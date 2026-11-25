import type {
  ProjectMetaColorKey,
  ProjectPriorityOption,
  ProjectStatusOption,
} from '../types/index.js';

export const PROJECT_META_LABEL_MAX = 40;
export const PROJECT_META_ID_MAX = 50;
export const PROJECT_META_MAX_ITEMS = 20;

export interface ProjectMetaColorDef {
  key: ProjectMetaColorKey;
  label: string;
  swatchHex: string;
  badgeClass: string;
  activeFilterClass: string;
  idleFilterClass: string;
  textClass: string;
  barClass: string;
}

export const PROJECT_META_PALETTE: readonly ProjectMetaColorDef[] = [
  {
    key: 'sky',
    label: 'Błękitny',
    swatchHex: '#0284c7',
    badgeClass:
      'bg-sky-100 text-sky-900 border-sky-300 dark:bg-sky-950/70 dark:text-sky-200 dark:border-sky-800',
    activeFilterClass: 'bg-sky-700 text-white border-sky-700',
    idleFilterClass:
      'bg-sky-50 dark:bg-sky-950/40 text-sky-800 dark:text-sky-200 border border-sky-200 dark:border-sky-900/50 hover:bg-sky-100 dark:hover:bg-sky-900/50',
    textClass: 'text-sky-700 dark:text-sky-400 font-medium',
    barClass: 'bg-sky-500',
  },
  {
    key: 'emerald',
    label: 'Zielony',
    swatchHex: '#059669',
    badgeClass:
      'bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-950/70 dark:text-emerald-200 dark:border-emerald-800',
    activeFilterClass: 'bg-emerald-700 text-white border-emerald-700',
    idleFilterClass:
      'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-900/50 hover:bg-emerald-100 dark:hover:bg-emerald-900/50',
    textClass: 'text-emerald-700 dark:text-emerald-400 font-semibold',
    barClass: 'bg-emerald-500',
  },
  {
    key: 'amber',
    label: 'Bursztynowy',
    swatchHex: '#d97706',
    badgeClass:
      'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950/70 dark:text-amber-200 dark:border-amber-800',
    activeFilterClass: 'bg-amber-700 text-white border-amber-700',
    idleFilterClass:
      'bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 border border-amber-200 dark:border-amber-900/50 hover:bg-amber-100 dark:hover:bg-amber-900/50',
    textClass: 'text-amber-700 dark:text-amber-400 font-semibold',
    barClass: 'bg-amber-500',
  },
  {
    key: 'orange',
    label: 'Pomarańczowy',
    swatchHex: '#ea580c',
    badgeClass:
      'bg-orange-100 text-orange-900 border-orange-300 dark:bg-orange-950/70 dark:text-orange-200 dark:border-orange-800',
    activeFilterClass: 'bg-orange-700 text-white border-orange-700',
    idleFilterClass:
      'bg-orange-50 dark:bg-orange-950/40 text-orange-800 dark:text-orange-200 border border-orange-200 dark:border-orange-900/50 hover:bg-orange-100 dark:hover:bg-orange-900/50',
    textClass: 'text-orange-700 dark:text-orange-400 font-semibold',
    barClass: 'bg-orange-500',
  },
  {
    key: 'rose',
    label: 'Czerwony',
    swatchHex: '#e11d48',
    badgeClass:
      'bg-rose-100 text-rose-900 border-rose-300 dark:bg-rose-950/70 dark:text-rose-200 dark:border-rose-800',
    activeFilterClass: 'bg-rose-700 text-white border-rose-700',
    idleFilterClass:
      'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 border border-rose-200 dark:border-rose-900/50 hover:bg-rose-100 dark:hover:bg-rose-900/50',
    textClass: 'text-rose-700 dark:text-rose-400 font-bold',
    barClass: 'bg-rose-500',
  },
  {
    key: 'indigo',
    label: 'Indygo',
    swatchHex: '#4f46e5',
    badgeClass:
      'bg-indigo-100 text-indigo-900 border-indigo-300 dark:bg-indigo-950/70 dark:text-indigo-200 dark:border-indigo-800',
    activeFilterClass: 'bg-indigo-700 text-white border-indigo-700',
    idleFilterClass:
      'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-800 dark:text-indigo-200 border border-indigo-200 dark:border-indigo-900/50 hover:bg-indigo-100 dark:hover:bg-indigo-900/50',
    textClass: 'text-indigo-700 dark:text-indigo-400 font-semibold',
    barClass: 'bg-indigo-500',
  },
  {
    key: 'purple',
    label: 'Fioletowy',
    swatchHex: '#9333ea',
    badgeClass:
      'bg-purple-100 text-purple-900 border-purple-300 dark:bg-purple-950/70 dark:text-purple-200 dark:border-purple-800',
    activeFilterClass: 'bg-purple-700 text-white border-purple-700',
    idleFilterClass:
      'bg-purple-50 dark:bg-purple-950/40 text-purple-800 dark:text-purple-200 border border-purple-200 dark:border-purple-900/50 hover:bg-purple-100 dark:hover:bg-purple-900/50',
    textClass: 'text-purple-700 dark:text-purple-400 font-semibold',
    barClass: 'bg-purple-500',
  },
  {
    key: 'slate',
    label: 'Szary',
    swatchHex: '#64748b',
    badgeClass:
      'bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700',
    activeFilterClass: 'bg-slate-700 text-white border-slate-700',
    idleFilterClass:
      'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700',
    textClass: 'text-slate-600 dark:text-slate-400 font-normal',
    barClass: 'bg-slate-500',
  },
] as const;

export const VALID_PROJECT_META_COLORS = new Set<ProjectMetaColorKey>(
  PROJECT_META_PALETTE.map((c) => c.key)
);

const PALETTE_BY_KEY = new Map<ProjectMetaColorKey, ProjectMetaColorDef>(
  PROJECT_META_PALETTE.map((c) => [c.key, c])
);

export const SYSTEM_PROJECT_STATUS_IDS = new Set([
  'planning',
  'active',
  'on_hold',
  'completed',
]);

export const SYSTEM_PROJECT_PRIORITY_IDS = new Set([
  'low',
  'normal',
  'high',
  'critical',
]);

export const DEFAULT_PROJECT_STATUSES: ProjectStatusOption[] = [
  {
    id: 'planning',
    label: 'Planowanie',
    color: 'sky',
    order: 1,
    isDefault: true,
    isClosed: false,
    isSystem: true,
  },
  {
    id: 'active',
    label: 'Aktywny',
    color: 'emerald',
    order: 2,
    isDefault: false,
    isClosed: false,
    isSystem: true,
  },
  {
    id: 'on_hold',
    label: 'Wstrzymany',
    color: 'amber',
    order: 3,
    isDefault: false,
    isClosed: false,
    isSystem: true,
  },
  {
    id: 'completed',
    label: 'Zakończony',
    color: 'slate',
    order: 4,
    isDefault: false,
    isClosed: true,
    isSystem: true,
  },
];

export const DEFAULT_PROJECT_PRIORITIES: ProjectPriorityOption[] = [
  {
    id: 'low',
    label: 'Niski',
    color: 'slate',
    order: 1,
    isDefault: false,
    isSystem: true,
  },
  {
    id: 'normal',
    label: 'Normalny',
    color: 'sky',
    order: 2,
    isDefault: true,
    isSystem: true,
  },
  {
    id: 'high',
    label: 'Wysoki',
    color: 'orange',
    order: 3,
    isDefault: false,
    isSystem: true,
  },
  {
    id: 'critical',
    label: 'Krytyczny',
    color: 'rose',
    order: 4,
    isDefault: false,
    isSystem: true,
  },
];

export function getPaletteDef(color?: string): ProjectMetaColorDef {
  if (color && VALID_PROJECT_META_COLORS.has(color as ProjectMetaColorKey)) {
    return PALETTE_BY_KEY.get(color as ProjectMetaColorKey)!;
  }
  return PALETTE_BY_KEY.get('slate')!;
}

export function slugifyProjectMetaId(label: string, prefix: string): string {
  const ascii = label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[łŁ]/g, 'l')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const base = ascii || prefix;
  return base.slice(0, PROJECT_META_ID_MAX);
}

export function normalizeProjectStatuses(raw: unknown): ProjectStatusOption[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return DEFAULT_PROJECT_STATUSES.map((s) => ({ ...s }));
  }

  const byId = new Map<string, ProjectStatusOption>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rawObj = item as Record<string, any>;
    const id = typeof rawObj.id === 'string' ? rawObj.id.trim().slice(0, PROJECT_META_ID_MAX) : '';
    const label =
      typeof rawObj.label === 'string' ? rawObj.label.trim().slice(0, PROJECT_META_LABEL_MAX) : '';
    if (!id || !label || byId.has(id)) continue;

    const defFallback = DEFAULT_PROJECT_STATUSES.find((d) => d.id === id);
    const color: ProjectMetaColorKey = VALID_PROJECT_META_COLORS.has(rawObj.color)
      ? rawObj.color
      : defFallback?.color || 'slate';
    const order =
      typeof rawObj.order === 'number' && Number.isInteger(rawObj.order)
        ? rawObj.order
        : defFallback?.order ?? byId.size + 1;
    const isSystem = SYSTEM_PROJECT_STATUS_IDS.has(id) || Boolean(rawObj.isSystem);
    const isClosed =
      typeof rawObj.isClosed === 'boolean' ? rawObj.isClosed : Boolean(defFallback?.isClosed);

    byId.set(id, {
      id,
      label,
      color,
      order,
      isDefault: Boolean(rawObj.isDefault),
      isClosed,
      ...(isSystem ? { isSystem: true } : {}),
    });
  }

  // Zapewnij obecność wszystkich systemowych stanów (kompatybilność wsteczna)
  for (const sys of DEFAULT_PROJECT_STATUSES) {
    if (!byId.has(sys.id)) {
      byId.set(sys.id, { ...sys });
    }
  }

  const list = Array.from(byId.values()).sort(
    (a, b) => a.order - b.order || a.label.localeCompare(b.label, 'pl')
  );

  // Upewnij się, że dokładnie jeden element ma isDefault = true
  let foundDefault = false;
  for (const item of list) {
    if (item.isDefault && !foundDefault) {
      foundDefault = true;
    } else {
      item.isDefault = false;
    }
  }
  if (!foundDefault && list.length > 0) {
    const planning = list.find((item) => item.id === 'planning') || list[0];
    planning.isDefault = true;
  }

  return list;
}

export function normalizeProjectPriorities(raw: unknown): ProjectPriorityOption[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return DEFAULT_PROJECT_PRIORITIES.map((p) => ({ ...p }));
  }

  const byId = new Map<string, ProjectPriorityOption>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rawObj = item as Record<string, any>;
    const id = typeof rawObj.id === 'string' ? rawObj.id.trim().slice(0, PROJECT_META_ID_MAX) : '';
    const label =
      typeof rawObj.label === 'string' ? rawObj.label.trim().slice(0, PROJECT_META_LABEL_MAX) : '';
    if (!id || !label || byId.has(id)) continue;

    const defFallback = DEFAULT_PROJECT_PRIORITIES.find((d) => d.id === id);
    const color: ProjectMetaColorKey = VALID_PROJECT_META_COLORS.has(rawObj.color)
      ? rawObj.color
      : defFallback?.color || 'slate';
    const order =
      typeof rawObj.order === 'number' && Number.isInteger(rawObj.order)
        ? rawObj.order
        : defFallback?.order ?? byId.size + 1;
    const isSystem = SYSTEM_PROJECT_PRIORITY_IDS.has(id) || Boolean(rawObj.isSystem);

    byId.set(id, {
      id,
      label,
      color,
      order,
      isDefault: Boolean(rawObj.isDefault),
      ...(isSystem ? { isSystem: true } : {}),
    });
  }

  for (const sys of DEFAULT_PROJECT_PRIORITIES) {
    if (!byId.has(sys.id)) {
      byId.set(sys.id, { ...sys });
    }
  }

  const list = Array.from(byId.values()).sort(
    (a, b) => a.order - b.order || a.label.localeCompare(b.label, 'pl')
  );

  let foundDefault = false;
  for (const item of list) {
    if (item.isDefault && !foundDefault) {
      foundDefault = true;
    } else {
      item.isDefault = false;
    }
  }
  if (!foundDefault && list.length > 0) {
    const normal = list.find((item) => item.id === 'normal') || list[0];
    normal.isDefault = true;
  }

  return list;
}

export function getOrderedProjectStatuses(
  statuses?: ProjectStatusOption[] | null
): ProjectStatusOption[] {
  const source =
    Array.isArray(statuses) && statuses.length > 0 ? statuses : DEFAULT_PROJECT_STATUSES;
  return [...source].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.label.localeCompare(b.label, 'pl')
  );
}

export function getOrderedProjectPriorities(
  priorities?: ProjectPriorityOption[] | null
): ProjectPriorityOption[] {
  const source =
    Array.isArray(priorities) && priorities.length > 0 ? priorities : DEFAULT_PROJECT_PRIORITIES;
  return [...source].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.label.localeCompare(b.label, 'pl')
  );
}

export function getDefaultProjectStatusId(statuses?: ProjectStatusOption[] | null): string {
  const ordered = getOrderedProjectStatuses(statuses);
  return ordered.find((s) => s.isDefault)?.id || ordered[0]?.id || 'planning';
}

export function getDefaultProjectPriorityId(priorities?: ProjectPriorityOption[] | null): string {
  const ordered = getOrderedProjectPriorities(priorities);
  return ordered.find((p) => p.isDefault)?.id || ordered[0]?.id || 'normal';
}

export function resolveProjectStatus(
  statusId: string | undefined | null,
  statuses?: ProjectStatusOption[] | null
): {
  id: string;
  label: string;
  color: ProjectMetaColorKey;
  isClosed: boolean;
  badgeClass: string;
  textClass: string;
  barClass: string;
} {
  const ordered = getOrderedProjectStatuses(statuses);
  const id = typeof statusId === 'string' && statusId.trim() ? statusId.trim() : 'planning';
  const match =
    ordered.find((s) => s.id === id) ||
    DEFAULT_PROJECT_STATUSES.find((s) => s.id === id);
  const color: ProjectMetaColorKey = match?.color || 'slate';
  const palette = getPaletteDef(color);
  return {
    id,
    label: match?.label || id,
    color,
    isClosed: match ? Boolean(match.isClosed) : id === 'completed',
    badgeClass: palette.badgeClass,
    textClass: palette.textClass,
    barClass: palette.barClass,
  };
}

export function resolveProjectPriority(
  priorityId: string | undefined | null,
  priorities?: ProjectPriorityOption[] | null
): {
  id: string;
  label: string;
  color: ProjectMetaColorKey;
  order: number;
  badgeClass: string;
  textClass: string;
  barClass: string;
} {
  const ordered = getOrderedProjectPriorities(priorities);
  const id = typeof priorityId === 'string' && priorityId.trim() ? priorityId.trim() : 'normal';
  const match =
    ordered.find((p) => p.id === id) ||
    DEFAULT_PROJECT_PRIORITIES.find((p) => p.id === id);
  const color: ProjectMetaColorKey = match?.color || 'slate';
  const palette = getPaletteDef(color);
  return {
    id,
    label: match?.label || id,
    color,
    order: match?.order ?? 99,
    badgeClass: palette.badgeClass,
    textClass: palette.textClass,
    barClass: palette.barClass,
  };
}

export function isProjectStatusClosed(
  statusId: string | undefined | null,
  statuses?: ProjectStatusOption[] | null
): boolean {
  if (!statusId) return false;
  const source =
    Array.isArray(statuses) && statuses.length > 0 ? statuses : DEFAULT_PROJECT_STATUSES;
  const match = source.find((s) => s.id === statusId);
  if (match) {
    return Boolean(match.isClosed);
  }
  return statusId === 'completed';
}
