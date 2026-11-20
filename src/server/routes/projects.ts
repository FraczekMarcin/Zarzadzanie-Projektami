import express from 'express';
import crypto from 'crypto';
import {
  FIELD_LIMITS,
  filterProjectForUser,
  canWrite,
  canEditFinance,
  hasFinanceOrClientFields,
  hasForbiddenKeys,
  pickAllowedProjectFields,
} from '../../utils/access.js';
import { validateProjectFinanceFields } from '../../utils/finance.js';
import {
  getNextProjectCode,
  isProjectCodeAvailable,
  isValidProjectCodeFormat,
} from '../../utils/projectCode.js';
import { DISK_FULL_ERROR_MESSAGE, isDiskFullError, StateStore } from '../state.js';
import { SessionStore } from '../sessions.js';
import { SettingsService } from '../settings.js';
import { moveProjectToTrash } from '../trash.js';
import { logger } from '../logger.js';

export function registerProjectRoutes(
  app: express.Express,
  deps: { stateStore: StateStore; sessionStore: SessionStore; settingsService: SettingsService }
): void {
  const { stateStore, sessionStore, settingsService } = deps;
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

      const financeValidation = validateProjectFinanceFields(allowed);
      if (!financeValidation.ok) {
        return res.status(400).json({
          error: financeValidation.error,
          itemType: financeValidation.itemType,
          itemId: financeValidation.itemId,
          field: financeValidation.field,
        });
      }

      const companies = Array.isArray(appState.companies) ? appState.companies : [];
      const activeCompanies = companies.filter((c: any) => c && c.isActive);
      const rawCompanyId =
        typeof body.companyId === 'string' ? body.companyId.trim() : '';

      let selectedCompany: any = undefined;
      if (rawCompanyId) {
        selectedCompany = companies.find((c: any) => c && c.id === rawCompanyId);
        if (!selectedCompany || !selectedCompany.isActive) {
          return res.status(400).json({ error: 'Wybrana firma nie istnieje lub jest nieaktywna.' });
        }
      } else if (activeCompanies.length > 0) {
        return res.status(400).json({ error: 'Wybór aktywnej firmy jest wymagany.' });
      }

      const isAdminOrManager = caller.role === 'admin' || caller.role === 'project_manager';
      if (isAdminOrManager && typeof allowed.ownerId === 'string') {
        const trimmedOwner = allowed.ownerId.trim();
        allowed.ownerId = trimmedOwner || undefined;
      } else {
        delete allowed.ownerId;
      }

      let members: string[];
      if (isAdminOrManager && Array.isArray(allowed.memberIds)) {
        members = Array.from(new Set(allowed.memberIds));
      } else {
        members = [caller.id];
      }
      if (!members.includes(caller.id)) {
        members.push(caller.id);
      }

      let key: string;
      const customKeyRaw =
        isAdminOrManager && typeof allowed.key === 'string' ? allowed.key.trim() : '';

      if (customKeyRaw) {
        const normalizedKey = customKeyRaw.toUpperCase().slice(0, FIELD_LIMITS.key);
        if (!isValidProjectCodeFormat(normalizedKey)) {
          return res.status(400).json({ error: 'Nieprawidłowy format numeru projektu.' });
        }
        if (!isProjectCodeAvailable(normalizedKey, appState.projects || [])) {
          return res.status(409).json({ error: `Numer projektu "${normalizedKey}" jest już zajęty.` });
        }
        key = normalizedKey;
      } else if (selectedCompany) {
        const scope =
          appState.projectNumbering?.scope === 'company' ? 'company' : 'year';
        try {
          key = getNextProjectCode(
            appState.projects || [],
            appState.trash || [],
            companies,
            selectedCompany.id,
            new Date().getFullYear(),
            scope
          );
        } catch (err: any) {
          return res.status(400).json({ error: err?.message || 'Nie udało się wygenerować numeru projektu.' });
        }
      } else {
        try {
          key = getNextProjectCode(
            appState.projects || [],
            appState.trash || [],
            companies,
            undefined,
            new Date().getFullYear(),
            'year'
          );
        } catch (err: any) {
          return res.status(400).json({ error: err?.message || 'Nie udało się wygenerować numeru projektu.' });
        }
      }

      const now = new Date().toISOString();

      const newProject = {
        ...allowed,
        id: crypto.randomUUID(),
        key,
        ...(selectedCompany ? { companyId: selectedCompany.id } : {}),
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
      if (!selectedCompany) {
        delete newProject.companyId;
      }

      appState.projects.push(newProject);
      const newRev = stateStore.bumpStateRevision();
      await stateStore.saveStateAtomicAsync();

      res.status(201).json({
        success: true,
        project: filterProjectForUser(newProject, caller),
        revision: newRev,
      });
    } catch (err: any) {
      if (isDiskFullError(err)) {
        return res.status(507).json({ error: DISK_FULL_ERROR_MESSAGE });
      }
      logger.error('[Server API] Błąd tworzenia projektu:', err);
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

      const hasCompanyIdPatch = Object.prototype.hasOwnProperty.call(patch, 'companyId');
      const canChangeCompany =
        caller.role === 'admin' ||
        canEditFinance(caller, project) ||
        (Boolean(project.ownerId) && project.ownerId === caller.id);

      if (hasCompanyIdPatch && !canChangeCompany) {
        return res.status(403).json({
          error: 'Zmiana firmy projektu jest dozwolona wyłącznie dla administratora lub właściciela projektu.',
        });
      }

      if ((hasFinanceOrClientFields(patch) || patch.ownerId !== undefined) && !canEditFinance(caller, project)) {
        return res.status(403).json({
          error: 'Edycja finansów: administrator i właściciel projektu',
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

      const financeValidation = validateProjectFinanceFields(allowedUpdates);
      if (!financeValidation.ok) {
        return res.status(400).json({
          error: financeValidation.error,
          itemType: financeValidation.itemType,
          itemId: financeValidation.itemId,
          field: financeValidation.field,
        });
      }

      if (hasCompanyIdPatch) {
        const rawCid = patch.companyId;
        if (rawCid === null || rawCid === '') {
          allowedUpdates.companyId = undefined;
        } else if (typeof rawCid === 'string') {
          const trimmedCid = rawCid.trim();
          const companies = Array.isArray(appState.companies) ? appState.companies : [];
          const foundCompany = companies.find((c: any) => c && c.id === trimmedCid);
          if (!foundCompany) {
            return res.status(400).json({ error: 'Wybrana firma nie istnieje.' });
          }
          allowedUpdates.companyId = trimmedCid;
        } else {
          return res.status(400).json({ error: 'Nieprawidłowy identyfikator firmy.' });
        }
      }

      if (allowedUpdates.ownerId !== undefined) {
        allowedUpdates.ownerId = typeof allowedUpdates.ownerId === 'string' && allowedUpdates.ownerId.trim()
          ? allowedUpdates.ownerId.trim()
          : undefined;
      }

      if (allowedUpdates.name !== undefined) {
        const sanitizedName = String(allowedUpdates.name).trim();
        if (!sanitizedName) {
          return res.status(400).json({ error: 'Wymagana nazwa projektu.' });
        }
        allowedUpdates.name = sanitizedName;
      }

      if (allowedUpdates.key !== undefined) {
        const nextKey = String(allowedUpdates.key).toUpperCase().trim().slice(0, FIELD_LIMITS.key);
        if (!isValidProjectCodeFormat(nextKey)) {
          return res.status(400).json({ error: 'Nieprawidłowy format numeru projektu.' });
        }
        if (!isProjectCodeAvailable(nextKey, appState.projects || [], project.id)) {
          return res.status(409).json({ error: `Numer projektu "${nextKey}" jest już zajęty.` });
        }
        allowedUpdates.key = nextKey;
      }

      for (const [key, value] of Object.entries(allowedUpdates)) {
        if (key === 'companyId' && value === undefined) {
          delete project.companyId;
        } else {
          project[key] = value;
        }
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
      if (isDiskFullError(err)) {
        return res.status(507).json({ error: DISK_FULL_ERROR_MESSAGE });
      }
      logger.error('[Server API] Błąd aktualizacji projektu:', err);
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

      const project = appState.projects[projectIndex];
      const retentionDays = settingsService.getEffectiveTrashRetentionDays();
      const { trashEntry } = moveProjectToTrash(appState, project, caller, retentionDays, Date.now());

      const newRev = stateStore.bumpStateRevision();
      await stateStore.saveStateAtomicAsync();

      res.json({ success: true, revision: newRev, trashId: trashEntry.id });
    } catch (err: any) {
      if (isDiskFullError(err)) {
        return res.status(507).json({ error: DISK_FULL_ERROR_MESSAGE });
      }
      logger.error('[Server API] Błąd usuwania projektu:', err);
      res.status(500).json({ error: err.message });
    }
  });
}
