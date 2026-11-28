import express from 'express';
import crypto from 'crypto';
import {
  FIELD_LIMITS,
  FINANCIAL_AND_CLIENT_FIELDS,
  filterProjectForUser,
  canWrite,
  canEditFinance,
  hasFinanceOrClientFields,
  hasForbiddenKeys,
  pickAllowedProjectFields,
} from '../../utils/access.js';
import {
  can,
  canUserUseCompanyPermission,
  sanitizePermissionArray,
} from '../../utils/permissions.js';
import { validateProjectFinanceFields } from '../../utils/financeValidation.js';
import {
  getNextProjectCode,
  isProjectCodeAvailable,
  isValidProjectCodeFormat,
} from '../../utils/projectCode.js';
import { recomputeProjectProgress } from '../../utils/progress.js';
import {
  SHORT_NAME_MAX,
  copyTemplateDeliverablesToProject,
  getDefaultProjectPriorityId,
  getDefaultProjectStatusId,
  getDeliverablesSummary,
  normalizeProjectPriorities,
  normalizeProjectStatuses,
  normalizeProjectTypes,
  validateProjectDeliverables,
} from '../../utils/projectMeta.js';
import type { ProjectTemplate, Task } from '../../types/index.js';
import {
  addDaysUtc,
  instantiateTemplateForProject,
  isValidIsoDateString,
  resolveTemplateById,
} from '../../utils/templateInstantiation.js';
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
      const permConfig = appState.permissionConfig;
      const caller = (req as any).user;
      const hasPotentialCreate =
        can(caller, 'projects.create', undefined, permConfig) ||
        canUserUseCompanyPermission(caller, 'projects.create', permConfig);
      if (!hasPotentialCreate) {
        return res.status(403).json({ error: 'Brak uprawnień do tworzenia projektów.' });
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
        allowed = pickAllowedProjectFields(body, caller, { permissionConfig: permConfig });
      } catch (err: any) {
        return res.status(400).json({ error: err.message });
      }

      const sanitizedName = String(allowed.name ?? '').trim();
      if (!sanitizedName) {
        return res.status(400).json({ error: 'Wymagana nazwa projektu.' });
      }

      let resolvedShortName: string | undefined;
      if (body.shortName !== undefined && body.shortName !== null) {
        if (typeof body.shortName !== 'string') {
          return res.status(400).json({ error: 'Nazwa skrócona projektu musi być tekstem.', field: 'shortName' });
        }
        const trimmedShort = body.shortName.trim();
        if (trimmedShort.length > SHORT_NAME_MAX) {
          return res.status(400).json({
            error: `Nazwa skrócona projektu nie może przekraczać ${SHORT_NAME_MAX} znaków.`,
            field: 'shortName',
          });
        }
        if (trimmedShort) {
          resolvedShortName = trimmedShort;
        }
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

      if (!can(caller, 'projects.create', selectedCompany ? { companyId: selectedCompany.id } : undefined, permConfig)) {
        return res.status(403).json({ error: 'Brak uprawnień do tworzenia projektów dla tej firmy.' });
      }

      const configuredStatuses = normalizeProjectStatuses(appState.variables?.projectStatuses);
      const configuredPriorities = normalizeProjectPriorities(appState.variables?.projectPriorities);
      const configuredTypes = normalizeProjectTypes(appState.variables?.projectTypes);

      let resolvedStatus = getDefaultProjectStatusId(configuredStatuses);
      if (body.status !== undefined && body.status !== null && body.status !== '') {
        const rawStatus = typeof body.status === 'string' ? body.status.trim() : '';
        if (!rawStatus || !configuredStatuses.some((s) => s.id === rawStatus)) {
          return res.status(400).json({
            error: 'Wybrany stan projektu nie istnieje w konfiguracji.',
            field: 'status',
          });
        }
        resolvedStatus = rawStatus;
      }

      let resolvedPriority = getDefaultProjectPriorityId(configuredPriorities);
      if (body.priority !== undefined && body.priority !== null && body.priority !== '') {
        const rawPriority = typeof body.priority === 'string' ? body.priority.trim() : '';
        if (!rawPriority || !configuredPriorities.some((p) => p.id === rawPriority)) {
          return res.status(400).json({
            error: 'Wybrany priorytet projektu nie istnieje w konfiguracji.',
            field: 'priority',
          });
        }
        resolvedPriority = rawPriority;
      }

      let resolvedTypeId: string | undefined;
      if (body.typeId !== undefined && body.typeId !== null && body.typeId !== '') {
        if (typeof body.typeId !== 'string' || !body.typeId.trim()) {
          return res.status(400).json({
            error: 'Nieprawidłowy identyfikator rodzaju projektu.',
            field: 'typeId',
          });
        }
        const rawTypeId = body.typeId.trim();
        if (!configuredTypes.some((t) => t.id === rawTypeId)) {
          return res.status(400).json({
            error: 'Wybrany rodzaj projektu nie istnieje w konfiguracji.',
            field: 'typeId',
          });
        }
        resolvedTypeId = rawTypeId;
      }

      let resolvedSubtypeId: string | undefined;
      if (body.subtypeId !== undefined && body.subtypeId !== null && body.subtypeId !== '') {
        if (typeof body.subtypeId !== 'string' || !body.subtypeId.trim()) {
          return res.status(400).json({
            error: 'Nieprawidłowy identyfikator podrodzaju projektu.',
            field: 'subtypeId',
          });
        }
        const rawSubtypeId = body.subtypeId.trim();
        if (!resolvedTypeId) {
          return res.status(400).json({
            error: 'Podrodzaj projektu wymaga wybrania rodzaju projektu.',
            field: 'subtypeId',
          });
        }
        const parentType = configuredTypes.find((t) => t.id === resolvedTypeId);
        if (!parentType || !(parentType.subtypes || []).some((s) => s.id === rawSubtypeId)) {
          return res.status(400).json({
            error: 'Wybrany podrodzaj nie należy do wskazanego rodzaju projektu.',
            field: 'subtypeId',
          });
        }
        resolvedSubtypeId = rawSubtypeId;
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

      const canManageGlobalProject = can(caller, 'projects.edit', undefined, permConfig);
      if (canManageGlobalProject && typeof allowed.ownerId === 'string') {
        const trimmedOwner = allowed.ownerId.trim();
        allowed.ownerId = trimmedOwner || undefined;
      } else {
        delete allowed.ownerId;
      }

      let members: string[];
      if (canManageGlobalProject && Array.isArray(allowed.memberIds)) {
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
        canManageGlobalProject && typeof allowed.key === 'string' ? allowed.key.trim() : '';

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

      const hasTemplateParam =
        body.templateId !== undefined && body.templateId !== null && body.templateId !== '';
      let resolvedTemplate: ProjectTemplate | undefined;
      if (hasTemplateParam) {
        if (typeof body.templateId !== 'string' || !body.templateId.trim()) {
          return res.status(400).json({ error: 'Nieprawidłowy identyfikator szablonu (templateId).' });
        }
        resolvedTemplate = resolveTemplateById(appState, body.templateId.trim());
        if (!resolvedTemplate) {
          return res.status(404).json({
            error: `Szablon o ID "${body.templateId.trim()}" nie został znaleziony.`,
          });
        }
      }

      if (body.startDate !== undefined && body.startDate !== null && body.startDate !== '') {
        if (!isValidIsoDateString(body.startDate)) {
          return res.status(400).json({
            error: 'Nieprawidłowy format daty rozpoczęcia (startDate w formacie RRRR-MM-DD).',
          });
        }
      }

      const now = new Date().toISOString();
      const effectiveStartDate =
        typeof allowed.startDate === 'string' && isValidIsoDateString(allowed.startDate)
          ? allowed.startDate.trim()
          : now.slice(0, 10);

      const effectiveDurationDays =
        typeof allowed.durationDays === 'number' && allowed.durationDays >= 1
          ? allowed.durationDays
          : resolvedTemplate
          ? Math.max(1, resolvedTemplate.defaultDurationDays || 60)
          : 30;

      const effectiveDueDate =
        typeof allowed.dueDate === 'string' && isValidIsoDateString(allowed.dueDate)
          ? allowed.dueDate.trim()
          : resolvedTemplate
          ? addDaysUtc(effectiveStartDate, effectiveDurationDays - 1)
          : now.slice(0, 10);

      if (
        !resolvedTypeId &&
        body.typeId === undefined &&
        resolvedTemplate?.typeId &&
        configuredTypes.some((t) => t.id === resolvedTemplate!.typeId)
      ) {
        resolvedTypeId = resolvedTemplate.typeId;
      }

      const actorName = caller?.name || caller?.email || caller?.id || 'Użytkownik';
      let resolvedDeliverables = undefined;
      if (body.deliverables !== undefined) {
        const delValidation = validateProjectDeliverables(body.deliverables, {
          actorName,
          nowIso: now,
        });
        if (!delValidation.ok) {
          return res.status(400).json({
            error: delValidation.error,
            field: delValidation.field,
          });
        }
        if (delValidation.deliverables.length > 0) {
          resolvedDeliverables = delValidation.deliverables;
        }
      } else if (resolvedTemplate?.deliverables && resolvedTemplate.deliverables.length > 0) {
        resolvedDeliverables = copyTemplateDeliverablesToProject(resolvedTemplate.deliverables);
      }

      const newProject: Record<string, any> = {
        ...allowed,
        id: crypto.randomUUID(),
        key,
        ...(selectedCompany ? { companyId: selectedCompany.id } : {}),
        name: sanitizedName,
        memberIds: members,
        description: allowed.description || '',
        priority: resolvedPriority,
        status: resolvedStatus,
        startDate: effectiveStartDate,
        dueDate: effectiveDueDate,
        durationDays: effectiveDurationDays,
        progress: 0,
        color: allowed.color || '#3b82f6',
        revision: 1,
      };
      if (resolvedShortName) {
        newProject.shortName = resolvedShortName;
      } else {
        delete newProject.shortName;
      }
      if (resolvedTypeId) {
        newProject.typeId = resolvedTypeId;
      } else {
        delete newProject.typeId;
      }
      if (resolvedSubtypeId) {
        newProject.subtypeId = resolvedSubtypeId;
      } else {
        delete newProject.subtypeId;
      }
      if (resolvedDeliverables && resolvedDeliverables.length > 0) {
        newProject.deliverables = resolvedDeliverables;
      } else {
        delete newProject.deliverables;
      }
      if (!selectedCompany) {
        delete newProject.companyId;
      }
      if (!newProject.ownerId) {
        delete newProject.ownerId;
      }
      if (newProject.projectValue === null || newProject.projectValue === undefined) {
        delete newProject.projectValue;
        delete newProject.projectValueGross;
      }
      if (newProject.projectValueGross === null || newProject.projectValueGross === undefined) {
        delete newProject.projectValueGross;
      }
      if (newProject.budget === null || newProject.budget === undefined || newProject.budget === '') {
        delete newProject.budget;
      }

      let instantiatedTasks: Task[] = [];
      if (resolvedTemplate) {
        const instRes = instantiateTemplateForProject({
          template: resolvedTemplate,
          project: {
            id: newProject.id,
            key: newProject.key,
            startDate: newProject.startDate,
            ownerId: newProject.ownerId,
          },
          caller,
          templateTaskKeys: body.templateTaskKeys,
          existingProjectTasksCount: 0,
          nowIso: now,
        });
        if (!instRes.ok) {
          return res.status(instRes.status).json({ error: instRes.error });
        }
        instantiatedTasks = instRes.tasks;
      }

      const prevProjectsLen = appState.projects.length;
      const prevTasks = Array.isArray(appState.tasks) ? [...appState.tasks] : [];
      const prevLogs = Array.isArray(appState.activityLogs) ? [...appState.activityLogs] : [];
      const prevRev = appState.revision || 0;

      let newRev: number;
      try {
        appState.projects.push(newProject);
        if (instantiatedTasks.length > 0) {
          if (!Array.isArray(appState.tasks)) {
            appState.tasks = [];
          }
          appState.tasks = [...instantiatedTasks, ...appState.tasks];
        }

        recomputeProjectProgress(appState, newProject.id, {
          weighting: settingsService.getEffectiveProgressWeighting(),
        });

        if (resolvedTemplate) {
          if (!Array.isArray(appState.activityLogs)) {
            appState.activityLogs = [];
          }
          const actorName = caller?.name || caller?.email || caller?.id || 'Użytkownik';
          const deadlineCount = instantiatedTasks.filter((t) => t.isOfficialDeadline).length;
          appState.activityLogs.unshift({
            id: `act-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
            projectId: newProject.id,
            userId: caller.id,
            action: `${actorName} utworzył projekt [${newProject.key}] z szablonu "${resolvedTemplate.name}" (${instantiatedTasks.length} zadań)`,
            timestamp: now,
            details: `Wygenerowano ${instantiatedTasks.length} zadań (terminy urzędowe: ${deadlineCount}).`,
          });
          if (appState.activityLogs.length > 500) {
            appState.activityLogs = appState.activityLogs.slice(0, 500);
          }
        }

        newRev = stateStore.bumpStateRevision();
        await stateStore.saveStateAtomicAsync();
      } catch (saveErr) {
        appState.projects.length = prevProjectsLen;
        appState.tasks = prevTasks;
        appState.activityLogs = prevLogs;
        appState.revision = prevRev;
        throw saveErr;
      }

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
        project: filterProjectForUser(newProject, caller, permConfig),
        ...(resolvedTemplate ? { tasks: instantiatedTasks } : {}),
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
      const permConfig = appState.permissionConfig;
      const caller = (req as any).user;
      if (!canWrite(caller, permConfig)) {
        return res.status(403).json({ error: 'Brak uprawnień do modyfikacji projektów.' });
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

      const patchKeys = Object.keys(patch).filter((k) => k !== 'expectedRevision');
      const hasArchiveFields =
        patch.isArchived !== undefined ||
        patch.archivedAt !== undefined ||
        patch.archivedBy !== undefined;
      const isArchiveOnlyPatch =
        hasArchiveFields &&
        patchKeys.length > 0 &&
        patchKeys.every((k) => k === 'isArchived' || k === 'archivedAt' || k === 'archivedBy');
      const isFinanceOnlyPatch =
        hasFinanceOrClientFields(patch) &&
        patchKeys.length > 0 &&
        patchKeys.every(
          (k) => FINANCIAL_AND_CLIENT_FIELDS.includes(k) || k.toLowerCase().startsWith('client')
        );

      const canEditThisProject = can(caller, 'projects.edit', project, permConfig);
      const canArchiveThisProject = can(caller, 'projects.archive', project, permConfig);
      const canEditThisFinance = canEditFinance(caller, project, permConfig);

      if (!isArchiveOnlyPatch && !isFinanceOnlyPatch && !canEditThisProject) {
        return res.status(403).json({ error: 'Brak uprawnień do edycji tego projektu.' });
      }

      if (hasArchiveFields && !canArchiveThisProject) {
        return res.status(403).json({ error: 'Brak uprawnień do archiwizacji tego projektu.' });
      }

      const canManageGlobalProject = can(caller, 'projects.edit', undefined, permConfig);
      if (!canManageGlobalProject && (patch.memberIds !== undefined || patch.key !== undefined)) {
        return res.status(403).json({
          error: 'Zmiana memberIds oraz key projektu jest dozwolona wyłącznie dla użytkowników z globalnym prawem edycji projektów.',
        });
      }

      const hasCompanyIdPatch = Object.prototype.hasOwnProperty.call(patch, 'companyId');
      const canChangeCompany = caller.role === 'admin' || canEditThisFinance;

      if (hasCompanyIdPatch && !canChangeCompany) {
        return res.status(403).json({
          error: 'Zmiana firmy projektu jest dozwolona wyłącznie dla administratora lub użytkownika z prawem edycji finansów.',
        });
      }

      const hasOwnerIdPatch =
        Object.prototype.hasOwnProperty.call(patch, 'ownerId') && patch.ownerId !== undefined;
      const denials = new Set(sanitizePermissionArray(caller?.permissionDenials));
      const isEditDenied = caller.role !== 'admin' && denials.has('projects.edit');
      const canChangeOwner =
        caller.role === 'admin' ||
        (!isEditDenied &&
          (project.ownerId
            ? project.ownerId === caller.id && caller.role !== 'viewer'
            : canManageGlobalProject));

      if (hasOwnerIdPatch && !canChangeOwner) {
        return res.status(403).json({
          error: 'Zmiana właściciela projektu jest dozwolona wyłącznie dla administratora lub obecnego właściciela projektu.',
        });
      }

      if (hasFinanceOrClientFields(patch) && !canEditThisFinance) {
        return res.status(403).json({
          error: 'Brak uprawnień do edycji finansów i danych klienta tego projektu.',
        });
      }

      const rawIfMatch = req.headers['if-match'] || (patch.expectedRevision !== undefined ? String(patch.expectedRevision) : null);
      if (rawIfMatch) {
        const cleanMatch = String(rawIfMatch).replace(/["W\/]/g, '').trim();
        const currentRev = String(project.revision !== undefined ? project.revision : 1);
        if (cleanMatch !== '*' && cleanMatch !== currentRev) {
          return res.status(409).json({
            error: 'Konflikt wersji projektu (został zmodyfikowany przez innego użytkownika).',
            currentProject: filterProjectForUser(project, caller, permConfig),
            revision: appState.revision,
          });
        }
      }

      let allowedUpdates: Record<string, any>;
      try {
        allowedUpdates = pickAllowedProjectFields(patch, caller, {
          project,
          permissionConfig: permConfig,
        });
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

      const configuredStatuses = normalizeProjectStatuses(appState.variables?.projectStatuses);
      const configuredPriorities = normalizeProjectPriorities(appState.variables?.projectPriorities);
      const configuredTypes = normalizeProjectTypes(appState.variables?.projectTypes);

      if (Object.prototype.hasOwnProperty.call(patch, 'status')) {
        const rawStatus = typeof patch.status === 'string' ? patch.status.trim() : '';
        if (!rawStatus || !configuredStatuses.some((s) => s.id === rawStatus)) {
          return res.status(400).json({
            error: 'Wybrany stan projektu nie istnieje w konfiguracji.',
            field: 'status',
          });
        }
        allowedUpdates.status = rawStatus;
      }

      if (Object.prototype.hasOwnProperty.call(patch, 'priority')) {
        const rawPriority = typeof patch.priority === 'string' ? patch.priority.trim() : '';
        if (!rawPriority || !configuredPriorities.some((p) => p.id === rawPriority)) {
          return res.status(400).json({
            error: 'Wybrany priorytet projektu nie istnieje w konfiguracji.',
            field: 'priority',
          });
        }
        allowedUpdates.priority = rawPriority;
      }

      const hasTypePatch = Object.prototype.hasOwnProperty.call(patch, 'typeId');
      const hasSubtypePatch = Object.prototype.hasOwnProperty.call(patch, 'subtypeId');
      let effectiveTypeId: string | undefined =
        typeof project.typeId === 'string' && project.typeId.trim() ? project.typeId.trim() : undefined;

      if (hasTypePatch) {
        const rawTypeId = patch.typeId;
        if (rawTypeId === null || rawTypeId === '' || rawTypeId === undefined) {
          allowedUpdates.typeId = undefined;
          effectiveTypeId = undefined;
        } else if (typeof rawTypeId === 'string' && rawTypeId.trim()) {
          const trimmedTypeId = rawTypeId.trim();
          if (!configuredTypes.some((t) => t.id === trimmedTypeId)) {
            return res.status(400).json({
              error: 'Wybrany rodzaj projektu nie istnieje w konfiguracji.',
              field: 'typeId',
            });
          }
          allowedUpdates.typeId = trimmedTypeId;
          effectiveTypeId = trimmedTypeId;
        } else {
          return res.status(400).json({
            error: 'Nieprawidłowy identyfikator rodzaju projektu.',
            field: 'typeId',
          });
        }
      }

      if (hasSubtypePatch) {
        const rawSubtypeId = patch.subtypeId;
        if (rawSubtypeId === null || rawSubtypeId === '' || rawSubtypeId === undefined) {
          allowedUpdates.subtypeId = undefined;
        } else if (typeof rawSubtypeId === 'string' && rawSubtypeId.trim()) {
          const trimmedSubId = rawSubtypeId.trim();
          if (!effectiveTypeId) {
            return res.status(400).json({
              error: 'Podrodzaj projektu wymaga wybrania rodzaju projektu.',
              field: 'subtypeId',
            });
          }
          const parentType = configuredTypes.find((t) => t.id === effectiveTypeId);
          if (!parentType || !(parentType.subtypes || []).some((s) => s.id === trimmedSubId)) {
            return res.status(400).json({
              error: 'Wybrany podrodzaj nie należy do wskazanego rodzaju projektu.',
              field: 'subtypeId',
            });
          }
          allowedUpdates.subtypeId = trimmedSubId;
        } else {
          return res.status(400).json({
            error: 'Nieprawidłowy identyfikator podrodzaju projektu.',
            field: 'subtypeId',
          });
        }
      } else if (hasTypePatch && project.subtypeId) {
        if (!effectiveTypeId) {
          allowedUpdates.subtypeId = undefined;
        } else {
          const parentType = configuredTypes.find((t) => t.id === effectiveTypeId);
          if (!parentType || !(parentType.subtypes || []).some((s) => s.id === project.subtypeId)) {
            allowedUpdates.subtypeId = undefined;
          }
        }
      }

      let deliverablesChangedSummary: { prevDone: number; prevTotal: number; nextDone: number; nextTotal: number } | null = null;
      if (Object.prototype.hasOwnProperty.call(patch, 'deliverables')) {
        const actorName = caller?.name || caller?.email || caller?.id || 'Użytkownik';
        const delValidation = validateProjectDeliverables(patch.deliverables, {
          existingDeliverables: Array.isArray(project.deliverables) ? project.deliverables : [],
          actorName,
          nowIso: new Date().toISOString(),
        });
        if (!delValidation.ok) {
          return res.status(400).json({
            error: delValidation.error,
            field: delValidation.field,
          });
        }
        const prevDeliverables = Array.isArray(project.deliverables) ? project.deliverables : [];
        if (!deepEqualJson(prevDeliverables, delValidation.deliverables)) {
          const prevSum = getDeliverablesSummary(prevDeliverables);
          const nextSum = getDeliverablesSummary(delValidation.deliverables);
          deliverablesChangedSummary = {
            prevDone: prevSum.done,
            prevTotal: prevSum.total,
            nextDone: nextSum.done,
            nextTotal: nextSum.total,
          };
        }
        allowedUpdates.deliverables =
          delValidation.deliverables.length > 0 ? delValidation.deliverables : undefined;
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

      if (Object.prototype.hasOwnProperty.call(patch, 'shortName')) {
        const rawShort = patch.shortName;
        if (rawShort === null || rawShort === '' || rawShort === undefined) {
          allowedUpdates.shortName = undefined;
        } else if (typeof rawShort === 'string') {
          const trimmedShort = rawShort.trim();
          if (trimmedShort.length > SHORT_NAME_MAX) {
            return res.status(400).json({
              error: `Nazwa skrócona projektu nie może przekraczać ${SHORT_NAME_MAX} znaków.`,
              field: 'shortName',
            });
          }
          allowedUpdates.shortName = trimmedShort || undefined;
        } else {
          return res.status(400).json({
            error: 'Nazwa skrócona projektu musi być tekstem.',
            field: 'shortName',
          });
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

      delete allowedUpdates.progress;

      for (const [key, value] of Object.entries(allowedUpdates)) {
        if (
          (key === 'companyId' ||
            key === 'ownerId' ||
            key === 'shortName' ||
            key === 'typeId' ||
            key === 'subtypeId' ||
            key === 'deliverables') &&
          value === undefined
        ) {
          delete project[key];
        } else if (
          (key === 'projectValue' || key === 'projectValueGross' || key === 'budget') &&
          (value === null || value === undefined || value === '')
        ) {
          delete project[key];
          if (key === 'projectValue') {
            delete project.projectValueGross;
          }
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

      if (deliverablesChangedSummary) {
        if (!Array.isArray(appState.activityLogs)) {
          appState.activityLogs = [];
        }
        const actorName = caller?.name || caller?.email || caller?.id || 'Użytkownik';
        appState.activityLogs.unshift({
          id: `act-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
          projectId: project.id,
          userId: caller.id,
          action: `${actorName} zaktualizował elementy do odbioru w projekcie [${project.key}] (Wykonano ${deliverablesChangedSummary.nextDone} z ${deliverablesChangedSummary.nextTotal})`,
          timestamp: new Date().toISOString(),
          details: `Poprzednio: ${deliverablesChangedSummary.prevDone} z ${deliverablesChangedSummary.prevTotal}.`,
        });
        if (appState.activityLogs.length > 500) {
          appState.activityLogs = appState.activityLogs.slice(0, 500);
        }
      }

      recomputeProjectProgress(appState, project.id, {
        weighting: settingsService.getEffectiveProgressWeighting(),
      });

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
        project: filterProjectForUser(project, caller, permConfig),
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
      const permConfig = appState.permissionConfig;
      const caller = (req as any).user;
      const hasPotentialDelete =
        can(caller, 'projects.delete', undefined, permConfig) ||
        canUserUseCompanyPermission(caller, 'projects.delete', permConfig);
      if (!hasPotentialDelete) {
        return res.status(403).json({
          error: 'Brak uprawnień do usuwania projektów.',
        });
      }
      const { id } = req.params;

      const projectIndex = (appState.projects || []).findIndex((p: any) => p.id === id);
      if (projectIndex === -1) {
        return res.status(404).json({ error: `Projekt o ID "${id}" nie istnieje.` });
      }

      const project = appState.projects[projectIndex];
      if (!can(caller, 'projects.delete', project, permConfig)) {
        return res.status(403).json({
          error: 'Brak uprawnień do usunięcia tego projektu.',
        });
      }
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
