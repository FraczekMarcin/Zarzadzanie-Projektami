import crypto from 'crypto';
import type {
  Bidder,
  Company,
  Project,
  ProjectNumberingScope,
  Tender,
  TenderPriceBasis,
  TenderStatus,
  TrashEntry,
} from '../types/index.js';
import { hasForbiddenKeys } from './access.js';
import {
  calcGrossFromNet,
  calcNetFromGross,
  MONEY_PRECISION_ERROR,
  parseMoney,
  parseQuantity,
  QUANTITY_PRECISION_ERROR,
  roundMoney,
  subtractMoney,
} from './money.js';
import { getNextProjectCode } from './projectCode.js';
import { addDaysIso, getTodayIso, parseIsoDate } from './today.js';
import type { VatRateOption } from './variablesSchema.js';

export const MAX_TENDERS = 5000;
export const MAX_BIDDERS_PER_TENDER = 50;
export const TENDER_MONEY_MAX = 999_999_999.99;

export const TENDER_STRING_LIMITS = {
  name: 200,
  contractingAuthority: 200,
  referenceNumber: 100,
  description: 2000,
  url: 500,
  scopeUnit: 20,
  notes: 2000,
  bidderId: 100,
  bidderName: 200,
  bidderNotes: 500,
} as const;

export const COMMON_SCOPE_UNITS = ['km', 'm', 'm2', 'm3', 'ha', 'szt.', 'kpl.'] as const;

export const TENDER_STATUSES: readonly TenderStatus[] = ['announced', 'resolved', 'cancelled'];
export const TENDER_PRICE_BASES: readonly TenderPriceBasis[] = ['net', 'gross'];

export const TENDER_SORT_KEYS = [
  'resolutionDate',
  'name',
  'contractingAuthority',
  'authorityBudget',
  'winnerPrice',
  'ourPrice',
  'winnerPricePerUnit',
  'ourPricePerUnit',
  'winnerToBudgetPct',
  'biddersCount',
] as const;

export type TenderSortKey = (typeof TENDER_SORT_KEYS)[number];
export type TenderSortOrder = 'asc' | 'desc';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const TENDER_WRITABLE_KEYS = new Set<string>([
  'name',
  'contractingAuthority',
  'referenceNumber',
  'description',
  'url',
  'announcementDate',
  'submissionDeadline',
  'resolutionDate',
  'status',
  'priceBasis',
  'authorityBudget',
  'scopeQuantity',
  'scopeUnit',
  'notes',
  'bidders',
  'winnerBidderId',
]);

export const TENDER_PATCH_ALLOWED_KEYS = new Set<string>([
  ...TENDER_WRITABLE_KEYS,
  'expectedRevision',
]);

export const BIDDER_ALLOWED_KEYS = new Set<string>([
  'id',
  'name',
  'price',
  'isOurs',
  'companyId',
  'isDisqualified',
  'notes',
]);

export const CREATE_PROJECT_ALLOWED_KEYS = new Set<string>([
  'startDate',
  'dueDate',
  'vatRate',
  'companyId',
  'force',
  'templateId',
]);

export interface ComputedBidder extends Bidder {
  rank: number | null;
  pricePerUnit: number | null;
  pctOfBudget: number | null;
}

export interface TenderComputedMetrics {
  biddersCount: number;
  lowestPrice: number | null;
  winnerPrice: number | null;
  ourPrice: number | null;
  ourRank: number | null;
  authorityBudgetPerUnit: number | null;
  winnerPricePerUnit: number | null;
  ourPricePerUnit: number | null;
  winnerToBudgetPct: number | null;
  ourToBudgetPct: number | null;
  differenceOurVsWinner: number | null;
  wonByUs: boolean;
}

export interface TenderListItem extends Tender, TenderComputedMetrics {}

export interface TenderDetail extends Omit<Tender, 'bidders'>, TenderComputedMetrics {
  bidders: ComputedBidder[];
}

export interface UnitPriceStats {
  unit: string;
  count: number;
  min: number;
  median: number;
  max: number;
}

export interface TenderSummary {
  totalCount: number;
  withScopeCount: number;
  wonCount: number;
  wonPercent: number;
  commonScopeUnit: string | null;
  winnerPricePerUnit: UnitPriceStats | null;
  winnerPricePerUnitByUnit: Record<string, UnitPriceStats>;
}

export interface TenderListQuery {
  q?: string;
  authority?: string;
  status?: string;
  from?: string;
  to?: string;
  ourOnly?: boolean;
  won?: boolean;
  minPrice?: number;
  maxPrice?: number;
  sort?: TenderSortKey;
  order?: TenderSortOrder;
  page?: number;
  pageSize?: number;
}

export interface TenderValidationResult {
  ok: boolean;
  error?: string;
  field?: string;
  tender?: Tender;
  changedFields?: string[];
}

function isPlainObject(val: unknown): val is Record<string, any> {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return false;
  const proto = Object.getPrototypeOf(val);
  return proto === Object.prototype || proto === null;
}

export function normalizeTenderSearchText(input: string): string {
  return String(input || '')
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export function normalizeScopeUnitKey(unit?: string | null): string {
  const trimmed = typeof unit === 'string' ? unit.trim() : '';
  if (!trimmed) return 'brak';
  return trimmed.toLowerCase().replace(/m²/g, 'm2').replace(/m³/g, 'm3');
}

export function isValidIsoDate(val: unknown): val is string {
  if (typeof val !== 'string') return false;
  const trimmed = val.trim();
  if (!ISO_DATE_RE.test(trimmed)) return false;
  const [yStr, mStr, dStr] = trimmed.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function isValidHttpUrl(val: string): boolean {
  try {
    const parsed = new URL(val);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isValidTenderMoney(val: unknown): val is number {
  if (typeof val !== 'number' || !Number.isFinite(val)) return false;
  if (val < 0 || val > TENDER_MONEY_MAX) return false;
  return parseMoney(val) !== null;
}

export function isValidTenderQuantity(val: unknown): val is number {
  if (typeof val !== 'number' || !Number.isFinite(val)) return false;
  return parseQuantity(val) !== null;
}

function validateOptionalString(
  raw: unknown,
  field: string,
  maxLen: number
): { ok: true; value: string | undefined; cleared: boolean } | { ok: false; error: string; field: string } {
  if (raw === undefined) {
    return { ok: true, value: undefined, cleared: false };
  }
  if (raw === null) {
    return { ok: true, value: undefined, cleared: true };
  }
  if (typeof raw !== 'string') {
    return { ok: false, error: `Pole "${field}" musi być tekstem.`, field };
  }
  const trimmed = raw.trim();
  if (trimmed.length > maxLen) {
    return {
      ok: false,
      error: `Pole "${field}" przekracza maksymalny limit ${maxLen} znaków.`,
      field,
    };
  }
  if (!trimmed) {
    return { ok: true, value: undefined, cleared: true };
  }
  return { ok: true, value: trimmed, cleared: false };
}

function validateBiddersArray(
  rawBidders: unknown,
  companies: Company[],
  idFactory: () => string
): { ok: true; bidders: Bidder[] } | { ok: false; error: string; field: string } {
  if (!Array.isArray(rawBidders)) {
    return { ok: false, error: 'Lista oferentów (bidders) musi być tablicą.', field: 'bidders' };
  }
  if (rawBidders.length > MAX_BIDDERS_PER_TENDER) {
    return {
      ok: false,
      error: `Przetarg może zawierać maksymalnie ${MAX_BIDDERS_PER_TENDER} oferentów.`,
      field: 'bidders',
    };
  }

  const companyIds = new Set(
    (Array.isArray(companies) ? companies : []).filter((c) => c && c.id).map((c) => c.id)
  );
  const seenIds = new Set<string>();
  const normalized: Bidder[] = [];
  let ourCount = 0;

  for (let i = 0; i < rawBidders.length; i++) {
    const item = rawBidders[i];
    if (!isPlainObject(item) || hasForbiddenKeys(item)) {
      return {
        ok: false,
        error: `Nieprawidłowa struktura oferenta na pozycji ${i + 1}.`,
        field: 'bidders',
      };
    }

    for (const key of Object.keys(item)) {
      if (!BIDDER_ALLOWED_KEYS.has(key)) {
        return {
          ok: false,
          error: `Nieznane pole "${key}" w danych oferenta.`,
          field: `bidders[${i}].${key}`,
        };
      }
    }

    let bidderId: string;
    if (item.id === undefined || item.id === null) {
      bidderId = idFactory();
    } else if (typeof item.id !== 'string' || !item.id.trim()) {
      return {
        ok: false,
        error: `Nieprawidłowy identyfikator oferenta na pozycji ${i + 1}.`,
        field: `bidders[${i}].id`,
      };
    } else {
      bidderId = item.id.trim();
      if (bidderId.length > TENDER_STRING_LIMITS.bidderId) {
        return {
          ok: false,
          error: `Identyfikator oferenta przekracza limit ${TENDER_STRING_LIMITS.bidderId} znaków.`,
          field: `bidders[${i}].id`,
        };
      }
    }

    if (seenIds.has(bidderId)) {
      return {
        ok: false,
        error: `Duplikat identyfikatora oferenta "${bidderId}".`,
        field: `bidders[${i}].id`,
      };
    }
    seenIds.add(bidderId);

    if (typeof item.name !== 'string' || !item.name.trim()) {
      return {
        ok: false,
        error: `Oferent na pozycji ${i + 1} musi posiadać nazwę.`,
        field: `bidders[${i}].name`,
      };
    }
    const bidderName = item.name.trim();
    if (bidderName.length > TENDER_STRING_LIMITS.bidderName) {
      return {
        ok: false,
        error: `Nazwa oferenta przekracza limit ${TENDER_STRING_LIMITS.bidderName} znaków.`,
        field: `bidders[${i}].name`,
      };
    }

    let price: number | undefined;
    if (item.price !== undefined && item.price !== null) {
      if (!isValidTenderMoney(item.price)) {
        return {
          ok: false,
          error: `${MONEY_PRECISION_ERROR} (maks. ${TENDER_MONEY_MAX}).`,
          field: `bidders[${i}].price`,
        };
      }
      price = roundMoney(item.price);
    }

    let isOurs = false;
    if (item.isOurs !== undefined) {
      if (typeof item.isOurs !== 'boolean') {
        return {
          ok: false,
          error: 'Pole "isOurs" oferenta musi być wartością logiczną.',
          field: `bidders[${i}].isOurs`,
        };
      }
      isOurs = item.isOurs;
    }

    if (isOurs) {
      ourCount += 1;
      if (ourCount > 1) {
        return {
          ok: false,
          error: 'Przetarg może zawierać maksymalnie jednego naszego oferenta (isOurs: true).',
          field: 'bidders',
        };
      }
    }

    let companyId: string | undefined;
    if (item.companyId !== undefined && item.companyId !== null && item.companyId !== '') {
      if (typeof item.companyId !== 'string') {
        return {
          ok: false,
          error: 'Pole "companyId" oferenta musi być identyfikatorem tekstowym.',
          field: `bidders[${i}].companyId`,
        };
      }
      const trimmedCompanyId = item.companyId.trim();
      if (trimmedCompanyId) {
        if (!isOurs) {
          return {
            ok: false,
            error: 'Pole "companyId" oferenta jest dozwolone wyłącznie dla naszej oferty (isOurs: true).',
            field: `bidders[${i}].companyId`,
          };
        }
        if (!companyIds.has(trimmedCompanyId)) {
          return {
            ok: false,
            error: `Wybrana firma oferenta "${trimmedCompanyId}" nie istnieje.`,
            field: `bidders[${i}].companyId`,
          };
        }
        companyId = trimmedCompanyId;
      }
    }

    let isDisqualified: boolean | undefined;
    if (item.isDisqualified !== undefined) {
      if (typeof item.isDisqualified !== 'boolean') {
        return {
          ok: false,
          error: 'Pole "isDisqualified" oferenta musi być wartością logiczną.',
          field: `bidders[${i}].isDisqualified`,
        };
      }
      if (item.isDisqualified) {
        isDisqualified = true;
      }
    }

    const notesRes = validateOptionalString(
      item.notes,
      `bidders[${i}].notes`,
      TENDER_STRING_LIMITS.bidderNotes
    );
    if (!notesRes.ok) {
      return notesRes;
    }

    const bidder: Bidder = {
      id: bidderId,
      name: bidderName,
      isOurs,
      ...(price !== undefined ? { price } : {}),
      ...(companyId ? { companyId } : {}),
      ...(isDisqualified ? { isDisqualified: true } : {}),
      ...(notesRes.value ? { notes: notesRes.value } : {}),
    };
    normalized.push(bidder);
  }

  return { ok: true, bidders: normalized };
}

export interface ValidateTenderWriteOptions {
  mode: 'create' | 'update';
  existingTender?: Tender;
  companies?: Company[];
  callerId: string;
  nowIso?: string;
  idFactory?: () => string;
}

export function validateTenderWritePayload(
  rawInput: unknown,
  options: ValidateTenderWriteOptions
): TenderValidationResult {
  if (!isPlainObject(rawInput) || hasForbiddenKeys(rawInput)) {
    return {
      ok: false,
      error: 'Nieprawidłowy format danych przetargu.',
    };
  }

  const allowedKeys = options.mode === 'create' ? TENDER_WRITABLE_KEYS : TENDER_PATCH_ALLOWED_KEYS;
  for (const key of Object.keys(rawInput)) {
    if (!allowedKeys.has(key)) {
      return {
        ok: false,
        error: `Nieznane pole "${key}" w danych przetargu.`,
        field: key,
      };
    }
  }

  const idFactory = options.idFactory ?? (() => crypto.randomUUID());
  const nowIso = options.nowIso ?? new Date().toISOString();
  const companies = Array.isArray(options.companies) ? options.companies : [];
  const existing = options.existingTender;

  if (options.mode === 'update' && !existing) {
    return { ok: false, error: 'Brak istniejącego przetargu do aktualizacji.' };
  }

  // name
  let name: string;
  if (rawInput.name !== undefined || options.mode === 'create') {
    if (typeof rawInput.name !== 'string' || !rawInput.name.trim()) {
      return { ok: false, error: 'Wymagana nazwa przetargu.', field: 'name' };
    }
    const trimmed = rawInput.name.trim();
    if (trimmed.length > TENDER_STRING_LIMITS.name) {
      return {
        ok: false,
        error: `Nazwa przetargu może mieć maksymalnie ${TENDER_STRING_LIMITS.name} znaków.`,
        field: 'name',
      };
    }
    name = trimmed;
  } else {
    name = existing!.name;
  }

  // contractingAuthority
  let contractingAuthority: string;
  if (rawInput.contractingAuthority !== undefined || options.mode === 'create') {
    if (typeof rawInput.contractingAuthority !== 'string' || !rawInput.contractingAuthority.trim()) {
      return {
        ok: false,
        error: 'Wymagana nazwa zamawiającego (contractingAuthority).',
        field: 'contractingAuthority',
      };
    }
    const trimmed = rawInput.contractingAuthority.trim();
    if (trimmed.length > TENDER_STRING_LIMITS.contractingAuthority) {
      return {
        ok: false,
        error: `Nazwa zamawiającego może mieć maksymalnie ${TENDER_STRING_LIMITS.contractingAuthority} znaków.`,
        field: 'contractingAuthority',
      };
    }
    contractingAuthority = trimmed;
  } else {
    contractingAuthority = existing!.contractingAuthority;
  }

  // optional string fields
  const refRes = validateOptionalString(
    rawInput.referenceNumber,
    'referenceNumber',
    TENDER_STRING_LIMITS.referenceNumber
  );
  if (!refRes.ok) return refRes;
  const referenceNumber =
    rawInput.referenceNumber !== undefined ? refRes.value : existing?.referenceNumber;

  const descRes = validateOptionalString(
    rawInput.description,
    'description',
    TENDER_STRING_LIMITS.description
  );
  if (!descRes.ok) return descRes;
  const description = rawInput.description !== undefined ? descRes.value : existing?.description;

  const urlRes = validateOptionalString(rawInput.url, 'url', TENDER_STRING_LIMITS.url);
  if (!urlRes.ok) return urlRes;
  let url: string | undefined;
  if (rawInput.url !== undefined) {
    if (urlRes.value !== undefined && !isValidHttpUrl(urlRes.value)) {
      return {
        ok: false,
        error: 'Adres URL przetargu musi zaczynać się od http:// lub https://.',
        field: 'url',
      };
    }
    url = urlRes.value;
  } else {
    url = existing?.url;
  }

  const notesRes = validateOptionalString(rawInput.notes, 'notes', TENDER_STRING_LIMITS.notes);
  if (!notesRes.ok) return notesRes;
  const notes = rawInput.notes !== undefined ? notesRes.value : existing?.notes;

  const unitRes = validateOptionalString(
    rawInput.scopeUnit,
    'scopeUnit',
    TENDER_STRING_LIMITS.scopeUnit
  );
  if (!unitRes.ok) return unitRes;
  const scopeUnit = rawInput.scopeUnit !== undefined ? unitRes.value : existing?.scopeUnit;

  // dates
  let announcementDate: string | undefined;
  if (rawInput.announcementDate !== undefined) {
    if (rawInput.announcementDate === null || rawInput.announcementDate === '') {
      announcementDate = undefined;
    } else if (!isValidIsoDate(rawInput.announcementDate)) {
      return {
        ok: false,
        error: 'Nieprawidłowy format daty ogłoszenia (oczekiwano RRRR-MM-DD).',
        field: 'announcementDate',
      };
    } else {
      announcementDate = rawInput.announcementDate.trim();
    }
  } else {
    announcementDate = existing?.announcementDate;
  }

  let submissionDeadline: string | undefined;
  if (rawInput.submissionDeadline !== undefined) {
    if (rawInput.submissionDeadline === null || rawInput.submissionDeadline === '') {
      submissionDeadline = undefined;
    } else if (!isValidIsoDate(rawInput.submissionDeadline)) {
      return {
        ok: false,
        error: 'Nieprawidłowy format terminu składania ofert (oczekiwano RRRR-MM-DD).',
        field: 'submissionDeadline',
      };
    } else {
      submissionDeadline = rawInput.submissionDeadline.trim();
    }
  } else {
    submissionDeadline = existing?.submissionDeadline;
  }

  let resolutionDate: string;
  if (rawInput.resolutionDate !== undefined || options.mode === 'create') {
    if (!isValidIsoDate(rawInput.resolutionDate)) {
      return {
        ok: false,
        error: 'Wymagana prawidłowa data rozstrzygnięcia (resolutionDate w formacie RRRR-MM-DD).',
        field: 'resolutionDate',
      };
    }
    resolutionDate = rawInput.resolutionDate.trim();
  } else {
    resolutionDate = existing!.resolutionDate;
  }

  // status & priceBasis
  let status: TenderStatus;
  if (rawInput.status !== undefined) {
    if (typeof rawInput.status !== 'string' || !TENDER_STATUSES.includes(rawInput.status as TenderStatus)) {
      return {
        ok: false,
        error: 'Nieprawidłowy status przetargu (dozwolone: announced, resolved, cancelled).',
        field: 'status',
      };
    }
    status = rawInput.status as TenderStatus;
  } else {
    status = options.mode === 'create' ? 'announced' : existing!.status;
  }

  let priceBasis: TenderPriceBasis;
  if (rawInput.priceBasis !== undefined) {
    if (
      typeof rawInput.priceBasis !== 'string' ||
      !TENDER_PRICE_BASES.includes(rawInput.priceBasis as TenderPriceBasis)
    ) {
      return {
        ok: false,
        error: 'Nieprawidłowa podstawa cen (priceBasis: net lub gross).',
        field: 'priceBasis',
      };
    }
    priceBasis = rawInput.priceBasis as TenderPriceBasis;
  } else {
    priceBasis = options.mode === 'create' ? 'gross' : existing!.priceBasis;
  }

  // numeric fields
  let authorityBudget: number | undefined;
  if (rawInput.authorityBudget !== undefined) {
    if (rawInput.authorityBudget === null) {
      authorityBudget = undefined;
    } else if (!isValidTenderMoney(rawInput.authorityBudget)) {
      return {
        ok: false,
        error: `${MONEY_PRECISION_ERROR} (maks. ${TENDER_MONEY_MAX}).`,
        field: 'authorityBudget',
      };
    } else {
      authorityBudget = roundMoney(rawInput.authorityBudget);
    }
  } else {
    authorityBudget = existing?.authorityBudget;
  }

  let scopeQuantity: number | undefined;
  if (rawInput.scopeQuantity !== undefined) {
    if (rawInput.scopeQuantity === null) {
      scopeQuantity = undefined;
    } else if (!isValidTenderQuantity(rawInput.scopeQuantity)) {
      return {
        ok: false,
        error: QUANTITY_PRECISION_ERROR,
        field: 'scopeQuantity',
      };
    } else {
      scopeQuantity = parseQuantity(rawInput.scopeQuantity)!;
    }
  } else {
    scopeQuantity = existing?.scopeQuantity;
  }

  // bidders
  let bidders: Bidder[];
  if (rawInput.bidders !== undefined) {
    const biddersRes = validateBiddersArray(rawInput.bidders, companies, idFactory);
    if (!biddersRes.ok) {
      return biddersRes;
    }
    bidders = biddersRes.bidders;
  } else {
    bidders = options.mode === 'create' ? [] : existing!.bidders.map((b) => ({ ...b }));
  }

  // winnerBidderId
  let winnerBidderId: string | undefined;
  const hasExplicitWinner = Object.prototype.hasOwnProperty.call(rawInput, 'winnerBidderId');
  if (hasExplicitWinner) {
    if (rawInput.winnerBidderId === null || rawInput.winnerBidderId === '') {
      winnerBidderId = undefined;
    } else if (typeof rawInput.winnerBidderId !== 'string') {
      return {
        ok: false,
        error: 'Pole "winnerBidderId" musi być identyfikatorem tekstowym.',
        field: 'winnerBidderId',
      };
    } else {
      const trimmedWinner = rawInput.winnerBidderId.trim();
      winnerBidderId = trimmedWinner || undefined;
    }
  } else if (options.mode === 'update') {
    winnerBidderId = status === 'resolved' ? existing?.winnerBidderId : undefined;
  }

  if (winnerBidderId !== undefined) {
    if (status !== 'resolved') {
      return {
        ok: false,
        error: 'Pole "winnerBidderId" jest dozwolone wyłącznie przy statusie "resolved".',
        field: 'winnerBidderId',
      };
    }
    const matchedWinner = bidders.find((b) => b.id === winnerBidderId);
    if (!matchedWinner) {
      return {
        ok: false,
        error: `Wskazany zwycięzca "${winnerBidderId}" nie istnieje na liście oferentów.`,
        field: 'winnerBidderId',
      };
    }
    if (matchedWinner.isDisqualified) {
      return {
        ok: false,
        error: 'Zdyskwalifikowany oferent nie może zostać wskazany jako zwycięzca.',
        field: 'winnerBidderId',
      };
    }
  }

  const tender: Tender = {
    id: options.mode === 'create' ? idFactory() : existing!.id,
    name,
    contractingAuthority,
    ...(referenceNumber !== undefined ? { referenceNumber } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(url !== undefined ? { url } : {}),
    ...(announcementDate !== undefined ? { announcementDate } : {}),
    ...(submissionDeadline !== undefined ? { submissionDeadline } : {}),
    resolutionDate,
    status,
    priceBasis,
    ...(authorityBudget !== undefined ? { authorityBudget } : {}),
    ...(scopeQuantity !== undefined ? { scopeQuantity } : {}),
    ...(scopeUnit !== undefined ? { scopeUnit } : {}),
    ...(notes !== undefined ? { notes } : {}),
    bidders,
    ...(winnerBidderId !== undefined ? { winnerBidderId } : {}),
    ...(existing?.linkedProjectId ? { linkedProjectId: existing.linkedProjectId } : {}),
    createdAt: options.mode === 'create' ? nowIso : existing!.createdAt,
    createdBy: options.mode === 'create' ? options.callerId : existing!.createdBy,
    updatedAt: nowIso,
    revision: options.mode === 'create' ? 1 : (existing!.revision || 1) + 1,
  };

  let changedFields: string[] | undefined;
  if (options.mode === 'update' && existing) {
    changedFields = [];
    const checkFields: Array<keyof Tender> = [
      'name',
      'contractingAuthority',
      'referenceNumber',
      'description',
      'url',
      'announcementDate',
      'submissionDeadline',
      'resolutionDate',
      'status',
      'priceBasis',
      'authorityBudget',
      'scopeQuantity',
      'scopeUnit',
      'notes',
      'bidders',
      'winnerBidderId',
    ];
    for (const f of checkFields) {
      if (JSON.stringify(existing[f] ?? null) !== JSON.stringify(tender[f] ?? null)) {
        changedFields.push(f);
      }
    }
  }

  return {
    ok: true,
    tender,
    ...(changedFields ? { changedFields } : {}),
  };
}

function calcPct(part: number, total: number): number {
  return roundMoney((part / total) * 100);
}

export function computeBidderDetails(tender: Tender): ComputedBidder[] {
  const bidders = Array.isArray(tender.bidders) ? tender.bidders : [];
  const scopeQuantity =
    typeof tender.scopeQuantity === 'number' && tender.scopeQuantity > 0
      ? tender.scopeQuantity
      : null;
  const authorityBudget =
    typeof tender.authorityBudget === 'number' && tender.authorityBudget > 0
      ? tender.authorityBudget
      : null;

  const eligiblePrices = bidders
    .filter((b) => !b.isDisqualified && typeof b.price === 'number' && Number.isFinite(b.price))
    .map((b) => b.price as number);

  return bidders.map((b) => {
    const hasValidPrice = typeof b.price === 'number' && Number.isFinite(b.price);
    const rank =
      !b.isDisqualified && hasValidPrice
        ? 1 + eligiblePrices.filter((p) => p < (b.price as number)).length
        : null;
    const pricePerUnit =
      hasValidPrice && scopeQuantity !== null ? roundMoney((b.price as number) / scopeQuantity) : null;
    const pctOfBudget =
      hasValidPrice && authorityBudget !== null ? calcPct(b.price as number, authorityBudget) : null;

    return {
      ...b,
      rank,
      pricePerUnit,
      pctOfBudget,
    };
  });
}

export function computeTenderMetrics(tender: Tender): TenderComputedMetrics {
  const bidders = Array.isArray(tender.bidders) ? tender.bidders : [];
  const scopeQuantity =
    typeof tender.scopeQuantity === 'number' && tender.scopeQuantity > 0
      ? tender.scopeQuantity
      : null;
  const authorityBudget =
    typeof tender.authorityBudget === 'number' && tender.authorityBudget > 0
      ? tender.authorityBudget
      : null;

  const eligiblePriced = bidders.filter(
    (b) => !b.isDisqualified && typeof b.price === 'number' && Number.isFinite(b.price)
  );
  const lowestPrice =
    eligiblePriced.length > 0 ? Math.min(...eligiblePriced.map((b) => b.price as number)) : null;

  const winnerBidder = tender.winnerBidderId
    ? bidders.find((b) => b.id === tender.winnerBidderId)
    : undefined;

  const winnerPrice = tender.winnerBidderId
    ? winnerBidder && typeof winnerBidder.price === 'number' && Number.isFinite(winnerBidder.price)
      ? winnerBidder.price
      : null
    : lowestPrice;

  const ourBidder = bidders.find((b) => b.isOurs);
  const ourPrice =
    ourBidder && typeof ourBidder.price === 'number' && Number.isFinite(ourBidder.price)
      ? ourBidder.price
      : null;
  const ourRank =
    ourBidder && !ourBidder.isDisqualified && ourPrice !== null
      ? 1 + eligiblePriced.filter((b) => (b.price as number) < ourPrice).length
      : null;

  const authorityBudgetPerUnit =
    authorityBudget !== null && scopeQuantity !== null
      ? roundMoney(authorityBudget / scopeQuantity)
      : null;
  const winnerPricePerUnit =
    winnerPrice !== null && scopeQuantity !== null ? roundMoney(winnerPrice / scopeQuantity) : null;
  const ourPricePerUnit =
    ourPrice !== null && scopeQuantity !== null ? roundMoney(ourPrice / scopeQuantity) : null;

  const winnerToBudgetPct =
    winnerPrice !== null && authorityBudget !== null ? calcPct(winnerPrice, authorityBudget) : null;
  const ourToBudgetPct =
    ourPrice !== null && authorityBudget !== null ? calcPct(ourPrice, authorityBudget) : null;

  const differenceOurVsWinner =
    ourPrice !== null && winnerPrice !== null ? subtractMoney(ourPrice, winnerPrice) : null;

  const wonByUs = Boolean(
    tender.status === 'resolved' &&
      winnerBidder &&
      winnerBidder.isOurs === true &&
      !winnerBidder.isDisqualified
  );

  return {
    biddersCount: bidders.length,
    lowestPrice,
    winnerPrice,
    ourPrice,
    ourRank,
    authorityBudgetPerUnit,
    winnerPricePerUnit,
    ourPricePerUnit,
    winnerToBudgetPct,
    ourToBudgetPct,
    differenceOurVsWinner,
    wonByUs,
  };
}

export function toTenderListItem(tender: Tender): TenderListItem {
  return {
    ...tender,
    ...computeTenderMetrics(tender),
  };
}

export function toTenderDetail(tender: Tender): TenderDetail {
  return {
    ...tender,
    bidders: computeBidderDetails(tender),
    ...computeTenderMetrics(tender),
  };
}

export function filterTenders(tenders: Tender[], query: TenderListQuery): TenderListItem[] {
  const qNorm = query.q ? normalizeTenderSearchText(query.q) : '';
  const authorityNorm = query.authority ? normalizeTenderSearchText(query.authority) : '';
  const statusFilter = query.status ? query.status.trim() : '';
  const fromDate = query.from ? query.from.trim() : '';
  const toDate = query.to ? query.to.trim() : '';

  const results: TenderListItem[] = [];

  for (const tender of tenders) {
    if (!tender) continue;

    if (qNorm) {
      const haystacks = [
        tender.name,
        tender.contractingAuthority,
        tender.referenceNumber || '',
        ...(Array.isArray(tender.bidders) ? tender.bidders.map((b) => b.name) : []),
      ];
      const matchesQ = haystacks.some((text) => normalizeTenderSearchText(text).includes(qNorm));
      if (!matchesQ) continue;
    }

    if (authorityNorm) {
      if (!normalizeTenderSearchText(tender.contractingAuthority).includes(authorityNorm)) {
        continue;
      }
    }

    if (statusFilter && tender.status !== statusFilter) {
      continue;
    }

    if (fromDate && tender.resolutionDate < fromDate) {
      continue;
    }
    if (toDate && tender.resolutionDate > toDate) {
      continue;
    }

    if (query.ourOnly) {
      const hasOurOffer =
        Array.isArray(tender.bidders) && tender.bidders.some((b) => b && b.isOurs === true);
      if (!hasOurOffer) continue;
    }

    const item = toTenderListItem(tender);

    if (query.won && !item.wonByUs) {
      continue;
    }

    if (query.minPrice !== undefined) {
      if (item.winnerPrice === null || item.winnerPrice < query.minPrice) continue;
    }
    if (query.maxPrice !== undefined) {
      if (item.winnerPrice === null || item.winnerPrice > query.maxPrice) continue;
    }

    results.push(item);
  }

  return results;
}

export function sortTenders(
  items: TenderListItem[],
  sort: TenderSortKey = 'resolutionDate',
  order: TenderSortOrder = 'desc'
): TenderListItem[] {
  const dir = order === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    let cmp = 0;

    if (sort === 'name' || sort === 'contractingAuthority') {
      cmp = a[sort].localeCompare(b[sort], 'pl', { sensitivity: 'base' }) * dir;
    } else if (sort === 'resolutionDate') {
      cmp = a.resolutionDate.localeCompare(b.resolutionDate) * dir;
    } else {
      const aVal = a[sort];
      const bVal = b[sort];
      const aMissing = aVal === null || aVal === undefined;
      const bMissing = bVal === null || bVal === undefined;
      if (aMissing && bMissing) {
        cmp = 0;
      } else if (aMissing) {
        return 1;
      } else if (bMissing) {
        return -1;
      } else {
        cmp = ((aVal as number) - (bVal as number)) * dir;
      }
    }

    if (cmp !== 0) return cmp;
    const dateTie = b.resolutionDate.localeCompare(a.resolutionDate);
    if (dateTie !== 0) return dateTie;
    return a.id.localeCompare(b.id);
  });
}

function calcMedian(sortedNumbers: number[]): number {
  const n = sortedNumbers.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) {
    return sortedNumbers[mid];
  }
  return roundMoney((sortedNumbers[mid - 1] + sortedNumbers[mid]) / 2);
}

export function computeTenderSummary(items: TenderListItem[]): TenderSummary {
  const totalCount = items.length;
  let withScopeCount = 0;
  let wonCount = 0;

  const groupedByUnitKey = new Map<string, { displayUnit: string; values: number[] }>();

  for (const item of items) {
    if (typeof item.scopeQuantity === 'number' && item.scopeQuantity > 0) {
      withScopeCount += 1;
    }
    if (item.wonByUs) {
      wonCount += 1;
    }
    if (item.winnerPricePerUnit !== null) {
      const unitKey = normalizeScopeUnitKey(item.scopeUnit);
      const displayUnit =
        typeof item.scopeUnit === 'string' && item.scopeUnit.trim()
          ? item.scopeUnit.trim()
          : 'brak';
      const existingGroup = groupedByUnitKey.get(unitKey);
      if (existingGroup) {
        existingGroup.values.push(item.winnerPricePerUnit);
      } else {
        groupedByUnitKey.set(unitKey, {
          displayUnit,
          values: [item.winnerPricePerUnit],
        });
      }
    }
  }

  const winnerPricePerUnitByUnit: Record<string, UnitPriceStats> = {};
  for (const [, group] of groupedByUnitKey.entries()) {
    const sorted = [...group.values].sort((x, y) => x - y);
    const stats: UnitPriceStats = {
      unit: group.displayUnit,
      count: sorted.length,
      min: sorted[0],
      median: calcMedian(sorted),
      max: sorted[sorted.length - 1],
    };
    winnerPricePerUnitByUnit[group.displayUnit] = stats;
  }

  const unitKeys = Array.from(groupedByUnitKey.keys());
  let commonScopeUnit: string | null = null;
  let winnerPricePerUnit: UnitPriceStats | null = null;

  if (unitKeys.length === 1) {
    const onlyGroup = groupedByUnitKey.get(unitKeys[0])!;
    commonScopeUnit = onlyGroup.displayUnit;
    winnerPricePerUnit = winnerPricePerUnitByUnit[onlyGroup.displayUnit];
  }

  const wonPercent = totalCount > 0 ? roundMoney((wonCount / totalCount) * 100) : 0;

  return {
    totalCount,
    withScopeCount,
    wonCount,
    wonPercent,
    commonScopeUnit,
    winnerPricePerUnit,
    winnerPricePerUnitByUnit,
  };
}

export function resolveDefaultVatRate(vatRates?: VatRateOption[] | null): number {
  if (!Array.isArray(vatRates) || vatRates.length === 0) return 23;
  const defaultNonExempt = vatRates.find((v) => v && v.isDefault && !v.isExempt);
  if (defaultNonExempt) {
    const rate =
      typeof defaultNonExempt.value === 'number'
        ? defaultNonExempt.value
        : defaultNonExempt.rate;
    if (typeof rate === 'number' && Number.isFinite(rate) && rate >= 0) {
      return rate;
    }
  }
  const anyDefault = vatRates.find((v) => v && v.isDefault);
  if (anyDefault && !anyDefault.isExempt) {
    const rate = typeof anyDefault.value === 'number' ? anyDefault.value : anyDefault.rate;
    if (typeof rate === 'number' && Number.isFinite(rate) && rate >= 0) {
      return rate;
    }
  }
  return 23;
}

export interface BuildProjectFromTenderOptions {
  tender: Tender;
  callerId: string;
  projects: Project[];
  trashedProjects?: TrashEntry[];
  companies?: Company[];
  projectNumberingScope?: ProjectNumberingScope;
  defaultCompanyId?: string;
  vatRates?: VatRateOption[];
  body?: Record<string, any>;
  todayIso?: string;
  idFactory?: () => string;
}

export type BuildProjectFromTenderResult =
  | { ok: true; project: Project; notice?: string }
  | { ok: false; status: number; error: string; extra?: Record<string, any> };

export function buildProjectFromTender(
  opts: BuildProjectFromTenderOptions
): BuildProjectFromTenderResult {
  const { tender, callerId, projects, trashedProjects = [], companies = [] } = opts;
  const body = opts.body ?? {};

  if (!isPlainObject(body) || hasForbiddenKeys(body)) {
    return { ok: false, status: 400, error: 'Nieprawidłowy format danych żądania.' };
  }

  for (const key of Object.keys(body)) {
    if (!CREATE_PROJECT_ALLOWED_KEYS.has(key)) {
      return {
        ok: false,
        status: 400,
        error: `Nieznane pole "${key}" w żądaniu utworzenia projektu.`,
      };
    }
  }

  // Warunek wygranej przez nas
  if (tender.status !== 'resolved' || !tender.winnerBidderId) {
    return {
      ok: false,
      status: 409,
      error: 'Projekt można utworzyć wyłącznie z rozstrzygniętego przetargu wygranego przez naszą ofertę.',
    };
  }
  const winner = (tender.bidders || []).find((b) => b.id === tender.winnerBidderId);
  if (!winner || winner.isDisqualified || winner.isOurs !== true) {
    return {
      ok: false,
      status: 409,
      error: 'Projekt można utworzyć wyłącznie z przetargu wygranego przez naszą niezdyskwalifikowaną ofertę.',
    };
  }

  // Sprawdzenie ponownego kopiowania
  const force = body.force === true;
  if (tender.linkedProjectId && !force) {
    const existingProject = (projects || []).find((p) => p && p.id === tender.linkedProjectId);
    if (existingProject) {
      return {
        ok: false,
        status: 409,
        error: `Z tego przetargu utworzono już projekt "${existingProject.key}". Przekaż force: true, aby utworzyć kolejny projekt.`,
        extra: {
          existingProjectId: existingProject.id,
          existingProjectKey: existingProject.key,
        },
      };
    }
  }

  // Rozstrzygnięcie firmy
  let selectedCompany: Company | undefined;
  if (body.companyId !== undefined && body.companyId !== null && body.companyId !== '') {
    if (typeof body.companyId !== 'string') {
      return { ok: false, status: 400, error: 'Nieprawidłowy identyfikator firmy (companyId).' };
    }
    const requestedCompanyId = body.companyId.trim();
    selectedCompany = companies.find((c) => c && c.id === requestedCompanyId);
    if (!selectedCompany) {
      return { ok: false, status: 400, error: 'Wybrana firma nie istnieje.' };
    }
  } else if (winner.companyId) {
    selectedCompany = companies.find((c) => c && c.id === winner.companyId);
    if (!selectedCompany) {
      return { ok: false, status: 400, error: 'Firma przypisana do zwycięskiej oferty nie istnieje.' };
    }
  } else if (opts.defaultCompanyId) {
    const defComp = companies.find((c) => c && c.id === opts.defaultCompanyId && c.isActive);
    if (defComp) selectedCompany = defComp;
  }

  // Daty projektu
  const todayIso = opts.todayIso ?? getTodayIso();
  let startDate = todayIso;
  if (body.startDate !== undefined && body.startDate !== null && body.startDate !== '') {
    if (!isValidIsoDate(body.startDate)) {
      return {
        ok: false,
        status: 400,
        error: 'Nieprawidłowy format daty rozpoczęcia (startDate w formacie RRRR-MM-DD).',
      };
    }
    startDate = body.startDate.trim();
  }

  let dueDate: string;
  if (body.dueDate !== undefined && body.dueDate !== null && body.dueDate !== '') {
    if (!isValidIsoDate(body.dueDate)) {
      return {
        ok: false,
        status: 400,
        error: 'Nieprawidłowy format terminu zakończenia (dueDate w formacie RRRR-MM-DD).',
      };
    }
    dueDate = body.dueDate.trim();
    if (dueDate < startDate) {
      return {
        ok: false,
        status: 400,
        error: 'Termin zakończenia (dueDate) nie może być wcześniejszy niż data rozpoczęcia (startDate).',
      };
    }
  } else {
    dueDate = addDaysIso(startDate, 30);
  }

  const diffDays = Math.round(
    (parseIsoDate(dueDate).getTime() - parseIsoDate(startDate).getTime()) / (24 * 60 * 60 * 1000)
  );
  const durationDays = Math.max(1, diffDays);

  // Stawka VAT
  let requestedVatRate: number | undefined;
  if (body.vatRate !== undefined && body.vatRate !== null) {
    if (
      typeof body.vatRate !== 'number' ||
      !Number.isFinite(body.vatRate) ||
      body.vatRate < 0 ||
      body.vatRate > 100 ||
      Number(body.vatRate.toFixed(2)) !== body.vatRate
    ) {
      return {
        ok: false,
        status: 400,
        error: 'Nieprawidłowa stawka VAT (dozwolone 0–100%, maks. 2 miejsca po przecinku).',
      };
    }
    requestedVatRate = body.vatRate;
  }

  const isVatExempt = selectedCompany?.vatPayer === false;
  const defaultVatRate = resolveDefaultVatRate(opts.vatRates);
  const effectiveVatRate = isVatExempt ? 0 : (requestedVatRate ?? defaultVatRate);

  let projectValue: number | undefined;
  let projectValueGross: number | undefined;
  if (typeof winner.price === 'number' && Number.isFinite(winner.price)) {
    const rawPrice = roundMoney(winner.price);
    if (isVatExempt) {
      projectValue = rawPrice;
      projectValueGross = rawPrice;
    } else if (tender.priceBasis === 'net') {
      projectValue = rawPrice;
      projectValueGross = calcGrossFromNet(rawPrice, effectiveVatRate);
    } else {
      projectValueGross = rawPrice;
      projectValue = calcNetFromGross(rawPrice, effectiveVatRate);
    }
  }

  // Numer projektu RRRR-X_L (lub RRRR-NN gdy brak firmy)
  const scope: ProjectNumberingScope =
    opts.projectNumberingScope === 'company' ? 'company' : 'year';
  const parsedYear = Number(todayIso.slice(0, 4));
  const targetYear = Number.isInteger(parsedYear) && parsedYear >= 1900 ? parsedYear : new Date().getFullYear();
  let key: string;
  try {
    key = getNextProjectCode(
      projects,
      trashedProjects,
      companies,
      selectedCompany?.id,
      targetYear,
      scope
    );
  } catch (err: any) {
    return {
      ok: false,
      status: 400,
      error: err?.message || 'Nie udało się wygenerować numeru projektu.',
    };
  }

  // Opis projektu łączący description + url
  const descParts: string[] = [];
  if (tender.description && tender.description.trim()) {
    descParts.push(tender.description.trim());
  }
  if (tender.url && tender.url.trim()) {
    descParts.push(`Link do postępowania: ${tender.url.trim()}`);
  }
  const description = descParts.join('\n\n');

  const idFactory = opts.idFactory ?? (() => crypto.randomUUID());

  const project: Project = {
    id: idFactory(),
    key,
    ...(selectedCompany ? { companyId: selectedCompany.id } : {}),
    name: tender.name,
    description,
    priority: 'normal',
    status: 'planning',
    startDate,
    dueDate,
    durationDays,
    progress: 0,
    ...(projectValue !== undefined ? { projectValue } : {}),
    ...(projectValueGross !== undefined ? { projectValueGross } : {}),
    projectVatRate: effectiveVatRate,
    ownerId: callerId,
    memberIds: [callerId],
    color: '#3b82f6',
    clientName: tender.contractingAuthority,
    sourceTenderId: tender.id,
    revision: 1,
  };

  let notice: string | undefined;
  if (body.templateId !== undefined && body.templateId !== null && String(body.templateId).trim() !== '') {
    notice = 'Szablony projektów po stronie serwera nie są jeszcze obsługiwane — parametr templateId został zignorowany.';
  }

  return {
    ok: true,
    project,
    ...(notice ? { notice } : {}),
  };
}
