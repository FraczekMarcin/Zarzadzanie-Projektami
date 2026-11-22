import { test, expect, Page } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';

const ADMIN_EMAIL = 'admin.ekonomia.e2e@example.pl';
const ADMIN_PASS = 'Architektura-Mural-91!';
const DEV_EMAIL = 'dev.ekonomia.e2e@example.pl';
const DEV_PASS = 'Projekt-Beton-2026!';

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
      // Serwer jeszcze się uruchamia
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Serwer E2E Ekonomii nie odpowiedział na ${baseUrl}/api/health`);
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

test.describe.serial('Widok Ekonomia z podziałem na firmy i harmonogramem płatności (E2E)', () => {
  let serverProc: ChildProcess | null = null;
  let tempDataDir = '';
  let baseUrl = '';

  test.beforeAll(async () => {
    tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-e2e-economy-'));
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
        name: 'Admin Ekonomia E2E',
        email: ADMIN_EMAIL,
        password: ADMIN_PASS,
      }),
    });
    if (!setupRes.ok) {
      throw new Error(`setup-admin failed: ${setupRes.status}`);
    }
    const adminCookie = extractCookie(setupRes);
    const adminJson = await setupRes.json();
    const adminId = adminJson.user.id as string;

    // 2. Utwórz dewelopera bez własnego projektu (nie powinien widzieć menu Ekonomia)
    const devRes = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Projektant Bez Projektów',
        email: DEV_EMAIL,
        role: 'developer',
        department: 'Konstrukcja',
        password: DEV_PASS,
      }),
    });
    if (!devRes.ok) {
      throw new Error(`create dev failed: ${devRes.status}`);
    }

    // 3. Najpierw utwórz projekt bez firmy (zanim istnieją aktywne firmy)
    const noCompRes = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Projekt Prywatny Bez Firmy',
        clientName: 'Jan Kowalski',
        ownerId: adminId,
        status: 'planning',
        startDate: '2026-03-01',
        dueDate: '2026-11-01',
        projectValue: 1000,
        projectVatRate: 23,
      }),
    });
    if (!noCompRes.ok) {
      throw new Error(`create no-company project failed: ${noCompRes.status} ${await noCompRes.text()}`);
    }

    // 4. Utwórz dwie firmy A i B
    const compARes = await fetch(`${baseUrl}/api/companies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ name: 'Alfa Architekci', letter: 'A', isActive: true }),
    });
    if (!compARes.ok) throw new Error(`create compA failed: ${compARes.status}`);
    const compA = (await compARes.json()).company;

    const compBRes = await fetch(`${baseUrl}/api/companies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ name: 'Beta Konstrukcje', letter: 'B', isActive: true }),
    });
    if (!compBRes.ok) throw new Error(`create compB failed: ${compBRes.status}`);
    const compB = (await compBRes.json()).company;

    // 5. Utwórz projekty przypisane do Firmy A i Firmy B
    const projARes = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        companyId: compA.id,
        name: 'Kamienica Słoneczna',
        clientName: 'Inwestor Alfa Sp. z o.o.',
        ownerId: adminId,
        status: 'active',
        startDate: '2026-01-15',
        dueDate: '2026-12-31',
        projectValue: 20000,
        projectVatRate: 23,
        costs: [
          {
            id: 'c-alfa-1',
            title: 'Badania geotechniczne',
            amountNet: 3000,
            amountGross: 3690,
            category: 'geologia',
            date: '2026-01-20',
            status: 'planned',
            isPaid: false,
            dueDate: '2026-11-15',
            contractorName: 'GeoTest Sp. z o.o.',
          },
        ],
        paymentTranches: [
          {
            id: 'tr-alfa-1',
            title: 'I transza projektowa',
            amountNet: 8000,
            amountGross: 9840,
            dueDate: '2026-10-20',
            isPaid: false,
          },
        ],
        quotations: [
          {
            id: 'q-alfa-1',
            title: 'Oferta GeoTest',
            type: 'koszt',
            status: 'accepted',
            unitPriceNet: 3000,
            quantity: 1,
            vatRate: 23,
            totalNet: 3000,
            totalGross: 3690,
            isSelected: true,
            isChosenOffer: true,
            linkedCostId: 'c-alfa-1',
            companyName: 'GeoTest Sp. z o.o.',
          },
        ],
      }),
    });
    if (!projARes.ok) {
      throw new Error(`create projA failed: ${projARes.status} ${await projARes.text()}`);
    }

    const projBRes = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        companyId: compB.id,
        name: 'Hala Stalowa Beta',
        clientName: 'Logistic Beta',
        ownerId: adminId,
        status: 'active',
        startDate: '2026-02-01',
        dueDate: '2026-12-20',
        projectValue: 5000,
        projectVatRate: 23,
        costs: [
          {
            id: 'c-beta-1',
            title: 'Stal i uzgodnienia',
            amountNet: 7000,
            amountGross: 8610,
            category: 'podwykonawca',
            date: '2026-02-10',
            status: 'incurred',
            isPaid: false,
            dueDate: '2026-11-30',
          },
        ],
      }),
    });
    if (!projBRes.ok) {
      throw new Error(`create projB failed: ${projBRes.status} ${await projBRes.text()}`);
    }
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

  test('przełączanie firm, tryb netto/brutto, szczegóły projektu, dodawanie płatności do harmonogramu i zamknięcie po zapłacie', async ({ page }) => {
    test.setTimeout(90_000);
    await loginThroughUi(page, baseUrl, ADMIN_EMAIL, ADMIN_PASS);

    const nav = page.getByRole('navigation', { name: 'Główna nawigacja' });
    const econBtn = nav.getByRole('button', { name: 'Ekonomia', exact: true });
    await expect(econBtn).toBeVisible();
    await econBtn.click();

    await expect(page.getByRole('heading', { name: 'Ekonomia i finanse firm' })).toBeVisible();

    // Lista zawiera wszystkie 3 projekty w zakładce "Wszystkie"
    await expect(page.getByRole('button', { name: 'Kamienica Słoneczna' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Hala Stalowa Beta' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Projekt Prywatny Bez Firmy' })).toBeVisible();

    // Wiersz sum zawiera łączną wartość netto (20 000 + 5 000 + 1 000 = 26 000,00 zł)
    const tfoot = page.locator('tfoot');
    await expect(tfoot).toContainText('26 000,00 zł');

    // Przełącznik Brutto aktualizuje kwoty i zapisuje preferencję w localStorage
    await page.getByRole('button', { name: 'Brutto', exact: true }).click();
    await expect(tfoot).toContainText('31 980,00 zł');
    const savedPref = await page.evaluate(() => localStorage.getItem('oph_pref_economy_amounts'));
    expect(savedPref).toBe('gross');
    await page.getByRole('button', { name: 'Netto', exact: true }).click();

    // Zakładki firm filtrują listę
    await page.getByRole('tab', { name: 'A - Alfa Architekci' }).click();
    await expect(page.getByRole('button', { name: 'Kamienica Słoneczna' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Hala Stalowa Beta' })).toBeHidden();

    await page.getByRole('tab', { name: 'B - Beta Konstrukcje' }).click();
    await expect(page.getByRole('button', { name: 'Hala Stalowa Beta' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Kamienica Słoneczna' })).toBeHidden();

    await page.getByRole('tab', { name: 'Bez firmy' }).click();
    await expect(page.getByRole('button', { name: 'Projekt Prywatny Bez Firmy' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Kamienica Słoneczna' })).toBeHidden();

    await page.getByRole('tab', { name: 'Wszystkie' }).click();

    // Kliknięcie w projekt otwiera szczegóły z fokusem na nagłówku
    await page.getByRole('button', { name: 'Kamienica Słoneczna' }).click();
    await expect(page.getByRole('heading', { name: /Kamienica Słoneczna/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Przychody' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Koszty' })).toBeVisible();
    await expect(page.getByText('Wybrana oferta')).toBeVisible();

    // Dodaj koszt "Badania geotechniczne" do harmonogramu
    const costListItem = page.locator('li', { hasText: 'Badania geotechniczne' });
    await costListItem.getByRole('button', { name: 'Dodaj do harmonogramu' }).click();
    await expect(costListItem.getByRole('link', { name: 'W harmonogramie' })).toBeVisible();

    // Deep link ?view=economy po przeładowaniu otwiera Ekonomię bez duplikatu zadania
    await page.goto(`${baseUrl}/?view=economy`);
    await expect(page.getByRole('heading', { name: 'Ekonomia i finanse firm' })).toBeVisible();
    await page.getByRole('button', { name: 'Kamienica Słoneczna' }).click();

    const reloadedCostItem = page.locator('li', { hasText: 'Badania geotechniczne' });
    await expect(reloadedCostItem.getByRole('link', { name: 'W harmonogramie' })).toBeVisible();

    // Oznaczenie pozycji jako zapłaconej proponuje zamknięcie powiązanego zadania
    await reloadedCostItem.getByRole('button', { name: 'Oznacz jako zapłacone' }).click();
    const closePrompt = page.getByRole('dialog', {
      name: /Zamknąć powiązane zadanie w harmonogramie/i,
    });
    await expect(closePrompt).toBeVisible();
    await closePrompt.getByRole('button', { name: 'Tak, zamknij zadanie' }).click();
    await expect(closePrompt).toBeHidden();

    // Kliknięcie "W harmonogramie" otwiera zadanie ze statusem Ukończone (done) i postępem 100%
    await reloadedCostItem.getByRole('link', { name: 'W harmonogramie' }).click();
    const drawer = page.getByRole('dialog', {
      name: /Płatność: Badania geotechniczne/i,
    });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByLabel('Status zadania')).toHaveValue('done');
    await expect(drawer).toContainText('100%');
  });

  test('ukrywa pozycję menu Ekonomia przed użytkownikiem bez uprawnień (developer bez projektów)', async ({ page }) => {
    await loginThroughUi(page, baseUrl, DEV_EMAIL, DEV_PASS);
    const nav = page.getByRole('navigation', { name: 'Główna nawigacja' });
    await expect(nav.getByRole('button', { name: 'Ekonomia', exact: true })).toHaveCount(0);
  });

  test('firma zwolniona z VAT w Ustawieniach, widoku Ekonomia i oknie finansów projektu (przychód ZW, koszt brutto)', async ({ page }) => {
    test.setTimeout(90_000);
    await loginThroughUi(page, baseUrl, ADMIN_EMAIL, ADMIN_PASS);

    // Dodaj firmę zwolnioną z VAT i projekt dla niej przez API sesji
    const setupData = await page.evaluate(async () => {
      const compRes = await fetch('/api/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Gamma Zwolniona',
          letter: 'G',
          isActive: true,
          vatPayer: false,
          vatExemptionBasis: 'art. 113 ust. 1 ustawy o VAT',
        }),
      });
      if (!compRes.ok) throw new Error(`comp create failed: ${compRes.status}`);
      const company = (await compRes.json()).company;

      const projRes = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: company.id,
          name: 'Pawilon Zwolniony Gamma',
          clientName: 'Klient Gamma',
          status: 'active',
          startDate: '2026-03-01',
          dueDate: '2026-12-01',
          projectValue: 10000,
          projectValueGross: 10000,
          projectVatRate: 0,
          costs: [
            {
              id: 'c-gamma-1',
              title: 'Faktura z VAT 23%',
              amountNet: 2000,
              amountGross: 2460,
              vatRate: 23,
              category: 'inne',
              date: '2026-04-01',
              status: 'planned',
              isPaid: false,
            },
          ],
        }),
      });
      if (!projRes.ok) throw new Error(`proj create failed: ${projRes.status}`);
      return { companyId: company.id };
    });
    expect(setupData.companyId).toBeTruthy();

    await page.reload();
    const nav = page.getByRole('navigation', { name: 'Główna nawigacja' });
    await nav.getByRole('button', { name: 'Ekonomia', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Ekonomia i finanse firm' })).toBeVisible();

    // Zakładka firmy zwolnionej pokazuje plakietkę 'Zwolniona z VAT' i wyliczenia przychód 10 000 zł, koszt brutto 2 460 zł, bilans +7 540,00 zł
    const gammaTab = page.getByRole('tab', { name: /G - Gamma Zwolniona/ });
    await expect(gammaTab).toBeVisible();
    await expect(gammaTab).toContainText('Zwolniona z VAT');
    await gammaTab.click();

    await expect(page.locator('tfoot')).toContainText('10 000,00 zł');
    await expect(page.locator('tfoot')).toContainText('2 460,00 zł');
    await expect(page.locator('tfoot')).toContainText('+7 540,00 zł');

    // Przełączenie na Brutto zachowuje koszt ekonomiczny brutto 2 460,00 zł i przychód ZW 10 000,00 zł
    await page.getByRole('button', { name: 'Brutto', exact: true }).click();
    await expect(page.locator('tfoot')).toContainText('10 000,00 zł');
    await expect(page.locator('tfoot')).toContainText('2 460,00 zł');
    await expect(page.locator('tfoot')).toContainText('+7 540,00 zł');
    await expect(page.getByText(/Podstawa wyliczeń:/)).toBeVisible();
  });
});
