import React from 'react';
import { Project, User } from '../../types';
import { canViewFinance } from '../../utils/access';
import { can } from '../../utils/permissions';
import { Archive, ArchiveRestore, Download, Edit3, Eye, Receipt, Trash2 } from 'lucide-react';

export interface ProjectActionsProps {
  project: Project;
  currentUser: User;
  variant?: 'tile' | 'row';
  onOpen: (projectId: string) => void;
  onViewDetails: (project: Project) => void;
  onOpenFinancials: (project: Project) => void;
  onEdit: (project: Project) => void;
  onDownloadIcs: (project: Project) => void;
  onArchive: (project: Project) => void;
  onRestore: (project: Project) => void;
  onDelete?: (project: Project) => void;
}

export const ProjectActions: React.FC<ProjectActionsProps> = ({
  project,
  currentUser,
  variant = 'tile',
  onOpen,
  onViewDetails,
  onOpenFinancials,
  onEdit,
  onDownloadIcs,
  onArchive,
  onRestore,
  onDelete,
}) => {
  const canViewProjectFinance = canViewFinance(currentUser, project);
  const canEditProject = can(currentUser, 'projects.edit', project);
  const canArchiveProject = can(currentUser, 'projects.archive', project);
  const canDeleteProject = Boolean(onDelete && can(currentUser, 'projects.delete', project));
  const iconButtonPadding = variant === 'row' ? 'p-1.5' : 'p-1';

  return (
    <div className={`flex items-center ${variant === 'row' ? 'justify-end gap-1 whitespace-nowrap' : 'gap-1.5'}`}>
      <button
        type="button"
        onClick={() => onViewDetails(project)}
        className={`${iconButtonPadding} text-slate-600 dark:text-slate-400 hover:text-sky-700 dark:hover:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-950/40 rounded transition-colors`}
        title="Podgląd danych projektu bez wchodzenia w edycję"
        aria-label={`Podgląd projektu ${project.key}`}
      >
        <Eye className="w-4 h-4 text-sky-700 dark:text-sky-400" aria-hidden="true" />
      </button>

      {canViewProjectFinance && (
        <button
          type="button"
          onClick={() => onOpenFinancials(project)}
          className={`${iconButtonPadding} text-slate-600 dark:text-slate-400 hover:text-emerald-700 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 rounded transition-colors`}
          title="Wyceny Inwestorskie, Koszty (Mapa, Geologia, Uzgodnienia)"
          aria-label={`Kosztorys i wyceny projektu ${project.key}`}
        >
          <Receipt className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
        </button>
      )}

      <button
        type="button"
        disabled={!canEditProject}
        onClick={() => {
          if (!canEditProject) return;
          onEdit(project);
        }}
        className={`${iconButtonPadding} text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed rounded transition-colors`}
        title={
          canEditProject
            ? 'Edytuj projekt i dane Zamawiającego'
            : 'Brak uprawnienia: projects.edit. Poproś administratora.'
        }
        aria-label={`Edytuj projekt ${project.key}`}
      >
        <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
      </button>

      <button
        type="button"
        onClick={() => onDownloadIcs(project)}
        className={`${iconButtonPadding} text-slate-600 dark:text-slate-400 hover:text-sky-700 dark:hover:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-950/40 rounded transition-colors`}
        title="Pobierz terminarz projektu (.ics)"
        aria-label={`Pobierz terminarz projektu ${project.key} (.ics)`}
      >
        <Download className="w-3.5 h-3.5" aria-hidden="true" />
      </button>

      {project.isArchived ? (
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={!canArchiveProject}
            onClick={() => {
              if (!canArchiveProject) return;
              onRestore(project);
            }}
            className="px-2 py-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/60 disabled:opacity-40 disabled:cursor-not-allowed rounded flex items-center gap-1 transition-colors border border-emerald-200 dark:border-emerald-800 whitespace-nowrap shrink-0"
            title={
              canArchiveProject
                ? 'Przywróć projekt z archiwum do bieżącej pracy'
                : 'Brak uprawnienia: projects.archive. Poproś administratora.'
            }
            aria-label={`Przywróć projekt ${project.key}`}
          >
            <ArchiveRestore className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
            <span>Przywróć</span>
          </button>
          {onDelete && (
            <button
              type="button"
              disabled={!canDeleteProject}
              onClick={() => {
                if (!canDeleteProject) return;
                onDelete(project);
              }}
              className="px-2 py-1 text-[11px] font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-900/60 disabled:opacity-40 disabled:cursor-not-allowed rounded flex items-center gap-1 transition-colors border border-rose-200 dark:border-rose-800 whitespace-nowrap shrink-0"
              title={
                canDeleteProject
                  ? 'Całkowicie usuń projekt z bazy danych'
                  : 'Brak uprawnienia: projects.delete. Poproś administratora.'
              }
              aria-label={`Usuń projekt ${project.key} z bazy`}
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-700 dark:text-rose-400" aria-hidden="true" />
              <span>Usuń z bazy</span>
            </button>
          )}
        </div>
      ) : (
        <>
          <button
            type="button"
            disabled={!canArchiveProject}
            onClick={() => {
              if (!canArchiveProject) return;
              onArchive(project);
            }}
            className={`${iconButtonPadding} text-slate-600 dark:text-slate-400 hover:text-purple-700 dark:hover:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950/40 disabled:opacity-40 disabled:cursor-not-allowed rounded transition-colors`}
            title={
              canArchiveProject
                ? 'Przenieś projekt do archiwum'
                : 'Brak uprawnienia: projects.archive. Poproś administratora.'
            }
            aria-label={`Przenieś projekt ${project.key} do archiwum`}
          >
            <Archive className="w-3.5 h-3.5 text-purple-700 dark:text-purple-400" aria-hidden="true" />
          </button>

          {onDelete && (
            <button
              type="button"
              disabled={!canDeleteProject}
              onClick={() => {
                if (!canDeleteProject) return;
                onDelete(project);
              }}
              className={`${iconButtonPadding} text-slate-600 dark:text-slate-400 hover:text-rose-700 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-40 disabled:cursor-not-allowed rounded transition-colors`}
              title={
                canDeleteProject
                  ? 'Usuń projekt'
                  : 'Brak uprawnienia: projects.delete. Poproś administratora.'
              }
              aria-label={`Usuń projekt ${project.key}`}
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </>
      )}

      <button
        type="button"
        onClick={() => onOpen(project.id)}
        aria-label={`Otwórz projekt ${project.key}`}
        className="text-xs font-semibold text-sky-700 hover:text-sky-800 dark:text-sky-400 hover:underline px-1.5 py-0.5 whitespace-nowrap shrink-0"
      >
        Otwórz <span aria-hidden="true">→</span>
      </button>
    </div>
  );
};
