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
import { validateProjectFinanceFields } from '../../utils/financeValidation.js';
import {
  getNextProjectCode,
  isProjectCodeAvailable,
  isValidProjectCodeFormat,
} from '../../utils/projectCode.js';
import { getClientIp } from '../security.js';
import { DISK_FULL_ERROR_MESSAGE, isDiskFullError, StateStore } from '../state.js';
import { SessionStore } from '../sessions.js';
import { SettingsService } from '../settings.js';
import { moveProjectToTrash } from '../trash.js';
import { logger } from '../logger.js';

const FINANCE_AUDIT_SCALAR_FIELDS = [
  'budget',
  'projectValue',
  'projectValueGross',
  'projectVatRate',
  'isBaseContractPaid',
] as const;

const FINANCE_AUDIT_ARRAY_FIELDS = ['quotations', 'costs', 'paymentTranches'] as const;

interface FinanceAuditItemDiff {
  list: 'quotations' | 'costs' | 'paymentTranches';
  action: 'added' | 'removed' | 'updated';
  id: string;
  title: string;
  before: { net: number | null; gross: number | null } | null;
  after: { net: number | null; gross: number | null } | null;
}

function deepEqualJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) {
    return a === b;
  }
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, idx) => deepEqualJson(item, b[idx]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const objA = a as Record<string, unknown>;
    const objB = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(objA), ...Object.keys(objB)]);
    for (const key of keys) {
      if (!deepEqualJson(objA[key], objB[key])) return false;
    }
    return true;
  }
  return false;
}

function extractItemAmounts(
  listName: 'quotations' | 'costs' | 'paymentTranches',
  item: any
): { net: number | null; gross: number | null } {
  if (!item || typeof item !== 'object') {
    return { net: null, gross: null };
  }
  if (listName === 'quotations') {
    return {
      net: typeof item.totalNet === 'number' ? item.totalNet : null,
      gross: typeof item.totalGross === 'number' ? item.totalGross : null,
    };
  }
  return {
    net: typeof item.amountNet === 'number' ? item.amountNet : null,
    gross: typeof item.amountGross === 'number' ? item.amountGross : null,
  };
}

function buildFinanceAuditDetails(
  beforeProject: Record<string, any>,
  afterProject: Record<string, any>
): Record<string, any> | null {
  const changedFields: string[] = [];
  const scalars: Record<string, { before: unknown; after: unknown }> = {};
  const items: FinanceAuditItemDiff[] = [];

  for (const field of FINANCE_AUDIT_SCALAR_FIELDS) {
    const beforeVal = beforeProject[field];
    const afterVal = afterProject[field];
    if (!deepEqualJson(beforeVal, afterVal)) {
      changedFields.push(field);
      scalars[field] = {
        before: beforeVal ?? null,
        after: afterVal ?? null,
      };
    }
  }

  for (const listName of FINANCE_AUDIT_ARRAY_FIELDS) {
    const beforeArr: any[] = Array.isArray(beforeProject[listName]) ? beforeProject[listName] : [];
    const afterArr: any[] = Array.isArray(afterProject[listName]) ? afterProject[listName] : [];
    if (deepEqualJson(beforeArr, afterArr)) {
      continue;
    }
    changedFields.push(listName);

    const beforeById = new Map<string, any>();
    for (const item of beforeArr) {
      if (item && typeof item.id === 'string') {
        beforeById.set(item.id, item);
      }
    }
    const afterById = new Map<string, any>();
    for (const item of afterArr) {
      if (item && typeof item.id === 'string') {
        afterById.set(item.id, item);
      }
    }

    for (const afterItem of afterArr) {
      if (!afterItem || typeof afterItem.id !== 'string') continue;
      const prevItem = beforeById.get(afterItem.id);
      if (!prevItem) {
        items.push({
          list: listName,
          action: 'added',
          id: afterItem.id,
          title: typeof afterItem.title === 'string' ? afterItem.title : '',
          before: null,
          after: extractItemAmounts(listName, afterItem),
        });
      } else if (!deepEqualJson(prevItem, afterItem)) {
        items.push({
          list: listName,
          action: 'updated',
          id: afterItem.id,
          title: typeof afterItem.title === 'string' ? afterItem.title : '',
          before: extractItemAmounts(listName, prevItem),
          after: extractItemAmounts(listName, afterItem),
        });
      }
    }

    for (const beforeItem of beforeArr) {
      if (!beforeItem || typeof beforeItem.id !== 'string') continue;
      if (!afterById.has(beforeItem.id)) {
        items.push({
          list: listName,
          action: 'removed',
          id: beforeItem.id,
          title: typeof beforeItem.title === 'string' ? beforeItem.title : '',
          before: extractItemAmounts(listName, beforeItem),
          after: null,
        });
      }
    }
  }

  if (changedFields.length === 0) {
    return null;
  }

  return {
    projectId: afterProject.id,
    projectKey: afterProject.key,
    changedFields,
    ...(Object.keys(scalars).length > 0 ? { scalars } : {}),
    ...(items.length > 0 ? { items } : {}),
  };
}

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

      const financeValidation = validateProjectFinanceFields(allowed, undefined, {
        company: selectedCompany,
      });
      if (!financeValidation.ok) {
        return res.status(400).json({
          error: financeValidation.error,
          itemType: financeValidation.itemType,
          itemId: financeValidation.itemId,
          field: financeValidation.field,
        });
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
      if (allowed.ownerId && !members.includes(allowed.ownerId)) {
        members.push(allowed.ownerId);
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

      const newProject: Record<string, any> = {
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
      if (!newProject.ownerId) {
        delete newProject.ownerId;
      }

      appState.projects.push(newProject);
      const newRev = stateStore.bumpStateRevision();
      await stateStore.saveStateAtomicAsync();

      const hasInitialFinance =
        (typeof newProject.projectValue === 'number' && newProject.projectValue > 0) ||
        (typeof newProject.projectValueGross === 'number' && newProject.projectValueGross > 0) ||
        Boolean(newProject.budget) ||
        (Array.isArray(newProject.quotations) && newProject.quotations.length > 0) ||
        (Array.isArray(newProject.costs) && newProject.costs.length > 0) ||
        (Array.isArray(newProject.paymentTranches) && newProject.paymentTranches.length > 0);
      if (hasInitialFinance) {
        const auditDetails = buildFinanceAuditDetails({}, newProject);
        if (auditDetails) {
          await stateStore.securityLogger
            .record('finance_changed', {
              userId: caller.id,
              ip: getClientIp(req),
              userAgent: (req.headers['user-agent'] || '').slice(0, 100),
              details: auditDetails,
            })
            .catch(() => {});
        }
      }

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
      const isProjectOwner =
        Boolean(project.ownerId) && project.ownerId === caller.id && caller.role !== 'viewer';
      if (!isAdminOrManager && !isProjectOwner) {
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
      const canChangeCompany = caller.role === 'admin' || canEditFinance(caller, project);

      if (hasCompanyIdPatch && !canChangeCompany) {
        return res.status(403).json({
          error: 'Zmiana firmy projektu jest dozwolona wyłącznie dla administratora lub właściciela projektu.',
        });
      }

      const hasOwnerIdPatch =
        Object.prototype.hasOwnProperty.call(patch, 'ownerId') && patch.ownerId !== undefined;
      const canChangeOwner =
        caller.role === 'admin' ||
        (project.ownerId
          ? project.ownerId === caller.id && caller.role !== 'viewer'
          : caller.role === 'project_manager');

      if (hasOwnerIdPatch && !canChangeOwner) {
        return res.status(403).json({
          error: 'Zmiana właściciela projektu jest dozwolona wyłącznie dla administratora lub obecnego właściciela projektu.',
        });
      }

      if (hasFinanceOrClientFields(patch) && !canEditFinance(caller, project)) {
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
        allowedUpdates = pickAllowedProjectFields(patch, caller, { project });
      } catch (err: any) {
        return res.status(400).json({ error: err.message });
      }

      const companies = Array.isArray(appState.companies) ? appState.companies : [];
      let targetCompany: any = project.companyId
        ? companies.find((c: any) => c && c.id === project.companyId)
        : undefined;

      if (hasCompanyIdPatch) {
        const rawCid = patch.companyId;
        if (rawCid === null || rawCid === '') {
          allowedUpdates.companyId = undefined;
          targetCompany = undefined;
        } else if (typeof rawCid === 'string') {
          const trimmedCid = rawCid.trim();
          const foundCompany = companies.find((c: any) => c && c.id === trimmedCid);
          if (!foundCompany) {
            return res.status(400).json({ error: 'Wybrana firma nie istnieje.' });
          }
          allowedUpdates.companyId = trimmedCid;
          targetCompany = foundCompany;
        } else {
          return res.status(400).json({ error: 'Nieprawidłowy identyfikator firmy.' });
        }
      }

      const financeValidation = validateProjectFinanceFields(allowedUpdates, project, {
        company: targetCompany,
      });
      if (!financeValidation.ok) {
        return res.status(400).json({
          error: financeValidation.error,
          itemType: financeValidation.itemType,
          itemId: financeValidation.itemId,
          field: financeValidation.field,
        });
      }

      if (hasOwnerIdPatch) {
        const rawOwner = patch.ownerId;
        if (rawOwner === null || rawOwner === '') {
          allowedUpdates.ownerId = undefined;
        } else if (typeof rawOwner === 'string') {
          const trimmedOwner = rawOwner.trim();
          allowedUpdates.ownerId = trimmedOwner || undefined;
        } else {
          return res.status(400).json({ error: 'Nieprawidłowy identyfikator właściciela projektu.' });
        }
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

      const beforeFinanceSnapshot = {
        id: project.id,
        key: project.key,
        budget: project.budget,
        projectValue: project.projectValue,
        projectValueGross: project.projectValueGross,
        projectVatRate: project.projectVatRate,
        isBaseContractPaid: project.isBaseContractPaid,
        quotations: Array.isArray(project.quotations)
          ? structuredClone(project.quotations)
          : project.quotations,
        costs: Array.isArray(project.costs)
          ? structuredClone(project.costs)
          : project.costs,
        paymentTranches: Array.isArray(project.paymentTranches)
          ? structuredClone(project.paymentTranches)
          : project.paymentTranches,
      };

      for (const [key, value] of Object.entries(allowedUpdates)) {
        if ((key === 'companyId' || key === 'ownerId') && value === undefined) {
          delete project[key];
        } else {
          project[key] = value;
        }
      }

      if (typeof project.ownerId === 'string' && project.ownerId) {
        if (!Array.isArray(project.memberIds)) {
          project.memberIds = [project.ownerId];
        } else if (!project.memberIds.includes(project.ownerId)) {
          project.memberIds.push(project.ownerId);
        }
      }

      project.revision = (project.revision || 1) + 1;
      const newRev = stateStore.bumpStateRevision();
      await stateStore.saveStateAtomicAsync();

      const financeAuditDetails = buildFinanceAuditDetails(beforeFinanceSnapshot, project);
      if (financeAuditDetails) {
        await stateStore.securityLogger
          .record('finance_changed', {
            userId: caller.id,
            ip: getClientIp(req),
            userAgent: (req.headers['user-agent'] || '').slice(0, 100),
            details: financeAuditDetails,
          })
          .catch(() => {});
      }

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
