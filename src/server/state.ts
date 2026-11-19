import fs from 'fs';
import path from 'path';
import {
  JsonFileStateStore,
  StateStore as PersistenceStateStore,
  normalizeStateStructure,
} from '../utils/stateStore.js';
import { StateWriter } from '../utils/stateWriter.js';
import { SecurityLog } from '../utils/securityLog.js';
import { ServerConfig } from './config.js';
import { logger } from './logger.js';

export const DISK_FULL_ERROR_MESSAGE =
  'Brak miejsca na dysku serwera. Zmiana nie została zapisana.';
export const DISK_WRITE_FAILED_COOLDOWN_MS = 10 * 60 * 1000;

export function isDiskFullError(err: any): boolean {
  return Boolean(
    err &&
      (err.code === 'ENOSPC' ||
        err.cause?.code === 'ENOSPC' ||
        err.status === 507 ||
        err.statusCode === 507)
  );
}

export function createDiskFullError(): Error & { status: number; code: string } {
  const err = new Error(DISK_FULL_ERROR_MESSAGE) as Error & { status: number; code: string };
  err.status = 507;
  err.code = 'ENOSPC';
  return err;
}

export interface StateStore {
  getAppState: () => any;
  setAppState: (next: any) => void;
  getUsers: () => any[];
  setUsers: (next: any[]) => void;
  ensureStateStructure: () => any;
  bumpStateRevision: () => number;
  onRevisionChange: (listener: (revision: number) => void) => () => void;
  saveStateAtomicAsync: () => Promise<void>;
  flushPendingStateSave: () => Promise<void>;
  securityLogger: SecurityLog;
}

export function sanitizeUser(u: any) {
  if (!u) return u;
  const {
    passwordHash,
    password,
    totpSecret,
    twoFactorSecret,
    twoFactorBackupCodes,
    pending2FA,
    calendarTokenHash,
    ...rest
  } = u;
  return {
    ...rest,
    hasPassword: Boolean(passwordHash || password),
    twoFactorEnabled: Boolean(u.twoFactorEnabled),
    backupCodesCount: Array.isArray(twoFactorBackupCodes) ? twoFactorBackupCodes.length : 0,
    hasCalendarToken: Boolean(calendarTokenHash),
  };
}

export async function tightenDataFilePermissions(filePath: string): Promise<void> {
  try {
    const st = await fs.promises.stat(filePath);
    if (!st.isFile()) return;
    const mode = st.mode & 0o777;
    if ((mode & 0o177) !== 0) {
      await fs.promises.chmod(filePath, 0o600);
    }
  } catch (err: any) {
    if (err?.code === 'ENOENT') return;
    logger.warn(`[Server WARN] Nie udało się ustawić uprawnień 0o600 dla pliku "${filePath}": ${err?.message || err}`);
  }
}

export async function createStateStore(config: ServerConfig): Promise<StateStore> {
  const { dataDir, stateFile, sessionsFile, effectiveAppSecret, isProduction, reset2faOnStart, storage } = config;

  if (storage !== 'json') {
    logger.error(`[Server FATAL] Nieobsługiwany typ magazynu STORAGE="${storage}".`);
    throw new Error('Nieobsługiwany typ magazynu');
  }

  const securityLogger = new SecurityLog(dataDir);

  logger.info(`[Server] Ścieżka katalogu danych (DATA_DIR): ${dataDir} (tryb: ${isProduction ? 'produkcja' : 'development'})`);

  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  } catch (err: any) {
    logger.error(`[Server FATAL] Nie można utworzyć katalogu danych "${dataDir}": ${err.message}`);
    throw err;
  }

  const testFilePath = path.join(dataDir, `.write_check_${Date.now()}`);
  try {
    fs.writeFileSync(testFilePath, 'ok', { encoding: 'utf-8', mode: 0o600 });
    fs.unlinkSync(testFilePath);
    logger.info(`[Server] Potwierdzono uprawnienia do zapisu w katalogu: ${dataDir}`);
  } catch (err: any) {
    logger.error(`[Server FATAL] Brak uprawnień do zapisu w katalogu danych "${dataDir}": ${err.message}`);
    logger.error(`[Server FATAL] Upewnij się, że katalog istnieje i posiada odpowiednie uprawnienia zapisu.`);
    throw err;
  }

  if (config.devAppSecretNeedsPersist) {
    const devSecretFile = path.join(dataDir, '.dev_app_secret');
    try {
      if (!fs.existsSync(devSecretFile)) {
        fs.writeFileSync(devSecretFile, effectiveAppSecret + '\n', { encoding: 'utf-8', mode: 0o600 });
        fs.chmodSync(devSecretFile, 0o600);
        logger.info(`[Server] Wygenerowano lokalny klucz szyfrowania w ${devSecretFile} (uprawnienia 600).`);
      }
    } catch (err: any) {
      logger.warn(`[Server WARN] Nie udało się zapisać pliku ${devSecretFile}: ${err?.message || err}`);
    }
  }

  const dataFilesToHarden = [
    stateFile,
    `${stateFile}.tmp`,
    sessionsFile,
    `${sessionsFile}.tmp`,
    path.join(dataDir, '.dev_app_secret'),
    path.join(dataDir, 'security_log.jsonl'),
    path.join(dataDir, 'security_log.1.jsonl'),
    path.join(dataDir, 'security_log.2.jsonl'),
    path.join(dataDir, 'security_log.3.jsonl'),
  ];
  for (const filePath of dataFilesToHarden) {
    await tightenDataFilePermissions(filePath);
  }

  const store: PersistenceStateStore = new JsonFileStateStore({
    filePath: stateFile,
    appSecret: effectiveAppSecret,
    isProduction,
    reset2faOnStart,
  });

  let serverAppStateCache: any = null;
  let serverUsersCache: any[] = [];
  const revisionListeners = new Set<(revision: number) => void>();

  let lastDiskWriteFailedEventAtMs: number | null = null;

  const appStateWriter = new StateWriter(async () => {
    try {
      await store.save(serverAppStateCache);
    } catch (err: any) {
      if (isDiskFullError(err)) {
        logger.error('[Server] Brak miejsca na dysku podczas zapisu stanu aplikacji (ENOSPC).');
        const nowMs = Date.now();
        if (
          lastDiskWriteFailedEventAtMs === null ||
          nowMs - lastDiskWriteFailedEventAtMs >= DISK_WRITE_FAILED_COOLDOWN_MS
        ) {
          lastDiskWriteFailedEventAtMs = nowMs;
          await securityLogger
            .record('disk_write_failed', {
              details: { reason: 'ENOSPC' },
            })
            .catch(() => {});
        }
        throw createDiskFullError();
      }
      throw err;
    }
  });

  function saveStateAtomicAsync(): Promise<void> {
    return appStateWriter.save();
  }

  async function flushPendingStateSave(): Promise<void> {
    return appStateWriter.flush();
  }

  function ensureStateStructure() {
    serverAppStateCache = normalizeStateStructure(serverAppStateCache);
    serverUsersCache = serverAppStateCache.users;
    return serverAppStateCache;
  }

  function bumpStateRevision(): number {
    ensureStateStructure();
    serverAppStateCache.revision = (serverAppStateCache.revision || 0) + 1;
    serverAppStateCache.updatedAt = new Date().toISOString();
    const nextRevision = serverAppStateCache.revision;
    for (const listener of revisionListeners) {
      try {
        listener(nextRevision);
      } catch (err) {
        logger.error('[Server] Błąd powiadomienia słuchacza zmiany rewizji:', err);
      }
    }
    return nextRevision;
  }

  function onRevisionChange(listener: (revision: number) => void): () => void {
    revisionListeners.add(listener);
    return () => {
      revisionListeners.delete(listener);
    };
  }

  // Wczytanie istniejącego stanu przy starcie przez store.load()
  try {
    const loadedState = await store.load();
    if (loadedState) {
      serverAppStateCache = loadedState;
      ensureStateStructure();
      logger.info(
        `[Server] Loaded persistent state from ${stateFile} (${serverAppStateCache.tasks.length} tasks, ${serverUsersCache.length} users, revision: ${serverAppStateCache.revision})`
      );
    }
  } catch (err: any) {
    if (isProduction && err?.message === 'APP_SECRET nie pasuje do danych w app_state.json') {
      throw err;
    }
    logger.error('[Server] Error reading app_state.json:', err);
  }

  return {
    getAppState: () => serverAppStateCache,
    setAppState: (next: any) => {
      serverAppStateCache = next;
      if (next && Array.isArray(next.users)) {
        serverUsersCache = next.users;
      }
    },
    getUsers: () => serverUsersCache,
    setUsers: (next: any[]) => {
      serverUsersCache = next;
      if (serverAppStateCache) {
        serverAppStateCache.users = next;
      }
    },
    ensureStateStructure,
    bumpStateRevision,
    onRevisionChange,
    saveStateAtomicAsync,
    flushPendingStateSave,
    securityLogger,
  };
}
