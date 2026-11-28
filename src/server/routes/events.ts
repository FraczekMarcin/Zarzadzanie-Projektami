import express from 'express';
import { StateStore } from '../state.js';
import { SessionStore } from '../sessions.js';

export const MAX_SSE_STREAMS_PER_USER = 5;
export const SSE_KEEP_ALIVE_INTERVAL_MS = 25000;

interface SseClient {
  userId: string;
  tokenHash: string;
  res: express.Response;
  close: () => void;
}

export interface EventRoutesHandle {
  closeAll: () => void;
  notifyPermissionsChanged: (options?: { userIds?: string[] | null }) => void;
}

export function registerEventRoutes(
  app: express.Express,
  deps: { stateStore: StateStore; sessionStore: SessionStore }
): EventRoutesHandle {
  const { stateStore, sessionStore } = deps;
  const clientsByUser = new Map<string, Set<SseClient>>();
  const clientsByTokenHash = new Map<string, Set<SseClient>>();

  const isClientActiveAndValid = (client: SseClient): boolean => {
    if (!sessionStore.isSessionValid(client.tokenHash)) {
      return false;
    }
    const user = (stateStore.getUsers() || []).find((u) => u.id === client.userId);
    if (!user || user.isApproved === false) {
      return false;
    }
    return true;
  };

  const unsubscribeRevision = stateStore.onRevisionChange((revision) => {
    const payload = `event: revision\ndata: ${JSON.stringify({ revision })}\n\n`;
    const allClients = Array.from(clientsByUser.values()).flatMap((set) => Array.from(set));
    for (const client of allClients) {
      if (!isClientActiveAndValid(client)) {
        client.close();
        continue;
      }
      try {
        if (!client.res.writableEnded) {
          client.res.write(payload);
        }
      } catch {
        client.close();
      }
    }
  });

  const unsubscribeRevocations = sessionStore.onSessionsRevoked((tokenHashes) => {
    for (const tokenHash of tokenHashes) {
      const set = clientsByTokenHash.get(tokenHash);
      if (!set) continue;
      for (const client of Array.from(set)) {
        client.close();
      }
    }
  });

  app.get('/api/events', (req, res) => {
    // Odczyt sesji BEZ odświeżania lastSeenAt (otwarta karta nie blokuje wygasania po bezczynności)
    const session = sessionStore.getSessionFromReq(req, { touchLastSeen: false });
    if (!session) {
      return res.status(401).json({ error: 'Wymagana autoryzacja (brak aktywnej sesji)' });
    }

    const user = (stateStore.getUsers() || []).find((u) => u.id === session.userId);
    if (!user || user.isApproved === false) {
      return res.status(401).json({ error: 'Użytkownik nie istnieje lub nie został zatwierdzony' });
    }

    const existingForUser = clientsByUser.get(user.id);
    if (existingForUser && existingForUser.size >= MAX_SSE_STREAMS_PER_USER) {
      return res.status(429).json({
        error: `Przekroczono limit ${MAX_SSE_STREAMS_PER_USER} jednoczesnych połączeń strumienia zdarzeń na użytkownika.`,
      });
    }

    req.setTimeout?.(0);
    res.setTimeout?.(0);
    req.socket?.setTimeout?.(0);

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let closed = false;
    let keepAliveTimer: NodeJS.Timeout | null = null;
    let expiryTimer: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (closed) return;
      closed = true;

      if (keepAliveTimer) {
        clearInterval(keepAliveTimer);
        keepAliveTimer = null;
      }
      if (expiryTimer) {
        clearTimeout(expiryTimer);
        expiryTimer = null;
      }

      const uSet = clientsByUser.get(user.id);
      if (uSet) {
        uSet.delete(client);
        if (uSet.size === 0) {
          clientsByUser.delete(user.id);
        }
      }

      const tSet = clientsByTokenHash.get(session.tokenHash);
      if (tSet) {
        tSet.delete(client);
        if (tSet.size === 0) {
          clientsByTokenHash.delete(session.tokenHash);
        }
      }

      try {
        if (!res.writableEnded) {
          res.end();
        }
      } catch {
        // ignore close errors
      }
    };

    const client: SseClient = {
      userId: user.id,
      tokenHash: session.tokenHash,
      res,
      close: cleanup,
    };

    if (!clientsByUser.has(user.id)) {
      clientsByUser.set(user.id, new Set());
    }
    clientsByUser.get(user.id)!.add(client);

    if (!clientsByTokenHash.has(session.tokenHash)) {
      clientsByTokenHash.set(session.tokenHash, new Set());
    }
    clientsByTokenHash.get(session.tokenHash)!.add(client);

    const scheduleExpiryCheck = () => {
      if (closed) return;
      if (expiryTimer) {
        clearTimeout(expiryTimer);
        expiryTimer = null;
      }
      const expiryMs = sessionStore.getSessionExpiryMs(session.tokenHash);
      if (expiryMs === null) {
        cleanup();
        return;
      }
      const remainingMs = expiryMs - Date.now();
      if (remainingMs <= 0) {
        isClientActiveAndValid(client);
        cleanup();
        return;
      }
      // Sprawdzaj wygaśnięcie bez czekania pełnych 25s przy krótkim czasie bezczynności (np. w testach)
      if (remainingMs < SSE_KEEP_ALIVE_INTERVAL_MS) {
        expiryTimer = setTimeout(() => {
          expiryTimer = null;
          if (!isClientActiveAndValid(client)) {
            cleanup();
          } else {
            scheduleExpiryCheck();
          }
        }, remainingMs + 10);
        expiryTimer.unref();
      }
    };

    // Natychmiastowe wysłanie bieżącej rewizji po nawiązaniu połączenia
    const currentRevision = stateStore.getAppState()?.revision || 0;
    try {
      res.write(`event: revision\ndata: ${JSON.stringify({ revision: currentRevision })}\n\n`);
    } catch {
      cleanup();
      return;
    }

    keepAliveTimer = setInterval(() => {
      if (closed) return;
      if (!isClientActiveAndValid(client)) {
        cleanup();
        return;
      }
      try {
        res.write(': keep-alive\n\n');
      } catch {
        cleanup();
        return;
      }
      scheduleExpiryCheck();
    }, SSE_KEEP_ALIVE_INTERVAL_MS);
    keepAliveTimer.unref();

    scheduleExpiryCheck();

    req.on('close', cleanup);
    res.on('close', cleanup);
    res.on('error', cleanup);
  });

  const notifyPermissionsChanged = (options?: { userIds?: string[] | null }) => {
    const targetIds =
      Array.isArray(options?.userIds) && options.userIds.length > 0
        ? new Set(options.userIds)
        : null;
    const targets: SseClient[] = targetIds
      ? Array.from(targetIds).flatMap((uid) => Array.from(clientsByUser.get(uid) || []))
      : Array.from(clientsByUser.values()).flatMap((set) => Array.from(set));

    const ts = new Date().toISOString();
    for (const client of targets) {
      if (!isClientActiveAndValid(client)) {
        client.close();
        continue;
      }
      const payload = `event: permissions\ndata: ${JSON.stringify({ ts, userId: client.userId })}\n\n`;
      try {
        if (!client.res.writableEnded) {
          client.res.write(payload);
        }
      } catch {
        client.close();
      }
    }
  };

  const closeAll = () => {
    unsubscribeRevision();
    unsubscribeRevocations();
    const allClients = Array.from(clientsByUser.values()).flatMap((set) => Array.from(set));
    for (const client of allClients) {
      client.close();
    }
    clientsByUser.clear();
    clientsByTokenHash.clear();
  };

  return { closeAll, notifyPermissionsChanged };
}
