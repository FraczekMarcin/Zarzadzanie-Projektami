import type { User } from '../types';

const EXPLICIT_LOGOUT_STORAGE_KEY = 'zp_explicit_logout';

let deviceLoginAttempted = false;
let hasDeviceCookieHint = false;
let inFlightAttempt: Promise<{ ok: boolean; user?: User }> | null = null;

export function setHasTrustedDeviceCookie(present: boolean): void {
  hasDeviceCookieHint = present;
}

export function hasTrustedDeviceCookie(): boolean {
  return hasDeviceCookieHint;
}

export function markExplicitLogout(): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(EXPLICIT_LOGOUT_STORAGE_KEY, '1');
    }
  } catch {}
  deviceLoginAttempted = true;
  hasDeviceCookieHint = false;
}

export function clearExplicitLogout(): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(EXPLICIT_LOGOUT_STORAGE_KEY);
    }
  } catch {}
  deviceLoginAttempted = false;
}

export function hasExplicitLogout(): boolean {
  try {
    if (typeof sessionStorage !== 'undefined') {
      return sessionStorage.getItem(EXPLICIT_LOGOUT_STORAGE_KEY) === '1';
    }
  } catch {}
  return false;
}

export function resetDeviceLoginAttempt(): void {
  deviceLoginAttempted = false;
}

/**
 * Podejmuje jednokrotną próbę cichego logowania zaufanym urządzeniem (POST /api/auth/device-login),
 * wyłącznie gdy serwer potwierdził obecność ciasteczka urządzenia lub zapamiętano je po zalogowaniu.
 * Chroni przed zbędnymi błędami 401 w konsoli oraz zapętleniem przy równoległych żądaniach.
 */
export async function attemptSilentDeviceLogin(): Promise<{ ok: boolean; user?: User }> {
  if (hasExplicitLogout() || !hasDeviceCookieHint) {
    return { ok: false };
  }
  if (inFlightAttempt) {
    return inFlightAttempt;
  }
  if (deviceLoginAttempted) {
    return { ok: false };
  }

  deviceLoginAttempted = true;

  inFlightAttempt = (async () => {
    try {
      const res = await fetch('/api/auth/device-login', {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (!res.ok) {
        hasDeviceCookieHint = false;
        return { ok: false };
      }
      const data = await res.json().catch(() => null);
      if (data && data.success && data.user) {
        clearExplicitLogout();
        hasDeviceCookieHint = true;
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem('oph_is_authenticated', 'true');
          }
        } catch {}
        return { ok: true, user: data.user as User };
      }
      hasDeviceCookieHint = false;
      return { ok: false };
    } catch {
      return { ok: false };
    } finally {
      inFlightAttempt = null;
    }
  })();

  return inFlightAttempt;
}
