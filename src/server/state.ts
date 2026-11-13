import fs from 'fs';
import path from 'path';
import { encryptSecret, decryptUserSecrets } from '../utils/secretBox.js';
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
  const { dataDir, stateFile, effectiveAppSecret, isProduction, reset2faOnStart } = config;
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

  let serverAppStateCache: any = null;
  let serverUsersCache: any[] = [];

  function serializeStateForDisk(state: any): string {
    if (!state) return JSON.stringify(state);
    const stateCopy = {
      ...state,
      users: (state.users || []).map((u: any) => {
        const uCopy = { ...u };
        if (uCopy.twoFactorSecret && typeof uCopy.twoFactorSecret === 'string') {
          uCopy.twoFactorSecret = encryptSecret(uCopy.twoFactorSecret, effectiveAppSecret);
        }
        if (uCopy.pending2FA && typeof uCopy.pending2FA.secret === 'string') {
          uCopy.pending2FA = {
            ...uCopy.pending2FA,
            secret: encryptSecret(uCopy.pending2FA.secret, effectiveAppSecret),
          };
        }
        return uCopy;
      }),
    };
    return JSON.stringify(stateCopy);
  }

  async function executeDiskWrite(): Promise<void> {
    const tmpFile = path.join(dataDir, 'app_state.json.tmp');
    const content = serializeStateForDisk(serverAppStateCache);
    const handle = await fs.promises.open(tmpFile, 'w');
    try {
      await handle.writeFile(content, 'utf-8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.promises.rename(tmpFile, stateFile);
  }

  const appStateWriter = new StateWriter(executeDiskWrite);

  function saveStateAtomicAsync(): Promise<void> {
    return appStateWriter.save();
  }

  async function flushPendingStateSave(): Promise<void> {
    return appStateWriter.flush();
  }

  function ensureStateStructure() {
    if (!serverAppStateCache) {
      serverAppStateCache = {
        initialized: true,
        revision: 0,
        tasks: [],
        projects: [],
        users: [],
        comments: [],
        activityLogs: [],
        updatedAt: new Date().toISOString(),
      };
    }
    if (typeof serverAppStateCache.revision !== 'number') {
      serverAppStateCache.revision = 0;
    }
    if (!Array.isArray(serverAppStateCache.tasks)) serverAppStateCache.tasks = [];
    if (!Array.isArray(serverAppStateCache.projects)) serverAppStateCache.projects = [];
    if (!Array.isArray(serverAppStateCache.users)) serverAppStateCache.users = [];
    if (!Array.isArray(serverAppStateCache.comments)) serverAppStateCache.comments = [];
    if (!Array.isArray(serverAppStateCache.activityLogs)) serverAppStateCache.activityLogs = [];

    for (const t of serverAppStateCache.tasks) {
      if (typeof t.revision !== 'number') t.revision = 1;
    }
    for (const p of serverAppStateCache.projects) {
      if (typeof p.revision !== 'number') p.revision = 1;
    }

    serverUsersCache = serverAppStateCache.users;
    return serverAppStateCache;
  }

  function bumpStateRevision(): number {
    ensureStateStructure();
    serverAppStateCache.revision = (serverAppStateCache.revision || 0) + 1;
    serverAppStateCache.updatedAt = new Date().toISOString();
    return serverAppStateCache.revision;
  }

  // Wczytanie istniejącego stanu przy starcie
  if (fs.existsSync(stateFile)) {
    try {
      const raw = fs.readFileSync(stateFile, 'utf-8');
      serverAppStateCache = JSON.parse(raw);
      ensureStateStructure();

      const decryptResult = decryptUserSecrets(
        serverAppStateCache.users,
        effectiveAppSecret,
        { resetOnFailure: reset2faOnStart }
      );

      serverAppStateCache.users = decryptResult.users;
      serverUsersCache = serverAppStateCache.users;

      if (decryptResult.failed.length > 0) {
        const affectedEmails = Array.from(new Set(decryptResult.failed.map((f) => f.email || f.userId)));
        if (reset2faOnStart) {
          console.warn(
            `[Server WARN] Uruchomiono z RESET_2FA_ON_START=true: zresetowano 2FA u ${affectedEmails.length} użytkowników, których sekretów nie można było odszyfrować:`
          );
          for (const email of affectedEmails) {
            console.warn(` - ${email}`);
          }
          await saveStateAtomicAsync();
        } else if (isProduction) {
          console.error(
            'APP_SECRET nie pasuje do danych w app_state.json; przywróć poprawny APP_SECRET z .env sprzed zmiany albo, ostatecznie, uruchom z RESET_2FA_ON_START=true.'
          );
          throw new Error('APP_SECRET nie pasuje do danych w app_state.json');
        } else {
          console.warn(
            `[Server WARN] APP_SECRET nie pasuje do danych 2FA użytkowników: ${affectedEmails.join(', ')} (tryb development - kontynuacja).`
          );
        }
      } else if (decryptResult.migrated) {
        console.log('[Server] Wykryto niezaszyfrowane sekrety 2FA w app_state.json - zostaną zaszyfrowane przy zapisie.');
        saveStateAtomicAsync();
      }

      console.log(
        `[Server] Loaded persistent state from ${stateFile} (${serverAppStateCache.tasks.length} tasks, ${serverUsersCache.length} users, revision: ${serverAppStateCache.revision})`
      );
    } catch (err: any) {
      if (isProduction && err?.message === 'APP_SECRET nie pasuje do danych w app_state.json') {
        throw err;
      }
      console.error('[Server] Error reading app_state.json:', err);
    }
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
