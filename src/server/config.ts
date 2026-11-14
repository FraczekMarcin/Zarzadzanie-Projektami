import path from 'path';
import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { validateAppSecret } from '../utils/secretBox.js';

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
}

export interface ServerConfig {
  isProduction: boolean;
  rawAppSecret: string;
  effectiveAppSecret: string;
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
  enableVite: boolean;
  staticDir?: string;
  isDirectRun: boolean;
  storage: string;
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

  const rawAppSecret = (options.appSecret !== undefined ? options.appSecret : (process.env.APP_SECRET || '')).trim();

  if (isProduction) {
    const secretValidation = validateAppSecret(rawAppSecret);
    if (!secretValidation.ok) {
      console.error(`[Server FATAL] Niepoprawna wartość APP_SECRET: ${secretValidation.reason}`);
      console.error('[Server FATAL] Wygeneruj bezpieczny klucz poleceniem: openssl rand -hex 32');
      throw new Error(`Niepoprawna wartość APP_SECRET: ${secretValidation.reason}`);
    }
  }

  const effectiveAppSecret = rawAppSecret || 'zp_dev_app_secret_fallback_2026';
  const port = options.port !== undefined ? options.port : (process.env.PORT || 3000);
  const trustProxy = parseTrustProxyEnv();
  const isReverseProxyHandlingCompression = Boolean(
    process.env.TRUST_PROXY &&
    !['false', '0'].includes(process.env.TRUST_PROXY.trim().toLowerCase())
  );

  const dataDir = options.dataDir !== undefined
    ? options.dataDir
    : (process.env.DATA_DIR || (isProduction ? '/app/data' : './data'));
  const stateFile = path.join(dataDir, 'app_state.json');
  const sessionsFile = path.join(dataDir, 'sessions.json');
  const reset2faOnStart =
    process.env.RESET_2FA_ON_START === 'true' || process.env.RESET_2FA_ON_START === '1';

  const sessionIdleMinutes = parseInt(process.env.SESSION_IDLE_MINUTES || '120', 10) || 120;
  const sessionIdleMs = sessionIdleMinutes * 60 * 1000;
  const sessionMaxHours = parseInt(process.env.SESSION_MAX_HOURS || '12', 10) || 12;
  const sessionMaxMs = sessionMaxHours * 60 * 60 * 1000;

  const rawStorage = options.storage !== undefined ? options.storage : process.env.STORAGE;
  const storage =
    rawStorage !== undefined && rawStorage.trim() !== ''
      ? rawStorage.trim().toLowerCase()
      : 'json';

  const isSelfRegistrationAllowed = (): boolean => {
    if (options.allowSelfRegistration !== undefined) {
      return Boolean(options.allowSelfRegistration);
    }
    if (process.env.ALLOW_SELF_REGISTRATION !== undefined) {
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

  const isSmtpConfigured = (): boolean =>
    Boolean(process.env.SMTP_HOST && process.env.SMTP_HOST.trim().length > 0);

  return {
    isProduction,
    rawAppSecret,
    effectiveAppSecret,
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
    enableVite: options.enableVite !== false,
    staticDir: options.staticDir,
    isDirectRun: Boolean(options.isDirectRun),
    storage,
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
