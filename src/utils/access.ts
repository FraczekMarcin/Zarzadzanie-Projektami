import type { User, Project, Task, Comment, ActivityLog } from '../types';

/**
 * Lista pól projektu o charakterze finansowym oraz danych klienta / zamawiającego,
 * które są usuwane z odpowiedzi dla ról innych niż admin i project_manager.
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

/**
 * Sprawdza, czy użytkownik może edytować finanse i dane zamawiającego w projekcie.
 * - admin: zawsze true
 * - viewer: zawsze false
 * - właściciel projektu (project.ownerId === user.id): true niezależnie od roli (poza viewer)
 * - projekty bez przypisanego ownerId: true dla project_manager (kompatybilność wsteczna)
 * - kierownik niebędący właścicielem projektu z ustawionym ownerId: false
 */
export function canEditFinance(
  user: { id: string; role?: string } | null | undefined,
  project: { ownerId?: string } | null | undefined
): boolean {
  if (!user || !user.role) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'viewer') return false;
  if (project?.ownerId) {
    return project.ownerId === user.id;
  }
  return user.role === 'project_manager';
}

/**
 * Sprawdza, czy użytkownik może przeglądać finanse projektu (menu Ekonomia i podgląd kosztorysu).
 * - admin oraz project_manager: zawsze true
 * - viewer: zawsze false
 * - właściciel projektu (ownerId === user.id): true niezależnie od roli (poza viewer)
 * - pozostałe role bez własności projektu: false
 */
export function canViewFinance(
  user: { id: string; role?: string } | null | undefined,
  project: { ownerId?: string } | null | undefined
): boolean {
  if (!user || !user.role || !project) return false;
  if (user.role === 'viewer') return false;
  if (user.role === 'admin' || user.role === 'project_manager') return true;
  if (project.ownerId && project.ownerId === user.id) return true;
  return false;
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
 * Sprawdza, czy użytkownik ma uprawnienia do zapisu (rola 'viewer' jest wyłącznie do odczytu).
 */
export function canWrite(user: { role?: string } | null | undefined): boolean {
  if (!user || !user.role) return false;
  return user.role !== 'viewer';
}

/**
 * Sprawdza, czy użytkownik ma dostęp do danego projektu.
 * Role 'admin' i 'project_manager' mają dostęp do wszystkich projektów.
 * Pozostałe role mają dostęp tylko wtedy, gdy ich id znajduje się w project.memberIds.
 */
export function canAccessProject(
  user: { id: string; role?: string } | null | undefined,
  project: { id: string; memberIds?: string[]; ownerId?: string } | null | undefined
): boolean {
  if (!user || !project) return false;
  if (user.role === 'admin' || user.role === 'project_manager') {
    return true;
  }
  if (project.ownerId && project.ownerId === user.id) {
    return true;
  }
  return Array.isArray(project.memberIds) && project.memberIds.includes(user.id);
}

/**
 * Filtruje pojedynczy projekt pod kątem uprawnień użytkownika.
 * Dla użytkowników bez canViewFinance usuwa pola finansowe i dane klienta (client*).
 */
export function filterProjectForUser<T extends Record<string, any>>(
  project: T,
  user: { id: string; role?: string } | null | undefined
): T {
  if (!project) return project;
  if (canViewFinance(user, project)) {
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
 * Filtruje cały stan aplikacji pod kątem uprawnień użytkownika:
 * - Admin i Project Manager widzą wszystko.
 * - Pozostałe role widzą tylko projekty z memberIds (z usuniętymi polami finansowymi i danymi klienta),
 *   oraz zadania z tych projektów lub przypisane do nich / zgłoszone przez nich,
 *   a także powiązane komentarze i logi aktywności.
 */
/**
 * Filtruje pojedynczą firmę pod kątem uprawnień użytkownika:
 * - admin i project_manager widzą wszystkie pola (w tym nip, address, vatPayer, vatExemptionBasis).
 * - właściciele projektów przypisanych do firmy (poza viewer) widzą także vatPayer i vatExemptionBasis.
 * - pozostali zalogowani widzą tylko pola jawne (id, name, letter, isActive).
 */
export function filterCompanyForUser<T extends Record<string, any>>(
  company: T,
  user: { id: string; role?: string } | null | undefined,
  ownedCompanyIds?: Set<string>
): T {
  if (!company || typeof company !== 'object') return company;
  const isAdminOrManager = user && (user.role === 'admin' || user.role === 'project_manager');
  if (isAdminOrManager) {
    return { ...company };
  }
  const { nip: _nip, address: _address, vatPayer, vatExemptionBasis, ...publicFields } = company;
  if (user && user.role !== 'viewer' && ownedCompanyIds?.has(company.id)) {
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
  user: { id: string; role?: string } | null | undefined,
  projects?: Array<{ companyId?: string; ownerId?: string }> | null
): T[] {
  if (!user || !Array.isArray(companies)) return [];
  const ownedCompanyIds = new Set<string>();
  if (Array.isArray(projects) && user.role !== 'viewer') {
    for (const p of projects) {
      if (p && p.companyId && p.ownerId === user.id) {
        ownedCompanyIds.add(p.companyId);
      }
    }
  }
  return companies.map((c) => filterCompanyForUser(c, user, ownedCompanyIds));
}

export function filterStateForUser(
  state: any,
  user: { id: string; role?: string } | null | undefined
): any {
  if (!state) return state;
  const {
    serverSettings: _serverSettings,
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

  const isAdminOrManager = user.role === 'admin' || user.role === 'project_manager';
  if (isAdminOrManager) {
    return {
      ...safeState,
      companies: Array.isArray(safeState.companies) ? safeState.companies.map((c: any) => ({ ...c })) : [],
    };
  }

  // Dla ról innych niż admin i project_manager usuń listę klientów z variables
  let filteredVariables = safeState.variables;
  if (safeState.variables && typeof safeState.variables === 'object') {
    const { clients: _ignoredClients, ...restVariables } = safeState.variables;
    filteredVariables = restVariables;
  }

  // 1. Dostępne projekty
  const allProjects = Array.isArray(safeState.projects) ? safeState.projects : [];
  const accessibleProjects = allProjects
    .filter((p: any) => canAccessProject(user, p))
    .map((p: any) => filterProjectForUser(p, user));

  const allowedProjectIds = new Set(accessibleProjects.map((p: any) => p.id));

  // 2. Dostępne zadania: z dostępnych projektów LUB przypisane / zgłoszone przez użytkownika
  const allTasks = Array.isArray(safeState.tasks) ? safeState.tasks : [];
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
  const allComments = Array.isArray(safeState.comments) ? safeState.comments : [];
  const filteredComments = allComments.filter((c: any) => {
    if (!c) return false;
    return c.taskId && allowedTaskIds.has(c.taskId);
  });

  // 4. Logi aktywności: powiązane z dostępnymi projektami lub zadaniami, albo wykonane przez usera
  const allLogs = Array.isArray(safeState.activityLogs) ? safeState.activityLogs : [];
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
    companies: filterCompaniesForUser(safeState.companies, user, allProjects),
    projects: accessibleProjects,
    tasks: filteredTasks,
    comments: filteredComments,
    activityLogs: filteredLogs,
  };
}

/**
 * Whitelist edytowalnych pól zadania (Task).
 * Pola `id`, `revision`, `createdAt`, `reporterId` nigdy nie są edytowalne.
 * Zmiana `projectId` zadania dozwolona wyłącznie dla admin / project_manager.
 * Odrzuca klucze prototype (__proto__, constructor, prototype).
 */
export const FIELD_LIMITS = {
  title: 200,
  key: 12,
  name: 200,
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
    else if (field === 'description') limit = FIELD_LIMITS.description;
    else if (field === 'status' || field === 'priority' || field === 'type') limit = FIELD_LIMITS.status;
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
 * Pola `id`, `revision`, `createdAt`, `reporterId` nigdy nie są edytowalne.
 * Zmiana `projectId` zadania dozwolona wyłącznie dla admin / project_manager.
 * Odrzuca klucze prototype (__proto__, constructor, prototype).
 * Przycina lub odrzuca (gdy options.rejectOnOverflow=true) wartości tekstowe ponad limity.
 */
export function pickAllowedTaskFields(
  body: any,
  user: { id: string; role?: string } | null | undefined,
  options?: FieldSanitizeOptions
): Record<string, any> {
  if (!body || typeof body !== 'object') return {};
  if (hasForbiddenKeys(body)) {
    throw new Error('Niedozwolony klucz w żądaniu (__proto__, constructor, prototype).');
  }

  const isAdminOrManager = user && (user.role === 'admin' || user.role === 'project_manager');

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
    // Pola absolutnie niemodyfikowalne: id, revision, createdAt, reporterId, updatedAt, expectedRevision
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
      // Zmiana projectId tylko dla admin/project_manager
      if (isAdminOrManager) {
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
  project?: { ownerId?: string } | null;
}

/**
 * Whitelist edytowalnych pól projektu (Project).
 * Pola `id`, `revision`, `createdAt` nigdy nie są edytowalne.
 * Zmiana `memberIds` oraz `key` projektu tylko dla admin / project_manager.
 * Pola finansowe, `companyId` i dane klienta (budget, costs, client*) edytowalne dla uprawnionych wg `canEditFinance`.
 * Zmiana `ownerId`: admin lub obecny właściciel projektu (dla projektów bez ownerId również project_manager).
 * Odrzuca klucze prototype (__proto__, constructor, prototype).
 * Przycina lub odrzuca (gdy options.rejectOnOverflow=true) wartości tekstowe ponad limity.
 */
export function pickAllowedProjectFields(
  body: any,
  user: { id: string; role?: string } | null | undefined,
  options?: ProjectFieldPickOptions
): Record<string, any> {
  if (!body || typeof body !== 'object') return {};
  if (hasForbiddenKeys(body)) {
    throw new Error('Niedozwolony klucz w żądaniu (__proto__, constructor, prototype).');
  }

  const isAdmin = Boolean(user && user.role === 'admin');
  const isAdminOrManager = Boolean(user && (user.role === 'admin' || user.role === 'project_manager'));
  const canManageFinance = canEditFinance(user, options?.project);
  const canChangeOwner = Boolean(
    user &&
      user.role !== 'viewer' &&
      (isAdmin ||
        (options?.project?.ownerId
          ? options.project.ownerId === user.id
          : user.role === 'project_manager'))
  );

  // Bazowe pola edytowalne dla każdego uprawnionego do edycji projektu
  const baseFields = new Set([
    'name',
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

  // Pola zastrzeżone wyłącznie dla admin / project_manager
  const strictAdminManagerFields = new Set([
    'key',
    'memberIds',
    'isArchived',
    'archivedAt',
    'archivedBy',
    'isDemo',
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

    if (isAdminOrManager && strictAdminManagerFields.has(key)) {
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
    `${projectKey}-${String(existingCount + 1).padStart(2, '0')}`;

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
