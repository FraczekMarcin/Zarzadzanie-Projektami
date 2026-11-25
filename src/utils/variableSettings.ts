import type { ProjectPriorityOption, ProjectStatusOption } from '../types';
import {
  ClientRecord,
  createDefaultVariablesState,
  DEFAULT_CLIENTS,
  DEFAULT_DEADLINE_WARNING_DAYS,
  DEFAULT_PROJECT_PRIORITIES,
  DEFAULT_PROJECT_STATUSES,
  DEFAULT_TASK_TYPES,
  DEFAULT_VAT_RATES,
  normalizeVariablesState,
  ServerVariablesState,
  TaskTypeColor,
  TaskTypeDefinition,
  VARIABLES_LIMITS,
  VatRateOption,
} from './variablesSchema';

export type {
  ClientRecord,
  ProjectPriorityOption,
  ProjectStatusOption,
  ServerVariablesState,
  TaskTypeColor,
  TaskTypeDefinition,
  VatRateOption,
};

export {
  DEFAULT_CLIENTS,
  DEFAULT_DEADLINE_WARNING_DAYS,
  DEFAULT_PROJECT_PRIORITIES,
  DEFAULT_PROJECT_STATUSES,
  DEFAULT_TASK_TYPES,
  DEFAULT_VAT_RATES,
  VARIABLES_LIMITS,
};

export const LEGACY_VARIABLE_STORAGE_KEYS = [
  'oph_vat_rates',
  'oph_clients',
  'oph_task_types',
  'oph_deadline_warning_days',
] as const;

let currentVariablesState: ServerVariablesState = createDefaultVariablesState();
const variableListeners = new Set<() => void>();

function notifyVariableListeners(): void {
  for (const listener of variableListeners) {
    try {
      listener();
    } catch {
      // Ignoruj błędy pojedynczych subskrybentów
    }
  }
}

export function subscribeVariables(listener: () => void): () => void {
  variableListeners.add(listener);
  return () => {
    variableListeners.delete(listener);
  };
}

export function getVariablesSnapshot(): ServerVariablesState {
  return currentVariablesState;
}

export function setServerVariables(incoming: Partial<ServerVariablesState> | null | undefined): void {
  if (!incoming || typeof incoming !== 'object') return;
  const normalized = normalizeVariablesState(incoming);
  // Jeśli serwer celowo usunął listę klientów dla roli bez uprawnień, nie przywracaj domyślnych
  const clients = Array.isArray(incoming.clients) ? normalized.clients : [];

  currentVariablesState = {
    vatRates: normalized.vatRates,
    clients,
    taskTypes: normalized.taskTypes,
    projectStatuses: normalized.projectStatuses,
    projectPriorities: normalized.projectPriorities,
    deadlineWarningDays: normalized.deadlineWarningDays,
    initialized: Boolean(incoming.initialized),
  };
  notifyVariableListeners();
}

export function resetServerVariables(): void {
  currentVariablesState = createDefaultVariablesState();
  notifyVariableListeners();
}

export function getVatRates(): VatRateOption[] {
  return currentVariablesState.vatRates.map((item) => ({
    ...item,
    value: item.value !== undefined ? item.value : item.rate || 0,
    rate: item.rate !== undefined ? item.rate : item.value || 0,
  }));
}

export function getClients(): ClientRecord[] {
  return currentVariablesState.clients;
}

export function getTaskTypes(): TaskTypeDefinition[] {
  return currentVariablesState.taskTypes;
}

export function getProjectStatuses(): ProjectStatusOption[] {
  return currentVariablesState.projectStatuses;
}

export function getProjectPriorities(): ProjectPriorityOption[] {
  return currentVariablesState.projectPriorities;
}

export function getDeadlineWarningDays(): number {
  const days = currentVariablesState.deadlineWarningDays;
  if (typeof days === 'number' && Number.isInteger(days) && days >= 0 && days <= 30) {
    return days;
  }
  return DEFAULT_DEADLINE_WARNING_DAYS;
}

export async function saveVariablesToServer(
  patch: Partial<Omit<ServerVariablesState, 'initialized'>>
): Promise<{
  ok: boolean;
  status?: number;
  error?: string;
  inUseProjects?: Array<{ id: string; key: string; name: string }>;
  revision?: number;
  variables?: ServerVariablesState;
}> {
  try {
    const res = await fetch('/api/admin/variables', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: data?.error || 'Nie udało się zapisać zmiennych systemowych na serwerze.',
        ...(Array.isArray(data?.inUseProjects) ? { inUseProjects: data.inUseProjects } : {}),
      };
    }
    if (data?.variables) {
      setServerVariables(data.variables);
    }
    return {
      ok: true,
      status: res.status,
      revision: typeof data?.revision === 'number' ? data.revision : undefined,
      variables: data?.variables,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || 'Błąd połączenia z serwerem podczas zapisu zmiennych.',
    };
  }
}

/**
 * Automatycznie dopisuje zamawiającego do listy w pamięci (i na serwer, jeśli admin)
 */
export function registerClientIfNew(
  client: Partial<ClientRecord> & { name: string },
  options?: { syncToServer?: boolean }
): ClientRecord[] {
  if (!client.name || !client.name.trim()) return getClients();
  const trimmedName = client.name.trim();
  const currentList = getClients();

  const existing = currentList.find(
    (c) =>
      c.name.toLowerCase() === trimmedName.toLowerCase() ||
      (client.nip && c.nip && c.nip === client.nip)
  );

  let updatedList: ClientRecord[];
  if (existing) {
    updatedList = currentList.map((c) =>
      c.id === existing.id
        ? {
            ...c,
            contactPerson: client.contactPerson || c.contactPerson,
            phone: client.phone || c.phone,
            email: client.email || c.email,
            nip: client.nip || c.nip,
            address: client.address || c.address,
          }
        : c
    );
  } else {
    const newClient: ClientRecord = {
      id: `cli-${Date.now()}`,
      name: trimmedName,
      contactPerson: client.contactPerson || undefined,
      nip: client.nip || undefined,
      phone: client.phone || undefined,
      email: client.email || undefined,
      address: client.address || undefined,
      notes: client.notes || undefined,
      createdAt: new Date().toISOString(),
    };
    updatedList = [newClient, ...currentList];
  }

  currentVariablesState = {
    ...currentVariablesState,
    clients: updatedList,
  };
  notifyVariableListeners();

  if (options?.syncToServer) {
    void saveVariablesToServer({ clients: updatedList });
  }

  return updatedList;
}

export function hasLegacyLocalVariables(
  storage: Pick<Storage, 'getItem'> = localStorage
): boolean {
  try {
    return LEGACY_VARIABLE_STORAGE_KEYS.some((key) => storage.getItem(key) !== null);
  } catch {
    return false;
  }
}

export function readLegacyLocalVariables(
  storage: Pick<Storage, 'getItem'> = localStorage
): Partial<Omit<ServerVariablesState, 'initialized'>> {
  const result: Partial<Omit<ServerVariablesState, 'initialized'>> = {};

  try {
    const rawVat = storage.getItem('oph_vat_rates');
    if (rawVat !== null) {
      const parsed = JSON.parse(rawVat);
      if (Array.isArray(parsed)) {
        result.vatRates = parsed
          .filter((item: any) => item && typeof item === 'object')
          .slice(0, VARIABLES_LIMITS.vatRatesMax)
          .map((item: any, idx: number) => {
            const rawVal = item.value !== undefined ? Number(item.value) : Number(item.rate ?? 0);
            const numeric = Number.isFinite(rawVal)
              ? Math.min(100, Math.max(0, Number(rawVal.toFixed(2))))
              : 0;
            return {
              id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `vat-${idx + 1}`,
              value: numeric,
              rate: numeric,
              label:
                typeof item.label === 'string' && item.label.trim()
                  ? item.label.trim().slice(0, VARIABLES_LIMITS.vatLabelMax)
                  : `${numeric}%`,
              ...(item.isExempt ? { isExempt: true } : {}),
              ...(item.isDefault ? { isDefault: true } : {}),
            };
          });
      }
    }
  } catch {}

  try {
    const rawClients = storage.getItem('oph_clients');
    if (rawClients !== null) {
      const parsed = JSON.parse(rawClients);
      if (Array.isArray(parsed)) {
        result.clients = parsed
          .filter((item: any) => item && typeof item === 'object' && typeof item.name === 'string' && item.name.trim())
          .slice(0, VARIABLES_LIMITS.clientsMax)
          .map((item: any, idx: number) => {
            const rec: ClientRecord = {
              id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `cli-${Date.now()}-${idx + 1}`,
              name: item.name.trim().slice(0, VARIABLES_LIMITS.clientFieldMax),
              createdAt:
                typeof item.createdAt === 'string' && item.createdAt.trim()
                  ? item.createdAt.trim()
                  : new Date().toISOString(),
            };
            if (typeof item.contactPerson === 'string' && item.contactPerson.trim()) {
              rec.contactPerson = item.contactPerson.trim().slice(0, VARIABLES_LIMITS.clientFieldMax);
            }
            if (typeof item.nip === 'string' && item.nip.trim()) {
              rec.nip = item.nip.trim().slice(0, VARIABLES_LIMITS.clientNipMax);
            }
            if (typeof item.phone === 'string' && item.phone.trim()) {
              rec.phone = item.phone.trim().slice(0, VARIABLES_LIMITS.clientFieldMax);
            }
            if (typeof item.email === 'string' && item.email.trim()) {
              rec.email = item.email.trim().slice(0, VARIABLES_LIMITS.clientFieldMax);
            }
            if (typeof item.address === 'string' && item.address.trim()) {
              rec.address = item.address.trim().slice(0, VARIABLES_LIMITS.clientFieldMax);
            }
            if (typeof item.notes === 'string' && item.notes.trim()) {
              rec.notes = item.notes.trim().slice(0, VARIABLES_LIMITS.clientFieldMax);
            }
            return rec;
          });
      }
    }
  } catch {}

  try {
    const rawTaskTypes = storage.getItem('oph_task_types');
    if (rawTaskTypes !== null) {
      const parsed = JSON.parse(rawTaskTypes);
      if (Array.isArray(parsed)) {
        result.taskTypes = parsed
          .filter((item: any) => item && typeof item === 'object')
          .map((item: any, idx: number) => {
            const rawName = typeof item.name === 'string' && item.name.trim()
              ? item.name.trim()
              : typeof item.label === 'string' && item.label.trim()
              ? item.label.trim()
              : '';
            if (!rawName) return null;
            const name = rawName.slice(0, VARIABLES_LIMITS.taskTypeNameMax);
            const rec: TaskTypeDefinition = {
              id: typeof item.id === 'string' && item.id.trim() ? item.id.trim().slice(0, VARIABLES_LIMITS.taskTypeIdMax) : `typ-${idx + 1}`,
              name,
              label: name,
              color: item.color || 'sky',
            };
            if (typeof item.description === 'string' && item.description.trim()) {
              rec.description = item.description.trim().slice(0, VARIABLES_LIMITS.taskTypeDescMax);
            }
            if (item.isDefault) rec.isDefault = true;
            return rec;
          })
          .filter((t): t is TaskTypeDefinition => t !== null)
          .slice(0, VARIABLES_LIMITS.taskTypesMax);
      }
    }
  } catch {}

  try {
    const rawDays = storage.getItem('oph_deadline_warning_days');
    if (rawDays !== null) {
      const parsed = parseInt(rawDays, 10);
      if (!Number.isNaN(parsed)) {
        result.deadlineWarningDays = Math.min(30, Math.max(0, parsed));
      }
    }
  } catch {}

  return result;
}

export function clearLegacyLocalVariables(
  storage: Pick<Storage, 'removeItem'> = localStorage
): void {
  try {
    for (const key of LEGACY_VARIABLE_STORAGE_KEYS) {
      storage.removeItem(key);
    }
  } catch {}
}

export function clearOphStorageOnLogout(
  storage: Pick<Storage, 'length' | 'key' | 'removeItem'> = localStorage
): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith('oph_') && k !== 'oph_theme_mode' && !k.startsWith('oph_pref_')) {
        keysToRemove.push(k);
      }
    }
    for (const k of keysToRemove) {
      storage.removeItem(k);
    }
  } catch {}
}

export function getTaskTypeLabel(typeId: string, customTypes?: TaskTypeDefinition[]): string {
  const all = customTypes || getTaskTypes();
  const match = all.find((t) => t.id === typeId || t.name.toLowerCase() === typeId.toLowerCase());
  if (match) return match.name || match.label || typeId;
  if (typeId === 'task') return 'Rysunek';
  if (typeId === 'milestone') return 'Uzgodnienia';
  if (typeId === 'bug') return 'Opis';
  if (typeId === 'phase') return 'Czekanie na urząd';
  return typeId;
}

export function getTaskTypeBadgeStyle(typeId: string, customTypes?: TaskTypeDefinition[]): {
  badgeClass: string;
  dotColor: string;
} {
  const all = customTypes || getTaskTypes();
  const match = all.find((t) => t.id === typeId || t.name.toLowerCase() === typeId.toLowerCase());
  const color = match?.color || 'sky';

  switch (color) {
    case 'emerald':
      return {
        badgeClass: 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
        dotColor: 'bg-emerald-500',
      };
    case 'purple':
      return {
        badgeClass: 'bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800',
        dotColor: 'bg-purple-500',
      };
    case 'amber':
      return {
        badgeClass: 'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-200 border-amber-200 dark:border-amber-800',
        dotColor: 'bg-amber-500',
      };
    case 'rose':
      return {
        badgeClass: 'bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800',
        dotColor: 'bg-rose-500',
      };
    case 'indigo':
      return {
        badgeClass: 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800',
        dotColor: 'bg-indigo-500',
      };
    case 'slate':
      return {
        badgeClass: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700',
        dotColor: 'bg-slate-500',
      };
    default:
      return {
        badgeClass: 'bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800',
        dotColor: 'bg-sky-500',
      };
  }
}
