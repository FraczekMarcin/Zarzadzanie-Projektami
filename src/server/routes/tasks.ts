import express from 'express';
import {
  canAccessProject,
  canWrite,
  hasForbiddenKeys,
  pickAllowedTaskFields,
  buildNewTaskRecord,
} from '../../utils/access.js';
import { StateStore } from '../state.js';
import { SessionStore } from '../sessions.js';

export function registerTaskRoutes(
  app: express.Express,
  deps: { stateStore: StateStore; sessionStore: SessionStore }
): void {
  const { stateStore, sessionStore } = deps;
  const { requireAuth } = sessionStore;

  // POST /api/tasks
  app.post('/api/tasks', requireAuth, async (req, res) => {
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

      if (!body.title || !String(body.title).trim() || !body.projectId) {
        return res.status(400).json({ error: 'Wymagane pola zadania: title oraz projectId.' });
      }

      const targetProject = (appState.projects || []).find((p: any) => p.id === body.projectId);
      if (!targetProject) {
        return res.status(404).json({ error: `Projekt o ID "${body.projectId}" nie istnieje.` });
      }

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

      const sanitizedTitle = String(allowed.title ?? '').trim();
      if (!sanitizedTitle) {
        return res.status(400).json({ error: 'Wymagany tytuł zadania.' });
      }

      const projKey = targetProject?.key || 'ZAD';
      const existingCount = (appState.tasks || []).filter((t: any) => t.projectId === targetProject.id).length;

      let newTask: any;
      try {
        newTask = buildNewTaskRecord({
          body,
          allowed,
          caller,
          projectId: targetProject.id,
          reporterId: caller.id,
          projectKey: projKey,
          existingCount,
        });
      } catch (err: any) {
        return res.status(400).json({ error: err.message });
      }

      appState.tasks.unshift(newTask);
      const newRev = stateStore.bumpStateRevision();
      await stateStore.saveStateAtomicAsync();

      res.status(201).json({ success: true, task: newTask, revision: newRev });
    } catch (err: any) {
      console.error('[Server API] Błąd tworzenia zadania:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // PATCH /api/tasks/:id
  app.patch('/api/tasks/:id', requireAuth, async (req, res) => {
    try {
      const appState = stateStore.ensureStateStructure();
      const { id } = req.params;
      const caller = (req as any).user;
      if (!canWrite(caller)) {
        return res.status(403).json({ error: 'Rola viewer posiada dostęp wyłącznie do odczytu.' });
      }
      if (hasForbiddenKeys(req.body)) {
        return res.status(400).json({ error: 'Niedozwolony klucz w żądaniu (__proto__, constructor, prototype).' });
      }
      const patch = req.body || {};

      const task = (appState.tasks || []).find((t: any) => t.id === id);
      if (!task) {
        return res.status(404).json({ error: `Zadanie o ID "${id}" nie zostało znalezione.` });
      }

      const isAdminOrManager = caller.role === 'admin' || caller.role === 'project_manager';
      if (!isAdminOrManager) {
        const targetProject = (appState.projects || []).find((p: any) => p.id === task.projectId);
        const isMember = targetProject && Array.isArray(targetProject.memberIds) && targetProject.memberIds.includes(caller.id);
        const isAssigneeOrReporter = (task.assigneeId && task.assigneeId === caller.id) || (task.reporterId && task.reporterId === caller.id);
        if (!isMember && !isAssigneeOrReporter) {
          return res.status(403).json({ error: 'Brak uprawnień do edycji zadania w tym projekcie.' });
        }
      }

      if (patch.projectId !== undefined && patch.projectId !== task.projectId) {
        if (!isAdminOrManager) {
          return res.status(403).json({ error: 'Zmiana projektu zadania jest dozwolona wyłącznie dla roli administratora lub kierownika projektu.' });
        }
        const destProject = (appState.projects || []).find((p: any) => p.id === patch.projectId);
        if (!destProject) {
          return res.status(404).json({ error: `Projekt docelowy o ID "${patch.projectId}" nie istnieje.` });
        }
      }

      const rawIfMatch = req.headers['if-match'] || (patch.expectedRevision !== undefined ? String(patch.expectedRevision) : null);
      if (rawIfMatch) {
        const cleanMatch = String(rawIfMatch).replace(/["W\/]/g, '').trim();
        const currentRev = String(task.revision !== undefined ? task.revision : 1);
        if (cleanMatch !== '*' && cleanMatch !== currentRev) {
          return res.status(409).json({
            error: 'Konflikt wersji zadania (zostało zmodyfikowane przez innego użytkownika).',
            currentTask: task,
            revision: appState.revision,
          });
        }
      }

      let allowedUpdates: Record<string, any>;
      try {
        allowedUpdates = pickAllowedTaskFields(patch, caller);
      } catch (err: any) {
        return res.status(400).json({ error: err.message });
      }

      if (allowedUpdates.title !== undefined) {
        const sanitizedTitle = String(allowedUpdates.title).trim();
        if (!sanitizedTitle) {
          return res.status(400).json({ error: 'Wymagany tytuł zadania.' });
        }
        allowedUpdates.title = sanitizedTitle;
      }

      for (const [key, value] of Object.entries(allowedUpdates)) {
        task[key] = value;
      }

      task.revision = (task.revision || 1) + 1;
      task.updatedAt = new Date().toISOString();

      const newRev = stateStore.bumpStateRevision();
      await stateStore.saveStateAtomicAsync();

      res.json({ success: true, task, revision: newRev });
    } catch (err: any) {
      console.error('[Server API] Błąd aktualizacji zadania:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/tasks/:id
  app.delete('/api/tasks/:id', requireAuth, async (req, res) => {
    try {
      const appState = stateStore.ensureStateStructure();
      const { id } = req.params;
      const caller = (req as any).user;
      if (!canWrite(caller)) {
        return res.status(403).json({ error: 'Rola viewer posiada dostęp wyłącznie do odczytu.' });
      }

      const task = (appState.tasks || []).find((t: any) => t.id === id);
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

      appState.tasks = appState.tasks.filter((t: any) => t.id !== id);
      const newRev = stateStore.bumpStateRevision();
      await stateStore.saveStateAtomicAsync();

      res.json({ success: true, revision: newRev });
    } catch (err: any) {
      console.error('[Server API] Błąd usuwania zadania:', err);
      res.status(500).json({ error: err.message });
    }
  });
}
