import { test, expect, Page } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';

const ADMIN_EMAIL = 'admin.definicja.e2e@example.pl';
const ADMIN_PASS = 'Katedra-Beton-2026!';
const DEV_EMAIL = 'projektant.definicja.e2e@example.pl';
const DEV_PASS = 'Konstrukcja-Stal-91!';

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
  throw new Error(`Serwer E2E P77 nie odpowiedział na ${baseUrl}/api/health`);
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

test.describe.serial('P77: Rodzaje projektów, nazwa skrócona (podpowiedź na fokus), elementy do odbioru i szablony (E2E)', () => {
  let serverProc: ChildProcess | null = null;
  let tempDataDir = '';
  let baseUrl = '';
  let devUserId = '';
  let project1Key = '';

  const FULL_NAME_1 = 'Budowa kompleksu biurowego przy ulicy Żwirki i Wigury';
  const SHORT_NAME_1 = 'Żwirki Biurowiec';
  const FULL_NAME_2 = 'Ćwiklińskiej Osiedle Mieszkaniowe';

  test.beforeAll(async () => {
    tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-e2e-p77-'));
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
        name: 'Administrator Pracowni',
        email: ADMIN_EMAIL,
        password: ADMIN_PASS,
      }),
    });
    if (!setupRes.ok) {
      throw new Error(`setup-admin failed: ${setupRes.status}`);
    }
    const adminCookie = extractCookie(setupRes);

    const devRes = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Marek Konstruktor',
        email: DEV_EMAIL,
        role: 'developer',
        password: DEV_PASS,
        department: 'Konstrukcja',
      }),
    });
    if (!devRes.ok) {
      throw new Error(`create developer failed: ${devRes.status}`);
    }
    devUserId = (await devRes.json()).user.id;
  });

  test.afterAll(async () => {
    if (serverProc && !serverProc.killed) {
      serverProc.kill('SIGTERM');
    }
    if (tempDataDir && fs.existsSync(tempDataDir)) {
      fs.rmSync(tempDataDir, { recursive: true, force: true });
    }
  });

  test('1. Administrator konfiguruje podrodzaje w Ustawieniach oraz tworzy projekty z rodzajem, nazwą skróconą i odbiorem', async ({
    page,
  }) => {
    await loginThroughUi(page, baseUrl, ADMIN_EMAIL, ADMIN_PASS);

    // Ustawienia -> Zmienne & Terminy: sprawdź domyślne rodzaje i dodaj podrodzaje
    await page.getByRole('button', { name: 'Ustawienia systemu' }).click();
    const settingsDialog = page.getByRole('dialog', { name: /Ustawienia Pracowni/i });
    await expect(settingsDialog).toBeVisible();

    await settingsDialog.getByRole('tab', { name: /Zmienne & Terminy/i }).click();
    await expect(settingsDialog.getByText('Projekt Budowlany', { exact: true })).toBeVisible();
    await expect(settingsDialog.getByText('ZRID', { exact: true })).toBeVisible();
    await expect(settingsDialog.getByText('Organizacja ruchu', { exact: true })).toBeVisible();

    const pbRow = settingsDialog.locator('tr', { hasText: 'Projekt Budowlany' }).first();
    await pbRow.getByRole('button', { name: /podrodz\./i }).click();

    const newSubInput = settingsDialog.getByLabel('Nowy podrodzaj dla Projekt Budowlany');
    await expect(newSubInput).toBeVisible();
    await newSubInput.fill('Architektura');
    await settingsDialog.getByRole('button', { name: 'Dodaj podrodzaj' }).click();
    await expect(settingsDialog.getByText('Architektura', { exact: true })).toBeVisible();

    await newSubInput.fill('Konstrukcja');
    await settingsDialog.getByRole('button', { name: 'Dodaj podrodzaj' }).click();
    await expect(settingsDialog.getByText('Konstrukcja', { exact: true })).toBeVisible();

    // Dodaj własny rodzaj
    await settingsDialog.locator('#settings-new-project-type-label').fill('Audyt BRD');
    await settingsDialog.getByRole('button', { name: '+ Dodaj rodzaj' }).click();
    await expect(settingsDialog.getByText('Audyt BRD', { exact: true })).toBeVisible();

    await settingsDialog.getByRole('button', { name: 'Zamknij', exact: true }).click();
    await expect(settingsDialog).toBeHidden();

    // Przejdź do widoku Projekty i utwórz Projekt 1
    await page.getByRole('button', { name: 'Projekty', exact: true }).click();
    await page.getByRole('button', { name: 'Zarejestruj nowy projekt' }).click();

    const createDialog = page.getByRole('dialog', { name: /Rejestracja Nowego Projektu/i });
    await expect(createDialog).toBeVisible();

    await createDialog.locator('#project-name-input').fill(FULL_NAME_1);
    await createDialog.locator('#project-short-name-input').fill(SHORT_NAME_1);
    await createDialog.locator('#project-type-select').selectOption('projekt_budowlany');
    await createDialog.locator('#project-subtype-select').selectOption('architektura');

    // Dodaj elementy do odbioru i zmień kolejność
    const delSection = createDialog.locator('#project-deliverables-section');
    await delSection.locator('#new-deliverable-name').fill('Projekt zagospodarowania');
    await delSection.locator('#new-deliverable-copies').fill('4');
    await delSection.locator('#new-deliverable-unit').fill('egz.');
    await delSection.getByRole('button', { name: 'Dodaj', exact: true }).click();

    await delSection.locator('#new-deliverable-name').fill('Projekt techniczny');
    await delSection.locator('#new-deliverable-copies').fill('2');
    await delSection.locator('#new-deliverable-unit').fill('szt.');
    await delSection.getByRole('button', { name: 'Dodaj', exact: true }).click();

    await expect(delSection.getByText('Wykonano 0 z 2')).toBeVisible();
    await delSection.getByRole('button', { name: 'Przesuń element "Projekt techniczny" w górę' }).click();

    // Przypisz członka (developer Marek Konstruktor) do projektu, żeby w teście 3 mógł odznaczać odbiory
    await createDialog.getByRole('button', { name: /Marek Konstruktor/i }).click();

    const createResPromise1 = page.waitForResponse(
      (res) => res.url().endsWith('/api/projects') && res.request().method() === 'POST'
    );
    await createDialog.getByRole('button', { name: 'Zarejestruj projekt' }).click();
    const createRes1 = await createResPromise1;
    expect(createRes1.status()).toBe(201);
    const created1 = (await createRes1.json()).project;
    project1Key = created1.key;
    expect(created1.shortName).toBe(SHORT_NAME_1);
    expect(created1.typeId).toBe('projekt_budowlany');
    expect(created1.subtypeId).toBe('architektura');
    expect(created1.deliverables).toHaveLength(2);
    expect(created1.deliverables[0].name).toBe('Projekt techniczny');
    await expect(createDialog).toBeHidden();

    // Utwórz Projekt 2 (bez shortName, rodzaj ZRID) do testu sortowania z polskimi znakami
    await page.getByRole('button', { name: 'Zarejestruj nowy projekt' }).click();
    await expect(createDialog).toBeVisible();
    await createDialog.locator('#project-name-input').fill(FULL_NAME_2);
    await createDialog.locator('#project-type-select').selectOption('zrid');

    const createResPromise2 = page.waitForResponse(
      (res) => res.url().endsWith('/api/projects') && res.request().method() === 'POST'
    );
    await createDialog.getByRole('button', { name: 'Zarejestruj projekt' }).click();
    expect((await createResPromise2).status()).toBe(201);
    await expect(createDialog).toBeHidden();
    expect(devUserId).toBeTruthy();
  });

  test('2. Nazwa skrócona z dostępną podpowiedzią pełnej nazwy po fokusie, filtrowanie i sortowanie z polską kolacją', async ({
    page,
  }) => {
    await loginThroughUi(page, baseUrl, ADMIN_EMAIL, ADMIN_PASS);
    await page.getByRole('button', { name: 'Projekty', exact: true }).click();

    // Kafelek pokazuje nazwę skróconą i odznakę rodzaju/podrodzaju
    const titleBtn = page.getByRole('button', { name: SHORT_NAME_1, exact: true }).first();
    await expect(titleBtn).toBeVisible();
    await expect(page.getByText('Projekt Budowlany · Architektura').first()).toBeVisible();
    await expect(page.getByText('Wykonano 0 z 2').first()).toBeVisible();

    // Podpowiedź pełnej nazwy po fokusie (klawiatura / aria-describedby + role="tooltip")
    await titleBtn.focus();
    const describedById = await titleBtn.getAttribute('aria-describedby');
    expect(describedById).toBeTruthy();
    const tooltip = page.locator(`[id="${describedById!}"]`);
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveAttribute('role', 'tooltip');
    await expect(tooltip).toHaveText(`Pełna nazwa: ${FULL_NAME_1}`);

    // Zamknięcie podpowiedzi przez Escape lub utratę fokusa
    await titleBtn.press('Escape');
    await expect(tooltip).toHaveCount(0);

    // Wyszukiwarka znajduje po pełnej i skróconej nazwie
    const searchInput = page.locator('#projects-search-input');
    await searchInput.fill('Wigury');
    await expect(page.getByRole('button', { name: SHORT_NAME_1, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: FULL_NAME_2, exact: true })).toHaveCount(0);

    await searchInput.fill('Żwirki');
    await expect(page.getByRole('button', { name: SHORT_NAME_1, exact: true })).toBeVisible();
    await searchInput.fill('');

    // Filtrowanie po rodzaju i zależnym podrodzaju
    await page.locator('#projects-type-filter').selectOption('projekt_budowlany');
    await expect(page.locator('#projects-subtype-filter')).toBeVisible();
    await page.locator('#projects-subtype-filter').selectOption('architektura');
    await expect(page.getByRole('button', { name: SHORT_NAME_1, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: FULL_NAME_2, exact: true })).toHaveCount(0);
    await page.locator('#projects-type-filter').selectOption('all');

    // Sortowanie po nazwie (polska kolacja: 'Ćwiklińskiej...' przed 'Żwirki...')
    await page.locator('#projects-sort-select').selectOption('name:asc');
    await page.getByRole('button', { name: 'Lista', exact: true }).click();
    const table = page.getByRole('table');
    await expect(table).toBeVisible();
    const bodyRows = table.locator('tbody tr');
    await expect(bodyRows).toHaveCount(2);
    await expect(bodyRows.nth(0)).toContainText(FULL_NAME_2);
    await expect(bodyRows.nth(1)).toContainText(SHORT_NAME_1);

    // Sprawdź także podpowiedź pełnej nazwy po fokusie w widoku listy (wiersz tabeli)
    const listTitleBtn = bodyRows.nth(1).getByRole('button', { name: SHORT_NAME_1, exact: true });
    await listTitleBtn.focus();
    const listTooltipId = await listTitleBtn.getAttribute('aria-describedby');
    expect(listTooltipId).toBeTruthy();
    await expect(page.locator(`[id="${listTooltipId!}"]`)).toHaveText(
      `Pełna nazwa: ${FULL_NAME_1}`
    );
  });

  test('3. Elementy do odbioru: odznaczanie wykonania (również przez członka bez finansów), szczegóły i trwałość', async ({
    browser,
    page,
  }) => {
    await loginThroughUi(page, baseUrl, ADMIN_EMAIL, ADMIN_PASS);
    await page.getByRole('button', { name: 'Projekty', exact: true }).click();

    await page.getByRole('button', { name: `Podgląd projektu ${project1Key}` }).click();
    const detailDialog = page.getByRole('dialog');
    await expect(detailDialog).toBeVisible();
    await expect(detailDialog.getByText(`Pełna nazwa: ${FULL_NAME_1}`)).toBeVisible();
    await expect(detailDialog.getByText('Rodzaj: Projekt Budowlany · Architektura')).toBeVisible();

    const firstCb = detailDialog.getByRole('checkbox', { name: 'Wykonano: Projekt techniczny' });
    const patchPromise1 = page.waitForResponse(
      (res) => res.url().includes('/api/projects/') && res.request().method() === 'PATCH'
    );
    await firstCb.check();
    expect((await patchPromise1).status()).toBe(200);
    await expect(detailDialog.getByText('Wykonano 1 z 2')).toBeVisible();
    await expect(detailDialog.getByText(/Administrator Pracowni/)).toBeVisible();

    await detailDialog.getByRole('button', { name: 'Zamknij szczegóły projektu' }).click();
    await expect(page.getByText('Wykonano 1 z 2').first()).toBeVisible();

    // Członek projektu z rolą developer (bez prawa do finansów) może odznaczać elementy do odbioru
    const devContext = await browser.newContext();
    const devPage = await devContext.newPage();
    try {
      await loginThroughUi(devPage, baseUrl, DEV_EMAIL, DEV_PASS);
      await devPage.getByRole('button', { name: 'Projekty', exact: true }).click();
      await devPage.getByRole('button', { name: `Podgląd projektu ${project1Key}` }).click();
      const devDetail = devPage.getByRole('dialog');
      await expect(devDetail).toBeVisible();

      const secondCb = devDetail.getByRole('checkbox', {
        name: 'Wykonano: Projekt zagospodarowania',
      });
      const patchPromise2 = devPage.waitForResponse(
        (res) => res.url().includes('/api/projects/') && res.request().method() === 'PATCH'
      );
      await secondCb.check();
      expect((await patchPromise2).status()).toBe(200);
      await expect(devDetail.getByText('Wykonano 2 z 2')).toBeVisible();

      // Odśwież stronę i sprawdź trwałość stanu po stronie serwera
      await devPage.reload();
      await devPage.getByRole('button', { name: 'Projekty', exact: true }).click();
      await expect(devPage.getByText('Wykonano 2 z 2').first()).toBeVisible();
    } finally {
      await devContext.close();
    }
  });

  test('4. Szablony przejmują rodzaj oraz elementy do odbioru i blokują usunięcie używanych wartości', async ({
    page,
  }) => {
    await loginThroughUi(page, baseUrl, ADMIN_EMAIL, ADMIN_PASS);

    // Utwórz szablon z projektu 1 (powinien przejąć typeId='projekt_budowlany' i 2 elementy)
    await page.getByRole('button', { name: 'Ustawienia systemu' }).click();
    const settingsDialog = page.getByRole('dialog', { name: /Ustawienia Pracowni/i });
    await settingsDialog.getByRole('tab', { name: /Szablony projektów/i }).click();
    await settingsDialog.getByRole('button', { name: 'Utwórz z projektu' }).click();

    const fromProjDialog = page.getByRole('dialog', {
      name: /Utwórz szablon z istniejącego projektu/i,
    });
    await expect(fromProjDialog).toBeVisible();
    const srcSelect = fromProjDialog.getByLabel(/Projekt źródłowy/i);
    const srcValue = await srcSelect
      .locator('option', { hasText: project1Key })
      .getAttribute('value');
    expect(srcValue).toBeTruthy();
    await srcSelect.selectOption(srcValue!);
    await fromProjDialog.getByLabel(/Nazwa szablonu/i).fill('Szablon P77 z Projektu');
    await fromProjDialog.getByRole('button', { name: 'Utwórz szablon' }).click();
    await expect(fromProjDialog).toBeHidden();

    // Otwórz edytor szablonu i dodaj domyślny element do odbioru
    await settingsDialog.getByRole('button', { name: 'Edytuj', exact: true }).first().click();
    const editorDialog = page.getByRole('dialog', {
      name: /Edytor szablonu: Szablon P77 z Projektu/i,
    });
    await expect(editorDialog).toBeVisible();
    await expect(editorDialog.getByLabel('Rodzaj projektu')).toHaveValue('projekt_budowlany');

    await editorDialog.getByLabel('Nowy element do odbioru').fill('Operat wodnoprawny');
    await editorDialog.getByLabel('Egzemplarze', { exact: true }).fill('3');
    await editorDialog.getByRole('button', { name: 'Dodaj element' }).click();
    await expect(editorDialog.getByText('Domyślne elementy do odbioru (3/100)')).toBeVisible();

    const saveTplPromise = page.waitForResponse(
      (res) => res.url().includes('/api/templates/') && res.request().method() === 'PUT'
    );
    await editorDialog.getByRole('button', { name: 'Zapisz zmiany' }).click();
    expect((await saveTplPromise).status()).toBe(200);
    await expect(editorDialog).toHaveCount(0);

    // Wróć do Zmienne & Terminy i zweryfikuj blokadę usunięcia używanego rodzaju i podrodzaju
    await settingsDialog.getByRole('tab', { name: /Zmienne & Terminy/i }).click();
    await expect(
      settingsDialog.getByRole('button', { name: 'Usuń rodzaj Projekt Budowlany' })
    ).toBeDisabled();

    const pbRow = settingsDialog.locator('tr', { hasText: 'Projekt Budowlany' }).first();
    await pbRow.getByRole('button', { name: /podrodz\./i }).click();
    await expect(
      settingsDialog.getByRole('button', { name: 'Usuń podrodzaj Architektura' })
    ).toBeDisabled();

    await settingsDialog.getByRole('button', { name: 'Zamknij', exact: true }).click();

    // Utwórz nowy projekt z tego szablonu i sprawdź odziedziczony rodzaj oraz niewykonane odbiory (0 z 3)
    await page.getByRole('button', { name: 'Projekty', exact: true }).click();
    await page.getByRole('button', { name: 'Zarejestruj nowy projekt' }).click();
    const newProjDialog = page.getByRole('dialog', { name: /Rejestracja Nowego Projektu/i });
    const tplSelect = newProjDialog.getByLabel(/Użyj gotowego szablonu procesu/i);
    const tplValue = await tplSelect
      .locator('option', { hasText: 'Szablon P77 z Projektu' })
      .getAttribute('value');
    expect(tplValue).toBeTruthy();
    await tplSelect.selectOption(tplValue!);

    await expect(newProjDialog.locator('#project-type-select')).toHaveValue('projekt_budowlany');
    await expect(newProjDialog.locator('#project-deliverables-section')).toContainText(
      'Wykonano 0 z 3'
    );

    const createFromTplPromise = page.waitForResponse(
      (res) => res.url().endsWith('/api/projects') && res.request().method() === 'POST'
    );
    await newProjDialog.getByRole('button', { name: 'Zarejestruj projekt' }).click();
    const res3 = await createFromTplPromise;
    expect(res3.status()).toBe(201);
    const created3 = (await res3.json()).project;
    expect(created3.typeId).toBe('projekt_budowlany');
    expect(created3.deliverables).toHaveLength(3);
    expect(created3.deliverables.every((d: { isDone: boolean }) => d.isDone === false)).toBe(true);
  });
});
