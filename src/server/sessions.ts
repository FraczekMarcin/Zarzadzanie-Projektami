import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Session, isSessionExpired } from '../utils/sessions.js';
import { ServerConfig, SESSION_DISK_FLUSH_INTERVAL_MS } from './config.js';
import { StateStore } from './state.js';
import { getClientIp, isRequestHttps, parseCookies } from './security.js';

export type { Session };
export { parseCookies };

export interface SessionStore {
  sessions: Map<string, Session>;
  hashSessionToken: (token: string) => string;
  saveSessionsAsync: () => Promise<void>;
  scheduleThrottledSessionsSave: () => void;
  setSessionCookie: (req: express.Request, res: express.Response, rawToken: string, maxAgeSec?: number) => void;
  clearSessionCookie: (req: express.Request, res: express.Response) => void;
  getSessionFromReq: (req: express.Request) => Session | null;
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => void;
  requireAdmin: (req: express.Request, res: express.Response, next: express.NextFunction) => void;
  close: () => Promise<void>;
}

export function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token.trim()).digest('hex');
}

export function createSessionStore(config: ServerConfig, stateStore: StateStore): SessionStore {
  const {
    dataDir,
    sessionsFile,
    sessionIdleMinutes,
    sessionIdleMs,
    sessionMaxHours,
    sessionMaxMs,
  } = config;

  console.log(`[Server Auth] Polityka sesji: bezczynność maks. ${sessionIdleMinutes} min, czas trwania maks. ${sessionMaxHours} h`);

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
        const expiresAt = typeof s.expiresAt === 'number' ? s.expiresAt : (createdAt + sessionMaxMs);
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

        if (!isSessionExpired(loadedSession, now, sessionIdleMs, sessionMaxMs)) {
          sessions.set(tokenHash, loadedSession);
        }
      }
      console.log(`[Server Auth] Załadowano ${sessions.size} aktywnych sesji z pliku ${sessionsFile}`);
    } catch (err) {
      console.warn('[Server Auth] Błąd odczytu sessions.json:', err);
    }
  }

  let sessionWriteQueue: Promise<void> = Promise.resolve();
  function saveSessionsAsync(): Promise<void> {
    const doWrite = async () => {
      try {
        const now = Date.now();
        const active = Array.from(sessions.values()).filter(
          (s) => !isSessionExpired(s, now, sessionIdleMs, sessionMaxMs)
        );
        const tmp = path.join(dataDir, 'sessions.json.tmp');
        await fs.promises.writeFile(tmp, JSON.stringify(active), 'utf-8');
        await fs.promises.rename(tmp, sessionsFile);
      } catch (err) {
        console.error('[Server Auth] Błąd zapisu sessions.json:', err);
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
    maxAgeSec = sessionMaxHours * 3600
  ) {
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

    const now = Date.now();
    if (isSessionExpired(session, now, sessionIdleMs, sessionMaxMs)) {
      sessions.delete(tokenHash);
      saveSessionsAsync();
      return null;
    }

    const effectiveLastSeen = typeof session.lastSeenAt === 'number' ? session.lastSeenAt : session.createdAt;
    if (now - effectiveLastSeen >= 60 * 1000) {
      session.lastSeenAt = now;
      if (!session.ip) session.ip = getClientIp(req);
      if (!session.userAgent) session.userAgent = (req.headers['user-agent'] || '').slice(0, 200);
      scheduleThrottledSessionsSave();
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
    requireAuth,
    requireAdmin,
    close,
  };
}
