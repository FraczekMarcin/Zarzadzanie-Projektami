import express from 'express';
import crypto from 'crypto';
import {
  canWrite,
  hasForbiddenKeys,
  pickAllowedTaskFields,
  buildNewTaskRecord,
} from '../../utils/access.js';
import { can, canUserUseCompanyPermission, hasMatchingCompanyMembership, sanitizePermissionArray } from '../../utils/permissions.js';
import { canReparent, reconcileParentCompletionOnReparent } from '../../utils/taskTree.js';
import {
  hasDirectSubtasks,
  reconcileLeafTaskConsistency,
  recomputeProjectProgress,
} from '../../utils/progress.js';
import { DISK_FULL_ERROR_MESSAGE, isDiskFullError, StateStore } from '../state.js';
import { SessionStore } from '../sessions.js';
import { SettingsService } from '../settings.js';
import { moveTaskToTrash } from '../trash.js';
import { logger } from '../logger.js';

export function registerTaskRoutes(
  app: express.Express,
  deps: { stateStore: StateStore; sessionStore: SessionStore; settingsService: SettingsService }
): void {
  const { stateStore, sessionStore, settingsService } = deps;
  const { requireAuth } = sessionStore;

  // POST /api/tasks
  app.post('/api/tasks', requireAuth, async (req, res) => {
    try {
      const appState = stateStore.ensureStateStructure();
      const permConfig = appState.permissionConfig;
      const caller = (req as any).user;
      if (!canWrite(caller, permConfig)) {
        return res.status(403).json({ error: 'Brak uprawnień do tworzenia zadań.' });
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

      if (!can(caller, 'tasks.edit', targetProject, permConfig)) {
        return res.status(403).json({ error: 'Brak uprawnień do tworzenia zadań w tym projekcie.' });
      }

      let allowed: Record<string, any>;
      try {
        allowed = pickAllowedTaskFields(body, caller, { permissionConfig: permConfig });
      } catch (err: any) {
        return res.status(400).json({ error: err.message });
      }

      const sanitizedTitle = String(allowed.title ?? '').trim();
      if (!sanitizedTitle) {
        return res.status(400).json({ error: 'Wymagany tytuł zadania.' });
      }

      if (Object.prototype.hasOwnProperty.call(allowed, 'parentId')) {
        if (allowed.parentId === '' || allowed.parentId === null || allowed.parentId === undefined) {
          delete allowed.parentId;
        } else {
          const parentCheck = canReparent(appState.tasks || [], null, allowed.parentId, targetProject.id);
          if (!parentCheck.ok) {
            return res.status(400).json({ error: parentCheck.error });
          }
          allowed.parentId = String(allowed.parentId).trim();
        }
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

      reconcileLeafTaskConsistency(newTask, { hasSubtasks: false });
      appState.tasks.unshift(newTask);
      recomputeProjectProgress(appState, targetProject.id, {
        weighting: settingsService.getEffectiveProgressWeighting(),
      });
      const newRev = stateStore.bumpStateRevision();
      await stateStore.saveStateAtomicAsync();

      res.status(201).json({ success: true, task: newTask, revision: newRev });
    } catch (err: any) {
      if (isDiskFullError(err)) {
        return res.status(507).json({ error: DISK_FULL_ERROR_MESSAGE });
      }
      logger.error('[Server API] Błąd tworzenia zadania:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // PATCH /api/tasks/:id
  app.patch('/api/tasks/:id', requireAuth, async (req, res) => {
    try {
      const appState = stateStore.ensureStateStructure();
      const permConfig = appState.permissionConfig;
      const { id } = req.params;
      const caller = (req as any).user;
      if (!canWrite(caller, permConfig)) {
        return res.status(403).json({ error: 'Brak uprawnień do edycji zadań.' });
      }
      if (hasForbiddenKeys(req.body)) {
        return res.status(400).json({ error: 'Niedozwolony klucz w żądaniu (__proto__, constructor, prototype).' });
      }
      const patch = req.body || {};

      const task = (appState.tasks || []).find((t: any) => t.id === id);
      if (!task) {
        return res.status(404).json({ error: `Zadanie o ID "${id}" nie zostało znalezione.` });
      }

      const targetProject = (appState.projects || []).find((p: any) => p.id === task.projectId);
      if (!can(caller, 'tasks.edit', { type: 'task', task, project: targetProject || null }, permConfig)) {
        return res.status(403).json({ error: 'Brak uprawnień do edycji zadania w tym projekcie.' });
      }

      const hasGlobalTasksEdit = can(caller, 'tasks.edit', undefined, permConfig);
      if (patch.projectId !== undefined && patch.projectId !== task.projectId) {
        if (!hasGlobalTasksEdit) {
          return res.status(403).json({ error: 'Zmiana projektu zadania wymaga globalnego uprawnienia edycji zadań.' });
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
        allowedUpdates = pickAllowedTaskFields(patch, caller, { permissionConfig: permConfig });
      } catch (err: any) {
        return res.status(400).json({ error: err.message });
      }

      if (
        Object.prototype.hasOwnProperty.call(allowedUpdates, 'progress') &&
        allowedUpdates.progress !== undefined &&
        hasDirectSubtasks(appState.tasks || [], task.id)
      ) {
        return res.status(400).json({
          error: 'Postęp zadania nadrzędnego wynika z podzadań',
        });
      }

      if (allowedUpdates.title !== undefined) {
        const sanitizedTitle = String(allowedUpdates.title).trim();
        if (!sanitizedTitle) {
          return res.status(400).json({ error: 'Wymagany tytuł zadania.' });
        }
        allowedUpdates.title = sanitizedTitle;
      }

      const hasParentPatch = Object.prototype.hasOwnProperty.call(allowedUpdates, 'parentId');
      const nextProjectId = allowedUpdates.projectId ?? task.projectId;
      if (hasParentPatch) {
        const rawParent = allowedUpdates.parentId;
        if (rawParent === '' || rawParent === null || rawParent === undefined) {
          allowedUpdates.parentId = undefined;
        } else {
          const parentCheck = canReparent(appState.tasks || [], task.id, rawParent, nextProjectId);
          if (!parentCheck.ok) {
            return res.status(400).json({ error: parentCheck.error });
          }
          allowedUpdates.parentId = String(rawParent).trim();
        }
      } else if (
        allowedUpdates.projectId !== undefined &&
        allowedUpdates.projectId !== task.projectId &&
        task.parentId
      ) {
        const parentCheck = canReparent(appState.tasks || [], task.id, task.parentId, nextProjectId);
        if (!parentCheck.ok) {
          return res.status(400).json({ error: parentCheck.error });
        }
      }

      const oldProjectId = task.projectId;
      const oldParentId = typeof task.parentId === 'string' && task.parentId.trim() ? task.parentId.trim() : null;
      const previousStatus = task.status;
      for (const [key, value] of Object.entries(allowedUpdates)) {
        if (key === 'parentId' && value === undefined) {
          delete task.parentId;
        } else {
          task[key] = value;
        }
      }

      const nowIso = new Date().toISOString();
      const isParentAfterPatch = hasDirectSubtasks(appState.tasks || [], task.id);
      const leafSync = reconcileLeafTaskConsistency(task, {
        previousStatus,
        hasSubtasks: isParentAfterPatch,
      });

      task.revision = (task.revision || 1) + 1;
      task.updatedAt = nowIso;

      if (leafSync.statusChangedToDone) {
        if (!Array.isArray(appState.activityLogs)) {
          appState.activityLogs = [];
        }
        const actorName = caller?.name || caller?.email || caller?.id || 'Użytkownik';
        appState.activityLogs.unshift({
          id: `act-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
          projectId: task.projectId || undefined,
          taskId: task.id,
          userId: caller.id,
          action: `${actorName} zmienił status [${task.code || task.id}] na "done"`,
          timestamp: nowIso,
        });
        if (appState.activityLogs.length > 500) {
          appState.activityLogs = appState.activityLogs.slice(0, 500);
        }
      }

      const progressWeighting = settingsService.getEffectiveProgressWeighting();
      const newParentId = typeof task.parentId === 'string' && task.parentId.trim() ? task.parentId.trim() : null;
      const affectedTaskIds = new Set<string>();

      if (hasParentPatch && (oldParentId !== newParentId || oldProjectId !== task.projectId)) {
        if (oldProjectId && oldProjectId !== task.projectId && oldParentId) {
          const oldProjRec = reconcileParentCompletionOnReparent(appState.tasks || [], {
            movedTaskId: task.id,
            oldParentId,
            newParentId: null,
            projectId: oldProjectId,
            progressOptions: { weighting: progressWeighting },
            nowIso,
          });
          const statusSet = new Set(oldProjRec.changedStatusParentIds);
          for (const updatedItem of oldProjRec.tasks) {
            const target = (appState.tasks || []).find((t: any) => t.id === updatedItem.id);
            if (!target || target.id === task.id) continue;
            if (statusSet.has(target.id)) {
              target.status = updatedItem.status;
              target.updatedAt = nowIso;
              target.revision = (target.revision || 1) + 1;
              affectedTaskIds.add(target.id);
            }
          }
        }

        const rec = reconcileParentCompletionOnReparent(appState.tasks || [], {
          movedTaskId: task.id,
          oldParentId: oldProjectId === task.projectId ? oldParentId : null,
          newParentId,
          projectId: task.projectId,
          progressOptions: { weighting: progressWeighting },
          nowIso,
        });
        const statusSet = new Set(rec.changedStatusParentIds);
        const progressSet = new Set(rec.changedProgressTaskIds);
        for (const updatedItem of rec.tasks) {
          const target = (appState.tasks || []).find((t: any) => t.id === updatedItem.id);
          if (!target || target.id === task.id) continue;
          if (statusSet.has(target.id)) {
            target.status = updatedItem.status;
            target.updatedAt = nowIso;
            target.revision = (target.revision || 1) + 1;
            affectedTaskIds.add(target.id);
          }
          if (progressSet.has(target.id)) {
            target.progress = updatedItem.progress;
            affectedTaskIds.add(target.id);
          }
        }
      }

      if (oldProjectId) {
        recomputeProjectProgress(appState, oldProjectId, { weighting: progressWeighting });
      }
      if (task.projectId && task.projectId !== oldProjectId) {
        recomputeProjectProgress(appState, task.projectId, { weighting: progressWeighting });
      }

      const affectedTasks =
        affectedTaskIds.size > 0
          ? (appState.tasks || []).filter((t: any) => affectedTaskIds.has(t.id))
          : [];

      const newRev = stateStore.bumpStateRevision();
      await stateStore.saveStateAtomicAsync();

      res.json({
        success: true,
        task,
        revision: newRev,
        ...(affectedTasks.length > 0 ? { affectedTasks } : {}),
      });
    } catch (err: any) {
      if (isDiskFullError(err)) {
        return res.status(507).json({ error: DISK_FULL_ERROR_MESSAGE });
      }
      logger.error('[Server API] Błąd aktualizacji zadania:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/tasks/:id
  app.delete('/api/tasks/:id', requireAuth, async (req, res) => {
    try {
      const appState = stateStore.ensureStateStructure();
      const permConfig = appState.permissionConfig;
      const { id } = req.params;
      const caller = (req as any).user;
      if (!canWrite(caller, permConfig)) {
        return res.status(403).json({ error: 'Brak uprawnień do usuwania zadań.' });
      }

      const task = (appState.tasks || []).find((t: any) => t.id === id);
      if (!task) {
        return res.status(404).json({ error: `Zadanie o ID "${id}" nie istnieje.` });
      }

      const targetProject = (appState.projects || []).find((p: any) => p.id === task.projectId);
      const denials = new Set(sanitizePermissionArray(caller?.permissionDenials));
      if (caller.role !== 'admin' && denials.has('tasks.edit')) {
        return res.status(403).json({ error: 'Brak uprawnień do usuwania zadań.' });
      }

      const hasGlobalOrCompanyDelete =
        can(caller, 'tasks.edit', undefined, permConfig) ||
        (canUserUseCompanyPermission(caller, 'tasks.edit', permConfig) &&
          hasMatchingCompanyMembership(caller, targetProject || null));

      if (!hasGlobalOrCompanyDelete) {
        const isOwn =
          caller.role !== 'viewer' &&
          ((task.assigneeId && task.assigneeId === caller.id) ||
            (task.reporterId && task.reporterId === caller.id));
        if (!isOwn) {
          return res.status(403).json({
            error: `Brak uprawnień do usunięcia cudzego zadania: "${task.title || task.code || task.id}".`,
          });
        }
      }

      const deletedProjectId = task.projectId;
      const retentionDays = settingsService.getEffectiveTrashRetentionDays();
      const { trashEntry } = moveTaskToTrash(appState, task, caller, retentionDays, Date.now());
      if (deletedProjectId) {
        recomputeProjectProgress(appState, deletedProjectId, {
          weighting: settingsService.getEffectiveProgressWeighting(),
        });
      }
      const newRev = stateStore.bumpStateRevision();
      await stateStore.saveStateAtomicAsync();

      res.json({ success: true, revision: newRev, trashId: trashEntry.id });
    } catch (err: any) {
      if (isDiskFullError(err)) {
        return res.status(507).json({ error: DISK_FULL_ERROR_MESSAGE });
      }
      logger.error('[Server API] Błąd usuwania zadania:', err);
      res.status(500).json({ error: err.message });
    }
  });
}
