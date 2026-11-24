import { test, expect, Page } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';

const ADMIN_EMAIL = 'admin.szablony.e2e@example.pl';
const ADMIN_PASS = 'Katedra-Beton-2026!';
const PM_EMAIL = 'kierownik.szablony.e2e@example.pl';
const PM_PASS = 'Konstrukcja-Stal-91!';

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
  throw new Error(`Serwer E2E Szablonów nie odpowiedział na ${baseUrl}/api/health`);
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

test.describe.serial('Szablony projektów — Ustawienia i współdzielenie między sesjami (E2E)', () => {
  let serverProc: ChildProcess | null = null;
  let tempDataDir = '';
  let baseUrl = '';

  test.beforeAll(async () => {
    tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-e2e-templates-'));
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
        name: 'Admin Szablony E2E',
        email: ADMIN_EMAIL,
        password: ADMIN_PASS,
      }),
    });
    if (!setupRes.ok) throw new Error(`setup-admin failed: ${setupRes.status}`);
    const adminCookie = extractCookie(setupRes);

    const pmRes = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Kierownik E2E',
        email: PM_EMAIL,
        role: 'project_manager',
        password: PM_PASS,
      }),
    });
    if (!pmRes.ok) throw new Error(`create pm failed: ${pmRes.status}`);

    // Projekt źródłowy z zadaniem nadrzędnym i podzadaniem
    const prjRes = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Hala Produkcyjna Wzorcowa',
        startDate: '2026-05-01',
        dueDate: '2026-06-30',
        durationDays: 61,
      }),
    });
    if (!prjRes.ok) throw new Error(`create project failed: ${prjRes.status}`);
    const prjData = await prjRes.json();
    const projectId = prjData.project.id;

    const rootRes = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        projectId,
        title: 'Projekt budowlany konstrukcji',
        startDate: '2026-05-01',
        dueDate: '2026-05-14',
        durationDays: 14,
      }),
    });
    if (!rootRes.ok) throw new Error(`create root task failed: ${rootRes.status}`);
    const rootTaskId = (await rootRes.json()).task.id;

    const subRes = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        projectId,
        parentId: rootTaskId,
        title: 'Obliczenia statyczne fundamentów',
        startDate: '2026-05-02',
        dueDate: '2026-05-06',
        durationDays: 5,
      }),
    });
    if (!subRes.ok) throw new Error(`create sub task failed: ${subRes.status}`);
  });

  test.afterAll(async () => {
    if (serverProc && !serverProc.killed) {
      serverProc.kill('SIGTERM');
    }
    if (tempDataDir && fs.existsSync(tempDataDir)) {
      fs.rmSync(tempDataDir, { recursive: true, force: true });
    }
  });

  test('admin tworzy szablon z projektu w Ustawieniach i szablon jest widoczny dla innego użytkownika w świeżej sesji', async ({
    browser,
    page,
  }) => {
    await loginThroughUi(page, baseUrl, ADMIN_EMAIL, ADMIN_PASS);

    // Otwórz Ustawienia -> Szablony projektów
    await page.getByRole('button', { name: 'Ustawienia systemu' }).click();
    const settingsDialog = page.getByRole('dialog', { name: /Ustawienia Pracowni/i });
    await expect(settingsDialog).toBeVisible();

    await settingsDialog.getByRole('tab', { name: /Szablony projektów/i }).click();
    await expect(settingsDialog.getByRole('button', { name: 'Utwórz z projektu' })).toBeVisible();

    // Utwórz szablon z projektu
    await settingsDialog.getByRole('button', { name: 'Utwórz z projektu' }).click();
    const fromProjectDialog = page.getByRole('dialog', { name: /Utwórz szablon z istniejącego projektu/i });
    await expect(fromProjectDialog).toBeVisible();

    await fromProjectDialog.getByLabel(/Nazwa szablonu/i).fill('Wspólny Szablon Hali E2E');
    await fromProjectDialog.getByRole('button', { name: 'Utwórz szablon' }).click();

    await expect(fromProjectDialog).toBeHidden();
    await expect(settingsDialog.getByText('Wspólny Szablon Hali E2E', { exact: true })).toBeVisible();

    // Edytuj świeżo utworzony szablon w nowym edytorze
    const editBtn = settingsDialog.getByRole('button', { name: 'Edytuj', exact: true }).first();
    await expect(editBtn).toBeVisible();
    await editBtn.click();

    const editorDialog = page.getByRole('dialog', { name: /Edytor szablonu: Wspólny Szablon Hali E2E/i });
    await expect(editorDialog).toBeVisible();

    await editorDialog.getByRole('button', { name: /Projekt budowlany konstrukcji/i }).first().click();
    await editorDialog.getByLabel(/Tytuł zadania/i).fill('Projekt konstrukcji po edycji E2E');

    const saveEditPromise = page.waitForResponse(
      (res) => res.url().includes('/api/templates/') && res.request().method() === 'PUT'
    );
    await editorDialog.getByRole('button', { name: 'Zapisz zmiany' }).click();
    expect((await saveEditPromise).status()).toBe(200);
    await expect(editorDialog).toHaveCount(0);

    await settingsDialog.getByRole('button', { name: 'Zamknij', exact: true }).click();

    // Nowa, całkowicie czysta sesja przeglądarki (inny użytkownik: kierownik projektu)
    const freshContext = await browser.newContext();
    const freshPage = await freshContext.newPage();
    try {
      await loginThroughUi(freshPage, baseUrl, PM_EMAIL, PM_PASS);
      await freshPage.getByRole('button', { name: 'Projekty', exact: true }).click();
      await freshPage.getByRole('button', { name: 'Zarejestruj nowy projekt' }).click();

      const newProjDialog = freshPage.getByRole('dialog', { name: /Rejestracja Nowego Projektu/i });
      await expect(newProjDialog).toBeVisible();

      const templateSelect = newProjDialog.getByLabel(/Użyj gotowego szablonu procesu/i);
      await expect(templateSelect).toContainText('Wspólny Szablon Hali E2E');

      const optionValue = await templateSelect
        .locator('option', { hasText: 'Wspólny Szablon Hali E2E' })
        .getAttribute('value');
      expect(optionValue).toBeTruthy();
      await templateSelect.selectOption(optionValue!);

      const templateChecklist = newProjDialog.getByRole('group', { name: 'Lista zadań z szablonu do utworzenia' });
      await expect(templateChecklist).toBeVisible();
      await expect(templateChecklist.getByText('Projekt konstrukcji po edycji E2E')).toBeVisible();

      // Odznacz jedno podzadanie i sprawdź podsumowanie
      const subCheckbox = templateChecklist.getByLabel(/Obliczenia statyczne fundamentów/i);
      await subCheckbox.uncheck();
      await expect(newProjDialog.getByTestId('template-selection-summary')).toContainText('1 zadań');

      await newProjDialog.getByRole('button', { name: 'Zarejestruj projekt' }).click();
      await expect(newProjDialog).toBeHidden();

      // Przejdź do widoku Drzewa zadań i sprawdź wyedytowane zadanie oraz brak odznaczonego podzadania
      await freshPage.getByRole('button', { name: 'Drzewo zadań' }).click();
      await expect(freshPage.getByText('Projekt konstrukcji po edycji E2E')).toBeVisible();
      await expect(freshPage.getByText('Obliczenia statyczne fundamentów')).toHaveCount(0);
    } finally {
      await freshContext.close();
    }
  });
});
