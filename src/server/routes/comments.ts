import express from 'express';
import crypto from 'crypto';
import { canAccessProject, canWrite, hasForbiddenKeys } from '../../utils/access.js';
import { StateStore } from '../state.js';
import { SessionStore } from '../sessions.js';

export function registerCommentRoutes(
  app: express.Express,
  deps: { stateStore: StateStore; sessionStore: SessionStore }
): void {
  const { stateStore, sessionStore } = deps;
  const { requireAuth } = sessionStore;

  // POST /api/comments (Dodanie komentarza z autoryzacją)
  app.post('/api/comments', requireAuth, async (req, res) => {
    try {
      const appState = stateStore.ensureStateStructure();
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

      const task = (appState.tasks || []).find((t: any) => t.id === taskId);
      if (!task) {
        return res.status(404).json({ error: `Zadanie o ID "${taskId}" nie istnieje.` });
      }

      const isAdminOrManager = caller.role === 'admin' || caller.role === 'project_manager';
      if (!isAdminOrManager) {
        const targetProject = (appState.projects || []).find((p: any) => p.id === task.projectId);
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

      appState.comments.push(newComment);
      const newRev = stateStore.bumpStateRevision();
      await stateStore.saveStateAtomicAsync();

      res.status(201).json({ success: true, comment: newComment, revision: newRev });
    } catch (err: any) {
      console.error('[Server API] Błąd dodawania komentarza:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/comments/:id (Usuwanie komentarza: tylko autor lub administrator)
  app.delete('/api/comments/:id', requireAuth, async (req, res) => {
    try {
      const appState = stateStore.ensureStateStructure();
      const caller = (req as any).user;
      if (!canWrite(caller)) {
        return res.status(403).json({ error: 'Rola viewer posiada dostęp wyłącznie do odczytu.' });
      }
      const { id } = req.params;

      const comment = (appState.comments || []).find((c: any) => c.id === id);
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

      appState.comments = appState.comments.filter((c: any) => c.id !== id);
      const newRev = stateStore.bumpStateRevision();
      await stateStore.saveStateAtomicAsync();

      res.json({ success: true, revision: newRev });
    } catch (err: any) {
      console.error('[Server API] Błąd usuwania komentarza:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/activity (Rejestracja wpisu w dzienniku aktywności z walidacją projektu i limitów)
  app.post('/api/activity', requireAuth, async (req, res) => {
    try {
      const appState = stateStore.ensureStateStructure();
      const caller = (req as any).user;
      if (!canWrite(caller)) {
        return res.status(403).json({ error: 'Rola viewer posiada dostęp wyłącznie do odczytu.' });
      }
      if (hasForbiddenKeys(req.body)) {
        return res.status(400).json({ error: 'Niedozwolony klucz w żądaniu (__proto__, constructor, prototype).' });
      }
      const body = req.body || {};

      if (!body.projectId || typeof body.projectId !== 'string' || !body.projectId.trim()) {
        return res.status(400).json({ error: 'Wymagane pole: projectId.' });
      }

      const projectId = body.projectId.trim();
      const project = (appState.projects || []).find((p: any) => p.id === projectId);
      if (!project) {
        return res.status(404).json({ error: `Projekt o ID "${projectId}" nie istnieje.` });
      }

      if (!canAccessProject(caller, project)) {
        return res.status(403).json({ error: 'Brak uprawnień do rejestracji aktywności w tym projekcie.' });
      }

      if (!body.action || typeof body.action !== 'string' || !body.action.trim()) {
        return res.status(400).json({ error: 'Wymagane pole: action.' });
      }
      const action = body.action.trim();
      if (action.length > 200) {
        return res.status(400).json({ error: 'Pole action może mieć maksymalnie 200 znaków.' });
      }

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

      let taskId: string | undefined;
      if (body.taskId) {
        if (typeof body.taskId !== 'string') {
          return res.status(400).json({ error: 'Pole taskId musi być tekstem.' });
        }
        taskId = body.taskId.trim();
        const task = (appState.tasks || []).find((t: any) => t.id === taskId);
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

      appState.activityLogs.unshift(newLog);
      if (appState.activityLogs.length > 500) {
        appState.activityLogs = appState.activityLogs.slice(0, 500);
      }
      const newRev = stateStore.bumpStateRevision();
      await stateStore.saveStateAtomicAsync();

      res.status(201).json({ success: true, log: newLog, revision: newRev });
    } catch (err: any) {
      console.error('[Server API] Błąd zapisu aktywności:', err);
      res.status(500).json({ error: err.message });
    }
  });
}
