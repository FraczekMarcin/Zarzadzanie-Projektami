import express from 'express';
import {
  CreateAppOptions,
  ServerConfig,
  resolveServerConfig,
} from './config.js';
import { createStateStore, DISK_FULL_ERROR_MESSAGE, isDiskFullError, StateStore } from './state.js';
import { applyCoreMiddleware, createSecurityContext, SecurityContext } from './security.js';
import { createSessionStore, SessionStore } from './sessions.js';
import { registerSystemRoutes } from './routes/system.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerTaskRoutes } from './routes/tasks.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerTenderRoutes } from './routes/tenders.js';
import { registerTemplateRoutes } from './routes/templates.js';
import { registerCompanyRoutes } from './routes/companies.js';
import { registerCommentRoutes } from './routes/comments.js';
import { registerUserRoutes } from './routes/users.js';
import { registerCalendarRoutes } from './routes/calendar.js';
import { registerEventRoutes, EventRoutesHandle } from './routes/events.js';
import { createGoogleSyncService, registerGoogleSyncRoutes } from './googleSync.js';
import { createBackupWatchService } from './backupWatch.js';
import { createDiskWatchService } from './diskWatch.js';
import { createSettingsService } from './settings.js';
import { createTrustedDevicesService } from './trustedDevices.js';
import { createMailer } from './mailer.js';
import { registerAdminSettingsRoutes } from './routes/adminSettings.js';
import { registerPermissionRoutes } from './routes/permissions.js';
import { createTrashCleanupService } from './trash.js';
import { registerTrashRoutes } from './routes/trash.js';
import { createReminderService } from './reminders.js';
import { registerReminderRoutes } from './routes/reminders.js';
import { createWeeklySummaryService } from './weeklySummary.js';
import { registerWeeklySummaryRoutes } from './routes/weeklySummary.js';
import {
  reconcileLeafTasksConsistency,
  recomputeAllProjectsProgress,
} from '../utils/progress.js';
import { setupStaticAndSpa } from './static.js';
import { logger } from './logger.js';

export type { CreateAppOptions };

export interface CreateAppResult {
  app: express.Express;
  close: () => Promise<void>;
}

export async function createApp(options: CreateAppOptions = {}): Promise<CreateAppResult> {
  process.umask(0o077);
  const config: ServerConfig = resolveServerConfig(options);
  const stateStore: StateStore = await createStateStore(config);
  const settingsService = createSettingsService({ config, stateStore });
  const bootState = stateStore.getAppState();
  if (bootState) {
    const ensuredBootState = stateStore.ensureStateStructure();
    const { fixedCount } = reconcileLeafTasksConsistency(ensuredBootState.tasks);
    if (fixedCount > 0) {
      logger.info(
        `[Server] Migracja spójności postępu i statusu zadań: naprawiono ${fixedCount} zadań liściowych.`
      );
    }
    const { changed } = recomputeAllProjectsProgress(ensuredBootState, {
      weighting: settingsService.getEffectiveProgressWeighting(),
    });
    if ((fixedCount > 0 || changed) && bootState.initialized) {
      await stateStore.saveStateAtomicAsync();
    }
  }
  const mailer = createMailer(settingsService);
  const security: SecurityContext = createSecurityContext();
  const sessionStore: SessionStore = createSessionStore(
    config,
    stateStore,
    () => settingsService.getEffectiveSessionPolicy()
  );
  const trustedDevicesService = createTrustedDevicesService({
    config,
    stateStore,
    sessionStore,
    settingsService,
    disableTimers: options.trustedDevicesDisableTimers,
  });
  const googleSync = createGoogleSyncService({
    config,
    stateStore,
    clientOverride: options.googleSyncClient,
    disableTimers: options.googleSyncDisableTimers,
  });
  const backupWatch = createBackupWatchService({
    config,
    stateStore,
    mailer,
    disableTimers: options.backupWatchDisableTimers,
    checkStatusOverride: options.backupStatusCheckOverride,
    mailerOverride: options.backupAlertMailer,
  });
  const diskWatch = createDiskWatchService({
    config,
    stateStore,
    mailer,
    disableTimers: options.diskWatchDisableTimers,
    checkStatusOverride: options.diskStatusCheckOverride,
    mailerOverride: options.diskAlertMailer,
  });
  const trashCleanup = createTrashCleanupService({
    stateStore,
    disableTimers: options.trashCleanupDisableTimers,
  });
  const weeklySummaryService = createWeeklySummaryService({
    stateStore,
    settingsService,
    mailer,
    disableTimers: true, // Wspólny timer 10-minutowy z harmonogramem przypomnień
  });
  const reminderService = createReminderService({
    stateStore,
    settingsService,
    mailer,
    disableTimers: options.remindersDisableTimers,
    onTick: options.weeklySummaryDisableTimers
      ? undefined
      : async () => {
          await weeklySummaryService.tick();
        },
  });

  let closeStatic: (() => Promise<void>) | null = null;
  let eventsHandle: EventRoutesHandle | null = null;
  let closed = false;

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;

    weeklySummaryService.stop();
    reminderService.stop();
    trustedDevicesService.stop();
    trashCleanup.stop();
    diskWatch.stop();
    backupWatch.stop();
    googleSync.stop();
    eventsHandle?.closeAll();
    security.destroy();

    try {
      await sessionStore.close();
    } catch (err) {
      logger.error('[Server] Błąd zapisu sesji przy zamykaniu:', err);
    }

    try {
      await stateStore.flushPendingStateSave();
    } catch (err) {
      logger.error('[Server] Błąd wymuszonego zapisu stanu przy zamykaniu:', err);
    }

    if (closeStatic) {
      await closeStatic();
    }
  };

  try {
    const app = express();
    applyCoreMiddleware(app, config, stateStore.securityLogger);

    await trashCleanup.start();
    await trustedDevicesService.start();
    await reminderService.start();

    registerSystemRoutes(app, {
      config,
      stateStore,
      sessionStore,
      settingsService,
      diskStatusCheckOverride: options.diskStatusCheckOverride,
    });
    registerAuthRoutes(app, {
      config,
      stateStore,
      sessionStore,
      security,
      settingsService,
      mailer,
      trustedDevicesService,
    });
    registerTaskRoutes(app, { stateStore, sessionStore, settingsService });
    registerProjectRoutes(app, { stateStore, sessionStore, settingsService });
    registerTenderRoutes(app, { stateStore, sessionStore, security });
    registerTemplateRoutes(app, { stateStore, sessionStore });
    registerCompanyRoutes(app, { stateStore, sessionStore });
    registerTrashRoutes(app, { stateStore, sessionStore, settingsService });
    registerCommentRoutes(app, { stateStore, sessionStore });
    registerUserRoutes(app, { config, stateStore, sessionStore, security, trustedDevicesService });
    registerCalendarRoutes(app, { config, stateStore, sessionStore });
    registerGoogleSyncRoutes(app, { googleSync, sessionStore });
    registerAdminSettingsRoutes(app, {
      stateStore,
      sessionStore,
      security,
      settingsService,
      mailer,
      trustedDevicesService,
    });
    registerReminderRoutes(app, { sessionStore, security, settingsService, mailer, reminderService });
    registerWeeklySummaryRoutes(app, {
      sessionStore,
      security,
      settingsService,
      mailer,
      weeklySummaryService,
    });
    eventsHandle = registerEventRoutes(app, { stateStore, sessionStore });
    registerPermissionRoutes(app, {
      stateStore,
      sessionStore,
      notifyPermissionsChanged: (opts) => eventsHandle?.notifyPermissionsChanged(opts),
    });

    // 404 handler dla nieznanych tras /api (dla każdej metody HTTP)
    app.use('/api', (_req, res) => {
      res.status(404).json({ error: 'Nie znaleziono' });
    });

    closeStatic = await setupStaticAndSpa(app, config);

    // Globalny middleware obsługi błędów zwracający ZAWSZE JSON { error: string } (bez HTML, bez stack trace)
    app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      if (isDiskFullError(err)) {
        return res.status(507).json({ error: DISK_FULL_ERROR_MESSAGE });
      }
      const status = typeof err?.status === 'number' ? err.status : (typeof err?.statusCode === 'number' ? err.statusCode : 500);
      let errorMsg = 'Wystąpił wewnętrzny błąd serwera';

      if (err?.type === 'entity.parse.failed' || (err instanceof SyntaxError && 'body' in err)) {
        errorMsg = 'Niepoprawny format danych JSON';
      } else if (err?.type === 'entity.too.large') {
        errorMsg = 'Przekroczono dopuszczalny rozmiar treści żądania';
      } else if (err?.message && status < 500) {
        errorMsg = err.message;
      }

      res.status(status).json({ error: errorMsg });
    });

    return { app, close };
  } catch (err) {
    await close().catch(() => {});
    throw err;
  }
}
