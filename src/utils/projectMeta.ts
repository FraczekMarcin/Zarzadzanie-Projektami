import type {
  LegacyTemplateCategory,
  ProjectDeliverable,
  ProjectMetaColorKey,
  ProjectPriorityOption,
  ProjectStatusOption,
  ProjectSubtypeOption,
  ProjectTypeOption,
  TemplateDeliverableBlueprint,
} from '../types/index.js';
import { hasForbiddenKeys } from './access.js';

export const PROJECT_META_LABEL_MAX = 40;
export const PROJECT_META_ID_MAX = 50;
export const PROJECT_META_MAX_ITEMS = 20;

export const PROJECT_TYPE_LABEL_MAX = 60;
export const PROJECT_TYPE_ID_MAX = 50;
export const PROJECT_TYPE_MAX_ITEMS = 30;
export const PROJECT_SUBTYPE_MAX_ITEMS = 30;
export const SHORT_NAME_MAX = 60;

export const DELIVERABLE_LIMITS = {
  maxItems: 100,
  idMax: 100,
  nameMax: 200,
  copiesMin: 1,
  copiesMax: 999,
  defaultCopies: 1,
  unitMax: 20,
  defaultUnit: 'egz.',
  notesMax: 500,
} as const;

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

export const DEFAULT_PROJECT_TYPES: ProjectTypeOption[] = [
  {
    id: 'projekt_budowlany',
    label: 'Projekt Budowlany',
    color: 'sky',
    order: 1,
    isActive: true,
    subtypes: [],
  },
  {
    id: 'zgloszenie',
    label: 'Zgłoszenie',
    color: 'emerald',
    order: 2,
    isActive: true,
    subtypes: [],
  },
  {
    id: 'zrid',
    label: 'ZRID',
    color: 'indigo',
    order: 3,
    isActive: true,
    subtypes: [],
  },
  {
    id: 'uzgodnienie',
    label: 'Uzgodnienie',
    color: 'purple',
    order: 4,
    isActive: true,
    subtypes: [],
  },
  {
    id: 'zjazd_pd',
    label: 'Zjazd PD',
    color: 'amber',
    order: 5,
    isActive: true,
    subtypes: [],
  },
  {
    id: 'zjazd_dw',
    label: 'Zjazd DW',
    color: 'orange',
    order: 6,
    isActive: true,
    subtypes: [],
  },
  {
    id: 'organizacja_ruchu',
    label: 'Organizacja ruchu',
    color: 'rose',
    order: 7,
    isActive: true,
    subtypes: [],
  },
  {
    id: 'kosztorys',
    label: 'Kosztorys',
    color: 'emerald',
    order: 8,
    isActive: true,
    subtypes: [],
  },
  {
    id: 'inne',
    label: 'Inne',
    color: 'slate',
    order: 9,
    isActive: true,
    subtypes: [],
  },
];

export const LEGACY_TEMPLATE_CATEGORY_MAP: Record<LegacyTemplateCategory, string> = {
  kubaturowe: 'projekt_budowlany',
  mieszkaniowe: 'projekt_budowlany',
  przemyslowe: 'projekt_budowlany',
  przebudowa: 'projekt_budowlany',
  infrastruktura: 'zrid',
  ogolne: 'inne',
};

export function mapLegacyTemplateCategory(
  rawCategory: unknown,
  allowedTypeIds?: ReadonlySet<string>
): string {
  const key = typeof rawCategory === 'string' ? rawCategory.trim().toLowerCase() : '';
  const mapped =
    (LEGACY_TEMPLATE_CATEGORY_MAP as Record<string, string>)[key] || 'inne';
  if (allowedTypeIds && !allowedTypeIds.has(mapped)) {
    return allowedTypeIds.has('inne') ? 'inne' : Array.from(allowedTypeIds)[0] || 'inne';
  }
  return mapped;
}

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

export function normalizeProjectTypes(raw: unknown): ProjectTypeOption[] {
  // Jeśli w starszym app_state.json nie ma pola projectTypes — uzupełnij domyślnymi 9 rodzajami.
  // Jeśli tablica została jawnie przekazana (w tym pusta [] po celowym usunięciu wszystkich), zachowaj ją.
  if (!Array.isArray(raw)) {
    return DEFAULT_PROJECT_TYPES.map((t) => ({
      ...t,
      subtypes: t.subtypes.map((s) => ({ ...s })),
    }));
  }

  const byId = new Map<string, ProjectTypeOption>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rawObj = item as Record<string, any>;
    const id = typeof rawObj.id === 'string' ? rawObj.id.trim().slice(0, PROJECT_TYPE_ID_MAX) : '';
    const label =
      typeof rawObj.label === 'string' ? rawObj.label.trim().slice(0, PROJECT_TYPE_LABEL_MAX) : '';
    if (!id || !label || byId.has(id)) continue;

    const defFallback = DEFAULT_PROJECT_TYPES.find((d) => d.id === id);
    const color: ProjectMetaColorKey = VALID_PROJECT_META_COLORS.has(rawObj.color)
      ? rawObj.color
      : defFallback?.color || 'slate';
    const order =
      typeof rawObj.order === 'number' && Number.isInteger(rawObj.order)
        ? rawObj.order
        : defFallback?.order ?? byId.size + 1;
    const isActive = typeof rawObj.isActive === 'boolean' ? rawObj.isActive : true;

    const subtypesById = new Map<string, ProjectSubtypeOption>();
    if (Array.isArray(rawObj.subtypes)) {
      for (const subItem of rawObj.subtypes) {
        if (!subItem || typeof subItem !== 'object') continue;
        const subObj = subItem as Record<string, any>;
        const subId =
          typeof subObj.id === 'string' ? subObj.id.trim().slice(0, PROJECT_TYPE_ID_MAX) : '';
        const subLabel =
          typeof subObj.label === 'string'
            ? subObj.label.trim().slice(0, PROJECT_TYPE_LABEL_MAX)
            : '';
        if (!subId || !subLabel || subtypesById.has(subId)) continue;
        const subOrder =
          typeof subObj.order === 'number' && Number.isInteger(subObj.order)
            ? subObj.order
            : subtypesById.size + 1;
        const subActive = typeof subObj.isActive === 'boolean' ? subObj.isActive : true;
        subtypesById.set(subId, {
          id: subId,
          label: subLabel,
          order: subOrder,
          isActive: subActive,
        });
        if (subtypesById.size >= PROJECT_SUBTYPE_MAX_ITEMS) break;
      }
    }

    const sortedSubtypes = Array.from(subtypesById.values()).sort(
      (a, b) => a.order - b.order || a.label.localeCompare(b.label, 'pl')
    );

    byId.set(id, {
      id,
      label,
      color,
      order,
      isActive,
      subtypes: sortedSubtypes,
    });
    if (byId.size >= PROJECT_TYPE_MAX_ITEMS) break;
  }

  return Array.from(byId.values()).sort(
    (a, b) => a.order - b.order || a.label.localeCompare(b.label, 'pl')
  );
}

export function getOrderedProjectTypes(
  types?: ProjectTypeOption[] | null,
  options?: { activeOnly?: boolean }
): ProjectTypeOption[] {
  const source = Array.isArray(types) ? types : DEFAULT_PROJECT_TYPES;
  const filtered = options?.activeOnly ? source.filter((t) => t && t.isActive !== false) : source;
  return [...filtered].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.label.localeCompare(b.label, 'pl')
  );
}

export function getOrderedProjectSubtypes(
  projectType: ProjectTypeOption | null | undefined,
  options?: { activeOnly?: boolean }
): ProjectSubtypeOption[] {
  if (!projectType || !Array.isArray(projectType.subtypes)) return [];
  const filtered = options?.activeOnly
    ? projectType.subtypes.filter((s) => s && s.isActive !== false)
    : projectType.subtypes;
  return [...filtered].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.label.localeCompare(b.label, 'pl')
  );
}

export function resolveProjectType(
  typeId: string | undefined | null,
  types?: ProjectTypeOption[] | null
): {
  id: string;
  label: string;
  color: ProjectMetaColorKey;
  hasType: boolean;
  badgeClass: string;
  textClass: string;
  barClass: string;
} {
  const cleanId = typeof typeId === 'string' ? typeId.trim() : '';
  if (!cleanId) {
    const slate = getPaletteDef('slate');
    return {
      id: '',
      label: 'Brak',
      color: 'slate',
      hasType: false,
      badgeClass: slate.badgeClass,
      textClass: slate.textClass,
      barClass: slate.barClass,
    };
  }
  const source = Array.isArray(types) ? types : DEFAULT_PROJECT_TYPES;
  const match =
    source.find((t) => t.id === cleanId) || DEFAULT_PROJECT_TYPES.find((t) => t.id === cleanId);
  const color: ProjectMetaColorKey = match?.color || 'slate';
  const palette = getPaletteDef(color);
  return {
    id: cleanId,
    label: match?.label || cleanId,
    color,
    hasType: true,
    badgeClass: palette.badgeClass,
    textClass: palette.textClass,
    barClass: palette.barClass,
  };
}

export function resolveProjectSubtype(
  typeId: string | undefined | null,
  subtypeId: string | undefined | null,
  types?: ProjectTypeOption[] | null
): { id: string; label: string } | null {
  const cleanTypeId = typeof typeId === 'string' ? typeId.trim() : '';
  const cleanSubId = typeof subtypeId === 'string' ? subtypeId.trim() : '';
  if (!cleanTypeId || !cleanSubId) return null;
  const source = Array.isArray(types) ? types : DEFAULT_PROJECT_TYPES;
  const typeMatch = source.find((t) => t.id === cleanTypeId);
  const subMatch = typeMatch?.subtypes?.find((s) => s.id === cleanSubId);
  return {
    id: cleanSubId,
    label: subMatch?.label || cleanSubId,
  };
}

export function getProjectDisplayName(
  project: { name?: string | null; shortName?: string | null } | null | undefined
): string {
  if (!project) return '';
  const short = typeof project.shortName === 'string' ? project.shortName.trim() : '';
  if (short) return short;
  return typeof project.name === 'string' ? project.name : '';
}

export function hasDistinctShortName(
  project: { name?: string | null; shortName?: string | null } | null | undefined
): boolean {
  if (!project) return false;
  const short = typeof project.shortName === 'string' ? project.shortName.trim() : '';
  const full = typeof project.name === 'string' ? project.name.trim() : '';
  return Boolean(short && full && short !== full);
}

export function compareProjectDisplayNames(
  a: { name?: string | null; shortName?: string | null } | null | undefined,
  b: { name?: string | null; shortName?: string | null } | null | undefined
): number {
  const nameA = getProjectDisplayName(a).toLowerCase();
  const nameB = getProjectDisplayName(b).toLowerCase();
  const cmp = nameA.localeCompare(nameB, 'pl', { sensitivity: 'base' });
  if (cmp !== 0) return cmp;
  const fullA = (typeof a?.name === 'string' ? a.name : '').toLowerCase();
  const fullB = (typeof b?.name === 'string' ? b.name : '').toLowerCase();
  return fullA.localeCompare(fullB, 'pl', { sensitivity: 'base' });
}

export function matchesProjectSearch(
  project:
    | { key?: string | null; name?: string | null; shortName?: string | null; clientName?: string | null }
    | null
    | undefined,
  rawQuery: string,
  options?: { includeClientName?: boolean }
): boolean {
  if (!project) return false;
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;
  if (typeof project.name === 'string' && project.name.toLowerCase().includes(q)) return true;
  if (typeof project.shortName === 'string' && project.shortName.toLowerCase().includes(q)) return true;
  if (typeof project.key === 'string' && project.key.toLowerCase().includes(q)) return true;
  if (
    options?.includeClientName &&
    typeof project.clientName === 'string' &&
    project.clientName.toLowerCase().includes(q)
  ) {
    return true;
  }
  return false;
}

export function getDeliverablesSummary(
  deliverables?: readonly ProjectDeliverable[] | null
): { done: number; total: number; percent: number; label: string } {
  if (!Array.isArray(deliverables) || deliverables.length === 0) {
    return { done: 0, total: 0, percent: 0, label: 'Wykonano 0 z 0' };
  }
  let done = 0;
  for (const item of deliverables) {
    if (item && item.isDone) done += 1;
  }
  const total = deliverables.length;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  return {
    done,
    total,
    percent,
    label: `Wykonano ${done} z ${total}`,
  };
}

function generateDeliverableId(): string {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return `del-${globalThis.crypto.randomUUID()}`;
  }
  return `del-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function validateProjectDeliverables(
  raw: unknown,
  options?: {
    existingDeliverables?: readonly ProjectDeliverable[] | null;
    actorName?: string;
    nowIso?: string;
  }
):
  | { ok: true; deliverables: ProjectDeliverable[] }
  | { ok: false; error: string; field: 'deliverables' } {
  if (raw === null || raw === undefined) {
    return { ok: true, deliverables: [] };
  }
  if (!Array.isArray(raw)) {
    return {
      ok: false,
      error: 'Pole deliverables (elementy do odbioru) musi być tablicą.',
      field: 'deliverables',
    };
  }
  if (raw.length > DELIVERABLE_LIMITS.maxItems) {
    return {
      ok: false,
      error: `Projekt może zawierać maksymalnie ${DELIVERABLE_LIMITS.maxItems} elementów do odbioru.`,
      field: 'deliverables',
    };
  }

  const prevById = new Map<string, ProjectDeliverable>();
  if (Array.isArray(options?.existingDeliverables)) {
    for (const prev of options.existingDeliverables) {
      if (prev && typeof prev.id === 'string' && prev.id) {
        prevById.set(prev.id, prev);
      }
    }
  }

  const nowIso = options?.nowIso || new Date().toISOString();
  const actorName = (options?.actorName || '').trim() || 'Użytkownik';
  const seenIds = new Set<string>();
  const normalized: ProjectDeliverable[] = [];

  for (let i = 0; i < raw.length; i += 1) {
    const item = raw[i];
    if (!item || typeof item !== 'object' || Array.isArray(item) || hasForbiddenKeys(item)) {
      return {
        ok: false,
        error: `Nieprawidłowy format elementu do odbioru na pozycji ${i + 1}.`,
        field: 'deliverables',
      };
    }

    const obj = item as Record<string, unknown>;
    if (typeof obj.name !== 'string' || !obj.name.trim()) {
      return {
        ok: false,
        error: `Nazwa elementu do odbioru na pozycji ${i + 1} nie może być pusta.`,
        field: 'deliverables',
      };
    }
    const name = obj.name.trim();
    if (name.length > DELIVERABLE_LIMITS.nameMax) {
      return {
        ok: false,
        error: `Nazwa elementu do odbioru nie może przekraczać ${DELIVERABLE_LIMITS.nameMax} znaków.`,
        field: 'deliverables',
      };
    }

    let copies: number = DELIVERABLE_LIMITS.defaultCopies;
    if (obj.copies !== undefined && obj.copies !== null && obj.copies !== '') {
      if (
        typeof obj.copies !== 'number' ||
        !Number.isInteger(obj.copies) ||
        obj.copies < DELIVERABLE_LIMITS.copiesMin ||
        obj.copies > DELIVERABLE_LIMITS.copiesMax
      ) {
        return {
          ok: false,
          error: `Liczba egzemplarzy musi być liczbą całkowitą z zakresu ${DELIVERABLE_LIMITS.copiesMin}–${DELIVERABLE_LIMITS.copiesMax}.`,
          field: 'deliverables',
        };
      }
      copies = obj.copies;
    }

    let unit: string = DELIVERABLE_LIMITS.defaultUnit;
    if (obj.unit !== undefined && obj.unit !== null && obj.unit !== '') {
      if (typeof obj.unit !== 'string') {
        return {
          ok: false,
          error: 'Jednostka elementu do odbioru musi być tekstem.',
          field: 'deliverables',
        };
      }
      const trimmedUnit = obj.unit.trim();
      if (trimmedUnit.length > DELIVERABLE_LIMITS.unitMax) {
        return {
          ok: false,
          error: `Jednostka elementu do odbioru nie może przekraczać ${DELIVERABLE_LIMITS.unitMax} znaków.`,
          field: 'deliverables',
        };
      }
      if (trimmedUnit) {
        unit = trimmedUnit;
      }
    }

    let notes: string | undefined;
    if (obj.notes !== undefined && obj.notes !== null && obj.notes !== '') {
      if (typeof obj.notes !== 'string') {
        return {
          ok: false,
          error: 'Notatka elementu do odbioru musi być tekstem.',
          field: 'deliverables',
        };
      }
      const trimmedNotes = obj.notes.trim();
      if (trimmedNotes.length > DELIVERABLE_LIMITS.notesMax) {
        return {
          ok: false,
          error: `Notatka elementu do odbioru nie może przekraczać ${DELIVERABLE_LIMITS.notesMax} znaków.`,
          field: 'deliverables',
        };
      }
      if (trimmedNotes) {
        notes = trimmedNotes;
      }
    }

    let id =
      typeof obj.id === 'string' && obj.id.trim()
        ? obj.id.trim().slice(0, DELIVERABLE_LIMITS.idMax)
        : generateDeliverableId();
    if (seenIds.has(id)) {
      return {
        ok: false,
        error: `Zduplikowany identyfikator elementu do odbioru "${id}".`,
        field: 'deliverables',
      };
    }
    seenIds.add(id);

    if (obj.isDone !== undefined && typeof obj.isDone !== 'boolean') {
      return {
        ok: false,
        error: `Pole isDone elementu "${name}" musi być wartością logiczną.`,
        field: 'deliverables',
      };
    }

    const isDone = obj.isDone === true;
    const prev = prevById.get(id);
    let doneAt: string | undefined;
    let doneBy: string | undefined;

    if (isDone) {
      if (prev && prev.isDone) {
        doneAt = prev.doneAt || nowIso;
        doneBy = prev.doneBy || actorName;
      } else {
        doneAt = nowIso;
        doneBy = actorName;
      }
    }

    normalized.push({
      id,
      name,
      copies,
      unit,
      isDone,
      ...(doneAt ? { doneAt } : {}),
      ...(doneBy ? { doneBy } : {}),
      ...(notes ? { notes } : {}),
    });
  }

  return { ok: true, deliverables: normalized };
}

export function validateTemplateDeliverables(
  raw: unknown
):
  | { ok: true; deliverables: TemplateDeliverableBlueprint[] }
  | { ok: false; error: string; field: 'deliverables' } {
  if (raw === null || raw === undefined) {
    return { ok: true, deliverables: [] };
  }
  if (!Array.isArray(raw)) {
    return {
      ok: false,
      error: 'Lista domyślnych elementów do odbioru szablonu musi być tablicą.',
      field: 'deliverables',
    };
  }
  if (raw.length > DELIVERABLE_LIMITS.maxItems) {
    return {
      ok: false,
      error: `Szablon może zawierać maksymalnie ${DELIVERABLE_LIMITS.maxItems} elementów do odbioru.`,
      field: 'deliverables',
    };
  }

  const seenIds = new Set<string>();
  const normalized: TemplateDeliverableBlueprint[] = [];

  for (let i = 0; i < raw.length; i += 1) {
    const item = raw[i];
    if (!item || typeof item !== 'object' || Array.isArray(item) || hasForbiddenKeys(item)) {
      return {
        ok: false,
        error: `Nieprawidłowy format elementu do odbioru nr ${i + 1} w szablonie.`,
        field: 'deliverables',
      };
    }
    const obj = item as Record<string, unknown>;
    if (typeof obj.name !== 'string' || !obj.name.trim()) {
      return {
        ok: false,
        error: `Nazwa elementu do odbioru nr ${i + 1} w szablonie jest wymagana.`,
        field: 'deliverables',
      };
    }
    const name = obj.name.trim();
    if (name.length > DELIVERABLE_LIMITS.nameMax) {
      return {
        ok: false,
        error: `Nazwa elementu do odbioru w szablonie nie może przekraczać ${DELIVERABLE_LIMITS.nameMax} znaków.`,
        field: 'deliverables',
      };
    }

    let copies: number = DELIVERABLE_LIMITS.defaultCopies;
    if (obj.copies !== undefined && obj.copies !== null && obj.copies !== '') {
      if (
        typeof obj.copies !== 'number' ||
        !Number.isInteger(obj.copies) ||
        obj.copies < DELIVERABLE_LIMITS.copiesMin ||
        obj.copies > DELIVERABLE_LIMITS.copiesMax
      ) {
        return {
          ok: false,
          error: `Liczba egzemplarzy w szablonie musi być liczbą całkowitą z zakresu ${DELIVERABLE_LIMITS.copiesMin}–${DELIVERABLE_LIMITS.copiesMax}.`,
          field: 'deliverables',
        };
      }
      copies = obj.copies;
    }

    let unit: string = DELIVERABLE_LIMITS.defaultUnit;
    if (obj.unit !== undefined && obj.unit !== null && obj.unit !== '') {
      if (typeof obj.unit !== 'string') {
        return {
          ok: false,
          error: 'Jednostka elementu do odbioru w szablonie musi być tekstem.',
          field: 'deliverables',
        };
      }
      const trimmedUnit = obj.unit.trim();
      if (trimmedUnit.length > DELIVERABLE_LIMITS.unitMax) {
        return {
          ok: false,
          error: `Jednostka elementu do odbioru w szablonie nie może przekraczać ${DELIVERABLE_LIMITS.unitMax} znaków.`,
          field: 'deliverables',
        };
      }
      if (trimmedUnit) {
        unit = trimmedUnit;
      }
    }

    let notes: string | undefined;
    if (obj.notes !== undefined && obj.notes !== null && obj.notes !== '') {
      if (typeof obj.notes !== 'string') {
        return {
          ok: false,
          error: 'Notatka elementu do odbioru w szablonie musi być tekstem.',
          field: 'deliverables',
        };
      }
      const trimmedNotes = obj.notes.trim();
      if (trimmedNotes.length > DELIVERABLE_LIMITS.notesMax) {
        return {
          ok: false,
          error: `Notatka elementu do odbioru w szablonie nie może przekraczać ${DELIVERABLE_LIMITS.notesMax} znaków.`,
          field: 'deliverables',
        };
      }
      if (trimmedNotes) {
        notes = trimmedNotes;
      }
    }

    const id =
      typeof obj.id === 'string' && obj.id.trim()
        ? obj.id.trim().slice(0, DELIVERABLE_LIMITS.idMax)
        : `tdel-${i + 1}`;
    if (seenIds.has(id)) {
      return {
        ok: false,
        error: `Zduplikowany identyfikator elementu do odbioru w szablonie: "${id}".`,
        field: 'deliverables',
      };
    }
    seenIds.add(id);

    normalized.push({
      id,
      name,
      copies,
      unit,
      ...(notes ? { notes } : {}),
    });
  }

  return { ok: true, deliverables: normalized };
}

export function copyTemplateDeliverablesToProject(
  blueprints?: readonly TemplateDeliverableBlueprint[] | null
): ProjectDeliverable[] {
  if (!Array.isArray(blueprints) || blueprints.length === 0) return [];
  return blueprints.slice(0, DELIVERABLE_LIMITS.maxItems).map((bp) => ({
    id: generateDeliverableId(),
    name: bp.name,
    copies:
      typeof bp.copies === 'number' && Number.isInteger(bp.copies)
        ? Math.min(DELIVERABLE_LIMITS.copiesMax, Math.max(DELIVERABLE_LIMITS.copiesMin, bp.copies))
        : DELIVERABLE_LIMITS.defaultCopies,
    unit: (typeof bp.unit === 'string' && bp.unit.trim()) || DELIVERABLE_LIMITS.defaultUnit,
    isDone: false,
    ...(bp.notes ? { notes: bp.notes } : {}),
  }));
}

export interface ProjectTypeUsageMatch {
  projects: Array<{ id: string; key: string; name: string }>;
  templates: Array<{ id: string; name: string; builtIn?: boolean }>;
  positionsCount: number;
}

export function findProjectTypeUsage(
  typeId: string,
  sources: {
    projects?: readonly any[] | null;
    templates?: readonly any[] | null;
    tenders?: readonly any[] | null;
  }
): ProjectTypeUsageMatch {
  const usingProjects: Array<{ id: string; key: string; name: string }> = [];
  const usingTemplates: Array<{ id: string; name: string; builtIn?: boolean }> = [];
  let positionsCount = 0;

  for (const p of sources.projects || []) {
    if (!p || typeof p !== 'object') continue;
    if (p.typeId === typeId) {
      usingProjects.push({ id: p.id, key: p.key || '', name: getProjectDisplayName(p) || p.name || '' });
    }
    for (const arrKey of ['costs', 'quotations', 'paymentTranches'] as const) {
      const arr = p[arrKey];
      if (!Array.isArray(arr)) continue;
      for (const item of arr) {
        if (item && item.typeId === typeId) positionsCount += 1;
      }
    }
  }

  for (const t of sources.tenders || []) {
    if (t && t.typeId === typeId) {
      positionsCount += 1;
    }
  }

  for (const tpl of sources.templates || []) {
    if (!tpl || typeof tpl !== 'object') continue;
    if (tpl.typeId === typeId) {
      usingTemplates.push({
        id: tpl.id,
        name: tpl.name || tpl.id,
        ...(tpl.builtIn ? { builtIn: true } : {}),
      });
    }
  }

  return { projects: usingProjects, templates: usingTemplates, positionsCount };
}

export function findProjectSubtypeUsage(
  typeId: string,
  subtypeId: string,
  sources: {
    projects?: readonly any[] | null;
    templates?: readonly any[] | null;
    tenders?: readonly any[] | null;
  }
): ProjectTypeUsageMatch {
  const usingProjects: Array<{ id: string; key: string; name: string }> = [];
  const usingTemplates: Array<{ id: string; name: string; builtIn?: boolean }> = [];
  let positionsCount = 0;

  for (const p of sources.projects || []) {
    if (!p || typeof p !== 'object') continue;
    if (p.typeId === typeId && p.subtypeId === subtypeId) {
      usingProjects.push({ id: p.id, key: p.key || '', name: getProjectDisplayName(p) || p.name || '' });
    }
    for (const arrKey of ['costs', 'quotations', 'paymentTranches'] as const) {
      const arr = p[arrKey];
      if (!Array.isArray(arr)) continue;
      for (const item of arr) {
        if (item && item.subtypeId === subtypeId && (!item.typeId || item.typeId === typeId)) {
          positionsCount += 1;
        }
      }
    }
  }

  for (const t of sources.tenders || []) {
    if (t && t.typeId === typeId && t.subtypeId === subtypeId) {
      positionsCount += 1;
    }
  }

  for (const tpl of sources.templates || []) {
    if (!tpl || typeof tpl !== 'object') continue;
    if (tpl.typeId === typeId && tpl.subtypeId === subtypeId) {
      usingTemplates.push({
        id: tpl.id,
        name: tpl.name || tpl.id,
        ...(tpl.builtIn ? { builtIn: true } : {}),
      });
    }
  }

  return { projects: usingProjects, templates: usingTemplates, positionsCount };
}
