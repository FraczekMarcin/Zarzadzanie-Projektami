import {
  PersistedReminderState,
  UserDigest,
  buildDigests,
  computeNextScheduledAt,
  escapeHtml,
  localDateString,
  renderDigestEmail,
  shouldRunNow,
} from '../utils/reminders.js';
import { isValidEmail } from '../utils/settingsSchema.js';
import { logger } from './logger.js';
import { MailerService, formatSmtpErrorPolish } from './mailer.js';
import type { SettingsService } from './settings.js';
import type { StateStore } from './state.js';

export const REMINDER_CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10 minut
export const REMINDER_DEFAULT_SEND_DELAY_MS = 1000; // 1 sekunda między kolejnymi e-mailami

export interface ReminderStatusPayload {
  enabled: boolean;
  lastRunDate: string | null;
  lastRunAt: string | null;
  sentCount: number;
  skippedCount: number;
  errorCount: number;
  lastError: string | null;
  nextScheduledAt: string | null;
  smtpConfigured: boolean;
}

export interface ReminderRunResult {
  executed: boolean;
  alreadyRanToday: boolean;
  smtpConfigured: boolean;
  date: string;
  sentCount: number;
  skippedCount: number;
  errorCount: number;
  lastError: string | null;
}

export interface ReminderPreviewResult {
  to: string;
  taskCount: number;
  date: string;
}

export interface ReminderService {
  start: () => Promise<void>;
  stop: () => void;
  getStatus: () => ReminderStatusPayload;
  tick: () => Promise<ReminderRunResult | null>;
  runNow: (options?: { force?: boolean }) => Promise<ReminderRunResult>;
  sendPreview: (caller: { id: string; name?: string; email?: string; role?: string }) => Promise<ReminderPreviewResult>;
}

function defaultDelay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getOrInitReminderState(appState: any): PersistedReminderState {
  const existing =
    appState && appState.reminderState && typeof appState.reminderState === 'object'
      ? appState.reminderState
      : {};

  return {
    lastRunDate: typeof existing.lastRunDate === 'string' ? existing.lastRunDate : null,
    lastRunAt: typeof existing.lastRunAt === 'string' ? existing.lastRunAt : null,
    sentCount: typeof existing.sentCount === 'number' ? existing.sentCount : 0,
    skippedCount: typeof existing.skippedCount === 'number' ? existing.skippedCount : 0,
    errorCount: typeof existing.errorCount === 'number' ? existing.errorCount : 0,
    lastError: typeof existing.lastError === 'string' ? existing.lastError : null,
    sentUserIdsDate:
      typeof existing.sentUserIdsDate === 'string' ? existing.sentUserIdsDate : null,
    sentUserIdsToday: Array.isArray(existing.sentUserIdsToday)
      ? existing.sentUserIdsToday.filter((id: unknown): id is string => typeof id === 'string')
      : [],
  };
}

export function createReminderService(deps: {
  stateStore: StateStore;
  settingsService: SettingsService;
  mailer: MailerService;
  disableTimers?: boolean;
  now?: () => number;
  delayFn?: (ms: number) => Promise<void>;
  sendDelayMs?: number;
  onTick?: () => Promise<void>;
}): ReminderService {
  const {
    stateStore,
    settingsService,
    mailer,
    disableTimers = false,
    onTick,
  } = deps;
  const now = deps.now ?? (() => Date.now());
  const delayFn = deps.delayFn ?? defaultDelay;
  const sendDelayMs =
    typeof deps.sendDelayMs === 'number' && deps.sendDelayMs >= 0
      ? deps.sendDelayMs
      : REMINDER_DEFAULT_SEND_DELAY_MS;

  let intervalTimer: NodeJS.Timeout | null = null;
  let stopped = false;
  let activeRunPromise: Promise<ReminderRunResult> | null = null;
  let lastMissingSmtpLoggedDate: string | null = null;

  async function persistReminderState(nextState: PersistedReminderState): Promise<void> {
    const appState = stateStore.ensureStateStructure();
    appState.reminderState = { ...nextState };
    stateStore.setAppState(appState);
    await stateStore.saveStateAtomicAsync();
  }

  function getStatus(): ReminderStatusPayload {
    const appState = stateStore.ensureStateStructure();
    const persisted = getOrInitReminderState(appState);
    const settings = settingsService.getEffectiveReminderSettings();
    const currentMs = now();

    return {
      enabled: settings.enabled,
      lastRunDate: persisted.lastRunDate,
      lastRunAt: persisted.lastRunAt,
      sentCount: persisted.sentCount,
      skippedCount: persisted.skippedCount,
      errorCount: persisted.errorCount,
      lastError: persisted.lastError,
      nextScheduledAt: computeNextScheduledAt(currentMs, settings, persisted.lastRunDate),
      smtpConfigured: mailer.isMailConfigured(),
    };
  }

  async function executeRun(options: { force: boolean; isManual: boolean }): Promise<ReminderRunResult> {
    if (activeRunPromise) {
      return await activeRunPromise;
    }

    const runPromise = (async (): Promise<ReminderRunResult> => {
      const currentMs = now();
      const currentIso = new Date(currentMs).toISOString();
      const settings = settingsService.getEffectiveReminderSettings();
      const todayStr = localDateString(currentMs, settings.timezone);
      const appState = stateStore.ensureStateStructure();
      const persisted = getOrInitReminderState(appState);

      if (persisted.sentUserIdsDate !== todayStr) {
        persisted.sentUserIdsDate = todayStr;
        persisted.sentUserIdsToday = [];
      }

      if (!options.force && !options.isManual && !shouldRunNow(currentMs, settings, persisted.lastRunDate)) {
        return {
          executed: false,
          alreadyRanToday: persisted.lastRunDate === todayStr,
          smtpConfigured: mailer.isMailConfigured(),
          date: todayStr,
          sentCount: 0,
          skippedCount: 0,
          errorCount: 0,
          lastError: persisted.lastError,
        };
      }

      if (!mailer.isMailConfigured()) {
        const msg = 'Serwer SMTP nie jest skonfigurowany — nie wysłano przypomnień.';
        persisted.lastRunAt = currentIso;
        persisted.sentCount = 0;
        persisted.skippedCount = 0;
        persisted.errorCount = 1;
        persisted.lastError = msg;
        await persistReminderState(persisted);

        if (options.isManual || lastMissingSmtpLoggedDate !== todayStr) {
          lastMissingSmtpLoggedDate = todayStr;
          await stateStore.securityLogger
            .record('reminders_failed', {
              details: { sentCount: 0, skippedCount: 0, errorCount: 1, reason: 'smtp_not_configured' },
            })
            .catch(() => {});
          logger.warn('[Reminders] Pominięto wysyłkę przypomnień: serwer SMTP nie jest skonfigurowany.');
        }

        return {
          executed: false,
          alreadyRanToday: false,
          smtpConfigured: false,
          date: todayStr,
          sentCount: 0,
          skippedCount: 0,
          errorCount: 1,
          lastError: msg,
        };
      }

      const alreadyRanToday = !options.force && persisted.lastRunDate === todayStr;

      const users = Array.isArray(appState.users) ? appState.users : [];
      const tasks = Array.isArray(appState.tasks) ? appState.tasks : [];
      const projects = Array.isArray(appState.projects) ? appState.projects : [];

      const activeUsersWithEmail = users.filter(
        (u: any) =>
          u &&
          u.id &&
          u.isApproved !== false &&
          typeof u.email === 'string' &&
          isValidEmail(u.email)
      );

      const digests: UserDigest[] = buildDigests(
        tasks,
        projects,
        users,
        currentMs,
        settings,
        appState.variables?.projectStatuses
      );
      const digestUserIds = new Set(digests.map((d) => d.user.id));

      // Liczba pominiętych obejmuje aktywnych użytkowników bez zadań w oknie lub z wyłączonymi przypomnieniami
      let skippedCount = activeUsersWithEmail.filter((u: any) => !digestUserIds.has(u.id)).length;
      const alreadySentSet = new Set(persisted.sentUserIdsToday);
      const smtpPassword = settingsService.getRuntimeSmtpConfig().password;

      let sentCount = 0;
      let errorCount = 0;
      let lastError: string | null = null;
      let attemptIndex = 0;

      for (const digest of digests) {
        if (!options.force && alreadySentSet.has(digest.user.id)) {
          skippedCount += 1;
          continue;
        }

        if (attemptIndex > 0) {
          await delayFn(sendDelayMs);
        }
        attemptIndex += 1;

        const rendered = renderDigestEmail(digest, settings.appBaseUrl);

        try {
          await mailer.sendMail({
            to: digest.user.email,
            subject: rendered.subject,
            text: rendered.text,
            html: rendered.html,
          });
          sentCount += 1;
          if (!alreadySentSet.has(digest.user.id)) {
            alreadySentSet.add(digest.user.id);
            persisted.sentUserIdsToday.push(digest.user.id);
          }
          // Zapisuj stan po każdym wysłanym odbiorcy dla odporności na restart/awarię w trakcie pętli
          await persistReminderState(persisted);
        } catch (err: any) {
          errorCount += 1;
          lastError = formatSmtpErrorPolish(err, smtpPassword);
          logger.warn(
            `[Reminders] Nie udało się wysłać przypomnienia dla użytkownika (${digest.user.id}): ${lastError}`
          );
        }
      }

      persisted.lastRunDate = todayStr;
      persisted.lastRunAt = currentIso;
      persisted.sentCount = sentCount;
      persisted.skippedCount = skippedCount;
      persisted.errorCount = errorCount;
      persisted.lastError = lastError;
      await persistReminderState(persisted);

      const logDetails = { sentCount, skippedCount, errorCount };
      if (sentCount > 0 || errorCount === 0) {
        await stateStore.securityLogger
          .record('reminders_sent', { details: logDetails })
          .catch(() => {});
      }
      if (errorCount > 0) {
        await stateStore.securityLogger
          .record('reminders_failed', { details: logDetails })
          .catch(() => {});
      }

      logger.info(
        `[Reminders] Zakończono przebieg przypomnień (${todayStr}): wysłano=${sentCount}, pominięto=${skippedCount}, błędy=${errorCount}.`
      );

      return {
        executed: true,
        alreadyRanToday,
        smtpConfigured: true,
        date: todayStr,
        sentCount,
        skippedCount,
        errorCount,
        lastError,
      };
    })();

    activeRunPromise = runPromise;
    try {
      return await runPromise;
    } finally {
      if (activeRunPromise === runPromise) {
        activeRunPromise = null;
      }
    }
  }

  async function tick(): Promise<ReminderRunResult | null> {
    if (stopped) return null;
    const settings = settingsService.getEffectiveReminderSettings();
    const appState = stateStore.ensureStateStructure();
    const persisted = getOrInitReminderState(appState);
    if (!shouldRunNow(now(), settings, persisted.lastRunDate)) {
      return null;
    }
    return await executeRun({ force: false, isManual: false });
  }

  async function runNow(options: { force?: boolean } = {}): Promise<ReminderRunResult> {
    return await executeRun({
      force: Boolean(options.force),
      isManual: true,
    });
  }

  async function sendPreview(caller: {
    id: string;
    name?: string;
    email?: string;
    role?: string;
  }): Promise<ReminderPreviewResult> {
    if (!mailer.isMailConfigured()) {
      throw new Error('Serwer SMTP nie jest skonfigurowany. Uzupełnij i zapisz ustawienia SMTP.');
    }
    const cleanEmail = typeof caller.email === 'string' ? caller.email.trim() : '';
    if (!cleanEmail || !isValidEmail(cleanEmail)) {
      throw new Error('Twoje konto nie ma przypisanego prawidłowego adresu e-mail.');
    }

    const currentMs = now();
    const settings = settingsService.getEffectiveReminderSettings();
    const appState = stateStore.ensureStateStructure();
    const tasks = Array.isArray(appState.tasks) ? appState.tasks : [];
    const projects = Array.isArray(appState.projects) ? appState.projects : [];
    const todayStr = localDateString(currentMs, settings.timezone);

    const previewUser = {
      id: caller.id,
      name: caller.name || cleanEmail,
      email: cleanEmail,
      role: (caller.role || 'admin') as any,
      department: '',
      initials: '',
      isApproved: true,
      emailReminders: true,
    };

    const digests = buildDigests(
      tasks,
      projects,
      [previewUser],
      currentMs,
      settings,
      appState.variables?.projectStatuses
    );
    if (digests.length > 0) {
      const digest = digests[0];
      const rendered = renderDigestEmail(digest, settings.appBaseUrl);
      await mailer.sendMail({
        to: cleanEmail,
        subject: `[PODGLĄD] ${rendered.subject}`,
        text: rendered.text,
        html: rendered.html,
      });
      return {
        to: cleanEmail,
        taskCount: digest.totalTasks,
        date: digest.date,
      };
    }

    const safeName = previewUser.name;
    const emptySubject = `[PODGLĄD] Przypomnienie o terminach zadań (0) — ${todayStr}`;
    const emptyText = [
      `Dzień dobry, ${safeName}!`,
      '',
      `To jest podgląd wiadomości dziennego przypomnienia (stan na ${todayStr}, strefa ${settings.timezone}).`,
      'Obecnie nie masz przypisanych żadnych otwartych zadań spełniających wybrane kryteria terminów.',
      '',
      '---',
      'Aby wyłączyć dzienne przypomnienia e-mail, zaloguj się do aplikacji Zarządzanie Projektami i odznacz opcję przypomnień w ustawieniach swojego konta.',
    ].join('\n');
    const emptyHtml = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#1e293b;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
      <h2 style="margin:0 0 8px 0;font-size:18px;color:#0f172a;">[PODGLĄD] Zarządzanie Projektami — przypomnienie o terminach</h2>
      <p style="margin:0 0 12px 0;font-size:13px;color:#475569;">
        Dzień dobry, <strong>${escapeHtml(safeName)}</strong>! Stan na dzień <strong>${escapeHtml(todayStr)}</strong> (${escapeHtml(settings.timezone)}).
      </p>
      <p style="margin:0;padding:12px;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;color:#334155;">
        Obecnie nie masz żadnych otwartych zadań spełniających skonfigurowane kryteria przypomnień (dni przed terminem: ${escapeHtml(settings.daysBefore.join(', ') || 'brak')}${settings.notifyOverdue ? ', po terminie: tak' : ''}).
      </p>
    </div>`;

    await mailer.sendMail({
      to: cleanEmail,
      subject: emptySubject,
      text: emptyText,
      html: emptyHtml,
    });

    return {
      to: cleanEmail,
      taskCount: 0,
      date: todayStr,
    };
  }

  async function start(): Promise<void> {
    try {
      await tick();
    } catch (err: any) {
      logger.warn('[Reminders] Błąd wstępnego sprawdzenia przypomnień:', err?.message || err);
    }

    if (onTick) {
      try {
        await onTick();
      } catch (err: any) {
        logger.warn('[Reminders] Błąd wstępnego sprawdzenia dodatkowego zadania:', err?.message || err);
      }
    }

    if (!disableTimers && !intervalTimer) {
      intervalTimer = setInterval(() => {
        if (!stopped) {
          tick().catch((err) => {
            logger.warn('[Reminders] Błąd harmonogramu przypomnień:', err?.message || err);
          });
          if (onTick) {
            onTick().catch((err) => {
              logger.warn('[Reminders] Błąd harmonogramu dodatkowego zadania:', err?.message || err);
            });
          }
        }
      }, REMINDER_CHECK_INTERVAL_MS);
      if (typeof intervalTimer.unref === 'function') {
        intervalTimer.unref();
      }
    }
  }

  function stop(): void {
    stopped = true;
    if (intervalTimer) {
      clearInterval(intervalTimer);
      intervalTimer = null;
    }
  }

  return {
    start,
    stop,
    getStatus,
    tick,
    runNow,
    sendPreview,
  };
}
