import express from 'express';
import compression from 'compression';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';
import 'dotenv/config';
import { buildIcs } from './src/utils/icsBuilder.js';
import {
  filterStateForUser,
  filterProjectForUser,
  canAccessProject,
  canWrite,
  hasForbiddenKeys,
  pickAllowedTaskFields,
  pickAllowedProjectFields,
  isSameOrigin,
} from './src/utils/access.js';
import {
  generateBase32Secret,
  generate10BackupCodes,
  calculateTotpForStep,
  verifyTotpStrict,
  verifyAndConsumeBackupCode,
  getOtpAuthUrl,
} from './src/utils/totp.js';
import { createRateLimiter } from './src/utils/rateLimit.js';
import {
  encryptSecret,
  decryptSecret,
  decryptUserSecrets,
  isEncryptedSecret,
  validateAppSecret,
} from './src/utils/secretBox.js';
import { StateWriter } from './src/utils/stateWriter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProduction = process.env.NODE_ENV === 'production';
const rawAppSecret = (process.env.APP_SECRET || '').trim();

if (isProduction) {
  const secretValidation = validateAppSecret(rawAppSecret);
  if (!secretValidation.ok) {
    console.error(`[Server FATAL] Niepoprawna wartość APP_SECRET: ${secretValidation.reason}`);
    console.error('[Server FATAL] Wygeneruj bezpieczny klucz poleceniem: openssl rand -hex 32');
    process.exit(1);
  }
}
const effectiveAppSecret = rawAppSecret || 'zp_dev_app_secret_fallback_2026';

const app = express();
app.disable('x-powered-by');
const PORT = process.env.PORT || 3000;

// Konfiguracja trust proxy: x-forwarded-proto i x-forwarded-for ufaj TYLKO gdy ustawione TRUST_PROXY
if (process.env.TRUST_PROXY) {
  const tp = process.env.TRUST_PROXY.trim().toLowerCase();
  if (tp === 'true') {
    app.set('trust proxy', true);
  } else if (tp === 'false' || tp === '0') {
    app.set('trust proxy', false);
  } else if (/^\d+$/.test(tp)) {
    app.set('trust proxy', parseInt(tp, 10));
  } else {
    app.set('trust proxy', process.env.TRUST_PROXY.trim());
  }
} else {
  app.set('trust proxy', false);
}

// Kompresja odpowiedzi HTTP (gzip/deflate/br) dla odpowiedzi tekstowych.
// Decyzja: Gdy TRUST_PROXY wskazuje obecność zewnętrznego reverse proxy (np. Nginx, Cloudflare, Traefik),
// to kompresję wykonuje brzeg sieciowy / reverse proxy (odciążając proces Node.js).
// Jeśli serwer działa bezpośrednio bez proxy (brak TRUST_PROXY lub fałsz), włączamy bibliotekę compression w aplikacji.
const isReverseProxyHandlingCompression = Boolean(
  process.env.TRUST_PROXY &&
  !['false', '0'].includes(process.env.TRUST_PROXY.trim().toLowerCase())
);

if (!isReverseProxyHandlingCompression) {
  app.use(
    compression({
      filter: (req, res) => {
        if (req.headers['x-no-compression']) {
          return false;
        }
        return compression.filter(req, res);
      },
      threshold: 1024, // kompresuj odpowiedzi powyżej 1 KB
    })
  );
}

function isRequestHttps(req: express.Request): boolean {
  if (req.app.get('trust proxy')) {
    const xfp = req.headers['x-forwarded-proto'];
    const proto = Array.isArray(xfp)
      ? xfp[0]?.toLowerCase().trim()
      : typeof xfp === 'string'
      ? xfp.split(',')[0].toLowerCase().trim()
      : '';
    return Boolean(req.secure || proto === 'https');
  }
  return Boolean(req.secure);
}

// Nagłówki bezpieczeństwa HTTP (Security Headers, Content-Security-Policy, Permissions-Policy, COOP, HSTS)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self';"
  );
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (isRequestHttps(req)) {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  }
  if (req.path.startsWith('/api')) {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
});

// Wszystkie odpowiedzi /api/* dostają Cache-Control: no-store
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// Ograniczenie rozmiaru JSON: domyślnie 100kb, dla POST /api/state 10mb
const json100kb = express.json({ limit: '100kb' });
const json10mb = express.json({ limit: '10mb' });

app.use((req, res, next) => {
  if (req.method === 'POST' && req.path === '/api/state') {
    return json10mb(req, res, next);
  }
  return json100kb(req, res, next);
});

// Persistent shared database directory for all clients
const DATA_DIR = process.env.DATA_DIR || (process.env.NODE_ENV === 'production' ? '/app/data' : './data');
const STATE_FILE = path.join(DATA_DIR, 'app_state.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

console.log(`[Server] Ścieżka katalogu danych (DATA_DIR): ${DATA_DIR} (tryb: ${isProduction ? 'produkcja' : 'development'})`);

// Ensure data directory exists
try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
} catch (err: any) {
  console.error(`[Server FATAL] Nie można utworzyć katalogu danych "${DATA_DIR}": ${err.message}`);
  process.exit(1);
}

// Sprawdź zapisywalność DATA_DIR (zapis i usunięcie pliku testowego)
const testFilePath = path.join(DATA_DIR, `.write_check_${Date.now()}`);
try {
  fs.writeFileSync(testFilePath, 'ok', 'utf-8');
  fs.unlinkSync(testFilePath);
  console.log(`[Server] Potwierdzono uprawnienia do zapisu w katalogu: ${DATA_DIR}`);
} catch (err: any) {
  console.error(`[Server FATAL] Brak uprawnień do zapisu w katalogu danych "${DATA_DIR}": ${err.message}`);
  console.error(`[Server FATAL] Upewnij się, że katalog istnieje i posiada odpowiednie uprawnienia zapisu.`);
  process.exit(1);
}

// In-memory cache for live synchronization and Google Calendar iCal feeds
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
  const tmpFile = path.join(DATA_DIR, 'app_state.json.tmp');
  const content = serializeStateForDisk(serverAppStateCache);
  const handle = await fs.promises.open(tmpFile, 'w');
  try {
    await handle.writeFile(content, 'utf-8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.promises.rename(tmpFile, STATE_FILE);
}

const appStateWriter = new StateWriter(executeDiskWrite);

/**
 * Zapisuje stan atomowo w modelu single-flight (bez sztucznego debounce):
 * - Jeśli żaden zapis nie trwa: zapisuje natychmiast bez opóźnienia.
 * - Jeśli zapis trwa: oznacza stan jako brudny i po jego zakończeniu wykonuje dokładnie jeden kolejny zapis najnowszego stanu.
 * - Każde wywołanie zwraca Promise rozwiązywany po zakończeniu zapisu obejmującego jego zmianę (nigdy po starszym).
 * - Błąd zapisu odrzuca Promise wszystkich oczekujących na ten zapis.
 */
function saveStateAtomicAsync(): Promise<void> {
  return appStateWriter.save();
}

/**
 * Czeka na zakończenie trwającego zapisu i wykonuje ostatni zapis, jeśli stan jest brudny.
 */
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
}

function bumpStateRevision(): number {
  ensureStateStructure();
  serverAppStateCache.revision = (serverAppStateCache.revision || 0) + 1;
  serverAppStateCache.updatedAt = new Date().toISOString();
  return serverAppStateCache.revision;
}

// Load existing state on server startup
if (fs.existsSync(STATE_FILE)) {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf-8');
    serverAppStateCache = JSON.parse(raw);
    ensureStateStructure();

    const reset2faOnStart =
      process.env.RESET_2FA_ON_START === 'true' || process.env.RESET_2FA_ON_START === '1';

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
        process.exit(1);
      } else {
        console.warn(
          `[Server WARN] APP_SECRET nie pasuje do danych 2FA użytkowników: ${affectedEmails.join(', ')} (tryb development - kontynuacja).`
        );
      }
    } else if (decryptResult.migrated) {
      console.log('[Server] Wykryto niezaszyfrowane sekrety 2FA w app_state.json - zostaną zaszyfrowane przy zapisie.');
      saveStateAtomicAsync();
    }

    console.log(`[Server] Loaded persistent state from ${STATE_FILE} (${serverAppStateCache.tasks.length} tasks, ${serverUsersCache.length} users, revision: ${serverAppStateCache.revision})`);
  } catch (err) {
    console.error('[Server] Error reading app_state.json:', err);
  }
}

// ==============================================================================
// 1. BEZPIECZEŃSTWO SESJI I CIASTECZEK (HttpOnly, SameSite=Lax, Secure gdy HTTPS)
// ==============================================================================
export interface Session {
  tokenHash: string;
  userId: string;
  role: string;
  createdAt: number;
  expiresAt: number;
}

const sessions = new Map<string, Session>();

function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token.trim()).digest('hex');
}

// Wczytaj sesje z pliku sessions.json w DATA_DIR (przechowywanie hashy SHA-256)
if (fs.existsSync(SESSIONS_FILE)) {
  try {
    const raw = fs.readFileSync(SESSIONS_FILE, 'utf-8');
    const parsed: any[] = JSON.parse(raw);
    const now = Date.now();
    for (const s of parsed) {
      if (s && s.expiresAt > now) {
        if (s.tokenHash) {
          sessions.set(s.tokenHash, s);
        } else if (s.token) {
          // Migracja wsteczna: haszuj stare jawne tokeny z sessions.json
          const hash = hashSessionToken(s.token);
          sessions.set(hash, {
            tokenHash: hash,
            userId: s.userId,
            role: s.role,
            createdAt: s.createdAt,
            expiresAt: s.expiresAt,
          });
        }
      }
    }
    console.log(`[Server Auth] Załadowano ${sessions.size} aktywnych sesji z pliku ${SESSIONS_FILE}`);
  } catch (err) {
    console.warn('[Server Auth] Błąd odczytu sessions.json:', err);
  }
}

let sessionWriteQueue: Promise<void> = Promise.resolve();
function saveSessionsAsync(): Promise<void> {
  const doWrite = async () => {
    try {
      const active = Array.from(sessions.values()).filter((s) => s.expiresAt > Date.now());
      const tmp = path.join(DATA_DIR, 'sessions.json.tmp');
      await fs.promises.writeFile(tmp, JSON.stringify(active), 'utf-8');
      await fs.promises.rename(tmp, SESSIONS_FILE);
    } catch (err) {
      console.error('[Server Auth] Błąd zapisu sessions.json:', err);
    }
  };
  sessionWriteQueue = sessionWriteQueue.then(doWrite, doWrite);
  return sessionWriteQueue;
}

function parseCookies(header?: string): Record<string, string> {
  if (!header) return {};
  const res: Record<string, string> = {};
  const items = header.split(';');
  for (const item of items) {
    const idx = item.indexOf('=');
    if (idx !== -1) {
      const k = item.slice(0, idx).trim();
      const v = item.slice(idx + 1).trim();
      try {
        res[k] = decodeURIComponent(v);
      } catch {
        res[k] = v;
      }
    }
  }
  return res;
}

function setSessionCookie(req: express.Request, res: express.Response, rawToken: string, maxAgeSec = 12 * 3600) {
  const isHttps = isRequestHttps(req);
  const cookieName = isHttps ? '__Host-zp_session' : 'zp_session';
  const cookieParts = [
    `${cookieName}=${encodeURIComponent(rawToken)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec}`,
  ];
  if (isHttps) {
    cookieParts.push('Secure');
  }
  res.setHeader('Set-Cookie', cookieParts.join('; '));
}

function clearSessionCookie(req: express.Request, res: express.Response) {
  const isHttps = isRequestHttps(req);
  const cookiesToClear = [
    `zp_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isHttps ? '; Secure' : ''}`,
    '__Host-zp_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure',
  ];
  res.setHeader('Set-Cookie', cookiesToClear);
}

function getSessionFromReq(req: express.Request): Session | null {
  const cookies = parseCookies(req.headers.cookie);
  let rawToken = cookies['__Host-zp_session'] || cookies['zp_session'];
  if (!rawToken && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    rawToken = req.headers.authorization.slice(7).trim();
  }
  if (!rawToken) return null;

  const tokenHash = hashSessionToken(rawToken);
  const session = sessions.get(tokenHash);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(tokenHash);
    saveSessionsAsync();
    return null;
  }
  return session;
}

// ==============================================================================
// 2. HASZOWANIE HASEŁ SCRYPT & MIGRACJA Z SHA-256 & BLOKADA 5 PRÓB / 15 MINUT
// ==============================================================================
function hashPasswordScrypt(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    const N = 16384;
    const r = 8;
    const p = 1;
    const keyLen = 64;
    crypto.scrypt(password, salt, keyLen, { N, r, p }, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`scrypt$${N}$${salt}$${derivedKey.toString('hex')}`);
    });
  });
}

function verifyPasswordScrypt(password: string, storedHash: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const parts = storedHash.split('$');
      if (parts.length !== 4 || parts[0] !== 'scrypt') {
        return resolve(false);
      }
      const N = parseInt(parts[1], 10) || 16384;
      const salt = parts[2];
      const expectedHash = parts[3];
      const keyLen = 64;

      crypto.scrypt(password, salt, keyLen, { N, r: 8, p: 1 }, (err, derivedKey) => {
        if (err) return resolve(false);
        const expectedBuf = Buffer.from(expectedHash, 'hex');
        if (expectedBuf.length !== derivedKey.length) {
          return resolve(false);
        }
        const matches = crypto.timingSafeEqual(expectedBuf, derivedKey);
        resolve(matches);
      });
    } catch {
      resolve(false);
    }
  });
}

async function verifyAndMigratePassword(user: any, password: string): Promise<boolean> {
  if (!user) return false;
  const stored = user.passwordHash || user.password;
  if (!stored) return false;

  // Format scrypt: scrypt$N$salt$hash
  if (stored.startsWith('scrypt$')) {
    return await verifyPasswordScrypt(password, stored);
  }

  // Wsteczna kompatybilność: stary hash SHA-256
  const LEGACY_SALT = 'zarzadzanie_projektami_salt_2026';
  const salted = `${LEGACY_SALT}:${password.trim()}:${LEGACY_SALT}`;
  const sha256Hex = crypto.createHash('sha256').update(salted).digest('hex');
  const expectedSha = 'sha256:' + sha256Hex;

  let isMatch = false;
  if (stored === expectedSha || stored === sha256Hex) {
    isMatch = true;
  } else if (stored === password.trim()) {
    isMatch = true;
  }

  if (isMatch) {
    // Automatyczna migracja do bezpiecznego scrypt z losową solą
    try {
      const newHash = await hashPasswordScrypt(password.trim());
      user.passwordHash = newHash;
      delete user.password;
      saveStateAtomicAsync();
      console.log(`[Server Auth] Zmigrowano hasło użytkownika ${user.name} (${user.id}) z SHA-256 do scrypt.`);
    } catch (migErr) {
      console.error('[Server Auth] Błąd migracji hasła do scrypt:', migErr);
    }
    return true;
  }

  return false;
}

// ==============================================================================
// 2a. OGRANICZNIKI LICZBY ŻĄDAŃ (IN-MEMORY RATE LIMITERS)
// ==============================================================================
const passwordResetRequestEmailLimiter = createRateLimiter({ max: 3, windowMs: 60 * 60 * 1000 }); // 3 na godzinę na e-mail
const passwordResetRequestIpLimiter = createRateLimiter({ max: 10, windowMs: 60 * 60 * 1000 }); // 10 na godzinę na IP
const passwordResetVerifyIpLimiter = createRateLimiter({ max: 10, windowMs: 15 * 60 * 1000 }); // 10 na 15 minut na IP
const registerIpLimiter = createRateLimiter({ max: 5, windowMs: 60 * 60 * 1000 }); // 5 na godzinę na IP
const setupAdminIpLimiter = createRateLimiter({ max: 10, windowMs: 60 * 60 * 1000 }); // 10 na godzinę na IP

// Helpery konfiguracji środowiskowej
function isSelfRegistrationAllowed(): boolean {
  if (process.env.ALLOW_SELF_REGISTRATION !== undefined) {
    const val = process.env.ALLOW_SELF_REGISTRATION.trim().toLowerCase();
    return val !== 'false' && val !== '0' && val !== 'no';
  }
  return true;
}

function getSetupToken(): string {
  return (process.env.SETUP_TOKEN || '').trim();
}

function isSetupTokenRequired(): boolean {
  return getSetupToken().length > 0;
}

// Ograniczenie prób logowania: 5 błędnych logowań na konto/IP -> blokada 15 minut (6. logowanie -> 429)
interface FailedLoginRec {
  attempts: number;
  blockedUntil: number;
  updatedAt: number;
}
const failedLogins = new Map<string, FailedLoginRec>();
const MAX_FAILED_LOGIN_KEYS = 10000;

function cleanupExpiredFailedLogins() {
  const now = Date.now();
  for (const [key, rec] of failedLogins.entries()) {
    if (rec.blockedUntil <= now && now - rec.updatedAt > 15 * 60 * 1000) {
      failedLogins.delete(key);
    }
  }
  if (failedLogins.size > MAX_FAILED_LOGIN_KEYS) {
    const entries = Array.from(failedLogins.entries()).sort(
      (a, b) => a[1].updatedAt - b[1].updatedAt
    );
    const toRemove = failedLogins.size - MAX_FAILED_LOGIN_KEYS;
    for (let i = 0; i < toRemove; i++) {
      failedLogins.delete(entries[i][0]);
    }
  }
}
setInterval(cleanupExpiredFailedLogins, 5 * 60 * 1000).unref();

function getClientIp(req: express.Request): string {
  if (req.app.get('trust proxy')) {
    return req.ip || req.socket.remoteAddress || '127.0.0.1';
  }
  return req.socket.remoteAddress || req.ip || '127.0.0.1';
}

function isRateLimited(account: string, clientIp: string): boolean {
  const now = Date.now();
  const cleanAccount = String(account || '').trim().toLowerCase();

  // 1. Sprawdź blokadę pary IP + konto (5 prób z tego IP na to konto)
  const accountKey = `ip_user:${clientIp}:${cleanAccount}`;
  const accRec = failedLogins.get(accountKey);
  if (accRec && accRec.blockedUntil > now) {
    return true;
  }

  // 2. Sprawdź blokadę globalną adresu IP (15 prób z tego IP na jakiekolwiek konta)
  const ipKey = `ip_global:${clientIp}`;
  const ipRec = failedLogins.get(ipKey);
  if (ipRec && ipRec.blockedUntil > now) {
    return true;
  }

  return false;
}

function registerFailedLogin(account: string, clientIp: string) {
  const now = Date.now();
  const cleanAccount = String(account || '').trim().toLowerCase();

  // Licznik dla pary IP + konto (5 błędnych logowań -> blokada 15 minut)
  const accountKey = `ip_user:${clientIp}:${cleanAccount}`;
  const accRec = failedLogins.get(accountKey) || { attempts: 0, blockedUntil: 0, updatedAt: now };
  accRec.attempts += 1;
  accRec.updatedAt = now;
  if (accRec.attempts >= 5) {
    accRec.blockedUntil = now + 15 * 60 * 1000;
  }
  failedLogins.set(accountKey, accRec);

  // Licznik globalny na adres IP (15 prób -> blokada IP na 15 minut)
  const ipKey = `ip_global:${clientIp}`;
  const ipRec = failedLogins.get(ipKey) || { attempts: 0, blockedUntil: 0, updatedAt: now };
  ipRec.attempts += 1;
  ipRec.updatedAt = now;
  if (ipRec.attempts >= 15) {
    ipRec.blockedUntil = now + 15 * 60 * 1000;
  }
  failedLogins.set(ipKey, ipRec);

  if (failedLogins.size > MAX_FAILED_LOGIN_KEYS) {
    cleanupExpiredFailedLogins();
  }
}

function resetFailedLogin(account: string, clientIp: string) {
  const cleanAccount = String(account || '').trim().toLowerCase();
  failedLogins.delete(`ip_user:${clientIp}:${cleanAccount}`);
}

// ==============================================================================
// 2b. OBSŁUGA TOTP (RFC 6238, HMAC-SHA1), KODY ZAPASOWE & RESET HASŁA SMTP
// ==============================================================================

// Funkcje TOTP, kody zapasowe i linki otpauth wyodrębniono do ./src/utils/totp.ts
// Dummy hash scrypt do eliminowania timing attacks przy logowaniu nieistniejącego użytkownika
const DUMMY_SCRYPT_HASH =
  'scrypt$16384$8$1$0123456789abcdef0123456789abcdef$0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';


// Magazyn tokenów resetowania hasła (pamięć serwera, 10 minut ważności)
interface PasswordResetToken {
  email: string;
  userId: string;
  codeHash: string;
  expiresAt: number;
  attempts: number;
  verifiedTicket?: string;
}
const passwordResetTokens = new Map<string, PasswordResetToken>();

// Licznik prób weryfikacji łącznie dla e-maila (okno 1 godziny - nowe kody nie zerują prób)
interface EmailResetAttempts {
  attempts: number;
  windowExpiresAt: number;
}
const passwordResetEmailAttempts = new Map<string, EmailResetAttempts>();

function cleanupExpiredResetAttempts() {
  const now = Date.now();
  for (const [email, rec] of passwordResetEmailAttempts.entries()) {
    if (rec.windowExpiresAt <= now) {
      passwordResetEmailAttempts.delete(email);
    }
  }
}
setInterval(cleanupExpiredResetAttempts, 5 * 60 * 1000).unref();

function isSmtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_HOST.trim().length > 0);
}

// Sanityzacja użytkownika - usunięcie wszelkich sekretów i haseł
function sanitizeUser(u: any) {
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

// ==============================================================================
// 3. MIDDLEWARE AUTORYZACJI (Wszystkie /api/* poza health i login)
// ==============================================================================
function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const session = getSessionFromReq(req);
  if (!session) {
    return res.status(401).json({ error: 'Wymagana autoryzacja (brak aktywnej sesji)' });
  }
  const user = (serverUsersCache || []).find((u) => u.id === session.userId);
  if (!user || user.isApproved === false) {
    return res.status(401).json({ error: 'Użytkownik nie istnieje lub nie został zatwierdzony' });
  }
  (req as any).user = user;
  (req as any).session = session;
  next();
}

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  requireAuth(req, res, () => {
    const user = (req as any).user;
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Operacja dozwolona wyłącznie dla Administratora' });
    }
    next();
  });
}

// ==============================================================================
// 3b. OCHRONA CSRF OPARTA NA NAGŁÓWKU ORIGIN (DLA METOD ZMIENIAJĄCYCH STAN)
// ==============================================================================
const CSRF_MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

app.use('/api', (req, res, next) => {
  if (!CSRF_MUTATING_METHODS.has(req.method.toUpperCase())) {
    return next();
  }

  const originHeader = req.headers.origin;
  const rawOrigin = Array.isArray(originHeader) ? originHeader[0] : originHeader;

  // Brak nagłówka Origin przepuszczaj
  if (!rawOrigin || typeof rawOrigin !== 'string' || !rawOrigin.trim()) {
    return next();
  }

  // Jeśli żądanie uwierzytelnione jest tokenem Bearer w nagłówku, pomiń ochronę CSRF
  const authHeader = req.headers.authorization;
  const isBearer = Boolean(
    authHeader &&
    typeof authHeader === 'string' &&
    authHeader.trim().toLowerCase().startsWith('bearer ')
  );
  if (isBearer) {
    return next();
  }

  // Sprawdź czy żądanie uwierzytelnione jest ciasteczkiem sesji
  const cookies = parseCookies(req.headers.cookie);
  const hasSessionCookie = Boolean(cookies['__Host-zp_session'] || cookies['zp_session']);
  if (!hasSessionCookie) {
    return next();
  }

  // Wyznacz oczekiwany host (przy trust proxy użyj X-Forwarded-Host jeśli dostępny)
  let effectiveHost = '';
  if (req.app.get('trust proxy')) {
    const xfh = req.headers['x-forwarded-host'];
    if (xfh) {
      const rawXfh = Array.isArray(xfh) ? xfh[0] : xfh;
      if (typeof rawXfh === 'string' && rawXfh.trim()) {
        effectiveHost = rawXfh.split(',')[0].trim();
      }
    }
  }
  if (!effectiveHost) {
    const h = req.headers.host;
    const rawH = Array.isArray(h) ? h[0] : h;
    if (typeof rawH === 'string') {
      effectiveHost = rawH.trim();
    }
  }

  if (!isSameOrigin(rawOrigin, effectiveHost)) {
    return res.status(403).json({ error: 'Niedozwolone źródło żądania' });
  }

  next();
});

// ==============================================================================
// 4. ENDPOINTY PUBLICZNE: HEALTH & AUTH LOGIN / SETUP / REGISTER
// ==============================================================================

// API Healthcheck endpoint (Public)
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: getLocalInstalledVersion(),
    timestamp: new Date().toISOString(),
    storage: 'JSON Database (app_state.json)',
    persistedState: !!serverAppStateCache,
  });
});

// ==============================================================================
// 4a. ENDPOINTY RESETOWANIA HASŁA PRZEZ E-MAIL (SMTP / NODEMAILER)
// ==============================================================================

// GET /api/auth/password-reset/status (Sprawdzenie czy SMTP jest skonfigurowany)
app.get('/api/auth/password-reset/status', (_req, res) => {
  const enabled = isSmtpConfigured();
  res.json({
    enabled,
    message: enabled
      ? 'Resetowanie hasła przez e-mail jest aktywne'
      : 'Funkcja resetowania hasła przez e-mail jest wyłączona (brak konfiguracji serwera SMTP). Skontaktuj się z administratorem pracowni.',
  });
});

// POST /api/auth/password-reset/request (Generowanie losowego kodu 6 cyfr, ważność 10 min, max 5 prób)
// Ograniczenie: 3 na godzinę na e-mail i 10 na godzinę na IP
app.post('/api/auth/password-reset/request', async (req, res) => {
  try {
    const clientIp = getClientIp(req);
    const ipCheck = passwordResetRequestIpLimiter.hit(clientIp);
    if (!ipCheck.allowed) {
      res.setHeader('Retry-After', ipCheck.retryAfterSeconds.toString());
      return res.status(429).json({
        error: 'Zbyt wiele żądań resetu hasła z tego adresu IP. Spróbuj ponownie później.',
        retryAfter: ipCheck.retryAfterSeconds,
      });
    }

    if (!isSmtpConfigured()) {
      return res.status(400).json({
        error: 'Funkcja resetowania hasła przez e-mail jest wyłączona. Skontaktuj się z administratorem pracowni.',
      });
    }

    const { email } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    const standardMessage =
      'Jeśli podany adres e-mail istnieje w bazie pracowni, wysłano na niego 6-cyfrowy kod weryfikacyjny. Kod jest ważny przez 10 minut.';

    if (!cleanEmail) {
      return res.json({ success: true, message: standardMessage });
    }

    const emailCheck = passwordResetRequestEmailLimiter.hit(cleanEmail);
    if (!emailCheck.allowed) {
      res.setHeader('Retry-After', emailCheck.retryAfterSeconds.toString());
      return res.status(429).json({
        error: 'Zbyt wiele żądań resetu hasła dla tego adresu e-mail. Spróbuj ponownie później.',
        retryAfter: emailCheck.retryAfterSeconds,
      });
    }

    const targetUser = (serverUsersCache || []).find((u) => (u.email || '').trim().toLowerCase() === cleanEmail);

    if (targetUser) {
      const code = crypto.randomInt(100000, 1000000).toString();
      const codeHash = crypto.createHash('sha256').update(code).digest('hex');

      passwordResetTokens.set(cleanEmail, {
        email: cleanEmail,
        userId: targetUser.id,
        codeHash,
        expiresAt: Date.now() + 10 * 60 * 1000, // 10 minut
        attempts: 0,
      });

      // Wysłanie wiadomości przez SMTP
      try {
        const port = parseInt(process.env.SMTP_PORT || '587', 10);
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port,
          secure: port === 465,
          auth: process.env.SMTP_USER
            ? {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS || '',
              }
            : undefined,
        });

        await transporter.sendMail({
          from: process.env.SMTP_FROM || '"Zarządzanie Projektami" <noreply@pracownia.pl>',
          to: cleanEmail,
          subject: 'Kod weryfikacyjny resetu hasła - Zarządzanie Projektami',
          text: `Twój jednorazowy 6-cyfrowy kod do zresetowania hasła to: ${code}\n\nKod jest ważny przez 10 minut (maksymalnie 5 prób weryfikacji).\nJeśli to nie Ty prosiłeś o reset hasła, zignoruj tę wiadomość.`,
          html: `<div style="font-family: sans-serif; padding: 24px; color: #1e293b; max-width: 480px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px;">
            <h2 style="color: #0284c7; margin-top: 0;">Zarządzanie Projektami</h2>
            <p style="font-size: 14px; line-height: 1.5;">Otrzymaliśmy prośbę o zresetowanie hasła dla Twojego profilu w pracowni.</p>
            <p style="font-size: 13px; font-weight: bold; margin-bottom: 8px;">Twój 6-cyfrowy kod weryfikacyjny:</p>
            <div style="font-size: 32px; font-family: monospace; font-weight: bold; letter-spacing: 6px; color: #0f172a; padding: 14px 20px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; width: fit-content;">${code}</div>
            <p style="font-size: 12px; color: #64748b; margin-top: 18px; line-height: 1.4;">Kod jest ważny przez <strong>10 minut</strong> (maksymalnie 5 prób weryfikacji). Jeśli to nie Ty prosiłeś o zmianę hasła, zignoruj tę wiadomość.</p>
          </div>`,
        });
        console.log(`[Server Auth] Wysłano kod resetu hasła na adres e-mail: ${cleanEmail}`);
      } catch (mailErr: any) {
        console.error(`[Server Auth] Błąd wysyłania e-maila SMTP na adres ${cleanEmail}:`, mailErr.message);
      }
    }

    // Odpowiedź API nigdy nie zawiera kodu ani informacji, czy e-mail istnieje (zawsze ta sama wiadomość)
    res.json({ success: true, message: standardMessage });
  } catch (err: any) {
    console.error('[Server Auth] Błąd resetu hasła request:', err);
    res.json({
      success: true,
      message: 'Jeśli podany adres e-mail istnieje w bazie pracowni, wysłano na niego 6-cyfrowy kod weryfikacyjny. Kod jest ważny przez 10 minut.',
    });
  }
});

// POST /api/auth/password-reset/verify (Weryfikacja kodu z ograniczeniem: 10 na 15 min na IP oraz 5 prób łącznie na e-mail w oknie 1h)
app.post('/api/auth/password-reset/verify', (req, res) => {
  const clientIp = getClientIp(req);
  const ipCheck = passwordResetVerifyIpLimiter.hit(clientIp);
  if (!ipCheck.allowed) {
    res.setHeader('Retry-After', ipCheck.retryAfterSeconds.toString());
    return res.status(429).json({
      error: 'Zbyt wiele prób weryfikacji kodu z tego adresu IP. Spróbuj ponownie później.',
      retryAfter: ipCheck.retryAfterSeconds,
    });
  }

  const { email, code } = req.body || {};
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanCode = String(code || '').replace(/[\s-]/g, '').trim();

  const now = Date.now();
  let attemptRec = passwordResetEmailAttempts.get(cleanEmail);
  if (attemptRec && now >= attemptRec.windowExpiresAt) {
    attemptRec = undefined;
    passwordResetEmailAttempts.delete(cleanEmail);
  }

  if (attemptRec && attemptRec.attempts >= 5) {
    const retryAfter = Math.max(1, Math.ceil((attemptRec.windowExpiresAt - now) / 1000));
    res.setHeader('Retry-After', retryAfter.toString());
    return res.status(429).json({
      error: 'Przekroczono maksymalną liczbę prób (5) weryfikacji w oknie 1 godziny. Poproś o nowy kod później.',
      retryAfter,
    });
  }

  const token = passwordResetTokens.get(cleanEmail);
  if (!token || token.expiresAt < now) {
    return res.status(400).json({ error: 'Kod weryfikacyjny wygasł lub nie został wygenerowany. Poproś o nowy kod.' });
  }

  // Zwiększ licznik prób dla e-maila
  if (!attemptRec) {
    attemptRec = { attempts: 1, windowExpiresAt: now + 60 * 60 * 1000 };
  } else {
    attemptRec.attempts += 1;
  }
  passwordResetEmailAttempts.set(cleanEmail, attemptRec);

  const enteredHash = crypto.createHash('sha256').update(cleanCode).digest('hex');
  const isMatch = crypto.timingSafeEqual(Buffer.from(enteredHash), Buffer.from(token.codeHash));

  if (!isMatch) {
    const remaining = 5 - attemptRec.attempts;
    if (remaining <= 0) {
      passwordResetTokens.delete(cleanEmail);
      const retryAfter = Math.max(1, Math.ceil((attemptRec.windowExpiresAt - now) / 1000));
      res.setHeader('Retry-After', retryAfter.toString());
      return res.status(429).json({
        error: 'Przekroczono limit 5 prób weryfikacji. Poproś o nowy kod resetu za godzinę.',
        retryAfter,
      });
    }
    return res.status(400).json({ error: `Nieprawidłowy kod weryfikacyjny. Pozostało prób: ${remaining}` });
  }

  const verifiedTicket = crypto.randomBytes(32).toString('hex');
  token.verifiedTicket = verifiedTicket;
  res.json({ success: true, verifiedTicket });
});

// POST /api/auth/password-reset/confirm (Zatwierdzenie nowego hasła)
app.post('/api/auth/password-reset/confirm', async (req, res) => {
  try {
    const { email, verifiedTicket, newPassword } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();

    const token = passwordResetTokens.get(cleanEmail);
    if (!token || !token.verifiedTicket || token.verifiedTicket !== verifiedTicket || token.expiresAt < Date.now()) {
      return res.status(400).json({ error: 'Sesja resetowania hasła wygasła lub jest nieprawidłowa. Rozpocznij procedurę od nowa.' });
    }

    const targetUser = (serverUsersCache || []).find((u) => u.id === token.userId);
    if (!targetUser) {
      return res.status(404).json({ error: 'Użytkownik nie istnieje w systemie.' });
    }

    const minLen = targetUser.role === 'admin' ? 12 : 8;
    if (!newPassword || String(newPassword).length < minLen) {
      return res.status(400).json({ error: `Nowe hasło musi zawierać co najmniej ${minLen} znaków.` });
    }

    const newHash = await hashPasswordScrypt(String(newPassword));
    targetUser.passwordHash = newHash;
    delete targetUser.password;

    // Unieważnij wszystkie dotychczasowe sesje użytkownika
    for (const [sToken, s] of sessions.entries()) {
      if (s.userId === targetUser.id) {
        sessions.delete(sToken);
      }
    }
    saveSessionsAsync();

    passwordResetTokens.delete(cleanEmail);
    passwordResetEmailAttempts.delete(cleanEmail);
    serverAppStateCache = {
      ...(serverAppStateCache || {}),
      users: serverUsersCache,
      updatedAt: new Date().toISOString(),
    };
    await saveStateAtomicAsync();

    res.json({ success: true, message: 'Hasło zostało pomyślnie zmienione. Możesz się teraz zalogować nowym hasłem.' });
  } catch (err: any) {
    console.error('[Server Auth] Błąd confirm password reset:', err);
    res.status(500).json({ error: 'Błąd zapisu nowego hasła' });
  }
});

// Setup status: zwraca setupRequired, allowSelfRegistration i requireSetupToken
app.get('/api/auth/setup-status', (req, res) => {
  const session = getSessionFromReq(req);
  const setupRequired = (serverUsersCache || []).length === 0;
  const allowSelfRegistration = isSelfRegistrationAllowed();
  const requireSetupToken = isSetupTokenRequired();

  if (!session) {
    return res.json({
      setupRequired,
      allowSelfRegistration,
      requireSetupToken,
    });
  }

  res.json({
    setupRequired,
    userCount: (serverUsersCache || []).length,
    users: (serverUsersCache || []).filter((u) => u.isApproved !== false).map(sanitizeUser),
  });
});

// POST /api/auth/login {email, userId, password, totpCode?}
app.post('/api/auth/login', async (req, res) => {
  try {
    const { userId, email, password, totpCode } = req.body || {};
    const identifier = String(email || userId || '').trim();
    const clientIp = getClientIp(req);

    if (!identifier || !password) {
      return res.status(400).json({ error: 'Wymagany adres e-mail i hasło dostępu' });
    }

    // Sprawdzenie blokady rate-limitu
    if (isRateLimited(identifier, clientIp)) {
      return res.status(429).json({
        error: 'Zbyt wiele nieudanych prób logowania. Konto lub adres IP zablokowany na 15 minut.',
      });
    }

    const AUTH_ERROR_MSG = 'Nieprawidłowy adres e-mail lub hasło';

    const user = (serverUsersCache || []).find(
      (u) => (u.email && u.email.toLowerCase() === identifier.toLowerCase()) || u.id === identifier
    );

    if (!user) {
      // Wyeliminowanie różnic czasowych (timing attacks): wykonaj dummy scrypt
      await verifyPasswordScrypt(String(password), DUMMY_SCRYPT_HASH);
      registerFailedLogin(identifier, clientIp);
      if (isRateLimited(identifier, clientIp)) {
        return res.status(429).json({
          error: 'Zbyt wiele nieudanych prób logowania. Konto lub adres IP zablokowany na 15 minut.',
        });
      }
      return res.status(401).json({ error: AUTH_ERROR_MSG });
    }

    if (user.isApproved === false) {
      return res.status(403).json({ error: 'Konto oczekuje na zatwierdzenie przez Administratora' });
    }

    const isPasswordValid = await verifyAndMigratePassword(user, String(password));
    if (!isPasswordValid) {
      registerFailedLogin(identifier, clientIp);
      if (isRateLimited(identifier, clientIp)) {
        return res.status(429).json({
          error: 'Zbyt wiele nieudanych prób logowania. Konto lub adres IP zablokowany na 15 minut.',
        });
      }
      return res.status(401).json({ error: AUTH_ERROR_MSG });
    }

    // 2FA Google Authenticator Check & Jednorazowe kody zapasowe
    if (user.twoFactorEnabled || (user.pending2FA && user.pending2FA.secret)) {
      if (!totpCode) {
        return res.json({
          require2FA: true,
          message: 'Wymagany 6-cyfrowy kod Google Authenticator lub jednorazowy kod zapasowy',
        });
      }

      let authSuccess = false;

      // 1. Sprawdzenie kodu TOTP gdy 2FA jest już aktywne
      if (user.twoFactorEnabled && user.twoFactorSecret) {
        const matchedStep = verifyTotpStrict(user.twoFactorSecret, String(totpCode), user.lastTotpCounter);
        if (matchedStep !== null) {
          user.lastTotpCounter = matchedStep;
          authSuccess = true;
          await saveStateAtomicAsync();
        } else if (verifyAndConsumeBackupCode(user, String(totpCode), effectiveAppSecret)) {
          authSuccess = true;
          await saveStateAtomicAsync();
          console.log(`[Server Auth] Użytkownik ${user.name} (${user.id}) zalogował się za pomocą jednorazowego kodu zapasowego.`);
        }
      } else if (user.pending2FA && user.pending2FA.secret) {
        // 2. Pierwsze logowanie po rejestracji z 2FA: potwierdzenie pending2FA
        const matchedStep = verifyTotpStrict(user.pending2FA.secret, String(totpCode));
        if (matchedStep !== null) {
          user.twoFactorEnabled = true;
          user.twoFactorSecret = user.pending2FA.secret;
          user.twoFactorBackupCodes = user.pending2FA.backupCodeHashes;
          user.lastTotpCounter = matchedStep;
          delete user.pending2FA;
          authSuccess = true;
          await saveStateAtomicAsync();
          console.log(`[Server Auth] Użytkownik ${user.name} (${user.id}) potwierdził 2FA przy pierwszym logowaniu.`);
        }
      }

      if (!authSuccess) {
        registerFailedLogin(identifier, clientIp);
        if (isRateLimited(identifier, clientIp)) {
          return res.status(429).json({
            error: 'Zbyt wiele nieudanych prób logowania. Konto lub adres IP zablokowany na 15 minut.',
          });
        }
        return res.status(401).json({ error: 'Nieprawidłowy kod 2FA lub kod zapasowy' });
      }
    }

    // Pomyślne logowanie - resetowanie licznika błędnych prób
    resetFailedLogin(identifier, clientIp);

    // Utworzenie tokena i sesji (12 h) - w pamięci i pliku przechowujemy SHA-256 tokenu
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashSessionToken(rawToken);
    const session: Session = {
      tokenHash,
      userId: user.id,
      role: user.role,
      createdAt: Date.now(),
      expiresAt: Date.now() + 12 * 60 * 60 * 1000,
    };
    sessions.set(tokenHash, session);
    saveSessionsAsync();

    setSessionCookie(req, res, rawToken);
    res.json({ success: true, user: sanitizeUser(user) });
  } catch (err: any) {
    console.error('[Server Auth] Błąd logowania:', err);
    res.status(500).json({ error: 'Wystąpił błąd serwera podczas logowania' });
  }
});

// POST /api/auth/logout
app.post('/api/auth/logout', (req, res) => {
  const session = getSessionFromReq(req);
  if (session) {
    sessions.delete(session.tokenHash);
    saveSessionsAsync();
  }
  clearSessionCookie(req, res);
  res.json({ success: true });
});

// GET /api/auth/me
app.get('/api/auth/me', requireAuth, (req, res) => {
  const user = (req as any).user;
  res.json({ authenticated: true, user: sanitizeUser(user) });
});

// POST /api/auth/setup-admin (Kreator tworzenia pierwszego konta admina, hasło min. 12 znaków)
// Ograniczenie: 10 na godzinę na IP oraz opcjonalna walidacja SETUP_TOKEN
app.post('/api/auth/setup-admin', async (req, res) => {
  try {
    const clientIp = getClientIp(req);
    const ipCheck = setupAdminIpLimiter.hit(clientIp);
    if (!ipCheck.allowed) {
      res.setHeader('Retry-After', ipCheck.retryAfterSeconds.toString());
      return res.status(429).json({
        error: 'Zbyt wiele prób konfiguracji administratora z tego adresu IP. Spróbuj ponownie później.',
        retryAfter: ipCheck.retryAfterSeconds,
      });
    }

    if ((serverUsersCache || []).length > 0) {
      return res.status(400).json({ error: 'Konto administratora zostało już utworzone w systemie.' });
    }

    if (isSetupTokenRequired()) {
      const { setupToken } = req.body || {};
      const expectedToken = getSetupToken();
      if (!setupToken || String(setupToken).trim() !== expectedToken) {
        return res.status(403).json({
          error: 'Nieprawidłowy token autoryzacyjny pierwszego administratora (SETUP_TOKEN).',
        });
      }
    }

    const { name, email, password, department } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Wszystkie pola są wymagane.' });
    }
    if (String(password).length < 12) {
      return res.status(400).json({ error: 'Hasło administratora musi zawierać co najmniej 12 znaków.' });
    }

    const passwordHash = await hashPasswordScrypt(String(password));
    const adminUser = {
      id: crypto.randomUUID(),
      name: String(name).trim(),
      email: String(email).trim().toLowerCase(),
      role: 'admin',
      department: department ? String(department).trim() : 'Główny Projektant',
      initials: String(name).trim().split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2) || 'AD',
      passwordHash,
      isDemo: false,
      isApproved: true,
      createdAt: new Date().toISOString(),
    };

    serverUsersCache = [adminUser];
    serverAppStateCache = {
      ...(serverAppStateCache || {}),
      initialized: true,
      users: serverUsersCache,
      updatedAt: new Date().toISOString(),
    };
    await saveStateAtomicAsync();

    // Automatyczne zalogowanie po utworzeniu konta
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashSessionToken(rawToken);
    const session: Session = {
      tokenHash,
      userId: adminUser.id,
      role: adminUser.role,
      createdAt: Date.now(),
      expiresAt: Date.now() + 12 * 60 * 60 * 1000,
    };
    sessions.set(tokenHash, session);
    saveSessionsAsync();

    setSessionCookie(req, res, rawToken);
    res.json({ success: true, user: sanitizeUser(adminUser) });
  } catch (err: any) {
    console.error('[Server Auth] Błąd setup-admin:', err);
    res.status(500).json({ error: 'Błąd tworzenia konta administratora' });
  }
});

// POST /api/auth/register (Rejestracja nowego użytkownika - oczekuje na zatwierdzenie admina)
// Ograniczenie: 5 na godzinę na IP oraz opcjonalna blokada samorejestracji (ALLOW_SELF_REGISTRATION=false)
app.post('/api/auth/register', async (req, res) => {
  try {
    if (!isSelfRegistrationAllowed()) {
      return res.status(403).json({
        error: 'Samodzielna rejestracja użytkowników została wyłączona przez administratora systemu (ALLOW_SELF_REGISTRATION=false).',
      });
    }

    const clientIp = getClientIp(req);
    const ipCheck = registerIpLimiter.hit(clientIp);
    if (!ipCheck.allowed) {
      res.setHeader('Retry-After', ipCheck.retryAfterSeconds.toString());
      return res.status(429).json({
        error: 'Zbyt wiele prób rejestracji z tego adresu IP. Spróbuj ponownie później.',
        retryAfter: ipCheck.retryAfterSeconds,
      });
    }

    const { name, email, password, role, department, twoFactorEnabled } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Wymagane imię, e-mail i hasło.' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: 'Hasło musi zawierać co najmniej 8 znaków.' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const existing = (serverUsersCache || []).find(
      (u) => u.email?.toLowerCase() === cleanEmail
    );
    if (existing) {
      // Ochrona przed enumeracją kont użytkowników: identyczny komunikat sukcesu
      return res.json({
        success: true,
        message: 'Wniosek rejestracyjny został zapisany. Administrator musi zatwierdzić konto.',
      });
    }

    const passwordHash = await hashPasswordScrypt(String(password));

    // Generowanie sekretu TOTP i 10 kodów zapasowych po stronie serwera
    // Rejestracja z checkboxem 2FA nie włącza 2FA od razu: zapisz jako pending2FA
    let twoFactorData: { secret: string; otpAuthUrl: string; backupCodes: string[] } | null = null;
    let pending2FAData: { secret: string; backupCodeHashes: string[]; createdAt: number } | undefined = undefined;

    if (Boolean(twoFactorEnabled)) {
      const server2FASecret = generateBase32Secret(32);
      const { codes, hashes } = generate10BackupCodes(effectiveAppSecret);
      const otpAuthUrl = getOtpAuthUrl(cleanEmail, server2FASecret);
      twoFactorData = {
        secret: server2FASecret,
        otpAuthUrl,
        backupCodes: codes,
      };
      pending2FAData = {
        secret: server2FASecret,
        backupCodeHashes: hashes,
        createdAt: Date.now(),
      };
    }

    const newUser = {
      id: crypto.randomUUID(),
      name: String(name).trim(),
      email: cleanEmail,
      role: 'developer', // Konto zawsze powstaje jako developer; rolę zmienia wyłącznie admin przy zatwierdzeniu
      department: department ? String(department).trim() : 'Projektant',
      initials: String(name).trim().split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2) || 'UZ',
      passwordHash,
      twoFactorEnabled: false, // Włączane dopiero po potwierdzeniu kodem przy pierwszym logowaniu lub w ustawieniach
      pending2FA: pending2FAData,
      lastTotpCounter: 0,
      isDemo: false,
      isApproved: false, // Wymaga zatwierdzenia przez administratora
      registeredAt: new Date().toISOString(),
    };

    serverUsersCache.push(newUser);
    serverAppStateCache = {
      ...(serverAppStateCache || {}),
      users: serverUsersCache,
      updatedAt: new Date().toISOString(),
    };
    await saveStateAtomicAsync();

    res.json({
      success: true,
      message: 'Wniosek rejestracyjny został zapisany. Administrator musi zatwierdzić konto.',
      twoFactor: twoFactorData,
    });
  } catch (err: any) {
    console.error('[Server Auth] Błąd rejestracji:', err);
    res.status(500).json({ error: 'Błąd rejestracji użytkownika' });
  }
});

// ==============================================================================
// 5. ZARZĄDZANIE STANEM APLIKACJI I OPERACJE NA ZASOBACH (Revision & Granular API)
// ==============================================================================

// Lekki endpoint sprawdzania rewizji stanu (co 15s przez klienta, wymaga uwierzytelnienia)
app.get('/api/state/revision', requireAuth, (_req, res) => {
  ensureStateStructure();
  res.json({ revision: serverAppStateCache?.revision || 0 });
});

// GET /api/state: Zwraca dane z polem revision oraz nagłówkiem ETag (przefiltrowane wg uprawnień)
app.get('/api/state', requireAuth, (req, res) => {
  ensureStateStructure();
  const caller = (req as any).user;
  const currentRevision = serverAppStateCache?.revision || 0;
  res.setHeader('ETag', `W/"rev-${currentRevision}"`);

  const filtered = filterStateForUser(serverAppStateCache, caller);
  const sanitized = {
    ...filtered,
    revision: currentRevision,
    users: (filtered.users || []).map(sanitizeUser),
  };
  return res.json({ initialized: true, state: sanitized });
});

// POST /api/tasks (Dodanie pojedynczego zadania z whitelistą i autoryzacją)
app.post('/api/tasks', requireAuth, async (req, res) => {
  try {
    ensureStateStructure();
    const caller = (req as any).user;
    if (!canWrite(caller)) {
      return res.status(403).json({ error: 'Rola viewer posiada dostęp wyłącznie do odczytu.' });
    }
    if (hasForbiddenKeys(req.body)) {
      return res.status(400).json({ error: 'Niedozwolony klucz w żądaniu (__proto__, constructor, prototype).' });
    }
    const body = req.body || {};

    if (!body.title || !String(body.title).trim() || !body.projectId) {
      return res.status(400).json({ error: 'Wymagane pola zadania: title oraz projectId.' });
    }

    const targetProject = (serverAppStateCache.projects || []).find((p: any) => p.id === body.projectId);
    if (!targetProject) {
      return res.status(404).json({ error: `Projekt o ID "${body.projectId}" nie istnieje.` });
    }

    // Walidacja ról i członkostwa w projekcie
    const isAdminOrManager = caller.role === 'admin' || caller.role === 'project_manager';
    if (!isAdminOrManager) {
      const isMember = canAccessProject(caller, targetProject);
      if (!isMember) {
        return res.status(403).json({ error: 'Brak uprawnień: użytkownik nie jest członkiem tego projektu.' });
      }
    }

    let allowed: Record<string, any>;
    try {
      allowed = pickAllowedTaskFields(body, caller);
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }

    const projKey = targetProject?.key || 'ZAD';
    const existingCount = (serverAppStateCache.tasks || []).filter((t: any) => t.projectId === body.projectId).length;
    const code = allowed.code || `${projKey}-${String(existingCount + 1).padStart(2, '0')}`;

    const now = new Date().toISOString();
    const newTask = {
      ...allowed,
      id: crypto.randomUUID(),
      projectId: targetProject.id,
      code,
      title: String(body.title).trim(),
      reporterId: caller.id,
      type: allowed.type || 'task',
      priority: allowed.priority || 'normal',
      status: allowed.status || 'to_do',
      progress: typeof allowed.progress === 'number' ? allowed.progress : 0,
      startDate: allowed.startDate || now.slice(0, 10),
      dueDate: allowed.dueDate || now.slice(0, 10),
      durationDays: typeof allowed.durationDays === 'number' ? allowed.durationDays : 1,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };

    serverAppStateCache.tasks.unshift(newTask);
    const newRev = bumpStateRevision();
    await saveStateAtomicAsync();

    res.status(201).json({ success: true, task: newTask, revision: newRev });
  } catch (err: any) {
    console.error('[Server API] Błąd tworzenia zadania:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/tasks/:id (Aktualizacja pól zadania z whitelistą i weryfikacją If-Match / revision)
app.patch('/api/tasks/:id', requireAuth, async (req, res) => {
  try {
    ensureStateStructure();
    const { id } = req.params;
    const caller = (req as any).user;
    if (!canWrite(caller)) {
      return res.status(403).json({ error: 'Rola viewer posiada dostęp wyłącznie do odczytu.' });
    }
    if (hasForbiddenKeys(req.body)) {
      return res.status(400).json({ error: 'Niedozwolony klucz w żądaniu (__proto__, constructor, prototype).' });
    }
    const patch = req.body || {};

    const task = (serverAppStateCache.tasks || []).find((t: any) => t.id === id);
    if (!task) {
      return res.status(404).json({ error: `Zadanie o ID "${id}" nie zostało znalezione.` });
    }

    // Walidacja uprawnień i członkostwa w projekcie
    const isAdminOrManager = caller.role === 'admin' || caller.role === 'project_manager';
    if (!isAdminOrManager) {
      const targetProject = (serverAppStateCache.projects || []).find((p: any) => p.id === task.projectId);
      const isMember = targetProject && Array.isArray(targetProject.memberIds) && targetProject.memberIds.includes(caller.id);
      const isAssigneeOrReporter = (task.assigneeId && task.assigneeId === caller.id) || (task.reporterId && task.reporterId === caller.id);
      if (!isMember && !isAssigneeOrReporter) {
        return res.status(403).json({ error: 'Brak uprawnień do edycji zadania w tym projekcie.' });
      }
    }

    // Zmiana projectId zadania dozwolona wyłącznie dla admin / project_manager
    if (patch.projectId !== undefined && patch.projectId !== task.projectId) {
      if (!isAdminOrManager) {
        return res.status(403).json({ error: 'Zmiana projektu zadania jest dozwolona wyłącznie dla roli administratora lub kierownika projektu.' });
      }
      const destProject = (serverAppStateCache.projects || []).find((p: any) => p.id === patch.projectId);
      if (!destProject) {
        return res.status(404).json({ error: `Projekt docelowy o ID "${patch.projectId}" nie istnieje.` });
      }
    }

    // Weryfikacja optymistycznej blokady (nagłówek If-Match lub pole expectedRevision)
    const rawIfMatch = req.headers['if-match'] || (patch.expectedRevision !== undefined ? String(patch.expectedRevision) : null);
    if (rawIfMatch) {
      const cleanMatch = String(rawIfMatch).replace(/["W\/]/g, '').trim();
      const currentRev = String(task.revision !== undefined ? task.revision : 1);
      if (cleanMatch !== '*' && cleanMatch !== currentRev) {
        return res.status(409).json({
          error: 'Konflikt wersji zadania (zostało zmodyfikowane przez innego użytkownika).',
          currentTask: task,
          revision: serverAppStateCache.revision,
        });
      }
    }

    let allowedUpdates: Record<string, any>;
    try {
      allowedUpdates = pickAllowedTaskFields(patch, caller);
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }

    for (const [key, value] of Object.entries(allowedUpdates)) {
      task[key] = value;
    }

    task.revision = (task.revision || 1) + 1;
    task.updatedAt = new Date().toISOString();

    const newRev = bumpStateRevision();
    await saveStateAtomicAsync();

    res.json({ success: true, task, revision: newRev });
  } catch (err: any) {
    console.error('[Server API] Błąd aktualizacji zadania:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/tasks/:id (Usuwanie zadania z kontrolą uprawnień: admin/kierownik lub własne zadanie)
app.delete('/api/tasks/:id', requireAuth, async (req, res) => {
  try {
    ensureStateStructure();
    const { id } = req.params;
    const caller = (req as any).user;
    if (!canWrite(caller)) {
      return res.status(403).json({ error: 'Rola viewer posiada dostęp wyłącznie do odczytu.' });
    }

    const task = (serverAppStateCache.tasks || []).find((t: any) => t.id === id);
    if (!task) {
      return res.status(404).json({ error: `Zadanie o ID "${id}" nie istnieje.` });
    }

    const isAdminOrManager = caller.role === 'admin' || caller.role === 'project_manager';
    if (!isAdminOrManager) {
      const isOwn = (task.assigneeId && task.assigneeId === caller.id) ||
                    (task.reporterId && task.reporterId === caller.id);
      if (!isOwn) {
        return res.status(403).json({
          error: `Brak uprawnień do usunięcia cudzego zadania: "${task.title || task.code || task.id}".`,
        });
      }
    }

    serverAppStateCache.tasks = serverAppStateCache.tasks.filter((t: any) => t.id !== id);
    const newRev = bumpStateRevision();
    await saveStateAtomicAsync();

    res.json({ success: true, revision: newRev });
  } catch (err: any) {
    console.error('[Server API] Błąd usuwania zadania:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects (Tworzenie nowego projektu z whitelistą i autoryzacją)
app.post('/api/projects', requireAuth, async (req, res) => {
  try {
    ensureStateStructure();
    const caller = (req as any).user;
    if (!canWrite(caller)) {
      return res.status(403).json({ error: 'Rola viewer posiada dostęp wyłącznie do odczytu.' });
    }
    if (hasForbiddenKeys(req.body)) {
      return res.status(400).json({ error: 'Niedozwolony klucz w żądaniu (__proto__, constructor, prototype).' });
    }
    const body = req.body || {};

    if (!body.name || !String(body.name).trim()) {
      return res.status(400).json({ error: 'Wymagana nazwa projektu.' });
    }

    let allowed: Record<string, any>;
    try {
      allowed = pickAllowedProjectFields(body, caller);
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }

    const isAdminOrManager = caller.role === 'admin' || caller.role === 'project_manager';
    let members: string[];
    if (isAdminOrManager && Array.isArray(body.memberIds)) {
      members = Array.from(new Set(body.memberIds));
    } else {
      members = [caller.id];
    }
    if (!members.includes(caller.id)) {
      members.push(caller.id);
    }

    const rawKey = allowed.key || (isAdminOrManager && body.key ? String(body.key) : 'PRJ');
    const key = String(rawKey).toUpperCase().trim().slice(0, 10);
    const now = new Date().toISOString();

    const newProject = {
      ...allowed,
      id: crypto.randomUUID(),
      key,
      name: String(allowed.name || body.name).trim().slice(0, 200),
      memberIds: members,
      description: allowed.description || '',
      priority: allowed.priority || 'normal',
      status: allowed.status || 'planning',
      startDate: allowed.startDate || now.slice(0, 10),
      dueDate: allowed.dueDate || now.slice(0, 10),
      durationDays: typeof allowed.durationDays === 'number' ? allowed.durationDays : 30,
      progress: typeof allowed.progress === 'number' ? allowed.progress : 0,
      color: allowed.color || '#3b82f6',
      revision: 1,
    };

    serverAppStateCache.projects.push(newProject);
    const newRev = bumpStateRevision();
    await saveStateAtomicAsync();

    res.status(201).json({
      success: true,
      project: filterProjectForUser(newProject, caller),
      revision: newRev,
    });
  } catch (err: any) {
    console.error('[Server API] Błąd tworzenia projektu:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/projects/:id (Aktualizacja projektu z whitelistą i obsługą If-Match)
app.patch('/api/projects/:id', requireAuth, async (req, res) => {
  try {
    ensureStateStructure();
    const caller = (req as any).user;
    if (!canWrite(caller)) {
      return res.status(403).json({ error: 'Rola viewer posiada dostęp wyłącznie do odczytu.' });
    }
    if (hasForbiddenKeys(req.body)) {
      return res.status(400).json({ error: 'Niedozwolony klucz w żądaniu (__proto__, constructor, prototype).' });
    }
    const { id } = req.params;
    const patch = req.body || {};

    const project = (serverAppStateCache.projects || []).find((p: any) => p.id === id);
    if (!project) {
      return res.status(404).json({ error: `Projekt o ID "${id}" nie został znaleziony.` });
    }

    const isAdminOrManager = caller.role === 'admin' || caller.role === 'project_manager';
    if (!isAdminOrManager) {
      const isMember = Array.isArray(project.memberIds) && project.memberIds.includes(caller.id);
      if (!isMember) {
        return res.status(403).json({ error: 'Brak uprawnień do edycji tego projektu.' });
      }
    }

    // Zmiana memberIds oraz key projektu tylko dla admin / project_manager
    if (!isAdminOrManager && (patch.memberIds !== undefined || patch.key !== undefined)) {
      return res.status(403).json({
        error: 'Zmiana memberIds oraz key projektu jest dozwolona wyłącznie dla roli administratora lub kierownika projektu.',
      });
    }

    const rawIfMatch = req.headers['if-match'] || (patch.expectedRevision !== undefined ? String(patch.expectedRevision) : null);
    if (rawIfMatch) {
      const cleanMatch = String(rawIfMatch).replace(/["W\/]/g, '').trim();
      const currentRev = String(project.revision !== undefined ? project.revision : 1);
      if (cleanMatch !== '*' && cleanMatch !== currentRev) {
        return res.status(409).json({
          error: 'Konflikt wersji projektu (został zmodyfikowany przez innego użytkownika).',
          currentProject: filterProjectForUser(project, caller),
          revision: serverAppStateCache.revision,
        });
      }
    }

    let allowedUpdates: Record<string, any>;
    try {
      allowedUpdates = pickAllowedProjectFields(patch, caller);
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }

    for (const [key, value] of Object.entries(allowedUpdates)) {
      project[key] = value;
    }

    project.revision = (project.revision || 1) + 1;
    const newRev = bumpStateRevision();
    await saveStateAtomicAsync();

    res.json({
      success: true,
      project: filterProjectForUser(project, caller),
      revision: newRev,
    });
  } catch (err: any) {
    console.error('[Server API] Błąd aktualizacji projektu:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/projects/:id (Tylko Administrator lub Kierownik projektu)
app.delete('/api/projects/:id', requireAuth, async (req, res) => {
  try {
    ensureStateStructure();
    const caller = (req as any).user;
    if (!canWrite(caller)) {
      return res.status(403).json({ error: 'Rola viewer posiada dostęp wyłącznie do odczytu.' });
    }
    const { id } = req.params;

    const isAdminOrManager = caller.role === 'admin' || caller.role === 'project_manager';
    if (!isAdminOrManager) {
      return res.status(403).json({
        error: 'Usuwanie projektów wymaga roli administratora lub kierownika projektu.',
      });
    }

    const projectIndex = (serverAppStateCache.projects || []).findIndex((p: any) => p.id === id);
    if (projectIndex === -1) {
      return res.status(404).json({ error: `Projekt o ID "${id}" nie istnieje.` });
    }

    serverAppStateCache.projects.splice(projectIndex, 1);
    serverAppStateCache.tasks = (serverAppStateCache.tasks || []).filter((t: any) => t.projectId !== id);

    const newRev = bumpStateRevision();
    await saveStateAtomicAsync();

    res.json({ success: true, revision: newRev });
  } catch (err: any) {
    console.error('[Server API] Błąd usuwania projektu:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/comments (Dodanie komentarza z autoryzacją)
app.post('/api/comments', requireAuth, async (req, res) => {
  try {
    ensureStateStructure();
    const caller = (req as any).user;
    if (!canWrite(caller)) {
      return res.status(403).json({ error: 'Rola viewer posiada dostęp wyłącznie do odczytu.' });
    }
    if (hasForbiddenKeys(req.body)) {
      return res.status(400).json({ error: 'Niedozwolony klucz w żądaniu (__proto__, constructor, prototype).' });
    }
    const { taskId, content } = req.body || {};
    const commentContent = content !== undefined && content !== null ? content : req.body?.comment;

    if (!taskId || !commentContent || !String(commentContent).trim()) {
      return res.status(400).json({ error: 'Wymagane pola taskId oraz treść komentarza (content).' });
    }

    if (String(commentContent).length > 5000) {
      return res.status(400).json({ error: 'Treść komentarza może mieć maksymalnie 5000 znaków.' });
    }

    const task = (serverAppStateCache.tasks || []).find((t: any) => t.id === taskId);
    if (!task) {
      return res.status(404).json({ error: `Zadanie o ID "${taskId}" nie istnieje.` });
    }

    const isAdminOrManager = caller.role === 'admin' || caller.role === 'project_manager';
    if (!isAdminOrManager) {
      const targetProject = (serverAppStateCache.projects || []).find((p: any) => p.id === task.projectId);
      const isMember = targetProject && Array.isArray(targetProject.memberIds) && targetProject.memberIds.includes(caller.id);
      const isAssigneeOrReporter = (task.assigneeId && task.assigneeId === caller.id) || (task.reporterId && task.reporterId === caller.id);
      if (!isMember && !isAssigneeOrReporter) {
        return res.status(403).json({ error: 'Brak uprawnień do komentowania zadania w tym projekcie.' });
      }
    }

    const newComment = {
      id: crypto.randomUUID(),
      taskId,
      userId: caller.id,
      content: String(commentContent).trim().slice(0, 5000),
      createdAt: new Date().toISOString(),
    };

    serverAppStateCache.comments.push(newComment);
    const newRev = bumpStateRevision();
    await saveStateAtomicAsync();

    res.status(201).json({ success: true, comment: newComment, revision: newRev });
  } catch (err: any) {
    console.error('[Server API] Błąd dodawania komentarza:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/comments/:id (Usuwanie komentarza: tylko autor lub administrator)
app.delete('/api/comments/:id', requireAuth, async (req, res) => {
  try {
    ensureStateStructure();
    const caller = (req as any).user;
    if (!canWrite(caller)) {
      return res.status(403).json({ error: 'Rola viewer posiada dostęp wyłącznie do odczytu.' });
    }
    const { id } = req.params;

    const comment = (serverAppStateCache.comments || []).find((c: any) => c.id === id);
    if (!comment) {
      return res.status(404).json({ error: `Komentarz o ID "${id}" nie istnieje.` });
    }

    const isAuthor = comment.userId === caller.id;
    const isAdmin = caller.role === 'admin';
    if (!isAuthor && !isAdmin) {
      return res.status(403).json({
        error: 'Brak uprawnień do usunięcia cudzego komentarza.',
      });
    }

    serverAppStateCache.comments = serverAppStateCache.comments.filter((c: any) => c.id !== id);
    const newRev = bumpStateRevision();
    await saveStateAtomicAsync();

    res.json({ success: true, revision: newRev });
  } catch (err: any) {
    console.error('[Server API] Błąd usuwania komentarza:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/activity (Rejestracja wpisu w dzienniku aktywności z walidacją projektu i limitów)
app.post('/api/activity', requireAuth, async (req, res) => {
  try {
    ensureStateStructure();
    const caller = (req as any).user;
    if (!canWrite(caller)) {
      return res.status(403).json({ error: 'Rola viewer posiada dostęp wyłącznie do odczytu.' });
    }
    if (hasForbiddenKeys(req.body)) {
      return res.status(400).json({ error: 'Niedozwolony klucz w żądaniu (__proto__, constructor, prototype).' });
    }
    const body = req.body || {};

    // projectId wymagany
    if (!body.projectId || typeof body.projectId !== 'string' || !body.projectId.trim()) {
      return res.status(400).json({ error: 'Wymagane pole: projectId.' });
    }

    const projectId = body.projectId.trim();
    const project = (serverAppStateCache.projects || []).find((p: any) => p.id === projectId);
    if (!project) {
      return res.status(404).json({ error: `Projekt o ID "${projectId}" nie istnieje.` });
    }

    // Sprawdź dostęp użytkownika do projektu
    if (!canAccessProject(caller, project)) {
      return res.status(403).json({ error: 'Brak uprawnień do rejestracji aktywności w tym projekcie.' });
    }

    // action max 200 znaków
    if (!body.action || typeof body.action !== 'string' || !body.action.trim()) {
      return res.status(400).json({ error: 'Wymagane pole: action.' });
    }
    const action = body.action.trim();
    if (action.length > 200) {
      return res.status(400).json({ error: 'Pole action może mieć maksymalnie 200 znaków.' });
    }

    // details / comment / treść komentarza: maks. 5000 znaków
    let details: string | undefined;
    const rawDetails = body.details !== undefined && body.details !== null ? body.details : body.comment;
    if (rawDetails !== undefined && rawDetails !== null) {
      if (typeof rawDetails !== 'string') {
        return res.status(400).json({ error: 'Pole details/comment musi być tekstem.' });
      }
      if (rawDetails.length > 5000) {
        return res.status(400).json({ error: 'Treść komentarza / szczegółów może mieć maksymalnie 5000 znaków.' });
      }
      details = rawDetails.slice(0, 5000);
    }

    // taskId (jeśli podane) musi istnieć
    let taskId: string | undefined;
    if (body.taskId) {
      if (typeof body.taskId !== 'string') {
        return res.status(400).json({ error: 'Pole taskId musi być tekstem.' });
      }
      taskId = body.taskId.trim();
      const task = (serverAppStateCache.tasks || []).find((t: any) => t.id === taskId);
      if (!task) {
        return res.status(404).json({ error: `Zadanie o ID "${taskId}" nie istnieje.` });
      }
      if (task.projectId !== projectId) {
        return res.status(400).json({ error: `Zadanie "${taskId}" nie należy do projektu "${projectId}".` });
      }
    }

    const newLog = {
      id: crypto.randomUUID(),
      projectId,
      taskId,
      userId: caller.id,
      action,
      timestamp: new Date().toISOString(),
      details,
    };

    serverAppStateCache.activityLogs.unshift(newLog);
    if (serverAppStateCache.activityLogs.length > 500) {
      serverAppStateCache.activityLogs = serverAppStateCache.activityLogs.slice(0, 500);
    }
    const newRev = bumpStateRevision();
    await saveStateAtomicAsync();

    res.status(201).json({ success: true, log: newLog, revision: newRev });
  } catch (err: any) {
    console.error('[Server API] Błąd zapisu aktywności:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/state: WYŁĄCZNIE dla Administratora (import/przywracanie kopii z walidacją If-Match)
app.post('/api/state', requireAuth, async (req, res) => {
  try {
    ensureStateStructure();
    const caller = (req as any).user;
    const incoming = req.body || {};

    // Modyfikacja całego stanu wyłącznie dla administratora
    if (caller.role !== 'admin') {
      return res.status(403).json({
        error: 'Modyfikacja całego stanu aplikacji jest dozwolona wyłącznie dla Administratora (import/przywracanie kopii).',
      });
    }

    // Walidacja If-Match jeśli podany
    const rawIfMatch = req.headers['if-match'] || (incoming.expectedRevision !== undefined ? String(incoming.expectedRevision) : null);
    if (rawIfMatch) {
      const cleanMatch = String(rawIfMatch).replace(/["W\/]/g, '').trim();
      const currentRev = String(serverAppStateCache.revision || 0);
      if (cleanMatch !== '*' && cleanMatch !== currentRev) {
        return res.status(409).json({
          error: 'Konflikt wersji stanu aplikacji (baza została zaktualizowana przez innego administratora).',
          currentState: {
            ...filterStateForUser(serverAppStateCache, caller),
            revision: serverAppStateCache.revision,
            users: (serverAppStateCache.users || []).map(sanitizeUser),
          },
          currentRevision: serverAppStateCache.revision,
        });
      }
    }

    // Zachowaj wrażliwe hashe użytkowników
    let nextUsers = serverUsersCache;
    if (Array.isArray(incoming.users)) {
      nextUsers = incoming.users.map((inUser: any) => {
        const existing = serverUsersCache.find((u) => u.id === inUser.id);
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

    serverAppStateCache = {
      ...serverAppStateCache,
      ...incoming,
      users: nextUsers,
      initialized: true,
      updatedAt: new Date().toISOString(),
    };
    serverUsersCache = nextUsers;

    const newRev = bumpStateRevision();
    await saveStateAtomicAsync();
    res.json({ success: true, revision: newRev, timestamp: serverAppStateCache.updatedAt });
  } catch (err: any) {
    console.error('[Server] Error saving app_state:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==============================================================================
// 6. ZMIANA HASEŁ, 2FA I ZARZĄDZANIE KONTAMI (Osobne bezpieczne endpointy)
// ==============================================================================

// POST /api/users/:userId/password (Admin lub właściciel konta)
app.post('/api/users/:userId/password', requireAuth, async (req, res) => {
  try {
    const caller = (req as any).user;
    const { userId } = req.params;
    const { currentPassword, newPassword } = req.body || {};
    const clientIp = getClientIp(req);

    if (!newPassword || String(newPassword).length < 8) {
      return res.status(400).json({ error: 'Nowe hasło musi zawierać co najmniej 8 znaków.' });
    }
    if (String(newPassword).length > 128) {
      return res.status(400).json({ error: 'Hasło może mieć maksymalnie 128 znaków.' });
    }

    const targetUser = (serverUsersCache || []).find((u) => u.id === userId);
    if (!targetUser) {
      return res.status(404).json({ error: 'Użytkownik nie istnieje w systemie.' });
    }

    const isSelf = caller.id === userId;
    const isAdmin = caller.role === 'admin';

    if (!isSelf && !isAdmin) {
      return res.status(403).json({ error: 'Brak uprawnień do zmiany hasła innego użytkownika.' });
    }

    // Właściciel konta (w tym administrator zmieniający własne hasło) MUSI podać currentPassword
    if (isSelf) {
      const rateLimitKey = `pwd_chg:${clientIp}:${userId}`;
      if (isRateLimited(rateLimitKey, clientIp)) {
        return res.status(429).json({
          error: 'Zbyt wiele nieudanych prób wprowadzenia dotychczasowego hasła. Blokada na 15 minut.',
        });
      }

      if (!currentPassword) {
        return res.status(400).json({ error: 'Wymagane podanie dotychczasowego hasła.' });
      }

      const isCurrentValid = await verifyAndMigratePassword(targetUser, String(currentPassword));
      if (!isCurrentValid) {
        registerFailedLogin(rateLimitKey, clientIp);
        return res.status(401).json({ error: 'Nieprawidłowe dotychczasowe hasło.' });
      }
      resetFailedLogin(rateLimitKey, clientIp);
    }

    if (targetUser.role === 'admin' && String(newPassword).length < 12) {
      return res.status(400).json({ error: 'Hasło administratora musi zawierać co najmniej 12 znaków.' });
    }

    const newHash = await hashPasswordScrypt(String(newPassword));
    targetUser.passwordHash = newHash;
    delete targetUser.password;

    serverAppStateCache = {
      ...(serverAppStateCache || {}),
      users: serverUsersCache,
      updatedAt: new Date().toISOString(),
    };
    await saveStateAtomicAsync();

    // Zmiana hasła zrzuca stare sesje (401):
    // Jeśli isSelf: unieważnij pozostałe sesje (poza bieżącą).
    // Jeśli admin zmienia cudze hasło: unieważnij wszystkie sesje użytkownika.
    const currentSession = getSessionFromReq(req);
    for (const [tokenHash, session] of sessions.entries()) {
      if (session.userId === targetUser.id) {
        if (isSelf && tokenHash === currentSession?.tokenHash) {
          continue;
        }
        sessions.delete(tokenHash);
      }
    }
    saveSessionsAsync();

    res.json({ success: true, message: 'Hasło zostało pomyślnie zaktualizowane.' });
  } catch (err: any) {
    console.error('[Server Auth] Błąd zmiany hasła:', err);
    res.status(500).json({ error: 'Błąd podczas zmiany hasła' });
  }
});

// POST /api/users/:userId/2fa/setup (Inicjalizacja 2FA - generuje sekret i 10 kodów zapasowych)
app.post('/api/users/:userId/2fa/setup', requireAuth, async (req, res) => {
  try {
    const caller = (req as any).user;
    const { userId } = req.params;
    const { currentPassword, code } = req.body || {};
    const clientIp = getClientIp(req);

    // Admin może konfigurować cudze 2FA tylko przez reset (disable); użytkownik sam wykonuje setup
    if (caller.id !== userId) {
      return res.status(403).json({
        error: 'Użytkownik musi samodzielnie skonfigurować 2FA na swoim urządzeniu. Administrator może jedynie zresetować 2FA.',
      });
    }

    const targetUser = (serverUsersCache || []).find((u) => u.id === userId);
    if (!targetUser) return res.status(404).json({ error: 'Użytkownik nie istnieje' });

    const rateLimitKey = `2fa_setup:${clientIp}:${userId}`;
    if (isRateLimited(rateLimitKey, clientIp)) {
      return res.status(429).json({ error: 'Zbyt wiele prób. Blokada na 15 minut.' });
    }

    if (!currentPassword) {
      return res.status(400).json({ error: 'Wymagane podanie bieżącego hasła' });
    }

    const isPassValid = await verifyAndMigratePassword(targetUser, String(currentPassword));
    if (!isPassValid) {
      registerFailedLogin(rateLimitKey, clientIp);
      return res.status(401).json({ error: 'Nieprawidłowe hasło dostępu' });
    }

    // Gdy 2FA jest już włączone – wymaga także aktualnego kodu TOTP (lub kodu zapasowego)
    if (targetUser.twoFactorEnabled) {
      if (!code) {
        return res.status(400).json({ error: 'Dla aktywnego 2FA wymagany jest aktualny kod weryfikacyjny z aplikacji' });
      }
      let codeValid = false;
      if (targetUser.twoFactorSecret) {
        const step = verifyTotpStrict(targetUser.twoFactorSecret, String(code), targetUser.lastTotpCounter);
        if (step !== null) codeValid = true;
      }
      if (!codeValid && verifyAndConsumeBackupCode(targetUser, String(code), effectiveAppSecret)) {
        codeValid = true;
      }
      if (!codeValid) {
        registerFailedLogin(rateLimitKey, clientIp);
        return res.status(401).json({ error: 'Nieprawidłowy aktualny kod 2FA lub kod zapasowy' });
      }
    }

    resetFailedLogin(rateLimitKey, clientIp);

    const secret = generateBase32Secret(32);
    const { codes, hashes } = generate10BackupCodes(effectiveAppSecret);
    const cleanEmail = String(targetUser.email || '').trim().toLowerCase();
    const otpAuthUrl = getOtpAuthUrl(cleanEmail, secret);

    targetUser.pending2FA = {
      secret,
      backupCodeHashes: hashes,
      createdAt: Date.now(),
    };
    await saveStateAtomicAsync();

    // Sekret i 10 kodów zapasowych zwracane wyłącznie raz w tym wywołaniu setupu
    res.json({
      success: true,
      secret,
      otpAuthUrl,
      backupCodes: codes,
    });
  } catch (err: any) {
    console.error('[Server Auth] Błąd 2fa/setup:', err);
    res.status(500).json({ error: 'Błąd generowania konfiguracji 2FA' });
  }
});

// POST /api/users/:userId/2fa/confirm (Potwierdzenie 2FA kodem z aplikacji)
app.post('/api/users/:userId/2fa/confirm', requireAuth, async (req, res) => {
  try {
    const caller = (req as any).user;
    const { userId } = req.params;
    const { code } = req.body || {};

    if (caller.id !== userId) {
      return res.status(403).json({ error: 'Brak uprawnień do potwierdzenia konfiguracji 2FA dla tego konta' });
    }

    const targetUser = (serverUsersCache || []).find((u) => u.id === userId);
    if (!targetUser) return res.status(404).json({ error: 'Użytkownik nie istnieje' });

    if (!targetUser.pending2FA || !targetUser.pending2FA.secret) {
      return res.status(400).json({ error: 'Brak oczekującej konfiguracji 2FA. Zainicjuj procedurę ponownie.' });
    }

    const matchedStep = verifyTotpStrict(targetUser.pending2FA.secret, String(code));
    if (matchedStep === null) {
      return res.status(400).json({ error: 'Nieprawidłowy 6-cyfrowy kod weryfikacyjny z aplikacji Google Authenticator' });
    }

    targetUser.twoFactorEnabled = true;
    targetUser.twoFactorSecret = targetUser.pending2FA.secret;
    targetUser.twoFactorBackupCodes = targetUser.pending2FA.backupCodeHashes;
    targetUser.lastTotpCounter = matchedStep;
    delete targetUser.pending2FA;

    serverAppStateCache = {
      ...(serverAppStateCache || {}),
      users: serverUsersCache,
      updatedAt: new Date().toISOString(),
    };
    await saveStateAtomicAsync();

    // Po sukcesie unieważnij pozostałe sesje użytkownika (zostaw bieżącą)
    const currentSession = getSessionFromReq(req);
    for (const [tokenHash, session] of sessions.entries()) {
      if (session.userId === targetUser.id && tokenHash !== currentSession?.tokenHash) {
        sessions.delete(tokenHash);
      }
    }
    saveSessionsAsync();

    res.json({
      success: true,
      twoFactorEnabled: true,
      backupCodesCount: targetUser.twoFactorBackupCodes.length,
    });
  } catch (err: any) {
    console.error('[Server Auth] Błąd 2fa/confirm:', err);
    res.status(500).json({ error: 'Błąd potwierdzenia 2FA' });
  }
});

// POST /api/users/:userId/2fa/disable (Bezpieczne wyłączenie 2FA: wymaga hasła i kodu)
app.post('/api/users/:userId/2fa/disable', requireAuth, async (req, res) => {
  try {
    const caller = (req as any).user;
    const { userId } = req.params;
    const { currentPassword, code } = req.body || {};
    const clientIp = getClientIp(req);

    const targetUser = (serverUsersCache || []).find((u) => u.id === userId);
    if (!targetUser) return res.status(404).json({ error: 'Użytkownik nie istnieje' });

    const isSelf = caller.id === userId;
    const isAdmin = caller.role === 'admin';

    if (!isSelf && !isAdmin) {
      return res.status(403).json({ error: 'Brak uprawnień do zarządzania 2FA dla tego konta' });
    }

    if (isSelf) {
      const rateLimitKey = `2fa_disable:${clientIp}:${userId}`;
      if (isRateLimited(rateLimitKey, clientIp)) {
        return res.status(429).json({ error: 'Zbyt wiele prób. Blokada na 15 minut.' });
      }

      if (!currentPassword) {
        return res.status(400).json({ error: 'Wymagane dotychczasowe hasło dostępu' });
      }
      const isPassValid = await verifyAndMigratePassword(targetUser, String(currentPassword));
      if (!isPassValid) {
        registerFailedLogin(rateLimitKey, clientIp);
        return res.status(401).json({ error: 'Nieprawidłowe hasło dostępu' });
      }

      // Jeśli 2FA jest włączone, wymaga poprawnego kodu TOTP lub kodu zapasowego
      if (targetUser.twoFactorEnabled) {
        if (!code) {
          return res.status(400).json({ error: 'Wymagany 6-cyfrowy kod z Google Authenticator lub kod zapasowy' });
        }
        let codeValid = false;
        if (targetUser.twoFactorSecret) {
          const step = verifyTotpStrict(targetUser.twoFactorSecret, String(code), targetUser.lastTotpCounter);
          if (step !== null) codeValid = true;
        }
        if (!codeValid && verifyAndConsumeBackupCode(targetUser, String(code), effectiveAppSecret)) {
          codeValid = true;
        }

        if (!codeValid) {
          registerFailedLogin(rateLimitKey, clientIp);
          return res.status(401).json({ error: 'Nieprawidłowy kod 2FA lub kod zapasowy' });
        }
      }

      resetFailedLogin(rateLimitKey, clientIp);
    } else {
      // Administrator resetuje cudze 2FA (np. w przypadku utraty urządzenia przez pracownika)
      console.log(`[Server Auth] Administrator ${caller.name} (${caller.id}) zresetował 2FA dla ${targetUser.name} (${targetUser.id}).`);
    }

    targetUser.twoFactorEnabled = false;
    delete targetUser.twoFactorSecret;
    delete targetUser.twoFactorBackupCodes;
    delete targetUser.lastTotpCounter;
    delete targetUser.pending2FA;

    serverAppStateCache = {
      ...(serverAppStateCache || {}),
      users: serverUsersCache,
      updatedAt: new Date().toISOString(),
    };
    await saveStateAtomicAsync();

    // W przypadku resetu cudzego konta przez administratora, unieważnij wszystkie sesje użytkownika
    if (!isSelf) {
      for (const [token, session] of sessions.entries()) {
        if (session.userId === targetUser.id) {
          sessions.delete(token);
        }
      }
      saveSessionsAsync();
    }

    res.json({ success: true, twoFactorEnabled: false });
  } catch (err: any) {
    console.error('[Server Auth] Błąd 2fa/disable:', err);
    res.status(500).json({ error: 'Błąd wyłączania 2FA' });
  }
});

// POST /api/users/:userId/approve (Tylko Administrator)
app.post('/api/users/:userId/approve', requireAdmin, async (req, res) => {
  const { userId } = req.params;
  const targetUser = (serverUsersCache || []).find((u) => u.id === userId);
  if (!targetUser) return res.status(404).json({ error: 'Użytkownik nie istnieje' });

  targetUser.isApproved = true;
  serverAppStateCache = {
    ...(serverAppStateCache || {}),
    users: serverUsersCache,
    updatedAt: new Date().toISOString(),
  };
  await saveStateAtomicAsync();

  res.json({ success: true, user: sanitizeUser(targetUser) });
});

// DELETE /api/users/:userId (Tylko Administrator)
app.delete('/api/users/:userId', requireAdmin, async (req, res) => {
  const caller = (req as any).user;
  const { userId } = req.params;

  if (caller.id === userId) {
    return res.status(400).json({ error: 'Nie możesz usunąć aktualnie zalogowanego konta Administratora' });
  }

  serverUsersCache = serverUsersCache.filter((u) => u.id !== userId);
  serverAppStateCache = {
    ...(serverAppStateCache || {}),
    users: serverUsersCache,
    updatedAt: new Date().toISOString(),
  };
  await saveStateAtomicAsync();

  res.json({ success: true });
});

// POST /api/users (Tylko Administrator tworzy nowych użytkowników z hasłem)
app.post('/api/users', requireAdmin, async (req, res) => {
  try {
    const { name, email, role, department, password } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Wymagane pola: imię, e-mail i hasło.' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const existing = (serverUsersCache || []).find((u) => u.email?.toLowerCase() === cleanEmail);
    if (existing) {
      return res.status(400).json({ error: 'Użytkownik o podanym adresie e-mail już istnieje w systemie.' });
    }

    const ALLOWED_ROLES = ['admin', 'project_manager', 'developer', 'tester', 'viewer'];
    const assignedRole = role || 'developer';
    if (!ALLOWED_ROLES.includes(assignedRole)) {
      return res.status(400).json({
        error: `Nieprawidłowa rola użytkownika. Dozwolone: ${ALLOWED_ROLES.join(', ')}.`,
      });
    }

    if (String(password).length > 128) {
      return res.status(400).json({ error: 'Hasło może mieć maksymalnie 128 znaków.' });
    }

    const minLen = assignedRole === 'admin' ? 12 : 8;
    if (String(password).length < minLen) {
      return res.status(400).json({
        error: `Hasło dla roli ${assignedRole === 'admin' ? 'Administrator' : 'Użytkownik'} musi mieć co najmniej ${minLen} znaków.`,
      });
    }

    const passwordHash = await hashPasswordScrypt(String(password));
    const newUser = {
      id: crypto.randomUUID(),
      name: String(name).trim(),
      email: cleanEmail,
      role: assignedRole,
      department: department ? String(department).trim() : 'Projektant',
      initials: String(name).trim().split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2) || 'UZ',
      passwordHash,
      isDemo: false,
      isApproved: true,
      createdAt: new Date().toISOString(),
    };

    serverUsersCache.push(newUser);
    serverAppStateCache = {
      ...(serverAppStateCache || {}),
      users: serverUsersCache,
      updatedAt: new Date().toISOString(),
    };
    await saveStateAtomicAsync();

    res.json({ success: true, user: sanitizeUser(newUser) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ==============================================================================
// 7. STATUS KOPII ZAPASOWYCH (Wymaga autoryzacji, cache w pamięci 60 s, fs.promises)
// ==============================================================================
let backupStatusCache: { data: any; cachedAt: number } | null = null;
const BACKUP_STATUS_CACHE_TTL_MS = 60 * 1000; // 60 sekund

app.get('/api/backup/status', requireAuth, async (_req, res) => {
  try {
    const now = Date.now();
    if (backupStatusCache && (now - backupStatusCache.cachedAt < BACKUP_STATUS_CACHE_TTL_MS)) {
      return res.json(backupStatusCache.data);
    }

    const candidateDirs = [
      process.env.BACKUP_DIR,
      '/opt/zarzadzanie-projektami/backups',
      path.resolve(DATA_DIR, '..', 'backups'),
      path.resolve(DATA_DIR, 'backups'),
      path.resolve(process.cwd(), 'backups'),
    ].filter(Boolean) as string[];

    interface BackupFileInfo {
      filePath: string;
      filename: string;
      mtime: Date;
      size: number;
    }

    const foundBackups: BackupFileInfo[] = [];

    for (const dir of candidateDirs) {
      try {
        const stat = await fs.promises.stat(dir).catch(() => null);
        if (stat && stat.isDirectory()) {
          const files = await fs.promises.readdir(dir);
          for (const file of files) {
            if (file.endsWith('.tmp') || file.startsWith('.')) continue;
            if (file.startsWith('app_state_') || file.endsWith('.json.gz') || file.endsWith('.sql.gz')) {
              const fullPath = path.join(dir, file);
              const fileStat = await fs.promises.stat(fullPath).catch(() => null);
              if (fileStat && fileStat.isFile()) {
                foundBackups.push({
                  filePath: fullPath,
                  filename: file,
                  mtime: fileStat.mtime,
                  size: fileStat.size,
                });
              }
            }
          }
        }
      } catch (readErr) {
        console.warn(`[Server] Błąd odczytu katalogu kopii:`, readErr);
      }
    }

    if (foundBackups.length === 0) {
      const emptyResult = {
        active: false,
        lastBackup: null,
        maxAgeHours: 36,
        message: 'Brak kopii zapasowej na serwerze',
      };
      backupStatusCache = { data: emptyResult, cachedAt: now };
      return res.json(emptyResult);
    }

    // Sortowanie malejąco po dacie modyfikacji (najnowszy pierwszy)
    foundBackups.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    const newest = foundBackups[0];
    const ageMs = Date.now() - newest.mtime.getTime();
    const ageHours = Math.max(0, ageMs / (1000 * 60 * 60));
    const isRecent = ageHours <= 36;

    const result = {
      active: isRecent,
      lastBackup: {
        filename: newest.filename,
        timestamp: newest.mtime.toISOString(),
        ageHours: Math.round(ageHours * 10) / 10,
        size: newest.size,
      },
      totalBackups: foundBackups.length,
      maxAgeHours: 36,
      message: isRecent
        ? 'Ostatnia kopia wykonana pomyślnie w ciągu ostatnich 36h'
        : `Ostatnia kopia zapasowa jest starsza niż 36h (${Math.round(ageHours)}h temu)`,
    };

    backupStatusCache = { data: result, cachedAt: now };
    res.json(result);
  } catch (err: any) {
    console.error('[Server] Błąd pobierania statusu kopii zapasowej:', err);
    res.status(500).json({ active: false, error: err.message });
  }
});


// ==============================================================================
// 8. SUBSKRYPCJA KALENDARZA RFC 5545 (Zabezpieczona prywatnym hashowanym tokenem)
// ==============================================================================

function getUserByCalendarToken(token: string) {
  if (!token || typeof token !== 'string') return null;
  const clean = token.trim();
  if (clean.length < 16) return null;
  const tokenHash = crypto.createHash('sha256').update(clean).digest('hex');
  return (serverAppStateCache?.users || []).find((u: any) => u.calendarTokenHash === tokenHash && u.isApproved !== false) || null;
}

// GET /api/calendar/token (Sprawdzenie statusu tokenu zalogowanego użytkownika)
app.get('/api/calendar/token', requireAuth, (req, res) => {
  ensureStateStructure();
  const caller = (req as any).user;
  const user = (serverAppStateCache.users || []).find((u: any) => u.id === caller.id);
  res.json({
    hasToken: Boolean(user?.calendarTokenHash),
    createdAt: user?.calendarTokenCreatedAt || null,
  });
});

// POST /api/calendar/token/generate (Wygenerowanie nowego prywatnego tokenu i zapisanie hasha SHA-256)
app.post('/api/calendar/token/generate', requireAuth, async (req, res) => {
  try {
    ensureStateStructure();
    const caller = (req as any).user;
    const user = (serverAppStateCache.users || []).find((u: any) => u.id === caller.id);
    if (!user) {
      return res.status(404).json({ error: 'Użytkownik nie istnieje.' });
    }

    const rawToken = crypto.randomBytes(24).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const nowIso = new Date().toISOString();

    user.calendarTokenHash = tokenHash;
    user.calendarTokenCreatedAt = nowIso;

    const userInCache = serverUsersCache.find((u) => u.id === caller.id);
    if (userInCache) {
      userInCache.calendarTokenHash = tokenHash;
      userInCache.calendarTokenCreatedAt = nowIso;
    }

    await saveStateAtomicAsync();
    res.json({ success: true, token: rawToken, createdAt: nowIso });
  } catch (err: any) {
    console.error('[Server Calendar] Błąd generowania tokenu:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/calendar/token (Odwołanie tokenu kalendarza)
app.delete('/api/calendar/token', requireAuth, async (req, res) => {
  try {
    ensureStateStructure();
    const caller = (req as any).user;
    const user = (serverAppStateCache.users || []).find((u: any) => u.id === caller.id);
    if (!user) {
      return res.status(404).json({ error: 'Użytkownik nie istnieje.' });
    }

    delete user.calendarTokenHash;
    delete user.calendarTokenCreatedAt;

    const userInCache = serverUsersCache.find((u) => u.id === caller.id);
    if (userInCache) {
      delete userInCache.calendarTokenHash;
      delete userInCache.calendarTokenCreatedAt;
    }

    await saveStateAtomicAsync();
    res.json({ success: true });
  } catch (err: any) {
    console.error('[Server Calendar] Błąd odwoływania tokenu:', err);
    res.status(500).json({ error: err.message });
  }
});

// Stare publiczne adresy bez tokenu zwracają 404 Not Found
app.get('/api/calendar/all.ics', (_req, res) => {
  res.status(404).type('text/plain; charset=utf-8').send('Not Found: Dostęp do kalendarza wymaga prywatnego tokenu subskrypcji.');
});

app.get('/api/calendar/user/:userId.ics', (_req, res) => {
  res.status(404).type('text/plain; charset=utf-8').send('Not Found: Dostęp do kalendarza wymaga prywatnego tokenu subskrypcji.');
});

// RFC 5545 iCalendar feed dla wszystkich zadań (z tokenem w URL, przefiltrowany wg uprawnień właściciela tokenu)
app.get('/api/calendar/:token/all.ics', (req, res) => {
  ensureStateStructure();
  const { token } = req.params;
  const user = getUserByCalendarToken(token);
  if (!user) {
    return res.status(404).type('text/plain; charset=utf-8').send('Not Found: Nieprawidłowy lub wygasły token kalendarza.');
  }

  const allProjects = serverAppStateCache?.projects || [];
  const allTasks = serverAppStateCache?.tasks || [];

  let visibleTasks: any[];
  if (user.role === 'admin' || user.role === 'project_manager') {
    visibleTasks = allTasks;
  } else {
    const accessibleProjectIds = new Set(
      allProjects.filter((p: any) => canAccessProject(user, p)).map((p: any) => p.id)
    );
    visibleTasks = allTasks.filter(
      (t: any) => accessibleProjectIds.has(t.projectId) || t.assigneeId === user.id || t.reporterId === user.id
    );
  }

  const icsBody = buildIcs(visibleTasks, 'Wszystkie Projekty - Terminarz');

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename="wszystkie-projekty.ics"');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(icsBody);
});

// RFC 5545 iCalendar feed dla konkretnego użytkownika (z tokenem w URL)
app.get('/api/calendar/:token/user/:userId.ics', (req, res) => {
  ensureStateStructure();
  const { token, userId } = req.params;
  const authUser = getUserByCalendarToken(token);
  if (!authUser) {
    return res.status(404).type('text/plain; charset=utf-8').send('Not Found: Nieprawidłowy lub wygasły token kalendarza.');
  }

  // Działa tylko gdy userId jest właścicielem tokenu (admin może dla dowolnego)
  if (authUser.id !== userId && authUser.role !== 'admin') {
    return res.status(403).type('text/plain; charset=utf-8').send('Forbidden: Dostęp ograniczony wyłącznie do własnego kalendarza.');
  }

  const targetUser = (serverAppStateCache.users || []).find((u: any) => u.id === userId);
  const userName = targetUser ? targetUser.name : 'Użytkownik';

  const allProjects = serverAppStateCache?.projects || [];
  const allTasks = serverAppStateCache?.tasks || [];

  let userTasks = allTasks.filter((t: any) => t.assigneeId === userId || (!t.assigneeId && authUser.id === userId));

  if (authUser.role !== 'admin' && authUser.role !== 'project_manager') {
    const accessibleProjectIds = new Set(
      allProjects.filter((p: any) => canAccessProject(authUser, p)).map((p: any) => p.id)
    );
    userTasks = userTasks.filter(
      (t: any) => accessibleProjectIds.has(t.projectId) || t.assigneeId === authUser.id || t.reporterId === authUser.id
    );
  }

  const icsBody = buildIcs(userTasks, `${userName} - Moje Zadania`);

  // Nazwa pliku w Content-Disposition oczyszczona wyłącznie do [a-z0-9-]
  const safeBaseName = (userId || 'kalendarz')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'kalendarz';

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `inline; filename="${safeBaseName}.ics"`);
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(icsBody);
});

// Helper to read installed version from VERSION file or fallback
function getLocalInstalledVersion(): string {
  try {
    const candidates = [
      path.resolve(process.cwd(), 'VERSION'),
      path.resolve(__dirname, 'VERSION'),
      path.resolve(__dirname, '..', 'VERSION')
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        const v = fs.readFileSync(p, 'utf8').trim();
        if (v && v.length > 2) return v;
      }
    }
  } catch {}
  return process.env.APP_VERSION || '2026-11-10 v0.6.0';
}

function isNewerVersion(remote: string, local: string): boolean {
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

// Pamięć podręczna sprawdzania aktualizacji na serwerze (cache 6 godzin)
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

let serverUpdateCache: UpdateCheckCache | null = null;
const UPDATE_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 godzin cache

// Sprawdzanie aktualizacji z GitHub (Wymaga autoryzacji, cache serwerowy 6 h)
app.get('/api/system/check-update', requireAuth, async (req, res) => {
  try {
    const caller = (req as any).user;
    const isAdmin = caller?.role === 'admin';
    // Parametr fresh=true dozwolony tylko dla administratora; dla innych ról ignorowany
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

// 404 handler dla nieznanych tras /api (dla każdej metody HTTP)
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Nie znaleziono' });
});

// Vite dev middleware or static file serving
if (process.env.NODE_ENV !== 'production') {
  try {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    console.log('[Server] Mounted Vite development middlewares on port ' + PORT);
  } catch (viteErr) {
    console.warn('[Server] Could not initialize Vite dev middleware:', viteErr);
  }
} else {
  const staticDir = path.join(__dirname, 'public');
  const indexPath = path.join(staticDir, 'index.html');

  if (!fs.existsSync(indexPath)) {
    console.error(`[Server FATAL] Brak pliku "${indexPath}". Zbuduj frontend (npm run build) przed uruchomieniem serwera produkcyjnego.`);
    process.exit(1);
  }

  console.log(`[Server] Serving static assets from: ${staticDir}`);

  // Cache statyczny: pliki z hashem w nazwie (assets/*) mają Cache-Control: public, max-age=31536000, immutable
  // Pozostałe pliki statyczne mają domyślny maxAge
  app.use(express.static(staticDir, {
    index: false,
    dotfiles: 'deny',
    setHeaders: (res, filePath) => {
      const normalizedPath = filePath.replace(/\\/g, '/');
      if (normalizedPath.includes('/assets/')) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else if (normalizedPath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }));

  // Fallback to index.html for SPA client routing (wyłącznie metoda GET poza /api) - Cache-Control: no-cache
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    if (req.path.startsWith('/api')) return next();

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    return res.sendFile(indexPath);
  });
}

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

const server = app.listen(PORT, () => {
  console.log(`Zarządzanie Projektami running on port ${PORT}`);
});

// Graceful shutdown: zapis wymuszony przy SIGTERM i SIGINT oraz przed zakończeniem procesu
let isShuttingDown = false;
async function handleGracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[Server] Otrzymano sygnał ${signal}. Trwa wymuszony zapis stanu bazy i zamykanie serwera...`);

  try {
    await flushPendingStateSave();
    console.log('[Server] Stan bazy zapisany bezpiecznie.');
  } catch (err) {
    console.error('[Server] Błąd wymuszonego zapisu stanu przed zamknięciem:', err);
  }

  server.close(() => {
    console.log('[Server] Serwer HTTP zatrzymany. Do widzenia.');
    process.exit(0);
  });

  // Awaryjne zamknięcie jeśli cokolwiek zablokuje pętlę po 3 sekundach
  setTimeout(() => {
    process.exit(0);
  }, 3000).unref();
}

process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));
process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));
process.on('beforeExit', async () => {
  try {
    await flushPendingStateSave();
  } catch {}
});

