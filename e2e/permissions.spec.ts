import { test, expect, Page, BrowserContext } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';

const ADMIN_EMAIL = 'admin.perm.e2e@example.pl';
const ADMIN_PASS = 'Katedra-Uprawnienia-2026!';
const DEV_EMAIL = 'dev.perm.e2e@example.pl';
const DEV_PASS = 'Projektant-Dostep-91!';

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
      // Serwer uruchamia się
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Izolowany serwer E2E uprawnień nie odpowiedział na ${baseUrl}/api/health`);
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

async function loginThroughUi(
  page: Page,
  baseUrl: string,
  email: string,
  password: string
): Promise<void> {
  await page.goto(baseUrl);
  await expect(page.getByRole('button', { name: 'Zaloguj do pracowni' })).toBeVisible();
  await page.getByLabel(/Adres e-mail/i).fill(email);
  await page.getByLabel(/Hasło dostępu/i).fill(password);
  await page.getByRole('button', { name: 'Zaloguj do pracowni' }).click();
  await expect(page.getByRole('button', { name: 'Wyloguj się z systemu' })).toBeVisible();
}

async function openSettingsPermissionsTab(page: Page) {
  await page.getByRole('button', { name: 'Ustawienia systemu' }).click();
  const settingsDialog = page.getByRole('dialog', { name: /Ustawienia Pracowni/i });
  await expect(settingsDialog).toBeVisible();
  await settingsDialog.getByRole('tab', { name: 'Uprawnienia', exact: true }).click();
  await expect(settingsDialog.getByText('Ładowanie sekcji...')).toHaveCount(0);
  await expect(settingsDialog.getByText('Ładowanie konfiguracji uprawnień...')).toHaveCount(0);
  return settingsDialog;
}

test.describe.serial('System uprawnień, grup i przypisań do firm — interfejs E2E', () => {
  let serverProc: ChildProcess | null = null;
  let tempDataDir = '';
  let baseUrl = '';
  let adminContext: BrowserContext;
  let devContext: BrowserContext;
  let adminPage: Page;
  let devPage: Page;
  let projectAKey = '';
  let projectBKey = '';

  test.beforeAll(async ({ browser }) => {
    tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-e2e-permissions-'));
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
        name: 'Administrator E2E',
        email: ADMIN_EMAIL,
        password: ADMIN_PASS,
      }),
    });
    if (!setupRes.ok) throw new Error(`setup-admin failed: ${setupRes.status}`);
    const adminCookie = extractCookie(setupRes);
    const setupJson = await setupRes.json();
    const adminId: string = setupJson.user.id;

    const devRes = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Jan Deweloper',
        email: DEV_EMAIL,
        role: 'developer',
        department: 'Konstrukcja',
        password: DEV_PASS,
      }),
    });
    if (!devRes.ok) throw new Error(`create dev failed: ${devRes.status}`);

    const compARes = await fetch(`${baseUrl}/api/companies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Firma Alfa',
        letter: 'A',
        color: '#0369a1',
        isActive: true,
        vatPayer: true,
      }),
    });
    if (!compARes.ok) throw new Error(`create company A failed: ${compARes.status}`);
    const compAJson = await compARes.json();
    const companyAId: string = compAJson.company.id;

    const compBRes = await fetch(`${baseUrl}/api/companies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Firma Beta',
        letter: 'B',
        color: '#6d28d9',
        isActive: true,
        vatPayer: true,
      }),
    });
    if (!compBRes.ok) throw new Error(`create company B failed: ${compBRes.status}`);
    const compBJson = await compBRes.json();
    const companyBId: string = compBJson.company.id;

    const projARes = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Alfa Budynek',
        companyId: companyAId,
        ownerId: adminId,
        memberIds: [adminId],
        priority: 'normal',
        status: 'active',
        startDate: '2026-01-10',
        dueDate: '2026-10-30',
      }),
    });
    if (!projARes.ok) {
      throw new Error(`create project A failed: ${projARes.status} ${await projARes.text()}`);
    }
    projectAKey = (await projARes.json()).project.key;

    const projBRes = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Beta Hala',
        companyId: companyBId,
        ownerId: adminId,
        memberIds: [adminId],
        priority: 'normal',
        status: 'active',
        startDate: '2026-01-10',
        dueDate: '2026-10-30',
      }),
    });
    if (!projBRes.ok) {
      throw new Error(`create project B failed: ${projBRes.status} ${await projBRes.text()}`);
    }
    projectBKey = (await projBRes.json()).project.key;

    adminContext = await browser.newContext();
    devContext = await browser.newContext();
    adminPage = await adminContext.newPage();
    devPage = await devContext.newPage();

    await loginThroughUi(adminPage, baseUrl, ADMIN_EMAIL, ADMIN_PASS);
    await loginThroughUi(devPage, baseUrl, DEV_EMAIL, DEV_PASS);
  });

  test.afterAll(async () => {
    await adminContext?.close().catch(() => {});
    await devContext?.close().catch(() => {});

    if (serverProc && !serverProc.killed) {
      serverProc.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          serverProc?.kill('SIGKILL');
          resolve();
        }, 3_000);
        serverProc?.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    if (tempDataDir && fs.existsSync(tempDataDir)) {
      fs.rmSync(tempDataDir, { recursive: true, force: true });
    }
  });

  test('1) włączenie i wyłączenie uprawnienia roli aktualizuje menu drugiego użytkownika bez przeładowania', async () => {
    const devNav = devPage.getByRole('navigation', { name: 'Główna nawigacja' });
    await expect(devNav.getByRole('button', { name: 'Przetargi', exact: true })).toHaveCount(0);

    const settingsDialog = await openSettingsPermissionsTab(adminPage);
    await expect(
      settingsDialog.getByRole('button', { name: 'Zapisz uprawnienia ról' })
    ).toBeVisible();

    const devTendersCheckbox = settingsDialog.getByRole('checkbox', {
      name: 'Podgląd przetargów dla roli Projektant / Inżynier',
    });
    await expect(devTendersCheckbox).not.toBeChecked();
    await devTendersCheckbox.check();

    await settingsDialog.getByPlaceholder('Hasło administratora').fill(ADMIN_PASS);
    const saveEnablePromise = adminPage.waitForResponse(
      (res) => res.url().includes('/api/admin/permissions') && res.request().method() === 'PUT'
    );
    await settingsDialog.getByRole('button', { name: 'Zapisz uprawnienia ról' }).click();
    expect((await saveEnablePromise).status()).toBe(200);
    await expect(settingsDialog.getByText('Zapisano uprawnienia ról.')).toBeVisible();

    // SSE odświeża uprawnienia zalogowanego dewelopera w locie — bez page.reload()
    await expect(devNav.getByRole('button', { name: 'Przetargi', exact: true })).toBeVisible();

    // Wyłączenie uprawnienia z powrotem również znika na żywo
    await devTendersCheckbox.uncheck();
    await settingsDialog.getByPlaceholder('Hasło administratora').fill(ADMIN_PASS);
    const saveDisablePromise = adminPage.waitForResponse(
      (res) => res.url().includes('/api/admin/permissions') && res.request().method() === 'PUT'
    );
    await settingsDialog.getByRole('button', { name: 'Zapisz uprawnienia ról' }).click();
    expect((await saveDisablePromise).status()).toBe(200);

    await expect(devNav.getByRole('button', { name: 'Przetargi', exact: true })).toHaveCount(0);

    await settingsDialog.getByRole('button', { name: 'Zamknij ustawienia' }).click();
    await expect(settingsDialog).toHaveCount(0);
  });

  test('2) utworzenie grupy, przypisanie do użytkownika z podglądem efektywnych uprawnień oraz usunięcie grupy z ostrzeżeniem o liczbie członków', async () => {
    const devNav = devPage.getByRole('navigation', { name: 'Główna nawigacja' });
    await expect(devNav.getByRole('button', { name: 'Kosz', exact: true })).toHaveCount(0);

    const settingsDialog = await openSettingsPermissionsTab(adminPage);

    // Utworzenie grupy „Kosz i Szablony”
    await settingsDialog.getByRole('tab', { name: /^Grupy/i }).click();
    await settingsDialog.getByRole('button', { name: 'Nowa grupa' }).click();

    const groupDialog = adminPage.getByRole('dialog', { name: 'Nowa grupa uprawnień' });
    await expect(groupDialog).toBeVisible();
    await groupDialog.getByPlaceholder('np. Zespół przetargowy').fill('Kosz i Szablony');
    await groupDialog
      .getByPlaceholder('Krótki opis przeznaczenia grupy')
      .fill('Uprawnienia do kosza i szablonów projektów');

    await groupDialog.locator('label', { hasText: 'Zarządzanie szablonami' }).locator('input[type="checkbox"]').check();
    await groupDialog.locator('label', { hasText: 'Zarządzanie koszem' }).locator('input[type="checkbox"]').check();

    const createGroupPromise = adminPage.waitForResponse(
      (res) =>
        res.url().includes('/api/admin/permission-groups') && res.request().method() === 'POST'
    );
    await groupDialog.getByRole('button', { name: 'Utwórz grupę' }).click();
    expect((await createGroupPromise).status()).toBe(201);
    await expect(groupDialog).toHaveCount(0);
    await expect(settingsDialog.getByText('Kosz i Szablony')).toBeVisible();

    // Przypisanie grupy do dewelopera z podzakładki Użytkownicy + sprawdzenie podglądu źródeł
    await settingsDialog.getByRole('tab', { name: /^Użytkownicy/i }).click();
    const devRow = settingsDialog.locator('tr', { hasText: DEV_EMAIL });
    await devRow.getByRole('button', { name: 'Edytuj dostęp' }).click();

    const accessModal = adminPage.getByRole('dialog', {
      name: /Uprawnienia użytkownika: Jan Deweloper/i,
    });
    await expect(accessModal).toBeVisible();

    await accessModal
      .locator('label', { hasText: 'Kosz i Szablony' })
      .locator('input[type="checkbox"]')
      .check();

    // Podgląd efektywnych uprawnień powinien oznaczyć źródło jako „grupa”
    const templatesRow = accessModal.locator('tr', { hasText: 'templates.manage' });
    await expect(templatesRow).toContainText('Dostęp pełny');
    await expect(templatesRow).toContainText('grupa: Kosz i Szablony');

    const trashRow = accessModal.locator('tr', { hasText: 'trash.manage' });
    await expect(trashRow).toContainText('grupa: Kosz i Szablony');

    const saveAccessPromise = adminPage.waitForResponse(
      (res) =>
        res.url().includes('/api/admin/users/') &&
        res.url().includes('/access') &&
        res.request().method() === 'PUT'
    );
    await accessModal.getByRole('button', { name: 'Zapisz uprawnienia użytkownika' }).click();
    expect((await saveAccessPromise).status()).toBe(200);
    await expect(accessModal).toHaveCount(0);

    // Weryfikacja na koncie dewelopera: widoczny Kosz oraz zakładka Szablony projektów w Ustawieniach
    await expect(devNav.getByRole('button', { name: 'Kosz', exact: true })).toBeVisible();
    await devPage.getByRole('button', { name: 'Ustawienia systemu' }).click();
    const devSettings = devPage.getByRole('dialog', { name: /Ustawienia Pracowni/i });
    await expect(devSettings.getByRole('tab', { name: 'Szablony projektów' })).toBeVisible();
    await devSettings.getByRole('button', { name: 'Zamknij ustawienia' }).click();
    await expect(devSettings).toHaveCount(0);

    // Powrót do podzakładki Grupy: widoczna liczba członków oraz ostrzeżenie przy usuwaniu
    await settingsDialog.getByRole('tab', { name: /^Grupy/i }).click();
    const groupCard = settingsDialog.locator('div', {
      hasText: 'Uprawnienia do kosza i szablonów projektów',
    }).filter({ has: adminPage.getByRole('button', { name: 'Usuń' }) }).first();
    await expect(groupCard).toContainText('Użytkownicy: 1');

    await groupCard.getByRole('button', { name: 'Usuń', exact: true }).click();
    const delDialog = adminPage.getByRole('dialog', { name: /Usuń grupę/i });
    await expect(delDialog).toBeVisible();
    await expect(delDialog).toContainText('1 użytkowników');

    const deleteGroupPromise = adminPage.waitForResponse(
      (res) =>
        res.url().includes('/api/admin/permission-groups/') && res.request().method() === 'DELETE'
    );
    await delDialog.getByRole('button', { name: 'Tak, usuń grupę' }).click();
    expect((await deleteGroupPromise).status()).toBe(200);
    await expect(delDialog).toHaveCount(0);

    await expect(devNav.getByRole('button', { name: 'Kosz', exact: true })).toHaveCount(0);

    await settingsDialog.getByRole('button', { name: 'Zamknij ustawienia' }).click();
    await expect(settingsDialog).toHaveCount(0);
  });

  test('3) przypisanie użytkownika do Firmy A odblokowuje edycję jej projektu przy zablokowaniu edycji projektu Firmy B oraz aktualizuje licznik w Firmach', async () => {
    const settingsDialog = await openSettingsPermissionsTab(adminPage);

    await settingsDialog.getByRole('tab', { name: /^Członkowie firm/i }).click();
    const addSelectA = settingsDialog.getByLabel('Dodaj użytkownika do firmy Firma Alfa');
    await expect(addSelectA).toBeVisible();

    const devOptionValue = await addSelectA.evaluate((selectEl) => {
      const select = selectEl as HTMLSelectElement;
      const opt = Array.from(select.options).find((o) => o.text.includes('Jan Deweloper'));
      return opt?.value || '';
    });
    expect(devOptionValue).not.toBe('');
    await addSelectA.selectOption(devOptionValue);

    const companyACard = settingsDialog
      .locator('div.rounded-xl')
      .filter({ has: settingsDialog.getByLabel('Dodaj użytkownika do firmy Firma Alfa') })
      .first();

    const assignPromise = adminPage.waitForResponse(
      (res) =>
        res.url().includes('/api/admin/users/') &&
        res.url().includes('/access') &&
        res.request().method() === 'PUT'
    );
    await companyACard.getByRole('button', { name: 'Dodaj', exact: true }).click();
    expect((await assignPromise).status()).toBe(200);
    await expect(companyACard).toContainText('Przypisani członkowie: 1');

    // Zakładka Firmy pokazuje liczbę członków przy firmie
    await settingsDialog.getByRole('tab', { name: /^Firmy\b/i }).click();
    await expect(settingsDialog.getByText('Ładowanie sekcji...')).toHaveCount(0);
    const alfaCompanyEntry = settingsDialog
      .locator('div', { hasText: 'Firma Alfa' })
      .filter({ hasText: 'Członkowie:' })
      .first();
    await expect(alfaCompanyEntry).toContainText('Członkowie: 1');

    await settingsDialog.getByRole('button', { name: 'Zamknij ustawienia' }).click();
    await expect(settingsDialog).toHaveCount(0);

    // Deweloper widzi projekty: ALFA (Firma A) może edytować, BETA (Firma B) ma wyłączoną edycję
    const devNav = devPage.getByRole('navigation', { name: 'Główna nawigacja' });
    await devNav.getByRole('button', { name: 'Projekty', exact: true }).click();
    await expect(devPage.getByRole('heading', { name: /Rejestr Projektów/i })).toBeVisible();

    const editAlfaBtn = devPage.getByRole('button', { name: `Edytuj projekt ${projectAKey}` }).first();
    const editBetaBtn = devPage.getByRole('button', { name: `Edytuj projekt ${projectBKey}` }).first();

    await expect(editAlfaBtn).toBeEnabled();
    await expect(editBetaBtn).toBeDisabled();
    await expect(editBetaBtn).toHaveAttribute(
      'title',
      'Brak uprawnienia: projects.edit. Poproś administratora.'
    );

    // Rzeczywista edycja i zapis projektu ALFA powodzi się
    await editAlfaBtn.click();
    const editModal = devPage.getByRole('dialog');
    await expect(editModal.getByLabel(/Nazwa pełna/i)).toBeVisible();
    await editModal.getByLabel(/Nazwa pełna/i).fill('Alfa Budynek (edytowany przez członka firmy)');

    const saveProjPromise = devPage.waitForResponse(
      (res) => res.url().includes('/api/projects/') && res.request().method() === 'PUT'
    );
    await editModal.getByRole('button', { name: 'Zapisz zmiany w projekcie' }).click();
    expect((await saveProjPromise).status()).toBe(200);
    await expect(devPage.getByText('Alfa Budynek (edytowany przez członka firmy)').first()).toBeVisible();
  });
});
