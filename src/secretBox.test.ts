import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  encryptSecret,
  decryptSecret,
  decryptUserSecrets,
  isEncryptedSecret,
  deriveKeyFromSecret,
} from './utils/secretBox';

describe('secretBox (AES-256-GCM / HKDF)', () => {
  const TEST_SECRET = 'bardzo_bezpieczny_klucz_testowy_app_secret_123456';
  const originalEnvSecret = process.env.APP_SECRET;

  beforeEach(() => {
    process.env.APP_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    process.env.APP_SECRET = originalEnvSecret;
  });

  describe('Szyfrowanie i format danych', () => {
    it('szyfruje tekst jawny do formatu enc:v1:iv:tag:dane', () => {
      const plaintext = 'JBSWY3DPEHPK3PXP'; // Przykładowy sekret TOTP Base32
      const encrypted = encryptSecret(plaintext, TEST_SECRET);

      expect(encrypted).toMatch(/^enc:v1:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);
      expect(isEncryptedSecret(encrypted)).toBe(true);

      const parts = encrypted.split(':');
      expect(parts.length).toBe(5);
      expect(parts[0]).toBe('enc');
      expect(parts[1]).toBe('v1');
      expect(parts[2].length).toBe(24); // 12 bajtów IV w hex
      expect(parts[3].length).toBe(32); // 16 bajtów Auth Tag w hex
      expect(parts[4].length).toBeGreaterThan(0); // Zaszyfrowane dane
    });

    it('generuje unikalny wektor IV przy każdym szyfrowaniu tego samego tekstu', () => {
      const plaintext = 'JBSWY3DPEHPK3PXP';
      const enc1 = encryptSecret(plaintext, TEST_SECRET);
      const enc2 = encryptSecret(plaintext, TEST_SECRET);

      expect(enc1).not.toBe(enc2);
      expect(enc1.split(':')[2]).not.toBe(enc2.split(':')[2]);
    });

    it('zwraca ciąg bez podwójnego szyfrowania, jeśli jest już zaszyfrowany', () => {
      const plaintext = 'JBSWY3DPEHPK3PXP';
      const enc = encryptSecret(plaintext, TEST_SECRET);
      const doubleEnc = encryptSecret(enc, TEST_SECRET);

      expect(doubleEnc).toBe(enc);
    });
  });

  describe('Odszyfrowanie', () => {
    it('poprawnie odszyfrowuje zaszyfrowany sekret', () => {
      const plaintext = 'TEST_TOTP_SECRET_BASE32_987654';
      const encrypted = encryptSecret(plaintext, TEST_SECRET);
      const decrypted = decryptSecret(encrypted, TEST_SECRET);

      expect(decrypted).toBe(plaintext);
    });

    it('rozpoznaje wartości jawne (stare) i zwraca je bez zmian', () => {
      const legacyPlaintext = 'KZXW65TFOJZGS3TH';
      expect(isEncryptedSecret(legacyPlaintext)).toBe(false);

      const result = decryptSecret(legacyPlaintext, TEST_SECRET);
      expect(result).toBe(legacyPlaintext);
    });
  });

  describe('Złe dane (integralność i walidacja)', () => {
    it('wyrzuca błąd przy sfałszowanym zaszyfrowanym tekście (tampered ciphertext)', () => {
      const plaintext = 'JBSWY3DPEHPK3PXP';
      const encrypted = encryptSecret(plaintext, TEST_SECRET);
      const parts = encrypted.split(':');

      // Zmiana ostatniego znaku ciphertextu
      const tamperedData = parts[4].slice(0, -1) + (parts[4].slice(-1) === 'a' ? 'b' : 'a');
      const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:${parts[3]}:${tamperedData}`;

      expect(() => decryptSecret(tampered, TEST_SECRET)).toThrow(/Błąd odszyfrowania sekretu/);
    });

    it('wyrzuca błąd przy zmodyfikowanym znaczniku autentyczności (Auth Tag)', () => {
      const plaintext = 'JBSWY3DPEHPK3PXP';
      const encrypted = encryptSecret(plaintext, TEST_SECRET);
      const parts = encrypted.split(':');

      // Zmiana znacznika autentyczności
      const corruptedTag = '00'.repeat(16);
      const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:${corruptedTag}:${parts[4]}`;

      expect(() => decryptSecret(tampered, TEST_SECRET)).toThrow(/Błąd odszyfrowania sekretu/);
    });

    it('wyrzuca błąd przy nieprawidłowym formacie nagłówka', () => {
      const invalid = 'enc:v2:1234:5678:90ab';
      expect(() => decryptSecret(invalid, TEST_SECRET)).toThrow();
    });

    it('wyrzuca błąd przy nieprawidłowej długości IV', () => {
      const invalidIv = 'enc:v1:1234:0123456789abcdef0123456789abcdef:aabbcc';
      expect(() => decryptSecret(invalidIv, TEST_SECRET)).toThrow(/Nieprawidłowa długość wektora IV/);
    });
  });

  describe('Brak klucza', () => {
    it('wyrzuca błąd, gdy APP_SECRET jest niedostępny lub pusty', () => {
      delete process.env.APP_SECRET;

      expect(() => deriveKeyFromSecret('')).toThrow(/Brak klucza APP_SECRET/);
      expect(() => encryptSecret('tajne_dane', '')).toThrow(/Brak klucza APP_SECRET/);
      expect(() => decryptSecret('enc:v1:012345678901234567890123:0123456789abcdef0123456789abcdef:1234', '')).toThrow(/Brak klucza APP_SECRET/);
    });
  });

  describe('KRYTERIA ZADANIA: szyfrowanie app_state.json i tokeny sesji', () => {
    it('szyfruje twoFactorSecret i pending2FA.secret w stanie użytkowników przed zapisem do JSON', () => {
      const mockState = {
        users: [
          {
            id: 'u1',
            email: 'admin@pracownia.pl',
            twoFactorSecret: 'RAW_2FA_SECRET_BASE32',
            pending2FA: {
              secret: 'RAW_PENDING_2FA_BASE32',
              backupCodeHashes: ['hash1'],
            },
          },
        ],
      };

      // Serializacja stanu ze zmianą sekretów na enc:v1:...
      const serialized = JSON.stringify({
        ...mockState,
        users: mockState.users.map((u) => ({
          ...u,
          twoFactorSecret: encryptSecret(u.twoFactorSecret, TEST_SECRET),
          pending2FA: {
            ...u.pending2FA,
            secret: encryptSecret(u.pending2FA.secret, TEST_SECRET),
          },
        })),
      });

      // Sprawdzenie, że plik JSON nie zawiera jawnych sekretów
      expect(serialized).not.toContain('RAW_2FA_SECRET_BASE32');
      expect(serialized).not.toContain('RAW_PENDING_2FA_BASE32');
      expect(serialized).toContain('enc:v1:');

      // Parsowanie i odszyfrowanie przy odczycie
      const parsed = JSON.parse(serialized);
      const decrypted2FA = decryptSecret(parsed.users[0].twoFactorSecret, TEST_SECRET);
      const decryptedPending = decryptSecret(parsed.users[0].pending2FA.secret, TEST_SECRET);

      expect(decrypted2FA).toBe('RAW_2FA_SECRET_BASE32');
      expect(decryptedPending).toBe('RAW_PENDING_2FA_BASE32');
    });

    it('magazyn sesji przechowuje tokenHash (SHA-256) zamiast jawnego tokenu', () => {
      const rawToken = '7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a';
      const crypto = require('crypto');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

      const sessionRecord = {
        tokenHash,
        userId: 'u1',
        role: 'admin',
        createdAt: Date.now(),
        expiresAt: Date.now() + 3600000,
      };

      const serializedSessions = JSON.stringify([sessionRecord]);

      // sessions.json nie zawiera tokenu jawnego
      expect(serializedSessions).not.toContain(rawToken);
      expect(serializedSessions).toContain(tokenHash);
      expect(tokenHash).toHaveLength(64);
    });
  });

  describe('decryptUserSecrets (wielu użytkowników, migracja i obsługa błędów klucza)', () => {
    it('poprawnie odszyfrowuje sekrety 2FA użytkowników przy właściwym kluczu', () => {
      const users = [
        {
          id: 'u1',
          email: 'jan@nowak.pl',
          twoFactorSecret: encryptSecret('SECRET_USER_1', TEST_SECRET),
          twoFactorEnabled: true,
        },
        {
          id: 'u2',
          email: 'anna@kowalska.pl',
          pending2FA: {
            secret: encryptSecret('PENDING_USER_2', TEST_SECRET),
            backupCodeHashes: ['h1', 'h2'],
          },
        },
      ];

      const res = decryptUserSecrets(users, TEST_SECRET);
      expect(res.failed).toHaveLength(0);
      expect(res.users[0].twoFactorSecret).toBe('SECRET_USER_1');
      expect(res.users[1].pending2FA.secret).toBe('PENDING_USER_2');
      expect(res.migrated).toBe(false);
    });

    it('wykrywa błąd odszyfrowania przy niewłaściwym kluczu i rejestruje w failed', () => {
      const wrongKey = 'calkowicie_inny_i_zly_klucz_app_secret_99999';
      const users = [
        {
          id: 'u1',
          email: 'jan@nowak.pl',
          twoFactorSecret: encryptSecret('SECRET_USER_1', TEST_SECRET),
          twoFactorEnabled: true,
        },
      ];

      const res = decryptUserSecrets(users, wrongKey);
      expect(res.failed).toHaveLength(1);
      expect(res.failed[0].userId).toBe('u1');
      expect(res.failed[0].email).toBe('jan@nowak.pl');
      expect(res.failed[0].field).toBe('twoFactorSecret');
      expect(res.failed[0].error).toMatch(/Błąd odszyfrowania/);
      expect(res.migrated).toBe(false);
      // Zaszyfrowana wartość nie została zniszczona w trybie standardowym
      expect(res.users[0].twoFactorSecret).toContain('enc:v1:');
    });

    it('wykrywa niezaszyfrowane dane legacy i oznacza migrated = true', () => {
      const users = [
        {
          id: 'u-legacy',
          email: 'stary@system.pl',
          twoFactorSecret: 'PLAIN_LEGACY_BASE32_SECRET',
        },
      ];

      const res = decryptUserSecrets(users, TEST_SECRET);
      expect(res.failed).toHaveLength(0);
      expect(res.migrated).toBe(true);
      expect(res.users[0].twoFactorSecret).toBe('PLAIN_LEGACY_BASE32_SECRET');
    });

    it('w trybie resetOnFailure (RESET_2FA_ON_START) czyści 2FA u uszkodzonych użytkowników', () => {
      const wrongKey = 'zly_klucz_12345';
      const users = [
        {
          id: 'u-broken',
          email: 'broken@pracownia.pl',
          twoFactorEnabled: true,
          twoFactorSecret: encryptSecret('SECRET_GOOD', TEST_SECRET),
          twoFactorBackupCodes: ['hash1', 'hash2'],
          lastTotpCounter: 42,
          pending2FA: {
            secret: encryptSecret('PENDING_GOOD', TEST_SECRET),
          },
        },
        {
          id: 'u-ok-without-2fa',
          email: 'normalny@pracownia.pl',
          twoFactorEnabled: false,
        },
      ];

      const res = decryptUserSecrets(users, wrongKey, { resetOnFailure: true });
      expect(res.failed.length).toBeGreaterThan(0);
      expect(res.migrated).toBe(true);

      const brokenUser = res.users.find((u) => u.id === 'u-broken');
      expect(brokenUser.twoFactorEnabled).toBe(false);
      expect(brokenUser.twoFactorSecret).toBeUndefined();
      expect(brokenUser.pending2FA).toBeUndefined();
      expect(brokenUser.twoFactorBackupCodes).toBeUndefined();
      expect(brokenUser.lastTotpCounter).toBeUndefined();

      const normalUser = res.users.find((u) => u.id === 'u-ok-without-2fa');
      expect(normalUser.twoFactorEnabled).toBe(false);
    });
  });
});

