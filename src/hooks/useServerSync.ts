import React, { useState, useEffect, useRef } from 'react';
import { Task, Project, User, ActivityLog, Comment, Company, ProjectNumberingSettings } from '../types';
import type { NotificationToast } from './useAuthSession';
import { attemptSilentDeviceLogin } from '../utils/deviceLoginClient';
import { setServerVariables } from '../utils/variableSettings';
import { normalizeProgressWeighting, ProgressWeighting } from '../utils/progress';
import { normalizeSubmitError, parseApiErrorResponse } from './useFormSubmit';

export interface ProjectMutationResult {
  ok: boolean;
  status?: number;
  project?: Project;
  tasks?: Task[];
  error?: string;
  field?: string;
}

export interface FinancePatchSaveResult {
  ok: boolean;
  status: number;
  project?: Project;
  revision?: number;
  error?: string;
  itemType?: 'project' | 'quotation' | 'cost' | 'tranche';
  itemId?: string;
  field?: string;
  currentProject?: Project;
}

interface UseServerSyncParams {
  isAuthenticated: boolean;
  setIsAuthenticated: React.Dispatch<React.SetStateAction<boolean>>;
  editingTaskRef: React.MutableRefObject<Task | null>;
  closeEventSourceRef: React.MutableRefObject<() => void>;
  setUsers: React.Dispatch<React.SetStateAction<User[]>>;
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  setCompanies?: React.Dispatch<React.SetStateAction<Company[]>>;
  setProjectNumbering?: React.Dispatch<React.SetStateAction<ProjectNumberingSettings>>;
  setProgressWeighting?: React.Dispatch<React.SetStateAction<ProgressWeighting>>;
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  setActivityLogs: React.Dispatch<React.SetStateAction<ActivityLog[]>>;
  setComments: React.Dispatch<React.SetStateAction<Comment[]>>;
  setSelectedProjectId: React.Dispatch<React.SetStateAction<string | null>>;
  setNotificationToast: React.Dispatch<React.SetStateAction<NotificationToast | null>>;
}

export function useServerSync({
  isAuthenticated,
  setIsAuthenticated,
  editingTaskRef,
  closeEventSourceRef,
  setUsers,
  setProjects,
  setCompanies,
  setProjectNumbering,
  setProgressWeighting,
  setTasks,
  setActivityLogs,
  setComments,
  setSelectedProjectId,
  setNotificationToast,
}: UseServerSyncParams) {
  // Rewizja stanu na serwerze i referencje dla współbieżnej synchronizacji
  const [stateRevision, setStateRevision] = useState<number>(0);
  const [hasLoadedState, setHasLoadedState] = useState<boolean>(false);
  const stateRevisionRef = useRef<number>(0);
  stateRevisionRef.current = stateRevision;

  const eventSourceRef = useRef<EventSource | null>(null);

  const applyRevision = (rev: number) => {
    setStateRevision(rev);
    stateRevisionRef.current = rev;
  };

  const closeEventSource = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  };
  closeEventSourceRef.current = closeEventSource;

  // Pobranie świeżego stanu z serwera (z zachowaniem otwartego formularza edycji)
  const fetchFreshState = async (showNotification = false) => {
    try {
      const res = await fetch('/api/state', { credentials: 'same-origin' });
      if (res.status === 401) {
        const deviceAuth = await attemptSilentDeviceLogin();
        if (deviceAuth.ok) {
          return await fetchFreshState(showNotification);
        }
        closeEventSource();
        setHasLoadedState(false);
        setIsAuthenticated(false);
        localStorage.removeItem('oph_is_authenticated');
        return;
      }
      if (!res.ok) return;
      const data = await res.json();
      if (data.initialized && data.state) {
        const s = data.state;
        if (typeof s.revision === 'number') {
          applyRevision(s.revision);
        }
        if (Array.isArray(s.users) && s.users.length > 0) {
          setUsers(s.users);
        }
        if (Array.isArray(s.projects)) {
          setProjects(s.projects);
        }
        if (Array.isArray(s.companies) && setCompanies) {
          setCompanies(s.companies);
        }
        if (s.projectNumbering && typeof s.projectNumbering === 'object' && setProjectNumbering) {
          setProjectNumbering({
            scope: s.projectNumbering.scope === 'company' ? 'company' : 'year',
            ...(typeof s.projectNumbering.defaultCompanyId === 'string' && s.projectNumbering.defaultCompanyId
              ? { defaultCompanyId: s.projectNumbering.defaultCompanyId }
              : {}),
          });
        }
        if (Array.isArray(s.tasks)) {
          const currentEditingId = editingTaskRef.current?.id;
          setTasks((prevTasks) => {
            if (!currentEditingId) return s.tasks;
            // Nie nadpisuj pól zadania edytowanego obecnie w otwartym formularzu
            return s.tasks.map((incomingTask: Task) => {
              if (incomingTask.id === currentEditingId) {
                const localTask = prevTasks.find((t) => t.id === currentEditingId);
                return localTask || incomingTask;
              }
              return incomingTask;
            });
          });
        }
        if (Array.isArray(s.activityLogs)) {
          setActivityLogs(s.activityLogs);
        }
        if (Array.isArray(s.comments)) {
          setComments(s.comments);
        }
        if (s.variables) {
          setServerVariables(s.variables);
        }
        if (s.progressWeighting !== undefined && setProgressWeighting) {
          setProgressWeighting(normalizeProgressWeighting(s.progressWeighting));
        }
        setHasLoadedState(true);
        if (showNotification) {
          setNotificationToast({
            message: 'Zmiany od innych użytkowników zostały pobrane',
            type: 'info',
          });
        }
      }
    } catch (err) {
      console.warn('Błąd odświeżania stanu z serwera:', err);
    }
  };

  // Inicjalne pobranie stanu przy starcie sesji
  useEffect(() => {
    if (!isAuthenticated) {
      setHasLoadedState(false);
      return;
    }
    fetchFreshState(false);
  }, [isAuthenticated]);

  // Strumień zdarzeń SSE (/api/events) z rezerwą odpytywania co 15 s po 3 nieudanych próbach
  useEffect(() => {
    if (!isAuthenticated) {
      closeEventSource();
      return;
    }

    let disposed = false;
    let consecutiveErrors = 0;
    let fallbackInterval: ReturnType<typeof setInterval> | null = null;
    let retryClosedTimer: ReturnType<typeof setTimeout> | null = null;

    const stopFallbackPolling = () => {
      if (fallbackInterval) {
        clearInterval(fallbackInterval);
        fallbackInterval = null;
      }
    };

    const clearRetryClosedTimer = () => {
      if (retryClosedTimer) {
        clearTimeout(retryClosedTimer);
        retryClosedTimer = null;
      }
    };

    const pollRevisionOnce = async (): Promise<boolean> => {
      try {
        const res = await fetch('/api/state/revision', { credentials: 'same-origin' });
        if (res.status === 401) {
          const deviceAuth = await attemptSilentDeviceLogin();
          if (deviceAuth.ok) {
            return await pollRevisionOnce();
          }
          closeEventSource();
          stopFallbackPolling();
          clearRetryClosedTimer();
          setIsAuthenticated(false);
          localStorage.removeItem('oph_is_authenticated');
          return false;
        }
        if (!res.ok) return false;
        const data = await res.json();
        if (typeof data.revision === 'number' && data.revision > stateRevisionRef.current) {
          await fetchFreshState(stateRevisionRef.current > 0);
        }
        return true;
      } catch (err) {
        console.warn('Błąd odpytywania rewizji:', err);
        return false;
      }
    };

    const startFallbackPolling = () => {
      if (disposed || fallbackInterval) return;
      fallbackInterval = setInterval(async () => {
        if (disposed || document.hidden) return;
        const ok = await pollRevisionOnce();
        if (
          ok &&
          !disposed &&
          typeof EventSource !== 'undefined' &&
          (!eventSourceRef.current || eventSourceRef.current.readyState === EventSource.CLOSED)
        ) {
          connectSse();
        }
      }, 15000);
    };

    const connectSse = () => {
      if (disposed) return;
      clearRetryClosedTimer();
      closeEventSource();

      if (typeof EventSource === 'undefined') {
        startFallbackPolling();
        return;
      }

      let sseUrl = '/api/events';
      try {
        const iframeBearer = sessionStorage.getItem('oph_iframe_bearer');
        if (iframeBearer) {
          sseUrl = `/api/events?token=${encodeURIComponent(iframeBearer)}`;
        }
      } catch {}
      const es = new EventSource(sseUrl);
      eventSourceRef.current = es;

      es.onopen = () => {
        if (disposed) {
          es.close();
          return;
        }
        consecutiveErrors = 0;
        stopFallbackPolling();
      };

      es.addEventListener('revision', (event: MessageEvent) => {
        if (disposed) return;
        consecutiveErrors = 0;
        stopFallbackPolling();

        let incomingRevision: number | null = null;
        try {
          const parsed = JSON.parse(String(event.data));
          if (typeof parsed === 'number') {
            incomingRevision = parsed;
          } else if (parsed && typeof parsed.revision === 'number') {
            incomingRevision = parsed.revision;
          }
        } catch {
          const parsedNum = Number(event.data);
          if (!Number.isNaN(parsedNum)) {
            incomingRevision = parsedNum;
          }
        }

        if (incomingRevision !== null && incomingRevision > stateRevisionRef.current) {
          void fetchFreshState(stateRevisionRef.current > 0);
        }
      });

      es.onerror = () => {
        if (disposed) return;
        consecutiveErrors += 1;

        const isClosed = es.readyState === EventSource.CLOSED;
        if (isClosed) {
          if (eventSourceRef.current === es) {
            eventSourceRef.current = null;
          }
          // Sprawdź, czy powodem zamknięcia nie jest 401 (wygasła/unieważniona sesja)
          void pollRevisionOnce().then((ok) => {
            if (disposed) return;
            if (ok && consecutiveErrors < 3 && !retryClosedTimer) {
              retryClosedTimer = setTimeout(() => {
                retryClosedTimer = null;
                connectSse();
              }, 2000);
            }
          });
        }

        if (consecutiveErrors >= 3) {
          startFallbackPolling();
        }
      };
    };

    connectSse();

    return () => {
      disposed = true;
      stopFallbackPolling();
      clearRetryClosedTimer();
      closeEventSource();
    };
  }, [isAuthenticated]);

  const createProjectOnServer = async (
    project: Omit<Project, 'id' | 'key'> & {
      id?: string;
      key?: string;
      templateId?: string;
      templateTaskKeys?: string[];
    }
  ): Promise<ProjectMutationResult> => {
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(project),
      });
      if (res.status === 401) {
        setIsAuthenticated(false);
        return {
          ok: false,
          status: 401,
          error: 'Sesja wygasła. Zaloguj się ponownie.',
        };
      }
      if (res.ok) {
        const data = await res.json();
        if (typeof data.revision === 'number') {
          applyRevision(data.revision);
        }
        if (data.project) {
          const createdTasks: Task[] | undefined = Array.isArray(data.tasks)
            ? (data.tasks as Task[])
            : undefined;
          setProjects((prev) => {
            if (project.id && prev.some((p) => p.id === project.id)) {
              return prev.map((p) => (p.id === project.id ? { ...p, ...data.project } : p));
            }
            if (prev.some((p) => p.id === data.project.id)) {
              return prev.map((p) => (p.id === data.project.id ? data.project : p));
            }
            return [...prev, data.project];
          });
          if (createdTasks && createdTasks.length > 0) {
            setTasks((prev) => {
              const createdIds = new Set(createdTasks.map((t) => t.id));
              return [...createdTasks, ...prev.filter((t) => !createdIds.has(t.id))];
            });
          } else if (project.id) {
            setTasks((prev) =>
              prev.map((t) => (t.projectId === project.id ? { ...t, projectId: data.project.id } : t))
            );
          }
          if (project.id) {
            setSelectedProjectId((prev) => (prev === project.id ? data.project.id : prev));
          }
          return {
            ok: true,
            status: res.status,
            project: data.project as Project,
            ...(createdTasks ? { tasks: createdTasks } : {}),
          };
        }
        return {
          ok: false,
          status: res.status,
          error: 'Nie udało się zapisać nowego projektu na serwerze.',
        };
      } else {
        const parsed = await parseApiErrorResponse(
          res,
          'Nie udało się zapisać nowego projektu na serwerze.'
        );
        return {
          ok: false,
          status: res.status,
          error: parsed.error,
          field: parsed.field,
        };
      }
    } catch (err) {
      console.warn('Błąd tworzenia projektu na serwerze:', err);
      const normalized = normalizeSubmitError(
        err,
        'Nie udało się zapisać nowego projektu na serwerze.'
      );
      return {
        ok: false,
        status: 0,
        error: normalized.error,
        field: normalized.field,
      };
    }
  };

  const patchProjectOnServer = async (
    projectId: string,
    patch: Partial<Project>,
    expectedRevision?: number,
    retryCount = 0
  ): Promise<ProjectMutationResult> => {
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': String(expectedRevision || 1),
        },
        body: JSON.stringify(patch),
      });
      if (res.status === 401) {
        setIsAuthenticated(false);
        return {
          ok: false,
          status: 401,
          error: 'Sesja wygasła. Zaloguj się ponownie.',
        };
      }
      if (res.status === 409) {
        const conflict = await res.json().catch(() => ({}));
        if (conflict.currentProject && retryCount < 3) {
          setNotificationToast({
            message: 'Projekt został zmieniony przez innego użytkownika, zastosowano Twoją wersję',
            type: 'info',
          });
          return await patchProjectOnServer(
            projectId,
            patch,
            conflict.currentProject.revision || 1,
            retryCount + 1
          );
        }
        return {
          ok: false,
          status: 409,
          error: conflict.error || 'Konflikt wersji projektu.',
          field: typeof conflict.field === 'string' ? conflict.field : undefined,
        };
      }
      if (res.ok) {
        const data = await res.json();
        if (typeof data.revision === 'number') {
          applyRevision(data.revision);
        }
        if (data.project) {
          setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, ...data.project } : p)));
        }
        return {
          ok: true,
          status: res.status,
          project: data.project as Project | undefined,
        };
      } else {
        const parsed = await parseApiErrorResponse(
          res,
          'Nie udało się zapisać zmian projektu na serwerze.'
        );
        return {
          ok: false,
          status: res.status,
          error: parsed.error,
          field: parsed.field,
        };
      }
    } catch (err) {
      console.warn('Błąd aktualizacji projektu na serwerze:', err);
      const normalized = normalizeSubmitError(
        err,
        'Nie udało się zapisać zmian projektu na serwerze.'
      );
      return {
        ok: false,
        status: 0,
        error: normalized.error,
        field: normalized.field,
      };
    }
  };

  const patchProjectFinanceOnServer = async (
    projectId: string,
    patch: Partial<Project>,
    expectedRevision?: number
  ): Promise<FinancePatchSaveResult> => {
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': String(expectedRevision || 1),
        },
        body: JSON.stringify(patch),
      });
      if (res.status === 401) {
        setIsAuthenticated(false);
        return { ok: false, status: 401, error: 'Sesja wygasła.' };
      }
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        return {
          ok: false,
          status: 409,
          error: data.error || 'Konflikt wersji projektu (został zmodyfikowany przez innego użytkownika).',
          currentProject: data.currentProject,
        };
      }
      if (res.ok) {
        if (typeof data.revision === 'number') {
          applyRevision(data.revision);
        }
        if (data.project) {
          setProjects((prev) => prev.map((p) => (p.id === projectId ? data.project : p)));
        }
        return {
          ok: true,
          status: res.status,
          project: data.project,
          revision: data.revision,
        };
      }
      return {
        ok: false,
        status: res.status,
        error: data.error || 'Nie udało się zapisać zmian finansowych projektu.',
        itemType: data.itemType,
        itemId: data.itemId,
        field: data.field,
      };
    } catch (err: any) {
      return {
        ok: false,
        status: 0,
        error: err?.message || 'Błąd połączenia z serwerem.',
      };
    }
  };

  const deleteProjectOnServer = async (
    projectId: string
  ): Promise<{ ok: boolean; trashId?: string }> => {
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (res.status === 401) {
        setIsAuthenticated(false);
        return { ok: false };
      }
      if (!res.ok) {
        const errData = await res.json();
        setNotificationToast({
          message: errData.error || 'Brak uprawnień do usunięcia projektu',
          type: 'error',
        });
        await fetchFreshState(false);
        return { ok: false };
      }
      const data = await res.json();
      if (typeof data.revision === 'number') {
        applyRevision(data.revision);
      }
      await fetchFreshState(false);
      return { ok: true, trashId: typeof data.trashId === 'string' ? data.trashId : undefined };
    } catch (err) {
      console.warn('Błąd usuwania projektu na serwerze:', err);
      return { ok: false };
    }
  };

  const createActivityOnServer = async (log: ActivityLog) => {
    try {
      const res = await fetch('/api/activity', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(log),
      });
      if (res.ok) {
        const data = await res.json();
        if (typeof data.revision === 'number') {
          applyRevision(data.revision);
        }
      }
    } catch {}
  };

  return {
    hasLoadedState,
    stateRevision,
    stateRevisionRef,
    applyRevision,
    closeEventSource,
    fetchFreshState,
    createProjectOnServer,
    patchProjectOnServer,
    patchProjectFinanceOnServer,
    deleteProjectOnServer,
    createActivityOnServer,
  };
}
