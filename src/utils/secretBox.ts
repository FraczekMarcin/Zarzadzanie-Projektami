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
