import type { CostCategory, CostItem, PaymentTranche, Project, QuotationItem } from '../types/index.js';
import {
  addMoney,
  calcGrossFromNet,
  calcMarginPercent,
  MONEY_PRECISION_ERROR,
  parseMoney,
  parseQuantity,
  QUANTITY_PRECISION_ERROR,
  roundMoney,
  subtractMoney,
  toGrosze,
} from './money.js';
import { getTodayIso } from './today.js';
export {
  validateProjectFinanceFields,
  type FinanceValidationResult,
} from './financeValidation.js';

export interface ProjectFinanceSummary {
  baseProjectValueNet: number;
  baseProjectValueGross: number;
  projectVatRate: number;
  totalQuotationNet: number;
  totalQuotationGross: number;
  totalRevenueNet: number;
  totalRevenueGross: number;
  directCostsNet: number;
  directCostsGross: number;
  quoteCostsNet: number;
  quoteCostsGross: number;
  totalCostsNet: number;
  totalCostsGross: number;
  profitNet: number;
  profitGross: number;
  marginPercent: number;
  paidRevenueNet: number;
  unpaidRevenueNet: number;
  paidCostsNet: number;
  unpaidCostsNet: number;
  tranchesTotalNet: number;
  tranchesTotalGross: number;
  tranchesPaidNet: number;
  tranchesRemainingNet: number;
  tranchesExceedProjectValue: boolean;
  expectedInflowNet: number;
  expectedInflowGross: number;
  expectedOutflowNet: number;
  expectedOutflowGross: number;
  nextPaymentDate: string | null;
  costsByCategory: Record<CostCategory, number>;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isPaymentOverdue(
  dueDate?: string | null,
  isPaid?: boolean,
  todayIso: string = getTodayIso()
): boolean {
  if (isPaid) return false;
  const trimmed = typeof dueDate === 'string' ? dueDate.trim() : '';
  if (!trimmed || !ISO_DATE_RE.test(trimmed)) return false;
  return trimmed < todayIso;
}

export function computeProjectFinance(
  project: Pick<
    Project,
    | 'projectValue'
    | 'projectValueGross'
    | 'projectVatRate'
    | 'status'
    | 'isBaseContractPaid'
    | 'quotations'
    | 'costs'
    | 'paymentTranches'
  >,
  options?: { todayIso?: string }
): ProjectFinanceSummary {
  const todayIso = options?.todayIso || getTodayIso();
  const projectVatRate = project.projectVatRate !== undefined ? Number(project.projectVatRate) : 23;
  const baseProjectValueNet = roundMoney(Number(project.projectValue || 0));
  const baseProjectValueGross =
    project.projectValueGross !== undefined && baseProjectValueNet > 0
      ? roundMoney(Number(project.projectValueGross))
      : calcGrossFromNet(baseProjectValueNet, projectVatRate);

  const quotations: QuotationItem[] = Array.isArray(project.quotations) ? project.quotations : [];
  const costs: CostItem[] = Array.isArray(project.costs) ? project.costs : [];
  const tranches: PaymentTranche[] = Array.isArray(project.paymentTranches)
    ? project.paymentTranches
    : [];

  const selectedQuotations = quotations.filter((q) => q.isSelected !== false);
  const revenueQuotes = selectedQuotations.filter((q) => q.type !== 'koszt');
  // Wyceny kosztowe przeniesione do kosztów (linkedCostId) są wyłączone z wycen kosztowych,
  // aby nie dopuścić do podwójnego liczenia tej samej kwoty w kosztach i bilansie.
  const costQuotesUnlinked = selectedQuotations.filter(
    (q) => q.type === 'koszt' && !q.linkedCostId
  );

  const totalQuotationNet = addMoney(...revenueQuotes.map((q) => q.totalNet || 0));
  const totalQuotationGross = addMoney(...revenueQuotes.map((q) => q.totalGross || 0));

  const totalRevenueNet = addMoney(baseProjectValueNet, totalQuotationNet);
  const totalRevenueGross = addMoney(baseProjectValueGross, totalQuotationGross);

  const directCostsNet = addMoney(...costs.map((c) => c.amountNet || 0));
  const directCostsGross = addMoney(...costs.map((c) => c.amountGross || 0));

  const quoteCostsNet = addMoney(...costQuotesUnlinked.map((q) => q.totalNet || 0));
  const quoteCostsGross = addMoney(...costQuotesUnlinked.map((q) => q.totalGross || 0));

  const totalCostsNet = addMoney(directCostsNet, quoteCostsNet);
  const totalCostsGross = addMoney(directCostsGross, quoteCostsGross);

  const profitNet = subtractMoney(totalRevenueNet, totalCostsNet);
  const profitGross = subtractMoney(totalRevenueGross, totalCostsGross);
  const marginPercent = calcMarginPercent(totalRevenueNet, profitNet);

  // Transze płatności od zamawiającego
  const tranchesTotalNet = addMoney(...tranches.map((t) => t.amountNet || 0));
  const tranchesTotalGross = addMoney(...tranches.map((t) => t.amountGross || 0));
  const tranchesPaidNet = addMoney(
    ...tranches
      .filter((t) => t.isPaid)
      .map((t) => (t.paidAmount !== undefined ? t.paidAmount : t.amountNet || 0))
  );
  const tranchesRemainingNet = Math.max(0, subtractMoney(tranchesTotalNet, tranchesPaidNet));
  const tranchesExceedProjectValue =
    totalRevenueNet > 0 && toGrosze(tranchesTotalNet) > toGrosze(totalRevenueNet);

  // Rozliczone vs nierozliczone przychody i koszty
  const isBasePaid =
    project.isBaseContractPaid !== undefined
      ? Boolean(project.isBaseContractPaid)
      : project.status === 'completed';

  const paidRevenueQuotesNet = addMoney(
    ...revenueQuotes
      .filter((q) => q.isPaid)
      .map((q) => (q.paidAmount !== undefined ? q.paidAmount : q.totalNet || 0))
  );
  const baseOrTranchesPaidNet =
    tranches.length > 0
      ? Math.max(isBasePaid ? baseProjectValueNet : 0, tranchesPaidNet)
      : isBasePaid
        ? baseProjectValueNet
        : 0;
  const paidRevenueNet = addMoney(baseOrTranchesPaidNet, paidRevenueQuotesNet);
  const unpaidRevenueNet = Math.max(0, subtractMoney(totalRevenueNet, paidRevenueNet));

  const paidDirectCostsNet = addMoney(
    ...costs.filter((c) => c.isPaid || c.status === 'paid').map((c) => c.amountNet || 0)
  );
  const paidQuoteCostsNet = addMoney(
    ...costQuotesUnlinked.filter((q) => q.isPaid).map((q) => q.totalNet || 0)
  );
  const paidCostsNet = addMoney(paidDirectCostsNet, paidQuoteCostsNet);
  const unpaidCostsNet = Math.max(0, subtractMoney(totalCostsNet, paidCostsNet));

  // Oczekiwane wpływy: niezapłacone transze i wyceny przychodowe z terminem płatności
  const datedUnpaidTranches = tranches.filter(
    (t) => !t.isPaid && Boolean(t.dueDate && t.dueDate.trim())
  );
  const datedUnpaidRevenueQuotes = revenueQuotes.filter(
    (q) => !q.isPaid && Boolean(q.dueDate && q.dueDate.trim())
  );
  const expectedInflowNet = addMoney(
    ...datedUnpaidTranches.map((t) => Math.max(0, subtractMoney(t.amountNet || 0, t.paidAmount || 0))),
    ...datedUnpaidRevenueQuotes.map((q) => Math.max(0, subtractMoney(q.totalNet || 0, q.paidAmount || 0)))
  );
  const expectedInflowGross = addMoney(
    ...datedUnpaidTranches.map((t) => {
      const gross =
        t.amountGross !== undefined
          ? t.amountGross
          : calcGrossFromNet(t.amountNet || 0, projectVatRate);
      const paidGross = t.paidAmount ? calcGrossFromNet(t.paidAmount, projectVatRate) : 0;
      return Math.max(0, subtractMoney(gross, paidGross));
    }),
    ...datedUnpaidRevenueQuotes.map((q) => {
      const gross =
        q.totalGross !== undefined
          ? q.totalGross
          : calcGrossFromNet(q.totalNet || 0, q.vatRate ?? projectVatRate);
      const paidGross = q.paidAmount ? calcGrossFromNet(q.paidAmount, q.vatRate ?? projectVatRate) : 0;
      return Math.max(0, subtractMoney(gross, paidGross));
    })
  );

  // Oczekiwane wydatki: niezapłacone i planowane koszty z terminem płatności
  const datedUnpaidCosts = costs.filter(
    (c) => !(c.isPaid || c.status === 'paid') && Boolean(c.dueDate && c.dueDate.trim())
  );
  const datedUnpaidCostQuotes = costQuotesUnlinked.filter(
    (q) => !q.isPaid && Boolean(q.dueDate && q.dueDate.trim())
  );
  const expectedOutflowNet = addMoney(
    ...datedUnpaidCosts.map((c) => c.amountNet || 0),
    ...datedUnpaidCostQuotes.map((q) => q.totalNet || 0)
  );
  const expectedOutflowGross = addMoney(
    ...datedUnpaidCosts.map((c) =>
      c.amountGross !== undefined
        ? c.amountGross
        : calcGrossFromNet(c.amountNet || 0, c.vatRate ?? projectVatRate)
    ),
    ...datedUnpaidCostQuotes.map((q) =>
      q.totalGross !== undefined
        ? q.totalGross
        : calcGrossFromNet(q.totalNet || 0, q.vatRate ?? projectVatRate)
    )
  );

  // Najbliższy termin płatności (preferuje daty >= todayIso, w przeciwnym razie najwcześniejszy zaległy)
  const candidateDates: string[] = [];
  for (const t of datedUnpaidTranches) {
    if (t.dueDate && ISO_DATE_RE.test(t.dueDate.trim())) candidateDates.push(t.dueDate.trim());
  }
  for (const q of datedUnpaidRevenueQuotes) {
    if (q.dueDate && ISO_DATE_RE.test(q.dueDate.trim())) candidateDates.push(q.dueDate.trim());
  }
  for (const c of datedUnpaidCosts) {
    if (c.dueDate && ISO_DATE_RE.test(c.dueDate.trim())) candidateDates.push(c.dueDate.trim());
  }
  for (const q of datedUnpaidCostQuotes) {
    if (q.dueDate && ISO_DATE_RE.test(q.dueDate.trim())) candidateDates.push(q.dueDate.trim());
  }

  let nextPaymentDate: string | null = null;
  if (candidateDates.length > 0) {
    const upcoming = candidateDates.filter((d) => d >= todayIso).sort();
    if (upcoming.length > 0) {
      nextPaymentDate = upcoming[0];
    } else {
      nextPaymentDate = [...candidateDates].sort()[0];
    }
  }

  // Struktura kosztów wg kategorii
  const costsByCategory = costs.reduce((acc, c) => {
    acc[c.category] = addMoney(acc[c.category] || 0, c.amountNet || 0);
    return acc;
  }, {} as Record<CostCategory, number>);

  return {
    baseProjectValueNet,
    baseProjectValueGross,
    projectVatRate,
    totalQuotationNet,
    totalQuotationGross,
    totalRevenueNet,
    totalRevenueGross,
    directCostsNet,
    directCostsGross,
    quoteCostsNet,
    quoteCostsGross,
    totalCostsNet,
    totalCostsGross,
    profitNet,
    profitGross,
    marginPercent,
    paidRevenueNet,
    unpaidRevenueNet,
    paidCostsNet,
    unpaidCostsNet,
    tranchesTotalNet,
    tranchesTotalGross,
    tranchesPaidNet,
    tranchesRemainingNet,
    tranchesExceedProjectValue,
    expectedInflowNet,
    expectedInflowGross,
    expectedOutflowNet,
    expectedOutflowGross,
    nextPaymentDate,
    costsByCategory,
  };
}

export const FINANCE_MODAL_PATCH_FIELDS = [
  'clientName',
  'clientContactPerson',
  'clientPhone',
  'clientEmail',
  'clientNip',
  'clientAddress',
  'diskPath',
  'startDate',
  'dueDate',
  'projectValue',
  'projectValueGross',
  'projectVatRate',
  'isBaseContractPaid',
  'budget',
  'quotations',
  'costs',
  'paymentTranches',
] as const;

function deepEqualJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) {
    return a === b;
  }
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, idx) => deepEqualJson(item, b[idx]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const objA = a as Record<string, unknown>;
    const objB = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(objA), ...Object.keys(objB)]);
    for (const key of keys) {
      if (!deepEqualJson(objA[key], objB[key])) return false;
    }
    return true;
  }
  return false;
}

/**
 * Zwraca obiekt zawierający wyłącznie zmienione pola spośród sekcji finansowych/klienta/dat.
 */
export function buildFinancePatch(
  original: Project,
  draft: Partial<Project>
): Partial<Project> {
  const patch: Record<string, any> = {};

  for (const field of FINANCE_MODAL_PATCH_FIELDS) {
    if (!(field in draft)) continue;
    const origVal = (original as any)[field];
    const nextVal = (draft as any)[field];

    // Normalizuj undefined vs pusty ciąg/tablica przy porównaniu niezmienionych pól
    if (
      (field === 'quotations' || field === 'costs' || field === 'paymentTranches') &&
      origVal === undefined &&
      Array.isArray(nextVal) &&
      nextVal.length === 0
    ) {
      continue;
    }

    if (!deepEqualJson(origVal, nextVal)) {
      patch[field] = nextVal;
    }
  }

  return patch as Partial<Project>;
}
