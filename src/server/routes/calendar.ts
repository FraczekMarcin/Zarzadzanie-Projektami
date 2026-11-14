import express from 'express';
import crypto from 'crypto';
import { buildIcs, IcsProject, IcsTask } from '../../utils/icsBuilder.js';
import { canAccessProject } from '../../utils/access.js';
import { ServerConfig } from '../config.js';
import { StateStore } from '../state.js';
import { SessionStore } from '../sessions.js';

function computeLastModifiedMs(tasks: IcsTask[], stateUpdatedAt?: string): number {
  let maxMs = 0;
  for (const t of tasks) {
    const raw = t.updatedAt || t.createdAt;
    if (!raw) continue;
    const ms = Date.parse(raw);
    if (!isNaN(ms) && ms > maxMs) {
      maxMs = ms;
    }
  }
  if (maxMs === 0 && stateUpdatedAt) {
    const stateMs = Date.parse(stateUpdatedAt);
    if (!isNaN(stateMs) && stateMs > 0) {
      maxMs = stateMs;
    }
  }
  if (maxMs === 0) {
    maxMs = Date.UTC(2026, 0, 1);
  }
  return maxMs;
}

function sendIcsWithCaching(
  req: express.Request,
  res: express.Response,
  icsBody: string,
  filename: string,
  lastModifiedMs: number
) {
  const etagHash = crypto.createHash('sha256').update(icsBody, 'utf-8').digest('hex');
  const etag = `"${etagHash}"`;
  const lastModifiedHttp = new Date(lastModifiedMs).toUTCString();

  res.setHeader('ETag', etag);
  res.setHeader('Last-Modified', lastModifiedHttp);
  res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');

  const ifNoneMatch = req.headers['if-none-match'];
  if (typeof ifNoneMatch === 'string' && ifNoneMatch.trim() !== '') {
    const candidates = ifNoneMatch.split(',').map((s) => s.trim().replace(/^W\//, ''));
    if (candidates.includes('*') || candidates.includes(etag)) {
      return res.status(304).end();
    }
  }

  const ifModifiedSince = req.headers['if-modified-since'];
  if (!ifNoneMatch && typeof ifModifiedSince === 'string') {
    const imsMs = Date.parse(ifModifiedSince);
    const lmSecMs = Math.floor(lastModifiedMs / 1000) * 1000;
    if (!isNaN(imsMs) && lmSecMs <= imsMs) {
      return res.status(304).end();
    }
  }

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  return res.send(icsBody);
}

export function registerCalendarRoutes(
  app: express.Express,
  deps: { config: ServerConfig; stateStore: StateStore; sessionStore: SessionStore }
): void {
  const { config, stateStore, sessionStore } = deps;
  const { requireAuth } = sessionStore;

  function getUserByCalendarToken(token: string) {
    if (!token || typeof token !== 'string') return null;
    const clean = token.trim();
    if (clean.length < 16) return null;
    const tokenHash = crypto.createHash('sha256').update(clean).digest('hex');
    const appState = stateStore.getAppState();
    return (appState?.users || []).find((u: any) => u.calendarTokenHash === tokenHash && u.isApproved !== false) || null;
  }

  // GET /api/calendar/token (Sprawdzenie statusu tokenu zalogowanego użytkownika)
  app.get('/api/calendar/token', requireAuth, (req, res) => {
    const appState = stateStore.ensureStateStructure();
    const caller = (req as any).user;
    const user = (appState.users || []).find((u: any) => u.id === caller.id);
    res.json({
      hasToken: Boolean(user?.calendarTokenHash),
      createdAt: user?.calendarTokenCreatedAt || null,
      ...(config.publicBaseUrl ? { publicBaseUrl: config.publicBaseUrl } : {}),
    });
  });

  // POST /api/calendar/token/generate (Wygenerowanie nowego prywatnego tokenu i zapisanie hasha SHA-256)
  app.post('/api/calendar/token/generate', requireAuth, async (req, res) => {
    try {
      const appState = stateStore.ensureStateStructure();
      const caller = (req as any).user;
      const user = (appState.users || []).find((u: any) => u.id === caller.id);
      if (!user) {
        return res.status(404).json({ error: 'Użytkownik nie istnieje.' });
      }

      const rawToken = crypto.randomBytes(24).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const nowIso = new Date().toISOString();

      user.calendarTokenHash = tokenHash;
      user.calendarTokenCreatedAt = nowIso;

      const userInCache = stateStore.getUsers().find((u) => u.id === caller.id);
      if (userInCache) {
        userInCache.calendarTokenHash = tokenHash;
        userInCache.calendarTokenCreatedAt = nowIso;
      }

      await stateStore.saveStateAtomicAsync();
      res.json({
        success: true,
        token: rawToken,
        createdAt: nowIso,
        ...(config.publicBaseUrl ? { publicBaseUrl: config.publicBaseUrl } : {}),
      });
    } catch (err: any) {
      console.error('[Server Calendar] Błąd generowania tokenu:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/calendar/token (Odwołanie tokenu kalendarza)
  app.delete('/api/calendar/token', requireAuth, async (req, res) => {
    try {
      const appState = stateStore.ensureStateStructure();
      const caller = (req as any).user;
      const user = (appState.users || []).find((u: any) => u.id === caller.id);
      if (!user) {
        return res.status(404).json({ error: 'Użytkownik nie istnieje.' });
      }

      delete user.calendarTokenHash;
      delete user.calendarTokenCreatedAt;

      const userInCache = stateStore.getUsers().find((u) => u.id === caller.id);
      if (userInCache) {
        delete userInCache.calendarTokenHash;
        delete userInCache.calendarTokenCreatedAt;
      }

      await stateStore.saveStateAtomicAsync();
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
    const appState = stateStore.ensureStateStructure();
    const { token } = req.params;
    const user = getUserByCalendarToken(token);
    if (!user) {
      return res.status(404).type('text/plain; charset=utf-8').send('Not Found: Nieprawidłowy lub wygasły token kalendarza.');
    }

    const allProjects = appState?.projects || [];
    const allTasks = appState?.tasks || [];

    const projectsMap = new Map<string, IcsProject>();
    let visibleTasks: any[];
    if (user.role === 'admin' || user.role === 'project_manager') {
      visibleTasks = allTasks;
      for (const p of allProjects) {
        if (p && p.id) projectsMap.set(p.id, p);
      }
    } else {
      const accessibleProjects = allProjects.filter((p: any) => canAccessProject(user, p));
      const accessibleProjectIds = new Set(accessibleProjects.map((p: any) => p.id));
      for (const p of accessibleProjects) {
        if (p && p.id) projectsMap.set(p.id, p);
      }
      visibleTasks = allTasks.filter(
        (t: any) => accessibleProjectIds.has(t.projectId) || t.assigneeId === user.id || t.reporterId === user.id
      );
    }

    const icsBody = buildIcs(visibleTasks, 'Wszystkie Projekty - Terminarz', {
      projects: projectsMap,
      publicBaseUrl: config.publicBaseUrl,
    });
    const lastModifiedMs = computeLastModifiedMs(visibleTasks, appState?.updatedAt);
    return sendIcsWithCaching(req, res, icsBody, 'wszystkie-projekty.ics', lastModifiedMs);
  });

  // RFC 5545 iCalendar feed dla konkretnego użytkownika (z tokenem w URL)
  app.get('/api/calendar/:token/user/:userId.ics', (req, res) => {
    const appState = stateStore.ensureStateStructure();
    const { token, userId } = req.params;
    const authUser = getUserByCalendarToken(token);
    if (!authUser) {
      return res.status(404).type('text/plain; charset=utf-8').send('Not Found: Nieprawidłowy lub wygasły token kalendarza.');
    }

    if (authUser.id !== userId && authUser.role !== 'admin') {
      return res.status(403).type('text/plain; charset=utf-8').send('Forbidden: Dostęp ograniczony wyłącznie do własnego kalendarza.');
    }

    const targetUser = (appState.users || []).find((u: any) => u.id === userId);
    const userName = targetUser ? targetUser.name : 'Użytkownik';

    const allProjects = appState?.projects || [];
    const allTasks = appState?.tasks || [];

    let userTasks = allTasks.filter((t: any) => t.assigneeId === userId || (!t.assigneeId && authUser.id === userId));
    const projectsMap = new Map<string, IcsProject>();

    if (authUser.role !== 'admin' && authUser.role !== 'project_manager') {
      const accessibleProjects = allProjects.filter((p: any) => canAccessProject(authUser, p));
      const accessibleProjectIds = new Set(accessibleProjects.map((p: any) => p.id));
      for (const p of accessibleProjects) {
        if (p && p.id) projectsMap.set(p.id, p);
      }
      userTasks = userTasks.filter(
        (t: any) => accessibleProjectIds.has(t.projectId) || t.assigneeId === authUser.id || t.reporterId === authUser.id
      );
    } else {
      for (const p of allProjects) {
        if (p && p.id) projectsMap.set(p.id, p);
      }
    }

    const icsBody = buildIcs(userTasks, `${userName} - Moje Zadania`, {
      projects: projectsMap,
      publicBaseUrl: config.publicBaseUrl,
    });
    const lastModifiedMs = computeLastModifiedMs(userTasks, appState?.updatedAt);

    const safeBaseName = (userId || 'kalendarz')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'kalendarz';

    return sendIcsWithCaching(req, res, icsBody, `${safeBaseName}.ics`, lastModifiedMs);
  });
}
