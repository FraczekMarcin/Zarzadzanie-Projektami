import express from 'express';
import compression from 'compression';
import crypto from 'crypto';
import { isSameOrigin } from '../utils/access.js';
import { createRateLimiter, RateLimiter } from '../utils/rateLimit.js';
import { SecurityLog } from '../utils/securityLog.js';
import { ServerConfig } from './config.js';
import { StateStore } from './state.js';

export interface FailedLoginRec {
  attempts: number;
  blockedUntil: number;
  updatedAt: number;
}

export interface PasswordResetToken {
  email: string;
  userId: string;
  codeHash: string;
  expiresAt: number;
  attempts: number;
  verifiedTicket?: string;
}

export interface EmailResetAttempts {
  attempts: number;
  windowExpiresAt: number;
}

export interface SecurityContext {
  passwordResetRequestEmailLimiter: RateLimiter;
  passwordResetRequestIpLimiter: RateLimiter;
  passwordResetVerifyIpLimiter: RateLimiter;
  registerIpLimiter: RateLimiter;
  setupAdminIpLimiter: RateLimiter;
  passwordResetTokens: Map<string, PasswordResetToken>;
  passwordResetEmailAttempts: Map<string, EmailResetAttempts>;
  isRateLimited: (account: string, clientIp: string) => boolean;
  registerFailedLogin: (account: string, clientIp: string) => void;
  resetFailedLogin: (account: string, clientIp: string) => void;
  destroy: () => void;
}

const CSRF_MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const MAX_FAILED_LOGIN_KEYS = 10000;

export function parseCookies(header?: string): Record<string, string> {
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

export function isRequestHttps(req: express.Request): boolean {
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

export function getClientIp(req: express.Request): string {
  if (req.app.get('trust proxy')) {
    return req.ip || req.socket.remoteAddress || '127.0.0.1';
  }
  return req.socket.remoteAddress || req.ip || '127.0.0.1';
}

export function hashPasswordScrypt(password: string): Promise<string> {
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

export function verifyPasswordScrypt(password: string, storedHash: string): Promise<boolean> {
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

export async function verifyAndMigratePassword(
  user: any,
  password: string,
  stateStore: StateStore
): Promise<boolean> {
  if (!user) return false;
  const stored = user.passwordHash || user.password;
  if (!stored) return false;

  if (stored.startsWith('scrypt$')) {
    return await verifyPasswordScrypt(password, stored);
  }

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
    try {
      const newHash = await hashPasswordScrypt(password.trim());
      user.passwordHash = newHash;
      delete user.password;
      stateStore.saveStateAtomicAsync();
      console.log(`[Server Auth] Zmigrowano hasło użytkownika ${user.name} (${user.id}) z SHA-256 do scrypt.`);
    } catch (migErr) {
      console.error('[Server Auth] Błąd migracji hasła do scrypt:', migErr);
    }
    return true;
  }

  return false;
}

export function applyCoreMiddleware(
  app: express.Express,
  config: ServerConfig,
  securityLogger: SecurityLog
): void {
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  // Lekkie logowanie żądań API bez zewnętrznych zależności
  app.use((req, res, next) => {
    const reqPath = req.path;
    if (!reqPath.startsWith('/api/') && reqPath !== '/api') {
      return next();
    }
    if (reqPath === '/api/health' || reqPath === '/api/state/revision') {
      return next();
    }

    const startTime = Date.now();

    res.on('finish', () => {
      const durationMs = Date.now() - startTime;
      const status = res.statusCode;
      if (status >= 400 || durationMs > 500) {
        console.log(`[API] ${req.method} ${reqPath} ${status} ${durationMs}ms`);
      }
    });

    next();
  });

  // Kompresja odpowiedzi HTTP
  if (!config.isReverseProxyHandlingCompression) {
    app.use(
      compression({
        filter: (req, res) => {
          if (req.headers['x-no-compression']) {
            return false;
          }
          return compression.filter(req, res);
        },
        threshold: 1024,
      })
    );
  }

  // Nagłówki bezpieczeństwa HTTP
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

  // Ochrona CSRF oparta na nagłówku Origin dla metod zmieniających stan
  app.use('/api', (req, res, next) => {
    if (!CSRF_MUTATING_METHODS.has(req.method.toUpperCase())) {
      return next();
    }

    const originHeader = req.headers.origin;
    const rawOrigin = Array.isArray(originHeader) ? originHeader[0] : originHeader;

    if (!rawOrigin || typeof rawOrigin !== 'string' || !rawOrigin.trim()) {
      return next();
    }

    const authHeader = req.headers.authorization;
    const isBearer = Boolean(
      authHeader &&
      typeof authHeader === 'string' &&
      authHeader.trim().toLowerCase().startsWith('bearer ')
    );
    if (isBearer) {
      return next();
    }

    const cookies = parseCookies(req.headers.cookie);
    const hasSessionCookie = Boolean(cookies['__Host-zp_session'] || cookies['zp_session']);
    if (!hasSessionCookie) {
      return next();
    }

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
      securityLogger.record('origin_blocked', {
        ip: getClientIp(req),
        userAgent: (req.headers['user-agent'] || '').slice(0, 100),
        details: { origin: String(rawOrigin).slice(0, 150), host: effectiveHost, path: req.path },
      }).catch(() => {});
      return res.status(403).json({ error: 'Niedozwolone źródło żądania' });
    }

    next();
  });
}

export function createSecurityContext(): SecurityContext {
  const passwordResetRequestEmailLimiter = createRateLimiter({ max: 3, windowMs: 60 * 60 * 1000 });
  const passwordResetRequestIpLimiter = createRateLimiter({ max: 10, windowMs: 60 * 60 * 1000 });
  const passwordResetVerifyIpLimiter = createRateLimiter({ max: 10, windowMs: 15 * 60 * 1000 });
  const registerIpLimiter = createRateLimiter({ max: 5, windowMs: 60 * 60 * 1000 });
  const setupAdminIpLimiter = createRateLimiter({ max: 10, windowMs: 60 * 60 * 1000 });

  const failedLogins = new Map<string, FailedLoginRec>();
  const passwordResetTokens = new Map<string, PasswordResetToken>();
  const passwordResetEmailAttempts = new Map<string, EmailResetAttempts>();

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
  const failedLoginCleanupInterval = setInterval(cleanupExpiredFailedLogins, 5 * 60 * 1000);
  failedLoginCleanupInterval.unref();

  function cleanupExpiredResetAttempts() {
    const now = Date.now();
    for (const [email, rec] of passwordResetEmailAttempts.entries()) {
      if (rec.windowExpiresAt <= now) {
        passwordResetEmailAttempts.delete(email);
      }
    }
  }
  const resetAttemptsCleanupInterval = setInterval(cleanupExpiredResetAttempts, 5 * 60 * 1000);
  resetAttemptsCleanupInterval.unref();

  function isRateLimited(account: string, clientIp: string): boolean {
    const now = Date.now();
    const cleanAccount = String(account || '').trim().toLowerCase();

    const accountKey = `ip_user:${clientIp}:${cleanAccount}`;
    const accRec = failedLogins.get(accountKey);
    if (accRec && accRec.blockedUntil > now) {
      return true;
    }

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

    const accountKey = `ip_user:${clientIp}:${cleanAccount}`;
    const accRec = failedLogins.get(accountKey) || { attempts: 0, blockedUntil: 0, updatedAt: now };
    accRec.attempts += 1;
    accRec.updatedAt = now;
    if (accRec.attempts >= 5) {
      accRec.blockedUntil = now + 15 * 60 * 1000;
    }
    failedLogins.set(accountKey, accRec);

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

  function destroy() {
    clearInterval(failedLoginCleanupInterval);
    clearInterval(resetAttemptsCleanupInterval);
    passwordResetRequestEmailLimiter.destroy();
    passwordResetRequestIpLimiter.destroy();
    passwordResetVerifyIpLimiter.destroy();
    registerIpLimiter.destroy();
    setupAdminIpLimiter.destroy();
  }

  return {
    passwordResetRequestEmailLimiter,
    passwordResetRequestIpLimiter,
    passwordResetVerifyIpLimiter,
    registerIpLimiter,
    setupAdminIpLimiter,
    passwordResetTokens,
    passwordResetEmailAttempts,
    isRateLimited,
    registerFailedLogin,
    resetFailedLogin,
    destroy,
  };
}
