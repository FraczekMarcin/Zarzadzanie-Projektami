import {
  computeProgressMap,
  type ProgressOptions,
  type ProgressTaskLike,
} from './progress.js';

export const MAX_TASK_DEPTH = 6;

export interface TaskTreeNodeLike {
  id: string;
  projectId: string;
  parentId?: string | null;
}

export interface ReparentValidationResult {
  ok: boolean;
  error?: string;
}

/**
 * Zwraca głębokość zadania w hierarchii (korzeń = 1, bezpośrednie dziecko korzenia = 2, itd.).
 * Jeśli zadania nie ma na liście, zwraca 0. Chroni przed cyklami za pomocą zbioru odwiedzonych ID.
 */
export function getDepth(
  tasks: readonly TaskTreeNodeLike[],
  taskId: string
): number {
  if (!taskId || !Array.isArray(tasks)) return 0;
  const byId = new Map<string, TaskTreeNodeLike>();
  for (const t of tasks) {
    if (t && t.id) {
      byId.set(t.id, t);
    }
  }

  const start = byId.get(taskId);
  if (!start) return 0;

  let depth = 1;
  const visited = new Set<string>([start.id]);
  let current: TaskTreeNodeLike | undefined = start;

  while (current && typeof current.parentId === 'string' && current.parentId.trim()) {
    const parentId = current.parentId.trim();
    if (visited.has(parentId)) {
      break;
    }
    const parent = byId.get(parentId);
    if (!parent || parent.projectId !== start.projectId) {
      break;
    }
    visited.add(parentId);
    depth += 1;
    current = parent;
  }

  return depth;
}

/**
 * Zwraca maksymalną wysokość poddrzewa zakorzenionego w `taskId` (liść = 1).
 */
export function getSubtreeHeight(
  tasks: readonly TaskTreeNodeLike[],
  taskId: string
): number {
  if (!taskId || !Array.isArray(tasks)) return 0;
  const byId = new Map<string, TaskTreeNodeLike>();
  const childrenByParent = new Map<string, string[]>();

  for (const t of tasks) {
    if (!t || !t.id) continue;
    byId.set(t.id, t);
  }

  const root = byId.get(taskId);
  if (!root) return 0;

  for (const t of tasks) {
    if (!t || !t.id || t.projectId !== root.projectId) continue;
    if (typeof t.parentId === 'string' && t.parentId.trim()) {
      const pid = t.parentId.trim();
      const arr = childrenByParent.get(pid) || [];
      arr.push(t.id);
      childrenByParent.set(pid, arr);
    }
  }

  const visited = new Set<string>([taskId]);
  const measure = (id: string): number => {
    const children = childrenByParent.get(id) || [];
    let maxChildHeight = 0;
    for (const cid of children) {
      if (visited.has(cid)) continue;
      visited.add(cid);
      const h = measure(cid);
      if (h > maxChildHeight) maxChildHeight = h;
    }
    return 1 + maxChildHeight;
  };

  return measure(taskId);
}

/**
 * Sprawdza, czy zadanie `taskId` (lub nowe zadanie, gdy `taskId` to null) może otrzymać wskazane `newParentId`:
 * - pusty ciąg lub null usuwa parentId (dozwolone)
 * - parentId musi wskazywać istniejące zadanie z tego samego projektu
 * - parentId nie może wskazywać samego siebie ani potomka `taskId` (cykl)
 * - wynikowa głębokość hierarchii (z uwzględnieniem poddrzewa pod `taskId`) nie przekracza MAX_TASK_DEPTH (6)
 */
export function canReparent(
  tasks: readonly TaskTreeNodeLike[],
  taskId: string | null | undefined,
  newParentId: unknown,
  targetProjectId?: string
): ReparentValidationResult {
  if (newParentId === undefined || newParentId === null || newParentId === '') {
    return { ok: true };
  }

  if (typeof newParentId !== 'string') {
    return {
      ok: false,
      error: 'Nieprawidłowy identyfikator zadania nadrzędnego (parentId).',
    };
  }

  const trimmedParentId = newParentId.trim();
  if (!trimmedParentId) {
    return { ok: true };
  }

  if (taskId && trimmedParentId === taskId) {
    return {
      ok: false,
      error: 'Zadanie nie może być swoim własnym zadaniem nadrzędnym (parentId).',
    };
  }

  const byId = new Map<string, TaskTreeNodeLike>();
  for (const t of tasks || []) {
    if (t && t.id) {
      byId.set(t.id, t);
    }
  }

  const existingTask = taskId ? byId.get(taskId) : undefined;
  const parentTask = byId.get(trimmedParentId);
  if (!parentTask) {
    return {
      ok: false,
      error: `Zadanie nadrzędne o ID "${trimmedParentId}" nie istnieje.`,
    };
  }

  const effectiveProjectId = targetProjectId ?? existingTask?.projectId;
  if (effectiveProjectId && parentTask.projectId !== effectiveProjectId) {
    return {
      ok: false,
      error: 'Zadanie nadrzędne (parentId) musi należeć do tego samego projektu.',
    };
  }

  // Wykryj cykl: wędrujemy w górę od parentTask i sprawdzamy, czy trafimy na taskId
  if (taskId) {
    const visited = new Set<string>();
    let curr: TaskTreeNodeLike | undefined = parentTask;
    while (curr) {
      if (curr.id === taskId) {
        return {
          ok: false,
          error: 'Nie można ustawić zadania podrzędnego jako zadania nadrzędnego (wykryto cykl w hierarchii).',
        };
      }
      if (visited.has(curr.id)) {
        break;
      }
      visited.add(curr.id);
      if (typeof curr.parentId === 'string' && curr.parentId.trim()) {
        const nextParent = byId.get(curr.parentId.trim());
        if (!nextParent || (effectiveProjectId && nextParent.projectId !== effectiveProjectId)) {
          break;
        }
        curr = nextParent;
      } else {
        curr = undefined;
      }
    }
  }

  const parentDepth = getDepth(tasks, trimmedParentId);
  const subtreeHeight = existingTask ? getSubtreeHeight(tasks, existingTask.id) : 1;
  if (parentDepth + subtreeHeight > MAX_TASK_DEPTH) {
    return {
      ok: false,
      error: `Przekroczono maksymalną głębokość hierarchii zadań (${MAX_TASK_DEPTH}).`,
    };
  }

  return { ok: true };
}

export interface ReconcileReparentResult<
  T extends TaskTreeNodeLike & ProgressTaskLike & { status?: string; progress?: number; updatedAt?: string }
> {
  tasks: T[];
  changedStatusParentIds: string[];
  changedProgressTaskIds: string[];
}

function collectAncestorChain<T extends TaskTreeNodeLike>(
  byId: ReadonlyMap<string, T>,
  startParentId: string | null | undefined,
  projectId: string,
  excludedId?: string
): string[] {
  const result: string[] = [];
  const visited = new Set<string>();
  if (excludedId) visited.add(excludedId);

  let currId = typeof startParentId === 'string' ? startParentId.trim() : '';
  while (currId && !visited.has(currId)) {
    visited.add(currId);
    const parent = byId.get(currId);
    if (!parent || parent.projectId !== projectId) break;
    result.push(currId);
    currId = typeof parent.parentId === 'string' ? parent.parentId.trim() : '';
  }
  return result;
}

/**
 * Po przeniesieniu zadania między rodzicami (bez zmiany dat i zależności):
 * 1) sprawdza łańcuchy przodków starego i nowego rodzica od najgłębszych węzłów w górę
 *    i stosuje regułę „wszystkie nieanulowane podzadania ukończone” w obie strony:
 *    - wszystkie done -> parent.status = 'done'
 *    - któreś nie-done, a parent był 'done' -> parent.status = 'in_progress'
 * 2) przelicza postęp projektu za pomocą computeProgressMap.
 */
export function reconcileParentCompletionOnReparent<
  T extends TaskTreeNodeLike & ProgressTaskLike & { status?: string; progress?: number; updatedAt?: string }
>(
  tasks: readonly T[],
  options: {
    movedTaskId: string;
    oldParentId?: string | null;
    newParentId?: string | null;
    projectId: string;
    progressOptions?: ProgressOptions;
    nowIso?: string;
  }
): ReconcileReparentResult<T> {
  const {
    movedTaskId,
    oldParentId,
    newParentId,
    projectId,
    progressOptions = {},
    nowIso = new Date().toISOString(),
  } = options;

  const working = tasks.map((t) => ({ ...t }));
  const byId = new Map<string, T>();
  for (const t of working) {
    if (t && t.id) byId.set(t.id, t);
  }

  const oldAncestors = collectAncestorChain(byId, oldParentId, projectId, movedTaskId);
  const newAncestors = collectAncestorChain(byId, newParentId, projectId, movedTaskId);
  const allAncestorIds = Array.from(new Set([...oldAncestors, ...newAncestors]));

  // Sortujemy malejąco po głębokości, aby dzieci przeliczyć przed ich rodzicami
  allAncestorIds.sort((a, b) => getDepth(working, b) - getDepth(working, a));

  const changedStatusParentIds: string[] = [];

  for (const pid of allAncestorIds) {
    const idx = working.findIndex((t) => t.id === pid && t.projectId === projectId);
    if (idx === -1) continue;
    const parent = working[idx];
    if (!parent || (parent.status as string) === 'cancelled') continue;

    const directSubtasks = working.filter(
      (t) =>
        t.projectId === projectId &&
        typeof t.parentId === 'string' &&
        t.parentId.trim() === pid &&
        (t.status as string) !== 'cancelled'
    );

    if (directSubtasks.length === 0) {
      continue;
    }

    const allDone = directSubtasks.every((s) => s.status === 'done');
    if (allDone && parent.status !== 'done') {
      working[idx] = {
        ...parent,
        status: 'done',
        updatedAt: nowIso,
      };
      changedStatusParentIds.push(pid);
    } else if (!allDone && parent.status === 'done') {
      working[idx] = {
        ...parent,
        status: 'in_progress',
        updatedAt: nowIso,
      };
      changedStatusParentIds.push(pid);
    }
  }

  const projectTasks = working.filter((t) => t.projectId === projectId);
  const progressMap = computeProgressMap(projectTasks, progressOptions);
  const changedProgressTaskIds: string[] = [];

  for (let i = 0; i < working.length; i += 1) {
    const task = working[i];
    if (!task || task.projectId !== projectId || (task.status as string) === 'cancelled') continue;
    const computed = progressMap.get(task.id);
    if (computed !== undefined && task.progress !== computed) {
      working[i] = {
        ...task,
        progress: computed,
      };
      changedProgressTaskIds.push(task.id);
    }
  }

  return {
    tasks: working,
    changedStatusParentIds,
    changedProgressTaskIds,
  };
}

