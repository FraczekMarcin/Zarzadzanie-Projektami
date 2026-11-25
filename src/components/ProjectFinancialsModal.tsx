import React, { useState, useRef, useId, useEffect } from 'react';
import type {
  Project,
  Task,
  User,
  QuotationItem,
  CostItem,
  CostCategory,
  PaymentTranche,
  Company,
} from '../types';
import type { FinancePatchSaveResult } from '../hooks/useServerSync';
import type { FormSubmitResult } from '../hooks/useFormSubmit';
import { registerClientIfNew } from '../utils/variableSettings';
import { isProjectStatusClosed } from '../utils/projectMeta';
import { useVariables } from '../hooks/useVariables';
import { copyToClipboard } from '../utils/clipboard';
import { useFocusTrap } from '../utils/useFocusTrap';
import { canEditFinance } from '../utils/access';
import { useDismissOnOutsideClick } from '../hooks/useDismissOnOutsideClick';
import { DiscardChangesModal } from './DiscardChangesModal';
import {
  buildFinancePatch,
  computeProjectFinance,
  isPaymentOverdue,
} from '../utils/finance';
import {
  calcGrossFromNet,
  calcNetFromGross,
  formatMoney,
  formatQuantity,
  parseMoney,
  parseQuantity,
  validateMoneyInput,
  validateQuantityInput,
} from '../utils/money';
import { getTodayIso } from '../utils/today';
import {
  X,
  Building2,
  Calendar,
  Plus,
  Trash2,
  DollarSign,
  TrendingUp,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Receipt,
  Clock,
  Layers,
  Folder,
  Copy,
  Check,
  CheckSquare,
  Square,
  Edit3,
  ArrowRightLeft,
  Undo2,
  RefreshCw,
  Lock,
  ExternalLink,
} from 'lucide-react';

interface ProjectFinancialsModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: Project;
  companies?: Company[];
  tasks: Task[];
  currentUser?: User | null;
  isAdmin?: boolean;
  onSaveProject?: (
    updated: Project
  ) => Promise<FormSubmitResult<Project> | boolean | void> | FormSubmitResult<Project> | boolean | void;
  onSaveFinancePatch?: (
    projectId: string,
    patch: Partial<Project>,
    expectedRevision?: number
  ) => Promise<FinancePatchSaveResult>;
  onRefreshProject?: (freshProject: Project) => void;
  initialTab?: 'quotations' | 'costs' | 'client' | 'summary';
  onItemsMarkedPaid?: (linkedTaskIds: string[]) => void;
}

const COST_CATEGORIES: Array<{ value: CostCategory; label: string }> = [
  { value: 'mapa', label: '🗺️ Mapa (MDCP)' },
  { value: 'geologia', label: '🧪 Badania geologiczne i grunt' },
  { value: 'uzgodnienia', label: '📋 Uzgodnienia ZUD/PPOŻ/Sanepid' },
  { value: 'podwykonawca', label: '🏗️ Podwykonawca / Branżysta' },
  { value: 'oplaty_urzedowe', label: '🏛️ Opłaty skarbowe / urzędowe' },
  { value: 'inne', label: '📦 Inne wydatki' },
];

function getInitialMoneyStr(value: number | undefined | null): string {
  if (value === undefined || value === null || !Number.isFinite(value) || value <= 0) {
    return '';
  }
  return formatMoney(value);
}

function getOptionalMoneyStr(value: number | undefined | null): string {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return '';
  }
  return formatMoney(value);
}

export const ProjectFinancialsModal: React.FC<ProjectFinancialsModalProps> = ({
  isOpen,
  onClose,
  project,
  companies = [],
  tasks,
  currentUser,
  isAdmin = false,
  onSaveProject,
  onSaveFinancePatch,
  onRefreshProject,
  initialTab = 'quotations',
  onItemsMarkedPaid,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const footerCancelRef = useRef<HTMLButtonElement>(null);
  const moveQuoteModalRef = useRef<HTMLDivElement>(null);
  const moveQuoteCancelRef = useRef<HTMLButtonElement>(null);
  const uidPrefix = useId();

  const effectiveUser =
    currentUser ?? (isAdmin ? ({ id: 'admin', role: 'admin' } as User) : null);
  const canEdit = canEditFinance(effectiveUser, project);

  const [activeTab, setActiveTab] = useState<'quotations' | 'costs' | 'client' | 'summary'>(initialTab);
  const [highlightedCostId, setHighlightedCostId] = useState<string | null>(null);

  // Client form fields
  const [clientName, setClientName] = useState(project.clientName || '');
  const [clientContactPerson, setClientContactPerson] = useState(project.clientContactPerson || '');
  const [clientPhone, setClientPhone] = useState(project.clientPhone || '');
  const [clientEmail, setClientEmail] = useState(project.clientEmail || '');
  const [clientNip, setClientNip] = useState(project.clientNip || '');
  const [clientAddress, setClientAddress] = useState(project.clientAddress || '');
  const [diskPath, setDiskPath] = useState(project.diskPath || '');
  const [copiedPath, setCopiedPath] = useState(false);

  // Available VAT rates, project statuses & clients from server-synced system variables
  const {
    vatRates: vatRateOptions,
    clients: availableClients,
    projectStatuses,
  } = useVariables();
  const projectCompany = project.companyId
    ? companies.find((c) => c.id === project.companyId)
    : undefined;
  const isVatExempt = projectCompany?.vatPayer === false;
  const defaultVarVatRate =
    vatRateOptions.find((v) => v.isDefault)?.value ??
    vatRateOptions.find((v) => v.value === 23)?.value ??
    vatRateOptions[0]?.value ??
    23;

  // Base Contract Value (Wartość projektu z umowy) — pusta, jeśli projekt jej nie ma
  const initialVatRate =
    project.projectVatRate !== undefined
      ? project.projectVatRate
      : isVatExempt
        ? 0
        : defaultVarVatRate;
  const [projectVatRate, setProjectVatRate] = useState<number>(initialVatRate);
  const [baseNetStr, setBaseNetStr] = useState<string>(() =>
    getInitialMoneyStr(project.projectValue)
  );
  const [baseGrossStr, setBaseGrossStr] = useState<string>(() => {
    if (!project.projectValue || project.projectValue <= 0) return '';
    const gross =
      project.projectValueGross && project.projectValueGross > 0
        ? project.projectValueGross
        : calcGrossFromNet(project.projectValue, initialVatRate);
    return formatMoney(gross);
  });
  const [baseNetError, setBaseNetError] = useState<string | undefined>();
  const [baseGrossError, setBaseGrossError] = useState<string | undefined>();
  const [isBaseContractPaid, setIsBaseContractPaid] = useState<boolean>(
    project.isBaseContractPaid !== undefined
      ? Boolean(project.isBaseContractPaid)
      : isProjectStatusClosed(project.status, projectStatuses)
  );

  // Dates
  const [startDate, setStartDate] = useState(project.startDate || getTodayIso());
  const [dueDate, setDueDate] = useState(project.dueDate || getTodayIso());

  // Quotation items
  const [quotations, setQuotations] = useState<QuotationItem[]>(() =>
    (project.quotations || []).map((q) => ({
      ...q,
      companyName: q.companyName || project.clientName || 'Inwestor Główny',
      isSelected: q.isSelected !== undefined ? q.isSelected : true,
      taxType: q.taxType || 'netto',
      isPaid: q.isPaid || false,
    }))
  );

  // Add Quotation Form State (puste kwoty startowe, brak domyślnych 10000/5000)
  const [newQuoteTitle, setNewQuoteTitle] = useState('');
  const [newQuoteCompany, setNewQuoteCompany] = useState(project.clientName || '');
  const [newQuoteDirection, setNewQuoteDirection] = useState<'przychod' | 'koszt'>('przychod');
  const [newQuoteQuantityStr, setNewQuoteQuantityStr] = useState('1');
  const [newQuoteQuantityError, setNewQuoteQuantityError] = useState<string | undefined>();
  const [newQuoteUnit, setNewQuoteUnit] = useState('kpl');
  const [newQuotePriceStr, setNewQuotePriceStr] = useState('');
  const [newQuotePriceError, setNewQuotePriceError] = useState<string | undefined>();
  const [newQuoteTaxType, setNewQuoteTaxType] = useState<'netto' | 'brutto' | 'zwolniony'>(() =>
    isVatExempt ? 'zwolniony' : 'netto'
  );
  const [newQuoteVatRate, setNewQuoteVatRate] = useState(() =>
    isVatExempt ? 0 : defaultVarVatRate
  );
  const [newQuoteDueDate, setNewQuoteDueDate] = useState('');
  const [newQuoteIsSelected, setNewQuoteIsSelected] = useState(true);
  const [newQuoteIsPaid, setNewQuoteIsPaid] = useState(false);

  // Inline Edit & Confirm State — Quotations
  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null);
  const [editQuoteDraft, setEditQuoteDraft] = useState<{
    title: string;
    companyName: string;
    type: 'przychod' | 'koszt';
    quantityStr: string;
    quantityError?: string;
    unit: string;
    priceStr: string;
    priceError?: string;
    taxType: 'netto' | 'brutto' | 'zwolniony';
    vatRate: number;
    dueDate: string;
    isSelected: boolean;
    isPaid: boolean;
    paidAmountStr: string;
    paidAmountError?: string;
  } | null>(null);
  const [confirmDeleteQuoteId, setConfirmDeleteQuoteId] = useState<string | null>(null);

  // Move cost quotation to costs modal state
  const [moveQuoteModalId, setMoveQuoteModalId] = useState<string | null>(null);
  const [moveQuoteCategory, setMoveQuoteCategory] = useState<CostCategory>('podwykonawca');
  const [confirmUndoMoveQuoteId, setConfirmUndoMoveQuoteId] = useState<string | null>(null);

  // Costs items
  const [costs, setCosts] = useState<CostItem[]>(() =>
    (project.costs || []).map((c) => ({
      ...c,
      isPaid: c.isPaid !== undefined ? c.isPaid : c.status === 'paid',
    }))
  );

  // Add Cost Form State (puste kwoty startowe)
  const [newCostTitle, setNewCostTitle] = useState('');
  const [newCostCategory, setNewCostCategory] = useState<CostCategory>('mapa');
  const [newCostAmountNetStr, setNewCostAmountNetStr] = useState('');
  const [newCostAmountGrossStr, setNewCostAmountGrossStr] = useState('');
  const [newCostNetError, setNewCostNetError] = useState<string | undefined>();
  const [newCostGrossError, setNewCostGrossError] = useState<string | undefined>();
  const [newCostVatRate, setNewCostVatRate] = useState(() => defaultVarVatRate);
  const [newCostContractor, setNewCostContractor] = useState('');
  const [newCostInvoice, setNewCostInvoice] = useState('');
  const [newCostTaskId, setNewCostTaskId] = useState<string>('');
  const [newCostDueDate, setNewCostDueDate] = useState('');
  const [newCostStatus, setNewCostStatus] = useState<'planned' | 'incurred' | 'paid'>('planned');

  // Inline Edit & Confirm State — Costs
  const [editingCostId, setEditingCostId] = useState<string | null>(null);
  const [editCostDraft, setEditCostDraft] = useState<{
    title: string;
    category: CostCategory;
    taskId: string;
    contractorName: string;
    invoiceNumber: string;
    vatRate: number;
    amountNetStr: string;
    amountGrossStr: string;
    netError?: string;
    grossError?: string;
    dueDate: string;
    status: 'planned' | 'incurred' | 'paid';
    isPaid: boolean;
  } | null>(null);
  const [confirmDeleteCostId, setConfirmDeleteCostId] = useState<string | null>(null);

  // Payment Tranches State (Płatności zamawiającego)
  const [paymentTranches, setPaymentTranches] = useState<PaymentTranche[]>(() =>
    project.paymentTranches || []
  );
  const [newTrancheTitle, setNewTrancheTitle] = useState('');
  const [newTrancheNetStr, setNewTrancheNetStr] = useState('');
  const [newTrancheGrossStr, setNewTrancheGrossStr] = useState('');
  const [newTrancheNetError, setNewTrancheNetError] = useState<string | undefined>();
  const [newTrancheGrossError, setNewTrancheGrossError] = useState<string | undefined>();
  const [newTrancheDueDate, setNewTrancheDueDate] = useState('');
  const [newTrancheIsPaid, setNewTrancheIsPaid] = useState(false);
  const [newTranchePaidAt, setNewTranchePaidAt] = useState('');
  const [newTranchePaidAmountStr, setNewTranchePaidAmountStr] = useState('');
  const [newTranchePaidAmountError, setNewTranchePaidAmountError] = useState<string | undefined>();

  // Inline Edit & Confirm State — Tranches
  const [editingTrancheId, setEditingTrancheId] = useState<string | null>(null);
  const [editTrancheDraft, setEditTrancheDraft] = useState<{
    title: string;
    amountNetStr: string;
    amountGrossStr: string;
    netError?: string;
    grossError?: string;
    dueDate: string;
    isPaid: boolean;
    paidAt: string;
    paidAmountStr: string;
    paidAmountError?: string;
  } | null>(null);
  const [confirmDeleteTrancheId, setConfirmDeleteTrancheId] = useState<string | null>(null);

  // Save / Server Error / Conflict State
  const [isSaving, setIsSaving] = useState(false);
  const inFlightSaveRef = useRef(false);
  const saveErrorAlertRef = useRef<HTMLDivElement>(null);
  const conflictAlertRef = useRef<HTMLDivElement>(null);
  const [saveError, setSaveError] = useState<{
    error: string;
    itemType?: 'project' | 'quotation' | 'cost' | 'tranche';
    itemId?: string;
    field?: string;
  } | null>(null);
  const [conflictState, setConflictState] = useState<{
    error: string;
    currentProject?: Project;
  } | null>(null);

  useEffect(() => {
    if (saveError && typeof window !== 'undefined') {
      window.requestAnimationFrame(() => saveErrorAlertRef.current?.focus());
    }
  }, [saveError]);

  useEffect(() => {
    if (conflictState && typeof window !== 'undefined') {
      window.requestAnimationFrame(() => conflictAlertRef.current?.focus());
    }
  }, [conflictState]);

  const buildFinanceSnapshot = (vals: {
    clientName: string;
    clientContactPerson: string;
    clientPhone: string;
    clientEmail: string;
    clientNip: string;
    clientAddress: string;
    diskPath: string;
    startDate: string;
    dueDate: string;
    baseNetStr: string;
    baseGrossStr: string;
    projectVatRate: number;
    isBaseContractPaid: boolean;
    quotations: QuotationItem[];
    costs: CostItem[];
    paymentTranches: PaymentTranche[];
  }) => JSON.stringify(vals);

  const [baselineSnapshot, setBaselineSnapshot] = useState<string>(() =>
    buildFinanceSnapshot({
      clientName: project.clientName || '',
      clientContactPerson: project.clientContactPerson || '',
      clientPhone: project.clientPhone || '',
      clientEmail: project.clientEmail || '',
      clientNip: project.clientNip || '',
      clientAddress: project.clientAddress || '',
      diskPath: project.diskPath || '',
      startDate: project.startDate || getTodayIso(),
      dueDate: project.dueDate || getTodayIso(),
      baseNetStr: getInitialMoneyStr(project.projectValue),
      baseGrossStr:
        project.projectValue && project.projectValue > 0
          ? formatMoney(
              project.projectValueGross && project.projectValueGross > 0
                ? project.projectValueGross
                : calcGrossFromNet(project.projectValue, initialVatRate)
            )
          : '',
      projectVatRate: initialVatRate,
      isBaseContractPaid:
        project.isBaseContractPaid !== undefined
          ? Boolean(project.isBaseContractPaid)
          : isProjectStatusClosed(project.status, projectStatuses),
      quotations: (project.quotations || []).map((q) => ({
        ...q,
        companyName: q.companyName || project.clientName || 'Inwestor Główny',
        isSelected: q.isSelected !== undefined ? q.isSelected : true,
        taxType: q.taxType || 'netto',
        isPaid: q.isPaid || false,
      })),
      costs: (project.costs || []).map((c) => ({
        ...c,
        isPaid: c.isPaid !== undefined ? c.isPaid : c.status === 'paid',
      })),
      paymentTranches: project.paymentTranches || [],
    })
  );

  const currentSnapshot = buildFinanceSnapshot({
    clientName,
    clientContactPerson,
    clientPhone,
    clientEmail,
    clientNip,
    clientAddress,
    diskPath,
    startDate,
    dueDate,
    baseNetStr,
    baseGrossStr,
    projectVatRate,
    isBaseContractPaid,
    quotations,
    costs,
    paymentTranches,
  });

  const hasUnsavedInlineDraft = Boolean(
    editingQuoteId ||
      editingCostId ||
      editingTrancheId ||
      newQuoteTitle.trim() ||
      newQuotePriceStr.trim() ||
      newCostTitle.trim() ||
      newCostAmountNetStr.trim() ||
      newCostAmountGrossStr.trim() ||
      newTrancheTitle.trim() ||
      newTrancheNetStr.trim() ||
      newTrancheGrossStr.trim()
  );

  const isDirty =
    isOpen &&
    canEdit &&
    (currentSnapshot !== baselineSnapshot || hasUnsavedInlineDraft);

  const {
    backdropProps,
    flashClassName,
    requestClose,
    isDiscardModalOpen,
    confirmDiscard,
    cancelDiscard,
  } = useDismissOnOutsideClick({
    isOpen,
    mode: canEdit ? 'form' : 'dismiss',
    panelRef: modalRef,
    onDismiss: onClose,
    disabled: isSaving,
    isDirty,
    cancelButtonRef: footerCancelRef,
  });

  useFocusTrap({
    isOpen,
    onClose: requestClose,
    containerRef: modalRef,
    disableEscape: isSaving,
  });

  const isMoveQuoteOpen = Boolean(moveQuoteModalId && quotations.some((q) => q.id === moveQuoteModalId));

  const {
    backdropProps: moveQuoteBackdropProps,
  } = useDismissOnOutsideClick({
    isOpen: isMoveQuoteOpen,
    mode: 'form',
    panelRef: moveQuoteModalRef,
    onDismiss: () => setMoveQuoteModalId(null),
    cancelButtonRef: moveQuoteCancelRef,
  });

  useFocusTrap({
    isOpen: isMoveQuoteOpen,
    onClose: () => setMoveQuoteModalId(null),
    containerRef: moveQuoteModalRef,
  });

  if (!isOpen) return null;

  const projectTasks = tasks.filter((t) => t.projectId === project.id);

  // Parsed base contract values
  const parsedBaseNet = baseNetStr.trim() === '' ? 0 : parseMoney(baseNetStr);
  const parsedBaseGross = baseGrossStr.trim() === '' ? 0 : parseMoney(baseGrossStr);
  const baseProjectValueNet = parsedBaseNet !== null ? parsedBaseNet : 0;
  const baseProjectValueGross =
    parsedBaseGross !== null
      ? parsedBaseGross
      : calcGrossFromNet(baseProjectValueNet, projectVatRate);

  const draftProjectSnapshot: Project = {
    ...project,
    clientName: clientName.trim() || undefined,
    clientContactPerson: clientContactPerson.trim() || undefined,
    clientPhone: clientPhone.trim() || undefined,
    clientEmail: clientEmail.trim() || undefined,
    clientNip: clientNip.trim() || undefined,
    clientAddress: clientAddress.trim() || undefined,
    diskPath: diskPath.trim() || undefined,
    startDate,
    dueDate,
    projectValue: baseProjectValueNet,
    projectValueGross: baseProjectValueGross,
    projectVatRate,
    isBaseContractPaid,
    quotations,
    costs,
    paymentTranches,
  };

  const finance = computeProjectFinance(draftProjectSnapshot, projectCompany);
  const effectiveTrancheVat = isVatExempt ? 0 : projectVatRate;
  const hasZeroVatOption = vatRateOptions.some((v) => (v.value ?? v.rate) === 0);
  const selectedQuotations = quotations.filter((q) => q.isSelected !== false);
  const revenueQuotes = selectedQuotations.filter((q) => q.type !== 'koszt');
  const unlinkedCostQuotes = selectedQuotations.filter(
    (q) => q.type === 'koszt' && !q.linkedCostId
  );

  // Rehydrate modal states when user clicks "Odśwież dane projektu" po 409
  const applyFreshProjectToModal = (fresh: Project) => {
    const freshVat =
      fresh.projectVatRate !== undefined
        ? fresh.projectVatRate
        : isVatExempt
          ? 0
          : defaultVarVatRate;
    const nextStart = fresh.startDate || getTodayIso();
    const nextDue = fresh.dueDate || getTodayIso();
    const nextBaseNetStr = getInitialMoneyStr(fresh.projectValue);
    const nextBaseGrossStr =
      fresh.projectValue && fresh.projectValue > 0
        ? formatMoney(
            fresh.projectValueGross && fresh.projectValueGross > 0
              ? fresh.projectValueGross
              : calcGrossFromNet(fresh.projectValue, freshVat)
          )
        : '';
    const nextBasePaid =
      fresh.isBaseContractPaid !== undefined
        ? Boolean(fresh.isBaseContractPaid)
        : isProjectStatusClosed(fresh.status, projectStatuses);
    const nextQuotations = (fresh.quotations || []).map((q) => ({
      ...q,
      companyName: q.companyName || fresh.clientName || 'Inwestor Główny',
      isSelected: q.isSelected !== undefined ? q.isSelected : true,
      taxType: q.taxType || 'netto',
      isPaid: q.isPaid || false,
    }));
    const nextCosts = (fresh.costs || []).map((c) => ({
      ...c,
      isPaid: c.isPaid !== undefined ? c.isPaid : c.status === 'paid',
    }));
    const nextTranches = fresh.paymentTranches || [];

    setClientName(fresh.clientName || '');
    setClientContactPerson(fresh.clientContactPerson || '');
    setClientPhone(fresh.clientPhone || '');
    setClientEmail(fresh.clientEmail || '');
    setClientNip(fresh.clientNip || '');
    setClientAddress(fresh.clientAddress || '');
    setDiskPath(fresh.diskPath || '');
    setStartDate(nextStart);
    setDueDate(nextDue);
    setProjectVatRate(freshVat);
    setBaseNetStr(nextBaseNetStr);
    setBaseGrossStr(nextBaseGrossStr);
    setBaseNetError(undefined);
    setBaseGrossError(undefined);
    setIsBaseContractPaid(nextBasePaid);
    setQuotations(nextQuotations);
    setCosts(nextCosts);
    setPaymentTranches(nextTranches);
    setBaselineSnapshot(
      buildFinanceSnapshot({
        clientName: fresh.clientName || '',
        clientContactPerson: fresh.clientContactPerson || '',
        clientPhone: fresh.clientPhone || '',
        clientEmail: fresh.clientEmail || '',
        clientNip: fresh.clientNip || '',
        clientAddress: fresh.clientAddress || '',
        diskPath: fresh.diskPath || '',
        startDate: nextStart,
        dueDate: nextDue,
        baseNetStr: nextBaseNetStr,
        baseGrossStr: nextBaseGrossStr,
        projectVatRate: freshVat,
        isBaseContractPaid: nextBasePaid,
        quotations: nextQuotations,
        costs: nextCosts,
        paymentTranches: nextTranches,
      })
    );
    setEditingQuoteId(null);
    setEditQuoteDraft(null);
    setEditingCostId(null);
    setEditCostDraft(null);
    setEditingTrancheId(null);
    setEditTrancheDraft(null);
    setSaveError(null);
    setConflictState(null);
    onRefreshProject?.(fresh);
  };

  // --- Base Project Value Handlers ---
  const handleBaseNetChange = (raw: string) => {
    setBaseNetStr(raw);
    if (isVatExempt && projectVatRate !== 0) {
      setProjectVatRate(0);
    }
    if (raw.trim() === '') {
      setBaseNetError(undefined);
      setBaseGrossStr('');
      setBaseGrossError(undefined);
      return;
    }
    const res = validateMoneyInput(raw, { allowEmpty: true });
    if (!res.valid) {
      setBaseNetError(res.error);
    } else {
      setBaseNetError(undefined);
      if (res.value !== null) {
        const effVat = isVatExempt ? 0 : projectVatRate;
        setBaseGrossStr(res.value > 0 ? formatMoney(calcGrossFromNet(res.value, effVat)) : '0,00');
        setBaseGrossError(undefined);
      }
    }
  };

  const handleBaseNetBlur = () => {
    const parsed = parseMoney(baseNetStr);
    if (baseNetStr.trim() !== '' && parsed !== null) {
      setBaseNetStr(formatMoney(parsed));
    }
  };

  const handleBaseGrossChange = (raw: string) => {
    if (isVatExempt) return;
    setBaseGrossStr(raw);
    if (raw.trim() === '') {
      setBaseGrossError(undefined);
      setBaseNetStr('');
      setBaseNetError(undefined);
      return;
    }
    const res = validateMoneyInput(raw, { allowEmpty: true });
    if (!res.valid) {
      setBaseGrossError(res.error);
    } else {
      setBaseGrossError(undefined);
      if (res.value !== null) {
        setBaseNetStr(res.value > 0 ? formatMoney(calcNetFromGross(res.value, projectVatRate)) : '0,00');
        setBaseNetError(undefined);
      }
    }
  };

  const handleBaseGrossBlur = () => {
    const parsed = parseMoney(baseGrossStr);
    if (baseGrossStr.trim() !== '' && parsed !== null) {
      setBaseGrossStr(formatMoney(parsed));
    }
  };

  const handleProjectVatRateChange = (newVat: number) => {
    if (isVatExempt) return;
    setProjectVatRate(newVat);
    const parsedNet = parseMoney(baseNetStr);
    if (baseNetStr.trim() !== '' && parsedNet !== null) {
      setBaseGrossStr(formatMoney(calcGrossFromNet(parsedNet, newVat)));
      setBaseGrossError(undefined);
    }
    // Synchronize tranche gross preview values on VAT change
    setPaymentTranches((prev) =>
      prev.map((t) => ({
        ...t,
        amountGross: calcGrossFromNet(t.amountNet, newVat),
      }))
    );
    if (newTrancheNetStr.trim() !== '') {
      const pNet = parseMoney(newTrancheNetStr);
      if (pNet !== null) {
        setNewTrancheGrossStr(formatMoney(calcGrossFromNet(pNet, newVat)));
      }
    }
  };

  // --- Quotation Add Form Handlers ---
  const handleNewQuotePriceChange = (raw: string) => {
    setNewQuotePriceStr(raw);
    if (raw.trim() === '') {
      setNewQuotePriceError(undefined);
      return;
    }
    const res = validateMoneyInput(raw, { requiredPositive: true });
    setNewQuotePriceError(res.valid ? undefined : res.error);
  };

  const handleNewQuotePriceBlur = () => {
    const parsed = parseMoney(newQuotePriceStr);
    if (newQuotePriceStr.trim() !== '' && parsed !== null) {
      setNewQuotePriceStr(formatMoney(parsed));
    }
  };

  const handleNewQuoteQtyChange = (raw: string) => {
    setNewQuoteQuantityStr(raw);
    if (raw.trim() === '') {
      setNewQuoteQuantityError(undefined);
      return;
    }
    const res = validateQuantityInput(raw);
    setNewQuoteQuantityError(res.valid ? undefined : res.error);
  };

  const handleNewQuoteQtyBlur = () => {
    const parsed = parseQuantity(newQuoteQuantityStr);
    if (newQuoteQuantityStr.trim() !== '' && parsed !== null) {
      setNewQuoteQuantityStr(formatQuantity(parsed));
    }
  };

  const parsedNewQuotePrice = parseMoney(newQuotePriceStr);
  const parsedNewQuoteQty = parseQuantity(newQuoteQuantityStr);
  const canSubmitNewQuotation =
    canEdit &&
    newQuoteTitle.trim().length > 0 &&
    parsedNewQuotePrice !== null &&
    parsedNewQuotePrice > 0 &&
    parsedNewQuoteQty !== null &&
    parsedNewQuoteQty > 0 &&
    !newQuotePriceError &&
    !newQuoteQuantityError;

  const computeQuoteTotals = (
    qty: number,
    unitPriceInput: number,
    taxType: 'netto' | 'brutto' | 'zwolniony',
    rawVatRate: number
  ) => {
    let vatRate = rawVatRate;
    let unitNet = unitPriceInput;
    let unitGross = unitPriceInput;

    if (taxType === 'zwolniony') {
      vatRate = 0;
      unitNet = unitPriceInput;
      unitGross = unitPriceInput;
    } else if (taxType === 'brutto') {
      unitGross = unitPriceInput;
      unitNet = calcNetFromGross(unitGross, vatRate);
    } else {
      unitNet = unitPriceInput;
      unitGross = calcGrossFromNet(unitNet, vatRate);
    }

    const totalNet = Math.round((qty * unitNet + Number.EPSILON) * 100) / 100;
    const totalGross =
      taxType === 'zwolniony'
        ? totalNet
        : taxType === 'brutto'
          ? Math.round((qty * unitGross + Number.EPSILON) * 100) / 100
          : calcGrossFromNet(totalNet, vatRate);

    return { vatRate, unitNet, unitGross, totalNet, totalGross };
  };

  const handleAddQuotation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmitNewQuotation || parsedNewQuotePrice === null || parsedNewQuoteQty === null) return;

    const effectiveTaxType =
      isVatExempt && newQuoteDirection === 'przychod' ? 'zwolniony' : newQuoteTaxType;
    const effectiveVatInput = effectiveTaxType === 'zwolniony' ? 0 : newQuoteVatRate;

    const { vatRate, unitNet, unitGross, totalNet, totalGross } = computeQuoteTotals(
      parsedNewQuoteQty,
      parsedNewQuotePrice,
      effectiveTaxType,
      effectiveVatInput
    );

    const newItem: QuotationItem = {
      id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: newQuoteTitle.trim(),
      companyName: newQuoteCompany.trim() || clientName.trim() || 'Pracownia Projektowa',
      quantity: parsedNewQuoteQty,
      unit: newQuoteUnit.trim() || 'kpl',
      unitPriceNet: unitNet,
      unitPriceGross: unitGross,
      taxType: effectiveTaxType,
      vatRate,
      totalNet,
      totalGross,
      dueDate: newQuoteDueDate || undefined,
      isSelected: newQuoteIsSelected,
      isPaid: newQuoteIsPaid,
      paidAt: newQuoteIsPaid ? getTodayIso() : undefined,
      status: 'accepted',
      type: newQuoteDirection,
    };

    setQuotations((prev) => [...prev, newItem]);
    setNewQuoteTitle('');
    setNewQuoteCompany(clientName || '');
    setNewQuoteQuantityStr('1');
    setNewQuoteQuantityError(undefined);
    setNewQuotePriceStr('');
    setNewQuotePriceError(undefined);
    setNewQuoteDueDate('');
    setNewQuoteIsPaid(false);
  };

  const handleToggleSelectQuotation = (id: string) => {
    if (!canEdit) return;
    setQuotations((prev) =>
      prev.map((q) => (q.id === id ? { ...q, isSelected: !(q.isSelected !== false) } : q))
    );
  };

  const handleToggleQuotationPaid = (id: string) => {
    if (!canEdit) return;
    setQuotations((prev) =>
      prev.map((q) =>
        q.id === id
          ? {
              ...q,
              isPaid: !q.isPaid,
              paidAt: !q.isPaid ? getTodayIso() : undefined,
            }
          : q
      )
    );
  };

  const startEditQuotation = (q: QuotationItem) => {
    if (!canEdit) return;
    const taxType = q.taxType || 'netto';
    const baseUnitPrice =
      taxType === 'brutto' && q.unitPriceGross !== undefined ? q.unitPriceGross : q.unitPriceNet;
    setEditingQuoteId(q.id);
    setConfirmDeleteQuoteId(null);
    setEditQuoteDraft({
      title: q.title,
      companyName: q.companyName || '',
      type: q.type === 'koszt' ? 'koszt' : 'przychod',
      quantityStr: formatQuantity(q.quantity),
      unit: q.unit || 'kpl',
      priceStr: formatMoney(baseUnitPrice),
      taxType,
      vatRate: q.vatRate ?? 23,
      dueDate: q.dueDate || '',
      isSelected: q.isSelected !== false,
      isPaid: Boolean(q.isPaid),
      paidAmountStr: getOptionalMoneyStr(q.paidAmount),
    });
  };

  const cancelEditQuotation = () => {
    setEditingQuoteId(null);
    setEditQuoteDraft(null);
  };

  const saveEditQuotation = (id: string) => {
    if (!canEdit || !editQuoteDraft) return;
    const qtyRes = validateQuantityInput(editQuoteDraft.quantityStr);
    const priceRes = validateMoneyInput(editQuoteDraft.priceStr, { requiredPositive: true });
    const paidRes = validateMoneyInput(editQuoteDraft.paidAmountStr, { allowEmpty: true });

    if (!editQuoteDraft.title.trim() || !qtyRes.valid || !priceRes.valid || !paidRes.valid) {
      setEditQuoteDraft((prev) =>
        prev
          ? {
              ...prev,
              quantityError: qtyRes.valid ? undefined : qtyRes.error,
              priceError: priceRes.valid ? undefined : priceRes.error,
              paidAmountError: paidRes.valid ? undefined : paidRes.error,
            }
          : null
      );
      return;
    }

    const effectiveTaxType =
      isVatExempt && editQuoteDraft.type === 'przychod' ? 'zwolniony' : editQuoteDraft.taxType;
    const effectiveVatInput = effectiveTaxType === 'zwolniony' ? 0 : editQuoteDraft.vatRate;

    const { vatRate, unitNet, unitGross, totalNet, totalGross } = computeQuoteTotals(
      qtyRes.value!,
      priceRes.value!,
      effectiveTaxType,
      effectiveVatInput
    );

    const existing = quotations.find((q) => q.id === id);
    const updatedLinkedCostId =
      editQuoteDraft.type === 'koszt' ? existing?.linkedCostId : undefined;

    setQuotations((prev) =>
      prev.map((q) =>
        q.id === id
          ? {
              ...q,
              title: editQuoteDraft.title.trim(),
              companyName: editQuoteDraft.companyName.trim() || clientName.trim() || 'Pracownia Projektowa',
              type: editQuoteDraft.type,
              quantity: qtyRes.value!,
              unit: editQuoteDraft.unit.trim() || 'kpl',
              unitPriceNet: unitNet,
              unitPriceGross: unitGross,
              taxType: effectiveTaxType,
              vatRate,
              totalNet,
              totalGross,
              dueDate: editQuoteDraft.dueDate || undefined,
              isSelected: editQuoteDraft.isSelected,
              isPaid: editQuoteDraft.isPaid,
              paidAt: editQuoteDraft.isPaid ? q.paidAt || getTodayIso() : undefined,
              paidAmount: paidRes.value !== null ? paidRes.value : undefined,
              isChosenOffer: updatedLinkedCostId ? q.isChosenOffer : undefined,
              linkedCostId: updatedLinkedCostId,
            }
          : q
      )
    );

    // Update linked cost amounts if quotation is linked to a cost
    if (updatedLinkedCostId) {
      setCosts((prev) =>
        prev.map((c) =>
          c.id === updatedLinkedCostId
            ? {
                ...c,
                title: editQuoteDraft.title.trim(),
                contractorName: editQuoteDraft.companyName.trim() || undefined,
                amountNet: totalNet,
                amountGross: totalGross,
                vatRate,
                dueDate: editQuoteDraft.dueDate || undefined,
              }
            : c
        )
      );
    }

    cancelEditQuotation();
  };

  const handleDeleteQuotation = (id: string) => {
    if (!canEdit) return;
    setQuotations((prev) => prev.filter((q) => q.id !== id));
    setCosts((prev) =>
      prev.map((c) => (c.sourceQuotationId === id ? { ...c, sourceQuotationId: undefined } : c))
    );
    setConfirmDeleteQuoteId(null);
    if (editingQuoteId === id) cancelEditQuotation();
  };

  // --- Move Cost Quotation to Costs ---
  const openMoveQuoteModal = (quoteId: string) => {
    if (!canEdit) return;
    setMoveQuoteCategory('podwykonawca');
    setMoveQuoteModalId(quoteId);
  };

  const handleConfirmMoveQuoteToCost = () => {
    if (!canEdit || !moveQuoteModalId) return;
    const q = quotations.find((item) => item.id === moveQuoteModalId);
    if (!q || q.type !== 'koszt' || q.linkedCostId) {
      setMoveQuoteModalId(null);
      return;
    }

    const newCostId = `cst-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const newCost: CostItem = {
      id: newCostId,
      projectId: project.id,
      title: q.title,
      category: moveQuoteCategory,
      contractorName: q.companyName || undefined,
      amountNet: q.totalNet,
      amountGross: q.totalGross,
      vatRate: q.vatRate,
      date: q.dueDate || getTodayIso(),
      dueDate: q.dueDate || undefined,
      status: 'planned',
      isPaid: false,
      sourceQuotationId: q.id,
    };

    setCosts((prev) => [...prev, newCost]);
    setQuotations((prev) =>
      prev.map((item) =>
        item.id === q.id
          ? { ...item, isChosenOffer: true, linkedCostId: newCostId }
          : item
      )
    );
    setMoveQuoteModalId(null);
  };

  const handleUndoMoveQuoteToCost = (quoteId: string) => {
    if (!canEdit) return;
    const q = quotations.find((item) => item.id === quoteId);
    if (!q) return;
    const linkedId = q.linkedCostId;
    if (linkedId) {
      setCosts((prev) => prev.filter((c) => c.id !== linkedId));
    }
    setQuotations((prev) =>
      prev.map((item) =>
        item.id === quoteId
          ? { ...item, isChosenOffer: undefined, linkedCostId: undefined }
          : item
      )
    );
    setConfirmUndoMoveQuoteId(null);
  };

  const handleJumpToLinkedCost = (costId: string) => {
    setHighlightedCostId(costId);
    setActiveTab('costs');
  };

  // --- Cost Add & Edit Form Handlers ---
  const handleNewCostNetChange = (raw: string) => {
    setNewCostAmountNetStr(raw);
    if (raw.trim() === '') {
      setNewCostNetError(undefined);
      setNewCostAmountGrossStr('');
      setNewCostGrossError(undefined);
      return;
    }
    const res = validateMoneyInput(raw, { requiredPositive: true });
    if (!res.valid) {
      setNewCostNetError(res.error);
    } else {
      setNewCostNetError(undefined);
      if (res.value !== null) {
        setNewCostAmountGrossStr(formatMoney(calcGrossFromNet(res.value, newCostVatRate)));
        setNewCostGrossError(undefined);
      }
    }
  };

  const handleNewCostNetBlur = () => {
    const parsed = parseMoney(newCostAmountNetStr);
    if (newCostAmountNetStr.trim() !== '' && parsed !== null) {
      setNewCostAmountNetStr(formatMoney(parsed));
    }
  };

  const handleNewCostGrossChange = (raw: string) => {
    setNewCostAmountGrossStr(raw);
    if (raw.trim() === '') {
      setNewCostGrossError(undefined);
      setNewCostAmountNetStr('');
      setNewCostNetError(undefined);
      return;
    }
    const res = validateMoneyInput(raw, { requiredPositive: true });
    if (!res.valid) {
      setNewCostGrossError(res.error);
    } else {
      setNewCostGrossError(undefined);
      if (res.value !== null) {
        setNewCostAmountNetStr(formatMoney(calcNetFromGross(res.value, newCostVatRate)));
        setNewCostNetError(undefined);
      }
    }
  };

  const handleNewCostGrossBlur = () => {
    const parsed = parseMoney(newCostAmountGrossStr);
    if (newCostAmountGrossStr.trim() !== '' && parsed !== null) {
      setNewCostAmountGrossStr(formatMoney(parsed));
    }
  };

  const handleNewCostVatChange = (newVat: number) => {
    setNewCostVatRate(newVat);
    const parsedNet = parseMoney(newCostAmountNetStr);
    if (newCostAmountNetStr.trim() !== '' && parsedNet !== null) {
      setNewCostAmountGrossStr(formatMoney(calcGrossFromNet(parsedNet, newVat)));
      setNewCostGrossError(undefined);
    }
  };

  const parsedNewCostNet = parseMoney(newCostAmountNetStr);
  const parsedNewCostGross = parseMoney(newCostAmountGrossStr);
  const canSubmitNewCost =
    canEdit &&
    newCostTitle.trim().length > 0 &&
    parsedNewCostNet !== null &&
    parsedNewCostNet > 0 &&
    !newCostNetError &&
    !newCostGrossError;

  const handleAddCost = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmitNewCost || parsedNewCostNet === null) return;

    const gross =
      parsedNewCostGross !== null
        ? parsedNewCostGross
        : calcGrossFromNet(parsedNewCostNet, newCostVatRate);
    const isPaid = newCostStatus === 'paid';

    const newCost: CostItem = {
      id: `cst-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      projectId: project.id,
      taskId: newCostTaskId || undefined,
      title: newCostTitle.trim(),
      category: newCostCategory,
      amountNet: parsedNewCostNet,
      amountGross: gross,
      vatRate: newCostVatRate,
      contractorName: newCostContractor.trim() || undefined,
      invoiceNumber: newCostInvoice.trim() || undefined,
      date: getTodayIso(),
      dueDate: newCostDueDate || undefined,
      status: newCostStatus,
      isPaid,
      paidAt: isPaid ? getTodayIso() : undefined,
    };

    setCosts((prev) => [...prev, newCost]);
    setNewCostTitle('');
    setNewCostAmountNetStr('');
    setNewCostAmountGrossStr('');
    setNewCostNetError(undefined);
    setNewCostGrossError(undefined);
    setNewCostContractor('');
    setNewCostInvoice('');
    setNewCostDueDate('');
    setNewCostStatus('planned');
  };

  const handleToggleCostPaid = (id: string) => {
    if (!canEdit) return;
    setCosts((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const currentlyPaid = c.isPaid !== undefined ? c.isPaid : c.status === 'paid';
        const nextPaid = !currentlyPaid;
        return {
          ...c,
          isPaid: nextPaid,
          status: nextPaid ? 'paid' : c.status === 'paid' ? 'incurred' : c.status,
          paidAt: nextPaid ? getTodayIso() : undefined,
        };
      })
    );
  };

  const startEditCost = (c: CostItem) => {
    if (!canEdit) return;
    const inferredVat =
      c.vatRate !== undefined
        ? c.vatRate
        : c.amountNet > 0
          ? Math.round(((c.amountGross / c.amountNet) - 1) * 100)
          : 23;
    setEditingCostId(c.id);
    setConfirmDeleteCostId(null);
    setEditCostDraft({
      title: c.title,
      category: c.category,
      taskId: c.taskId || '',
      contractorName: c.contractorName || '',
      invoiceNumber: c.invoiceNumber || '',
      vatRate: inferredVat >= 0 && inferredVat <= 100 ? inferredVat : 23,
      amountNetStr: formatMoney(c.amountNet),
      amountGrossStr: formatMoney(c.amountGross),
      dueDate: c.dueDate || '',
      status: c.status,
      isPaid: c.isPaid !== undefined ? c.isPaid : c.status === 'paid',
    });
  };

  const cancelEditCost = () => {
    setEditingCostId(null);
    setEditCostDraft(null);
  };

  const saveEditCost = (id: string) => {
    if (!canEdit || !editCostDraft) return;
    const netRes = validateMoneyInput(editCostDraft.amountNetStr, { requiredPositive: true });
    const grossRes = validateMoneyInput(editCostDraft.amountGrossStr, { requiredPositive: true });

    if (!editCostDraft.title.trim() || !netRes.valid || !grossRes.valid) {
      setEditCostDraft((prev) =>
        prev
          ? {
              ...prev,
              netError: netRes.valid ? undefined : netRes.error,
              grossError: grossRes.valid ? undefined : grossRes.error,
            }
          : null
      );
      return;
    }

    const net = netRes.value!;
    const gross = grossRes.value!;

    setCosts((prev) =>
      prev.map((c) =>
        c.id === id
          ? {
              ...c,
              title: editCostDraft.title.trim(),
              category: editCostDraft.category,
              taskId: editCostDraft.taskId || undefined,
              contractorName: editCostDraft.contractorName.trim() || undefined,
              invoiceNumber: editCostDraft.invoiceNumber.trim() || undefined,
              vatRate: editCostDraft.vatRate,
              amountNet: net,
              amountGross: gross,
              dueDate: editCostDraft.dueDate || undefined,
              status: editCostDraft.isPaid ? 'paid' : editCostDraft.status === 'paid' ? 'incurred' : editCostDraft.status,
              isPaid: editCostDraft.isPaid,
              paidAt: editCostDraft.isPaid ? c.paidAt || getTodayIso() : undefined,
            }
          : c
      )
    );

    cancelEditCost();
  };

  const handleDeleteCost = (id: string) => {
    if (!canEdit) return;
    const deletedCost = costs.find((c) => c.id === id);
    setCosts((prev) => prev.filter((c) => c.id !== id));
    // Jeśli pozycja kosztu została usunięta ręcznie, oznaczenie w wycenie musi zniknąć
    setQuotations((prev) =>
      prev.map((q) =>
        q.linkedCostId === id || (deletedCost?.sourceQuotationId && q.id === deletedCost.sourceQuotationId)
          ? { ...q, isChosenOffer: undefined, linkedCostId: undefined }
          : q
      )
    );
    setConfirmDeleteCostId(null);
    if (editingCostId === id) cancelEditCost();
  };

  // --- Payment Tranches Handlers ---
  const handleNewTrancheNetChange = (raw: string) => {
    setNewTrancheNetStr(raw);
    if (raw.trim() === '') {
      setNewTrancheNetError(undefined);
      setNewTrancheGrossStr('');
      setNewTrancheGrossError(undefined);
      return;
    }
    const res = validateMoneyInput(raw, { requiredPositive: true });
    if (!res.valid) {
      setNewTrancheNetError(res.error);
    } else {
      setNewTrancheNetError(undefined);
      if (res.value !== null) {
        setNewTrancheGrossStr(formatMoney(calcGrossFromNet(res.value, effectiveTrancheVat)));
        setNewTrancheGrossError(undefined);
      }
    }
  };

  const handleNewTrancheNetBlur = () => {
    const parsed = parseMoney(newTrancheNetStr);
    if (newTrancheNetStr.trim() !== '' && parsed !== null) {
      setNewTrancheNetStr(formatMoney(parsed));
    }
  };

  const handleNewTrancheGrossChange = (raw: string) => {
    if (isVatExempt) return;
    setNewTrancheGrossStr(raw);
    if (raw.trim() === '') {
      setNewTrancheGrossError(undefined);
      setNewTrancheNetStr('');
      setNewTrancheNetError(undefined);
      return;
    }
    const res = validateMoneyInput(raw, { requiredPositive: true });
    if (!res.valid) {
      setNewTrancheGrossError(res.error);
    } else {
      setNewTrancheGrossError(undefined);
      if (res.value !== null) {
        setNewTrancheNetStr(formatMoney(calcNetFromGross(res.value, effectiveTrancheVat)));
        setNewTrancheNetError(undefined);
      }
    }
  };

  const handleNewTrancheGrossBlur = () => {
    const parsed = parseMoney(newTrancheGrossStr);
    if (newTrancheGrossStr.trim() !== '' && parsed !== null) {
      setNewTrancheGrossStr(formatMoney(parsed));
    }
  };

  const handleNewTranchePaidAmountChange = (raw: string) => {
    setNewTranchePaidAmountStr(raw);
    if (raw.trim() === '') {
      setNewTranchePaidAmountError(undefined);
      return;
    }
    const res = validateMoneyInput(raw, { allowEmpty: true });
    setNewTranchePaidAmountError(res.valid ? undefined : res.error);
  };

  const handleNewTranchePaidAmountBlur = () => {
    const parsed = parseMoney(newTranchePaidAmountStr);
    if (newTranchePaidAmountStr.trim() !== '' && parsed !== null) {
      setNewTranchePaidAmountStr(formatMoney(parsed));
    }
  };

  const parsedNewTrancheNet = parseMoney(newTrancheNetStr);
  const parsedNewTrancheGross = parseMoney(newTrancheGrossStr);
  const parsedNewTranchePaidAmount = parseMoney(newTranchePaidAmountStr);
  const canSubmitNewTranche =
    canEdit &&
    newTrancheTitle.trim().length > 0 &&
    parsedNewTrancheNet !== null &&
    parsedNewTrancheNet > 0 &&
    !newTrancheNetError &&
    !newTrancheGrossError &&
    !newTranchePaidAmountError;

  const handleAddTranche = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmitNewTranche || parsedNewTrancheNet === null) return;

    const gross = isVatExempt
      ? parsedNewTrancheNet
      : parsedNewTrancheGross !== null
        ? parsedNewTrancheGross
        : calcGrossFromNet(parsedNewTrancheNet, effectiveTrancheVat);

    const newTranche: PaymentTranche = {
      id: `trn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: newTrancheTitle.trim(),
      amountNet: parsedNewTrancheNet,
      amountGross: gross,
      dueDate: newTrancheDueDate || undefined,
      isPaid: newTrancheIsPaid,
      paidAt: newTrancheIsPaid ? newTranchePaidAt || getTodayIso() : undefined,
      paidAmount:
        newTrancheIsPaid && parsedNewTranchePaidAmount !== null
          ? parsedNewTranchePaidAmount
          : undefined,
    };

    setPaymentTranches((prev) => [...prev, newTranche]);
    setNewTrancheTitle('');
    setNewTrancheNetStr('');
    setNewTrancheGrossStr('');
    setNewTrancheNetError(undefined);
    setNewTrancheGrossError(undefined);
    setNewTrancheDueDate('');
    setNewTrancheIsPaid(false);
    setNewTranchePaidAt('');
    setNewTranchePaidAmountStr('');
    setNewTranchePaidAmountError(undefined);
  };

  const handleToggleTranchePaid = (id: string) => {
    if (!canEdit) return;
    setPaymentTranches((prev) =>
      prev.map((t) =>
        t.id === id
          ? {
              ...t,
              isPaid: !t.isPaid,
              paidAt: !t.isPaid ? t.paidAt || getTodayIso() : undefined,
            }
          : t
      )
    );
  };

  const startEditTranche = (t: PaymentTranche) => {
    if (!canEdit) return;
    setEditingTrancheId(t.id);
    setConfirmDeleteTrancheId(null);
    setEditTrancheDraft({
      title: t.title,
      amountNetStr: formatMoney(t.amountNet),
      amountGrossStr: isVatExempt ? formatMoney(t.amountNet) : formatMoney(t.amountGross),
      dueDate: t.dueDate || '',
      isPaid: t.isPaid,
      paidAt: t.paidAt || '',
      paidAmountStr: getOptionalMoneyStr(t.paidAmount),
    });
  };

  const cancelEditTranche = () => {
    setEditingTrancheId(null);
    setEditTrancheDraft(null);
  };

  const saveEditTranche = (id: string) => {
    if (!canEdit || !editTrancheDraft) return;
    const netRes = validateMoneyInput(editTrancheDraft.amountNetStr, { requiredPositive: true });
    const grossRes = isVatExempt
      ? netRes
      : validateMoneyInput(editTrancheDraft.amountGrossStr, { requiredPositive: true });
    const paidRes = validateMoneyInput(editTrancheDraft.paidAmountStr, { allowEmpty: true });

    if (!editTrancheDraft.title.trim() || !netRes.valid || !grossRes.valid || !paidRes.valid) {
      setEditTrancheDraft((prev) =>
        prev
          ? {
              ...prev,
              netError: netRes.valid ? undefined : netRes.error,
              grossError: grossRes.valid ? undefined : grossRes.error,
              paidAmountError: paidRes.valid ? undefined : paidRes.error,
            }
          : null
      );
      return;
    }

    setPaymentTranches((prev) =>
      prev.map((t) =>
        t.id === id
          ? {
              ...t,
              title: editTrancheDraft.title.trim(),
              amountNet: netRes.value!,
              amountGross: isVatExempt ? netRes.value! : grossRes.value!,
              dueDate: editTrancheDraft.dueDate || undefined,
              isPaid: editTrancheDraft.isPaid,
              paidAt: editTrancheDraft.isPaid ? editTrancheDraft.paidAt || getTodayIso() : undefined,
              paidAmount: paidRes.value !== null ? paidRes.value : undefined,
            }
          : t
      )
    );

    cancelEditTranche();
  };

  const handleDeleteTranche = (id: string) => {
    if (!canEdit) return;
    setPaymentTranches((prev) => prev.filter((t) => t.id !== id));
    setConfirmDeleteTrancheId(null);
    if (editingTrancheId === id) cancelEditTranche();
  };

  // --- Keyboard helper for inline edit rows ---
  const handleInlineRowKeyDown = (
    e: React.KeyboardEvent,
    onSave: () => void,
    onCancel: () => void
  ) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    } else if (
      e.key === 'Enter' &&
      !(e.target instanceof HTMLTextAreaElement) &&
      !(e.target instanceof HTMLButtonElement)
    ) {
      e.preventDefault();
      onSave();
    }
  };

  const handleSelectPredefinedClient = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (!canEdit) return;
    const selected = availableClients.find((c) => c.id === e.target.value);
    if (selected) {
      setClientName(selected.name);
      if (selected.contactPerson) setClientContactPerson(selected.contactPerson);
      if (selected.phone) setClientPhone(selected.phone);
      if (selected.email) setClientEmail(selected.email);
      if (selected.nip) setClientNip(selected.nip);
      if (selected.address) setClientAddress(selected.address);
    }
  };

  const handleCopyDiskPath = async () => {
    if (!diskPath) return;
    await copyToClipboard(diskPath);
    setCopiedPath(true);
    setTimeout(() => setCopiedPath(false), 2500);
  };

  // --- Save Handler (sends ONLY changed fields) ---
  const handleSaveAll = async () => {
    if (!canEdit) return;
    if (inFlightSaveRef.current || isSaving) return;
    if (baseNetError || baseGrossError) {
      setActiveTab('quotations');
      return;
    }

    setSaveError(null);
    setConflictState(null);

    if (clientName.trim()) {
      registerClientIfNew(
        {
          name: clientName.trim(),
          contactPerson: clientContactPerson.trim() || undefined,
          phone: clientPhone.trim() || undefined,
          email: clientEmail.trim() || undefined,
          nip: clientNip.trim() || undefined,
          address: clientAddress.trim() || undefined,
        },
        { syncToServer: isAdmin }
      );
    }

    const computedBudget =
      baseProjectValueNet > 0
        ? `${formatMoney(baseProjectValueNet)} PLN`
        : finance.totalRevenueNet > 0
          ? `${formatMoney(finance.totalRevenueNet)} PLN`
          : project.budget;

    const draftWithBudget: Project = {
      ...draftProjectSnapshot,
      budget: computedBudget,
    };

    const patch = buildFinancePatch(project, draftWithBudget);

    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }

    const collectNewlyPaidTaskIds = (): string[] => {
      const ids = new Set<string>();
      const origCosts = new Map((project.costs || []).map((c) => [c.id, c]));
      for (const c of costs) {
        const prev = origCosts.get(c.id);
        const wasPaid = Boolean(prev && (prev.isPaid || prev.status === 'paid'));
        const nowPaid = Boolean(c.isPaid || c.status === 'paid');
        if (!wasPaid && nowPaid && c.scheduledTaskId) {
          ids.add(c.scheduledTaskId);
        }
      }
      const origTranches = new Map((project.paymentTranches || []).map((t) => [t.id, t]));
      for (const t of paymentTranches) {
        const prev = origTranches.get(t.id);
        const wasPaid = Boolean(prev && prev.isPaid);
        if (!wasPaid && t.isPaid && t.scheduledTaskId) {
          ids.add(t.scheduledTaskId);
        }
      }
      const origQuotes = new Map((project.quotations || []).map((q) => [q.id, q]));
      for (const q of quotations) {
        const prev = origQuotes.get(q.id);
        const wasPaid = Boolean(prev && prev.isPaid);
        if (!wasPaid && q.isPaid && q.scheduledTaskId) {
          ids.add(q.scheduledTaskId);
        }
      }
      return Array.from(ids);
    };

    if (onSaveFinancePatch) {
      inFlightSaveRef.current = true;
      setIsSaving(true);
      try {
        const res = await onSaveFinancePatch(project.id, patch, project.revision || 1);

        if (res.ok) {
          const newlyPaidTaskIds = collectNewlyPaidTaskIds();
          if (newlyPaidTaskIds.length > 0) {
            onItemsMarkedPaid?.(newlyPaidTaskIds);
          }
          onClose();
          return;
        }

        if (res.status === 409) {
          setConflictState({
            error:
              res.error ||
              'Konflikt wersji projektu (został zmodyfikowany przez innego użytkownika).',
            currentProject: res.currentProject,
          });
          return;
        }

        setSaveError({
          error: res.error || 'Błąd zapisu danych finansowych.',
          itemType: res.itemType,
          itemId: res.itemId,
          field: res.field,
        });

        if (res.itemType === 'cost') {
          setActiveTab('costs');
        } else if (res.itemType === 'quotation' || res.itemType === 'tranche' || res.itemType === 'project') {
          setActiveTab('quotations');
        }
      } catch (err: any) {
        setSaveError({
          error: err?.message || 'Błąd połączenia z serwerem podczas zapisu danych finansowych.',
        });
      } finally {
        inFlightSaveRef.current = false;
        setIsSaving(false);
      }
      return;
    }

    if (onSaveProject) {
      inFlightSaveRef.current = true;
      setIsSaving(true);
      try {
        const res = await Promise.resolve(onSaveProject(draftWithBudget));
        if (res === false || (res && typeof res === 'object' && 'ok' in res && !res.ok)) {
          const errMsg =
            res && typeof res === 'object' && 'error' in res && typeof res.error === 'string' && res.error.trim()
              ? res.error
              : 'Błąd zapisu danych finansowych.';
          setSaveError({
            error: errMsg,
            field: res && typeof res === 'object' && 'field' in res ? res.field : undefined,
          });
          return;
        }
        const newlyPaidTaskIds = collectNewlyPaidTaskIds();
        if (newlyPaidTaskIds.length > 0) {
          onItemsMarkedPaid?.(newlyPaidTaskIds);
        }
        onClose();
      } catch (err: any) {
        setSaveError({
          error: err?.message || 'Nie udało się zapisać danych projektu na serwerze.',
        });
      } finally {
        inFlightSaveRef.current = false;
        setIsSaving(false);
      }
      return;
    }

    onClose();
  };

  const handleRefreshFromConflict = async () => {
    if (conflictState?.currentProject) {
      applyFreshProjectToModal(conflictState.currentProject);
      return;
    }
    try {
      const res = await fetch('/api/state', { credentials: 'same-origin' });
      if (res.ok) {
        const data = await res.json();
        const found = (data?.state?.projects || []).find((p: Project) => p.id === project.id);
        if (found) {
          applyFreshProjectToModal(found);
        }
      }
    } catch {
      // Fallback: clear conflict notice if network failed
    }
  };

  const getCategoryLabel = (cat: CostCategory) => {
    switch (cat) {
      case 'mapa':
        return {
          label: '🗺️ Mapa do celów proj. (MDCP)',
          color: 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800',
        };
      case 'geologia':
        return {
          label: '🧪 Badania geotechniczne i grunt',
          color: 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800',
        };
      case 'uzgodnienia':
        return {
          label: '📋 Uzgodnienia ZUD/PPOŻ/Sanepid',
          color: 'text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/40 border-sky-200 dark:border-sky-800',
        };
      case 'podwykonawca':
        return {
          label: '🏗️ Podwykonawcy branżowi',
          color: 'text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/40 border-purple-200 dark:border-purple-800',
        };
      case 'oplaty_urzedowe':
        return {
          label: '🏛️ Opłaty urzędowe / skarbowe',
          color: 'text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700',
        };
      default:
        return {
          label: '📦 Inne koszty',
          color: 'text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700',
        };
    }
  };

  const quoteToMove = moveQuoteModalId ? quotations.find((q) => q.id === moveQuoteModalId) : null;
  const projectServerError = saveError?.itemType === 'project' ? saveError.error : undefined;

  return (
    <div
      {...backdropProps}
      className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="financials-modal-title"
        className={`bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 relative ${flashClassName}`}
      >
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/70 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-lg bg-sky-700 text-white flex items-center justify-center font-bold text-sm shadow-xs"
              aria-hidden="true"
            >
              {project.key.slice(0, 4)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-sky-700 dark:text-sky-400">
                  {project.key}
                </span>
                {projectCompany && (
                  <span
                    title={`Firma prowadząca: ${projectCompany.name}`}
                    className="font-mono text-[11px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950/70 text-indigo-800 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800"
                  >
                    {projectCompany.letter}
                  </span>
                )}
                {isVatExempt && (
                  <span
                    title={projectCompany?.vatExemptionBasis ? `Podstawa: ${projectCompany.vatExemptionBasis}` : 'Firma zwolniona z VAT'}
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800"
                  >
                    Zwolniona z VAT
                  </span>
                )}
                <h3 id="financials-modal-title" className="text-sm font-bold text-slate-900 dark:text-white">
                  {project.name}
                </h3>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Finanse projektu, płatności zamawiającego, wyceny inwestorskie oraz kosztorys branżowy
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={isSaving}
            onClick={requestClose}
            aria-label="Zamknij finanse projektu"
            className="p-1 rounded text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Read-only notice when user cannot edit finances */}
        {!canEdit && (
          <div
            role="status"
            className="px-6 py-2.5 bg-amber-50 dark:bg-amber-950/50 border-b border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs flex items-center gap-2 font-semibold"
          >
            <Lock className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0" aria-hidden="true" />
            <span>Edycja finansów: administrator i właściciel projektu</span>
          </div>
        )}

        {/* 409 Revision Conflict Alert */}
        {conflictState && (
          <div
            ref={conflictAlertRef}
            role="alert"
            aria-live="assertive"
            tabIndex={-1}
            className="px-6 py-3 bg-amber-50 dark:bg-amber-950/60 border-b border-amber-300 dark:border-amber-800 text-amber-950 dark:text-amber-100 text-xs flex flex-wrap items-center justify-between gap-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0" aria-hidden="true" />
              <span>{conflictState.error}</span>
            </div>
            <button
              type="button"
              onClick={handleRefreshFromConflict}
              className="px-3 py-1.5 rounded bg-amber-700 hover:bg-amber-600 text-white font-semibold flex items-center gap-1.5 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Odśwież dane projektu</span>
            </button>
          </div>
        )}

        {/* General 400 / 403 / Save Error Alert */}
        {saveError && (
          <div
            ref={saveErrorAlertRef}
            role="alert"
            aria-live="assertive"
            tabIndex={-1}
            className="px-6 py-2.5 bg-rose-50 dark:bg-rose-950/50 border-b border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200 text-xs flex items-center justify-between gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-700 dark:text-rose-400 shrink-0" aria-hidden="true" />
              <span>{saveError.error}</span>
            </div>
            <button
              type="button"
              onClick={() => setSaveError(null)}
              aria-label="Zamknij komunikat błędu"
              className="text-rose-700 dark:text-rose-300 hover:underline font-semibold"
            >
              Ukryj
            </button>
          </div>
        )}

        {/* Historical VAT Warning when company is VAT-exempt */}
        {finance.hasHistoricalNonZeroRevenueVat && (
          <div
            role="status"
            className="px-6 py-2.5 bg-amber-50 dark:bg-amber-950/50 border-b border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs flex items-start gap-2"
          >
            <AlertTriangle className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              <strong>Stawka VAT zapisana przed zmianą statusu firmy:</strong> Przychody firmy zwolnionej z VAT są wyliczane bez VAT (ZW, brutto = netto), bez nadpisywania zapisanych historycznie kwot w bazie.
            </span>
          </div>
        )}

        {/* Top Financial Stats Bar */}
        <div className="bg-slate-100/70 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 px-6 py-2.5 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div>
            <span className="text-[11px] text-slate-600 dark:text-slate-400 block">
              {finance.isVatExempt ? 'Wartość Projektu (ZW)' : 'Wartość Projektu (Netto)'}
            </span>
            <span
              data-testid="finance-total-revenue"
              className="font-bold text-slate-900 dark:text-white text-sm font-mono"
            >
              {formatMoney(finance.totalRevenueNet)} PLN
            </span>
            {finance.baseProjectValueNet > 0 && (
              <span className="text-[10px] text-slate-600 dark:text-slate-400 block">
                Umowa: {formatMoney(finance.baseProjectValueNet)} zł
              </span>
            )}
          </div>

          <div>
            <span className="text-[11px] text-slate-600 dark:text-slate-400 block">
              {finance.isVatExempt ? 'Koszt ekonomiczny (brutto, VAT nieodliczalny)' : 'Koszty łączne (Netto)'}
            </span>
            <span
              data-testid="finance-total-costs"
              className="font-bold text-rose-700 dark:text-rose-400 text-sm font-mono"
            >
              {formatMoney(finance.economicTotalCosts)} PLN
            </span>
            <span className="text-[10px] text-slate-600 dark:text-slate-400 block">
              {finance.isVatExempt
                ? `Netto: ${formatMoney(finance.totalCostsNet)} zł · Opłacono: ${formatMoney(finance.paidCostsEconomic)} zł`
                : `Opłacono: ${formatMoney(finance.paidCostsNet)} zł`}
            </span>
          </div>

          <div>
            <span className="text-[11px] text-slate-600 dark:text-slate-400 block">
              {finance.isVatExempt ? 'Bilans (Przychód ZW − Koszt brutto)' : 'Wynik finansowy (Netto)'}
            </span>
            <span
              data-testid="finance-profit-net"
              className={`font-bold text-sm font-mono ${
                finance.profitNet >= 0
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-rose-700 dark:text-rose-400'
              }`}
            >
              {finance.profitNet >= 0 ? '+' : ''}
              {formatMoney(finance.profitNet)} PLN
            </span>
            <span className="text-[10px] text-slate-600 dark:text-slate-400 block">
              Marża: {finance.marginPercent}%
            </span>
          </div>

          <div>
            <span className="text-[11px] text-slate-600 dark:text-slate-400 block">
              Status płatności (Wpłaty)
            </span>
            <div className="flex items-center gap-1.5 pt-0.5">
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                Zapłacono: {formatMoney(finance.paidRevenueNet)} zł
              </span>
            </div>
            {finance.unpaidRevenueNet > 0 && (
              <span className="text-[10px] text-amber-700 dark:text-amber-400 font-semibold block">
                Do zapłaty: {formatMoney(finance.unpaidRevenueNet)} zł
              </span>
            )}
          </div>
        </div>

        {/* Tabs Bar */}
        <div
          role="tablist"
          aria-label="Sekcje finansowe projektu"
          className="flex border-b border-slate-200 dark:border-slate-800 px-6 bg-slate-50/50 dark:bg-slate-900/50 gap-6 text-xs overflow-x-auto"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'quotations'}
            onClick={() => setActiveTab('quotations')}
            className={`py-3 border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'quotations'
                ? 'border-sky-700 text-sky-700 dark:border-sky-500 dark:text-sky-400 font-semibold'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <DollarSign className="w-4 h-4" aria-hidden="true" />
            <span>Wyceny i Oferty ({quotations.length})</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'costs'}
            onClick={() => setActiveTab('costs')}
            className={`py-3 border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'costs'
                ? 'border-sky-700 text-sky-700 dark:border-sky-500 dark:text-sky-400 font-semibold'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Receipt className="w-4 h-4" aria-hidden="true" />
            <span>Lista kosztów i zadania ({costs.length})</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'client'}
            onClick={() => setActiveTab('client')}
            className={`py-3 border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'client'
                ? 'border-sky-700 text-sky-700 dark:border-sky-500 dark:text-sky-400 font-semibold'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Building2 className="w-4 h-4" aria-hidden="true" />
            <span>Zamawiający, Dysk & Terminy</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'summary'}
            onClick={() => setActiveTab('summary')}
            className={`py-3 border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'summary'
                ? 'border-sky-700 text-sky-700 dark:border-sky-500 dark:text-sky-400 font-semibold'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <TrendingUp className="w-4 h-4" aria-hidden="true" />
            <span>Podsumowanie</span>
          </button>
        </div>

        {/* Tab Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5 text-xs">
          {/* TAB 1: WYCENY, WARTOŚĆ PROJEKTU & PŁATNOŚCI ZAMAWIAJĄCEGO */}
          {activeTab === 'quotations' && (
            <div className="space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h4 className="font-bold text-slate-900 dark:text-white text-sm">
                    Wyceny i Oferta dla Zamawiającego
                  </h4>
                  <p className="text-slate-600 dark:text-slate-400 text-xs">
                    Zaznacz znacznik <strong>Wybrana</strong>, aby włączyć ofertę do bilansu projektu.
                  </p>
                </div>
                <div className="text-left sm:text-right bg-sky-50 dark:bg-sky-950/40 p-2.5 rounded-lg border border-sky-200 dark:border-sky-800">
                  <span className="text-[11px] text-sky-800 dark:text-sky-300 block">
                    Przychód z wycen ({selectedQuotations.length} z {quotations.length} ofert):
                  </span>
                  <span className="text-sm font-bold text-sky-700 dark:text-sky-400 font-mono">
                    {finance.isVatExempt
                      ? `${formatMoney(finance.totalQuotationNet)} zł (ZW, bez VAT)`
                      : `${formatMoney(finance.totalQuotationNet)} zł netto (${formatMoney(finance.totalQuotationGross)} zł brutto)`}
                  </span>
                </div>
              </div>

              {/* Base Project Contract Value (Kwota umowy netto i brutto) */}
              <div className="p-3.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                    <div>
                      <span className="font-bold text-slate-800 dark:text-slate-200 text-xs block">
                        Wartość bazowa projektu (kwota umowy głównej)
                      </span>
                      <span className="text-[11px] text-slate-600 dark:text-slate-400">
                        {finance.isVatExempt
                          ? `Firma zwolniona z VAT${finance.vatExemptionBasis ? ` (${finance.vatExemptionBasis})` : ''} — przychody bez VAT (ZW, brutto = netto).`
                          : 'Podstawa przychodu w bilansie projektu. Kwoty netto i brutto przeliczają się z dokładnością do 0,01 zł.'}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-start gap-2.5">
                    <div>
                      <label htmlFor="fin-base-contract" className="block text-[10px] text-slate-600 dark:text-slate-400 mb-0.5">
                        {finance.isVatExempt ? 'Kwota umowy (ZW) PLN' : 'Kwota netto PLN'}
                      </label>
                      <input
                        id="fin-base-contract"
                        type="text"
                        inputMode="decimal"
                        disabled={!canEdit}
                        value={baseNetStr}
                        onChange={(e) => handleBaseNetChange(e.target.value)}
                        onBlur={handleBaseNetBlur}
                        placeholder="0,00"
                        aria-invalid={Boolean(baseNetError || (projectServerError && saveError?.field === 'projectValue'))}
                        aria-describedby={baseNetError ? `${uidPrefix}-base-net-err` : undefined}
                        className="w-36 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1 text-xs text-slate-900 dark:text-white font-mono font-bold text-right disabled:opacity-60"
                      />
                      {baseNetError && (
                        <p id={`${uidPrefix}-base-net-err`} role="alert" className="text-[10px] text-rose-700 dark:text-rose-400 mt-0.5">
                          {baseNetError}
                        </p>
                      )}
                    </div>

                    <div>
                      <label htmlFor="fin-base-contract-gross" className="block text-[10px] text-slate-600 dark:text-slate-400 mb-0.5">
                        {isVatExempt ? 'Kwota brutto (ZW) PLN' : 'Kwota brutto PLN'}
                      </label>
                      <input
                        id="fin-base-contract-gross"
                        type="text"
                        inputMode="decimal"
                        disabled={!canEdit || isVatExempt}
                        value={isVatExempt ? baseNetStr : baseGrossStr}
                        onChange={(e) => handleBaseGrossChange(e.target.value)}
                        onBlur={handleBaseGrossBlur}
                        placeholder="0,00"
                        aria-invalid={Boolean(baseGrossError || (projectServerError && saveError?.field === 'projectValueGross'))}
                        aria-describedby={baseGrossError ? `${uidPrefix}-base-gross-err` : undefined}
                        className="w-36 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1 text-xs text-slate-900 dark:text-white font-mono font-bold text-right disabled:opacity-60"
                      />
                      {baseGrossError && (
                        <p id={`${uidPrefix}-base-gross-err`} role="alert" className="text-[10px] text-rose-700 dark:text-rose-400 mt-0.5">
                          {baseGrossError}
                        </p>
                      )}
                    </div>

                    <div>
                      <label htmlFor="fin-base-vat" className="block text-[10px] text-slate-600 dark:text-slate-400 mb-0.5">
                        Stawka VAT
                      </label>
                      <select
                        id="fin-base-vat"
                        disabled={!canEdit || isVatExempt}
                        value={isVatExempt ? 0 : projectVatRate}
                        onChange={(e) => handleProjectVatRateChange(Number(e.target.value))}
                        className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-900 dark:text-white disabled:opacity-60"
                      >
                        {!hasZeroVatOption && <option value={0}>Zwolniony (ZW, 0%)</option>}
                        {vatRateOptions.map((v) => (
                          <option key={v.id} value={v.value ?? v.rate}>
                            {isVatExempt && (v.value ?? v.rate) === 0 ? 'Zwolniony (ZW, 0%)' : v.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="pt-4">
                      <button
                        type="button"
                        disabled={!canEdit}
                        aria-pressed={isBaseContractPaid}
                        onClick={() => setIsBaseContractPaid(!isBaseContractPaid)}
                        className={`px-2.5 py-1 rounded text-[11px] font-semibold border flex items-center gap-1 transition-colors disabled:opacity-60 ${
                          isBaseContractPaid
                            ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800'
                            : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700'
                        }`}
                      >
                        {isBaseContractPaid ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                        ) : (
                          <Clock className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" aria-hidden="true" />
                        )}
                        <span>{isBaseContractPaid ? 'Umowa opłacona' : 'Umowa nieopłacona'}</span>
                      </button>
                    </div>
                  </div>
                </div>
                {projectServerError && (
                  <p role="alert" className="text-[11px] text-rose-700 dark:text-rose-400 font-semibold">
                    {projectServerError}
                  </p>
                )}
              </div>

              {/* Sekcja Płatności zamawiającego (transze) */}
              <div className="p-4 bg-slate-50/70 dark:bg-slate-800/30 border border-slate-200 dark:border-slate-800 rounded-lg space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h5 className="font-bold text-slate-900 dark:text-white text-xs flex items-center gap-1.5">
                      <Receipt className="w-4 h-4 text-sky-700 dark:text-sky-400" aria-hidden="true" />
                      <span>Płatności zamawiającego</span>
                    </h5>
                    <p className="text-[11px] text-slate-600 dark:text-slate-400">
                      {isVatExempt
                        ? 'Harmonogram transz płatności — firma zwolniona z VAT (ZW, brutto = netto).'
                        : `Harmonogram transz płatności z VAT projektu (${projectVatRate}%).`}
                    </p>
                  </div>
                  <div className="text-xs font-mono bg-white dark:bg-slate-900 px-3 py-1.5 rounded border border-slate-200 dark:border-slate-700">
                    <span className="text-slate-600 dark:text-slate-400 mr-1.5">Zapłacono / Pozostało do zapłaty:</span>
                    <strong className="text-emerald-700 dark:text-emerald-400">
                      {formatMoney(finance.tranchesPaidNet)} zł
                    </strong>
                    <span className="mx-1 text-slate-600 dark:text-slate-400">/</span>
                    <strong className="text-amber-700 dark:text-amber-400">
                      {formatMoney(finance.tranchesRemainingNet)} zł
                    </strong>
                  </div>
                </div>

                {finance.tranchesExceedProjectValue && (
                  <div
                    role="status"
                    className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-[11px] flex items-center gap-2"
                  >
                    <AlertTriangle className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0" aria-hidden="true" />
                    <span>
                      Ostrzeżenie: suma transz ({formatMoney(finance.tranchesTotalNet)} zł netto) przekracza wartość projektu ({formatMoney(finance.totalRevenueNet)} zł netto).
                    </span>
                  </div>
                )}

                <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto bg-white dark:bg-slate-900">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                      <tr>
                        <th scope="col" className="py-2 px-3 font-semibold">Nazwa transzy</th>
                        <th scope="col" className="py-2 px-3 font-semibold text-right">Netto</th>
                        <th scope="col" className="py-2 px-3 font-semibold text-right">Brutto</th>
                        <th scope="col" className="py-2 px-3 font-semibold">Termin płatności</th>
                        <th scope="col" className="py-2 px-3 font-semibold text-center">Status</th>
                        <th scope="col" className="py-2 px-3 font-semibold">Data zapłaty</th>
                        {canEdit && <th scope="col" className="py-2 px-3 font-semibold text-center">Akcje</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {paymentTranches.length === 0 ? (
                        <tr>
                          <td colSpan={canEdit ? 7 : 6} className="py-4 text-center text-slate-600 dark:text-slate-400">
                            Brak zdefiniowanych transz płatności od zamawiającego.
                          </td>
                        </tr>
                      ) : (
                        paymentTranches.map((t) => {
                          const isEditing = canEdit && editingTrancheId === t.id && editTrancheDraft;
                          const overdue = isPaymentOverdue(t.dueDate, t.isPaid);
                          const serverItemErr =
                            saveError?.itemType === 'tranche' && saveError?.itemId === t.id
                              ? saveError.error
                              : undefined;

                          if (isEditing && editTrancheDraft) {
                            return (
                              <tr
                                key={t.id}
                                className="bg-sky-50/50 dark:bg-sky-950/20"
                                onKeyDown={(e) =>
                                  handleInlineRowKeyDown(
                                    e,
                                    () => saveEditTranche(t.id),
                                    cancelEditTranche
                                  )
                                }
                              >
                                <td colSpan={canEdit ? 7 : 6} className="p-3 space-y-2">
                                  <div className="grid grid-cols-1 sm:grid-cols-6 gap-2 items-start">
                                    <div className="sm:col-span-2">
                                      <label htmlFor={`edit-trn-title-${t.id}`} className="block text-[10px] text-slate-600 dark:text-slate-400 mb-0.5">
                                        Nazwa transzy *
                                      </label>
                                      <input
                                        id={`edit-trn-title-${t.id}`}
                                        type="text"
                                        value={editTrancheDraft.title}
                                        onChange={(e) =>
                                          setEditTrancheDraft((prev) =>
                                            prev ? { ...prev, title: e.target.value } : null
                                          )
                                        }
                                        className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2 py-1 text-xs"
                                      />
                                    </div>
                                      <div>
                                        <label htmlFor={`edit-trn-net-${t.id}`} className="block text-[10px] text-slate-600 dark:text-slate-400 mb-0.5">
                                          {isVatExempt ? 'Kwota ZW (zł) *' : 'Netto (zł) *'}
                                        </label>
                                        <input
                                          id={`edit-trn-net-${t.id}`}
                                          type="text"
                                          inputMode="decimal"
                                          value={editTrancheDraft.amountNetStr}
                                          onChange={(e) => {
                                            const raw = e.target.value;
                                            const res = validateMoneyInput(raw, { requiredPositive: true });
                                            setEditTrancheDraft((prev) =>
                                              prev
                                                ? {
                                                    ...prev,
                                                    amountNetStr: raw,
                                                    netError: raw.trim() === '' ? 'Podaj kwotę większą od 0' : res.valid ? undefined : res.error,
                                                    amountGrossStr:
                                                      res.valid && res.value !== null
                                                        ? formatMoney(calcGrossFromNet(res.value, effectiveTrancheVat))
                                                        : prev.amountGrossStr,
                                                    grossError: res.valid ? undefined : prev.grossError,
                                                  }
                                                : null
                                            );
                                          }}
                                          onBlur={() => {
                                            const p = parseMoney(editTrancheDraft.amountNetStr);
                                            if (p !== null) {
                                              setEditTrancheDraft((prev) =>
                                                prev ? { ...prev, amountNetStr: formatMoney(p) } : null
                                              );
                                            }
                                          }}
                                          placeholder="0,00"
                                          aria-invalid={Boolean(editTrancheDraft.netError)}
                                          aria-describedby={editTrancheDraft.netError ? `edit-trn-net-err-${t.id}` : undefined}
                                          className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2 py-1 text-xs font-mono text-right"
                                        />
                                        {editTrancheDraft.netError && (
                                          <p id={`edit-trn-net-err-${t.id}`} role="alert" className="text-[10px] text-rose-700 dark:text-rose-400 mt-0.5">
                                            {editTrancheDraft.netError}
                                          </p>
                                        )}
                                      </div>
                                      <div>
                                        <label htmlFor={`edit-trn-gross-${t.id}`} className="block text-[10px] text-slate-600 dark:text-slate-400 mb-0.5">
                                          {isVatExempt ? 'Brutto (ZW, zł)' : 'Brutto (zł) *'}
                                        </label>
                                        <input
                                          id={`edit-trn-gross-${t.id}`}
                                          type="text"
                                          inputMode="decimal"
                                          disabled={isVatExempt}
                                          value={isVatExempt ? editTrancheDraft.amountNetStr : editTrancheDraft.amountGrossStr}
                                          onChange={(e) => {
                                            if (isVatExempt) return;
                                            const raw = e.target.value;
                                            const res = validateMoneyInput(raw, { requiredPositive: true });
                                            setEditTrancheDraft((prev) =>
                                              prev
                                                ? {
                                                    ...prev,
                                                    amountGrossStr: raw,
                                                    grossError: raw.trim() === '' ? 'Podaj kwotę większą od 0' : res.valid ? undefined : res.error,
                                                    amountNetStr:
                                                      res.valid && res.value !== null
                                                        ? formatMoney(calcNetFromGross(res.value, effectiveTrancheVat))
                                                        : prev.amountNetStr,
                                                    netError: res.valid ? undefined : prev.netError,
                                                  }
                                                : null
                                            );
                                          }}
                                          onBlur={() => {
                                            const p = parseMoney(editTrancheDraft.amountGrossStr);
                                            if (p !== null) {
                                              setEditTrancheDraft((prev) =>
                                                prev ? { ...prev, amountGrossStr: formatMoney(p) } : null
                                              );
                                            }
                                          }}
                                          placeholder="0,00"
                                          aria-invalid={Boolean(editTrancheDraft.grossError)}
                                          aria-describedby={editTrancheDraft.grossError ? `edit-trn-gross-err-${t.id}` : undefined}
                                          className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2 py-1 text-xs font-mono text-right disabled:opacity-60"
                                        />
                                        {editTrancheDraft.grossError && (
                                          <p id={`edit-trn-gross-err-${t.id}`} role="alert" className="text-[10px] text-rose-700 dark:text-rose-400 mt-0.5">
                                            {editTrancheDraft.grossError}
                                          </p>
                                        )}
                                      </div>
                                    <div>
                                      <label htmlFor={`edit-trn-due-${t.id}`} className="block text-[10px] text-slate-600 dark:text-slate-400 mb-0.5">
                                        Termin płatności
                                      </label>
                                      <input
                                        id={`edit-trn-due-${t.id}`}
                                        type="date"
                                        value={editTrancheDraft.dueDate}
                                        onChange={(e) =>
                                          setEditTrancheDraft((prev) =>
                                            prev ? { ...prev, dueDate: e.target.value } : null
                                          )
                                        }
                                        className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2 py-1 text-xs"
                                      />
                                    </div>
                                    <div>
                                      <label htmlFor={`edit-trn-paid-${t.id}`} className="flex items-center gap-1.5 text-[11px] font-semibold mt-4 cursor-pointer">
                                        <input
                                          id={`edit-trn-paid-${t.id}`}
                                          type="checkbox"
                                          checked={editTrancheDraft.isPaid}
                                          onChange={(e) =>
                                            setEditTrancheDraft((prev) =>
                                              prev
                                                ? {
                                                    ...prev,
                                                    isPaid: e.target.checked,
                                                    paidAt: e.target.checked ? prev.paidAt || getTodayIso() : '',
                                                  }
                                                : null
                                            )
                                          }
                                        />
                                        <span>Zapłacona</span>
                                      </label>
                                    </div>
                                  </div>
                                  {editTrancheDraft.isPaid && (
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                                      <div>
                                        <label htmlFor={`edit-trn-paid-at-${t.id}`} className="block text-[10px] text-slate-600 dark:text-slate-400 mb-0.5">
                                          Data zapłaty
                                        </label>
                                        <input
                                          id={`edit-trn-paid-at-${t.id}`}
                                          type="date"
                                          value={editTrancheDraft.paidAt}
                                          onChange={(e) =>
                                            setEditTrancheDraft((prev) =>
                                              prev ? { ...prev, paidAt: e.target.value } : null
                                            )
                                          }
                                          className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2 py-1 text-xs"
                                        />
                                      </div>
                                      <div>
                                        <label htmlFor={`edit-trn-paid-amt-${t.id}`} className="block text-[10px] text-slate-600 dark:text-slate-400 mb-0.5">
                                          Kwota zapłacona netto (opcjonalnie)
                                        </label>
                                        <input
                                          id={`edit-trn-paid-amt-${t.id}`}
                                          type="text"
                                          inputMode="decimal"
                                          value={editTrancheDraft.paidAmountStr}
                                          onChange={(e) => {
                                            const raw = e.target.value;
                                            const res = validateMoneyInput(raw, { allowEmpty: true });
                                            setEditTrancheDraft((prev) =>
                                              prev
                                                ? {
                                                    ...prev,
                                                    paidAmountStr: raw,
                                                    paidAmountError: res.valid ? undefined : res.error,
                                                  }
                                                : null
                                            );
                                          }}
                                          onBlur={() => {
                                            const p = parseMoney(editTrancheDraft.paidAmountStr);
                                            if (editTrancheDraft.paidAmountStr.trim() !== '' && p !== null) {
                                              setEditTrancheDraft((prev) =>
                                                prev ? { ...prev, paidAmountStr: formatMoney(p) } : null
                                              );
                                            }
                                          }}
                                          placeholder="0,00"
                                          aria-invalid={Boolean(editTrancheDraft.paidAmountError)}
                                          aria-describedby={editTrancheDraft.paidAmountError ? `edit-trn-paid-amt-err-${t.id}` : undefined}
                                          className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2 py-1 text-xs font-mono text-right"
                                        />
                                        {editTrancheDraft.paidAmountError && (
                                          <p id={`edit-trn-paid-amt-err-${t.id}`} role="alert" className="text-[10px] text-rose-700 dark:text-rose-400 mt-0.5">
                                            {editTrancheDraft.paidAmountError}
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                  <div className="flex justify-end gap-2">
                                    <button
                                      type="button"
                                      onClick={cancelEditTranche}
                                      className="px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 text-[11px]"
                                    >
                                      Anuluj
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => saveEditTranche(t.id)}
                                      className="px-3 py-1 rounded bg-sky-700 hover:bg-sky-800 text-white font-semibold text-[11px]"
                                    >
                                      Zapisz wiersz
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          }

                          return (
                            <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                              <td className="py-2 px-3 font-medium text-slate-900 dark:text-slate-100">
                                <span>{t.title}</span>
                                {serverItemErr && (
                                  <p role="alert" className="text-[10px] text-rose-700 dark:text-rose-400 mt-0.5">
                                    {serverItemErr}
                                  </p>
                                )}
                              </td>
                              <td className="py-2 px-3 text-right font-mono font-bold text-slate-900 dark:text-slate-100">
                                {formatMoney(t.amountNet)} zł
                              </td>
                              <td className="py-2 px-3 text-right font-mono text-slate-600 dark:text-slate-400">
                                {isVatExempt ? `${formatMoney(t.amountNet)} zł (ZW)` : `${formatMoney(t.amountGross)} zł`}
                              </td>
                              <td className="py-2 px-3 whitespace-nowrap font-mono text-[11px]">
                                {t.dueDate ? (
                                  <div className="flex items-center gap-1.5">
                                    <span>{t.dueDate}</span>
                                    {overdue && (
                                      <span className="px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800 text-[10px] font-bold">
                                        po terminie
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-slate-600 dark:text-slate-400">—</span>
                                )}
                              </td>
                              <td className="py-2 px-3 text-center">
                                <button
                                  type="button"
                                  disabled={!canEdit}
                                  aria-pressed={t.isPaid}
                                  onClick={() => handleToggleTranchePaid(t.id)}
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border disabled:opacity-60 ${
                                    t.isPaid
                                      ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                                      : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700'
                                  }`}
                                >
                                  {t.isPaid ? 'Zapłacona' : 'Oczekuje'}
                                </button>
                              </td>
                              <td className="py-2 px-3 font-mono text-[11px] text-slate-600 dark:text-slate-400">
                                {t.isPaid && t.paidAt ? t.paidAt : '—'}
                              </td>
                              {canEdit && (
                                <td className="py-2 px-3 text-center whitespace-nowrap">
                                  {confirmDeleteTrancheId === t.id ? (
                                    <div className="inline-flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteTranche(t.id)}
                                        className="px-2 py-0.5 rounded bg-rose-700 text-white text-[10px] font-semibold"
                                      >
                                        Potwierdź
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setConfirmDeleteTrancheId(null)}
                                        className="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-[10px]"
                                      >
                                        Anuluj
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="inline-flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => startEditTranche(t)}
                                        aria-label={`Edytuj transzę ${t.title}`}
                                        className="px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px]"
                                      >
                                        Edytuj
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setConfirmDeleteTrancheId(t.id)}
                                        aria-label={`Usuń transzę ${t.title}`}
                                        className="px-2 py-0.5 rounded border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-[11px]"
                                      >
                                        Usuń
                                      </button>
                                    </div>
                                  )}
                                </td>
                              )}
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {canEdit && (
                  <form onSubmit={handleAddTranche} className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg space-y-2">
                    <span className="font-semibold text-slate-800 dark:text-slate-200 block text-[11px]">
                      + Dodaj transzę płatności od zamawiającego
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-6 gap-2 items-start">
                      <div className="sm:col-span-2">
                        <label htmlFor="fin-tranche-title" className="block text-[10px] text-slate-600 dark:text-slate-400 mb-0.5">
                          Nazwa transzy *
                        </label>
                        <input
                          id="fin-tranche-title"
                          type="text"
                          value={newTrancheTitle}
                          onChange={(e) => setNewTrancheTitle(e.target.value)}
                          placeholder="np. Zaliczka 30% / Etap PZT"
                          className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2.5 py-1 text-xs"
                        />
                      </div>
                      <div>
                        <label htmlFor="fin-tranche-net" className="block text-[10px] text-slate-600 dark:text-slate-400 mb-0.5">
                          {isVatExempt ? 'Kwota ZW (zł) *' : 'Kwota netto (zł) *'}
                        </label>
                        <input
                          id="fin-tranche-net"
                          type="text"
                          inputMode="decimal"
                          value={newTrancheNetStr}
                          onChange={(e) => handleNewTrancheNetChange(e.target.value)}
                          onBlur={handleNewTrancheNetBlur}
                          placeholder="0,00"
                          aria-invalid={Boolean(newTrancheNetError)}
                          aria-describedby={newTrancheNetError ? `${uidPrefix}-trn-net-err` : undefined}
                          className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2.5 py-1 text-xs font-mono text-right"
                        />
                        {newTrancheNetError && (
                          <p id={`${uidPrefix}-trn-net-err`} role="alert" className="text-[10px] text-rose-700 dark:text-rose-400 mt-0.5">
                            {newTrancheNetError}
                          </p>
                        )}
                      </div>
                      <div>
                        <label htmlFor="fin-tranche-gross" className="block text-[10px] text-slate-600 dark:text-slate-400 mb-0.5">
                          {isVatExempt ? 'Kwota brutto (ZW, zł)' : 'Kwota brutto (zł)'}
                        </label>
                        <input
                          id="fin-tranche-gross"
                          type="text"
                          inputMode="decimal"
                          disabled={isVatExempt}
                          value={isVatExempt ? newTrancheNetStr : newTrancheGrossStr}
                          onChange={(e) => handleNewTrancheGrossChange(e.target.value)}
                          onBlur={handleNewTrancheGrossBlur}
                          placeholder="0,00"
                          aria-invalid={Boolean(newTrancheGrossError)}
                          aria-describedby={newTrancheGrossError ? `${uidPrefix}-trn-gross-err` : undefined}
                          className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2.5 py-1 text-xs font-mono text-right disabled:opacity-60"
                        />
                        {newTrancheGrossError && (
                          <p id={`${uidPrefix}-trn-gross-err`} role="alert" className="text-[10px] text-rose-700 dark:text-rose-400 mt-0.5">
                            {newTrancheGrossError}
                          </p>
                        )}
                      </div>
                      <div>
                        <label htmlFor="fin-tranche-due" className="block text-[10px] text-slate-600 dark:text-slate-400 mb-0.5">
                          Termin płatności
                        </label>
                        <input
                          id="fin-tranche-due"
                          type="date"
                          value={newTrancheDueDate}
                          onChange={(e) => setNewTrancheDueDate(e.target.value)}
                          className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2 py-1 text-xs"
                        />
                      </div>
                      <div className="pt-4">
                        <button
                          type="submit"
                          disabled={!canSubmitNewTranche}
                          className="w-full py-1 px-3 bg-sky-700 hover:bg-sky-800 disabled:opacity-40 text-white rounded font-medium text-xs"
                        >
                          Dodaj transzę
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-4 pt-1">
                      <label htmlFor="fin-tranche-paid-check" className="flex items-center gap-1.5 cursor-pointer text-[11px] font-semibold">
                        <input
                          id="fin-tranche-paid-check"
                          type="checkbox"
                          checked={newTrancheIsPaid}
                          onChange={(e) => {
                            setNewTrancheIsPaid(e.target.checked);
                            if (e.target.checked && !newTranchePaidAt) {
                              setNewTranchePaidAt(getTodayIso());
                            }
                          }}
                        />
                        <span>Zapłacona</span>
                      </label>
                      {newTrancheIsPaid && (
                        <>
                          <div className="flex items-center gap-1.5">
                            <label htmlFor="fin-tranche-paid-at" className="text-[10px] text-slate-600 dark:text-slate-400">
                              Data zapłaty:
                            </label>
                            <input
                              id="fin-tranche-paid-at"
                              type="date"
                              value={newTranchePaidAt}
                              onChange={(e) => setNewTranchePaidAt(e.target.value)}
                              className="border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2 py-0.5 text-xs"
                            />
                          </div>
                          <div className="flex items-center gap-1.5">
                            <label htmlFor="fin-tranche-paid-amt" className="text-[10px] text-slate-600 dark:text-slate-400">
                              Kwota zapłacona netto (opcjonalnie):
                            </label>
                            <input
                              id="fin-tranche-paid-amt"
                              type="text"
                              inputMode="decimal"
                              value={newTranchePaidAmountStr}
                              onChange={(e) => handleNewTranchePaidAmountChange(e.target.value)}
                              onBlur={handleNewTranchePaidAmountBlur}
                              placeholder="0,00"
                              aria-invalid={Boolean(newTranchePaidAmountError)}
                              aria-describedby={newTranchePaidAmountError ? `${uidPrefix}-trn-paid-err` : undefined}
                              className="w-28 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2 py-0.5 text-xs font-mono text-right"
                            />
                            {newTranchePaidAmountError && (
                              <span id={`${uidPrefix}-trn-paid-err`} role="alert" className="text-[10px] text-rose-700 dark:text-rose-400">
                                {newTranchePaidAmountError}
                              </span>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </form>
                )}
              </div>

              {/* Table of quotation items */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                    <tr>
                      <th scope="col" className="py-2.5 px-2.5 font-semibold text-center">Do bilansu</th>
                      <th scope="col" className="py-2.5 px-2.5 font-semibold text-center">Zapłacono</th>
                      <th scope="col" className="py-2.5 px-2.5 font-semibold text-center">Rodzaj</th>
                      <th scope="col" className="py-2.5 px-2.5 font-semibold">Nazwa wyceny / zakres</th>
                      <th scope="col" className="py-2.5 px-2.5 font-semibold">Firma / Oferent</th>
                      <th scope="col" className="py-2.5 px-2.5 font-semibold">Ilość</th>
                      <th scope="col" className="py-2.5 px-2.5 font-semibold text-center">Typ & VAT</th>
                      <th scope="col" className="py-2.5 px-2.5 font-semibold">Termin płatności</th>
                      <th scope="col" className="py-2.5 px-2.5 font-semibold text-right">Netto</th>
                      <th scope="col" className="py-2.5 px-2.5 font-semibold text-right">Brutto</th>
                      <th scope="col" className="py-2.5 px-2.5 font-semibold text-center">Akcje</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900">
                    {quotations.length === 0 ? (
                      <tr>
                        <td colSpan={11} className="py-6 text-center text-slate-600 dark:text-slate-400">
                          Brak pozycji wyceny. Wypełnij poniższy formularz i dodaj pierwszą pozycję.
                        </td>
                      </tr>
                    ) : (
                      quotations.map((q) => {
                        const isSelected = q.isSelected !== false;
                        const isCost = q.type === 'koszt';
                        const isLinked = Boolean(q.linkedCostId);
                        const overdue = isPaymentOverdue(q.dueDate, q.isPaid);
                        const isEditing = canEdit && editingQuoteId === q.id && editQuoteDraft;
                        const serverItemErr =
                          saveError?.itemType === 'quotation' && saveError?.itemId === q.id
                            ? saveError.error
                            : undefined;

                        if (isEditing && editQuoteDraft) {
                          return (
                            <tr
                              key={q.id}
                              className="bg-sky-50/50 dark:bg-sky-950/20"
                              onKeyDown={(e) =>
                                handleInlineRowKeyDown(
                                  e,
                                  () => saveEditQuotation(q.id),
                                  cancelEditQuotation
                                )
                              }
                            >
                              <td colSpan={11} className="p-3 space-y-2">
                                <div className="grid grid-cols-1 sm:grid-cols-6 gap-2 items-start">
                                  <div>
                                    <label htmlFor={`edit-q-dir-${q.id}`} className="block text-[10px] text-slate-600 dark:text-slate-400 mb-0.5">
                                      Rodzaj
                                    </label>
                                    <select
                                      id={`edit-q-dir-${q.id}`}
                                      value={editQuoteDraft.type}
                                      onChange={(e) => {
                                        const dir = e.target.value as 'przychod' | 'koszt';
                                        setEditQuoteDraft((prev) => {
                                          if (!prev) return null;
                                          if (isVatExempt && dir === 'przychod') {
                                            return { ...prev, type: dir, taxType: 'zwolniony', vatRate: 0 };
                                          }
                                          if (isVatExempt && dir === 'koszt' && prev.taxType === 'zwolniony') {
                                            return { ...prev, type: dir, taxType: 'netto', vatRate: defaultVarVatRate };
                                          }
                                          return { ...prev, type: dir };
                                        });
                                      }}
                                      className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2 py-1 text-xs"
                                    >
                                      <option value="przychod">Przychód (+)</option>
                                      <option value="koszt">Koszt (-)</option>
                                    </select>
                                  </div>
                                  <div className="sm:col-span-2">
                                    <label htmlFor={`edit-q-title-${q.id}`} className="block text-[10px] text-slate-600 dark:text-slate-400 mb-0.5">
                                      Nazwa wyceny *
                                    </label>
                                    <input
                                      id={`edit-q-title-${q.id}`}
                                      type="text"
                                      value={editQuoteDraft.title}
                                      onChange={(e) =>
                                        setEditQuoteDraft((prev) =>
                                          prev ? { ...prev, title: e.target.value } : null
                                        )
                                      }
                                      className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2 py-1 text-xs"
                                    />
                                  </div>
                                  <div>
                                    <label htmlFor={`edit-q-comp-${q.id}`} className="block text-[10px] text-slate-600 dark:text-slate-400 mb-0.5">
                                      Firma / Oferent
                                    </label>
                                    <input
                                      id={`edit-q-comp-${q.id}`}
                                      type="text"
                                      value={editQuoteDraft.companyName}
                                      onChange={(e) =>
                                        setEditQuoteDraft((prev) =>
                                          prev ? { ...prev, companyName: e.target.value } : null
                                        )
                                      }
                                      className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2 py-1 text-xs"
                                    />
                                  </div>
                                  <div>
                                    <label htmlFor={`edit-q-qty-${q.id}`} className="block text-[10px] text-slate-600 dark:text-slate-400 mb-0.5">
                                      Ilość i jedn.
                                    </label>
                                    <div className="flex gap-1">
                                      <input
                                        id={`edit-q-qty-${q.id}`}
                                        type="text"
                                        inputMode="decimal"
                                        value={editQuoteDraft.quantityStr}
                                        onChange={(e) => {
                                          const raw = e.target.value;
                                          const res = validateQuantityInput(raw);
                                          setEditQuoteDraft((prev) =>
                                            prev
                                              ? {
                                                  ...prev,
                                                  quantityStr: raw,
                                                  quantityError: res.valid ? undefined : res.error,
                                                }
                                              : null
                                          );
                                        }}
                                        onBlur={() => {
                                          const p = parseQuantity(editQuoteDraft.quantityStr);
                                          if (p !== null) {
                                            setEditQuoteDraft((prev) =>
                                              prev ? { ...prev, quantityStr: formatQuantity(p) } : null
                                            );
                                          }
                                        }}
                                        aria-invalid={Boolean(editQuoteDraft.quantityError)}
                                        aria-describedby={editQuoteDraft.quantityError ? `edit-q-qty-err-${q.id}` : undefined}
                                        className="w-20 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2 py-1 text-xs font-mono text-right"
                                      />
                                      <input
                                        type="text"
                                        aria-label="Jednostka"
                                        value={editQuoteDraft.unit}
                                        onChange={(e) =>
                                          setEditQuoteDraft((prev) =>
                                            prev ? { ...prev, unit: e.target.value } : null
                                          )
                                        }
                                        className="w-14 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2 py-1 text-xs text-center"
                                      />
                                    </div>
                                    {editQuoteDraft.quantityError && (
                                      <p id={`edit-q-qty-err-${q.id}`} role="alert" className="text-[10px] text-rose-700 dark:text-rose-400 mt-0.5">
                                        {editQuoteDraft.quantityError}
                                      </p>
                                    )}
                                  </div>
                                  <div>
                                    <label htmlFor={`edit-q-price-${q.id}`} className="block text-[10px] text-slate-600 dark:text-slate-400 mb-0.5">
                                      Cena jedn. (zł) *
                                    </label>
                                    <input
                                      id={`edit-q-price-${q.id}`}
                                      type="text"
                                      inputMode="decimal"
                                      value={editQuoteDraft.priceStr}
                                      onChange={(e) => {
                                        const raw = e.target.value;
                                        const res = validateMoneyInput(raw, { requiredPositive: true });
                                        setEditQuoteDraft((prev) =>
                                          prev
                                            ? {
                                                ...prev,
                                                priceStr: raw,
                                                priceError: res.valid ? undefined : res.error,
                                              }
                                            : null
                                        );
                                      }}
                                      onBlur={() => {
                                        const p = parseMoney(editQuoteDraft.priceStr);
                                        if (p !== null) {
                                          setEditQuoteDraft((prev) =>
                                            prev ? { ...prev, priceStr: formatMoney(p) } : null
                                          );
                                        }
                                      }}
                                      placeholder="0,00"
                                      aria-invalid={Boolean(editQuoteDraft.priceError)}
                                      aria-describedby={editQuoteDraft.priceError ? `edit-q-price-err-${q.id}` : undefined}
                                      className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2 py-1 text-xs font-mono text-right"
                                    />
                                    {editQuoteDraft.priceError && (
                                      <p id={`edit-q-price-err-${q.id}`} role="alert" className="text-[10px] text-rose-700 dark:text-rose-400 mt-0.5">
                                        {editQuoteDraft.priceError}
                                      </p>
                                    )}
                                  </div>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-6 gap-2 items-end">
                                  <div>
                                    <label htmlFor={`edit-q-tax-${q.id}`} className="block text-[10px] text-slate-600 dark:text-slate-400 mb-0.5">
                                      Podstawa
                                    </label>
                                    <select
                                      id={`edit-q-tax-${q.id}`}
                                      disabled={isVatExempt && editQuoteDraft.type === 'przychod'}
                                      value={
                                        isVatExempt && editQuoteDraft.type === 'przychod'
                                          ? 'zwolniony'
                                          : editQuoteDraft.taxType
                                      }
                                      onChange={(e) =>
                                        setEditQuoteDraft((prev) =>
                                          prev
                                            ? { ...prev, taxType: e.target.value as 'netto' | 'brutto' | 'zwolniony' }
                                            : null
                                        )
                                      }
                                      className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2 py-1 text-xs disabled:opacity-50"
                                    >
                                      <option value="netto">Netto</option>
                                      <option value="brutto">Brutto</option>
                                      <option value="zwolniony">Zwolniony</option>
                                    </select>
                                  </div>
                                  <div>
                                    <label htmlFor={`edit-q-vat-${q.id}`} className="block text-[10px] text-slate-600 dark:text-slate-400 mb-0.5">
                                      VAT
                                    </label>
                                    <select
                                      id={`edit-q-vat-${q.id}`}
                                      disabled={
                                        (isVatExempt && editQuoteDraft.type === 'przychod') ||
                                        editQuoteDraft.taxType === 'zwolniony'
                                      }
                                      value={
                                        (isVatExempt && editQuoteDraft.type === 'przychod') ||
                                        editQuoteDraft.taxType === 'zwolniony'
                                          ? 0
                                          : editQuoteDraft.vatRate
                                      }
                                      onChange={(e) =>
                                        setEditQuoteDraft((prev) =>
                                          prev ? { ...prev, vatRate: Number(e.target.value) } : null
                                        )
                                      }
                                      className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2 py-1 text-xs disabled:opacity-50"
                                    >
                                      {!hasZeroVatOption && <option value={0}>Zwolniony (0%)</option>}
                                      {vatRateOptions.map((v) => (
                                        <option key={v.id} value={v.value}>
                                          {v.label} ({v.value}%)
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                  <div>
                                    <label htmlFor={`edit-q-due-${q.id}`} className="block text-[10px] text-slate-600 dark:text-slate-400 mb-0.5">
                                      Termin płatności
                                    </label>
                                    <input
                                      id={`edit-q-due-${q.id}`}
                                      type="date"
                                      value={editQuoteDraft.dueDate}
                                      onChange={(e) =>
                                        setEditQuoteDraft((prev) =>
                                          prev ? { ...prev, dueDate: e.target.value } : null
                                        )
                                      }
                                      className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2 py-1 text-xs"
                                    />
                                  </div>
                                  <div>
                                    <label htmlFor={`edit-q-paidamt-${q.id}`} className="block text-[10px] text-slate-600 dark:text-slate-400 mb-0.5">
                                      Kwota zapłacona (zł)
                                    </label>
                                    <input
                                      id={`edit-q-paidamt-${q.id}`}
                                      type="text"
                                      inputMode="decimal"
                                      value={editQuoteDraft.paidAmountStr}
                                      onChange={(e) => {
                                        const raw = e.target.value;
                                        const res = validateMoneyInput(raw, { allowEmpty: true });
                                        setEditQuoteDraft((prev) =>
                                          prev
                                            ? {
                                                ...prev,
                                                paidAmountStr: raw,
                                                paidAmountError: res.valid ? undefined : res.error,
                                              }
                                            : null
                                        );
                                      }}
                                      onBlur={() => {
                                        const p = parseMoney(editQuoteDraft.paidAmountStr);
                                        if (editQuoteDraft.paidAmountStr.trim() !== '' && p !== null) {
                                          setEditQuoteDraft((prev) =>
                                            prev ? { ...prev, paidAmountStr: formatMoney(p) } : null
                                          );
                                        }
                                      }}
                                      placeholder="0,00"
                                      aria-invalid={Boolean(editQuoteDraft.paidAmountError)}
                                      aria-describedby={editQuoteDraft.paidAmountError ? `edit-q-paidamt-err-${q.id}` : undefined}
                                      className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2 py-1 text-xs font-mono text-right"
                                    />
                                    {editQuoteDraft.paidAmountError && (
                                      <p id={`edit-q-paidamt-err-${q.id}`} role="alert" className="text-[10px] text-rose-700 dark:text-rose-400 mt-0.5">
                                        {editQuoteDraft.paidAmountError}
                                      </p>
                                    )}
                                  </div>
                                  <div className="sm:col-span-2 flex justify-end gap-2">
                                    <button
                                      type="button"
                                      onClick={cancelEditQuotation}
                                      className="px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 text-[11px]"
                                    >
                                      Anuluj
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => saveEditQuotation(q.id)}
                                      className="px-3 py-1 rounded bg-sky-700 hover:bg-sky-800 text-white font-semibold text-[11px]"
                                    >
                                      Zapisz wiersz
                                    </button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          );
                        }

                        return (
                          <tr
                            key={q.id}
                            className={`transition-colors ${
                              isSelected
                                ? 'bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                                : 'bg-slate-50/60 dark:bg-slate-950/40 opacity-75 hover:opacity-100'
                            }`}
                          >
                            <td className="py-2 px-2.5 text-center">
                              <button
                                type="button"
                                disabled={!canEdit}
                                aria-pressed={isSelected}
                                onClick={() => handleToggleSelectQuotation(q.id)}
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border transition-colors disabled:opacity-60 ${
                                  isSelected
                                    ? isCost
                                      ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-700'
                                      : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700'
                                }`}
                              >
                                {isSelected ? (
                                  <>
                                    <CheckSquare className={`w-3.5 h-3.5 ${isCost ? 'text-rose-700 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400'}`} aria-hidden="true" />
                                    <span>Wybrana</span>
                                  </>
                                ) : (
                                  <>
                                    <Square className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" aria-hidden="true" />
                                    <span>Opcja (poza)</span>
                                  </>
                                )}
                              </button>
                            </td>
                            <td className="py-2 px-2.5 text-center">
                              <button
                                type="button"
                                disabled={!canEdit}
                                aria-pressed={Boolean(q.isPaid)}
                                onClick={() => handleToggleQuotationPaid(q.id)}
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border transition-colors disabled:opacity-60 ${
                                  q.isPaid
                                    ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700'
                                }`}
                              >
                                {q.isPaid ? (
                                  <CheckCircle2 className="w-3 h-3 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                                ) : (
                                  <Clock className="w-3 h-3 text-slate-600 dark:text-slate-400" aria-hidden="true" />
                                )}
                                <span>{q.isPaid ? 'Zapłacono' : 'Czeka'}</span>
                              </button>
                            </td>
                            <td className="py-2 px-2.5 text-center">
                              <span
                                className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                  isCost
                                    ? 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800'
                                    : 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
                                }`}
                              >
                                {isCost ? '📉 Koszt (-)' : '📈 Przychód (+)'}
                              </span>
                            </td>
                            <td className="py-2 px-2.5 font-medium text-slate-900 dark:text-slate-100">
                              <div>{q.title}</div>
                              {isLinked && q.linkedCostId && (
                                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-950/60 text-purple-800 dark:text-purple-200 border border-purple-300 dark:border-purple-800 text-[10px] font-bold">
                                    Wybrana oferta (w kosztach)
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleJumpToLinkedCost(q.linkedCostId!)}
                                    className="inline-flex items-center gap-0.5 text-[10px] text-sky-700 dark:text-sky-400 hover:underline font-semibold"
                                  >
                                    <span>Pokaż koszt</span>
                                    <ExternalLink className="w-3 h-3" aria-hidden="true" />
                                  </button>
                                </div>
                              )}
                              {q.notes && (
                                <span className="block text-[10px] text-slate-600 dark:text-slate-400">{q.notes}</span>
                              )}
                              {serverItemErr && (
                                <p role="alert" className="text-[10px] text-rose-700 dark:text-rose-400 mt-0.5">
                                  {serverItemErr}
                                </p>
                              )}
                            </td>
                            <td className="py-2 px-2.5 text-slate-600 dark:text-slate-400">
                              <span className="inline-block px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded font-medium text-[11px] text-slate-700 dark:text-slate-300">
                                {q.companyName || '—'}
                              </span>
                            </td>
                            <td className="py-2 px-2.5 text-slate-600 dark:text-slate-400 whitespace-nowrap font-mono">
                              {formatQuantity(q.quantity)} {q.unit}
                            </td>
                            <td className="py-2 px-2.5 text-center">
                              <span className="inline-block px-1.5 py-0.5 rounded text-[10px] uppercase font-mono font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                {isVatExempt && !isCost
                                  ? 'ZW (0%)'
                                  : q.taxType === 'zwolniony'
                                    ? 'ZW (0%)'
                                    : `${q.taxType || 'netto'} ${q.vatRate}%`}
                              </span>
                            </td>
                            <td className="py-2 px-2.5 whitespace-nowrap font-mono text-[11px]">
                              {q.dueDate ? (
                                <div className="flex items-center gap-1">
                                  <span>{q.dueDate}</span>
                                  {overdue && (
                                    <span className="px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800 text-[10px] font-bold">
                                      po terminie
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-slate-600 dark:text-slate-400">—</span>
                              )}
                            </td>
                            <td
                              className={`py-2 px-2.5 text-right font-mono font-bold whitespace-nowrap ${
                                isCost ? 'text-rose-700 dark:text-rose-400' : 'text-slate-900 dark:text-slate-100'
                              }`}
                            >
                              {isCost ? '-' : '+'}
                              {formatMoney(q.totalNet)} zł
                            </td>
                            <td className="py-2 px-2.5 text-right font-mono text-slate-600 dark:text-slate-400 whitespace-nowrap">
                              {isVatExempt && !isCost
                                ? `${formatMoney(q.totalNet)} zł (ZW)`
                                : `${formatMoney(q.totalGross)} zł`}
                            </td>
                            <td className="py-2 px-2.5 text-center whitespace-nowrap">
                              {canEdit ? (
                                <div className="flex flex-col items-center gap-1">
                                  {confirmDeleteQuoteId === q.id ? (
                                    <div className="inline-flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteQuotation(q.id)}
                                        className="px-2 py-0.5 rounded bg-rose-700 text-white text-[10px] font-semibold"
                                      >
                                        Potwierdź
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setConfirmDeleteQuoteId(null)}
                                        className="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-[10px]"
                                      >
                                        Anuluj
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="inline-flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => startEditQuotation(q)}
                                        aria-label={`Edytuj wycenę ${q.title}`}
                                        className="px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] inline-flex items-center gap-1"
                                      >
                                        <Edit3 className="w-3 h-3" aria-hidden="true" />
                                        <span>Edytuj</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setConfirmDeleteQuoteId(q.id)}
                                        aria-label={`Usuń wycenę ${q.title}`}
                                        className="px-2 py-0.5 rounded border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-[11px] inline-flex items-center gap-1"
                                      >
                                        <Trash2 className="w-3 h-3" aria-hidden="true" />
                                        <span>Usuń</span>
                                      </button>
                                    </div>
                                  )}

                                  {isCost && !isLinked && (
                                    <button
                                      type="button"
                                      onClick={() => openMoveQuoteModal(q.id)}
                                      className="px-2 py-0.5 rounded bg-purple-50 dark:bg-purple-950/50 border border-purple-300 dark:border-purple-800 text-purple-800 dark:text-purple-200 hover:bg-purple-100 dark:hover:bg-purple-900/60 text-[10px] font-semibold inline-flex items-center gap-1"
                                    >
                                      <ArrowRightLeft className="w-3 h-3" aria-hidden="true" />
                                      <span>Przenieś do kosztów</span>
                                    </button>
                                  )}

                                  {isCost && isLinked && (
                                    confirmUndoMoveQuoteId === q.id ? (
                                      <div className="inline-flex items-center gap-1">
                                        <button
                                          type="button"
                                          onClick={() => handleUndoMoveQuoteToCost(q.id)}
                                          className="px-2 py-0.5 rounded bg-purple-700 text-white text-[10px] font-semibold"
                                        >
                                          Potwierdź cofnięcie
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setConfirmUndoMoveQuoteId(null)}
                                          className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-600 text-[10px]"
                                        >
                                          Anuluj
                                        </button>
                                      </div>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => setConfirmUndoMoveQuoteId(q.id)}
                                        className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 text-[10px] font-semibold inline-flex items-center gap-1"
                                      >
                                        <Undo2 className="w-3 h-3" aria-hidden="true" />
                                        <span>Cofnij przeniesienie</span>
                                      </button>
                                    )
                                  )}
                                </div>
                              ) : (
                                <span className="text-[10px] text-slate-600 dark:text-slate-400">Tylko odczyt</span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Add quotation item form */}
              {canEdit && (
                <form
                  onSubmit={handleAddQuotation}
                  className="p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <span className="font-bold text-slate-800 dark:text-slate-200 block text-xs">
                      + Dodaj nową pozycję oferty / wyceny
                    </span>
                    <div className="flex items-center gap-4">
                      <label
                        htmlFor="fin-quote-selected"
                        className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-emerald-700 dark:text-emerald-400"
                      >
                        <input
                          id="fin-quote-selected"
                          type="checkbox"
                          checked={newQuoteIsSelected}
                          onChange={(e) => setNewQuoteIsSelected(e.target.checked)}
                          className="rounded border-slate-300 text-emerald-700 focus:ring-emerald-500"
                        />
                        <span>Wybrana (uwzględnij w bilansie projektu)</span>
                      </label>
                      <label
                        htmlFor="fin-quote-paid"
                        className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-slate-700 dark:text-slate-300"
                      >
                        <input
                          id="fin-quote-paid"
                          type="checkbox"
                          checked={newQuoteIsPaid}
                          onChange={(e) => setNewQuoteIsPaid(e.target.checked)}
                          className="rounded border-slate-300"
                        />
                        <span>Zapłacono</span>
                      </label>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
                    <div className="sm:col-span-2">
                      <label htmlFor="fin-quote-direction" className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                        Kierunek pozycji (Przychód / Koszt) *
                      </label>
                      <select
                        id="fin-quote-direction"
                        value={newQuoteDirection}
                        onChange={(e) => {
                          const dir = e.target.value as 'przychod' | 'koszt';
                          setNewQuoteDirection(dir);
                          if (isVatExempt) {
                            if (dir === 'przychod') {
                              setNewQuoteTaxType('zwolniony');
                              setNewQuoteVatRate(0);
                            } else {
                              setNewQuoteTaxType('netto');
                              setNewQuoteVatRate(defaultVarVatRate);
                            }
                          }
                        }}
                        className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white font-semibold"
                      >
                        <option value="przychod">📈 Przychód: Wycena dla Inwestora</option>
                        <option value="koszt">📉 Koszt: Oferta podwykonawcy / branżysty</option>
                      </select>
                    </div>

                    <div className="sm:col-span-2">
                      <label htmlFor="fin-quote-title" className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                        Nazwa wyceny / zakresu *
                      </label>
                      <input
                        id="fin-quote-title"
                        type="text"
                        required
                        value={newQuoteTitle}
                        onChange={(e) => setNewQuoteTitle(e.target.value)}
                        placeholder="np. Koncepcja & Projekt Budowlany PAB"
                        className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label htmlFor="fin-quote-company" className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                        Firma / Oferent
                      </label>
                      <input
                        id="fin-quote-company"
                        type="text"
                        value={newQuoteCompany}
                        onChange={(e) => setNewQuoteCompany(e.target.value)}
                        placeholder="np. Biuro Projektowe Architekci Sp. p."
                        className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 pt-1 items-start">
                    <div>
                      <label htmlFor="fin-quote-quantity" className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                        Ilość i jedn.
                      </label>
                      <div className="flex gap-1">
                        <input
                          id="fin-quote-quantity"
                          type="text"
                          inputMode="decimal"
                          aria-label="Ilość"
                          value={newQuoteQuantityStr}
                          onChange={(e) => handleNewQuoteQtyChange(e.target.value)}
                          onBlur={handleNewQuoteQtyBlur}
                          aria-invalid={Boolean(newQuoteQuantityError)}
                          aria-describedby={newQuoteQuantityError ? `${uidPrefix}-q-qty-err` : undefined}
                          className="w-20 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2 py-1.5 text-xs text-slate-900 dark:text-white font-mono text-right"
                        />
                        <input
                          id="fin-quote-unit"
                          type="text"
                          aria-label="Jednostka miary"
                          value={newQuoteUnit}
                          onChange={(e) => setNewQuoteUnit(e.target.value)}
                          placeholder="kpl"
                          className="w-16 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2 py-1.5 text-xs text-slate-900 dark:text-white text-center"
                        />
                      </div>
                      {newQuoteQuantityError && (
                        <p id={`${uidPrefix}-q-qty-err`} role="alert" className="text-[10px] text-rose-700 dark:text-rose-400 mt-0.5">
                          {newQuoteQuantityError}
                        </p>
                      )}
                    </div>

                    <div>
                      <label htmlFor="fin-quote-tax-type" className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                        Podstawa kwoty
                      </label>
                      <select
                        id="fin-quote-tax-type"
                        disabled={isVatExempt && newQuoteDirection === 'przychod'}
                        value={
                          isVatExempt && newQuoteDirection === 'przychod' ? 'zwolniony' : newQuoteTaxType
                        }
                        onChange={(e) => setNewQuoteTaxType(e.target.value as 'netto' | 'brutto' | 'zwolniony')}
                        className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white disabled:opacity-50"
                      >
                        <option value="netto">Netto</option>
                        <option value="brutto">Brutto</option>
                        <option value="zwolniony">Zwolniony (ZW)</option>
                      </select>
                    </div>

                    <div>
                      <label htmlFor="fin-quote-price" className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                        {newQuoteTaxType === 'brutto'
                          ? 'Cena jedn. brutto (zł) *'
                          : isVatExempt && newQuoteDirection === 'przychod'
                            ? 'Cena jedn. (ZW, zł) *'
                            : 'Cena jedn. netto (zł) *'}
                      </label>
                      <input
                        id="fin-quote-price"
                        type="text"
                        inputMode="decimal"
                        value={newQuotePriceStr}
                        onChange={(e) => handleNewQuotePriceChange(e.target.value)}
                        onBlur={handleNewQuotePriceBlur}
                        placeholder="0,00"
                        aria-invalid={Boolean(newQuotePriceError)}
                        aria-describedby={newQuotePriceError ? `${uidPrefix}-q-price-err` : undefined}
                        className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white font-mono text-right"
                      />
                      {newQuotePriceError && (
                        <p id={`${uidPrefix}-q-price-err`} role="alert" className="text-[10px] text-rose-700 dark:text-rose-400 mt-0.5">
                          {newQuotePriceError}
                        </p>
                      )}
                    </div>

                    <div>
                      <label htmlFor="fin-quote-vat" className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                        Stawka VAT
                      </label>
                      <select
                        id="fin-quote-vat"
                        disabled={
                          (isVatExempt && newQuoteDirection === 'przychod') ||
                          newQuoteTaxType === 'zwolniony'
                        }
                        value={
                          (isVatExempt && newQuoteDirection === 'przychod') ||
                          newQuoteTaxType === 'zwolniony'
                            ? 0
                            : newQuoteVatRate
                        }
                        onChange={(e) => setNewQuoteVatRate(Number(e.target.value))}
                        className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white disabled:opacity-50"
                      >
                        {!hasZeroVatOption && <option value={0}>Zwolniony (0%)</option>}
                        {vatRateOptions.map((v) => (
                          <option key={v.id} value={v.value}>
                            {v.label} ({v.value}%)
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label htmlFor="fin-quote-due-date" className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                        Termin płatności
                      </label>
                      <input
                        id="fin-quote-due-date"
                        type="date"
                        value={newQuoteDueDate}
                        onChange={(e) => setNewQuoteDueDate(e.target.value)}
                        className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2 py-1.5 text-xs text-slate-900 dark:text-white"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end pt-1">
                    <button
                      type="submit"
                      disabled={!canSubmitNewQuotation}
                      className="px-5 py-2 bg-sky-700 hover:bg-sky-800 disabled:opacity-40 text-white rounded font-medium text-xs transition-colors shadow-xs flex items-center gap-1.5"
                    >
                      <Plus className="w-4 h-4" aria-hidden="true" />
                      <span>Dodaj wycenę do listy</span>
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* TAB 2: LISTA KOSZTÓW I ZADANIA */}
          {activeTab === 'costs' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h4 className="font-bold text-slate-900 dark:text-white text-sm">
                    Rejestr Kosztów Branżowych i Wydatków Projektowych
                  </h4>
                  <p className="text-slate-600 dark:text-slate-400 text-xs">
                    Koszty podwykonawców, map, badań, uzgodnień i opłat urzędowych przypisanych do projektu.
                  </p>
                </div>
                <div className="text-left sm:text-right bg-rose-50 dark:bg-rose-950/40 p-2.5 rounded-lg border border-rose-200 dark:border-rose-800">
                  <span className="text-[11px] text-rose-800 dark:text-rose-300 block">
                    {finance.isVatExempt
                      ? `Koszty bezpośrednie (${costs.length}) — brutto (VAT nieodliczalny):`
                      : `Koszty bezpośrednie (${costs.length}):`}
                  </span>
                  <span className="text-sm font-bold text-rose-700 dark:text-rose-400 font-mono">
                    {finance.isVatExempt
                      ? `${formatMoney(finance.directCostsGross)} zł brutto (netto: ${formatMoney(finance.directCostsNet)} zł)`
                      : `${formatMoney(finance.directCostsNet)} zł netto (${formatMoney(finance.directCostsGross)} zł brutto)`}
                  </span>
                </div>
              </div>

              <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                    <tr>
                      <th scope="col" className="py-2.5 px-3 font-semibold">Nazwa kosztu / faktura</th>
                      <th scope="col" className="py-2.5 px-3 font-semibold text-center">Zapłacono</th>
                      <th scope="col" className="py-2.5 px-3 font-semibold">Kategoria branżowa</th>
                      <th scope="col" className="py-2.5 px-3 font-semibold">Powiązane zadanie</th>
                      <th scope="col" className="py-2.5 px-3 font-semibold">Wykonawca</th>
                      <th scope="col" className="py-2.5 px-3 font-semibold">Termin płatności</th>
                      <th scope="col" className="py-2.5 px-3 font-semibold text-right">Netto</th>
                      <th scope="col" className="py-2.5 px-3 font-semibold text-right">
                        {finance.isVatExempt ? 'Brutto (koszt)' : 'Brutto'}
                      </th>
                      {canEdit && <th scope="col" className="py-2.5 px-3 font-semibold text-center">Akcje</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900">
                    {costs.length === 0 ? (
                      <tr>
                        <td colSpan={canEdit ? 9 : 8} className="py-6 text-center text-slate-600 dark:text-slate-400">
                          Brak wprowadzonych kosztów branżowych. Dodaj koszt mapy, geologii lub uzgodnień poniżej.
                        </td>
                      </tr>
                    ) : (
                      costs.map((c) => {
                        const meta = getCategoryLabel(c.category);
                        const linkedTask = projectTasks.find((t) => t.id === c.taskId);
                        const isCostPaid = c.isPaid !== undefined ? c.isPaid : c.status === 'paid';
                        const overdue = isPaymentOverdue(c.dueDate, isCostPaid);
                        const isEditing = canEdit && editingCostId === c.id && editCostDraft;
                        const isHighlighted = highlightedCostId === c.id;
                        const serverItemErr =
                          saveError?.itemType === 'cost' && saveError?.itemId === c.id
                            ? saveError.error
                            : undefined;

                        if (isEditing && editCostDraft) {
                          return (
                            <tr
                              key={c.id}
                              className="bg-sky-50/50 dark:bg-sky-950/20"
                              onKeyDown={(e) =>
                                handleInlineRowKeyDown(
                                  e,
                                  () => saveEditCost(c.id),
                                  cancelEditCost
                                )
                              }
                            >
                              <td colSpan={canEdit ? 9 : 8} className="p-3 space-y-2">
                                <div className="grid grid-cols-1 sm:grid-cols-6 gap-2 items-start">
                                  <div className="sm:col-span-2">
                                    <label htmlFor={`edit-c-title-${c.id}`} className="block text-[10px] text-slate-600 dark:text-slate-400 mb-0.5">
                                      Tytuł kosztu *
                                    </label>
                                    <input
                                      id={`edit-c-title-${c.id}`}
                                      type="text"
                                      value={editCostDraft.title}
                                      onChange={(e) =>
                                        setEditCostDraft((prev) =>
                                          prev ? { ...prev, title: e.target.value } : null
                                        )
                                      }
                                      className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2 py-1 text-xs"
                                    />
                                  </div>
                                  <div>
                                    <label htmlFor={`edit-c-cat-${c.id}`} className="block text-[10px] text-slate-600 dark:text-slate-400 mb-0.5">
                                      Kategoria
                                    </label>
                                    <select
                                      id={`edit-c-cat-${c.id}`}
                                      value={editCostDraft.category}
                                      onChange={(e) =>
                                        setEditCostDraft((prev) =>
                                          prev ? { ...prev, category: e.target.value as CostCategory } : null
                                        )
                                      }
                                      className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2 py-1 text-xs"
                                    >
                                      {COST_CATEGORIES.map((cat) => (
                                        <option key={cat.value} value={cat.value}>
                                          {cat.label}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                  <div>
                                    <label htmlFor={`edit-c-net-${c.id}`} className="block text-[10px] text-slate-600 dark:text-slate-400 mb-0.5">
                                      Kwota netto (zł) *
                                    </label>
                                    <input
                                      id={`edit-c-net-${c.id}`}
                                      type="text"
                                      inputMode="decimal"
                                      value={editCostDraft.amountNetStr}
                                      onChange={(e) => {
                                        const raw = e.target.value;
                                        const res = validateMoneyInput(raw, { requiredPositive: true });
                                        setEditCostDraft((prev) =>
                                          prev
                                            ? {
                                                ...prev,
                                                amountNetStr: raw,
                                                netError: res.valid ? undefined : res.error,
                                                amountGrossStr:
                                                  res.valid && res.value !== null
                                                    ? formatMoney(calcGrossFromNet(res.value, prev.vatRate))
                                                    : prev.amountGrossStr,
                                                grossError: res.valid ? undefined : prev.grossError,
                                              }
                                            : null
                                        );
                                      }}
                                      onBlur={() => {
                                        const p = parseMoney(editCostDraft.amountNetStr);
                                        if (p !== null) {
                                          setEditCostDraft((prev) =>
                                            prev ? { ...prev, amountNetStr: formatMoney(p) } : null
                                          );
                                        }
                                      }}
                                      placeholder="0,00"
                                      aria-invalid={Boolean(editCostDraft.netError)}
                                      aria-describedby={editCostDraft.netError ? `edit-c-net-err-${c.id}` : undefined}
                                      className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2 py-1 text-xs font-mono text-right"
                                    />
                                    {editCostDraft.netError && (
                                      <p id={`edit-c-net-err-${c.id}`} role="alert" className="text-[10px] text-rose-700 dark:text-rose-400 mt-0.5">
                                        {editCostDraft.netError}
                                      </p>
                                    )}
                                  </div>
                                  <div>
                                    <label htmlFor={`edit-c-gross-${c.id}`} className="block text-[10px] text-slate-600 dark:text-slate-400 mb-0.5">
                                      Kwota brutto (zł) *
                                    </label>
                                    <input
                                      id={`edit-c-gross-${c.id}`}
                                      type="text"
                                      inputMode="decimal"
                                      value={editCostDraft.amountGrossStr}
                                      onChange={(e) => {
                                        const raw = e.target.value;
                                        const res = validateMoneyInput(raw, { requiredPositive: true });
                                        setEditCostDraft((prev) =>
                                          prev
                                            ? {
                                                ...prev,
                                                amountGrossStr: raw,
                                                grossError: res.valid ? undefined : res.error,
                                                amountNetStr:
                                                  res.valid && res.value !== null
                                                    ? formatMoney(calcNetFromGross(res.value, prev.vatRate))
                                                    : prev.amountNetStr,
                                                netError: res.valid ? undefined : prev.netError,
                                              }
                                            : null
                                        );
                                      }}
                                      onBlur={() => {
                                        const p = parseMoney(editCostDraft.amountGrossStr);
                                        if (p !== null) {
                                          setEditCostDraft((prev) =>
                                            prev ? { ...prev, amountGrossStr: formatMoney(p) } : null
                                          );
                                        }
                                      }}
                                      placeholder="0,00"
                                      aria-invalid={Boolean(editCostDraft.grossError)}
                                      aria-describedby={editCostDraft.grossError ? `edit-c-gross-err-${c.id}` : undefined}
                                      className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2 py-1 text-xs font-mono text-right"
                                    />
                                    {editCostDraft.grossError && (
                                      <p id={`edit-c-gross-err-${c.id}`} role="alert" className="text-[10px] text-rose-700 dark:text-rose-400 mt-0.5">
                                        {editCostDraft.grossError}
                                      </p>
                                    )}
                                  </div>
                                  <div>
                                    <label htmlFor={`edit-c-vat-${c.id}`} className="block text-[10px] text-slate-600 dark:text-slate-400 mb-0.5">
                                      VAT
                                    </label>
                                    <select
                                      id={`edit-c-vat-${c.id}`}
                                      value={editCostDraft.vatRate}
                                      onChange={(e) => {
                                        const vat = Number(e.target.value);
                                        setEditCostDraft((prev) => {
                                          if (!prev) return null;
                                          const pNet = parseMoney(prev.amountNetStr);
                                          return {
                                            ...prev,
                                            vatRate: vat,
                                            amountGrossStr:
                                              pNet !== null
                                                ? formatMoney(calcGrossFromNet(pNet, vat))
                                                : prev.amountGrossStr,
                                          };
                                        });
                                      }}
                                      className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2 py-1 text-xs"
                                    >
                                      {vatRateOptions.map((v) => (
                                        <option key={v.id} value={v.value}>
                                          {v.label} ({v.value}%)
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-6 gap-2 items-end">
                                  <div>
                                    <label htmlFor={`edit-c-contractor-${c.id}`} className="block text-[10px] text-slate-600 dark:text-slate-400 mb-0.5">
                                      Wykonawca
                                    </label>
                                    <input
                                      id={`edit-c-contractor-${c.id}`}
                                      type="text"
                                      value={editCostDraft.contractorName}
                                      onChange={(e) =>
                                        setEditCostDraft((prev) =>
                                          prev ? { ...prev, contractorName: e.target.value } : null
                                        )
                                      }
                                      className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2 py-1 text-xs"
                                    />
                                  </div>
                                  <div>
                                    <label htmlFor={`edit-c-invoice-${c.id}`} className="block text-[10px] text-slate-600 dark:text-slate-400 mb-0.5">
                                      Nr faktury
                                    </label>
                                    <input
                                      id={`edit-c-invoice-${c.id}`}
                                      type="text"
                                      value={editCostDraft.invoiceNumber}
                                      onChange={(e) =>
                                        setEditCostDraft((prev) =>
                                          prev ? { ...prev, invoiceNumber: e.target.value } : null
                                        )
                                      }
                                      className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2 py-1 text-xs"
                                    />
                                  </div>
                                  <div>
                                    <label htmlFor={`edit-c-due-${c.id}`} className="block text-[10px] text-slate-600 dark:text-slate-400 mb-0.5">
                                      Termin płatności
                                    </label>
                                    <input
                                      id={`edit-c-due-${c.id}`}
                                      type="date"
                                      value={editCostDraft.dueDate}
                                      onChange={(e) =>
                                        setEditCostDraft((prev) =>
                                          prev ? { ...prev, dueDate: e.target.value } : null
                                        )
                                      }
                                      className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2 py-1 text-xs"
                                    />
                                  </div>
                                  <div>
                                    <label htmlFor={`edit-c-status-${c.id}`} className="block text-[10px] text-slate-600 dark:text-slate-400 mb-0.5">
                                      Status
                                    </label>
                                    <select
                                      id={`edit-c-status-${c.id}`}
                                      value={editCostDraft.isPaid ? 'paid' : editCostDraft.status}
                                      onChange={(e) => {
                                        const st = e.target.value as 'planned' | 'incurred' | 'paid';
                                        setEditCostDraft((prev) =>
                                          prev
                                            ? { ...prev, status: st, isPaid: st === 'paid' }
                                            : null
                                        );
                                      }}
                                      className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2 py-1 text-xs"
                                    >
                                      <option value="planned">Planowany</option>
                                      <option value="incurred">Poniesiony (nieopłacony)</option>
                                      <option value="paid">Zapłacono</option>
                                    </select>
                                  </div>
                                  <div className="sm:col-span-2 flex justify-end gap-2">
                                    <button
                                      type="button"
                                      onClick={cancelEditCost}
                                      className="px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 text-[11px]"
                                    >
                                      Anuluj
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => saveEditCost(c.id)}
                                      className="px-3 py-1 rounded bg-sky-700 hover:bg-sky-800 text-white font-semibold text-[11px]"
                                    >
                                      Zapisz wiersz
                                    </button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          );
                        }

                        return (
                          <tr
                            key={c.id}
                            className={`transition-colors ${
                              isHighlighted
                                ? 'bg-purple-50 dark:bg-purple-950/40'
                                : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                            }`}
                          >
                            <td className="py-2 px-3 font-medium text-slate-900 dark:text-slate-100">
                              <div>{c.title}</div>
                              {c.sourceQuotationId && (
                                <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-950/60 text-purple-800 dark:text-purple-200 text-[10px] font-semibold">
                                  Z wyceny ofertowej
                                </span>
                              )}
                              {c.invoiceNumber && (
                                <span className="block text-[10px] text-slate-600 dark:text-slate-400 font-mono">
                                  Faktura: {c.invoiceNumber}
                                </span>
                              )}
                              {serverItemErr && (
                                <p role="alert" className="text-[10px] text-rose-700 dark:text-rose-400 mt-0.5">
                                  {serverItemErr}
                                </p>
                              )}
                            </td>
                            <td className="py-2 px-3 text-center">
                              <button
                                type="button"
                                disabled={!canEdit}
                                aria-pressed={isCostPaid}
                                onClick={() => handleToggleCostPaid(c.id)}
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border transition-colors disabled:opacity-60 ${
                                  isCostPaid
                                    ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700'
                                }`}
                              >
                                {isCostPaid ? (
                                  <CheckCircle2 className="w-3 h-3 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                                ) : (
                                  <Clock className="w-3 h-3 text-slate-600 dark:text-slate-400" aria-hidden="true" />
                                )}
                                <span>{isCostPaid ? 'Zapłacono' : c.status === 'planned' ? 'Planowany' : 'Czeka'}</span>
                              </button>
                            </td>
                            <td className="py-2 px-3">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-medium border ${meta.color}`}>
                                {meta.label}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-slate-600 dark:text-slate-400">
                              {linkedTask ? (
                                <span className="font-mono text-[11px] text-sky-700 dark:text-sky-400 font-semibold">
                                  [{linkedTask.code}] {linkedTask.title.slice(0, 20)}...
                                </span>
                              ) : (
                                <span className="text-slate-600 dark:text-slate-400 italic">Ogólny projekt</span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-slate-600 dark:text-slate-400">
                              {c.contractorName || '—'}
                            </td>
                            <td className="py-2 px-3 whitespace-nowrap font-mono text-[11px]">
                              {c.dueDate ? (
                                <div className="flex items-center gap-1">
                                  <span>{c.dueDate}</span>
                                  {overdue && (
                                    <span className="px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800 text-[10px] font-bold">
                                      po terminie
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-slate-600 dark:text-slate-400">—</span>
                              )}
                            </td>
                            <td className={`py-2 px-3 text-right font-mono whitespace-nowrap ${finance.isVatExempt ? 'text-slate-600 dark:text-slate-400' : 'font-bold text-slate-900 dark:text-slate-100'}`}>
                              {formatMoney(c.amountNet)} zł
                            </td>
                            <td className={`py-2 px-3 text-right font-mono whitespace-nowrap ${finance.isVatExempt ? 'font-bold text-rose-700 dark:text-rose-400' : 'text-slate-600 dark:text-slate-400'}`}>
                              {formatMoney(c.amountGross)} zł
                            </td>
                            {canEdit && (
                              <td className="py-2 px-3 text-center whitespace-nowrap">
                                {confirmDeleteCostId === c.id ? (
                                  <div className="inline-flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteCost(c.id)}
                                      className="px-2 py-0.5 rounded bg-rose-700 text-white text-[10px] font-semibold"
                                    >
                                      Potwierdź
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDeleteCostId(null)}
                                      className="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-[10px]"
                                    >
                                      Anuluj
                                    </button>
                                  </div>
                                ) : (
                                  <div className="inline-flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => startEditCost(c)}
                                      aria-label={`Edytuj koszt ${c.title}`}
                                      className="px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] inline-flex items-center gap-1"
                                    >
                                      <Edit3 className="w-3 h-3" aria-hidden="true" />
                                      <span>Edytuj</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDeleteCostId(c.id)}
                                      aria-label={`Usuń koszt ${c.title}`}
                                      className="px-2 py-0.5 rounded border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-[11px] inline-flex items-center gap-1"
                                    >
                                      <Trash2 className="w-3 h-3" aria-hidden="true" />
                                      <span>Usuń</span>
                                    </button>
                                  </div>
                                )}
                              </td>
                            )}
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Add cost form */}
              {canEdit && (
                <form
                  onSubmit={handleAddCost}
                  className="p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg space-y-3"
                >
                  <span className="font-bold text-slate-800 dark:text-slate-200 block text-xs">
                    + Zarejestruj nowy koszt (Mapa, Geologia, Uzgodnienia, Podwykonawcy)
                  </span>

                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <div className="sm:col-span-2">
                      <label htmlFor="fin-cost-title" className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                        Tytuł kosztu / opis opracowania *
                      </label>
                      <input
                        id="fin-cost-title"
                        type="text"
                        required
                        value={newCostTitle}
                        onChange={(e) => setNewCostTitle(e.target.value)}
                        placeholder="np. Opracowanie Mapy do Celów Projektowych (MDCP)"
                        className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
                      />
                    </div>

                    <div>
                      <label htmlFor="fin-cost-category" className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                        Kategoria kosztu
                      </label>
                      <select
                        id="fin-cost-category"
                        value={newCostCategory}
                        onChange={(e) => setNewCostCategory(e.target.value as CostCategory)}
                        className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
                      >
                        {COST_CATEGORIES.map((cat) => (
                          <option key={cat.value} value={cat.value}>
                            {cat.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label htmlFor="fin-cost-task" className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                        Przypisz do zadania
                      </label>
                      <select
                        id="fin-cost-task"
                        value={newCostTaskId}
                        onChange={(e) => setNewCostTaskId(e.target.value)}
                        className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
                      >
                        <option value="">-- Koszt ogólny projektu --</option>
                        {projectTasks.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.code}: {t.title}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-6 gap-3 items-start">
                    <div>
                      <label htmlFor="fin-cost-net" className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                        Kwota netto (zł) *
                      </label>
                      <input
                        id="fin-cost-net"
                        type="text"
                        inputMode="decimal"
                        value={newCostAmountNetStr}
                        onChange={(e) => handleNewCostNetChange(e.target.value)}
                        onBlur={handleNewCostNetBlur}
                        placeholder="0,00"
                        aria-invalid={Boolean(newCostNetError)}
                        aria-describedby={newCostNetError ? `${uidPrefix}-c-net-err` : undefined}
                        className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white font-mono text-right"
                      />
                      {newCostNetError && (
                        <p id={`${uidPrefix}-c-net-err`} role="alert" className="text-[10px] text-rose-700 dark:text-rose-400 mt-0.5">
                          {newCostNetError}
                        </p>
                      )}
                    </div>

                    <div>
                      <label htmlFor="fin-cost-gross" className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                        Kwota brutto (zł)
                      </label>
                      <input
                        id="fin-cost-gross"
                        type="text"
                        inputMode="decimal"
                        value={newCostAmountGrossStr}
                        onChange={(e) => handleNewCostGrossChange(e.target.value)}
                        onBlur={handleNewCostGrossBlur}
                        placeholder="0,00"
                        aria-invalid={Boolean(newCostGrossError)}
                        aria-describedby={newCostGrossError ? `${uidPrefix}-c-gross-err` : undefined}
                        className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white font-mono text-right"
                      />
                      {newCostGrossError && (
                        <p id={`${uidPrefix}-c-gross-err`} role="alert" className="text-[10px] text-rose-700 dark:text-rose-400 mt-0.5">
                          {newCostGrossError}
                        </p>
                      )}
                    </div>

                    <div>
                      <label htmlFor="fin-cost-vat" className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                        Stawka VAT
                      </label>
                      <select
                        id="fin-cost-vat"
                        value={newCostVatRate}
                        onChange={(e) => handleNewCostVatChange(Number(e.target.value))}
                        className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
                      >
                        {vatRateOptions.map((v) => (
                          <option key={v.id} value={v.value}>
                            {v.label} ({v.value}%)
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label htmlFor="fin-cost-contractor" className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                        Wykonawca / Rzeczoznawca
                      </label>
                      <input
                        id="fin-cost-contractor"
                        type="text"
                        value={newCostContractor}
                        onChange={(e) => setNewCostContractor(e.target.value)}
                        placeholder="np. Biuro Geodezyjne"
                        className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
                      />
                    </div>

                    <div>
                      <label htmlFor="fin-cost-due-date" className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                        Termin płatności
                      </label>
                      <input
                        id="fin-cost-due-date"
                        type="date"
                        value={newCostDueDate}
                        onChange={(e) => setNewCostDueDate(e.target.value)}
                        className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2 py-1.5 text-xs text-slate-900 dark:text-white"
                      />
                    </div>

                    <div>
                      <label htmlFor="fin-cost-status" className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                        Status kosztu
                      </label>
                      <select
                        id="fin-cost-status"
                        value={newCostStatus}
                        onChange={(e) => setNewCostStatus(e.target.value as 'planned' | 'incurred' | 'paid')}
                        className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2 py-1.5 text-xs text-slate-900 dark:text-white"
                      >
                        <option value="planned">Planowany</option>
                        <option value="incurred">Poniesiony</option>
                        <option value="paid">Zapłacono</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <div className="flex items-center gap-2">
                      <label htmlFor="fin-cost-invoice" className="text-[11px] text-slate-600 dark:text-slate-400">
                        Nr faktury:
                      </label>
                      <input
                        id="fin-cost-invoice"
                        type="text"
                        value={newCostInvoice}
                        onChange={(e) => setNewCostInvoice(e.target.value)}
                        placeholder="np. FV/2026/11"
                        className="w-40 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded px-2 py-1 text-xs"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={!canSubmitNewCost}
                      className="px-5 py-1.5 bg-rose-700 hover:bg-rose-800 disabled:opacity-40 text-white rounded font-medium text-xs transition-colors shadow-xs"
                    >
                      + Zapisz koszt
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* TAB 3: ZAMAWIAJĄCY & DYSK & TERMINY */}
          {activeTab === 'client' && (
            <div className="space-y-4">
              <h4 className="font-bold text-slate-900 dark:text-white text-sm">
                Dane Zamawiającego (Inwestora), Lokalizacja na Dysku & Ramy Czasowe Projektu
              </h4>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Investor details */}
                <div className="space-y-3 p-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-lg">
                  <div className="flex items-center justify-between">
                    <h5 className="font-semibold text-slate-800 dark:text-slate-200 text-xs flex items-center gap-1.5">
                      <Building2 className="w-4 h-4 text-sky-700 dark:text-sky-400" aria-hidden="true" />
                      <span>Inwestor / Zamawiający</span>
                    </h5>
                    {canEdit && availableClients.length > 0 && (
                      <div className="flex items-center gap-1">
                        <label htmlFor="fin-client-preset" className="text-[10px] text-slate-600 dark:text-slate-400">
                          Wybierz:
                        </label>
                        <select
                          id="fin-client-preset"
                          aria-label="Wybierz inwestora z bazy"
                          onChange={handleSelectPredefinedClient}
                          defaultValue=""
                          className="text-[11px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2 py-0.5 text-slate-700 dark:text-slate-300"
                        >
                          <option value="" disabled>-- Baza inwestorów --</option>
                          {availableClients.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  <div>
                    <label htmlFor="fin-client-name" className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                      Nazwa Inwestora / Zamawiającego
                    </label>
                    <input
                      id="fin-client-name"
                      type="text"
                      disabled={!canEdit}
                      value={clientName}
                      onChange={(e) => setClientName(e.target.value)}
                      placeholder="np. Nordic Development Sp. z o.o."
                      className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-3 py-2 text-xs text-slate-900 dark:text-white disabled:opacity-60"
                    />
                  </div>

                  <div>
                    <label htmlFor="fin-client-contact" className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                      Osoba kontaktowa (reprezentant)
                    </label>
                    <input
                      id="fin-client-contact"
                      type="text"
                      disabled={!canEdit}
                      value={clientContactPerson}
                      onChange={(e) => setClientContactPerson(e.target.value)}
                      placeholder="np. Marek Zawadzki - Dyrektor Techniczny"
                      className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-3 py-2 text-xs text-slate-900 dark:text-white disabled:opacity-60"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label htmlFor="fin-client-phone" className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                        Telefon
                      </label>
                      <input
                        id="fin-client-phone"
                        type="text"
                        disabled={!canEdit}
                        value={clientPhone}
                        onChange={(e) => setClientPhone(e.target.value)}
                        placeholder="+48 22 555 12 34"
                        className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-3 py-2 text-xs text-slate-900 dark:text-white disabled:opacity-60"
                      />
                    </div>
                    <div>
                      <label htmlFor="fin-client-email" className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                        E-mail
                      </label>
                      <input
                        id="fin-client-email"
                        type="email"
                        disabled={!canEdit}
                        value={clientEmail}
                        onChange={(e) => setClientEmail(e.target.value)}
                        placeholder="kontakt@inwestor.pl"
                        className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-3 py-2 text-xs text-slate-900 dark:text-white disabled:opacity-60"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label htmlFor="fin-client-nip" className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                        NIP
                      </label>
                      <input
                        id="fin-client-nip"
                        type="text"
                        disabled={!canEdit}
                        value={clientNip}
                        onChange={(e) => setClientNip(e.target.value)}
                        placeholder="525-000-00-00"
                        className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-3 py-2 text-xs text-slate-900 dark:text-white font-mono disabled:opacity-60"
                      />
                    </div>
                    <div>
                      <label htmlFor="fin-client-address" className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                        Adres Inwestora
                      </label>
                      <input
                        id="fin-client-address"
                        type="text"
                        disabled={!canEdit}
                        value={clientAddress}
                        onChange={(e) => setClientAddress(e.target.value)}
                        placeholder="ul. Inwestycyjna 1, Warszawa"
                        className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-3 py-2 text-xs text-slate-900 dark:text-white disabled:opacity-60"
                      />
                    </div>
                  </div>
                </div>

                {/* Disk Path and Dates */}
                <div className="space-y-4">
                  <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-lg space-y-2">
                    <h5 className="font-semibold text-slate-800 dark:text-slate-200 text-xs flex items-center gap-1.5">
                      <Folder className="w-4 h-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                      <span>Lokalizacja na dysku / serwerze NAS</span>
                    </h5>
                    <p className="text-[11px] text-slate-600 dark:text-slate-400">
                      Ścieżka do katalogu projektu w sieci lokalnej lub na dysku roboczym pracowni.
                    </p>
                    <label htmlFor="fin-disk-path" className="sr-only">
                      Ścieżka do katalogu projektu na dysku lub serwerze NAS
                    </label>
                    <div className="flex gap-1.5">
                      <input
                        id="fin-disk-path"
                        type="text"
                        disabled={!canEdit}
                        value={diskPath}
                        onChange={(e) => setDiskPath(e.target.value)}
                        placeholder="np. Z:\PROJEKTY\2026\2026-01-NordicTower lub /mnt/projekty/2026/01"
                        className="flex-1 font-mono text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-3 py-2 text-slate-900 dark:text-white disabled:opacity-60"
                      />
                      <button
                        type="button"
                        onClick={handleCopyDiskPath}
                        disabled={!diskPath}
                        className={`px-3 py-2 rounded text-xs font-semibold flex items-center gap-1.5 transition-colors border ${
                          copiedPath
                            ? 'bg-emerald-700 text-white border-emerald-700'
                            : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
                        } disabled:opacity-40`}
                      >
                        {copiedPath ? <Check className="w-4 h-4" aria-hidden="true" /> : <Copy className="w-4 h-4" aria-hidden="true" />}
                        <span>{copiedPath ? 'Skopiowano' : 'Kopiuj'}</span>
                      </button>
                    </div>
                  </div>

                  <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-lg space-y-3">
                    <h5 className="font-semibold text-slate-800 dark:text-slate-200 text-xs flex items-center gap-1.5">
                      <Calendar className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                      <span>Termin rozpoczęcia i zakończenia</span>
                    </h5>

                    <div>
                      <label htmlFor="fin-start-date" className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                        Data rozpoczęcia
                      </label>
                      <input
                        id="fin-start-date"
                        type="date"
                        disabled={!canEdit}
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-3 py-2 text-xs text-slate-900 dark:text-white disabled:opacity-60"
                      />
                    </div>

                    <div>
                      <label htmlFor="fin-due-date" className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                        Termin końcowy (zakończenie wyceny / umowy)
                      </label>
                      <input
                        id="fin-due-date"
                        type="date"
                        disabled={!canEdit}
                        value={dueDate}
                        onChange={(e) => setDueDate(e.target.value)}
                        className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-3 py-2 text-xs text-slate-900 dark:text-white disabled:opacity-60"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: PODSUMOWANIE */}
          {activeTab === 'summary' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="font-bold text-slate-900 dark:text-white text-sm">
                  Podsumowanie Finansowe, Rentowność i Prognoza Płatności
                </h4>
                {finance.isVatExempt && (
                  <span className="text-[11px] px-2.5 py-1 rounded bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 font-medium">
                    Firma zwolniona z VAT{finance.vatExemptionBasis ? ` (${finance.vatExemptionBasis})` : ''}: przychody ZW, koszty ekonomiczne brutto
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg">
                  <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-300 block mb-1">
                    {finance.isVatExempt ? 'Wartość projektu (ZW, Umowa + Wyceny)' : 'Wartość projektu (Umowa + Wyceny)'}
                  </span>
                  <div className="text-xl font-bold font-mono text-emerald-700 dark:text-emerald-400">
                    {formatMoney(finance.totalRevenueNet)} PLN
                  </div>
                  <span className="text-[11px] text-emerald-700 dark:text-emerald-400 block mt-1">
                    {finance.isVatExempt
                      ? 'Zwolniona z VAT (brutto = netto)'
                      : `Brutto z VAT: ${formatMoney(finance.totalRevenueGross)} PLN`}
                  </span>
                </div>

                <div className="p-4 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 rounded-lg">
                  <span className="text-xs font-semibold text-rose-800 dark:text-rose-300 block mb-1">
                    {finance.isVatExempt ? 'Koszt ekonomiczny (brutto, VAT nieodliczalny)' : 'Koszty łączne (Netto)'}
                  </span>
                  <div className="text-xl font-bold font-mono text-rose-700 dark:text-rose-400">
                    {formatMoney(finance.economicTotalCosts)} PLN
                  </div>
                  <span className="text-[11px] text-rose-700 dark:text-rose-400 block mt-1">
                    {finance.isVatExempt
                      ? `Nominalnie netto: ${formatMoney(finance.totalCostsNet)} PLN (brutto: ${formatMoney(finance.totalCostsGross)} PLN)`
                      : `Brutto z VAT: ${formatMoney(finance.totalCostsGross)} PLN`}
                  </span>
                </div>

                <div
                  className={`p-4 rounded-lg border ${
                    finance.profitNet >= 0
                      ? 'bg-sky-50 dark:bg-sky-950/30 border-sky-200 dark:border-sky-800'
                      : 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800'
                  }`}
                >
                  <span
                    className={`text-xs font-semibold block mb-1 ${
                      finance.profitNet >= 0
                        ? 'text-sky-800 dark:text-sky-300'
                        : 'text-rose-800 dark:text-rose-300'
                    }`}
                  >
                    {finance.isVatExempt ? 'Bilans (Przychód ZW − Koszt brutto)' : 'Bilans (Netto)'}
                  </span>
                  <div
                    className={`text-xl font-bold font-mono ${
                      finance.profitNet >= 0
                        ? 'text-sky-700 dark:text-sky-400'
                        : 'text-rose-700 dark:text-rose-400'
                    }`}
                  >
                    {finance.profitNet >= 0 ? '+' : ''}
                    {formatMoney(finance.profitNet)} PLN
                  </div>
                  <span
                    className={`text-[11px] block mt-1 font-semibold ${
                      finance.profitNet >= 0
                        ? 'text-sky-700 dark:text-sky-400'
                        : 'text-rose-700 dark:text-rose-400'
                    }`}
                  >
                    Marża projektu: {finance.marginPercent}%
                  </span>
                </div>
              </div>

              {/* Oczekiwane wpływy i wydatki (z terminem płatności) */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 bg-white dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-lg">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Oczekiwane wpływy
                  </span>
                  <div
                    data-testid="finance-expected-inflow"
                    className="text-lg font-bold font-mono text-emerald-700 dark:text-emerald-400"
                  >
                    {formatMoney(finance.expectedInflowNet)} PLN
                  </div>
                  <span className="text-[11px] text-slate-600 dark:text-slate-400 block mt-1">
                    Niezapłacone transze i wyceny przychodowe z terminem płatności
                  </span>
                </div>

                <div className="p-4 bg-white dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-lg">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Oczekiwane wydatki
                  </span>
                  <div
                    data-testid="finance-expected-outflow"
                    className="text-lg font-bold font-mono text-rose-700 dark:text-rose-400"
                  >
                    {formatMoney(finance.economicExpectedOutflow)} PLN
                  </div>
                  <span className="text-[11px] text-slate-600 dark:text-slate-400 block mt-1">
                    {finance.isVatExempt
                      ? 'Niezapłacone i planowane koszty z terminem płatności (brutto — VAT nieodliczalny)'
                      : 'Niezapłacone i planowane koszty z terminem płatności'}
                  </span>
                </div>

                <div className="p-4 bg-white dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-lg">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Najbliższy termin płatności
                  </span>
                  <div className="text-lg font-bold font-mono text-slate-900 dark:text-white">
                    {finance.nextPaymentDate || 'Brak zaplanowanych'}
                  </div>
                  <span className="text-[11px] text-slate-600 dark:text-slate-400 block mt-1">
                    Najwcześniejszy nadchodzący lub zaległy termin rozliczenia
                  </span>
                </div>
              </div>

              {/* Breakdown */}
              <div className="p-4 bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg space-y-3">
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-2">
                  <h5 className="font-bold text-slate-900 dark:text-white text-xs flex items-center gap-1.5">
                    <Layers className="w-4 h-4 text-sky-700 dark:text-sky-400" aria-hidden="true" />
                    <span>Wartość Projektu — Rozbicie na elementy i koszty</span>
                  </h5>
                  <span className="font-mono text-xs font-bold text-emerald-700 dark:text-emerald-400">
                    {finance.isVatExempt
                      ? `Przychód łączny: ${formatMoney(finance.totalRevenueNet)} PLN (ZW)`
                      : `Przychód łączny: ${formatMoney(finance.totalRevenueNet)} PLN netto`}
                  </span>
                </div>

                <div className="space-y-2">
                  <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                    1. Składowe przychodu pracowni (Umowa + Wybrane wyceny przychodowe):
                  </div>
                  {finance.baseProjectValueNet === 0 && revenueQuotes.length === 0 ? (
                    <div className="text-[11px] text-slate-600 dark:text-slate-400 italic">
                      Brak pozycji przychodowych
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100 dark:divide-slate-700/50 bg-slate-50/50 dark:bg-slate-900/40 rounded border border-slate-200 dark:border-slate-700">
                      {finance.baseProjectValueNet > 0 && (
                        <div className="p-2 flex items-center justify-between text-xs">
                          <span className="font-medium text-slate-900 dark:text-slate-100">
                            Wartość bazowa projektu (umowa główna)
                          </span>
                          <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                            {formatMoney(finance.baseProjectValueNet)} {finance.isVatExempt ? 'zł (ZW)' : 'zł netto'}
                          </span>
                        </div>
                      )}
                      {revenueQuotes.map((q) => (
                        <div key={q.id} className="p-2 flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-emerald-600" aria-hidden="true" />
                            <span className="font-medium text-slate-900 dark:text-slate-100">{q.title}</span>
                            <span className="text-[10px] text-slate-600 dark:text-slate-400">({q.companyName})</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                              {formatMoney(q.totalNet)} {finance.isVatExempt ? 'zł (ZW)' : 'zł netto'}
                            </span>
                            {!finance.isVatExempt && (
                              <span className="text-[10px] text-slate-600 dark:text-slate-400 font-mono">
                                ({formatMoney(q.totalGross)} brutto)
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 pt-2">
                    2. Koszty zewnętrzne i podwykonawcy branżowi (bez podwójnego liczenia ofert przeniesionych):
                  </div>
                  {finance.economicTotalCosts === 0 ? (
                    <div className="text-[11px] text-slate-600 dark:text-slate-400 italic">Brak przypisanych kosztów</div>
                  ) : (
                    <div className="divide-y divide-slate-100 dark:divide-slate-700/50 bg-slate-50/50 dark:bg-slate-900/40 rounded border border-slate-200 dark:border-slate-700">
                      {unlinkedCostQuotes.map((q) => (
                        <div key={q.id} className="p-2 flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-rose-600" aria-hidden="true" />
                            <span className="font-medium text-slate-900 dark:text-slate-100">{q.title}</span>
                            <span className="text-[10px] text-slate-600 dark:text-slate-400">({q.companyName})</span>
                          </div>
                          <div className="text-right font-mono">
                            <span className="font-bold text-rose-700 dark:text-rose-400">
                              -{formatMoney(finance.isVatExempt ? q.totalGross : q.totalNet)} {finance.isVatExempt ? 'zł brutto' : 'zł netto'}
                            </span>
                            {finance.isVatExempt && (
                              <span className="text-[10px] text-slate-600 dark:text-slate-400 ml-1.5">
                                (netto: {formatMoney(q.totalNet)} zł)
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                      {costs.map((c) => (
                        <div key={c.id} className="p-2 flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-rose-600" aria-hidden="true" />
                            <span className="font-medium text-slate-900 dark:text-slate-100">{c.title}</span>
                            {c.contractorName && (
                              <span className="text-[10px] text-slate-600 dark:text-slate-400">({c.contractorName})</span>
                            )}
                          </div>
                          <div className="text-right font-mono">
                            <span className="font-bold text-rose-700 dark:text-rose-400">
                              -{formatMoney(finance.isVatExempt ? c.amountGross : c.amountNet)} {finance.isVatExempt ? 'zł brutto' : 'zł netto'}
                            </span>
                            {finance.isVatExempt && (
                              <span className="text-[10px] text-slate-600 dark:text-slate-400 ml-1.5">
                                (netto: {formatMoney(c.amountNet)} zł)
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Category Breakdown */}
              <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-lg space-y-3">
                <h5 className="font-bold text-slate-800 dark:text-slate-200 text-xs">
                  Struktura kosztów bezpośrednich według kategorii{finance.isVatExempt ? ' (brutto — VAT nieodliczalny)' : ''}:
                </h5>
                <div className="space-y-2">
                  {(Object.keys(finance.costsByCategory) as CostCategory[]).map((catKey) => {
                    const catAmount = finance.costsByCategory[catKey] || 0;
                    const catPct =
                      finance.economicTotalCosts > 0
                        ? Math.round((catAmount / finance.economicTotalCosts) * 100)
                        : 0;
                    const meta = getCategoryLabel(catKey);
                    return (
                      <div key={catKey} className="flex items-center justify-between text-xs">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-medium border ${meta.color}`}>
                          {meta.label}
                        </span>
                        <div className="flex items-center gap-3">
                          <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                            {formatMoney(catAmount)} PLN
                          </span>
                          <span className="text-slate-600 dark:text-slate-400 text-[11px] w-12 text-right">
                            {catPct}%
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/70 flex items-center justify-between">
          <button
            ref={footerCancelRef}
            type="button"
            disabled={isSaving}
            onClick={onClose}
            className="px-4 py-2 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 rounded transition-colors disabled:opacity-50"
          >
            {canEdit ? 'Anuluj' : 'Zamknij'}
          </button>

          {canEdit && (
            <button
              type="button"
              disabled={isSaving || Boolean(baseNetError || baseGrossError)}
              onClick={handleSaveAll}
              className="flex items-center gap-1.5 px-5 py-2 bg-sky-700 hover:bg-sky-800 disabled:opacity-50 text-white rounded font-semibold text-xs shadow-xs transition-colors"
            >
              <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
              <span>{isSaving ? 'Zapisywanie...' : 'Zapisz zmiany w projekcie i kosztorysie'}</span>
            </button>
          )}
        </div>

        {/* Sub-dialog: Wybór kategorii przy przenoszeniu wyceny do kosztów */}
        {quoteToMove && (
          <div
            {...moveQuoteBackdropProps}
            className="fixed inset-0 z-60 bg-black/50 flex items-center justify-center p-4"
          >
            <div
              ref={moveQuoteModalRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="move-quote-dialog-title"
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 max-w-sm w-full shadow-2xl space-y-3 text-xs"
            >
              <h4 id="move-quote-dialog-title" className="text-sm font-bold text-slate-900 dark:text-white">
                Przenieś wycenę do kosztów
              </h4>
              <p className="text-slate-600 dark:text-slate-400">
                Pozycja <strong>{quoteToMove.title}</strong> ({formatMoney(quoteToMove.totalNet)} zł netto) zostanie dodana jako planowany koszt bez podwójnego liczenia w bilansie.
              </p>
              <div>
                <label htmlFor="move-quote-category" className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Kategoria kosztu
                </label>
                <select
                  id="move-quote-category"
                  value={moveQuoteCategory}
                  onChange={(e) => setMoveQuoteCategory(e.target.value as CostCategory)}
                  className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
                >
                  {COST_CATEGORIES.map((cat) => (
                    <option key={cat.value} value={cat.value}>
                      {cat.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  ref={moveQuoteCancelRef}
                  type="button"
                  onClick={() => setMoveQuoteModalId(null)}
                  className="px-3 py-1.5 rounded border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300"
                >
                  Anuluj
                </button>
                <button
                  type="button"
                  onClick={handleConfirmMoveQuoteToCost}
                  className="px-4 py-1.5 rounded bg-purple-700 hover:bg-purple-800 text-white font-semibold"
                >
                  Przenieś do kosztów
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      <DiscardChangesModal
        isOpen={isDiscardModalOpen}
        onCancel={cancelDiscard}
        onConfirm={confirmDiscard}
      />
    </div>
  );
};
