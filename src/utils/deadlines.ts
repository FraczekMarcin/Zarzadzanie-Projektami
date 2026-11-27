import { useEffect, useState, useSyncExternalStore } from 'react';

// TODO: Uzupełnić obsługę po doprecyzowaniu uciętego wymagania:
// "po terminie projektu podana liczba dni do tego terminu z możliwości robienia..."

export interface ProjectDeadlineSettings {
  warnDays: number;
  criticalDays: number;
  blinkEnabled: boolean;
}

export const DEFAULT_PROJECT_DEADLINE_SETTINGS: ProjectDeadlineSettings = {
  warnDays: 30,
  criticalDays: 7,
  blinkEnabled: true,
};

export const PROJECT_DEADLINE_LIMITS = {
  minDays: 1,
  maxDays: 365,
} as const;

export const DEFAULT_DEADLINE_TIMEZONE = 'Europe/Warsaw';
export const DEADLINE_BLINK_PREF_KEY = 'oph_pref_deadline_blink';

const ISO_DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

export function resolveDeadlineTimezone(timezone?: string | null): string {
  const trimmed = typeof timezone === 'string' ? timezone.trim() : '';
  if (!trimmed) return DEFAULT_DEADLINE_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: trimmed }).format(new Date());
    return trimmed;
  } catch {
    return DEFAULT_DEADLINE_TIMEZONE;
  }
}

/**
 * Returns YYYY-MM-DD in the given IANA timezone (defaults to Europe/Warsaw).
 */
export function getTodayIsoInTimezone(
  timezone?: string | null,
  now: Date = new Date()
): string {
  const resolvedTz = resolveDeadlineTimezone(timezone);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: resolvedTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const year = parts.find((p) => p.type === 'year')?.value || '1970';
  const month = parts.find((p) => p.type === 'month')?.value || '01';
  const day = parts.find((p) => p.type === 'day')?.value || '01';
  return `${year}-${month}-${day}`;
}

/**
 * Parses YYYY-MM-DD strictly to UTC midnight timestamp (ms) so calendar day diffs
 * are immune to DST spring-forward (23h) and fall-back (25h) transitions.
 */
function parseIsoToUtcMidnightMs(isoDate: string): number | null {
  if (typeof isoDate !== 'string') return null;
  const match = ISO_DATE_REGEX.exec(isoDate.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcMs = Date.UTC(year, month - 1, day);
  const check = new Date(utcMs);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return utcMs;
}

/**
 * Calendar days from `todayIso` to `targetDateIso` (positive = future, 0 = today, negative = overdue).
 */
export function diffCalendarDays(targetDateIso: string, todayIso: string): number | null {
  const targetMs = parseIsoToUtcMidnightMs(targetDateIso);
  const todayMs = parseIsoToUtcMidnightMs(todayIso);
  if (targetMs === null || todayMs === null) return null;
  return Math.round((targetMs - todayMs) / 86_400_000);
}

/**
 * Polish pluralization for day counts: "1 dzień", "2 dni", "5 dni", "22 dni".
 */
export function formatPolishDays(days: number): string {
  const abs = Math.abs(Math.trunc(days));
  return abs === 1 ? '1 dzień' : `${abs} dni`;
}

/**
 * Formats relative project deadline label:
 * - 0 -> "dziś"
 * - 1 -> "jutro"
 * - > 1 -> "za N dni" (e.g. "za 2 dni", "za 5 dni")
 * - < 0 -> "N dni po terminie" (e.g. "1 dzień po terminie", "5 dni po terminie")
 */
export function formatProjectDeadlineRelative(diffDays: number): string {
  if (diffDays === 0) return 'dziś';
  if (diffDays === 1) return 'jutro';
  if (diffDays > 1) return `za ${formatPolishDays(diffDays)}`;
  return `${formatPolishDays(Math.abs(diffDays))} po terminie`;
}

export type ProjectDeadlineTone = 'none' | 'normal' | 'warning' | 'critical';

export interface EvaluateProjectDeadlineOptions {
  isClosed?: boolean;
  isArchived?: boolean;
  todayIso?: string;
  timezone?: string | null;
  now?: Date;
  userBlinkEnabled?: boolean;
  reducedMotion?: boolean;
}

export interface ProjectDeadlineEvaluation {
  showCounter: boolean;
  diffDays: number | null;
  text: string | null;
  tone: ProjectDeadlineTone;
  isRed: boolean;
  shouldBlink: boolean;
  showStaticCritical: boolean;
  isOverdue: boolean;
}

export function normalizeProjectDeadlineSettings(
  raw?: Partial<ProjectDeadlineSettings> | null
): ProjectDeadlineSettings {
  const warnDays =
    typeof raw?.warnDays === 'number' &&
    Number.isInteger(raw.warnDays) &&
    raw.warnDays >= PROJECT_DEADLINE_LIMITS.minDays &&
    raw.warnDays <= PROJECT_DEADLINE_LIMITS.maxDays
      ? raw.warnDays
      : DEFAULT_PROJECT_DEADLINE_SETTINGS.warnDays;

  let criticalDays =
    typeof raw?.criticalDays === 'number' &&
    Number.isInteger(raw.criticalDays) &&
    raw.criticalDays >= PROJECT_DEADLINE_LIMITS.minDays &&
    raw.criticalDays <= PROJECT_DEADLINE_LIMITS.maxDays
      ? raw.criticalDays
      : DEFAULT_PROJECT_DEADLINE_SETTINGS.criticalDays;

  if (criticalDays >= warnDays) {
    criticalDays = Math.max(PROJECT_DEADLINE_LIMITS.minDays, warnDays - 1);
  }

  const blinkEnabled =
    typeof raw?.blinkEnabled === 'boolean'
      ? raw.blinkEnabled
      : DEFAULT_PROJECT_DEADLINE_SETTINGS.blinkEnabled;

  return { warnDays, criticalDays, blinkEnabled };
}

export function evaluateProjectDeadline(
  dueDate: string | undefined | null,
  settings?: Partial<ProjectDeadlineSettings> | null,
  options: EvaluateProjectDeadlineOptions = {}
): ProjectDeadlineEvaluation {
  if (!dueDate || options.isClosed) {
    return {
      showCounter: false,
      diffDays: null,
      text: null,
      tone: 'none',
      isRed: false,
      shouldBlink: false,
      showStaticCritical: false,
      isOverdue: false,
    };
  }

  const todayIso =
    options.todayIso && parseIsoToUtcMidnightMs(options.todayIso) !== null
      ? options.todayIso
      : getTodayIsoInTimezone(options.timezone, options.now);

  const diffDays = diffCalendarDays(dueDate, todayIso);
  if (diffDays === null) {
    return {
      showCounter: false,
      diffDays: null,
      text: null,
      tone: 'none',
      isRed: false,
      shouldBlink: false,
      showStaticCritical: false,
      isOverdue: false,
    };
  }

  const text = formatProjectDeadlineRelative(diffDays);
  const isOverdue = diffDays < 0;

  if (options.isArchived) {
    return {
      showCounter: true,
      diffDays,
      text,
      tone: 'normal',
      isRed: false,
      shouldBlink: false,
      showStaticCritical: false,
      isOverdue,
    };
  }

  const cfg = normalizeProjectDeadlineSettings(settings);
  const isCritical = diffDays <= cfg.criticalDays;
  const isWarning = !isCritical && diffDays <= cfg.warnDays;
  const isRed = isCritical || isWarning;

  const canAnimate =
    cfg.blinkEnabled &&
    options.userBlinkEnabled !== false &&
    !options.reducedMotion;

  const shouldBlink = isCritical && canAnimate;
  const showStaticCritical = isCritical && !shouldBlink;

  return {
    showCounter: true,
    diffDays,
    text,
    tone: isCritical ? 'critical' : isWarning ? 'warning' : 'normal',
    isRed,
    shouldBlink,
    showStaticCritical,
    isOverdue,
  };
}

const blinkPrefListeners = new Set<() => void>();

function notifyBlinkPrefListeners(): void {
  for (const listener of blinkPrefListeners) {
    try {
      listener();
    } catch {
      // ignore subscriber errors
    }
  }
}

export function loadDeadlineBlinkPref(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const raw = window.localStorage.getItem(DEADLINE_BLINK_PREF_KEY);
    return raw !== 'false';
  } catch {
    return true;
  }
}

export function saveDeadlineBlinkPref(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DEADLINE_BLINK_PREF_KEY, enabled ? 'true' : 'false');
  } catch {
    // ignore storage errors
  }
  notifyBlinkPrefListeners();
}

export function subscribeDeadlineBlinkPref(listener: () => void): () => void {
  blinkPrefListeners.add(listener);
  if (typeof window === 'undefined') {
    return () => {
      blinkPrefListeners.delete(listener);
    };
  }
  const onStorage = (e: StorageEvent) => {
    if (e.key === DEADLINE_BLINK_PREF_KEY || e.key === null) {
      listener();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    blinkPrefListeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

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
