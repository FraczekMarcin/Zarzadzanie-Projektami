import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import type {
  Priority,
  ProjectTemplate,
  TemplateAssigneeRole,
  TemplateDeliverableBlueprint,
  TemplateTaskBlueprint,
} from '../../types';
import { useDismissOnOutsideClick } from '../../hooks/useDismissOnOutsideClick';
import { useFocusTrap } from '../../utils/useFocusTrap';
import { useVariables } from '../../hooks/useVariables';
import { useFormSubmit } from '../../hooks/useFormSubmit';
import { DiscardChangesModal } from '../DiscardChangesModal';
import { FormError } from '../FormError';
import {
  DELIVERABLE_LIMITS,
  getOrderedProjectTypes,
} from '../../utils/projectMeta';
import {
  MAX_TEMPLATE_DAYS,
  MAX_TEMPLATE_TASKS,
  validateTemplateWritePayload,
} from '../../utils/templateValidation';
import {
  ASSIGNEE_ROLE_LABELS,
  TemplateEditorDraft,
  TemplateEditorHistory,
  addTemplateTask,
  applyStartAfterPredecessor,
  buildTreeOrderedTasks,
  canReparentTemplateTask,
  computeTemplateDurationFromTasks,
  computeTemplateWarningsAndStats,
  createDraftFromTemplate,
  createEditorHistory,
  deleteTemplateTaskSubtree,
  duplicateTemplateTask,
  getEligibleBlockerCandidates,
  getEligibleStartAfterPredecessors,
  indentTemplateTask,
  moveTemplateTaskSibling,
  outdentTemplateTask,
  pushEditorState,
  redoEditorState,
  reparentTemplateTask,
  undoEditorState,
} from '../../utils/templateEditor';
import {
  TemplateConflictError,
  updateTemplateOnServer,
} from '../../utils/projectTemplates';
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BarChart3,
  Clock,
  Copy,
  GitBranch,
  GripVertical,
  Layers,
  PackageCheck,
  Plus,
  Redo2,
  Save,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';

export interface TemplateEditorModalProps {
  isOpen: boolean;
  template: ProjectTemplate | null;
  onClose: () => void;
  onSaved: (updated: ProjectTemplate, revision?: number) => void;
}

const DEPTH_PADDING_CLASSES = ['pl-2', 'pl-6', 'pl-10', 'pl-14', 'pl-18', 'pl-22'] as const;

const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'Niski',
  normal: 'Normalny',
  high: 'Wysoki',
  critical: 'Krytyczny',
};

function serializeDraftForDirty(draft: TemplateEditorDraft): string {
  return JSON.stringify(draft);
}

export const TemplateEditorModal: React.FC<TemplateEditorModalProps> = ({
  isOpen,
  template,
  onClose,
  onSaved,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const uid = useId();
  const { taskTypes, projectTypes } = useVariables();
  const orderedProjectTypes = useMemo(() => getOrderedProjectTypes(projectTypes), [projectTypes]);

  const [history, setHistory] = useState<TemplateEditorHistory>(() =>
    createEditorHistory({
      name: '',
      typeId: 'inne',
      description: '',
      defaultPriority: 'normal',
      defaultDurationDays: 30,
      durationManualOverride: false,
      defaultBudget: '',
      tasks: [],
      deliverables: [],
    })
  );
  const [baselineSnapshot, setBaselineSnapshot] = useState<string>('');
  const [expectedRevision, setExpectedRevision] = useState<number>(1);
  const [selectedTaskKey, setSelectedTaskKey] = useState<string | null>(null);
  const [pendingDeleteKey, setPendingDeleteKey] = useState<string | null>(null);
  const [tagsText, setTagsText] = useState<string>('');
  const [showTimeline, setShowTimeline] = useState<boolean>(true);
  const [newDelName, setNewDelName] = useState<string>('');
  const [newDelCopies, setNewDelCopies] = useState<number>(1);
  const [newDelUnit, setNewDelUnit] = useState<string>(DELIVERABLE_LIMITS.defaultUnit);
  const [newDelNotes, setNewDelNotes] = useState<string>('');
  const saveSubmit = useFormSubmit();
  const errorAlertId = `${uid}-error`;
  const [conflictTemplate, setConflictTemplate] = useState<ProjectTemplate | null>(null);

  // Drag & drop (HTML5 + dotykowy pointer fallback)
  const [draggedKey, setDraggedKey] = useState<string | null>(null);
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);
  const pointerDragRef = useRef<{ key: string; pointerId: number } | null>(null);

  const loadTemplateIntoEditor = (tpl: ProjectTemplate) => {
    const initialDraft = createDraftFromTemplate(tpl);
    setHistory(createEditorHistory(initialDraft));
    setBaselineSnapshot(serializeDraftForDirty(initialDraft));
    setExpectedRevision(typeof tpl.revision === 'number' ? tpl.revision : 1);
    const ordered = buildTreeOrderedTasks(initialDraft.tasks);
    setSelectedTaskKey(ordered[0]?.task.key ?? null);
    setPendingDeleteKey(null);
    setNewDelName('');
    setNewDelCopies(1);
    setNewDelUnit(DELIVERABLE_LIMITS.defaultUnit);
    setNewDelNotes('');
    saveSubmit.clearError();
    setConflictTemplate(null);
    setDraggedKey(null);
    setDropTargetKey(null);
  };

  useEffect(() => {
    if (!isOpen || !template) return;
    loadTemplateIntoEditor(template);
  }, [isOpen, template?.id]);

  const draft = history.present;

  const isDirty = useMemo(() => {
    if (!isOpen || !template || !baselineSnapshot) return false;
    return serializeDraftForDirty(draft) !== baselineSnapshot;
  }, [isOpen, template, baselineSnapshot, draft]);

  const orderedNodes = useMemo(() => buildTreeOrderedTasks(draft.tasks), [draft.tasks]);

  const selectedTask = useMemo(
    () => draft.tasks.find((t) => t.key === selectedTaskKey) ?? null,
    [draft.tasks, selectedTaskKey]
  );

  useEffect(() => {
    setTagsText(selectedTask?.tags ? selectedTask.tags.join(', ') : '');
    setPendingDeleteKey(null);
  }, [selectedTaskKey]);

  const summary = useMemo(() => computeTemplateWarningsAndStats(draft), [draft]);

  const {
    backdropProps,
    flashClassName,
    requestClose,
    isDiscardModalOpen,
    confirmDiscard,
    cancelDiscard,
  } = useDismissOnOutsideClick({
    isOpen: isOpen && Boolean(template),
    mode: 'form',
    panelRef,
    onDismiss: () => {
      if (!saveSubmit.isSubmitting) onClose();
    },
    disabled: saveSubmit.isSubmitting,
    isDirty,
    cancelButtonRef,
  });

  useFocusTrap({
    isOpen: isOpen && Boolean(template),
    containerRef: panelRef,
    onClose: requestClose,
    disableEscape: saveSubmit.isSubmitting,
  });

  const commitDraft = (updater: (curr: TemplateEditorDraft) => TemplateEditorDraft) => {
    saveSubmit.clearError();
    setHistory((prev) => pushEditorState(prev, updater(prev.present)));
  };

  const handleUndo = () => {
    saveSubmit.clearError();
    setHistory((prev) => undoEditorState(prev));
  };

  const handleRedo = () => {
    saveSubmit.clearError();
    setHistory((prev) => redoEditorState(prev));
  };

  const updateSelectedTask = (
    updater: (task: TemplateTaskBlueprint) => TemplateTaskBlueprint
  ) => {
    if (!selectedTaskKey) return;
    commitDraft((curr) => ({
      ...curr,
      tasks: curr.tasks.map((t) => (t.key === selectedTaskKey ? updater(t) : t)),
    }));
  };

  const handleAddRootTask = () => {
    const res = addTemplateTask(draft.tasks, { afterKey: selectedTaskKey || undefined });
    if (!res.ok) {
      saveSubmit.setValidationError(res.error);
      return;
    }
    commitDraft((curr) => ({ ...curr, tasks: res.tasks }));
    setSelectedTaskKey(res.createdKey);
  };

  const handleAddSubtask = () => {
    if (!selectedTaskKey) return;
    const res = addTemplateTask(draft.tasks, { parentKey: selectedTaskKey });
    if (!res.ok) {
      saveSubmit.setValidationError(res.error);
      return;
    }
    commitDraft((curr) => ({ ...curr, tasks: res.tasks }));
    setSelectedTaskKey(res.createdKey);
  };

  const handleDuplicateTask = (key: string) => {
    const res = duplicateTemplateTask(draft.tasks, key);
    if (!res.ok) {
      saveSubmit.setValidationError(res.error);
      return;
    }
    commitDraft((curr) => ({ ...curr, tasks: res.tasks }));
    setSelectedTaskKey(res.createdKey);
  };

  const handleConfirmDeleteTask = (key: string) => {
    const nextTasks = deleteTemplateTaskSubtree(draft.tasks, key);
    commitDraft((curr) => ({ ...curr, tasks: nextTasks }));
    setPendingDeleteKey(null);
    if (selectedTaskKey === key || !nextTasks.some((t) => t.key === selectedTaskKey)) {
      const nextOrdered = buildTreeOrderedTasks(nextTasks);
      setSelectedTaskKey(nextOrdered[0]?.task.key ?? null);
    }
  };

  const handleMoveSibling = (key: string, direction: 'up' | 'down') => {
    const nextTasks = moveTemplateTaskSibling(draft.tasks, key, direction);
    commitDraft((curr) => ({ ...curr, tasks: nextTasks }));
  };

  const handleIndentTask = (key: string) => {
    const res = indentTemplateTask(draft.tasks, key);
    if (!res.ok) {
      saveSubmit.setValidationError(res.error);
      return;
    }
    commitDraft((curr) => ({ ...curr, tasks: res.tasks }));
  };

  const handleOutdentTask = (key: string) => {
    const res = outdentTemplateTask(draft.tasks, key);
    if (!res.ok) {
      saveSubmit.setValidationError(res.error);
      return;
    }
    commitDraft((curr) => ({ ...curr, tasks: res.tasks }));
  };

  const handleReparentDrop = (sourceKey: string, targetParentKey: string | undefined) => {
    setDraggedKey(null);
    setDropTargetKey(null);
    if (!sourceKey || sourceKey === targetParentKey) return;
    const check = canReparentTemplateTask(draft.tasks, sourceKey, targetParentKey);
    if (!check.ok) {
      saveSubmit.setValidationError(check.error);
      return;
    }
    const res = reparentTemplateTask(draft.tasks, sourceKey, targetParentKey);
    if (!res.ok) {
      saveSubmit.setValidationError(res.error);
      return;
    }
    commitDraft((curr) => ({ ...curr, tasks: res.tasks }));
  };

  // Obsługa przeciągania wskaźnikiem/dotykiem na uchwycie
  useEffect(() => {
    if (!draggedKey || !pointerDragRef.current) return;

    const resolveTargetUnderPoint = (clientX: number, clientY: number): string | null => {
      const el = document.elementFromPoint(clientX, clientY);
      if (!el) return null;
      const rootZone = el.closest('[data-tpl-root-drop="true"]');
      if (rootZone) return '__root__';
      const row = el.closest<HTMLElement>('[data-tpl-task-key]');
      if (row) {
        return row.dataset.tplTaskKey || null;
      }
      return null;
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!pointerDragRef.current || e.pointerId !== pointerDragRef.current.pointerId) return;
      const target = resolveTargetUnderPoint(e.clientX, e.clientY);
      setDropTargetKey(target);
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (!pointerDragRef.current || e.pointerId !== pointerDragRef.current.pointerId) return;
      const source = pointerDragRef.current.key;
      const target = resolveTargetUnderPoint(e.clientX, e.clientY);
      pointerDragRef.current = null;
      if (target === '__root__') {
        handleReparentDrop(source, undefined);
      } else if (target && target !== source) {
        handleReparentDrop(source, target);
      } else {
        setDraggedKey(null);
        setDropTargetKey(null);
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [draggedKey, draft.tasks]);

  const handleAddDeliverable = () => {
    const cleanName = newDelName.trim();
    if (!cleanName) {
      saveSubmit.setValidationError('Podaj nazwę elementu do odbioru.');
      return;
    }
    if (draft.deliverables.length >= DELIVERABLE_LIMITS.maxItems) {
      saveSubmit.setValidationError(
        `Szablon może zawierać maksymalnie ${DELIVERABLE_LIMITS.maxItems} elementów do odbioru.`
      );
      return;
    }
    const copies = Math.min(
      DELIVERABLE_LIMITS.copiesMax,
      Math.max(DELIVERABLE_LIMITS.copiesMin, Math.round(Number(newDelCopies) || 1))
    );
    const unit = newDelUnit.trim().slice(0, DELIVERABLE_LIMITS.unitMax) || DELIVERABLE_LIMITS.defaultUnit;
    const notes = newDelNotes.trim().slice(0, DELIVERABLE_LIMITS.notesMax);
    const nextItem: TemplateDeliverableBlueprint = {
      id: `tdel-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: cleanName.slice(0, DELIVERABLE_LIMITS.nameMax),
      copies,
      unit,
      ...(notes ? { notes } : {}),
    };
    commitDraft((curr) => ({
      ...curr,
      deliverables: [...curr.deliverables, nextItem],
    }));
    setNewDelName('');
    setNewDelCopies(1);
    setNewDelUnit(DELIVERABLE_LIMITS.defaultUnit);
    setNewDelNotes('');
  };

  const handleUpdateDeliverable = (
    id: string,
    patch: Partial<TemplateDeliverableBlueprint>
  ) => {
    commitDraft((curr) => ({
      ...curr,
      deliverables: curr.deliverables.map((item) =>
        item.id === id ? { ...item, ...patch } : item
      ),
    }));
  };

  const handleMoveDeliverable = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= draft.deliverables.length) return;
    commitDraft((curr) => {
      const next = [...curr.deliverables];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return { ...curr, deliverables: next };
    });
  };

  const handleDeleteDeliverable = (id: string) => {
    commitDraft((curr) => ({
      ...curr,
      deliverables: curr.deliverables.filter((d) => d.id !== id),
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!template) return;

    const cleanedDeliverables: TemplateDeliverableBlueprint[] = draft.deliverables
      .filter((d) => d && typeof d.name === 'string' && d.name.trim())
      .map((d) => ({
        id: d.id,
        name: d.name.trim(),
        copies: Math.min(
          DELIVERABLE_LIMITS.copiesMax,
          Math.max(DELIVERABLE_LIMITS.copiesMin, Math.round(Number(d.copies) || 1))
        ),
        unit: (typeof d.unit === 'string' && d.unit.trim()) || DELIVERABLE_LIMITS.defaultUnit,
        ...(typeof d.notes === 'string' && d.notes.trim() ? { notes: d.notes.trim() } : {}),
      }));

    const payload = {
      name: draft.name.trim(),
      typeId: draft.typeId,
      description: draft.description.trim(),
      defaultDurationDays: draft.durationManualOverride
        ? Math.max(1, Math.min(MAX_TEMPLATE_DAYS, Math.round(draft.defaultDurationDays || 1)))
        : computeTemplateDurationFromTasks(draft.tasks),
      defaultPriority: draft.defaultPriority,
      ...(draft.defaultBudget.trim() ? { defaultBudget: draft.defaultBudget.trim() } : {}),
      ...(template.sourceProjectId ? { sourceProjectId: template.sourceProjectId } : {}),
      tasks: draft.tasks.map((t) => ({
        ...t,
        title: t.title.trim(),
        description: (t.description || '').trim(),
      })),
      deliverables: cleanedDeliverables,
    };

    const localValidation = validateTemplateWritePayload(payload, projectTypes);
    if (!localValidation.ok) {
      saveSubmit.setValidationError(localValidation.error);
      return;
    }

    setConflictTemplate(null);
    await saveSubmit.submit(
      async () => {
        try {
          const res = await updateTemplateOnServer(template.id, payload, {
            expectedRevision,
          });
          onSaved(res.template, res.revision);
          onClose();
          return { ok: true };
        } catch (err: unknown) {
          if (err instanceof TemplateConflictError && err.currentTemplate) {
            setConflictTemplate(err.currentTemplate);
          }
          throw err;
        }
      },
      { fallbackError: 'Nie udało się zapisać zmian szablonu.' }
    );
  };

  if (!isOpen || !template) return null;

  const eligibleBlockers = selectedTask
    ? getEligibleBlockerCandidates(draft.tasks, selectedTask.key)
    : [];
  const startAfterCandidates = selectedTask
    ? getEligibleStartAfterPredecessors(draft.tasks, selectedTask.key)
    : [];

  const timelineHorizon = Math.max(
    1,
    draft.durationManualOverride
      ? draft.defaultDurationDays
      : computeTemplateDurationFromTasks(draft.tasks),
    summary.totalDurationDays
  );

  const pendingDeleteSubtreeCount = pendingDeleteKey
    ? (orderedNodes.find((n) => n.task.key === pendingDeleteKey)?.descendantKeys.length ?? 0)
    : 0;

  return (
    <div
      className="fixed inset-0 z-[60] bg-slate-950/75 backdrop-blur-2xs flex items-center justify-center p-2 sm:p-4"
      {...backdropProps}
      onPointerDown={(e) => {
        e.stopPropagation();
        backdropProps.onPointerDown(e);
      }}
      onClick={(e) => {
        e.stopPropagation();
        backdropProps.onClick(e);
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`w-full max-w-6xl max-h-[94vh] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-2xl flex flex-col overflow-hidden text-xs ${flashClassName}`}
      >
        {/* Nagłówek */}
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <Layers className="w-5 h-5 text-purple-700 dark:text-purple-400 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <h2 id={titleId} className="text-sm font-bold text-slate-900 dark:text-white truncate">
                Edytor szablonu: {draft.name || template.name}
              </h2>
              <p className="text-[11px] text-slate-600 dark:text-slate-300">
                Wersja {expectedRevision} · {summary.taskCount} zadań · {summary.totalDurationDays} dni ·{' '}
                {summary.totalEstimatedHours} godz.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleUndo}
              disabled={history.past.length === 0 || saveSubmit.isSubmitting}
              aria-label="Cofnij zmianę w edytorze"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-45 font-semibold transition-colors"
            >
              <Undo2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Cofnij</span>
            </button>
            <button
              type="button"
              onClick={handleRedo}
              disabled={history.future.length === 0 || saveSubmit.isSubmitting}
              aria-label="Ponów zmianę w edytorze"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-45 font-semibold transition-colors"
            >
              <Redo2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Ponów</span>
            </button>
            <button
              type="button"
              disabled={saveSubmit.isSubmitting}
              onClick={requestClose}
              aria-label="Zamknij edytor szablonu"
              className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 transition-colors"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Treść formularza */}
        <form onSubmit={handleSave} className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div
            tabIndex={0}
            className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-600"
          >
            {/* Komunikaty błędów i konfliktu 409 */}
            {saveSubmit.submitError && (
              <div className="space-y-2">
                <FormError
                  id={errorAlertId}
                  error={saveSubmit.submitError}
                  alertRef={saveSubmit.alertRef}
                  onDismiss={saveSubmit.clearError}
                />
                {conflictTemplate && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => loadTemplateIntoEditor(conflictTemplate)}
                      className="px-3 py-1.5 rounded-lg bg-rose-700 hover:bg-rose-800 text-white font-semibold"
                    >
                      Załaduj najnowszą wersję z serwera
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Metadane szablonu */}
            <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-slate-900 dark:text-slate-100 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="md:col-span-2">
                  <label htmlFor={`${uid}-name`} className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                    Nazwa szablonu <span className="text-rose-600 dark:text-rose-400">*</span>
                  </label>
                  <input
                    id={`${uid}-name`}
                    type="text"
                    required
                    maxLength={200}
                    value={draft.name}
                    onChange={(e) => commitDraft((curr) => ({ ...curr, name: e.target.value }))}
                    {...saveSubmit.getFieldA11yProps('name', errorAlertId)}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>

                <div>
                  <label htmlFor={`${uid}-type`} className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                    Rodzaj projektu
                  </label>
                  <select
                    id={`${uid}-type`}
                    value={draft.typeId}
                    onChange={(e) =>
                      commitDraft((curr) => ({
                        ...curr,
                        typeId: e.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    {!orderedProjectTypes.some((pt) => pt.id === draft.typeId) && draft.typeId && (
                      <option value={draft.typeId}>{draft.typeId}</option>
                    )}
                    {orderedProjectTypes
                      .filter((pt) => pt.isActive !== false || pt.id === draft.typeId)
                      .map((pt) => (
                        <option key={pt.id} value={pt.id}>
                          {pt.label}
                          {pt.isActive === false ? ' (nieaktywny)' : ''}
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label htmlFor={`${uid}-prio`} className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                    Domyślny priorytet
                  </label>
                  <select
                    id={`${uid}-prio`}
                    value={draft.defaultPriority}
                    onChange={(e) =>
                      commitDraft((curr) => ({
                        ...curr,
                        defaultPriority: e.target.value as Priority,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    {(['low', 'normal', 'high', 'critical'] as Priority[]).map((p) => (
                      <option key={p} value={p}>
                        {PRIORITY_LABELS[p]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start">
                <div className="md:col-span-2">
                  <label htmlFor={`${uid}-desc`} className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                    Opis szablonu
                  </label>
                  <textarea
                    id={`${uid}-desc`}
                    rows={2}
                    maxLength={2000}
                    value={draft.description}
                    onChange={(e) => commitDraft((curr) => ({ ...curr, description: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor={`${uid}-dur`} className="font-semibold text-slate-700 dark:text-slate-200">
                      Czas trwania (dni)
                    </label>
                    <label className="inline-flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={draft.durationManualOverride}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          commitDraft((curr) => ({
                            ...curr,
                            durationManualOverride: checked,
                            defaultDurationDays: checked
                              ? curr.defaultDurationDays
                              : computeTemplateDurationFromTasks(curr.tasks),
                          }));
                        }}
                        className="rounded border-slate-300 dark:border-slate-600"
                      />
                      <span>Nadpisz ręcznie</span>
                    </label>
                  </div>
                  <input
                    id={`${uid}-dur`}
                    type="number"
                    min={1}
                    max={MAX_TEMPLATE_DAYS}
                    disabled={!draft.durationManualOverride}
                    value={
                      draft.durationManualOverride
                        ? draft.defaultDurationDays
                        : computeTemplateDurationFromTasks(draft.tasks)
                    }
                    onChange={(e) => {
                      const val = Math.max(1, Math.min(MAX_TEMPLATE_DAYS, Math.round(Number(e.target.value) || 1)));
                      commitDraft((curr) => ({
                        ...curr,
                        durationManualOverride: true,
                        defaultDurationDays: val,
                      }));
                    }}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white px-3 py-1.5 font-mono disabled:opacity-60"
                  />
                </div>
              </div>
            </div>

            {/* Ostrzeżenia walidacyjne */}
            {summary.warnings.length > 0 && (
              <div
                role="region"
                aria-label="Ostrzeżenia szablonu"
                className="p-3 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-950 dark:text-amber-100 space-y-1"
              >
                <div className="font-bold flex items-center gap-1.5 text-amber-900 dark:text-amber-200">
                  <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Ostrzeżenia ({summary.warnings.length})</span>
                </div>
                <ul className="list-disc pl-5 space-y-0.5 text-[11px]">
                  {summary.warnings.map((w, idx) => (
                    <li key={`${w.code}-${w.taskKey || idx}`}>{w.message}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Główny układ: Drzewo zadań (lewa kolumna) + Szczegóły zadania (prawa kolumna) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
              {/* Lewy panel: Drzewo zadań */}
              <div className="lg:col-span-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 text-slate-900 dark:text-slate-100 overflow-hidden">
                <div className="px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/70 text-slate-900 dark:text-slate-100 flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold flex items-center gap-1.5">
                    <GitBranch className="w-4 h-4 text-sky-700 dark:text-sky-400" aria-hidden="true" />
                    <span>Drzewo zadań szablonu ({draft.tasks.length}/{MAX_TEMPLATE_TASKS})</span>
                  </span>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={draft.tasks.length >= MAX_TEMPLATE_TASKS}
                      onClick={handleAddRootTask}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-sky-700 hover:bg-sky-800 disabled:opacity-50 text-white font-semibold transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Dodaj zadanie</span>
                    </button>
                    <button
                      type="button"
                      disabled={!selectedTaskKey || draft.tasks.length >= MAX_TEMPLATE_TASKS}
                      onClick={handleAddSubtask}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-45 font-semibold transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Dodaj podzadanie</span>
                    </button>
                  </div>
                </div>

                {/* Strefa upuszczenia na poziom główny podczas przeciągania */}
                {draggedKey && (
                  <div
                    data-tpl-root-drop="true"
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDropTargetKey('__root__');
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const src = e.dataTransfer.getData('text/plain') || draggedKey;
                      handleReparentDrop(src, undefined);
                    }}
                    className={`mx-2.5 mt-2.5 p-2 rounded-lg border-2 border-dashed text-center text-[11px] font-semibold transition-colors ${
                      dropTargetKey === '__root__'
                        ? 'border-sky-600 bg-sky-50 dark:bg-sky-950/50 text-sky-900 dark:text-sky-200'
                        : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    Upuść tutaj, aby przenieść na poziom główny
                  </div>
                )}

                <div
                  tabIndex={0}
                  className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[380px] overflow-y-auto p-1.5 space-y-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-600"
                >
                  {orderedNodes.length === 0 ? (
                    <div className="p-6 text-center text-slate-600 dark:text-slate-300">
                      Brak zadań w szablonie. Kliknij „Dodaj zadanie”, aby rozpocząć.
                    </div>
                  ) : (
                    orderedNodes.map((node) => {
                      const t = node.task;
                      const isSelected = t.key === selectedTaskKey;
                      const isDropTarget = dropTargetKey === t.key && draggedKey !== t.key;
                      const depthClass = DEPTH_PADDING_CLASSES[Math.min(node.depth, 5)];

                      return (
                        <div
                          key={t.key}
                          data-tpl-task-key={t.key}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/plain', t.key);
                            setDraggedKey(t.key);
                          }}
                          onDragOver={(e) => {
                            if (draggedKey && draggedKey !== t.key) {
                              e.preventDefault();
                              setDropTargetKey(t.key);
                            }
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            const src = e.dataTransfer.getData('text/plain') || draggedKey;
                            if (src && src !== t.key) {
                              handleReparentDrop(src, t.key);
                            }
                          }}
                          onDragEnd={() => {
                            setDraggedKey(null);
                            setDropTargetKey(null);
                          }}
                          className={`${depthClass} pr-2 py-2 rounded-lg border transition-colors ${
                            isDropTarget
                              ? 'border-sky-600 bg-sky-50 dark:bg-sky-950/50 text-slate-900 dark:text-white'
                              : isSelected
                              ? 'border-purple-400 dark:border-purple-600 bg-purple-50/70 dark:bg-purple-950/40 text-slate-900 dark:text-white'
                              : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-800 dark:text-slate-200'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0 flex-1">
                              <span
                                role="button"
                                tabIndex={0}
                                aria-label={`Przeciągnij zadanie ${t.title || t.key}`}
                                onPointerDown={(e) => {
                                  pointerDragRef.current = { key: t.key, pointerId: e.pointerId };
                                  setDraggedKey(t.key);
                                }}
                                className="cursor-grab active:cursor-grabbing p-1 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 touch-none"
                              >
                                <GripVertical className="w-3.5 h-3.5" aria-hidden="true" />
                              </span>

                              <button
                                type="button"
                                onClick={() => setSelectedTaskKey(t.key)}
                                className="text-left min-w-0 flex-1 py-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 rounded"
                              >
                                <div className="font-semibold truncate text-slate-900 dark:text-white">
                                  {t.title.trim() || <span className="italic text-rose-600 dark:text-rose-400">(bez tytułu)</span>}
                                </div>
                                <div className="text-[10px] text-slate-600 dark:text-slate-300 flex flex-wrap items-center gap-2 font-mono">
                                  <span>+{t.offsetDays}d</span>
                                  <span>{t.durationDays}d</span>
                                  {t.estimatedHours !== undefined && <span>{t.estimatedHours}h</span>}
                                  {t.isOfficialDeadline && (
                                    <span className="text-rose-700 dark:text-rose-300 font-bold">Urząd</span>
                                  )}
                                </div>
                              </button>
                            </div>

                            {/* Przyciski drzewa */}
                            <div className="flex items-center gap-0.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => handleMoveSibling(t.key, 'up')}
                                aria-label={`Przenieś w górę: ${t.title || t.key}`}
                                title="Przenieś w górę"
                                className="p-1 rounded hover:bg-slate-200/70 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300"
                              >
                                <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleMoveSibling(t.key, 'down')}
                                aria-label={`Przenieś w dół: ${t.title || t.key}`}
                                title="Przenieś w dół"
                                className="p-1 rounded hover:bg-slate-200/70 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300"
                              >
                                <ArrowDown className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                disabled={!t.parentKey}
                                onClick={() => handleOutdentTask(t.key)}
                                aria-label={`Zmniejsz wcięcie: ${t.title || t.key}`}
                                title="Zmniejsz wcięcie (poziom wyżej)"
                                className="p-1 rounded hover:bg-slate-200/70 dark:hover:bg-slate-700 disabled:opacity-35 text-slate-600 dark:text-slate-300"
                              >
                                <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleIndentTask(t.key)}
                                aria-label={`Zwiększ wcięcie: ${t.title || t.key}`}
                                title="Zwiększ wcięcie (jako podzadanie poprzedniego)"
                                className="p-1 rounded hover:bg-slate-200/70 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300"
                              >
                                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                disabled={draft.tasks.length >= MAX_TEMPLATE_TASKS}
                                onClick={() => handleDuplicateTask(t.key)}
                                aria-label={`Duplikuj zadanie: ${t.title || t.key}`}
                                title="Duplikuj zadanie"
                                className="p-1 rounded hover:bg-slate-200/70 dark:hover:bg-slate-700 disabled:opacity-35 text-slate-600 dark:text-slate-300"
                              >
                                <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setPendingDeleteKey(pendingDeleteKey === t.key ? null : t.key)
                                }
                                aria-label={`Usuń zadanie: ${t.title || t.key}`}
                                title="Usuń zadanie"
                                className="p-1 rounded hover:bg-rose-100 dark:hover:bg-rose-900/50 text-rose-700 dark:text-rose-300"
                              >
                                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>
                            </div>
                          </div>

                          {/* Wskaźnik upuszczenia */}
                          {isDropTarget && (
                            <div className="mt-1 text-[10px] font-semibold text-sky-800 dark:text-sky-200">
                              Jako podzadanie: {t.title || t.key}
                            </div>
                          )}

                          {/* Potwierdzenie usunięcia */}
                          {pendingDeleteKey === t.key && (
                            <div className="mt-2 p-2 rounded border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/60 text-rose-900 dark:text-rose-100 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                              <span>
                                Usunąć zadanie
                                {pendingDeleteSubtreeCount > 0
                                  ? ` wraz z ${pendingDeleteSubtreeCount} podzadaniami`
                                  : ''}
                                ?
                              </span>
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setPendingDeleteKey(null)}
                                  className="px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold"
                                >
                                  Anuluj
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleConfirmDeleteTask(t.key)}
                                  className="px-2 py-0.5 rounded bg-rose-700 hover:bg-rose-800 text-white font-semibold"
                                >
                                  Potwierdź usunięcie
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Prawy panel: Szczegóły wybranego zadania */}
              <div className="lg:col-span-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 text-slate-900 dark:text-slate-100 p-4 space-y-3">
                {selectedTask ? (
                  <>
                    <div className="flex items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
                      <span className="font-bold text-slate-900 dark:text-white">
                        Parametry zadania
                      </span>
                      <span className="text-[11px] font-mono text-slate-600 dark:text-slate-300">
                        klucz: {selectedTask.key}
                      </span>
                    </div>

                    <div>
                      <label htmlFor={`${uid}-t-title`} className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                        Tytuł zadania <span className="text-rose-600 dark:text-rose-400">*</span>
                      </label>
                      <input
                        id={`${uid}-t-title`}
                        type="text"
                        maxLength={200}
                        value={selectedTask.title}
                        onChange={(e) =>
                          updateSelectedTask((t) => ({ ...t, title: e.target.value }))
                        }
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-sky-500"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label htmlFor={`${uid}-t-type`} className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                          Typ zadania
                        </label>
                        <select
                          id={`${uid}-t-type`}
                          value={selectedTask.type}
                          onChange={(e) =>
                            updateSelectedTask((t) => ({ ...t, type: e.target.value }))
                          }
                          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white px-2.5 py-1.5"
                        >
                          {!taskTypes.some((tt) => tt.id === selectedTask.type) && (
                            <option value={selectedTask.type}>{selectedTask.type}</option>
                          )}
                          {taskTypes.map((tt) => (
                            <option key={tt.id} value={tt.id}>
                              {tt.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label htmlFor={`${uid}-t-prio`} className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                          Priorytet zadania
                        </label>
                        <select
                          id={`${uid}-t-prio`}
                          value={selectedTask.priority}
                          onChange={(e) =>
                            updateSelectedTask((t) => ({
                              ...t,
                              priority: e.target.value as Priority,
                            }))
                          }
                          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white px-2.5 py-1.5"
                        >
                          {(['low', 'normal', 'high', 'critical'] as Priority[]).map((p) => (
                            <option key={p} value={p}>
                              {PRIORITY_LABELS[p]}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label htmlFor={`${uid}-t-dur`} className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                          Czas trwania (dni)
                        </label>
                        <input
                          id={`${uid}-t-dur`}
                          type="number"
                          min={1}
                          max={MAX_TEMPLATE_DAYS}
                          value={selectedTask.durationDays}
                          onChange={(e) => {
                            const val = Math.max(1, Math.min(MAX_TEMPLATE_DAYS, Math.round(Number(e.target.value) || 1)));
                            updateSelectedTask((t) => ({ ...t, durationDays: val }));
                          }}
                          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white px-2.5 py-1.5 font-mono"
                        />
                      </div>

                      <div>
                        <label htmlFor={`${uid}-t-off`} className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                          Przesunięcie (dni od startu)
                        </label>
                        <input
                          id={`${uid}-t-off`}
                          type="number"
                          min={0}
                          max={MAX_TEMPLATE_DAYS}
                          value={selectedTask.offsetDays}
                          onChange={(e) => {
                            const val = Math.max(0, Math.min(MAX_TEMPLATE_DAYS, Math.round(Number(e.target.value) || 0)));
                            updateSelectedTask((t) => ({ ...t, offsetDays: val }));
                          }}
                          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white px-2.5 py-1.5 font-mono"
                        />
                      </div>

                      <div>
                        <label htmlFor={`${uid}-t-hrs`} className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                          Szacowane godziny
                        </label>
                        <input
                          id={`${uid}-t-hrs`}
                          type="number"
                          min={0}
                          step="0.5"
                          value={selectedTask.estimatedHours ?? ''}
                          placeholder="np. 16"
                          onChange={(e) => {
                            const raw = e.target.value.trim();
                            if (!raw) {
                              updateSelectedTask((t) => {
                                const next = { ...t };
                                delete next.estimatedHours;
                                return next;
                              });
                            } else {
                              const num = Math.max(0, Number(raw));
                              if (Number.isFinite(num)) {
                                updateSelectedTask((t) => ({
                                  ...t,
                                  estimatedHours: Math.round(num * 100) / 100,
                                }));
                              }
                            }
                          }}
                          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white px-2.5 py-1.5 font-mono"
                        />
                      </div>
                    </div>

                    {/* Zacznij po zakończeniu + Assignee Role */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label htmlFor={`${uid}-t-after`} className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                          Zacznij po zakończeniu:
                        </label>
                        <select
                          id={`${uid}-t-after`}
                          value=""
                          onChange={(e) => {
                            const predKey = e.target.value;
                            if (!predKey) return;
                            commitDraft((curr) => ({
                              ...curr,
                              tasks: applyStartAfterPredecessor(
                                curr.tasks,
                                selectedTask.key,
                                predKey
                              ),
                            }));
                          }}
                          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white px-2.5 py-1.5"
                        >
                          <option value="">— Wybierz poprzednika (ustawi przesunięcie i blokadę) —</option>
                          {startAfterCandidates.map((cand) => (
                            <option key={cand.key} value={cand.key}>
                              {cand.title || cand.key} (koniec: dzień {cand.offsetDays + cand.durationDays})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label htmlFor={`${uid}-t-role`} className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                          Przypisanie przy utworzeniu projektu
                        </label>
                        <select
                          id={`${uid}-t-role`}
                          value={selectedTask.assigneeRole || 'none'}
                          onChange={(e) =>
                            updateSelectedTask((t) => ({
                              ...t,
                              assigneeRole: e.target.value as TemplateAssigneeRole,
                            }))
                          }
                          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white px-2.5 py-1.5"
                        >
                          {(['none', 'owner', 'reporter'] as TemplateAssigneeRole[]).map((role) => (
                            <option key={role} value={role}>
                              {ASSIGNEE_ROLE_LABELS[role]}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                      <div>
                        <label htmlFor={`${uid}-t-tags`} className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                          Tagi (rozdzielone przecinkami)
                        </label>
                        <input
                          id={`${uid}-t-tags`}
                          type="text"
                          value={tagsText}
                          onChange={(e) => {
                            const val = e.target.value;
                            setTagsText(val);
                            const parsed = val
                              .split(',')
                              .map((s) => s.trim())
                              .filter(Boolean)
                              .slice(0, 30);
                            updateSelectedTask((t) => {
                              const next = { ...t };
                              if (parsed.length > 0) next.tags = parsed;
                              else delete next.tags;
                              return next;
                            });
                          }}
                          placeholder="np. PZT, Uzgodnienia"
                          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white px-2.5 py-1.5"
                        />
                      </div>

                      <div className="pt-4">
                        <label className="inline-flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-200 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={Boolean(selectedTask.isOfficialDeadline)}
                            onChange={(e) =>
                              updateSelectedTask((t) => {
                                const next = { ...t };
                                if (e.target.checked) next.isOfficialDeadline = true;
                                else delete next.isOfficialDeadline;
                                return next;
                              })
                            }
                            className="rounded border-slate-300 dark:border-slate-600"
                          />
                          <span>Termin urzędowy / formalnoprawny</span>
                        </label>
                      </div>
                    </div>

                    <div>
                      <label htmlFor={`${uid}-t-desc`} className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                        Opis zadania
                      </label>
                      <textarea
                        id={`${uid}-t-desc`}
                        rows={2}
                        maxLength={2000}
                        value={selectedTask.description}
                        onChange={(e) =>
                          updateSelectedTask((t) => ({ ...t, description: e.target.value }))
                        }
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white px-3 py-1.5"
                      />
                    </div>

                    {/* Zadania blokujące */}
                    <div>
                      <span className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                        Zadania blokujące (poprzedniki bez cykli)
                      </span>
                      {eligibleBlockers.length === 0 ? (
                        <p className="text-[11px] text-slate-600 dark:text-slate-400">
                          Brak wcześniejszych zadań możliwych do wskazania jako blokujące.
                        </p>
                      ) : (
                        <div
                          tabIndex={0}
                          className="max-h-28 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2 space-y-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
                        >
                          {eligibleBlockers.map((cand) => {
                            const checked = (selectedTask.blockerKeys || []).includes(cand.key);
                            return (
                              <label
                                key={cand.key}
                                className="flex items-center gap-2 text-[11px] text-slate-800 dark:text-slate-200 cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    const nextChecked = e.target.checked;
                                    updateSelectedTask((t) => {
                                      const prevSet = new Set(t.blockerKeys || []);
                                      if (nextChecked) prevSet.add(cand.key);
                                      else prevSet.delete(cand.key);
                                      const next = { ...t };
                                      if (prevSet.size > 0) next.blockerKeys = Array.from(prevSet);
                                      else delete next.blockerKeys;
                                      return next;
                                    });
                                  }}
                                  className="rounded border-slate-300 dark:border-slate-600"
                                />
                                <span className="truncate">{cand.title || cand.key}</span>
                                <span className="font-mono text-[10px] text-slate-600 dark:text-slate-400 ml-auto shrink-0">
                                  +{cand.offsetDays}d / {cand.durationDays}d
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="p-6 text-center text-slate-600 dark:text-slate-300">
                    Wybierz zadanie z drzewa po lewej stronie, aby dostosować jego parametry.
                  </div>
                )}
              </div>
            </div>

            {/* Domyślne elementy do odbioru szablonu */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 text-slate-900 dark:text-slate-100 overflow-hidden">
              <div className="px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/70 flex items-center justify-between gap-2">
                <span className="font-bold flex items-center gap-1.5 text-slate-900 dark:text-white">
                  <PackageCheck className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                  <span>
                    Domyślne elementy do odbioru ({draft.deliverables.length}/{DELIVERABLE_LIMITS.maxItems})
                  </span>
                </span>
                <span className="text-[11px] text-slate-600 dark:text-slate-400">
                  Kopiowane do nowego projektu jako niewykonane
                </span>
              </div>

              <div className="p-3 space-y-2.5">
                {draft.deliverables.length === 0 ? (
                  <p className="text-[11px] text-slate-600 dark:text-slate-400">
                    Brak domyślnych elementów do odbioru w tym szablonie.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg">
                    {draft.deliverables.map((del, delIdx) => (
                      <div
                        key={del.id}
                        className="p-2 grid grid-cols-1 sm:grid-cols-12 gap-2 items-center"
                      >
                        <div className="sm:col-span-5">
                          <input
                            type="text"
                            aria-label={`Nazwa elementu ${delIdx + 1}`}
                            maxLength={DELIVERABLE_LIMITS.nameMax}
                            value={del.name}
                            onChange={(e) =>
                              handleUpdateDeliverable(del.id, { name: e.target.value })
                            }
                            className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 text-xs text-slate-900 dark:text-white"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <input
                            type="number"
                            aria-label={`Liczba egzemplarzy elementu ${delIdx + 1}`}
                            min={DELIVERABLE_LIMITS.copiesMin}
                            max={DELIVERABLE_LIMITS.copiesMax}
                            value={del.copies}
                            onChange={(e) =>
                              handleUpdateDeliverable(del.id, {
                                copies: Math.min(
                                  DELIVERABLE_LIMITS.copiesMax,
                                  Math.max(DELIVERABLE_LIMITS.copiesMin, Math.round(Number(e.target.value) || 1))
                                ),
                              })
                            }
                            className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 text-xs font-mono text-slate-900 dark:text-white"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <input
                            type="text"
                            aria-label={`Jednostka elementu ${delIdx + 1}`}
                            maxLength={DELIVERABLE_LIMITS.unitMax}
                            value={del.unit}
                            onChange={(e) =>
                              handleUpdateDeliverable(del.id, { unit: e.target.value })
                            }
                            className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 text-xs text-slate-900 dark:text-white"
                          />
                        </div>
                        <div className="sm:col-span-3 flex items-center justify-end gap-1">
                          <button
                            type="button"
                            disabled={delIdx === 0}
                            onClick={() => handleMoveDeliverable(delIdx, -1)}
                            aria-label={`Przesuń element ${del.name} w górę`}
                            className="p-1 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-30"
                          >
                            <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            disabled={delIdx === draft.deliverables.length - 1}
                            onClick={() => handleMoveDeliverable(delIdx, 1)}
                            aria-label={`Przesuń element ${del.name} w dół`}
                            className="p-1 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-30"
                          >
                            <ArrowDown className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteDeliverable(del.id)}
                            aria-label={`Usuń element ${del.name}`}
                            className="p-1 text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded"
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </div>
                        <div className="sm:col-span-12">
                          <input
                            type="text"
                            aria-label={`Uwagi do elementu ${delIdx + 1}`}
                            maxLength={DELIVERABLE_LIMITS.notesMax}
                            value={del.notes || ''}
                            onChange={(e) =>
                              handleUpdateDeliverable(del.id, { notes: e.target.value })
                            }
                            placeholder="Uwagi (opcjonalnie)"
                            className="w-full rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2 py-1 text-[11px] text-slate-700 dark:text-slate-300"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700">
                  <div className="sm:col-span-5">
                    <label htmlFor={`${uid}-new-del-name`} className="block text-[11px] text-slate-600 dark:text-slate-300 mb-1">
                      Nowy element do odbioru
                    </label>
                    <input
                      id={`${uid}-new-del-name`}
                      type="text"
                      maxLength={DELIVERABLE_LIMITS.nameMax}
                      value={newDelName}
                      onChange={(e) => setNewDelName(e.target.value)}
                      placeholder="np. Projekt Zagospodarowania Terenu (PZT)"
                      className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1 text-xs text-slate-900 dark:text-white"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor={`${uid}-new-del-copies`} className="block text-[11px] text-slate-600 dark:text-slate-300 mb-1">
                      Egzemplarze
                    </label>
                    <input
                      id={`${uid}-new-del-copies`}
                      type="number"
                      min={DELIVERABLE_LIMITS.copiesMin}
                      max={DELIVERABLE_LIMITS.copiesMax}
                      value={newDelCopies}
                      onChange={(e) => setNewDelCopies(Number(e.target.value) || 1)}
                      className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs font-mono text-slate-900 dark:text-white"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor={`${uid}-new-del-unit`} className="block text-[11px] text-slate-600 dark:text-slate-300 mb-1">
                      Jednostka
                    </label>
                    <input
                      id={`${uid}-new-del-unit`}
                      type="text"
                      maxLength={DELIVERABLE_LIMITS.unitMax}
                      value={newDelUnit}
                      onChange={(e) => setNewDelUnit(e.target.value)}
                      className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs text-slate-900 dark:text-white"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <button
                      type="button"
                      disabled={draft.deliverables.length >= DELIVERABLE_LIMITS.maxItems}
                      onClick={handleAddDeliverable}
                      className="w-full inline-flex items-center justify-center gap-1 px-3 py-1 rounded bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-semibold text-xs transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Dodaj element</span>
                    </button>
                  </div>
                  <div className="sm:col-span-12">
                    <input
                      type="text"
                      aria-label="Uwagi do nowego elementu do odbioru"
                      maxLength={DELIVERABLE_LIMITS.notesMax}
                      value={newDelNotes}
                      onChange={(e) => setNewDelNotes(e.target.value)}
                      placeholder="Uwagi do nowego elementu (opcjonalnie)"
                      className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1 text-[11px] text-slate-700 dark:text-slate-300"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Podgląd osi czasu */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 text-slate-900 dark:text-slate-100 overflow-hidden">
              <div className="px-3.5 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/70 flex items-center justify-between gap-2">
                <span className="font-bold flex items-center gap-1.5 text-slate-900 dark:text-white">
                  <BarChart3 className="w-4 h-4 text-sky-700 dark:text-sky-400" aria-hidden="true" />
                  <span>Podgląd osi czasu szablonu (horyzont: {timelineHorizon} dni)</span>
                </span>
                <button
                  type="button"
                  onClick={() => setShowTimeline((v) => !v)}
                  className="text-[11px] font-semibold text-sky-700 dark:text-sky-300 hover:underline"
                >
                  {showTimeline ? 'Ukryj wykres' : 'Pokaż wykres'}
                </button>
              </div>

              {showTimeline && (
                <div
                  tabIndex={0}
                  aria-label="Wykres osi czasu zadań szablonu"
                  role="region"
                  className="p-3 space-y-1.5 max-h-48 overflow-y-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-600"
                >
                  {orderedNodes.length === 0 ? (
                    <p className="text-[11px] text-slate-600 dark:text-slate-300">
                      Dodaj zadania, aby zobaczyć rozkład czasu na osi.
                    </p>
                  ) : (
                    orderedNodes.map((node) => {
                      const t = node.task;
                      const startPct = Math.min(100, Math.max(0, (t.offsetDays / timelineHorizon) * 100));
                      const widthPct = Math.max(
                        2,
                        Math.min(100 - startPct, (t.durationDays / timelineHorizon) * 100)
                      );
                      return (
                        <div key={`tl-${t.key}`} className="grid grid-cols-12 items-center gap-2 text-[11px]">
                          <div className="col-span-4 truncate text-slate-700 dark:text-slate-200 font-medium">
                            {node.depth > 0 ? `${'↳ '.repeat(Math.min(node.depth, 3))}` : ''}
                            {t.title.trim() || t.key}
                          </div>
                          <div className="col-span-6">
                            <svg
                              viewBox="0 0 100 10"
                              preserveAspectRatio="none"
                              className="w-full h-3 rounded bg-slate-100 dark:bg-slate-800"
                              aria-hidden="true"
                            >
                              <rect
                                x={startPct}
                                y={1}
                                width={widthPct}
                                height={8}
                                rx={2}
                                className={
                                  t.isOfficialDeadline
                                    ? 'fill-rose-600 dark:fill-rose-500'
                                    : 'fill-sky-600 dark:fill-sky-500'
                                }
                              />
                            </svg>
                          </div>
                          <div className="col-span-2 text-right font-mono text-[10px] text-slate-600 dark:text-slate-300 flex items-center justify-end gap-1">
                            <Clock className="w-3 h-3 shrink-0" aria-hidden="true" />
                            <span>
                              D{t.offsetDays + 1}–D{t.offsetDays + t.durationDays}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Stopka z przyciskami Zapisz i Anuluj (Grupa B) */}
          <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/70 text-slate-900 dark:text-slate-100 flex flex-wrap items-center justify-between gap-3 shrink-0">
            <div className="text-[11px] text-slate-600 dark:text-slate-300">
              {isDirty ? 'Masz niezapisane zmiany w szablonie.' : 'Brak niezapisanych zmian.'}
            </div>
            <div className="flex items-center gap-2">
              <button
                ref={cancelButtonRef}
                type="button"
                disabled={saveSubmit.isSubmitting}
                onClick={requestClose}
                className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 font-semibold transition-colors"
              >
                Anuluj
              </button>
              <button
                type="submit"
                disabled={saveSubmit.isSubmitting}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-700 hover:bg-sky-800 disabled:opacity-55 text-white font-semibold shadow-xs transition-colors"
              >
                <Save className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{saveSubmit.isSubmitting ? 'Zapisywanie...' : 'Zapisz zmiany'}</span>
              </button>
            </div>
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
