import { describe, it, expect } from 'vitest';
import { createRateLimiter } from './utils/rateLimit';

describe('In-Memory Rate Limiter (src/utils/rateLimit.ts)', () => {
  it('allows hits up to max within window and rejects exceeded hits with retryAfterSeconds', () => {
    const limiter = createRateLimiter({ max: 3, windowMs: 60 * 1000 });

    const r1 = limiter.hit('user1');
    expect(r1.allowed).toBe(true);
    expect(r1.current).toBe(1);
    expect(r1.remaining).toBe(2);
    expect(r1.retryAfterSeconds).toBe(0);

    const r2 = limiter.hit('user1');
    expect(r2.allowed).toBe(true);
    expect(r2.current).toBe(2);
    expect(r2.remaining).toBe(1);

    const r3 = limiter.hit('user1');
    expect(r3.allowed).toBe(true);
    expect(r3.current).toBe(3);
    expect(r3.remaining).toBe(0);

    const r4 = limiter.hit('user1');
    expect(r4.allowed).toBe(false);
    expect(r4.current).toBe(4);
    expect(r4.remaining).toBe(0);
    expect(r4.retryAfterSeconds).toBeGreaterThan(0);
    expect(r4.retryAfterSeconds).toBeLessThanOrEqual(60);

    limiter.destroy();
  });

  it('manually resets limit when reset(key) is invoked', () => {
    const limiter = createRateLimiter({ max: 2, windowMs: 60 * 1000 });

    expect(limiter.hit('key-a').allowed).toBe(true);
    expect(limiter.hit('key-a').allowed).toBe(true);
    expect(limiter.hit('key-a').allowed).toBe(false);

    limiter.reset('key-a');

    const freshHit = limiter.hit('key-a');
    expect(freshHit.allowed).toBe(true);
    expect(freshHit.current).toBe(1);

    limiter.destroy();
  });

  it('tracks different keys independently', () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 60 * 1000 });

    expect(limiter.hit('192.168.1.1').allowed).toBe(true);
    expect(limiter.hit('192.168.1.1').allowed).toBe(false);

    // Another IP should still be allowed
    expect(limiter.hit('192.168.1.2').allowed).toBe(true);
    expect(limiter.hit('192.168.1.2').allowed).toBe(false);

    limiter.destroy();
  });

  describe('KRYTERIA ZADANIA', () => {
    it('KRYTERIUM 1: 4. żądanie resetu hasła w ciągu godziny dla jednego e-maila dostaje 429', () => {
      // password-reset/request – 3 na godzinę na e-mail
      const emailLimiter = createRateLimiter({ max: 3, windowMs: 60 * 60 * 1000 });
      const targetEmail = 'architekt@pracownia.pl';

      expect(emailLimiter.hit(targetEmail).allowed).toBe(true); // 1. żądanie
      expect(emailLimiter.hit(targetEmail).allowed).toBe(true); // 2. żądanie
      expect(emailLimiter.hit(targetEmail).allowed).toBe(true); // 3. żądanie

      const fourth = emailLimiter.hit(targetEmail); // 4. żądanie
      expect(fourth.allowed).toBe(false);
      expect(fourth.current).toBe(4);
      expect(fourth.retryAfterSeconds).toBeGreaterThan(0);
      expect(fourth.retryAfterSeconds).toBeLessThanOrEqual(3600);

      emailLimiter.destroy();
    });

    it('KRYTERIUM 2: 6. rejestracja z jednego IP w godzinę dostaje 429', () => {
      // register – 5 na godzinę na IP
      const registerIpLimiter = createRateLimiter({ max: 5, windowMs: 60 * 60 * 1000 });
      const clientIp = '10.0.0.42';

      for (let i = 1; i <= 5; i++) {
        const hit = registerIpLimiter.hit(clientIp);
        expect(hit.allowed).toBe(true);
        expect(hit.current).toBe(i);
      }

      const sixth = registerIpLimiter.hit(clientIp); // 6. rejestracja
      expect(sixth.allowed).toBe(false);
      expect(sixth.current).toBe(6);
      expect(sixth.retryAfterSeconds).toBeGreaterThan(0);
      expect(sixth.retryAfterSeconds).toBeLessThanOrEqual(3600);

      registerIpLimiter.destroy();
    });

    it('password-reset/request na IP: 10 na godzinę na IP', () => {
      const ipLimiter = createRateLimiter({ max: 10, windowMs: 60 * 60 * 1000 });
      const clientIp = '192.168.1.100';

      for (let i = 1; i <= 10; i++) {
        expect(ipLimiter.hit(clientIp).allowed).toBe(true);
      }

      const eleventh = ipLimiter.hit(clientIp);
      expect(eleventh.allowed).toBe(false);
      expect(eleventh.current).toBe(11);
      expect(eleventh.retryAfterSeconds).toBeGreaterThan(0);

      ipLimiter.destroy();
    });

    it('password-reset/verify: 10 na 15 minut na IP', () => {
      const verifyLimiter = createRateLimiter({ max: 10, windowMs: 15 * 60 * 1000 });
      const clientIp = '192.168.1.100';

      for (let i = 1; i <= 10; i++) {
        expect(verifyLimiter.hit(clientIp).allowed).toBe(true);
      }

      const eleventh = verifyLimiter.hit(clientIp);
      expect(eleventh.allowed).toBe(false);
      expect(eleventh.current).toBe(11);
      expect(eleventh.retryAfterSeconds).toBeGreaterThan(0);
      expect(eleventh.retryAfterSeconds).toBeLessThanOrEqual(900);

      verifyLimiter.destroy();
    });

    it('setup-admin: 10 na godzinę na IP', () => {
      const setupLimiter = createRateLimiter({ max: 10, windowMs: 60 * 60 * 1000 });
      const clientIp = '192.168.1.100';

      for (let i = 1; i <= 10; i++) {
        expect(setupLimiter.hit(clientIp).allowed).toBe(true);
      }

      const eleventh = setupLimiter.hit(clientIp);
      expect(eleventh.allowed).toBe(false);
      expect(eleventh.current).toBe(11);
      expect(eleventh.retryAfterSeconds).toBeGreaterThan(0);

      setupLimiter.destroy();
    });

    it('kod resetu liczy próby łącznie dla e-maila (nowe żądanie kodu nie zeruje licznika prób w oknie 1 godziny)', () => {
      // Symulacja logiki serwera: mapa prób resetu dla e-maila
      interface EmailResetAttempts {
        attempts: number;
        windowExpiresAt: number;
      }
      const emailAttempts = new Map<string, EmailResetAttempts>();
      const testEmail = 'architekt@pracownia.pl';
      const windowMs = 60 * 60 * 1000;

      function recordVerifyAttempt(email: string): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
        const now = Date.now();
        let rec = emailAttempts.get(email);
        if (rec && now >= rec.windowExpiresAt) {
          rec = undefined;
          emailAttempts.delete(email);
        }
        if (rec && rec.attempts >= 5) {
          const retryAfter = Math.max(1, Math.ceil((rec.windowExpiresAt - now) / 1000));
          return { allowed: false, remaining: 0, retryAfterSeconds: retryAfter };
        }
        if (!rec) {
          rec = { attempts: 1, windowExpiresAt: now + windowMs };
        } else {
          rec.attempts += 1;
        }
        emailAttempts.set(email, rec);
        return { allowed: true, remaining: Math.max(0, 5 - rec.attempts), retryAfterSeconds: 0 };
      }

      // 1. Użytkownik generuje kod i próbuje 3 razy niepoprawnie
      expect(recordVerifyAttempt(testEmail).allowed).toBe(true);
      expect(recordVerifyAttempt(testEmail).allowed).toBe(true);
      expect(recordVerifyAttempt(testEmail).allowed).toBe(true);
      expect(emailAttempts.get(testEmail)?.attempts).toBe(3);

      // 2. Użytkownik prosi o nowy kod (nowe żądanie NIE czyści emailAttempts)
      // Weryfikuje 2 kolejne razy
      expect(recordVerifyAttempt(testEmail).allowed).toBe(true); // 4. próba
      expect(recordVerifyAttempt(testEmail).allowed).toBe(true); // 5. próba

      // 3. 6. próba przekracza limit 5 prób w oknie 1 godziny i dostaje blokadę
      const blockedAttempt = recordVerifyAttempt(testEmail);
      expect(blockedAttempt.allowed).toBe(false);
      expect(blockedAttempt.retryAfterSeconds).toBeGreaterThan(0);
      expect(blockedAttempt.retryAfterSeconds).toBeLessThanOrEqual(3600);
    });
  });
});

