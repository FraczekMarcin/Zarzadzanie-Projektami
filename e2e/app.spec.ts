import { test, expect, Page } from '@playwright/test';
import { calculateTotpForStep } from '../src/utils/totp';

const ADMIN_NAME = 'Marek Nowak';
const ADMIN_EMAIL = 'admin.biuro@example.pl';
const ADMIN_DEPT = 'Architektura';
const ADMIN_PASS = 'Katedra-Projekt-2026!';

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

  page.on('response', (res) => {
    if (res.status() >= 400) {
      console.log(`[E2E HTTP ${res.status()}] ${res.request().method()} ${res.url()}`);
    }
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

async function loginThroughUi(page: Page, secondFactorCode?: string): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Zaloguj do pracowni' })).toBeVisible();
  await page.getByLabel(/Adres e-mail/i).fill(ADMIN_EMAIL);
  await page.getByLabel(/Hasło dostępu/i).fill(ADMIN_PASS);
  await page.getByRole('button', { name: 'Zaloguj do pracowni' }).click();

  if (secondFactorCode) {
    const codeInput = page.getByLabel(/Kod z aplikacji Google Authenticator/i);
    await expect(codeInput).toBeVisible();
    await codeInput.fill(secondFactorCode);
    await page.getByRole('button', { name: 'Zweryfikuj kod i zaloguj' }).click();
  }

  await expect(page.getByRole('button', { name: 'Wyloguj się z systemu' })).toBeVisible();
}

test.describe.serial('Testy end-to-end aplikacji Zarządzanie Projektami', () => {
  let totpSecret = '';
  let lastUsedTotpStep = -1;
  let backupCodeForSecondContext = '';
  let backupCodeForTrashTest = '';

  function computeNextTotp(secret: string): string {
    const nowStep = Math.floor(Date.now() / 1000 / 30);
    // verifyTotpStrict akceptuje wyłącznie kroki w oknie [nowStep - 1, nowStep + 1] i większe od lastUsedTotpStep
    const candidateStep = Math.max(nowStep - 1, lastUsedTotpStep + 1);
    if (candidateStep > nowStep + 1) {
      throw new Error('Przekroczono limit kroków TOTP w bieżącym oknie 30s');
    }
    lastUsedTotpStep = candidateStep;
    return calculateTotpForStep(secret, candidateStep);
  }

  test('a) konfiguracja pierwszego administratora (setup wizard) i logowanie bez błędów konsoli ani CSP', async ({ page }) => {
    const monitor = await attachErrorMonitor(page);

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Kreator Konfiguracji Administratora' })).toBeVisible();

    await page.getByLabel(/Imię i Nazwisko Administratora/i).fill(ADMIN_NAME);
    await page.getByLabel(/Adres e-mail/i).fill(ADMIN_EMAIL);
    await page.getByLabel(/Dział \/ Rola w Pracowni/i).fill(ADMIN_DEPT);
    await page.getByLabel(/Hasło Administratora/i).fill(ADMIN_PASS);
    await page.getByLabel(/Powtórz hasło/i).fill(ADMIN_PASS);

    const setupResponsePromise = page.waitForResponse(
      (res) => res.url().includes('/api/auth/setup-admin') && res.request().method() === 'POST'
    );
    await page.getByRole('button', { name: 'Utwórz konto Administratora i przejdź do systemu' }).click();
    const setupResponse = await setupResponsePromise;
    expect(setupResponse.status()).toBe(200);

    await expect(page.getByRole('button', { name: 'Wyloguj się z systemu' })).toBeVisible();

    // Weryfikacja standardowego logowania hasłem po wylogowaniu
    await page.getByRole('button', { name: 'Wyloguj się z systemu' }).click();
    await expect(page.getByRole('button', { name: 'Zaloguj do pracowni' })).toBeVisible();

    await page.getByLabel(/Adres e-mail/i).fill(ADMIN_EMAIL);
    await page.getByLabel(/Hasło dostępu/i).fill(ADMIN_PASS);
    await page.getByRole('button', { name: 'Zaloguj do pracowni' }).click();
    await expect(page.getByRole('button', { name: 'Wyloguj się z systemu' })).toBeVisible();

    await monitor.assertClean();
  });

  test('b) utworzenie projektu i zadania, edycja tytułu, przeniesienie w Kanbanie i trwałość po przeładowaniu', async ({ page }) => {
    const monitor = await attachErrorMonitor(page);
    await loginThroughUi(page);

    // Utworzenie projektu
    await page.getByRole('button', { name: 'Projekty', exact: true }).click();
    await page.getByRole('button', { name: 'Zarejestruj nowy projekt' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByLabel(/Nazwa projektu/i).fill('Osiedle Parkowe E2E');
    await page.getByLabel(/Opis projektu/i).fill('Projekt weryfikacyjny Playwright');

    const createProjectPromise = page.waitForResponse(
      (res) => res.url().includes('/api/projects') && res.request().method() === 'POST'
    );
    await page.getByRole('button', { name: 'Zarejestruj projekt' }).click();
    const createProjectRes = await createProjectPromise;
    expect(createProjectRes.status()).toBe(201);

    // Przejście do Kanbana i utworzenie zadania
    await page.getByRole('button', { name: 'Tablica Kanban' }).click();
    await page.getByRole('button', { name: 'Nowe zadanie' }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByLabel(/Tytuł zadania/i).fill('Projekt koncepcyjny E2E');
    const createTaskPromise = page.waitForResponse(
      (res) => res.url().includes('/api/tasks') && res.request().method() === 'POST'
    );
    await page.getByRole('button', { name: 'Utwórz zadanie' }).click();
    const createTaskRes = await createTaskPromise;
    expect(createTaskRes.status()).toBe(201);

    const createdCard = page.getByRole('button', { name: /Zadanie .*: Projekt koncepcyjny E2E/i });
    await expect(createdCard).toBeVisible();

    // Edycja tytułu zadania
    await createdCard.click();
    await page.getByRole('button', { name: 'Edytuj', exact: true }).click();
    await page.getByLabel(/Tytuł zadania/i).fill('Projekt budowlany E2E');

    const patchTitlePromise = page.waitForResponse(
      (res) => res.url().includes('/api/tasks/') && res.request().method() === 'PATCH' && res.status() === 200
    );
    await page.getByRole('button', { name: 'Zapisz zmiany' }).click();
    await patchTitlePromise;

    const renamedCard = page.getByRole('button', { name: /Zadanie .*: Projekt budowlany E2E/i });
    await expect(renamedCard).toBeVisible();

    // Przeniesienie zadania w Kanbanie przez menu „Przenieś do…”
    await renamedCard.hover();
    await renamedCard.getByRole('button', { name: /Przenieś do/i }).click();

    const patchStatusPromise = page.waitForResponse(
      (res) => res.url().includes('/api/tasks/') && res.request().method() === 'PATCH' && res.status() === 200
    );
    await page.getByRole('menuitem', { name: 'W toku' }).click();
    await patchStatusPromise;

    const inProgressColumn = page.locator('section', {
      has: page.getByRole('heading', { name: 'W toku' }),
    });
    await expect(inProgressColumn.getByRole('button', { name: /Projekt budowlany E2E/i })).toBeVisible();

    // Przeładowanie strony i weryfikacja trwałości
    await page.reload();
    await expect(page.getByRole('button', { name: 'Wyloguj się z systemu' })).toBeVisible();
    await page.getByRole('button', { name: 'Tablica Kanban' }).click();
    await expect(inProgressColumn.getByRole('button', { name: /Projekt budowlany E2E/i })).toBeVisible();

    await monitor.assertClean();
  });

  test('c) otwarcie wszystkich zakładek Ustawień bez błędów oraz weryfikacja zablokowanego przycisku 1-Click dla localhost', async ({ page }) => {
    const monitor = await attachErrorMonitor(page);
    await loginThroughUi(page);

    await page.getByRole('button', { name: 'Ustawienia systemu' }).click();
    const settingsDialog = page.getByRole('dialog');
    await expect(settingsDialog).toBeVisible();

    const tabNames = [
      'Wygląd & Motyw',
      'Zmienne & Terminy',
      'Użytkownicy & Zgody',
      'Dziennik bezpieczeństwa',
      'Aktualizacje',
      'Wdrożenie Docker',
      'Kopie Zapasowe',
      'Kalendarz Google',
    ];

    for (const tabName of tabNames) {
      const tab = settingsDialog.getByRole('tab', { name: new RegExp(tabName, 'i') });
      await tab.click();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
    }

    // Otwarcie modalu synchronizacji kalendarza i sprawdzenie zablokowanego przycisku 1-Click
    await settingsDialog.getByRole('button', { name: 'Konfiguracja subskrypcji iCal i tokenu' }).click();
    const calendarDialog = page.getByRole('dialog', { name: /Prywatna synchronizacja z kalendarzami/i });
    await expect(calendarDialog).toBeVisible();

    await calendarDialog.getByRole('button', { name: /Wygeneruj prywatny link subskrypcji/i }).click();
    await expect(calendarDialog.getByText('Adres niedostępny z internetu')).toBeVisible();

    const googleOneClickBtn = calendarDialog.getByRole('button', { name: 'Dodaj do Kalendarza Google' });
    await expect(googleOneClickBtn).toBeDisabled();
    await expect(googleOneClickBtn).toHaveAttribute('aria-disabled', 'true');

    await monitor.assertClean();
  });

  test('d) wylogowanie usuwa dane projektów i zadań z localStorage oraz przenosi na ekran logowania', async ({ page }) => {
    const monitor = await attachErrorMonitor(page);
    await loginThroughUi(page);

    // Upewnij się, że istnieją zapisy w localStorage przed wylogowaniem
    const hasAuthFlagBefore = await page.evaluate(() => localStorage.getItem('oph_is_authenticated'));
    expect(hasAuthFlagBefore).toBe('true');

    await page.getByRole('button', { name: 'Wyloguj się z systemu' }).click();
    await expect(page.getByRole('heading', { name: 'Pracownia Projektowa' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Logowanie', selected: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Zaloguj do pracowni' })).toBeVisible();

    const storageDump = await page.evaluate(() => {
      const entries: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
          entries[key] = localStorage.getItem(key) || '';
        }
      }
      return entries;
    });

    const nonThemeOphKeys = Object.keys(storageDump).filter(
      (k) => k.startsWith('oph_') && k !== 'oph_theme_mode'
    );
    expect(nonThemeOphKeys).toEqual([]);

    const serializedValues = Object.values(storageDump).join('\n');
    expect(serializedValues).not.toContain('Osiedle Parkowe E2E');
    expect(serializedValues).not.toContain('Projekt budowlany E2E');

    await monitor.assertClean();
  });

  test('e) włączenie uwierzytelniania 2FA dla administratora i ponowne logowanie kodem TOTP', async ({ page }) => {
    const monitor = await attachErrorMonitor(page);
    await loginThroughUi(page);

    await page.getByRole('button', { name: new RegExp(`Konto użytkownika: ${ADMIN_NAME}`, 'i') }).click();
    const accountDialog = page.getByRole('dialog');
    await expect(accountDialog).toBeVisible();

    await accountDialog.getByRole('tab', { name: /Weryfikacja 2FA/i }).click();
    await accountDialog.getByRole('button', { name: 'Włącz 2FA' }).click();

    await accountDialog.getByLabel(/Aktualne hasło do konta/i).fill(ADMIN_PASS);
    await accountDialog.getByRole('button', { name: 'Dalej: Wygeneruj kod QR' }).click();

    const secretEl = accountDialog.getByLabel('Klucz konfiguracyjny 2FA');
    await expect(secretEl).toBeVisible();
    const rawSecretText = await secretEl.innerText();
    totpSecret = rawSecretText.replace(/\s+/g, '');
    expect(totpSecret.length).toBeGreaterThanOrEqual(16);

    const activationTotp = computeNextTotp(totpSecret);
    await accountDialog.getByLabel(/Wprowadź 6-cyfrowy kod z aplikacji/i).fill(activationTotp);
    await accountDialog.getByRole('button', { name: 'Zatwierdź i włącz 2FA' }).click();

    await expect(
      accountDialog.getByText('Uwierzytelnianie dwuskładnikowe 2FA zostało pomyślnie włączone!')
    ).toBeVisible();

    const firstBackupCodeEl = accountDialog.getByText(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/).first();
    await expect(firstBackupCodeEl).toBeVisible();
    backupCodeForSecondContext = (await firstBackupCodeEl.innerText()).trim();
    const secondBackupCodeEl = accountDialog.getByText(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/).nth(1);
    backupCodeForTrashTest = (await secondBackupCodeEl.innerText()).trim();

    await accountDialog.getByRole('button', { name: 'Zakończ i zamknij' }).click();
    await accountDialog.getByRole('button', { name: 'Zamknij okno uwierzytelniania' }).click();

    // Wylogowanie i ponowne logowanie z kodem TOTP
    await page.getByRole('button', { name: 'Wyloguj się z systemu' }).click();
    await expect(page.getByRole('button', { name: 'Zaloguj do pracowni' })).toBeVisible();

    const loginTotp = computeNextTotp(totpSecret);
    await loginThroughUi(page, loginTotp);

    await monitor.assertClean();
  });

  test('f) dwa konteksty przeglądarki – zmiana zadania w jednym jest widoczna w drugim w ciągu 3 sekund', async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();

      const monitorA = await attachErrorMonitor(pageA);
      const monitorB = await attachErrorMonitor(pageB);

      const totpA = computeNextTotp(totpSecret);
      await loginThroughUi(pageA, totpA);
      await loginThroughUi(pageB, backupCodeForSecondContext);

      await pageA.getByRole('button', { name: 'Tablica Kanban' }).click();
      await pageB.getByRole('button', { name: 'Tablica Kanban' }).click();

      const taskCardA = pageA.getByRole('button', { name: /Zadanie .*: Projekt budowlany E2E/i });
      const taskCardB = pageB.getByRole('button', { name: /Zadanie .*: Projekt budowlany E2E/i });
      await expect(taskCardA).toBeVisible();
      await expect(taskCardB).toBeVisible();

      // Poczekaj na otwarcie strumienia SSE w drugim kontekście przed edycją
      await pageB.waitForTimeout(300);

      // Edycja zadania w kontekście A
      await taskCardA.click();
      await pageA.getByRole('button', { name: 'Edytuj', exact: true }).click();
      await pageA.getByLabel(/Tytuł zadania/i).fill('Projekt wykonawczy E2E');

      const patchPromise = pageA.waitForResponse(
        (res) => res.url().includes('/api/tasks/') && res.request().method() === 'PATCH' && res.status() === 200
      );
      await pageA.getByRole('button', { name: 'Zapisz zmiany' }).click();
      await patchPromise;

      // Weryfikacja aktualizacji w kontekście B w ciągu 3 sekund
      await expect(
        pageB.getByRole('button', { name: /Zadanie .*: Projekt wykonawczy E2E/i })
      ).toBeVisible({ timeout: 3000 });

      await monitorA.assertClean();
      await monitorB.assertClean();
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test('g) usunięcie zadania przenosi je do kosza, toast „Cofnij” przywraca je natychmiast i otwarcie widoku Kosz przebiega czysto', async ({ page }) => {
    const monitor = await attachErrorMonitor(page);
    await loginThroughUi(page, backupCodeForTrashTest);

    await page.getByRole('button', { name: 'Zadania', exact: true }).click();
    const taskLink = page.getByRole('button', { name: 'Projekt wykonawczy E2E' });
    await expect(taskLink).toBeVisible();

    const taskRow = page.locator('tr', { has: taskLink });
    await taskRow.getByRole('button', { name: /^Usuń zadanie /i }).click();

    const deleteDialog = page.getByRole('dialog', { name: /Usuń zadanie/i });
    await expect(deleteDialog).toBeVisible();
    await expect(deleteDialog).toContainText(/Element trafi do kosza/i);

    const deletePromise = page.waitForResponse(
      (res) => res.url().includes('/api/tasks/') && res.request().method() === 'DELETE' && res.status() === 200
    );
    await deleteDialog.getByRole('button', { name: 'Tak, przenieś do kosza' }).click();
    await deletePromise;

    await expect(taskLink).toHaveCount(0);

    const undoToast = page.getByRole('status').filter({ hasText: 'Przeniesiono do kosza' });
    await expect(undoToast).toBeVisible();
    const restorePromise = page.waitForResponse(
      (res) => res.url().includes('/api/trash/') && res.url().includes('/restore') && res.request().method() === 'POST' && res.status() === 200
    );
    await undoToast.getByRole('button', { name: 'Cofnij' }).click();
    await restorePromise;

    await expect(page.getByRole('button', { name: 'Projekt wykonawczy E2E' })).toBeVisible();

    // Weryfikacja trwałości przywrócenia po przeładowaniu
    await page.reload();
    await expect(page.getByRole('button', { name: 'Wyloguj się z systemu' })).toBeVisible();
    await page.getByRole('button', { name: 'Zadania', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Projekt wykonawczy E2E' })).toBeVisible();

    // Otwarcie widoku Kosz z nawigacji
    await page.getByRole('navigation', { name: 'Główna nawigacja' }).getByRole('button', { name: 'Kosz', exact: true }).click();
    await expect(page.getByRole('heading', { name: /Kosz usuniętych zadań i projektów/i })).toBeVisible();
    await expect(page.getByText('Kosz jest pusty')).toBeVisible();

    await monitor.assertClean();
  });
});
