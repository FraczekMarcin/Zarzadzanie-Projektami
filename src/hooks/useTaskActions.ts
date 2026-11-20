import React, { useRef, useState } from 'react';
import { Task, Project, User, TaskStatus, Comment } from '../types';
import { getTodayIso, addDaysIso } from '../utils/today';
import { cascadeScheduleDates } from '../utils/scheduleCascade';
import type { NotificationToast } from './useAuthSession';
import { attemptSilentDeviceLogin } from '../utils/deviceLoginClient';

interface UseTaskActionsParams {
  tasks: Task[];
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  projects: Project[];
  currentUser: User;
  editingTask: Task | null;
  setEditingTask: React.Dispatch<React.SetStateAction<Task | null>>;
  selectedTaskDetail: Task | null;
  setSelectedTaskDetail: React.Dispatch<React.SetStateAction<Task | null>>;
  setComments: React.Dispatch<React.SetStateAction<Comment[]>>;
  setIsAuthenticated: React.Dispatch<React.SetStateAction<boolean>>;
  setNotificationToast: React.Dispatch<React.SetStateAction<NotificationToast | null>>;
  applyRevision: (rev: number) => void;
  fetchFreshState: (showNotification?: boolean) => Promise<void>;
  logActivity: (action: string, taskId?: string, details?: string) => void;
}

export function useTaskActions({
  tasks,
  setTasks,
  projects,
  currentUser,
  editingTask,
  setEditingTask,
  selectedTaskDetail,
  setSelectedTaskDetail,
  setComments,
  setIsAuthenticated,
  setNotificationToast,
  applyRevision,
  fetchFreshState,
  logActivity,
}: UseTaskActionsParams) {
  // Kolejka debouncingu 500 ms dla aktualizacji wielu pól jednego zadania
  const taskPatchDebounceTimers = useRef<Map<string, { timer: any; patch: Partial<Task>; baseRevision: number }>>(new Map());
  const [taskToDelete, setTaskToDelete] = useState<Task | null>(null);

  const restoreFromTrashById = async (trashId: string) => {
    try {
      const res = await fetch(`/api/trash/${encodeURIComponent(trashId)}/restore`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (res.status === 401) {
        const deviceAuth = await attemptSilentDeviceLogin();
        if (!deviceAuth.ok) {
          setIsAuthenticated(false);
        }
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotificationToast({
          message: data.error || 'Nie udało się przywrócić elementu z kosza.',
          type: 'error',
        });
        return;
      }
      if (typeof data.revision === 'number') {
        applyRevision(data.revision);
      }
      await fetchFreshState(false);
      setNotificationToast({
        message: 'Przywrócono element z kosza.',
        type: 'success',
      });
    } catch {
      setNotificationToast({
        message: 'Błąd połączenia z serwerem podczas przywracania z kosza.',
        type: 'error',
      });
    }
  };

  const saveTaskPatchToServer = async (taskId: string, patch: Partial<Task>, baseRevision?: number, retryCount = 0): Promise<void> => {
    try {
      const targetRev = baseRevision !== undefined ? baseRevision : 1;
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': String(targetRev),
        },
        body: JSON.stringify(patch),
      });

      if (res.status === 401) {
        const deviceAuth = await attemptSilentDeviceLogin();
        if (!deviceAuth.ok) {
          setIsAuthenticated(false);
        }
        return;
      }

      if (res.status === 409) {
        // Obsługa 409 Conflict: pobranie aktualnego zasobu, scalenie lokalnych zmian i ponowienie
        const conflictData = await res.json();
        const currentTask: Task = conflictData.currentTask;
        if (currentTask && retryCount < 3) {
          // Last-write-wins dla edytowanego pola
          const mergedPatch: Partial<Task> = { ...patch };
          setNotificationToast({
            message: 'Zadanie zostało zmienione przez innego użytkownika, zastosowano Twoją wersję',
            type: 'info',
          });
          await saveTaskPatchToServer(taskId, mergedPatch, currentTask.revision || 1, retryCount + 1);
          return;
        }
      }

      if (res.ok) {
        const data = await res.json();
        if (typeof data.revision === 'number') {
          applyRevision(data.revision);
        }
        if (data.task) {
          setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...data.task } : t)));
          setSelectedTaskDetail((prev) =>
            prev && prev.id === taskId ? { ...prev, ...data.task } : prev
          );
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        setNotificationToast({
          message: errData.error || 'Nie udało się zapisać zmian zadania na serwerze.',
          type: 'error',
        });
      }
    } catch (err) {
      console.warn('Błąd zapisu zadania do API:', err);
    }
  };

  const queueTaskPatch = (taskId: string, patch: Partial<Task>, baseRevision?: number) => {
    const existing = taskPatchDebounceTimers.current.get(taskId);
    if (existing) {
      clearTimeout(existing.timer);
      existing.patch = { ...existing.patch, ...patch };
    } else {
      taskPatchDebounceTimers.current.set(taskId, {
        timer: null,
        patch,
        baseRevision: baseRevision || 1,
      });
    }

    const record = taskPatchDebounceTimers.current.get(taskId)!;
    record.timer = setTimeout(() => {
      const queued = taskPatchDebounceTimers.current.get(taskId);
      taskPatchDebounceTimers.current.delete(taskId);
      if (queued) {
        saveTaskPatchToServer(taskId, queued.patch, queued.baseRevision);
      }
    }, 500);
  };

  const createTaskOnServer = async (task: Task) => {
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(task),
      });
      if (res.status === 401) {
        const deviceAuth = await attemptSilentDeviceLogin();
        if (!deviceAuth.ok) {
          setIsAuthenticated(false);
        }
        return;
      }
      if (res.ok) {
        const data = await res.json();
        if (typeof data.revision === 'number') {
          applyRevision(data.revision);
        }
        if (data.task) {
          setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, ...data.task } : t)));
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        setNotificationToast({
          message: errData.error || 'Nie udało się zapisać nowego zadania na serwerze.',
          type: 'error',
        });
      }
    } catch (err) {
      console.warn('Błąd tworzenia zadania na serwerze:', err);
    }
  };

  const deleteTaskOnServer = async (taskId: string) => {
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (res.status === 401) {
        const deviceAuth = await attemptSilentDeviceLogin();
        if (!deviceAuth.ok) {
          setIsAuthenticated(false);
        }
        return;
      }
      if (!res.ok) {
        const errData = await res.json();
        setNotificationToast({
          message: errData.error || 'Nie udało się usunąć zadania',
          type: 'error',
        });
        await fetchFreshState(false);
        return;
      }
      const data = await res.json();
      if (typeof data.revision === 'number') {
        applyRevision(data.revision);
      }
      await fetchFreshState(false);
      setNotificationToast({
        message: 'Przeniesiono do kosza',
        type: 'info',
        durationMs: 8000,
        action:
          typeof data.trashId === 'string'
            ? {
                label: 'Cofnij',
                onClick: () => restoreFromTrashById(data.trashId),
              }
            : undefined,
      });
    } catch (err) {
      console.warn('Błąd usuwania zadania z serwera:', err);
    }
  };

  const createCommentOnServer = async (comment: Comment) => {
    try {
      const res = await fetch('/api/comments', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(comment),
      });
      if (res.status === 401) {
        const deviceAuth = await attemptSilentDeviceLogin();
        if (!deviceAuth.ok) {
          setIsAuthenticated(false);
        }
        return;
      }
      if (res.ok) {
        const data = await res.json();
        if (typeof data.revision === 'number') {
          applyRevision(data.revision);
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        setNotificationToast({
          message: errData.error || 'Nie udało się zapisać komentarza na serwerze.',
          type: 'error',
        });
      }
    } catch (err) {
      console.warn('Błąd dodawania komentarza na serwerze:', err);
    }
  };

  /**
   * Helper to add days to a date string 'YYYY-MM-DD'
   */
  const addDaysToDate = (dateStr: string, daysToAdd: number): string => {
    try {
      const d = new Date(dateStr + 'T00:00:00');
      d.setDate(d.getDate() + daysToAdd);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    } catch {
      return dateStr;
    }
  };

  /**
   * Safe task selection handler: normalizes all fields to prevent any drawer crash
   */
  const handleSelectTask = (task: Task) => {
    if (!task) return;
    const priority = (task.priority as any) === 'medium' ? 'normal' : (task.priority || 'normal');
    const safeTask: Task = {
      ...task,
      title: task.title || 'Zadanie',
      code: task.code || 'ZAD',
      priority,
      status: task.status || 'to_do',
      durationDays: task.durationDays || 7,
      startDate: task.startDate || getTodayIso(),
      dueDate: task.dueDate || addDaysIso(getTodayIso(), 7),
      progress: task.progress !== undefined ? task.progress : 0,
      blockingTaskIds: Array.isArray(task.blockingTaskIds) ? task.blockingTaskIds : (task.dependencies || []),
      dependencies: Array.isArray(task.dependencies) ? task.dependencies : (task.blockingTaskIds || []),
      tags: Array.isArray(task.tags) ? task.tags : [],
    };
    setSelectedTaskDetail(safeTask);
  };

  /**
   * DEPENDENCY & TREE HIERARCHY ENGINE
   */
  const processDependencyRules = (currentTasks: Task[]): { updatedTasks: Task[]; triggeredEvents: string[] } => {
    // Krok 0: Kaskadowe dostosowanie dat kolejnych etapów (w dzień zakończenia poprzedzającego zadania)
    const { updatedTasks: cascadedTasks, cascadedEvents } = cascadeScheduleDates(currentTasks);
    let tasksCopy = [...cascadedTasks];
    const events: string[] = [...cascadedEvents];

    // Step 1: Check all tasks with blockingTaskIds
    tasksCopy = tasksCopy.map((task) => {
      const blockerIds = task.blockingTaskIds || task.dependencies || [];
      if (blockerIds.length === 0) return task;

      const blockers = tasksCopy.filter((t) => blockerIds.includes(t.id));
      const allBlockersDone = blockers.length > 0 && blockers.every((b) => b.status === 'done');

      // Rule: If all blockers are done, unlock task (transition from 'blocked' to 'in_progress')
      // and adjust start date to the latest finish date of blockers!
      if (allBlockersDone && task.status === 'blocked') {
        let latestBlockerDueDate = task.startDate || getTodayIso();
        blockers.forEach((b) => {
          if (b.dueDate && b.dueDate > latestBlockerDueDate) {
            latestBlockerDueDate = b.dueDate;
          }
        });

        const newStartDate = latestBlockerDueDate;
        const taskDuration = task.durationDays || 7;
        const newDueDate = addDaysToDate(newStartDate, taskDuration - 1);

        events.push(
          `Odblokowano zadanie [${task.code}]: po ukończeniu poprzedników przeszło w stan "W toku", a czas trwania (${taskDuration} dni) liczony jest od ${newStartDate}.`
        );

        return {
          ...task,
          status: 'in_progress',
          startDate: newStartDate,
          dueDate: newDueDate,
          updatedAt: new Date().toISOString(),
        };
      }

      // Rule: If any blocker is NOT done and task was not marked as done, ensure it stays blocked
      if (!allBlockersDone && task.status !== 'done') {
        return {
          ...task,
          status: 'blocked',
          updatedAt: new Date().toISOString(),
        };
      }

      return task;
    });

    // Step 2: Parent-Subtask Tree Hierarchy Rule
    const parentIds = Array.from(new Set(tasksCopy.map((t) => t.parentId).filter(Boolean))) as string[];

    parentIds.forEach((parentId) => {
      const subtasks = tasksCopy.filter((t) => t.parentId === parentId);
      const allSubtasksDone = subtasks.length > 0 && subtasks.every((s) => s.status === 'done');
      const parentTask = tasksCopy.find((t) => t.id === parentId);

      if (parentTask && allSubtasksDone && parentTask.status !== 'done') {
        tasksCopy = tasksCopy.map((t) =>
          t.id === parentId
            ? {
                ...t,
                status: 'done',
                progress: 100,
                updatedAt: new Date().toISOString(),
              }
            : t
        );
        events.push(
          `Wszystkie podzadania zostały ukończone! Zadanie nadrzędne [${parentTask.code}] "${parentTask.title}" zostało automatycznie zakończone.`
        );
      } else if (parentTask && subtasks.length > 0) {
        const avgProgress = Math.round(
          subtasks.reduce((acc, s) => acc + (s.progress || 0), 0) / subtasks.length
        );
        if (parentTask.progress !== avgProgress && parentTask.status !== 'done') {
          tasksCopy = tasksCopy.map((t) =>
            t.id === parentId ? { ...t, progress: avgProgress } : t
          );
        }
      }
    });

    return { updatedTasks: tasksCopy, triggeredEvents: events };
  };

  // Task actions
  const handleSaveTask = (taskData: Omit<Task, 'id' | 'code' | 'createdAt' | 'updatedAt'>) => {
    let newTaskList: Task[];

    if (editingTask) {
      const updated: Task = {
        ...editingTask,
        ...taskData,
        updatedAt: new Date().toISOString(),
      };
      newTaskList = tasks.map((t) => (t.id === editingTask.id ? updated : t));
      queueTaskPatch(editingTask.id, taskData, editingTask.revision || 1);
      logActivity(
        `${currentUser.name} zaktualizował zadanie [${editingTask.code}]: ${updated.title}`,
        editingTask.id,
        `Status: ${updated.status}, Czas trwania: ${updated.durationDays} dni, Priorytet: ${updated.priority}`
      );
    } else {
      const targetProject = projects.find((p) => p.id === taskData.projectId) || projects[0];
      const count = tasks.filter((t) => t.projectId === targetProject.id).length + 1;
      const code = `${targetProject.key}-${String(count).padStart(2, '0')}`;

      const newTask: Task = {
        ...taskData,
        id: `tsk-${Date.now()}`,
        code,
        revision: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      newTaskList = [newTask, ...tasks];
      createTaskOnServer(newTask);
      logActivity(
        `${currentUser.name} utworzył nowe zadanie [${code}]: ${newTask.title}`,
        newTask.id,
        `Czas: ${newTask.durationDays} dni, Priorytet: ${newTask.priority}`
      );
    }

    const { updatedTasks, triggeredEvents } = processDependencyRules(newTaskList);
    setTasks(updatedTasks);

    if (triggeredEvents.length > 0) {
      triggeredEvents.forEach((evt) => logActivity(evt));
      setNotificationToast({ message: triggeredEvents[0], type: 'success' });
    }

    if (selectedTaskDetail) {
      const refreshed = updatedTasks.find((t) => t.id === selectedTaskDetail.id);
      if (refreshed) handleSelectTask(refreshed);
    }

    setEditingTask(null);
  };

  const handleDeleteTask = (taskId: string) => {
    const target = tasks.find((t) => t.id === taskId);
    if (!target) return;
    setTaskToDelete(target);
  };

  const confirmDeleteTask = () => {
    if (!taskToDelete) return;
    const taskId = taskToDelete.id;
    setTaskToDelete(null);

    const filtered = tasks.filter((t) => t.id !== taskId);
    const { updatedTasks } = processDependencyRules(filtered);
    setTasks(updatedTasks);
    if (selectedTaskDetail?.id === taskId) {
      setSelectedTaskDetail(null);
    }
    void deleteTaskOnServer(taskId);
  };

  const handleUpdateStatus = async (taskId: string, newStatus: TaskStatus, immediate = false) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    const blockerIds = task.blockingTaskIds || task.dependencies || [];
    const unfinishedBlockers = tasks.filter((t) => blockerIds.includes(t.id) && t.status !== 'done');

    if (unfinishedBlockers.length > 0 && (newStatus === 'in_progress' || newStatus === 'done')) {
      setNotificationToast({
        message:
          `Nie można przenieść zadania [${task.code}] przed ukończeniem zadań blokujących: ` +
          unfinishedBlockers.map((b) => `[${b.code}] ${b.title}`).join(', '),
        type: 'error',
      });
      return;
    }

    const progress = newStatus === 'done' ? 100 : task.progress;
    const updated: Task = {
      ...task,
      status: newStatus,
      progress,
      updatedAt: new Date().toISOString(),
    };

    const newTaskList = tasks.map((t) => (t.id === taskId ? updated : t));
    const { updatedTasks, triggeredEvents } = processDependencyRules(newTaskList);
    setTasks(updatedTasks);

    if (immediate) {
      const existing = taskPatchDebounceTimers.current.get(taskId);
      if (existing) {
        clearTimeout(existing.timer);
        taskPatchDebounceTimers.current.delete(taskId);
      }
      await saveTaskPatchToServer(
        taskId,
        { ...(existing?.patch || {}), status: newStatus, progress },
        task.revision || 1
      );
    } else {
      queueTaskPatch(taskId, { status: newStatus, progress }, task.revision || 1);
    }
    logActivity(`${currentUser.name} zmienił status [${task.code}] na "${newStatus}"`, taskId);

    if (triggeredEvents.length > 0) {
      triggeredEvents.forEach((evt) => logActivity(evt));
      setNotificationToast({ message: triggeredEvents[0], type: 'success' });
    }

    if (selectedTaskDetail?.id === taskId) {
      const refreshed = updatedTasks.find((t) => t.id === taskId);
      if (refreshed) handleSelectTask(refreshed);
    }
  };

  const handleUpdateProgress = (taskId: string, progress: number) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    const status: TaskStatus = progress === 100 ? 'done' : task.status;
    const updated: Task = {
      ...task,
      progress,
      status,
      updatedAt: new Date().toISOString(),
    };

    const newTaskList = tasks.map((t) => (t.id === taskId ? updated : t));
    const { updatedTasks, triggeredEvents } = processDependencyRules(newTaskList);
    setTasks(updatedTasks);

    queueTaskPatch(taskId, { progress, status }, task.revision || 1);

    if (triggeredEvents.length > 0) {
      triggeredEvents.forEach((evt) => logActivity(evt));
      setNotificationToast({ message: triggeredEvents[0], type: 'success' });
    }

    if (selectedTaskDetail?.id === taskId) {
      const refreshed = updatedTasks.find((t) => t.id === taskId);
      if (refreshed) handleSelectTask(refreshed);
    }
  };

  const handleAddComment = (taskId: string, content: string) => {
    const newComment: Comment = {
      id: `com-${Date.now()}`,
      taskId,
      userId: currentUser.id,
      content,
      createdAt: new Date().toISOString(),
    };
    setComments((prev) => [...prev, newComment]);
    createCommentOnServer(newComment);
    logActivity(`${currentUser.name} dodał komentarz do zadania`, taskId, content);
  };

  return {
    createTaskOnServer,
    restoreFromTrashById,
    processDependencyRules,
    handleSelectTask,
    handleSaveTask,
    handleDeleteTask,
    taskToDelete,
    setTaskToDelete,
    confirmDeleteTask,
    handleUpdateStatus,
    handleUpdateProgress,
    handleAddComment,
  };
}
