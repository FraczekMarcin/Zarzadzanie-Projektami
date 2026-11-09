import crypto from 'crypto';

const SALT = 'zp_secret_box_salt_v1';
const INFO = 'aes-256-gcm-key';
const ALGORITHM = 'aes-256-gcm';

/**
 * Wyprowadza 32-bajtowy klucz szyfrowania AES-256 z APP_SECRET za pomocą HKDF-SHA256.
 */
export function deriveKeyFromSecret(secret?: string): Buffer {
  const cleanSecret = secret ?? (typeof process !== 'undefined' ? process.env?.APP_SECRET : undefined);
  if (!cleanSecret || typeof cleanSecret !== 'string' || cleanSecret.trim() === '') {
    throw new Error('Brak klucza APP_SECRET: klucz jest wymagany do operacji kryptograficznych');
  }
  return Buffer.from(crypto.hkdfSync('sha256', cleanSecret.trim(), SALT, INFO, 32));
}

/**
 * Sprawdza, czy dana wartość jest już zaszyfrowana w formacie enc:v1:iv:tag:dane.
 */
export function isEncryptedSecret(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return value.startsWith('enc:v1:');
}

/**
 * Szyfruje jawny tekst algorytmem AES-256-GCM.
 * Format wyjściowy: enc:v1:iv:tag:dane (wartości w zapisie hex).
 */
export function encryptSecret(plaintext: string, secret?: string): string {
  if (typeof plaintext !== 'string') {
    throw new Error('Dane do zaszyfrowania muszą być ciągiem znaków');
  }
  if (isEncryptedSecret(plaintext)) {
    return plaintext;
  }

  const key = deriveKeyFromSecret(secret);
  const iv = crypto.randomBytes(12); // 96-bitowy wektor IV zalecany dla GCM
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `enc:v1:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Odszyfrowuje ciąg znaków w formacie enc:v1:iv:tag:dane.
 * Jeśli ciąg nie zaczyna się od "enc:" (stare dane jawne), zwraca go bez zmian.
 */
export function decryptSecret(cipherText: string, secret?: string): string {
  if (typeof cipherText !== 'string') {
    throw new Error('Zaszyfrowane dane muszą być ciągiem znaków');
  }

  // Jeśli ciąg zaczyna się od prefiksu "enc:", podlega ścisłej walidacji i odszyfrowaniu
  if (cipherText.startsWith('enc:')) {
    const parts = cipherText.split(':');
    if (parts.length !== 5 || parts[0] !== 'enc' || parts[1] !== 'v1') {
      throw new Error('Nieprawidłowy format zaszyfrowanych danych (wymagany enc:v1:iv:tag:dane)');
    }

    const ivHex = parts[2];
    const tagHex = parts[3];
    const dataHex = parts[4];

    if (ivHex.length !== 24) {
      throw new Error('Nieprawidłowa długość wektora IV');
    }
    if (tagHex.length !== 32) {
      throw new Error('Nieprawidłowa długość znacznika autentyczności (Auth Tag)');
    }

    const key = deriveKeyFromSecret(secret);
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const ciphertext = Buffer.from(dataHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    try {
      const decrypted = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);
      return decrypted.toString('utf8');
    } catch {
      throw new Error('Błąd odszyfrowania sekretu: nieprawidłowy klucz lub naruszona integralność danych');
    }
  }

  // Wsteczna kompatybilność: odczyt rozpoznaje wartości jawne (stare)
  return cipherText;
}

export interface FailedUserSecret {
  userId: string;
  email: string;
  field: 'twoFactorSecret' | 'pending2FA';
  error: string;
}

export interface DecryptUserSecretsOptions {
  resetOnFailure?: boolean;
}

export interface DecryptUserSecretsResult {
  users: any[];
  failed: FailedUserSecret[];
  migrated: boolean;
}

/**
 * Czysta funkcja do deszyfrowania sekretów 2FA (twoFactorSecret oraz pending2FA.secret) użytkowników.
 * - Wykrywa stare niezaszyfrowane sekrety i oznacza migrated = true.
 * - Jeśli odszyfrowanie się nie powiedzie, rejestruje wpis w failed.
 * - Gdy options.resetOnFailure === true, u uszkodzonych użytkowników czyści pola 2FA
 *   (twoFactorSecret, pending2FA, twoFactorBackupCodes, lastTotpCounter, twoFactorEnabled = false)
 *   i oznacza migrated = true.
 */
export function decryptUserSecrets(
  users: any[],
  secret?: string,
  options?: DecryptUserSecretsOptions
): DecryptUserSecretsResult {
  const resultUsers: any[] = [];
  const failed: FailedUserSecret[] = [];
  let migrated = false;

  for (const rawUser of users || []) {
    const u = { ...rawUser };
    let userHasFailure = false;

    // 1. twoFactorSecret
    if (u.twoFactorSecret && typeof u.twoFactorSecret === 'string') {
      if (!isEncryptedSecret(u.twoFactorSecret)) {
        migrated = true;
      } else {
        try {
          u.twoFactorSecret = decryptSecret(u.twoFactorSecret, secret);
        } catch (err: any) {
          userHasFailure = true;
          failed.push({
            userId: u.id || '',
            email: u.email || '',
            field: 'twoFactorSecret',
            error: err?.message || 'Błąd odszyfrowania twoFactorSecret',
          });
        }
      }
    }

    // 2. pending2FA.secret
    if (u.pending2FA && typeof u.pending2FA.secret === 'string') {
      if (!isEncryptedSecret(u.pending2FA.secret)) {
        migrated = true;
      } else {
        try {
          u.pending2FA = {
            ...u.pending2FA,
            secret: decryptSecret(u.pending2FA.secret, secret),
          };
        } catch (err: any) {
          userHasFailure = true;
          failed.push({
            userId: u.id || '',
            email: u.email || '',
            field: 'pending2FA',
            error: err?.message || 'Błąd odszyfrowania pending2FA.secret',
          });
        }
      }
    }

    // Obsługa RESET_2FA_ON_START
    if (userHasFailure && options?.resetOnFailure) {
      delete u.twoFactorSecret;
      delete u.pending2FA;
      delete u.twoFactorBackupCodes;
      delete u.lastTotpCounter;
      u.twoFactorEnabled = false;
      migrated = true;
    }

    resultUsers.push(u);
  }

  return {
    users: resultUsers,
    failed,
    migrated,
  };
}

export interface AppSecretValidationResult {
  ok: boolean;
  reason?: string;
}

export const FORBIDDEN_SECRET_PREFIXES = [
  'wygeneruj',
  'changeme',
  'zmien',
  'zmień',
  'example',
  'secret',
];

export const FORBIDDEN_EXACT_SECRETS = [
  'sekretna-fraza-szyfrowania-zarzadzanie-projektami-2026',
  'wygeneruj_unikalny_losowy_ciag_znakow_min_32_znaki_np_openssl_rand_hex_32',
  'wygeneruj_unikalny_ciag_znakow_dla_tokenow_bezpieczenstwa_2026',
];

/**
 * Czysta funkcja walidująca poprawność klucza APP_SECRET.
 * W produkcji odrzuca klucze krótsze niż 32 znaki oraz wartości-przykłady.
 */
export function validateAppSecret(
  value: unknown,
  isProduction: boolean = true
): AppSecretValidationResult {
  if (!isProduction) {
    return { ok: true };
  }

  if (value === undefined || value === null || typeof value !== 'string') {
    return {
      ok: false,
      reason: 'Brak klucza APP_SECRET (wartość jest niezdefiniowana)',
    };
  }

  const clean = value.trim();
  if (clean.length === 0) {
    return {
      ok: false,
      reason: 'Klucz APP_SECRET nie może być pusty',
    };
  }

  if (clean.length < 32) {
    return {
      ok: false,
      reason: `Klucz APP_SECRET jest zbyt krótki (${clean.length} znaków; wymagane minimum 32 znaki)`,
    };
  }

  const lower = clean.toLowerCase();
  for (const prefix of FORBIDDEN_SECRET_PREFIXES) {
    if (lower.startsWith(prefix)) {
      return {
        ok: false,
        reason: `Klucz APP_SECRET nie może być wartością przykładową (zaczyna się od "${prefix}")`,
      };
    }
  }

  for (const forbidden of FORBIDDEN_EXACT_SECRETS) {
    if (clean === forbidden || lower === forbidden.toLowerCase()) {
      return {
        ok: false,
        reason: 'Klucz APP_SECRET jest domyślną wartością przykładową z konfiguracji referencyjnej',
      };
    }
  }

  return { ok: true };
}
