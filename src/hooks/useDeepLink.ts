import { useEffect, useRef } from 'react';
import type { Project, Task } from '../types';
import {
  DeepLinkTarget,
  buildUrlWithoutDeepLinkParams,
  clearPendingDeepLink,
  parseDeepLink,
  readPendingDeepLink,
  savePendingDeepLink,
} from '../utils/deepLink';

interface UseDeepLinkParams {
  isAuthenticated: boolean;
  hasLoadedState: boolean;
  tasks: Task[];
  projects: Project[];
  onOpenTask: (task: Task) => void;
  onOpenProject: (project: Project) => void;
  onNotifyMissing: (message: string) => void;
}

export function useDeepLink({
  isAuthenticated,
  hasLoadedState,
  tasks,
  projects,
  onOpenTask,
  onOpenProject,
  onNotifyMissing,
}: UseDeepLinkParams): void {
  const initialUrlTargetRef = useRef<DeepLinkTarget | null>(null);
  const initializedRef = useRef(false);

  if (!initializedRef.current && typeof window !== 'undefined') {
    initializedRef.current = true;
    initialUrlTargetRef.current = parseDeepLink(window.location.search);
  }

  // Jeśli użytkownik nie jest jeszcze zalogowany, zapamiętaj parametr ?task= / ?project= w sessionStorage (maks. 10 min)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isAuthenticated) return;

    const fromUrl = parseDeepLink(window.location.search) || initialUrlTargetRef.current;
    if (fromUrl) {
      savePendingDeepLink(fromUrl);
      initialUrlTargetRef.current = fromUrl;
    }
  }, [isAuthenticated]);

  // Po zalogowaniu i załadowaniu pełnego stanu z serwera otwórz docelowe zadanie/projekt i wyczyść URL
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!isAuthenticated || !hasLoadedState) return;

    const urlTarget = parseDeepLink(window.location.search);
    const pendingTarget = readPendingDeepLink();
    const target = urlTarget || initialUrlTargetRef.current || pendingTarget;

    if (!target) return;

    // Zużyj link jednorazowo i usuń parametry z URL, aby odświeżenie go nie ponawiało
    initialUrlTargetRef.current = null;
    clearPendingDeepLink();
    const cleanRelativeUrl = buildUrlWithoutDeepLinkParams(window.location.href);
    try {
      window.history.replaceState(null, '', cleanRelativeUrl);
    } catch {}

    if (target.type === 'task') {
      const foundTask = tasks.find((t) => t && t.id === target.id);
      if (foundTask) {
        onOpenTask(foundTask);
      } else {
        onNotifyMissing('Zadanie nie istnieje lub nie masz do niego dostępu.');
      }
      return;
    }

    if (target.type === 'project') {
      const foundProject = projects.find((p) => p && p.id === target.id);
      if (foundProject) {
        onOpenProject(foundProject);
      } else {
        onNotifyMissing('Projekt nie istnieje lub nie masz do niego dostępu.');
      }
    }
  }, [isAuthenticated, hasLoadedState, tasks, projects, onOpenTask, onOpenProject, onNotifyMissing]);
}
