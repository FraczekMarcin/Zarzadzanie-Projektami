import crypto from 'crypto';
import type { Project, ProjectTemplate, Task, TemplateTaskBlueprint } from '../types/index.js';
import { DEFAULT_PROJECT_TEMPLATES } from '../data/defaultTemplates.js';
import { buildNewTaskRecord, generateTaskCode } from './access.js';
import { canReparent } from './taskTree.js';

export function isValidIsoDateString(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return false;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const ms = Date.UTC(y, m - 1, d);
  const dt = new Date(ms);
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function addDaysUtc(dateStr: string, days: number): string {
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

export function resolveTemplateById(
  appState: { projectTemplates?: ProjectTemplate[] } | null | undefined,
  templateId: string
): ProjectTemplate | undefined {
  const trimmedId = typeof templateId === 'string' ? templateId.trim() : '';
  if (!trimmedId) return undefined;

  const builtIn = DEFAULT_PROJECT_TEMPLATES.find((t) => t.id === trimmedId);
  if (builtIn) {
    return { ...builtIn, builtIn: true, isCustom: false };
  }

  const customList = Array.isArray(appState?.projectTemplates)
    ? appState.projectTemplates
    : [];
  const custom = customList.find((t) => t && t.id === trimmedId);
  if (!custom) return undefined;

  return { ...custom, builtIn: false, isCustom: true };
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
 * Filtruje zadania szablonu według opcjonalnej listy wybranych kluczy (`selectedKeys`).
 * Odznaczenie zadania nadrzędnego automatycznie pomija wszystkie jego zadania podrzędne.
 */
export function filterBlueprintsWithParentCascade(
  blueprints: readonly TemplateTaskBlueprint[],
  selectedKeys?: ReadonlySet<string> | null
): TemplateTaskBlueprint[] {
  if (!Array.isArray(blueprints) || blueprints.length === 0) return [];
  if (!selectedKeys) {
    return [...blueprints];
  }

  const byKey = new Map<string, TemplateTaskBlueprint>();
  for (const bp of blueprints) {
    if (bp && bp.key) {
      byKey.set(bp.key, bp);
    }
  }

  const hasExcludedAncestor = (bp: TemplateTaskBlueprint): boolean => {
    const visited = new Set<string>([bp.key]);
    let currParent = typeof bp.parentKey === 'string' ? bp.parentKey.trim() : '';
    while (currParent && !visited.has(currParent)) {
      visited.add(currParent);
      if (!selectedKeys.has(currParent)) {
        return true;
      }
      const parentBp = byKey.get(currParent);
      if (!parentBp) return true;
      currParent = typeof parentBp.parentKey === 'string' ? parentBp.parentKey.trim() : '';
    }
    return false;
  };

  return blueprints.filter(
    (bp) => Boolean(bp && bp.key && selectedKeys.has(bp.key) && !hasExcludedAncestor(bp))
  );
}

export interface TemplateSelectionSummary {
  selectedCount: number;
  totalEstimatedHours: number;
  firstTaskDate: string | null;
  lastTaskDate: string | null;
}

export function computeTemplateSelectionSummary(
  blueprints: readonly TemplateTaskBlueprint[],
  startDate: string,
  selectedKeys?: ReadonlySet<string> | null
): TemplateSelectionSummary {
  const kept = filterBlueprintsWithParentCascade(blueprints, selectedKeys);
  if (kept.length === 0) {
    return {
      selectedCount: 0,
      totalEstimatedHours: 0,
      firstTaskDate: null,
      lastTaskDate: null,
    };
  }

  const hasValidDate = isValidIsoDateString(startDate);
  let minOffset = Number.POSITIVE_INFINITY;
  let maxEndOffset = 0;
  let totalHours = 0;

  for (const bp of kept) {
    const offset = Math.max(0, Math.round(bp.offsetDays || 0));
    const duration = Math.max(1, Math.round(bp.durationDays || 1));
    if (offset < minOffset) minOffset = offset;
    const endOffset = offset + duration - 1;
    if (endOffset > maxEndOffset) maxEndOffset = endOffset;
    if (typeof bp.estimatedHours === 'number' && Number.isFinite(bp.estimatedHours) && bp.estimatedHours >= 0) {
      totalHours += bp.estimatedHours;
    }
  }

  return {
    selectedCount: kept.length,
    totalEstimatedHours: Math.round(totalHours * 100) / 100,
    firstTaskDate: hasValidDate ? addDaysUtc(startDate, minOffset) : null,
    lastTaskDate: hasValidDate ? addDaysUtc(startDate, maxEndOffset) : null,
  };
}

export interface InstantiateTemplateOptions {
  template: ProjectTemplate;
  project: Pick<Project, 'id' | 'key' | 'startDate' | 'ownerId'>;
  caller: { id: string; role?: string };
  templateTaskKeys?: unknown;
  existingProjectTasksCount?: number;
  nowIso?: string;
  idFactory?: () => string;
}

export type InstantiateTemplateResult =
  | { ok: true; tasks: Task[] }
  | { ok: false; status: number; error: string };

/**
 * Instancjonuje zadania z szablonu po stronie serwera dla nowego projektu:
 * - generuje kody zadań standardową funkcją projektu (`generateTaskCode` / `buildNewTaskRecord`)
 * - generuje ID za pomocą `crypto.randomUUID()`
 * - zachowuje hierarchię `parentId` (rodzice przed dziećmi, z walidacją `canReparent`)
 * - odwzorowuje `blockerKeys` (zadania blokowane startują jako `blocked`, pozostałe jako `to_do`; blokady na pominięte zadania są usuwane)
 * - odznaczenie rodzica pomija podzadania
 * - przypisuje `assigneeId` wg `assigneeRole` (`owner` | `reporter` | `none`)
 */
export function instantiateTemplateForProject(
  options: InstantiateTemplateOptions
): InstantiateTemplateResult {
  const {
    template,
    project,
    caller,
    templateTaskKeys,
    existingProjectTasksCount = 0,
    nowIso = new Date().toISOString(),
    idFactory = () => crypto.randomUUID(),
  } = options;

  let selectedKeySet: Set<string> | null = null;
  if (templateTaskKeys !== undefined) {
    if (!Array.isArray(templateTaskKeys)) {
      return {
        ok: false,
        status: 400,
        error: 'Pole templateTaskKeys musi być tablicą kluczy zadań szablonu.',
      };
    }
    selectedKeySet = new Set<string>();
    for (const rawKey of templateTaskKeys) {
      if (typeof rawKey !== 'string') {
        return {
          ok: false,
          status: 400,
          error: 'Wszystkie elementy templateTaskKeys muszą być ciągami znaków.',
        };
      }
      const trimmed = rawKey.trim();
      if (trimmed) {
        selectedKeySet.add(trimmed);
      }
    }
  }

  const allBlueprints = Array.isArray(template.tasks) ? template.tasks : [];
  const filteredBlueprints = filterBlueprintsWithParentCascade(allBlueprints, selectedKeySet);
  if (filteredBlueprints.length === 0) {
    return { ok: true, tasks: [] };
  }

  const byKey = new Map<string, TemplateTaskBlueprint>();
  const keyToOriginalIdx = new Map<string, number>();
  const keyToTaskId = new Map<string, string>();

  filteredBlueprints.forEach((bp, idx) => {
    byKey.set(bp.key, bp);
    keyToOriginalIdx.set(bp.key, idx);
    keyToTaskId.set(bp.key, idFactory());
  });

  // Sortowanie gwarantujące utworzenie rodziców przed podzadaniami
  const orderedBlueprints = [...filteredBlueprints].sort((a, b) => {
    const dA = getBlueprintDepth(byKey, a.key);
    const dB = getBlueprintDepth(byKey, b.key);
    if (dA !== dB) return dA - dB;
    return (keyToOriginalIdx.get(a.key) ?? 0) - (keyToOriginalIdx.get(b.key) ?? 0);
  });

  const builtTasks: Task[] = [];
  const baseStartDate = isValidIsoDateString(project.startDate)
    ? project.startDate
    : nowIso.slice(0, 10);

  for (let idx = 0; idx < orderedBlueprints.length; idx += 1) {
    const bp = orderedBlueprints[idx];
    const taskId = keyToTaskId.get(bp.key)!;
    const offsetDays = Math.max(0, Math.round(bp.offsetDays || 0));
    const durationDays = Math.max(1, Math.round(bp.durationDays || 1));
    const startDate = addDaysUtc(baseStartDate, offsetDays);
    const dueDate = addDaysUtc(startDate, durationDays - 1);

    const parentId =
      bp.parentKey && keyToTaskId.has(bp.parentKey)
        ? keyToTaskId.get(bp.parentKey)
        : undefined;

    if (parentId) {
      const parentCheck = canReparent(builtTasks, null, parentId, project.id);
      if (!parentCheck.ok) {
        return {
          ok: false,
          status: 400,
          error: parentCheck.error || 'Nieprawidłowa hierarchia zadań w szablonie.',
        };
      }
    }

    const mappedBlockers = (bp.blockerKeys || [])
      .map((bKey) => keyToTaskId.get(bKey))
      .filter((id): id is string => Boolean(id && id !== taskId));

    const uniqueBlockers = Array.from(new Set(mappedBlockers));
    const status = uniqueBlockers.length > 0 ? 'blocked' : 'to_do';

    let assigneeId: string | undefined;
    if (bp.assigneeRole === 'owner') {
      assigneeId = project.ownerId || undefined;
    } else if (bp.assigneeRole === 'reporter') {
      assigneeId = caller.id;
    }

    const code = generateTaskCode(project.key, existingProjectTasksCount + idx);

    try {
      const taskRecord = buildNewTaskRecord({
        allowed: {
          title: bp.title,
          description: bp.description || '',
          type: bp.type || 'task',
          priority: bp.priority || 'normal',
          status,
          ...(assigneeId ? { assigneeId } : {}),
          ...(parentId ? { parentId } : {}),
          startDate,
          dueDate,
          durationDays,
          ...(bp.isOfficialDeadline ? { isOfficialDeadline: true } : {}),
          ...(bp.estimatedHours !== undefined ? { estimatedHours: bp.estimatedHours } : {}),
          spentHours: 0,
          progress: 0,
          blockingTaskIds: uniqueBlockers,
          dependencies: uniqueBlockers,
          tags: Array.isArray(bp.tags) ? [...bp.tags] : [],
        },
        caller,
        projectId: project.id,
        reporterId: caller.id,
        projectKey: project.key,
        existingCount: existingProjectTasksCount + idx,
        id: taskId,
        code,
        now: nowIso,
      }) as Task;

      builtTasks.push(taskRecord);
    } catch (err: any) {
      return {
        ok: false,
        status: 400,
        error: err?.message || `Błąd przygotowania zadania "${bp.title}" z szablonu.`,
      };
    }
  }

  return { ok: true, tasks: builtTasks };
}
