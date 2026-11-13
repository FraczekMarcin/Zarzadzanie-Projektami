import express from 'express';
import crypto from 'crypto';
import { buildIcs } from '../../utils/icsBuilder.js';
import { canAccessProject } from '../../utils/access.js';
import { StateStore } from '../state.js';
import { SessionStore } from '../sessions.js';

export function registerCalendarRoutes(
  app: express.Express,
  deps: { stateStore: StateStore; sessionStore: SessionStore }
): void {
  const { stateStore, sessionStore } = deps;
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
      res.json({ success: true, token: rawToken, createdAt: nowIso });
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

    if (authUser.role !== 'admin' && authUser.role !== 'project_manager') {
      const accessibleProjectIds = new Set(
        allProjects.filter((p: any) => canAccessProject(authUser, p)).map((p: any) => p.id)
      );
      userTasks = userTasks.filter(
        (t: any) => accessibleProjectIds.has(t.projectId) || t.assigneeId === authUser.id || t.reporterId === authUser.id
      );
    }

    const icsBody = buildIcs(userTasks, `${userName} - Moje Zadania`);

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
}
