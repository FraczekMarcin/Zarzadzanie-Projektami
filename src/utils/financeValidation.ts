import { hasForbiddenKeys } from './access.js';
import {
  calcGrossFromNet,
  formatMoney,
  MONEY_PRECISION_ERROR,
  parseMoney,
  parseQuantity,
  QUANTITY_PRECISION_ERROR,
  roundMoney,
  toGrosze,
} from './money.js';

export interface FinanceValidationResult {
  ok: boolean;
  error?: string;
  itemType?: 'project' | 'quotation' | 'cost' | 'tranche';
  itemId?: string;
  field?: string;
}

export interface FinanceValidationOptions {
  company?: { vatPayer?: boolean } | null;
}

export const FINANCE_ARRAY_LIMITS = {
  quotations: 500,
  costs: 500,
  paymentTranches: 100,
} as const;

export const FINANCE_STRING_LIMITS = {
  title: 200,
  companyName: 200,
  contractorName: 200,
  invoiceNumber: 100,
  notes: 2000,
  unit: 20,
} as const;

const GROSS_TOLERANCE_GROSZE = 5; // 0,05 zł
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const QUOTATION_STATUSES = new Set(['draft', 'sent', 'accepted', 'rejected', 'invoiced']);
const QUOTATION_TYPES = new Set(['przychod', 'koszt']);
const QUOTATION_TAX_TYPES = new Set(['netto', 'brutto', 'zwolniony']);
const COST_STATUSES = new Set(['planned', 'incurred', 'paid']);
const COST_CATEGORIES = new Set([
  'mapa',
  'geologia',
  'uzgodnienia',
  'podwykonawca',
  'oplaty_urzedowe',
  'inne',
]);

const QUOTATION_ALLOWED_KEYS = new Set([
  'id',
  'title',
  'companyName',
  'type',
  'isSelected',
  'taxType',
  'quantity',
  'unit',
  'unitPriceNet',
  'unitPriceGross',
  'vatRate',
  'totalNet',
  'totalGross',
  'status',
  'dueDate',
  'isPaid',
  'paidAt',
  'paidAmount',
  'isChosenOffer',
  'linkedCostId',
  'scheduledTaskId',
  'notes',
]);

const COST_ALLOWED_KEYS = new Set([
  'id',
  'projectId',
  'taskId',
  'title',
  'category',
  'amountNet',
  'amountGross',
  'vatRate',
  'contractorName',
  'invoiceNumber',
  'date',
  'dueDate',
  'status',
  'isPaid',
  'paidAt',
  'sourceQuotationId',
  'scheduledTaskId',
  'notes',
]);

const TRANCHE_ALLOWED_KEYS = new Set([
  'id',
  'title',
  'amountNet',
  'amountGross',
  'dueDate',
  'isPaid',
  'paidAt',
  'paidAmount',
  'scheduledTaskId',
  'notes',
]);

function isPlainObject(val: unknown): val is Record<string, any> {
  return Boolean(val) && typeof val === 'object' && !Array.isArray(val);
}

function isValidVatRate(val: unknown): val is number {
  return typeof val === 'number' && Number.isFinite(val) && val >= 0 && val <= 100;
}

function isValidOptionalDate(val: unknown): boolean {
  if (val === undefined || val === null || val === '') return true;
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

function validateOptionalStringField(
  obj: Record<string, any>,
  field: keyof typeof FINANCE_STRING_LIMITS,
  itemType: 'quotation' | 'cost' | 'tranche',
  itemId: string
): FinanceValidationResult | null {
  const val = obj[field];
  if (val === undefined || val === null) return null;
  if (typeof val !== 'string') {
    return {
      ok: false,
      error: `Pole "${field}" musi być tekstem.`,
      itemType,
      itemId,
      field,
    };
  }
  const limit = FINANCE_STRING_LIMITS[field];
  if (val.length > limit) {
    return {
      ok: false,
      error: `Pole "${field}" przekracza maksymalny limit ${limit} znaków.`,
      itemType,
      itemId,
      field,
    };
  }
  return null;
}

function findUnknownKey(obj: Record<string, any>, allowedKeys: Set<string>): string | null {
  for (const key of Object.keys(obj)) {
    if (!allowedKeys.has(key)) {
      return key;
    }
  }
  return null;
}

function validateExpectedGross(
  net: number,
  gross: number,
  vatRate: number
): { valid: boolean; expectedGross: number } {
  const expectedGross = vatRate === 0 ? roundMoney(net) : calcGrossFromNet(net, vatRate);
  const diffGrosze = Math.abs(toGrosze(gross) - toGrosze(expectedGross));
  return { valid: diffGrosze <= GROSS_TOLERANCE_GROSZE, expectedGross };
}

export function validateProjectFinanceFields(
  patch: Record<string, any>,
  existingProject?: { projectValue?: number; projectVatRate?: number } | null,
  options?: FinanceValidationOptions
): FinanceValidationResult {
  if (!patch || typeof patch !== 'object') {
    return { ok: true };
  }

  const isCompanyVatExempt = options?.company?.vatPayer === false;

  if (patch.projectValue !== undefined && patch.projectValue !== null) {
    if (typeof patch.projectValue !== 'number' || parseMoney(patch.projectValue) === null) {
      return {
        ok: false,
        error: MONEY_PRECISION_ERROR,
        itemType: 'project',
        field: 'projectValue',
      };
    }
  }

  if (patch.projectValueGross !== undefined && patch.projectValueGross !== null) {
    if (typeof patch.projectValueGross !== 'number' || parseMoney(patch.projectValueGross) === null) {
      return {
        ok: false,
        error: MONEY_PRECISION_ERROR,
        itemType: 'project',
        field: 'projectValueGross',
      };
    }
  }

  if (patch.projectVatRate !== undefined && patch.projectVatRate !== null) {
    if (!isValidVatRate(patch.projectVatRate)) {
      return {
        ok: false,
        error: 'Nieprawidłowa stawka VAT projektu (dozwolone 0–100%).',
        itemType: 'project',
        field: 'projectVatRate',
      };
    }
  }

  const effectiveProjectVatRate =
    patch.projectVatRate !== undefined && patch.projectVatRate !== null
      ? patch.projectVatRate
      : existingProject?.projectVatRate !== undefined && isValidVatRate(existingProject.projectVatRate)
        ? existingProject.projectVatRate
        : 23;

  if (patch.projectValueGross !== undefined && patch.projectValueGross !== null) {
    const netValue =
      patch.projectValue !== undefined && patch.projectValue !== null
        ? patch.projectValue
        : typeof existingProject?.projectValue === 'number'
          ? existingProject.projectValue
          : 0;
    const grossCheck = validateExpectedGross(netValue, patch.projectValueGross, effectiveProjectVatRate);
    const exemptGrossCheck = isCompanyVatExempt
      ? validateExpectedGross(netValue, patch.projectValueGross, 0)
      : null;
    if (!grossCheck.valid && !(exemptGrossCheck && exemptGrossCheck.valid)) {
      const expectedText = isCompanyVatExempt
        ? `${formatMoney(exemptGrossCheck!.expectedGross)} zł przy VAT 0% (ZW)`
        : `${formatMoney(grossCheck.expectedGross)} zł przy VAT ${effectiveProjectVatRate}%`;
      return {
        ok: false,
        error: `Niespójna kwota brutto wartości projektu (oczekiwano ok. ${expectedText}).`,
        itemType: 'project',
        field: 'projectValueGross',
      };
    }
  }

  if (patch.quotations !== undefined) {
    if (!Array.isArray(patch.quotations)) {
      return {
        ok: false,
        error: 'Lista wycen musi być tablicą.',
        itemType: 'quotation',
      };
    }
    if (patch.quotations.length > FINANCE_ARRAY_LIMITS.quotations) {
      return {
        ok: false,
        error: `Zbyt wiele pozycji (maks. ${FINANCE_ARRAY_LIMITS.quotations})`,
        itemType: 'quotation',
      };
    }

    const seenIds = new Set<string>();
    for (const q of patch.quotations) {
      if (!isPlainObject(q) || hasForbiddenKeys(q)) {
        return {
          ok: false,
          error: 'Nieprawidłowa struktura pozycji wyceny.',
          itemType: 'quotation',
        };
      }
      if (typeof q.id !== 'string' || !q.id.trim()) {
        return {
          ok: false,
          error: 'Każda wycena musi posiadać unikalny identyfikator (id).',
          itemType: 'quotation',
          field: 'id',
        };
      }
      const id = q.id;
      if (seenIds.has(id)) {
        return {
          ok: false,
          error: `Duplikat identyfikatora wyceny "${id}".`,
          itemType: 'quotation',
          itemId: id,
          field: 'id',
        };
      }
      seenIds.add(id);

      const unknownKey = findUnknownKey(q, QUOTATION_ALLOWED_KEYS);
      if (unknownKey) {
        return {
          ok: false,
          error: `Nieznane pole "${unknownKey}" w wycenie "${typeof q.title === 'string' && q.title.trim() ? q.title.trim() : id}".`,
          itemType: 'quotation',
          itemId: id,
          field: unknownKey,
        };
      }

      if (typeof q.title !== 'string' || !q.title.trim()) {
        return {
          ok: false,
          error: 'Każda wycena musi posiadać nazwę.',
          itemType: 'quotation',
          itemId: id,
          field: 'title',
        };
      }
      if (q.title.length > FINANCE_STRING_LIMITS.title) {
        return {
          ok: false,
          error: `Nazwa wyceny przekracza limit ${FINANCE_STRING_LIMITS.title} znaków.`,
          itemType: 'quotation',
          itemId: id,
          field: 'title',
        };
      }

      for (const strField of ['companyName', 'notes', 'unit'] as const) {
        const strErr = validateOptionalStringField(q, strField, 'quotation', id);
        if (strErr) return strErr;
      }

      if (typeof q.status !== 'string' || !QUOTATION_STATUSES.has(q.status)) {
        return {
          ok: false,
          error: `Nieprawidłowy status wyceny "${q.title.trim()}".`,
          itemType: 'quotation',
          itemId: id,
          field: 'status',
        };
      }
      if (q.type !== undefined && (typeof q.type !== 'string' || !QUOTATION_TYPES.has(q.type))) {
        return {
          ok: false,
          error: `Nieprawidłowy typ wyceny "${q.title.trim()}".`,
          itemType: 'quotation',
          itemId: id,
          field: 'type',
        };
      }
      if (
        q.taxType !== undefined &&
        (typeof q.taxType !== 'string' || !QUOTATION_TAX_TYPES.has(q.taxType))
      ) {
        return {
          ok: false,
          error: `Nieprawidłowy typ opodatkowania wyceny "${q.title.trim()}".`,
          itemType: 'quotation',
          itemId: id,
          field: 'taxType',
        };
      }

      if (typeof q.quantity !== 'number' || parseQuantity(q.quantity) === null) {
        return {
          ok: false,
          error: QUANTITY_PRECISION_ERROR,
          itemType: 'quotation',
          itemId: id,
          field: 'quantity',
        };
      }
      if (typeof q.unitPriceNet !== 'number' || parseMoney(q.unitPriceNet) === null) {
        return {
          ok: false,
          error: MONEY_PRECISION_ERROR,
          itemType: 'quotation',
          itemId: id,
          field: 'unitPriceNet',
        };
      }
      if (
        q.unitPriceGross !== undefined &&
        (typeof q.unitPriceGross !== 'number' || parseMoney(q.unitPriceGross) === null)
      ) {
        return {
          ok: false,
          error: MONEY_PRECISION_ERROR,
          itemType: 'quotation',
          itemId: id,
          field: 'unitPriceGross',
        };
      }
      if (typeof q.totalNet !== 'number' || parseMoney(q.totalNet) === null) {
        return {
          ok: false,
          error: MONEY_PRECISION_ERROR,
          itemType: 'quotation',
          itemId: id,
          field: 'totalNet',
        };
      }
      if (typeof q.totalGross !== 'number' || parseMoney(q.totalGross) === null) {
        return {
          ok: false,
          error: MONEY_PRECISION_ERROR,
          itemType: 'quotation',
          itemId: id,
          field: 'totalGross',
        };
      }
      if (
        q.paidAmount !== undefined &&
        (typeof q.paidAmount !== 'number' || parseMoney(q.paidAmount) === null)
      ) {
        return {
          ok: false,
          error: MONEY_PRECISION_ERROR,
          itemType: 'quotation',
          itemId: id,
          field: 'paidAmount',
        };
      }
      if (!isValidVatRate(q.vatRate)) {
        return {
          ok: false,
          error: 'Nieprawidłowa stawka VAT wyceny (dozwolone 0–100%).',
          itemType: 'quotation',
          itemId: id,
          field: 'vatRate',
        };
      }

      const effectiveQuoteVat = q.taxType === 'zwolniony' || q.vatRate === 0 ? 0 : q.vatRate;
      const totalGrossCheck = validateExpectedGross(q.totalNet, q.totalGross, effectiveQuoteVat);
      if (!totalGrossCheck.valid) {
        return {
          ok: false,
          error: `Niespójna kwota brutto wyceny "${q.title.trim()}" (oczekiwano ok. ${formatMoney(totalGrossCheck.expectedGross)} zł przy VAT ${effectiveQuoteVat}%).`,
          itemType: 'quotation',
          itemId: id,
          field: 'totalGross',
        };
      }

      if (q.unitPriceGross !== undefined) {
        const unitGrossCheck = validateExpectedGross(
          q.unitPriceNet,
          q.unitPriceGross,
          effectiveQuoteVat
        );
        if (!unitGrossCheck.valid) {
          return {
            ok: false,
            error: `Niespójna cena jednostkowa brutto wyceny "${q.title.trim()}" (oczekiwano ok. ${formatMoney(unitGrossCheck.expectedGross)} zł przy VAT ${effectiveQuoteVat}%).`,
            itemType: 'quotation',
            itemId: id,
            field: 'unitPriceGross',
          };
        }
      }

      if (!isValidOptionalDate(q.dueDate)) {
        return {
          ok: false,
          error: 'Nieprawidłowy format terminu płatności (oczekiwano RRRR-MM-DD).',
          itemType: 'quotation',
          itemId: id,
          field: 'dueDate',
        };
      }
      if (!isValidOptionalDate(q.paidAt)) {
        return {
          ok: false,
          error: 'Nieprawidłowy format daty zapłaty wyceny (oczekiwano RRRR-MM-DD).',
          itemType: 'quotation',
          itemId: id,
          field: 'paidAt',
        };
      }
    }
  }

  if (patch.costs !== undefined) {
    if (!Array.isArray(patch.costs)) {
      return {
        ok: false,
        error: 'Lista kosztów musi być tablicą.',
        itemType: 'cost',
      };
    }
    if (patch.costs.length > FINANCE_ARRAY_LIMITS.costs) {
      return {
        ok: false,
        error: `Zbyt wiele pozycji (maks. ${FINANCE_ARRAY_LIMITS.costs})`,
        itemType: 'cost',
      };
    }

    const seenIds = new Set<string>();
    for (const c of patch.costs) {
      if (!isPlainObject(c) || hasForbiddenKeys(c)) {
        return {
          ok: false,
          error: 'Nieprawidłowa struktura pozycji kosztu.',
          itemType: 'cost',
        };
      }
      if (typeof c.id !== 'string' || !c.id.trim()) {
        return {
          ok: false,
          error: 'Każdy koszt musi posiadać unikalny identyfikator (id).',
          itemType: 'cost',
          field: 'id',
        };
      }
      const id = c.id;
      if (seenIds.has(id)) {
        return {
          ok: false,
          error: `Duplikat identyfikatora kosztu "${id}".`,
          itemType: 'cost',
          itemId: id,
          field: 'id',
        };
      }
      seenIds.add(id);

      const unknownKey = findUnknownKey(c, COST_ALLOWED_KEYS);
      if (unknownKey) {
        return {
          ok: false,
          error: `Nieznane pole "${unknownKey}" w koszcie "${typeof c.title === 'string' && c.title.trim() ? c.title.trim() : id}".`,
          itemType: 'cost',
          itemId: id,
          field: unknownKey,
        };
      }

      if (typeof c.title !== 'string' || !c.title.trim()) {
        return {
          ok: false,
          error: 'Każdy koszt musi posiadać tytuł.',
          itemType: 'cost',
          itemId: id,
          field: 'title',
        };
      }
      if (c.title.length > FINANCE_STRING_LIMITS.title) {
        return {
          ok: false,
          error: `Tytuł kosztu przekracza limit ${FINANCE_STRING_LIMITS.title} znaków.`,
          itemType: 'cost',
          itemId: id,
          field: 'title',
        };
      }

      for (const strField of ['contractorName', 'invoiceNumber', 'notes'] as const) {
        const strErr = validateOptionalStringField(c, strField, 'cost', id);
        if (strErr) return strErr;
      }

      if (typeof c.status !== 'string' || !COST_STATUSES.has(c.status)) {
        return {
          ok: false,
          error: `Nieprawidłowy status kosztu "${c.title.trim()}".`,
          itemType: 'cost',
          itemId: id,
          field: 'status',
        };
      }
      if (typeof c.category !== 'string' || !COST_CATEGORIES.has(c.category)) {
        return {
          ok: false,
          error: `Nieprawidłowa kategoria kosztu "${c.title.trim()}".`,
          itemType: 'cost',
          itemId: id,
          field: 'category',
        };
      }

      if (typeof c.amountNet !== 'number' || parseMoney(c.amountNet) === null) {
        return {
          ok: false,
          error: MONEY_PRECISION_ERROR,
          itemType: 'cost',
          itemId: id,
          field: 'amountNet',
        };
      }
      if (typeof c.amountGross !== 'number' || parseMoney(c.amountGross) === null) {
        return {
          ok: false,
          error: MONEY_PRECISION_ERROR,
          itemType: 'cost',
          itemId: id,
          field: 'amountGross',
        };
      }
      if (c.vatRate !== undefined && !isValidVatRate(c.vatRate)) {
        return {
          ok: false,
          error: 'Nieprawidłowa stawka VAT kosztu (dozwolone 0–100%).',
          itemType: 'cost',
          itemId: id,
          field: 'vatRate',
        };
      }

      const effectiveCostVat = c.vatRate !== undefined ? c.vatRate : effectiveProjectVatRate;
      const costGrossCheck = validateExpectedGross(c.amountNet, c.amountGross, effectiveCostVat);
      if (!costGrossCheck.valid) {
        return {
          ok: false,
          error: `Niespójna kwota brutto kosztu "${c.title.trim()}" (oczekiwano ok. ${formatMoney(costGrossCheck.expectedGross)} zł przy VAT ${effectiveCostVat}%).`,
          itemType: 'cost',
          itemId: id,
          field: 'amountGross',
        };
      }

      if (!isValidOptionalDate(c.date)) {
        return {
          ok: false,
          error: 'Nieprawidłowy format daty kosztu (oczekiwano RRRR-MM-DD).',
          itemType: 'cost',
          itemId: id,
          field: 'date',
        };
      }
      if (!isValidOptionalDate(c.dueDate)) {
        return {
          ok: false,
          error: 'Nieprawidłowy format terminu płatności kosztu (oczekiwano RRRR-MM-DD).',
          itemType: 'cost',
          itemId: id,
          field: 'dueDate',
        };
      }
      if (!isValidOptionalDate(c.paidAt)) {
        return {
          ok: false,
          error: 'Nieprawidłowy format daty zapłaty kosztu (oczekiwano RRRR-MM-DD).',
          itemType: 'cost',
          itemId: id,
          field: 'paidAt',
        };
      }
    }
  }

  if (patch.paymentTranches !== undefined) {
    if (!Array.isArray(patch.paymentTranches)) {
      return {
        ok: false,
        error: 'Lista transz płatności musi być tablicą.',
        itemType: 'tranche',
      };
    }
    if (patch.paymentTranches.length > FINANCE_ARRAY_LIMITS.paymentTranches) {
      return {
        ok: false,
        error: `Zbyt wiele pozycji (maks. ${FINANCE_ARRAY_LIMITS.paymentTranches})`,
        itemType: 'tranche',
      };
    }

    const seenIds = new Set<string>();
    for (const t of patch.paymentTranches) {
      if (!isPlainObject(t) || hasForbiddenKeys(t)) {
        return {
          ok: false,
          error: 'Nieprawidłowa struktura transzy płatności.',
          itemType: 'tranche',
        };
      }
      if (typeof t.id !== 'string' || !t.id.trim()) {
        return {
          ok: false,
          error: 'Każda transza płatności musi posiadać unikalny identyfikator (id).',
          itemType: 'tranche',
          field: 'id',
        };
      }
      const id = t.id;
      if (seenIds.has(id)) {
        return {
          ok: false,
          error: `Duplikat identyfikatora transzy "${id}".`,
          itemType: 'tranche',
          itemId: id,
          field: 'id',
        };
      }
      seenIds.add(id);

      const unknownKey = findUnknownKey(t, TRANCHE_ALLOWED_KEYS);
      if (unknownKey) {
        return {
          ok: false,
          error: `Nieznane pole "${unknownKey}" w transzy "${typeof t.title === 'string' && t.title.trim() ? t.title.trim() : id}".`,
          itemType: 'tranche',
          itemId: id,
          field: unknownKey,
        };
      }

      if (typeof t.title !== 'string' || !t.title.trim()) {
        return {
          ok: false,
          error: 'Każda transza płatności musi posiadać nazwę.',
          itemType: 'tranche',
          itemId: id,
          field: 'title',
        };
      }
      if (t.title.length > FINANCE_STRING_LIMITS.title) {
        return {
          ok: false,
          error: `Nazwa transzy przekracza limit ${FINANCE_STRING_LIMITS.title} znaków.`,
          itemType: 'tranche',
          itemId: id,
          field: 'title',
        };
      }

      const notesErr = validateOptionalStringField(t, 'notes', 'tranche', id);
      if (notesErr) return notesErr;

      if (typeof t.amountNet !== 'number' || parseMoney(t.amountNet) === null) {
        return {
          ok: false,
          error: MONEY_PRECISION_ERROR,
          itemType: 'tranche',
          itemId: id,
          field: 'amountNet',
        };
      }
      if (typeof t.amountGross !== 'number' || parseMoney(t.amountGross) === null) {
        return {
          ok: false,
          error: MONEY_PRECISION_ERROR,
          itemType: 'tranche',
          itemId: id,
          field: 'amountGross',
        };
      }
      if (
        t.paidAmount !== undefined &&
        (typeof t.paidAmount !== 'number' || parseMoney(t.paidAmount) === null)
      ) {
        return {
          ok: false,
          error: MONEY_PRECISION_ERROR,
          itemType: 'tranche',
          itemId: id,
          field: 'paidAmount',
        };
      }

      const trancheGrossCheck = validateExpectedGross(
        t.amountNet,
        t.amountGross,
        effectiveProjectVatRate
      );
      const exemptTrancheCheck = isCompanyVatExempt
        ? validateExpectedGross(t.amountNet, t.amountGross, 0)
        : null;
      if (!trancheGrossCheck.valid && !(exemptTrancheCheck && exemptTrancheCheck.valid)) {
        const expectedText = isCompanyVatExempt
          ? `${formatMoney(exemptTrancheCheck!.expectedGross)} zł przy VAT 0% (ZW)`
          : `${formatMoney(trancheGrossCheck.expectedGross)} zł przy VAT ${effectiveProjectVatRate}%`;
        return {
          ok: false,
          error: `Niespójna kwota brutto transzy "${t.title.trim()}" (oczekiwano ok. ${expectedText}).`,
          itemType: 'tranche',
          itemId: id,
          field: 'amountGross',
        };
      }

      if (!isValidOptionalDate(t.dueDate)) {
        return {
          ok: false,
          error: 'Nieprawidłowy format terminu płatności transzy (oczekiwano RRRR-MM-DD).',
          itemType: 'tranche',
          itemId: id,
          field: 'dueDate',
        };
      }
      if (!isValidOptionalDate(t.paidAt)) {
        return {
          ok: false,
          error: 'Nieprawidłowy format daty zapłaty transzy (oczekiwano RRRR-MM-DD).',
          itemType: 'tranche',
          itemId: id,
          field: 'paidAt',
        };
      }
    }
  }

  return { ok: true };
}
