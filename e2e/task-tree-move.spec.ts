import { test, expect, Page } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';

const ADMIN_EMAIL = 'admin.treemove.e2e@example.pl';
const ADMIN_PASS = 'Modrzew-Sciezka-2026!';

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

async function loginThroughUi(page: Page, baseUrl: string, email: string, password: string): Promise<void> {
  await page.goto(baseUrl);
  await expect(page.getByRole('button', { name: 'Zaloguj do pracowni' })).toBeVisible();
  await page.getByLabel(/Adres e-mail/i).fill(email);
  await page.getByLabel(/Hasło dostępu/i).fill(password);
  await page.getByRole('button', { name: 'Zaloguj do pracowni' }).click();
  await expect(page.getByRole('button', { name: 'Wyloguj się z systemu' })).toBeVisible();
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

test.describe.serial('P66: Przesuwanie zadań w drzewie (E2E)', () => {
  let serverProc: ChildProcess | null = null;
  let tempDataDir = '';
  let baseUrl = '';
  let taskParentA: any;
  let taskChildA: any;
  let taskTargetB: any;

  test.beforeAll(async () => {
    tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-e2e-treemove-'));
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
        name: 'Admin Drzewo E2E',
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
        name: 'Projekt Drzewo E2E',
        ownerId: adminUser.id,
        status: 'active',
        startDate: '2026-06-01',
        dueDate: '2026-06-30',
      }),
    });
    if (!projRes.ok) throw new Error(`create project failed: ${projRes.status}`);
    const project = (await projRes.json()).project;

    const mkTask = async (body: Record<string, any>) => {
      const r = await fetch(`${baseUrl}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({
          projectId: project.id,
          startDate: '2026-06-02',
          dueDate: '2026-06-15',
          durationDays: 13,
          ...body,
        }),
      });
      if (!r.ok) throw new Error(`create task failed: ${r.status}`);
      return (await r.json()).task;
    };

    taskParentA = await mkTask({ title: 'Gałąź A', status: 'in_progress' });
    taskChildA = await mkTask({
      title: 'Podzadanie A1',
      parentId: taskParentA.id,
      status: 'to_do',
      progress: 0,
    });
    taskTargetB = await mkTask({
      title: 'Gałąź B (docelowa)',
      status: 'done',
      progress: 100,
    });
  });

  test.afterAll(async () => {
    if (serverProc && !serverProc.killed) {
      serverProc.kill('SIGTERM');
    }
    if (tempDataDir) {
      fs.rmSync(tempDataDir, { recursive: true, force: true });
    }
  });

  test('przeciąganie, niedostępny cel, przenoszenie z klawiatury (Przenieś) oraz cofnięcie toasta', async ({ page }) => {
    await loginThroughUi(page, baseUrl, ADMIN_EMAIL, ADMIN_PASS);

    const nav = page.getByRole('navigation', { name: 'Główna nawigacja' });
    await nav.getByRole('button', { name: 'Drzewo zadań', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Rozwijane Drzewo Zadań i Gałęzi' })).toBeVisible();

    // 1. Sprawdź przeciągnięcie Gałąź A na jego własnego potomka (cel niedostępny) oraz na Gałąź B (cel prawidłowy)
    const handleParentA = page.getByTestId(`tree-drag-handle-${taskParentA.id}`);
    const rowChildA = page.locator(`[data-tree-row-id="${taskChildA.id}"]`);
    const rowTargetB = page.locator(`[data-tree-row-id="${taskTargetB.id}"]`);

    await expect(handleParentA).toBeVisible();
    await expect(rowChildA).toBeVisible();
    await expect(rowTargetB).toBeVisible();

    // Rozpocznij drag i najedź na potomka -> niedostępne, brak wywołania PATCH
    await handleParentA.dispatchEvent('dragstart', {
      dataTransfer: new DataTransfer(),
    });
    await rowChildA.dispatchEvent('dragover');
    await expect(rowChildA).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByText(/Niedostępne:/i)).toBeVisible();

    // Najedź na prawidłowy cel Gałąź B -> widoczny wskaźnik 'Jako podzadanie: <kod>'
    await rowTargetB.dispatchEvent('dragover');
    await expect(page.getByText(`Jako podzadanie: ${taskTargetB.code}`)).toBeVisible();
    await handleParentA.dispatchEvent('dragend');

    // 2. Przenieś zadanie Podzadanie A1 pod Gałąź B za pomocą klawiatury / przycisku "Przenieś"
    await page.getByRole('button', { name: `Przenieś zadanie ${taskChildA.code}` }).click();
    const moveDialog = page.getByRole('dialog', { name: new RegExp(`Przenieś zadanie \\[${taskChildA.code}\\]`) });
    await expect(moveDialog).toBeVisible();

    // Niedozwolony cel (samo siebie) nie występuje na liście
    await expect(moveDialog.getByRole('button', { name: new RegExp(`\\[${taskChildA.code}\\]`) })).toHaveCount(0);

    const patchPromise = page.waitForResponse(
      (res) => res.url().includes(`/api/tasks/${taskChildA.id}`) && res.request().method() === 'PATCH'
    );
    await moveDialog.getByRole('button', { name: new RegExp(`\\[${taskTargetB.code}\\]`) }).click();
    const patchRes = await patchPromise;
    expect(patchRes.status()).toBe(200);

    // Ogłoszenie aria-live oraz toast 'Przeniesiono zadanie.' z 'Cofnij'
    await expect(page.getByText(`Przeniesiono zadanie ${taskChildA.code} pod ${taskTargetB.code}`)).toBeAttached();
    await expect(page.getByText('Przeniesiono zadanie.')).toBeVisible();
    const undoBtn = page.getByRole('button', { name: 'Cofnij' });
    await expect(undoBtn).toBeVisible();

    // Gałąź B (była 'done') powinna zostać otwarta ponownie ('W toku'), bo dostała nieukończone podzadanie
    await expect(rowTargetB).toContainText('W toku');

    // Kliknij 'Cofnij' -> przywróć poprzedniego rodzica (Gałąź A) i Gałąź B wraca na 'Ukończone'
    const undoPatchPromise = page.waitForResponse(
      (res) => res.url().includes(`/api/tasks/${taskChildA.id}`) && res.request().method() === 'PATCH'
    );
    await undoBtn.click();
    expect((await undoPatchPromise).status()).toBe(200);
    await expect(rowTargetB).toContainText('Ukończone');

    // 3. Przenieś Podzadanie A1 na Poziom główny przez okno przenoszenia (skrót Alt+M)
    const rowChildAFocus = page.locator(`[data-tree-row-id="${taskChildA.id}"]`);
    await rowChildAFocus.focus();
    await rowChildAFocus.press('Alt+m');
    const moveDialog2 = page.getByRole('dialog', { name: new RegExp(`Przenieś zadanie \\[${taskChildA.code}\\]`) });
    await expect(moveDialog2).toBeVisible();

    const rootPatchPromise = page.waitForResponse(
      (res) => res.url().includes(`/api/tasks/${taskChildA.id}`) && res.request().method() === 'PATCH'
    );
    await moveDialog2.getByRole('button', { name: 'Poziom główny' }).click();
    expect((await rootPatchPromise).status()).toBe(200);
    await expect(page.getByText(`Przeniesiono zadanie ${taskChildA.code} na poziom główny`)).toBeAttached();
  });
});
