import { test, expect, Page } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';

const ADMIN_EMAIL = 'admin.dismiss.e2e@example.pl';
const ADMIN_PASS = 'Kasztan-Nakladka-2026!';

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
  throw new Error(`Serwer E2E nie odpowiedział na ${baseUrl}/api/health`);
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
    assertClean: async () => {
      const cspViolations = await page.evaluate(() => {
        const win = window as unknown as { __cspViolations?: string[] };
        return win.__cspViolations || [];
      });
      expect(consoleErrors, 'Błędy konsoli przeglądarki').toEqual([]);
      expect(pageErrors, 'Nieobsłużone wyjątki pageerror').toEqual([]);
      expect(cspViolations, 'Naruszenia Content-Security-Policy').toEqual([]);
    },
  };
}

test.describe.serial('P68: Zamykanie okien i menu kliknięciem poza nimi (E2E)', () => {
  let serverProc: ChildProcess | null = null;
  let tempDataDir = '';
  let baseUrl = '';
  let sampleTask: any;

  test.beforeAll(async () => {
    tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-e2e-dismiss-'));
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
        name: 'Admin Overlay E2E',
        email: ADMIN_EMAIL,
        password: ADMIN_PASS,
      }),
    });
    if (!setupRes.ok) throw new Error(`setup-admin failed: ${setupRes.status}`);
    const adminCookie = extractCookie(setupRes);
    const adminUser = (await setupRes.json()).user;

    const projRes = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Projekt Nakładki E2E',
        ownerId: adminUser.id,
        status: 'active',
        startDate: '2026-07-01',
        dueDate: '2026-07-31',
      }),
    });
    if (!projRes.ok) throw new Error(`create project failed: ${projRes.status}`);
    const project = (await projRes.json()).project;

    const taskRes = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        projectId: project.id,
        title: 'Zadanie startowe E2E',
        status: 'to_do',
        startDate: '2026-07-02',
        dueDate: '2026-07-10',
        durationDays: 8,
      }),
    });
    if (!taskRes.ok) throw new Error(`create task failed: ${taskRes.status}`);
    sampleTask = (await taskRes.json()).task;
  });

  test.afterAll(async () => {
    if (serverProc && !serverProc.killed) {
      serverProc.kill('SIGTERM');
    }
    if (tempDataDir) {
      fs.rmSync(tempDataDir, { recursive: true, force: true });
    }
  });

  test('TaskDetailDrawer zamyka się po kliknięciu w tło, synchronicznie zapisuje tytuł oraz blokuje zamknięcie przy pustym tytule', async ({ page }) => {
    const monitor = await attachErrorMonitor(page);
    await loginThroughUi(page, baseUrl, ADMIN_EMAIL, ADMIN_PASS);

    await page.getByRole('button', { name: 'Tablica Kanban' }).click();

    // Otwórz szufladę szczegółów zadania
    await page.getByRole('button', { name: new RegExp(`Zadanie ${sampleTask.code}: Zadanie startowe E2E`) }).click();
    const drawerDialog = page.getByRole('dialog', { name: 'Zadanie startowe E2E' });
    await expect(drawerDialog).toBeVisible();

    const titleInput = drawerDialog.getByRole('textbox', { name: 'Tytuł zadania' });
    await titleInput.fill('Zadanie po edycji E2E');

    // Kliknij bezpośrednio w tło na lewo od szuflady (max-w-xl jest przy prawej krawędzi) -> synchroniczny zapis i zamknięcie
    const patchPromise = page.waitForResponse(
      (res) => res.url().includes(`/api/tasks/${sampleTask.id}`) && res.request().method() === 'PATCH'
    );
    await page.mouse.click(32, 240);
    const patchRes = await patchPromise;
    expect(patchRes.status()).toBe(200);
    await expect(drawerDialog).toBeHidden();

    // Po przeładowaniu tytuł jest trwale zapisany
    await page.reload();
    await page.getByRole('button', { name: 'Tablica Kanban' }).click();
    const renamedCardBtn = page.getByRole('button', {
      name: new RegExp(`Zadanie ${sampleTask.code}: Zadanie po edycji E2E`),
    });
    await expect(renamedCardBtn).toBeVisible();

    // Otwórz ponownie i wyczyść tytuł -> kliknięcie w tło musi zablokować zamknięcie, ustawić fokus na polu tytułu i pokazać błąd
    await renamedCardBtn.click();
    const reopenedDrawer = page.getByRole('dialog', { name: 'Zadanie po edycji E2E' });
    await expect(reopenedDrawer).toBeVisible();

    const titleInputAgain = reopenedDrawer.getByRole('textbox', { name: 'Tytuł zadania' });
    await titleInputAgain.fill('   ');
    await page.mouse.click(32, 240);

    await expect(reopenedDrawer).toBeVisible();
    await expect(reopenedDrawer.getByRole('alert')).toContainText('Tytuł zadania nie może być pusty.');
    await expect(titleInputAgain).toBeFocused();

    // Po poprawieniu tytułu Escape synchronicznie zapisuje i zamyka szufladę
    await titleInputAgain.fill('Zadanie końcowe E2E');
    const escapePatchPromise = page.waitForResponse(
      (res) => res.url().includes(`/api/tasks/${sampleTask.id}`) && res.request().method() === 'PATCH'
    );
    await page.keyboard.press('Escape');
    const escapePatchRes = await escapePatchPromise;
    expect(escapePatchRes.status()).toBe(200);
    await expect(reopenedDrawer).toBeHidden();
    await expect(
      page.getByRole('button', {
        name: new RegExp(`Zadanie ${sampleTask.code}: Zadanie końcowe E2E`),
      })
    ).toBeVisible();

    await monitor.assertClean();
  });

  test('TaskModal (Grupa B) nie zamyka się po kliknięciu w tło, przy brudnym formularzu błyska ramką, przenosi fokus na Anuluj i pyta przed odrzuceniem na Escape', async ({ page }) => {
    const monitor = await attachErrorMonitor(page);
    await loginThroughUi(page, baseUrl, ADMIN_EMAIL, ADMIN_PASS);

    await page.getByRole('button', { name: 'Tablica Kanban' }).click();

    await page.getByRole('button', { name: 'Nowe zadanie' }).first().click();
    const taskDialog = page.getByRole('dialog', { name: 'Nowe Zadanie', exact: true });
    await expect(taskDialog).toBeVisible();

    // Czysty formularz + kliknięcie poza oknem -> pozostaje otwarte
    await page.mouse.click(12, 12);
    await expect(taskDialog).toBeVisible();

    // Wprowadź zmianę w formularzu (isDirty = true)
    await taskDialog.getByLabel(/Tytuł zadania/i).fill('Niezapisane zadanie formularza');

    // Kliknięcie w tło -> nie zamyka, dodaje animację błysku ramki i przenosi fokus na 'Anuluj'
    await page.mouse.click(12, 12);
    await expect(taskDialog).toBeVisible();
    await expect(taskDialog).toHaveClass(/animate-modal-flash/);
    const cancelBtn = taskDialog.getByRole('button', { name: 'Anuluj' });
    await expect(cancelBtn).toBeFocused();

    // Escape przy brudnym formularzu -> otwiera dialog 'Odrzucić niezapisane zmiany?'
    await page.keyboard.press('Escape');
    const discardDialog = page.getByRole('dialog', { name: 'Odrzucić niezapisane zmiany?' });
    await expect(discardDialog).toBeVisible();
    await expect(taskDialog).toBeVisible();

    // Kliknięcie 'Wróć do edycji' zamyka tylko monit o odrzucenie i wraca do formularza
    await discardDialog.getByRole('button', { name: 'Wróć do edycji' }).click();
    await expect(discardDialog).toBeHidden();
    await expect(taskDialog).toBeVisible();

    // Ponowne Escape -> 'Odrzuć zmiany' zamyka oba okna bez zapisywania
    await page.keyboard.press('Escape');
    await expect(discardDialog).toBeVisible();
    await discardDialog.getByRole('button', { name: 'Odrzuć zmiany' }).click();
    await expect(discardDialog).toBeHidden();
    await expect(taskDialog).toBeHidden();
    await expect(page.getByText('Niezapisane zadanie formularza')).toHaveCount(0);

    await monitor.assertClean();
  });

  test('Menu „Przenieś do…” na tablicy Kanban zamyka się po kliknięciu obok i przywraca fokus na przycisk wyzwalający', async ({ page }) => {
    const monitor = await attachErrorMonitor(page);
    await loginThroughUi(page, baseUrl, ADMIN_EMAIL, ADMIN_PASS);

    await page.getByRole('button', { name: 'Tablica Kanban' }).click();

    const triggerBtn = page.getByRole('button', { name: 'Przenieś do…' }).first();
    await triggerBtn.click({ force: true });

    const menu = page.getByRole('menu', { name: /Przenieś zadanie .* do statusu/i });
    await expect(menu).toBeVisible();

    // Kliknięcie poza menu (w tło widoku) -> zamyka menu i zwraca fokus na triggerBtn
    await page.mouse.click(24, 24);
    await expect(menu).toBeHidden();
    await expect(triggerBtn).toBeFocused();

    await monitor.assertClean();
  });
});
