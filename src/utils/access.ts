import type { User, Project, Task, Comment, ActivityLog } from '../types';

/**
 * Lista pól projektu o charakterze finansowym oraz danych klienta / zamawiającego,
 * które są usuwane z odpowiedzi dla ról innych niż admin i project_manager.
 */
export const FINANCIAL_AND_CLIENT_FIELDS: readonly string[] = [
  'budget',
  'costs',
  'quotations',
  'projectValue',
  'projectValueGross',
  'projectVatRate',
  'clientName',
  'clientContactPerson',
  'clientPhone',
  'clientEmail',
  'clientNip',
  'clientAddress',
] as const;

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
  project: { id: string; memberIds?: string[] } | null | undefined
): boolean {
  if (!user || !project) return false;
  if (user.role === 'admin' || user.role === 'project_manager') {
    return true;
  }
  return Array.isArray(project.memberIds) && project.memberIds.includes(user.id);
}

/**
 * Filtruje pojedynczy projekt pod kątem uprawnień użytkownika.
 * Dla ról innych niż admin i project_manager usuwa pola finansowe i dane klienta (client*).
 */
export function filterProjectForUser<T extends Record<string, any>>(
  project: T,
  user: { id: string; role?: string } | null | undefined
): T {
  if (!project) return project;
  const isAdminOrManager = user && (user.role === 'admin' || user.role === 'project_manager');
  if (isAdminOrManager) {
    return { ...project };
  }

  const sanitized: Record<string, any> = { ...project };
  for (const key of Object.keys(sanitized)) {
    if (
      key.toLowerCase().startsWith('client') ||
      key === 'budget' ||
      key === 'costs' ||
      key === 'quotations' ||
      key === 'projectValue' ||
      key === 'projectValueGross' ||
      key === 'projectVatRate'
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
export function filterStateForUser(
  state: any,
  user: { id: string; role?: string } | null | undefined
): any {
  if (!state) return state;
  if (!user) {
    return {
      ...state,
      projects: [],
      tasks: [],
      comments: [],
      activityLogs: [],
    };
  }

  const isAdminOrManager = user.role === 'admin' || user.role === 'project_manager';
  if (isAdminOrManager) {
    return { ...state };
  }

  // 1. Dostępne projekty
  const allProjects = Array.isArray(state.projects) ? state.projects : [];
  const accessibleProjects = allProjects
    .filter((p: any) => canAccessProject(user, p))
    .map((p: any) => filterProjectForUser(p, user));

  const allowedProjectIds = new Set(accessibleProjects.map((p: any) => p.id));

  // 2. Dostępne zadania: z dostępnych projektów LUB przypisane / zgłoszone przez użytkownika
  const allTasks = Array.isArray(state.tasks) ? state.tasks : [];
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
  const allComments = Array.isArray(state.comments) ? state.comments : [];
  const filteredComments = allComments.filter((c: any) => {
    if (!c) return false;
    return c.taskId && allowedTaskIds.has(c.taskId);
  });

  // 4. Logi aktywności: powiązane z dostępnymi projektami lub zadaniami, albo wykonane przez usera
  const allLogs = Array.isArray(state.activityLogs) ? state.activityLogs : [];
  const filteredLogs = allLogs.filter((log: any) => {
    if (!log) return false;
    if (log.projectId && allowedProjectIds.has(log.projectId)) return true;
    if (log.taskId && allowedTaskIds.has(log.taskId)) return true;
    if (!log.projectId && !log.taskId && log.userId === user.id) return true;
    return false;
  });

  return {
    ...state,
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
export function pickAllowedTaskFields(
  body: any,
  user: { id: string; role?: string } | null | undefined
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
      result[key] = body[key];
    }
  }

  return result;
}

/**
 * Whitelist edytowalnych pól projektu (Project).
 * Pola `id`, `revision`, `createdAt` nigdy nie są edytowalne.
 * Zmiana `memberIds` oraz `key` projektu tylko dla admin / project_manager.
 * Pola finansowe i dane klienta (budget, costs, client*) edytowalne tylko dla admin / project_manager.
 * Odrzuca klucze prototype (__proto__, constructor, prototype).
 */
export function pickAllowedProjectFields(
  body: any,
  user: { id: string; role?: string } | null | undefined
): Record<string, any> {
  if (!body || typeof body !== 'object') return {};
  if (hasForbiddenKeys(body)) {
    throw new Error('Niedozwolony klucz w żądaniu (__proto__, constructor, prototype).');
  }

  const isAdminOrManager = user && (user.role === 'admin' || user.role === 'project_manager');

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
  const adminManagerFields = new Set([
    'key',
    'memberIds',
    'budget',
    'projectValue',
    'projectValueGross',
    'projectVatRate',
    'quotations',
    'costs',
    'clientName',
    'clientContactPerson',
    'clientPhone',
    'clientEmail',
    'clientNip',
    'clientAddress',
    'isArchived',
    'archivedAt',
    'archivedBy',
    'isDemo',
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
      result[key] = body[key];
      continue;
    }

    if (isAdminOrManager && (adminManagerFields.has(key) || key.toLowerCase().startsWith('client'))) {
      result[key] = body[key];
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
