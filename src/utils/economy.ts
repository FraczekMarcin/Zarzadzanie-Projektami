import type {
  Company,
  CostItem,
  PaymentTranche,
  Project,
  QuotationItem,
  Task,
  User,
} from '../types/index.js';
import { FIELD_LIMITS, canEditFinance, canViewFinance } from './access.js';
import { ProjectFinanceSummary, computeProjectFinance, isPaymentOverdue } from './finance.js';
import { addMoney, calcGrossFromNet, formatMoney, subtractMoney } from './money.js';
import { getTodayIso } from './today.js';

export type EconomyAmountMode = 'net' | 'gross';
export type EconomyCompanyFilter = 'all' | 'none' | string;
export type EconomySortKey =
  | 'key'
  | 'name'
  | 'clientName'
  | 'value'
  | 'costs'
  | 'balance'
  | 'expectedBalance'
  | 'nextPaymentDate';
export type EconomySortDirection = 'asc' | 'desc';

export const ECONOMY_AMOUNTS_PREF_KEY = 'oph_pref_economy_amounts';

export function loadEconomyAmountsPref(): EconomyAmountMode {
  if (typeof window === 'undefined') return 'net';
  try {
    const val = window.localStorage.getItem(ECONOMY_AMOUNTS_PREF_KEY);
    return val === 'gross' ? 'gross' : 'net';
  } catch {
    return 'net';
  }
}

export function saveEconomyAmountsPref(mode: EconomyAmountMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ECONOMY_AMOUNTS_PREF_KEY, mode);
  } catch {
    // Ignoruj błędy dostępu do localStorage
  }
}

export function extractProjectYear(project: Pick<Project, 'key' | 'startDate'>): number | null {
  const keyMatch = typeof project.key === 'string' ? project.key.trim().match(/^(\d{4})-/) : null;
  if (keyMatch) {
    const yr = Number(keyMatch[1]);
    if (Number.isInteger(yr) && yr >= 1900 && yr <= 2999) return yr;
  }
  const dateMatch =
    typeof project.startDate === 'string' ? project.startDate.trim().match(/^(\d{4})(?:-|$)/) : null;
  if (dateMatch) {
    const yr = Number(dateMatch[1]);
    if (Number.isInteger(yr) && yr >= 1900 && yr <= 2999) return yr;
  }
  return null;
}

export function formatPln(amount: number): string {
  return `${formatMoney(amount)} zł`;
}

export function formatSignedPln(amount: number): string {
  const rounded = Object.is(amount, -0) ? 0 : amount;
  if (rounded > 0) {
    return `+${formatMoney(rounded)} zł`;
  }
  if (rounded < 0) {
    return `${formatMoney(rounded)} zł`;
  }
  return `+${formatMoney(0)} zł`;
}

export interface EconomyProjectRow {
  project: Project;
  company: Company | null;
  isVatExempt: boolean;
  year: number | null;
  summary: ProjectFinanceSummary;
  clientNameDisplay: string;
  valueNet: number;
  valueGross: number;
  costsNet: number;
  costsGross: number;
  nominalCostsNet: number;
  nominalCostsGross: number;
  balanceNet: number;
  balanceGross: number;
  expectedInflowNet: number;
  expectedInflowGross: number;
  expectedOutflowNet: number;
  expectedOutflowGross: number;
  expectedBalanceNet: number;
  expectedBalanceGross: number;
  nextPaymentDate: string | null;
  isNextPaymentOverdue: boolean;
}

export interface EconomyFilterOptions {
  companyFilter: EconomyCompanyFilter;
  year: number | 'all';
  status: Project['status'] | 'all';
  showArchived: boolean;
  search: string;
}

export interface EconomyTotals {
  count: number;
  valueNet: number;
  valueGross: number;
  costsNet: number;
  costsGross: number;
  balanceNet: number;
  balanceGross: number;
  expectedInflowNet: number;
  expectedInflowGross: number;
  expectedOutflowNet: number;
  expectedOutflowGross: number;
  expectedBalanceNet: number;
  expectedBalanceGross: number;
}

export function buildEconomyRows(
  projects: Project[],
  companies: Company[],
  currentUser: Pick<User, 'id' | 'role'> | null | undefined,
  todayIso: string = getTodayIso()
): EconomyProjectRow[] {
  const companyMap = new Map<string, Company>();
  for (const comp of companies) {
    if (comp && comp.id) {
      companyMap.set(comp.id, comp);
    }
  }

  const rows: EconomyProjectRow[] = [];
  for (const project of projects) {
    if (!project || !canViewFinance(currentUser, project)) continue;
    const company = project.companyId ? companyMap.get(project.companyId) || null : null;
    const summary = computeProjectFinance(project, company, { todayIso });
    const expectedBalanceNet = subtractMoney(summary.expectedInflowNet, summary.economicExpectedOutflow);
    const expectedBalanceGross = subtractMoney(
      summary.expectedInflowGross,
      summary.expectedOutflowGross
    );

    rows.push({
      project,
      company,
      isVatExempt: summary.isVatExempt,
      year: extractProjectYear(project),
      summary,
      clientNameDisplay: project.clientName?.trim() || '—',
      valueNet: summary.totalRevenueNet,
      valueGross: summary.totalRevenueGross,
      costsNet: summary.economicTotalCosts,
      costsGross: summary.totalCostsGross,
      nominalCostsNet: summary.totalCostsNet,
      nominalCostsGross: summary.totalCostsGross,
      balanceNet: summary.profitNet,
      balanceGross: summary.profitGross,
      expectedInflowNet: summary.expectedInflowNet,
      expectedInflowGross: summary.expectedInflowGross,
      expectedOutflowNet: summary.economicExpectedOutflow,
      expectedOutflowGross: summary.expectedOutflowGross,
      expectedBalanceNet,
      expectedBalanceGross,
      nextPaymentDate: summary.nextPaymentDate,
      isNextPaymentOverdue: summary.nextPaymentDate
        ? isPaymentOverdue(summary.nextPaymentDate, false, todayIso)
        : false,
    });
  }

  return rows;
}

export function getAvailableEconomyYears(rows: EconomyProjectRow[]): number[] {
  const years = new Set<number>();
  for (const row of rows) {
    if (row.year !== null) years.add(row.year);
  }
  return Array.from(years).sort((a, b) => b - a);
}

export function filterEconomyRows(
  rows: EconomyProjectRow[],
  filters: EconomyFilterOptions
): EconomyProjectRow[] {
  const searchLower = filters.search.trim().toLowerCase();

  return rows.filter((row) => {
    if (!filters.showArchived && row.project.isArchived) {
      return false;
    }
    if (filters.companyFilter === 'none') {
      if (row.project.companyId) return false;
    } else if (filters.companyFilter !== 'all') {
      if (row.project.companyId !== filters.companyFilter) return false;
    }
    if (filters.year !== 'all' && row.year !== filters.year) {
      return false;
    }
    if (filters.status !== 'all' && row.project.status !== filters.status) {
      return false;
    }
    if (searchLower) {
      const keyMatch = (row.project.key || '').toLowerCase().includes(searchLower);
      const nameMatch = (row.project.name || '').toLowerCase().includes(searchLower);
      if (!keyMatch && !nameMatch) return false;
    }
    return true;
  });
}

export function sortEconomyRows(
  rows: EconomyProjectRow[],
  sortKey: EconomySortKey,
  sortDir: EconomySortDirection,
  amountMode: EconomyAmountMode
): EconomyProjectRow[] {
  const dir = sortDir === 'asc' ? 1 : -1;
  const copy = [...rows];
  copy.sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case 'key':
        cmp = (a.project.key || '').localeCompare(b.project.key || '', 'pl', { numeric: true });
        break;
      case 'name':
        cmp = (a.project.name || '').localeCompare(b.project.name || '', 'pl');
        break;
      case 'clientName':
        cmp = a.clientNameDisplay.localeCompare(b.clientNameDisplay, 'pl');
        break;
      case 'value':
        cmp =
          amountMode === 'gross'
            ? a.valueGross - b.valueGross
            : a.valueNet - b.valueNet;
        break;
      case 'costs':
        cmp =
          amountMode === 'gross'
            ? a.costsGross - b.costsGross
            : a.costsNet - b.costsNet;
        break;
      case 'balance':
        cmp =
          amountMode === 'gross'
            ? a.balanceGross - b.balanceGross
            : a.balanceNet - b.balanceNet;
        break;
      case 'expectedBalance':
        cmp =
          amountMode === 'gross'
            ? a.expectedBalanceGross - b.expectedBalanceGross
            : a.expectedBalanceNet - b.expectedBalanceNet;
        break;
      case 'nextPaymentDate': {
        if (!a.nextPaymentDate && !b.nextPaymentDate) cmp = 0;
        else if (!a.nextPaymentDate) return 1;
        else if (!b.nextPaymentDate) return -1;
        else cmp = a.nextPaymentDate.localeCompare(b.nextPaymentDate);
        break;
      }
    }
    if (cmp === 0) {
      return (a.project.key || '').localeCompare(b.project.key || '', 'pl', { numeric: true });
    }
    return cmp * dir;
  });
  return copy;
}

export function computeEconomyTotals(rows: EconomyProjectRow[]): EconomyTotals {
  const valueNet = addMoney(...rows.map((r) => r.valueNet));
  const valueGross = addMoney(...rows.map((r) => r.valueGross));
  const costsNet = addMoney(...rows.map((r) => r.costsNet));
  const costsGross = addMoney(...rows.map((r) => r.costsGross));
  const balanceNet = subtractMoney(valueNet, costsNet);
  const balanceGross = subtractMoney(valueGross, costsGross);
  const expectedInflowNet = addMoney(...rows.map((r) => r.expectedInflowNet));
  const expectedInflowGross = addMoney(...rows.map((r) => r.expectedInflowGross));
  const expectedOutflowNet = addMoney(...rows.map((r) => r.expectedOutflowNet));
  const expectedOutflowGross = addMoney(...rows.map((r) => r.expectedOutflowGross));
  const expectedBalanceNet = subtractMoney(expectedInflowNet, expectedOutflowNet);
  const expectedBalanceGross = subtractMoney(expectedInflowGross, expectedOutflowGross);

  return {
    count: rows.length,
    valueNet,
    valueGross,
    costsNet,
    costsGross,
    balanceNet,
    balanceGross,
    expectedInflowNet,
    expectedInflowGross,
    expectedOutflowNet,
    expectedOutflowGross,
    expectedBalanceNet,
    expectedBalanceGross,
  };
}

export type PaymentItemKind = 'cost' | 'tranche' | 'quotation';

export interface PaymentScheduleCandidate {
  projectId: string;
  projectKey: string;
  projectName: string;
  kind: PaymentItemKind;
  itemId: string;
  title: string;
  amountNet: number;
  amountGross: number;
  dueDate: string;
  direction: 'wydatek' | 'wpływ';
  isPaid: boolean;
  scheduledTaskId?: string;
}

export function getProjectPaymentCandidates(
  project: Project,
  tasksById: Map<string, Task>,
  company?: Pick<Company, 'vatPayer'> | null
): PaymentScheduleCandidate[] {
  const isVatExempt = company?.vatPayer === false;
  const vatRate = project.projectVatRate !== undefined ? Number(project.projectVatRate) : 23;
  const result: PaymentScheduleCandidate[] = [];

  for (const tranche of project.paymentTranches || []) {
    const dueDate = tranche.dueDate?.trim() || '';
    if (!dueDate) continue;
    const validScheduledTaskId =
      tranche.scheduledTaskId && tasksById.has(tranche.scheduledTaskId)
        ? tranche.scheduledTaskId
        : undefined;
    const netAmount = tranche.amountNet || 0;
    result.push({
      projectId: project.id,
      projectKey: project.key,
      projectName: project.name,
      kind: 'tranche',
      itemId: tranche.id,
      title: tranche.title,
      amountNet: netAmount,
      amountGross: isVatExempt
        ? netAmount
        : tranche.amountGross !== undefined
          ? tranche.amountGross
          : calcGrossFromNet(netAmount, vatRate),
      dueDate,
      direction: 'wpływ',
      isPaid: Boolean(tranche.isPaid),
      scheduledTaskId: validScheduledTaskId,
    });
  }

  for (const quote of project.quotations || []) {
    if (quote.isSelected === false || quote.linkedCostId) continue;
    const dueDate = quote.dueDate?.trim() || '';
    if (!dueDate) continue;
    const validScheduledTaskId =
      quote.scheduledTaskId && tasksById.has(quote.scheduledTaskId)
        ? quote.scheduledTaskId
        : undefined;
    const netAmount = quote.totalNet || 0;
    const grossAmount =
      quote.type === 'koszt'
        ? quote.totalGross !== undefined
          ? quote.totalGross
          : calcGrossFromNet(netAmount, quote.vatRate ?? vatRate)
        : isVatExempt
          ? netAmount
          : quote.totalGross !== undefined
            ? quote.totalGross
            : calcGrossFromNet(netAmount, quote.vatRate ?? vatRate);
    result.push({
      projectId: project.id,
      projectKey: project.key,
      projectName: project.name,
      kind: 'quotation',
      itemId: quote.id,
      title: quote.title,
      amountNet: isVatExempt && quote.type === 'koszt' ? grossAmount : netAmount,
      amountGross: grossAmount,
      dueDate,
      direction: quote.type === 'koszt' ? 'wydatek' : 'wpływ',
      isPaid: Boolean(quote.isPaid),
      scheduledTaskId: validScheduledTaskId,
    });
  }

  for (const cost of project.costs || []) {
    const dueDate = cost.dueDate?.trim() || '';
    if (!dueDate) continue;
    const validScheduledTaskId =
      cost.scheduledTaskId && tasksById.has(cost.scheduledTaskId)
        ? cost.scheduledTaskId
        : undefined;
    const grossAmount =
      cost.amountGross !== undefined
        ? cost.amountGross
        : calcGrossFromNet(cost.amountNet || 0, cost.vatRate ?? vatRate);
    result.push({
      projectId: project.id,
      projectKey: project.key,
      projectName: project.name,
      kind: 'cost',
      itemId: cost.id,
      title: cost.title,
      amountNet: isVatExempt ? grossAmount : cost.amountNet || 0,
      amountGross: grossAmount,
      dueDate,
      direction: 'wydatek',
      isPaid: Boolean(cost.isPaid || cost.status === 'paid'),
      scheduledTaskId: validScheduledTaskId,
    });
  }

  return result;
}

export function getUpcomingUnscheduledPayments(
  projects: Project[],
  tasksById: Map<string, Task>,
  currentUser: Pick<User, 'id' | 'role'> | null | undefined,
  todayIso: string = getTodayIso(),
  companies?: Company[]
): PaymentScheduleCandidate[] {
  const companyMap = new Map<string, Company>();
  for (const comp of companies || []) {
    if (comp && comp.id) companyMap.set(comp.id, comp);
  }
  const candidates: PaymentScheduleCandidate[] = [];
  for (const project of projects) {
    if (!canEditFinance(currentUser, project)) continue;
    const company = project.companyId ? companyMap.get(project.companyId) || null : null;
    for (const item of getProjectPaymentCandidates(project, tasksById, company)) {
      if (!item.isPaid && !item.scheduledTaskId && item.dueDate >= todayIso) {
        candidates.push(item);
      }
    }
  }
  candidates.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return candidates;
}

export function buildPaymentTaskTitle(
  itemTitle: string,
  amountPln: number,
  direction: 'wydatek' | 'wpływ'
): string {
  const suffix = ` (${formatPln(amountPln)}, ${direction})`;
  const prefix = 'Płatność: ';
  const maxNameLen = Math.max(10, FIELD_LIMITS.title - prefix.length - suffix.length);
  const cleanName = itemTitle.trim();
  const safeName =
    cleanName.length > maxNameLen ? `${cleanName.slice(0, maxNameLen - 1)}…` : cleanName;
  return `${prefix}${safeName}${suffix}`.slice(0, FIELD_LIMITS.title);
}

export function buildPaymentTaskPayload(
  project: Pick<Project, 'id' | 'key' | 'name' | 'ownerId'>,
  candidate: PaymentScheduleCandidate,
  defaultTaskType: string,
  amountMode: EconomyAmountMode
): Record<string, any> {
  const amount = amountMode === 'gross' ? candidate.amountGross : candidate.amountNet;
  return {
    projectId: project.id,
    title: buildPaymentTaskTitle(candidate.title, amount, candidate.direction),
    description: `Płatność w projekcie [${project.key}] ${project.name}: ${candidate.title} (${formatPln(amount)}, ${candidate.direction}). Termin płatności: ${candidate.dueDate}.`,
    startDate: candidate.dueDate,
    dueDate: candidate.dueDate,
    durationDays: 1,
    type: defaultTaskType || 'rysunek',
    priority: 'normal',
    status: 'to_do',
    progress: 0,
    ...(project.ownerId ? { assigneeId: project.ownerId } : {}),
    tags: ['płatność'],
    ...(candidate.kind === 'cost' ? { costIds: [candidate.itemId] } : {}),
  };
}

export function buildProjectPatchWithScheduledTask(
  project: Project,
  updates: Array<{ kind: PaymentItemKind; itemId: string; taskId: string }>
): Partial<Project> {
  const patch: Partial<Project> = {};
  const costUpdates = new Map<string, string>();
  const trancheUpdates = new Map<string, string>();
  const quoteUpdates = new Map<string, string>();

  for (const u of updates) {
    if (u.kind === 'cost') costUpdates.set(u.itemId, u.taskId);
    else if (u.kind === 'tranche') trancheUpdates.set(u.itemId, u.taskId);
    else if (u.kind === 'quotation') quoteUpdates.set(u.itemId, u.taskId);
  }

  if (costUpdates.size > 0) {
    patch.costs = (project.costs || []).map((c: CostItem) =>
      costUpdates.has(c.id) ? { ...c, scheduledTaskId: costUpdates.get(c.id) } : c
    );
  }
  if (trancheUpdates.size > 0) {
    patch.paymentTranches = (project.paymentTranches || []).map((t: PaymentTranche) =>
      trancheUpdates.has(t.id) ? { ...t, scheduledTaskId: trancheUpdates.get(t.id) } : t
    );
  }
  if (quoteUpdates.size > 0) {
    patch.quotations = (project.quotations || []).map((q: QuotationItem) =>
      quoteUpdates.has(q.id) ? { ...q, scheduledTaskId: quoteUpdates.get(q.id) } : q
    );
  }

  return patch;
}

export interface SchedulePaymentResult {
  ok: boolean;
  alreadyScheduled?: boolean;
  rolledBack?: boolean;
  task?: Task;
  project?: Project;
  revision?: number;
  error?: string;
}

export async function schedulePaymentItemOnServer(params: {
  project: Project;
  candidate: PaymentScheduleCandidate;
  existingTasks: Task[];
  defaultTaskType: string;
  amountMode: EconomyAmountMode;
  baseUrl?: string;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
}): Promise<SchedulePaymentResult> {
  const {
    project,
    candidate,
    existingTasks,
    defaultTaskType,
    amountMode,
    baseUrl = '',
    headers = {},
    fetchImpl = fetch,
  } = params;

  const existingTask = candidate.scheduledTaskId
    ? existingTasks.find((t) => t.id === candidate.scheduledTaskId)
    : undefined;
  if (existingTask) {
    return { ok: true, alreadyScheduled: true, task: existingTask, project };
  }

  // Sprawdź również bieżącą tablicę projektu na wypadek gdy scheduledTaskId istnieje w projekcie
  const rawList =
    candidate.kind === 'cost'
      ? project.costs || []
      : candidate.kind === 'tranche'
        ? project.paymentTranches || []
        : project.quotations || [];
  const rawItem = rawList.find((it) => it.id === candidate.itemId);
  if (!rawItem) {
    return { ok: false, error: 'Nie znaleziono wskazanej pozycji finansowej w projekcie.' };
  }
  if (rawItem.scheduledTaskId) {
    const linked = existingTasks.find((t) => t.id === rawItem.scheduledTaskId);
    if (linked) {
      return { ok: true, alreadyScheduled: true, task: linked, project };
    }
  }

  // 1. POST zadania w harmonogramie
  const taskPayload = buildPaymentTaskPayload(project, candidate, defaultTaskType, amountMode);
  let postRes: Response;
  try {
    postRes = await fetchImpl(`${baseUrl}/api/tasks`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(taskPayload),
    });
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Błąd połączenia przy tworzeniu zadania.' };
  }

  const postData = await postRes.json().catch(() => ({}));
  if (!postRes.ok || !postData?.task?.id) {
    return {
      ok: false,
      error: postData?.error || 'Nie udało się utworzyć zadania w harmonogramie.',
    };
  }

  const createdTask = postData.task as Task;

  // 2. PATCH projektu zapisujący scheduledTaskId w pozycji
  const patch = buildProjectPatchWithScheduledTask(project, [
    { kind: candidate.kind, itemId: candidate.itemId, taskId: createdTask.id },
  ]);

  let patchRes: Response | null = null;
  let patchData: any = {};
  let patchError: string | undefined;

  try {
    patchRes = await fetchImpl(`${baseUrl}/api/projects/${encodeURIComponent(project.id)}`, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': String(project.revision || 1),
        ...headers,
      },
      body: JSON.stringify(patch),
    });
    patchData = await patchRes.json().catch(() => ({}));
    if (!patchRes.ok) {
      patchError = patchData?.error || 'Nie udało się zapisać powiązania w projekcie.';
    }
  } catch (err: any) {
    patchError = err?.message || 'Błąd połączenia przy aktualizacji projektu.';
  }

  if (!patchRes || !patchRes.ok || !patchData?.project) {
    // Cofnij krok 1 (usuń nowo utworzone zadanie, aby nie zostawić niespójności)
    let rolledBack = false;
    try {
      const rollbackRes = await fetchImpl(
        `${baseUrl}/api/tasks/${encodeURIComponent(createdTask.id)}`,
        {
          method: 'DELETE',
          credentials: 'same-origin',
          headers: { ...headers },
        }
      );
      rolledBack = rollbackRes.ok;
    } catch {
      rolledBack = false;
    }
    return {
      ok: false,
      rolledBack,
      error: patchError || 'Nie udało się zapisać powiązania płatności z zadaniem.',
    };
  }

  return {
    ok: true,
    task: createdTask,
    project: patchData.project as Project,
    revision: typeof patchData.revision === 'number' ? patchData.revision : postData.revision,
  };
}

export function sanitizeCsvFormula(value: string): string {
  if (!value) return '';
  const firstChar = value.charAt(0);
  if (firstChar === '=' || firstChar === '+' || firstChar === '-' || firstChar === '@') {
    return `'${value}`;
  }
  return value;
}

export function formatCsvCell(value: string): string {
  const safe = sanitizeCsvFormula(String(value ?? ''));
  if (safe.includes(';') || safe.includes('"') || safe.includes('\n') || safe.includes('\r')) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

function formatCsvNumber(amount: number): string {
  const rounded = Object.is(amount, -0) ? 0 : Math.round((amount + Number.EPSILON) * 100) / 100;
  return rounded.toFixed(2).replace('.', ',');
}

export function exportEconomyCsv(
  rows: EconomyProjectRow[],
  amountMode: EconomyAmountMode
): string {
  const modeLabel = amountMode === 'gross' ? 'brutto' : 'netto';
  const headers = [
    'Numer',
    'Nazwa',
    'Firma',
    'Zamawiający',
    `Wartość projektu (${modeLabel})`,
    `Koszty (${modeLabel})`,
    `Bilans (${modeLabel})`,
    `Oczekiwane wpływy (${modeLabel})`,
    `Oczekiwane wydatki (${modeLabel})`,
    `Przewidywane płatności (${modeLabel})`,
    'Najbliższy termin płatności',
    'Status',
    'Status VAT firmy',
    'Podstawa wyliczeń',
  ];

  const statusLabels: Record<Project['status'], string> = {
    planning: 'Planowany',
    active: 'Aktywny',
    on_hold: 'Wstrzymany',
    completed: 'Zakończony',
  };

  const lines: string[] = [headers.map(formatCsvCell).join(';')];

  for (const row of rows) {
    const val = amountMode === 'gross' ? row.valueGross : row.valueNet;
    const cost = amountMode === 'gross' ? row.costsGross : row.costsNet;
    const bal = amountMode === 'gross' ? row.balanceGross : row.balanceNet;
    const inflow = amountMode === 'gross' ? row.expectedInflowGross : row.expectedInflowNet;
    const outflow = amountMode === 'gross' ? row.expectedOutflowGross : row.expectedOutflowNet;
    const expBal = amountMode === 'gross' ? row.expectedBalanceGross : row.expectedBalanceNet;
    const companyLabel = row.company ? `${row.company.letter} - ${row.company.name}` : 'Bez firmy';
    const statusText = row.project.isArchived
      ? `${statusLabels[row.project.status] || row.project.status} (Archiwalny)`
      : statusLabels[row.project.status] || row.project.status;
    const vatStatusLabel = row.isVatExempt ? 'Zwolniona z VAT' : 'Płatnik VAT';
    const calcBasis = row.isVatExempt
      ? row.company?.vatExemptionBasis
        ? `Przychód ZW, koszt brutto (VAT nieodliczalny) — ${row.company.vatExemptionBasis}`
        : 'Przychód ZW, koszt brutto (VAT nieodliczalny)'
      : amountMode === 'gross'
        ? 'Przychód i koszt brutto'
        : 'Przychód i koszt netto';

    const cells = [
      row.project.key || '',
      row.project.name || '',
      companyLabel,
      row.project.clientName?.trim() || '',
      formatCsvNumber(val),
      formatCsvNumber(cost),
      formatCsvNumber(bal),
      formatCsvNumber(inflow),
      formatCsvNumber(outflow),
      formatCsvNumber(expBal),
      row.nextPaymentDate || '',
      statusText,
      vatStatusLabel,
      calcBasis,
    ];
    lines.push(cells.map(formatCsvCell).join(';'));
  }

  return `\uFEFF${lines.join('\r\n')}`;
}
