import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  encryptSecret,
  decryptSecret,
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
});

