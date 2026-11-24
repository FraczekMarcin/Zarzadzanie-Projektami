import type {
  Priority,
  ProjectTemplate,
  TemplateAssigneeRole,
  TemplateCategory,
  TemplateTaskBlueprint,
} from '../types/index.js';
import {
  MAX_TEMPLATE_DAYS,
  MAX_TEMPLATE_HIERARCHY_DEPTH,
  MAX_TEMPLATE_TASKS,
} from './templateValidation.js';

export interface TemplateEditorDraft {
  name: string;
  category: TemplateCategory;
  description: string;
  defaultPriority: Priority;
  defaultDurationDays: number;
  durationManualOverride: boolean;
  defaultBudget: string;
  tasks: TemplateTaskBlueprint[];
}

export interface TemplateEditorHistory {
  past: TemplateEditorDraft[];
  present: TemplateEditorDraft;
  future: TemplateEditorDraft[];
}

export interface OrderedTemplateTaskNode {
  task: TemplateTaskBlueprint;
  depth: number;
  treeIndex: number;
  parentTitle?: string;
  hasChildren: boolean;
  descendantKeys: string[];
}

export interface TemplateWarningItem {
  code: 'empty_template' | 'missing_title' | 'offset_out_of_bounds';
  taskKey?: string;
  message: string;
}

export interface TemplateEditorSummary {
  taskCount: number;
  totalDurationDays: number;
  totalEstimatedHours: number;
  warnings: TemplateWarningItem[];
}

export function cloneDraft(draft: TemplateEditorDraft): TemplateEditorDraft {
  return {
    ...draft,
    tasks: draft.tasks.map((t) => ({
      ...t,
      ...(t.tags ? { tags: [...t.tags] } : {}),
      ...(t.blockerKeys ? { blockerKeys: [...t.blockerKeys] } : {}),
    })),
  };
}

export function computeTemplateDurationFromTasks(
  tasks: readonly TemplateTaskBlueprint[]
): number {
  if (!Array.isArray(tasks) || tasks.length === 0) return 1;
  let maxSpan = 1;
  for (const t of tasks) {
    const offset = Math.max(0, Math.round(t?.offsetDays || 0));
    const dur = Math.max(1, Math.round(t?.durationDays || 1));
    const end = offset + dur;
    if (end > maxSpan) maxSpan = end;
  }
  return Math.min(MAX_TEMPLATE_DAYS, Math.max(1, maxSpan));
}

export function createDraftFromTemplate(template: ProjectTemplate): TemplateEditorDraft {
  const tasks = (template.tasks || []).map((t) => ({
    ...t,
    ...(t.tags ? { tags: [...t.tags] } : {}),
    ...(t.blockerKeys ? { blockerKeys: [...t.blockerKeys] } : {}),
  }));
  const computedDur = computeTemplateDurationFromTasks(tasks);
  const templateDur =
    typeof template.defaultDurationDays === 'number' && template.defaultDurationDays >= 1
      ? Math.min(MAX_TEMPLATE_DAYS, Math.round(template.defaultDurationDays))
      : computedDur;

  return {
    name: template.name || '',
    category: template.category || 'ogolne',
    description: template.description || '',
    defaultPriority: template.defaultPriority || 'normal',
    defaultDurationDays: templateDur,
    durationManualOverride: tasks.length > 0 ? templateDur !== computedDur : true,
    defaultBudget: template.defaultBudget || '',
    tasks,
  };
}

export function createEditorHistory(initial: TemplateEditorDraft): TemplateEditorHistory {
  return {
    past: [],
    present: cloneDraft(initial),
    future: [],
  };
}

export function pushEditorState(
  history: TemplateEditorHistory,
  nextDraft: TemplateEditorDraft,
  maxPast = 50
): TemplateEditorHistory {
  const nextPresent = cloneDraft(nextDraft);
  const syncedPresent = nextPresent.durationManualOverride
    ? nextPresent
    : {
        ...nextPresent,
        defaultDurationDays:
          nextPresent.tasks.length > 0
            ? computeTemplateDurationFromTasks(nextPresent.tasks)
            : nextPresent.defaultDurationDays,
      };

  const nextPast = [...history.past, cloneDraft(history.present)];
  if (nextPast.length > maxPast) {
    nextPast.splice(0, nextPast.length - maxPast);
  }
  return {
    past: nextPast,
    present: syncedPresent,
    future: [],
  };
}

export function undoEditorState(history: TemplateEditorHistory): TemplateEditorHistory {
  if (history.past.length === 0) return history;
  const previous = history.past[history.past.length - 1];
  const nextPast = history.past.slice(0, -1);
  return {
    past: nextPast,
    present: cloneDraft(previous),
    future: [cloneDraft(history.present), ...history.future],
  };
}

export function redoEditorState(history: TemplateEditorHistory): TemplateEditorHistory {
  if (history.future.length === 0) return history;
  const next = history.future[0];
  const nextFuture = history.future.slice(1);
  return {
    past: [...history.past, cloneDraft(history.present)],
    present: cloneDraft(next),
    future: nextFuture,
  };
}

export function generateUniqueTaskKey(
  tasks: readonly TemplateTaskBlueprint[],
  prefix = 'etap'
): string {
  const used = new Set(tasks.map((t) => t.key));
  let idx = tasks.length + 1;
  while (used.has(`${prefix}-${idx}`)) {
    idx += 1;
  }
  return `${prefix}-${idx}`;
}

export function getTemplateTaskDepth(
  tasks: readonly TemplateTaskBlueprint[],
  key: string
): number {
  const byKey = new Map<string, TemplateTaskBlueprint>();
  for (const t of tasks) {
    if (t?.key) byKey.set(t.key, t);
  }
  let curr = byKey.get(key);
  if (!curr) return 0;

  let depth = 1;
  const visited = new Set<string>([key]);
  while (curr?.parentKey && !visited.has(curr.parentKey)) {
    visited.add(curr.parentKey);
    const parent = byKey.get(curr.parentKey);
    if (!parent) break;
    depth += 1;
    curr = parent;
  }
  return depth;
}

export function getTemplateSubtreeHeight(
  tasks: readonly TemplateTaskBlueprint[],
  key: string
): number {
  const childrenMap = new Map<string, string[]>();
  let exists = false;
  for (const t of tasks) {
    if (!t?.key) continue;
    if (t.key === key) exists = true;
    if (t.parentKey) {
      const list = childrenMap.get(t.parentKey) || [];
      list.push(t.key);
      childrenMap.set(t.parentKey, list);
    }
  }
  if (!exists) return 0;

  const visited = new Set<string>([key]);
  const measure = (k: string): number => {
    let maxChild = 0;
    for (const childKey of childrenMap.get(k) || []) {
      if (visited.has(childKey)) continue;
      visited.add(childKey);
      const h = measure(childKey);
      if (h > maxChild) maxChild = h;
    }
    return 1 + maxChild;
  };
  return measure(key);
}

export function collectTemplateSubtreeKeys(
  tasks: readonly TemplateTaskBlueprint[],
  rootKey: string
): string[] {
  const childrenMap = new Map<string, string[]>();
  for (const t of tasks) {
    if (!t?.key || !t.parentKey) continue;
    const list = childrenMap.get(t.parentKey) || [];
    list.push(t.key);
    childrenMap.set(t.parentKey, list);
  }

  const result: string[] = [];
  const visited = new Set<string>();
  const walk = (k: string) => {
    if (visited.has(k)) return;
    visited.add(k);
    result.push(k);
    for (const childKey of childrenMap.get(k) || []) {
      walk(childKey);
    }
  };
  walk(rootKey);
  return result;
}

/**
 * Zwraca zadania szablonu w kolejności drzewa (rodzic -> dzieci DFS) wraz z głębokością i potomkami.
 */
export function buildTreeOrderedTasks(
  tasks: readonly TemplateTaskBlueprint[]
): OrderedTemplateTaskNode[] {
  const byKey = new Map<string, TemplateTaskBlueprint>();
  const childrenMap = new Map<string, TemplateTaskBlueprint[]>();

  for (const t of tasks) {
    if (t?.key) byKey.set(t.key, t);
  }

  const roots: TemplateTaskBlueprint[] = [];
  for (const t of tasks) {
    if (!t?.key) continue;
    if (t.parentKey && t.parentKey !== t.key && byKey.has(t.parentKey)) {
      const arr = childrenMap.get(t.parentKey) || [];
      arr.push(t);
      childrenMap.set(t.parentKey, arr);
    } else {
      roots.push(t);
    }
  }

  const ordered: OrderedTemplateTaskNode[] = [];
  const visited = new Set<string>();

  const walk = (node: TemplateTaskBlueprint, depth: number) => {
    if (visited.has(node.key)) return;
    visited.add(node.key);
    const children = childrenMap.get(node.key) || [];
    const descendants = collectTemplateSubtreeKeys(tasks, node.key).slice(1);
    const parent = node.parentKey ? byKey.get(node.parentKey) : undefined;
    ordered.push({
      task: node,
      depth: Math.min(depth, MAX_TEMPLATE_HIERARCHY_DEPTH - 1),
      treeIndex: ordered.length,
      parentTitle: parent?.title,
      hasChildren: children.length > 0,
      descendantKeys: descendants,
    });
    for (const ch of children) {
      walk(ch, depth + 1);
    }
  };

  for (const root of roots) {
    walk(root, 0);
  }

  // Dodaj ewentualne węzły z cyklu awaryjnie
  for (const t of tasks) {
    if (t?.key && !visited.has(t.key)) {
      walk(t, 0);
    }
  }

  return ordered;
}

export function canReparentTemplateTask(
  tasks: readonly TemplateTaskBlueprint[],
  taskKey: string,
  newParentKey: string | undefined
): { ok: true } | { ok: false; error: string } {
  if (!newParentKey) return { ok: true };
  if (newParentKey === taskKey) {
    return { ok: false, error: 'Zadanie nie może być swoim własnym zadaniem nadrzędnym.' };
  }

  const byKey = new Map<string, TemplateTaskBlueprint>();
  for (const t of tasks) {
    if (t?.key) byKey.set(t.key, t);
  }
  const targetParent = byKey.get(newParentKey);
  if (!targetParent) {
    return { ok: false, error: 'Wybrane zadanie nadrzędne nie istnieje.' };
  }

  // Wykryj cykl parentKey: podążaj w górę od targetParent
  const visited = new Set<string>();
  let curr: TemplateTaskBlueprint | undefined = targetParent;
  while (curr) {
    if (curr.key === taskKey) {
      return { ok: false, error: 'Nie można przenieść zadania pod własne podzadanie (cykl).' };
    }
    if (visited.has(curr.key)) break;
    visited.add(curr.key);
    curr = curr.parentKey ? byKey.get(curr.parentKey) : undefined;
  }

  const parentDepth = getTemplateTaskDepth(tasks, newParentKey);
  const subtreeHeight = getTemplateSubtreeHeight(tasks, taskKey);
  if (parentDepth + subtreeHeight > MAX_TEMPLATE_HIERARCHY_DEPTH) {
    return {
      ok: false,
      error: `Przekroczono maksymalną głębokość hierarchii zadań (${MAX_TEMPLATE_HIERARCHY_DEPTH}).`,
    };
  }

  return { ok: true };
}

/**
 * Sprawdza, czy dodanie `candidateBlockerKey` do `blockerKeys` zadania `targetKey` utworzy cykl.
 */
export function wouldCreateBlockerCycle(
  tasks: readonly TemplateTaskBlueprint[],
  targetKey: string,
  candidateBlockerKey: string
): boolean {
  if (!targetKey || !candidateBlockerKey || targetKey === candidateBlockerKey) {
    return true;
  }
  const byKey = new Map<string, TemplateTaskBlueprint>();
  for (const t of tasks) {
    if (t?.key) byKey.set(t.key, t);
  }
  if (!byKey.has(candidateBlockerKey)) return true;

  // Cykl powstaje wtedy i tylko wtedy, gdy z candidateBlockerKey da się dojść po blockerKeys do targetKey
  const visited = new Set<string>();
  const stack: string[] = [candidateBlockerKey];
  while (stack.length > 0) {
    const currKey = stack.pop()!;
    if (currKey === targetKey) return true;
    if (visited.has(currKey)) continue;
    visited.add(currKey);
    const node = byKey.get(currKey);
    for (const bk of node?.blockerKeys || []) {
      if (!visited.has(bk)) {
        stack.push(bk);
      }
    }
  }
  return false;
}

/**
 * Zwraca listę kandydatów na blokadę (`blockerKeys`):
 * wcześniejsze zadania w kolejności drzewa, które nie powodują cyklu (oraz już przypisane blokady).
 */
export function getEligibleBlockerCandidates(
  tasks: readonly TemplateTaskBlueprint[],
  targetKey: string
): TemplateTaskBlueprint[] {
  const ordered = buildTreeOrderedTasks(tasks);
  const targetIdx = ordered.findIndex((n) => n.task.key === targetKey);
  const targetTask = targetIdx >= 0 ? ordered[targetIdx].task : undefined;
  const existingSet = new Set(targetTask?.blockerKeys || []);

  const result: TemplateTaskBlueprint[] = [];
  for (let i = 0; i < ordered.length; i += 1) {
    const candidate = ordered[i].task;
    if (candidate.key === targetKey) continue;
    const isEarlier = targetIdx === -1 || i < targetIdx;
    if (!isEarlier && !existingSet.has(candidate.key)) continue;
    if (wouldCreateBlockerCycle(tasks, targetKey, candidate.key) && !existingSet.has(candidate.key)) {
      continue;
    }
    result.push(candidate);
  }
  return result;
}

export function getEligibleStartAfterPredecessors(
  tasks: readonly TemplateTaskBlueprint[],
  targetKey: string
): TemplateTaskBlueprint[] {
  const ordered = buildTreeOrderedTasks(tasks);
  const targetIdx = ordered.findIndex((n) => n.task.key === targetKey);
  return ordered
    .filter((node, i) => {
      if (node.task.key === targetKey) return false;
      if (targetIdx !== -1 && i > targetIdx) {
        // Preferuj wcześniejsze, ale pozwól na każde niecykliczne jeśli nie ma pętli
        return !wouldCreateBlockerCycle(tasks, targetKey, node.task.key);
      }
      return !wouldCreateBlockerCycle(tasks, targetKey, node.task.key);
    })
    .map((n) => n.task);
}

/**
 * Pomocnik "Zacznij po zakończeniu: <zadanie>":
 * ustawia offsetDays = pred.offsetDays + pred.durationDays oraz dodaje klucz poprzednika do blockerKeys.
 */
export function applyStartAfterPredecessor(
  tasks: readonly TemplateTaskBlueprint[],
  targetKey: string,
  predecessorKey: string
): TemplateTaskBlueprint[] {
  if (!predecessorKey || targetKey === predecessorKey) return [...tasks];
  const pred = tasks.find((t) => t.key === predecessorKey);
  if (!pred) return [...tasks];
  if (wouldCreateBlockerCycle(tasks, targetKey, predecessorKey)) {
    return [...tasks];
  }

  const nextOffset = Math.min(
    MAX_TEMPLATE_DAYS,
    Math.max(0, Math.round(pred.offsetDays || 0) + Math.max(1, Math.round(pred.durationDays || 1)))
  );

  return tasks.map((t) => {
    if (t.key !== targetKey) return t;
    const nextBlockers = Array.from(new Set([...(t.blockerKeys || []), predecessorKey]));
    return {
      ...t,
      offsetDays: nextOffset,
      blockerKeys: nextBlockers,
    };
  });
}

function normalizeTreeOrder(tasks: readonly TemplateTaskBlueprint[]): TemplateTaskBlueprint[] {
  return buildTreeOrderedTasks(tasks).map((n) => n.task);
}

export function addTemplateTask(
  tasks: readonly TemplateTaskBlueprint[],
  options: { parentKey?: string; afterKey?: string; title?: string } = {}
): { ok: true; tasks: TemplateTaskBlueprint[]; createdKey: string } | { ok: false; error: string } {
  if (tasks.length >= MAX_TEMPLATE_TASKS) {
    return { ok: false, error: `Szablon może zawierać maksymalnie ${MAX_TEMPLATE_TASKS} zadań.` };
  }

  if (options.parentKey) {
    const parentDepth = getTemplateTaskDepth(tasks, options.parentKey);
    if (parentDepth === 0) {
      return { ok: false, error: 'Wybrane zadanie nadrzędne nie istnieje.' };
    }
    if (parentDepth + 1 > MAX_TEMPLATE_HIERARCHY_DEPTH) {
      return {
        ok: false,
        error: `Przekroczono maksymalną głębokość hierarchii zadań (${MAX_TEMPLATE_HIERARCHY_DEPTH}).`,
      };
    }
  }

  const parentTask = options.parentKey ? tasks.find((t) => t.key === options.parentKey) : undefined;
  const newKey = generateUniqueTaskKey(tasks, 'etap');
  const newTask: TemplateTaskBlueprint = {
    key: newKey,
    title: options.title ?? `Nowe zadanie ${tasks.length + 1}`,
    description: '',
    type: 'task',
    priority: 'normal',
    durationDays: 5,
    offsetDays: parentTask ? Math.max(0, parentTask.offsetDays || 0) : 0,
    ...(options.parentKey ? { parentKey: options.parentKey } : {}),
    assigneeRole: 'none',
  };

  const ordered = normalizeTreeOrder(tasks);
  if (options.parentKey) {
    const subtreeKeys = collectTemplateSubtreeKeys(ordered, options.parentKey);
    const lastKey = subtreeKeys[subtreeKeys.length - 1];
    const insertIdx = ordered.findIndex((t) => t.key === lastKey);
    const next = [...ordered];
    next.splice(insertIdx + 1, 0, newTask);
    return { ok: true, tasks: normalizeTreeOrder(next), createdKey: newKey };
  }

  if (options.afterKey) {
    const afterSubtree = collectTemplateSubtreeKeys(ordered, options.afterKey);
    const lastKey = afterSubtree[afterSubtree.length - 1];
    const insertIdx = ordered.findIndex((t) => t.key === lastKey);
    const next = [...ordered];
    next.splice(insertIdx + 1, 0, newTask);
    return { ok: true, tasks: normalizeTreeOrder(next), createdKey: newKey };
  }

  return { ok: true, tasks: normalizeTreeOrder([...ordered, newTask]), createdKey: newKey };
}

export function duplicateTemplateTask(
  tasks: readonly TemplateTaskBlueprint[],
  taskKey: string
): { ok: true; tasks: TemplateTaskBlueprint[]; createdKey: string } | { ok: false; error: string } {
  if (tasks.length >= MAX_TEMPLATE_TASKS) {
    return { ok: false, error: `Szablon może zawierać maksymalnie ${MAX_TEMPLATE_TASKS} zadań.` };
  }

  const ordered = normalizeTreeOrder(tasks);
  const sourceIdx = ordered.findIndex((t) => t.key === taskKey);
  if (sourceIdx === -1) {
    return { ok: false, error: 'Zadanie do duplikacji nie istnieje.' };
  }

  const source = ordered[sourceIdx];
  const copyKey = generateUniqueTaskKey(ordered, 'etap');
  const copyTitle = `${source.title} (kopia)`.slice(0, 200);
  const copyTask: TemplateTaskBlueprint = {
    ...source,
    key: copyKey,
    title: copyTitle,
    ...(source.tags ? { tags: [...source.tags] } : {}),
    ...(source.blockerKeys ? { blockerKeys: [...source.blockerKeys] } : {}),
  };

  const subtreeKeys = collectTemplateSubtreeKeys(ordered, taskKey);
  const lastKey = subtreeKeys[subtreeKeys.length - 1];
  const insertAfterIdx = ordered.findIndex((t) => t.key === lastKey);

  const next = [...ordered];
  next.splice(insertAfterIdx + 1, 0, copyTask);
  return { ok: true, tasks: normalizeTreeOrder(next), createdKey: copyKey };
}

export function deleteTemplateTaskSubtree(
  tasks: readonly TemplateTaskBlueprint[],
  taskKey: string
): TemplateTaskBlueprint[] {
  const toRemove = new Set(collectTemplateSubtreeKeys(tasks, taskKey));
  return tasks
    .filter((t) => !toRemove.has(t.key))
    .map((t) => {
      const cleanedBlockers = (t.blockerKeys || []).filter((bk) => !toRemove.has(bk));
      if (cleanedBlockers.length === (t.blockerKeys || []).length) {
        return t;
      }
      const next = { ...t };
      if (cleanedBlockers.length > 0) {
        next.blockerKeys = cleanedBlockers;
      } else {
        delete next.blockerKeys;
      }
      return next;
    });
}

export function moveTemplateTaskSibling(
  tasks: readonly TemplateTaskBlueprint[],
  taskKey: string,
  direction: 'up' | 'down'
): TemplateTaskBlueprint[] {
  const ordered = normalizeTreeOrder(tasks);
  const target = ordered.find((t) => t.key === taskKey);
  if (!target) return ordered;

  const targetParent = target.parentKey || '';
  const siblings = ordered.filter((t) => (t.parentKey || '') === targetParent);
  const siblingIdx = siblings.findIndex((t) => t.key === taskKey);
  if (siblingIdx === -1) return ordered;

  const swapWithIdx = direction === 'up' ? siblingIdx - 1 : siblingIdx + 1;
  if (swapWithIdx < 0 || swapWithIdx >= siblings.length) return ordered;

  const siblingKeyA = siblings[Math.min(siblingIdx, swapWithIdx)].key;
  const siblingKeyB = siblings[Math.max(siblingIdx, swapWithIdx)].key;

  const subtreeA = new Set(collectTemplateSubtreeKeys(ordered, siblingKeyA));
  const subtreeB = new Set(collectTemplateSubtreeKeys(ordered, siblingKeyB));

  const blockA = ordered.filter((t) => subtreeA.has(t.key));
  const blockB = ordered.filter((t) => subtreeB.has(t.key));

  const firstIdxA = ordered.findIndex((t) => subtreeA.has(t.key));
  const lastIdxB = ordered.reduce((acc, t, idx) => (subtreeB.has(t.key) ? idx : acc), -1);

  return [
    ...ordered.slice(0, firstIdxA),
    ...blockB,
    ...blockA,
    ...ordered.slice(lastIdxB + 1),
  ];
}

export function indentTemplateTask(
  tasks: readonly TemplateTaskBlueprint[],
  taskKey: string
): { ok: true; tasks: TemplateTaskBlueprint[] } | { ok: false; error: string } {
  const ordered = normalizeTreeOrder(tasks);
  const target = ordered.find((t) => t.key === taskKey);
  if (!target) return { ok: false, error: 'Zadanie nie istnieje.' };

  const targetParent = target.parentKey || '';
  const siblings = ordered.filter((t) => (t.parentKey || '') === targetParent);
  const siblingIdx = siblings.findIndex((t) => t.key === taskKey);
  if (siblingIdx <= 0) {
    return { ok: false, error: 'Brak wcześniejszego zadania na tym samym poziomie do wcięcia.' };
  }

  const newParent = siblings[siblingIdx - 1];
  const check = canReparentTemplateTask(ordered, taskKey, newParent.key);
  if (!check.ok) return check;

  const updated = ordered.map((t) =>
    t.key === taskKey ? { ...t, parentKey: newParent.key } : t
  );
  return { ok: true, tasks: normalizeTreeOrder(updated) };
}

export function outdentTemplateTask(
  tasks: readonly TemplateTaskBlueprint[],
  taskKey: string
): { ok: true; tasks: TemplateTaskBlueprint[] } | { ok: false; error: string } {
  const ordered = normalizeTreeOrder(tasks);
  const target = ordered.find((t) => t.key === taskKey);
  if (!target || !target.parentKey) {
    return { ok: false, error: 'Zadanie jest już na poziomie głównym.' };
  }

  const oldParent = ordered.find((t) => t.key === target.parentKey);
  const newParentKey = oldParent?.parentKey || undefined;

  // Wytnij przenoszone poddrzewo i wstaw bezpośrednio za poddrzewem dotychczasowego rodzica
  const movedKeys = new Set(collectTemplateSubtreeKeys(ordered, taskKey));
  const movedBlock = ordered
    .filter((t) => movedKeys.has(t.key))
    .map((t) => {
      if (t.key !== taskKey) return t;
      const next = { ...t };
      if (newParentKey) next.parentKey = newParentKey;
      else delete next.parentKey;
      return next;
    });

  const remaining = ordered.filter((t) => !movedKeys.has(t.key));
  if (oldParent) {
    const parentSubtree = collectTemplateSubtreeKeys(remaining, oldParent.key);
    const lastParentKey = parentSubtree[parentSubtree.length - 1];
    const insertIdx = remaining.findIndex((t) => t.key === lastParentKey);
    if (insertIdx !== -1) {
      remaining.splice(insertIdx + 1, 0, ...movedBlock);
      return { ok: true, tasks: normalizeTreeOrder(remaining) };
    }
  }

  return { ok: true, tasks: normalizeTreeOrder([...remaining, ...movedBlock]) };
}

export function reparentTemplateTask(
  tasks: readonly TemplateTaskBlueprint[],
  taskKey: string,
  newParentKey: string | undefined
): { ok: true; tasks: TemplateTaskBlueprint[] } | { ok: false; error: string } {
  const check = canReparentTemplateTask(tasks, taskKey, newParentKey);
  if (!check.ok) return check;

  const updated = tasks.map((t) => {
    if (t.key !== taskKey) return t;
    const next = { ...t };
    if (newParentKey) next.parentKey = newParentKey;
    else delete next.parentKey;
    return next;
  });

  return { ok: true, tasks: normalizeTreeOrder(updated) };
}

export function computeTemplateWarningsAndStats(
  draft: Pick<TemplateEditorDraft, 'defaultDurationDays' | 'tasks'>
): TemplateEditorSummary {
  const tasks = Array.isArray(draft.tasks) ? draft.tasks : [];
  const warnings: TemplateWarningItem[] = [];

  if (tasks.length === 0) {
    warnings.push({
      code: 'empty_template',
      message: 'Szablon nie zawiera żadnych zadań (pusty szablon).',
    });
  }

  let totalHours = 0;
  let maxSpan = 0;
  const projectDuration = Math.max(1, Math.round(draft.defaultDurationDays || 1));

  for (const t of tasks) {
    if (!t.title || !t.title.trim()) {
      warnings.push({
        code: 'missing_title',
        taskKey: t.key,
        message: `Zadanie "${t.key}" nie posiada tytułu.`,
      });
    }

    const offset = Math.max(0, Math.round(t.offsetDays || 0));
    const dur = Math.max(1, Math.round(t.durationDays || 1));
    const end = offset + dur;
    if (end > maxSpan) maxSpan = end;

    if (offset >= projectDuration || end > projectDuration) {
      warnings.push({
        code: 'offset_out_of_bounds',
        taskKey: t.key,
        message: `Zadanie "${t.title?.trim() || t.key}" wykracza poza czas trwania szablonu (${offset} + ${dur} > ${projectDuration} dni).`,
      });
    }

    if (typeof t.estimatedHours === 'number' && Number.isFinite(t.estimatedHours) && t.estimatedHours >= 0) {
      totalHours += t.estimatedHours;
    }
  }

  return {
    taskCount: tasks.length,
    totalDurationDays: tasks.length > 0 ? Math.max(1, maxSpan) : projectDuration,
    totalEstimatedHours: Math.round(totalHours * 100) / 100,
    warnings,
  };
}

export const ASSIGNEE_ROLE_LABELS: Record<TemplateAssigneeRole, string> = {
  owner: 'Właściciel projektu',
  reporter: 'Zgłaszający (twórca)',
  none: 'Brak przypisania',
};
