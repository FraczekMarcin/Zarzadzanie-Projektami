import { test, expect, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { spawn, ChildProcess } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';

const ADMIN_NAME = 'Administrator A11y';
const ADMIN_EMAIL = 'a11y.admin@example.pl';
const ADMIN_DEPT = 'Architektura';
const ADMIN_PASS = 'Katedra-Projekt-2026!';

const REPORT_PATH = path.resolve(process.cwd(), 'test-results', 'a11y-report.json');
const AXE_TAGS = ['wcag2a', 'wcag2aa'];

type ThemeKind = 'light' | 'dark';

interface A11yViolationNodeSummary {
  target: string[];
  failureSummary?: string;
}

interface A11yViolationEntry {
  id: string;
  impact: string;
  description: string;
  help: string;
  helpUrl: string;
  tags: string[];
  nodesCount: number;
  nodes: A11yViolationNodeSummary[];
}

interface A11yViewScanResult {
  view: string;
  label: string;
  theme: ThemeKind;
  totalViolations: number;
  seriousAndCriticalCount: number;
  violations: A11yViolationEntry[];
}

const SETTINGS_TABS: Array<{ key: string; name: string }> = [
  { key: 'settings-theme', name: 'Wygląd & Motyw' },
  { key: 'settings-variables', name: 'Zmienne & Terminy' },
  { key: 'settings-templates', name: 'Szablony projektów' },
  { key: 'settings-companies', name: 'Firmy' },
  { key: 'settings-users', name: 'Użytkownicy & Zgody' },
  { key: 'settings-security', name: 'Dziennik bezpieczeństwa' },
  { key: 'settings-smtp', name: 'Poczta (SMTP)' },
  { key: 'settings-notifications', name: 'Powiadomienia' },
  { key: 'settings-access', name: 'Dostęp i sesje' },
  { key: 'settings-update', name: 'Aktualizacje' },
  { key: 'settings-docker', name: 'Wdrożenie Docker' },
  { key: 'settings-backup', name: 'Kopie Zapasowe' },
  { key: 'settings-calendar', name: 'Kalendarz Google' },
];

const ARCHIVE_TABS: Array<{ key: string; name: string }> = [
  { key: 'archive-backup-auto', name: 'Automatyczne Kopie (Harmonogram)' },
  { key: 'archive-backup-gdrive', name: 'Google Drive' },
  { key: 'archive-backup-ftp', name: 'Serwer FTP / SFTP' },
  { key: 'archive-backup-local', name: 'Zrzuty SQL & Pliki Lokalne' },
  { key: 'archive-backup-history', name: 'Historia Zrzutów' },
];

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
      if (res.ok) {
        return;
      }
    } catch {
      // Serwer jeszcze się uruchamia
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Izolowany serwer testowy A11y nie odpowiedział na ${baseUrl}/api/health`);
}

async function applyThemeForPage(page: Page, theme: ThemeKind): Promise<void> {
  await page.evaluate((targetTheme) => {
    localStorage.setItem('oph_theme_mode', targetTheme);
    if (targetTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, theme);

  if (theme === 'dark') {
    await expect(page.locator('html')).toHaveClass(/dark/);
  } else {
    await expect(page.locator('html')).not.toHaveClass(/dark/);
  }
}

async function loginThroughUi(page: Page, baseUrl: string, theme: ThemeKind): Promise<void> {
  await page.goto(baseUrl);
  await applyThemeForPage(page, theme);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Zaloguj do pracowni' })).toBeVisible();
  await page.getByLabel(/Adres e-mail/i).fill(ADMIN_EMAIL);
  await page.getByLabel(/Hasło dostępu/i).fill(ADMIN_PASS);
  await page.getByRole('button', { name: 'Zaloguj do pracowni' }).click();
  await expect(page.getByRole('button', { name: 'Wyloguj się z systemu' })).toBeVisible();
  await applyThemeForPage(page, theme);
}

async function scanView(
  page: Page,
  results: A11yViewScanResult[],
  view: string,
  label: string,
  theme: ThemeKind
): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const analysis = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const violations: A11yViolationEntry[] = analysis.violations.map((v) => ({
    id: v.id,
    impact: v.impact || 'minor',
    description: v.description,
    help: v.help,
    helpUrl: v.helpUrl,
    tags: v.tags,
    nodesCount: v.nodes.length,
    nodes: v.nodes.slice(0, 10).map((n) => ({
      target: n.target.map((t) => String(t)),
      failureSummary: n.failureSummary,
    })),
  }));

  const seriousAndCriticalCount = violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical'
  ).length;

  results.push({
    view,
    label,
    theme,
    totalViolations: violations.length,
    seriousAndCriticalCount,
    violations,
  });

  if (violations.length > 0) {
    const summaryList = violations.map((v) => `${v.id}[${v.impact}:${v.nodesCount}]`).join(', ');
    console.log(`[a11y][${theme}][${view}] Naruszenia (${violations.length}): ${summaryList}`);
  } else {
    console.log(`[a11y][${theme}][${view}] Brak naruszeń WCAG 2.x A/AA`);
  }
}

interface PageMonitor {
  consoleErrors: string[];
  pageErrors: string[];
  assertClean: () => Promise<void>;
}

async function attachErrorMonitor(page: Page): Promise<PageMonitor> {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  await page.addInitScript(() => {
    const win = window as unknown as { __cspViolations?: string[] };
    win.__cspViolations = [];
    window.addEventListener('securitypolicyviolation', (event) => {
      win.__cspViolations?.push(
        `${event.violatedDirective || event.effectiveDirective}: ${event.blockedURI}`
      );
    });
  });

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('pageerror', (err) => {
    pageErrors.push(err.message || String(err));
  });

  return {
    consoleErrors,
    pageErrors,
    assertClean: async () => {
      const cspViolations = await page.evaluate(() => {
        const win = window as unknown as { __cspViolations?: string[] };
        return win.__cspViolations || [];
      });
      expect(consoleErrors, 'Błędy konsoli przeglądarki').toEqual([]);
      expect(pageErrors, 'Nieobsłużone wyjątki pageerror').toEqual([]);
      expect(cspViolations, 'Naruszenia Content-Security-Policy').toEqual([]);
    },
  };
}

function writeReport(results: A11yViewScanResult[]): void {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  const totalViolations = results.reduce((sum, r) => sum + r.totalViolations, 0);
  const viewsWithViolations = results.filter((r) => r.totalViolations > 0).length;
  const seriousViolations = results.reduce(
    (sum, r) => sum + r.violations.filter((v) => v.impact === 'serious').length,
    0
  );
  const criticalViolations = results.reduce(
    (sum, r) => sum + r.violations.filter((v) => v.impact === 'critical').length,
    0
  );

  const payload = {
    generatedAt: new Date().toISOString(),
    strictMode: process.env.A11Y_STRICT === 'true',
    tags: AXE_TAGS,
    summary: {
      totalScans: results.length,
      viewsWithViolations,
      totalViolations,
      seriousViolations,
      criticalViolations,
    },
    results,
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
}

test.describe.serial('Audyt dostępności WCAG 2.0/2.1 (A/AA) w trybie jasnym i ciemnym', () => {
  let serverProcess: ChildProcess | null = null;
  let dataDir = '';
  let baseUrl = '';
  const scanResults: A11yViewScanResult[] = [];

  test.beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-a11y-data-'));
    const port = await findFreePort();
    baseUrl = `http://localhost:${port}`;
    const appSecret = crypto.randomBytes(32).toString('hex');

    serverProcess = spawn('node', ['dist/server.js'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(port),
        DATA_DIR: dataDir,
        APP_SECRET: appSecret,
      },
      stdio: 'pipe',
    });

    await waitForServerReady(baseUrl);
  });

  test.afterAll(async () => {
    if (scanResults.length > 0) {
      writeReport(scanResults);
    }

    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          serverProcess?.kill('SIGKILL');
          resolve();
        }, 3_000);
        serverProcess?.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }

    if (dataDir && fs.existsSync(dataDir)) {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test('1) konfiguracja danych testowych oraz skan ekranu logowania w trybie jasnym i ciemnym', async ({ page }) => {
    test.setTimeout(120_000);
    const monitor = await attachErrorMonitor(page);
    await page.goto(baseUrl);
    await expect(page.getByRole('heading', { name: 'Kreator Konfiguracji Administratora' })).toBeVisible();

    await page.getByLabel(/Imię i Nazwisko Administratora/i).fill(ADMIN_NAME);
    await page.getByLabel(/Adres e-mail/i).fill(ADMIN_EMAIL);
    await page.getByLabel(/Dział \/ Rola w Pracowni/i).fill(ADMIN_DEPT);
    await page.getByLabel(/Hasło Administratora/i).fill(ADMIN_PASS);
    await page.getByLabel(/Powtórz hasło/i).fill(ADMIN_PASS);

    const setupResPromise = page.waitForResponse(
      (res) => res.url().includes('/api/auth/setup-admin') && res.request().method() === 'POST'
    );
    await page.getByRole('button', { name: 'Utwórz konto Administratora i przejdź do systemu' }).click();
    expect((await setupResPromise).status()).toBe(200);
    await expect(page.getByRole('button', { name: 'Wyloguj się z systemu' })).toBeVisible();

    // Utworzenie projektu oraz 2 zadań (jedno aktywne o priorytecie krytycznym, drugie przeniesione do kosza)
    const nav = page.getByRole('navigation', { name: 'Główna nawigacja' });
    await nav.getByRole('button', { name: 'Projekty', exact: true }).click();
    await page.getByRole('button', { name: 'Zarejestruj nowy projekt' }).click();
    await page.getByLabel(/Nazwa projektu/i).fill('Projekt Referencyjny A11y');
    const projResPromise = page.waitForResponse(
      (res) => res.url().includes('/api/projects') && res.request().method() === 'POST'
    );
    await page.getByRole('button', { name: 'Zarejestruj projekt' }).click();
    expect((await projResPromise).status()).toBe(201);

    await page.getByRole('button', { name: 'Nowe zadanie' }).first().click();
    await page.getByLabel(/Tytuł zadania/i).fill('Zadanie referencyjne A11y');
    await page.getByLabel(/Priorytet zadania/i).selectOption('critical');
    const task1Promise = page.waitForResponse(
      (res) => res.url().includes('/api/tasks') && res.request().method() === 'POST'
    );
    await page.getByRole('button', { name: 'Utwórz zadanie' }).click();
    expect((await task1Promise).status()).toBe(201);

    await page.getByRole('button', { name: 'Nowe zadanie' }).first().click();
    await page.getByLabel(/Tytuł zadania/i).fill('Zadanie do kosza A11y');
    const task2Promise = page.waitForResponse(
      (res) => res.url().includes('/api/tasks') && res.request().method() === 'POST'
    );
    await page.getByRole('button', { name: 'Utwórz zadanie' }).click();
    expect((await task2Promise).status()).toBe(201);

    // Dodanie pozycji finansowych (transza, wycena, koszt), aby przetestować także otwarte formularze edycji
    await page.getByRole('button', { name: /Kosztorys i wyceny projektu/i }).first().click();
    const setupFinanceDialog = page.getByRole('dialog', { name: 'Projekt Referencyjny A11y' });
    await expect(setupFinanceDialog).toBeVisible();
    await setupFinanceDialog.locator('#fin-tranche-title').fill('Transza referencyjna A11y');
    await setupFinanceDialog.locator('#fin-tranche-net').fill('1000');
    await setupFinanceDialog.getByRole('button', { name: 'Dodaj transzę', exact: true }).click();
    await expect(setupFinanceDialog.getByText('Transza referencyjna A11y')).toBeVisible();

    await setupFinanceDialog.locator('#fin-quote-title').fill('Wycena referencyjna A11y');
    await setupFinanceDialog.locator('#fin-quote-price').fill('5000');
    await setupFinanceDialog.getByRole('button', { name: /Dodaj wycenę do listy/i }).click();
    await expect(setupFinanceDialog.getByText('Wycena referencyjna A11y')).toBeVisible();

    await setupFinanceDialog.getByRole('tab', { name: /Lista kosztów i zadania/i }).click();
    await setupFinanceDialog.locator('#fin-cost-title').fill('Koszt referencyjny A11y');
    await setupFinanceDialog.locator('#fin-cost-net').fill('500');
    await setupFinanceDialog.getByRole('button', { name: /Zapisz koszt/i }).click();
    await expect(setupFinanceDialog.getByText('Koszt referencyjny A11y')).toBeVisible();

    const financePatchPromise = page.waitForResponse(
      (res) => res.url().includes('/api/projects/') && res.request().method() === 'PATCH'
    );
    await setupFinanceDialog.getByRole('button', { name: 'Zapisz zmiany w projekcie i kosztorysie' }).click();
    expect((await financePatchPromise).status()).toBe(200);
    await expect(setupFinanceDialog).toHaveCount(0);

    // Przeniesienie drugiego zadania do kosza, aby widok Kosz miał aktywny wpis do audytu
    await nav.getByRole('button', { name: 'Zadania', exact: true }).click();
    const trashTargetLink = page.getByRole('button', { name: 'Zadanie do kosza A11y' });
    await expect(trashTargetLink).toBeVisible();
    const trashRow = page.locator('tr', { has: trashTargetLink });
    await trashRow.getByRole('button', { name: /^Usuń zadanie /i }).click();
    const deleteDialog = page.getByRole('dialog', { name: /Usuń zadanie/i });
    const deleteResPromise = page.waitForResponse(
      (res) => res.url().includes('/api/tasks/') && res.request().method() === 'DELETE'
    );
    await deleteDialog.getByRole('button', { name: 'Tak, przenieś do kosza' }).click();
    expect((await deleteResPromise).status()).toBe(200);

    // Utworzenie przetargu referencyjnego do audytu dostępności widoku Przetargi i jego modali
    const tenderCreatedStatus = await page.evaluate(async () => {
      const res = await fetch('/api/tenders', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Przetarg Referencyjny A11y',
          contractingAuthority: 'Urząd Miasta A11y',
          referenceNumber: 'A11Y.271.1.2026',
          description: 'Opis postępowania referencyjnego do audytu WCAG.',
          url: 'https://example.pl/przetarg-a11y',
          announcementDate: '2026-04-01',
          submissionDeadline: '2026-04-20',
          resolutionDate: '2026-05-05',
          status: 'resolved',
          priceBasis: 'gross',
          authorityBudget: 250000,
          scopeQuantity: 10,
          scopeUnit: 'km',
          winnerBidderId: 'bid-a11y-1',
          bidders: [
            { id: 'bid-a11y-1', name: 'Nasza Pracownia A11y', price: 200000, isOurs: true },
            { id: 'bid-a11y-2', name: 'Konkurent A11y', price: 240000, isOurs: false },
          ],
        }),
      });
      return res.status;
    });
    expect(tenderCreatedStatus).toBe(201);

    // Wylogowanie i skan ekranu logowania w trybie jasnym i ciemnym
    await page.getByRole('button', { name: 'Wyloguj się z systemu' }).click();
    await expect(page.getByRole('button', { name: 'Zaloguj do pracowni' })).toBeVisible();

    await applyThemeForPage(page, 'light');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Zaloguj do pracowni' })).toBeVisible();
    await scanView(page, scanResults, 'login', 'Ekran logowania', 'light');

    await applyThemeForPage(page, 'dark');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Zaloguj do pracowni' })).toBeVisible();
    await scanView(page, scanResults, 'login', 'Ekran logowania', 'dark');

    await monitor.assertClean();
  });

  for (const theme of ['light', 'dark'] as const) {
    const themeLabel = theme === 'light' ? 'trybie jasnym' : 'trybie ciemnym';

    test(`2) skan wszystkich widoków, szuflady, modali i zakładek Ustawień w ${themeLabel}`, async ({ page }) => {
      test.setTimeout(210_000);
      const monitor = await attachErrorMonitor(page);
      await loginThroughUi(page, baseUrl, theme);
      const nav = page.getByRole('navigation', { name: 'Główna nawigacja' });

      // 1. Gantt
      await nav.getByRole('button', { name: 'Harmonogram Gantta', exact: true }).click();
      await expect(nav.getByRole('button', { name: 'Harmonogram Gantta', exact: true })).toHaveAttribute('aria-current', 'page');
      await scanView(page, scanResults, 'gantt', 'Harmonogram Gantta', theme);

      // 2. Lista zadań
      await nav.getByRole('button', { name: 'Zadania', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Zadanie referencyjne A11y' })).toBeVisible();
      await scanView(page, scanResults, 'tasks', 'Lista zadań', theme);

      // 3. Szczegóły zadania (TaskDetailDrawer)
      await page.getByRole('button', { name: 'Zadanie referencyjne A11y' }).click();
      const drawer = page.getByRole('dialog', { name: 'Zadanie referencyjne A11y' });
      await expect(drawer).toBeVisible();
      await scanView(page, scanResults, 'task-detail', 'Szczegóły zadania', theme);
      await drawer.getByRole('button', { name: 'Zamknij szczegóły zadania' }).click();
      await expect(drawer).toHaveCount(0);

      // 4. Okno zadania (TaskModal)
      await page.getByRole('button', { name: 'Nowe zadanie' }).first().click();
      const taskModal = page.getByRole('dialog', { name: 'Nowe Zadanie' });
      await expect(taskModal).toBeVisible();
      await scanView(page, scanResults, 'task-modal', 'Okno zadania', theme);
      await taskModal.getByRole('button', { name: 'Zamknij okno zadania' }).click();
      await expect(taskModal).toHaveCount(0);

      // 4b. Okno filtrowanych zadań (TaskFilterModal — zakładki Krytyczne i Zablokowane)
      await page.getByRole('button', { name: /\d+ krytycznych/i }).click();
      const taskFilterDialog = page.getByRole('dialog', { name: /Zadania o Priorytecie Krytycznym|Zadania Zablokowane/i });
      await expect(taskFilterDialog).toBeVisible();
      await scanView(page, scanResults, 'task-filter-critical', 'Filtrowane zadania: Krytyczne', theme);
      await taskFilterDialog.getByRole('tab', { name: /Zablokowane/i }).click();
      await expect(taskFilterDialog.getByRole('tab', { name: /Zablokowane/i })).toHaveAttribute('aria-selected', 'true');
      await scanView(page, scanResults, 'task-filter-blocked', 'Filtrowane zadania: Zablokowane', theme);
      await taskFilterDialog.getByRole('button', { name: 'Zamknij okno filtrowanych zadań' }).click();
      await expect(taskFilterDialog).toHaveCount(0);

      // 5. Kanban
      await nav.getByRole('button', { name: 'Tablica Kanban', exact: true }).click();
      await expect(nav.getByRole('button', { name: 'Tablica Kanban', exact: true })).toHaveAttribute('aria-current', 'page');
      await scanView(page, scanResults, 'kanban', 'Tablica Kanban', theme);

      // 5b. Drzewo zadań (+ okno przenoszenia zadania)
      await nav.getByRole('button', { name: 'Drzewo zadań', exact: true }).click();
      await expect(nav.getByRole('button', { name: 'Drzewo zadań', exact: true })).toHaveAttribute('aria-current', 'page');
      await expect(page.getByRole('heading', { name: 'Rozwijane Drzewo Zadań i Gałęzi' })).toBeVisible();
      await scanView(page, scanResults, 'tree', 'Drzewo zadań', theme);
      await page.getByRole('button', { name: /Przenieś zadanie/i }).first().click();
      const treeMoveDialog = page.getByRole('dialog', { name: /Przenieś zadanie/i });
      await expect(treeMoveDialog).toBeVisible();
      await scanView(page, scanResults, 'tree-move-modal', 'Drzewo zadań: Okno przenoszenia zadania', theme);
      await treeMoveDialog.getByRole('button', { name: 'Zamknij okno przenoszenia zadania' }).click();
      await expect(treeMoveDialog).toHaveCount(0);

      // 6. Przegląd projektów (widok kafelków, widok listy i wszystkie zakładki okna finansów)
      await nav.getByRole('button', { name: 'Projekty', exact: true }).click();
      await expect(nav.getByRole('button', { name: 'Projekty', exact: true })).toHaveAttribute('aria-current', 'page');
      await page.getByRole('button', { name: 'Kafelki', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Kafelki', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await scanView(page, scanResults, 'projects-tiles', 'Przegląd projektów (Kafelki)', theme);
      await page.getByRole('button', { name: 'Lista', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Lista', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('table')).toBeVisible();
      await scanView(page, scanResults, 'projects-list', 'Przegląd projektów (Lista)', theme);

      await page.getByRole('button', { name: /Kosztorys i wyceny projektu/i }).first().click();
      const financialsModal = page.getByRole('dialog', { name: 'Projekt Referencyjny A11y' });
      await expect(financialsModal).toBeVisible();

      // Zakładka 1: Wyceny i Oferty (+ otwarte formularze edycji transzy i wyceny)
      await scanView(page, scanResults, 'project-financials-quotations', 'Okno finansów: Wyceny i Oferty', theme);
      await financialsModal.getByRole('button', { name: /Edytuj transzę/i }).first().click();
      await expect(financialsModal.getByRole('button', { name: 'Zapisz wiersz' })).toBeVisible();
      await scanView(page, scanResults, 'project-financials-edit-tranche', 'Okno finansów: Edycja transzy', theme);
      await financialsModal.getByRole('button', { name: 'Anuluj', exact: true }).first().click();

      await financialsModal.getByRole('button', { name: /Edytuj wycenę/i }).first().click();
      await expect(financialsModal.getByRole('button', { name: 'Zapisz wiersz' })).toBeVisible();
      await scanView(page, scanResults, 'project-financials-edit-quote', 'Okno finansów: Edycja wyceny', theme);
      await financialsModal.getByRole('button', { name: 'Anuluj', exact: true }).first().click();

      // Zakładka 2: Lista kosztów i zadania (+ otwarty formularz edycji kosztu)
      await financialsModal.getByRole('tab', { name: /Lista kosztów i zadania/i }).click();
      await expect(financialsModal.getByRole('tab', { name: /Lista kosztów i zadania/i })).toHaveAttribute('aria-selected', 'true');
      await scanView(page, scanResults, 'project-financials-costs', 'Okno finansów: Koszty i zadania', theme);
      await financialsModal.getByRole('button', { name: /Edytuj koszt/i }).first().click();
      await expect(financialsModal.getByRole('button', { name: 'Zapisz wiersz' })).toBeVisible();
      await scanView(page, scanResults, 'project-financials-edit-cost', 'Okno finansów: Edycja kosztu', theme);
      await financialsModal.getByRole('button', { name: 'Anuluj', exact: true }).first().click();

      // Zakładka 3: Zamawiający, Dysk & Terminy
      await financialsModal.getByRole('tab', { name: /Zamawiający, Dysk & Terminy/i }).click();
      await expect(financialsModal.getByRole('tab', { name: /Zamawiający, Dysk & Terminy/i })).toHaveAttribute('aria-selected', 'true');
      await scanView(page, scanResults, 'project-financials-client', 'Okno finansów: Zamawiający, Dysk & Terminy', theme);

      // Zakładka 4: Podsumowanie
      await financialsModal.getByRole('tab', { name: /Podsumowanie/i }).click();
      await expect(financialsModal.getByRole('tab', { name: /Podsumowanie/i })).toHaveAttribute('aria-selected', 'true');
      await scanView(page, scanResults, 'project-financials-summary', 'Okno finansów: Podsumowanie', theme);

      await financialsModal.getByRole('button', { name: 'Zamknij finanse projektu' }).click();
      await expect(financialsModal).toHaveCount(0);

      await page.getByRole('button', { name: 'Kafelki', exact: true }).click();

      // 7. Ekonomia (lista i szczegóły projektu)
      await nav.getByRole('button', { name: 'Ekonomia', exact: true }).click();
      await expect(nav.getByRole('button', { name: 'Ekonomia', exact: true })).toHaveAttribute('aria-current', 'page');
      await expect(page.getByRole('heading', { name: 'Ekonomia i finanse firm' })).toBeVisible();
      await scanView(page, scanResults, 'economy', 'Ekonomia', theme);
      await page.getByRole('button', { name: 'Projekt Referencyjny A11y' }).click();
      await expect(page.getByRole('heading', { name: /Projekt Referencyjny A11y/ })).toBeVisible();
      await scanView(page, scanResults, 'economy-detail', 'Ekonomia: Szczegóły projektu', theme);
      await page.getByRole('button', { name: 'Powrót do listy' }).click();
      await expect(page.getByRole('heading', { name: 'Ekonomia i finanse firm' })).toBeVisible();

      // 7b. Przetargi (+ szczegóły, formularz i kopiowanie do projektu)
      await nav.getByRole('button', { name: 'Przetargi', exact: true }).click();
      await expect(nav.getByRole('button', { name: 'Przetargi', exact: true })).toHaveAttribute('aria-current', 'page');
      await expect(page.getByRole('button', { name: 'Przetarg Referencyjny A11y' })).toBeVisible();
      await scanView(page, scanResults, 'tenders', 'Przetargi', theme);

      await page.getByRole('button', { name: 'Przetarg Referencyjny A11y' }).click();
      const tenderDetailDialog = page.getByRole('dialog', { name: 'Przetarg Referencyjny A11y' });
      await expect(tenderDetailDialog).toBeVisible();
      await scanView(page, scanResults, 'tender-detail', 'Przetargi: Szczegóły przetargu', theme);

      await tenderDetailDialog.getByRole('button', { name: 'Kopiuj jako projekt' }).click();
      const tenderCopyDialog = page.getByRole('dialog', { name: 'Kopiuj przetarg jako projekt' });
      await expect(tenderCopyDialog).toBeVisible();
      await scanView(page, scanResults, 'tender-copy-modal', 'Przetargi: Kopiuj jako projekt', theme);
      await tenderCopyDialog.getByRole('button', { name: 'Anuluj' }).click();
      await expect(tenderCopyDialog).toHaveCount(0);

      await tenderDetailDialog.getByRole('button', { name: 'Edytuj' }).click();
      const tenderFormDialog = page.getByRole('dialog', { name: 'Edycja przetargu' });
      await expect(tenderFormDialog).toBeVisible();
      await scanView(page, scanResults, 'tender-form-modal', 'Przetargi: Formularz przetargu', theme);
      await tenderFormDialog.getByRole('button', { name: 'Anuluj' }).click();
      await expect(tenderFormDialog).toHaveCount(0);

      await tenderDetailDialog.getByRole('button', { name: 'Zamknij szczegóły przetargu' }).click();
      await expect(tenderDetailDialog).toHaveCount(0);

      // 8. Kosz
      await nav.getByRole('button', { name: 'Kosz', exact: true }).click();
      await expect(page.getByRole('heading', { name: /Kosz usuniętych zadań i projektów/i })).toBeVisible();
      await scanView(page, scanResults, 'trash', 'Kosz', theme);

      // 8. Każda zakładka Ustawień + Okno synchronizacji kalendarza
      await page.getByRole('button', { name: 'Ustawienia systemu' }).click();
      const settingsDialog = page.getByRole('dialog', { name: /Ustawienia Pracowni/i });
      await expect(settingsDialog).toBeVisible();

      for (const tabSpec of SETTINGS_TABS) {
        const escaped = tabSpec.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const tab = settingsDialog.getByRole('tab', { name: new RegExp(escaped, 'i') });
        await tab.click();
        await expect(tab).toHaveAttribute('aria-selected', 'true');
        await expect(settingsDialog.getByText('Ładowanie sekcji...')).toHaveCount(0);
        if (tabSpec.key === 'settings-notifications') {
          await expect(
            settingsDialog.getByRole('heading', { name: 'Podsumowanie tygodniowe', exact: true })
          ).toBeVisible();
        }
        if (tabSpec.key === 'settings-access') {
          await expect(
            settingsDialog.getByRole('heading', { name: 'Stan serwera i zajętość dysku', exact: true })
          ).toBeVisible();
        }
        if (tabSpec.key === 'settings-templates') {
          await expect(settingsDialog.getByText('Ładowanie szablonów...')).toHaveCount(0);
          await expect(settingsDialog.getByRole('button', { name: 'Utwórz z projektu' })).toBeVisible();
        }
        await scanView(page, scanResults, tabSpec.key, `Ustawienia: ${tabSpec.name}`, theme);

        if (tabSpec.key === 'settings-templates') {
          await settingsDialog.getByRole('button', { name: 'Duplikuj', exact: true }).first().click();
          const editBtn = settingsDialog.getByRole('button', { name: 'Edytuj', exact: true }).first();
          await expect(editBtn).toBeVisible();
          await editBtn.click();

          const templateEditorDialog = page.getByRole('dialog', { name: /Edytor szablonu:/i });
          await expect(templateEditorDialog).toBeVisible();
          await scanView(page, scanResults, 'template-editor-modal', 'Ustawienia: Edytor szablonu projektu', theme);
          await templateEditorDialog.getByRole('button', { name: 'Zamknij edytor szablonu' }).click();
          await expect(templateEditorDialog).toHaveCount(0);

          await settingsDialog.getByRole('button', { name: 'Usuń', exact: true }).first().click();
          await settingsDialog.getByRole('button', { name: 'Potwierdź usunięcie', exact: true }).click();
          await expect(settingsDialog.getByRole('button', { name: 'Edytuj', exact: true })).toHaveCount(0);
        }
      }

      // 9. Okno synchronizacji kalendarza (otwierane z aktywnej zakładki Kalendarz Google automatycznie zamyka Ustawienia)
      await settingsDialog.getByRole('button', { name: 'Konfiguracja subskrypcji iCal i tokenu' }).click();
      await expect(settingsDialog).toHaveCount(0);
      const calendarDialog = page.getByRole('dialog', { name: /Prywatna synchronizacja z kalendarzami/i });
      await expect(calendarDialog).toBeVisible();
      await scanView(page, scanResults, 'calendar-sync-modal', 'Okno synchronizacji kalendarza', theme);
      await calendarDialog.getByRole('button', { name: 'Zamknij okno synchronizacji z Kalendarzem Google' }).click();
      await expect(calendarDialog).toHaveCount(0);

      // 9b. Centrum Archiwizacji & Automatycznych Kopii Zapasowych (ArchiveBackupModal — wszystkie 5 zakładek)
      await page.getByRole('button', { name: 'Ustawienia systemu' }).click();
      const settingsDialogArchive = page.getByRole('dialog', { name: /Ustawienia Pracowni/i });
      await expect(settingsDialogArchive).toBeVisible();
      await settingsDialogArchive.getByRole('tab', { name: /Kopie Zapasowe/i }).click();
      await settingsDialogArchive.getByRole('button', { name: /Otwórz pełny moduł archiwizacji/i }).click();
      await expect(settingsDialogArchive).toHaveCount(0);

      const archiveDialog = page.getByRole('dialog', { name: /Centrum Archiwizacji/i });
      await expect(archiveDialog).toBeVisible();
      for (const tabSpec of ARCHIVE_TABS) {
        const escaped = tabSpec.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const tab = archiveDialog.getByRole('tab', { name: new RegExp(escaped, 'i') });
        await tab.click();
        await expect(tab).toHaveAttribute('aria-selected', 'true');
        await scanView(page, scanResults, tabSpec.key, `Archiwizacja: ${tabSpec.name}`, theme);
      }
      await archiveDialog.getByRole('button', { name: 'Zamknij centrum archiwizacji' }).click();
      await expect(archiveDialog).toHaveCount(0);

      // 10. Okno konta użytkownika — zakładka Zaufane urządzenia
      await page.getByRole('button', { name: new RegExp(`Konto użytkownika: ${ADMIN_NAME}`, 'i') }).click();
      const accountDialog = page.getByRole('dialog', { name: /Uwierzytelnianie/i });
      await expect(accountDialog).toBeVisible();
      const devicesTab = accountDialog.getByRole('tab', { name: /Zaufane urządzenia/i });
      await devicesTab.click();
      await expect(devicesTab).toHaveAttribute('aria-selected', 'true');
      await expect(accountDialog.getByText('Ładowanie zaufanych urządzeń...')).toHaveCount(0);
      await expect(accountDialog.getByRole('columnheader', { name: 'Urządzenie' })).toBeVisible();
      await scanView(page, scanResults, 'account-trusted-devices', 'Konto: Zaufane urządzenia', theme);
      await accountDialog.getByRole('button', { name: 'Zamknij okno uwierzytelniania' }).click();
      await expect(accountDialog).toHaveCount(0);

      await monitor.assertClean();
    });
  }

  test('3) zapis raportu JSON, bezwzględna kontrola kontrastu oraz tryb A11Y_STRICT', async () => {
    expect(scanResults.length).toBeGreaterThanOrEqual(80);
    writeReport(scanResults);
    expect(fs.existsSync(REPORT_PATH)).toBe(true);

    const contrastViolations = scanResults.flatMap((entry) =>
      entry.violations
        .filter((v) => v.id === 'color-contrast')
        .map(
          (v) =>
            `[${entry.theme}][${entry.view}] color-contrast (węzłów: ${v.nodesCount}): ${v.nodes
              .map((n) => n.target.join(' '))
              .join(' | ')}`
        )
    );

    expect(
      contrastViolations,
      `Wykryto naruszenia kontrastu WCAG AA (color-contrast):\n${contrastViolations.join('\n')}`
    ).toEqual([]);

    const strict = process.env.A11Y_STRICT === 'true';
    const seriousOrCritical = scanResults.flatMap((entry) =>
      entry.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `[${entry.theme}][${entry.view}] ${v.id} (${v.impact}, węzłów: ${v.nodesCount}): ${v.help}`)
    );

    if (strict) {
      expect(
        seriousOrCritical,
        `Tryb A11Y_STRICT=true wykrył naruszenia serious/critical:\n${seriousOrCritical.join('\n')}`
      ).toEqual([]);
    } else if (seriousOrCritical.length > 0) {
      console.log(
        `[a11y] Tryb raportowy (A11Y_STRICT=${process.env.A11Y_STRICT || 'false'}): znaleziono ${seriousOrCritical.length} naruszeń serious/critical zapisanych do ${REPORT_PATH}.`
      );
    }
  });
});
