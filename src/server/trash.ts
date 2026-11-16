import crypto from 'crypto';
import type {
  TrashEntry,
  TrashEntrySummary,
  TrashProjectPayload,
  TrashTaskPayload,
} from '../types/index.js';
import { canAccessProject, canWrite } from '../utils/access.js';
import { logger } from './logger.js';
import type { StateStore } from './state.js';

export const TRASH_MAX_ENTRIES = 2000;
export const TRASH_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 godzin
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function deepClone<T>(val: T): T {
  return JSON.parse(JSON.stringify(val));
}

function normalizeArrayIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return Array.from(new Set(raw.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)));
}

export function enforceTrashLimit(
  trash: TrashEntry[],
  maxEntries: number = TRASH_MAX_ENTRIES
): { entries: TrashEntry[]; removedCount: number } {
  if (!Array.isArray(trash)) {
    return { entries: [], removedCount: 0 };
  }
  if (trash.length <= maxEntries) {
    return { entries: trash, removedCount: 0 };
  }

  // Sortujemy indeksy od najstarszego do najnowszego (po deletedAt) i usuwamy najstarsze wpisy ponad limit
  const withOrder = trash.map((entry, idx) => ({
    entry,
    idx,
    ts: Number.isFinite(Date.parse(entry?.deletedAt)) ? Date.parse(entry.deletedAt) : 0,
  }));

  withOrder.sort((a, b) => {
    if (a.ts !== b.ts) return a.ts - b.ts;
    return a.idx - b.idx;
  });

  const toRemoveCount = trash.length - maxEntries;
  const indicesToRemove = new Set(withOrder.slice(0, toRemoveCount).map((item) => item.idx));
  const entries = trash.filter((_, idx) => !indicesToRemove.has(idx));

  return { entries, removedCount: toRemoveCount };
}

export function purgeExpiredTrash(
  appState: any,
  nowMs: number = Date.now()
): { removedCount: number } {
  if (!appState || !Array.isArray(appState.trash) || appState.trash.length === 0) {
    return { removedCount: 0 };
  }

  const before = appState.trash.length;
  appState.trash = appState.trash.filter((entry: TrashEntry) => {
    if (!entry || typeof entry.expiresAt !== 'string') return false;
    const expMs = Date.parse(entry.expiresAt);
    if (!Number.isFinite(expMs)) return false;
    return expMs > nowMs;
  });

  return { removedCount: before - appState.trash.length };
}

export function moveTaskToTrash(
  appState: any,
  task: any,
  caller: { id: string; name?: string; email?: string },
  retentionDays: number,
  nowMs: number = Date.now()
): { trashEntry: TrashEntry } {
  if (!Array.isArray(appState.trash)) appState.trash = [];
  if (!Array.isArray(appState.comments)) appState.comments = [];
  if (!Array.isArray(appState.activityLogs)) appState.activityLogs = [];

  const taskId = task.id;

  // Wyodrębnij i usuń komentarze tego zadania ze stanu, aby nie zostawały osierocone
  const taskComments = appState.comments.filter((c: any) => c && c.taskId === taskId);
  appState.comments = appState.comments.filter((c: any) => !c || c.taskId !== taskId);

  // Zapisz powiązania zależności w obu kierunkach
  const ownBlocking = normalizeArrayIds(task.blockingTaskIds);
  const ownDeps = normalizeArrayIds(task.dependencies);
  const childTaskIds: string[] = [];
  const dependentTaskIds: string[] = [];

  const remainingTasks: any[] = [];
  for (const t of appState.tasks || []) {
    if (!t || t.id === taskId) continue;
    const cloneOrRef = t;
    if (cloneOrRef.parentId === taskId) {
      childTaskIds.push(cloneOrRef.id);
      delete cloneOrRef.parentId;
    }
    const hadBlocking = Array.isArray(cloneOrRef.blockingTaskIds) && cloneOrRef.blockingTaskIds.includes(taskId);
    const hadDeps = Array.isArray(cloneOrRef.dependencies) && cloneOrRef.dependencies.includes(taskId);
    if (hadBlocking || hadDeps) {
      dependentTaskIds.push(cloneOrRef.id);
      if (hadBlocking) {
        cloneOrRef.blockingTaskIds = cloneOrRef.blockingTaskIds.filter((id: string) => id !== taskId);
      }
      if (hadDeps) {
        cloneOrRef.dependencies = cloneOrRef.dependencies.filter((id: string) => id !== taskId);
      }
    }
    remainingTasks.push(cloneOrRef);
  }
  appState.tasks = remainingTasks;

  const deletedAt = new Date(nowMs).toISOString();
  const safeRetention = Math.max(1, Math.min(365, Math.floor(retentionDays || 30)));
  const expiresAt = new Date(nowMs + safeRetention * MS_PER_DAY).toISOString();

  const payload: TrashTaskPayload = {
    task: deepClone(task),
    comments: deepClone(taskComments),
    links: {
      ...(typeof task.parentId === 'string' && task.parentId ? { parentId: task.parentId } : {}),
      blockingTaskIds: ownBlocking,
      dependencies: ownDeps,
      childTaskIds,
      dependentTaskIds,
    },
  };

  const entry: TrashEntry = {
    id: `trash-${crypto.randomUUID()}`,
    type: 'task',
    deletedAt,
    deletedBy: caller.id,
    deletedByName: caller.name || caller.email || caller.id,
    expiresAt,
    projectId: task.projectId || '',
    title: task.title || '',
    code: task.code || '',
    payload,
  };

  appState.trash.unshift(entry);
  const { entries } = enforceTrashLimit(appState.trash, TRASH_MAX_ENTRIES);
  appState.trash = entries;

  appState.activityLogs.unshift({
    id: `act-${nowMs}-${crypto.randomUUID().slice(0, 8)}`,
    projectId: task.projectId || undefined,
    taskId: task.id,
    userId: caller.id,
    action: `Zadanie [${task.code || task.id}] "${task.title || ''}" przeniesiono do kosza`,
    timestamp: deletedAt,
  });

  return { trashEntry: entry };
}

export function moveProjectToTrash(
  appState: any,
  project: any,
  caller: { id: string; name?: string; email?: string },
  retentionDays: number,
  nowMs: number = Date.now()
): { trashEntry: TrashEntry } {
  if (!Array.isArray(appState.trash)) appState.trash = [];
  if (!Array.isArray(appState.comments)) appState.comments = [];
  if (!Array.isArray(appState.activityLogs)) appState.activityLogs = [];

  const projectId = project.id;
  const projectTasks = (appState.tasks || []).filter((t: any) => t && t.projectId === projectId);
  const projectTaskIdSet = new Set(projectTasks.map((t: any) => t.id));

  const projectComments = appState.comments.filter((c: any) => c && projectTaskIdSet.has(c.taskId));
  appState.comments = appState.comments.filter((c: any) => !c || !projectTaskIdSet.has(c.taskId));

  appState.projects = (appState.projects || []).filter((p: any) => p && p.id !== projectId);
  appState.tasks = (appState.tasks || []).filter((t: any) => {
    if (!t || t.projectId === projectId) return false;
    if (t.parentId && projectTaskIdSet.has(t.parentId)) {
      delete t.parentId;
    }
    if (Array.isArray(t.blockingTaskIds)) {
      t.blockingTaskIds = t.blockingTaskIds.filter((id: string) => !projectTaskIdSet.has(id));
    }
    if (Array.isArray(t.dependencies)) {
      t.dependencies = t.dependencies.filter((id: string) => !projectTaskIdSet.has(id));
    }
    return true;
  });

  const deletedAt = new Date(nowMs).toISOString();
  const safeRetention = Math.max(1, Math.min(365, Math.floor(retentionDays || 30)));
  const expiresAt = new Date(nowMs + safeRetention * MS_PER_DAY).toISOString();

  const payload: TrashProjectPayload = {
    project: deepClone(project),
    tasks: deepClone(projectTasks),
    comments: deepClone(projectComments),
  };

  const entry: TrashEntry = {
    id: `trash-${crypto.randomUUID()}`,
    type: 'project',
    deletedAt,
    deletedBy: caller.id,
    deletedByName: caller.name || caller.email || caller.id,
    expiresAt,
    projectId,
    title: project.name || '',
    code: project.key || '',
    payload,
  };

  appState.trash.unshift(entry);
  const { entries } = enforceTrashLimit(appState.trash, TRASH_MAX_ENTRIES);
  appState.trash = entries;

  appState.activityLogs.unshift({
    id: `act-${nowMs}-${crypto.randomUUID().slice(0, 8)}`,
    projectId,
    userId: caller.id,
    action: `Projekt [${project.key || projectId}] "${project.name || ''}" przeniesiono do kosza`,
    timestamp: deletedAt,
  });

  return { trashEntry: entry };
}

function findProjectForTrashEntry(appState: any, projectId: string): any | null {
  const active = (appState.projects || []).find((p: any) => p && p.id === projectId);
  if (active) return active;

  const trashed = (appState.trash || []).find(
    (e: TrashEntry) => e && e.type === 'project' && e.projectId === projectId
  );
  if (trashed && trashed.payload && (trashed.payload as TrashProjectPayload).project) {
    return (trashed.payload as TrashProjectPayload).project;
  }
  return null;
}

export function canSeeTrashEntry(
  appState: any,
  entry: TrashEntry,
  user: { id: string; role?: string } | null | undefined
): boolean {
  if (!user || !user.role || !entry) return false;
  if (user.role === 'viewer') return false;
  if (user.role === 'admin' || user.role === 'project_manager') return true;

  const project = findProjectForTrashEntry(appState, entry.projectId);
  const hasProjectAccess = project ? canAccessProject(user, project) : false;

  if (entry.type === 'project') {
    return hasProjectAccess && entry.deletedBy === user.id;
  }

  const taskPayload = entry.payload as TrashTaskPayload;
  const task = taskPayload?.task;
  const isOwnTask =
    Boolean(task) &&
    ((task.assigneeId && task.assigneeId === user.id) ||
      (task.reporterId && task.reporterId === user.id));

  // Spójnie z filterStateForUser: własne zadania (assignee/reporter) lub z dostępnego projektu
  if (!hasProjectAccess && !isOwnTask) {
    return false;
  }

  return Boolean(isOwnTask || entry.deletedBy === user.id);
}

export function canRestoreTrashEntry(
  appState: any,
  entry: TrashEntry,
  user: { id: string; role?: string } | null | undefined
): boolean {
  if (!canWrite(user) || !entry) return false;
  if (user!.role === 'admin' || user!.role === 'project_manager') return true;
  return canSeeTrashEntry(appState, entry, user) && entry.deletedBy === user!.id;
}

export function listTrashForUser(
  appState: any,
  user: { id: string; role?: string } | null | undefined,
  nowMs: number = Date.now()
): TrashEntrySummary[] {
  if (!user || user.role === 'viewer') return [];
  const entries: TrashEntry[] = Array.isArray(appState?.trash) ? appState.trash : [];
  const isAdminOrManager = user.role === 'admin' || user.role === 'project_manager';

  const result: TrashEntrySummary[] = [];
  for (const entry of entries) {
    if (!entry) continue;
    if (!canSeeTrashEntry(appState, entry, user)) continue;

    const expMs = Date.parse(entry.expiresAt);
    const daysRemaining = Number.isFinite(expMs)
      ? Math.max(0, Math.ceil((expMs - nowMs) / MS_PER_DAY))
      : 0;

    const proj = findProjectForTrashEntry(appState, entry.projectId);

    if (entry.type === 'project') {
      const payload = entry.payload as TrashProjectPayload;
      result.push({
        id: entry.id,
        type: 'project',
        deletedAt: entry.deletedAt,
        deletedBy: entry.deletedBy,
        deletedByName: entry.deletedByName,
        expiresAt: entry.expiresAt,
        daysRemaining,
        projectId: entry.projectId,
        projectName: payload?.project?.name || entry.title,
        projectKey: payload?.project?.key || entry.code,
        title: entry.title,
        code: entry.code,
        taskCount: Array.isArray(payload?.tasks) ? payload.tasks.length : 0,
        commentCount: Array.isArray(payload?.comments) ? payload.comments.length : 0,
        canRestore: canRestoreTrashEntry(appState, entry, user),
        canPurge: isAdminOrManager,
      });
    } else {
      const payload = entry.payload as TrashTaskPayload;
      result.push({
        id: entry.id,
        type: 'task',
        deletedAt: entry.deletedAt,
        deletedBy: entry.deletedBy,
        deletedByName: entry.deletedByName,
        expiresAt: entry.expiresAt,
        daysRemaining,
        projectId: entry.projectId,
        projectName: proj?.name || '(Usunięty projekt)',
        projectKey: proj?.key || '—',
        title: entry.title,
        code: entry.code,
        taskCount: 1,
        commentCount: Array.isArray(payload?.comments) ? payload.comments.length : 0,
        canRestore: canRestoreTrashEntry(appState, entry, user),
        canPurge: isAdminOrManager,
      });
    }
  }

  return result;
}

export type RestoreTrashResult =
  | {
      ok: true;
      type: 'task';
      task: any;
      commentsRestored: number;
    }
  | {
      ok: true;
      type: 'project';
      project: any;
      tasksRestored: number;
      commentsRestored: number;
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

export function restoreTrashEntry(
  appState: any,
  trashId: string,
  caller: { id: string; role?: string; name?: string },
  nowMs: number = Date.now()
): RestoreTrashResult {
  if (!Array.isArray(appState.trash)) appState.trash = [];
  if (!Array.isArray(appState.projects)) appState.projects = [];
  if (!Array.isArray(appState.tasks)) appState.tasks = [];
  if (!Array.isArray(appState.comments)) appState.comments = [];
  if (!Array.isArray(appState.activityLogs)) appState.activityLogs = [];

  if (!canWrite(caller)) {
    return { ok: false, status: 403, error: 'Rola viewer posiada dostęp wyłącznie do odczytu.' };
  }

  const entryIndex = appState.trash.findIndex((e: TrashEntry) => e && e.id === trashId);
  if (entryIndex === -1) {
    return { ok: false, status: 404, error: 'Element nie znajduje się w koszu lub wygasł.' };
  }

  const entry: TrashEntry = appState.trash[entryIndex];
  if (!canRestoreTrashEntry(appState, entry, caller)) {
    return { ok: false, status: 403, error: 'Brak uprawnień do przywrócenia tego elementu z kosza.' };
  }

  const nowIso = new Date(nowMs).toISOString();

  if (entry.type === 'task') {
    const payload = entry.payload as TrashTaskPayload;
    const taskTemplate = payload?.task;
    if (!taskTemplate || !taskTemplate.id) {
      return { ok: false, status: 400, error: 'Uszkodzone dane zadania w koszu.' };
    }

    const parentProject = appState.projects.find((p: any) => p && p.id === entry.projectId);
    if (!parentProject) {
      return { ok: false, status: 409, error: 'Najpierw przywróć projekt.' };
    }

    if (appState.tasks.some((t: any) => t && t.id === taskTemplate.id)) {
      return {
        ok: false,
        status: 409,
        error: `Zadanie o ID "${taskTemplate.id}" już istnieje w stanie aplikacji.`,
      };
    }

    const existingTaskIds = new Set<string>(appState.tasks.map((t: any) => t.id));
    const restoredTask = deepClone(taskTemplate);

    // Przywróć parentId i zależności tylko gdy drugie zadanie wciąż istnieje w stanie
    const sourceParentId = payload.links?.parentId ?? restoredTask.parentId;
    if (sourceParentId && existingTaskIds.has(sourceParentId)) {
      restoredTask.parentId = sourceParentId;
    } else {
      delete restoredTask.parentId;
    }

    const sourceBlocking = normalizeArrayIds(
      payload.links?.blockingTaskIds ?? restoredTask.blockingTaskIds
    ).filter((id) => existingTaskIds.has(id));

    const sourceDeps = normalizeArrayIds(
      payload.links?.dependencies ?? restoredTask.dependencies
    ).filter((id) => existingTaskIds.has(id));

    if (sourceBlocking.length > 0) {
      restoredTask.blockingTaskIds = sourceBlocking;
    } else if ('blockingTaskIds' in restoredTask) {
      restoredTask.blockingTaskIds = [];
    }

    if (sourceDeps.length > 0) {
      restoredTask.dependencies = sourceDeps;
    } else if ('dependencies' in restoredTask) {
      restoredTask.dependencies = [];
    }

    restoredTask.revision = (typeof restoredTask.revision === 'number' ? restoredTask.revision : 1) + 1;
    restoredTask.updatedAt = nowIso;

    appState.tasks.unshift(restoredTask);

    // Odtwórz też wychodzące relacje (gdy inne zadanie wciąż istnieje w stanie)
    const childIds = new Set(payload.links?.childTaskIds || []);
    const dependentIds = new Set(payload.links?.dependentTaskIds || []);
    if (childIds.size > 0 || dependentIds.size > 0) {
      for (const t of appState.tasks) {
        if (!t || t.id === restoredTask.id) continue;
        if (childIds.has(t.id) && !t.parentId) {
          t.parentId = restoredTask.id;
          t.revision = (typeof t.revision === 'number' ? t.revision : 1) + 1;
          t.updatedAt = nowIso;
        }
        if (dependentIds.has(t.id)) {
          const nextBlocking = normalizeArrayIds(t.blockingTaskIds);
          if (!nextBlocking.includes(restoredTask.id)) nextBlocking.push(restoredTask.id);
          t.blockingTaskIds = nextBlocking;

          const nextDeps = normalizeArrayIds(t.dependencies);
          if (!nextDeps.includes(restoredTask.id)) nextDeps.push(restoredTask.id);
          t.dependencies = nextDeps;

          t.revision = (typeof t.revision === 'number' ? t.revision : 1) + 1;
          t.updatedAt = nowIso;
        }
      }
    }

    // Przywróć komentarze bez duplikacji po ID
    const existingCommentIds = new Set(appState.comments.map((c: any) => c.id));
    let commentsRestored = 0;
    for (const c of payload.comments || []) {
      if (c && c.id && !existingCommentIds.has(c.id)) {
        appState.comments.push(deepClone(c));
        existingCommentIds.add(c.id);
        commentsRestored += 1;
      }
    }

    appState.trash.splice(entryIndex, 1);
    appState.activityLogs.unshift({
      id: `act-${nowMs}-${crypto.randomUUID().slice(0, 8)}`,
      projectId: restoredTask.projectId,
      taskId: restoredTask.id,
      userId: caller.id,
      action: `Przywrócono z kosza zadanie [${restoredTask.code || restoredTask.id}] "${restoredTask.title || ''}"`,
      timestamp: nowIso,
    });

    return { ok: true, type: 'task', task: restoredTask, commentsRestored };
  }

  // entry.type === 'project'
  const payload = entry.payload as TrashProjectPayload;
  const projectTemplate = payload?.project;
  if (!projectTemplate || !projectTemplate.id) {
    return { ok: false, status: 400, error: 'Uszkodzone dane projektu w koszu.' };
  }

  if (appState.projects.some((p: any) => p && p.id === projectTemplate.id)) {
    return {
      ok: false,
      status: 409,
      error: `Projekt o ID "${projectTemplate.id}" już istnieje w stanie aplikacji.`,
    };
  }

  const normalizedKey = String(projectTemplate.key || '').trim().toUpperCase();
  if (
    normalizedKey &&
    appState.projects.some(
      (p: any) => p && String(p.key || '').trim().toUpperCase() === normalizedKey
    )
  ) {
    return {
      ok: false,
      status: 409,
      error: `Klucz projektu "${projectTemplate.key}" jest już zajęty przez inny istniejący projekt.`,
    };
  }

  const existingTaskIds = new Set<string>(appState.tasks.map((t: any) => t.id));
  const payloadTasks = Array.isArray(payload.tasks) ? payload.tasks : [];
  for (const pt of payloadTasks) {
    if (pt && existingTaskIds.has(pt.id)) {
      return {
        ok: false,
        status: 409,
        error: `Zadanie o ID "${pt.id}" już istnieje w stanie aplikacji.`,
      };
    }
  }

  const allAvailableTaskIds = new Set<string>([
    ...existingTaskIds,
    ...payloadTasks.map((t) => t.id),
  ]);

  const restoredProject = deepClone(projectTemplate);
  restoredProject.revision = (typeof restoredProject.revision === 'number' ? restoredProject.revision : 1) + 1;
  appState.projects.push(restoredProject);

  let tasksRestored = 0;
  for (const pt of payloadTasks) {
    if (!pt || !pt.id) continue;
    const rt = deepClone(pt);
    if (rt.parentId && !allAvailableTaskIds.has(rt.parentId)) {
      delete rt.parentId;
    }
    if (Array.isArray(rt.blockingTaskIds)) {
      rt.blockingTaskIds = rt.blockingTaskIds.filter((id: string) => allAvailableTaskIds.has(id));
    }
    if (Array.isArray(rt.dependencies)) {
      rt.dependencies = rt.dependencies.filter((id: string) => allAvailableTaskIds.has(id));
    }
    rt.revision = (typeof rt.revision === 'number' ? rt.revision : 1) + 1;
    rt.updatedAt = nowIso;
    appState.tasks.push(rt);
    tasksRestored += 1;
  }

  const existingCommentIds = new Set(appState.comments.map((c: any) => c.id));
  let commentsRestored = 0;
  for (const c of payload.comments || []) {
    if (c && c.id && !existingCommentIds.has(c.id)) {
      appState.comments.push(deepClone(c));
      existingCommentIds.add(c.id);
      commentsRestored += 1;
    }
  }

  appState.trash.splice(entryIndex, 1);
  appState.activityLogs.unshift({
    id: `act-${nowMs}-${crypto.randomUUID().slice(0, 8)}`,
    projectId: restoredProject.id,
    userId: caller.id,
    action: `Przywrócono z kosza projekt [${restoredProject.key || restoredProject.id}] "${restoredProject.name || ''}" (${tasksRestored} zadań)`,
    timestamp: nowIso,
  });

  return { ok: true, type: 'project', project: restoredProject, tasksRestored, commentsRestored };
}

export function createTrashCleanupService(deps: {
  stateStore: StateStore;
  disableTimers?: boolean;
}) {
  const { stateStore, disableTimers = false } = deps;
  let intervalTimer: NodeJS.Timeout | null = null;

  async function runCleanup(): Promise<number> {
    const appState = stateStore.ensureStateStructure();
    const { removedCount } = purgeExpiredTrash(appState, Date.now());
    if (removedCount > 0) {
      stateStore.setAppState(appState);
      await stateStore.saveStateAtomicAsync();
      logger.info(`[Trash] Automatycznie usunięto ${removedCount} przeterminowanych wpisów z kosza.`);
    }
    return removedCount;
  }

  async function start(): Promise<void> {
    try {
      await runCleanup();
    } catch (err: any) {
      logger.warn('[Trash] Błąd wstępnego czyszczenia kosza:', err?.message || err);
    }

    if (!disableTimers && !intervalTimer) {
      intervalTimer = setInterval(() => {
        runCleanup().catch((err) => {
          logger.warn('[Trash] Błąd okresowego czyszczenia kosza:', err?.message || err);
        });
      }, TRASH_CLEANUP_INTERVAL_MS);
      if (typeof intervalTimer.unref === 'function') {
        intervalTimer.unref();
      }
    }
  }

  function stop(): void {
    if (intervalTimer) {
      clearInterval(intervalTimer);
      intervalTimer = null;
    }
  }

  return {
    start,
    stop,
    runCleanup,
  };
}
