import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Konfiguracja trust proxy: x-forwarded-proto i x-forwarded-for ufaj TYLKO gdy ustawione TRUST_PROXY
if (process.env.TRUST_PROXY) {
  const tp = process.env.TRUST_PROXY.trim().toLowerCase();
  if (tp === 'true' || tp === '1') {
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

// Nagłówki bezpieczeństwa HTTP (Security Headers & Content-Security-Policy)
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https: blob:; connect-src 'self' https://api.github.com https://raw.githubusercontent.com;"
  );
  next();
});

app.use(express.json({ limit: '10mb' }));

// Persistent shared database directory for all clients
const isProduction = process.env.NODE_ENV === 'production';
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
let serverTasksCache: any[] = [];
let serverUsersCache: any[] = [];

// Kolejka atomowych i asynchronicznych zapisów stanu
let writeQueue: Promise<void> = Promise.resolve();

function saveStateAtomicAsync(): Promise<void> {
  const doWrite = async () => {
    try {
      const tmpFile = path.join(DATA_DIR, 'app_state.json.tmp');
      const content = JSON.stringify(serverAppStateCache);
      await fs.promises.writeFile(tmpFile, content, 'utf-8');
      await fs.promises.rename(tmpFile, STATE_FILE);
    } catch (writeErr) {
      console.error('[Server] Błąd atomowego zapisu stanu do pliku:', writeErr);
      throw writeErr;
    }
  };

  writeQueue = writeQueue.then(doWrite, doWrite);
  return writeQueue;
}

// Load existing state on server startup
if (fs.existsSync(STATE_FILE)) {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf-8');
    serverAppStateCache = JSON.parse(raw);
    if (serverAppStateCache && Array.isArray(serverAppStateCache.tasks)) {
      serverTasksCache = serverAppStateCache.tasks;
    }
    if (serverAppStateCache && Array.isArray(serverAppStateCache.users)) {
      serverUsersCache = serverAppStateCache.users;
    }
    console.log(`[Server] Loaded persistent state from ${STATE_FILE} (${serverTasksCache.length} tasks, ${serverUsersCache.length} users)`);
  } catch (err) {
    console.error('[Server] Error reading app_state.json:', err);
  }
}

// ==============================================================================
// 1. BEZPIECZEŃSTWO SESJI I CIASTECZEK (HttpOnly, SameSite=Lax, Secure gdy HTTPS)
// ==============================================================================
export interface Session {
  token: string;
  userId: string;
  role: string;
  createdAt: number;
  expiresAt: number;
}

const sessions = new Map<string, Session>();

// Wczytaj sesje z pliku sessions.json w DATA_DIR
if (fs.existsSync(SESSIONS_FILE)) {
  try {
    const raw = fs.readFileSync(SESSIONS_FILE, 'utf-8');
    const parsed: Session[] = JSON.parse(raw);
    const now = Date.now();
    for (const s of parsed) {
      if (s && s.token && s.expiresAt > now) {
        sessions.set(s.token, s);
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

function isRequestHttps(req: express.Request): boolean {
  if (req.app.get('trust proxy')) {
    return Boolean(req.secure || req.headers['x-forwarded-proto'] === 'https');
  }
  return Boolean(req.secure);
}

function setSessionCookie(req: express.Request, res: express.Response, token: string, maxAgeSec = 12 * 3600) {
  const isHttps = isRequestHttps(req);
  const cookieParts = [
    `zp_session=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec}`,
  ];
  if (isProduction && isHttps) {
    cookieParts.push('Secure');
  }
  res.setHeader('Set-Cookie', cookieParts.join('; '));
}

function clearSessionCookie(req: express.Request, res: express.Response) {
  const isHttps = isRequestHttps(req);
  const cookieParts = [
    'zp_session=',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (isProduction && isHttps) {
    cookieParts.push('Secure');
  }
  res.setHeader('Set-Cookie', cookieParts.join('; '));
}

function getSessionFromReq(req: express.Request): Session | null {
  const cookies = parseCookies(req.headers.cookie);
  let token = cookies.zp_session;
  if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.slice(7).trim();
  }
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
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

// Ograniczenie prób: 5 błędnych logowań na konto/IP -> blokada 15 minut (6. logowanie -> 429)
interface FailedLoginRec {
  attempts: number;
  blockedUntil: number;
}
const failedLogins = new Map<string, FailedLoginRec>();

function getClientIp(req: express.Request): string {
  if (req.app.get('trust proxy')) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0].trim();
    }
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
  const accRec = failedLogins.get(accountKey) || { attempts: 0, blockedUntil: 0 };
  accRec.attempts += 1;
  if (accRec.attempts >= 5) {
    accRec.blockedUntil = now + 15 * 60 * 1000;
  }
  failedLogins.set(accountKey, accRec);

  // Licznik globalny na adres IP (15 prób -> blokada IP na 15 minut)
  const ipKey = `ip_global:${clientIp}`;
  const ipRec = failedLogins.get(ipKey) || { attempts: 0, blockedUntil: 0 };
  ipRec.attempts += 1;
  if (ipRec.attempts >= 15) {
    ipRec.blockedUntil = now + 15 * 60 * 1000;
  }
  failedLogins.set(ipKey, ipRec);
}

function resetFailedLogin(account: string, clientIp: string) {
  const cleanAccount = String(account || '').trim().toLowerCase();
  failedLogins.delete(`ip_user:${clientIp}:${cleanAccount}`);
}

// ==============================================================================
// 2b. OBSŁUGA TOTP (RFC 6238, HMAC-SHA1), KODY ZAPASOWE & RESET HASŁA SMTP
// ==============================================================================

// Dekoder Base32 zgodny z RFC 4648
function base32ToBuffer(base32: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = (base32 || '').toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < clean.length; i++) {
    const idx = alphabet.indexOf(clean[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
      value = value & ((1 << bits) - 1);
    }
  }
  return Buffer.from(bytes);
}

// Generator losowego klucza Base32 (20 bajtów = 32 znaki Base32)
function generateBase32Secret(byteLength = 20): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const randomBytes = crypto.randomBytes(byteLength);
  let result = '';
  for (let i = 0; i < randomBytes.length; i++) {
    result += alphabet[randomBytes[i] % alphabet.length];
  }
  return result;
}

// Generowanie 8 jednorazowych kodów zapasowych i ich hashy SHA-256
function generate8BackupCodes(): { codes: string[]; hashes: string[] } {
  const codes: string[] = [];
  const hashes: string[] = [];
  for (let i = 0; i < 8; i++) {
    const raw = crypto.randomBytes(4).toString('hex').toUpperCase();
    const formatted = `${raw.slice(0, 4)}-${raw.slice(4)}`;
    codes.push(formatted);
    hashes.push(crypto.createHash('sha256').update(raw).digest('hex'));
  }
  return { codes, hashes };
}

// Obliczenie 6-cyfrowego kodu TOTP dla danego kroku czasowego
function calculateTotpForStep(secretBase32: string, step: number): string {
  const key = base32ToBuffer(secretBase32);
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(step));

  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const hmacOffset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[hmacOffset] & 0x7f) << 24) |
    ((hmac[hmacOffset + 1] & 0xff) << 16) |
    ((hmac[hmacOffset + 2] & 0xff) << 8) |
    (hmac[hmacOffset + 3] & 0xff);

  return (binary % 1000000).toString().padStart(6, '0');
}

/**
 * Weryfikacja kodu TOTP na serwerze (RFC 6238, HMAC-SHA1).
 * Okno tolerancji: wyłącznie ±1 krok (30 s w tył, bieżący, 30 s w przód).
 * Ochrona przed replay attack: kod dla kroku <= lastUsedStep jest natychmiast odrzucany.
 * Zwraca numer dopasowanego kroku lub null.
 */
function verifyTotpStrict(secretBase32: string, enteredCode: string, lastUsedStep?: number): number | null {
  if (!secretBase32 || !enteredCode) return null;
  const cleanCode = enteredCode.replace(/[\s-]/g, '').trim();
  if (!/^\d{6}$/.test(cleanCode)) return null;

  const key = base32ToBuffer(secretBase32);
  if (key.length === 0) return null;

  const epoch = Math.floor(Date.now() / 1000);
  const currentStep = Math.floor(epoch / 30);

  // Okno ściśle ±1 (kroki: currentStep - 1, currentStep, currentStep + 1)
  for (let offset = -1; offset <= 1; offset++) {
    const step = currentStep + offset;
    // Ochrona przed ponownym użyciem tego samego kodu
    if (typeof lastUsedStep === 'number' && step <= lastUsedStep) {
      continue;
    }
    const expectedOtp = calculateTotpForStep(secretBase32, step);
    if (crypto.timingSafeEqual(Buffer.from(cleanCode), Buffer.from(expectedOtp))) {
      return step;
    }
  }

  return null;
}

// Weryfikacja i unieważnienie jednorazowego kodu zapasowego
function verifyAndConsumeBackupCode(user: any, enteredCode: string): boolean {
  if (!user || !Array.isArray(user.twoFactorBackupCodes) || user.twoFactorBackupCodes.length === 0) {
    return false;
  }
  const cleanCode = enteredCode.replace(/[\s-]/g, '').toUpperCase().trim();
  if (cleanCode.length < 6) return false;

  const candidateHash = crypto.createHash('sha256').update(cleanCode).digest('hex');

  const idx = user.twoFactorBackupCodes.findIndex((storedHash: string) => {
    try {
      return crypto.timingSafeEqual(Buffer.from(storedHash), Buffer.from(candidateHash));
    } catch {
      return false;
    }
  });

  if (idx !== -1) {
    // Usunięcie zużytego kodu zapasowego (jednorazowy użytek)
    user.twoFactorBackupCodes.splice(idx, 1);
    return true;
  }

  return false;
}

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
    ...rest 
  } = u;
  return {
    ...rest,
    hasPassword: Boolean(passwordHash || password),
    twoFactorEnabled: Boolean(u.twoFactorEnabled),
    backupCodesCount: Array.isArray(twoFactorBackupCodes) ? twoFactorBackupCodes.length : 0,
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
// 4. ENDPOINTY PUBLICZNE: HEALTH & AUTH LOGIN / SETUP / REGISTER
// ==============================================================================

// API Healthcheck endpoint (Public)
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: '2026-11-02 v0.4.0',
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
app.post('/api/auth/password-reset/request', async (req, res) => {
  try {
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

// POST /api/auth/password-reset/verify (Weryfikacja kodu z ograniczeniem do 5 prób)
app.post('/api/auth/password-reset/verify', (req, res) => {
  const { email, code } = req.body || {};
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanCode = String(code || '').replace(/[\s-]/g, '').trim();

  const token = passwordResetTokens.get(cleanEmail);
  if (!token || token.expiresAt < Date.now()) {
    return res.status(400).json({ error: 'Kod weryfikacyjny wygasł lub nie został wygenerowany. Poproś o nowy kod.' });
  }

  if (token.attempts >= 5) {
    passwordResetTokens.delete(cleanEmail);
    return res.status(429).json({ error: 'Przekroczono maksymalną liczbę prób (5). Poproś o nowy kod resetu hasła.' });
  }

  token.attempts += 1;
  const enteredHash = crypto.createHash('sha256').update(cleanCode).digest('hex');
  const isMatch = crypto.timingSafeEqual(Buffer.from(enteredHash), Buffer.from(token.codeHash));

  if (!isMatch) {
    const remaining = 5 - token.attempts;
    if (remaining <= 0) {
      passwordResetTokens.delete(cleanEmail);
      return res.status(429).json({ error: 'Przekroczono limit 5 prób weryfikacji. Poproś o nowy kod resetu.' });
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

// Setup status: dla niezalogowanych zwraca TYLKO { setupRequired: boolean }
app.get('/api/auth/setup-status', (req, res) => {
  const session = getSessionFromReq(req);
  const setupRequired = (serverUsersCache || []).length === 0;

  if (!session) {
    return res.json({ setupRequired });
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
    if (user.twoFactorEnabled) {
      if (!totpCode) {
        return res.json({
          require2FA: true,
          message: 'Wymagany 6-cyfrowy kod Google Authenticator lub jednorazowy kod zapasowy',
        });
      }

      let authSuccess = false;

      // 1. Sprawdzenie kodu TOTP (RFC 6238, HMAC-SHA1, tolerancja ±1 krok, blokada replay attack)
      if (user.twoFactorSecret) {
        const matchedStep = verifyTotpStrict(user.twoFactorSecret, String(totpCode), user.lastTotpCounter);
        if (matchedStep !== null) {
          user.lastTotpCounter = matchedStep;
          authSuccess = true;
          await saveStateAtomicAsync();
        }
      }

      // 2. Jeśli kod TOTP nie pasował, sprawdź czy to jeden z 8 jednorazowych kodów zapasowych
      if (!authSuccess && verifyAndConsumeBackupCode(user, String(totpCode))) {
        authSuccess = true;
        await saveStateAtomicAsync();
        console.log(`[Server Auth] Użytkownik ${user.name} (${user.id}) zalogował się za pomocą jednorazowego kodu zapasowego.`);
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

    // Utworzenie tokena i sesji (12 h)
    const token = crypto.randomBytes(32).toString('hex');
    const session: Session = {
      token,
      userId: user.id,
      role: user.role,
      createdAt: Date.now(),
      expiresAt: Date.now() + 12 * 60 * 60 * 1000,
    };
    sessions.set(token, session);
    saveSessionsAsync();

    setSessionCookie(req, res, token);
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
    sessions.delete(session.token);
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
app.post('/api/auth/setup-admin', async (req, res) => {
  try {
    if ((serverUsersCache || []).length > 0) {
      return res.status(400).json({ error: 'Konto administratora zostało już utworzone w systemie.' });
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
      id: `usr-${Date.now()}`,
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
    const token = crypto.randomBytes(32).toString('hex');
    const session: Session = {
      token,
      userId: adminUser.id,
      role: adminUser.role,
      createdAt: Date.now(),
      expiresAt: Date.now() + 12 * 60 * 60 * 1000,
    };
    sessions.set(token, session);
    saveSessionsAsync();

    setSessionCookie(req, res, token);
    res.json({ success: true, user: sanitizeUser(adminUser) });
  } catch (err: any) {
    console.error('[Server Auth] Błąd setup-admin:', err);
    res.status(500).json({ error: 'Błąd tworzenia konta administratora' });
  }
});

// POST /api/auth/register (Rejestracja nowego użytkownika - oczekuje na zatwierdzenie admina)
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, role, department, twoFactorEnabled } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Wymagane imię, e-mail i hasło.' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: 'Hasło musi zawierać co najmniej 8 znaków.' });
    }

    const existing = (serverUsersCache || []).find(
      (u) => u.email?.toLowerCase() === String(email).trim().toLowerCase()
    );
    if (existing) {
      return res.status(400).json({ error: 'Użytkownik o podanym adresie e-mail już istnieje w systemie.' });
    }

    const passwordHash = await hashPasswordScrypt(String(password));

    // Generowanie sekretu TOTP i 8 kodów zapasowych wyłącznie po stronie serwera
    let twoFactorData: { secret: string; otpAuthUrl: string; backupCodes: string[] } | null = null;
    let server2FASecret: string | undefined = undefined;
    let backupCodeHashes: string[] = [];

    if (Boolean(twoFactorEnabled)) {
      server2FASecret = generateBase32Secret(20);
      const { codes, hashes } = generate8BackupCodes();
      backupCodeHashes = hashes;
      const cleanEmail = String(email).trim().toLowerCase();
      const issuer = 'Zarzadzanie Projektami';
      const otpAuthUrl = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(cleanEmail)}?secret=${server2FASecret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
      twoFactorData = {
        secret: server2FASecret,
        otpAuthUrl,
        backupCodes: codes,
      };
    }

    const newUser = {
      id: `usr-${Date.now()}`,
      name: String(name).trim(),
      email: String(email).trim().toLowerCase(),
      role: 'developer', // Konto zawsze powstaje jako developer; rolę zmienia wyłącznie admin przy zatwierdzeniu
      department: department ? String(department).trim() : 'Projektant',
      initials: String(name).trim().split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2) || 'UZ',
      passwordHash,
      twoFactorEnabled: Boolean(twoFactorEnabled),
      twoFactorSecret: server2FASecret,
      twoFactorBackupCodes: backupCodeHashes,
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
// 5. ZARZĄDZANIE STANEM APLIKACJI (Wymaga aktywnej sesji, brak pól wrażliwych)
// ==============================================================================

// GET /api/state: Zwraca dane BEZ pól passwordHash, password, totpSecret, twoFactorSecret
app.get('/api/state', requireAuth, (_req, res) => {
  if (serverAppStateCache && serverAppStateCache.initialized) {
    const sanitized = {
      ...serverAppStateCache,
      users: (serverAppStateCache.users || []).map(sanitizeUser),
    };
    return res.json({ initialized: true, state: sanitized });
  }
  if (fs.existsSync(STATE_FILE)) {
    try {
      const raw = fs.readFileSync(STATE_FILE, 'utf-8');
      serverAppStateCache = JSON.parse(raw);
      const sanitized = {
        ...serverAppStateCache,
        users: (serverAppStateCache.users || []).map(sanitizeUser),
      };
      return res.json({ initialized: true, state: sanitized });
    } catch (err) {
      console.error('[Server] Error parsing state file:', err);
    }
  }
  res.json({ initialized: false, state: null });
});

// POST /api/state: Wymaga sesji. Walidacja uprawnień do modyfikacji bazy danych.
app.post('/api/state', requireAuth, async (req, res) => {
  try {
    const caller = (req as any).user;
    const incoming = req.body || {};

    const isAdmin = caller.role === 'admin';
    const isManager = caller.role === 'admin' || caller.role === 'project_manager';

    if (!isManager) {
      // (a) Nie wolno usuwać projektów (odrzuć 400, jeśli zniknie którykolwiek id projektu)
      if (Array.isArray(incoming.projects)) {
        const curProjects = Array.isArray(serverAppStateCache?.projects) ? serverAppStateCache.projects : [];
        if (curProjects.length > 0) {
          const incomingProjectIds = new Set(incoming.projects.map((p: any) => p.id));
          const removedProject = curProjects.find((p: any) => !incomingProjectIds.has(p.id));
          if (removedProject) {
            return res.status(400).json({
              error: `Brak uprawnień do usunięcia projektu: "${removedProject.name || removedProject.id}". Usuwanie projektów wymaga roli administratora lub kierownika projektu.`,
            });
          }
        }
      }

      // (b) Nie wolno usuwać komentarzy ani wpisów activityLogs, które nie są własne (autor = caller)
      if (Array.isArray(incoming.comments)) {
        const curComments = Array.isArray(serverAppStateCache?.comments) ? serverAppStateCache.comments : [];
        if (curComments.length > 0) {
          const incomingCommentIds = new Set(incoming.comments.map((c: any) => c.id));
          const removedComments = curComments.filter((c: any) => !incomingCommentIds.has(c.id));
          for (const c of removedComments) {
            if (c.userId !== caller.id) {
              return res.status(400).json({
                error: `Brak uprawnień do usunięcia cudzego komentarza (ID: ${c.id}).`,
              });
            }
          }
        }
      }

      if (Array.isArray(incoming.activityLogs)) {
        const curActivity = Array.isArray(serverAppStateCache?.activityLogs) ? serverAppStateCache.activityLogs : [];
        if (curActivity.length > 0) {
          const incomingActivityIds = new Set(incoming.activityLogs.map((a: any) => a.id));
          const removedActivity = curActivity.filter((a: any) => !incomingActivityIds.has(a.id));
          for (const a of removedActivity) {
            if (a.userId !== caller.id) {
              return res.status(400).json({
                error: `Brak uprawnień do usunięcia cudzego wpisu w dzienniku aktywności (ID: ${a.id}).`,
              });
            }
          }
        }
      }

      // (c) W regule "cudzych zadań": użyj reporterId zamiast creatorId; zadanie bez przypisanej osoby traktuj jako cudze
      if (Array.isArray(incoming.tasks)) {
        const curTasks = serverTasksCache || [];
        if (curTasks.length > 0) {
          const incomingTaskIds = new Set(incoming.tasks.map((t: any) => t.id));
          const removedTasks = curTasks.filter((t: any) => !incomingTaskIds.has(t.id));
          for (const t of removedTasks) {
            // Własne wyłącznie gdy przypisane do callera LUB zgłoszone przez callera
            // Zadanie bez przypisanej osoby (brak assigneeId) i ze zgłaszającym innym niż caller jest traktowane jako cudze
            const isOwn = (t.assigneeId && t.assigneeId === caller.id) ||
                          (t.reporterId && t.reporterId === caller.id);
            if (!isOwn) {
              return res.status(400).json({
                error: `Brak uprawnień do usunięcia cudzego zadania: "${t.title || t.code || t.id}".`,
              });
            }
          }
        }

        // Odrzucaj 400, jeśli liczba zadań spada o >20% bez roli admin/kierownika
        const oldLen = (serverTasksCache || []).length;
        const newLen = incoming.tasks.length;
        if (oldLen > 0 && newLen < oldLen * 0.8) {
          return res.status(400).json({
            error: `Odrzucono próbę usunięcia ponad 20% zadań (${oldLen} -> ${newLen}) bez roli administratora lub kierownika projektu.`,
          });
        }
      }
    }

    // Tylko administrator może modyfikować tablicę użytkowników
    let nextUsers = serverUsersCache;
    if (caller.role === 'admin' && Array.isArray(incoming.users)) {
      nextUsers = incoming.users.map((inUser: any) => {
        const existing = serverUsersCache.find((u) => u.id === inUser.id);
        return {
          ...inUser,
          passwordHash: existing?.passwordHash || inUser.passwordHash,
          twoFactorSecret: existing?.twoFactorSecret || inUser.twoFactorSecret,
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
    if (Array.isArray(incoming.tasks)) {
      serverTasksCache = incoming.tasks;
    }
    serverUsersCache = nextUsers;

    await saveStateAtomicAsync();
    res.json({ success: true, timestamp: serverAppStateCache.updatedAt });
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

    if (!newPassword || String(newPassword).length < 8) {
      return res.status(400).json({ error: 'Nowe hasło musi zawierać co najmniej 8 znaków.' });
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

    if (isSelf && !isAdmin) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'Wymagane podanie dotychczasowego hasła.' });
      }
      const isCurrentValid = await verifyAndMigratePassword(targetUser, String(currentPassword));
      if (!isCurrentValid) {
        return res.status(401).json({ error: 'Nieprawidłowe dotychczasowe hasło.' });
      }
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

    res.json({ success: true, message: 'Hasło zostało pomyślnie zaktualizowane i zabezpieczone (scrypt).' });
  } catch (err: any) {
    console.error('[Server Auth] Błąd zmiany hasła:', err);
    res.status(500).json({ error: 'Błąd podczas zmiany hasła' });
  }
});

// POST /api/users/:userId/2fa/setup (Inicjalizacja 2FA - generuje sekret i 8 kodów zapasowych)
app.post('/api/users/:userId/2fa/setup', requireAuth, async (req, res) => {
  try {
    const caller = (req as any).user;
    const { userId } = req.params;
    const targetUser = (serverUsersCache || []).find((u) => u.id === userId);
    if (!targetUser) return res.status(404).json({ error: 'Użytkownik nie istnieje' });

    if (caller.id !== userId && caller.role !== 'admin') {
      return res.status(403).json({ error: 'Brak uprawnień do konfiguracji 2FA dla tego konta' });
    }

    const secret = generateBase32Secret(20);
    const { codes, hashes } = generate8BackupCodes();
    const cleanEmail = String(targetUser.email || '').trim().toLowerCase();
    const issuer = 'Zarzadzanie Projektami';
    const otpAuthUrl = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(cleanEmail)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

    targetUser.pending2FA = {
      secret,
      backupCodeHashes: hashes,
      createdAt: Date.now(),
    };
    await saveStateAtomicAsync();

    // Sekret i kody zapasowe zwracane wyłącznie raz w tym wywołaniu setupu
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

    const targetUser = (serverUsersCache || []).find((u) => u.id === userId);
    if (!targetUser) return res.status(404).json({ error: 'Użytkownik nie istnieje' });

    if (caller.id !== userId && caller.role !== 'admin') {
      return res.status(403).json({ error: 'Brak uprawnień do konfiguracji 2FA dla tego konta' });
    }

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

    res.json({ success: true, twoFactorEnabled: true, backupCodesCount: targetUser.twoFactorBackupCodes.length });
  } catch (err: any) {
    console.error('[Server Auth] Błąd 2fa/confirm:', err);
    res.status(500).json({ error: 'Błąd potwierdzenia 2FA' });
  }
});

// POST /api/users/:userId/2fa (Włączenie/wyłączenie 2FA z bezpieczną walidacją)
app.post('/api/users/:userId/2fa', requireAuth, async (req, res) => {
  try {
    const caller = (req as any).user;
    const { userId } = req.params;
    const { enabled, secret, code } = req.body || {};

    const targetUser = (serverUsersCache || []).find((u) => u.id === userId);
    if (!targetUser) return res.status(404).json({ error: 'Użytkownik nie istnieje' });

    if (caller.id !== userId && caller.role !== 'admin') {
      return res.status(403).json({ error: 'Brak uprawnień do konfiguracji 2FA dla tego konta' });
    }

    if (enabled) {
      const secretToUse = secret || targetUser.twoFactorSecret || generateBase32Secret(20);
      if (code) {
        const matchedStep = verifyTotpStrict(secretToUse, String(code));
        if (matchedStep === null) {
          return res.status(400).json({ error: 'Nieprawidłowy 6-cyfrowy kod z Google Authenticator' });
        }
        targetUser.lastTotpCounter = matchedStep;
      }
      targetUser.twoFactorEnabled = true;
      targetUser.twoFactorSecret = secretToUse;
      if (!Array.isArray(targetUser.twoFactorBackupCodes) || targetUser.twoFactorBackupCodes.length === 0) {
        const { hashes } = generate8BackupCodes();
        targetUser.twoFactorBackupCodes = hashes;
      }
    } else {
      targetUser.twoFactorEnabled = false;
      delete targetUser.twoFactorSecret;
      delete targetUser.twoFactorBackupCodes;
      delete targetUser.lastTotpCounter;
      delete targetUser.pending2FA;
    }

    serverAppStateCache = {
      ...(serverAppStateCache || {}),
      users: serverUsersCache,
      updatedAt: new Date().toISOString(),
    };
    await saveStateAtomicAsync();

    res.json({ success: true, twoFactorEnabled: targetUser.twoFactorEnabled });
  } catch (err: any) {
    console.error('[Server Auth] Błąd 2FA:', err);
    res.status(500).json({ error: 'Błąd konfiguracji 2FA' });
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
    const minLen = role === 'admin' ? 12 : 8;
    if (String(password).length < minLen) {
      return res.status(400).json({ error: `Hasło dla roli ${role === 'admin' ? 'Administrator' : 'Użytkownik'} musi mieć co najmniej ${minLen} znaków.` });
    }

    const passwordHash = await hashPasswordScrypt(String(password));
    const newUser = {
      id: `usr-${Date.now()}`,
      name: String(name).trim(),
      email: String(email).trim().toLowerCase(),
      role: role || 'developer',
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
// 7. STATUS KOPII ZAPASOWYCH (Wymaga autoryzacji)
// ==============================================================================
app.get('/api/backup/status', requireAuth, (_req, res) => {
  try {
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
    const scannedDirs: string[] = [];

    for (const dir of candidateDirs) {
      if (fs.existsSync(dir)) {
        scannedDirs.push(dir);
        try {
          const files = fs.readdirSync(dir);
          for (const file of files) {
            if (file.endsWith('.tmp') || file.startsWith('.')) continue;
            if (file.startsWith('app_state_') || file.endsWith('.json.gz') || file.endsWith('.sql.gz')) {
              const fullPath = path.join(dir, file);
              const stat = fs.statSync(fullPath);
              if (stat.isFile()) {
                foundBackups.push({
                  filePath: fullPath,
                  filename: file,
                  mtime: stat.mtime,
                  size: stat.size,
                });
              }
            }
          }
        } catch (readErr) {
          console.warn(`[Server] Błąd odczytu katalogu kopii "${dir}":`, readErr);
        }
      }
    }

    if (foundBackups.length === 0) {
      return res.json({
        active: false,
        lastBackup: null,
        maxAgeHours: 36,
        scannedDirs,
        message: 'Brak kopii zapasowej na serwerze',
      });
    }

    // Sortowanie malejąco po dacie modyfikacji (najnowszy pierwszy)
    foundBackups.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    const newest = foundBackups[0];
    const ageMs = Date.now() - newest.mtime.getTime();
    const ageHours = Math.max(0, ageMs / (1000 * 60 * 60));
    const isRecent = ageHours <= 36;

    res.json({
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
    });
  } catch (err: any) {
    console.error('[Server] Błąd pobierania statusu kopii zapasowej:', err);
    res.status(500).json({ active: false, error: err.message });
  }
});

// Direct endpoint to download install.sh via curl
app.get('/install.sh', (_req, res) => {
  try {
    const scriptPath = fs.existsSync(path.resolve(__dirname, 'install.sh'))
      ? path.resolve(__dirname, 'install.sh')
      : path.resolve(__dirname, '..', 'install.sh');
    if (fs.existsSync(scriptPath)) {
      res.setHeader('Content-Type', 'text/x-shellscript; charset=utf-8');
      return res.sendFile(scriptPath);
    }
  } catch (err) {
    console.error('Error serving install.sh:', err);
  }
  res.status(404).send('#!/bin/bash\necho "install.sh not found"\nexit 1');
});

// Endpoint to receive latest tasks from client for Google Calendar live sync (requires auth)
app.post('/api/calendar/push-tasks', requireAuth, (req, res) => {
  const { tasks, users } = req.body;
  if (Array.isArray(tasks)) {
    serverTasksCache = tasks;
  }
  if (Array.isArray(users)) {
    // Zachowaj wrażliwe hashe i sekrety istniejących użytkowników
    serverUsersCache = users.map((inUser: any) => {
      const existing = serverUsersCache.find((u) => u.id === inUser.id);
      return {
        ...inUser,
        passwordHash: existing?.passwordHash || inUser.passwordHash,
        twoFactorSecret: existing?.twoFactorSecret || inUser.twoFactorSecret,
      };
    });
  }
  res.json({ success: true, count: serverTasksCache.length });
});

// RFC 5545 iCalendar live subscription feed for a specific user
app.get('/api/calendar/user/:userId.ics', (req, res) => {
  const { userId } = req.params;
  const user = serverUsersCache.find((u) => u.id === userId);
  const userName = user ? user.name : 'Użytkownik';

  const userTasks = serverTasksCache.length > 0
    ? serverTasksCache.filter((t) => t.assigneeId === userId || !t.assigneeId)
    : [];

  const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const toGCalDate = (dateStr: string) => (dateStr ? dateStr.replace(/-/g, '') : now.slice(0, 8));
  const getNextDay = (dateStr: string) => {
    try {
      const d = new Date(dateStr + 'T00:00:00');
      d.setDate(d.getDate() + 1);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}${m}${day}`;
    } catch {
      return toGCalDate(dateStr);
    }
  };

  const events = userTasks.map((t) => {
    const start = toGCalDate(t.startDate || t.dueDate);
    const end = getNextDay(t.dueDate || t.startDate);
    const summary = `[${t.code || 'ZAD'}] ${(t.title || 'Zadanie').replace(/[,;]/g, ' ')}`;
    const desc = `Priorytet: ${t.priority || 'Normalny'}\\nStatus: ${t.status || 'W toku'}\\nCzas: ${t.durationDays || 1} dni\\n${(t.description || '').replace(/\n/g, '\\n')}`;

    return [
      'BEGIN:VEVENT',
      `UID:${t.id}@zarzadzanierp.local`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${start}`,
      `DTEND;VALUE=DATE:${end}`,
      `SUMMARY:${summary}`,
      `DESCRIPTION:${desc}`,
      `STATUS:${t.status === 'done' ? 'COMPLETED' : 'CONFIRMED'}`,
      'CLASS:PUBLIC',
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    ].join('\r\n');
  });

  const icsBody = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Zarzadzanie Projektami//PL//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${userName} - Moje Zadania (Zarządzanie Projektami)`,
    'X-WR-TIMEZONE:Europe/Warsaw',
    'X-PUBLISHED-TTL:PT15M',
    'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
    ...events,
    'END:VCALENDAR',
  ].join('\r\n');

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `inline; filename="${userId}-kalendarz.ics"`);
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(icsBody);
});

// RFC 5545 iCalendar live subscription feed for all tasks
app.get('/api/calendar/all.ics', (_req, res) => {
  const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const toGCalDate = (dateStr: string) => (dateStr ? dateStr.replace(/-/g, '') : now.slice(0, 8));
  const getNextDay = (dateStr: string) => {
    try {
      const d = new Date(dateStr + 'T00:00:00');
      d.setDate(d.getDate() + 1);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}${m}${day}`;
    } catch {
      return toGCalDate(dateStr);
    }
  };

  const events = serverTasksCache.map((t) => {
    const start = toGCalDate(t.startDate || t.dueDate);
    const end = getNextDay(t.dueDate || t.startDate);
    const summary = `[${t.code || 'ZAD'}] ${(t.title || 'Zadanie').replace(/[,;]/g, ' ')}`;
    const desc = `Priorytet: ${t.priority || 'Normalny'}\\nStatus: ${t.status || 'W toku'}\\nCzas: ${t.durationDays || 1} dni\\n${(t.description || '').replace(/\n/g, '\\n')}`;

    return [
      'BEGIN:VEVENT',
      `UID:${t.id}@zarzadzanierp.local`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${start}`,
      `DTEND;VALUE=DATE:${end}`,
      `SUMMARY:${summary}`,
      `DESCRIPTION:${desc}`,
      `STATUS:${t.status === 'done' ? 'COMPLETED' : 'CONFIRMED'}`,
      'CLASS:PUBLIC',
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    ].join('\r\n');
  });

  const icsBody = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Zarzadzanie Projektami//PL//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Wszystkie Projekty - Terminarz',
    'X-WR-TIMEZONE:Europe/Warsaw',
    'X-PUBLISHED-TTL:PT15M',
    'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
    ...events,
    'END:VCALENDAR',
  ].join('\r\n');

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename="wszystkie-projekty.ics"');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(icsBody);
});

// Helper to read installed version from VERSION file or fallback
function getLocalInstalledVersion(): string {
  try {
    const candidates = [
      path.resolve(process.cwd(), 'VERSION'),
      path.resolve(__dirname, 'VERSION'),
      path.resolve(process.cwd(), 'Instalacja', 'VERSION'),
      path.resolve(__dirname, '..', 'VERSION')
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        const v = fs.readFileSync(p, 'utf8').trim();
        if (v && v.length > 2) return v;
      }
    }
  } catch {}
  return process.env.APP_VERSION || '2026-11-02 v0.4.0';
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

// Sprawdzanie aktualizacji z GitHub (Wymaga autoryzacji)
app.get('/api/system/check-update', requireAuth, async (_req, res) => {
  try {
    const localVersion = getLocalInstalledVersion();
    let remoteVersion = localVersion;
    let checkedSource = 'brak połączenia';

    const versionUrl = 'https://raw.githubusercontent.com/FraczekMarcin/Zarzadzanie-Projektami/main/VERSION';
    const vResp = await fetch(`${versionUrl}?t=${Date.now()}`, { cache: 'no-cache' }).catch(() => null);

    if (vResp && vResp.ok) {
      const vText = (await vResp.text()).trim();
      if (vText && vText.length > 0 && vText.length < 50) {
        remoteVersion = vText;
        checkedSource = 'plik VERSION na GitHub (gałąź main)';
      }
    } else {
      const pkgUrl = 'https://raw.githubusercontent.com/FraczekMarcin/Zarzadzanie-Projektami/main/package.json';
      const pResp = await fetch(`${pkgUrl}?t=${Date.now()}`, { cache: 'no-cache' }).catch(() => null);
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
    }).catch(() => null);

    if (ghResp && ghResp.ok) {
      const cData: any = await ghResp.json();
      latestSha = (cData.sha || '').slice(0, 7);
      commitMessage = cData.commit?.message || '';
    }

    const hasUpdate = isNewerVersion(remoteVersion, localVersion);

    res.json({
      localVersion,
      remoteVersion,
      hasUpdate,
      checkedSource,
      latestSha,
      commitMessage,
      checkedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// API Info endpoint (Wymaga sesji użytkownika)
app.get('/api/system-info', requireAuth, (_req, res) => {
  res.json({
    name: 'Zarządzanie Projektami',
    description: 'System zarządzania projektami z wykresem Gantta, terminarzem i integracją Google Calendar na żywo',
    version: '2026-11-02 v0.4.0',
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
}

// Robust static file serving for production
const candidateDistPaths = [
  path.resolve(__dirname),
  path.resolve(__dirname, 'dist'),
  path.resolve(process.cwd(), 'dist'),
  path.resolve(process.cwd()),
];

const distPath = candidateDistPaths.find((p) => fs.existsSync(path.join(p, 'index.html'))) || path.resolve(__dirname, 'dist');
console.log(`[Server] Serving static assets from: ${distPath}`);

app.use(express.static(distPath, { index: false, maxAge: '1h' }));

// Fallback to index.html for SPA client routing
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (req.path.startsWith('/api')) return next();

  const indexPath = path.join(distPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.sendFile(indexPath);
  }
  next();
});

app.listen(PORT, () => {
  console.log(`Zarządzanie Projektami running on port ${PORT}`);
});
