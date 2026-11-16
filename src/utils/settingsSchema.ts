import { hasForbiddenKeys } from './access.js';

export type SmtpEncryption = 'none' | 'starttls' | 'tls';
export type SettingSource = 'env' | 'ui' | 'default';

export interface StoredSmtpSettings {
  host?: string;
  port?: number;
  encryption?: SmtpEncryption;
  user?: string;
  passwordEncrypted?: string;
  fromName?: string;
  fromAddress?: string;
  allowSelfSigned?: boolean;
}

export interface StoredServerSettings {
  smtp?: StoredSmtpSettings;
  access?: {
    allowSelfRegistration?: boolean;
  };
  sessions?: {
    idleMinutes?: number;
    maxHours?: number;
  };
  trash?: {
    retentionDays?: number;
  };
}

export interface SettingFieldState<T> {
  value: T;
  source: SettingSource;
  locked: boolean;
  envVar?: string;
}

export interface AdminReadOnlySettings {
  dataDir: string;
  trustProxy: {
    value: boolean | number | string;
    requestViaProxy: boolean;
    httpsDetected: boolean;
  };
  appSecret: {
    configured: boolean;
    lengthOk: boolean;
    source: 'env' | 'dev_file' | 'option';
  };
  mode: 'production' | 'development';
  version: string;
}

export interface AdminSettingsResponse {
  smtp: {
    configured: boolean;
    host: SettingFieldState<string>;
    port: SettingFieldState<number>;
    encryption: SettingFieldState<SmtpEncryption>;
    user: SettingFieldState<string>;
    passwordSet: SettingFieldState<boolean>;
    fromName: SettingFieldState<string>;
    fromAddress: SettingFieldState<string>;
    allowSelfSigned: SettingFieldState<boolean>;
  };
  access: {
    allowSelfRegistration: SettingFieldState<boolean>;
  };
  sessions: {
    idleMinutes: SettingFieldState<number>;
    maxHours: SettingFieldState<number>;
  };
  trash: {
    retentionDays: SettingFieldState<number>;
  };
  readOnly: AdminReadOnlySettings;
}

export interface SmtpUpdateInput {
  host?: unknown;
  port?: unknown;
  encryption?: unknown;
  user?: unknown;
  password?: unknown;
  clearPassword?: unknown;
  fromName?: unknown;
  fromAddress?: unknown;
  allowSelfSigned?: unknown;
}

export interface AdminSettingsUpdateInput {
  currentPassword?: unknown;
  smtp?: SmtpUpdateInput;
  access?: {
    allowSelfRegistration?: unknown;
  };
  sessions?: {
    idleMinutes?: unknown;
    maxHours?: unknown;
  };
  trash?: {
    retentionDays?: unknown;
  };
  trashRetentionDays?: unknown;
}

export interface NormalizedSettingsPatch {
  smtp?: {
    host?: string;
    port?: number;
    encryption?: SmtpEncryption;
    user?: string;
    password?: string; // Ustawiane tylko, gdy niepuste (zmiana hasła)
    clearPassword?: boolean;
    fromName?: string;
    fromAddress?: string;
    allowSelfSigned?: boolean;
  };
  access?: {
    allowSelfRegistration?: boolean;
  };
  sessions?: {
    idleMinutes?: number;
    maxHours?: number;
  };
  trash?: {
    retentionDays?: number;
  };
}

export interface SettingsValidationResult {
  ok: boolean;
  errors: string[];
  patch: NormalizedSettingsPatch;
}

export const SERVER_SETTINGS_DEFAULTS = {
  smtp: {
    host: '',
    port: 587,
    encryption: 'starttls' as SmtpEncryption,
    user: '',
    passwordSet: false,
    fromName: 'Zarządzanie Projektami',
    fromAddress: '',
    allowSelfSigned: false,
  },
  access: {
    allowSelfRegistration: true,
  },
  sessions: {
    idleMinutes: 120,
    maxHours: 12,
  },
  trash: {
    retentionDays: 30,
  },
} as const;

export const SESSION_IDLE_MIN = 5;
export const SESSION_IDLE_MAX = 1440;
export const SESSION_MAX_HOURS_MIN = 1;
export const SESSION_MAX_HOURS_MAX = 168;
export const TRASH_RETENTION_MIN = 1;
export const TRASH_RETENTION_MAX = 365;

const VALID_ENCRYPTION_VALUES = new Set<SmtpEncryption>(['none', 'starttls', 'tls']);
const SIMPLE_EMAIL_REGEX = /^[^\s@<>()[\]\\,;:\"]+@[^\s@<>()[\]\\,;:\"]+\.[^\s@<>()[\]\\,;:\"]+$/;
const HAS_CONTROL_OR_NEWLINE_REGEX = /[\r\n\0]/;

export function isValidEmail(email: string): boolean {
  const clean = email.trim();
  if (!clean || clean.length > 254) return false;
  if (HAS_CONTROL_OR_NEWLINE_REGEX.test(clean)) return false;
  return SIMPLE_EMAIL_REGEX.test(clean);
}

export function parseSmtpFrom(rawFrom: string): { fromName: string; fromAddress: string } {
  const trimmed = rawFrom.trim();
  if (!trimmed) {
    return {
      fromName: SERVER_SETTINGS_DEFAULTS.smtp.fromName,
      fromAddress: '',
    };
  }

  const angleMatch = trimmed.match(/^(.*)<([^<>]+)>$/);
  if (angleMatch) {
    const rawName = angleMatch[1].trim().replace(/^["']|["']$/g, '').trim();
    const rawAddr = angleMatch[2].trim();
    return {
      fromName: rawName || SERVER_SETTINGS_DEFAULTS.smtp.fromName,
      fromAddress: rawAddr,
    };
  }

  if (trimmed.includes('@') && !/\s/.test(trimmed)) {
    return {
      fromName: SERVER_SETTINGS_DEFAULTS.smtp.fromName,
      fromAddress: trimmed,
    };
  }

  return {
    fromName: trimmed,
    fromAddress: '',
  };
}

export function formatSmtpFrom(fromName: string, fromAddress: string): string {
  const cleanAddr = (fromAddress || '').trim();
  const cleanName = (fromName || '').trim().replace(/[\r\n\0"]/g, '');
  if (!cleanAddr) {
    return `"${cleanName || SERVER_SETTINGS_DEFAULTS.smtp.fromName}" <noreply@pracownia.pl>`;
  }
  if (!cleanName) {
    return cleanAddr;
  }
  return `"${cleanName}" <${cleanAddr}>`;
}

export function validateAdminSettingsUpdate(
  input: unknown,
  currentEffectiveSessions: { idleMinutes: number; maxHours: number }
): SettingsValidationResult {
  const errors: string[] = [];
  const patch: NormalizedSettingsPatch = {};

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['Nieprawidłowy format danych ustawień.'], patch };
  }

  if (hasForbiddenKeys(input)) {
    return { ok: false, errors: ['Niedozwolony klucz w żądaniu.'], patch };
  }

  const body = input as AdminSettingsUpdateInput;

  // 1. Sekcja SMTP
  if (body.smtp !== undefined) {
    if (!body.smtp || typeof body.smtp !== 'object' || Array.isArray(body.smtp) || hasForbiddenKeys(body.smtp)) {
      errors.push('Nieprawidłowy format sekcji SMTP.');
    } else {
      const smtpIn = body.smtp;
      const smtpPatch: NonNullable<NormalizedSettingsPatch['smtp']> = {};

      if (smtpIn.host !== undefined) {
        if (typeof smtpIn.host !== 'string') {
          errors.push('Adres serwera SMTP musi być ciągiem znaków.');
        } else {
          const host = smtpIn.host.trim();
          if (host.length > 253) {
            errors.push('Adres serwera SMTP nie może przekraczać 253 znaków.');
          } else if (/\s/.test(host) || HAS_CONTROL_OR_NEWLINE_REGEX.test(host)) {
            errors.push('Adres serwera SMTP nie może zawierać białych znaków ani znaków kontrolnych.');
          } else {
            smtpPatch.host = host;
          }
        }
      }

      if (smtpIn.port !== undefined) {
        const portNum =
          typeof smtpIn.port === 'number'
            ? smtpIn.port
            : typeof smtpIn.port === 'string' && smtpIn.port.trim() !== ''
            ? Number(smtpIn.port.trim())
            : NaN;
        if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
          errors.push('Port SMTP musi być liczbą całkowitą z zakresu od 1 do 65535.');
        } else {
          smtpPatch.port = portNum;
        }
      }

      if (smtpIn.encryption !== undefined) {
        if (typeof smtpIn.encryption !== 'string' || !VALID_ENCRYPTION_VALUES.has(smtpIn.encryption as SmtpEncryption)) {
          errors.push('Nieprawidłowy tryb szyfrowania SMTP (dozwolone: none, starttls, tls).');
        } else {
          smtpPatch.encryption = smtpIn.encryption as SmtpEncryption;
        }
      }

      if (smtpIn.user !== undefined) {
        if (typeof smtpIn.user !== 'string') {
          errors.push('Nazwa użytkownika SMTP musi być ciągiem znaków.');
        } else {
          const user = smtpIn.user.trim();
          if (user.length > 254 || HAS_CONTROL_OR_NEWLINE_REGEX.test(user)) {
            errors.push('Nieprawidłowa nazwa użytkownika SMTP.');
          } else {
            smtpPatch.user = user;
          }
        }
      }

      if (smtpIn.clearPassword !== undefined) {
        if (typeof smtpIn.clearPassword !== 'boolean') {
          errors.push('Flaga usunięcia hasła SMTP musi być wartością logiczną.');
        } else if (smtpIn.clearPassword) {
          smtpPatch.clearPassword = true;
        }
      }

      if (smtpIn.password !== undefined) {
        if (typeof smtpIn.password !== 'string') {
          errors.push('Hasło SMTP musi być ciągiem znaków.');
        } else if (smtpIn.password.length > 500) {
          errors.push('Hasło SMTP nie może przekraczać 500 znaków.');
        } else if (smtpIn.password.length > 0 && !smtpPatch.clearPassword) {
          // Puste hasło oznacza „bez zmian”
          smtpPatch.password = smtpIn.password;
        }
      }

      if (smtpIn.fromName !== undefined) {
        if (typeof smtpIn.fromName !== 'string') {
          errors.push('Nazwa nadawcy musi być ciągiem znaków.');
        } else {
          const fromName = smtpIn.fromName.trim();
          if (fromName.length > 120 || HAS_CONTROL_OR_NEWLINE_REGEX.test(fromName)) {
            errors.push('Nazwa nadawcy jest nieprawidłowa lub przekracza 120 znaków.');
          } else {
            smtpPatch.fromName = fromName;
          }
        }
      }

      if (smtpIn.fromAddress !== undefined) {
        if (typeof smtpIn.fromAddress !== 'string') {
          errors.push('Adres e-mail nadawcy musi być ciągiem znaków.');
        } else {
          const fromAddress = smtpIn.fromAddress.trim();
          if (fromAddress !== '' && !isValidEmail(fromAddress)) {
            errors.push('Podaj prawidłowy adres e-mail nadawcy.');
          } else {
            smtpPatch.fromAddress = fromAddress;
          }
        }
      }

      if (smtpIn.allowSelfSigned !== undefined) {
        if (typeof smtpIn.allowSelfSigned !== 'boolean') {
          errors.push('Opcja akceptacji samopodpisanych certyfikatów TLS musi być wartością logiczną.');
        } else {
          smtpPatch.allowSelfSigned = smtpIn.allowSelfSigned;
        }
      }

      if (Object.keys(smtpPatch).length > 0) {
        patch.smtp = smtpPatch;
      }
    }
  }

  // 2. Sekcja Access (rejestracja)
  if (body.access !== undefined) {
    if (!body.access || typeof body.access !== 'object' || Array.isArray(body.access) || hasForbiddenKeys(body.access)) {
      errors.push('Nieprawidłowy format sekcji dostępu.');
    } else {
      const accessPatch: NonNullable<NormalizedSettingsPatch['access']> = {};
      if (body.access.allowSelfRegistration !== undefined) {
        if (typeof body.access.allowSelfRegistration !== 'boolean') {
          errors.push('Opcja samodzielnej rejestracji musi być wartością logiczną.');
        } else {
          accessPatch.allowSelfRegistration = body.access.allowSelfRegistration;
        }
      }
      if (Object.keys(accessPatch).length > 0) {
        patch.access = accessPatch;
      }
    }
  }

  // 3. Sekcja Sessions
  if (body.sessions !== undefined) {
    if (!body.sessions || typeof body.sessions !== 'object' || Array.isArray(body.sessions) || hasForbiddenKeys(body.sessions)) {
      errors.push('Nieprawidłowy format sekcji sesji.');
    } else {
      const sessionsPatch: NonNullable<NormalizedSettingsPatch['sessions']> = {};

      if (body.sessions.idleMinutes !== undefined) {
        const val =
          typeof body.sessions.idleMinutes === 'number'
            ? body.sessions.idleMinutes
            : typeof body.sessions.idleMinutes === 'string' && body.sessions.idleMinutes.trim() !== ''
            ? Number(body.sessions.idleMinutes.trim())
            : NaN;
        if (!Number.isInteger(val) || val < SESSION_IDLE_MIN || val > SESSION_IDLE_MAX) {
          errors.push(
            `Czas bezczynności sesji musi być liczbą całkowitą z zakresu od ${SESSION_IDLE_MIN} do ${SESSION_IDLE_MAX} minut.`
          );
        } else {
          sessionsPatch.idleMinutes = val;
        }
      }

      if (body.sessions.maxHours !== undefined) {
        const val =
          typeof body.sessions.maxHours === 'number'
            ? body.sessions.maxHours
            : typeof body.sessions.maxHours === 'string' && body.sessions.maxHours.trim() !== ''
            ? Number(body.sessions.maxHours.trim())
            : NaN;
        if (!Number.isInteger(val) || val < SESSION_MAX_HOURS_MIN || val > SESSION_MAX_HOURS_MAX) {
          errors.push(
            `Maksymalny czas trwania sesji musi być liczbą całkowitą z zakresu od ${SESSION_MAX_HOURS_MIN} do ${SESSION_MAX_HOURS_MAX} godzin.`
          );
        } else {
          sessionsPatch.maxHours = val;
        }
      }

      if (Object.keys(sessionsPatch).length > 0) {
        patch.sessions = sessionsPatch;
      }
    }
  }

  // Walidacja spójności sesji: idleMinutes <= maxHours * 60
  const nextIdle = patch.sessions?.idleMinutes ?? currentEffectiveSessions.idleMinutes;
  const nextMaxHours = patch.sessions?.maxHours ?? currentEffectiveSessions.maxHours;
  if (Number.isFinite(nextIdle) && Number.isFinite(nextMaxHours) && nextIdle > nextMaxHours * 60) {
    errors.push(
      'Czas bezczynności sesji (w minutach) nie może przekraczać maksymalnego czasu trwania sesji.'
    );
  }

  // 4. Sekcja Trash (kosz) — obsługuje zarówno body.trash.retentionDays jak i body.trashRetentionDays
  let rawRetention: unknown;
  if (body.trash !== undefined) {
    if (!body.trash || typeof body.trash !== 'object' || Array.isArray(body.trash) || hasForbiddenKeys(body.trash)) {
      errors.push('Nieprawidłowy format sekcji kosza.');
    } else if (body.trash.retentionDays !== undefined) {
      rawRetention = body.trash.retentionDays;
    }
  }
  if (rawRetention === undefined && body.trashRetentionDays !== undefined) {
    rawRetention = body.trashRetentionDays;
  }

  if (rawRetention !== undefined) {
    const val =
      typeof rawRetention === 'number'
        ? rawRetention
        : typeof rawRetention === 'string' && rawRetention.trim() !== ''
        ? Number(rawRetention.trim())
        : NaN;
    if (!Number.isInteger(val) || val < TRASH_RETENTION_MIN || val > TRASH_RETENTION_MAX) {
      errors.push(
        `Okres przechowywania elementów w koszu musi być liczbą całkowitą z zakresu od ${TRASH_RETENTION_MIN} do ${TRASH_RETENTION_MAX} dni.`
      );
    } else {
      patch.trash = { retentionDays: val };
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    patch,
  };
}
