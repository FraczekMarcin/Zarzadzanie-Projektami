export interface DeepLinkTarget {
  type: 'task' | 'project' | 'view';
  id: string;
}

export interface StoredPendingDeepLink extends DeepLinkTarget {
  storedAt: number;
}

export const DEEP_LINK_STORAGE_KEY = 'zp_pending_deep_link';
export const DEEP_LINK_MAX_AGE_MS = 10 * 60 * 1000; // 10 minut

const SAFE_DEEP_LINK_ID_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,79}$/;
const FORBIDDEN_DEEP_LINK_IDS = new Set(['__proto__', 'constructor', 'prototype']);

export function isValidDeepLinkId(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  if (!raw || raw.length > 80) return false;
  if (raw !== raw.trim()) return false;
  if (FORBIDDEN_DEEP_LINK_IDS.has(raw.toLowerCase())) return false;
  return SAFE_DEEP_LINK_ID_REGEX.test(raw);
}

/**
 * Czysta funkcja parsująca parametr ?task=<id> lub ?project=<id> z ciągu zapytania URL.
 * Zwraca cel nawigacji wyłącznie dla identyfikatorów zgodnych ze wzorcem aplikacji;
 * błędne wartości, próby wstrzyknięcia lub nieznane parametry są bezpiecznie ignorowane.
 */
export function parseDeepLink(search: string | null | undefined): DeepLinkTarget | null {
  if (typeof search !== 'string') return null;
  const trimmed = search.trim();
  if (!trimmed) return null;

  const queryPart = trimmed.startsWith('?') ? trimmed.slice(1) : trimmed;
  if (!queryPart) return null;

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(queryPart);
  } catch {
    return null;
  }

  if (params.has('task')) {
    const allTasks = params.getAll('task');
    if (allTasks.length !== 1) return null;
    const rawTaskId = allTasks[0];
    if (!isValidDeepLinkId(rawTaskId)) return null;
    return { type: 'task', id: rawTaskId };
  }

  if (params.has('project')) {
    const allProjects = params.getAll('project');
    if (allProjects.length !== 1) return null;
    const rawProjectId = allProjects[0];
    if (!isValidDeepLinkId(rawProjectId)) return null;
    return { type: 'project', id: rawProjectId };
  }

  if (params.has('view')) {
    const allViews = params.getAll('view');
    if (allViews.length !== 1) return null;
    const rawView = allViews[0]?.trim();
    if (rawView === 'economy') {
      return { type: 'view', id: 'economy' };
    }
  }

  return null;
}

export function savePendingDeepLink(
  target: DeepLinkTarget,
  nowMs: number = Date.now(),
  storage: Pick<Storage, 'setItem'> | null = typeof window !== 'undefined' ? window.sessionStorage : null
): void {
  if (!storage || !isValidDeepLinkId(target.id)) return;
  try {
    const payload: StoredPendingDeepLink = {
      type: target.type,
      id: target.id,
      storedAt: nowMs,
    };
    storage.setItem(DEEP_LINK_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignoruj błędy dostępu do sessionStorage
  }
}

export function readPendingDeepLink(
  nowMs: number = Date.now(),
  storage: Pick<Storage, 'getItem' | 'removeItem'> | null = typeof window !== 'undefined'
    ? window.sessionStorage
    : null
): DeepLinkTarget | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(DEEP_LINK_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<StoredPendingDeepLink> | null;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      (parsed.type !== 'task' && parsed.type !== 'project' && parsed.type !== 'view') ||
      !isValidDeepLinkId(parsed.id) ||
      (parsed.type === 'view' && parsed.id !== 'economy') ||
      typeof parsed.storedAt !== 'number' ||
      !Number.isFinite(parsed.storedAt)
    ) {
      storage.removeItem(DEEP_LINK_STORAGE_KEY);
      return null;
    }

    const ageMs = nowMs - parsed.storedAt;
    if (ageMs < 0 || ageMs > DEEP_LINK_MAX_AGE_MS) {
      storage.removeItem(DEEP_LINK_STORAGE_KEY);
      return null;
    }

    return { type: parsed.type, id: parsed.id };
  } catch {
    try {
      storage.removeItem(DEEP_LINK_STORAGE_KEY);
    } catch {}
    return null;
  }
}

export function clearPendingDeepLink(
  storage: Pick<Storage, 'removeItem'> | null = typeof window !== 'undefined' ? window.sessionStorage : null
): void {
  if (!storage) return;
  try {
    storage.removeItem(DEEP_LINK_STORAGE_KEY);
  } catch {}
}

export function buildUrlWithoutDeepLinkParams(currentHref: string): string {
  try {
    const url = new URL(currentHref);
    url.searchParams.delete('task');
    url.searchParams.delete('project');
    if (url.searchParams.get('view') === 'economy') {
      url.searchParams.delete('view');
    }
    const search = url.searchParams.toString();
    return `${url.pathname}${search ? `?${search}` : ''}${url.hash}`;
  } catch {
    return '/';
  }
}
