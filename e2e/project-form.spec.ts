import { test, expect, Page } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';

const ADMIN_EMAIL = 'admin.projform.e2e@example.pl';
const ADMIN_PASS = 'Architektura-Formularz-2026!';

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        srv.close(() => reject(new Error('Nie udało się przydzielić portu TCP')));
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
      // Serwer startuje
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Serwer E2E formularza projektów nie odpowiedział na ${baseUrl}/api/health`);
}

function extractCookie(res: Response): string {
  const anyHeaders = res.headers as unknown as { getSetCookie?: () => string[] };
  const setCookies =
    typeof anyHeaders.getSetCookie === 'function'
      ? anyHeaders.getSetCookie()
      : res.headers.get('set-cookie')
        ? [res.headers.get('set-cookie') as string]
        : [];
  for (const raw of setCookies) {
    if (/(?:__Host-zp_session|zp_session)=([^;]+)/.test(raw)) {
      return raw.split(';')[0];
    }
  }
  return '';
}

async function loginThroughUi(page: Page, baseUrl: string, email: string, password: string): Promise<void> {
  await page.goto(baseUrl);
  await expect(page.getByRole('button', { name: 'Zaloguj do pracowni' })).toBeVisible();
  await page.getByLabel(/Adres e-mail/i).fill(email);
  await page.getByLabel(/Hasło dostępu/i).fill(password);
  await page.getByRole('button', { name: 'Zaloguj do pracowni' }).click();
  await expect(page.getByRole('button', { name: 'Wyloguj się z systemu' })).toBeVisible();
}

test.describe.serial('P76: Formularz projektu, VAT ZW, stany/priorytety w Ustawieniach i brak wartości (E2E)', () => {
  let serverProc: ChildProcess | null = null;
  let tempDataDir = '';
  let baseUrl = '';
  let vatCompanyId = '';
  let zwCompanyId = '';

  test.beforeAll(async () => {
    tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-e2e-projform-'));
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

    const setupRes = await fetch(`${baseUrl}/api/auth/setup-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Administrator Formularza',
        email: ADMIN_EMAIL,
        password: ADMIN_PASS,
      }),
    });
    if (!setupRes.ok) {
      throw new Error(`setup-admin failed: ${setupRes.status}`);
    }
    const adminCookie = extractCookie(setupRes);

    // Utwórz firmę VAT i firmę zwolnioną z VAT
    const compVatRes = await fetch(`${baseUrl}/api/companies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ name: 'Alfa VAT Studio', letter: 'A', isActive: true, vatPayer: true }),
    });
    if (!compVatRes.ok) throw new Error(`compVat failed: ${compVatRes.status}`);
    vatCompanyId = (await compVatRes.json()).company.id;

    const compZwRes = await fetch(`${baseUrl}/api/companies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Beta Zwolniona',
        letter: 'B',
        isActive: true,
        vatPayer: false,
        vatExemptionBasis: 'art. 113 ust. 1 ustawy o VAT',
      }),
    });
    if (!compZwRes.ok) throw new Error(`compZw failed: ${compZwRes.status}`);
    zwCompanyId = (await compZwRes.json()).company.id;
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

  test('tworzenie projektu z pustą domyślną wartością, VAT 0% ZW dla firmy zwolnionej, czyszczenie wartości i obsługa błędu', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await loginThroughUi(page, baseUrl, ADMIN_EMAIL, ADMIN_PASS);

    const nav = page.getByRole('navigation', { name: 'Główna nawigacja' });
    await nav.getByRole('button', { name: 'Projekty', exact: true }).click();

    // 1. Otwórz formularz tworzenia projektu i sprawdź puste pole wartości oraz kontrolki stanu/priorytetu
    await page.getByRole('button', { name: 'Zarejestruj nowy projekt' }).click();
    const createDialog = page.getByRole('dialog', { name: /Rejestracja Nowego Projektu/i });
    await expect(createDialog).toBeVisible();

    const valueInput = createDialog.locator('#project-value-net');
    const vatSelect = createDialog.locator('#project-vat-rate');
    const statusSelect = createDialog.locator('#project-status-select');
    const prioritySelect = createDialog.locator('#project-priority-select');
    const companySelect = createDialog.locator('#project-company-select');

    await expect(valueInput).toHaveValue('');
    await expect(statusSelect).toBeVisible();
    await expect(prioritySelect).toBeVisible();

    // Wybierz firmę zwolnioną z VAT -> stawka zmienia się na 0% (ZW) i pole VAT staje się zablokowane
    await companySelect.selectOption(zwCompanyId);
    await expect(vatSelect).toHaveValue('0');
    await expect(vatSelect).toBeDisabled();
    await expect(
      createDialog.getByText('Wybrana firma jest zwolniona z VAT — obowiązuje stawka 0% (ZW).')
    ).toBeVisible();

    await createDialog.locator('#project-name-input').fill('Pawilon Zwolniony Test');
    await statusSelect.selectOption('active');
    await prioritySelect.selectOption('high');
    await valueInput.fill('10000');

    // Symuluj błąd serwera (np. 409) przy pierwszym zapisie: okno pozostaje otwarte, pola zachowane, fokus na #project-form-error
    let intercepted = false;
    await page.route('**/api/projects', async (route) => {
      if (!intercepted && route.request().method() === 'POST') {
        intercepted = true;
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'Wykryto konflikt numeru projektu podczas zapisu.',
            field: 'name',
          }),
        });
        return;
      }
      await route.continue();
    });

    await createDialog.getByRole('button', { name: 'Zarejestruj projekt' }).click();

    const formError = createDialog.locator('#project-form-error');
    await expect(formError).toBeVisible();
    await expect(formError).toContainText('Wykryto konflikt numeru projektu podczas zapisu.');
    await expect(formError).toBeFocused();
    await expect(createDialog.locator('#project-name-input')).toHaveAttribute('aria-invalid', 'true');
    await expect(createDialog.locator('#project-name-input')).toHaveValue('Pawilon Zwolniony Test');
    await expect(valueInput).toHaveValue('10000');

    // Ponowny zapis przechodzi poprawnie (VAT 0% bez błędu 400 o niespójności brutto)
    await createDialog.getByRole('button', { name: 'Zarejestruj projekt' }).click();
    await expect(createDialog).toBeHidden();
    await expect(page.getByText('Pawilon Zwolniony Test')).toBeVisible();

    // 2. Edytuj projekt, wyczyść wartość netto i sprawdź w Ekonomii ("brak wartości" i suma 0,00 zł)
    await page.getByRole('button', { name: 'Lista' }).click();
    const table = page.getByRole('table');
    const row = table.locator('tbody tr', { hasText: 'Pawilon Zwolniony Test' });
    await row.getByRole('button', { name: /Edytuj projekt/i }).click();

    const editDialog = page.getByRole('dialog', { name: /Edycja Projektu/i });
    await expect(editDialog).toBeVisible();
    await editDialog.locator('#project-value-net').fill('');
    await editDialog.getByRole('button', { name: 'Zapisz zmiany w projekcie' }).click();
    await expect(editDialog).toBeHidden();

    await nav.getByRole('button', { name: 'Ekonomia', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Ekonomia i finanse firm' })).toBeVisible();
    const econRow = page.locator('tbody tr', { hasText: 'Pawilon Zwolniony Test' });
    await expect(econRow).toContainText('brak wartości');
    await expect(page.locator('tfoot')).toContainText('0,00 zł');

    // Przejdź do szczegółów projektu w Ekonomii -> karta wartości też pokazuje "brak wartości"
    await econRow.getByRole('button', { name: 'Pawilon Zwolniony Test' }).click();
    await expect(page.getByText('brak wartości')).toBeVisible();
  });

  test('konfiguracja stanów i priorytetów w Ustawieniach, ochrona używanych pozycji oraz wykluczenie stanu końcowego z ostrzeżeń', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await loginThroughUi(page, baseUrl, ADMIN_EMAIL, ADMIN_PASS);

    // 1. Otwórz Ustawienia -> Zmienne & Terminy i dodaj własny stan końcowy ("Anulowany") oraz priorytet ("Strategiczny")
    await page.getByRole('button', { name: 'Ustawienia systemu' }).click();
    const settingsDialog = page.getByRole('dialog', { name: /Ustawienia Pracowni/i });
    await expect(settingsDialog).toBeVisible();
    await settingsDialog.getByRole('tab', { name: /Zmienne & Terminy/i }).click();

    // Pozycje systemowe mają zablokowane usuwanie
    await expect(settingsDialog.getByRole('button', { name: 'Usuń stan Planowanie' })).toBeDisabled();
    await expect(settingsDialog.getByRole('button', { name: 'Usuń priorytet Normalny' })).toBeDisabled();

    // Dodaj stan "Anulowany" ze znacznikiem "Stan końcowy"
    await settingsDialog.locator('#settings-new-project-status-label').fill('Anulowany');
    await settingsDialog.getByLabel('Stan końcowy', { exact: true }).check();
    await settingsDialog.getByRole('button', { name: '+ Dodaj stan' }).click();
    await expect(settingsDialog.getByRole('button', { name: 'Usuń stan Anulowany' })).toBeEnabled();

    // Dodaj priorytet "Strategiczny"
    await settingsDialog.locator('#settings-new-project-priority-label').fill('Strategiczny');
    await settingsDialog.getByRole('button', { name: '+ Dodaj priorytet' }).click();
    await expect(settingsDialog.getByRole('button', { name: 'Usuń priorytet Strategiczny' })).toBeEnabled();

    await settingsDialog.getByRole('button', { name: 'Zamknij ustawienia' }).click();
    await expect(settingsDialog).toBeHidden();

    // 2. Zarejestruj dwa przeterminowane projekty (2020-01-10): jeden Aktywny, drugi Anulowany (końcowy) + Strategiczny
    const nav = page.getByRole('navigation', { name: 'Główna nawigacja' });
    await nav.getByRole('button', { name: 'Projekty', exact: true }).click();

    await page.getByRole('button', { name: 'Zarejestruj nowy projekt' }).click();
    let dialog = page.getByRole('dialog', { name: /Rejestracja Nowego Projektu/i });
    await dialog.locator('#project-company-select').selectOption(vatCompanyId);
    await dialog.locator('#project-name-input').fill('Projekt Anulowany Przeterminowany');
    await dialog.locator('#project-status-select').selectOption('anulowany');
    await dialog.locator('#project-priority-select').selectOption('strategiczny');
    await dialog.locator('#project-start-date').fill('2020-01-01');
    await dialog.locator('#project-due-date').fill('2020-01-10');
    await dialog.getByRole('button', { name: 'Zarejestruj projekt' }).click();
    await expect(dialog).toBeHidden();

    await page.getByRole('button', { name: 'Zarejestruj nowy projekt' }).click();
    dialog = page.getByRole('dialog', { name: /Rejestracja Nowego Projektu/i });
    await dialog.locator('#project-company-select').selectOption(vatCompanyId);
    await dialog.locator('#project-name-input').fill('Projekt Aktywny Przeterminowany');
    await dialog.locator('#project-status-select').selectOption('active');
    await dialog.locator('#project-start-date').fill('2020-01-01');
    await dialog.locator('#project-due-date').fill('2020-01-10');
    await dialog.getByRole('button', { name: 'Zarejestruj projekt' }).click();
    await expect(dialog).toBeHidden();

    // 3. W widoku listy: aktywny przeterminowany ma ostrzeżenie terminu, anulowany (końcowy) nie ma
    await page.getByRole('button', { name: 'Lista' }).click();
    const table = page.getByRole('table');
    const cancelledRow = table.locator('tbody tr', { hasText: 'Projekt Anulowany Przeterminowany' });
    const activeRow = table.locator('tbody tr', { hasText: 'Projekt Aktywny Przeterminowany' });

    await expect(cancelledRow).toContainText('Anulowany');
    await expect(cancelledRow).toContainText('Strategiczny');
    await expect(cancelledRow.locator('[title="Termin projektu przekroczony"]')).toHaveCount(0);
    await expect(activeRow.locator('[title="Termin projektu przekroczony"]')).toHaveCount(1);

    // 4. Wróć do Ustawień -> używany stan 'Anulowany' i priorytet 'Strategiczny' nie mogą być usunięte
    await page.getByRole('button', { name: 'Ustawienia systemu' }).click();
    const settingsAgain = page.getByRole('dialog', { name: /Ustawienia Pracowni/i });
    await settingsAgain.getByRole('tab', { name: /Zmienne & Terminy/i }).click();
    await expect(settingsAgain.getByRole('button', { name: 'Usuń stan Anulowany' })).toBeDisabled();
    await expect(settingsAgain.getByRole('button', { name: 'Usuń priorytet Strategiczny' })).toBeDisabled();
  });
});
