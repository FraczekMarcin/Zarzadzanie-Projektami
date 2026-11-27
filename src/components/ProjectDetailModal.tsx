import React, { useState, useRef, useId } from 'react';
import { Project, ProjectDeliverable, Task, User, Priority, Company } from '../types';
import { copyToClipboard } from '../utils/clipboard';
import { FIELD_LIMITS } from '../utils/access';
import { computeProjectFinance } from '../utils/finance';
import { formatMoney } from '../utils/money';
import {
  DELIVERABLE_LIMITS,
  getDeliverablesSummary,
  getProjectDisplayName,
  hasDistinctShortName,
  resolveProjectPriority,
  resolveProjectStatus,
  resolveProjectSubtype,
  resolveProjectType,
} from '../utils/projectMeta';
import { getCompanyBadgeColors } from '../utils/colorContrast';
import { useIsDarkTheme } from '../hooks/useIsDarkTheme';
import { evaluateProjectDeadline } from '../utils/deadlines';
import { useAppTimezone, useVariables } from '../hooks/useVariables';
import { useFocusTrap } from '../utils/useFocusTrap';
import { useDismissOnOutsideClick } from '../hooks/useDismissOnOutsideClick';
import { 
  X, 
  Briefcase, 
  Calendar, 
  Clock, 
  Building2, 
  Phone, 
  Mail, 
  MapPin, 
  HardDrive, 
  Copy, 
  Check, 
  DollarSign, 
  TrendingUp, 
  Receipt, 
  Users, 
  Edit3, 
  Archive, 
  RotateCcw, 
  CheckCircle2, 
  AlertCircle, 
  AlertTriangle,
  Lock,
  Layers,
  ArrowRight,
  PackageCheck,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import type { FormSubmitResult } from '../hooks/useFormSubmit';

interface ProjectDetailModalProps {
  project: Project | null;
  companies?: Company[];
  tasks: Task[];
  users: User[];
  currentUser: User | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdateDeliverables?: (
    project: Project,
    deliverables: ProjectDeliverable[]
  ) => Promise<FormSubmitResult<Project> | void> | void;
  onEditProject?: (project: Project) => void;
  onOpenFinancials?: (project: Project) => void;
  onArchiveProject?: (project: Project) => void;
  onRestoreProject?: (project: Project) => void;
}

function createDetailDeliverableId(): string {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return `del-${globalThis.crypto.randomUUID()}`;
  }
  return `del-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export const ProjectDetailModal: React.FC<ProjectDetailModalProps> = ({
  project,
  companies = [],
  tasks,
  users,
  currentUser,
  isOpen,
  onClose,
  onUpdateDeliverables,
  onEditProject,
  onOpenFinancials,
  onArchiveProject,
  onRestoreProject,
}) => {
  const [copiedDiskPath, setCopiedDiskPath] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [newDelName, setNewDelName] = useState('');
  const [newDelCopies, setNewDelCopies] = useState<number>(DELIVERABLE_LIMITS.defaultCopies);
  const [newDelUnit, setNewDelUnit] = useState<string>(DELIVERABLE_LIMITS.defaultUnit);
  const [deliverablesError, setDeliverablesError] = useState<string | null>(null);
  const [isSavingDeliverables, setIsSavingDeliverables] = useState(false);
  const [pendingDeliverables, setPendingDeliverables] = useState<ProjectDeliverable[] | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const { projectStatuses, projectPriorities, projectTypes, projectDeadline } = useVariables();
  const appTimezone = useAppTimezone();
  const isDark = useIsDarkTheme();
  const { backdropProps, requestClose } = useDismissOnOutsideClick({
    isOpen: Boolean(isOpen && project),
    mode: 'dismiss',
    panelRef: modalRef,
    onDismiss: onClose,
  });

  useFocusTrap({ isOpen: Boolean(isOpen && project), onClose: requestClose, containerRef: modalRef });

  if (!isOpen || !project) return null;

  const statusMeta = resolveProjectStatus(project.status, projectStatuses);
  const priorityMeta = resolveProjectPriority(project.priority, projectPriorities);
  const typeMeta = resolveProjectType(project.typeId, projectTypes);
  const subtypeMeta = resolveProjectSubtype(project.typeId, project.subtypeId, projectTypes);
  const serverDeliverables = Array.isArray(project.deliverables) ? project.deliverables : [];
  const deliverables = pendingDeliverables ?? serverDeliverables;
  const deliverablesSummary = getDeliverablesSummary(deliverables);

  const projectTasks = tasks.filter((t) => t.projectId === project.id);
  const completedTasksCount = projectTasks.filter((t) => t.status === 'done').length;
  const inProgressTasksCount = projectTasks.filter((t) => t.status === 'in_progress').length;
  const blockedTasksCount = projectTasks.filter((t) => t.status === 'blocked').length;
  const criticalTasksCount = projectTasks.filter((t) => t.priority === 'critical' && t.status !== 'done').length;
  const allTasksDone = projectTasks.length > 0 && completedTasksCount === projectTasks.length;

  const assignedMembers = users.filter((u) => project.memberIds?.includes(u.id));

  const projectCompany = project.companyId
    ? companies.find((c) => c.id === project.companyId)
    : undefined;

  const finance = computeProjectFinance(project, projectCompany, { projectStatuses });
  const baselineValue = finance.baseProjectValueNet;
  const baselineValueGross = finance.baseProjectValueGross;
  const balanceNet = finance.profitNet;
  const marginPercent = finance.marginPercent;

  const isAdmin = currentUser?.role === 'admin';
  const canEditProjectDeliverables = Boolean(
    onUpdateDeliverables &&
      currentUser &&
      currentUser.role !== 'viewer' &&
      (currentUser.role === 'admin' ||
        currentUser.role === 'project_manager' ||
        project.ownerId === currentUser.id ||
        (project.memberIds || []).includes(currentUser.id))
  );

  const persistDeliverables = async (nextList: ProjectDeliverable[]) => {
    if (!onUpdateDeliverables || isSavingDeliverables) return;
    setDeliverablesError(null);
    setPendingDeliverables(nextList);
    setIsSavingDeliverables(true);
    try {
      const res = await onUpdateDeliverables(project, nextList);
      if (res && typeof res === 'object' && 'ok' in res && !res.ok) {
        setPendingDeliverables(null);
        setDeliverablesError(res.error || 'Nie udało się zapisać elementów do odbioru.');
      } else {
        setPendingDeliverables(null);
      }
    } catch (err: any) {
      setPendingDeliverables(null);
      setDeliverablesError(err?.message || 'Nie udało się zapisać elementów do odbioru.');
    } finally {
      setIsSavingDeliverables(false);
    }
  };

  const handleToggleDeliverable = (itemId: string) => {
    const nextList = deliverables.map((d) =>
      d.id === itemId
        ? {
            ...d,
            isDone: !d.isDone,
            ...(!d.isDone
              ? { doneAt: new Date().toISOString(), doneBy: currentUser?.name || 'Użytkownik' }
              : { doneAt: undefined, doneBy: undefined }),
          }
        : d
    );
    void persistDeliverables(nextList);
  };

  const handleMoveDeliverable = async (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= deliverables.length) return;
    const nextList = [...deliverables];
    const [moved] = nextList.splice(index, 1);
    nextList.splice(target, 0, moved);
    await persistDeliverables(nextList);
  };

  const handleRemoveDeliverable = async (itemId: string) => {
    const nextList = deliverables.filter((d) => d.id !== itemId);
    await persistDeliverables(nextList);
  };

  const handleAddDeliverable = async () => {
    const trimmedName = newDelName.trim();
    if (!trimmedName) {
      setDeliverablesError('Podaj nazwę elementu do odbioru.');
      return;
    }
    if (trimmedName.length > DELIVERABLE_LIMITS.nameMax) {
      setDeliverablesError(`Nazwa elementu nie może przekraczać ${DELIVERABLE_LIMITS.nameMax} znaków.`);
      return;
    }
    if (deliverables.length >= DELIVERABLE_LIMITS.maxItems) {
      setDeliverablesError(`Maksymalnie ${DELIVERABLE_LIMITS.maxItems} elementów do odbioru.`);
      return;
    }
    const copiesInt = Number(newDelCopies);
    if (
      !Number.isInteger(copiesInt) ||
      copiesInt < DELIVERABLE_LIMITS.copiesMin ||
      copiesInt > DELIVERABLE_LIMITS.copiesMax
    ) {
      setDeliverablesError(
        `Liczba egzemplarzy musi być liczbą całkowitą z zakresu ${DELIVERABLE_LIMITS.copiesMin}–${DELIVERABLE_LIMITS.copiesMax}.`
      );
      return;
    }
    const unitTrimmed = newDelUnit.trim() || DELIVERABLE_LIMITS.defaultUnit;
    if (unitTrimmed.length > DELIVERABLE_LIMITS.unitMax) {
      setDeliverablesError(`Jednostka nie może przekraczać ${DELIVERABLE_LIMITS.unitMax} znaków.`);
      return;
    }
    const nextList: ProjectDeliverable[] = [
      ...deliverables,
      {
        id: createDetailDeliverableId(),
        name: trimmedName,
        copies: copiesInt,
        unit: unitTrimmed,
        isDone: false,
      },
    ];
    await persistDeliverables(nextList);
    setNewDelName('');
    setNewDelCopies(DELIVERABLE_LIMITS.defaultCopies);
    setNewDelUnit(DELIVERABLE_LIMITS.defaultUnit);
  };

  const handleCopyPath = async () => {
    if (!project.diskPath) return;
    const success = await copyToClipboard(project.diskPath);
    if (success) {
      setCopiedDiskPath(true);
      setTimeout(() => setCopiedDiskPath(false), 2000);
    }
  };

  const handleArchiveClick = () => {
    if (project.isArchived) {
      if (onRestoreProject) onRestoreProject(project);
      onClose();
      return;
    }

    if (!allTasksDone && projectTasks.length > 0) {
      setShowArchiveConfirm(true);
    } else {
      if (onArchiveProject) onArchiveProject(project);
      onClose();
    }
  };

  const confirmArchiveNow = () => {
    if (onArchiveProject) onArchiveProject(project);
    setShowArchiveConfirm(false);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto"
      {...backdropProps}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95"
      >
        {/* Header */}
        <div className="p-4 sm:p-6 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60 flex items-start justify-between gap-4">
          <div className="space-y-1.5 flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs font-bold px-2.5 py-1 rounded-md bg-sky-100 dark:bg-sky-950 text-sky-800 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
                [{project.key}]
              </span>
              {(() => {
                const comp = project.companyId
                  ? companies.find((c) => c.id === project.companyId)
                  : undefined;
                return comp ? (
                  <span
                    style={getCompanyBadgeColors(comp, isDark ? 'dark' : 'light')}
                    title={`Firma prowadząca: ${comp.name}`}
                    className="font-mono text-xs font-bold px-2 py-1 rounded-md border"
                  >
                    {comp.letter} · {comp.name}
                  </span>
                ) : null;
              })()}
              <span
                className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${statusMeta.badgeClass}`}
              >
                {statusMeta.label}
              </span>
              <span
                className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                  typeMeta.hasType
                    ? typeMeta.badgeClass
                    : 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
                }`}
              >
                Rodzaj:{' '}
                {typeMeta.hasType
                  ? subtypeMeta
                    ? `${typeMeta.label} · ${subtypeMeta.label}`
                    : typeMeta.label
                  : 'Brak'}
              </span>
              <span
                className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${priorityMeta.badgeClass}`}
              >
                Priorytet: {priorityMeta.label}
              </span>
              {project.isArchived && (
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 flex items-center gap-1">
                  <Archive className="w-3 h-3 text-slate-600 dark:text-slate-400" aria-hidden="true" />
                  <span>Zarchiwizowany</span>
                </span>
              )}
            </div>
            <h2 id={titleId} className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white truncate">
              {getProjectDisplayName(project)}
            </h2>
            {hasDistinctShortName(project) && (
              <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Pełna nazwa: {project.name}
              </p>
            )}
            {project.description && (
              <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2">
                {project.description}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Zamknij szczegóły projektu"
            className="p-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-6 text-xs flex-1">
          {/* Warning banner for archive confirmation */}
          {showArchiveConfirm && (
            <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/60 border-2 border-amber-400 dark:border-amber-700 text-amber-900 dark:text-amber-100 space-y-3">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h4 className="font-bold text-sm">Ostrzeżenie: Projekt posiada nieukończone zadania</h4>
                  <p className="text-xs text-amber-800 dark:text-amber-200 leading-relaxed">
                    W projekcie pozostało {projectTasks.length - completedTasksCount} zadań nieoznaczonych jako zakończone.
                    Czy jako Administrator na pewno chcesz przenieść ten projekt do archiwum?
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 justify-end pt-1">
                <button
                  type="button"
                  onClick={() => setShowArchiveConfirm(false)}
                  className="px-3 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold text-xs"
                >
                  Anuluj
                </button>
                <button
                  type="button"
                  onClick={confirmArchiveNow}
                  className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs shadow-xs"
                >
                  Tak, zarchiwizuj mimo to
                </button>
              </div>
            </div>
          )}

          {/* 1. KEY METRICS CARDS */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {(() => {
              const deadlineEval = evaluateProjectDeadline(project.dueDate, projectDeadline, {
                isClosed: statusMeta.isClosed,
                isArchived: project.isArchived,
                timezone: appTimezone,
              });
              return (
                <div
                  className={`p-3 rounded-xl border space-y-1 ${
                    deadlineEval.isRed
                      ? 'bg-rose-50/70 dark:bg-rose-950/30 border-rose-300 dark:border-rose-800'
                      : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <span className="text-[11px] text-slate-600 dark:text-slate-400 flex items-center gap-1">
                    {deadlineEval.isRed ? (
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-700 dark:text-rose-400" aria-hidden="true" />
                    ) : (
                      <Calendar className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" aria-hidden="true" />
                    )}
                    <span>Termin realizacji</span>
                  </span>
                  <div className="flex flex-wrap items-baseline gap-1.5">
                    <span
                      className={`font-mono font-bold text-sm ${
                        deadlineEval.isRed
                          ? 'text-rose-700 dark:text-rose-400'
                          : 'text-slate-900 dark:text-white'
                      }`}
                    >
                      {project.dueDate}
                    </span>
                    {deadlineEval.showCounter && deadlineEval.text && (
                      <span
                        data-testid="project-deadline-counter"
                        className={`text-[11px] font-semibold ${
                          deadlineEval.isRed
                            ? 'text-rose-700 dark:text-rose-400'
                            : 'text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        ({deadlineEval.text})
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-slate-600 dark:text-slate-400 block">
                    Rozpoczęcie: {project.startDate} ({project.durationDays} dni)
                  </span>
                </div>
              );
            })()}

            <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1">
              <span className="text-[11px] text-slate-600 dark:text-slate-400 flex items-center gap-1">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                <span>Postęp prac</span>
              </span>
              <span className="font-mono font-bold text-sm text-emerald-700 dark:text-emerald-400 block">
                {project.progress}%
              </span>
              <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
                <div style={{ width: `${project.progress}%` }} className="bg-emerald-500 h-full" />
              </div>
            </div>

            <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1">
              <span className="text-[11px] text-slate-600 dark:text-slate-400 flex items-center gap-1">
                <DollarSign className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
                <span>{finance.isVatExempt ? 'Wartość umowy (ZW)' : 'Wartość umowy (netto)'}</span>
              </span>
              <span className="font-mono font-bold text-sm text-slate-900 dark:text-white block">
                {baselineValue > 0 ? `${formatMoney(baselineValue)} zł` : 'Nie określono'}
              </span>
              <span className="text-[10px] text-slate-600 dark:text-slate-400">
                {finance.isVatExempt
                  ? 'Zwolniona z VAT (brutto = netto)'
                  : `Brutto: ${baselineValueGross > 0 ? `${formatMoney(baselineValueGross)} zł` : '-'}`}
              </span>
            </div>

            <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1">
              <span className="text-[11px] text-slate-600 dark:text-slate-400 flex items-center gap-1">
                <Receipt className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" aria-hidden="true" />
                <span>Wynik bilansu</span>
              </span>
              <span className={`font-mono font-bold text-sm block ${balanceNet >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>
                {formatMoney(balanceNet)} zł
              </span>
              <span className="text-[10px] text-slate-600 dark:text-slate-400">
                Marża projektu: {marginPercent}%
              </span>
            </div>
          </div>

          {/* 2. CLIENT & DISK PATH DETAILS */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Zamawiający / Inwestor */}
            <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
              <h4 className="font-bold text-slate-700 dark:text-slate-200 text-xs flex items-center gap-1.5 uppercase tracking-wider">
                <Building2 className="w-4 h-4 text-sky-600 dark:text-sky-400" aria-hidden="true" />
                <span>Dane Zamawiającego / Inwestora</span>
              </h4>

              {project.clientName ? (
                <div className="space-y-2">
                  <div className="font-bold text-sm text-slate-900 dark:text-white">
                    {project.clientName}
                  </div>
                  {project.clientNip && (
                    <div className="text-slate-600 dark:text-slate-400 flex items-center gap-2">
                      <span className="font-mono text-slate-600 dark:text-slate-400">NIP:</span>
                      <span className="font-mono font-semibold">{project.clientNip}</span>
                    </div>
                  )}
                  {project.clientContactPerson && (
                    <div className="text-slate-600 dark:text-slate-400">
                      <span className="text-slate-600 dark:text-slate-400">Kontakt: </span>
                      <span className="font-medium text-slate-800 dark:text-slate-200">{project.clientContactPerson}</span>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-3 pt-1">
                    {project.clientPhone && (
                      <a
                        href={`tel:${project.clientPhone}`}
                        className="flex items-center gap-1 text-sky-700 dark:text-sky-400 hover:underline"
                      >
                        <Phone className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>{project.clientPhone}</span>
                      </a>
                    )}
                    {project.clientEmail && (
                      <a
                        href={`mailto:${project.clientEmail}`}
                        className="flex items-center gap-1 text-sky-700 dark:text-sky-400 hover:underline"
                      >
                        <Mail className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>{project.clientEmail}</span>
                      </a>
                    )}
                  </div>
                  {project.clientAddress && (
                    <div className="text-slate-600 dark:text-slate-400 flex items-start gap-1.5 pt-1">
                      <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-600 dark:text-slate-400" aria-hidden="true" />
                      <span>{project.clientAddress}</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-slate-600 dark:text-slate-400 italic py-2">
                  Brak wprowadzonych danych zamawiającego dla tego projektu.
                </div>
              )}
            </div>

            {/* Lokalizacja na dysku & Zespół */}
            <div className="space-y-4">
              {/* Lokalizacja na dysku / NAS */}
              <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
                <h4 className="font-bold text-slate-700 dark:text-slate-200 text-xs flex items-center gap-1.5 uppercase tracking-wider">
                  <HardDrive className="w-4 h-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  <span>Ścieżka na dysku / serwerze NAS</span>
                </h4>
                {project.diskPath ? (
                  <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                    <span className="font-mono text-slate-700 dark:text-slate-300 truncate">
                      {project.diskPath}
                    </span>
                    <button
                      type="button"
                      onClick={handleCopyPath}
                      aria-label={copiedDiskPath ? 'Skopiowano ścieżkę do schowka' : 'Skopiuj ścieżkę do schowka'}
                      className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white shrink-0"
                      title="Skopiuj ścieżkę do schowka"
                    >
                      {copiedDiskPath ? <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" /> : <Copy className="w-4 h-4" aria-hidden="true" />}
                    </button>
                  </div>
                ) : (
                  <div className="text-slate-600 dark:text-slate-400 italic">
                    Nie skonfigurowano ścieżki do plików projektu na serwerze pracowni.
                  </div>
                )}
              </div>

              {/* Zespół projektowy */}
              <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
                <h4 className="font-bold text-slate-700 dark:text-slate-200 text-xs flex items-center gap-1.5 uppercase tracking-wider">
                  <Users className="w-4 h-4 text-purple-600 dark:text-purple-400" aria-hidden="true" />
                  <span>Zespół projektowy ({assignedMembers.length})</span>
                </h4>
                <div className="flex flex-wrap gap-2">
                  {assignedMembers.length > 0 ? (
                    assignedMembers.map((m) => (
                      <div
                        key={m.id}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xs"
                      >
                        <div className="w-5 h-5 rounded-full bg-sky-700 text-white font-bold text-[10px] flex items-center justify-center" aria-hidden="true">
                          {m.initials}
                        </div>
                        <span className="font-semibold text-slate-800 dark:text-slate-200">{m.name}</span>
                        <span className="text-[10px] text-slate-600 dark:text-slate-400 font-normal">({m.department})</span>
                      </div>
                    ))
                  ) : (
                    <span className="text-slate-600 dark:text-slate-400 italic">Brak przypisanych członków zespołu.</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 3. TASK STATISTICS */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-slate-700 dark:text-slate-200 text-xs flex items-center gap-1.5 uppercase tracking-wider">
                <Layers className="w-4 h-4 text-sky-600 dark:text-sky-400" aria-hidden="true" />
                <span>Stan realizacji zadań projektu ({projectTasks.length})</span>
              </h4>
              <span className="font-mono text-[11px] text-slate-600 dark:text-slate-400">
                Ukończono: {completedTasksCount}/{projectTasks.length}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-center">
              <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60">
                <span className="font-mono font-bold text-base text-emerald-700 dark:text-emerald-300 block">
                  {completedTasksCount}
                </span>
                <span className="text-[10px] text-emerald-800 dark:text-emerald-200 font-semibold">Ukończone</span>
              </div>
              <div className="p-2.5 rounded-lg bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800/60">
                <span className="font-mono font-bold text-base text-sky-700 dark:text-sky-300 block">
                  {inProgressTasksCount}
                </span>
                <span className="text-[10px] text-sky-800 dark:text-sky-200 font-semibold">W toku</span>
              </div>
              <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60">
                <span className="font-mono font-bold text-base text-rose-700 dark:text-rose-300 block">
                  {blockedTasksCount}
                </span>
                <span className="text-[10px] text-rose-800 dark:text-rose-200 font-semibold">Zablokowane</span>
              </div>
              <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60">
                <span className="font-mono font-bold text-base text-amber-700 dark:text-amber-300 block">
                  {criticalTasksCount}
                </span>
                <span className="text-[10px] text-amber-800 dark:text-amber-200 font-semibold">Krytyczne</span>
              </div>
            </div>
          </div>

          {/* 4. ELEMENTY DO ODBIORU */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="font-bold text-slate-700 dark:text-slate-200 text-xs flex items-center gap-1.5 uppercase tracking-wider">
                <PackageCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                <span>Elementy do odbioru ({deliverables.length})</span>
              </h4>
              {deliverables.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                    {deliverablesSummary.label}
                  </span>
                  <div className="w-20 bg-slate-200 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden" aria-hidden="true">
                    <div
                      style={{ width: `${deliverablesSummary.percent}%` }}
                      className={`h-full ${
                        deliverablesSummary.done === deliverablesSummary.total
                          ? 'bg-emerald-500'
                          : 'bg-sky-500'
                      }`}
                    />
                  </div>
                </div>
              )}
            </div>

            {deliverablesError && (
              <div
                role="alert"
                className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-xs font-medium"
              >
                {deliverablesError}
              </div>
            )}

            {deliverables.length === 0 ? (
              <p className="text-slate-600 dark:text-slate-400 italic">
                Brak zdefiniowanych elementów do odbioru w tym projekcie.
              </p>
            ) : (
              <ul className="space-y-2" aria-label="Lista elementów do odbioru w szczegółach projektu">
                {deliverables.map((item, idx) => (
                  <li
                    key={item.id}
                    className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 flex flex-wrap items-center justify-between gap-2"
                  >
                    <div className="flex items-start gap-2.5 min-w-0 flex-1">
                      <input
                        type="checkbox"
                        checked={item.isDone}
                        disabled={!canEditProjectDeliverables || isSavingDeliverables}
                        aria-label={`Wykonano: ${item.name}`}
                        onChange={() => handleToggleDeliverable(item.id)}
                        className="mt-0.5 rounded border-slate-400 dark:border-slate-600 text-emerald-700 focus:ring-emerald-600 disabled:opacity-60 cursor-pointer"
                      />
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`font-semibold text-xs ${
                              item.isDone
                                ? 'line-through text-slate-500 dark:text-slate-400'
                                : 'text-slate-900 dark:text-white'
                            }`}
                          >
                            {item.name}
                          </span>
                          <span className="font-mono text-[11px] px-1.5 py-0.2 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
                            {item.copies} {item.unit}
                          </span>
                        </div>
                        {item.notes && (
                          <p className="text-[11px] text-slate-600 dark:text-slate-400">
                            {item.notes}
                          </p>
                        )}
                        {item.isDone && (item.doneAt || item.doneBy) && (
                          <p className="text-[10px] text-emerald-700 dark:text-emerald-300">
                            Wykonano
                            {item.doneAt ? `: ${new Date(item.doneAt).toLocaleString('pl-PL')}` : ''}
                            {item.doneBy ? ` · ${item.doneBy}` : ''}
                          </p>
                        )}
                      </div>
                    </div>

                    {canEditProjectDeliverables && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          disabled={idx === 0 || isSavingDeliverables}
                          onClick={() => handleMoveDeliverable(idx, -1)}
                          aria-label={`Przesuń element "${item.name}" w górę`}
                          className="p-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
                        >
                          <ArrowUp className="w-3 h-3" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === deliverables.length - 1 || isSavingDeliverables}
                          onClick={() => handleMoveDeliverable(idx, 1)}
                          aria-label={`Przesuń element "${item.name}" w dół`}
                          className="p-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
                        >
                          <ArrowDown className="w-3 h-3" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          disabled={isSavingDeliverables}
                          onClick={() => handleRemoveDeliverable(item.id)}
                          aria-label={`Usuń element "${item.name}"`}
                          className="p-1 rounded border border-rose-200 dark:border-rose-900/50 bg-white dark:bg-slate-900 text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 disabled:opacity-40"
                        >
                          <Trash2 className="w-3 h-3" aria-hidden="true" />
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {canEditProjectDeliverables && (
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <input
                  type="text"
                  aria-label="Nazwa nowego elementu do odbioru"
                  value={newDelName}
                  maxLength={DELIVERABLE_LIMITS.nameMax}
                  disabled={isSavingDeliverables}
                  onChange={(e) => setNewDelName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleAddDeliverable();
                    }
                  }}
                  placeholder="Dodaj nowy element do odbioru..."
                  className="sm:col-span-6 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
                />
                <input
                  type="number"
                  aria-label="Liczba egzemplarzy"
                  min={DELIVERABLE_LIMITS.copiesMin}
                  max={DELIVERABLE_LIMITS.copiesMax}
                  disabled={isSavingDeliverables}
                  value={newDelCopies}
                  onChange={(e) => setNewDelCopies(Number(e.target.value))}
                  className="sm:col-span-2 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2 py-1.5 text-xs font-mono text-slate-900 dark:text-white"
                />
                <input
                  type="text"
                  aria-label="Jednostka"
                  value={newDelUnit}
                  maxLength={DELIVERABLE_LIMITS.unitMax}
                  disabled={isSavingDeliverables}
                  onChange={(e) => setNewDelUnit(e.target.value)}
                  placeholder="egz."
                  className="sm:col-span-2 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2 py-1.5 text-xs text-slate-900 dark:text-white"
                />
                <button
                  type="button"
                  disabled={isSavingDeliverables}
                  onClick={() => void handleAddDeliverable()}
                  className="sm:col-span-2 inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded bg-sky-700 hover:bg-sky-600 disabled:opacity-50 text-white font-semibold text-xs transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Dodaj</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 px-6 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {isAdmin && (
              <button
                type="button"
                onClick={handleArchiveClick}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors shadow-2xs ${
                  project.isArchived
                    ? 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border-sky-300 dark:border-sky-800 hover:bg-sky-100'
                    : 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 border-amber-300 dark:border-amber-800 hover:bg-amber-100'
                }`}
                title={project.isArchived ? 'Przywróć projekt do aktywnych' : 'Przenieś projekt do archiwum (tylko Administrator)'}
              >
                {project.isArchived ? (
                  <>
                    <RotateCcw className="w-3.5 h-3.5 text-sky-600" />
                    <span>Przywróć z archiwum</span>
                  </>
                ) : (
                  <>
                    <Archive className="w-3.5 h-3.5 text-amber-600" />
                    <span>Zarchiwizuj projekt (Admin)</span>
                  </>
                )}
              </button>
            )}

            {onOpenFinancials && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenFinancials(project);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 hover:bg-emerald-100 font-semibold text-xs transition-colors"
              >
                <DollarSign className="w-3.5 h-3.5" />
                <span>Bilans & Wyceny</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {onEditProject && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onEditProject(project);
                }}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-semibold text-xs shadow-xs transition-colors"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Edytuj dane projektu</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-semibold text-xs transition-colors"
            >
              Zamknij
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
