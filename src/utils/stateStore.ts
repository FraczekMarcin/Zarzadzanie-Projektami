import fs from 'fs';
import path from 'path';
import { encryptSecret, decryptUserSecrets } from './secretBox.js';

export interface AppState {
  initialized?: boolean;
  revision: number;
  tasks: any[];
  projects: any[];
  users: any[];
  comments: any[];
  activityLogs: any[];
  updatedAt?: string;
  [key: string]: any;
}

export interface StateStore {
  load(): Promise<AppState | null>;
  save(state: AppState): Promise<void>;
}

export function normalizeStateStructure(raw?: any): AppState {
  const state: AppState = raw && typeof raw === 'object'
    ? raw
    : {
        initialized: true,
        revision: 0,
        tasks: [],
        projects: [],
        users: [],
        comments: [],
        activityLogs: [],
        updatedAt: new Date().toISOString(),
      };

  if (typeof state.revision !== 'number') {
    state.revision = 0;
  }
  if (!Array.isArray(state.tasks)) state.tasks = [];
  if (!Array.isArray(state.projects)) state.projects = [];
  if (!Array.isArray(state.users)) state.users = [];
  if (!Array.isArray(state.comments)) state.comments = [];
  if (!Array.isArray(state.activityLogs)) state.activityLogs = [];

  for (const t of state.tasks) {
    if (t && typeof t.revision !== 'number') t.revision = 1;
  }
  for (const p of state.projects) {
    if (p && typeof p.revision !== 'number') p.revision = 1;
  }

  return state;
}

export function serializeStateForDisk(state: AppState | null | undefined, appSecret: string): string {
  if (!state) return JSON.stringify(state);
  const stateCopy = {
    ...state,
    users: (state.users || []).map((u: any) => {
      const uCopy = { ...u };
      if (uCopy.twoFactorSecret && typeof uCopy.twoFactorSecret === 'string') {
        uCopy.twoFactorSecret = encryptSecret(uCopy.twoFactorSecret, appSecret);
      }
      if (uCopy.pending2FA && typeof uCopy.pending2FA.secret === 'string') {
        uCopy.pending2FA = {
          ...uCopy.pending2FA,
          secret: encryptSecret(uCopy.pending2FA.secret, appSecret),
        };
      }
      return uCopy;
    }),
  };
  return JSON.stringify(stateCopy);
}

export interface JsonFileStateStoreOptions {
  filePath: string;
  appSecret: string;
  isProduction?: boolean;
  reset2faOnStart?: boolean;
}

export class JsonFileStateStore implements StateStore {
  private readonly filePath: string;
  private readonly appSecret: string;
  private readonly isProduction: boolean;
  private readonly reset2faOnStart: boolean;

  constructor(options: JsonFileStateStoreOptions) {
    this.filePath = options.filePath;
    this.appSecret = options.appSecret;
    this.isProduction = options.isProduction ?? true;
    this.reset2faOnStart = options.reset2faOnStart ?? false;
  }

  async load(): Promise<AppState | null> {
    if (!fs.existsSync(this.filePath)) {
      return null;
    }

    const raw = await fs.promises.readFile(this.filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    const state = normalizeStateStructure(parsed);

    const decryptResult = decryptUserSecrets(state.users, this.appSecret, {
      resetOnFailure: this.reset2faOnStart,
    });

    state.users = decryptResult.users;

    if (decryptResult.failed.length > 0) {
      const affectedEmails = Array.from(
        new Set(decryptResult.failed.map((f) => f.email || f.userId))
      );
      if (this.reset2faOnStart) {
        console.warn(
          `[Server WARN] Uruchomiono z RESET_2FA_ON_START=true: zresetowano 2FA u ${affectedEmails.length} użytkowników, których sekretów nie można było odszyfrować:`
        );
        for (const email of affectedEmails) {
          console.warn(` - ${email}`);
        }
        await this.save(state);
      } else if (this.isProduction) {
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
      console.log(
        '[Server] Wykryto niezaszyfrowane sekrety 2FA w app_state.json - zostaną zaszyfrowane przy zapisie.'
      );
      await this.save(state);
    }

    return state;
  }

  async save(state: AppState): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.promises.mkdir(dir, { recursive: true });
    const tmpFile = `${this.filePath}.tmp`;
    const content = serializeStateForDisk(state, this.appSecret);
    let handle: fs.promises.FileHandle | null = null;
    try {
      handle = await fs.promises.open(tmpFile, 'w');
      await handle.writeFile(content, 'utf-8');
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.promises.rename(tmpFile, this.filePath);
    } catch (err) {
      if (handle) {
        await handle.close().catch(() => {});
      }
      await fs.promises.unlink(tmpFile).catch(() => {});
      throw err;
    }
  }
}

function cloneAppState(state: AppState): AppState {
  return JSON.parse(JSON.stringify(state));
}

export class MemoryStateStore implements StateStore {
  private snapshot: AppState | null;

  constructor(initialState: AppState | null = null) {
    this.snapshot = initialState ? cloneAppState(initialState) : null;
  }

  async load(): Promise<AppState | null> {
    if (!this.snapshot) return null;
    return cloneAppState(this.snapshot);
  }

  async save(state: AppState): Promise<void> {
    this.snapshot = cloneAppState(state);
  }
}
