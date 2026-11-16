import express from 'express';
import {
  CreateAppOptions,
  ServerConfig,
  resolveServerConfig,
} from './config.js';
import { createStateStore, StateStore } from './state.js';
import { applyCoreMiddleware, createSecurityContext, SecurityContext } from './security.js';
import { createSessionStore, SessionStore } from './sessions.js';
import { registerSystemRoutes } from './routes/system.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerTaskRoutes } from './routes/tasks.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerCommentRoutes } from './routes/comments.js';
import { registerUserRoutes } from './routes/users.js';
import { registerCalendarRoutes } from './routes/calendar.js';
import { registerEventRoutes, EventRoutesHandle } from './routes/events.js';
import { createGoogleSyncService, registerGoogleSyncRoutes } from './googleSync.js';
import { createBackupWatchService } from './backupWatch.js';
import { createSettingsService } from './settings.js';
import { createMailer } from './mailer.js';
import { registerAdminSettingsRoutes } from './routes/adminSettings.js';
import { createTrashCleanupService } from './trash.js';
import { registerTrashRoutes } from './routes/trash.js';
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
  const mailer = createMailer(settingsService);
  const security: SecurityContext = createSecurityContext();
  const sessionStore: SessionStore = createSessionStore(
    config,
    stateStore,
    () => settingsService.getEffectiveSessionPolicy()
  );
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
  const trashCleanup = createTrashCleanupService({
    stateStore,
    disableTimers: options.trashCleanupDisableTimers,
  });

  let closeStatic: (() => Promise<void>) | null = null;
  let eventsHandle: EventRoutesHandle | null = null;
  let closed = false;

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;

    trashCleanup.stop();
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

    registerSystemRoutes(app, { config, stateStore, sessionStore });
    registerAuthRoutes(app, { config, stateStore, sessionStore, security, settingsService, mailer });
    registerTaskRoutes(app, { stateStore, sessionStore, settingsService });
    registerProjectRoutes(app, { stateStore, sessionStore, settingsService });
    registerTrashRoutes(app, { stateStore, sessionStore, settingsService });
    registerCommentRoutes(app, { stateStore, sessionStore });
    registerUserRoutes(app, { config, stateStore, sessionStore, security });
    registerCalendarRoutes(app, { config, stateStore, sessionStore });
    registerGoogleSyncRoutes(app, { googleSync, sessionStore });
    registerAdminSettingsRoutes(app, { stateStore, sessionStore, security, settingsService, mailer });
    eventsHandle = registerEventRoutes(app, { stateStore, sessionStore });

    // 404 handler dla nieznanych tras /api (dla każdej metody HTTP)
    app.use('/api', (_req, res) => {
      res.status(404).json({ error: 'Nie znaleziono' });
    });

    closeStatic = await setupStaticAndSpa(app, config);

    // Globalny middleware obsługi błędów zwracający ZAWSZE JSON { error: string } (bez HTML, bez stack trace)
    app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
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
