import React, { useState } from 'react';
import { Project, Task, User, Priority } from '../types';
import { copyToClipboard } from '../utils/clipboard';
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
  Lock,
  Layers,
  ArrowRight
} from 'lucide-react';

interface ProjectDetailModalProps {
  project: Project | null;
  tasks: Task[];
  users: User[];
  currentUser: User | null;
  isOpen: boolean;
  onClose: () => void;
  onEditProject?: (project: Project) => void;
  onOpenFinancials?: (project: Project) => void;
  onArchiveProject?: (project: Project) => void;
  onRestoreProject?: (project: Project) => void;
}

export const ProjectDetailModal: React.FC<ProjectDetailModalProps> = ({
  project,
  tasks,
  users,
  currentUser,
  isOpen,
  onClose,
  onEditProject,
  onOpenFinancials,
  onArchiveProject,
  onRestoreProject,
}) => {
  const [copiedDiskPath, setCopiedDiskPath] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);

  if (!isOpen || !project) return null;

  const projectTasks = tasks.filter((t) => t.projectId === project.id);
  const completedTasksCount = projectTasks.filter((t) => t.status === 'done').length;
  const inProgressTasksCount = projectTasks.filter((t) => t.status === 'in_progress').length;
  const blockedTasksCount = projectTasks.filter((t) => t.status === 'blocked').length;
  const criticalTasksCount = projectTasks.filter((t) => t.priority === 'critical' && t.status !== 'done').length;
  const allTasksDone = projectTasks.length > 0 && completedTasksCount === projectTasks.length;

  const assignedMembers = users.filter((u) => project.memberIds?.includes(u.id));

  // Financial calculations
  const baselineValue = project.projectValue || 0;
  const baselineValueGross = project.projectValueGross || Math.round(baselineValue * 1.23);

  // Selected Quotations
  const selectedQuotes = (project.quotations || []).filter((q) => q.isSelected !== false);
  const quotesRevenue = selectedQuotes
    .filter((q) => q.type === 'przychod' || !q.type)
    .reduce((sum, q) => sum + (q.totalNet || 0), 0);
  const quotesCost = selectedQuotes
    .filter((q) => q.type === 'koszt')
    .reduce((sum, q) => sum + (q.totalNet || 0), 0);

  // Direct costs
  const directCostsNet = (project.costs || []).reduce((sum, c) => sum + (c.amountNet || 0), 0);

  const totalRevenueNet = baselineValue + quotesRevenue;
  const totalCostNet = quotesCost + directCostsNet;
  const balanceNet = totalRevenueNet - totalCostNet;
  const marginPercent = totalRevenueNet > 0 ? Math.round((balanceNet / totalRevenueNet) * 100) : 0;

  // Paid status
  const paidQuotesRevenue = selectedQuotes
    .filter((q) => (q.type === 'przychod' || !q.type) && q.isPaid)
    .reduce((sum, q) => sum + (q.totalNet || 0), 0);
  const paidCosts = (project.costs || []).filter((c) => c.isPaid).reduce((sum, c) => sum + (c.amountNet || 0), 0);

  const isAdmin = currentUser?.role === 'admin';

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
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95">
        {/* Header */}
        <div className="p-4 sm:p-6 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60 flex items-start justify-between gap-4">
          <div className="space-y-1.5 flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs font-bold px-2.5 py-1 rounded-md bg-sky-100 dark:bg-sky-950 text-sky-800 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
                [{project.key}]
              </span>
              <span
                className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                  project.status === 'active'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                    : project.status === 'completed'
                    ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800'
                    : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
                }`}
              >
                {project.status === 'active'
                  ? 'W realizacji'
                  : project.status === 'completed'
                  ? 'Ukończony'
                  : project.status === 'planning'
                  ? 'Planowanie'
                  : 'Wstrzymany'}
              </span>
              {project.isArchived && (
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 flex items-center gap-1">
                  <Archive className="w-3 h-3 text-slate-500" />
                  <span>Zarchiwizowany</span>
                </span>
              )}
            </div>
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white truncate">
              {project.name}
            </h2>
            {project.description && (
              <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2">
                {project.description}
              </p>
            )}
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
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
            <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1">
              <span className="text-[11px] text-slate-500 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-sky-500" />
                <span>Termin realizacji</span>
              </span>
              <span className="font-mono font-bold text-sm text-slate-900 dark:text-white block">
                {project.dueDate}
              </span>
              <span className="text-[10px] text-slate-400">
                Rozpoczęcie: {project.startDate} ({project.durationDays} dni)
              </span>
            </div>

            <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1">
              <span className="text-[11px] text-slate-500 flex items-center gap-1">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                <span>Postęp prac</span>
              </span>
              <span className="font-mono font-bold text-sm text-emerald-600 dark:text-emerald-400 block">
                {project.progress}%
              </span>
              <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
                <div style={{ width: `${project.progress}%` }} className="bg-emerald-500 h-full" />
              </div>
            </div>

            <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1">
              <span className="text-[11px] text-slate-500 flex items-center gap-1">
                <DollarSign className="w-3.5 h-3.5 text-indigo-500" />
                <span>Wartość umowy (netto)</span>
              </span>
              <span className="font-mono font-bold text-sm text-slate-900 dark:text-white block">
                {baselineValue > 0 ? `${baselineValue.toLocaleString('pl-PL')} zł` : 'Nie określono'}
              </span>
              <span className="text-[10px] text-slate-400">
                Brutto: {baselineValueGross > 0 ? `${baselineValueGross.toLocaleString('pl-PL')} zł` : '-'}
              </span>
            </div>

            <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1">
              <span className="text-[11px] text-slate-500 flex items-center gap-1">
                <Receipt className="w-3.5 h-3.5 text-purple-500" />
                <span>Wynik bilansu</span>
              </span>
              <span className={`font-mono font-bold text-sm block ${balanceNet >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600'}`}>
                {balanceNet.toLocaleString('pl-PL')} zł
              </span>
              <span className="text-[10px] text-slate-400">
                Marża projektu: {marginPercent}%
              </span>
            </div>
          </div>

          {/* 2. CLIENT & DISK PATH DETAILS */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Zamawiający / Inwestor */}
            <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
              <h4 className="font-bold text-slate-900 dark:text-white text-xs flex items-center gap-1.5 uppercase tracking-wider text-slate-500">
                <Building2 className="w-4 h-4 text-sky-500" />
                <span>Dane Zamawiającego / Inwestora</span>
              </h4>

              {project.clientName ? (
                <div className="space-y-2">
                  <div className="font-bold text-sm text-slate-900 dark:text-white">
                    {project.clientName}
                  </div>
                  {project.clientNip && (
                    <div className="text-slate-600 dark:text-slate-400 flex items-center gap-2">
                      <span className="font-mono text-slate-400">NIP:</span>
                      <span className="font-mono font-semibold">{project.clientNip}</span>
                    </div>
                  )}
                  {project.clientContactPerson && (
                    <div className="text-slate-600 dark:text-slate-400">
                      <span className="text-slate-400">Kontakt: </span>
                      <span className="font-medium text-slate-800 dark:text-slate-200">{project.clientContactPerson}</span>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-3 pt-1">
                    {project.clientPhone && (
                      <a
                        href={`tel:${project.clientPhone}`}
                        className="flex items-center gap-1 text-sky-600 dark:text-sky-400 hover:underline"
                      >
                        <Phone className="w-3.5 h-3.5" />
                        <span>{project.clientPhone}</span>
                      </a>
                    )}
                    {project.clientEmail && (
                      <a
                        href={`mailto:${project.clientEmail}`}
                        className="flex items-center gap-1 text-sky-600 dark:text-sky-400 hover:underline"
                      >
                        <Mail className="w-3.5 h-3.5" />
                        <span>{project.clientEmail}</span>
                      </a>
                    )}
                  </div>
                  {project.clientAddress && (
                    <div className="text-slate-500 flex items-start gap-1.5 pt-1">
                      <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
                      <span>{project.clientAddress}</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-slate-400 italic py-2">
                  Brak wprowadzonych danych zamawiającego dla tego projektu.
                </div>
              )}
            </div>

            {/* Lokalizacja na dysku & Zespół */}
            <div className="space-y-4">
              {/* Lokalizacja na dysku / NAS */}
              <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
                <h4 className="font-bold text-slate-900 dark:text-white text-xs flex items-center gap-1.5 uppercase tracking-wider text-slate-500">
                  <HardDrive className="w-4 h-4 text-emerald-500" />
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
                      className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-800 dark:hover:text-white shrink-0"
                      title="Skopiuj ścieżkę do schowka"
                    >
                      {copiedDiskPath ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                ) : (
                  <div className="text-slate-400 italic">
                    Nie skonfigurowano ścieżki do plików projektu na serwerze pracowni.
                  </div>
                )}
              </div>

              {/* Zespół projektowy */}
              <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
                <h4 className="font-bold text-slate-900 dark:text-white text-xs flex items-center gap-1.5 uppercase tracking-wider text-slate-500">
                  <Users className="w-4 h-4 text-purple-500" />
                  <span>Zespół projektowy ({assignedMembers.length})</span>
                </h4>
                <div className="flex flex-wrap gap-2">
                  {assignedMembers.length > 0 ? (
                    assignedMembers.map((m) => (
                      <div
                        key={m.id}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xs"
                      >
                        <div className="w-5 h-5 rounded-full bg-sky-600 text-white font-bold text-[10px] flex items-center justify-center">
                          {m.initials}
                        </div>
                        <span className="font-semibold text-slate-800 dark:text-slate-200">{m.name}</span>
                        <span className="text-[10px] text-slate-400 font-normal">({m.department})</span>
                      </div>
                    ))
                  ) : (
                    <span className="text-slate-400 italic">Brak przypisanych członków zespołu.</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 3. TASK STATISTICS */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-slate-900 dark:text-white text-xs flex items-center gap-1.5 uppercase tracking-wider text-slate-500">
                <Layers className="w-4 h-4 text-sky-500" />
                <span>Stan realizacji zadań projektu ({projectTasks.length})</span>
              </h4>
              <span className="font-mono text-[11px] text-slate-400">
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
