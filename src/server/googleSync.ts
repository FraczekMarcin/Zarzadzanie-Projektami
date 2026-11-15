import express from 'express';
import {
  diffEvents,
  GoogleCalendarApiError,
  GoogleCalendarClient,
  GoogleCalendarEventPayload,
  GoogleCalendarExistingEvent,
  loadServiceAccountCredentials,
} from '../utils/googleCalendar.js';
import { ServerConfig } from './config.js';
import { getClientIp } from './security.js';
import { SessionStore } from './sessions.js';
import { StateStore } from './state.js';
import { logger } from './logger.js';

export interface GoogleCalendarSyncClientLike {
  listEvents(): Promise<GoogleCalendarExistingEvent[]>;
  insertEvent(payload: GoogleCalendarEventPayload): Promise<GoogleCalendarExistingEvent>;
  patchEvent(
    eventId: string,
    payload: Partial<GoogleCalendarEventPayload>
  ): Promise<GoogleCalendarExistingEvent>;
  deleteEvent(eventId: string): Promise<void>;
}

export interface GoogleSyncCounts {
  created: number;
  updated: number;
  deleted: number;
}

export interface GoogleSyncStatus {
  enabled: boolean;
  running: boolean;
  lastSyncAt: string | null;
  lastSuccessAt: string | null;
  counts: GoogleSyncCounts | null;
  lastError: string | null;
}

export interface GoogleSyncRunResult {
  skipped: boolean;
  reason?: 'disabled' | 'already_running';
  created?: number;
  updated?: number;
  deleted?: number;
  error?: string;
}

export interface GoogleSyncService {
  isEnabled: () => boolean;
  getStatus: () => GoogleSyncStatus;
  runSync: (
    trigger?: 'startup' | 'debounce' | 'interval' | 'manual',
    meta?: { userId?: string; ip?: string; userAgent?: string }
  ) => Promise<GoogleSyncRunResult>;
  stop: () => void;
}

export const GOOGLE_SYNC_STARTUP_DELAY_MS = 30_000;
export const GOOGLE_SYNC_DEBOUNCE_MS = 60_000;
export const GOOGLE_SYNC_RECONCILE_INTERVAL_MS = 15 * 60 * 1000;

function sanitizeSyncError(err: any): string {
  if (err instanceof GoogleCalendarApiError) {
    return err.message;
  }
  const raw = typeof err?.message === 'string' ? err.message : 'Nieznany błąd synchronizacji';
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/-----BEGIN[^-]+-----[\s\S]*?-----END[^-]+-----/g, '[PRIVATE_KEY_REDACTED]')
    .replace(/\s+/g, ' ')
    .slice(0, 180);
}

export function createGoogleSyncService(deps: {
  config: ServerConfig;
  stateStore: StateStore;
  clientOverride?: GoogleCalendarSyncClientLike;
  disableTimers?: boolean;
}): GoogleSyncService {
  const { config, stateStore, clientOverride, disableTimers } = deps;
  const enabled = Boolean(
    clientOverride ||
      (config.googleServiceAccountFile &&
        config.googleServiceAccountFile.trim() !== '' &&
        config.googleCalendarId &&
        config.googleCalendarId.trim() !== '')
  );

  let running = false;
  let lastSyncAt: string | null = null;
  let lastSuccessAt: string | null = null;
  let lastCounts: GoogleSyncCounts | null = null;
  let lastError: string | null = null;
  let cachedClient: GoogleCalendarSyncClientLike | null = clientOverride || null;

  let startupTimer: NodeJS.Timeout | null = null;
  let debounceTimer: NodeJS.Timeout | null = null;
  let reconcileInterval: NodeJS.Timeout | null = null;
  let unsubscribeRevision: (() => void) | null = null;
  let stopped = false;

  const getClient = async (): Promise<GoogleCalendarSyncClientLike> => {
    if (cachedClient) return cachedClient;
    const creds = await loadServiceAccountCredentials(config.googleServiceAccountFile);
    cachedClient = new GoogleCalendarClient({
      clientEmail: creds.clientEmail,
      privateKey: creds.privateKey,
      calendarId: config.googleCalendarId,
    });
    return cachedClient;
  };

  const runSync = async (
    trigger: 'startup' | 'debounce' | 'interval' | 'manual' = 'manual',
    meta?: { userId?: string; ip?: string; userAgent?: string }
  ): Promise<GoogleSyncRunResult> => {
    if (!enabled) {
      return { skipped: true, reason: 'disabled' };
    }
    if (running) {
      return { skipped: true, reason: 'already_running' };
    }

    running = true;
    lastSyncAt = new Date().toISOString();

    stateStore.securityLogger
      .record('google_sync_started', {
        userId: meta?.userId,
        ip: meta?.ip,
        userAgent: meta?.userAgent,
        details: { trigger },
      })
      .catch(() => {});

    try {
      const client = await getClient();
      const appState = stateStore.ensureStateStructure();
      const existingEvents = await client.listEvents();
      const diff = diffEvents(appState.tasks || [], existingEvents, appState.projects || []);

      for (const item of diff.create) {
        await client.insertEvent(item.payload);
      }
      for (const item of diff.update) {
        await client.patchEvent(item.eventId, item.payload);
      }
      for (const item of diff.delete) {
        await client.deleteEvent(item.eventId);
      }

      const counts: GoogleSyncCounts = {
        created: diff.create.length,
        updated: diff.update.length,
        deleted: diff.delete.length,
      };
      lastCounts = counts;
      lastSuccessAt = new Date().toISOString();
      lastError = null;

      stateStore.securityLogger
        .record('google_sync_completed', {
          userId: meta?.userId,
          ip: meta?.ip,
          userAgent: meta?.userAgent,
          details: { trigger, ...counts },
        })
        .catch(() => {});

      return { skipped: false, ...counts };
    } catch (err: any) {
      const safeMsg = sanitizeSyncError(err);
      lastError = safeMsg;
      logger.error(`[GoogleSync] Błąd synchronizacji (${trigger}): ${safeMsg}`);

      stateStore.securityLogger
        .record('google_sync_failed', {
          userId: meta?.userId,
          ip: meta?.ip,
          userAgent: meta?.userAgent,
          details: { trigger, error: safeMsg },
        })
        .catch(() => {});

      return { skipped: false, error: safeMsg };
    } finally {
      running = false;
    }
  };

  if (enabled && !disableTimers) {
    startupTimer = setTimeout(() => {
      startupTimer = null;
      if (!stopped) {
        void runSync('startup');
      }
    }, GOOGLE_SYNC_STARTUP_DELAY_MS);
    startupTimer.unref();

    reconcileInterval = setInterval(() => {
      if (!stopped) {
        void runSync('interval');
      }
    }, GOOGLE_SYNC_RECONCILE_INTERVAL_MS);
    reconcileInterval.unref();

    unsubscribeRevision = stateStore.onRevisionChange(() => {
      if (stopped) return;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        if (!stopped) {
          void runSync('debounce');
        }
      }, GOOGLE_SYNC_DEBOUNCE_MS);
      debounceTimer.unref();
    });
  }

  const getStatus = (): GoogleSyncStatus => ({
    enabled,
    running,
    lastSyncAt,
    lastSuccessAt,
    counts: lastCounts ? { ...lastCounts } : null,
    lastError,
  });

  const stop = () => {
    stopped = true;
    if (startupTimer) {
      clearTimeout(startupTimer);
      startupTimer = null;
    }
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (reconcileInterval) {
      clearInterval(reconcileInterval);
      reconcileInterval = null;
    }
    if (unsubscribeRevision) {
      unsubscribeRevision();
      unsubscribeRevision = null;
    }
  };

  return {
    isEnabled: () => enabled,
    getStatus,
    runSync,
    stop,
  };
}

export function registerGoogleSyncRoutes(
  app: express.Express,
  deps: { googleSync: GoogleSyncService; sessionStore: SessionStore }
): void {
  const { googleSync, sessionStore } = deps;
  const { requireAdmin } = sessionStore;

  app.get('/api/google-sync/status', requireAdmin, (_req, res) => {
    res.json(googleSync.getStatus());
  });

  app.post('/api/google-sync/run', requireAdmin, (req, res) => {
    if (!googleSync.isEnabled()) {
      return res.status(400).json({
        error: 'Synchronizacja z Kalendarzem Google jest wyłączona (brak konfiguracji zmiennych GOOGLE_SERVICE_ACCOUNT_FILE i GOOGLE_CALENDAR_ID).',
      });
    }

    const caller = (req as any).user;
    void googleSync.runSync('manual', {
      userId: caller?.id,
      ip: getClientIp(req),
      userAgent: (req.headers['user-agent'] || '').slice(0, 100),
    });

    return res.status(202).json({
      accepted: true,
      message: 'Uruchomiono synchronizację zadań z Kalendarzem Google.',
      status: googleSync.getStatus(),
    });
  });
}
