import type {
  ProjectPriorityOption,
  ProjectStatusOption,
  ProjectSubtypeOption,
  ProjectTypeOption,
} from '../types/index.js';
import { hasForbiddenKeys } from './access.js';
import {
  DEFAULT_PROJECT_PRIORITIES,
  DEFAULT_PROJECT_STATUSES,
  DEFAULT_PROJECT_TYPES,
  PROJECT_META_ID_MAX,
  PROJECT_META_LABEL_MAX,
  PROJECT_META_MAX_ITEMS,
  PROJECT_SUBTYPE_MAX_ITEMS,
  PROJECT_TYPE_ID_MAX,
  PROJECT_TYPE_LABEL_MAX,
  PROJECT_TYPE_MAX_ITEMS,
  SYSTEM_PROJECT_PRIORITY_IDS,
  SYSTEM_PROJECT_STATUS_IDS,
  VALID_PROJECT_META_COLORS,
  normalizeProjectPriorities,
  normalizeProjectStatuses,
  normalizeProjectTypes,
} from './projectMeta.js';

export { DEFAULT_PROJECT_PRIORITIES, DEFAULT_PROJECT_STATUSES, DEFAULT_PROJECT_TYPES };

export interface ClientRecord {
  id: string;
  name: string;
  contactPerson?: string;
  nip?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  createdAt: string;
}

export interface VatRateOption {
  id: string;
  value: number;
  rate?: number;
  label: string;
  isExempt?: boolean;
  isDefault?: boolean;
}

export type TaskTypeColor = 'sky' | 'emerald' | 'purple' | 'amber' | 'rose' | 'indigo' | 'blue' | 'slate';

export interface TaskTypeDefinition {
  id: string;
  name: string;
  label?: string;
  description?: string;
  color?: TaskTypeColor;
  badgeColor?: string;
  icon?: string;
  isDefault?: boolean;
}

export interface ServerVariablesState {
  vatRates: VatRateOption[];
  clients: ClientRecord[];
  taskTypes: TaskTypeDefinition[];
  projectStatuses: ProjectStatusOption[];
  projectPriorities: ProjectPriorityOption[];
  projectTypes: ProjectTypeOption[];
  deadlineWarningDays: number;
  initialized: boolean;
}

export const DEFAULT_DEADLINE_WARNING_DAYS = 3;

export const DEFAULT_VAT_RATES: VatRateOption[] = [
  { id: 'vat-23', value: 23, rate: 23, label: '23% - Podstawowa', isDefault: true },
  { id: 'vat-8', value: 8, rate: 8, label: '8% - Obniżona (budownictwo mieszkaniowe)' },
  { id: 'vat-5', value: 5, rate: 5, label: '5% - Obniżona' },
  { id: 'vat-0', value: 0, rate: 0, label: '0% - Eksport / Stawka zerowa' },
  { id: 'vat-zw', value: 0, rate: 0, label: 'ZW - Zwolniony z podatku VAT', isExempt: true },
];

export const DEFAULT_CLIENTS: ClientRecord[] = [
  {
    id: 'cli-1',
    name: 'Nordic Invest Sp. z o.o.',
    contactPerson: 'Krzysztof Majewski (Dyrektor Inwestycji)',
    nip: '5252819281',
    phone: '+48 22 555 40 10',
    email: 'inwestycje@nordic-invest.pl',
    address: 'ul. Marszałkowska 140, 00-061 Warszawa',
    createdAt: '2026-10-01T08:00:00Z',
  },
  {
    id: 'cli-2',
    name: 'Spółdzielnia Mieszkaniowa "Zielone Tarasy"',
    contactPerson: 'Barbara Grabowska (Prezes Zarządu)',
    nip: '9512394821',
    phone: '+48 22 644 12 30',
    email: 'zarzad@zielonetarasy.waw.pl',
    address: 'al. KEN 45/12, 02-797 Warszawa',
    createdAt: '2026-10-05T09:30:00Z',
  },
  {
    id: 'cli-3',
    name: 'Polska Grupa Logistyczna S.A.',
    contactPerson: 'Marek Domagała',
    nip: '7792451920',
    phone: '+48 61 889 00 20',
    email: 'projekty@pgl-sa.pl',
    address: 'ul. Dąbrowskiego 210, 60-406 Poznań',
    createdAt: '2026-10-10T11:00:00Z',
  },
];

export const DEFAULT_TASK_TYPES: TaskTypeDefinition[] = [
  {
    id: 'rysunek',
    name: 'Rysunek',
    label: 'Rysunek',
    description: 'Rysunki wykonawcze, schematy, rzuty CAD/BIM',
    color: 'sky',
    isDefault: true,
  },
  {
    id: 'opis',
    name: 'Opis',
    label: 'Opis',
    description: 'Opisy techniczne, specyfikacje materiałowe, przedmiary',
    color: 'emerald',
    isDefault: true,
  },
  {
    id: 'uzgodnienia',
    name: 'Uzgodnienia',
    label: 'Uzgodnienia',
    description: 'Uzgodnienia rzeczoznawców PPOŻ, Sanepid, BHP, gestorzy sieci',
    color: 'purple',
    isDefault: true,
  },
  {
    id: 'urzad',
    name: 'Czekanie na urząd',
    label: 'Czekanie na urząd',
    description: 'Procedury administracyjne, KPA, pozwolenia na budowę',
    color: 'amber',
    isDefault: true,
  },
];

export const VARIABLES_LIMITS = {
  vatRatesMax: 20,
  vatLabelMax: 200,
  clientsMax: 500,
  clientFieldMax: 200,
  clientNipMax: 20,
  taskTypesMax: 30,
  taskTypeNameMax: 50,
  taskTypeIdMax: 50,
  taskTypeDescMax: 200,
  projectStatusesMax: PROJECT_META_MAX_ITEMS,
  projectPrioritiesMax: PROJECT_META_MAX_ITEMS,
  projectMetaLabelMax: PROJECT_META_LABEL_MAX,
  projectMetaIdMax: PROJECT_META_ID_MAX,
  projectTypesMax: PROJECT_TYPE_MAX_ITEMS,
  projectSubtypesMax: PROJECT_SUBTYPE_MAX_ITEMS,
  projectTypeLabelMax: PROJECT_TYPE_LABEL_MAX,
  projectTypeIdMax: PROJECT_TYPE_ID_MAX,
  deadlineWarningDaysMin: 0,
  deadlineWarningDaysMax: 30,
} as const;

const VALID_TASK_TYPE_COLORS = new Set<TaskTypeColor>([
  'sky',
  'emerald',
  'purple',
  'amber',
  'rose',
  'indigo',
  'blue',
  'slate',
]);

export function createDefaultVariablesState(): ServerVariablesState {
  return {
    vatRates: DEFAULT_VAT_RATES.map((v) => ({ ...v })),
    clients: DEFAULT_CLIENTS.map((c) => ({ ...c })),
    taskTypes: DEFAULT_TASK_TYPES.map((t) => ({ ...t })),
    projectStatuses: DEFAULT_PROJECT_STATUSES.map((s) => ({ ...s })),
    projectPriorities: DEFAULT_PROJECT_PRIORITIES.map((p) => ({ ...p })),
    projectTypes: DEFAULT_PROJECT_TYPES.map((pt) => ({
      ...pt,
      subtypes: pt.subtypes.map((sub) => ({ ...sub })),
    })),
    deadlineWarningDays: DEFAULT_DEADLINE_WARNING_DAYS,
    initialized: false,
  };
}

export function normalizeVariablesState(raw: any): ServerVariablesState {
  const defaults = createDefaultVariablesState();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return defaults;
  }

  const vatRates = Array.isArray(raw.vatRates)
    ? raw.vatRates
        .filter((item: any) => item && typeof item === 'object')
        .map((item: any) => {
          const rawRate = item.value !== undefined ? item.value : item.rate;
          const numeric = typeof rawRate === 'number' && Number.isFinite(rawRate) ? rawRate : 0;
          return {
            ...item,
            id: typeof item.id === 'string' && item.id ? item.id : `vat-${numeric}`,
            value: numeric,
            rate: numeric,
            label: typeof item.label === 'string' ? item.label : `${numeric}%`,
          } as VatRateOption;
        })
    : defaults.vatRates;

  const clients = Array.isArray(raw.clients)
    ? raw.clients
        .filter((item: any) => item && typeof item === 'object')
        .map((item: any) => ({ ...item } as ClientRecord))
    : defaults.clients;

  const taskTypes = Array.isArray(raw.taskTypes)
    ? raw.taskTypes
        .filter((item: any) => item && typeof item === 'object')
        .map((item: any) => {
          const name = typeof item.name === 'string' ? item.name : typeof item.label === 'string' ? item.label : '';
          const label = typeof item.label === 'string' && item.label ? item.label : name;
          return {
            ...item,
            name,
            label,
          } as TaskTypeDefinition;
        })
    : defaults.taskTypes;

  const projectStatuses = normalizeProjectStatuses(raw.projectStatuses);
  const projectPriorities = normalizeProjectPriorities(raw.projectPriorities);
  const projectTypes = normalizeProjectTypes(raw.projectTypes);

  const deadlineWarningDays =
    typeof raw.deadlineWarningDays === 'number' &&
    Number.isInteger(raw.deadlineWarningDays) &&
    raw.deadlineWarningDays >= VARIABLES_LIMITS.deadlineWarningDaysMin &&
    raw.deadlineWarningDays <= VARIABLES_LIMITS.deadlineWarningDaysMax
      ? raw.deadlineWarningDays
      : DEFAULT_DEADLINE_WARNING_DAYS;

  const initialized = typeof raw.initialized === 'boolean' ? raw.initialized : false;

  return {
    vatRates,
    clients,
    taskTypes,
    projectStatuses,
    projectPriorities,
    projectTypes,
    deadlineWarningDays,
    initialized,
  };
}

export interface VariablesValidationResult {
  ok: boolean;
  errors: string[];
  patch: Partial<Omit<ServerVariablesState, 'initialized'>>;
}

export function validateVariablesUpdate(body: any): VariablesValidationResult {
  const errors: string[] = [];
  const patch: Partial<Omit<ServerVariablesState, 'initialized'>> = {};

  if (!body || typeof body !== 'object' || Array.isArray(body) || hasForbiddenKeys(body)) {
    return {
      ok: false,
      errors: ['Nieprawidłowy format danych zmiennych systemowych.'],
      patch,
    };
  }

  const hasVatRates = body.vatRates !== undefined;
  const hasClients = body.clients !== undefined;
  const hasTaskTypes = body.taskTypes !== undefined;
  const hasProjectStatuses = body.projectStatuses !== undefined;
  const hasProjectPriorities = body.projectPriorities !== undefined;
  const hasProjectTypes = body.projectTypes !== undefined;
  const hasDeadlineDays = body.deadlineWarningDays !== undefined;

  if (
    !hasVatRates &&
    !hasClients &&
    !hasTaskTypes &&
    !hasProjectStatuses &&
    !hasProjectPriorities &&
    !hasProjectTypes &&
    !hasDeadlineDays
  ) {
    return {
      ok: false,
      errors: ['Brak sekcji zmiennych systemowych do zapisania.'],
      patch,
    };
  }

  // 1. Walidacja stawek VAT
  if (hasVatRates) {
    if (!Array.isArray(body.vatRates)) {
      errors.push('Pole vatRates musi być tablicą.');
    } else if (body.vatRates.length > VARIABLES_LIMITS.vatRatesMax) {
      errors.push(`Lista stawek VAT może zawierać maksymalnie ${VARIABLES_LIMITS.vatRatesMax} pozycji.`);
    } else {
      const normalizedVat: VatRateOption[] = [];
      const seenKeys = new Set<string>();
      const seenIds = new Set<string>();

      for (let i = 0; i < body.vatRates.length; i++) {
        const item = body.vatRates[i];
        if (!item || typeof item !== 'object' || Array.isArray(item) || hasForbiddenKeys(item)) {
          errors.push(`Nieprawidłowy format stawki VAT na pozycji ${i + 1}.`);
          break;
        }

        const rawRate = item.value !== undefined ? item.value : item.rate;
        if (typeof rawRate !== 'number' || !Number.isFinite(rawRate) || rawRate < 0 || rawRate > 100) {
          errors.push('Stawka VAT musi być liczbą z zakresu 0–100.');
          break;
        }
        if (Number(rawRate.toFixed(2)) !== rawRate) {
          errors.push('Stawka VAT może mieć maksymalnie 2 miejsca po przecinku.');
          break;
        }
        const rate = Number(rawRate.toFixed(2));
        const isExempt = Boolean(item.isExempt);
        const uniqueKey = `${rate}:${isExempt ? 'exempt' : 'std'}`;
        if (seenKeys.has(uniqueKey)) {
          errors.push('Stawki VAT muszą być unikalne (z uwzględnieniem statusu zwolnienia ZW).');
          break;
        }
        seenKeys.add(uniqueKey);

        if (typeof item.label !== 'string' || !item.label.trim()) {
          errors.push('Etykieta stawki VAT nie może być pusta.');
          break;
        }
        const label = item.label.trim();
        if (label.length > VARIABLES_LIMITS.vatLabelMax) {
          errors.push(`Etykieta stawki VAT nie może przekraczać ${VARIABLES_LIMITS.vatLabelMax} znaków.`);
          break;
        }

        let id =
          typeof item.id === 'string' && item.id.trim()
            ? item.id.trim().slice(0, 64)
            : `vat-${i + 1}-${isExempt ? 'zw' : String(rate).replace('.', '_')}`;
        while (seenIds.has(id)) {
          id = `${id.slice(0, 56)}-${i + 1}`;
        }
        seenIds.add(id);

        const rec: VatRateOption = {
          id,
          value: rate,
          rate,
          label,
        };
        if (isExempt) rec.isExempt = true;
        if (item.isDefault) rec.isDefault = true;
        normalizedVat.push(rec);
      }

      if (errors.length === 0) {
        patch.vatRates = normalizedVat;
      }
    }
  }

  // 2. Walidacja listy klientów
  if (hasClients) {
    if (!Array.isArray(body.clients)) {
      errors.push('Pole clients musi być tablicą.');
    } else if (body.clients.length > VARIABLES_LIMITS.clientsMax) {
      errors.push(`Lista klientów może zawierać maksymalnie ${VARIABLES_LIMITS.clientsMax} pozycji.`);
    } else {
      const normalizedClients: ClientRecord[] = [];
      const seenIds = new Set<string>();

      for (let i = 0; i < body.clients.length; i++) {
        const item = body.clients[i];
        if (!item || typeof item !== 'object' || Array.isArray(item) || hasForbiddenKeys(item)) {
          errors.push(`Nieprawidłowy format klienta na pozycji ${i + 1}.`);
          break;
        }

        if (typeof item.name !== 'string' || !item.name.trim()) {
          errors.push('Nazwa klienta nie może być pusta.');
          break;
        }
        const name = item.name.trim();
        if (name.length > VARIABLES_LIMITS.clientFieldMax) {
          errors.push(`Nazwa klienta nie może przekraczać ${VARIABLES_LIMITS.clientFieldMax} znaków.`);
          break;
        }

        const stringFields = ['contactPerson', 'phone', 'email', 'address', 'notes'] as const;
        let fieldError: string | null = null;
        const cleanedFields: Record<string, string | undefined> = {};

        for (const f of stringFields) {
          const val = item[f];
          if (val !== undefined && val !== null) {
            if (typeof val !== 'string') {
              fieldError = `Pole "${f}" klienta musi być tekstem.`;
              break;
            }
            const trimmed = val.trim();
            if (trimmed.length > VARIABLES_LIMITS.clientFieldMax) {
              fieldError = `Pole "${f}" klienta nie może przekraczać ${VARIABLES_LIMITS.clientFieldMax} znaków.`;
              break;
            }
            if (trimmed) {
              cleanedFields[f] = trimmed;
            }
          }
        }
        if (fieldError) {
          errors.push(fieldError);
          break;
        }

        let nip: string | undefined;
        if (item.nip !== undefined && item.nip !== null) {
          if (typeof item.nip !== 'string') {
            errors.push('Pole "nip" klienta musi być tekstem.');
            break;
          }
          const trimmedNip = item.nip.trim();
          if (trimmedNip.length > VARIABLES_LIMITS.clientNipMax) {
            errors.push(`Numer NIP klienta nie może przekraczać ${VARIABLES_LIMITS.clientNipMax} znaków.`);
            break;
          }
          if (trimmedNip) {
            nip = trimmedNip;
          }
        }

        let id =
          typeof item.id === 'string' && item.id.trim()
            ? item.id.trim().slice(0, 100)
            : `cli-${Date.now()}-${i + 1}`;
        while (seenIds.has(id)) {
          id = `${id.slice(0, 90)}-${i + 1}`;
        }
        seenIds.add(id);

        const createdAt =
          typeof item.createdAt === 'string' && item.createdAt.trim()
            ? item.createdAt.trim().slice(0, 64)
            : new Date().toISOString();

        const rec: ClientRecord = {
          id,
          name,
          createdAt,
        };
        if (cleanedFields.contactPerson) rec.contactPerson = cleanedFields.contactPerson;
        if (nip) rec.nip = nip;
        if (cleanedFields.phone) rec.phone = cleanedFields.phone;
        if (cleanedFields.email) rec.email = cleanedFields.email;
        if (cleanedFields.address) rec.address = cleanedFields.address;
        if (cleanedFields.notes) rec.notes = cleanedFields.notes;

        normalizedClients.push(rec);
      }

      if (errors.length === 0) {
        patch.clients = normalizedClients;
      }
    }
  }

  // 3. Walidacja typów zadań
  if (hasTaskTypes) {
    if (!Array.isArray(body.taskTypes)) {
      errors.push('Pole taskTypes musi być tablicą.');
    } else if (body.taskTypes.length > VARIABLES_LIMITS.taskTypesMax) {
      errors.push(`Lista typów zadań może zawierać maksymalnie ${VARIABLES_LIMITS.taskTypesMax} pozycji.`);
    } else {
      const normalizedTaskTypes: TaskTypeDefinition[] = [];
      const seenIds = new Set<string>();

      for (let i = 0; i < body.taskTypes.length; i++) {
        const item = body.taskTypes[i];
        if (!item || typeof item !== 'object' || Array.isArray(item) || hasForbiddenKeys(item)) {
          errors.push(`Nieprawidłowy format typu zadania na pozycji ${i + 1}.`);
          break;
        }

        const rawName = item.name !== undefined ? item.name : item.label;
        if (typeof rawName !== 'string' || !rawName.trim()) {
          errors.push('Nazwa typu zadania nie może być pusta.');
          break;
        }
        const name = rawName.trim();
        if (name.length > VARIABLES_LIMITS.taskTypeNameMax) {
          errors.push(`Nazwa typu zadania nie może przekraczać ${VARIABLES_LIMITS.taskTypeNameMax} znaków.`);
          break;
        }

        let label = name;
        if (item.label !== undefined && item.label !== null) {
          if (typeof item.label !== 'string') {
            errors.push('Etykieta typu zadania musi być tekstem.');
            break;
          }
          const trimmedLabel = item.label.trim();
          if (trimmedLabel.length > VARIABLES_LIMITS.taskTypeNameMax) {
            errors.push(`Etykieta typu zadania nie może przekraczać ${VARIABLES_LIMITS.taskTypeNameMax} znaków.`);
            break;
          }
          if (trimmedLabel) {
            label = trimmedLabel;
          }
        }

        let description: string | undefined;
        if (item.description !== undefined && item.description !== null) {
          if (typeof item.description !== 'string') {
            errors.push('Opis typu zadania musi być tekstem.');
            break;
          }
          const trimmedDesc = item.description.trim();
          if (trimmedDesc.length > VARIABLES_LIMITS.taskTypeDescMax) {
            errors.push(`Opis typu zadania nie może przekraczać ${VARIABLES_LIMITS.taskTypeDescMax} znaków.`);
            break;
          }
          if (trimmedDesc) {
            description = trimmedDesc;
          }
        }

        let id =
          typeof item.id === 'string' && item.id.trim()
            ? item.id.trim().slice(0, VARIABLES_LIMITS.taskTypeIdMax)
            : `typ-${i + 1}`;
        while (seenIds.has(id)) {
          id = `${id.slice(0, 42)}-${i + 1}`;
        }
        seenIds.add(id);

        const color: TaskTypeColor =
          typeof item.color === 'string' && VALID_TASK_TYPE_COLORS.has(item.color as TaskTypeColor)
            ? (item.color as TaskTypeColor)
            : 'sky';

        const rec: TaskTypeDefinition = {
          id,
          name,
          label,
          color,
        };
        if (description) rec.description = description;
        if (typeof item.badgeColor === 'string' && item.badgeColor.trim()) {
          rec.badgeColor = item.badgeColor.trim().slice(0, 50);
        }
        if (typeof item.icon === 'string' && item.icon.trim()) {
          rec.icon = item.icon.trim().slice(0, 50);
        }
        if (item.isDefault) rec.isDefault = true;

        normalizedTaskTypes.push(rec);
      }

      if (errors.length === 0) {
        patch.taskTypes = normalizedTaskTypes;
      }
    }
  }

  // 4. Walidacja stanów projektów
  if (hasProjectStatuses) {
    if (!Array.isArray(body.projectStatuses)) {
      errors.push('Pole projectStatuses musi być tablicą.');
    } else if (body.projectStatuses.length === 0) {
      errors.push('Lista stanów projektów nie może być pusta.');
    } else if (body.projectStatuses.length > VARIABLES_LIMITS.projectStatusesMax) {
      errors.push(
        `Lista stanów projektów może zawierać maksymalnie ${VARIABLES_LIMITS.projectStatusesMax} pozycji.`
      );
    } else {
      const normalizedStatuses: ProjectStatusOption[] = [];
      const seenIds = new Set<string>();
      const seenLabels = new Set<string>();
      let defaultCount = 0;

      for (let i = 0; i < body.projectStatuses.length; i++) {
        const item = body.projectStatuses[i];
        if (!item || typeof item !== 'object' || Array.isArray(item) || hasForbiddenKeys(item)) {
          errors.push(`Nieprawidłowy format stanu projektu na pozycji ${i + 1}.`);
          break;
        }

        const rawId = typeof item.id === 'string' ? item.id.trim() : '';
        if (!rawId) {
          errors.push('Każdy stan projektu musi posiadać identyfikator (id).');
          break;
        }
        if (rawId.length > VARIABLES_LIMITS.projectMetaIdMax) {
          errors.push(
            `Identyfikator stanu projektu nie może przekraczać ${VARIABLES_LIMITS.projectMetaIdMax} znaków.`
          );
          break;
        }
        if (seenIds.has(rawId)) {
          errors.push(`Duplikat identyfikatora stanu projektu "${rawId}".`);
          break;
        }
        seenIds.add(rawId);

        if (typeof item.label !== 'string' || !item.label.trim()) {
          errors.push('Etykieta stanu projektu nie może być pusta.');
          break;
        }
        const label = item.label.trim();
        if (label.length > VARIABLES_LIMITS.projectMetaLabelMax) {
          errors.push(
            `Etykieta stanu projektu nie może przekraczać ${VARIABLES_LIMITS.projectMetaLabelMax} znaków.`
          );
          break;
        }
        const labelKey = label.toLowerCase();
        if (seenLabels.has(labelKey)) {
          errors.push(`Etykieta stanu projektu "${label}" musi być unikalna.`);
          break;
        }
        seenLabels.add(labelKey);

        const color =
          item.color === undefined || item.color === null ? 'slate' : item.color;
        if (typeof color !== 'string' || !VALID_PROJECT_META_COLORS.has(color as any)) {
          errors.push(`Nieprawidłowy kolor stanu projektu "${label}".`);
          break;
        }

        const order = item.order === undefined ? i + 1 : item.order;
        if (typeof order !== 'number' || !Number.isInteger(order)) {
          errors.push(`Kolejność stanu projektu "${label}" musi być liczbą całkowitą.`);
          break;
        }

        const isDefault = Boolean(item.isDefault);
        if (isDefault) defaultCount += 1;

        const isSystem = SYSTEM_PROJECT_STATUS_IDS.has(rawId);
        const rec: ProjectStatusOption = {
          id: rawId,
          label,
          color: color as ProjectStatusOption['color'],
          order,
          isDefault,
          isClosed: Boolean(item.isClosed),
          ...(isSystem ? { isSystem: true } : {}),
        };
        normalizedStatuses.push(rec);
      }

      if (errors.length === 0) {
        for (const sysId of SYSTEM_PROJECT_STATUS_IDS) {
          if (!seenIds.has(sysId)) {
            errors.push(`Nie można usunąć systemowego stanu projektu "${sysId}".`);
            break;
          }
        }
      }
      if (errors.length === 0 && defaultCount !== 1) {
        errors.push('Dokładnie jeden stan projektu musi być ustawiony jako domyślny.');
      }
      if (errors.length === 0) {
        patch.projectStatuses = normalizedStatuses.sort(
          (a, b) => a.order - b.order || a.label.localeCompare(b.label, 'pl')
        );
      }
    }
  }

  // 5. Walidacja priorytetów projektów
  if (hasProjectPriorities) {
    if (!Array.isArray(body.projectPriorities)) {
      errors.push('Pole projectPriorities musi być tablicą.');
    } else if (body.projectPriorities.length === 0) {
      errors.push('Lista priorytetów projektów nie może być pusta.');
    } else if (body.projectPriorities.length > VARIABLES_LIMITS.projectPrioritiesMax) {
      errors.push(
        `Lista priorytetów projektów może zawierać maksymalnie ${VARIABLES_LIMITS.projectPrioritiesMax} pozycji.`
      );
    } else {
      const normalizedPriorities: ProjectPriorityOption[] = [];
      const seenIds = new Set<string>();
      const seenLabels = new Set<string>();
      let defaultCount = 0;

      for (let i = 0; i < body.projectPriorities.length; i++) {
        const item = body.projectPriorities[i];
        if (!item || typeof item !== 'object' || Array.isArray(item) || hasForbiddenKeys(item)) {
          errors.push(`Nieprawidłowy format priorytetu projektu na pozycji ${i + 1}.`);
          break;
        }

        const rawId = typeof item.id === 'string' ? item.id.trim() : '';
        if (!rawId) {
          errors.push('Każdy priorytet projektu musi posiadać identyfikator (id).');
          break;
        }
        if (rawId.length > VARIABLES_LIMITS.projectMetaIdMax) {
          errors.push(
            `Identyfikator priorytetu projektu nie może przekraczać ${VARIABLES_LIMITS.projectMetaIdMax} znaków.`
          );
          break;
        }
        if (seenIds.has(rawId)) {
          errors.push(`Duplikat identyfikatora priorytetu projektu "${rawId}".`);
          break;
        }
        seenIds.add(rawId);

        if (typeof item.label !== 'string' || !item.label.trim()) {
          errors.push('Etykieta priorytetu projektu nie może być pusta.');
          break;
        }
        const label = item.label.trim();
        if (label.length > VARIABLES_LIMITS.projectMetaLabelMax) {
          errors.push(
            `Etykieta priorytetu projektu nie może przekraczać ${VARIABLES_LIMITS.projectMetaLabelMax} znaków.`
          );
          break;
        }
        const labelKey = label.toLowerCase();
        if (seenLabels.has(labelKey)) {
          errors.push(`Etykieta priorytetu projektu "${label}" musi być unikalna.`);
          break;
        }
        seenLabels.add(labelKey);

        const color =
          item.color === undefined || item.color === null ? 'slate' : item.color;
        if (typeof color !== 'string' || !VALID_PROJECT_META_COLORS.has(color as any)) {
          errors.push(`Nieprawidłowy kolor priorytetu projektu "${label}".`);
          break;
        }

        const order = item.order === undefined ? i + 1 : item.order;
        if (typeof order !== 'number' || !Number.isInteger(order)) {
          errors.push(`Kolejność priorytetu projektu "${label}" musi być liczbą całkowitą.`);
          break;
        }

        const isDefault = Boolean(item.isDefault);
        if (isDefault) defaultCount += 1;

        const isSystem = SYSTEM_PROJECT_PRIORITY_IDS.has(rawId);
        const rec: ProjectPriorityOption = {
          id: rawId,
          label,
          color: color as ProjectPriorityOption['color'],
          order,
          isDefault,
          ...(isSystem ? { isSystem: true } : {}),
        };
        normalizedPriorities.push(rec);
      }

      if (errors.length === 0) {
        for (const sysId of SYSTEM_PROJECT_PRIORITY_IDS) {
          if (!seenIds.has(sysId)) {
            errors.push(`Nie można usunąć systemowego priorytetu projektu "${sysId}".`);
            break;
          }
        }
      }
      if (errors.length === 0 && defaultCount !== 1) {
        errors.push('Dokładnie jeden priorytet projektu musi być ustawiony jako domyślny.');
      }
      if (errors.length === 0) {
        patch.projectPriorities = normalizedPriorities.sort(
          (a, b) => a.order - b.order || a.label.localeCompare(b.label, 'pl')
        );
      }
    }
  }

  // 6. Walidacja rodzajów projektów i podrodzajów
  if (hasProjectTypes) {
    if (!Array.isArray(body.projectTypes)) {
      errors.push('Pole projectTypes musi być tablicą.');
    } else if (body.projectTypes.length > VARIABLES_LIMITS.projectTypesMax) {
      errors.push(
        `Lista rodzajów projektów może zawierać maksymalnie ${VARIABLES_LIMITS.projectTypesMax} pozycji.`
      );
    } else {
      const normalizedTypes: ProjectTypeOption[] = [];
      const seenTypeIds = new Set<string>();
      const seenTypeLabels = new Set<string>();

      for (let i = 0; i < body.projectTypes.length; i += 1) {
        const item = body.projectTypes[i];
        if (!item || typeof item !== 'object' || Array.isArray(item) || hasForbiddenKeys(item)) {
          errors.push(`Nieprawidłowy format rodzaju projektu na pozycji ${i + 1}.`);
          break;
        }

        const rawId = typeof item.id === 'string' ? item.id.trim() : '';
        if (!rawId) {
          errors.push('Każdy rodzaj projektu musi posiadać identyfikator (id).');
          break;
        }
        if (rawId.length > VARIABLES_LIMITS.projectTypeIdMax) {
          errors.push(
            `Identyfikator rodzaju projektu nie może przekraczać ${VARIABLES_LIMITS.projectTypeIdMax} znaków.`
          );
          break;
        }
        if (seenTypeIds.has(rawId)) {
          errors.push(`Duplikat identyfikatora rodzaju projektu "${rawId}".`);
          break;
        }
        seenTypeIds.add(rawId);

        if (typeof item.label !== 'string' || !item.label.trim()) {
          errors.push('Nazwa rodzaju projektu nie może być pusta.');
          break;
        }
        const label = item.label.trim();
        if (label.length > VARIABLES_LIMITS.projectTypeLabelMax) {
          errors.push(
            `Nazwa rodzaju projektu nie może przekraczać ${VARIABLES_LIMITS.projectTypeLabelMax} znaków.`
          );
          break;
        }
        const labelKey = label.toLowerCase();
        if (seenTypeLabels.has(labelKey)) {
          errors.push(`Nazwa rodzaju projektu "${label}" musi być unikalna.`);
          break;
        }
        seenTypeLabels.add(labelKey);

        const color =
          item.color === undefined || item.color === null ? 'slate' : item.color;
        if (typeof color !== 'string' || !VALID_PROJECT_META_COLORS.has(color as any)) {
          errors.push(`Nieprawidłowy kolor rodzaju projektu "${label}".`);
          break;
        }

        const order = item.order === undefined ? i + 1 : item.order;
        if (typeof order !== 'number' || !Number.isInteger(order)) {
          errors.push(`Kolejność rodzaju projektu "${label}" musi być liczbą całkowitą.`);
          break;
        }

        const isActive =
          item.isActive === undefined ? true : Boolean(item.isActive);
        if (item.isActive !== undefined && typeof item.isActive !== 'boolean') {
          errors.push(`Pole isActive rodzaju projektu "${label}" musi być wartością logiczną.`);
          break;
        }

        let normalizedSubtypes: ProjectSubtypeOption[] = [];
        if (item.subtypes !== undefined && item.subtypes !== null) {
          if (!Array.isArray(item.subtypes)) {
            errors.push(`Podrodzaje rodzaju "${label}" muszą być tablicą.`);
            break;
          }
          if (item.subtypes.length > VARIABLES_LIMITS.projectSubtypesMax) {
            errors.push(
              `Rodzaj projektu "${label}" może zawierać maksymalnie ${VARIABLES_LIMITS.projectSubtypesMax} podrodzajów.`
            );
            break;
          }

          const seenSubIds = new Set<string>();
          const seenSubLabels = new Set<string>();
          let subtypeError = false;

          for (let j = 0; j < item.subtypes.length; j += 1) {
            const sub = item.subtypes[j];
            if (!sub || typeof sub !== 'object' || Array.isArray(sub) || hasForbiddenKeys(sub)) {
              errors.push(`Nieprawidłowy format podrodzaju na pozycji ${j + 1} w rodzaju "${label}".`);
              subtypeError = true;
              break;
            }
            const rawSubId = typeof sub.id === 'string' ? sub.id.trim() : '';
            if (!rawSubId) {
              errors.push(`Każdy podrodzaj w rodzaju "${label}" musi posiadać identyfikator (id).`);
              subtypeError = true;
              break;
            }
            if (rawSubId.length > VARIABLES_LIMITS.projectTypeIdMax) {
              errors.push(
                `Identyfikator podrodzaju w rodzaju "${label}" nie może przekraczać ${VARIABLES_LIMITS.projectTypeIdMax} znaków.`
              );
              subtypeError = true;
              break;
            }
            if (seenSubIds.has(rawSubId)) {
              errors.push(`Duplikat identyfikatora podrodzaju "${rawSubId}" w rodzaju "${label}".`);
              subtypeError = true;
              break;
            }
            seenSubIds.add(rawSubId);

            if (typeof sub.label !== 'string' || !sub.label.trim()) {
              errors.push(`Nazwa podrodzaju w rodzaju "${label}" nie może być pusta.`);
              subtypeError = true;
              break;
            }
            const subLabel = sub.label.trim();
            if (subLabel.length > VARIABLES_LIMITS.projectTypeLabelMax) {
              errors.push(
                `Nazwa podrodzaju w rodzaju "${label}" nie może przekraczać ${VARIABLES_LIMITS.projectTypeLabelMax} znaków.`
              );
              subtypeError = true;
              break;
            }
            const subLabelKey = subLabel.toLowerCase();
            if (seenSubLabels.has(subLabelKey)) {
              errors.push(`Nazwa podrodzaju "${subLabel}" w rodzaju "${label}" musi być unikalna.`);
              subtypeError = true;
              break;
            }
            seenSubLabels.add(subLabelKey);

            const subOrder = sub.order === undefined ? j + 1 : sub.order;
            if (typeof subOrder !== 'number' || !Number.isInteger(subOrder)) {
              errors.push(`Kolejność podrodzaju "${subLabel}" musi być liczbą całkowitą.`);
              subtypeError = true;
              break;
            }

            if (sub.isActive !== undefined && typeof sub.isActive !== 'boolean') {
              errors.push(`Pole isActive podrodzaju "${subLabel}" musi być wartością logiczną.`);
              subtypeError = true;
              break;
            }
            const subActive = sub.isActive === undefined ? true : Boolean(sub.isActive);

            normalizedSubtypes.push({
              id: rawSubId,
              label: subLabel,
              order: subOrder,
              isActive: subActive,
            });
          }

          if (subtypeError) {
            break;
          }

          normalizedSubtypes = normalizedSubtypes.sort(
            (a, b) => a.order - b.order || a.label.localeCompare(b.label, 'pl')
          );
        }

        normalizedTypes.push({
          id: rawId,
          label,
          color: color as ProjectTypeOption['color'],
          order,
          isActive,
          subtypes: normalizedSubtypes,
        });
      }

      if (errors.length === 0) {
        patch.projectTypes = normalizedTypes.sort(
          (a, b) => a.order - b.order || a.label.localeCompare(b.label, 'pl')
        );
      }
    }
  }

  // 7. Walidacja liczby dni ostrzeżenia o terminie
  if (hasDeadlineDays) {
    const days = body.deadlineWarningDays;
    if (
      typeof days !== 'number' ||
      !Number.isInteger(days) ||
      days < VARIABLES_LIMITS.deadlineWarningDaysMin ||
      days > VARIABLES_LIMITS.deadlineWarningDaysMax
    ) {
      errors.push(
        `Liczba dni ostrzeżenia o terminie musi być liczbą całkowitą z zakresu ${VARIABLES_LIMITS.deadlineWarningDaysMin}–${VARIABLES_LIMITS.deadlineWarningDaysMax}.`
      );
    } else {
      patch.deadlineWarningDays = days;
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    patch,
  };
}
