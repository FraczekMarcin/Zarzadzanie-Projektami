export type ProgressWeighting = 'estimate' | 'equal';

export const DEFAULT_PROGRESS_WEIGHTING: ProgressWeighting = 'estimate';

export interface ProgressOptions {
  weighting?: ProgressWeighting;
}

export interface ProgressTaskLike {
  id: string;
  projectId?: string;
  parentId?: string | null;
  status?: string;
  progress?: number;
  estimatedHours?: number;
  startDate?: string;
  dueDate?: string;
  durationDays?: number;
}

export interface SubtaskProgressSummary {
  total: number;
  done: number;
  weightLabel: string;
  tooltip: string;
}

export function normalizeProgressWeighting(raw: unknown): ProgressWeighting {
  return raw === 'equal' ? 'equal' : 'estimate';
}

export function isCancelledTask(task: { status?: unknown } | null | undefined): boolean {
  return Boolean(task && (task.status as string) === 'cancelled');
}

function parseIsoDateUtcMs(raw?: string): number | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  const ms = Date.UTC(year, month - 1, day);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Wyznacza wagę zadania dla średniej ważonej postępu:
 * - przy trybie 'equal': zawsze 1
 * - przy trybie 'estimate': estimatedHours (> 0), w przeciwnym razie (dueDate - startDate + 1, min 1), inaczej 1.
 */
export function getTaskWeight(
  task: ProgressTaskLike | null | undefined,
  weighting: ProgressWeighting = DEFAULT_PROGRESS_WEIGHTING
): number {
  if (!task || weighting === 'equal') {
    return 1;
  }

  if (
    typeof task.estimatedHours === 'number' &&
    Number.isFinite(task.estimatedHours) &&
    task.estimatedHours > 0
  ) {
    return task.estimatedHours;
  }

  const startMs = parseIsoDateUtcMs(task.startDate);
  const dueMs = parseIsoDateUtcMs(task.dueDate);
  if (startMs !== null && dueMs !== null) {
    const diffDays = Math.round((dueMs - startMs) / 86_400_000) + 1;
    return Math.max(1, diffDays);
  }

  return 1;
}

function clampLeafProgress(task: ProgressTaskLike): number {
  if (task.status === 'done') return 100;
  const raw = Number(task.progress);
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

function computeWeightedAverage(
  entries: ReadonlyArray<{ progress: number; weight: number; status?: string }>
): number {
  if (entries.length === 0) return 0;

  const allDone = entries.every((entry) => entry.status === 'done');
  if (allDone) return 100;

  let weightedSum = 0;
  let totalWeight = 0;
  for (const entry of entries) {
    const safeWeight = Number.isFinite(entry.weight) && entry.weight > 0 ? entry.weight : 1;
    weightedSum += entry.progress * safeWeight;
    totalWeight += safeWeight;
  }

  const rawAvg =
    totalWeight > 0
      ? weightedSum / totalWeight
      : entries.reduce((acc, entry) => acc + entry.progress, 0) / entries.length;

  const rounded = Math.round(rawAvg);
  return Math.max(0, Math.min(99, rounded));
}

function sameProjectScope(a: ProgressTaskLike, b: ProgressTaskLike): boolean {
  if (a.projectId && b.projectId) {
    return a.projectId === b.projectId;
  }
  return true;
}

/**
 * Zwraca mapę taskId -> wyliczony postęp (0..100) dla wszystkich nieanulowanych zadań.
 * Liczone rekurencyjnie od liści do korzeni z ochroną przed cyklami i brakującymi rodzicami.
 */
export function computeProgressMap(
  tasks: readonly ProgressTaskLike[],
  options: ProgressOptions = {}
): Map<string, number> {
  const weighting = normalizeProgressWeighting(options.weighting);
  const map = new Map<string, number>();
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return map;
  }

  const activeById = new Map<string, ProgressTaskLike>();
  for (const task of tasks) {
    if (!task || !task.id || isCancelledTask(task)) continue;
    activeById.set(task.id, task);
  }

  const childrenByParent = new Map<string, ProgressTaskLike[]>();
  for (const task of activeById.values()) {
    const rawParentId = typeof task.parentId === 'string' ? task.parentId.trim() : '';
    if (!rawParentId || rawParentId === task.id) continue;
    const parent = activeById.get(rawParentId);
    if (!parent || !sameProjectScope(task, parent)) continue;

    const list = childrenByParent.get(rawParentId);
    if (list) {
      list.push(task);
    } else {
      childrenByParent.set(rawParentId, [task]);
    }
  }

  const visiting = new Set<string>();

  const evaluate = (taskId: string): number => {
    const cached = map.get(taskId);
    if (cached !== undefined) return cached;

    const task = activeById.get(taskId);
    if (!task) return 0;

    visiting.add(taskId);
    const directChildren = (childrenByParent.get(taskId) || []).filter(
      (child) => !visiting.has(child.id)
    );

    let result: number;
    if (directChildren.length === 0) {
      result = clampLeafProgress(task);
    } else {
      const childEntries = directChildren.map((child) => ({
        progress: evaluate(child.id),
        weight: getTaskWeight(child, weighting),
        status: child.status,
      }));
      result = computeWeightedAverage(childEntries);
    }

    visiting.delete(taskId);
    map.set(taskId, result);
    return result;
  };

  for (const taskId of activeById.keys()) {
    evaluate(taskId);
  }

  return map;
}

/**
 * Wylicza postęp projektu na podstawie nieanulowanych zadań najwyższego poziomu.
 * Jeśli brak zliczanych zadań -> 0.
 * 100 wyłącznie gdy wszystkie zliczane zadania najwyższego poziomu mają status 'done'.
 */
export function computeProjectProgress(
  projectTasks: readonly ProgressTaskLike[],
  options: ProgressOptions = {}
): number {
  const weighting = normalizeProgressWeighting(options.weighting);
  if (!Array.isArray(projectTasks) || projectTasks.length === 0) {
    return 0;
  }

  const activeTasks = projectTasks.filter((t) => t && t.id && !isCancelledTask(t));
  if (activeTasks.length === 0) {
    return 0;
  }

  const activeIds = new Set(activeTasks.map((t) => t.id));
  const progressMap = computeProgressMap(activeTasks, { weighting });

  let topLevelTasks = activeTasks.filter((t) => {
    const rawParentId = typeof t.parentId === 'string' ? t.parentId.trim() : '';
    return !rawParentId || !activeIds.has(rawParentId);
  });

  // Zabezpieczenie na wypadek czystego cyklu bez żadnego korzenia
  if (topLevelTasks.length === 0) {
    topLevelTasks = activeTasks;
  }

  const entries = topLevelTasks.map((task) => ({
    progress: progressMap.get(task.id) ?? clampLeafProgress(task),
    weight: getTaskWeight(task, weighting),
    status: task.status,
  }));

  return computeWeightedAverage(entries);
}

export function hasDirectSubtasks(
  tasks: readonly ProgressTaskLike[],
  taskId: string
): boolean {
  if (!taskId || !Array.isArray(tasks)) return false;
  const target = tasks.find((t) => t && t.id === taskId);
  return tasks.some(
    (t) =>
      t &&
      t.id !== taskId &&
      typeof t.parentId === 'string' &&
      t.parentId.trim() === taskId &&
      !isCancelledTask(t) &&
      (!target || sameProjectScope(t, target))
  );
}

export function getSubtaskProgressSummary(
  tasks: readonly ProgressTaskLike[],
  taskId: string,
  weighting: ProgressWeighting = DEFAULT_PROGRESS_WEIGHTING
): SubtaskProgressSummary {
  const normalizedWeighting = normalizeProgressWeighting(weighting);
  const target = Array.isArray(tasks) ? tasks.find((t) => t && t.id === taskId) : undefined;
  const direct = (Array.isArray(tasks) ? tasks : []).filter(
    (t) =>
      t &&
      t.id !== taskId &&
      typeof t.parentId === 'string' &&
      t.parentId.trim() === taskId &&
      !isCancelledTask(t) &&
      (!target || sameProjectScope(t, target))
  );

  const done = direct.filter((t) => t.status === 'done').length;
  const weightLabel = normalizedWeighting === 'equal' ? 'wagi: równe' : 'wagi: godziny';
  return {
    total: direct.length,
    done,
    weightLabel,
    tooltip: `Podzadania: ${direct.length} (${done} ukończone); ${weightLabel}`,
  };
}

/**
 * Przelicza w miejscu (in-place) postęp zadań i samego projektu w stanie aplikacji.
 * Nie podbija pola `revision` na zadaniach nadrzędnych ani podrzędnych.
 */
export function recomputeProjectProgress(
  appState: { projects?: any[]; tasks?: any[] },
  projectId: string,
  options: ProgressOptions = {}
): { changed: boolean; projectProgress: number } {
  if (!appState || !projectId) {
    return { changed: false, projectProgress: 0 };
  }

  const allTasks = Array.isArray(appState.tasks) ? appState.tasks : [];
  const projectTasks = allTasks.filter((t: any) => t && t.projectId === projectId);
  const progressMap = computeProgressMap(projectTasks, options);
  const projectProgress = computeProjectProgress(projectTasks, options);

  let changed = false;
  for (const task of projectTasks) {
    if (!task || !task.id || isCancelledTask(task)) continue;
    const computed = progressMap.get(task.id);
    if (computed !== undefined && task.progress !== computed) {
      task.progress = computed;
      changed = true;
    }
  }

  const projects = Array.isArray(appState.projects) ? appState.projects : [];
  const project = projects.find((p: any) => p && p.id === projectId);
  if (project && project.progress !== projectProgress) {
    project.progress = projectProgress;
    changed = true;
  }

  return { changed, projectProgress };
}

export function recomputeAllProjectsProgress(
  appState: { projects?: any[]; tasks?: any[] },
  options: ProgressOptions = {}
): { changed: boolean } {
  if (!appState) return { changed: false };
  const projectIds = new Set<string>();
  for (const p of Array.isArray(appState.projects) ? appState.projects : []) {
    if (p && typeof p.id === 'string' && p.id) {
      projectIds.add(p.id);
    }
  }
  for (const t of Array.isArray(appState.tasks) ? appState.tasks : []) {
    if (t && typeof t.projectId === 'string' && t.projectId) {
      projectIds.add(t.projectId);
    }
  }

  let changed = false;
  for (const pid of projectIds) {
    const res = recomputeProjectProgress(appState, pid, options);
    if (res.changed) changed = true;
  }
  return { changed };
}

export interface ReconcileLeafOptions {
  previousStatus?: unknown;
  hasSubtasks?: boolean;
}

export interface ReconcileLeafResult {
  changed: boolean;
  statusChangedToDone: boolean;
}

/**
 * Zapewnia spójność statusu i postępu zadania liściowego (bez aktywnych podzadań):
 * - zadania cancelled oraz zadania nadrzędne (hasSubtasks=true) nie są zmieniane;
 * - zmiana statusu z 'done' na inny (nie 'cancelled') przy progress=100 ustawia progress na 99;
 * - status 'done' ustawia progress na 100;
 * - progress=100 i status inny niż 'done'/'cancelled' ustawia status na 'done'.
 */
export function reconcileLeafTaskConsistency(
  task: { status?: unknown; progress?: unknown } | null | undefined,
  options: ReconcileLeafOptions = {}
): ReconcileLeafResult {
  if (!task || options.hasSubtasks || isCancelledTask(task)) {
    return { changed: false, statusChangedToDone: false };
  }

  const rawNum = Number(task.progress);
  const clamped = Number.isFinite(rawNum)
    ? Math.max(0, Math.min(100, Math.round(rawNum)))
    : 0;

  if (options.previousStatus === 'done' && task.status !== 'done') {
    if (clamped === 100) {
      const changed = task.progress !== 99;
      task.progress = 99;
      return { changed, statusChangedToDone: false };
    }
    if (typeof task.progress === 'number' && task.progress !== clamped) {
      task.progress = clamped;
      return { changed: true, statusChangedToDone: false };
    }
    return { changed: false, statusChangedToDone: false };
  }

  if (task.status === 'done') {
    const changed = task.progress !== 100;
    task.progress = 100;
    return { changed, statusChangedToDone: false };
  }

  if (clamped === 100) {
    task.status = 'done';
    task.progress = 100;
    return { changed: true, statusChangedToDone: true };
  }

  if (typeof task.progress === 'number' && task.progress !== clamped) {
    task.progress = clamped;
    return { changed: true, statusChangedToDone: false };
  }

  return { changed: false, statusChangedToDone: false };
}

/**
 * Naprawia spójność statusu i postępu istniejących zadań liściowych w przekazanej tablicy
 * (migracja startowa, import stanu, przywracanie z kosza).
 * Zadania cancelled oraz zadania nadrzędne pozostają bez zmian.
 */
export function reconcileLeafTasksConsistency(
  tasks: any[] | null | undefined,
  options: { projectId?: string } = {}
): { fixedCount: number; fixedTaskIds: string[] } {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return { fixedCount: 0, fixedTaskIds: [] };
  }

  const byId = new Map<string, ProgressTaskLike>();
  for (const t of tasks) {
    if (t && typeof t.id === 'string' && t.id) {
      byId.set(t.id, t);
    }
  }

  const parentIdsWithActiveChildren = new Set<string>();
  for (const t of tasks) {
    if (!t || !t.id || isCancelledTask(t)) continue;
    const rawParentId = typeof t.parentId === 'string' ? t.parentId.trim() : '';
    if (!rawParentId || rawParentId === t.id) continue;
    const parent = byId.get(rawParentId);
    if (parent && sameProjectScope(t, parent)) {
      parentIdsWithActiveChildren.add(rawParentId);
    }
  }

  const fixedTaskIds: string[] = [];
  for (const task of tasks) {
    if (!task || !task.id) continue;
    if (options.projectId && task.projectId !== options.projectId) continue;
    if (isCancelledTask(task)) continue;
    if (parentIdsWithActiveChildren.has(task.id)) continue;

    const { changed } = reconcileLeafTaskConsistency(task, { hasSubtasks: false });
    if (changed) {
      fixedTaskIds.push(task.id);
    }
  }

  return {
    fixedCount: fixedTaskIds.length,
    fixedTaskIds,
  };
}

