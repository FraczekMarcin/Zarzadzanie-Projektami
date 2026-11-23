import type {
  Company,
  TenderPriceBasis,
  TenderStatus,
  User,
} from '../types/index.js';
import type {
  ComputedBidder,
  TenderDetail,
  TenderListItem,
  TenderSortKey,
  TenderSortOrder,
  TenderSummary,
} from './tenders.js';
import { formatMoney, formatQuantity, roundMoney } from './money.js';

export type {
  ComputedBidder,
  TenderDetail,
  TenderListItem,
  TenderSortKey,
  TenderSortOrder,
  TenderSummary,
};

export interface TenderListResponse {
  items: TenderListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  summary: TenderSummary;
}

export interface TenderFilterState {
  q: string;
  authority: string;
  status: '' | TenderStatus;
  from: string;
  to: string;
  ourOnly: boolean;
  won: boolean;
  minPrice: string;
  maxPrice: string;
}

export const INITIAL_TENDER_FILTERS: TenderFilterState = {
  q: '',
  authority: '',
  status: '',
  from: '',
  to: '',
  ourOnly: false,
  won: false,
  minPrice: '',
  maxPrice: '',
};

export const TENDER_STATUS_LABELS: Record<TenderStatus, string> = {
  announced: 'Ogłoszony',
  resolved: 'Rozstrzygnięty',
  cancelled: 'Unieważniony',
};

export const TENDER_PRICE_BASIS_LABELS: Record<TenderPriceBasis, string> = {
  net: 'Netto',
  gross: 'Brutto',
};

export const COMMON_SCOPE_UNITS = ['km', 'm', 'm2', 'm3', 'ha', 'szt.', 'kpl.'] as const;

export function canAccessTenders(
  user: Pick<User, 'role'> | null | undefined
): boolean {
  return Boolean(user && (user.role === 'admin' || user.role === 'project_manager'));
}

export function canDeleteTender(
  user: Pick<User, 'id' | 'role'> | null | undefined,
  tender: { createdBy?: string } | null | undefined
): boolean {
  if (!user || !tender) return false;
  if (user.role === 'admin') return true;
  return Boolean(tender.createdBy && tender.createdBy === user.id);
}

export function formatTenderPln(
  value: number | null | undefined,
  emptyAs: string = '—'
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return emptyAs;
  }
  return `${formatMoney(value)} zł`;
}

export function formatTenderPercent(
  value: number | null | undefined,
  emptyAs: string = '—'
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return emptyAs;
  }
  const rounded = roundMoney(value);
  return `${rounded.toFixed(2).replace('.', ',')}%`;
}

export function formatTenderScope(
  quantity: number | null | undefined,
  unit: string | null | undefined,
  emptyAs: string = '—'
): string {
  if (quantity === null || quantity === undefined || !Number.isFinite(quantity) || quantity <= 0) {
    return emptyAs;
  }
  const qtyStr = formatQuantity(quantity);
  const trimmedUnit = typeof unit === 'string' ? unit.trim() : '';
  return trimmedUnit ? `${qtyStr} ${trimmedUnit}` : qtyStr;
}

export function formatTenderPricePerUnit(
  value: number | null | undefined,
  unit: string | null | undefined,
  emptyAs: string = '—'
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return emptyAs;
  }
  const trimmedUnit = typeof unit === 'string' ? unit.trim() : '';
  return `${formatMoney(value)} zł/${trimmedUnit || 'jedn.'}`;
}

export function isValidTenderHttpUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return true;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function computeLiveBidderPreview(
  price: number | null,
  scopeQuantity: number | null,
  authorityBudget: number | null
): { pricePerUnit: number | null; pctOfBudget: number | null } {
  if (price === null || !Number.isFinite(price)) {
    return { pricePerUnit: null, pctOfBudget: null };
  }
  const pricePerUnit =
    scopeQuantity !== null && Number.isFinite(scopeQuantity) && scopeQuantity > 0
      ? roundMoney(price / scopeQuantity)
      : null;
  const pctOfBudget =
    authorityBudget !== null && Number.isFinite(authorityBudget) && authorityBudget > 0
      ? roundMoney((price / authorityBudget) * 100)
      : null;
  return { pricePerUnit, pctOfBudget };
}

export function sortComputedBiddersForDetail(bidders: ComputedBidder[]): ComputedBidder[] {
  return [...bidders].sort((a, b) => {
    const aDisq = Boolean(a.isDisqualified);
    const bDisq = Boolean(b.isDisqualified);
    if (aDisq !== bDisq) return aDisq ? 1 : -1;

    const aHasPrice = typeof a.price === 'number' && Number.isFinite(a.price);
    const bHasPrice = typeof b.price === 'number' && Number.isFinite(b.price);
    if (aHasPrice !== bHasPrice) return aHasPrice ? -1 : 1;

    if (aHasPrice && bHasPrice && a.price !== b.price) {
      return (a.price as number) - (b.price as number);
    }

    return a.name.localeCompare(b.name, 'pl', { sensitivity: 'base' });
  });
}

export function buildTenderQueryParams(
  filters: TenderFilterState,
  sort: TenderSortKey,
  order: TenderSortOrder,
  page: number,
  pageSize: number
): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.authority.trim()) params.set('authority', filters.authority.trim());
  if (filters.status) params.set('status', filters.status);
  if (filters.from.trim()) params.set('from', filters.from.trim());
  if (filters.to.trim()) params.set('to', filters.to.trim());
  if (filters.ourOnly) params.set('ourOnly', 'true');
  if (filters.won) params.set('won', 'true');
  if (filters.minPrice.trim()) {
    params.set('minPrice', filters.minPrice.trim().replace(',', '.').replace(/\s+/g, ''));
  }
  if (filters.maxPrice.trim()) {
    params.set('maxPrice', filters.maxPrice.trim().replace(',', '.').replace(/\s+/g, ''));
  }
  params.set('sort', sort);
  params.set('order', order);
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));
  return params;
}

/**
 * Zabezpieczenie przed wstrzyknięciem formuł w Excelu / Calc (CWE-1236):
 * komórki zaczynające się od =, +, -, @ (lub wiodących białych znaków przed nimi) poprzedzamy apostrofem '.
 */
export function sanitizeTenderCsvFormula(value: string): string {
  if (!value) return '';
  const firstChar = value.charAt(0);
  if (
    firstChar === '=' ||
    firstChar === '+' ||
    firstChar === '-' ||
    firstChar === '@'
  ) {
    return `'${value}`;
  }
  const trimmedStart = value.replace(/^[\s\t\r\n]+/, '');
  if (
    trimmedStart &&
    (trimmedStart.startsWith('=') ||
      trimmedStart.startsWith('+') ||
      trimmedStart.startsWith('-') ||
      trimmedStart.startsWith('@'))
  ) {
    return `'${value}`;
  }
  return value;
}

export function formatTenderCsvCell(value: string): string {
  const safe = sanitizeTenderCsvFormula(String(value ?? ''));
  if (
    safe.includes(';') ||
    safe.includes('"') ||
    safe.includes('\n') ||
    safe.includes('\r')
  ) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

function formatCsvDecimal(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '';
  }
  const rounded = Object.is(value, -0) ? 0 : roundMoney(value);
  return rounded.toFixed(2).replace('.', ',');
}

function formatCsvQty(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '';
  }
  return formatQuantity(value);
}

export function exportTendersCsv(
  items: TenderListItem[],
  companies: Company[] = []
): string {
  const companyMap = new Map(companies.map((c) => [c.id, c]));
  const headers = [
    'Nazwa',
    'Zamawiający',
    'Numer referencyjny',
    'Status',
    'Podstawa cen',
    'Data ogłoszenia',
    'Termin składania',
    'Data rozstrzygnięcia',
    'Cena zamawiającego',
    'Zakres (ilość)',
    'Jednostka',
    'Cena zwycięzcy',
    'Nasza oferta',
    'Nasze miejsce',
    'Firma naszej oferty',
    'Cena/jednostkę (zwycięzca)',
    'Nasza cena/jednostkę',
    '% ceny zamawiającego',
    'Liczba ofert',
    'Wygrany przez nas',
    'Link',
  ];

  const lines: string[] = [headers.map(formatTenderCsvCell).join(';')];

  for (const item of items) {
    const ourBidder = Array.isArray(item.bidders)
      ? item.bidders.find((b) => b.isOurs)
      : undefined;
    const ourCompany = ourBidder?.companyId
      ? companyMap.get(ourBidder.companyId)
      : undefined;
    const ourCompanyLabel = ourCompany
      ? `${ourCompany.letter} - ${ourCompany.name}`
      : '';

    const cells = [
      item.name || '',
      item.contractingAuthority || '',
      item.referenceNumber || '',
      TENDER_STATUS_LABELS[item.status] || item.status,
      TENDER_PRICE_BASIS_LABELS[item.priceBasis] || item.priceBasis,
      item.announcementDate || '',
      item.submissionDeadline || '',
      item.resolutionDate || '',
      formatCsvDecimal(item.authorityBudget),
      formatCsvQty(item.scopeQuantity),
      item.scopeUnit || '',
      formatCsvDecimal(item.winnerPrice),
      formatCsvDecimal(item.ourPrice),
      item.ourRank !== null && item.ourRank !== undefined ? String(item.ourRank) : '',
      ourCompanyLabel,
      formatCsvDecimal(item.winnerPricePerUnit),
      formatCsvDecimal(item.ourPricePerUnit),
      formatCsvDecimal(item.winnerToBudgetPct),
      String(item.biddersCount ?? 0),
      item.wonByUs ? 'Tak' : 'Nie',
      item.url || '',
    ];

    lines.push(cells.map(formatTenderCsvCell).join(';'));
  }

  return `\uFEFF${lines.join('\r\n')}`;
}
