import express from 'express';
import { filterStateForUser } from '../../utils/access.js';
import { SecurityEventType } from '../../utils/securityLog.js';
import { computeBackupStatus } from '../backupStatus.js';
import { classifyDiskLevel, DiskStatus, getDiskStatus } from '../diskWatch.js';
import {
  BACKUP_STATUS_CACHE_TTL_MS,
  UPDATE_CACHE_TTL_MS,
  ServerConfig,
  getLocalInstalledVersion,
  isNewerVersion,
} from '../config.js';
import { DISK_FULL_ERROR_MESSAGE, isDiskFullError, StateStore, sanitizeUser } from '../state.js';
import { SessionStore } from '../sessions.js';
import { SettingsService } from '../settings.js';
import { logger } from '../logger.js';
import { sanitizeImportedCompanies } from './companies.js';
import {
  DEFAULT_PROGRESS_WEIGHTING,
  reconcileLeafTasksConsistency,
  recomputeAllProjectsProgress,
} from '../../utils/progress.js';

interface UpdateCheckCache {
  data: {
    localVersion: string;
    remoteVersion: string;
    hasUpdate: boolean;
    checkedSource: string;
    latestSha: string;
    commitMessage: string;
    checkedAt: string;
    cached?: boolean;
  };
  cachedAt: number;
}

export function registerSystemRoutes(
  app: express.Express,
  deps: {
    config: ServerConfig;
    stateStore: StateStore;
    sessionStore: SessionStore;
    settingsService?: SettingsService;
    diskStatusCheckOverride?: () => Promise<DiskStatus | null>;
  }
): void {
  const { config, stateStore, sessionStore, settingsService, diskStatusCheckOverride } = deps;
  const { requireAuth, requireAdmin } = sessionStore;

  let backupStatusCache: { data: any; cachedAt: number } | null = null;
  let serverUpdateCache: UpdateCheckCache | null = null;

  // API Healthcheck endpoint (Public)
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      version: getLocalInstalledVersion(),
      timestamp: new Date().toISOString(),
      storage: 'JSON Database (app_state.json)',
      persistedState: !!stateStore.getAppState(),
    });
  });

  // Lekki endpoint sprawdzania rewizji stanu (co 15s przez klienta, wymaga uwierzytelnienia)
  app.get('/api/state/revision', requireAuth, (_req, res) => {
    const appState = stateStore.ensureStateStructure();
    res.json({ revision: appState?.revision || 0 });
  });

  // GET /api/state: Zwraca dane z polem revision oraz nagłówkiem ETag (przefiltrowane wg uprawnień)
  app.get('/api/state', requireAuth, (req, res) => {
    const appState = stateStore.ensureStateStructure();
    const caller = (req as any).user;
    const currentRevision = appState?.revision || 0;
    res.setHeader('ETag', `W/"rev-${currentRevision}"`);

    const filtered = filterStateForUser(appState, caller);
    const sanitized = {
      ...filtered,
      revision: currentRevision,
      users: (filtered.users || []).map(sanitizeUser),
      progressWeighting: settingsService
        ? settingsService.getEffectiveProgressWeighting()
        : DEFAULT_PROGRESS_WEIGHTING,
      appTimezone: settingsService
        ? settingsService.getEffectiveReminderSettings().timezone
        : 'Europe/Warsaw',
    };
    return res.json({ initialized: true, state: sanitized });
  });

  // POST /api/state: WYŁĄCZNIE dla Administratora (import/przywracanie kopii z walidacją If-Match)
  app.post('/api/state', requireAuth, async (req, res) => {
    try {
      const appState = stateStore.ensureStateStructure();
      const caller = (req as any).user;
      const incoming = req.body || {};

      if (caller.role !== 'admin') {
        return res.status(403).json({
          error: 'Modyfikacja całego stanu aplikacji jest dozwolona wyłącznie dla Administratora (import/przywracanie kopii).',
        });
      }

      const rawIfMatch = req.headers['if-match'] || (incoming.expectedRevision !== undefined ? String(incoming.expectedRevision) : null);
      if (rawIfMatch) {
        const cleanMatch = String(rawIfMatch).replace(/["W\/]/g, '').trim();
        const currentRev = String(appState.revision || 0);
        if (cleanMatch !== '*' && cleanMatch !== currentRev) {
          return res.status(409).json({
            error: 'Konflikt wersji stanu aplikacji (baza została zaktualizowana przez innego administratora).',
            currentState: {
              ...filterStateForUser(appState, caller),
              revision: appState.revision,
              users: (appState.users || []).map(sanitizeUser),
            },
            currentRevision: appState.revision,
          });
        }
      }

      const existingUsers = stateStore.getUsers();
      let nextUsers = existingUsers;
      if (Array.isArray(incoming.users)) {
        nextUsers = incoming.users.map((inUser: any) => {
          const existing = existingUsers.find((u) => u.id === inUser.id);
          return {
            ...inUser,
            passwordHash: existing?.passwordHash || inUser.passwordHash,
            twoFactorSecret: existing?.twoFactorSecret || inUser.twoFactorSecret,
            twoFactorBackupCodes: existing?.twoFactorBackupCodes || inUser.twoFactorBackupCodes,
            calendarTokenHash: existing?.calendarTokenHash || inUser.calendarTokenHash,
            calendarTokenCreatedAt: existing?.calendarTokenCreatedAt || inUser.calendarTokenCreatedAt,
          };
        });
      }

      const {
        serverSettings: _ignoredServerSettings,
        trash: _ignoredTrash,
        tenders: _ignoredTenders,
        projectTemplates: _ignoredProjectTemplates,
        reminderState: _ignoredReminderState,
        weeklySummaryState: _ignoredWeeklySummaryState,
        trustedDevices: _ignoredTrustedDevices,
        variables: _ignoredVariables,
        progressWeighting: _ignoredProgressWeighting,
        companies: incomingCompanies,
        projectNumbering: incomingProjectNumbering,
        ...safeIncoming
      } = incoming;

      const preservedCompanies = Array.isArray(incomingCompanies)
        ? sanitizeImportedCompanies(incomingCompanies)
        : (Array.isArray(appState.companies) ? appState.companies : []);

      const currentNumbering = appState.projectNumbering || { scope: 'year' as const };
      const nextProjectNumbering =
        incomingProjectNumbering && typeof incomingProjectNumbering === 'object'
          ? {
              scope: incomingProjectNumbering.scope === 'company' ? ('company' as const) : ('year' as const),
              ...(typeof incomingProjectNumbering.defaultCompanyId === 'string' &&
              preservedCompanies.some((c: any) => c.id === incomingProjectNumbering.defaultCompanyId && c.isActive)
                ? { defaultCompanyId: incomingProjectNumbering.defaultCompanyId }
                : {}),
            }
          : currentNumbering;

      const nextState = {
        ...appState,
        ...safeIncoming,
        companies: preservedCompanies,
        projectNumbering: nextProjectNumbering,
        serverSettings: appState.serverSettings,
        trash: Array.isArray(appState.trash) ? appState.trash : [],
        tenders: Array.isArray(appState.tenders) ? appState.tenders : [],
        projectTemplates: Array.isArray(appState.projectTemplates) ? appState.projectTemplates : [],
        reminderState: appState.reminderState,
        weeklySummaryState: appState.weeklySummaryState,
        trustedDevices: Array.isArray(appState.trustedDevices) ? appState.trustedDevices : [],
        variables: appState.variables,
        users: nextUsers,
        initialized: true,
        updatedAt: new Date().toISOString(),
      };
      stateStore.setAppState(nextState);
      stateStore.setUsers(nextUsers);
      const ensured = stateStore.ensureStateStructure();
      reconcileLeafTasksConsistency(ensured.tasks);
      recomputeAllProjectsProgress(ensured, {
        weighting: settingsService
          ? settingsService.getEffectiveProgressWeighting()
          : DEFAULT_PROGRESS_WEIGHTING,
      });

      const newRev = stateStore.bumpStateRevision();
      await stateStore.saveStateAtomicAsync();
      res.json({ success: true, revision: newRev, timestamp: stateStore.getAppState().updatedAt });
    } catch (err: any) {
      if (isDiskFullError(err)) {
        return res.status(507).json({ success: false, error: DISK_FULL_ERROR_MESSAGE });
      }
      logger.error('[Server] Error saving app_state:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/security/events (Tylko Administrator)
  app.get('/api/security/events', requireAdmin, async (req, res) => {
    try {
      const rawLimit = parseInt(String(req.query.limit || '100'), 10);
      const limit = Number.isNaN(rawLimit) ? 100 : Math.min(Math.max(rawLimit, 1), 500);
      const filterType = typeof req.query.type === 'string' && req.query.type.trim()
        ? (req.query.type.trim() as SecurityEventType)
        : undefined;

      const events = await stateStore.securityLogger.getRecentEvents(limit, filterType);
      res.json({
        success: true,
        count: events.length,
        events,
      });
    } catch (err: any) {
      logger.error('[Server] Błąd pobierania zdarzeń bezpieczeństwa:', err);
      res.status(500).json({ error: 'Nie udało się pobrać dziennika bezpieczeństwa' });
    }
  });

  // GET /api/backup/status (Wymaga autoryzacji, cache w pamięci 60 s, fs.promises)
  app.get('/api/backup/status', requireAuth, async (_req, res) => {
    try {
      const now = Date.now();
      if (backupStatusCache && (now - backupStatusCache.cachedAt < BACKUP_STATUS_CACHE_TTL_MS)) {
        return res.json(backupStatusCache.data);
      }

      const result = await computeBackupStatus({
        dataDir: config.dataDir,
        maxAgeHours: config.backupMaxAgeHours,
        nowMs: now,
      });

      backupStatusCache = { data: result, cachedAt: now };
      res.json(result);
    } catch (err: any) {
      logger.error('[Server] Błąd pobierania statusu kopii zapasowej:', err);
      res.status(500).json({ active: false, error: err.message });
    }
  });

  // GET /api/admin/system — informacje o systemie, dysku, czasie pracy i kopii zapasowej (tylko admin, bez ścieżek systemowych)
  app.get('/api/admin/system', requireAdmin, async (_req, res) => {
    try {
      const now = Date.now();
      const [diskRaw, backup] = await Promise.all([
        diskStatusCheckOverride ? diskStatusCheckOverride() : getDiskStatus(config.dataDir),
        computeBackupStatus({
          dataDir: config.dataDir,
          maxAgeHours: config.backupMaxAgeHours,
          nowMs: now,
        }),
      ]);

      const disk = diskRaw
        ? {
            freeBytes: diskRaw.freeBytes,
            totalBytes: diskRaw.totalBytes,
            freePercent: diskRaw.freePercent,
            level: classifyDiskLevel(diskRaw),
          }
        : null;

      return res.json({
        version: getLocalInstalledVersion(),
        mode: config.isProduction ? 'production' : 'development',
        disk,
        uptimeSeconds: Math.floor(process.uptime()),
        backup,
      });
    } catch (err: any) {
      logger.error('[Server] Błąd pobierania statusu systemu:', err?.message || err);
      return res.status(500).json({ error: 'Nie udało się pobrać informacji o systemie.' });
    }
  });

  // Sprawdzanie aktualizacji z GitHub (Wymaga autoryzacji, cache serwerowy 6 h)
  app.get('/api/system/check-update', requireAuth, async (req, res) => {
    try {
      const caller = (req as any).user;
      const isAdmin = caller?.role === 'admin';
      const forceFresh = isAdmin && (req.query.fresh === 'true' || req.query.fresh === '1');
      const now = Date.now();

      if (!forceFresh && serverUpdateCache && (now - serverUpdateCache.cachedAt < UPDATE_CACHE_TTL_MS)) {
        return res.json({
          ...serverUpdateCache.data,
          cached: true,
        });
      }

      const localVersion = getLocalInstalledVersion();
      let remoteVersion = localVersion;
      let checkedSource = 'brak połączenia';

      const versionUrl = 'https://raw.githubusercontent.com/FraczekMarcin/Zarzadzanie-Projektami/main/VERSION';
      const vResp = await fetch(`${versionUrl}?t=${Date.now()}`, {
        cache: 'no-cache',
        signal: AbortSignal.timeout(5000),
      }).catch(() => null);

      if (vResp && vResp.ok) {
        const vText = (await vResp.text()).trim();
        if (vText && vText.length > 0 && vText.length < 50) {
          remoteVersion = vText;
          checkedSource = 'plik VERSION na GitHub (gałąź main)';
        }
      } else {
        const pkgUrl = 'https://raw.githubusercontent.com/FraczekMarcin/Zarzadzanie-Projektami/main/package.json';
        const pResp = await fetch(`${pkgUrl}?t=${Date.now()}`, {
          cache: 'no-cache',
          signal: AbortSignal.timeout(5000),
        }).catch(() => null);
        if (pResp && pResp.ok) {
          try {
            const pJson = await pResp.json();
            if (pJson && pJson.version) {
              remoteVersion = `2026-11-02 v ${pJson.version}`;
              checkedSource = 'plik package.json na GitHub (gałąź main)';
            }
          } catch {}
        }
      }

      let latestSha = '';
      let commitMessage = '';
      const ghResp = await fetch('https://api.github.com/repos/FraczekMarcin/Zarzadzanie-Projektami/commits/main', {
        headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'Zarzadzanie-Projektami-Updater' },
        signal: AbortSignal.timeout(5000),
      }).catch(() => null);

      if (ghResp && ghResp.ok) {
        const cData: any = await ghResp.json();
        latestSha = (cData.sha || '').slice(0, 7);
        commitMessage = cData.commit?.message || '';
      }

      const hasUpdate = isNewerVersion(remoteVersion, localVersion);

      const resultData = {
        localVersion,
        remoteVersion,
        hasUpdate,
        checkedSource,
        latestSha,
        commitMessage,
        checkedAt: new Date().toISOString(),
        cached: false,
      };

      serverUpdateCache = {
        data: resultData,
        cachedAt: now,
      };

      res.json(resultData);
    } catch (err: any) {
      if (serverUpdateCache) {
        return res.json({
          ...serverUpdateCache.data,
          cached: true,
          warning: 'Błąd połączenia z GitHub, użyto danych z pamięci podręcznej',
        });
      }
      res.status(500).json({ error: err.message });
    }
  });

  // API Info endpoint (Wymaga sesji użytkownika)
  app.get('/api/system-info', requireAuth, (_req, res) => {
    res.json({
      name: 'Zarządzanie Projektami',
      description: 'System zarządzania projektami z wykresem Gantta, terminarzem i integracją Google Calendar na żywo',
      version: getLocalInstalledVersion(),
      deployment: 'Docker & Trwały Wolumen AppData Ready',
      features: [
        'Gantt Chart Interactive Timeline with Project Names on Bars',
        'Dependency & Blocker Engine',
        'Shared Server-side State Persistence across all PCs',
        'Google Calendar Live Subscription as Another Calendar',
        'Hierarchical Task Tree with Overdue and Approaching Animations',
        'User Authentication and Administrator Approval Gate',
      ],
    });
  });
}
