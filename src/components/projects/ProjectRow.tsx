import React from 'react';
import { Company, Project, Task, User } from '../../types';
import { canViewFinance } from '../../utils/access';
import {
  getDeliverablesSummary,
  resolveProjectSubtype,
  resolveProjectType,
} from '../../utils/projectMeta';
import { getCompanyBadgeColors } from '../../utils/colorContrast';
import { useIsDarkTheme } from '../../hooks/useIsDarkTheme';
import { evaluateProjectDeadline } from '../../utils/deadlines';
import {
  useDeadlineBlinkPreference,
  usePrefersReducedMotion,
} from '../../hooks/useDeadlines';
import { useAppTimezone, useVariables } from '../../hooks/useVariables';
import { AlertTriangle, Archive } from 'lucide-react';
import { useProjectNameTooltip } from '../ProjectNameLabel';
import { ProjectActions } from './ProjectActions';
import {
  getProjectPriorityMeta,
  getProjectStatusMeta,
  getProjectTaskMetrics,
} from './projectsViewUtils';

export interface ProjectRowProps {
  project: Project;
  company?: Company;
  owner?: User;
  tasks: Task[];
  currentUser: User;
  todayIso: string;
  showClientColumn: boolean;
  onOpen: (projectId: string) => void;
  onViewDetails: (project: Project) => void;
  onOpenFinancials: (project: Project) => void;
  onEdit: (project: Project) => void;
  onDownloadIcs: (project: Project) => void;
  onArchive: (project: Project) => void;
  onRestore: (project: Project) => void;
  onDelete?: (project: Project) => void;
}

export const ProjectRow: React.FC<ProjectRowProps> = ({
  project,
  company,
  owner,
  tasks,
  currentUser,
  todayIso,
  showClientColumn,
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

  const statusMeta = getProjectStatusMeta(project.status, projectStatuses);
  const priorityMeta = getProjectPriorityMeta(project.priority, projectPriorities);
  const typeMeta = resolveProjectType(project.typeId, projectTypes);
  const subtypeMeta = resolveProjectSubtype(project.typeId, project.subtypeId, projectTypes);
  const deliverablesSummary = getDeliverablesSummary(project.deliverables);
  const nameTooltip = useProjectNameTooltip(project);
  const metrics = getProjectTaskMetrics(tasks, project.id, todayIso);
  const canSeeClient = canViewFinance(currentUser, project);
  const deadlineEval = evaluateProjectDeadline(project.dueDate, projectDeadline, {
    isClosed: statusMeta.isClosed,
    isArchived: project.isArchived,
    todayIso,
    timezone: appTimezone,
    userBlinkEnabled,
    reducedMotion: prefersReducedMotion,
  });
  const clampedProgress = Math.min(100, Math.max(0, project.progress || 0));

  const rowHighlightClass = deadlineEval.shouldBlink
    ? 'animate-project-deadline-row'
    : deadlineEval.showStaticCritical
      ? 'project-deadline-static-row'
      : 'hover:bg-sky-50/50 dark:hover:bg-slate-800/60';

  return (
    <tr
      onClick={(e) => {
        const target = e.target as HTMLElement | null;
        if (target && target.closest('button, a, input, select')) return;
        onOpen(project.id);
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(project.id);
        }
      }}
      className={`${rowHighlightClass} cursor-pointer transition-colors`}
    >
      {/* Numer */}
      <td className="px-2.5 py-2.5 font-mono whitespace-nowrap">
        <button
          type="button"
          onClick={() => onOpen(project.id)}
          className="font-bold text-sky-800 dark:text-sky-300 hover:underline text-left"
        >
          {project.key}
        </button>
      </td>

      {/* Nazwa */}
      <td className="px-2.5 py-2.5 min-w-[160px] max-w-[260px]">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            ref={nameTooltip.containerRef}
            className="relative inline-flex max-w-full min-w-0 items-center"
          >
            <button
              type="button"
              onClick={() => onOpen(project.id)}
              {...nameTooltip.triggerHandlers}
              className={`font-semibold text-slate-900 dark:text-white hover:text-sky-700 dark:hover:text-sky-300 text-left truncate rounded-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 ${
                nameTooltip.hasTooltip
                  ? 'underline decoration-dotted decoration-slate-400 dark:decoration-slate-500 underline-offset-2'
                  : ''
              }`}
            >
              {nameTooltip.displayName}
            </button>
            {nameTooltip.tooltipNode}
          </span>
          {project.isArchived && (
            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-950/60 text-purple-800 dark:text-purple-200 font-semibold border border-purple-200 dark:border-purple-800 shrink-0">
              <Archive className="w-2.5 h-2.5" aria-hidden="true" />
              <span>Archiwum</span>
            </span>
          )}
        </div>
      </td>

      {/* Rodzaj i podrodzaj */}
      <td className="px-2.5 py-2.5 whitespace-nowrap">
        {typeMeta.hasType ? (
          <div className="flex flex-col items-start gap-0.5">
            <span
              className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded border ${typeMeta.badgeClass}`}
            >
              {typeMeta.label}
            </span>
            {subtypeMeta && (
              <span className="text-[10px] text-slate-600 dark:text-slate-400 pl-0.5">
                {subtypeMeta.label}
              </span>
            )}
          </div>
        ) : (
          <span className="text-slate-500 dark:text-slate-400">Brak</span>
        )}
      </td>

      {/* Firma (pełna nazwa na tle koloru firmy) */}
      <td className="px-2.5 py-2.5 max-w-[200px]">
        {company ? (
          <span
            style={getCompanyBadgeColors(company, isDark ? 'dark' : 'light')}
            title={`Firma prowadząca: ${company.name} (${company.letter})`}
            className="inline-block max-w-full truncate text-[11px] font-bold px-2 py-0.5 rounded border align-middle"
          >
            {company.name}
          </span>
        ) : (
          <span className="text-slate-500 dark:text-slate-400">—</span>
        )}
      </td>

      {/* Zamawiający (tylko dla uprawnionych) */}
      {showClientColumn && (
        <td className="px-2.5 py-2.5 max-w-[180px] text-slate-700 dark:text-slate-300">
          {canSeeClient && project.clientName ? (
            <span className="block truncate" title={project.clientName}>
              {project.clientName}
            </span>
          ) : (
            <span className="text-slate-500 dark:text-slate-400">—</span>
          )}
        </td>
      )}

      {/* Status */}
      <td className="px-2.5 py-2.5 whitespace-nowrap">
        <span
          className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded border ${statusMeta.badgeClass}`}
        >
          {statusMeta.label}
        </span>
      </td>

      {/* Priorytet */}
      <td className="px-2.5 py-2.5 whitespace-nowrap">
        <span className={`text-xs ${priorityMeta.className}`}>{priorityMeta.label}</span>
      </td>

      {/* Termin */}
      <td className="px-2.5 py-2.5 whitespace-nowrap">
        {project.dueDate ? (
          <div className="flex flex-col gap-0.5">
            <span
              className={`font-mono tabular-nums inline-flex items-center gap-1 ${
                deadlineEval.isRed
                  ? 'text-rose-700 dark:text-rose-400 font-bold'
                  : 'text-slate-800 dark:text-slate-200'
              }`}
              title={
                deadlineEval.isOverdue
                  ? 'Termin projektu przekroczony'
                  : deadlineEval.isRed
                    ? 'Zbliżający się termin projektu'
                    : undefined
              }
            >
              {deadlineEval.isRed && (
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              )}
              <span>{project.dueDate}</span>
            </span>
            {deadlineEval.showCounter && deadlineEval.text && (
              <span
                data-testid="project-deadline-counter"
                className={`text-[11px] leading-tight ${
                  deadlineEval.isRed
                    ? 'text-rose-700 dark:text-rose-400 font-semibold'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {deadlineEval.text}
              </span>
            )}
          </div>
        ) : (
          <span className="text-slate-500 dark:text-slate-400">—</span>
        )}
      </td>

      {/* Postęp (pasek i procent) */}
      <td className="px-2.5 py-2.5 whitespace-nowrap">
        <div className="flex items-center gap-2 min-w-[92px]">
          <div
            className="w-14 bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden shrink-0"
            aria-hidden="true"
          >
            <div
              style={{ width: `${clampedProgress}%` }}
              className={`h-full ${
                clampedProgress === 100
                  ? 'bg-emerald-500'
                  : project.priority === 'critical'
                    ? 'bg-rose-500'
                    : 'bg-sky-500'
              }`}
            />
          </div>
          <span className="font-mono tabular-nums text-xs font-bold text-slate-800 dark:text-slate-200">
            {project.progress}%
          </span>
        </div>
      </td>

      {/* Elementy do odbioru */}
      <td className="px-2.5 py-2.5 whitespace-nowrap">
        {deliverablesSummary.total > 0 ? (
          <div className="flex flex-col gap-1 min-w-[110px]">
            <span className="font-mono tabular-nums text-[11px] font-semibold text-slate-800 dark:text-slate-200">
              {deliverablesSummary.label}
            </span>
            <div
              className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden"
              aria-hidden="true"
            >
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
        ) : (
          <span className="text-slate-500 dark:text-slate-400">—</span>
        )}
      </td>

      {/* Zadania otwarte i zaległe */}
      <td className="px-2.5 py-2.5 whitespace-nowrap font-mono tabular-nums text-xs">
        <span className="text-slate-800 dark:text-slate-200 font-semibold">
          {metrics.openCount} otw.
        </span>
        <span aria-hidden="true" className="text-slate-400 dark:text-slate-500 mx-1">
          ·
        </span>
        <span
          className={
            metrics.overdueCount > 0
              ? 'text-rose-700 dark:text-rose-400 font-bold'
              : 'text-slate-600 dark:text-slate-400'
          }
        >
          {metrics.overdueCount} zal.
        </span>
      </td>

      {/* Właściciel */}
      <td className="px-2.5 py-2.5 max-w-[150px] text-slate-700 dark:text-slate-300">
        {owner ? (
          <span className="block truncate" title={owner.name}>
            {owner.name}
          </span>
        ) : (
          <span className="text-slate-500 dark:text-slate-400">—</span>
        )}
      </td>

      {/* Akcje */}
      <td className="px-2.5 py-2.5 text-right whitespace-nowrap">
        <ProjectActions
          project={project}
          currentUser={currentUser}
          variant="row"
          onOpen={onOpen}
          onViewDetails={onViewDetails}
          onOpenFinancials={onOpenFinancials}
          onEdit={onEdit}
          onDownloadIcs={onDownloadIcs}
          onArchive={onArchive}
          onRestore={onRestore}
          onDelete={onDelete}
        />
      </td>
    </tr>
  );
};
