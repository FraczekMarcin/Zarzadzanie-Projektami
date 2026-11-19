import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Session, isSessionExpired } from '../utils/sessions.js';
import { ServerConfig, SESSION_DISK_FLUSH_INTERVAL_MS } from './config.js';
import { StateStore } from './state.js';
import { getClientIp, isCrossSiteHttpsRequest, isRequestHttps, parseCookies } from './security.js';
import { logger } from './logger.js';

export type { Session };
export { parseCookies };

export interface SessionStore {
  sessions: Map<string, Session>;
  hashSessionToken: (token: string) => string;
  saveSessionsAsync: () => Promise<void>;
  scheduleThrottledSessionsSave: () => void;
  setSessionCookie: (req: express.Request, res: express.Response, rawToken: string, maxAgeSec?: number) => void;
  clearSessionCookie: (req: express.Request, res: express.Response) => void;
  getSessionFromReq: (req: express.Request, options?: { touchLastSeen?: boolean }) => Session | null;
  isSessionValid: (tokenHash: string) => boolean;
  getSessionExpiryMs: (tokenHash: string) => number | null;
  revokeSession: (tokenHash: string) => boolean;
  revokeUserSessions: (userId: string, exceptTokenHash?: string) => number;
  onSessionsRevoked: (listener: (tokenHashes: string[]) => void) => () => void;
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => void;
  requireAdmin: (req: express.Request, res: express.Response, next: express.NextFunction) => void;
  close: () => Promise<void>;
}

export function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token.trim()).digest('hex');
}

export interface SessionPolicy {
  idleMs: number;
  maxMs: number;
  maxHours: number;
}

export function createSessionStore(
  config: ServerConfig,
  stateStore: StateStore,
  getSessionPolicy?: () => SessionPolicy
): SessionStore {
  const { dataDir, sessionsFile } = config;

  const resolvePolicy = (): SessionPolicy => {
    if (getSessionPolicy) {
      return getSessionPolicy();
    }
    return {
      idleMs: config.sessionIdleMs,
      maxMs: config.sessionMaxMs,
      maxHours: config.sessionMaxHours,
    };
  };

  const initialPolicy = resolvePolicy();
  logger.info(
    `[Server Auth] Polityka sesji: bezczynność maks. ${Math.round(initialPolicy.idleMs / 60000)} min, czas trwania maks. ${initialPolicy.maxHours} h`
  );

  const sessions = new Map<string, Session>();

  if (fs.existsSync(sessionsFile)) {
    try {
      const raw = fs.readFileSync(sessionsFile, 'utf-8');
      const parsed: any[] = JSON.parse(raw);
      const now = Date.now();
      for (const s of parsed) {
        if (!s) continue;
        const createdAt = typeof s.createdAt === 'number' ? s.createdAt : now;
        const lastSeenAt = typeof s.lastSeenAt === 'number' ? s.lastSeenAt : createdAt;
        const expiresAt = typeof s.expiresAt === 'number' ? s.expiresAt : (createdAt + initialPolicy.maxMs);
        let tokenHash = s.tokenHash;
        if (!tokenHash && s.token) {
          tokenHash = hashSessionToken(s.token);
        }
        if (!tokenHash) continue;

        const loadedSession: Session = {
          tokenHash,
          userId: s.userId,
          role: s.role,
          createdAt,
          expiresAt,
          lastSeenAt,
          userAgent: typeof s.userAgent === 'string' ? s.userAgent.slice(0, 200) : undefined,
          ip: typeof s.ip === 'string' ? s.ip : undefined,
        };

        if (!isSessionExpired(loadedSession, now, initialPolicy.idleMs, initialPolicy.maxMs)) {
          sessions.set(tokenHash, loadedSession);
        }
      }
      logger.info(`[Server Auth] Załadowano ${sessions.size} aktywnych sesji z pliku ${sessionsFile}`);
    } catch (err) {
      logger.warn('[Server Auth] Błąd odczytu sessions.json:', err);
    }
  }

  let sessionWriteQueue: Promise<void> = Promise.resolve();
  function saveSessionsAsync(): Promise<void> {
    const doWrite = async () => {
      try {
        const now = Date.now();
        const policy = resolvePolicy();
        const active = Array.from(sessions.values()).filter(
          (s) => !isSessionExpired(s, now, policy.idleMs, policy.maxMs)
        );
        const tmp = path.join(dataDir, 'sessions.json.tmp');
        await fs.promises.writeFile(tmp, JSON.stringify(active), { encoding: 'utf-8', mode: 0o600 });
        await fs.promises.chmod(tmp, 0o600);
        await fs.promises.rename(tmp, sessionsFile);
      } catch (err) {
        logger.error('[Server Auth] Błąd zapisu sessions.json:', err);
      }
    };
    sessionWriteQueue = sessionWriteQueue.then(doWrite, doWrite);
    return sessionWriteQueue;
  }

  let lastSessionsDiskSaveTime = 0;
  let pendingSessionSaveTimeout: NodeJS.Timeout | null = null;

  function scheduleThrottledSessionsSave() {
    const now = Date.now();
    if (now - lastSessionsDiskSaveTime >= SESSION_DISK_FLUSH_INTERVAL_MS) {
      lastSessionsDiskSaveTime = now;
      if (pendingSessionSaveTimeout) {
        clearTimeout(pendingSessionSaveTimeout);
        pendingSessionSaveTimeout = null;
      }
      saveSessionsAsync();
    } else if (!pendingSessionSaveTimeout) {
      const delay = SESSION_DISK_FLUSH_INTERVAL_MS - (now - lastSessionsDiskSaveTime);
      pendingSessionSaveTimeout = setTimeout(() => {
        pendingSessionSaveTimeout = null;
        lastSessionsDiskSaveTime = Date.now();
        saveSessionsAsync();
      }, delay);
      pendingSessionSaveTimeout.unref();
    }
  }

  function setSessionCookie(
    req: express.Request,
    res: express.Response,
    rawToken: string,
    maxAgeSec = resolvePolicy().maxHours * 3600
  ) {
    const isCrossSiteHttps = isCrossSiteHttpsRequest(req);
    const isHttps = isRequestHttps(req) || isCrossSiteHttps;
    const cookieName = isHttps ? '__Host-zp_session' : 'zp_session';
    const cookieParts = [
      `${cookieName}=${encodeURIComponent(rawToken)}`,
      'Path=/',
      'HttpOnly',
      isCrossSiteHttps ? 'SameSite=None' : 'SameSite=Lax',
      `Max-Age=${maxAgeSec}`,
    ];
    if (isHttps) {
      cookieParts.push('Secure');
    }
    if (isCrossSiteHttps) {
      cookieParts.push('Partitioned');
    }
    res.append('Set-Cookie', cookieParts.join('; '));
  }

  function clearSessionCookie(req: express.Request, res: express.Response) {
    const isCrossSiteHttps = isCrossSiteHttpsRequest(req);
    const isHttps = isRequestHttps(req) || isCrossSiteHttps;
    const sameSite = isCrossSiteHttps ? 'SameSite=None' : 'SameSite=Lax';
    const extra = isCrossSiteHttps ? '; Partitioned' : '';
    res.append(
      'Set-Cookie',
      `zp_session=; Path=/; HttpOnly; ${sameSite}; Max-Age=0${isHttps ? '; Secure' : ''}${extra}`
    );
    res.append(
      'Set-Cookie',
      `__Host-zp_session=; Path=/; HttpOnly; ${sameSite}; Max-Age=0; Secure${extra}`
    );
  }

  const revocationListeners = new Set<(tokenHashes: string[]) => void>();

  function notifySessionsRevoked(tokenHashes: string[]) {
    if (tokenHashes.length === 0) return;
    for (const listener of revocationListeners) {
      try {
        listener(tokenHashes);
      } catch (err) {
        logger.error('[Server Auth] Błąd powiadomienia o unieważnieniu sesji:', err);
      }
    }
  }

  function onSessionsRevoked(listener: (tokenHashes: string[]) => void): () => void {
    revocationListeners.add(listener);
    return () => {
      revocationListeners.delete(listener);
    };
  }

  function revokeSession(tokenHash: string): boolean {
    const existed = sessions.delete(tokenHash);
    if (existed) {
      notifySessionsRevoked([tokenHash]);
    }
    return existed;
  }

  function revokeUserSessions(userId: string, exceptTokenHash?: string): number {
    const revoked: string[] = [];
    for (const [tokenHash, s] of sessions.entries()) {
      if (s.userId === userId && tokenHash !== exceptTokenHash) {
        sessions.delete(tokenHash);
        revoked.push(tokenHash);
      }
    }
    notifySessionsRevoked(revoked);
    return revoked.length;
  }

  function isSessionValid(tokenHash: string): boolean {
    const session = sessions.get(tokenHash);
    if (!session) return false;
    const now = Date.now();
    const policy = resolvePolicy();
    if (isSessionExpired(session, now, policy.idleMs, policy.maxMs)) {
      sessions.delete(tokenHash);
      saveSessionsAsync();
      notifySessionsRevoked([tokenHash]);
      return false;
    }
    return true;
  }

  function getSessionExpiryMs(tokenHash: string): number | null {
    const session = sessions.get(tokenHash);
    if (!session) return null;
    const policy = resolvePolicy();
    const lastSeen = typeof session.lastSeenAt === 'number' ? session.lastSeenAt : session.createdAt;
    const idleDeadline = lastSeen + policy.idleMs;
    const maxDeadline = typeof session.expiresAt === 'number' ? session.expiresAt : session.createdAt + policy.maxMs;
    return Math.min(idleDeadline, maxDeadline);
  }

  function getSessionFromReq(req: express.Request, options?: { touchLastSeen?: boolean }): Session | null {
    const touchLastSeen = options?.touchLastSeen !== false;
    const cookies = parseCookies(req.headers.cookie);
    let rawToken = cookies['__Host-zp_session'] || cookies['zp_session'];
    if (!rawToken && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      rawToken = req.headers.authorization.slice(7).trim();
    }
    if (!rawToken && req.path === '/api/events' && typeof req.query?.token === 'string') {
      rawToken = req.query.token.trim();
    }
    if (!rawToken) return null;

    const tokenHash = hashSessionToken(rawToken);
    const session = sessions.get(tokenHash);
    if (!session) return null;

    const now = Date.now();
    const policy = resolvePolicy();
    if (isSessionExpired(session, now, policy.idleMs, policy.maxMs)) {
      sessions.delete(tokenHash);
      saveSessionsAsync();
      notifySessionsRevoked([tokenHash]);
      return null;
    }

    if (touchLastSeen) {
      const effectiveLastSeen = typeof session.lastSeenAt === 'number' ? session.lastSeenAt : session.createdAt;
      if (now - effectiveLastSeen >= 60 * 1000) {
        session.lastSeenAt = now;
        if (!session.ip) session.ip = getClientIp(req);
        if (!session.userAgent) session.userAgent = (req.headers['user-agent'] || '').slice(0, 200);
        scheduleThrottledSessionsSave();
      }
    }

    return session;
  }

  function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
    const session = getSessionFromReq(req);
    if (!session) {
      return res.status(401).json({ error: 'Wymagana autoryzacja (brak aktywnej sesji)' });
    }
    const user = (stateStore.getUsers() || []).find((u) => u.id === session.userId);
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

  async function close(): Promise<void> {
    if (pendingSessionSaveTimeout) {
      clearTimeout(pendingSessionSaveTimeout);
      pendingSessionSaveTimeout = null;
      await saveSessionsAsync();
    } else {
      await sessionWriteQueue;
    }
  }

  return {
    sessions,
    hashSessionToken,
    saveSessionsAsync,
    scheduleThrottledSessionsSave,
    setSessionCookie,
    clearSessionCookie,
    getSessionFromReq,
    isSessionValid,
    getSessionExpiryMs,
    revokeSession,
    revokeUserSessions,
    onSessionsRevoked,
    requireAuth,
    requireAdmin,
    close,
  };
}
