import crypto from 'crypto';

export const TRUSTED_DEVICE_DAYS_MIN = 1;
export const TRUSTED_DEVICE_DAYS_MAX = 90;
export const TRUSTED_DEVICE_DEFAULT_DAYS = 30;
export const TRUSTED_DEVICE_MAX_PER_USER = 10;
export const TRUSTED_DEVICE_GRACE_MS = 60_000;

export interface TrustedDeviceRecord {
  id: string;
  userId: string;
  tokenHash: string;
  previousTokenHash?: string;
  previousTokenExpiresAt?: number;
  rotatedAt?: number;
  label: string;
  createdAt: number;
  lastUsedAt: number;
  expiresAt: number;
  ip?: string;
  userAgent?: string;
}

export interface PublicTrustedDevice {
  id: string;
  label: string;
  createdAt: number;
  lastUsedAt: number;
  expiresAt: number;
  ip?: string;
  userAgent?: string;
  current: boolean;
}

export type DeviceMatchResult =
  | { status: 'none' }
  | { status: 'expired'; record: TrustedDeviceRecord }
  | { status: 'current'; record: TrustedDeviceRecord }
  | { status: 'grace'; record: TrustedDeviceRecord }
  | { status: 'reuse'; record: TrustedDeviceRecord };

/**
 * Generuje kryptograficznie losowy token zaufanego urządzenia (32 bajty = 256 bitów).
 */
export function generateDeviceToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Oblicza skrót SHA-256 tokena urządzenia przechowywany na serwerze.
 */
export function hashDeviceToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
}

/**
 * Oblicza deterministyczny, nieodwracalny identyfikator publiczny urządzenia (16 znaków hex HMAC-SHA256).
 */
export function computeDevicePublicId(recordId: string, key: string): string {
  if (!recordId || !key) return '';
  return crypto.createHmac('sha256', key).update(recordId).digest('hex').slice(0, 16);
}

/**
 * Tworzy czytelną etykietę urządzenia z nagłówka User-Agent (np. "Chrome na Windows").
 */
export function formatDeviceLabel(ua?: string): string {
  if (!ua || typeof ua !== 'string' || !ua.trim()) {
    return 'Nieznane urządzenie';
  }

  const s = ua.trim();

  let os: string | null = null;
  if (/windows phone/i.test(s)) os = 'Windows Phone';
  else if (/windows/i.test(s)) os = 'Windows';
  else if (/iphone|ipad|ipod/i.test(s)) os = 'iOS';
  else if (/macintosh|mac os x/i.test(s)) os = 'macOS';
  else if (/android/i.test(s)) os = 'Android';
  else if (/cros/i.test(s)) os = 'ChromeOS';
  else if (/linux/i.test(s)) os = 'Linux';

  let browser = 'Przeglądarka';
  if (/edg\//i.test(s)) browser = 'Edge';
  else if (/opr\/|opera/i.test(s)) browser = 'Opera';
  else if (/chrome|crios/i.test(s) && !/edg\//i.test(s)) browser = 'Chrome';
  else if (/firefox|fxios/i.test(s)) browser = 'Firefox';
  else if (/safari/i.test(s) && !/chrome|crios|android/i.test(s)) browser = 'Safari';
  else if (/curl/i.test(s)) browser = 'cURL';

  return os ? `${browser} na ${os}` : browser;
}

export function isTrustedDeviceExpired(
  record: Pick<TrustedDeviceRecord, 'expiresAt'>,
  now: number
): boolean {
  if (!record || typeof record.expiresAt !== 'number') return true;
  return now >= record.expiresAt;
}

export function pruneExpiredDevices(
  records: TrustedDeviceRecord[],
  now: number
): { active: TrustedDeviceRecord[]; removedCount: number } {
  const active: TrustedDeviceRecord[] = [];
  let removedCount = 0;
  for (const r of records) {
    if (!r || typeof r !== 'object' || isTrustedDeviceExpired(r, now)) {
      removedCount += 1;
    } else {
      active.push(r);
    }
  }
  return { active, removedCount };
}

/**
 * Wymusza limit maksymalnie N zaufanych urządzeń na użytkownika (usuwa najdawniej używane).
 */
export function enforceMaxDevicesForUser(
  records: TrustedDeviceRecord[],
  userId: string,
  max: number = TRUSTED_DEVICE_MAX_PER_USER
): TrustedDeviceRecord[] {
  const others = records.filter((r) => r.userId !== userId);
  const owned = records
    .filter((r) => r.userId === userId)
    .sort((a, b) => (a.lastUsedAt || a.createdAt) - (b.lastUsedAt || b.createdAt));

  const kept = owned.length > max ? owned.slice(owned.length - max) : owned;
  return [...others, ...kept];
}

/**
 * Dopasowuje surowy token do listy rekordów z obsługą 60-sekundowego okna wyścigu zakładek
 * oraz detekcji ponownego użycia starego tokena (kradzież).
 */
export function matchDeviceToken(
  records: TrustedDeviceRecord[],
  rawToken: string | undefined | null,
  now: number
): DeviceMatchResult {
  if (!rawToken || typeof rawToken !== 'string' || !rawToken.trim()) {
    return { status: 'none' };
  }

  const incomingHash = hashDeviceToken(rawToken);

  for (const record of records) {
    if (!record) continue;
    if (record.tokenHash === incomingHash) {
      if (isTrustedDeviceExpired(record, now)) {
        return { status: 'expired', record };
      }
      return { status: 'current', record };
    }
  }

  for (const record of records) {
    if (!record || !record.previousTokenHash) continue;
    if (record.previousTokenHash === incomingHash) {
      if (isTrustedDeviceExpired(record, now)) {
        return { status: 'expired', record };
      }
      const graceUntil =
        typeof record.previousTokenExpiresAt === 'number'
          ? record.previousTokenExpiresAt
          : (record.rotatedAt ?? 0) + TRUSTED_DEVICE_GRACE_MS;
      if (now <= graceUntil) {
        return { status: 'grace', record };
      }
      return { status: 'reuse', record };
    }
  }

  return { status: 'none' };
}

export function toPublicTrustedDevice(
  record: TrustedDeviceRecord,
  currentRecordId: string | null | undefined,
  key: string
): PublicTrustedDevice {
  return {
    id: computeDevicePublicId(record.id, key),
    label: record.label || formatDeviceLabel(record.userAgent),
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt || record.createdAt,
    expiresAt: record.expiresAt,
    ip: record.ip,
    userAgent: record.userAgent,
    current: Boolean(currentRecordId && record.id === currentRecordId),
  };
}
