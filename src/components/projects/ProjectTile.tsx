import React from 'react';
import { Company, Project, Task, User } from '../../types';
import { computeProjectFinance } from '../../utils/finance';
import { copyToClipboard } from '../../utils/clipboard';
import {
  getDeliverablesSummary,
  resolveProjectPriority,
  resolveProjectStatus,
  resolveProjectSubtype,
  resolveProjectType,
} from '../../utils/projectMeta';
import { getCompanyBadgeColors, useIsDarkTheme } from '../../utils/colorContrast';
import {
  evaluateProjectDeadline,
  useDeadlineBlinkPreference,
  usePrefersReducedMotion,
} from '../../utils/deadlines';
import { useAppTimezone, useVariables } from '../../hooks/useVariables';
import { AlertTriangle, Archive, Building2, Check, Clock, Copy, DollarSign, Folder, PackageCheck } from 'lucide-react';
import { useProjectNameTooltip } from '../ProjectNameLabel';
import { ProjectActions } from './ProjectActions';

export interface ProjectTileProps {
  project: Project;
  companies: Company[];
  projectTasks: Task[];
  members: User[];
  currentUser: User;
  todayIso?: string;
  copiedProjectId: string | null;
  onCopyDiskPath: (projectId: string) => void;
  onOpen: (projectId: string) => void;
  onViewDetails: (project: Project) => void;
  onOpenFinancials: (project: Project) => void;
  onEdit: (project: Project) => void;
  onDownloadIcs: (project: Project) => void;
  onArchive: (project: Project) => void;
  onRestore: (project: Project) => void;
  onDelete?: (project: Project) => void;
}

export const ProjectTile: React.FC<ProjectTileProps> = ({
  project,
  companies,
  projectTasks,
  members,
  currentUser,
  todayIso,
  copiedProjectId,
  onCopyDiskPath,
  onOpen,
  onViewDetails,
  onOpenFinancials,
  onEdit,
  onDownloadIcs,
  onArchive,
  onRestore,
  onDelete,
}) => {
  const { projectStatuses, projectPriorities, projectTypes, projectDeadline } = useVariables();
  const appTimezone = useAppTimezone();
  const isDark = useIsDarkTheme();
  const [userBlinkEnabled] = useDeadlineBlinkPreference();
  const prefersReducedMotion = usePrefersReducedMotion();

  const statusMeta = resolveProjectStatus(project.status, projectStatuses);
  const priorityMeta = resolveProjectPriority(project.priority, projectPriorities);
  const typeMeta = resolveProjectType(project.typeId, projectTypes);
  const subtypeMeta = resolveProjectSubtype(project.typeId, project.subtypeId, projectTypes);
  const deliverablesSummary = getDeliverablesSummary(project.deliverables);
  const nameTooltip = useProjectNameTooltip(project);

  const deadlineEval = evaluateProjectDeadline(project.dueDate, projectDeadline, {
    isClosed: statusMeta.isClosed,
    isArchived: project.isArchived,
    todayIso,
    timezone: appTimezone,
    userBlinkEnabled,
    reducedMotion: prefersReducedMotion,
  });

  const completedTasks = projectTasks.filter((t) => t.status === 'done').length;
  const criticalTasks = projectTasks.filter(
    (t) => t.priority === 'critical' && t.status !== 'done'
  ).length;

  const comp = project.companyId
    ? companies.find((c) => c.id === project.companyId)
    : undefined;

  const selectedQuotes = (project.quotations || []).filter((q) => q.isSelected !== false);
  const revenueQuotes = selectedQuotes.filter((q) => q.type !== 'koszt');
  const finance = computeProjectFinance(project, comp, { projectStatuses });
  const quoteNet = finance.totalQuotationNet;
  const totalCostsNet = finance.economicTotalCosts;
  const profitNet = finance.profitNet;

  const tileHighlightClass = deadlineEval.shouldBlink
    ? 'animate-project-deadline-tile'
    : deadlineEval.showStaticCritical
      ? 'project-deadline-static-tile'
      : 'border-slate-200 dark:border-slate-800';

  return (
    <div className={`bg-white dark:bg-slate-900 border ${tileHighlightClass} rounded-lg p-5 shadow-xs hover:shadow-md transition-shadow flex flex-col justify-between`}>
      <div>
        {/* Top badges */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-mono text-xs font-bold text-sky-800 dark:text-sky-300 bg-sky-100 dark:bg-sky-950/60 px-2.5 py-0.5 rounded border border-sky-300 dark:border-sky-800">
              {project.key}
            </span>
            {comp && (
              <span
                style={getCompanyBadgeColors(comp, isDark ? 'dark' : 'light')}
                title={`Firma prowadząca: ${comp.name}`}
                className="font-mono text-[11px] font-bold px-1.5 py-0.5 rounded border"
              >
                {comp.letter}
              </span>
            )}
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${statusMeta.badgeClass}`}>
              {statusMeta.label}
            </span>
            <span
              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                typeMeta.hasType
                  ? typeMeta.badgeClass
                  : 'bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
              }`}
            >
              {typeMeta.hasType
                ? subtypeMeta
                  ? `${typeMeta.label} · ${subtypeMeta.label}`
                  : typeMeta.label
                : 'Brak rodzaju'}
            </span>
            {project.isDemo && (
              <span className="text-[10px] text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.2 rounded">
                Demo
              </span>
            )}
            {project.isArchived && (
              <span className="text-[10px] text-purple-700 bg-purple-100 dark:bg-purple-950/60 dark:text-purple-300 px-1.5 py-0.5 rounded font-semibold border border-purple-200 dark:border-purple-800 flex items-center gap-1">
                <Archive className="w-2.5 h-2.5" aria-hidden="true" /> Archiwum
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className={`text-xs ${priorityMeta.textClass}`}>
              {priorityMeta.label}
            </span>
          </div>
        </div>

        {/* Project Title & Description */}
        <h3 className="text-base font-bold text-slate-900 dark:text-white">
          <span
            ref={nameTooltip.containerRef}
            className="relative inline-flex max-w-full items-center"
          >
            <button
              type="button"
              onClick={() => onOpen(project.id)}
              {...nameTooltip.triggerHandlers}
              className={`text-left hover:text-sky-700 dark:hover:text-sky-400 cursor-pointer transition-colors rounded-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 ${
                nameTooltip.hasTooltip
                  ? 'underline decoration-dotted decoration-slate-400 dark:decoration-slate-500 underline-offset-2'
                  : ''
              }`}
            >
              {nameTooltip.displayName}
            </button>
            {nameTooltip.tooltipNode}
          </span>
        </h3>
        <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 line-clamp-2 leading-relaxed">
          {project.description}
        </p>

        {/* Client / Investor Badge */}
        {project.clientName && (
          <div className="mt-3 p-2 bg-slate-50 dark:bg-slate-800/60 rounded border border-slate-200/80 dark:border-slate-800 text-xs flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
              <Building2 className="w-3.5 h-3.5 text-sky-700 dark:text-sky-400 shrink-0" aria-hidden="true" />
              <span className="truncate max-w-[190px] font-medium" title={project.clientName}>
                {project.clientName}
              </span>
            </div>
            {project.clientNip && (
              <span className="text-[10px] text-slate-600 dark:text-slate-400 font-mono">
                NIP: {project.clientNip}
              </span>
            )}
          </div>
        )}

        {/* Project Value & Breakdown Card */}
        <div className="mt-2.5 p-2.5 bg-slate-50/80 dark:bg-slate-800/50 rounded-lg border border-slate-200/80 dark:border-slate-700/80 text-xs space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
              <DollarSign className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
              <span>Wartość Projektu:</span>
            </span>
            <span className="font-mono font-bold text-slate-900 dark:text-white text-xs">
              {quoteNet > 0
                ? `${quoteNet.toLocaleString('pl-PL')} zł netto`
                : project.budget || 'Do wyceny'}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-1 pt-1 border-t border-slate-200/60 dark:border-slate-700/60 text-[10px]">
            <div>
              <span className="text-slate-600 dark:text-slate-400 block">Wycena:</span>
              <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                {quoteNet > 0 ? `${quoteNet.toLocaleString('pl-PL')} zł` : '0 zł'}
              </span>
            </div>
            <div>
              <span className="text-slate-600 dark:text-slate-400 block">Koszty:</span>
              <span className="font-mono font-semibold text-rose-700 dark:text-rose-400">
                {totalCostsNet > 0 ? `${totalCostsNet.toLocaleString('pl-PL')} zł` : '0 zł'}
              </span>
            </div>
            <div>
              <span className="text-slate-600 dark:text-slate-400 block">Zysk:</span>
              <span
                className={`font-mono font-bold ${
                  profitNet >= 0
                    ? 'text-sky-700 dark:text-sky-400'
                    : 'text-rose-700 dark:text-rose-400'
                }`}
              >
                {profitNet.toLocaleString('pl-PL')} zł
              </span>
            </div>
          </div>

          {revenueQuotes.length > 0 && (
            <div className="pt-1 text-[10px] text-slate-600 dark:text-slate-400 flex flex-wrap gap-1">
              <span className="font-medium text-slate-700 dark:text-slate-300">Składowe:</span>
              {revenueQuotes.slice(0, 3).map((rq) => (
                <span
                  key={rq.id}
                  className="bg-slate-200/60 dark:bg-slate-700/50 px-1 py-0.2 rounded font-mono truncate max-w-[130px]"
                >
                  {rq.title}
                </span>
              ))}
              {revenueQuotes.length > 3 && <span>+{revenueQuotes.length - 3}</span>}
            </div>
          )}
        </div>

        {/* Disk Location if specified */}
        {project.diskPath && (
          <div className="mt-2.5 px-2.5 py-1.5 bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/70 dark:border-amber-900/40 rounded flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 min-w-0">
              <Folder className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400 shrink-0" aria-hidden="true" />
              <span
                className="font-mono text-[11px] text-slate-700 dark:text-slate-300 truncate"
                title={project.diskPath}
              >
                {project.diskPath}
              </span>
            </div>
            <button
              type="button"
              onClick={async (e) => {
                e.stopPropagation();
                await copyToClipboard(project.diskPath || '');
                onCopyDiskPath(project.id);
              }}
              className="p-1 hover:bg-amber-100 dark:hover:bg-amber-900/60 rounded text-amber-700 dark:text-amber-300 shrink-0 ml-1"
              title="Kopiuj ścieżkę na dysku"
              aria-label={`Kopiuj ścieżkę projektu ${project.key}`}
            >
              {copiedProjectId === project.id ? (
                <Check className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
              ) : (
                <Copy className="w-3.5 h-3.5" aria-hidden="true" />
              )}
            </button>
          </div>
        )}

        {/* Dates & Schedule with Duration in days */}
        <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400">
          <div className="flex flex-wrap items-center gap-1.5">
            <Clock
              className={`w-3.5 h-3.5 shrink-0 ${
                deadlineEval.isRed ? 'text-rose-700 dark:text-rose-400' : 'text-sky-700 dark:text-sky-400'
              }`}
              aria-hidden="true"
            />
            <span className="font-bold text-slate-900 dark:text-white font-mono">
              {project.durationDays || 30} dni
            </span>
            <span className="font-mono text-[11px] inline-flex flex-wrap items-center gap-1">
              <span className="text-slate-600 dark:text-slate-400">({project.startDate} ·</span>
              <span
                className={
                  deadlineEval.isRed
                    ? 'text-rose-700 dark:text-rose-400 font-bold inline-flex items-center gap-0.5'
                    : 'text-slate-700 dark:text-slate-300'
                }
              >
                {deadlineEval.isRed && (
                  <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />
                )}
                <span>{project.dueDate}</span>
              </span>
              {deadlineEval.showCounter && deadlineEval.text && (
                <span
                  data-testid="project-deadline-counter"
                  className={`font-sans text-[11px] ${
                    deadlineEval.isRed
                      ? 'text-rose-700 dark:text-rose-400 font-semibold'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  · {deadlineEval.text}
                </span>
              )}
              <span className="text-slate-600 dark:text-slate-400">)</span>
            </span>
          </div>
          {project.budget && (
            <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300 font-semibold">
              {project.budget}
            </span>
          )}
        </div>

        {/* Progress bar */}
        <div className="mt-2.5">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-slate-600 dark:text-slate-400 font-medium">Postęp realizacji</span>
            <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300 font-bold">
              {project.progress}%
            </span>
          </div>
          <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2 overflow-hidden">
            <div
              style={{ width: `${project.progress}%` }}
              className={`h-full ${
                project.progress === 100
                  ? 'bg-emerald-500'
                  : project.priority === 'critical'
                    ? 'bg-rose-500'
                    : 'bg-sky-500'
              }`}
            />
          </div>
        </div>

        {/* Deliverables summary */}
        {deliverablesSummary.total > 0 && (
          <div className="mt-2.5">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-slate-600 dark:text-slate-400 font-medium inline-flex items-center gap-1">
                <PackageCheck className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                <span>Odbiory</span>
              </span>
              <span className="font-mono tabular-nums text-slate-800 dark:text-slate-200 font-semibold">
                {deliverablesSummary.label}
              </span>
            </div>
            <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
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

        {/* Task counts stats */}
        <div className="grid grid-cols-2 gap-2 mt-3 text-xs bg-slate-50 dark:bg-slate-800/40 p-2.5 rounded border border-slate-100 dark:border-slate-800">
          <div>
            <span className="text-slate-600 dark:text-slate-400 block text-[10px] uppercase font-semibold">
              Zadania
            </span>
            <span className="font-mono tabular-nums font-semibold text-slate-800 dark:text-slate-200">
              {completedTasks} / {projectTasks.length} ukończonych
            </span>
          </div>
          <div>
            <span className="text-slate-600 dark:text-slate-400 block text-[10px] uppercase font-semibold">
              Krytyczne
            </span>
            <span
              className={`font-mono tabular-nums font-semibold ${
                criticalTasks > 0
                  ? 'text-rose-700 dark:text-rose-400'
                  : 'text-slate-700 dark:text-slate-300'
              }`}
            >
              {criticalTasks} wymagających uwagi
            </span>
          </div>
        </div>
      </div>

      {/* Card Footer: Team members & Actions */}
      <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
        <div className="flex items-center -space-x-1.5 overflow-hidden">
          {members.map((m) => (
            <div
              key={m.id}
              className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700 border-2 border-white dark:border-slate-900 text-[10px] font-bold text-slate-700 dark:text-slate-300 flex items-center justify-center"
              title={`${m.name} (${m.role})`}
            >
              {m.initials}
            </div>
          ))}
        </div>

        <ProjectActions
          project={project}
          currentUser={currentUser}
          variant="tile"
          onOpen={onOpen}
          onViewDetails={onViewDetails}
          onOpenFinancials={onOpenFinancials}
          onEdit={onEdit}
          onDownloadIcs={onDownloadIcs}
          onArchive={onArchive}
          onRestore={onRestore}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
};
