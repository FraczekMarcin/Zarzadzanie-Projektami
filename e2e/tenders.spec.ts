import { test, expect, Page } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';

const ADMIN_EMAIL = 'admin.przetargi.e2e@example.pl';
const ADMIN_PASS = 'Katedra-Beton-2026!';
const DEV_EMAIL = 'dev.przetargi.e2e@example.pl';
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
      // Serwer uruchamia się
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Serwer E2E Przetargów nie odpowiedział na ${baseUrl}/api/health`);
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

test.describe.serial('Moduł Przetargi — interfejs E2E', () => {
  let serverProc: ChildProcess | null = null;
  let tempDataDir = '';
  let baseUrl = '';

  test.beforeAll(async () => {
    tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-e2e-tenders-'));
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
        name: 'Admin Przetargi E2E',
        email: ADMIN_EMAIL,
        password: ADMIN_PASS,
      }),
    });
    if (!setupRes.ok) throw new Error(`setup-admin failed: ${setupRes.status}`);
    const adminCookie = extractCookie(setupRes);

    const devRes = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Deweloper Testowy',
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
      body: JSON.stringify({ name: 'Alfa Pracownia Sp. z o.o.', letter: 'A', isActive: true, vatPayer: true }),
    });
    if (!compARes.ok) throw new Error(`create company A failed: ${compARes.status}`);
  });

  test.afterAll(async () => {
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

  test('1) dodanie przetargu z 3 oferentami i naszą wygraną, drugiego przetargu, wyszukiwanie po zamawiającym i sortowanie po cenie/jednostkę', async ({ page }) => {
    await loginThroughUi(page, baseUrl, ADMIN_EMAIL, ADMIN_PASS);

    const nav = page.getByRole('navigation', { name: 'Główna nawigacja' });
    const tendersNavBtn = nav.getByRole('button', { name: 'Przetargi', exact: true });
    await expect(tendersNavBtn).toBeVisible();
    await tendersNavBtn.click();

    await expect(page.getByRole('heading', { name: 'Przetargi', exact: true })).toBeVisible();

    // Dodaj 1. przetarg z 3 oferentami i naszą wygraną
    await page.getByRole('button', { name: 'Dodaj przetarg' }).click();
    const formDialog = page.getByRole('dialog', { name: 'Nowy przetarg' });
    await expect(formDialog).toBeVisible();

    await formDialog.getByLabel(/Nazwa przetargu/i).fill('Budowa obwodnicy północnej');
    await formDialog.getByLabel(/Zamawiający/i).fill('Zarząd Dróg Wojewódzkich');
    await formDialog.getByLabel(/Numer referencyjny/i).fill('ZDW.271.10.2026');
    await formDialog.getByLabel(/Status postępowania/i).selectOption('resolved');
    await formDialog.getByLabel(/Data rozstrzygnięcia/i).fill('2026-05-15');
    await formDialog.getByLabel(/Cena zamawiającego/i).fill('200000');
    await formDialog.getByLabel(/Zakres \(ilość\)/i).fill('10');
    await formDialog.getByLabel(/Jednostka zakresu/i).fill('km');

    const addBidderBtn = formDialog.getByRole('button', { name: 'Dodaj oferenta' });
    await addBidderBtn.click();
    await addBidderBtn.click();
    await addBidderBtn.click();

    const bidderNameInputs = formDialog.getByPlaceholder('Nazwa wykonawcy');
    const bidderPriceInputs = formDialog.getByPlaceholder('np. 215 000,00');
    const ourCheckboxes = formDialog.getByLabel('To nasza oferta');
    const winnerRadios = formDialog.getByLabel('Zwycięzca');

    await bidderNameInputs.nth(0).fill('Alfa Pracownia Sp. z o.o.');
    await bidderPriceInputs.nth(0).fill('150000');
    await ourCheckboxes.nth(0).check();
    await formDialog.getByLabel('Nasza firma:').selectOption({ label: '[A] Alfa Pracownia Sp. z o.o.' });
    await winnerRadios.nth(0).check();

    await bidderNameInputs.nth(1).fill('Konkurent Drogi S.A.');
    await bidderPriceInputs.nth(1).fill('180000');

    await bidderNameInputs.nth(2).fill('Inny Wykonawca Sp. z o.o.');
    await bidderPriceInputs.nth(2).fill('210000');

    const createRes1 = page.waitForResponse(
      (res) => res.url().includes('/api/tenders') && res.request().method() === 'POST'
    );
    await formDialog.getByRole('button', { name: 'Zapisz' }).click();
    expect((await createRes1).status()).toBe(201);
    await expect(formDialog).toHaveCount(0);

    await expect(page.getByRole('button', { name: 'Budowa obwodnicy północnej' })).toBeVisible();
    await expect(page.getByText('15 000,00 zł/km').first()).toBeVisible();

    // Dodaj 2. przetarg (droższy za km, inny zamawiający)
    await page.getByRole('button', { name: 'Dodaj przetarg' }).click();
    const formDialog2 = page.getByRole('dialog', { name: 'Nowy przetarg' });
    await formDialog2.getByLabel(/Nazwa przetargu/i).fill('Projekt mostu na rzece');
    await formDialog2.getByLabel(/Zamawiający/i).fill('Gmina Miejska Kraków');
    await formDialog2.getByLabel(/Status postępowania/i).selectOption('resolved');
    await formDialog2.getByLabel(/Data rozstrzygnięcia/i).fill('2026-06-01');
    await formDialog2.getByLabel(/Cena zamawiającego/i).fill('300000');
    await formDialog2.getByLabel(/Zakres \(ilość\)/i).fill('5');
    await formDialog2.getByLabel(/Jednostka zakresu/i).fill('km');
    await formDialog2.getByRole('button', { name: 'Dodaj oferenta' }).click();
    await formDialog2.getByPlaceholder('Nazwa wykonawcy').nth(0).fill('Mosty Polskie');
    await formDialog2.getByPlaceholder('np. 215 000,00').nth(0).fill('250000');
    await formDialog2.getByLabel('Zwycięzca').nth(0).check();

    const createRes2 = page.waitForResponse(
      (res) => res.url().includes('/api/tenders') && res.request().method() === 'POST'
    );
    await formDialog2.getByRole('button', { name: 'Zapisz' }).click();
    expect((await createRes2).status()).toBe(201);

    await expect(page.getByRole('button', { name: 'Projekt mostu na rzece' })).toBeVisible();

    // Wyszukiwanie po zamawiającym
    const filtersSection = page.getByRole('region', { name: 'Filtry przetargów' });
    await filtersSection.getByLabel('Zamawiający').fill('Kraków');
    await expect(page.getByRole('button', { name: 'Projekt mostu na rzece' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Budowa obwodnicy północnej' })).toHaveCount(0);

    await filtersSection.getByRole('button', { name: 'Wyczyść filtry' }).click();
    await expect(page.getByRole('button', { name: 'Budowa obwodnicy północnej' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Projekt mostu na rzece' })).toBeVisible();

    // Sortowanie po cenie za jednostkę (15 000 zł/km vs 50 000 zł/km)
    const unitSortBtn = page.getByRole('button', { name: /Cena\/jedn\. \(zw\.\)/i });
    await unitSortBtn.click(); // asc
    const rows = page.locator('tbody tr');
    await expect(rows.nth(0)).toContainText('Budowa obwodnicy północnej');
    await expect(rows.nth(1)).toContainText('Projekt mostu na rzece');

    await unitSortBtn.click(); // desc
    await expect(rows.nth(0)).toContainText('Projekt mostu na rzece');
    await expect(rows.nth(1)).toContainText('Budowa obwodnicy północnej');
  });

  test('2) edycja oferenta w szczegółach przetargu i kopiowanie wygranego przetargu do projektu (RRRR-X_L)', async ({ page }) => {
    await loginThroughUi(page, baseUrl, ADMIN_EMAIL, ADMIN_PASS);

    // Otwórz przez deep link ?view=tenders
    await page.goto(`${baseUrl}/?view=tenders`);
    await expect(page.getByRole('heading', { name: 'Przetargi', exact: true })).toBeVisible();

    // Otwórz szczegóły wygranego przetargu
    await page.getByRole('button', { name: 'Budowa obwodnicy północnej' }).click();
    const detailDialog = page.getByRole('dialog', { name: 'Budowa obwodnicy północnej' });
    await expect(detailDialog).toBeVisible();
    await expect(detailDialog.getByText('Zwycięzca', { exact: true })).toBeVisible();

    // Edycja oferenta
    await detailDialog.getByRole('button', { name: 'Edytuj' }).click();
    const editDialog = page.getByRole('dialog', { name: 'Edycja przetargu' });
    await expect(editDialog).toBeVisible();
    // Pierwszy oferent w formularzu to nasza oferta
    await editDialog.getByPlaceholder('np. 215 000,00').nth(0).fill('140000');

    const patchRes = page.waitForResponse(
      (res) => res.url().includes('/api/tenders/') && res.request().method() === 'PATCH'
    );
    await editDialog.getByRole('button', { name: 'Zapisz' }).click();
    expect((await patchRes).status()).toBe(200);
    await expect(editDialog).toHaveCount(0);

    await expect(detailDialog.getByText('140 000,00 zł').first()).toBeVisible();

    // Kopiuj jako projekt z kodem firmy A (RRRR-X_A)
    await detailDialog.getByRole('button', { name: 'Kopiuj jako projekt' }).click();
    const copyDialog = page.getByRole('dialog', { name: 'Kopiuj przetarg jako projekt' });
    await expect(copyDialog).toBeVisible();

    const copyResPromise = page.waitForResponse(
      (res) => res.url().includes('/create-project') && res.request().method() === 'POST'
    );
    await copyDialog.getByRole('button', { name: 'Utwórz projekt' }).click();
    const copyRes = await copyResPromise;
    expect(copyRes.status()).toBe(201);
    const copyJson = await copyRes.json();
    const expectedKey = copyJson.project.key as string;
    expect(expectedKey).toMatch(/^\d{4}-\d+_A$/);

    await expect(copyDialog).toHaveCount(0);
    await expect(detailDialog.getByRole('button', { name: `Projekt: ${expectedKey}` })).toBeVisible();

    // Zamknięcie szuflady szczegółów kliknięciem poza panelem (Grupa A)
    await page.mouse.click(5, 300);
    await expect(detailDialog).toHaveCount(0);

    // Weryfikacja linku do projektu na liście przetargów i przejście do projektu
    await expect(page.getByRole('button', { name: `Projekt: ${expectedKey}` }).first()).toBeVisible();
    await page.getByRole('button', { name: `Otwórz projekt ${expectedKey}` }).click();
    await expect(page.getByRole('dialog', { name: /Budowa obwodnicy północnej/i })).toBeVisible();
  });

  test('3) użytkownik o roli developer nie widzi pozycji menu Przetargi', async ({ page }) => {
    await loginThroughUi(page, baseUrl, DEV_EMAIL, DEV_PASS);
    const nav = page.getByRole('navigation', { name: 'Główna nawigacja' });
    await expect(nav.getByRole('button', { name: 'Harmonogram Gantta', exact: true })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Przetargi', exact: true })).toHaveCount(0);

    // Próba otwarcia deep-linka ?view=tenders nie powinna otworzyć widoku Przetargi
    await page.goto(`${baseUrl}/?view=tenders`);
    await expect(page.getByRole('button', { name: 'Wyloguj się z systemu' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Przetargi', exact: true })).toHaveCount(0);
  });
});
