import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath, pathToFileURL } from 'url';
import { validateAppSecret } from '../utils/secretBox.js';
import type { BackupStatusResult } from './backupStatus.js';
import { logger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Gdy działa z src/server/config.ts -> katalog główny repozytorium;
// gdy skompilowany do dist/src/server/config.js -> katalog dist/.
export const APP_ROOT = path.resolve(__dirname, '..', '..');

export const DUMMY_SCRYPT_HASH =
  'scrypt$16384$8$1$0123456789abcdef0123456789abcdef$0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

export const SESSION_DISK_FLUSH_INTERVAL_MS = 5 * 60 * 1000; // 5 minut
export const BACKUP_STATUS_CACHE_TTL_MS = 60 * 1000; // 60 sekund
export const UPDATE_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 godzin cache

export interface CreateAppOptions {
  dataDir?: string;
  appSecret?: string;
  port?: number | string;
  isProduction?: boolean;
  allowSelfRegistration?: boolean;
  setupToken?: string;
  enableVite?: boolean;
  staticDir?: string;
  isDirectRun?: boolean;
  storage?: string;
  publicBaseUrl?: string;
  sessionIdleMs?: number;
  googleServiceAccountFile?: string;
  googleCalendarId?: string;
  googleSyncClient?: any;
  googleSyncDisableTimers?: boolean;
  backupMaxAgeHours?: number;
  backupAlertEmails?: string[];
  backupWatchDisableTimers?: boolean;
  trashCleanupDisableTimers?: boolean;
  remindersDisableTimers?: boolean;
  backupStatusCheckOverride?: () => Promise<BackupStatusResult>;
  backupAlertMailer?: (mail: { to: string[]; subject: string; text: string; html?: string }) => Promise<void>;
}

export interface ServerConfig {
  isProduction: boolean;
  rawAppSecret: string;
  effectiveAppSecret: string;
  appSecretSource: 'env' | 'dev_file' | 'option';
  devAppSecretNeedsPersist: boolean;
  port: number | string;
  trustProxy: boolean | number | string;
  isReverseProxyHandlingCompression: boolean;
  dataDir: string;
  stateFile: string;
  sessionsFile: string;
  reset2faOnStart: boolean;
  sessionIdleMinutes: number;
  sessionIdleMs: number;
  sessionMaxHours: number;
  sessionMaxMs: number;
  allowSelfRegistrationOverride?: boolean;
  sessionIdleMsOverride?: number;
  enableVite: boolean;
  staticDir?: string;
  isDirectRun: boolean;
  storage: string;
  publicBaseUrl: string;
  defaultReminderAppBaseUrl: string;
  googleServiceAccountFile: string;
  googleCalendarId: string;
  backupMaxAgeHours: number;
  backupAlertEmails: string[];
  isSelfRegistrationAllowed: () => boolean;
  getSetupToken: () => string;
  isSetupTokenRequired: () => boolean;
  isSmtpConfigured: () => boolean;
}

export function isDirectRunEntry(moduleFilename: string, moduleUrl: string): boolean {
  if (!process.argv[1]) return false;
  try {
    const resolvedArgv = fs.realpathSync(path.resolve(process.argv[1]));
    const resolvedModule = fs.realpathSync(moduleFilename);
    return (
      pathToFileURL(resolvedArgv).href === pathToFileURL(resolvedModule).href ||
      moduleUrl === pathToFileURL(path.resolve(process.argv[1])).href
    );
  } catch {
    return moduleUrl === pathToFileURL(path.resolve(process.argv[1])).href;
  }
}

export function parseTrustProxyEnv(): boolean | number | string {
  if (!process.env.TRUST_PROXY) return false;
  const tp = process.env.TRUST_PROXY.trim().toLowerCase();
  if (tp === 'true') return true;
  if (tp === 'false' || tp === '0') return false;
  if (/^\d+$/.test(tp)) return parseInt(tp, 10);
  return process.env.TRUST_PROXY.trim();
}

export function resolveServerConfig(options: CreateAppOptions = {}): ServerConfig {
  const isProduction = options.isProduction !== undefined
    ? options.isProduction
    : process.env.NODE_ENV === 'production';

  const dataDir = options.dataDir !== undefined
    ? options.dataDir
    : (process.env.DATA_DIR?.trim() || (isProduction ? '/app/data' : './data'));
  const stateFile = path.join(dataDir, 'app_state.json');
  const sessionsFile = path.join(dataDir, 'sessions.json');

  const optionSecret = options.appSecret !== undefined ? options.appSecret.trim() : undefined;
  const envSecret = (process.env.APP_SECRET || '').trim();
  const rawAppSecret = optionSecret !== undefined ? optionSecret : envSecret;

  let effectiveAppSecret = rawAppSecret;
  let appSecretSource: 'env' | 'dev_file' | 'option' = optionSecret !== undefined ? 'option' : 'env';
  let devAppSecretNeedsPersist = false;

  if (isProduction) {
    const secretValidation = validateAppSecret(rawAppSecret);
    if (!secretValidation.ok) {
      logger.error(`[Server FATAL] Niepoprawna wartość APP_SECRET: ${secretValidation.reason}`);
      logger.error('[Server FATAL] Wygeneruj bezpieczny klucz poleceniem: openssl rand -hex 32');
      throw new Error(`Niepoprawna wartość APP_SECRET: ${secretValidation.reason}`);
    }
  } else if (!rawAppSecret) {
    appSecretSource = 'dev_file';
    const devSecretFile = path.join(dataDir, '.dev_app_secret');
    let loadedSecret = '';
    try {
      if (fs.existsSync(devSecretFile)) {
        const content = fs.readFileSync(devSecretFile, 'utf-8').trim();
        if (content.length >= 32) {
          loadedSecret = content;
        }
      }
    } catch {
      // Ignoruj błąd odczytu – wygenerujemy nowy klucz
    }

    if (loadedSecret) {
      effectiveAppSecret = loadedSecret;
    } else {
      effectiveAppSecret = crypto.randomBytes(32).toString('hex');
      devAppSecretNeedsPersist = true;
    }
  }

  const port = options.port !== undefined ? options.port : (process.env.PORT || 3000);
  const trustProxy = parseTrustProxyEnv();
  const isReverseProxyHandlingCompression = Boolean(
    process.env.TRUST_PROXY &&
    !['false', '0'].includes(process.env.TRUST_PROXY.trim().toLowerCase())
  );

  const reset2faOnStart =
    process.env.RESET_2FA_ON_START === 'true' || process.env.RESET_2FA_ON_START === '1';

  const sessionIdleMinutes = parseInt(process.env.SESSION_IDLE_MINUTES || '120', 10) || 120;
  const sessionIdleMs =
    typeof options.sessionIdleMs === 'number' && options.sessionIdleMs > 0
      ? options.sessionIdleMs
      : sessionIdleMinutes * 60 * 1000;
  const sessionMaxHours = parseInt(process.env.SESSION_MAX_HOURS || '12', 10) || 12;
  const sessionMaxMs = sessionMaxHours * 60 * 60 * 1000;

  const rawStorage = options.storage !== undefined ? options.storage : process.env.STORAGE;
  const storage =
    rawStorage !== undefined && rawStorage.trim() !== ''
      ? rawStorage.trim().toLowerCase()
      : 'json';

  const rawPublicBaseUrl =
    options.publicBaseUrl !== undefined ? options.publicBaseUrl : (process.env.PUBLIC_BASE_URL || '');
  const publicBaseUrl = rawPublicBaseUrl.trim().replace(/\/+$/, '');

  const rawAppHost = (process.env.APP_HOST || '').trim();
  const cleanAppHost = rawAppHost.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const isHttpsMode =
    isReverseProxyHandlingCompression ||
    String(process.env.COMPOSE_FILE || '').toLowerCase().includes('https');
  const defaultReminderAppBaseUrl = publicBaseUrl
    ? publicBaseUrl
    : isHttpsMode && cleanAppHost
    ? `https://${cleanAppHost}`
    : '';

  const googleServiceAccountFile = (
    options.googleServiceAccountFile !== undefined
      ? options.googleServiceAccountFile
      : (process.env.GOOGLE_SERVICE_ACCOUNT_FILE || '')
  ).trim();
  const googleCalendarId = (
    options.googleCalendarId !== undefined
      ? options.googleCalendarId
      : (process.env.GOOGLE_CALENDAR_ID || '')
  ).trim();

  const isSelfRegistrationAllowed = (): boolean => {
    if (options.allowSelfRegistration !== undefined) {
      return Boolean(options.allowSelfRegistration);
    }
    if (process.env.ALLOW_SELF_REGISTRATION !== undefined && process.env.ALLOW_SELF_REGISTRATION.trim() !== '') {
      const val = process.env.ALLOW_SELF_REGISTRATION.trim().toLowerCase();
      return val !== 'false' && val !== '0' && val !== 'no';
    }
    return true;
  };

  const getSetupToken = (): string => {
    if (options.setupToken !== undefined) {
      return String(options.setupToken).trim();
    }
    return (process.env.SETUP_TOKEN || '').trim();
  };

  const isSetupTokenRequired = (): boolean => getSetupToken().length > 0;

  const rawBackupMaxAge = Number(process.env.BACKUP_MAX_AGE_HOURS);
  const backupMaxAgeHours =
    typeof options.backupMaxAgeHours === 'number' &&
    Number.isFinite(options.backupMaxAgeHours) &&
    options.backupMaxAgeHours > 0
      ? options.backupMaxAgeHours
      : Number.isFinite(rawBackupMaxAge) && rawBackupMaxAge > 0
      ? rawBackupMaxAge
      : 36;

  const backupAlertEmails = (
    options.backupAlertEmails !== undefined
      ? options.backupAlertEmails
      : String(process.env.BACKUP_ALERT_EMAILS || '').split(',')
  )
    .map((e) => e.trim())
    .filter(Boolean);

  const isSmtpConfigured = (): boolean =>
    Boolean(process.env.SMTP_HOST && process.env.SMTP_HOST.trim().length > 0);

  return {
    isProduction,
    rawAppSecret,
    effectiveAppSecret,
    appSecretSource,
    devAppSecretNeedsPersist,
    port,
    trustProxy,
    isReverseProxyHandlingCompression,
    dataDir,
    stateFile,
    sessionsFile,
    reset2faOnStart,
    sessionIdleMinutes,
    sessionIdleMs,
    sessionMaxHours,
    sessionMaxMs,
    allowSelfRegistrationOverride: options.allowSelfRegistration,
    sessionIdleMsOverride:
      typeof options.sessionIdleMs === 'number' && options.sessionIdleMs > 0
        ? options.sessionIdleMs
        : undefined,
    enableVite: options.enableVite !== false,
    staticDir: options.staticDir,
    isDirectRun: Boolean(options.isDirectRun),
    storage,
    publicBaseUrl,
    defaultReminderAppBaseUrl,
    googleServiceAccountFile,
    googleCalendarId,
    backupMaxAgeHours,
    backupAlertEmails,
    isSelfRegistrationAllowed,
    getSetupToken,
    isSetupTokenRequired,
    isSmtpConfigured,
  };
}

export function getLocalInstalledVersion(): string {
  const envVersion = process.env.APP_VERSION?.trim();
  if (envVersion) {
    return envVersion;
  }
  try {
    const candidates = [
      path.resolve(process.cwd(), 'VERSION'),
      path.resolve(APP_ROOT, 'VERSION'),
      path.resolve(APP_ROOT, '..', 'VERSION'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        const v = fs.readFileSync(p, 'utf8').trim();
        if (v && v.length > 0) return v;
      }
    }
  } catch {}
  return 'unknown';
}

export function isNewerVersion(remote: string, local: string): boolean {
  if (!remote || !local) return false;
  if (remote === local) return false;

  const rMatch = remote.match(/(\d{4})[-.](\d{2})[-.](\d{2})/);
  const lMatch = local.match(/(\d{4})[-.](\d{2})[-.](\d{2})/);
  if (rMatch && lMatch) {
    const rDate = parseInt(`${rMatch[1]}${rMatch[2]}${rMatch[3]}`, 10);
    const lDate = parseInt(`${lMatch[1]}${lMatch[2]}${lMatch[3]}`, 10);
    if (rDate > lDate) return true;
    if (rDate < lDate) return false;
  }

  const rSem = remote.match(/v\s*(\d+)\.(\d+)(?:\.(\d+))?/i);
  const lSem = local.match(/v\s*(\d+)\.(\d+)(?:\.(\d+))?/i);
  if (rSem && lSem) {
    const rMaj = parseInt(rSem[1] || '0', 10);
    const rMin = parseInt(rSem[2] || '0', 10);
    const rPat = parseInt(rSem[3] || '0', 10);

    const lMaj = parseInt(lSem[1] || '0', 10);
    const lMin = parseInt(lSem[2] || '0', 10);
    const lPat = parseInt(lSem[3] || '0', 10);

    if (rMaj !== lMaj) return rMaj > lMaj;
    if (rMin !== lMin) return rMin > lMin;
    return rPat > lPat;
  }

  return false;
}
