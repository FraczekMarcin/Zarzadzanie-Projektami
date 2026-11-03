/**
 * Bezpieczeństwo uwierzytelniania pracowni:
 * - Haszowanie haseł algorytmem SHA-256 z unikalną solą pracowni (wsparcie klienta)
 * - Formatowanie linków otpauth (RFC 6238) dla skanerów aplikacji Google Authenticator
 * - Lokalne generowanie kodów QR w przeglądarce bez żadnych zewnętrznych żądań sieciowych
 * - Bezpieczna sanityzacja użytkowników
 */

import QRCode from 'qrcode';
import { User } from '../types';

const SALT = 'zarzadzanie_projektami_salt_2026';

function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Haszowanie hasła z użyciem Web Crypto API SHA-256
 */
export async function hashPassword(password: string): Promise<string> {
  const trimmed = (password || '').trim();
  if (!trimmed) return '';

  try {
    const salted = `${SALT}:${trimmed}:${SALT}`;
    const encoder = new TextEncoder();
    const data = encoder.encode(salted);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return `sha256:${bufferToHex(hashBuffer)}`;
  } catch {
    return '';
  }
}

/**
 * Weryfikacja hasła użytkownika po stronie klienta (obsługuje hashe SHA-256)
 */
export async function verifyUserPassword(password: string, user: User): Promise<boolean> {
  const trimmed = (password || '').trim();
  if (!trimmed) return false;

  const inputHash = await hashPassword(trimmed);

  if (user.passwordHash) {
    return user.passwordHash === inputHash;
  }

  if (user.password) {
    return user.password === trimmed;
  }

  return false;
}

/**
 * Usuwa jawne hasło i przygotowuje użytkowników przed zapisem w kopii zapasowej
 */
export function sanitizeUsersForBackup(users: User[]): User[] {
  return (users || []).map((u) => {
    const { password, ...safeUser } = u;
    return {
      ...safeUser,
      passwordHash: safeUser.passwordHash || '',
    };
  });
}

/**
 * Generator losowego klucza Base32 (RFC 4648)
 */
export function generate2FASecret(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let secret = '';
  const randomBytes = new Uint8Array(20);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(randomBytes);
  } else {
    for (let i = 0; i < 20; i++) randomBytes[i] = Math.floor(Math.random() * 256);
  }
  for (let i = 0; i < 20; i++) {
    secret += chars[randomBytes[i] % chars.length];
  }
  return secret;
}

/**
 * Formatowanie klucza w czytelne 4-znakowe bloki (np. "JBSW Y3DP EHPK 3PXP")
 */
export function formatSecretKey(secret: string): string {
  return (secret || '').replace(/[\s-]/g, '').replace(/(.{4})/g, '$1 ').trim();
}

/**
 * Generuje w 100% zgodny z RFC 6238 link otpauth dla Google Authenticator
 */
export function getOtpAuthUrl(userEmail: string, secret: string): string {
  const cleanEmail = (userEmail || 'admin@pracownia.pl').trim();
  const issuer = 'Zarzadzanie Projektami';
  const cleanSecret = (secret || '').replace(/[\s-]/g, '').toUpperCase();
  const label = encodeURIComponent(`${issuer}:${cleanEmail}`);
  return `otpauth://totp/${label}?secret=${cleanSecret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/**
 * Generuje kod QR lokalnie w przeglądarce jako Data URL (PNG),
 * bez wysyłania jakichkolwiek zapytań do zewnętrznych serwisów (np. api.qrserver.com).
 */
export async function generateQrCodeDataUrl(text: string, size = 180): Promise<string> {
  try {
    return await QRCode.toDataURL(text, {
      width: size,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
      errorCorrectionLevel: 'M',
    });
  } catch (err) {
    console.error('Błąd lokalnego generowania kodu QR:', err);
    return '';
  }
}
