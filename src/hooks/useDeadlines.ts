import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  loadDeadlineBlinkPref,
  saveDeadlineBlinkPref,
  subscribeDeadlineBlinkPref,
} from '../utils/deadlines';

export function useDeadlineBlinkPreference(): [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(
    subscribeDeadlineBlinkPref,
    loadDeadlineBlinkPref,
    () => true
  );
  return [enabled, saveDeadlineBlinkPref];
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return reduced;
}
