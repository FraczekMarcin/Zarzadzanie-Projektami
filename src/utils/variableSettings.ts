export interface ClientRecord {
  id: string;
  name: string; // Pełna nazwa zamawiającego / firmy
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
  value: number; // np. 23, 8, 5, 0
  rate?: number; // alias
  label: string; // np. "23% (Stawka podstawowa)"
  isExempt?: boolean; // Zwolniony z VAT (ZW)
  isDefault?: boolean;
}

export const DEFAULT_VAT_RATES: VatRateOption[] = [
  { id: 'vat-23', value: 23, rate: 23, label: '23% - Podstawowa', isDefault: true },
  { id: 'vat-8', value: 8, rate: 8, label: '8% - Obniżona (budownictwo mieszkaniowe)' },
  { id: 'vat-5', value: 5, rate: 5, label: '5% - Obniżona' },
  { id: 'vat-0', value: 0, rate: 0, label: '0% - Eksport / Stawka zerowa' },
  { id: 'vat-zw', value: 0, rate: 0, label: 'ZW - Zwolniony z podatku VAT', isExempt: true },
];

const DEFAULT_CLIENTS: ClientRecord[] = [
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

export function getVatRates(): VatRateOption[] {
  try {
    const saved = localStorage.getItem('oph_vat_rates');
    const parsed: VatRateOption[] = saved ? JSON.parse(saved) : DEFAULT_VAT_RATES;
    return parsed.map((item) => ({
      ...item,
      value: item.value !== undefined ? item.value : (item.rate || 0),
      rate: item.rate !== undefined ? item.rate : (item.value || 0),
    }));
  } catch {
    return DEFAULT_VAT_RATES;
  }
}

export function saveVatRates(rates: VatRateOption[]): void {
  try {
    localStorage.setItem('oph_vat_rates', JSON.stringify(rates));
  } catch (err) {
    console.error('Błąd zapisu stawek VAT:', err);
  }
}

export function getClients(): ClientRecord[] {
  try {
    const saved = localStorage.getItem('oph_clients');
    return saved ? JSON.parse(saved) : DEFAULT_CLIENTS;
  } catch {
    return DEFAULT_CLIENTS;
  }
}

export function saveClients(clients: ClientRecord[]): void {
  try {
    localStorage.setItem('oph_clients', JSON.stringify(clients));
  } catch (err) {
    console.error('Błąd zapisu listy zamawiających:', err);
  }
}

/**
 * Automatycznie zapisuje zamawiającego do listy, jeśli jeszcze nie istnieje
 */
export function registerClientIfNew(client: Partial<ClientRecord> & { name: string }): ClientRecord[] {
  if (!client.name || !client.name.trim()) return getClients();
  const trimmedName = client.name.trim();
  const currentList = getClients();

  const existing = currentList.find(
    (c) => c.name.toLowerCase() === trimmedName.toLowerCase() || (client.nip && c.nip && c.nip === client.nip)
  );

  if (existing) {
    // Zaktualizuj dane kontaktowe jeśli podano nowe
    const updatedList = currentList.map((c) =>
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
    saveClients(updatedList);
    return updatedList;
  }

  const newClient: ClientRecord = {
    id: `cli-${Date.now()}`,
    name: trimmedName,
    contactPerson: client.contactPerson || '',
    nip: client.nip || '',
    phone: client.phone || '',
    email: client.email || '',
    address: client.address || '',
    notes: client.notes || '',
    createdAt: new Date().toISOString(),
  };

  const updatedList = [newClient, ...currentList];
  saveClients(updatedList);
  return updatedList;
}

export function getDeadlineWarningDays(): number {
  try {
    const saved = localStorage.getItem('oph_deadline_warning_days');
    return saved ? Math.max(1, parseInt(saved, 10)) : 3;
  } catch {
    return 3;
  }
}

export function saveDeadlineWarningDays(days: number): void {
  try {
    const val = Math.max(1, days);
    localStorage.setItem('oph_deadline_warning_days', String(val));
  } catch (err) {
    console.error('Błąd zapisu dni ostrzeżenia o terminie:', err);
  }
}

export type TaskTypeColor = 'sky' | 'emerald' | 'purple' | 'amber' | 'rose' | 'indigo' | 'blue' | 'slate';

export interface TaskTypeDefinition {
  id: string; // np. 'rysunek', 'opis', 'uzgodnienia', 'urzad' lub własne id
  name: string; // np. 'Rysunek', 'Opis', 'Uzgodnienia', 'Czekanie na urząd'
  color: TaskTypeColor;
  icon?: string;
  isDefault?: boolean;
}

export const DEFAULT_TASK_TYPES: TaskTypeDefinition[] = [
  { id: 'rysunek', name: 'Rysunek', color: 'sky', isDefault: true },
  { id: 'opis', name: 'Opis', color: 'emerald', isDefault: true },
  { id: 'uzgodnienia', name: 'Uzgodnienia', color: 'purple', isDefault: true },
  { id: 'urzad', name: 'Czekanie na urząd', color: 'amber', isDefault: true },
];

export function getTaskTypes(): TaskTypeDefinition[] {
  try {
    const saved = localStorage.getItem('oph_task_types');
    if (!saved) return DEFAULT_TASK_TYPES;
    const parsed = JSON.parse(saved);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
    return DEFAULT_TASK_TYPES;
  } catch {
    return DEFAULT_TASK_TYPES;
  }
}

export function saveTaskTypes(types: TaskTypeDefinition[]): void {
  try {
    localStorage.setItem('oph_task_types', JSON.stringify(types));
  } catch (err) {
    console.error('Błąd zapisu typów zadań:', err);
  }
}

export function getTaskTypeLabel(typeId: string, customTypes?: TaskTypeDefinition[]): string {
  const all = customTypes || getTaskTypes();
  const match = all.find((t) => t.id === typeId || t.name.toLowerCase() === typeId.toLowerCase());
  if (match) return match.name;
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
