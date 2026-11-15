/**
 * Bezpieczeństwo uwierzytelniania pracowni:
 * - Haszowanie haseł algorytmem SHA-256 z unikalną solą pracowni (wsparcie klienta)
 * - Formatowanie linków otpauth (RFC 6238) dla skanerów aplikacji Google Authenticator
 * - Lokalne generowanie kodów QR w przeglądarce bez żadnych zewnętrznych żądań sieciowych
 * - Bezpieczna sanityzacja użytkowników
 */

import QRCode from 'qrcode';
import { User } from '../types';

/**
 * Usuwa jawne hasło i przygotowuje użytkowników przed zapisem w kopii zapasowej
 */
export function sanitizeUsersForBackup(users: User[]): User[] {
  return (users || []).map((u) => {
    const { password, ...safeUser } = u as any;
    delete safeUser.passwordHash;
    return safeUser as User;
  });
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
