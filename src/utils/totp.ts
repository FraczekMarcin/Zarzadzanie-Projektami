import crypto from 'crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Dekoder Base32 zgodny z RFC 4648.
 */
export function base32ToBuffer(base32: string): Buffer {
  const clean = (base32 || '').toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < clean.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(clean[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
      value = value & ((1 << bits) - 1);
    }
  }
  return Buffer.from(bytes);
}

/**
 * Generator losowego klucza Base32 (domyślnie 32 znaki Base32 = 160 bitów entropii).
 */
export function generateBase32Secret(charLength = 32): string {
  const randomBytes = crypto.randomBytes(charLength);
  let result = '';
  for (let i = 0; i < randomBytes.length; i++) {
    result += BASE32_ALPHABET[randomBytes[i] % BASE32_ALPHABET.length];
  }
  return result;
}

/**
 * Klucz wyprowadzony z APP_SECRET dla HMAC-SHA256 kodów zapasowych.
 * Wymaga jawnego przekazania niepustego appSecret (brak fallbacków).
 */
export function getHmacKey(appSecret?: string): Buffer {
  const secret = appSecret || (typeof process !== 'undefined' ? process.env?.APP_SECRET : undefined);
  if (!secret || typeof secret !== 'string' || !secret.trim()) {
    throw new Error('Brak klucza APP_SECRET: operacje na kodach zapasowych wymagają aktywnego klucza aplikacji');
  }
  return crypto.createHash('sha256').update(secret.trim()).digest();
}

/**
 * Haszowanie kodu zapasowego za pomocą HMAC-SHA256 z kluczem z APP_SECRET.
 */
export function hashBackupCodeHmac(code: string, appSecret?: string): string {
  const clean = (code || '').replace(/[\s-]/g, '').toUpperCase().trim();
  const key = getHmacKey(appSecret);
  const hmacHex = crypto.createHmac('sha256', key).update(clean).digest('hex');
  return `hmac-sha256:${hmacHex}`;
}

/**
 * Haszowanie kodu zapasowego za pomocą zwykłego SHA-256 (format legacy / kompatybilność).
 */
export function hashBackupCodeLegacy(code: string): string {
  const clean = (code || '').replace(/[\s-]/g, '').toUpperCase().trim();
  return crypto.createHash('sha256').update(clean).digest('hex');
}

/**
 * Generowanie 10 jednorazowych kodów zapasowych (10 znaków base32, ok. 50 bitów).
 * Zwraca czytelne kody w formacie XXXXX-XXXXX oraz hashe HMAC-SHA256.
 */
export function generate10BackupCodes(appSecret?: string): { codes: string[]; hashes: string[] } {
  const codes: string[] = [];
  const hashes: string[] = [];

  for (let i = 0; i < 10; i++) {
    let raw = '';
    const randomBytes = crypto.randomBytes(10);
    for (let j = 0; j < 10; j++) {
      raw += BASE32_ALPHABET[randomBytes[j] % BASE32_ALPHABET.length];
    }
    const formatted = `${raw.slice(0, 5)}-${raw.slice(5)}`;
    codes.push(formatted);
    hashes.push(hashBackupCodeHmac(raw, appSecret));
  }

  return { codes, hashes };
}

/**
 * Obliczenie 6-cyfrowego kodu TOTP dla danego kroku czasowego (RFC 6238, HMAC-SHA1).
 */
export function calculateTotpForStep(secretBase32: string, step: number): string {
  const key = base32ToBuffer(secretBase32);
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(step));

  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const hmacOffset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[hmacOffset] & 0x7f) << 24) |
    ((hmac[hmacOffset + 1] & 0xff) << 16) |
    ((hmac[hmacOffset + 2] & 0xff) << 8) |
    (hmac[hmacOffset + 3] & 0xff);

  return (binary % 1000000).toString().padStart(6, '0');
}

/**
 * Weryfikacja kodu TOTP na serwerze (RFC 6238, HMAC-SHA1).
 * Okno tolerancji: wyłącznie ±1 krok (30 s w tył, bieżący, 30 s w przód).
 * Ochrona przed replay attack: kod dla kroku <= lastUsedStep jest natychmiast odrzucany.
 * Zwraca numer dopasowanego kroku lub null.
 */
export function verifyTotpStrict(
  secretBase32: string,
  enteredCode: string,
  lastUsedStep?: number,
  nowMs = Date.now()
): number | null {
  if (!secretBase32 || !enteredCode) return null;
  const cleanCode = enteredCode.replace(/[\s-]/g, '').trim();
  if (!/^\d{6}$/.test(cleanCode)) return null;

  const key = base32ToBuffer(secretBase32);
  if (key.length === 0) return null;

  const epoch = Math.floor(nowMs / 1000);
  const currentStep = Math.floor(epoch / 30);

  // Okno ściśle ±1 (kroki: currentStep - 1, currentStep, currentStep + 1)
  for (let offset = -1; offset <= 1; offset++) {
    const step = currentStep + offset;
    // Ochrona przed ponownym użyciem tego samego kodu
    if (typeof lastUsedStep === 'number' && step <= lastUsedStep) {
      continue;
    }
    const expectedOtp = calculateTotpForStep(secretBase32, step);
    if (
      cleanCode.length === expectedOtp.length &&
      crypto.timingSafeEqual(Buffer.from(cleanCode), Buffer.from(expectedOtp))
    ) {
      return step;
    }
  }

  return null;
}

/**
 * Weryfikacja i unieważnienie jednorazowego kodu zapasowego.
 * Obsługuje zarówno nowy format (HMAC-SHA256 z APP_SECRET),
 * jak i dotychczasowy legacy format (zwykły SHA-256) dla wstecznej kompatybilności.
 */
export function verifyAndConsumeBackupCode(
  user: { twoFactorBackupCodes?: string[] } | null | undefined,
  enteredCode: string,
  appSecret?: string
): boolean {
  if (!user || !Array.isArray(user.twoFactorBackupCodes) || user.twoFactorBackupCodes.length === 0) {
    return false;
  }
  const cleanCode = (enteredCode || '').replace(/[\s-]/g, '').toUpperCase().trim();
  if (cleanCode.length < 6) return false;

  let candidateHmac: string | null = null;
  let candidateHmacRaw: string | null = null;
  try {
    candidateHmac = hashBackupCodeHmac(cleanCode, appSecret);
    candidateHmacRaw = candidateHmac.replace('hmac-sha256:', '');
  } catch {
    // Brak appSecret uniemożliwia weryfikację kodów HMAC, ale legacy SHA-256 nadal może być sprawdzony
  }
  const candidateLegacy = hashBackupCodeLegacy(cleanCode);

  const idx = user.twoFactorBackupCodes.findIndex((storedHash: string) => {
    try {
      if (typeof storedHash !== 'string') return false;

      // 1. Nowy format: 'hmac-sha256:<hex>'
      if (storedHash.startsWith('hmac-sha256:')) {
        if (!candidateHmac) return false;
        return (
          crypto.timingSafeEqual(Buffer.from(storedHash), Buffer.from(candidateHmac))
        );
      }

      // 2. Bez prefiksu ale o długości 64 (może być raw hmac lub legacy sha256)
      if (storedHash.length === 64) {
        if (candidateHmacRaw && crypto.timingSafeEqual(Buffer.from(storedHash), Buffer.from(candidateHmacRaw))) {
          return true;
        }
        if (crypto.timingSafeEqual(Buffer.from(storedHash), Buffer.from(candidateLegacy))) {
          return true;
        }
      }

      return false;
    } catch {
      return false;
    }
  });

  if (idx !== -1) {
    // Usunięcie zużytego kodu zapasowego (jednorazowy użytek)
    user.twoFactorBackupCodes.splice(idx, 1);
    return true;
  }

  return false;
}

/**
 * Link otpauth zgodny z RFC 6238 dla Google Authenticator
 */
export function getOtpAuthUrl(
  email: string,
  secret: string,
  issuer = 'Zarzadzanie Projektami'
): string {
  const cleanEmail = (email || 'admin@pracownia.pl').trim().toLowerCase();
  const cleanSecret = (secret || '').replace(/[\s-]/g, '').toUpperCase();
  const label = encodeURIComponent(`${issuer}:${cleanEmail}`);
  return `otpauth://totp/${label}?secret=${cleanSecret}&issuer=${encodeURIComponent(
    issuer
  )}&algorithm=SHA1&digits=6&period=30`;
}
