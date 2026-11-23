import { describe, it, expect } from 'vitest';
import {
  DEEP_LINK_MAX_AGE_MS,
  DEEP_LINK_STORAGE_KEY,
  buildUrlWithoutDeepLinkParams,
  clearPendingDeepLink,
  isValidDeepLinkId,
  parseDeepLink,
  readPendingDeepLink,
  savePendingDeepLink,
} from '../utils/deepLink.js';

function createMemoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    dump: () => map,
  };
}

describe('parseDeepLink & isValidDeepLinkId (src/utils/deepLink.ts)', () => {
  it('parsuje poprawne parametry ?task=<id> oraz ?project=<id>', () => {
    expect(parseDeepLink('?task=tsk-1700000000')).toEqual({
      type: 'task',
      id: 'tsk-1700000000',
    });
    expect(parseDeepLink('task=tsk_alpha-01')).toEqual({
      type: 'task',
      id: 'tsk_alpha-01',
    });
    expect(parseDeepLink('?project=prj-2026-01')).toEqual({
      type: 'project',
      id: 'prj-2026-01',
    });
    expect(parseDeepLink('?utm_source=mail&task=tsk-42&view=list')).toEqual({
      type: 'task',
      id: 'tsk-42',
    });
  });

  it('ignoruje brakujące, puste i powtórzone parametry', () => {
    expect(parseDeepLink('')).toBeNull();
    expect(parseDeepLink('?')).toBeNull();
    expect(parseDeepLink(null)).toBeNull();
    expect(parseDeepLink(undefined)).toBeNull();
    expect(parseDeepLink('?foo=bar')).toBeNull();
    expect(parseDeepLink('?task=')).toBeNull();
    expect(parseDeepLink('?project=')).toBeNull();
    expect(parseDeepLink('?task=tsk-1&task=tsk-2')).toBeNull();
    expect(parseDeepLink('?project=prj-1&project=prj-2')).toBeNull();
  });

  it('odrzuca śmieci, białe znaki, klucze prototypu oraz próby wstrzyknięcia', () => {
    const maliciousInputs = [
      '<script>alert(1)</script>',
      '../../etc/passwd',
      'tsk-1;DROP TABLE',
      'javascript:alert(1)',
      ' tsk-123',
      'tsk-123 ',
      '-starts-with-dash',
      '_starts_with_underscore',
      'a', // za krótkie (min 2 znaki)
      'a'.repeat(81), // za długie (> 80 znaków)
      '__proto__',
      'constructor',
      'prototype',
    ];

    for (const payload of maliciousInputs) {
      expect(isValidDeepLinkId(payload)).toBe(false);
      expect(parseDeepLink(`?task=${encodeURIComponent(payload)}`)).toBeNull();
      expect(parseDeepLink(`?project=${encodeURIComponent(payload)}`)).toBeNull();
    }
  });
});

describe('sessionStorage TTL dla oczekującego deep linka (10 minut)', () => {
  it('zapisuje, odczytuje w oknie 10 minut i automatycznie usuwa po wygaśnięciu', () => {
    const storage = createMemoryStorage();
    const baseTime = 1_700_000_000_000;

    savePendingDeepLink({ type: 'task', id: 'tsk-999' }, baseTime, storage);
    expect(storage.getItem(DEEP_LINK_STORAGE_KEY)).toBeTruthy();

    expect(readPendingDeepLink(baseTime + DEEP_LINK_MAX_AGE_MS - 1000, storage)).toEqual({
      type: 'task',
      id: 'tsk-999',
    });

    // Po 10 minutach i 1 ms wygasa i jest czyszczony
    expect(readPendingDeepLink(baseTime + DEEP_LINK_MAX_AGE_MS + 1, storage)).toBeNull();
    expect(storage.getItem(DEEP_LINK_STORAGE_KEY)).toBeNull();
  });

  it('usuwa uszkodzone lub nieprawidłowe wpisy w sessionStorage i obsługuje clearPendingDeepLink', () => {
    const storage = createMemoryStorage();
    storage.setItem(DEEP_LINK_STORAGE_KEY, '{bad-json');
    expect(readPendingDeepLink(Date.now(), storage)).toBeNull();
    expect(storage.getItem(DEEP_LINK_STORAGE_KEY)).toBeNull();

    storage.setItem(
      DEEP_LINK_STORAGE_KEY,
      JSON.stringify({ type: 'task', id: '<script>', storedAt: Date.now() })
    );
    expect(readPendingDeepLink(Date.now(), storage)).toBeNull();
    expect(storage.getItem(DEEP_LINK_STORAGE_KEY)).toBeNull();

    savePendingDeepLink({ type: 'project', id: 'prj-77' }, Date.now(), storage);
    clearPendingDeepLink(storage);
    expect(storage.getItem(DEEP_LINK_STORAGE_KEY)).toBeNull();
  });

  it('usuwa parametry ?task, ?project oraz ?view=economy/?view=tenders z URL zachowując pozostałe parametry', () => {
    expect(parseDeepLink('?view=tenders')).toEqual({ type: 'view', id: 'tenders' });
    expect(parseDeepLink('?view=economy')).toEqual({ type: 'view', id: 'economy' });
    expect(buildUrlWithoutDeepLinkParams('http://localhost:3000/?task=tsk-1')).toBe('/');
    expect(buildUrlWithoutDeepLinkParams('http://localhost:3000/?view=tenders')).toBe('/');
    expect(buildUrlWithoutDeepLinkParams('http://localhost:3000/app?foo=1&task=tsk-1&project=prj-2#sec')).toBe(
      '/app?foo=1#sec'
    );
  });
});
