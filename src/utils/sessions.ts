import crypto from 'crypto';

export interface Session {
  tokenHash: string;
  userId: string;
  role: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
  userAgent?: string;
  ip?: string;
}

export interface PublicSession {
  id: string; // pierwsze 16 znaków HMAC-SHA256(tokenHash, APP_SECRET)
  userAgent?: string;
  ip?: string;
  createdAt: number;
  lastSeenAt: number;
  current: boolean;
}

/**
 * Oblicza publiczny identyfikator sesji: pierwsze 16 znaków HMAC-SHA256 z tokenHash i klucza serwera.
 * Nigdy nie ujawnia tokenHash ani oryginalnego tokena.
 */
export function computeSessionPublicId(tokenHash: string, key: string): string {
  if (!tokenHash || !key) return '';
  return crypto.createHmac('sha256', key).update(tokenHash).digest('hex').slice(0, 16);
}

/**
 * Sprawdza czy sesja wygasła ze względu na:
 * 1. Bezwzględny maksymalny czas trwania (maxMs) od createdAt (lub pole expiresAt)
 * 2. Brak aktywności / bezczynność (idleMs) od lastSeenAt (lub createdAt, jeśli lastSeenAt brak)
 */
export function isSessionExpired(
  session: { createdAt: number; expiresAt?: number; lastSeenAt?: number },
  now: number,
  idleMs: number,
  maxMs: number
): boolean {
  if (!session) return true;

  // 1. Wygasanie bezwzględne
  if (now - session.createdAt >= maxMs) {
    return true;
  }
  if (typeof session.expiresAt === 'number' && now >= session.expiresAt) {
    return true;
  }

  // 2. Wygasanie po bezczynności (stare sesje bez lastSeenAt traktują lastSeenAt = createdAt)
  const effectiveLastSeen = typeof session.lastSeenAt === 'number' ? session.lastSeenAt : session.createdAt;
  if (now - effectiveLastSeen >= idleMs) {
    return true;
  }

  return false;
}

/**
 * Mapuje wewnętrzną sesję serwera do bezpiecznego obiektu publicznego bez tokenHash.
 */
export function toPublicSession(
  session: Session,
  currentHash: string | null | undefined,
  key: string
): PublicSession {
  const publicId = computeSessionPublicId(session.tokenHash, key);
  const effectiveLastSeen = typeof session.lastSeenAt === 'number' ? session.lastSeenAt : session.createdAt;

  return {
    id: publicId,
    userAgent: session.userAgent,
    ip: session.ip,
    createdAt: session.createdAt,
    lastSeenAt: effectiveLastSeen,
    current: Boolean(currentHash && session.tokenHash === currentHash),
  };
}

/**
 * Formatuje nagłówek User-Agent do skróconego, czytelnego formatu "Przeglądarka / System operacyjny".
 */
export function parseUserAgent(ua?: string): string {
  if (!ua || typeof ua !== 'string' || !ua.trim()) {
    return 'Nieznane urządzenie';
  }

  const s = ua.trim();

  // Rozpoznawanie systemu operacyjnego
  let os = 'Inny system';
  if (/windows phone/i.test(s)) os = 'Windows Phone';
  else if (/win64|wow64|windows nt 10/i.test(s)) os = 'Windows 10/11';
  else if (/windows nt 6\.3/i.test(s)) os = 'Windows 8.1';
  else if (/windows nt 6\.1/i.test(s)) os = 'Windows 7';
  else if (/windows nt/i.test(s)) os = 'Windows';
  else if (/iphone|ipad|ipod/i.test(s)) os = 'iOS';
  else if (/macintosh|mac os x/i.test(s)) os = 'macOS';
  else if (/android/i.test(s)) os = 'Android';
  else if (/linux/i.test(s)) os = 'Linux';
  else if (/cros/i.test(s)) os = 'ChromeOS';

  // Rozpoznawanie przeglądarki
  let browser = 'Przeglądarka';
  if (/edg\//i.test(s)) browser = 'Edge';
  else if (/opr\/|opera/i.test(s)) browser = 'Opera';
  else if (/chrome|crios/i.test(s) && !/edg/i.test(s)) browser = 'Chrome';
  else if (/firefox|fxios/i.test(s)) browser = 'Firefox';
  else if (/safari/i.test(s) && !/chrome|crios|android/i.test(s)) browser = 'Safari';
  else if (/curl/i.test(s)) browser = 'cURL';

  return `${browser} (${os})`;
}
