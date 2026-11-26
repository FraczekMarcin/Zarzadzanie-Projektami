import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Project, ProjectTemplate, ProjectTemplateSummary, Task, User } from '../../types';
import { MAX_CUSTOM_TEMPLATES } from '../../utils/templateValidation';
import { resolveProjectType } from '../../utils/projectMeta';
import { useVariables } from '../../hooks/useVariables';
import {
  clearLegacyLocalCustomTemplates,
  createTemplateOnServer,
  deleteTemplateOnServer,
  duplicateTemplateOnServer,
  fetchTemplateById,
  fetchTemplatesList,
  getLegacyLocalCustomTemplates,
} from '../../utils/projectTemplates';
import { normalizeSubmitError } from '../../hooks/useFormSubmit';
import { FormError } from '../FormError';
import { CreateTemplateFromProjectModal } from './CreateTemplateFromProjectModal';
import { TemplateEditorModal } from './TemplateEditorModal';
import {
  Building2,
  CheckCircle2,
  Clock,
  Copy,
  Edit3,
  Layers,
  Lock,
  PackageCheck,
  RefreshCw,
  Trash2,
  UploadCloud,
} from 'lucide-react';

export interface ProjectTemplatesTabProps {
  isOpen: boolean;
  currentUser: User | null;
  projects: Project[];
  tasks: Task[];
  onRefreshState?: () => Promise<void> | void;
}

export const ProjectTemplatesTab: React.FC<ProjectTemplatesTabProps> = ({
  isOpen,
  currentUser,
  projects,
  tasks,
  onRefreshState,
}) => {
  const isAdmin = currentUser?.role === 'admin';
  const { projectTypes } = useVariables();

  const [templates, setTemplates] = useState<ProjectTemplateSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loadingEditId, setLoadingEditId] = useState<string | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<ProjectTemplate | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isFromProjectOpen, setIsFromProjectOpen] = useState(false);

  const [legacyTemplates, setLegacyTemplates] = useState(() =>
    getLegacyLocalCustomTemplates()
  );
  const [isMigratingLegacy, setIsMigratingLegacy] = useState(false);

  const [statusMsg, setStatusMsg] = useState<{
    type: 'success' | 'info' | 'error';
    text: string;
  } | null>(null);
  const errorAlertRef = useRef<HTMLDivElement>(null);
  const actionLockRef = useRef(false);

  const showError = useCallback((err: unknown, fallback: string) => {
    const normalized = normalizeSubmitError(err, fallback);
    setStatusMsg({ type: 'error', text: normalized.error });
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => errorAlertRef.current?.focus());
    }
  }, []);

  const loadTemplates = useCallback(async () => {
    if (!isAdmin) return;
    setIsLoading(true);
    try {
      const list = await fetchTemplatesList();
      setTemplates(list);
    } catch (err: unknown) {
      showError(err, 'Nie udało się pobrać listy szablonów.');
    } finally {
      setIsLoading(false);
    }
  }, [isAdmin, showError]);

  useEffect(() => {
    if (!isOpen || !isAdmin) return;
    setStatusMsg(null);
    setConfirmDeleteId(null);
    setLegacyTemplates(getLegacyLocalCustomTemplates());
    void loadTemplates();
  }, [isOpen, isAdmin, loadTemplates]);

  if (!isAdmin) {
    return (
      <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 flex items-center gap-2">
        <Lock className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span>Zarządzanie szablonami projektów jest dostępne wyłącznie dla Administratora.</span>
      </div>
    );
  }

  const customCount = templates.filter((t) => !t.builtIn).length;

  const handleMigrateLegacyToServer = async () => {
    if (legacyTemplates.length === 0 || actionLockRef.current) return;
    actionLockRef.current = true;
    setIsMigratingLegacy(true);
    setStatusMsg(null);
    let savedCount = 0;
    try {
      for (const tpl of legacyTemplates) {
        await createTemplateOnServer({
          name: tpl.name,
          typeId: tpl.typeId,
          description: tpl.description,
          defaultDurationDays: tpl.defaultDurationDays,
          defaultPriority: tpl.defaultPriority,
          ...(tpl.defaultBudget ? { defaultBudget: tpl.defaultBudget } : {}),
          ...(tpl.sourceProjectId ? { sourceProjectId: tpl.sourceProjectId } : {}),
          tasks: tpl.tasks,
          ...(tpl.deliverables && tpl.deliverables.length > 0
            ? { deliverables: tpl.deliverables }
            : {}),
        });
        savedCount += 1;
      }
      clearLegacyLocalCustomTemplates();
      setLegacyTemplates([]);
      await loadTemplates();
      await onRefreshState?.();
      setStatusMsg({
        type: 'success',
        text: `Zapisano ${savedCount} szablon(ów) z przeglądarki na serwerze.`,
      });
    } catch (err: unknown) {
      await loadTemplates();
      showError(
        err,
        `Przeniesiono ${savedCount} szablonów, ale wystąpił błąd podczas zapisu pozostałych.`
      );
    } finally {
      actionLockRef.current = false;
      setIsMigratingLegacy(false);
    }
  };

  const handleDismissLegacy = () => {
    clearLegacyLocalCustomTemplates();
    setLegacyTemplates([]);
    setStatusMsg({
      type: 'info',
      text: 'Pominięto lokalne szablony z tej przeglądarki i wyczyszczono pamięć lokalną.',
    });
  };

  const handleDuplicate = async (tpl: ProjectTemplateSummary) => {
    if (actionLockRef.current) return;
    actionLockRef.current = true;
    setBusyId(tpl.id);
    setStatusMsg(null);
    try {
      const res = await duplicateTemplateOnServer(tpl.id);
      await loadTemplates();
      await onRefreshState?.();
      setStatusMsg({
        type: 'success',
        text: `Utworzono kopię szablonu: "${res.template.name}".`,
      });
    } catch (err: unknown) {
      showError(err, 'Nie udało się zduplikować szablonu.');
    } finally {
      actionLockRef.current = false;
      setBusyId(null);
    }
  };

  const handleConfirmDelete = async (tpl: ProjectTemplateSummary) => {
    if (actionLockRef.current) return;
    actionLockRef.current = true;
    setBusyId(tpl.id);
    setStatusMsg(null);
    try {
      await deleteTemplateOnServer(tpl.id);
      setConfirmDeleteId(null);
      await loadTemplates();
      await onRefreshState?.();
      setStatusMsg({
        type: 'success',
        text: `Szablon "${tpl.name}" został usunięty.`,
      });
    } catch (err: unknown) {
      showError(err, 'Nie udało się usunąć szablonu.');
    } finally {
      actionLockRef.current = false;
      setBusyId(null);
    }
  };

  const handleOpenEditor = async (tpl: ProjectTemplateSummary) => {
    if (actionLockRef.current) return;
    actionLockRef.current = true;
    setLoadingEditId(tpl.id);
    setStatusMsg(null);
    try {
      const fullTemplate = await fetchTemplateById(tpl.id);
      setEditingTemplate(fullTemplate);
    } catch (err: unknown) {
      showError(err, 'Nie udało się wczytać szablonu do edycji.');
    } finally {
      actionLockRef.current = false;
      setLoadingEditId(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Nagłówek sekcji */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Layers className="w-4 h-4 text-purple-700 dark:text-purple-400" aria-hidden="true" />
            <span>Szablony projektów</span>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
              {customCount}/{MAX_CUSTOM_TEMPLATES} własnych
            </span>
          </h4>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
            Wspólny katalog szablonów przechowywany na serwerze dla wszystkich użytkowników tworzących projekty.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsFromProjectOpen(true)}
          disabled={customCount >= MAX_CUSTOM_TEMPLATES || projects.length === 0}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-sky-700 hover:bg-sky-800 disabled:opacity-50 text-white text-xs font-semibold shadow-xs transition-colors"
        >
          <Building2 className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Utwórz z projektu</span>
        </button>
      </div>

      {/* Baner migracji z localStorage */}
      {legacyTemplates.length > 0 && (
        <div
          role="region"
          aria-label="Migracja lokalnych szablonów"
          className="p-4 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-950 dark:text-amber-100 space-y-2.5"
        >
          <div className="flex items-start gap-2.5">
            <UploadCloud className="w-5 h-5 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="space-y-1 flex-1">
              <p className="font-bold text-xs">
                Znaleziono szablony z tej przeglądarki. Zapisać je na serwerze?
              </p>
              <p className="text-[11px] text-amber-900 dark:text-amber-200">
                Wykryto {legacyTemplates.length} własny(ch) szablon(ów) zapisanych lokalnie w tej przeglądarce:{' '}
                <span className="font-semibold">
                  {legacyTemplates.map((t) => t.name).join(', ')}
                </span>
                .
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              disabled={isMigratingLegacy}
              onClick={handleDismissLegacy}
              className="px-3 py-1.5 rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900 text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-slate-800 text-xs font-semibold transition-colors"
            >
              Pomiń
            </button>
            <button
              type="button"
              disabled={isMigratingLegacy}
              onClick={handleMigrateLegacyToServer}
              className="px-3.5 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-800 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
            >
              {isMigratingLegacy ? 'Zapisywanie...' : 'Zapisz na serwerze'}
            </button>
          </div>
        </div>
      )}

      {/* Komunikat statusu */}
      {statusMsg?.type === 'error' ? (
        <FormError
          error={statusMsg.text}
          alertRef={errorAlertRef}
          onDismiss={() => setStatusMsg(null)}
        />
      ) : (
        statusMsg && (
          <div
            role="status"
            className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
              statusMsg.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                : 'bg-sky-50 dark:bg-sky-950/50 border-sky-300 dark:border-sky-800 text-sky-900 dark:text-sky-200'
            }`}
          >
            <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{statusMsg.text}</span>
          </div>
        )
      )}

      {/* Lista szablonów */}
      {isLoading ? (
        <div role="status" className="flex items-center gap-2 py-8 text-slate-600 dark:text-slate-400">
          <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
          <span>Ładowanie szablonów...</span>
        </div>
      ) : (
        <div className="space-y-2.5">
          {templates.map((tpl) => {
            const isBusy = busyId === tpl.id;
            const isConfirmingDelete = confirmDeleteId === tpl.id;
            const typeInfo = resolveProjectType(tpl.typeId, projectTypes);

            return (
              <div
                key={tpl.id}
                className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 text-slate-900 dark:text-slate-100 space-y-2.5"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-sm text-slate-900 dark:text-white">
                        {tpl.name}
                      </span>
                      {tpl.builtIn ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700">
                          Wbudowany
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-purple-100 dark:bg-purple-950/60 text-purple-800 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                          Własny
                        </span>
                      )}
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${typeInfo.badgeClass}`}>
                        {typeInfo.label}
                      </span>
                    </div>

                    {tpl.description && (
                      <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2">
                        {tpl.description}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600 dark:text-slate-400 pt-0.5">
                      <span className="inline-flex items-center gap-1">
                        <Layers className="w-3 h-3" aria-hidden="true" />
                        <span>{tpl.taskCount} zadań</span>
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3 h-3" aria-hidden="true" />
                        <span>{tpl.defaultDurationDays} dni</span>
                      </span>
                      {(tpl.deliverableCount || 0) > 0 && (
                        <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300 font-semibold">
                          <PackageCheck className="w-3 h-3" aria-hidden="true" />
                          <span>{tpl.deliverableCount} elem. odbioru</span>
                        </span>
                      )}
                      {tpl.officialDeadlineCount > 0 && (
                        <span className="text-rose-700 dark:text-rose-300 font-semibold">
                          {tpl.officialDeadlineCount} terminy urzędowe
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Akcje */}
                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      disabled={isBusy || customCount >= MAX_CUSTOM_TEMPLATES}
                      onClick={() => handleDuplicate(tpl)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 text-xs font-semibold transition-colors"
                    >
                      <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Duplikuj</span>
                    </button>

                    {!tpl.builtIn && (
                      <>
                        <button
                          type="button"
                          disabled={isBusy || loadingEditId === tpl.id}
                          onClick={() => handleOpenEditor(tpl)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 text-xs font-semibold transition-colors"
                        >
                          <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>{loadingEditId === tpl.id ? 'Wczytywanie...' : 'Edytuj'}</span>
                        </button>

                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() =>
                            setConfirmDeleteId(isConfirmingDelete ? null : tpl.id)
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/60 disabled:opacity-50 text-xs font-semibold transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Usuń</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Potwierdzenie usunięcia */}
                {isConfirmingDelete && !tpl.builtIn && (
                  <div className="pt-2.5 border-t border-rose-200 dark:border-rose-900/50 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="text-rose-800 dark:text-rose-200 font-medium">
                      Czy na pewno trwale usunąć szablon „{tpl.name}”?
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => setConfirmDeleteId(null)}
                        className="px-3 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 font-semibold"
                      >
                        Anuluj
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleConfirmDelete(tpl)}
                        className="px-3 py-1 rounded bg-rose-700 hover:bg-rose-800 text-white font-semibold"
                      >
                        {isBusy ? 'Usuwanie...' : 'Potwierdź usunięcie'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <CreateTemplateFromProjectModal
        isOpen={isFromProjectOpen}
        onClose={() => setIsFromProjectOpen(false)}
        projects={projects}
        tasks={tasks}
        onCreated={(created) => {
          void loadTemplates();
          void onRefreshState?.();
          setStatusMsg({
            type: 'success',
            text: `Utworzono szablon "${created.name}" (${created.tasks.length} zadań).`,
          });
        }}
      />

      <TemplateEditorModal
        isOpen={Boolean(editingTemplate)}
        template={editingTemplate}
        onClose={() => setEditingTemplate(null)}
        onSaved={(updated) => {
          setEditingTemplate(null);
          void loadTemplates();
          void onRefreshState?.();
          setStatusMsg({
            type: 'success',
            text: `Zapisano zmiany w szablonie "${updated.name}" (${updated.tasks.length} zadań).`,
          });
        }}
      />
    </div>
  );
};
