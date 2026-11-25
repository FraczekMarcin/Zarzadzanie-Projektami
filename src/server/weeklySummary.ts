import { isValidEmail } from '../utils/settingsSchema.js';
import {
  PersistedWeeklySummaryState,
  UserWeeklySummary,
  buildWeeklySummary,
  findTargetWeeklyWindow,
  isoWeekKey,
  nextWeeklyRun,
  renderWeeklySummaryEmail,
  shouldRunWeeklyNow,
} from '../utils/weeklySummary.js';
import { logger } from './logger.js';
import { MailerService, formatSmtpErrorPolish } from './mailer.js';
import { REMINDER_CHECK_INTERVAL_MS, REMINDER_DEFAULT_SEND_DELAY_MS } from './reminders.js';
import type { SettingsService } from './settings.js';
import type { StateStore } from './state.js';

export interface WeeklySummaryStatusPayload {
  enabled: boolean;
  lastSentWeekKey: string | null;
  lastRunAt: string | null;
  sentCount: number;
  skippedCount: number;
  errorCount: number;
  lastError: string | null;
  nextScheduledAt: string | null;
  timezone: string;
  smtpConfigured: boolean;
}

export interface WeeklySummaryRunResult {
  executed: boolean;
  alreadyRanThisWeek: boolean;
  smtpConfigured: boolean;
  weekKey: string;
  sentCount: number;
  skippedCount: number;
  errorCount: number;
  lastError: string | null;
}

export interface WeeklySummaryPreviewResult {
  to: string;
  weekKey: string;
  overdueCount: number;
  upcomingCount: number;
}

export interface WeeklySummaryService {
  start: () => Promise<void>;
  stop: () => void;
  getStatus: () => WeeklySummaryStatusPayload;
  tick: () => Promise<WeeklySummaryRunResult | null>;
  runNow: (options?: { force?: boolean }) => Promise<WeeklySummaryRunResult>;
  sendPreview: (caller: {
    id: string;
    name?: string;
    email?: string;
    role?: string;
  }) => Promise<WeeklySummaryPreviewResult>;
}

function defaultDelay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getOrInitWeeklySummaryState(appState: any): PersistedWeeklySummaryState {
  const existing =
    appState && appState.weeklySummaryState && typeof appState.weeklySummaryState === 'object'
      ? appState.weeklySummaryState
      : {};

  return {
    lastSentWeekKey:
      typeof existing.lastSentWeekKey === 'string' ? existing.lastSentWeekKey : null,
    lastRunAt: typeof existing.lastRunAt === 'string' ? existing.lastRunAt : null,
    sentCount: typeof existing.sentCount === 'number' ? existing.sentCount : 0,
    skippedCount: typeof existing.skippedCount === 'number' ? existing.skippedCount : 0,
    errorCount: typeof existing.errorCount === 'number' ? existing.errorCount : 0,
    lastError: typeof existing.lastError === 'string' ? existing.lastError : null,
    sentUserIdsWeekKey:
      typeof existing.sentUserIdsWeekKey === 'string' ? existing.sentUserIdsWeekKey : null,
    sentUserIdsThisWeek: Array.isArray(existing.sentUserIdsThisWeek)
      ? existing.sentUserIdsThisWeek.filter((id: unknown): id is string => typeof id === 'string')
      : [],
  };
}

export function createWeeklySummaryService(deps: {
  stateStore: StateStore;
  settingsService: SettingsService;
  mailer: MailerService;
  disableTimers?: boolean;
  now?: () => number;
  delayFn?: (ms: number) => Promise<void>;
  sendDelayMs?: number;
}): WeeklySummaryService {
  const {
    stateStore,
    settingsService,
    mailer,
    disableTimers = false,
  } = deps;
  const now = deps.now ?? (() => Date.now());
  const delayFn = deps.delayFn ?? defaultDelay;
  const sendDelayMs =
    typeof deps.sendDelayMs === 'number' && deps.sendDelayMs >= 0
      ? deps.sendDelayMs
      : REMINDER_DEFAULT_SEND_DELAY_MS;

  let intervalTimer: NodeJS.Timeout | null = null;
  let stopped = false;
  let activeRunPromise: Promise<WeeklySummaryRunResult> | null = null;
  let lastMissingSmtpLoggedWeek: string | null = null;

  async function persistWeeklyState(nextState: PersistedWeeklySummaryState): Promise<void> {
    const appState = stateStore.ensureStateStructure();
    appState.weeklySummaryState = { ...nextState };
    stateStore.setAppState(appState);
    await stateStore.saveStateAtomicAsync();
  }

  function getStatus(): WeeklySummaryStatusPayload {
    const appState = stateStore.ensureStateStructure();
    const persisted = getOrInitWeeklySummaryState(appState);
    const settings = settingsService.getEffectiveWeeklySummarySettings();
    const currentMs = now();

    return {
      enabled: settings.enabled,
      lastSentWeekKey: persisted.lastSentWeekKey,
      lastRunAt: persisted.lastRunAt,
      sentCount: persisted.sentCount,
      skippedCount: persisted.skippedCount,
      errorCount: persisted.errorCount,
      lastError: persisted.lastError,
      nextScheduledAt: nextWeeklyRun(currentMs, settings, persisted.lastSentWeekKey),
      timezone: settings.timezone,
      smtpConfigured: mailer.isMailConfigured(),
    };
  }

  async function executeRun(options: {
    force: boolean;
    isManual: boolean;
  }): Promise<WeeklySummaryRunResult> {
    if (activeRunPromise) {
      return await activeRunPromise;
    }

    const runPromise = (async (): Promise<WeeklySummaryRunResult> => {
      const currentMs = now();
      const currentIso = new Date(currentMs).toISOString();
      const settings = settingsService.getEffectiveWeeklySummarySettings();
      const targetWindow = findTargetWeeklyWindow(currentMs, settings);
      const targetWeekKey = targetWindow?.weekKey ?? isoWeekKey(currentMs, settings.timezone);
      const appState = stateStore.ensureStateStructure();
      const persisted = getOrInitWeeklySummaryState(appState);

      if (persisted.sentUserIdsWeekKey !== targetWeekKey) {
        persisted.sentUserIdsWeekKey = targetWeekKey;
        persisted.sentUserIdsThisWeek = [];
      }

      if (!options.force && !options.isManual && !shouldRunWeeklyNow(currentMs, settings, persisted.lastSentWeekKey)) {
        return {
          executed: false,
          alreadyRanThisWeek: Boolean(
            persisted.lastSentWeekKey && persisted.lastSentWeekKey >= targetWeekKey
          ),
          smtpConfigured: mailer.isMailConfigured(),
          weekKey: targetWeekKey,
          sentCount: 0,
          skippedCount: 0,
          errorCount: 0,
          lastError: persisted.lastError,
        };
      }

      if (!mailer.isMailConfigured()) {
        const msg =
          'Serwer SMTP nie jest skonfigurowany — nie wysłano podsumowania tygodniowego.';
        persisted.lastRunAt = currentIso;
        persisted.sentCount = 0;
        persisted.skippedCount = 0;
        persisted.errorCount = 1;
        persisted.lastError = msg;
        await persistWeeklyState(persisted);

        if (options.isManual || lastMissingSmtpLoggedWeek !== targetWeekKey) {
          lastMissingSmtpLoggedWeek = targetWeekKey;
          await stateStore.securityLogger
            .record('weekly_summary_failed', {
              details: {
                weekKey: targetWeekKey,
                sentCount: 0,
                skippedCount: 0,
                errorCount: 1,
                reason: 'smtp_not_configured',
              },
            })
            .catch(() => {});
          logger.warn(
            '[WeeklySummary] Pominięto wysyłkę podsumowania tygodniowego: serwer SMTP nie jest skonfigurowany.'
          );
        }

        return {
          executed: false,
          alreadyRanThisWeek: false,
          smtpConfigured: false,
          weekKey: targetWeekKey,
          sentCount: 0,
          skippedCount: 0,
          errorCount: 1,
          lastError: msg,
        };
      }

      const alreadyRanThisWeek =
        !options.force && Boolean(persisted.lastSentWeekKey && persisted.lastSentWeekKey >= targetWeekKey);

      const users = Array.isArray(appState.users) ? appState.users : [];
      const tasks = Array.isArray(appState.tasks) ? appState.tasks : [];
      const projects = Array.isArray(appState.projects) ? appState.projects : [];

      const summaries: UserWeeklySummary[] = buildWeeklySummary(
        tasks,
        projects,
        users,
        currentMs,
        settings,
        appState.variables?.projectStatuses
      );

      const alreadySentSet = new Set(persisted.sentUserIdsThisWeek);
      const smtpPassword = settingsService.getRuntimeSmtpConfig().password;

      let sentCount = 0;
      let skippedCount = 0;
      let errorCount = 0;
      let lastError: string | null = null;
      let attemptIndex = 0;

      for (const rawSummary of summaries) {
        const summary: UserWeeklySummary =
          rawSummary.weekKey === targetWeekKey
            ? rawSummary
            : { ...rawSummary, weekKey: targetWeekKey };

        // Pustych podsumowań (bez zaległych i bez kończących się) nie wysyłamy
        if (summary.totalOverdue === 0 && summary.totalUpcoming === 0) {
          skippedCount += 1;
          continue;
        }

        if (!options.force && (alreadyRanThisWeek || alreadySentSet.has(summary.user.id))) {
          skippedCount += 1;
          continue;
        }

        if (attemptIndex > 0) {
          await delayFn(sendDelayMs);
        }
        attemptIndex += 1;

        const rendered = renderWeeklySummaryEmail(summary, settings.appBaseUrl);

        try {
          await mailer.sendMail({
            to: summary.user.email,
            subject: rendered.subject,
            text: rendered.text,
            html: rendered.html,
          });
          sentCount += 1;
          if (!alreadySentSet.has(summary.user.id)) {
            alreadySentSet.add(summary.user.id);
            persisted.sentUserIdsThisWeek.push(summary.user.id);
          }
          // Zapisuj listę obsłużonych użytkowników po każdej wiadomości dla odporności na restart w trakcie pętli
          await persistWeeklyState(persisted);
        } catch (err: any) {
          errorCount += 1;
          lastError = formatSmtpErrorPolish(err, smtpPassword);
          logger.warn(
            `[WeeklySummary] Nie udało się wysłać podsumowania tygodniowego dla użytkownika (${summary.user.id}): ${lastError}`
          );
        }
      }

      persisted.lastSentWeekKey = targetWeekKey;
      persisted.lastRunAt = currentIso;
      persisted.sentCount = sentCount;
      persisted.skippedCount = skippedCount;
      persisted.errorCount = errorCount;
      persisted.lastError = lastError;
      await persistWeeklyState(persisted);

      const logDetails = { weekKey: targetWeekKey, sentCount, skippedCount, errorCount };
      if (sentCount > 0 || errorCount === 0) {
        await stateStore.securityLogger
          .record('weekly_summary_sent', { details: logDetails })
          .catch(() => {});
      }
      if (errorCount > 0) {
        await stateStore.securityLogger
          .record('weekly_summary_failed', { details: logDetails })
          .catch(() => {});
      }

      logger.info(
        `[WeeklySummary] Zakończono przebieg podsumowania tygodniowego (${targetWeekKey}): wysłano=${sentCount}, pominięto=${skippedCount}, błędy=${errorCount}.`
      );

      return {
        executed: true,
        alreadyRanThisWeek,
        smtpConfigured: true,
        weekKey: targetWeekKey,
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

  async function tick(): Promise<WeeklySummaryRunResult | null> {
    if (stopped) return null;
    const settings = settingsService.getEffectiveWeeklySummarySettings();
    const appState = stateStore.ensureStateStructure();
    const persisted = getOrInitWeeklySummaryState(appState);
    if (!shouldRunWeeklyNow(now(), settings, persisted.lastSentWeekKey)) {
      return null;
    }
    return await executeRun({ force: false, isManual: false });
  }

  async function runNow(options: { force?: boolean } = {}): Promise<WeeklySummaryRunResult> {
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
  }): Promise<WeeklySummaryPreviewResult> {
    if (!mailer.isMailConfigured()) {
      throw new Error('Serwer SMTP nie jest skonfigurowany. Uzupełnij i zapisz ustawienia SMTP.');
    }

    const cleanEmail = typeof caller.email === 'string' ? caller.email.trim() : '';
    if (!cleanEmail || !isValidEmail(cleanEmail)) {
      throw new Error('Twoje konto nie ma przypisanego prawidłowego adresu e-mail.');
    }

    const currentMs = now();
    const settings = settingsService.getEffectiveWeeklySummarySettings();
    const appState = stateStore.ensureStateStructure();
    const tasks = Array.isArray(appState.tasks) ? appState.tasks : [];
    const projects = Array.isArray(appState.projects) ? appState.projects : [];

    const previewRecipient = {
      id: caller.id,
      name: caller.name || cleanEmail,
      email: cleanEmail,
      role: 'admin' as const,
      department: '',
      initials: '',
      isApproved: true,
      weeklySummary: true,
    };

    const summaries = buildWeeklySummary(
      tasks,
      projects,
      [previewRecipient],
      currentMs,
      { ...settings, includeAdmins: true },
      appState.variables?.projectStatuses
    );

    const summary = summaries[0] || {
      user: {
        id: caller.id,
        name: previewRecipient.name,
        email: cleanEmail,
        role: 'admin',
      },
      weekKey: isoWeekKey(currentMs, settings.timezone),
      date: new Date(currentMs).toISOString().slice(0, 10),
      timezone: settings.timezone,
      windowDays: settings.windowDays,
      maxItemsPerProject: settings.maxItemsPerProject,
      totalOpen: 0,
      totalOverdue: 0,
      totalUpcoming: 0,
      projects: [],
      cleanProjects: [],
    };

    const rendered = renderWeeklySummaryEmail(summary, settings.appBaseUrl);
    await mailer.sendMail({
      to: cleanEmail,
      subject: `[PODGLĄD] ${rendered.subject}`,
      text: rendered.text,
      html: rendered.html,
    });

    return {
      to: cleanEmail,
      weekKey: summary.weekKey,
      overdueCount: summary.totalOverdue,
      upcomingCount: summary.totalUpcoming,
    };
  }

  async function start(): Promise<void> {
    try {
      await tick();
    } catch (err: any) {
      logger.warn('[WeeklySummary] Błąd wstępnego sprawdzenia podsumowania tygodniowego:', err?.message || err);
    }

    if (!disableTimers && !intervalTimer) {
      intervalTimer = setInterval(() => {
        if (!stopped) {
          tick().catch((err) => {
            logger.warn('[WeeklySummary] Błąd harmonogramu podsumowania tygodniowego:', err?.message || err);
          });
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
