import type { PermissionConfig, Project, Task, Comment, ActivityLog, User } from '../types/index.js';
import {
  ALL_PERMISSIONS,
  can,
  canUserUseCompanyPermission,
  createDefaultPermissionConfig,
  getEffectiveGlobalPermissions,
  PermissionCheckContext,
  PermissionResource,
  sanitizePermissionArray,
} from './permissions.js';

/**
 * Lista pól projektu o charakterze finansowym oraz danych klienta / zamawiającego,
 * które są usuwane z odpowiedzi dla użytkowników bez uprawnienia `finance.view`.
 */
export const FINANCIAL_AND_CLIENT_FIELDS: readonly string[] = [
  'budget',
  'costs',
  'quotations',
  'paymentTranches',
  'projectValue',
  'projectValueGross',
  'projectVatRate',
  'isBaseContractPaid',
  'clientName',
  'clientContactPerson',
  'clientPhone',
  'clientEmail',
  'clientNip',
  'clientAddress',
] as const;

const WRITE_PERMISSIONS = [
  'projects.create',
  'projects.edit',
  'projects.delete',
  'projects.archive',
  'tasks.edit',
  'finance.edit',
  'tenders.edit',
  'contractors.edit',
  'clients.edit',
  'templates.manage',
  'trash.manage',
] as const;

/**
 * Sprawdza, czy użytkownik może edytować finanse i dane zamawiającego w projekcie.
 */
export function canEditFinance(
  user: {
    id: string;
    role?: string;
    groupIds?: string[];
    companyIds?: string[];
    permissionGrants?: any[];
    permissionDenials?: any[];
    effectivePermissions?: any[];
  } | null | undefined,
  project: { id?: string; ownerId?: string; memberIds?: string[]; companyId?: string } | null | undefined,
  context?: PermissionCheckContext
): boolean {
  return can(user, 'finance.edit', project || null, context);
}

/**
 * Sprawdza, czy użytkownik może przeglądać finanse projektu (menu Ekonomia i podgląd kosztorysu).
 */
export function canViewFinance(
  user: {
    id: string;
    role?: string;
    groupIds?: string[];
    companyIds?: string[];
    permissionGrants?: any[];
    permissionDenials?: any[];
    effectivePermissions?: any[];
  } | null | undefined,
  project: { id?: string; ownerId?: string; memberIds?: string[]; companyId?: string } | null | undefined,
  context?: PermissionCheckContext
): boolean {
  if (!user || !user.role || !project) return false;
  return can(user, 'finance.view', project, context);
}

/**
 * Sprawdza, czy obiekt aktualizacji zawiera jakiekolwiek pola finansowe lub dane klienta.
 */
export function hasFinanceOrClientFields(patch: Record<string, any> | null | undefined): boolean {
  if (!patch || typeof patch !== 'object') return false;
  const financeSet = new Set(FINANCIAL_AND_CLIENT_FIELDS);
  for (const key of Object.keys(patch)) {
    if (financeSet.has(key) || key.toLowerCase().startsWith('client')) {
      return true;
    }
  }
  return false;
}

/**
 * Sprawdza, czy obiekt wejściowy zawiera zakazane właściwości prototypowe
 * (__proto__, constructor, prototype).
 */
export function hasForbiddenKeys(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false;
  const forbidden = new Set(['__proto__', 'constructor', 'prototype']);

  // Wykryj manipulację prototypem (np. literał { __proto__: ... })
  const proto = Object.getPrototypeOf(obj);
  if (proto !== Object.prototype && proto !== null && !Array.isArray(obj)) {
    return true;
  }

  // Wykryj klucze własne (np. z JSON.parse lub jawnie zdefiniowane)
  for (const key of Object.getOwnPropertyNames(obj)) {
    if (forbidden.has(key)) return true;
  }
  for (const key of Object.keys(obj as Record<string, any>)) {
    if (forbidden.has(key)) return true;
  }
  return false;
}

/**
 * Sprawdza, czy użytkownik ma uprawnienia do zapisu.
 */
export function canWrite(
  user: {
    id?: string;
    role?: string;
    groupIds?: string[];
    companyIds?: string[];
    permissionGrants?: any[];
    permissionDenials?: any[];
    effectivePermissions?: any[];
  } | null | undefined,
  context?: PermissionCheckContext
): boolean {
  if (!user || !user.role) return false;
  if (user.role === 'admin') return true;
  const globalPerms = new Set(getEffectiveGlobalPermissions(user, context));
  for (const perm of WRITE_PERMISSIONS) {
    if (globalPerms.has(perm)) return true;
    if (canUserUseCompanyPermission(user, perm, context)) return true;
  }
  if (user.role !== 'viewer') {
    const denials = new Set(sanitizePermissionArray(user.permissionDenials));
    const hasUnblockedOwnWork =
      !denials.has('tasks.edit') || !denials.has('projects.edit') || !denials.has('finance.edit');
    if (hasUnblockedOwnWork && (!context || globalPerms.size > 0 || user.role === 'developer' || user.role === 'tester' || user.role === 'project_manager')) {
      return true;
    }
  }
  return false;
}

/**
 * Sprawdza, czy użytkownik ma dostęp do podglądu danego projektu.
 */
export function canAccessProject(
  user: {
    id: string;
    role?: string;
    groupIds?: string[];
    companyIds?: string[];
    permissionGrants?: any[];
    permissionDenials?: any[];
    effectivePermissions?: any[];
  } | null | undefined,
  project: { id: string; memberIds?: string[]; ownerId?: string; companyId?: string } | null | undefined,
  context?: PermissionCheckContext
): boolean {
  if (!user || !project) return false;
  if (!user.role) {
    return Array.isArray(project.memberIds) && project.memberIds.includes(user.id);
  }
  return can(user, 'projects.view', project, context);
}

/**
 * Filtruje pojedynczy projekt pod kątem uprawnień użytkownika.
 * Dla użytkowników bez canViewFinance usuwa pola finansowe i dane klienta (client*).
 */
export function filterProjectForUser<T extends Record<string, any>>(
  project: T,
  user: {
    id: string;
    role?: string;
    groupIds?: string[];
    companyIds?: string[];
    permissionGrants?: any[];
    permissionDenials?: any[];
    effectivePermissions?: any[];
  } | null | undefined,
  context?: PermissionCheckContext
): T {
  if (!project) return project;
  if (canViewFinance(user, project as any, context)) {
    return { ...project };
  }

  const sanitized: Record<string, any> = { ...project };
  for (const key of Object.keys(sanitized)) {
    if (
      key.toLowerCase().startsWith('client') ||
      key === 'budget' ||
      key === 'costs' ||
      key === 'quotations' ||
      key === 'paymentTranches' ||
      key === 'projectValue' ||
      key === 'projectValueGross' ||
      key === 'projectVatRate' ||
      key === 'isBaseContractPaid'
    ) {
      delete sanitized[key];
    }
  }
  return sanitized as T;
}

/**
 * Filtruje pojedynczą firmę pod kątem uprawnień użytkownika:
 * - użytkownicy z globalnym `finance.view` widzą wszystkie pola (w tym nip, address, vatPayer, vatExemptionBasis).
 * - właściciele projektów przypisanych do firmy (poza viewer) oraz przypisani członkowie firmy z `finance.view`
 *   widzą także vatPayer i vatExemptionBasis.
 * - pozostali zalogowani widzą tylko pola jawne (id, name, letter, color, isActive).
 */
export function filterCompanyForUser<T extends Record<string, any>>(
  company: T,
  user: { id: string; role?: string } | null | undefined,
  ownedCompanyIds?: Set<string>,
  memberFinanceCompanyIds?: Set<string>,
  hasGlobalFinanceView?: boolean
): T {
  if (!company || typeof company !== 'object') return company;
  const fullAccess =
    hasGlobalFinanceView !== undefined
      ? hasGlobalFinanceView
      : Boolean(user && (user.role === 'admin' || user.role === 'project_manager'));
  if (fullAccess) {
    return { ...company };
  }
  const { nip: _nip, address: _address, vatPayer, vatExemptionBasis, ...publicFields } = company;
  const hasCompanyFinance =
    memberFinanceCompanyIds?.has(company.id) ||
    Boolean(user && user.role !== 'viewer' && ownedCompanyIds?.has(company.id));
  if (hasCompanyFinance) {
    return {
      ...publicFields,
      vatPayer,
      ...(vatExemptionBasis !== undefined ? { vatExemptionBasis } : {}),
    } as unknown as T;
  }
  return publicFields as T;
}

export function filterCompaniesForUser<T extends Record<string, any>>(
  companies: T[] | null | undefined,
  user: {
    id: string;
    role?: string;
    groupIds?: string[];
    companyIds?: string[];
    permissionGrants?: any[];
    permissionDenials?: any[];
    effectivePermissions?: any[];
  } | null | undefined,
  projects?: Array<{ companyId?: string; ownerId?: string }> | null,
  context?: PermissionCheckContext
): T[] {
  if (!user || !Array.isArray(companies)) return [];
  const hasGlobalFinanceView = can(user, 'finance.view', undefined, context);
  const ownedCompanyIds = new Set<string>();
  const denials = new Set(sanitizePermissionArray(user.permissionDenials));

  if (Array.isArray(projects) && user.role !== 'viewer' && !denials.has('finance.view')) {
    for (const p of projects) {
      if (p && p.companyId && p.ownerId === user.id) {
        ownedCompanyIds.add(p.companyId);
      }
    }
  }

  const memberFinanceCompanyIds = new Set<string>();
  for (const c of companies) {
    if (c && typeof c.id === 'string' && can(user, 'finance.view', { companyId: c.id }, context)) {
      memberFinanceCompanyIds.add(c.id);
    }
  }

  return companies.map((c) =>
    filterCompanyForUser(c, user, ownedCompanyIds, memberFinanceCompanyIds, hasGlobalFinanceView)
  );
}

export function filterStateForUser(
  state: any,
  user: {
    id: string;
    role?: string;
    groupIds?: string[];
    companyIds?: string[];
    permissionGrants?: any[];
    permissionDenials?: any[];
    effectivePermissions?: any[];
  } | null | undefined
): any {
  if (!state) return state;
  const {
    serverSettings: _serverSettings,
    permissionConfig: rawPermissionConfig,
    trash: _trash,
    tenders: _tenders,
    projectTemplates: _projectTemplates,
    reminderState: _reminderState,
    weeklySummaryState: _weeklySummaryState,
    trustedDevices: _trustedDevices,
    ...safeState
  } = state;

  if (!user) {
    const {
      variables: _variables,
      companies: _companies,
      projectNumbering: _projectNumbering,
      ...unauthSafeState
    } = safeState;
    return {
      ...unauthSafeState,
      projects: [],
      companies: [],
      tasks: [],
      comments: [],
      activityLogs: [],
    };
  }

  const permContext: PermissionCheckContext | undefined = rawPermissionConfig
    ? { permissionConfig: rawPermissionConfig }
    : undefined;

  const hasGlobalProjectsView = can(user, 'projects.view', undefined, permContext);
  const hasGlobalFinanceView = can(user, 'finance.view', undefined, permContext);
  const canSeeClientsCatalog =
    hasGlobalFinanceView || can(user, 'clients.edit', undefined, permContext);

  // Usuń listę klientów z variables, jeśli użytkownik nie ma uprawnień do bazy klientów / finansów globalnie
  let filteredVariables = safeState.variables;
  if (safeState.variables && typeof safeState.variables === 'object' && !canSeeClientsCatalog) {
    const { clients: _ignoredClients, ...restVariables } = safeState.variables;
    filteredVariables = restVariables;
  }

  const allProjects = Array.isArray(safeState.projects) ? safeState.projects : [];
  const allTasks = Array.isArray(safeState.tasks) ? safeState.tasks : [];
  const allComments = Array.isArray(safeState.comments) ? safeState.comments : [];
  const allLogs = Array.isArray(safeState.activityLogs) ? safeState.activityLogs : [];

  if (hasGlobalProjectsView && hasGlobalFinanceView) {
    return {
      ...safeState,
      ...(filteredVariables !== undefined ? { variables: filteredVariables } : {}),
      companies: filterCompaniesForUser(safeState.companies, user, allProjects, permContext),
      projects: allProjects.map((p: any) => filterProjectForUser(p, user, permContext)),
    };
  }

  // 1. Dostępne projekty
  const accessibleProjects = allProjects
    .filter((p: any) => canAccessProject(user, p, permContext))
    .map((p: any) => filterProjectForUser(p, user, permContext));

  const allowedProjectIds = new Set(accessibleProjects.map((p: any) => p.id));

  // 2. Dostępne zadania: z dostępnych projektów LUB przypisane / zgłoszone przez użytkownika
  const filteredTasks = allTasks.filter((t: any) => {
    if (!t) return false;
    return (
      (t.projectId && allowedProjectIds.has(t.projectId)) ||
      (t.assigneeId && t.assigneeId === user.id) ||
      (t.reporterId && t.reporterId === user.id)
    );
  });

  const allowedTaskIds = new Set(filteredTasks.map((t: any) => t.id));

  // 3. Komentarze: tylko do dostępnych zadań
  const filteredComments = allComments.filter((c: any) => {
    if (!c) return false;
    return c.taskId && allowedTaskIds.has(c.taskId);
  });

  // 4. Logi aktywności: powiązane z dostępnymi projektami lub zadaniami, albo wykonane przez usera
  const filteredLogs = allLogs.filter((log: any) => {
    if (!log) return false;
    if (log.projectId && allowedProjectIds.has(log.projectId)) return true;
    if (log.taskId && allowedTaskIds.has(log.taskId)) return true;
    if (!log.projectId && !log.taskId && log.userId === user.id) return true;
    return false;
  });

  return {
    ...safeState,
    ...(filteredVariables !== undefined ? { variables: filteredVariables } : {}),
    companies: filterCompaniesForUser(safeState.companies, user, allProjects, permContext),
    projects: accessibleProjects,
    tasks: filteredTasks,
    comments: filteredComments,
    activityLogs: filteredLogs,
  };
}

/**
 * Whitelist edytowalnych pól zadania (Task).
 * Pola `id`, `revision`, `createdAt`, `reporterId` nigdy nie są edytowalne.
 * Zmiana `projectId` zadania dozwolona wyłącznie dla użytkowników z globalnym `tasks.edit`.
 * Odrzuca klucze prototype (__proto__, constructor, prototype).
 */
export const FIELD_LIMITS = {
  title: 200,
  key: 12,
  name: 200,
  shortName: 60,
  description: 20000,
  status: 50,
  priority: 50,
  type: 50,
  client: 200,
  tagsMaxCount: 30,
  tagLength: 50,
  comment: 5000,
} as const;

export interface FieldSanitizeOptions {
  /** Jeśli true, rzuca błąd zamiast przycinać wartości ponad limit (dla zwracania 400). Domyślnie false (przycina). */
  rejectOnOverflow?: boolean;
  permissionConfig?: PermissionConfig | null;
}

/**
 * Sanityzuje lub odrzuca wartości pól przekraczające dopuszczalne limity długości.
 */
export function sanitizeFieldValue(
  field: string,
  value: any,
  options?: FieldSanitizeOptions
): any {
  if (value === null || value === undefined) return value;
  const reject = Boolean(options?.rejectOnOverflow);

  // Tablice tagów: maks. 30 elementów po 50 znaków
  if (field === 'tags') {
    if (!Array.isArray(value)) return [];
    if (reject && value.length > FIELD_LIMITS.tagsMaxCount) {
      throw new Error(`Tablica tagów może zawierać maksymalnie ${FIELD_LIMITS.tagsMaxCount} elementów.`);
    }
    const sliced = value.slice(0, FIELD_LIMITS.tagsMaxCount);
    return sliced.map((t) => {
      const str = typeof t === 'string' ? t : String(t ?? '');
      if (reject && str.length > FIELD_LIMITS.tagLength) {
        throw new Error(`Pojedynczy tag może mieć maksymalnie ${FIELD_LIMITS.tagLength} znaków.`);
      }
      return str.slice(0, FIELD_LIMITS.tagLength);
    });
  }

  // Wartości tekstowe
  if (typeof value === 'string') {
    let limit: number | undefined;
    if (field === 'title') limit = FIELD_LIMITS.title;
    else if (field === 'key') limit = FIELD_LIMITS.key;
    else if (field === 'name') limit = FIELD_LIMITS.name;
    else if (field === 'shortName') limit = FIELD_LIMITS.shortName;
    else if (field === 'description') limit = FIELD_LIMITS.description;
    else if (field === 'status' || field === 'priority' || field === 'type' || field === 'typeId' || field === 'subtypeId') limit = FIELD_LIMITS.status;
    else if (field.toLowerCase().startsWith('client')) limit = FIELD_LIMITS.client;

    if (limit !== undefined) {
      if (reject && value.length > limit) {
        throw new Error(`Pole "${field}" przekracza maksymalny limit ${limit} znaków.`);
      }
      return value.slice(0, limit);
    }
  }

  return value;
}

/**
 * Whitelist edytowalnych pól zadania (Task).
 */
export function pickAllowedTaskFields(
  body: any,
  user: {
    id: string;
    role?: string;
    groupIds?: string[];
    companyIds?: string[];
    permissionGrants?: any[];
    permissionDenials?: any[];
    effectivePermissions?: any[];
  } | null | undefined,
  options?: FieldSanitizeOptions
): Record<string, any> {
  if (!body || typeof body !== 'object') return {};
  if (hasForbiddenKeys(body)) {
    throw new Error('Niedozwolony klucz w żądaniu (__proto__, constructor, prototype).');
  }

  const canMoveProject = can(user, 'tasks.edit', undefined, options?.permissionConfig);

  // Whitelist bazowych pól zadania edytowalnych przez uprawnionych członków
  const standardFields = new Set([
    'title',
    'description',
    'code',
    'type',
    'priority',
    'status',
    'assigneeId',
    'startDate',
    'dueDate',
    'durationDays',
    'isOfficialDeadline',
    'estimatedHours',
    'spentHours',
    'progress',
    'blockingTaskIds',
    'dependencies',
    'parentId',
    'completedAt',
    'tags',
    'costIds',
  ]);

  const result: Record<string, any> = {};

  for (const key of Object.keys(body)) {
    if (
      key === 'id' ||
      key === 'revision' ||
      key === 'createdAt' ||
      key === 'reporterId' ||
      key === 'updatedAt' ||
      key === 'expectedRevision'
    ) {
      continue;
    }

    if (key === 'projectId') {
      if (canMoveProject) {
        result.projectId = body.projectId;
      }
      continue;
    }

    if (standardFields.has(key)) {
      result[key] = sanitizeFieldValue(key, body[key], options);
    }
  }

  return result;
}

export interface ProjectFieldPickOptions extends FieldSanitizeOptions {
  project?: { id?: string; ownerId?: string; memberIds?: string[]; companyId?: string } | null;
}

/**
 * Whitelist edytowalnych pól projektu (Project).
 */
export function pickAllowedProjectFields(
  body: any,
  user: {
    id: string;
    role?: string;
    groupIds?: string[];
    companyIds?: string[];
    permissionGrants?: any[];
    permissionDenials?: any[];
    effectivePermissions?: any[];
  } | null | undefined,
  options?: ProjectFieldPickOptions
): Record<string, any> {
  if (!body || typeof body !== 'object') return {};
  if (hasForbiddenKeys(body)) {
    throw new Error('Niedozwolony klucz w żądaniu (__proto__, constructor, prototype).');
  }

  const permConfig = options?.permissionConfig;
  const isAdmin = Boolean(user && user.role === 'admin');
  const canManageGlobalProject = can(user, 'projects.edit', undefined, permConfig);
  const canArchive = can(user, 'projects.archive', options?.project || null, permConfig);
  const canManageFinance = canEditFinance(user, options?.project, permConfig);

  const denials = new Set(sanitizePermissionArray(user?.permissionDenials));
  const isEditDenied = !isAdmin && denials.has('projects.edit');
  const canChangeOwner = Boolean(
    user &&
      !isEditDenied &&
      (isAdmin ||
        (options?.project?.ownerId
          ? user.role !== 'viewer' && options.project.ownerId === user.id
          : canManageGlobalProject))
  );

  // Bazowe pola edytowalne dla każdego uprawnionego do edycji projektu
  const baseFields = new Set([
    'name',
    'shortName',
    'typeId',
    'subtypeId',
    'deliverables',
    'description',
    'priority',
    'status',
    'startDate',
    'dueDate',
    'durationDays',
    'progress',
    'spentHours',
    'color',
    'diskPath',
  ]);

  // Pola globalnej edycji projektu
  const globalProjectFields = new Set([
    'key',
    'memberIds',
    'isDemo',
  ]);

  // Pola archiwizacji projektu
  const archiveFields = new Set([
    'isArchived',
    'archivedAt',
    'archivedBy',
  ]);

  // Pola finansowe, firma oraz dane klienta
  const financeAndClientFields = new Set([
    'companyId',
    'budget',
    'projectValue',
    'projectValueGross',
    'projectVatRate',
    'isBaseContractPaid',
    'quotations',
    'costs',
    'paymentTranches',
    'clientName',
    'clientContactPerson',
    'clientPhone',
    'clientEmail',
    'clientNip',
    'clientAddress',
  ]);

  const result: Record<string, any> = {};

  for (const key of Object.keys(body)) {
    if (
      key === 'id' ||
      key === 'revision' ||
      key === 'createdAt' ||
      key === 'updatedAt' ||
      key === 'expectedRevision'
    ) {
      continue;
    }

    if (baseFields.has(key)) {
      result[key] = sanitizeFieldValue(key, body[key], options);
      continue;
    }

    if (canManageGlobalProject && globalProjectFields.has(key)) {
      result[key] = sanitizeFieldValue(key, body[key], options);
      continue;
    }

    if (canArchive && archiveFields.has(key)) {
      result[key] = sanitizeFieldValue(key, body[key], options);
      continue;
    }

    if (key === 'ownerId') {
      if (canChangeOwner) {
        result[key] = sanitizeFieldValue(key, body[key], options);
      }
      continue;
    }

    if (
      canManageFinance &&
      (financeAndClientFields.has(key) || key.toLowerCase().startsWith('client'))
    ) {
      result[key] = sanitizeFieldValue(key, body[key], options);
      continue;
    }
  }

  return result;
}

/**
 * Sprawdza, czy nagłówek Origin odpowiada oczekiwanemu nagłówkowi Host (ochrona CSRF).
 * - Brak nagłówka Origin (undefined, null, pusty ciąg) jest dozwolony (zwraca true).
 * - Jeśli podano Origin, wyciągany jest z niego host (domena/IP + ewentualny port)
 *   i porównywany bez uwzględniania wielkości liter z oczekiwanym hostem.
 * - Niepoprawny format URL w Origin lub brak pasującego hosta zwraca false.
 */
export function isSameOrigin(
  origin?: string | null,
  host?: string | null
): boolean {
  if (!origin || !origin.trim()) {
    return true;
  }
  if (!host || !host.trim()) {
    return false;
  }

  let originUrl: URL;
  try {
    originUrl = new URL(origin.trim());
  } catch {
    return false;
  }

  const originHost = originUrl.host.toLowerCase();
  if (!originHost) {
    return false;
  }

  let rawHost = host.trim().toLowerCase();
  if (rawHost.includes(',')) {
    rawHost = rawHost.split(',')[0].trim();
  }

  let expectedHost = rawHost;
  try {
    const protocol = originUrl.protocol || 'http:';
    const parsedExpected = rawHost.includes('://')
      ? new URL(rawHost)
      : new URL(`${protocol}//${rawHost}`);
    expectedHost = parsedExpected.host.toLowerCase();
  } catch {
    expectedHost = rawHost;
  }

  return originHost === expectedHost || originHost === rawHost;
}

export interface BuildNewTaskOptions {
  body?: any;
  allowed?: Record<string, any>;
  caller?: { id: string; role?: string } | null;
  projectId?: string;
  reporterId?: string;
  projectKey?: string;
  existingCount?: number;
  now?: string;
  id?: string;
  code?: string;
}

/**
 * Generuje standardowy kod zadania dla projektu w formacie `<KLUCZ_PROJEKTU>-<NN>`.
 */
export function generateTaskCode(projectKey: string, existingCount: number): string {
  const safeKey = String(projectKey || 'ZAD').trim() || 'ZAD';
  const safeCount =
    typeof existingCount === 'number' && Number.isFinite(existingCount) && existingCount >= 0
      ? Math.floor(existingCount)
      : 0;
  return `${safeKey}-${String(safeCount + 1).padStart(2, '0')}`;
}

/**
 * Czysta funkcja budująca rekord nowego zadania (Task).
 * Oczyszcza tytuł za pomocą whitelisty i limitów FIELD_LIMITS (title max 200).
 * Jeśli po trim tytuł jest pusty, rzuca błąd "Wymagany tytuł zadania.".
 */
export function buildNewTaskRecord(
  arg1: any,
  arg2?: any,
  arg3?: any,
  arg4?: any
): Record<string, any> {
  let body: any;
  let allowed: Record<string, any> | undefined;
  let caller: { id: string; role?: string } | null = null;
  let projectId = '';
  let reporterId = '';
  let projectKey = 'ZAD';
  let existingCount = 0;
  let customId: string | undefined;
  let customNow: string | undefined;
  let customCode: string | undefined;

  if (
    arg2 === undefined &&
    arg1 &&
    typeof arg1 === 'object' &&
    ('projectId' in arg1 || 'allowed' in arg1 || 'caller' in arg1 || 'reporterId' in arg1 || 'existingCount' in arg1)
  ) {
    const opts = arg1 as BuildNewTaskOptions;
    body = opts.body;
    allowed = opts.allowed;
    caller = opts.caller ?? null;
    projectId = opts.projectId || (opts.body?.projectId ?? '');
    reporterId = opts.reporterId || caller?.id || (opts.body?.reporterId ?? '');
    projectKey = opts.projectKey || 'ZAD';
    existingCount = typeof opts.existingCount === 'number' ? opts.existingCount : 0;
    customId = opts.id;
    customNow = opts.now;
    customCode = opts.code;
  } else {
    body = arg1;
    if (arg2 && typeof arg2 === 'object' && 'id' in arg2) {
      caller = arg2;
      reporterId = arg2.id;
    } else if (typeof arg2 === 'string') {
      reporterId = arg2;
    }

    if (arg3 && typeof arg3 === 'object') {
      projectId = arg3.id || '';
      projectKey = arg3.key || 'ZAD';
    } else if (typeof arg3 === 'string') {
      projectId = arg3;
    }

    if (typeof arg4 === 'number') {
      existingCount = arg4;
    }
  }

  if (!allowed) {
    allowed = pickAllowedTaskFields(body || {}, caller);
  }

  const sanitizedTitle = String(allowed.title ?? '').trim();
  if (!sanitizedTitle) {
    throw new Error('Wymagany tytuł zadania.');
  }

  const now = customNow || new Date().toISOString();
  const generatedId =
    customId ||
    (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `tsk-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);

  const code =
    customCode ||
    allowed.code ||
    generateTaskCode(projectKey, existingCount);

  return {
    ...allowed,
    id: generatedId,
    projectId: projectId || (targetIdFromAllowed(allowed)),
    code,
    title: sanitizedTitle,
    reporterId: reporterId || caller?.id || '',
    type: allowed.type || 'task',
    priority: allowed.priority || 'normal',
    status: allowed.status || 'to_do',
    progress: typeof allowed.progress === 'number' ? allowed.progress : 0,
    startDate: allowed.startDate || now.slice(0, 10),
    dueDate: allowed.dueDate || now.slice(0, 10),
    durationDays: typeof allowed.durationDays === 'number' ? allowed.durationDays : 1,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function targetIdFromAllowed(allowed: Record<string, any>): string {
  return typeof allowed.projectId === 'string' ? allowed.projectId : '';
}
