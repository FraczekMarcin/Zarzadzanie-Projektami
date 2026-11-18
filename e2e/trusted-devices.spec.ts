import { test, expect, Page } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';

const ADMIN_NAME = 'Tomasz Kowalczyk';
const ADMIN_EMAIL = 'trusted.e2e@example.pl';
const ADMIN_PASS = 'Pracownia-Zaufanie-2026!';

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        srv.close(() => reject(new Error('Nie udało się przydzielić wolnego portu TCP')));
        return;
      }
      const { port } = addr;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function waitForServerReady(baseUrl: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
    } catch {
      // Serwer w trakcie uruchamiania
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Serwer E2E dla zaufanych urządzeń nie odpowiedział na ${baseUrl}/api/health`);
}

async function attachErrorMonitor(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  await page.addInitScript(() => {
    const win = window as unknown as { __cspViolations?: string[] };
    win.__cspViolations = [];
    window.addEventListener('securitypolicyviolation', (event) => {
      win.__cspViolations?.push(
        `${event.violatedDirective || event.effectiveDirective}: ${event.blockedURI}`
      );
    });
  });

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('pageerror', (err) => {
    pageErrors.push(err.message || String(err));
  });

  return {
    consoleErrors,
    clearConsoleErrors: () => {
      consoleErrors.length = 0;
    },
    assertClean: async (allowExpected401 = false) => {
      const cspViolations = await page.evaluate(() => {
        const win = window as unknown as { __cspViolations?: string[] };
        return win.__cspViolations || [];
      });
      const unexpectedConsole = allowExpected401
        ? consoleErrors.filter((msg) => !msg.includes('401 (Unauthorized)'))
        : consoleErrors;
      expect(unexpectedConsole, 'Błędy konsoli przeglądarki').toEqual([]);
      expect(pageErrors, 'Nieobsłużone wyjątki pageerror').toEqual([]);
      expect(cspViolations, 'Naruszenia Content-Security-Policy').toEqual([]);
    },
  };
}

test.describe('P52: Zaufane urządzenia przy logowaniu (Playwright E2E)', () => {
  let serverProc: ChildProcess | null = null;
  let tempDataDir = '';
  let baseUrl = '';

  test.beforeAll(async () => {
    tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-e2e-trusted-'));
    const port = await findFreePort();
    baseUrl = `http://127.0.0.1:${port}`;
    const appSecret = crypto.randomBytes(32).toString('hex');

    serverProc = spawn('node', ['dist/server.js'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(port),
        DATA_DIR: tempDataDir,
        APP_SECRET: appSecret,
      },
      stdio: 'ignore',
    });

    await waitForServerReady(baseUrl);
  });

  test.afterAll(async () => {
    if (serverProc && !serverProc.killed) {
      serverProc.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 300));
    }
    if (tempDataDir && fs.existsSync(tempDataDir)) {
      fs.rmSync(tempDataDir, { recursive: true, force: true });
    }
  });

  test('ciche odnowienie sesji z „Ufaj temu urządzeniu”, lista w koncie i powrót do logowania bez zaufania', async ({
    page,
    context,
  }) => {
    const monitor = await attachErrorMonitor(page);

    // 1. Konfiguracja pierwszego administratora
    await page.goto(baseUrl);
    await expect(page.getByRole('heading', { name: 'Kreator Konfiguracji Administratora' })).toBeVisible();
    await page.getByLabel(/Imię i Nazwisko Administratora/i).fill(ADMIN_NAME);
    await page.getByLabel(/Adres e-mail/i).fill(ADMIN_EMAIL);
    await page.getByLabel(/Hasło Administratora/i).fill(ADMIN_PASS);
    await page.getByLabel(/Powtórz hasło/i).fill(ADMIN_PASS);
    await page.getByRole('button', { name: 'Utwórz konto Administratora i przejdź do systemu' }).click();
    await expect(page.getByRole('button', { name: 'Wyloguj się z systemu' })).toBeVisible();

    // 2. Wylogowanie i sprawdzenie, że opcja „Ufaj temu urządzeniu” jest domyślnie odznaczona
    await page.getByRole('button', { name: 'Wyloguj się z systemu' }).click();
    await expect(page.getByRole('button', { name: 'Zaloguj do pracowni' })).toBeVisible();

    const trustCheckbox = page.getByRole('checkbox', { name: /Ufaj temu urządzeniu przez/i });
    await expect(trustCheckbox).toBeVisible();
    await expect(trustCheckbox).not.toBeChecked();

    // 3. Przypadek A: logowanie BEZ zaznaczenia -> usunięcie ciasteczka sesji przenosi na ekran logowania
    await page.getByLabel(/Adres e-mail/i).fill(ADMIN_EMAIL);
    await page.getByLabel(/Hasło dostępu/i).fill(ADMIN_PASS);
    await page.getByRole('button', { name: 'Zaloguj do pracowni' }).click();
    await expect(page.getByRole('button', { name: 'Wyloguj się z systemu' })).toBeVisible();
    await monitor.assertClean();

    await context.clearCookies({ name: 'zp_session' });
    await context.clearCookies({ name: '__Host-zp_session' });
    await page.reload();
    await expect(page.getByRole('button', { name: 'Zaloguj do pracowni' })).toBeVisible();
    await monitor.assertClean(true);
    monitor.clearConsoleErrors();

    // 4. Przypadek B: logowanie Z zaznaczeniem „Ufaj temu urządzeniu”
    await page.getByLabel(/Adres e-mail/i).fill(ADMIN_EMAIL);
    await page.getByLabel(/Hasło dostępu/i).fill(ADMIN_PASS);
    const trustCheckboxAgain = page.getByRole('checkbox', { name: /Ufaj temu urządzeniu przez/i });
    await expect(trustCheckboxAgain).not.toBeChecked();
    await trustCheckboxAgain.check();
    await expect(trustCheckboxAgain).toBeChecked();

    await page.getByRole('button', { name: 'Zaloguj do pracowni' }).click();
    await expect(page.getByRole('button', { name: 'Wyloguj się z systemu' })).toBeVisible();
    await monitor.assertClean();

    // 5. Usunięcie wyłącznie ciasteczka sesji (zostaje HttpOnly zp_device) -> przeładowanie utrzymuje logowanie
    await context.clearCookies({ name: 'zp_session' });
    await context.clearCookies({ name: '__Host-zp_session' });

    const cookiesBeforeReload = await context.cookies();
    expect(cookiesBeforeReload.some((c) => c.name === 'zp_session' || c.name === '__Host-zp_session')).toBe(false);
    expect(cookiesBeforeReload.some((c) => c.name === 'zp_device' && c.httpOnly)).toBe(true);

    await page.reload();
    await expect(page.getByRole('button', { name: 'Wyloguj się z systemu' })).toBeVisible();
    await monitor.assertClean(true);
    monitor.clearConsoleErrors();

    // 6. Zakładka „Zaufane urządzenia” w oknie konta pokazuje „To urządzenie” i pozwala cofnąć zaufanie
    await page.getByRole('button', { name: new RegExp(`Konto użytkownika: ${ADMIN_NAME}`, 'i') }).click();
    const accountDialog = page.getByRole('dialog');
    await expect(accountDialog).toBeVisible();

    await accountDialog.getByRole('tab', { name: /Zaufane urządzenia/i }).click();
    await expect(accountDialog.getByText('To urządzenie')).toBeVisible();

    // Usuń zaufanie bieżącego urządzenia i zamknij okno
    await accountDialog.getByRole('button', { name: 'Usuń zaufanie' }).first().click();
    await expect(accountDialog.getByText('Brak zaufanych urządzeń powiązanych z tym kontem.')).toBeVisible();
    await accountDialog.getByRole('button', { name: 'Zamknij okno uwierzytelniania' }).click();
    await monitor.assertClean();

    // Po usunięciu ciasteczka sesji ponowne przeładowanie przenosi na ekran logowania
    await context.clearCookies({ name: 'zp_session' });
    await context.clearCookies({ name: '__Host-zp_session' });
    await page.reload();
    await expect(page.getByRole('button', { name: 'Zaloguj do pracowni' })).toBeVisible();

    await monitor.assertClean(true);
  });
});
