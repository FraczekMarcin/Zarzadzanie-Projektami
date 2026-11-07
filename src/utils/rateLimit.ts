export interface RateLimiterOptions {
  max: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  current: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export interface RateLimiter {
  hit: (key: string) => RateLimitResult;
  reset: (key: string) => void;
  get: (key: string) => RateLimitResult;
  destroy: () => void;
}

/**
 * Czysta funkcja tworząca ogranicznik liczby żądań (rate limiter) w pamięci.
 * - Mapa w pamięci
 * - Metody: hit(key), reset(key), get(key)
 * - Automatyczne czyszczenie wygasłych wpisów co kilka minut (setInterval z unref())
 */
export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const { max, windowMs } = options;
  const store = new Map<string, RateLimitEntry>();

  // Automatyczne czyszczenie wygasłych wpisów co 2 minuty
  const interval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
      if (now >= entry.resetAt) {
        store.delete(key);
      }
    }
  }, 2 * 60 * 1000);

  // unref() zapobiega blokowaniu zakończenia procesu Node.js
  if (typeof interval.unref === 'function') {
    interval.unref();
  }

  function hit(key: string): RateLimitResult {
    const now = Date.now();
    const cleanKey = String(key || '').trim().toLowerCase();
    let entry = store.get(cleanKey);

    if (!entry || now >= entry.resetAt) {
      entry = {
        count: 1,
        resetAt: now + windowMs,
      };
      store.set(cleanKey, entry);
      return {
        allowed: true,
        current: 1,
        remaining: Math.max(0, max - 1),
        resetAt: entry.resetAt,
        retryAfterSeconds: 0,
      };
    }

    entry.count += 1;
    const allowed = entry.count <= max;
    const retryAfterSeconds = allowed ? 0 : Math.max(1, Math.ceil((entry.resetAt - now) / 1000));

    return {
      allowed,
      current: entry.count,
      remaining: Math.max(0, max - entry.count),
      resetAt: entry.resetAt,
      retryAfterSeconds,
    };
  }

  function get(key: string): RateLimitResult {
    const now = Date.now();
    const cleanKey = String(key || '').trim().toLowerCase();
    const entry = store.get(cleanKey);

    if (!entry || now >= entry.resetAt) {
      return {
        allowed: true,
        current: 0,
        remaining: max,
        resetAt: now + windowMs,
        retryAfterSeconds: 0,
      };
    }

    const allowed = entry.count <= max;
    const retryAfterSeconds = allowed ? 0 : Math.max(1, Math.ceil((entry.resetAt - now) / 1000));

    return {
      allowed,
      current: entry.count,
      remaining: Math.max(0, max - entry.count),
      resetAt: entry.resetAt,
      retryAfterSeconds,
    };
  }

  function reset(key: string): void {
    const cleanKey = String(key || '').trim().toLowerCase();
    store.delete(cleanKey);
  }

  function destroy(): void {
    clearInterval(interval);
    store.clear();
  }

  return {
    hit,
    reset,
    get,
    destroy,
  };
}
