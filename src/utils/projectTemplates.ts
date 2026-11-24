import type {
  Project,
  ProjectTemplate,
  ProjectTemplateSummary,
  Task,
  TemplateTaskBlueprint,
  User,
} from '../types';
import { DEFAULT_PROJECT_TEMPLATES } from '../data/defaultTemplates.js';
import {
  migrateLegacyTemplate,
  type LegacyTemplateLike,
} from './templateValidation.js';

export const LEGACY_TEMPLATES_STORAGE_KEY = 'oph_project_templates';

/**
 * Zwraca listę własnych szablonów zapisanych wcześniej w localStorage przeglądarki
 * (po migracji z blockerIndices na key / blockerKeys).
 */
export const getLegacyLocalCustomTemplates = (): ProjectTemplate[] => {
  try {
    if (typeof localStorage === 'undefined') return [];
    const rawSaved = localStorage.getItem(LEGACY_TEMPLATES_STORAGE_KEY);
    if (!rawSaved) return [];
    const parsed = JSON.parse(rawSaved);
    if (!Array.isArray(parsed)) return [];
    const builtInIds = new Set(DEFAULT_PROJECT_TEMPLATES.map((t) => t.id));
    const result: ProjectTemplate[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const legacy = item as LegacyTemplateLike;
      const id = typeof legacy.id === 'string' ? legacy.id : '';
      const isCustomEntry =
        Boolean(legacy.isCustom) || id.startsWith('custom-') || !builtInIds.has(id);
      if (!isCustomEntry || builtInIds.has(id)) continue;
      result.push(migrateLegacyTemplate(legacy, { builtIn: false }));
    }
    return result;
  } catch {
    return [];
  }
};

export const clearLegacyLocalCustomTemplates = (): void => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(LEGACY_TEMPLATES_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
};

async function readApiError(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    if (data && typeof data.error === 'string' && data.error.trim()) {
      return data.error;
    }
  } catch {
    // ignore json error
  }
  return fallback;
}

export async function fetchTemplatesList(): Promise<ProjectTemplateSummary[]> {
  const res = await fetch('/api/templates', { credentials: 'same-origin' });
  if (!res.ok) {
    throw new Error(await readApiError(res, 'Nie udało się pobrać listy szablonów projektów.'));
  }
  const data = await res.json();
  return Array.isArray(data?.templates) ? data.templates : [];
}

export async function fetchTemplateById(templateId: string): Promise<ProjectTemplate> {
  const res = await fetch(`/api/templates/${encodeURIComponent(templateId)}`, {
    credentials: 'same-origin',
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, 'Nie udało się pobrać szczegółów szablonu projektu.'));
  }
  const data = await res.json();
  if (!data?.template) {
    throw new Error('Brak danych szablonu w odpowiedzi serwera.');
  }
  return data.template as ProjectTemplate;
}

export async function createTemplateOnServer(
  payload: Omit<ProjectTemplate, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'builtIn' | 'isCustom'>
): Promise<{ template: ProjectTemplate; revision?: number }> {
  const res = await fetch('/api/templates', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, 'Nie udało się zapisać szablonu na serwerze.'));
  }
  const data = await res.json();
  return {
    template: data.template as ProjectTemplate,
    revision: typeof data.revision === 'number' ? data.revision : undefined,
  };
}

export async function updateTemplateOnServer(
  templateId: string,
  payload: Omit<ProjectTemplate, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'builtIn' | 'isCustom'>
): Promise<{ template: ProjectTemplate; revision?: number }> {
  const res = await fetch(`/api/templates/${encodeURIComponent(templateId)}`, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, 'Nie udało się zaktualizować szablonu na serwerze.'));
  }
  const data = await res.json();
  return {
    template: data.template as ProjectTemplate,
    revision: typeof data.revision === 'number' ? data.revision : undefined,
  };
}

export async function duplicateTemplateOnServer(
  templateId: string,
  name?: string
): Promise<{ template: ProjectTemplate; revision?: number }> {
  const res = await fetch(`/api/templates/${encodeURIComponent(templateId)}/duplicate`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(name ? { name } : {}),
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, 'Nie udało się zduplikować szablonu.'));
  }
  const data = await res.json();
  return {
    template: data.template as ProjectTemplate,
    revision: typeof data.revision === 'number' ? data.revision : undefined,
  };
}

export async function deleteTemplateOnServer(
  templateId: string
): Promise<{ revision?: number }> {
  const res = await fetch(`/api/templates/${encodeURIComponent(templateId)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, 'Nie udało się usunąć szablonu.'));
  }
  const data = await res.json();
  return {
    revision: typeof data.revision === 'number' ? data.revision : undefined,
  };
}

export interface CreateTemplateFromProjectPayload {
  name: string;
  category: ProjectTemplate['category'];
  description?: string;
  selectedTaskIds?: string[];
  skipCompleted?: boolean;
  preserveAssigneeRoles?: boolean;
}

export async function createTemplateFromProjectOnServer(
  projectId: string,
  payload: CreateTemplateFromProjectPayload
): Promise<{ template: ProjectTemplate; revision?: number }> {
  const res = await fetch(`/api/templates/from-project/${encodeURIComponent(projectId)}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, 'Nie udało się utworzyć szablonu z projektu.'));
  }
  const data = await res.json();
  return {
    template: data.template as ProjectTemplate,
    revision: typeof data.revision === 'number' ? data.revision : undefined,
  };
}

function addDaysUtc(dateStr: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
  if (!match) return dateStr;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function getBlueprintDepth(
  byKey: ReadonlyMap<string, TemplateTaskBlueprint>,
  key: string
): number {
  let depth = 1;
  const visited = new Set<string>([key]);
  let curr = byKey.get(key);
  while (curr?.parentKey && !visited.has(curr.parentKey)) {
    visited.add(curr.parentKey);
    const parent = byKey.get(curr.parentKey);
    if (!parent) break;
    depth += 1;
    curr = parent;
  }
  return depth;
}

/**
 * Zwraca listę zadań do utworzenia z szablonu w kolejności gwarantującej,
 * że każde zadanie nadrzędne (`parentId`) występuje przed swoimi podzadaniami.
 */
export function instantiateTasksFromTemplate(
  template: ProjectTemplate,
  project: Pick<Project, 'id' | 'key' | 'startDate' | 'ownerId'>,
  reporterUser: User
): Task[];
export function instantiateTasksFromTemplate(
  template: ProjectTemplate,
  newProjectId: string,
  projectStartDate: string,
  reporterUser: User,
  options?: { projectKey?: string; ownerId?: string }
): Task[];
export function instantiateTasksFromTemplate(
  template: ProjectTemplate,
  projectOrId: Pick<Project, 'id' | 'key' | 'startDate' | 'ownerId'> | string,
  startOrReporter: string | User,
  maybeReporter?: User,
  options?: { projectKey?: string; ownerId?: string }
): Task[] {
  const newProjectId = typeof projectOrId === 'string' ? projectOrId : projectOrId.id;
  const projectStartDate =
    typeof projectOrId === 'string'
      ? (startOrReporter as string)
      : projectOrId.startDate;
  const reporterUser =
    typeof projectOrId === 'string'
      ? (maybeReporter as User)
      : (startOrReporter as User);
  const projectKey =
    (typeof projectOrId === 'string' ? options?.projectKey : projectOrId.key)?.trim() || 'ZAD';
  const ownerId =
    typeof projectOrId === 'string' ? options?.ownerId : projectOrId.ownerId;

  const blueprints = Array.isArray(template.tasks) ? template.tasks : [];
  if (blueprints.length === 0) return [];

  const byKey = new Map<string, TemplateTaskBlueprint>();
  const keyToTaskIdMap = new Map<string, string>();
  const keyToIndexMap = new Map<string, number>();

  const seed = Date.now();
  blueprints.forEach((bp, idx) => {
    const key = bp.key || `t-${idx + 1}`;
    byKey.set(key, bp);
    keyToIndexMap.set(key, idx);
    keyToTaskIdMap.set(key, `tsk-${seed}-${idx + 1}`);
  });

  // Sortowanie gwarantujące utworzenie zadań nadrzędnych przed podzadaniami
  const orderedBlueprints = [...blueprints].sort((a, b) => {
    const kA = a.key || '';
    const kB = b.key || '';
    const dA = getBlueprintDepth(byKey, kA);
    const dB = getBlueprintDepth(byKey, kB);
    if (dA !== dB) return dA - dB;
    return (keyToIndexMap.get(kA) ?? 0) - (keyToIndexMap.get(kB) ?? 0);
  });

  const nowIso = new Date().toISOString();

  return orderedBlueprints.map((bp, orderedIdx) => {
    const key = bp.key || `t-${orderedIdx + 1}`;
    const originalIdx = keyToIndexMap.get(key) ?? orderedIdx;
    const taskId = keyToTaskIdMap.get(key)!;
    const taskStart = addDaysUtc(projectStartDate, Math.max(0, bp.offsetDays || 0));
    const durationDays = Math.max(1, bp.durationDays || 1);
    const taskDue = addDaysUtc(taskStart, durationDays - 1);

    const parentId = bp.parentKey ? keyToTaskIdMap.get(bp.parentKey) : undefined;

    const mappedBlockers = (bp.blockerKeys || [])
      .map((bKey) => keyToTaskIdMap.get(bKey))
      .filter((id): id is string => Boolean(id && id !== taskId));

    const isInitialTask = mappedBlockers.length === 0;

    let assigneeId: string | undefined;
    if (bp.assigneeRole === 'owner') {
      assigneeId = ownerId || undefined;
    } else if (bp.assigneeRole === 'reporter') {
      assigneeId = reporterUser.id;
    }

    const task: Task = {
      id: taskId,
      projectId: newProjectId,
      code: `${projectKey}-${String(originalIdx + 1).padStart(2, '0')}`,
      title: bp.title,
      description: bp.description || '',
      type: bp.type,
      priority: bp.priority,
      status: isInitialTask ? 'to_do' : 'blocked',
      reporterId: reporterUser.id,
      ...(assigneeId ? { assigneeId } : {}),
      ...(parentId ? { parentId } : {}),
      startDate: taskStart,
      dueDate: taskDue,
      durationDays,
      ...(bp.isOfficialDeadline ? { isOfficialDeadline: true } : {}),
      ...(bp.estimatedHours !== undefined ? { estimatedHours: bp.estimatedHours } : {}),
      spentHours: 0,
      progress: 0,
      blockingTaskIds: mappedBlockers,
      dependencies: mappedBlockers,
      tags: bp.tags || [],
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    return task;
  });
}
