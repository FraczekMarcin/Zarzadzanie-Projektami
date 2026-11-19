import { test, expect, Page } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';

const ADMIN_EMAIL = 'admin.finance.e2e@example.pl';
const ADMIN_PASS = 'Katedra-Biurowiec-2026!';
const PM_OWNER_EMAIL = 'pm.owner.e2e@example.pl';
const PM_OTHER_EMAIL = 'pm.other.e2e@example.pl';
const PM_PASS = 'Budynek-Stalowy-2026!';

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
      // Serwer startuje
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Serwer E2E finansów nie odpowiedział na ${baseUrl}/api/health`);
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

test.describe.serial('Finanse projektu — kwoty 0,01 zł, wyceny w kosztach i uprawnienia (E2E)', () => {
  let serverProc: ChildProcess | null = null;
  let tempDataDir = '';
  let baseUrl = '';
  let projectId = '';

  test.beforeAll(async () => {
    tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-e2e-finance-'));
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
        name: 'Admin Finanse E2E',
        email: ADMIN_EMAIL,
        password: ADMIN_PASS,
      }),
    });
    if (!setupRes.ok) {
      throw new Error(`setup-admin failed: ${setupRes.status} ${await setupRes.text()}`);
    }
    const adminCookie = extractCookie(setupRes);

    // 2. Utwórz dwóch kierowników projektów (właściciel oraz obcy kierownik)
    const pmOwnerRes = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Kierownik Właściciel E2E',
        email: PM_OWNER_EMAIL,
        role: 'project_manager',
        department: 'Architektura',
        password: PM_PASS,
      }),
    });
    const pmOwnerJson = await pmOwnerRes.json();

    const pmOtherRes = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Kierownik Obcy E2E',
        email: PM_OTHER_EMAIL,
        role: 'project_manager',
        department: 'Konstrukcja',
        password: PM_PASS,
      }),
    });
    if (!pmOtherRes.ok) {
      throw new Error(`create pm other failed: ${pmOtherRes.status}`);
    }

    // 3. Utwórz projekt z przypisanym ownerId = pmOwner (bez początkowej kwoty projektu)
    const projRes = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        key: 'FIN-E2E',
        name: 'Hala Finansowa E2E',
        ownerId: pmOwnerJson.user.id,
        memberIds: [pmOwnerJson.user.id],
      }),
    });
    if (!projRes.ok) {
      throw new Error(`create project failed: ${projRes.status}`);
    }
    const projJson = await projRes.json();
    projectId = projJson.project.id;
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

  test('dodanie kosztu 1234,56 i edycja na 1000,10 oraz odrzucenie 12,345', async ({ page }) => {
    await loginThroughUi(page, baseUrl, ADMIN_EMAIL, ADMIN_PASS);

    await page.getByRole('button', { name: 'Projekty', exact: true }).click();
    await page.getByRole('button', { name: 'Kosztorys i wyceny projektu FIN-E2E' }).click();

    const modal = page.getByRole('dialog', { name: 'Hala Finansowa E2E' });
    await expect(modal.getByRole('heading', { name: 'Hala Finansowa E2E' })).toBeVisible();

    // Kwota bazowa projektu startuje pusta, jeśli projekt jej nie ma
    const baseNetInput = modal.locator('#fin-base-contract');
    await expect(baseNetInput).toHaveValue('');
    await expect(baseNetInput).toHaveAttribute('placeholder', '0,00');

    // Przejdź do kosztów
    await modal.getByRole('tab', { name: /Lista kosztów i zadania/i }).click();

    const costNetInput = modal.locator('#fin-cost-net');
    const addCostBtn = modal.getByRole('button', { name: '+ Zapisz koszt' });
    await expect(costNetInput).toHaveValue('');
    await expect(addCostBtn).toBeDisabled();

    // Wpisz 12,345 -> żywy błąd i zablokowany przycisk
    await modal.locator('#fin-cost-title').fill('Mapa do celów projektowych');
    await costNetInput.fill('12,345');
    await expect(modal.getByText('Podaj kwotę z maksymalnie dwoma miejscami po przecinku')).toBeVisible();
    await expect(costNetInput).toHaveAttribute('aria-invalid', 'true');
    await expect(addCostBtn).toBeDisabled();

    // Wpisz poprawną kwotę 1234,56 -> blur formatuje na 1 234,56 -> dodaj koszt
    await costNetInput.fill('1234,56');
    await costNetInput.blur();
    await expect(costNetInput).toHaveValue('1 234,56');
    await expect(addCostBtn).toBeEnabled();
    await addCostBtn.click();

    await expect(modal.getByTestId('finance-total-costs')).toContainText('1 234,56 PLN');

    // Edytuj koszt na 1000,10
    await modal.getByRole('button', { name: 'Edytuj koszt Mapa do celów projektowych' }).click();
    const editNetInput = modal.locator('input[id^="edit-c-net-"]');
    await expect(editNetInput).toBeVisible();
    await editNetInput.fill('1000,10');
    await editNetInput.blur();
    await expect(editNetInput).toHaveValue('1 000,10');
    await modal.getByRole('button', { name: 'Zapisz wiersz' }).click();

    await expect(modal.getByTestId('finance-total-costs')).toContainText('1 000,10 PLN');

    // Zapisz zmiany i sprawdź trwałość po przeładowaniu
    await modal.getByRole('button', { name: 'Zapisz zmiany w projekcie i kosztorysie' }).click();
    await expect(modal).toBeHidden();

    await page.reload();
    await expect(page.getByRole('button', { name: 'Wyloguj się z systemu' })).toBeVisible();
    await page.getByRole('button', { name: 'Projekty', exact: true }).click();
    await page.getByRole('button', { name: 'Kosztorys i wyceny projektu FIN-E2E' }).click();

    const reloadedModal = page.getByRole('dialog', { name: 'Hala Finansowa E2E' });
    await expect(reloadedModal.getByTestId('finance-total-costs')).toContainText('1 000,10 PLN');
  });

  test('przeniesienie wyceny kosztowej do kosztów bez podwójnego liczenia i cofnięcie', async ({ page }) => {
    await loginThroughUi(page, baseUrl, ADMIN_EMAIL, ADMIN_PASS);

    await page.getByRole('button', { name: 'Projekty', exact: true }).click();
    await page.getByRole('button', { name: 'Kosztorys i wyceny projektu FIN-E2E' }).click();

    const modal = page.getByRole('dialog', { name: 'Hala Finansowa E2E' });
    await expect(modal.getByTestId('finance-total-costs')).toContainText('1 000,10 PLN');

    // Pole ceny wyceny startuje puste, przycisk dodania nieaktywny
    const quotePriceInput = modal.locator('#fin-quote-price');
    const addQuoteBtn = modal.getByRole('button', { name: 'Dodaj wycenę do listy' });
    await expect(quotePriceInput).toHaveValue('');
    await expect(addQuoteBtn).toBeDisabled();

    // Dodaj wycenę typu 'koszt'
    await modal.locator('#fin-quote-direction').selectOption('koszt');
    await modal.locator('#fin-quote-title').fill('Instalacje sanitarne oferta');
    await modal.locator('#fin-quote-company').fill('Sanit-Bud Sp. z o.o.');
    await quotePriceInput.fill('2500,50');
    await quotePriceInput.blur();
    await expect(quotePriceInput).toHaveValue('2 500,50');
    await addQuoteBtn.click();

    // Bilans kosztów: 1 000,10 + 2 500,50 = 3 500,60 PLN
    await expect(modal.getByTestId('finance-total-costs')).toContainText('3 500,60 PLN');

    // Przenieś wycenę do kosztów
    await modal.getByRole('button', { name: 'Przenieś do kosztów' }).click();
    const moveDialog = page.getByRole('dialog', { name: 'Przenieś wycenę do kosztów' });
    await expect(moveDialog).toBeVisible();
    await expect(moveDialog.locator('#move-quote-category')).toHaveValue('podwykonawca');
    await moveDialog.getByRole('button', { name: 'Przenieś do kosztów' }).click();

    // Plakietka "Wybrana oferta (w kosztach)", przycisk "Cofnij przeniesienie" oraz brak podwójnego liczenia (nadal 3 500,60 PLN!)
    await expect(modal.getByText('Wybrana oferta (w kosztach)')).toBeVisible();
    await expect(modal.getByRole('button', { name: 'Cofnij przeniesienie' })).toBeVisible();
    await expect(modal.getByTestId('finance-total-costs')).toContainText('3 500,60 PLN');

    // Sprawdź pozycję w zakładce Koszty
    await modal.getByRole('tab', { name: /Lista kosztów i zadania/i }).click();
    await expect(modal.getByText('Instalacje sanitarne oferta')).toBeVisible();
    await expect(modal.getByText('Sanit-Bud Sp. z o.o.')).toBeVisible();

    // Cofnij przeniesienie
    await modal.getByRole('tab', { name: /Wyceny i Oferty/i }).click();
    await modal.getByRole('button', { name: 'Cofnij przeniesienie' }).click();
    await modal.getByRole('button', { name: 'Potwierdź cofnięcie' }).click();

    await expect(modal.getByText('Wybrana oferta (w kosztach)')).toBeHidden();
    await expect(modal.getByRole('button', { name: 'Przenieś do kosztów' })).toBeVisible();
    await expect(modal.getByTestId('finance-total-costs')).toContainText('3 500,60 PLN');
  });

  test('tryb tylko do odczytu dla kierownika, który nie jest właścicielem projektu', async ({ page }) => {
    await loginThroughUi(page, baseUrl, PM_OTHER_EMAIL, PM_PASS);

    await page.getByRole('button', { name: 'Projekty', exact: true }).click();
    await page.getByRole('button', { name: 'Kosztorys i wyceny projektu FIN-E2E' }).click();

    const modal = page.getByRole('dialog', { name: 'Hala Finansowa E2E' });
    await expect(modal.getByText('Edycja finansów: administrator i właściciel projektu')).toBeVisible();
    await expect(modal.locator('#fin-base-contract')).toBeDisabled();
    await expect(modal.getByRole('button', { name: 'Zapisz zmiany w projekcie i kosztorysie' })).toBeHidden();
    await expect(modal.getByRole('button', { name: /^Edytuj/ })).toHaveCount(0);

    // Weryfikacja po stronie serwera (403 dla obcego PM przy próbie bezpośredniego PATCH)
    const status = await page.evaluate(async (id) => {
      const res = await fetch(`/api/projects/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectValue: 99999 }),
      });
      return res.status;
    }, projectId);
    expect(status).toBe(403);
  });
});
