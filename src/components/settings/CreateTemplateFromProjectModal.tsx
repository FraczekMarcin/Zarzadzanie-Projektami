import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Project, ProjectTemplate, Task } from '../../types';
import { TEMPLATE_LIMITS } from '../../utils/templateValidation';
import { createTemplateFromProjectOnServer } from '../../utils/projectTemplates';
import { getOrderedProjectTypes, getProjectDisplayName } from '../../utils/projectMeta';
import { useVariables } from '../../hooks/useVariables';
import { useFocusTrap } from '../../utils/useFocusTrap';
import { useDismissOnOutsideClick } from '../../hooks/useDismissOnOutsideClick';
import { useFormSubmit } from '../../hooks/useFormSubmit';
import { DiscardChangesModal } from '../DiscardChangesModal';
import { FormError } from '../FormError';
import { Building2, CheckSquare, Layers, X } from 'lucide-react';

interface CreateTemplateFromProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  projects: Project[];
  tasks: Task[];
  onCreated: (template: ProjectTemplate) => void;
}

interface TreeTaskNode {
  task: Task;
  depth: number;
  ancestorIds: string[];
  descendantIds: string[];
}

const INDENT_CLASSES = ['pl-2', 'pl-7', 'pl-12', 'pl-16', 'pl-20', 'pl-24'] as const;

function buildProjectTaskTree(projectTasks: Task[]): TreeTaskNode[] {
  const byId = new Map<string, Task>();
  const childrenMap = new Map<string, Task[]>();

  for (const t of projectTasks) {
    if (t && t.id) {
      byId.set(t.id, t);
    }
  }

  const roots: Task[] = [];
  for (const t of projectTasks) {
    if (!t || !t.id) continue;
    const pid = typeof t.parentId === 'string' ? t.parentId.trim() : '';
    if (pid && pid !== t.id && byId.has(pid)) {
      const list = childrenMap.get(pid) || [];
      list.push(t);
      childrenMap.set(pid, list);
    } else {
      roots.push(t);
    }
  }

  const sortSiblings = (arr: Task[]) =>
    [...arr].sort((a, b) => {
      const dCmp = String(a.startDate || '').localeCompare(String(b.startDate || ''));
      if (dCmp !== 0) return dCmp;
      return String(a.code || '').localeCompare(String(b.code || ''));
    });

  const collectDescendants = (taskId: string, seen = new Set<string>()): string[] => {
    const out: string[] = [];
    for (const child of childrenMap.get(taskId) || []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      out.push(child.id, ...collectDescendants(child.id, seen));
    }
    return out;
  };

  const result: TreeTaskNode[] = [];
  const visited = new Set<string>();

  const walk = (node: Task, depth: number, ancestors: string[]) => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    result.push({
      task: node,
      depth: Math.min(depth, INDENT_CLASSES.length - 1),
      ancestorIds: ancestors,
      descendantIds: collectDescendants(node.id),
    });
    const nextAncestors = [...ancestors, node.id];
    for (const child of sortSiblings(childrenMap.get(node.id) || [])) {
      walk(child, depth + 1, nextAncestors);
    }
  };

  for (const root of sortSiblings(roots)) {
    walk(root, 0, []);
  }

  return result;
}

export const CreateTemplateFromProjectModal: React.FC<CreateTemplateFromProjectModalProps> = ({
  isOpen,
  onClose,
  projects,
  tasks,
  onCreated,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const uid = useId();
  const titleId = `${uid}-title`;

  const { projectTypes } = useVariables();
  const orderedProjectTypes = useMemo(() => getOrderedProjectTypes(projectTypes), [projectTypes]);
  const fallbackTypeId = useMemo(() => {
    if (orderedProjectTypes.some((t) => t.id === 'inne')) return 'inne';
    return orderedProjectTypes[0]?.id || 'inne';
  }, [orderedProjectTypes]);

  const resolveInitialTypeForProject = (proj: Project | undefined): string => {
    if (proj?.typeId && orderedProjectTypes.some((t) => t.id === proj.typeId)) {
      return proj.typeId;
    }
    return fallbackTypeId;
  };

  const selectableProjects = useMemo(
    () => projects.filter((p) => !p.isDemo),
    [projects]
  );
  const effectiveProjects = selectableProjects.length > 0 ? selectableProjects : projects;

  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [nameEditedManually, setNameEditedManually] = useState<boolean>(false);
  const [typeId, setTypeId] = useState<string>(fallbackTypeId);
  const [typeEditedManually, setTypeEditedManually] = useState<boolean>(false);
  const [description, setDescription] = useState<string>('');
  const [skipCompleted, setSkipCompleted] = useState<boolean>(false);
  const [preserveAssigneeRoles, setPreserveAssigneeRoles] = useState<boolean>(false);
  const [includeDeliverables, setIncludeDeliverables] = useState<boolean>(true);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const createSubmit = useFormSubmit();
  const errorAlertId = `${uid}-error`;

  const selectedProject = useMemo(
    () => effectiveProjects.find((p) => p.id === selectedProjectId),
    [effectiveProjects, selectedProjectId]
  );

  const projectTasks = useMemo(
    () => tasks.filter((t) => t.projectId === selectedProjectId),
    [tasks, selectedProjectId]
  );

  const treeNodes = useMemo(
    () => buildProjectTaskTree(projectTasks),
    [projectTasks]
  );

  useEffect(() => {
    if (!isOpen) return;
    const initialProj = effectiveProjects[0];
    if (initialProj) {
      setSelectedProjectId(initialProj.id);
      const dispName = getProjectDisplayName(initialProj) || initialProj.name;
      setName(`Szablon: ${dispName}`.slice(0, TEMPLATE_LIMITS.name));
      const initialTasks = tasks.filter((t) => t.projectId === initialProj.id);
      setSelectedTaskIds(new Set(initialTasks.map((t) => t.id)));
      setTypeId(resolveInitialTypeForProject(initialProj));
      setIncludeDeliverables(Boolean(initialProj.deliverables && initialProj.deliverables.length > 0));
    } else {
      setSelectedProjectId('');
      setName('');
      setSelectedTaskIds(new Set());
      setTypeId(fallbackTypeId);
      setIncludeDeliverables(false);
    }
    setNameEditedManually(false);
    setTypeEditedManually(false);
    setDescription('');
    setSkipCompleted(false);
    setPreserveAssigneeRoles(false);
    createSubmit.clearError();
  }, [isOpen, effectiveProjects, tasks, createSubmit.clearError, fallbackTypeId]);

  const handleProjectChange = (nextProjectId: string) => {
    setSelectedProjectId(nextProjectId);
    const proj = effectiveProjects.find((p) => p.id === nextProjectId);
    if (proj && !nameEditedManually) {
      const dispName = getProjectDisplayName(proj) || proj.name;
      setName(`Szablon: ${dispName}`.slice(0, TEMPLATE_LIMITS.name));
    }
    if (!typeEditedManually) {
      setTypeId(resolveInitialTypeForProject(proj));
    }
    setIncludeDeliverables(Boolean(proj?.deliverables && proj.deliverables.length > 0));
    const nextTasks = tasks.filter((t) => t.projectId === nextProjectId);
    setSelectedTaskIds(new Set(nextTasks.map((t) => t.id)));
    createSubmit.clearError();
  };

  const isDirty = Boolean(
    isOpen &&
      (nameEditedManually ||
        typeEditedManually ||
        description.trim() ||
        skipCompleted ||
        preserveAssigneeRoles)
  );

  const {
    backdropProps,
    flashClassName,
    requestClose,
    isDiscardModalOpen,
    confirmDiscard,
    cancelDiscard,
  } = useDismissOnOutsideClick({
    isOpen,
    mode: 'form',
    panelRef: modalRef,
    onDismiss: () => {
      if (!createSubmit.isSubmitting) onClose();
    },
    isDirty,
    disabled: createSubmit.isSubmitting,
    cancelButtonRef: cancelRef,
  });

  useFocusTrap({
    isOpen,
    containerRef: modalRef,
    onClose: () => {
      if (!createSubmit.isSubmitting) requestClose();
    },
    disableEscape: createSubmit.isSubmitting,
  });

  if (!isOpen) return null;

  const toggleTaskSelection = (node: TreeTaskNode, checked: boolean) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(node.task.id);
        for (const ancId of node.ancestorIds) {
          next.add(ancId);
        }
      } else {
        next.delete(node.task.id);
        for (const descId of node.descendantIds) {
          next.delete(descId);
        }
      }
      return next;
    });
  };

  const effectiveSelectedTaskIds = treeNodes
    .filter((node) => {
      if (!selectedTaskIds.has(node.task.id)) return false;
      if (node.ancestorIds.some((aid) => !selectedTaskIds.has(aid))) return false;
      if (skipCompleted && node.task.status === 'done') return false;
      return true;
    })
    .map((node) => node.task.id);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    createSubmit.clearError();

    if (!selectedProjectId) {
      createSubmit.setValidationError('Wybierz projekt źródłowy.', 'projectId');
      return;
    }
    if (!name.trim()) {
      createSubmit.setValidationError('Podaj nazwę nowego szablonu.', 'name');
      return;
    }
    if (effectiveSelectedTaskIds.length === 0) {
      createSubmit.setValidationError('Wybierz co najmniej jedno zadanie do zapisania w szablonie.');
      return;
    }

    await createSubmit.submit(
      async () => {
        const res = await createTemplateFromProjectOnServer(selectedProjectId, {
          name: name.trim(),
          typeId,
          ...(description.trim() ? { description: description.trim() } : {}),
          selectedTaskIds: Array.from(selectedTaskIds),
          skipCompleted,
          preserveAssigneeRoles,
          includeDeliverables,
        });
        onCreated(res.template);
        onClose();
        return { ok: true };
      },
      { fallbackError: 'Nie udało się utworzyć szablonu z projektu.' }
    );
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-slate-950/75 backdrop-blur-2xs flex items-center justify-center p-4"
      {...backdropProps}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-2xl overflow-hidden text-xs ${flashClassName}`}
      >
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/70 text-slate-900 dark:text-slate-100 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-sky-100 dark:bg-sky-950/70 text-sky-700 dark:text-sky-300">
              <Building2 className="w-4 h-4" aria-hidden="true" />
            </div>
            <div>
              <h3 id={titleId} className="text-sm font-bold text-slate-900 dark:text-white">
                Utwórz szablon z istniejącego projektu
              </h3>
              <p className="text-[11px] text-slate-600 dark:text-slate-400">
                Kopiuje strukturę zadań, podzadania i zależności bez danych finansowych, postępu oraz komentarzy.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={createSubmit.isSubmitting}
            onClick={requestClose}
            aria-label="Zamknij okno tworzenia szablonu z projektu"
            className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
          <FormError
            id={errorAlertId}
            error={createSubmit.submitError}
            alertRef={createSubmit.alertRef}
            onDismiss={createSubmit.clearError}
          />

          {effectiveProjects.length === 0 ? (
            <div className="p-4 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200">
              Brak dostępnych projektów do zapisania jako szablon.
            </div>
          ) : (
            <>
              <div>
                <label htmlFor={`${uid}-project`} className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                  Projekt źródłowy *
                </label>
                <select
                  id={`${uid}-project`}
                  value={selectedProjectId}
                  onChange={(e) => handleProjectChange(e.target.value)}
                  {...createSubmit.getFieldA11yProps('projectId', errorAlertId)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  {effectiveProjects.map((p) => {
                    const count = tasks.filter((t) => t.projectId === p.id).length;
                    return (
                      <option key={p.id} value={p.id}>
                        [{p.key}] {getProjectDisplayName(p)} ({count} zadań)
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor={`${uid}-name`} className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                    Nazwa szablonu *
                  </label>
                  <input
                    id={`${uid}-name`}
                    type="text"
                    required
                    maxLength={TEMPLATE_LIMITS.name}
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      setNameEditedManually(true);
                    }}
                    {...createSubmit.getFieldA11yProps('name', errorAlertId)}
                    placeholder="np. Standard Obiektu Kubaturowego"
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>

                <div>
                  <label htmlFor={`${uid}-type`} className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                    Rodzaj projektu
                  </label>
                  <select
                    id={`${uid}-type`}
                    value={typeId}
                    onChange={(e) => {
                      setTypeId(e.target.value);
                      setTypeEditedManually(true);
                    }}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    {orderedProjectTypes
                      .filter((pt) => pt.isActive !== false || pt.id === typeId)
                      .map((pt) => (
                        <option key={pt.id} value={pt.id}>
                          {pt.label}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor={`${uid}-desc`} className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                  Opis szablonu (opcjonalnie)
                </label>
                <textarea
                  id={`${uid}-desc`}
                  rows={2}
                  maxLength={TEMPLATE_LIMITS.description}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Zakres etapów i przeznaczenie szablonu (bez danych poufnych i finansowych)..."
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              {/* Opcje */}
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-slate-800 dark:text-slate-200 space-y-2">
                <label htmlFor={`${uid}-skip-done`} className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    id={`${uid}-skip-done`}
                    type="checkbox"
                    checked={skipCompleted}
                    onChange={(e) => setSkipCompleted(e.target.checked)}
                    className="rounded border-slate-300 dark:border-slate-600 text-sky-600 focus:ring-sky-500"
                  />
                  <span>Pomiń zakończone zadania</span>
                </label>
                <label htmlFor={`${uid}-preserve-roles`} className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    id={`${uid}-preserve-roles`}
                    type="checkbox"
                    checked={preserveAssigneeRoles}
                    onChange={(e) => setPreserveAssigneeRoles(e.target.checked)}
                    className="rounded border-slate-300 dark:border-slate-600 text-sky-600 focus:ring-sky-500"
                  />
                  <span>Zachowaj przypisania jako role (właściciel projektu / zgłaszający)</span>
                </label>
                <label htmlFor={`${uid}-include-deliverables`} className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    id={`${uid}-include-deliverables`}
                    type="checkbox"
                    checked={includeDeliverables}
                    disabled={!selectedProject?.deliverables?.length}
                    onChange={(e) => setIncludeDeliverables(e.target.checked)}
                    className="rounded border-slate-300 dark:border-slate-600 text-sky-600 focus:ring-sky-500 disabled:opacity-50"
                  />
                  <span>
                    Kopiuj elementy do odbioru projektu (
                    {selectedProject?.deliverables?.length || 0})
                  </span>
                </label>
              </div>

              {/* Drzewo zadań projektu */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <CheckSquare className="w-4 h-4 text-sky-700 dark:text-sky-400" aria-hidden="true" />
                    <span>
                      Zadania do uwzględnienia ({effectiveSelectedTaskIds.length} z {treeNodes.length})
                    </span>
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedTaskIds(new Set(treeNodes.map((n) => n.task.id)))}
                      className="text-[11px] font-semibold text-sky-700 dark:text-sky-400 hover:underline"
                    >
                      Zaznacz wszystkie
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedTaskIds(new Set())}
                      className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 hover:underline"
                    >
                      Odznacz wszystkie
                    </button>
                  </div>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                  Odznaczenie zadania nadrzędnego automatycznie pomija wszystkie jego podzadania.
                </p>

                {treeNodes.length === 0 ? (
                  <div className="p-4 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 text-center text-slate-600 dark:text-slate-400">
                    Wybrany projekt nie zawiera żadnych zadań.
                  </div>
                ) : (
                  <div className="max-h-60 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100">
                    {treeNodes.map((node) => {
                      const hasUncheckedAncestor = node.ancestorIds.some(
                        (aid) => !selectedTaskIds.has(aid)
                      );
                      const isChecked =
                        !hasUncheckedAncestor && selectedTaskIds.has(node.task.id);
                      const isSkippedByStatus = skipCompleted && node.task.status === 'done';
                      const indentCls = INDENT_CLASSES[node.depth] || 'pl-2';
                      const cbId = `${uid}-task-${node.task.id}`;

                      return (
                        <label
                          key={node.task.id}
                          htmlFor={cbId}
                          className={`flex items-center justify-between gap-2 py-2 pr-3 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60 ${indentCls} ${
                            hasUncheckedAncestor || isSkippedByStatus ? 'opacity-55' : ''
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <input
                              id={cbId}
                              type="checkbox"
                              checked={isChecked}
                              disabled={hasUncheckedAncestor}
                              onChange={(e) => toggleTaskSelection(node, e.target.checked)}
                              className="rounded border-slate-300 dark:border-slate-600 text-sky-600 focus:ring-sky-500 shrink-0"
                            />
                            <span className="font-mono text-[11px] text-slate-600 dark:text-slate-400 shrink-0">
                              {node.task.code}
                            </span>
                            <span className="truncate font-medium text-slate-900 dark:text-slate-100">
                              {node.task.title}
                            </span>
                            {node.task.isOfficialDeadline && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800 shrink-0">
                                Urzędowy
                              </span>
                            )}
                            {isSkippedByStatus && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 shrink-0">
                                Pominięte (zakończone)
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] font-mono text-slate-600 dark:text-slate-400 shrink-0">
                            {node.task.durationDays || 1}d
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}

          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
            <button
              ref={cancelRef}
              type="button"
              disabled={createSubmit.isSubmitting}
              onClick={requestClose}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 font-semibold transition-colors"
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={createSubmit.isSubmitting || effectiveProjects.length === 0 || effectiveSelectedTaskIds.length === 0}
              className="px-4 py-2 rounded-lg bg-sky-700 hover:bg-sky-800 disabled:opacity-50 text-white font-semibold flex items-center gap-1.5 transition-colors"
            >
              <Layers className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{createSubmit.isSubmitting ? 'Zapisywanie...' : 'Utwórz szablon'}</span>
            </button>
          </div>
        </form>
      </div>
      <DiscardChangesModal
        isOpen={isDiscardModalOpen}
        onCancel={cancelDiscard}
        onConfirm={confirmDiscard}
      />
    </div>
  );
};
