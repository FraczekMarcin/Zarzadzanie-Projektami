import { describe, it, expect } from 'vitest';
import {
  isSessionExpired,
  toPublicSession,
  computeSessionPublicId,
  parseUserAgent,
  Session,
} from '../utils/sessions';

describe('Zarządzanie sesjami (src/utils/sessions.ts)', () => {
  const secretKey = 'test_app_secret_key_1234567890abcdef';
  const idleMs = 120 * 60 * 1000; // 120 minut (2 godziny)
  const maxMs = 12 * 60 * 60 * 1000; // 12 godzin

  describe('1. isSessionExpired', () => {
    it('zwraca false dla aktywnej sesji w limitach bezczynności i maksymalnego czasu', () => {
      const now = 1700000000000;
      const session: Session = {
        tokenHash: 'hash1',
        userId: 'u1',
        role: 'developer',
        createdAt: now - 30 * 60 * 1000, // 30 min temu
        expiresAt: now + 10 * 60 * 60 * 1000,
        lastSeenAt: now - 5 * 60 * 1000, // 5 min temu
      };

      expect(isSessionExpired(session, now, idleMs, maxMs)).toBe(false);
    });

    it('wygasanie bezwzględne: zwraca true gdy czas od createdAt przekracza maxMs (12h)', () => {
      const now = 1700000000000;
      const session: Session = {
        tokenHash: 'hash2',
        userId: 'u1',
        role: 'developer',
        createdAt: now - (maxMs + 1000), // ponad 12h temu
        expiresAt: now + 60 * 1000,
        lastSeenAt: now - 1000, // aktywna przed chwilą
      };

      expect(isSessionExpired(session, now, idleMs, maxMs)).toBe(true);
    });

    it('wygasanie po bezczynności: zwraca true gdy od lastSeenAt minęło więcej niż idleMs (120 min)', () => {
      const now = 1700000000000;
      const session: Session = {
        tokenHash: 'hash3',
        userId: 'u1',
        role: 'developer',
        createdAt: now - 3 * 60 * 60 * 1000, // utworzona 3h temu (poniżej 12h)
        expiresAt: now + 9 * 60 * 60 * 1000,
        lastSeenAt: now - (idleMs + 1000), // bezczynność ponad 2h
      };

      expect(isSessionExpired(session, now, idleMs, maxMs)).toBe(true);
    });

    it('stare sesje bez lastSeenAt: przyjmuje lastSeenAt = createdAt i wygasa po bezczynności', () => {
      const now = 1700000000000;
      // Stara sesja bez lastSeenAt utworzona 3 godziny temu
      const oldSession = {
        tokenHash: 'hash_old',
        userId: 'u1',
        role: 'developer',
        createdAt: now - 3 * 60 * 60 * 1000, // 3h temu
        expiresAt: now + 9 * 60 * 60 * 1000,
      };

      // Powinna wygasnąć, bo od createdAt (traktowanego jako lastSeenAt) minęły 3h (> 2h bezczynności)
      expect(isSessionExpired(oldSession, now, idleMs, maxMs)).toBe(true);

      // Stara sesja utworzona 30 minut temu – nie wygasa
      const recentOldSession = {
        tokenHash: 'hash_old_recent',
        userId: 'u1',
        role: 'developer',
        createdAt: now - 30 * 60 * 1000, // 30 min temu
        expiresAt: now + 11 * 60 * 60 * 1000,
      };
      expect(isSessionExpired(recentOldSession, now, idleMs, maxMs)).toBe(false);
    });

    it('wygasa natychmiast gdy pole expiresAt jest mniejsze lub równe now', () => {
      const now = 1700000000000;
      const session: Session = {
        tokenHash: 'hash4',
        userId: 'u1',
        role: 'developer',
        createdAt: now - 1000,
        expiresAt: now - 1, // minęło expiresAt
        lastSeenAt: now - 500,
      };

      expect(isSessionExpired(session, now, idleMs, maxMs)).toBe(true);
    });
  });

  describe('2. toPublicSession i computeSessionPublicId', () => {
    it('brak wycieku tokenHash: obiekt publiczny nie zawiera tokenHash ani tajnych danych', () => {
      const session: Session = {
        tokenHash: 'tajny_hash_sha256_abcdef1234567890',
        userId: 'usr-1',
        role: 'developer',
        createdAt: 1700000000000,
        expiresAt: 1700043200000,
        lastSeenAt: 1700001000000,
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        ip: '192.168.1.50',
      };

      const publicSession = toPublicSession(session, 'inny_hash', secretKey);

      expect((publicSession as any).tokenHash).toBeUndefined();
      expect((publicSession as any).token).toBeUndefined();
      expect('tokenHash' in publicSession).toBe(false);
      expect('token' in publicSession).toBe(false);
      expect(publicSession.ip).toBe('192.168.1.50');
      expect(publicSession.userAgent).toBe('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
      expect(publicSession.current).toBe(false);
      expect(publicSession.createdAt).toBe(1700000000000);
      expect(publicSession.lastSeenAt).toBe(1700001000000);
    });

    it('id publiczne ma dokładnie 16 znaków szesnastkowych z HMAC-SHA256', () => {
      const tokenHash = 'super_tajny_hash_tokena';
      const publicId = computeSessionPublicId(tokenHash, secretKey);

      expect(publicId).toHaveLength(16);
      expect(/^[0-9a-f]{16}$/.test(publicId)).toBe(true);

      const session: Session = {
        tokenHash,
        userId: 'usr-2',
        role: 'admin',
        createdAt: 1700000000000,
        expiresAt: 1700043200000,
        lastSeenAt: 1700000500000,
      };

      const pub = toPublicSession(session, tokenHash, secretKey);
      expect(pub.id).toBe(publicId);
      expect(pub.current).toBe(true);
    });

    it('stare sesje bez lastSeenAt zwracają lastSeenAt równe createdAt w obiekcie publicznym', () => {
      const oldSession: any = {
        tokenHash: 'stary_hash_bez_last_seen',
        userId: 'usr-3',
        role: 'viewer',
        createdAt: 1700000000000,
        expiresAt: 1700043200000,
      };

      const pub = toPublicSession(oldSession, null, secretKey);
      expect(pub.lastSeenAt).toBe(1700000000000);
      expect(pub.current).toBe(false);
    });
  });

  describe('3. parseUserAgent', () => {
    it('poprawnie rozpoznaje Chrome na macOS', () => {
      const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
      expect(parseUserAgent(ua)).toBe('Chrome (macOS)');
    });

    it('poprawnie rozpoznaje Firefox na Windows', () => {
      const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0';
      expect(parseUserAgent(ua)).toBe('Firefox (Windows 10/11)');
    });

    it('poprawnie rozpoznaje Safari na iOS', () => {
      const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Mobile/15E148 Safari/604.1';
      expect(parseUserAgent(ua)).toBe('Safari (iOS)');
    });

    it('zwraca domyślny opis przy pustym User-Agent', () => {
      expect(parseUserAgent('')).toBe('Nieznane urządzenie');
      expect(parseUserAgent(undefined)).toBe('Nieznane urządzenie');
    });
  });
});
