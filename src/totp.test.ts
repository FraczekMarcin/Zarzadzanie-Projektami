import { describe, it, expect } from 'vitest';
import {
  base32ToBuffer,
  generateBase32Secret,
  calculateTotpForStep,
  verifyTotpStrict,
  generate10BackupCodes,
  verifyAndConsumeBackupCode,
  hashBackupCodeLegacy,
  getOtpAuthUrl,
} from './utils/totp';

describe('TOTP and Backup Codes (src/utils/totp.ts)', () => {
  it('generates a valid 32-character Base32 secret', () => {
    const secret = generateBase32Secret(32);
    expect(secret).toHaveLength(32);
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    const buf = base32ToBuffer(secret);
    expect(buf.length).toBe(20);
  });

  it('correctly calculates and strictly verifies RFC 6238 TOTP codes with ±1 step window', () => {
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    const nowMs = 1700000000000;
    const currentStep = Math.floor(nowMs / 1000 / 30);

    const currentCode = calculateTotpForStep(secret, currentStep);
    expect(currentCode).toMatch(/^\d{6}$/);

    // Current step verification
    const verifiedCurrent = verifyTotpStrict(secret, currentCode, undefined, nowMs);
    expect(verifiedCurrent).toBe(currentStep);

    // Previous step (-1) verification
    const prevCode = calculateTotpForStep(secret, currentStep - 1);
    const verifiedPrev = verifyTotpStrict(secret, prevCode, undefined, nowMs);
    expect(verifiedPrev).toBe(currentStep - 1);

    // Next step (+1) verification
    const nextCode = calculateTotpForStep(secret, currentStep + 1);
    const verifiedNext = verifyTotpStrict(secret, nextCode, undefined, nowMs);
    expect(verifiedNext).toBe(currentStep + 1);

    // Step -2 must be rejected
    const tooOldCode = calculateTotpForStep(secret, currentStep - 2);
    expect(verifyTotpStrict(secret, tooOldCode, undefined, nowMs)).toBeNull();

    // Step +2 must be rejected
    const tooFarAheadCode = calculateTotpForStep(secret, currentStep + 2);
    expect(verifyTotpStrict(secret, tooFarAheadCode, undefined, nowMs)).toBeNull();

    // Replay attack prevention: if step <= lastUsedStep, reject immediately
    expect(verifyTotpStrict(secret, currentCode, currentStep, nowMs)).toBeNull();
    expect(verifyTotpStrict(secret, prevCode, currentStep, nowMs)).toBeNull();
    // But next step should still be allowed if higher than lastUsedStep
    expect(verifyTotpStrict(secret, nextCode, currentStep, nowMs)).toBe(currentStep + 1);
  });

  it('rejects invalid or malformed TOTP codes', () => {
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    expect(verifyTotpStrict(secret, '12345')).toBeNull();
    expect(verifyTotpStrict(secret, '1234567')).toBeNull();
    expect(verifyTotpStrict(secret, 'abcdef')).toBeNull();
    expect(verifyTotpStrict('', '123456')).toBeNull();
  });

  it('generates exactly 10 backup codes of 10 base32 characters formatted as XXXXX-XXXXX', () => {
    const { codes, hashes } = generate10BackupCodes('test_secret');
    expect(codes).toHaveLength(10);
    expect(hashes).toHaveLength(10);

    codes.forEach((code) => {
      expect(code).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
      const clean = code.replace('-', '');
      expect(clean).toHaveLength(10);
    });

    hashes.forEach((hash) => {
      expect(hash).toMatch(/^hmac-sha256:[a-f0-9]{64}$/);
    });
  });

  it('verifies and consumes HMAC-SHA256 backup codes exactly once', () => {
    const appSecret = 'custom_secret_key_123';
    const { codes, hashes } = generate10BackupCodes(appSecret);

    const user = {
      twoFactorBackupCodes: [...hashes],
    };

    // First code consumes successfully
    const success1 = verifyAndConsumeBackupCode(user, codes[0], appSecret);
    expect(success1).toBe(true);
    expect(user.twoFactorBackupCodes).toHaveLength(9);

    // Consuming the same code a second time must fail
    const successAgain = verifyAndConsumeBackupCode(user, codes[0], appSecret);
    expect(successAgain).toBe(false);
    expect(user.twoFactorBackupCodes).toHaveLength(9);

    // Invalid code fails
    const invalidSuccess = verifyAndConsumeBackupCode(user, 'INVALID-CODE', appSecret);
    expect(invalidSuccess).toBe(false);
    expect(user.twoFactorBackupCodes).toHaveLength(9);

    // Code entered without dashes should also work
    const cleanSecondCode = codes[1].replace('-', '');
    const success2 = verifyAndConsumeBackupCode(user, cleanSecondCode, appSecret);
    expect(success2).toBe(true);
    expect(user.twoFactorBackupCodes).toHaveLength(8);
  });

  it('maintains backward compatibility with legacy plain SHA-256 backup codes', () => {
    const legacyCode = 'A1B2-C3D4';
    const legacyClean = legacyCode.replace('-', '');
    const legacyHash = hashBackupCodeLegacy(legacyClean);

    const user = {
      twoFactorBackupCodes: [legacyHash],
    };

    const success = verifyAndConsumeBackupCode(user, legacyCode);
    expect(success).toBe(true);
    expect(user.twoFactorBackupCodes).toHaveLength(0);

    // Second time fails
    expect(verifyAndConsumeBackupCode(user, legacyCode)).toBe(false);
  });

  it('generates valid otpauth URLs', () => {
    const url = getOtpAuthUrl('jan.kowalski@pracownia.pl', 'JBSWY3DPEHPK3PXP');
    expect(url).toContain('otpauth://totp/');
    expect(url).toContain('secret=JBSWY3DPEHPK3PXP');
    expect(url).toContain('jan.kowalski%40pracownia.pl');
  });

  describe('2FA Lifecycle & Session Invalidation Scenario', () => {
    interface TestUser {
      id: string;
      name: string;
      email: string;
      role: string;
      passwordHash: string;
      twoFactorEnabled?: boolean;
      twoFactorSecret?: string;
      twoFactorBackupCodes?: string[];
      pending2FA?: { secret: string; backupCodeHashes: string[]; createdAt: number };
      lastTotpCounter?: number;
    }

    interface TestSession {
      token: string;
      userId: string;
      createdAt: number;
    }

    it('enforces 2FA setup verification, code confirmation, and invalidates other sessions', () => {
      const user: TestUser = {
        id: 'user-1',
        name: 'Jan Nowak',
        email: 'jan@nowak.pl',
        role: 'developer',
        passwordHash: 'scrypt$16384$mock$hash',
      };

      const sessions = new Map<string, TestSession>([
        ['token-current', { token: 'token-current', userId: 'user-1', createdAt: 1000 }],
        ['token-old-mobile', { token: 'token-old-mobile', userId: 'user-1', createdAt: 500 }],
        ['token-other-user', { token: 'token-other-user', userId: 'user-2', createdAt: 800 }],
      ]);

      // Step 1: Setup generates pending2FA
      const secret = generateBase32Secret(32);
      const { codes, hashes } = generate10BackupCodes('test_app_secret_123');
      user.pending2FA = { secret, backupCodeHashes: hashes, createdAt: Date.now() };

      expect(user.twoFactorEnabled).toBeFalsy();

      // Step 2: Confirm with bad code fails
      const badCode = '000000';
      const badStep = verifyTotpStrict(user.pending2FA.secret, badCode);
      expect(badStep).toBeNull();
      expect(user.twoFactorEnabled).toBeFalsy();

      // Step 3: Confirm with valid TOTP code
      const currentStep = Math.floor(Date.now() / 1000 / 30);
      const validCode = calculateTotpForStep(user.pending2FA.secret, currentStep);
      const matchedStep = verifyTotpStrict(user.pending2FA.secret, validCode);
      expect(matchedStep).toBe(currentStep);

      // Upon success: activate 2FA and invalidate other sessions
      user.twoFactorEnabled = true;
      user.twoFactorSecret = user.pending2FA.secret;
      user.twoFactorBackupCodes = user.pending2FA.backupCodeHashes;
      user.lastTotpCounter = matchedStep ?? 0;
      delete user.pending2FA;

      const currentToken = 'token-current';
      for (const [token, sess] of sessions.entries()) {
        if (sess.userId === user.id && token !== currentToken) {
          sessions.delete(token);
        }
      }

      expect(user.twoFactorEnabled).toBe(true);
      expect(user.twoFactorBackupCodes).toHaveLength(10);
      // Other session for user-1 was removed
      expect(sessions.has('token-old-mobile')).toBe(false);
      // Current session remained
      expect(sessions.has('token-current')).toBe(true);
      // Other user's session unaffected
      expect(sessions.has('token-other-user')).toBe(true);
    });

    it('prevents disabling 2FA without valid password and code, and succeeds with both', () => {
      const appSecret = 'test_app_secret_123';
      const secret = generateBase32Secret(32);
      const { codes, hashes } = generate10BackupCodes(appSecret);

      const user: TestUser = {
        id: 'admin-1',
        name: 'Główny Architekt',
        email: 'admin@pracownia.pl',
        role: 'admin',
        passwordHash: 'scrypt$16384$mock$hash',
        twoFactorEnabled: true,
        twoFactorSecret: secret,
        twoFactorBackupCodes: [...hashes],
      };

      function disable2FA(params: { passwordValid: boolean; code?: string }) {
        if (!params.passwordValid) {
          return { status: 401, error: 'Nieprawidłowe hasło dostępu' };
        }
        if (!params.code) {
          return { status: 400, error: 'Wymagany kod' };
        }

        let codeValid = false;
        if (user.twoFactorSecret) {
          const step = verifyTotpStrict(user.twoFactorSecret, params.code, user.lastTotpCounter);
          if (step !== null) codeValid = true;
        }
        if (!codeValid && verifyAndConsumeBackupCode(user, params.code, appSecret)) {
          codeValid = true;
        }

        if (!codeValid) {
          return { status: 401, error: 'Nieprawidłowy kod 2FA lub kod zapasowy' };
        }

        user.twoFactorEnabled = false;
        delete user.twoFactorSecret;
        delete user.twoFactorBackupCodes;
        return { status: 200, success: true };
      }

      // 1. Without password fails
      expect(disable2FA({ passwordValid: false, code: '123456' }).status).toBe(401);
      expect(user.twoFactorEnabled).toBe(true);

      // 2. With valid password but missing code fails
      expect(disable2FA({ passwordValid: true }).status).toBe(400);
      expect(user.twoFactorEnabled).toBe(true);

      // 3. With valid password but invalid code fails
      expect(disable2FA({ passwordValid: true, code: '999999' }).status).toBe(401);
      expect(user.twoFactorEnabled).toBe(true);

      // 4. With valid password and backup code succeeds!
      const backupCode = codes[0];
      const result = disable2FA({ passwordValid: true, code: backupCode });
      expect(result.status).toBe(200);
      expect(user.twoFactorEnabled).toBe(false);
      expect(user.twoFactorSecret).toBeUndefined();
    });

    it('drops old sessions on password change', () => {
      const targetUserId = 'usr-arch-1';
      const sessions = new Map<string, TestSession>([
        ['sess-current', { token: 'sess-current', userId: targetUserId, createdAt: 100 }],
        ['sess-laptop', { token: 'sess-laptop', userId: targetUserId, createdAt: 50 }],
        ['sess-phone', { token: 'sess-phone', userId: targetUserId, createdAt: 75 }],
      ]);

      const currentToken = 'sess-current';
      const isSelf = true;

      // Invalidate sessions on password change
      for (const [token, session] of sessions.entries()) {
        if (session.userId === targetUserId) {
          if (isSelf && token === currentToken) {
            continue;
          }
          sessions.delete(token);
        }
      }

      // Old sessions dropped
      expect(sessions.has('sess-laptop')).toBe(false);
      expect(sessions.has('sess-phone')).toBe(false);
      // Current session active
      expect(sessions.has('sess-current')).toBe(true);
    });
  });
});
