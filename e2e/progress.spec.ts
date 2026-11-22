import { test, expect, Page } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';

const ADMIN_EMAIL = 'admin.progress.e2e@example.pl';
const ADMIN_PASS = 'Katedra-Mural-2026!';

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
  throw new Error(`Serwer E2E postępu nie odpowiedział na ${baseUrl}/api/health`);
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

test.describe.serial('P65: Postęp zadań nadrzędnych i projektów z podzadań (E2E)', () => {
  let serverProc: ChildProcess | null = null;
  let tempDataDir = '';
  let baseUrl = '';
  let projectId = '';

  test.beforeAll(async () => {
    tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-e2e-progress-'));
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
        name: 'Admin Postęp E2E',
        email: ADMIN_EMAIL,
        password: ADMIN_PASS,
      }),
    });
    if (!setupRes.ok) {
      throw new Error(`setup-admin failed: ${setupRes.status}`);
    }
    const adminCookie = extractCookie(setupRes);
    const adminUser = (await setupRes.json()).user;

    const projRes = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Projekt Postęp E2E',
        ownerId: adminUser.id,
        status: 'active',
        startDate: '2026-05-01',
        dueDate: '2026-05-30',
      }),
    });
    if (!projRes.ok) {
      throw new Error(`create project failed: ${projRes.status}`);
    }
    projectId = (await projRes.json()).project.id;

    // Zadanie nadrzędne
    const parentRes = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        projectId,
        title: 'Etap nadrzędny E2E',
        status: 'in_progress',
        startDate: '2026-05-01',
        dueDate: '2026-05-15',
      }),
    });
    if (!parentRes.ok) {
      throw new Error(`create parent task failed: ${parentRes.status}`);
    }
    const parentTask = (await parentRes.json()).task;

    // Podzadanie 1: 30h, 0%
    const sub1Res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        projectId,
        parentId: parentTask.id,
        title: 'Podzadanie Ciężkie E2E',
        status: 'to_do',
        progress: 0,
        estimatedHours: 30,
        startDate: '2026-05-01',
        dueDate: '2026-05-10',
      }),
    });
    if (!sub1Res.ok) throw new Error(`create sub1 failed: ${sub1Res.status}`);

    // Podzadanie 2: 10h, 20%
    const sub2Res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        projectId,
        parentId: parentTask.id,
        title: 'Podzadanie Lekkie E2E',
        status: 'in_progress',
        progress: 20,
        estimatedHours: 10,
        startDate: '2026-05-11',
        dueDate: '2026-05-15',
      }),
    });
    if (!sub2Res.ok) throw new Error(`create sub2 failed: ${sub2Res.status}`);
  });

  test.afterAll(async () => {
    if (serverProc && !serverProc.killed) {
      serverProc.kill('SIGTERM');
    }
    if (tempDataDir) {
      fs.rmSync(tempDataDir, { recursive: true, force: true });
    }
  });

  test('postęp zadania nadrzędnego i projektu wynika z podzadań, suwak rodzica jest zablokowany, a zmiana ważenia w ustawieniach przelicza wynik', async ({ page }) => {
    await loginThroughUi(page, baseUrl, ADMIN_EMAIL, ADMIN_PASS);

    // Wybierz projekt w pasku roboczym i sprawdź początkowy postęp: (0*30 + 20*10)/40 = 5%
    await page.locator('#workspace-project-select').selectOption(projectId);
    await expect(page.getByText(/Postęp:\s*5%/i)).toBeVisible();

    // Przejdź do widoku Zadania i oznacz Podzadanie Ciężkie (30h) jako ukończone
    await page.getByRole('button', { name: 'Zadania', exact: true }).click();
    await page.getByRole('button', { name: 'Podzadanie Ciężkie E2E' }).click();

    const subDrawer = page.getByRole('dialog', { name: 'Podzadanie Ciężkie E2E' });
    await expect(subDrawer).toBeVisible();

    const patchSubPromise = page.waitForResponse(
      (res) => res.url().includes('/api/tasks/') && res.request().method() === 'PATCH' && res.status() === 200
    );
    await subDrawer.getByLabel('Status zadania').selectOption('done');
    await patchSubPromise;
    await subDrawer.getByRole('button', { name: 'Zamknij szczegóły zadania' }).click();

    // Teraz ważony postęp (estimate): (100*30 + 20*10) / 40 = 80%
    await expect(page.getByText(/Postęp:\s*80%/i)).toBeVisible();

    // Otwórz zadanie nadrzędne i sprawdź zablokowany suwak + komunikat + tooltip
    await page.getByRole('button', { name: 'Etap nadrzędny E2E' }).click();
    const parentDrawer = page.getByRole('dialog', { name: 'Etap nadrzędny E2E' });
    await expect(parentDrawer).toBeVisible();

    const parentSlider = parentDrawer.getByLabel('Postęp');
    await expect(parentSlider).toBeDisabled();
    await expect(parentSlider).toHaveAttribute(
      'title',
      'Podzadania: 2 (1 ukończone); wagi: godziny'
    );
    await expect(parentDrawer.getByText('Wyliczany z podzadań')).toBeVisible();
    await expect(parentDrawer.getByText('80%')).toBeVisible();
    await parentDrawer.getByRole('button', { name: 'Zamknij szczegóły zadania' }).click();

    // Przeładuj stronę i zweryfikuj trwałość wyliczonego postępu z serwera
    await page.reload();
    await expect(page.getByRole('button', { name: 'Wyloguj się z systemu' })).toBeVisible();
    await page.locator('#workspace-project-select').selectOption(projectId);
    await expect(page.getByText(/Postęp:\s*80%/i)).toBeVisible();

    // Zmień sposób ważenia na 'Równe wagi podzadań' w Ustawieniach -> Dostęp i sesje
    await page.getByRole('button', { name: 'Ustawienia systemu' }).click();
    const settingsDialog = page.getByRole('dialog');
    await expect(settingsDialog).toBeVisible();
    await settingsDialog.getByRole('tab', { name: /Dostęp i sesje/i }).click();

    const weightingSelect = settingsDialog.locator('#progress-weighting');
    await expect(weightingSelect).toBeVisible();
    await weightingSelect.selectOption('equal');
    await settingsDialog.locator('#access-admin-current-password').fill(ADMIN_PASS);

    const putSettingsPromise = page.waitForResponse(
      (res) => res.url().includes('/api/admin/settings') && res.request().method() === 'PUT' && res.status() === 200
    );
    await settingsDialog.getByRole('button', { name: 'Zapisz' }).click();
    await putSettingsPromise;
    await settingsDialog.getByRole('button', { name: 'Zamknij ustawienia' }).click();

    // Przy równych wagach: (100 + 20) / 2 = 60%
    await expect(page.getByText(/Postęp:\s*60%/i)).toBeVisible();
    await page.getByRole('button', { name: 'Zadania', exact: true }).click();
    await page.getByRole('button', { name: 'Etap nadrzędny E2E' }).click();
    await expect(page.getByRole('dialog', { name: 'Etap nadrzędny E2E' }).getByText('60%')).toBeVisible();
    await expect(
      page.getByRole('dialog', { name: 'Etap nadrzędny E2E' }).getByLabel('Postęp')
    ).toHaveAttribute('title', 'Podzadania: 2 (1 ukończone); wagi: równe');
  });
});
