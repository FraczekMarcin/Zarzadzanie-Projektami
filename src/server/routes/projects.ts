import express from 'express';
import crypto from 'crypto';
import {
  filterProjectForUser,
  canWrite,
  hasForbiddenKeys,
  pickAllowedProjectFields,
} from '../../utils/access.js';
import { StateStore } from '../state.js';
import { SessionStore } from '../sessions.js';

export function registerProjectRoutes(
  app: express.Express,
  deps: { stateStore: StateStore; sessionStore: SessionStore }
): void {
  const { stateStore, sessionStore } = deps;
  const { requireAuth } = sessionStore;

  // POST /api/projects
  app.post('/api/projects', requireAuth, async (req, res) => {
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

      if (!body.name || !String(body.name).trim()) {
        return res.status(400).json({ error: 'Wymagana nazwa projektu.' });
      }

      let allowed: Record<string, any>;
      try {
        allowed = pickAllowedProjectFields(body, caller);
      } catch (err: any) {
        return res.status(400).json({ error: err.message });
      }

      const sanitizedName = String(allowed.name ?? '').trim();
      if (!sanitizedName) {
        return res.status(400).json({ error: 'Wymagana nazwa projektu.' });
      }

      const isAdminOrManager = caller.role === 'admin' || caller.role === 'project_manager';
      let members: string[];
      if (isAdminOrManager && Array.isArray(allowed.memberIds)) {
        members = Array.from(new Set(allowed.memberIds));
      } else {
        members = [caller.id];
      }
      if (!members.includes(caller.id)) {
        members.push(caller.id);
      }

      const rawKey = allowed.key || 'PRJ';
      const key = String(rawKey).toUpperCase().trim().slice(0, 10);
      const now = new Date().toISOString();

      const newProject = {
        ...allowed,
        id: crypto.randomUUID(),
        key,
        name: sanitizedName,
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

      appState.projects.push(newProject);
      const newRev = stateStore.bumpStateRevision();
      await stateStore.saveStateAtomicAsync();

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

  // PATCH /api/projects/:id
  app.patch('/api/projects/:id', requireAuth, async (req, res) => {
    try {
      const appState = stateStore.ensureStateStructure();
      const caller = (req as any).user;
      if (!canWrite(caller)) {
        return res.status(403).json({ error: 'Rola viewer posiada dostęp wyłącznie do odczytu.' });
      }
      if (hasForbiddenKeys(req.body)) {
        return res.status(400).json({ error: 'Niedozwolony klucz w żądaniu (__proto__, constructor, prototype).' });
      }
      const { id } = req.params;
      const patch = req.body || {};

      const project = (appState.projects || []).find((p: any) => p.id === id);
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
            revision: appState.revision,
          });
        }
      }

      let allowedUpdates: Record<string, any>;
      try {
        allowedUpdates = pickAllowedProjectFields(patch, caller);
      } catch (err: any) {
        return res.status(400).json({ error: err.message });
      }

      if (allowedUpdates.name !== undefined) {
        const sanitizedName = String(allowedUpdates.name).trim();
        if (!sanitizedName) {
          return res.status(400).json({ error: 'Wymagana nazwa projektu.' });
        }
        allowedUpdates.name = sanitizedName;
      }

      if (allowedUpdates.key !== undefined) {
        allowedUpdates.key = String(allowedUpdates.key).toUpperCase().trim().slice(0, 10);
      }

      for (const [key, value] of Object.entries(allowedUpdates)) {
        project[key] = value;
      }

      project.revision = (project.revision || 1) + 1;
      const newRev = stateStore.bumpStateRevision();
      await stateStore.saveStateAtomicAsync();

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

  // DELETE /api/projects/:id
  app.delete('/api/projects/:id', requireAuth, async (req, res) => {
    try {
      const appState = stateStore.ensureStateStructure();
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

      const projectIndex = (appState.projects || []).findIndex((p: any) => p.id === id);
      if (projectIndex === -1) {
        return res.status(404).json({ error: `Projekt o ID "${id}" nie istnieje.` });
      }

      appState.projects.splice(projectIndex, 1);
      appState.tasks = (appState.tasks || []).filter((t: any) => t.projectId !== id);

      const newRev = stateStore.bumpStateRevision();
      await stateStore.saveStateAtomicAsync();

      res.json({ success: true, revision: newRev });
    } catch (err: any) {
      console.error('[Server API] Błąd usuwania projektu:', err);
      res.status(500).json({ error: err.message });
    }
  });
}
