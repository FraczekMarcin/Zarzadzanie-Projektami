import React, { useState, useMemo, useRef, useEffect, useId, Suspense, lazy } from 'react';
import type {
  Company,
  CostCategory,
  CostItem,
  PaymentTranche,
  Project,
  QuotationItem,
  Task,
  TaskStatus,
  User,
} from '../types';
import type { FinancePatchSaveResult } from '../hooks/useServerSync';
import { canEditFinance } from '../utils/access';
import { isPaymentOverdue } from '../utils/finance';
import { calcGrossFromNet } from '../utils/money';
import { getTodayIso } from '../utils/today';
import { useFocusTrap } from '../utils/useFocusTrap';
import { useVariables } from '../hooks/useVariables';
import {
  EconomyAmountMode,
  EconomyCompanyFilter,
  EconomySortDirection,
  EconomySortKey,
  PaymentItemKind,
  PaymentScheduleCandidate,
  buildEconomyRows,
  buildProjectPatchWithScheduledTask,
  computeEconomyTotals,
  exportEconomyCsv,
  filterEconomyRows,
  formatPln,
  formatSignedPln,
  getAvailableEconomyYears,
  getProjectPaymentCandidates,
  getUpcomingUnscheduledPayments,
  loadEconomyAmountsPref,
  saveEconomyAmountsPref,
  schedulePaymentItemOnServer,
  sortEconomyRows,
} from '../utils/economy';
import {
  ArrowLeft,
  ArrowUpDown,
  Building2,
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Edit3,
  ExternalLink,
  Link2,
  Lock,
  Search,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react';

const ProjectFinancialsModal = lazy(() =>
  import('./ProjectFinancialsModal').then((m) => ({ default: m.ProjectFinancialsModal }))
);

const PAGE_SIZE = 50;

const PROJECT_STATUS_LABELS: Record<Project['status'], string> = {
  planning: 'Planowany',
  active: 'Aktywny',
  on_hold: 'Wstrzymany',
  completed: 'Zakończony',
};

const QUOTATION_STATUS_LABELS: Record<QuotationItem['status'], string> = {
  draft: 'Szkic',
  sent: 'Wysłana',
  accepted: 'Zaakceptowana',
  rejected: 'Odrzucona',
  invoiced: 'Zafakturowana',
};

const COST_CATEGORY_LABELS: Record<CostCategory, string> = {
  mapa: 'Mapa (MDCP)',
  geologia: 'Geologia',
  uzgodnienia: 'Uzgodnienia',
  podwykonawca: 'Podwykonawca',
  oplaty_urzedowe: 'Opłaty urzędowe',
  inne: 'Inne',
};

interface EconomyViewProps {
  projects: Project[];
  companies?: Company[];
  tasks: Task[];
  users: User[];
  currentUser: User;
  onUpdateProjectFinance?: (
    projectId: string,
    patch: Partial<Project>,
    expectedRevision?: number
  ) => Promise<FinancePatchSaveResult>;
  onApplyFreshProject?: (freshProject: Project, revision?: number) => void;
  onUpdateProject?: (updatedProject: Project) => void;
  onTaskCreatedFromEconomy?: (createdTask: Task, revision?: number) => void;
  onUpdateTaskStatus?: (taskId: string, newStatus: TaskStatus) => void | Promise<void>;
  onOpenTask?: (task: Task) => void;
  onNotify?: (message: string, type?: 'success' | 'info' | 'error') => void;
}

export const EconomyView: React.FC<EconomyViewProps> = ({
  projects,
  companies = [],
  tasks,
  users,
  currentUser,
  onUpdateProjectFinance,
  onApplyFreshProject,
  onUpdateProject,
  onTaskCreatedFromEconomy,
  onUpdateTaskStatus,
  onOpenTask,
  onNotify,
}) => {
  const { taskTypes } = useVariables();
  const uidPrefix = useId();
  const todayIso = getTodayIso();

  // Filtry i preferencje
  const [companyFilter, setCompanyFilter] = useState<EconomyCompanyFilter>('all');
  const [yearFilter, setYearFilter] = useState<number | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<Project['status'] | 'all'>('all');
  const [showArchived, setShowArchived] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [amountMode, setAmountMode] = useState<EconomyAmountMode>(() => loadEconomyAmountsPref());

  // Sortowanie i paginacja
  const [sortKey, setSortKey] = useState<EconomySortKey>('key');
  const [sortDir, setSortDir] = useState<EconomySortDirection>('asc');
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Widok szczegółów projektu
  const [selectedDetailProjectId, setSelectedDetailProjectId] = useState<string | null>(null);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const [highlightedCostId, setHighlightedCostId] = useState<string | null>(null);

  // Modal finansów projektu
  const [financialsModalState, setFinancialsModalState] = useState<{
    projectId: string;
    initialTab: 'quotations' | 'costs' | 'client' | 'summary';
  } | null>(null);

  // Stan operacji asynchronicznych i blokady duplikatów
  const inFlightKeysRef = useRef<Set<string>>(new Set());
  const [busyItemKey, setBusyItemKey] = useState<string | null>(null);

  // Masowe dodawanie nadchodzących płatności
  const [bulkModalItems, setBulkModalItems] = useState<PaymentScheduleCandidate[] | null>(null);
  const [bulkSelectedKeys, setBulkSelectedKeys] = useState<Set<string>>(new Set());
  const [isBulkSaving, setIsBulkSaving] = useState<boolean>(false);
  const bulkModalRef = useRef<HTMLDivElement>(null);

  // Propozycja zamknięcia powiązanego zadania po oznaczeniu płatności jako zapłaconej
  const [closeTaskPromptTasks, setCloseTaskPromptTasks] = useState<Task[] | null>(null);
  const closeTaskModalRef = useRef<HTMLDivElement>(null);

  useFocusTrap({
    isOpen: Boolean(bulkModalItems),
    containerRef: bulkModalRef,
    onClose: () => {
      if (!isBulkSaving) setBulkModalItems(null);
    },
  });

  useFocusTrap({
    isOpen: Boolean(closeTaskPromptTasks && closeTaskPromptTasks.length > 0),
    containerRef: closeTaskModalRef,
    onClose: () => setCloseTaskPromptTasks(null),
  });

  const defaultTaskType = useMemo(() => {
    const def = taskTypes.find((t) => t.isDefault) || taskTypes[0];
    return def?.id || 'rysunek';
  }, [taskTypes]);

  const activeCompanies = useMemo(
    () => companies.filter((c) => c.isActive).sort((a, b) => a.letter.localeCompare(b.letter, 'pl')),
    [companies]
  );

  const tasksById = useMemo(() => {
    const map = new Map<string, Task>();
    for (const t of tasks) {
      if (t && t.id) map.set(t.id, t);
    }
    return map;
  }, [tasks]);

  const usersById = useMemo(() => {
    const map = new Map<string, User>();
    for (const u of users) {
      if (u && u.id) map.set(u.id, u);
    }
    return map;
  }, [users]);

  const baseRows = useMemo(
    () => buildEconomyRows(projects, companies, currentUser, todayIso),
    [projects, companies, currentUser, todayIso]
  );

  const availableYears = useMemo(() => getAvailableEconomyYears(baseRows), [baseRows]);

  const filteredRows = useMemo(
    () =>
      filterEconomyRows(baseRows, {
        companyFilter,
        year: yearFilter,
        status: statusFilter,
        showArchived,
        search: searchQuery,
      }),
    [baseRows, companyFilter, yearFilter, statusFilter, showArchived, searchQuery]
  );

  const sortedRows = useMemo(
    () => sortEconomyRows(filteredRows, sortKey, sortDir, amountMode),
    [filteredRows, sortKey, sortDir, amountMode]
  );

  const totals = useMemo(() => computeEconomyTotals(filteredRows), [filteredRows]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);

  const paginatedRows = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return sortedRows.slice(start, start + PAGE_SIZE);
  }, [sortedRows, safePage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [companyFilter, yearFilter, statusFilter, showArchived, searchQuery, sortKey, sortDir]);

  const selectedDetailRow = useMemo(
    () =>
      selectedDetailProjectId
        ? baseRows.find((r) => r.project.id === selectedDetailProjectId) || null
        : null,
    [baseRows, selectedDetailProjectId]
  );

  useEffect(() => {
    if (selectedDetailProjectId && selectedDetailRow) {
      const id = window.requestAnimationFrame(() => {
        detailHeadingRef.current?.focus();
      });
      return () => window.cancelAnimationFrame(id);
    }
  }, [selectedDetailProjectId]);

  const financialsModalProject = useMemo(
    () =>
      financialsModalState
        ? baseRows.find((r) => r.project.id === financialsModalState.projectId)?.project || null
        : null,
    [baseRows, financialsModalState]
  );

  const bulkAllCandidates = useMemo(
    () =>
      getUpcomingUnscheduledPayments(
        filteredRows.map((r) => r.project),
        tasksById,
        currentUser,
        todayIso
      ),
    [filteredRows, tasksById, currentUser, todayIso]
  );

  const handleChangeAmountMode = (mode: EconomyAmountMode) => {
    setAmountMode(mode);
    saveEconomyAmountsPref(mode);
  };

  const handleSort = (key: EconomySortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const getAriaSort = (key: EconomySortKey): 'ascending' | 'descending' | 'none' => {
    if (sortKey !== key) return 'none';
    return sortDir === 'asc' ? 'ascending' : 'descending';
  };

  const handleExportCsv = () => {
    const csvContent = exportEconomyCsv(sortedRows, amountMode);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ekonomia-projekty-${todayIso}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    onNotify?.(`Wyeksportowano ${sortedRows.length} projektów do pliku CSV.`, 'success');
  };

  const handleOpenTaskLink = (task: Task) => {
    onOpenTask?.(task);
  };

  const handleScheduleSingleItem = async (
    project: Project,
    candidate: PaymentScheduleCandidate
  ) => {
    if (!canEditFinance(currentUser, project)) {
      onNotify?.('Edycja finansów: administrator i właściciel projektu', 'error');
      return;
    }

    const itemKey = `${project.id}:${candidate.kind}:${candidate.itemId}`;
    if (inFlightKeysRef.current.has(itemKey)) return;

    const existing = candidate.scheduledTaskId ? tasksById.get(candidate.scheduledTaskId) : undefined;
    if (existing) {
      handleOpenTaskLink(existing);
      return;
    }

    inFlightKeysRef.current.add(itemKey);
    setBusyItemKey(itemKey);
    try {
      const res = await schedulePaymentItemOnServer({
        project,
        candidate,
        existingTasks: tasks,
        defaultTaskType,
        amountMode,
      });

      if (!res.ok) {
        onNotify?.(
          res.rolledBack
            ? `${res.error || 'Nie udało się zapisać powiązania.'} Utworzone zadanie zostało wycofane.`
            : res.error || 'Nie udało się dodać płatności do harmonogramu.',
          'error'
        );
        return;
      }

      if (res.alreadyScheduled && res.task) {
        handleOpenTaskLink(res.task);
        return;
      }

      if (res.task) {
        onTaskCreatedFromEconomy?.(res.task, res.revision);
      }
      if (res.project) {
        onApplyFreshProject?.(res.project, res.revision);
      }
      onNotify?.(`Dodano płatność "${candidate.title}" do harmonogramu.`, 'success');
    } finally {
      inFlightKeysRef.current.delete(itemKey);
      setBusyItemKey(null);
    }
  };

  const openBulkScheduleModal = (targetProjects: Project[]) => {
    const candidates = getUpcomingUnscheduledPayments(
      targetProjects,
      tasksById,
      currentUser,
      todayIso
    );
    if (candidates.length === 0) {
      onNotify?.('Brak nadchodzących, nieopłaconych płatności do dodania do harmonogramu.', 'info');
      return;
    }
    setBulkSelectedKeys(
      new Set(candidates.map((c) => `${c.projectId}:${c.kind}:${c.itemId}`))
    );
    setBulkModalItems(candidates);
  };

  const handleConfirmBulkSchedule = async () => {
    if (!bulkModalItems || isBulkSaving) return;
    const chosen = bulkModalItems.filter((c) =>
      bulkSelectedKeys.has(`${c.projectId}:${c.kind}:${c.itemId}`)
    );
    if (chosen.length === 0) {
      setBulkModalItems(null);
      return;
    }

    setIsBulkSaving(true);
    let createdCount = 0;
    let failedCount = 0;

    try {
      // Grupuj po projekcie, aby używać aktualnej rewizji projektu i wykonać jeden PATCH na projekt
      const byProject = new Map<string, PaymentScheduleCandidate[]>();
      for (const item of chosen) {
        const list = byProject.get(item.projectId) || [];
        list.push(item);
        byProject.set(item.projectId, list);
      }

      for (const [projId, items] of byProject.entries()) {
        const project = projects.find((p) => p.id === projId);
        if (!project || !canEditFinance(currentUser, project)) {
          failedCount += items.length;
          continue;
        }

        const createdPairs: Array<{ item: PaymentScheduleCandidate; task: Task }> = [];
        for (const item of items) {
          if (item.scheduledTaskId && tasksById.has(item.scheduledTaskId)) {
            continue;
          }
          const postRes = await fetch('/api/tasks', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              projectId: project.id,
              title: `Płatność: ${item.title} (${formatPln(amountMode === 'gross' ? item.amountGross : item.amountNet)}, ${item.direction})`.slice(0, 200),
              description: `Płatność w projekcie [${project.key}] ${project.name}: ${item.title}. Termin płatności: ${item.dueDate}.`,
              startDate: item.dueDate,
              dueDate: item.dueDate,
              durationDays: 1,
              type: defaultTaskType,
              priority: 'normal',
              status: 'to_do',
              progress: 0,
              ...(project.ownerId ? { assigneeId: project.ownerId } : {}),
              tags: ['płatność'],
              ...(item.kind === 'cost' ? { costIds: [item.itemId] } : {}),
            }),
          });
          const postData = await postRes.json().catch(() => ({}));
          if (!postRes.ok || !postData?.task?.id) {
            failedCount += 1;
            continue;
          }
          createdPairs.push({ item, task: postData.task as Task });
        }

        if (createdPairs.length === 0) continue;

        const patch = buildProjectPatchWithScheduledTask(
          project,
          createdPairs.map((pair) => ({
            kind: pair.item.kind,
            itemId: pair.item.itemId,
            taskId: pair.task.id,
          }))
        );

        const patchRes = await fetch(`/api/projects/${encodeURIComponent(project.id)}`, {
          method: 'PATCH',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'If-Match': String(project.revision || 1),
          },
          body: JSON.stringify(patch),
        });
        const patchData = await patchRes.json().catch(() => ({}));

        if (!patchRes.ok || !patchData?.project) {
          // Cofnij nowo utworzone zadania tego projektu, by uniknąć niespójności
          for (const pair of createdPairs) {
            await fetch(`/api/tasks/${encodeURIComponent(pair.task.id)}`, {
              method: 'DELETE',
              credentials: 'same-origin',
            }).catch(() => {});
          }
          failedCount += createdPairs.length;
        } else {
          const patchRev =
            typeof patchData.revision === 'number' ? patchData.revision : undefined;
          for (const pair of createdPairs) {
            onTaskCreatedFromEconomy?.(pair.task, patchRev);
          }
          onApplyFreshProject?.(patchData.project as Project, patchRev);
          createdCount += createdPairs.length;
        }
      }

      if (createdCount > 0 && failedCount === 0) {
        onNotify?.(`Dodano ${createdCount} płatności do harmonogramu.`, 'success');
      } else if (createdCount > 0) {
        onNotify?.(
          `Dodano ${createdCount} płatności do harmonogramu (${failedCount} nie udało się zapisać).`,
          'info'
        );
      } else if (failedCount > 0) {
        onNotify?.('Nie udało się dodać wybranych płatności do harmonogramu.', 'error');
      }
      setBulkModalItems(null);
    } finally {
      setIsBulkSaving(false);
    }
  };

  const handleMarkItemPaid = async (
    project: Project,
    kind: PaymentItemKind,
    itemId: string
  ) => {
    if (!canEditFinance(currentUser, project) || !onUpdateProjectFinance) return;
    const itemKey = `${project.id}:paid:${kind}:${itemId}`;
    if (inFlightKeysRef.current.has(itemKey)) return;

    let linkedTaskId: string | undefined;
    const patch: Partial<Project> = {};

    if (kind === 'cost') {
      const target = (project.costs || []).find((c) => c.id === itemId);
      if (!target) return;
      linkedTaskId = target.scheduledTaskId;
      patch.costs = (project.costs || []).map((c: CostItem) =>
        c.id === itemId
          ? { ...c, isPaid: true, status: 'paid', paidAt: c.paidAt || todayIso }
          : c
      );
    } else if (kind === 'tranche') {
      const target = (project.paymentTranches || []).find((t) => t.id === itemId);
      if (!target) return;
      linkedTaskId = target.scheduledTaskId;
      patch.paymentTranches = (project.paymentTranches || []).map((t: PaymentTranche) =>
        t.id === itemId
          ? {
              ...t,
              isPaid: true,
              paidAt: t.paidAt || todayIso,
              paidAmount: t.paidAmount !== undefined ? t.paidAmount : t.amountNet,
            }
          : t
      );
    } else {
      const target = (project.quotations || []).find((q) => q.id === itemId);
      if (!target) return;
      linkedTaskId = target.scheduledTaskId;
      patch.quotations = (project.quotations || []).map((q: QuotationItem) =>
        q.id === itemId
          ? {
              ...q,
              isPaid: true,
              paidAt: q.paidAt || todayIso,
              paidAmount: q.paidAmount !== undefined ? q.paidAmount : q.totalNet,
            }
          : q
      );
    }

    inFlightKeysRef.current.add(itemKey);
    setBusyItemKey(itemKey);
    try {
      const res = await onUpdateProjectFinance(project.id, patch, project.revision || 1);
      if (!res.ok) {
        onNotify?.(res.error || 'Nie udało się oznaczyć pozycji jako zapłaconej.', 'error');
        return;
      }
      onNotify?.('Pozycja została oznaczona jako zapłacona.', 'success');

      if (linkedTaskId) {
        const linkedTask = tasksById.get(linkedTaskId);
        if (linkedTask && linkedTask.status !== 'done') {
          setCloseTaskPromptTasks([linkedTask]);
        }
      }
    } finally {
      inFlightKeysRef.current.delete(itemKey);
      setBusyItemKey(null);
    }
  };

  const handlePromptCloseTasksFromModal = (linkedTaskIds: string[]) => {
    const openTasks = linkedTaskIds
      .map((id) => tasksById.get(id))
      .filter((t): t is Task => Boolean(t && t.status !== 'done'));
    if (openTasks.length > 0) {
      setCloseTaskPromptTasks(openTasks);
    }
  };

  const handleConfirmCloseLinkedTasks = async () => {
    if (!closeTaskPromptTasks || !onUpdateTaskStatus) {
      setCloseTaskPromptTasks(null);
      return;
    }
    const targetTasks = closeTaskPromptTasks;
    setCloseTaskPromptTasks(null);
    for (const task of targetTasks) {
      await onUpdateTaskStatus(task.id, 'done');
    }
    onNotify?.(
      targetTasks.length === 1
        ? `Zamknięto powiązane zadanie [${targetTasks[0].code}].`
        : `Zamknięto ${targetTasks.length} powiązane zadania w harmonogramie.`,
      'success'
    );
  };

  const renderScheduleAction = (
    project: Project,
    canEdit: boolean,
    kind: PaymentItemKind,
    itemId: string,
    title: string,
    amountNet: number,
    amountGross: number,
    dueDate: string | undefined,
    direction: 'wydatek' | 'wpływ',
    isPaid: boolean,
    scheduledTaskId?: string
  ) => {
    const trimmedDate = dueDate?.trim() || '';
    const linkedTask = scheduledTaskId ? tasksById.get(scheduledTaskId) : undefined;
    const modalTab = kind === 'cost' ? 'costs' : 'quotations';
    const busyKey = `${project.id}:${kind}:${itemId}`;
    const isBusy = busyItemKey === busyKey;

    if (linkedTask) {
      return (
        <a
          href={`?task=${encodeURIComponent(linkedTask.id)}`}
          onClick={(e) => {
            e.preventDefault();
            handleOpenTaskLink(linkedTask);
          }}
          className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition-colors"
          title={`Otwórz zadanie [${linkedTask.code}] ${linkedTask.title}`}
        >
          <CheckCircle2 className="w-3 h-3 shrink-0" aria-hidden="true" />
          <span>W harmonogramie</span>
          <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
        </a>
      );
    }

    if (!trimmedDate) {
      if (!canEdit) {
        return (
          <span className="text-[11px] text-slate-600 dark:text-slate-400">Brak terminu</span>
        );
      }
      return (
        <button
          type="button"
          onClick={() => setFinancialsModalState({ projectId: project.id, initialTab: modalTab })}
          className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
        >
          <CalendarClock className="w-3 h-3 shrink-0" aria-hidden="true" />
          <span>Ustaw termin</span>
        </button>
      );
    }

    if (!canEdit) {
      return null;
    }

    return (
      <button
        type="button"
        disabled={isBusy}
        onClick={() =>
          handleScheduleSingleItem(project, {
            projectId: project.id,
            projectKey: project.key,
            projectName: project.name,
            kind,
            itemId,
            title,
            amountNet,
            amountGross,
            dueDate: trimmedDate,
            direction,
            isPaid,
            scheduledTaskId,
          })
        }
        className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold bg-sky-700 hover:bg-sky-800 disabled:opacity-60 text-white transition-colors"
      >
        <CalendarPlus className="w-3 h-3 shrink-0" aria-hidden="true" />
        <span>{isBusy ? 'Dodawanie...' : 'Dodaj do harmonogramu'}</span>
      </button>
    );
  };

  // --- WIDOK SZCZEGÓŁÓW PROJEKTU ---
  if (selectedDetailRow) {
    const project = selectedDetailRow.project;
    const canEdit = canEditFinance(currentUser, project);
    const vatRate = project.projectVatRate !== undefined ? Number(project.projectVatRate) : 23;
    const summary = selectedDetailRow.summary;
    const owner = project.ownerId ? usersById.get(project.ownerId) : undefined;

    const valProject = amountMode === 'gross' ? summary.totalRevenueGross : summary.totalRevenueNet;
    const valCosts = amountMode === 'gross' ? summary.totalCostsGross : summary.totalCostsNet;
    const valBalance = amountMode === 'gross' ? summary.profitGross : summary.profitNet;
    const valInflow =
      amountMode === 'gross' ? summary.expectedInflowGross : summary.expectedInflowNet;
    const valOutflow =
      amountMode === 'gross' ? summary.expectedOutflowGross : summary.expectedOutflowNet;
    const valForecast =
      amountMode === 'gross'
        ? selectedDetailRow.expectedBalanceGross
        : selectedDetailRow.expectedBalanceNet;

    const baseContractAmount =
      amountMode === 'gross' ? summary.baseProjectValueGross : summary.baseProjectValueNet;
    const isBasePaid =
      project.isBaseContractPaid !== undefined
        ? Boolean(project.isBaseContractPaid)
        : project.status === 'completed';

    const tranches = project.paymentTranches || [];
    const quotations = project.quotations || [];
    const selectedRevenueQuotes = quotations.filter(
      (q) => q.isSelected !== false && q.type !== 'koszt'
    );
    const selectedCostQuotes = quotations.filter(
      (q) => q.isSelected !== false && q.type === 'koszt'
    );
    const costs = project.costs || [];
    const costsById = new Map(costs.map((c) => [c.id, c]));

    const upcomingForProject = canEdit
      ? getUpcomingUnscheduledPayments([project], tasksById, currentUser, todayIso)
      : [];

    return (
      <section aria-labelledby={`${uidPrefix}-detail-heading`} className="space-y-4">
        {/* Pasek powrotu i akcji */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => {
                setSelectedDetailProjectId(null);
                setHighlightedCostId(null);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 border border-slate-300 dark:border-slate-700 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Powrót do listy</span>
            </button>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {selectedDetailRow.company && (
                  <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950/70 text-indigo-800 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                    {selectedDetailRow.company.letter} - {selectedDetailRow.company.name}
                  </span>
                )}
                <span className="text-xs px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium">
                  {PROJECT_STATUS_LABELS[project.status] || project.status}
                </span>
                {project.isArchived && (
                  <span className="text-xs px-2 py-0.5 rounded bg-purple-100 dark:bg-purple-950/60 text-purple-800 dark:text-purple-200 font-semibold">
                    Archiwalny
                  </span>
                )}
              </div>
              <h2
                id={`${uidPrefix}-detail-heading`}
                ref={detailHeadingRef}
                tabIndex={-1}
                className="text-base sm:text-lg font-bold text-slate-900 dark:text-white mt-1 focus:outline-none"
              >
                [{project.key}] {project.name}
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Zamawiający: <strong className="text-slate-800 dark:text-slate-200">{selectedDetailRow.clientNameDisplay}</strong>
                {owner ? ` · Właściciel: ${owner.name}` : ''}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Przełącznik netto/brutto */}
            <div
              role="group"
              aria-label="Tryb kwot"
              className="inline-flex items-center rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-0.5"
            >
              <button
                type="button"
                aria-pressed={amountMode === 'net'}
                onClick={() => handleChangeAmountMode('net')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                  amountMode === 'net'
                    ? 'bg-sky-700 text-white shadow-2xs'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                Netto
              </button>
              <button
                type="button"
                aria-pressed={amountMode === 'gross'}
                onClick={() => handleChangeAmountMode('gross')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                  amountMode === 'gross'
                    ? 'bg-sky-700 text-white shadow-2xs'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                Brutto
              </button>
            </div>

            {canEdit ? (
              <>
                <button
                  type="button"
                  onClick={() => openBulkScheduleModal([project])}
                  disabled={upcomingForProject.length === 0}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600 disabled:opacity-50 text-white transition-colors"
                >
                  <CalendarPlus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>
                    Dodaj wszystkie nadchodzące płatności do harmonogramu ({upcomingForProject.length})
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setFinancialsModalState({ projectId: project.id, initialTab: 'quotations' })
                  }
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-sky-700 hover:bg-sky-800 text-white transition-colors shadow-2xs"
                >
                  <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Edytuj finanse</span>
                </button>
              </>
            ) : (
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700">
                <Lock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>Edycja finansów: administrator i właściciel projektu</span>
              </div>
            )}
          </div>
        </div>

        {/* 6 kart podsumowania */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-2xs">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
              Wartość projektu ({amountMode === 'gross' ? 'brutto' : 'netto'})
            </div>
            <div className="text-lg font-bold text-slate-900 dark:text-white mt-1 tabular-nums">
              {formatPln(valProject)}
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-2xs">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
              Koszty ({amountMode === 'gross' ? 'brutto' : 'netto'})
            </div>
            <div className="text-lg font-bold text-slate-900 dark:text-white mt-1 tabular-nums">
              {formatPln(valCosts)}
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-2xs">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
              Bilans ({amountMode === 'gross' ? 'brutto' : 'netto'})
            </div>
            <div
              className={`text-lg font-bold mt-1 tabular-nums flex items-center gap-1.5 ${
                valBalance >= 0
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-rose-700 dark:text-rose-400'
              }`}
            >
              {valBalance >= 0 ? (
                <TrendingUp className="w-4 h-4 shrink-0" aria-hidden="true" />
              ) : (
                <TrendingDown className="w-4 h-4 shrink-0" aria-hidden="true" />
              )}
              <span>{formatSignedPln(valBalance)}</span>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-2xs">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
              Oczekiwane wpływy
            </div>
            <div className="text-lg font-bold text-emerald-700 dark:text-emerald-400 mt-1 tabular-nums">
              +{formatPln(valInflow)}
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-2xs">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
              Oczekiwane wydatki
            </div>
            <div className="text-lg font-bold text-rose-700 dark:text-rose-400 mt-1 tabular-nums">
              -{formatPln(valOutflow)}
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-2xs">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
              Bilans prognozowany
            </div>
            <div
              className={`text-lg font-bold mt-1 tabular-nums flex items-center gap-1.5 ${
                valForecast >= 0
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-rose-700 dark:text-rose-400'
              }`}
            >
              {valForecast >= 0 ? (
                <TrendingUp className="w-4 h-4 shrink-0" aria-hidden="true" />
              ) : (
                <TrendingDown className="w-4 h-4 shrink-0" aria-hidden="true" />
              )}
              <span>{formatSignedPln(valForecast)}</span>
            </div>
          </div>
        </div>

        {/* Dwie listy: Przychody oraz Koszty */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {/* PRZYCHODY */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2.5">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                <span>Przychody</span>
              </h3>
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200 tabular-nums">
                Razem: {formatPln(valProject)}
              </span>
            </div>

            {/* Wartość umowy */}
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3 space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-900 dark:text-white">
                  Wartość umowy (umowa bazowa)
                </span>
                <span className="text-xs font-bold text-slate-900 dark:text-white tabular-nums">
                  {formatPln(baseContractAmount)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600 dark:text-slate-400">
                <span>
                  Status:{' '}
                  <strong className="text-slate-800 dark:text-slate-200">
                    {isBasePaid ? 'Opłacona' : 'Nierozliczona'}
                  </strong>
                </span>
                <span>Termin płatności: Brak osobnego terminu</span>
                <span>
                  Zapłacono:{' '}
                  <strong className={isBasePaid ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-800 dark:text-slate-200'}>
                    {isBasePaid ? 'Tak' : 'Nie'}
                  </strong>
                </span>
              </div>
            </div>

            {/* Transze płatności */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                Transze płatności ({tranches.length})
              </h4>
              {tranches.length === 0 ? (
                <p className="text-xs text-slate-600 dark:text-slate-400 py-2">
                  Brak zdefiniowanych transz płatności.
                </p>
              ) : (
                <ul className="space-y-2">
                  {tranches.map((t) => {
                    const amountGross =
                      t.amountGross !== undefined
                        ? t.amountGross
                        : calcGrossFromNet(t.amountNet || 0, vatRate);
                    const displayAmount = amountMode === 'gross' ? amountGross : t.amountNet || 0;
                    const overdue = isPaymentOverdue(t.dueDate, t.isPaid, todayIso);
                    return (
                      <li
                        key={t.id}
                        className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 space-y-2"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <span className="text-xs font-bold text-slate-900 dark:text-white">
                              {t.title}
                            </span>
                            <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-slate-600 dark:text-slate-400">
                              <span>
                                Status:{' '}
                                <strong className="text-slate-800 dark:text-slate-200">
                                  {t.isPaid ? 'Zapłacona' : overdue ? 'Po terminie' : 'Planowana'}
                                </strong>
                              </span>
                              <span>
                                Termin płatności:{' '}
                                <strong className="font-mono text-slate-800 dark:text-slate-200">
                                  {t.dueDate || 'Brak'}
                                </strong>
                              </span>
                              <span>
                                Zapłacono:{' '}
                                <strong className={t.isPaid ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-800 dark:text-slate-200'}>
                                  {t.isPaid ? `Tak${t.paidAt ? ` (${t.paidAt})` : ''}` : 'Nie'}
                                </strong>
                              </span>
                              {overdue && (
                                <span className="px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-200 font-semibold">
                                  Po terminie
                                </span>
                              )}
                            </div>
                          </div>
                          <span className="text-xs font-bold text-slate-900 dark:text-white tabular-nums shrink-0">
                            {formatPln(displayAmount)}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {renderScheduleAction(
                            project,
                            canEdit,
                            'tranche',
                            t.id,
                            t.title,
                            t.amountNet || 0,
                            amountGross,
                            t.dueDate,
                            'wpływ',
                            Boolean(t.isPaid),
                            t.scheduledTaskId
                          )}
                          {canEdit && !t.isPaid && (
                            <button
                              type="button"
                              disabled={busyItemKey === `${project.id}:paid:tranche:${t.id}`}
                              onClick={() => handleMarkItemPaid(project, 'tranche', t.id)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white transition-colors"
                            >
                              <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                              <span>Oznacz jako zapłacone</span>
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Wybrane wyceny przychodowe */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                Wybrane wyceny przychodowe ({selectedRevenueQuotes.length})
              </h4>
              {selectedRevenueQuotes.length === 0 ? (
                <p className="text-xs text-slate-600 dark:text-slate-400 py-2">
                  Brak wybranych wycen przychodowych.
                </p>
              ) : (
                <ul className="space-y-2">
                  {selectedRevenueQuotes.map((q) => {
                    const amountGross =
                      q.totalGross !== undefined
                        ? q.totalGross
                        : calcGrossFromNet(q.totalNet || 0, q.vatRate ?? vatRate);
                    const displayAmount = amountMode === 'gross' ? amountGross : q.totalNet || 0;
                    const overdue = isPaymentOverdue(q.dueDate, q.isPaid, todayIso);
                    return (
                      <li
                        key={q.id}
                        className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 space-y-2"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <span className="text-xs font-bold text-slate-900 dark:text-white">
                              {q.title}
                            </span>
                            <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-slate-600 dark:text-slate-400">
                              <span>
                                Status:{' '}
                                <strong className="text-slate-800 dark:text-slate-200">
                                  {QUOTATION_STATUS_LABELS[q.status] || q.status}
                                </strong>
                              </span>
                              <span>
                                Termin płatności:{' '}
                                <strong className="font-mono text-slate-800 dark:text-slate-200">
                                  {q.dueDate || 'Brak'}
                                </strong>
                              </span>
                              <span>
                                Zapłacono:{' '}
                                <strong className={q.isPaid ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-800 dark:text-slate-200'}>
                                  {q.isPaid ? `Tak${q.paidAt ? ` (${q.paidAt})` : ''}` : 'Nie'}
                                </strong>
                              </span>
                              {overdue && (
                                <span className="px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-200 font-semibold">
                                  Po terminie
                                </span>
                              )}
                            </div>
                          </div>
                          <span className="text-xs font-bold text-slate-900 dark:text-white tabular-nums shrink-0">
                            {formatPln(displayAmount)}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {renderScheduleAction(
                            project,
                            canEdit,
                            'quotation',
                            q.id,
                            q.title,
                            q.totalNet || 0,
                            amountGross,
                            q.dueDate,
                            'wpływ',
                            Boolean(q.isPaid),
                            q.scheduledTaskId
                          )}
                          {canEdit && !q.isPaid && (
                            <button
                              type="button"
                              disabled={busyItemKey === `${project.id}:paid:quotation:${q.id}`}
                              onClick={() => handleMarkItemPaid(project, 'quotation', q.id)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white transition-colors"
                            >
                              <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                              <span>Oznacz jako zapłacone</span>
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          {/* KOSZTY */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2.5">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-rose-700 dark:text-rose-400" aria-hidden="true" />
                <span>Koszty</span>
              </h3>
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200 tabular-nums">
                Razem: {formatPln(valCosts)}
              </span>
            </div>

            {/* Pozycje kosztów */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                Pozycje kosztów ({costs.length})
              </h4>
              {costs.length === 0 ? (
                <p className="text-xs text-slate-600 dark:text-slate-400 py-2">
                  Brak zarejestrowanych pozycji kosztów.
                </p>
              ) : (
                <ul className="space-y-2">
                  {costs.map((c) => {
                    const amountGross =
                      c.amountGross !== undefined
                        ? c.amountGross
                        : calcGrossFromNet(c.amountNet || 0, c.vatRate ?? vatRate);
                    const displayAmount = amountMode === 'gross' ? amountGross : c.amountNet || 0;
                    const paid = Boolean(c.isPaid || c.status === 'paid');
                    const statusLabel = paid
                      ? 'Zapłacony'
                      : c.status === 'incurred'
                        ? 'Poniesiony'
                        : 'Planowany';
                    const overdue = isPaymentOverdue(c.dueDate, paid, todayIso);
                    const isHighlighted = highlightedCostId === c.id;
                    return (
                      <li
                        key={c.id}
                        id={`economy-cost-${c.id}`}
                        className={`rounded-lg border p-3 space-y-2 transition-colors ${
                          isHighlighted
                            ? 'border-sky-600 bg-sky-50/70 dark:bg-sky-950/40'
                            : 'border-slate-200 dark:border-slate-800'
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <span className="text-xs font-bold text-slate-900 dark:text-white">
                              {c.title}
                            </span>
                            <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-slate-600 dark:text-slate-400">
                              <span>
                                Kategoria: {COST_CATEGORY_LABELS[c.category] || c.category}
                              </span>
                              {c.contractorName && <span>Wykonawca: {c.contractorName}</span>}
                              <span
                                className={`px-1.5 py-0.5 rounded font-semibold ${
                                  paid
                                    ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-200'
                                    : c.status === 'incurred'
                                      ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200'
                                      : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200'
                                }`}
                              >
                                {statusLabel}
                              </span>
                              <span>
                                Termin płatności:{' '}
                                <strong className="font-mono text-slate-800 dark:text-slate-200">
                                  {c.dueDate || 'Brak'}
                                </strong>
                              </span>
                              {overdue && (
                                <span className="px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-200 font-semibold">
                                  Po terminie
                                </span>
                              )}
                            </div>
                          </div>
                          <span className="text-xs font-bold text-slate-900 dark:text-white tabular-nums shrink-0">
                            {formatPln(displayAmount)}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {renderScheduleAction(
                            project,
                            canEdit,
                            'cost',
                            c.id,
                            c.title,
                            c.amountNet || 0,
                            amountGross,
                            c.dueDate,
                            'wydatek',
                            paid,
                            c.scheduledTaskId
                          )}
                          {canEdit && !paid && (
                            <button
                              type="button"
                              disabled={busyItemKey === `${project.id}:paid:cost:${c.id}`}
                              onClick={() => handleMarkItemPaid(project, 'cost', c.id)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white transition-colors"
                            >
                              <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                              <span>Oznacz jako zapłacone</span>
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Wyceny kosztowe */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                Wyceny kosztowe ({selectedCostQuotes.length})
              </h4>
              {selectedCostQuotes.length === 0 ? (
                <p className="text-xs text-slate-600 dark:text-slate-400 py-2">
                  Brak wycen kosztowych.
                </p>
              ) : (
                <ul className="space-y-2">
                  {selectedCostQuotes.map((q) => {
                    const linkedCost = q.linkedCostId ? costsById.get(q.linkedCostId) : undefined;
                    const amountGross =
                      q.totalGross !== undefined
                        ? q.totalGross
                        : calcGrossFromNet(q.totalNet || 0, q.vatRate ?? vatRate);
                    const displayAmount = amountMode === 'gross' ? amountGross : q.totalNet || 0;
                    const overdue = isPaymentOverdue(q.dueDate, q.isPaid, todayIso);
                    return (
                      <li
                        key={q.id}
                        className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 space-y-2"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-bold text-slate-900 dark:text-white">
                                {q.title}
                              </span>
                              {(q.isChosenOffer || q.linkedCostId) && (
                                <span className="px-1.5 py-0.5 rounded text-[11px] font-semibold bg-indigo-100 dark:bg-indigo-950/60 text-indigo-800 dark:text-indigo-200 border border-indigo-200 dark:border-indigo-800">
                                  Wybrana oferta
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-slate-600 dark:text-slate-400">
                              {q.companyName && <span>Oferent: {q.companyName}</span>}
                              <span>
                                Termin płatności:{' '}
                                <strong className="font-mono text-slate-800 dark:text-slate-200">
                                  {q.dueDate || 'Brak'}
                                </strong>
                              </span>
                              {overdue && !q.linkedCostId && (
                                <span className="px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-200 font-semibold">
                                  Po terminie
                                </span>
                              )}
                            </div>
                          </div>
                          <span className="text-xs font-bold text-slate-900 dark:text-white tabular-nums shrink-0">
                            {formatPln(displayAmount)}
                          </span>
                        </div>

                        {q.linkedCostId ? (
                          <div className="flex flex-wrap items-center gap-2 text-[11px]">
                            <button
                              type="button"
                              onClick={() => {
                                setHighlightedCostId(q.linkedCostId!);
                                const el = document.getElementById(`economy-cost-${q.linkedCostId}`);
                                el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                              }}
                              className="inline-flex items-center gap-1 text-sky-700 dark:text-sky-400 hover:underline font-semibold"
                            >
                              <Link2 className="w-3 h-3" aria-hidden="true" />
                              <span>
                                Powiązany koszt: {linkedCost ? linkedCost.title : q.linkedCostId}
                              </span>
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            {renderScheduleAction(
                              project,
                              canEdit,
                              'quotation',
                              q.id,
                              q.title,
                              q.totalNet || 0,
                              amountGross,
                              q.dueDate,
                              'wydatek',
                              Boolean(q.isPaid),
                              q.scheduledTaskId
                            )}
                            {canEdit && !q.isPaid && (
                              <button
                                type="button"
                                disabled={busyItemKey === `${project.id}:paid:quotation:${q.id}`}
                                onClick={() => handleMarkItemPaid(project, 'quotation', q.id)}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white transition-colors"
                              >
                                <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                                <span>Oznacz jako zapłacone</span>
                              </button>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>

        {/* Modale współdzielone */}
        {renderModals()}
      </section>
    );
  }

  function renderModals() {
    return (
      <>
        {/* Modal masowego dodawania nadchodzących płatności */}
        {bulkModalItems && (
          <div
            className="fixed inset-0 z-60 bg-black/60 backdrop-blur-2xs flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${uidPrefix}-bulk-title`}
          >
            <div
              ref={bulkModalRef}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 max-w-2xl w-full shadow-2xl space-y-4 max-h-[85vh] flex flex-col"
            >
              <div className="flex items-center justify-between gap-3">
                <h3
                  id={`${uidPrefix}-bulk-title`}
                  className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2"
                >
                  <CalendarPlus className="w-4 h-4 text-sky-700 dark:text-sky-400" aria-hidden="true" />
                  <span>Dodaj wszystkie nadchodzące płatności do harmonogramu</span>
                </h3>
                <button
                  type="button"
                  disabled={isBulkSaving}
                  onClick={() => setBulkModalItems(null)}
                  aria-label="Zamknij okno masowego dodawania płatności"
                  className="p-1 rounded text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>

              <p className="text-xs text-slate-600 dark:text-slate-300">
                Poniżej znajduje się lista nieopłaconych płatności z nadchodzącym terminem, które nie są jeszcze powiązane z zadaniem w harmonogramie.
              </p>

              <div className="overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-200 dark:divide-slate-800">
                {bulkModalItems.map((item) => {
                  const key = `${item.projectId}:${item.kind}:${item.itemId}`;
                  const checked = bulkSelectedKeys.has(key);
                  const displayAmount =
                    amountMode === 'gross' ? item.amountGross : item.amountNet;
                  return (
                    <label
                      key={key}
                      className="flex items-center justify-between gap-3 px-3 py-2.5 text-xs cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            setBulkSelectedKeys((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(key);
                              else next.delete(key);
                              return next;
                            });
                          }}
                          className="rounded border-slate-300 dark:border-slate-600"
                        />
                        <span className="min-w-0">
                          <strong className="text-slate-900 dark:text-white block truncate">
                            [{item.projectKey}] {item.title}
                          </strong>
                          <span className="text-[11px] text-slate-600 dark:text-slate-400">
                            Termin: {item.dueDate} · Typ: {item.direction}
                          </span>
                        </span>
                      </span>
                      <span className="font-bold text-slate-900 dark:text-white tabular-nums shrink-0">
                        {formatPln(displayAmount)}
                      </span>
                    </label>
                  );
                })}
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  disabled={isBulkSaving}
                  onClick={() => setBulkModalItems(null)}
                  className="px-3 py-1.5 rounded text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Anuluj
                </button>
                <button
                  type="button"
                  disabled={isBulkSaving || bulkSelectedKeys.size === 0}
                  onClick={handleConfirmBulkSchedule}
                  className="px-4 py-1.5 rounded bg-sky-700 hover:bg-sky-800 disabled:opacity-60 text-white text-xs font-semibold shadow-2xs"
                >
                  {isBulkSaving
                    ? 'Dodawanie...'
                    : `Potwierdź i dodaj (${bulkSelectedKeys.size})`}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal propozycji zamknięcia powiązanego zadania po zapłacie */}
        {closeTaskPromptTasks && closeTaskPromptTasks.length > 0 && (
          <div
            className="fixed inset-0 z-60 bg-black/60 backdrop-blur-2xs flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${uidPrefix}-close-task-title`}
          >
            <div
              ref={closeTaskModalRef}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 max-w-md w-full shadow-2xl space-y-3"
            >
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="w-5 h-5 shrink-0" aria-hidden="true" />
                <h3
                  id={`${uidPrefix}-close-task-title`}
                  className="text-sm font-bold text-slate-900 dark:text-white"
                >
                  Zamknąć powiązane zadanie w harmonogramie?
                </h3>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                Pozycja została oznaczona jako zapłacona. Czy ustawić status powiązanego zadania na{' '}
                <strong>Zakończone (done)</strong>?
              </p>
              <ul className="text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 space-y-1">
                {closeTaskPromptTasks.map((t) => (
                  <li key={t.id} className="font-medium text-slate-900 dark:text-white">
                    [{t.code}] {t.title}
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setCloseTaskPromptTasks(null)}
                  className="px-3 py-1.5 rounded text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Zostaw otwarte
                </button>
                <button
                  type="button"
                  onClick={handleConfirmCloseLinkedTasks}
                  className="px-3.5 py-1.5 rounded bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold shadow-2xs"
                >
                  Tak, zamknij zadanie
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal edycji finansów (ProjectFinancialsModal) */}
        {financialsModalState && financialsModalProject && (
          <Suspense fallback={null}>
            <ProjectFinancialsModal
              isOpen={true}
              onClose={() => setFinancialsModalState(null)}
              project={financialsModalProject}
              companies={companies}
              tasks={tasks}
              currentUser={currentUser}
              isAdmin={currentUser.role === 'admin'}
              initialTab={financialsModalState.initialTab}
              onSaveFinancePatch={onUpdateProjectFinance}
              onRefreshProject={(fresh) => {
                onApplyFreshProject?.(fresh);
              }}
              onSaveProject={(updated) => {
                onUpdateProject?.(updated);
                setFinancialsModalState(null);
              }}
              onItemsMarkedPaid={handlePromptCloseTasksFromModal}
            />
          </Suspense>
        )}
      </>
    );
  }

  const visibleStart = sortedRows.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const visibleEnd = Math.min(sortedRows.length, safePage * PAGE_SIZE);

  return (
    <section aria-labelledby={`${uidPrefix}-heading`} className="space-y-4">
      {/* Nagłówek widoku Ekonomia */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2
              id={`${uidPrefix}-heading`}
              className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2"
            >
              <Wallet className="w-5 h-5 text-sky-700 dark:text-sky-400" aria-hidden="true" />
              <span>Ekonomia i finanse firm</span>
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
              Zestawienie przychodów, kosztów, bilansu oraz nadchodzących płatności w podziale na firmy.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Przełącznik Netto / Brutto */}
            <div
              role="group"
              aria-label="Tryb wyświetlania kwot"
              className="inline-flex items-center rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-0.5"
            >
              <button
                type="button"
                aria-pressed={amountMode === 'net'}
                onClick={() => handleChangeAmountMode('net')}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                  amountMode === 'net'
                    ? 'bg-sky-700 text-white shadow-2xs'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                Netto
              </button>
              <button
                type="button"
                aria-pressed={amountMode === 'gross'}
                onClick={() => handleChangeAmountMode('gross')}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                  amountMode === 'gross'
                    ? 'bg-sky-700 text-white shadow-2xs'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                Brutto
              </button>
            </div>

            {bulkAllCandidates.length > 0 && (
              <button
                type="button"
                onClick={() => openBulkScheduleModal(filteredRows.map((r) => r.project))}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600 text-white transition-colors"
              >
                <CalendarPlus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>
                  Dodaj wszystkie nadchodzące płatności do harmonogramu ({bulkAllCandidates.length})
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 border border-slate-300 dark:border-slate-700 transition-colors"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Eksportuj CSV</span>
            </button>
          </div>
        </div>

        {/* Przełącznik firm (zakładki) */}
        <div
          role="tablist"
          aria-label="Podział projektów według firmy"
          className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 dark:border-slate-800 pb-3"
        >
          <button
            type="button"
            role="tab"
            aria-selected={companyFilter === 'all'}
            onClick={() => setCompanyFilter('all')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              companyFilter === 'all'
                ? 'bg-sky-700 text-white shadow-2xs'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Wszystkie</span>
          </button>

          {activeCompanies.map((comp) => (
            <button
              key={comp.id}
              type="button"
              role="tab"
              aria-selected={companyFilter === comp.id}
              onClick={() => setCompanyFilter(comp.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                companyFilter === comp.id
                  ? 'bg-sky-700 text-white shadow-2xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <span>
                {comp.letter} - {comp.name}
              </span>
            </button>
          ))}

          <button
            type="button"
            role="tab"
            aria-selected={companyFilter === 'none'}
            onClick={() => setCompanyFilter('none')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              companyFilter === 'none'
                ? 'bg-sky-700 text-white shadow-2xs'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <span>Bez firmy</span>
          </button>
        </div>

        {/* Filtry: rok, status, archiwum, szukaj */}
        <div className="flex flex-wrap items-end gap-3 text-xs">
          <div className="flex flex-col gap-1">
            <label
              htmlFor={`${uidPrefix}-filter-year`}
              className="text-[11px] font-semibold text-slate-700 dark:text-slate-300"
            >
              Rok
            </label>
            <select
              id={`${uidPrefix}-filter-year`}
              value={yearFilter === 'all' ? 'all' : String(yearFilter)}
              onChange={(e) =>
                setYearFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))
              }
              className="bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
            >
              <option value="all">Wszystkie lata</option>
              {availableYears.map((yr) => (
                <option key={yr} value={String(yr)}>
                  {yr}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor={`${uidPrefix}-filter-status`}
              className="text-[11px] font-semibold text-slate-700 dark:text-slate-300"
            >
              Status projektu
            </label>
            <select
              id={`${uidPrefix}-filter-status`}
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter((e.target.value as Project['status'] | 'all') || 'all')
              }
              className="bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
            >
              <option value="all">Wszystkie statusy</option>
              <option value="planning">Planowany</option>
              <option value="active">Aktywny</option>
              <option value="on_hold">Wstrzymany</option>
              <option value="completed">Zakończony</option>
            </select>
          </div>

          <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
            <label
              htmlFor={`${uidPrefix}-filter-search`}
              className="text-[11px] font-semibold text-slate-700 dark:text-slate-300"
            >
              Szukaj (numer lub nazwa)
            </label>
            <div className="relative">
              <Search
                className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2"
                aria-hidden="true"
              />
              <input
                id={`${uidPrefix}-filter-search`}
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Np. 2026-1_A lub Hala..."
                className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <label className="inline-flex items-center gap-2 py-1.5 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-xs font-medium text-slate-800 dark:text-slate-200 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="rounded border-slate-300 dark:border-slate-600"
            />
            <span>Pokaż zarchiwizowane</span>
          </label>
        </div>
      </div>

      {/* Tabela listy projektów */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <caption className="sr-only">
              Zestawienie ekonomiczne projektów ({amountMode === 'gross' ? 'kwoty brutto' : 'kwoty netto'}), wiersze: {filteredRows.length}
            </caption>
            <thead className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200">
              <tr>
                <th scope="col" aria-sort={getAriaSort('key')} className="px-3 py-2.5 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => handleSort('key')}
                    className="inline-flex items-center gap-1 font-bold hover:text-sky-700 dark:hover:text-sky-400"
                  >
                    <span>Numer</span>
                    <ArrowUpDown className="w-3 h-3" aria-hidden="true" />
                  </button>
                </th>
                <th scope="col" aria-sort={getAriaSort('name')} className="px-3 py-2.5 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => handleSort('name')}
                    className="inline-flex items-center gap-1 font-bold hover:text-sky-700 dark:hover:text-sky-400"
                  >
                    <span>Nazwa</span>
                    <ArrowUpDown className="w-3 h-3" aria-hidden="true" />
                  </button>
                </th>
                <th scope="col" aria-sort={getAriaSort('clientName')} className="px-3 py-2.5 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => handleSort('clientName')}
                    className="inline-flex items-center gap-1 font-bold hover:text-sky-700 dark:hover:text-sky-400"
                  >
                    <span>Zamawiający</span>
                    <ArrowUpDown className="w-3 h-3" aria-hidden="true" />
                  </button>
                </th>
                <th scope="col" aria-sort={getAriaSort('value')} className="px-3 py-2.5 whitespace-nowrap text-right">
                  <button
                    type="button"
                    onClick={() => handleSort('value')}
                    className="inline-flex items-center justify-end gap-1 font-bold hover:text-sky-700 dark:hover:text-sky-400 w-full"
                  >
                    <span>Wartość projektu</span>
                    <ArrowUpDown className="w-3 h-3" aria-hidden="true" />
                  </button>
                </th>
                <th scope="col" aria-sort={getAriaSort('costs')} className="px-3 py-2.5 whitespace-nowrap text-right">
                  <button
                    type="button"
                    onClick={() => handleSort('costs')}
                    className="inline-flex items-center justify-end gap-1 font-bold hover:text-sky-700 dark:hover:text-sky-400 w-full"
                  >
                    <span>Koszty</span>
                    <ArrowUpDown className="w-3 h-3" aria-hidden="true" />
                  </button>
                </th>
                <th scope="col" aria-sort={getAriaSort('balance')} className="px-3 py-2.5 whitespace-nowrap text-right">
                  <button
                    type="button"
                    onClick={() => handleSort('balance')}
                    className="inline-flex items-center justify-end gap-1 font-bold hover:text-sky-700 dark:hover:text-sky-400 w-full"
                  >
                    <span>Bilans</span>
                    <ArrowUpDown className="w-3 h-3" aria-hidden="true" />
                  </button>
                </th>
                <th scope="col" aria-sort={getAriaSort('expectedBalance')} className="px-3 py-2.5 whitespace-nowrap text-right">
                  <button
                    type="button"
                    onClick={() => handleSort('expectedBalance')}
                    className="inline-flex items-center justify-end gap-1 font-bold hover:text-sky-700 dark:hover:text-sky-400 w-full"
                  >
                    <span>Przewidywane płatności</span>
                    <ArrowUpDown className="w-3 h-3" aria-hidden="true" />
                  </button>
                </th>
                <th scope="col" aria-sort={getAriaSort('nextPaymentDate')} className="px-3 py-2.5 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => handleSort('nextPaymentDate')}
                    className="inline-flex items-center gap-1 font-bold hover:text-sky-700 dark:hover:text-sky-400"
                  >
                    <span>Najbliższy termin płatności</span>
                    <ArrowUpDown className="w-3 h-3" aria-hidden="true" />
                  </button>
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {paginatedRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-xs text-slate-600 dark:text-slate-400">
                    Brak projektów spełniających wybrane kryteria filtrowania.
                  </td>
                </tr>
              ) : (
                paginatedRows.map((row) => {
                  const val = amountMode === 'gross' ? row.valueGross : row.valueNet;
                  const cost = amountMode === 'gross' ? row.costsGross : row.costsNet;
                  const balance = amountMode === 'gross' ? row.balanceGross : row.balanceNet;
                  const expInflow =
                    amountMode === 'gross' ? row.expectedInflowGross : row.expectedInflowNet;
                  const expOutflow =
                    amountMode === 'gross' ? row.expectedOutflowGross : row.expectedOutflowNet;
                  const expBalance =
                    amountMode === 'gross' ? row.expectedBalanceGross : row.expectedBalanceNet;
                  const breakdownTitle = `wpływy: ${formatPln(expInflow)}, wydatki: ${formatPln(expOutflow)}`;

                  return (
                    <tr
                      key={row.project.id}
                      onClick={(e) => {
                        const target = e.target as HTMLElement | null;
                        if (target && target.closest('button, a, input, select')) return;
                        setSelectedDetailProjectId(row.project.id);
                      }}
                      className="hover:bg-sky-50/50 dark:hover:bg-slate-800/60 cursor-pointer transition-colors"
                    >
                      <td className="px-3 py-2.5 font-mono whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          {row.company && (
                            <span
                              title={row.company.name}
                              className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950/70 text-indigo-800 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800"
                            >
                              {row.company.letter}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => setSelectedDetailProjectId(row.project.id)}
                            className="font-bold text-sky-800 dark:text-sky-300 hover:underline text-left"
                          >
                            {row.project.key}
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 min-w-[180px]">
                        <button
                          type="button"
                          onClick={() => setSelectedDetailProjectId(row.project.id)}
                          className="font-semibold text-slate-900 dark:text-white hover:text-sky-700 dark:hover:text-sky-300 text-left"
                        >
                          {row.project.name}
                        </button>
                        {row.project.isArchived && (
                          <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-950/60 text-purple-800 dark:text-purple-200 font-semibold">
                            Archiwum
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-slate-700 dark:text-slate-300">
                        {row.clientNameDisplay}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                        {formatPln(val)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                        {formatPln(cost)}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right tabular-nums font-bold whitespace-nowrap ${
                          balance >= 0
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-rose-700 dark:text-rose-400'
                        }`}
                      >
                        <span className="inline-flex items-center justify-end gap-1">
                          {balance >= 0 ? (
                            <TrendingUp className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          ) : (
                            <TrendingDown className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          )}
                          <span>{formatSignedPln(balance)}</span>
                        </span>
                      </td>
                      <td
                        title={breakdownTitle}
                        className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap"
                      >
                        <div
                          className={`font-bold ${
                            expBalance >= 0
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-rose-700 dark:text-rose-400'
                          }`}
                        >
                          {formatSignedPln(expBalance)}
                        </div>
                        <div className="text-[11px] text-slate-600 dark:text-slate-400">
                          wpływy: {formatPln(expInflow)} · wydatki: {formatPln(expOutflow)}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap font-mono text-slate-800 dark:text-slate-200">
                        {row.nextPaymentDate ? (
                          <div className="flex items-center gap-1.5">
                            <span>{row.nextPaymentDate}</span>
                            {row.isNextPaymentOverdue && (
                              <span className="font-sans text-[11px] px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-200 font-semibold">
                                Po terminie
                              </span>
                            )}
                          </div>
                        ) : (
                          <span>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>

            {filteredRows.length > 0 && (
              <tfoot className="bg-slate-100 dark:bg-slate-800/90 border-t-2 border-slate-300 dark:border-slate-700 font-bold text-slate-900 dark:text-white">
                <tr>
                  <th scope="row" colSpan={3} className="px-3 py-3 text-left">
                    Suma dla bieżącego filtra ({totals.count}{' '}
                    {totals.count === 1 ? 'projekt' : totals.count < 5 ? 'projekty' : 'projektów'})
                  </th>
                  <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">
                    {formatPln(amountMode === 'gross' ? totals.valueGross : totals.valueNet)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">
                    {formatPln(amountMode === 'gross' ? totals.costsGross : totals.costsNet)}
                  </td>
                  <td
                    className={`px-3 py-3 text-right tabular-nums whitespace-nowrap ${
                      (amountMode === 'gross' ? totals.balanceGross : totals.balanceNet) >= 0
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-rose-700 dark:text-rose-400'
                    }`}
                  >
                    {formatSignedPln(
                      amountMode === 'gross' ? totals.balanceGross : totals.balanceNet
                    )}
                  </td>
                  <td
                    title={`wpływy: ${formatPln(amountMode === 'gross' ? totals.expectedInflowGross : totals.expectedInflowNet)}, wydatki: ${formatPln(amountMode === 'gross' ? totals.expectedOutflowGross : totals.expectedOutflowNet)}`}
                    className="px-3 py-3 text-right tabular-nums whitespace-nowrap"
                  >
                    <div
                      className={
                        (amountMode === 'gross'
                          ? totals.expectedBalanceGross
                          : totals.expectedBalanceNet) >= 0
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-rose-700 dark:text-rose-400'
                      }
                    >
                      {formatSignedPln(
                        amountMode === 'gross'
                          ? totals.expectedBalanceGross
                          : totals.expectedBalanceNet
                      )}
                    </div>
                    <div className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
                      wpływy:{' '}
                      {formatPln(
                        amountMode === 'gross'
                          ? totals.expectedInflowGross
                          : totals.expectedInflowNet
                      )}{' '}
                      · wydatki:{' '}
                      {formatPln(
                        amountMode === 'gross'
                          ? totals.expectedOutflowGross
                          : totals.expectedOutflowNet
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* Paginacja po 50 wierszy */}
        {sortedRows.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300">
            <span>
              Wyświetlanie <strong>{visibleStart}–{visibleEnd}</strong> z{' '}
              <strong>{sortedRows.length}</strong> projektów (po {PAGE_SIZE} na stronę)
            </span>

            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 font-semibold"
                >
                  <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Poprzednia</span>
                </button>
                <span className="font-mono font-semibold">
                  Strona {safePage} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={safePage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 font-semibold"
                >
                  <span>Następna</span>
                  <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {renderModals()}
    </section>
  );
};
