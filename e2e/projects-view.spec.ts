import { test, expect, Page } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';

const ADMIN_EMAIL = 'admin.projview.e2e@example.pl';
const ADMIN_PASS = 'Architektura-Kafelki-2026!';
const DEV_EMAIL = 'dev.projview.e2e@example.pl';
const DEV_PASS = 'Karton-Szklo-Miedz-2026!';

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
  throw new Error(`Serwer E2E widoku projektów nie odpowiedział na ${baseUrl}/api/health`);
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

test.describe.serial('Zakładka Projekty — przełącznik Kafelki / Lista, sortowanie i akcje (E2E)', () => {
  let serverProc: ChildProcess | null = null;
  let tempDataDir = '';
  let baseUrl = '';
  let proj1Key = '';
  let projArchKey = '';

  test.beforeAll(async () => {
    tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-e2e-projview-'));
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

    // 1. Setup administratora
    const setupRes = await fetch(`${baseUrl}/api/auth/setup-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Administrator Projektów',
        email: ADMIN_EMAIL,
        password: ADMIN_PASS,
      }),
    });
    if (!setupRes.ok) {
      throw new Error(`setup-admin failed: ${setupRes.status}`);
    }
    const adminCookie = extractCookie(setupRes);
    const adminId = (await setupRes.json()).user.id as string;

    // 2. Utwórz zwykłego projektanta (developer bez własności projektu)
    const devRes = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Projektant Janusz',
        email: DEV_EMAIL,
        role: 'developer',
        department: 'Architektura',
        password: DEV_PASS,
      }),
    });
    if (!devRes.ok) {
      throw new Error(`create dev failed: ${devRes.status}`);
    }
    const devId = (await devRes.json()).user.id as string;

    // 3. Utwórz firmy A i B
    const compARes = await fetch(`${baseUrl}/api/companies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ name: 'Alfa Studio', letter: 'A', isActive: true }),
    });
    const compA = (await compARes.json()).company;

    const compBRes = await fetch(`${baseUrl}/api/companies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ name: 'Beta Pracownia', letter: 'B', isActive: true }),
    });
    const compB = (await compBRes.json()).company;

    // 4. Utwórz projekty (2 aktywne + 1 archiwalny)
    const proj1Res = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        companyId: compA.id,
        name: 'Zespół Biurowy Omega',
        clientName: 'Omega Inwestycje',
        priority: 'normal',
        status: 'active',
        startDate: '2026-01-10',
        dueDate: '2026-10-30',
        progress: 25,
        ownerId: adminId,
        memberIds: [adminId, devId],
        projectValue: 50000,
      }),
    });
    if (!proj1Res.ok) throw new Error(`proj1 failed: ${proj1Res.status}`);
    const proj1 = (await proj1Res.json()).project;
    proj1Key = proj1.key;

    const proj2Res = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        companyId: compB.id,
        name: 'Akademik Centralny',
        clientName: 'Uczelnia Publiczna',
        priority: 'critical',
        status: 'planning',
        startDate: '2026-02-01',
        dueDate: '2026-06-15',
        progress: 80,
        ownerId: adminId,
        memberIds: [adminId, devId],
        projectValue: 120000,
      }),
    });
    if (!proj2Res.ok) throw new Error(`proj2 failed: ${proj2Res.status}`);
    const proj2 = (await proj2Res.json()).project;

    // Dodaj zaległe i otwarte zadania do proj2
    await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        projectId: proj2.id,
        title: 'Zadanie zaległe E2E',
        startDate: '2020-01-01',
        dueDate: '2020-01-10',
        status: 'in_progress',
      }),
    });

    // Dodaj ukończone i bieżące zadanie do proj1
    await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        projectId: proj1.id,
        title: 'Zadanie otwarte E2E',
        startDate: '2026-03-01',
        dueDate: '2099-12-31',
        status: 'to_do',
      }),
    });

    // 5. Projekt archiwalny
    const projArchRes = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        companyId: compA.id,
        name: 'Archiwalny Pawilon',
        clientName: 'Miasto Testowe',
        priority: 'low',
        status: 'completed',
        isArchived: true,
        progress: 100,
        ownerId: adminId,
        memberIds: [adminId, devId],
      }),
    });
    if (!projArchRes.ok) throw new Error(`projArch failed: ${projArchRes.status}`);
    const projArch = (await projArchRes.json()).project;
    projArchKey = projArch.key;
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

  test('przełączanie Kafelki/Lista, pamiętanie po odświeżeniu i wylogowaniu, sortowanie i akcje', async ({ page }) => {
    test.setTimeout(90_000);
    await loginThroughUi(page, baseUrl, ADMIN_EMAIL, ADMIN_PASS);

    const nav = page.getByRole('navigation', { name: 'Główna nawigacja' });
    await nav.getByRole('button', { name: 'Projekty', exact: true }).click();

    const switcher = page.getByRole('group', { name: 'Widok listy projektów' });
    const tilesBtn = switcher.getByRole('button', { name: 'Kafelki' });
    const listBtn = switcher.getByRole('button', { name: 'Lista' });

    // Domyślnie aktywny widok Kafelki
    await expect(tilesBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(listBtn).toHaveAttribute('aria-pressed', 'false');

    // Akcje w widoku Kafelki: podgląd projektu
    await page.getByRole('button', { name: `Podgląd projektu ${proj1Key}` }).click();
    const detailDialog = page.getByRole('dialog');
    await expect(detailDialog.getByRole('heading', { name: 'Zespół Biurowy Omega' })).toBeVisible();
    await detailDialog.getByRole('button', { name: 'Zamknij szczegóły projektu' }).click();

    // Przełącz na widok Lista
    await listBtn.click();
    await expect(listBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(tilesBtn).toHaveAttribute('aria-pressed', 'false');
    expect(await page.evaluate(() => localStorage.getItem('oph_pref_projects_view'))).toBe('list');

    const table = page.getByRole('table');
    await expect(table).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Zamawiający' })).toBeVisible();
    await expect(table).toContainText('Omega Inwestycje');
    await expect(table).toContainText('Uczelnia Publiczna');
    await expect(table).toContainText('1 otw.');
    await expect(table).toContainText('1 zal.');

    // Przeładuj stronę -> nadal aktywny widok Lista
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Wyloguj się z systemu' })).toBeVisible();
    await nav.getByRole('button', { name: 'Projekty', exact: true }).click();
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Lista' })).toHaveAttribute('aria-pressed', 'true');

    // Sortowanie po kolumnie Nazwa (aria-sort ascending -> descending)
    const nameHeader = table.getByRole('columnheader', { name: 'Nazwa' });
    await nameHeader.getByRole('button', { name: 'Nazwa' }).click();
    await expect(nameHeader).toHaveAttribute('aria-sort', 'ascending');
    const firstAsc = await table.locator('tbody tr').nth(0).textContent();
    expect(firstAsc).toContain('Akademik Centralny');

    await nameHeader.getByRole('button', { name: 'Nazwa' }).click();
    await expect(nameHeader).toHaveAttribute('aria-sort', 'descending');
    const firstDesc = await table.locator('tbody tr').nth(0).textContent();
    expect(firstDesc).toContain('Zespół Biurowy Omega');

    // Akcje w widoku Lista: Finanse + Edycja + Podgląd + Otwórz
    await table.getByRole('button', { name: `Kosztorys i wyceny projektu ${proj1Key}` }).click();
    const finDialog = page.getByRole('dialog', { name: 'Zespół Biurowy Omega' });
    await expect(finDialog).toBeVisible();
    await finDialog.getByRole('button', { name: 'Zamknij finanse projektu' }).click();

    await table.getByRole('button', { name: `Edytuj projekt ${proj1Key}` }).click();
    const editDialog = page.getByRole('dialog', { name: 'Edycja Projektu' });
    await expect(editDialog).toBeVisible();
    await editDialog.getByRole('button', { name: 'Zamknij okno projektu' }).click();

    // Projekt archiwalny w widoku listy (i przywrócenie/przełączenie widoku)
    await page.getByRole('tab', { name: /Projekty archiwalne/i }).click();
    await expect(page.getByRole('table')).toContainText('Archiwalny Pawilon');
    await expect(page.getByRole('button', { name: `Przywróć projekt ${projArchKey}` })).toBeVisible();
    await expect(page.getByRole('button', { name: `Usuń projekt ${projArchKey} z bazy` })).toBeVisible();

    // Wróć do aktywnych
    await page.getByRole('tab', { name: /Aktywne projekty/i }).click();

    // Wyloguj się i zaloguj ponownie -> wybór 'list' zostaje zachowany!
    await page.getByRole('button', { name: 'Wyloguj się z systemu' }).click();
    await expect(page.getByRole('button', { name: 'Zaloguj do pracowni' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('oph_pref_projects_view'))).toBe('list');

    await loginThroughUi(page, baseUrl, ADMIN_EMAIL, ADMIN_PASS);
    await nav.getByRole('button', { name: 'Projekty', exact: true }).click();
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Lista' })).toHaveAttribute('aria-pressed', 'true');

    // Kliknięcie wiersza / Otwórz otwiera projekt w Harmonogramie Gantta
    await page.getByRole('button', { name: `Otwórz projekt ${proj1Key}` }).click();
    await expect(nav.getByRole('button', { name: 'Harmonogram Gantta', exact: true })).toHaveAttribute('aria-current', 'page');
  });

  test('ukrywa kolumnę Zamawiający i akcję Finanse przed nieuprawnionym użytkownikiem w obu widokach', async ({ page }) => {
    await loginThroughUi(page, baseUrl, DEV_EMAIL, DEV_PASS);
    const nav = page.getByRole('navigation', { name: 'Główna nawigacja' });
    await nav.getByRole('button', { name: 'Projekty', exact: true }).click();

    // W widoku Kafelki brak przycisku Kosztorys i wyceny projektu
    await expect(page.getByRole('button', { name: 'Kafelki' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: /Kosztorys i wyceny projektu/i })).toHaveCount(0);

    // Przełącz na Lista
    await page.getByRole('button', { name: 'Lista' }).click();
    const table = page.getByRole('table');
    await expect(table).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Zamawiający' })).toHaveCount(0);
    await expect(table.getByRole('button', { name: /Kosztorys i wyceny projektu/i })).toHaveCount(0);
    await expect(table).not.toContainText('Omega Inwestycje');

    // Weryfikacja responsywności poniżej 640 px (przewijanie poziome tabeli wewnątrz kontenera)
    await page.setViewportSize({ width: 390, height: 844 });
    const tableRegion = page.getByRole('region', { name: 'Tabela projektów' });
    await expect(tableRegion).toHaveAttribute('tabindex', '0');
    const scrollInfo = await tableRegion.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      el.scrollLeft = 120;
      return {
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        scrolledLeft: el.scrollLeft,
        fitsViewport: rect.left >= 0 && rect.right <= window.innerWidth,
        overflowX: getComputedStyle(el).overflowX,
      };
    });
    expect(scrollInfo.overflowX).toBe('auto');
    expect(scrollInfo.fitsViewport).toBe(true);
    expect(scrollInfo.scrollWidth).toBeGreaterThan(scrollInfo.clientWidth);
    expect(scrollInfo.scrolledLeft).toBeGreaterThan(0);
  });
});
