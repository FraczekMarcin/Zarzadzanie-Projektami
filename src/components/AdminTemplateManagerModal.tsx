import React, { useState, useEffect, useRef, useId, useMemo } from 'react';
import {
  Project,
  Task,
  User,
  ProjectTemplate,
  ProjectTemplateSummary,
  TemplateTaskBlueprint,
} from '../types';
import { useFocusTrap } from '../utils/useFocusTrap';
import { useDismissOnOutsideClick } from '../hooks/useDismissOnOutsideClick';
import { useVariables } from '../hooks/useVariables';
import { fetchTemplatesList, fetchTemplateById } from '../utils/projectTemplates';
import { resolveProjectType } from '../utils/projectMeta';
import {
  X,
  Layers,
  Clock,
  FolderPlus,
  RefreshCw,
  AlertCircle,
  GitBranch,
  Link2,
  PackageCheck,
} from 'lucide-react';

interface AdminTemplateManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  projects?: Project[];
  tasks?: Task[];
  currentUser?: User;
  onSelectTemplateToCreate?: (template: ProjectTemplate) => void;
}

const PREVIEW_INDENT_CLASSES = ['pl-3', 'pl-7', 'pl-11', 'pl-15', 'pl-19', 'pl-23'] as const;

function getBlueprintDepth(
  byKey: ReadonlyMap<string, TemplateTaskBlueprint>,
  key: string
): number {
  let depth = 0;
  const visited = new Set<string>([key]);
  let curr = byKey.get(key);
  while (curr?.parentKey && !visited.has(curr.parentKey)) {
    visited.add(curr.parentKey);
    const parent = byKey.get(curr.parentKey);
    if (!parent) break;
    depth += 1;
    curr = parent;
  }
  return Math.min(depth, PREVIEW_INDENT_CLASSES.length - 1);
}

export const AdminTemplateManagerModal: React.FC<AdminTemplateManagerModalProps> = ({
  isOpen,
  onClose,
  onSelectTemplateToCreate,
}) => {
  const { projectTypes } = useVariables();
  const [summaries, setSummaries] = useState<ProjectTemplateSummary[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [detailsCache, setDetailsCache] = useState<Record<string, ProjectTemplate>>({});
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const modalRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const titleId = `${baseId}-title`;

  const { backdropProps } = useDismissOnOutsideClick({
    isOpen,
    mode: 'dismiss',
    panelRef: modalRef,
    onDismiss: onClose,
  });

  useFocusTrap({ isOpen, onClose, containerRef: modalRef });

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setErrorMsg(null);
    setIsLoadingList(true);

    fetchTemplatesList()
      .then((list) => {
        if (cancelled) return;
        setSummaries(list);
        setSelectedTemplateId((prev) => {
          if (prev && list.some((item) => item.id === prev)) return prev;
          return list[0]?.id ?? null;
        });
      })
      .catch((err: any) => {
        if (!cancelled) {
          setErrorMsg(err?.message || 'Nie udało się pobrać listy szablonów projektów.');
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingList(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !selectedTemplateId) return;
    if (detailsCache[selectedTemplateId]) return;

    let cancelled = false;
    setIsLoadingDetail(true);
    setErrorMsg(null);

    fetchTemplateById(selectedTemplateId)
      .then((tpl) => {
        if (cancelled) return;
        setDetailsCache((prev) => ({ ...prev, [tpl.id]: tpl }));
      })
      .catch((err: any) => {
        if (!cancelled) {
          setErrorMsg(err?.message || 'Nie udało się pobrać szczegółów szablonu.');
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingDetail(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, selectedTemplateId, detailsCache]);

  const selectedDetail = selectedTemplateId ? detailsCache[selectedTemplateId] || null : null;

  const taskByKey = useMemo(() => {
    const map = new Map<string, TemplateTaskBlueprint>();
    if (selectedDetail) {
      for (const task of selectedDetail.tasks) {
        map.set(task.key, task);
      }
    }
    return map;
  }, [selectedDetail]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] bg-slate-900/60 dark:bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4"
      {...backdropProps}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95"
      >
        {/* Nagłówek */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-purple-100 dark:bg-purple-950/60 rounded-lg text-purple-700 dark:text-purple-300">
              <Layers className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h3 id={titleId} className="text-sm font-bold text-slate-900 dark:text-white">
                Katalog Szablonów Projektów ({summaries.length})
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Wybierz szablon z listy, aby podejrzeć etapy, podzadania i czasy trwania. Zarządzanie szablonami znajduje się w Ustawieniach.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Zamknij katalog szablonów"
            className="p-1.5 rounded text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {errorMsg && (
          <div
            role="alert"
            className="mx-6 mt-3 p-2.5 rounded-lg border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/50 text-rose-900 dark:text-rose-200 text-xs flex items-center gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="flex-1 flex overflow-hidden">
          {/* Lewy panel: lista szablonów */}
          <div className="w-72 border-r border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-slate-900 dark:text-slate-100 p-4 space-y-2 overflow-y-auto shrink-0">
            <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider block px-1">
              Dostępne szablony
            </span>

            {isLoadingList ? (
              <div role="status" className="flex items-center gap-2 py-6 text-xs text-slate-600 dark:text-slate-400">
                <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
                <span>Ładowanie listy...</span>
              </div>
            ) : summaries.length === 0 ? (
              <div className="p-4 text-xs text-slate-600 dark:text-slate-400 text-center">
                Brak dostępnych szablonów.
              </div>
            ) : (
              summaries.map((tpl) => {
                const isSelected = selectedTemplateId === tpl.id;
                return (
                  <button
                    type="button"
                    key={tpl.id}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedTemplateId(tpl.id)}
                    className={`w-full text-left p-3 rounded-xl border text-xs transition-all space-y-1.5 ${
                      isSelected
                        ? 'bg-purple-50/80 dark:bg-purple-950/50 border-purple-400 dark:border-purple-500 text-slate-900 dark:text-white shadow-xs'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/70'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-1.5">
                      <span className="font-bold text-slate-900 dark:text-white line-clamp-2">
                        {tpl.name}
                      </span>
                      {tpl.builtIn ? (
                        <span className="shrink-0 text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-700">
                          Wbudowany
                        </span>
                      ) : (
                        <span className="shrink-0 text-[10px] bg-purple-100 dark:bg-purple-950/60 text-purple-800 dark:text-purple-300 font-bold px-1.5 py-0.5 rounded border border-purple-300 dark:border-purple-800">
                          Własny
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-slate-600 dark:text-slate-400" aria-hidden="true" />
                        <span>{tpl.defaultDurationDays} dni</span>
                      </span>
                      <span aria-hidden="true">•</span>
                      <span>{tpl.taskCount} zadań</span>
                    </div>
                    {tpl.officialDeadlineCount > 0 && (
                      <div className="text-[10px] font-semibold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/50 px-1.5 py-0.5 rounded border border-rose-200 dark:border-rose-800 inline-block">
                        {tpl.officialDeadlineCount} terminy urzędowe
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>

          {/* Prawy panel: podgląd szablonu */}
          <div className="flex-1 p-6 overflow-y-auto space-y-5 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100">
            {isLoadingDetail && !selectedDetail ? (
              <div role="status" className="h-full flex items-center justify-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
                <span>Ładowanie podglądu szablonu...</span>
              </div>
            ) : selectedDetail ? (
              <div className="space-y-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      {(() => {
                        const typeInfo = resolveProjectType(selectedDetail.typeId, projectTypes);
                        return (
                          <span className={`text-[11px] font-bold px-2 py-0.5 rounded border ${typeInfo.badgeClass}`}>
                            {typeInfo.label}
                          </span>
                        );
                      })()}
                      {selectedDetail.builtIn ? (
                        <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700">
                          Szablon wbudowany
                        </span>
                      ) : (
                        <span className="text-[11px] font-bold text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/50 px-2 py-0.5 rounded border border-amber-200 dark:border-amber-800">
                          Szablon własny
                        </span>
                      )}
                    </div>
                    <h4 className="text-lg font-bold text-slate-900 dark:text-white">
                      {selectedDetail.name}
                    </h4>
                    {selectedDetail.description && (
                      <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                        {selectedDetail.description}
                      </p>
                    )}
                  </div>

                  {onSelectTemplateToCreate && (
                    <button
                      type="button"
                      onClick={() => {
                        onSelectTemplateToCreate(selectedDetail);
                        onClose();
                      }}
                      className="flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold px-3.5 py-2 rounded-lg shadow-xs transition-colors shrink-0"
                    >
                      <FolderPlus className="w-4 h-4" aria-hidden="true" />
                      <span>Użyj tego szablonu</span>
                    </button>
                  )}
                </div>

                {/* Karty podsumowania */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/70 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100">
                    <span className="text-slate-600 dark:text-slate-300 block text-[11px]">
                      Domyślny czas trwania:
                    </span>
                    <strong className="text-slate-900 dark:text-white text-sm">
                      {selectedDetail.defaultDurationDays} dni
                    </strong>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/70 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100">
                    <span className="text-slate-600 dark:text-slate-300 block text-[11px]">
                      Liczba etapów i podzadań:
                    </span>
                    <strong className="text-slate-900 dark:text-white text-sm">
                      {selectedDetail.tasks.length} zadań
                    </strong>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/70 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100">
                    <span className="text-slate-600 dark:text-slate-300 block text-[11px]">
                      Sugerowany budżet:
                    </span>
                    <strong className="text-slate-900 dark:text-white text-sm">
                      {selectedDetail.defaultBudget || 'Nieokreślony'}
                    </strong>
                  </div>
                </div>

                {/* Lista zadań */}
                <div className="space-y-2">
                  <h5 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wide">
                    Struktura etapów w szablonie:
                  </h5>
                  <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                    {selectedDetail.tasks.map((task, idx) => {
                      const depth = getBlueprintDepth(taskByKey, task.key);
                      const indentCls = PREVIEW_INDENT_CLASSES[depth] || 'pl-3';
                      const blockersCount = task.blockerKeys?.length || 0;

                      return (
                        <div
                          key={task.key}
                          className={`py-2.5 pr-3 ${indentCls} flex items-center justify-between gap-4 hover:bg-slate-50 dark:hover:bg-slate-800/60`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-800 font-mono text-[11px] font-bold text-slate-700 dark:text-slate-200 flex items-center justify-center shrink-0">
                              {idx + 1}
                            </span>
                            <div className="min-w-0">
                              <div className="font-bold text-slate-900 dark:text-white flex flex-wrap items-center gap-1.5">
                                {task.parentKey && (
                                  <GitBranch className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0" aria-hidden="true" />
                                )}
                                <span className="truncate">{task.title}</span>
                                {task.isOfficialDeadline && (
                                  <span className="text-[10px] bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 font-bold px-1.5 py-0.2 rounded border border-rose-300 dark:border-rose-800">
                                    Termin urzędowy
                                  </span>
                                )}
                                {task.type === 'milestone' && (
                                  <span className="text-[10px] bg-sky-100 dark:bg-sky-950/60 text-sky-800 dark:text-sky-300 font-bold px-1.5 py-0.2 rounded">
                                    Kamień milowy
                                  </span>
                                )}
                                {blockersCount > 0 && (
                                  <span className="inline-flex items-center gap-1 text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium px-1.5 py-0.2 rounded">
                                    <Link2 className="w-2.5 h-2.5" aria-hidden="true" />
                                    <span>{blockersCount} poprz.</span>
                                  </span>
                                )}
                              </div>
                              {task.description && (
                                <p className="text-[11px] text-slate-600 dark:text-slate-300 line-clamp-1">
                                  {task.description}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="text-right shrink-0 text-[11px]">
                            <span className="font-bold text-slate-800 dark:text-slate-200">
                              {task.durationDays} dni
                            </span>
                            <span className="text-slate-600 dark:text-slate-400 block text-[10px]">
                              offset: +{task.offsetDays}d
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Domyślne elementy do odbioru */}
                {Array.isArray(selectedDetail.deliverables) && selectedDetail.deliverables.length > 0 && (
                  <div className="space-y-2">
                    <h5 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wide flex items-center gap-1.5">
                      <PackageCheck className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                      <span>Domyślne elementy do odbioru ({selectedDetail.deliverables.length}):</span>
                    </h5>
                    <div className="border border-slate-200 dark:border-slate-700 rounded-lg divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                      {selectedDetail.deliverables.map((del) => (
                        <div key={del.id} className="px-3 py-2 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <span className="font-semibold text-slate-900 dark:text-white">{del.name}</span>
                            {del.notes && (
                              <span className="block text-[11px] text-slate-600 dark:text-slate-400">
                                {del.notes}
                              </span>
                            )}
                          </div>
                          <span className="font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-300 shrink-0">
                            {del.copies} {del.unit}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center p-8 text-slate-600 dark:text-slate-300">
                <Layers className="w-12 h-12 stroke-[1.5] text-slate-500 dark:text-slate-400 mb-2" aria-hidden="true" />
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  Wybierz szablon z listy po lewej stronie
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  aby podejrzeć listę zadań, hierarchię podzadań i czasy trwania.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Stopka */}
        <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
          <span>Wspólny katalog szablonów jest synchronizowany z serwerem pracowni.</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded transition-colors font-medium"
          >
            Zamknij
          </button>
        </div>
      </div>
    </div>
  );
};
