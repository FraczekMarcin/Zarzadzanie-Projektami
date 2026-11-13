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

export interface StateStore {
  getAppState: () => any;
  setAppState: (next: any) => void;
  getUsers: () => any[];
  setUsers: (next: any[]) => void;
  ensureStateStructure: () => any;
  bumpStateRevision: () => number;
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

export async function createStateStore(config: ServerConfig): Promise<StateStore> {
  const { dataDir, stateFile, effectiveAppSecret, isProduction, reset2faOnStart, storage } = config;

  if (storage !== 'json') {
    console.error(`[Server FATAL] Nieobsługiwany typ magazynu STORAGE="${storage}".`);
    throw new Error('Nieobsługiwany typ magazynu');
  }

  const securityLogger = new SecurityLog(dataDir);

  console.log(`[Server] Ścieżka katalogu danych (DATA_DIR): ${dataDir} (tryb: ${isProduction ? 'produkcja' : 'development'})`);

  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  } catch (err: any) {
    console.error(`[Server FATAL] Nie można utworzyć katalogu danych "${dataDir}": ${err.message}`);
    throw err;
  }

  const testFilePath = path.join(dataDir, `.write_check_${Date.now()}`);
  try {
    fs.writeFileSync(testFilePath, 'ok', 'utf-8');
    fs.unlinkSync(testFilePath);
    console.log(`[Server] Potwierdzono uprawnienia do zapisu w katalogu: ${dataDir}`);
  } catch (err: any) {
    console.error(`[Server FATAL] Brak uprawnień do zapisu w katalogu danych "${dataDir}": ${err.message}`);
    console.error(`[Server FATAL] Upewnij się, że katalog istnieje i posiada odpowiednie uprawnienia zapisu.`);
    throw err;
  }

  const store: PersistenceStateStore = new JsonFileStateStore({
    filePath: stateFile,
    appSecret: effectiveAppSecret,
    isProduction,
    reset2faOnStart,
  });

  let serverAppStateCache: any = null;
  let serverUsersCache: any[] = [];

  const appStateWriter = new StateWriter(async () => {
    await store.save(serverAppStateCache);
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
    return serverAppStateCache.revision;
  }

  // Wczytanie istniejącego stanu przy starcie przez store.load()
  try {
    const loadedState = await store.load();
    if (loadedState) {
      serverAppStateCache = loadedState;
      ensureStateStructure();
      console.log(
        `[Server] Loaded persistent state from ${stateFile} (${serverAppStateCache.tasks.length} tasks, ${serverUsersCache.length} users, revision: ${serverAppStateCache.revision})`
      );
    }
  } catch (err: any) {
    if (isProduction && err?.message === 'APP_SECRET nie pasuje do danych w app_state.json') {
      throw err;
    }
    console.error('[Server] Error reading app_state.json:', err);
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
    saveStateAtomicAsync,
    flushPendingStateSave,
    securityLogger,
  };
}
