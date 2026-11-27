import { test, expect, Page } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';

const ADMIN_EMAIL = 'admin.p78.e2e@example.pl';
const ADMIN_PASS = 'Terminy-Kolory-2026!';

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
  throw new Error(`Serwer E2E P78 nie odpowiedział na ${baseUrl}/api/health`);
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

function addDaysInWarsaw(deltaDays: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const y = Number(parts.find((p) => p.type === 'year')?.value || '2026');
  const m = Number(parts.find((p) => p.type === 'month')?.value || '01');
  const d = Number(parts.find((p) => p.type === 'day')?.value || '01');
  const utc = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return utc.toISOString().slice(0, 10);
}

async function loginThroughUi(page: Page, baseUrl: string): Promise<void> {
  await page.goto(baseUrl);
  await expect(page.getByRole('button', { name: 'Zaloguj do pracowni' })).toBeVisible();
  await page.getByLabel(/Adres e-mail/i).fill(ADMIN_EMAIL);
  await page.getByLabel(/Hasło dostępu/i).fill(ADMIN_PASS);
  await page.getByRole('button', { name: 'Zaloguj do pracowni' }).click();
  await expect(page.getByRole('button', { name: 'Wyloguj się z systemu' })).toBeVisible();
}

function parseRgbString(rgbStr: string): [number, number, number] {
  const m = /rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/.exec(rgbStr);
  if (!m) throw new Error(`Nieoczekiwany format koloru CSS: ${rgbStr}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function contrastRatioFromRgb(fgStr: string, bgStr: string): number {
  const toLum = ([r, g, b]: [number, number, number]) => {
    const lin = [r, g, b].map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  };
  const l1 = toLum(parseRgbString(fgStr));
  const l2 = toLum(parseRgbString(bgStr));
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

test.describe.serial('P78: Terminy projektów, ostrzeżenia, animacje WCAG i kolor firmy w tabeli (E2E)', () => {
  let serverProc: ChildProcess | null = null;
  let tempDataDir = '';
  let baseUrl = '';
  let compId = '';

  const COMPANY_FULL_NAME = 'Pracownia Słoneczna Architekci Sp. z o.o.';
  const PROJ_WARN_NAME = 'Projekt Ostrzegawczy 20 Dni';
  const PROJ_CRIT_NAME = 'Projekt Krytyczny 5 Dni';
  const PROJ_CLOSED_NAME = 'Projekt Zakończony Bez Licznika';
  const PROJ_SAFE_NAME = 'Projekt Odległy 60 Dni';

  test.beforeAll(async () => {
    tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-e2e-p78-'));
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
        name: 'Administrator P78',
        email: ADMIN_EMAIL,
        password: ADMIN_PASS,
      }),
    });
    if (!setupRes.ok) throw new Error(`setup-admin failed: ${setupRes.status}`);
    const adminCookie = extractCookie(setupRes);
    const adminId = (await setupRes.json()).user.id as string;

    const compRes = await fetch(`${baseUrl}/api/companies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: COMPANY_FULL_NAME,
        letter: 'A',
        color: '#1D4ED8',
        isActive: true,
      }),
    });
    if (!compRes.ok) throw new Error(`create company failed: ${compRes.status}`);
    compId = (await compRes.json()).company.id;

    const createProject = async (payload: Record<string, unknown>) => {
      const res = await fetch(`${baseUrl}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({
          companyId: compId,
          ownerId: adminId,
          memberIds: [adminId],
          priority: 'normal',
          startDate: addDaysInWarsaw(-30),
          progress: 40,
          ...payload,
        }),
      });
      if (!res.ok) throw new Error(`create project ${payload.name} failed: ${res.status}`);
    };

    await createProject({
      name: PROJ_WARN_NAME,
      status: 'active',
      dueDate: addDaysInWarsaw(20),
    });
    await createProject({
      name: PROJ_CRIT_NAME,
      status: 'active',
      dueDate: addDaysInWarsaw(5),
    });
    await createProject({
      name: PROJ_CLOSED_NAME,
      status: 'completed',
      dueDate: addDaysInWarsaw(2),
      progress: 100,
    });
    await createProject({
      name: PROJ_SAFE_NAME,
      status: 'active',
      dueDate: addDaysInWarsaw(60),
    });
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

  test('licznik dni, ostrzeżenie czerwone (20 dni), mruganie wiersza i kafelka (5 dni), prefers-reduced-motion oraz projekt zakończony', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await loginThroughUi(page, baseUrl);

    const nav = page.getByRole('navigation', { name: 'Główna nawigacja' });
    await nav.getByRole('button', { name: 'Projekty', exact: true }).click();

    // 1. Sprawdź widok Lista
    await page.getByRole('button', { name: 'Lista', exact: true }).click();
    const table = page.getByRole('table');
    await expect(table).toBeVisible();

    const warnRow = table.locator('tbody tr', { hasText: PROJ_WARN_NAME });
    const critRow = table.locator('tbody tr', { hasText: PROJ_CRIT_NAME });
    const closedRow = table.locator('tbody tr', { hasText: PROJ_CLOSED_NAME });
    const safeRow = table.locator('tbody tr', { hasText: PROJ_SAFE_NAME });

    // Projekt za 20 dni: licznik "za 20 dni", czerwony tekst, bez mrugania
    const warnCounter = warnRow.getByTestId('project-deadline-counter');
    await expect(warnCounter).toHaveText('za 20 dni');
    await expect(warnRow).not.toHaveClass(/animate-project-deadline-row/);
    const warnCounterColor = await warnCounter.evaluate((el) => getComputedStyle(el).color);
    const safeCounterColor = await safeRow
      .getByTestId('project-deadline-counter')
      .evaluate((el) => getComputedStyle(el).color);
    expect(warnCounterColor).not.toBe(safeCounterColor);
    const warnAnim = await warnRow.evaluate((el) => getComputedStyle(el).animationName);
    expect(warnAnim).toBe('none');

    // Projekt za 5 dni: licznik "za 5 dni", mruganie całego wiersza (<= 1 Hz -> duration >= 1s)
    const critCounter = critRow.getByTestId('project-deadline-counter');
    await expect(critCounter).toHaveText('za 5 dni');
    await expect(critRow).toHaveClass(/animate-project-deadline-row/);
    const critAnimInfo = await critRow.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        animationName: cs.animationName,
        animationDuration: cs.animationDuration,
      };
    });
    expect(critAnimInfo.animationName).not.toBe('none');
    expect(parseFloat(critAnimInfo.animationDuration)).toBeGreaterThanOrEqual(1);

    // Projekt zakończony (isClosed): brak licznika dni i brak mrugania
    await expect(closedRow.getByTestId('project-deadline-counter')).toHaveCount(0);
    await expect(closedRow).not.toHaveClass(/animate-project-deadline-row/);

    // Projekt za 60 dni: licznik "za 60 dni", bez mrugania
    await expect(safeRow.getByTestId('project-deadline-counter')).toHaveText('za 60 dni');
    await expect(safeRow).not.toHaveClass(/animate-project-deadline-row/);

    // 2. prefers-reduced-motion: reduce -> animacja mrugania całkowicie wyłączona, zostaje tekst + stałe obramowanie
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(critCounter).toHaveText('za 5 dni');
    const reducedAnimInfo = await critRow.evaluate((el) => {
      const cs = getComputedStyle(el);
      const firstTd = el.querySelector('td');
      return {
        animationName: cs.animationName,
        rowClass: el.className,
        tdBoxShadow: firstTd ? getComputedStyle(firstTd).boxShadow : '',
      };
    });
    expect(reducedAnimInfo.animationName).toBe('none');
    expect(reducedAnimInfo.rowClass).toContain('project-deadline-static-row');
    expect(reducedAnimInfo.tdBoxShadow).not.toBe('none');

    await page.emulateMedia({ reducedMotion: 'no-preference' });

    // 3. Widok Kafelki: kafelek krytyczny mruga, ostrzegawczy nie mruga, zakończony nie ma licznika
    await page.getByRole('button', { name: 'Kafelki', exact: true }).click();
    const critTile = page.locator('div.rounded-lg', { has: page.getByRole('button', { name: PROJ_CRIT_NAME }) }).first();
    const closedTile = page.locator('div.rounded-lg', { has: page.getByRole('button', { name: PROJ_CLOSED_NAME }) }).first();

    await expect(critTile.getByTestId('project-deadline-counter')).toContainText('za 5 dni');
    await expect(critTile).toHaveClass(/animate-project-deadline-tile/);
    const tileAnimName = await critTile.evaluate((el) => getComputedStyle(el).animationName);
    expect(tileAnimName).not.toBe('none');

    await expect(closedTile.getByTestId('project-deadline-counter')).toHaveCount(0);

    // 4. Preferencja użytkownika oph_pref_deadline_blink w Ustawienia > Wygląd & Motyw wyłącza animację
    await page.getByRole('button', { name: 'Ustawienia systemu' }).click();
    const themeSettings = page.getByRole('dialog', { name: /Ustawienia Pracowni/i });
    await themeSettings.getByRole('tab', { name: /Wygląd & Motyw/i }).click();
    const blinkPrefCheckbox = themeSettings.locator('#pref-deadline-blink');
    await expect(blinkPrefCheckbox).toBeChecked();
    await blinkPrefCheckbox.uncheck();
    expect(await page.evaluate(() => localStorage.getItem('oph_pref_deadline_blink'))).toBe('false');
    await themeSettings.getByRole('button', { name: 'Zamknij ustawienia' }).click();

    await expect(critTile).not.toHaveClass(/animate-project-deadline-tile/);
    await expect(critTile).toHaveClass(/project-deadline-static-tile/);
    expect(await critTile.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  });

  test('edycja koloru firmy w Ustawieniach oraz pełna nazwa firmy na tle jej koloru z kontrastem >= 4.5 w obu motywach', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await loginThroughUi(page, baseUrl);

    // 1. Otwórz Ustawienia -> Firmy i zmień kolor firmy na jasny żółty (#FACC15) z palety, sprawdzając też błąd walidacji hex
    await page.getByRole('button', { name: 'Ustawienia systemu' }).click();
    const settingsDialog = page.getByRole('dialog', { name: /Ustawienia Pracowni/i });
    await settingsDialog.getByRole('tab', { name: 'Firmy' }).click();

    await settingsDialog
      .locator('div', { hasText: COMPANY_FULL_NAME })
      .getByRole('button', { name: 'Edytuj', exact: true })
      .first()
      .click();
    const colorInput = settingsDialog.locator(`#edit-color-${compId}`);
    await expect(colorInput).toBeVisible();

    // Niepoprawny kod hex -> formularz pokazuje błąd walidacji
    await colorInput.fill('#123');
    await settingsDialog.getByRole('button', { name: 'Zapisz', exact: true }).click();
    await expect(settingsDialog.getByRole('alert')).toContainText('#RRGGBB');

    // Wybierz z palety jasny słoneczny (#FACC15) i zapisz
    await settingsDialog
      .getByRole('group', { name: `Paleta kolorów firmy ${COMPANY_FULL_NAME}` })
      .getByRole('button', { name: 'Kolor Słoneczny (#FACC15)' })
      .click();
    await expect(colorInput).toHaveValue('#FACC15');

    const patchPromise = page.waitForResponse(
      (res) => res.url().includes(`/api/companies/${compId}`) && res.request().method() === 'PATCH'
    );
    await settingsDialog.getByRole('button', { name: 'Zapisz', exact: true }).click();
    expect((await patchPromise).status()).toBe(200);

    await settingsDialog.getByRole('button', { name: 'Zamknij ustawienia' }).click();
    await expect(settingsDialog).toHaveCount(0);

    // 2. Wróć do widoku Projekty -> Lista: sprawdź pełną nazwę firmy, kolor tła #FACC15 i kontrast >= 4.5 w trybie jasnym i ciemnym
    const nav = page.getByRole('navigation', { name: 'Główna nawigacja' });
    await nav.getByRole('button', { name: 'Projekty', exact: true }).click();
    await page.getByRole('button', { name: 'Lista', exact: true }).click();

    const table = page.getByRole('table');
    const firstRow = table.locator('tbody tr', { hasText: PROJ_WARN_NAME });
    const companyCellBadge = firstRow.locator('td').nth(3).locator('span', { hasText: COMPANY_FULL_NAME });
    await expect(companyCellBadge).toHaveText(COMPANY_FULL_NAME);

    const lightStyles = await companyCellBadge.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, fg: cs.color };
    });
    expect(lightStyles.bg).toBe('rgb(250, 204, 21)'); // #FACC15
    expect(contrastRatioFromRgb(lightStyles.fg, lightStyles.bg)).toBeGreaterThanOrEqual(4.5);

    // Przełącz na motyw ciemny i sprawdź kontrast ponownie
    await page.evaluate(() => {
      document.documentElement.classList.add('dark');
      localStorage.setItem('oph_theme_mode', 'dark');
    });
    await expect(page.locator('html')).toHaveClass(/dark/);
    const darkStyles = await companyCellBadge.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, fg: cs.color };
    });
    expect(darkStyles.bg).toBe('rgb(250, 204, 21)');
    expect(contrastRatioFromRgb(darkStyles.fg, darkStyles.bg)).toBeGreaterThanOrEqual(4.5);

    // 3. Zmień globalne progi terminów w Ustawieniach -> Zmienne & Terminy (warnDays: 10, criticalDays: 3)
    //    Wówczas projekt za 20 dni przestaje być ostrzegawczy, a projekt za 5 dni nie mruga lecz pozostaje czerwony!
    await page.evaluate(() => {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('oph_theme_mode', 'light');
    });
    await page.getByRole('button', { name: 'Ustawienia systemu' }).click();
    const varsDialog = page.getByRole('dialog', { name: /Ustawienia Pracowni/i });
    await varsDialog.getByRole('tab', { name: /Zmienne & Terminy/i }).click();

    await varsDialog.locator('#settings-project-deadline-warn').fill('10');
    await varsDialog.locator('#settings-project-deadline-critical').fill('3');
    const varsPutPromise = page.waitForResponse(
      (res) => res.url().includes('/api/admin/variables') && res.request().method() === 'PUT'
    );
    await varsDialog.getByRole('button', { name: 'Zapisz progi terminów' }).click();
    expect((await varsPutPromise).status()).toBe(200);
    await varsDialog.getByRole('button', { name: 'Zamknij ustawienia' }).click();

    const critRowAfter = table.locator('tbody tr', { hasText: PROJ_CRIT_NAME });
    await expect(critRowAfter).not.toHaveClass(/animate-project-deadline-row/);
    const warnRowAfter = table.locator('tbody tr', { hasText: PROJ_WARN_NAME });
    const safeRowAfter = table.locator('tbody tr', { hasText: PROJ_SAFE_NAME });
    const warnColorAfter = await warnRowAfter
      .getByTestId('project-deadline-counter')
      .evaluate((el) => getComputedStyle(el).color);
    const safeColorAfter = await safeRowAfter
      .getByTestId('project-deadline-counter')
      .evaluate((el) => getComputedStyle(el).color);
    expect(warnColorAfter).toBe(safeColorAfter);
  });
});
