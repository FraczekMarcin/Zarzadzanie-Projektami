import type {
  Priority,
  Project,
  ProjectTemplate,
  ProjectTemplateSummary,
  Task,
  TemplateAssigneeRole,
  TemplateCategory,
  TemplateTaskBlueprint,
} from '../types';
import { hasForbiddenKeys } from './access.js';
import { MAX_TASK_DEPTH } from './taskTree.js';

export const MAX_CUSTOM_TEMPLATES = 50;
export const MAX_TEMPLATE_TASKS = 200;
export const MAX_TEMPLATE_HIERARCHY_DEPTH = MAX_TASK_DEPTH;
export const MAX_TEMPLATE_DAYS = 3650;

export const TEMPLATE_LIMITS = {
  name: 200,
  description: 2000,
  budget: 100,
  key: 64,
  taskTitle: 200,
  taskDescription: 2000,
  taskType: 50,
  tagsMaxCount: 30,
  tagLength: 50,
} as const;

export const TEMPLATE_CATEGORIES: readonly TemplateCategory[] = [
  'kubaturowe',
  'mieszkaniowe',
  'przemyslowe',
  'infrastruktura',
  'przebudowa',
  'ogolne',
] as const;

export const TEMPLATE_CATEGORY_LABELS: Record<TemplateCategory, string> = {
  kubaturowe: 'Obiekty kubaturowe',
  mieszkaniowe: 'Budownictwo mieszkaniowe',
  przemyslowe: 'Przemysł i hale',
  infrastruktura: 'Infrastruktura i sieci',
  przebudowa: 'Przebudowy i modernizacje',
  ogolne: 'Ogólne',
};

export const TEMPLATE_PRIORITIES: readonly Priority[] = [
  'low',
  'normal',
  'high',
  'critical',
] as const;

export const TEMPLATE_ASSIGNEE_ROLES: readonly TemplateAssigneeRole[] = [
  'owner',
  'reporter',
  'none',
] as const;

export interface LegacyTemplateTaskLike {
  key?: string;
  title?: string;
  description?: string;
  type?: string;
  priority?: Priority;
  durationDays?: number;
  offsetDays?: number;
  isOfficialDeadline?: boolean;
  estimatedHours?: number;
  tags?: string[];
  parentKey?: string;
  blockerKeys?: string[];
  blockerIndices?: number[];
  assigneeRole?: TemplateAssigneeRole;
  [k: string]: unknown;
}

export interface LegacyTemplateLike {
  id?: string;
  name?: string;
  category?: TemplateCategory | string;
  description?: string;
  defaultDurationDays?: number;
  defaultPriority?: Priority | string;
  defaultBudget?: string;
  tasks?: LegacyTemplateTaskLike[];
  isCustom?: boolean;
  builtIn?: boolean;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  sourceProjectId?: string;
}

function isValidCategory(val: unknown): val is TemplateCategory {
  return typeof val === 'string' && (TEMPLATE_CATEGORIES as readonly string[]).includes(val);
}

function isValidPriority(val: unknown): val is Priority {
  return typeof val === 'string' && (TEMPLATE_PRIORITIES as readonly string[]).includes(val);
}

function isValidAssigneeRole(val: unknown): val is TemplateAssigneeRole {
  return typeof val === 'string' && (TEMPLATE_ASSIGNEE_ROLES as readonly string[]).includes(val);
}

function sanitizeTags(rawTags: unknown): string[] {
  if (!Array.isArray(rawTags)) return [];
  const res: string[] = [];
  for (const tag of rawTags) {
    if (typeof tag !== 'string') continue;
    const trimmed = tag.trim().slice(0, TEMPLATE_LIMITS.tagLength);
    if (trimmed) {
      res.push(trimmed);
    }
    if (res.length >= TEMPLATE_LIMITS.tagsMaxCount) break;
  }
  return res;
}

/**
 * Konwertuje zadania starego formatu szablonu (`blockerIndices`) na stabilne klucze (`key` i `blockerKeys`).
 */
export function migrateTemplateTasksFromIndices(
  rawTasks: readonly LegacyTemplateTaskLike[] | null | undefined
): TemplateTaskBlueprint[] {
  if (!Array.isArray(rawTasks)) return [];

  const usedKeys = new Set<string>();
  const indexToKey = new Map<number, string>();

  const keys = rawTasks.map((task, idx) => {
    const rawKey = typeof task?.key === 'string' ? task.key.trim().slice(0, TEMPLATE_LIMITS.key) : '';
    let candidate = rawKey || `t-${idx + 1}`;
    if (usedKeys.has(candidate)) {
      let suffix = 2;
      while (usedKeys.has(`${candidate}-${suffix}`)) {
        suffix += 1;
      }
      candidate = `${candidate.slice(0, TEMPLATE_LIMITS.key - 8)}-${suffix}`;
    }
    usedKeys.add(candidate);
    indexToKey.set(idx, candidate);
    return candidate;
  });

  return rawTasks.map((task, idx) => {
    const key = keys[idx];
    const blockerSet = new Set<string>();

    if (Array.isArray(task?.blockerKeys)) {
      for (const bk of task.blockerKeys) {
        if (typeof bk === 'string') {
          const trimmed = bk.trim();
          if (trimmed && trimmed !== key && usedKeys.has(trimmed)) {
            blockerSet.add(trimmed);
          }
        }
      }
    }

    if (Array.isArray(task?.blockerIndices)) {
      for (const bIdx of task.blockerIndices) {
        if (typeof bIdx === 'number' && Number.isInteger(bIdx)) {
          const mappedKey = indexToKey.get(bIdx);
          if (mappedKey && mappedKey !== key) {
            blockerSet.add(mappedKey);
          }
        }
      }
    }

    const rawParentKey =
      typeof task?.parentKey === 'string' ? task.parentKey.trim() : '';
    const parentKey =
      rawParentKey && rawParentKey !== key && usedKeys.has(rawParentKey)
        ? rawParentKey
        : undefined;

    const rawDuration =
      typeof task?.durationDays === 'number' && Number.isFinite(task.durationDays)
        ? Math.round(task.durationDays)
        : 1;
    const durationDays = Math.min(MAX_TEMPLATE_DAYS, Math.max(1, rawDuration));

    const rawOffset =
      typeof task?.offsetDays === 'number' && Number.isFinite(task.offsetDays)
        ? Math.round(task.offsetDays)
        : 0;
    const offsetDays = Math.min(MAX_TEMPLATE_DAYS, Math.max(0, rawOffset));

    const estimatedHours =
      typeof task?.estimatedHours === 'number' &&
      Number.isFinite(task.estimatedHours) &&
      task.estimatedHours >= 0
        ? Math.round(task.estimatedHours * 100) / 100
        : undefined;

    const blueprint: TemplateTaskBlueprint = {
      key,
      title: String(task?.title || `Etap ${idx + 1}`).trim().slice(0, TEMPLATE_LIMITS.taskTitle) || `Etap ${idx + 1}`,
      description: String(task?.description || '').trim().slice(0, TEMPLATE_LIMITS.taskDescription),
      type:
        typeof task?.type === 'string' && task.type.trim()
          ? task.type.trim().slice(0, TEMPLATE_LIMITS.taskType)
          : 'task',
      priority: isValidPriority(task?.priority) ? task.priority : 'normal',
      durationDays,
      offsetDays,
      ...(task?.isOfficialDeadline ? { isOfficialDeadline: true } : {}),
      ...(estimatedHours !== undefined ? { estimatedHours } : {}),
      ...(Array.isArray(task?.tags) ? { tags: sanitizeTags(task.tags) } : {}),
      ...(parentKey ? { parentKey } : {}),
      ...(blockerSet.size > 0 ? { blockerKeys: Array.from(blockerSet) } : {}),
      assigneeRole: isValidAssigneeRole(task?.assigneeRole) ? task.assigneeRole : 'none',
    };

    return blueprint;
  });
}

/**
 * Migruje cały obiekt szablonu (wbudowanego lub starszego z localStorage) do aktualnego modelu.
 */
export function migrateLegacyTemplate(
  raw: LegacyTemplateLike,
  options: { builtIn?: boolean } = {}
): ProjectTemplate {
  const builtIn = options.builtIn ?? Boolean(raw?.builtIn);
  const rawDuration =
    typeof raw?.defaultDurationDays === 'number' && Number.isFinite(raw.defaultDurationDays)
      ? Math.round(raw.defaultDurationDays)
      : 60;

  return {
    id:
      typeof raw?.id === 'string' && raw.id.trim()
        ? raw.id.trim()
        : `tpl-${Date.now()}`,
    name:
      String(raw?.name || 'Szablon projektu').trim().slice(0, TEMPLATE_LIMITS.name) ||
      'Szablon projektu',
    category: isValidCategory(raw?.category) ? raw.category : 'ogolne',
    description: String(raw?.description || '').trim().slice(0, TEMPLATE_LIMITS.description),
    defaultDurationDays: Math.min(MAX_TEMPLATE_DAYS, Math.max(1, rawDuration)),
    defaultPriority: isValidPriority(raw?.defaultPriority) ? raw.defaultPriority : 'normal',
    ...(typeof raw?.defaultBudget === 'string' && raw.defaultBudget.trim()
      ? { defaultBudget: raw.defaultBudget.trim().slice(0, TEMPLATE_LIMITS.budget) }
      : {}),
    tasks: migrateTemplateTasksFromIndices(raw?.tasks).slice(0, MAX_TEMPLATE_TASKS),
    builtIn,
    isCustom: builtIn ? false : true,
    ...(typeof raw?.createdAt === 'string' ? { createdAt: raw.createdAt } : {}),
    ...(typeof raw?.updatedAt === 'string' ? { updatedAt: raw.updatedAt } : {}),
    ...(typeof raw?.createdBy === 'string' ? { createdBy: raw.createdBy } : {}),
    ...(typeof raw?.sourceProjectId === 'string' ? { sourceProjectId: raw.sourceProjectId } : {}),
  };
}

export function toTemplateSummary(template: ProjectTemplate): ProjectTemplateSummary {
  const tasks = Array.isArray(template.tasks) ? template.tasks : [];
  return {
    id: template.id,
    name: template.name,
    category: template.category,
    description: template.description,
    defaultDurationDays: template.defaultDurationDays,
    defaultPriority: template.defaultPriority,
    ...(template.defaultBudget !== undefined ? { defaultBudget: template.defaultBudget } : {}),
    taskCount: tasks.length,
    officialDeadlineCount: tasks.filter((t) => Boolean(t?.isOfficialDeadline)).length,
    builtIn: Boolean(template.builtIn),
    ...(template.isCustom !== undefined ? { isCustom: template.isCustom } : {}),
    ...(template.createdAt !== undefined ? { createdAt: template.createdAt } : {}),
    ...(template.updatedAt !== undefined ? { updatedAt: template.updatedAt } : {}),
    ...(template.createdBy !== undefined ? { createdBy: template.createdBy } : {}),
    ...(template.sourceProjectId !== undefined ? { sourceProjectId: template.sourceProjectId } : {}),
  };
}

export interface ValidatedTemplatePayload {
  name: string;
  category: TemplateCategory;
  description: string;
  defaultDurationDays: number;
  defaultPriority: Priority;
  defaultBudget?: string;
  sourceProjectId?: string;
  tasks: TemplateTaskBlueprint[];
}

export type TemplateValidationResult =
  | { ok: true; data: ValidatedTemplatePayload }
  | { ok: false; error: string; field?: string };

export function validateTemplateWritePayload(raw: unknown): TemplateValidationResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Nieprawidłowy format danych szablonu.' };
  }
  if (hasForbiddenKeys(raw)) {
    return { ok: false, error: 'Niedozwolony klucz w żądaniu (__proto__, constructor, prototype).' };
  }

  const body = raw as Record<string, unknown>;

  if (typeof body.name !== 'string' || !body.name.trim()) {
    return { ok: false, error: 'Nazwa szablonu jest wymagana.', field: 'name' };
  }
  const name = body.name.trim();
  if (name.length > TEMPLATE_LIMITS.name) {
    return {
      ok: false,
      error: `Nazwa szablonu nie może przekraczać ${TEMPLATE_LIMITS.name} znaków.`,
      field: 'name',
    };
  }

  let category: TemplateCategory = 'ogolne';
  if (body.category !== undefined) {
    if (!isValidCategory(body.category)) {
      return { ok: false, error: 'Nieprawidłowa kategoria szablonu.', field: 'category' };
    }
    category = body.category;
  }

  let description = '';
  if (body.description !== undefined) {
    if (typeof body.description !== 'string') {
      return { ok: false, error: 'Opis szablonu musi być tekstem.', field: 'description' };
    }
    description = body.description.trim();
    if (description.length > TEMPLATE_LIMITS.description) {
      return {
        ok: false,
        error: `Opis szablonu nie może przekraczać ${TEMPLATE_LIMITS.description} znaków.`,
        field: 'description',
      };
    }
  }

  let defaultDurationDays = 60;
  if (body.defaultDurationDays !== undefined) {
    if (
      typeof body.defaultDurationDays !== 'number' ||
      !Number.isInteger(body.defaultDurationDays) ||
      body.defaultDurationDays < 1 ||
      body.defaultDurationDays > MAX_TEMPLATE_DAYS
    ) {
      return {
        ok: false,
        error: `Domyślny czas trwania musi być liczbą całkowitą z zakresu 1–${MAX_TEMPLATE_DAYS} dni.`,
        field: 'defaultDurationDays',
      };
    }
    defaultDurationDays = body.defaultDurationDays;
  }

  let defaultPriority: Priority = 'normal';
  if (body.defaultPriority !== undefined) {
    if (!isValidPriority(body.defaultPriority)) {
      return { ok: false, error: 'Nieprawidłowy priorytet domyślny szablonu.', field: 'defaultPriority' };
    }
    defaultPriority = body.defaultPriority;
  }

  let defaultBudget: string | undefined;
  if (body.defaultBudget !== undefined && body.defaultBudget !== null && body.defaultBudget !== '') {
    if (typeof body.defaultBudget !== 'string') {
      return { ok: false, error: 'Sugerowany budżet musi być tekstem.', field: 'defaultBudget' };
    }
    const trimmedBudget = body.defaultBudget.trim();
    if (trimmedBudget.length > TEMPLATE_LIMITS.budget) {
      return {
        ok: false,
        error: `Sugerowany budżet nie może przekraczać ${TEMPLATE_LIMITS.budget} znaków.`,
        field: 'defaultBudget',
      };
    }
    defaultBudget = trimmedBudget;
  }

  let sourceProjectId: string | undefined;
  if (body.sourceProjectId !== undefined && body.sourceProjectId !== null && body.sourceProjectId !== '') {
    if (typeof body.sourceProjectId !== 'string' || body.sourceProjectId.trim().length > 100) {
      return { ok: false, error: 'Nieprawidłowy identyfikator projektu źródłowego.', field: 'sourceProjectId' };
    }
    sourceProjectId = body.sourceProjectId.trim();
  }

  if (body.tasks !== undefined && !Array.isArray(body.tasks)) {
    return { ok: false, error: 'Lista zadań szablonu musi być tablicą.', field: 'tasks' };
  }
  const rawTasks = Array.isArray(body.tasks) ? body.tasks : [];
  if (rawTasks.length > MAX_TEMPLATE_TASKS) {
    return {
      ok: false,
      error: `Szablon może zawierać maksymalnie ${MAX_TEMPLATE_TASKS} zadań.`,
      field: 'tasks',
    };
  }

  const normalizedTasks: TemplateTaskBlueprint[] = [];
  const taskByKey = new Map<string, TemplateTaskBlueprint>();

  for (let i = 0; i < rawTasks.length; i += 1) {
    const rawItem = rawTasks[i];
    if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
      return { ok: false, error: `Zadanie nr ${i + 1} ma nieprawidłowy format.`, field: 'tasks' };
    }
    if (hasForbiddenKeys(rawItem)) {
      return { ok: false, error: 'Niedozwolony klucz w zadaniu szablonu (__proto__, constructor, prototype).' };
    }
    const t = rawItem as Record<string, unknown>;

    if (typeof t.key !== 'string' || !t.key.trim()) {
      return { ok: false, error: `Zadanie nr ${i + 1} musi posiadać unikalny klucz (key).`, field: 'tasks' };
    }
    const key = t.key.trim();
    if (key.length > TEMPLATE_LIMITS.key) {
      return {
        ok: false,
        error: `Klucz zadania "${key.slice(0, 20)}..." przekracza ${TEMPLATE_LIMITS.key} znaków.`,
        field: 'tasks',
      };
    }
    if (taskByKey.has(key)) {
      return {
        ok: false,
        error: `Zduplikowany klucz zadania w szablonie: "${key}".`,
        field: 'tasks',
      };
    }

    if (typeof t.title !== 'string' || !t.title.trim()) {
      return { ok: false, error: `Zadanie "${key}" wymaga podania tytułu.`, field: 'tasks' };
    }
    const title = t.title.trim();
    if (title.length > TEMPLATE_LIMITS.taskTitle) {
      return {
        ok: false,
        error: `Tytuł zadania "${key}" przekracza maksymalnie ${TEMPLATE_LIMITS.taskTitle} znaków.`,
        field: 'tasks',
      };
    }

    let taskDescription = '';
    if (t.description !== undefined) {
      if (typeof t.description !== 'string') {
        return { ok: false, error: `Opis zadania "${key}" musi być tekstem.`, field: 'tasks' };
      }
      taskDescription = t.description.trim();
      if (taskDescription.length > TEMPLATE_LIMITS.taskDescription) {
        return {
          ok: false,
          error: `Opis zadania "${key}" przekracza ${TEMPLATE_LIMITS.taskDescription} znaków.`,
          field: 'tasks',
        };
      }
    }

    let taskType = 'task';
    if (t.type !== undefined) {
      if (typeof t.type !== 'string' || !t.type.trim() || t.type.trim().length > TEMPLATE_LIMITS.taskType) {
        return { ok: false, error: `Nieprawidłowy typ zadania "${key}".`, field: 'tasks' };
      }
      taskType = t.type.trim();
    }

    let priority: Priority = 'normal';
    if (t.priority !== undefined) {
      if (!isValidPriority(t.priority)) {
        return { ok: false, error: `Nieprawidłowy priorytet zadania "${key}".`, field: 'tasks' };
      }
      priority = t.priority;
    }

    if (
      typeof t.durationDays !== 'number' ||
      !Number.isInteger(t.durationDays) ||
      t.durationDays < 1 ||
      t.durationDays > MAX_TEMPLATE_DAYS
    ) {
      return {
        ok: false,
        error: `Czas trwania zadania "${key}" musi być liczbą całkowitą z zakresu 1–${MAX_TEMPLATE_DAYS} dni.`,
        field: 'tasks',
      };
    }

    if (
      typeof t.offsetDays !== 'number' ||
      !Number.isInteger(t.offsetDays) ||
      t.offsetDays < 0 ||
      t.offsetDays > MAX_TEMPLATE_DAYS
    ) {
      return {
        ok: false,
        error: `Przesunięcie (offsetDays) zadania "${key}" musi być liczbą całkowitą z zakresu 0–${MAX_TEMPLATE_DAYS} dni.`,
        field: 'tasks',
      };
    }

    let isOfficialDeadline: boolean | undefined;
    if (t.isOfficialDeadline !== undefined) {
      if (typeof t.isOfficialDeadline !== 'boolean') {
        return { ok: false, error: `Pole isOfficialDeadline zadania "${key}" musi być wartością logiczną.`, field: 'tasks' };
      }
      if (t.isOfficialDeadline) isOfficialDeadline = true;
    }

    let estimatedHours: number | undefined;
    if (t.estimatedHours !== undefined && t.estimatedHours !== null) {
      if (typeof t.estimatedHours !== 'number' || !Number.isFinite(t.estimatedHours) || t.estimatedHours < 0 || t.estimatedHours > 100000) {
        return { ok: false, error: `Szacowane godziny zadania "${key}" muszą być liczbą nieujemną.`, field: 'tasks' };
      }
      estimatedHours = Math.round(t.estimatedHours * 100) / 100;
    }

    let tags: string[] | undefined;
    if (t.tags !== undefined) {
      if (!Array.isArray(t.tags)) {
        return { ok: false, error: `Tagi zadania "${key}" muszą być tablicą.`, field: 'tasks' };
      }
      if (t.tags.length > TEMPLATE_LIMITS.tagsMaxCount) {
        return {
          ok: false,
          error: `Zadanie "${key}" może mieć maksymalnie ${TEMPLATE_LIMITS.tagsMaxCount} tagów.`,
          field: 'tasks',
        };
      }
      const cleanTags: string[] = [];
      for (const rawTag of t.tags) {
        if (typeof rawTag !== 'string') {
          return { ok: false, error: `Tagi zadania "${key}" muszą być tekstami.`, field: 'tasks' };
        }
        const trimmedTag = rawTag.trim();
        if (trimmedTag.length > TEMPLATE_LIMITS.tagLength) {
          return {
            ok: false,
            error: `Tag w zadaniu "${key}" przekracza ${TEMPLATE_LIMITS.tagLength} znaków.`,
            field: 'tasks',
          };
        }
        if (trimmedTag) cleanTags.push(trimmedTag);
      }
      if (cleanTags.length > 0) tags = cleanTags;
    }

    let assigneeRole: TemplateAssigneeRole = 'none';
    if (t.assigneeRole !== undefined) {
      if (!isValidAssigneeRole(t.assigneeRole)) {
        return { ok: false, error: `Nieprawidłowa rola przypisania w zadaniu "${key}".`, field: 'tasks' };
      }
      assigneeRole = t.assigneeRole;
    }

    let parentKey: string | undefined;
    if (t.parentKey !== undefined && t.parentKey !== null && t.parentKey !== '') {
      if (typeof t.parentKey !== 'string') {
        return { ok: false, error: `Nieprawidłowy klucz rodzica (parentKey) w zadaniu "${key}".`, field: 'tasks' };
      }
      parentKey = t.parentKey.trim();
    }

    let blockerKeys: string[] | undefined;
    if (t.blockerKeys !== undefined) {
      if (!Array.isArray(t.blockerKeys)) {
        return { ok: false, error: `Poprzedniki (blockerKeys) zadania "${key}" muszą być tablicą.`, field: 'tasks' };
      }
      const seenBlockers = new Set<string>();
      for (const bk of t.blockerKeys) {
        if (typeof bk !== 'string' || !bk.trim()) {
          return { ok: false, error: `Nieprawidłowy klucz poprzednika w zadaniu "${key}".`, field: 'tasks' };
        }
        seenBlockers.add(bk.trim());
      }
      if (seenBlockers.size > 0) {
        blockerKeys = Array.from(seenBlockers);
      }
    }

    const blueprint: TemplateTaskBlueprint = {
      key,
      title,
      description: taskDescription,
      type: taskType,
      priority,
      durationDays: t.durationDays,
      offsetDays: t.offsetDays,
      ...(isOfficialDeadline !== undefined ? { isOfficialDeadline } : {}),
      ...(estimatedHours !== undefined ? { estimatedHours } : {}),
      ...(tags ? { tags } : {}),
      ...(parentKey ? { parentKey } : {}),
      ...(blockerKeys ? { blockerKeys } : {}),
      assigneeRole,
    };

    normalizedTasks.push(blueprint);
    taskByKey.set(key, blueprint);
  }

  // Walidacja odwołań parentKey, cykli w hierarchii oraz maksymalnej głębokości (6)
  for (const task of normalizedTasks) {
    if (task.parentKey) {
      if (task.parentKey === task.key) {
        return {
          ok: false,
          error: `Zadanie "${task.key}" nie może być swoim własnym zadaniem nadrzędnym.`,
          field: 'tasks',
        };
      }
      if (!taskByKey.has(task.parentKey)) {
        return {
          ok: false,
          error: `Zadanie "${task.key}" odwołuje się do nieistniejącego zadania nadrzędnego "${task.parentKey}".`,
          field: 'tasks',
        };
      }
    }

    if (task.blockerKeys) {
      for (const bk of task.blockerKeys) {
        if (bk === task.key) {
          return {
            ok: false,
            error: `Zadanie "${task.key}" nie może blokować samego siebie.`,
            field: 'tasks',
          };
        }
        if (!taskByKey.has(bk)) {
          return {
            ok: false,
            error: `Zadanie "${task.key}" odwołuje się do nieistniejącego poprzednika "${bk}".`,
            field: 'tasks',
          };
        }
      }
    }
  }

  // Wykrywanie cykli i głębokości hierarchii parentKey
  const depthMemo = new Map<string, number>();
  const parentVisitState = new Map<string, 1 | 2>();

  const measureParentDepth = (key: string): { ok: true; depth: number } | { ok: false; error: string } => {
    const cached = depthMemo.get(key);
    if (cached !== undefined) return { ok: true, depth: cached };

    const state = parentVisitState.get(key);
    if (state === 1) {
      return {
        ok: false,
        error: `Wykryto cykl w hierarchii zadań nadrzędnych (parentKey) przy "${key}".`,
      };
    }

    parentVisitState.set(key, 1);
    const node = taskByKey.get(key)!;
    let depth = 1;
    if (node.parentKey) {
      const parentRes = measureParentDepth(node.parentKey);
      if (!parentRes.ok) return parentRes;
      depth = parentRes.depth + 1;
    }
    parentVisitState.set(key, 2);
    depthMemo.set(key, depth);

    if (depth > MAX_TEMPLATE_HIERARCHY_DEPTH) {
      return {
        ok: false,
        error: `Przekroczono maksymalną głębokość hierarchii zadań w szablonie (${MAX_TEMPLATE_HIERARCHY_DEPTH}).`,
      };
    }
    return { ok: true, depth };
  };

  for (const task of normalizedTasks) {
    const res = measureParentDepth(task.key);
    if (!res.ok) {
      return { ok: false, error: res.error, field: 'tasks' };
    }
  }

  // Wykrywanie cykli w zależnościach blockerKeys (3-kolorowy DFS)
  const blockerState = new Map<string, 1 | 2>();
  const checkBlockerCycle = (key: string): boolean => {
    const st = blockerState.get(key);
    if (st === 1) return true;
    if (st === 2) return false;
    blockerState.set(key, 1);
    const node = taskByKey.get(key);
    if (node?.blockerKeys) {
      for (const bk of node.blockerKeys) {
        if (checkBlockerCycle(bk)) return true;
      }
    }
    blockerState.set(key, 2);
    return false;
  };

  for (const task of normalizedTasks) {
    if (checkBlockerCycle(task.key)) {
      return {
        ok: false,
        error: `Wykryto cykl zależności między zadaniami (blockerKeys) przy "${task.key}".`,
        field: 'tasks',
      };
    }
  }

  return {
    ok: true,
    data: {
      name,
      category,
      description,
      defaultDurationDays,
      defaultPriority,
      ...(defaultBudget !== undefined ? { defaultBudget } : {}),
      ...(sourceProjectId !== undefined ? { sourceProjectId } : {}),
      tasks: normalizedTasks,
    },
  };
}

function parseIsoDateUtcMs(dateStr: unknown): number | null {
  if (typeof dateStr !== 'string') return null;
  const trimmed = dateStr.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const ms = Date.UTC(y, m - 1, d);
  const dt = new Date(ms);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return ms;
}

function diffDaysUtc(fromStr: string, toStr: string): number {
  const fromMs = parseIsoDateUtcMs(fromStr);
  const toMs = parseIsoDateUtcMs(toStr);
  if (fromMs === null || toMs === null) return 0;
  return Math.round((toMs - fromMs) / 86_400_000);
}

export interface BuildTemplateFromProjectInput {
  project: Project;
  projectTasks: readonly Task[];
  body: {
    name?: unknown;
    category?: unknown;
    description?: unknown;
    selectedTaskIds?: unknown;
    skipCompleted?: unknown;
    preserveAssigneeRoles?: unknown;
  };
  callerId: string;
  templateId: string;
  nowIso?: string;
}

export type BuildTemplateFromProjectResult =
  | { ok: true; template: ProjectTemplate }
  | { ok: false; status: number; error: string; field?: string };

/**
 * Buduje nowy szablon projektu na podstawie istniejącego projektu i jego zadań.
 * Nie kopiuje statusu, postępu, przepracowanych godzin, komentarzy ani żadnych danych finansowych.
 */
export function buildTemplateFromProject(
  input: BuildTemplateFromProjectInput
): BuildTemplateFromProjectResult {
  const { project, projectTasks, body, callerId, templateId, nowIso = new Date().toISOString() } = input;

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, error: 'Nieprawidłowy format żądania.' };
  }

  let name = `Szablon: ${project.name}`.trim().slice(0, TEMPLATE_LIMITS.name);
  if (body.name !== undefined) {
    if (typeof body.name !== 'string') {
      return { ok: false, status: 400, error: 'Nazwa szablonu musi być tekstem.', field: 'name' };
    }
    const trimmed = body.name.trim();
    if (!trimmed) {
      return { ok: false, status: 400, error: 'Nazwa szablonu jest wymagana.', field: 'name' };
    }
    if (trimmed.length > TEMPLATE_LIMITS.name) {
      return {
        ok: false,
        status: 400,
        error: `Nazwa szablonu nie może przekraczać ${TEMPLATE_LIMITS.name} znaków.`,
        field: 'name',
      };
    }
    name = trimmed;
  }

  let category: TemplateCategory = 'kubaturowe';
  if (body.category !== undefined) {
    if (!isValidCategory(body.category)) {
      return { ok: false, status: 400, error: 'Nieprawidłowa kategoria szablonu.', field: 'category' };
    }
    category = body.category;
  }

  let description = `Szablon utworzony na podstawie projektu [${project.key}] ${project.name}.`.slice(
    0,
    TEMPLATE_LIMITS.description
  );
  if (body.description !== undefined) {
    if (typeof body.description !== 'string') {
      return { ok: false, status: 400, error: 'Opis szablonu musi być tekstem.', field: 'description' };
    }
    const trimmedDesc = body.description.trim();
    if (trimmedDesc.length > TEMPLATE_LIMITS.description) {
      return {
        ok: false,
        status: 400,
        error: `Opis szablonu nie może przekraczać ${TEMPLATE_LIMITS.description} znaków.`,
        field: 'description',
      };
    }
    description = trimmedDesc;
  }

  const skipCompleted = body.skipCompleted === true;
  const preserveAssigneeRoles = body.preserveAssigneeRoles === true;

  let selectedIdSet: Set<string> | null = null;
  if (body.selectedTaskIds !== undefined) {
    if (!Array.isArray(body.selectedTaskIds)) {
      return { ok: false, status: 400, error: 'Lista selectedTaskIds musi być tablicą.', field: 'selectedTaskIds' };
    }
    selectedIdSet = new Set<string>();
    for (const rawId of body.selectedTaskIds) {
      if (typeof rawId === 'string' && rawId.trim()) {
        selectedIdSet.add(rawId.trim());
      }
    }
  }

  const taskById = new Map<string, Task>();
  for (const t of projectTasks) {
    if (t && t.id) {
      taskById.set(t.id, t);
    }
  }

  // Jeśli podano selectedTaskIds, odznaczenie rodzica pomija wszystkie jego zadania podrzędne
  const hasUnselectedAncestor = (task: Task): boolean => {
    if (!selectedIdSet) return false;
    const visited = new Set<string>([task.id]);
    let currParentId = typeof task.parentId === 'string' ? task.parentId.trim() : '';
    while (currParentId && !visited.has(currParentId)) {
      visited.add(currParentId);
      if (!selectedIdSet.has(currParentId)) {
        return true;
      }
      const parentTask = taskById.get(currParentId);
      if (!parentTask) break;
      currParentId = typeof parentTask.parentId === 'string' ? parentTask.parentId.trim() : '';
    }
    return false;
  };

  // Najwcześniejszy startDate spośród zadań projektu (punkt odniesienia offsetDays = 0)
  let earliestStartDate = '';
  for (const t of projectTasks) {
    if (t && parseIsoDateUtcMs(t.startDate) !== null) {
      if (!earliestStartDate || t.startDate < earliestStartDate) {
        earliestStartDate = t.startDate;
      }
    }
  }
  if (!earliestStartDate) {
    earliestStartDate =
      parseIsoDateUtcMs(project.startDate) !== null
        ? project.startDate
        : nowIso.slice(0, 10);
  }

  const filteredTasks = projectTasks.filter((t) => {
    if (!t || !t.id) return false;
    if (selectedIdSet && (!selectedIdSet.has(t.id) || hasUnselectedAncestor(t))) {
      return false;
    }
    if (skipCompleted && t.status === 'done') {
      return false;
    }
    return true;
  });

  if (filteredTasks.length === 0) {
    return {
      ok: false,
      status: 400,
      error: 'Wybierz co najmniej jedno zadanie do zapisania w szablonie.',
      field: 'selectedTaskIds',
    };
  }

  if (filteredTasks.length > MAX_TEMPLATE_TASKS) {
    return {
      ok: false,
      status: 400,
      error: `Szablon może zawierać maksymalnie ${MAX_TEMPLATE_TASKS} zadań (wybrano ${filteredTasks.length}).`,
      field: 'selectedTaskIds',
    };
  }

  // Sortowanie stabilne: chronologicznie po startDate, następnie po kodzie i tytule
  const sortedTasks = [...filteredTasks].sort((a, b) => {
    const dateCmp = String(a.startDate || '').localeCompare(String(b.startDate || ''));
    if (dateCmp !== 0) return dateCmp;
    const codeCmp = String(a.code || '').localeCompare(String(b.code || ''));
    if (codeCmp !== 0) return codeCmp;
    return String(a.title || '').localeCompare(String(b.title || ''));
  });

  const keptIdSet = new Set(sortedTasks.map((t) => t.id));
  const idToKey = new Map<string, string>();
  sortedTasks.forEach((t, idx) => {
    idToKey.set(t.id, `t-${idx + 1}`);
  });

  const resolveKeptParentKey = (task: Task): string | undefined => {
    const visited = new Set<string>([task.id]);
    let currParentId = typeof task.parentId === 'string' ? task.parentId.trim() : '';
    while (currParentId && !visited.has(currParentId)) {
      visited.add(currParentId);
      if (keptIdSet.has(currParentId)) {
        return idToKey.get(currParentId);
      }
      const parentTask = taskById.get(currParentId);
      if (!parentTask) break;
      currParentId = typeof parentTask.parentId === 'string' ? parentTask.parentId.trim() : '';
    }
    return undefined;
  };

  let maxEndOffset = 1;
  const blueprints: TemplateTaskBlueprint[] = sortedTasks.map((t, idx) => {
    const key = idToKey.get(t.id)!;
    const hasValidStart = parseIsoDateUtcMs(t.startDate) !== null;
    const hasValidDue = parseIsoDateUtcMs(t.dueDate) !== null;

    const rawOffset = hasValidStart ? diffDaysUtc(earliestStartDate, t.startDate) : 0;
    const offsetDays = Math.min(MAX_TEMPLATE_DAYS, Math.max(0, rawOffset));

    const rawDuration =
      hasValidStart && hasValidDue
        ? diffDaysUtc(t.startDate, t.dueDate) + 1
        : typeof t.durationDays === 'number' && Number.isFinite(t.durationDays)
        ? Math.round(t.durationDays)
        : 1;
    const durationDays = Math.min(MAX_TEMPLATE_DAYS, Math.max(1, rawDuration));

    maxEndOffset = Math.max(maxEndOffset, offsetDays + durationDays);

    const parentKey = resolveKeptParentKey(t);

    const rawBlockers = Array.isArray(t.blockingTaskIds)
      ? t.blockingTaskIds
      : Array.isArray(t.dependencies)
      ? t.dependencies
      : [];
    const blockerKeySet = new Set<string>();
    for (const blockerId of rawBlockers) {
      if (typeof blockerId === 'string' && keptIdSet.has(blockerId)) {
        const bKey = idToKey.get(blockerId);
        if (bKey && bKey !== key) {
          blockerKeySet.add(bKey);
        }
      }
    }

    let assigneeRole: TemplateAssigneeRole = 'none';
    if (preserveAssigneeRoles && typeof t.assigneeId === 'string' && t.assigneeId) {
      if (project.ownerId && t.assigneeId === project.ownerId) {
        assigneeRole = 'owner';
      } else if (t.reporterId && t.assigneeId === t.reporterId) {
        assigneeRole = 'reporter';
      }
    }

    const estimatedHours =
      typeof t.estimatedHours === 'number' && Number.isFinite(t.estimatedHours) && t.estimatedHours >= 0
        ? Math.round(t.estimatedHours * 100) / 100
        : undefined;

    const cleanTags = sanitizeTags(t.tags);

    return {
      key,
      title: String(t.title || `Etap ${idx + 1}`).trim().slice(0, TEMPLATE_LIMITS.taskTitle) || `Etap ${idx + 1}`,
      description: String(t.description || '').trim().slice(0, TEMPLATE_LIMITS.taskDescription),
      type:
        typeof t.type === 'string' && t.type.trim()
          ? t.type.trim().slice(0, TEMPLATE_LIMITS.taskType)
          : 'task',
      priority: isValidPriority(t.priority) ? t.priority : 'normal',
      durationDays,
      offsetDays,
      ...(t.isOfficialDeadline ? { isOfficialDeadline: true } : {}),
      ...(estimatedHours !== undefined ? { estimatedHours } : {}),
      ...(cleanTags.length > 0 ? { tags: cleanTags } : {}),
      ...(parentKey ? { parentKey } : {}),
      ...(blockerKeySet.size > 0 ? { blockerKeys: Array.from(blockerKeySet) } : {}),
      assigneeRole,
    };
  });

  const rawDefaultDuration =
    typeof project.durationDays === 'number' && Number.isInteger(project.durationDays) && project.durationDays >= 1
      ? project.durationDays
      : maxEndOffset;
  const defaultDurationDays = Math.min(MAX_TEMPLATE_DAYS, Math.max(1, rawDefaultDuration));

  // Walidacja wynikowa chroniąca przed ew. cyklami odziedziczonymi ze starego stanu
  const finalCandidate: ProjectTemplate = {
    id: templateId,
    name,
    category,
    description,
    defaultDurationDays,
    defaultPriority: isValidPriority(project.priority) ? project.priority : 'normal',
    tasks: blueprints,
    isCustom: true,
    builtIn: false,
    createdAt: nowIso,
    updatedAt: nowIso,
    createdBy: callerId,
    sourceProjectId: project.id,
  };

  const check = validateTemplateWritePayload(finalCandidate);
  if (!check.ok) {
    return { ok: false, status: 400, error: check.error, field: check.field };
  }

  return {
    ok: true,
    template: {
      ...finalCandidate,
      ...check.data,
    },
  };
}
