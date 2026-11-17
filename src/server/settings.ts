import type express from 'express';
import { encryptSecret, decryptSecret, validateAppSecret } from '../utils/secretBox.js';
import {
  AdminSettingsResponse,
  AdminSettingsUpdateInput,
  NormalizedSettingsPatch,
  SERVER_SETTINGS_DEFAULTS,
  SettingFieldState,
  SmtpEncryption,
  StoredServerSettings,
  TRASH_RETENTION_MAX,
  TRASH_RETENTION_MIN,
  formatSmtpFrom,
  parseSmtpFrom,
  validateAdminSettingsUpdate,
} from '../utils/settingsSchema.js';
import { isValidIanaTimezone, normalizeDaysBefore, ReminderSettings } from '../utils/reminders.js';
import {
  normalizeEnvTimeHHMM,
  parseTimeHHMM,
  WEEKLY_MAX_ITEMS_PER_PROJECT,
  WEEKLY_MIN_ITEMS_PER_PROJECT,
  WeeklySummarySettings,
} from '../utils/weeklySummary.js';
import { ServerConfig, getLocalInstalledVersion } from './config.js';
import { isRequestHttps } from './security.js';
import { StateStore } from './state.js';
import { logger } from './logger.js';

export interface EffectiveSettings {
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
  reminders: {
    enabled: SettingFieldState<boolean>;
    sendHour: SettingFieldState<number>;
    timezone: SettingFieldState<string>;
    daysBefore: SettingFieldState<number[]>;
    notifyOverdue: SettingFieldState<boolean>;
    appBaseUrl: SettingFieldState<string>;
  };
  weeklySummary: {
    enabled: SettingFieldState<boolean>;
    dayOfWeek: SettingFieldState<number>;
    time: SettingFieldState<string>;
    windowDays: SettingFieldState<7 | 14>;
    includeAdmins: SettingFieldState<boolean>;
    maxItemsPerProject: SettingFieldState<number>;
  };
}

export interface RuntimeSmtpConfig {
  configured: boolean;
  host: string;
  port: number;
  encryption: SmtpEncryption;
  user: string;
  password: string;
  from: string;
  fromName: string;
  fromAddress: string;
  allowSelfSigned: boolean;
}

export interface EffectiveSessionPolicy {
  idleMinutes: number;
  maxHours: number;
  idleMs: number;
  maxMs: number;
}

export interface LockedFieldConflict {
  field: string;
  envVar: string;
}

export interface SettingsService {
  getEffectiveSettings: () => EffectiveSettings;
  getEffectiveSessionPolicy: () => EffectiveSessionPolicy;
  getEffectiveTrashRetentionDays: () => number;
  getEffectiveReminderSettings: () => ReminderSettings;
  getEffectiveWeeklySummarySettings: () => WeeklySummarySettings;
  getRuntimeSmtpConfig: () => RuntimeSmtpConfig;
  getAdminSettingsPayload: (req: express.Request) => AdminSettingsResponse;
  findLockedFieldConflict: (input: AdminSettingsUpdateInput) => LockedFieldConflict | null;
  validateAndNormalizeUpdate: (input: unknown) => ReturnType<typeof validateAdminSettingsUpdate>;
  applySettingsPatch: (patch: NormalizedSettingsPatch) => Promise<{ changedFields: string[] }>;
}

function readEnvString(name: string): string | undefined {
  const val = process.env[name];
  if (val === undefined) return undefined;
  const trimmed = val.trim();
  return trimmed === '' ? undefined : trimmed;
}

function parseEnvBoolean(raw: string): boolean {
  const low = raw.trim().toLowerCase();
  return low !== 'false' && low !== '0' && low !== 'no';
}

export function createSettingsService(deps: {
  config: ServerConfig;
  stateStore: StateStore;
}): SettingsService {
  const { config, stateStore } = deps;

  function getStoredSettings(): StoredServerSettings {
    const appState = stateStore.getAppState();
    if (appState && appState.serverSettings && typeof appState.serverSettings === 'object') {
      return appState.serverSettings as StoredServerSettings;
    }
    return {};
  }

  function getEffectiveSettings(): EffectiveSettings {
    const stored = getStoredSettings();
    const storedSmtp = stored.smtp || {};
    const storedAccess = stored.access || {};
    const storedSessions = stored.sessions || {};
    const storedTrash = stored.trash || {};
    const storedReminders = stored.reminders || {};
    const storedWeekly = stored.weeklySummary || {};

    // --- SMTP HOST ---
    const envHost = readEnvString('SMTP_HOST');
    const host: SettingFieldState<string> =
      envHost !== undefined
        ? { value: envHost, source: 'env', locked: true, envVar: 'SMTP_HOST' }
        : storedSmtp.host !== undefined
        ? { value: storedSmtp.host, source: 'ui', locked: false }
        : { value: SERVER_SETTINGS_DEFAULTS.smtp.host, source: 'default', locked: false };

    // --- SMTP PORT ---
    const envPortRaw = readEnvString('SMTP_PORT');
    const envPortParsed = envPortRaw !== undefined ? parseInt(envPortRaw, 10) : NaN;
    const hasValidEnvPort = Number.isInteger(envPortParsed) && envPortParsed >= 1 && envPortParsed <= 65535;
    const port: SettingFieldState<number> = hasValidEnvPort
      ? { value: envPortParsed, source: 'env', locked: true, envVar: 'SMTP_PORT' }
      : typeof storedSmtp.port === 'number' && Number.isInteger(storedSmtp.port)
      ? { value: storedSmtp.port, source: 'ui', locked: false }
      : { value: SERVER_SETTINGS_DEFAULTS.smtp.port, source: 'default', locked: false };

    // --- SMTP ENCRYPTION ---
    const envEncRaw = readEnvString('SMTP_ENCRYPTION')?.toLowerCase();
    const hasValidEnvEnc =
      envEncRaw === 'none' || envEncRaw === 'starttls' || envEncRaw === 'tls';
    const encryption: SettingFieldState<SmtpEncryption> = hasValidEnvEnc
      ? {
          value: envEncRaw as SmtpEncryption,
          source: 'env',
          locked: true,
          envVar: 'SMTP_ENCRYPTION',
        }
      : storedSmtp.encryption === 'none' ||
        storedSmtp.encryption === 'starttls' ||
        storedSmtp.encryption === 'tls'
      ? { value: storedSmtp.encryption, source: 'ui', locked: false }
      : port.value === 465
      ? { value: 'tls', source: 'default', locked: false }
      : { value: SERVER_SETTINGS_DEFAULTS.smtp.encryption, source: 'default', locked: false };

    // --- SMTP USER ---
    const envUser = readEnvString('SMTP_USER');
    const user: SettingFieldState<string> =
      envUser !== undefined
        ? { value: envUser, source: 'env', locked: true, envVar: 'SMTP_USER' }
        : storedSmtp.user !== undefined
        ? { value: storedSmtp.user, source: 'ui', locked: false }
        : { value: SERVER_SETTINGS_DEFAULTS.smtp.user, source: 'default', locked: false };

    // --- SMTP PASSWORD (nigdy nie zwracamy wartości!) ---
    const envPass = process.env.SMTP_PASS;
    const hasEnvPass = envPass !== undefined && envPass !== '';
    const hasUiPass = Boolean(storedSmtp.passwordEncrypted);
    const passwordSet: SettingFieldState<boolean> = hasEnvPass
      ? { value: true, source: 'env', locked: true, envVar: 'SMTP_PASS' }
      : hasUiPass
      ? { value: true, source: 'ui', locked: false }
      : { value: false, source: 'default', locked: false };

    // --- SMTP FROM (SMTP_FROM steruje oboma polami fromName i fromAddress) ---
    const envFrom = readEnvString('SMTP_FROM');
    const parsedEnvFrom = envFrom !== undefined ? parseSmtpFrom(envFrom) : null;
    const fromName: SettingFieldState<string> = parsedEnvFrom
      ? { value: parsedEnvFrom.fromName, source: 'env', locked: true, envVar: 'SMTP_FROM' }
      : storedSmtp.fromName !== undefined
      ? { value: storedSmtp.fromName, source: 'ui', locked: false }
      : { value: SERVER_SETTINGS_DEFAULTS.smtp.fromName, source: 'default', locked: false };

    const fromAddress: SettingFieldState<string> = parsedEnvFrom
      ? { value: parsedEnvFrom.fromAddress, source: 'env', locked: true, envVar: 'SMTP_FROM' }
      : storedSmtp.fromAddress !== undefined
      ? { value: storedSmtp.fromAddress, source: 'ui', locked: false }
      : { value: SERVER_SETTINGS_DEFAULTS.smtp.fromAddress, source: 'default', locked: false };

    // --- SMTP ALLOW SELF SIGNED ---
    const envSelfSigned = readEnvString('SMTP_ALLOW_SELF_SIGNED');
    const allowSelfSigned: SettingFieldState<boolean> =
      envSelfSigned !== undefined
        ? {
            value: parseEnvBoolean(envSelfSigned),
            source: 'env',
            locked: true,
            envVar: 'SMTP_ALLOW_SELF_SIGNED',
          }
        : typeof storedSmtp.allowSelfSigned === 'boolean'
        ? { value: storedSmtp.allowSelfSigned, source: 'ui', locked: false }
        : {
            value: SERVER_SETTINGS_DEFAULTS.smtp.allowSelfSigned,
            source: 'default',
            locked: false,
          };

    // --- ACCESS: ALLOW_SELF_REGISTRATION ---
    const envRegRaw = readEnvString('ALLOW_SELF_REGISTRATION');
    const allowSelfRegistration: SettingFieldState<boolean> =
      envRegRaw !== undefined
        ? {
            value: parseEnvBoolean(envRegRaw),
            source: 'env',
            locked: true,
            envVar: 'ALLOW_SELF_REGISTRATION',
          }
        : typeof storedAccess.allowSelfRegistration === 'boolean'
        ? { value: storedAccess.allowSelfRegistration, source: 'ui', locked: false }
        : config.allowSelfRegistrationOverride !== undefined
        ? { value: Boolean(config.allowSelfRegistrationOverride), source: 'default', locked: false }
        : { value: SERVER_SETTINGS_DEFAULTS.access.allowSelfRegistration, source: 'default', locked: false };

    // --- SESSIONS ---
    const envIdleRaw = readEnvString('SESSION_IDLE_MINUTES');
    const envIdleParsed = envIdleRaw !== undefined ? parseInt(envIdleRaw, 10) : NaN;
    const hasValidEnvIdle = Number.isInteger(envIdleParsed) && envIdleParsed > 0;
    const idleMinutes: SettingFieldState<number> = hasValidEnvIdle
      ? { value: envIdleParsed, source: 'env', locked: true, envVar: 'SESSION_IDLE_MINUTES' }
      : typeof storedSessions.idleMinutes === 'number' && Number.isInteger(storedSessions.idleMinutes)
      ? { value: storedSessions.idleMinutes, source: 'ui', locked: false }
      : { value: SERVER_SETTINGS_DEFAULTS.sessions.idleMinutes, source: 'default', locked: false };

    const envMaxRaw = readEnvString('SESSION_MAX_HOURS');
    const envMaxParsed = envMaxRaw !== undefined ? parseInt(envMaxRaw, 10) : NaN;
    const hasValidEnvMax = Number.isInteger(envMaxParsed) && envMaxParsed > 0;
    const maxHours: SettingFieldState<number> = hasValidEnvMax
      ? { value: envMaxParsed, source: 'env', locked: true, envVar: 'SESSION_MAX_HOURS' }
      : typeof storedSessions.maxHours === 'number' && Number.isInteger(storedSessions.maxHours)
      ? { value: storedSessions.maxHours, source: 'ui', locked: false }
      : { value: SERVER_SETTINGS_DEFAULTS.sessions.maxHours, source: 'default', locked: false };

    // --- TRASH RETENTION ---
    const envTrashRaw = readEnvString('TRASH_RETENTION_DAYS');
    const envTrashParsed = envTrashRaw !== undefined ? parseInt(envTrashRaw, 10) : NaN;
    const hasValidEnvTrash =
      Number.isInteger(envTrashParsed) &&
      envTrashParsed >= TRASH_RETENTION_MIN &&
      envTrashParsed <= TRASH_RETENTION_MAX;
    const retentionDays: SettingFieldState<number> = hasValidEnvTrash
      ? {
          value: envTrashParsed,
          source: 'env',
          locked: true,
          envVar: 'TRASH_RETENTION_DAYS',
        }
      : typeof storedTrash.retentionDays === 'number' &&
        Number.isInteger(storedTrash.retentionDays) &&
        storedTrash.retentionDays >= TRASH_RETENTION_MIN &&
        storedTrash.retentionDays <= TRASH_RETENTION_MAX
      ? { value: storedTrash.retentionDays, source: 'ui', locked: false }
      : { value: SERVER_SETTINGS_DEFAULTS.trash.retentionDays, source: 'default', locked: false };

    // --- REMINDERS ---
    const envRemEnabledRaw = readEnvString('REMINDERS_ENABLED');
    const remindersEnabled: SettingFieldState<boolean> =
      envRemEnabledRaw !== undefined
        ? {
            value: parseEnvBoolean(envRemEnabledRaw),
            source: 'env',
            locked: true,
            envVar: 'REMINDERS_ENABLED',
          }
        : typeof storedReminders.enabled === 'boolean'
        ? { value: storedReminders.enabled, source: 'ui', locked: false }
        : { value: SERVER_SETTINGS_DEFAULTS.reminders.enabled, source: 'default', locked: false };

    const envRemHourRaw = readEnvString('REMINDER_SEND_HOUR');
    const envRemHourParsed = envRemHourRaw !== undefined ? parseInt(envRemHourRaw, 10) : NaN;
    const hasValidEnvRemHour =
      Number.isInteger(envRemHourParsed) && envRemHourParsed >= 0 && envRemHourParsed <= 23;
    const remindersSendHour: SettingFieldState<number> = hasValidEnvRemHour
      ? {
          value: envRemHourParsed,
          source: 'env',
          locked: true,
          envVar: 'REMINDER_SEND_HOUR',
        }
      : typeof storedReminders.sendHour === 'number' &&
        Number.isInteger(storedReminders.sendHour) &&
        storedReminders.sendHour >= 0 &&
        storedReminders.sendHour <= 23
      ? { value: storedReminders.sendHour, source: 'ui', locked: false }
      : { value: SERVER_SETTINGS_DEFAULTS.reminders.sendHour, source: 'default', locked: false };

    const envRemTzRaw = readEnvString('REMINDER_TIMEZONE');
    const hasValidEnvRemTz = envRemTzRaw !== undefined && isValidIanaTimezone(envRemTzRaw);
    const remindersTimezone: SettingFieldState<string> = hasValidEnvRemTz
      ? {
          value: envRemTzRaw!.trim(),
          source: 'env',
          locked: true,
          envVar: 'REMINDER_TIMEZONE',
        }
      : typeof storedReminders.timezone === 'string' && isValidIanaTimezone(storedReminders.timezone)
      ? { value: storedReminders.timezone.trim(), source: 'ui', locked: false }
      : { value: SERVER_SETTINGS_DEFAULTS.reminders.timezone, source: 'default', locked: false };

    const remindersDaysBefore: SettingFieldState<number[]> = Array.isArray(storedReminders.daysBefore)
      ? {
          value: normalizeDaysBefore(storedReminders.daysBefore),
          source: 'ui',
          locked: false,
        }
      : {
          value: [...SERVER_SETTINGS_DEFAULTS.reminders.daysBefore],
          source: 'default',
          locked: false,
        };

    const remindersNotifyOverdue: SettingFieldState<boolean> =
      typeof storedReminders.notifyOverdue === 'boolean'
        ? { value: storedReminders.notifyOverdue, source: 'ui', locked: false }
        : {
            value: SERVER_SETTINGS_DEFAULTS.reminders.notifyOverdue,
            source: 'default',
            locked: false,
          };

    const remindersAppBaseUrl: SettingFieldState<string> =
      storedReminders.appBaseUrl !== undefined
        ? { value: storedReminders.appBaseUrl, source: 'ui', locked: false }
        : { value: config.defaultReminderAppBaseUrl, source: 'default', locked: false };

    // --- WEEKLY SUMMARY ---
    const envWsEnabledRaw = readEnvString('WEEKLY_SUMMARY_ENABLED');
    const wsEnabled: SettingFieldState<boolean> =
      envWsEnabledRaw !== undefined
        ? {
            value: parseEnvBoolean(envWsEnabledRaw),
            source: 'env',
            locked: true,
            envVar: 'WEEKLY_SUMMARY_ENABLED',
          }
        : typeof storedWeekly.enabled === 'boolean'
        ? { value: storedWeekly.enabled, source: 'ui', locked: false }
        : { value: SERVER_SETTINGS_DEFAULTS.weeklySummary.enabled, source: 'default', locked: false };

    const envWsDayRaw = readEnvString('WEEKLY_SUMMARY_DAY');
    const envWsDayParsed = envWsDayRaw !== undefined ? parseInt(envWsDayRaw, 10) : NaN;
    const hasValidEnvWsDay =
      Number.isInteger(envWsDayParsed) && envWsDayParsed >= 1 && envWsDayParsed <= 7;
    const wsDayOfWeek: SettingFieldState<number> = hasValidEnvWsDay
      ? {
          value: envWsDayParsed,
          source: 'env',
          locked: true,
          envVar: 'WEEKLY_SUMMARY_DAY',
        }
      : typeof storedWeekly.dayOfWeek === 'number' &&
        Number.isInteger(storedWeekly.dayOfWeek) &&
        storedWeekly.dayOfWeek >= 1 &&
        storedWeekly.dayOfWeek <= 7
      ? { value: storedWeekly.dayOfWeek, source: 'ui', locked: false }
      : { value: SERVER_SETTINGS_DEFAULTS.weeklySummary.dayOfWeek, source: 'default', locked: false };

    const envWsTimeRaw = readEnvString('WEEKLY_SUMMARY_TIME');
    const normalizedEnvWsTime = envWsTimeRaw !== undefined ? normalizeEnvTimeHHMM(envWsTimeRaw) : null;
    const parsedStoredWsTime = parseTimeHHMM(storedWeekly.time);
    const wsTime: SettingFieldState<string> = normalizedEnvWsTime
      ? {
          value: normalizedEnvWsTime,
          source: 'env',
          locked: true,
          envVar: 'WEEKLY_SUMMARY_TIME',
        }
      : parsedStoredWsTime
      ? { value: parsedStoredWsTime.formatted, source: 'ui', locked: false }
      : { value: SERVER_SETTINGS_DEFAULTS.weeklySummary.time, source: 'default', locked: false };

    const wsWindowDays: SettingFieldState<7 | 14> =
      storedWeekly.windowDays === 7 || storedWeekly.windowDays === 14
        ? { value: storedWeekly.windowDays, source: 'ui', locked: false }
        : { value: SERVER_SETTINGS_DEFAULTS.weeklySummary.windowDays, source: 'default', locked: false };

    const wsIncludeAdmins: SettingFieldState<boolean> =
      typeof storedWeekly.includeAdmins === 'boolean'
        ? { value: storedWeekly.includeAdmins, source: 'ui', locked: false }
        : { value: SERVER_SETTINGS_DEFAULTS.weeklySummary.includeAdmins, source: 'default', locked: false };

    const wsMaxItemsPerProject: SettingFieldState<number> =
      typeof storedWeekly.maxItemsPerProject === 'number' &&
      Number.isInteger(storedWeekly.maxItemsPerProject) &&
      storedWeekly.maxItemsPerProject >= WEEKLY_MIN_ITEMS_PER_PROJECT &&
      storedWeekly.maxItemsPerProject <= WEEKLY_MAX_ITEMS_PER_PROJECT
        ? { value: storedWeekly.maxItemsPerProject, source: 'ui', locked: false }
        : {
            value: SERVER_SETTINGS_DEFAULTS.weeklySummary.maxItemsPerProject,
            source: 'default',
            locked: false,
          };

    return {
      smtp: {
        configured: host.value.trim().length > 0,
        host,
        port,
        encryption,
        user,
        passwordSet,
        fromName,
        fromAddress,
        allowSelfSigned,
      },
      access: {
        allowSelfRegistration,
      },
      sessions: {
        idleMinutes,
        maxHours,
      },
      trash: {
        retentionDays,
      },
      reminders: {
        enabled: remindersEnabled,
        sendHour: remindersSendHour,
        timezone: remindersTimezone,
        daysBefore: remindersDaysBefore,
        notifyOverdue: remindersNotifyOverdue,
        appBaseUrl: remindersAppBaseUrl,
      },
      weeklySummary: {
        enabled: wsEnabled,
        dayOfWeek: wsDayOfWeek,
        time: wsTime,
        windowDays: wsWindowDays,
        includeAdmins: wsIncludeAdmins,
        maxItemsPerProject: wsMaxItemsPerProject,
      },
    };
  }

  function getEffectiveTrashRetentionDays(): number {
    return getEffectiveSettings().trash.retentionDays.value;
  }

  function getEffectiveReminderSettings(): ReminderSettings {
    const r = getEffectiveSettings().reminders;
    return {
      enabled: r.enabled.value,
      sendHour: r.sendHour.value,
      timezone: r.timezone.value,
      daysBefore: r.daysBefore.value,
      notifyOverdue: r.notifyOverdue.value,
      appBaseUrl: r.appBaseUrl.value,
    };
  }

  function getEffectiveWeeklySummarySettings(): WeeklySummarySettings {
    const eff = getEffectiveSettings();
    const w = eff.weeklySummary;
    const r = eff.reminders;
    return {
      enabled: w.enabled.value,
      dayOfWeek: w.dayOfWeek.value,
      time: w.time.value,
      timezone: r.timezone.value,
      windowDays: w.windowDays.value,
      includeAdmins: w.includeAdmins.value,
      maxItemsPerProject: w.maxItemsPerProject.value,
      appBaseUrl: r.appBaseUrl.value,
    };
  }

  function getEffectiveSessionPolicy(): EffectiveSessionPolicy {
    const eff = getEffectiveSettings();
    const stored = getStoredSettings();
    const idleMinutes = eff.sessions.idleMinutes.value;
    const maxHours = eff.sessions.maxHours.value;

    const useTestIdleOverride =
      typeof config.sessionIdleMsOverride === 'number' &&
      config.sessionIdleMsOverride > 0 &&
      stored.sessions?.idleMinutes === undefined &&
      !eff.sessions.idleMinutes.locked;

    return {
      idleMinutes,
      maxHours,
      idleMs: useTestIdleOverride ? config.sessionIdleMsOverride! : idleMinutes * 60 * 1000,
      maxMs: maxHours * 60 * 60 * 1000,
    };
  }

  function getRuntimeSmtpConfig(): RuntimeSmtpConfig {
    const eff = getEffectiveSettings();
    const stored = getStoredSettings();
    const envPass = process.env.SMTP_PASS;
    let password = '';

    if (envPass !== undefined && envPass !== '') {
      password = envPass;
    } else if (stored.smtp?.passwordEncrypted) {
      try {
        password = decryptSecret(stored.smtp.passwordEncrypted, config.effectiveAppSecret);
      } catch {
        logger.warn('[Settings] Nie udało się odszyfrować zapisanego hasła SMTP (niezgodny APP_SECRET).');
        password = '';
      }
    }

    const envFrom = readEnvString('SMTP_FROM');
    const from = envFrom
      ? envFrom
      : formatSmtpFrom(eff.smtp.fromName.value, eff.smtp.fromAddress.value);

    return {
      configured: eff.smtp.configured,
      host: eff.smtp.host.value.trim(),
      port: eff.smtp.port.value,
      encryption: eff.smtp.encryption.value,
      user: eff.smtp.user.value.trim(),
      password,
      from,
      fromName: eff.smtp.fromName.value,
      fromAddress: eff.smtp.fromAddress.value,
      allowSelfSigned: eff.smtp.allowSelfSigned.value,
    };
  }

  function getAdminSettingsPayload(req: express.Request): AdminSettingsResponse {
    const eff = getEffectiveSettings();
    const xff = req.headers['x-forwarded-for'];
    const xfp = req.headers['x-forwarded-proto'];
    const xfh = req.headers['x-forwarded-host'];
    const requestViaProxy = Boolean(xff || xfp || xfh);

    const rawXfp = Array.isArray(xfp) ? xfp[0] : xfp;
    const protoHeader =
      typeof rawXfp === 'string' ? rawXfp.split(',')[0].trim().toLowerCase() : '';
    const httpsDetected = Boolean(isRequestHttps(req) || protoHeader === 'https');

    const secretValidation = validateAppSecret(config.effectiveAppSecret, true);

    return {
      smtp: eff.smtp,
      access: eff.access,
      sessions: eff.sessions,
      trash: eff.trash,
      reminders: eff.reminders,
      weeklySummary: eff.weeklySummary,
      readOnly: {
        dataDir: config.dataDir,
        trustProxy: {
          value: config.trustProxy,
          requestViaProxy,
          httpsDetected,
        },
        appSecret: {
          configured: config.effectiveAppSecret.length > 0,
          lengthOk: secretValidation.ok,
          source: config.appSecretSource,
        },
        mode: config.isProduction ? 'production' : 'development',
        version: getLocalInstalledVersion(),
      },
    };
  }

  function findLockedFieldConflict(input: AdminSettingsUpdateInput): LockedFieldConflict | null {
    const eff = getEffectiveSettings();
    if (!input || typeof input !== 'object') return null;

    if (input.smtp && typeof input.smtp === 'object') {
      const s = input.smtp;
      if (s.host !== undefined && eff.smtp.host.locked) {
        return { field: 'smtp.host', envVar: eff.smtp.host.envVar! };
      }
      if (s.port !== undefined && eff.smtp.port.locked) {
        return { field: 'smtp.port', envVar: eff.smtp.port.envVar! };
      }
      if (s.encryption !== undefined && eff.smtp.encryption.locked) {
        return { field: 'smtp.encryption', envVar: eff.smtp.encryption.envVar! };
      }
      if (s.user !== undefined && eff.smtp.user.locked) {
        return { field: 'smtp.user', envVar: eff.smtp.user.envVar! };
      }
      if (
        ((typeof s.password === 'string' && s.password.length > 0) || s.clearPassword === true) &&
        eff.smtp.passwordSet.locked
      ) {
        return { field: 'smtp.password', envVar: eff.smtp.passwordSet.envVar! };
      }
      if (s.fromName !== undefined && eff.smtp.fromName.locked) {
        return { field: 'smtp.fromName', envVar: eff.smtp.fromName.envVar! };
      }
      if (s.fromAddress !== undefined && eff.smtp.fromAddress.locked) {
        return { field: 'smtp.fromAddress', envVar: eff.smtp.fromAddress.envVar! };
      }
      if (s.allowSelfSigned !== undefined && eff.smtp.allowSelfSigned.locked) {
        return { field: 'smtp.allowSelfSigned', envVar: eff.smtp.allowSelfSigned.envVar! };
      }
    }

    if (input.access && typeof input.access === 'object') {
      if (input.access.allowSelfRegistration !== undefined && eff.access.allowSelfRegistration.locked) {
        return {
          field: 'access.allowSelfRegistration',
          envVar: eff.access.allowSelfRegistration.envVar!,
        };
      }
    }

    if (input.sessions && typeof input.sessions === 'object') {
      if (input.sessions.idleMinutes !== undefined && eff.sessions.idleMinutes.locked) {
        return { field: 'sessions.idleMinutes', envVar: eff.sessions.idleMinutes.envVar! };
      }
      if (input.sessions.maxHours !== undefined && eff.sessions.maxHours.locked) {
        return { field: 'sessions.maxHours', envVar: eff.sessions.maxHours.envVar! };
      }
    }

    if (
      (input.trash && typeof input.trash === 'object' && input.trash.retentionDays !== undefined) ||
      input.trashRetentionDays !== undefined
    ) {
      if (eff.trash.retentionDays.locked) {
        return { field: 'trash.retentionDays', envVar: eff.trash.retentionDays.envVar! };
      }
    }

    if (input.reminders && typeof input.reminders === 'object') {
      const r = input.reminders;
      if (r.enabled !== undefined && eff.reminders.enabled.locked) {
        return { field: 'reminders.enabled', envVar: eff.reminders.enabled.envVar! };
      }
      if (r.timezone !== undefined && eff.reminders.timezone.locked) {
        return { field: 'reminders.timezone', envVar: eff.reminders.timezone.envVar! };
      }
      if (r.sendHour !== undefined && eff.reminders.sendHour.locked) {
        return { field: 'reminders.sendHour', envVar: eff.reminders.sendHour.envVar! };
      }
    }

    if (input.weeklySummary && typeof input.weeklySummary === 'object') {
      const w = input.weeklySummary;
      if (w.enabled !== undefined && eff.weeklySummary.enabled.locked) {
        return { field: 'weeklySummary.enabled', envVar: eff.weeklySummary.enabled.envVar! };
      }
      if (w.dayOfWeek !== undefined && eff.weeklySummary.dayOfWeek.locked) {
        return { field: 'weeklySummary.dayOfWeek', envVar: eff.weeklySummary.dayOfWeek.envVar! };
      }
      if (w.time !== undefined && eff.weeklySummary.time.locked) {
        return { field: 'weeklySummary.time', envVar: eff.weeklySummary.time.envVar! };
      }
    }

    return null;
  }

  function validateAndNormalizeUpdate(input: unknown) {
    const eff = getEffectiveSettings();
    return validateAdminSettingsUpdate(input, {
      idleMinutes: eff.sessions.idleMinutes.value,
      maxHours: eff.sessions.maxHours.value,
    });
  }

  async function applySettingsPatch(
    patch: NormalizedSettingsPatch
  ): Promise<{ changedFields: string[] }> {
    const appState = stateStore.ensureStateStructure();
    const currentStored: StoredServerSettings =
      appState.serverSettings && typeof appState.serverSettings === 'object'
        ? {
            smtp: appState.serverSettings.smtp ? { ...appState.serverSettings.smtp } : undefined,
            access: appState.serverSettings.access ? { ...appState.serverSettings.access } : undefined,
            sessions: appState.serverSettings.sessions
              ? { ...appState.serverSettings.sessions }
              : undefined,
            trash: appState.serverSettings.trash ? { ...appState.serverSettings.trash } : undefined,
            reminders: appState.serverSettings.reminders ? { ...appState.serverSettings.reminders } : undefined,
            weeklySummary: appState.serverSettings.weeklySummary
              ? { ...appState.serverSettings.weeklySummary }
              : undefined,
          }
        : {};

    const changedFields: string[] = [];

    if (patch.smtp) {
      const nextSmtp = { ...(currentStored.smtp || {}) };
      if (patch.smtp.host !== undefined && patch.smtp.host !== nextSmtp.host) {
        nextSmtp.host = patch.smtp.host;
        changedFields.push('smtp.host');
      } else if (patch.smtp.host !== undefined && nextSmtp.host === undefined) {
        nextSmtp.host = patch.smtp.host;
        changedFields.push('smtp.host');
      }

      if (patch.smtp.port !== undefined && patch.smtp.port !== nextSmtp.port) {
        nextSmtp.port = patch.smtp.port;
        changedFields.push('smtp.port');
      }

      if (patch.smtp.encryption !== undefined && patch.smtp.encryption !== nextSmtp.encryption) {
        nextSmtp.encryption = patch.smtp.encryption;
        changedFields.push('smtp.encryption');
      }

      if (patch.smtp.user !== undefined && patch.smtp.user !== nextSmtp.user) {
        nextSmtp.user = patch.smtp.user;
        changedFields.push('smtp.user');
      }

      if (patch.smtp.clearPassword) {
        if (nextSmtp.passwordEncrypted) {
          delete nextSmtp.passwordEncrypted;
          changedFields.push('smtp.password');
        }
      } else if (patch.smtp.password !== undefined && patch.smtp.password.length > 0) {
        nextSmtp.passwordEncrypted = encryptSecret(patch.smtp.password, config.effectiveAppSecret);
        changedFields.push('smtp.password');
      }

      if (patch.smtp.fromName !== undefined && patch.smtp.fromName !== nextSmtp.fromName) {
        nextSmtp.fromName = patch.smtp.fromName;
        changedFields.push('smtp.fromName');
      }

      if (patch.smtp.fromAddress !== undefined && patch.smtp.fromAddress !== nextSmtp.fromAddress) {
        nextSmtp.fromAddress = patch.smtp.fromAddress;
        changedFields.push('smtp.fromAddress');
      }

      if (
        patch.smtp.allowSelfSigned !== undefined &&
        patch.smtp.allowSelfSigned !== nextSmtp.allowSelfSigned
      ) {
        nextSmtp.allowSelfSigned = patch.smtp.allowSelfSigned;
        changedFields.push('smtp.allowSelfSigned');
      }

      currentStored.smtp = nextSmtp;
    }

    if (patch.access) {
      const nextAccess = { ...(currentStored.access || {}) };
      if (
        patch.access.allowSelfRegistration !== undefined &&
        patch.access.allowSelfRegistration !== nextAccess.allowSelfRegistration
      ) {
        nextAccess.allowSelfRegistration = patch.access.allowSelfRegistration;
        changedFields.push('access.allowSelfRegistration');
      }
      currentStored.access = nextAccess;
    }

    if (patch.sessions) {
      const nextSessions = { ...(currentStored.sessions || {}) };
      if (
        patch.sessions.idleMinutes !== undefined &&
        patch.sessions.idleMinutes !== nextSessions.idleMinutes
      ) {
        nextSessions.idleMinutes = patch.sessions.idleMinutes;
        changedFields.push('sessions.idleMinutes');
      }
      if (
        patch.sessions.maxHours !== undefined &&
        patch.sessions.maxHours !== nextSessions.maxHours
      ) {
        nextSessions.maxHours = patch.sessions.maxHours;
        changedFields.push('sessions.maxHours');
      }
      currentStored.sessions = nextSessions;
    }

    if (patch.trash) {
      const nextTrash = { ...(currentStored.trash || {}) };
      if (
        patch.trash.retentionDays !== undefined &&
        patch.trash.retentionDays !== nextTrash.retentionDays
      ) {
        nextTrash.retentionDays = patch.trash.retentionDays;
        changedFields.push('trash.retentionDays');
      }
      currentStored.trash = nextTrash;
    }

    if (patch.reminders) {
      const nextRem = { ...(currentStored.reminders || {}) };
      if (patch.reminders.enabled !== undefined && patch.reminders.enabled !== nextRem.enabled) {
        nextRem.enabled = patch.reminders.enabled;
        changedFields.push('reminders.enabled');
      }
      if (patch.reminders.sendHour !== undefined && patch.reminders.sendHour !== nextRem.sendHour) {
        nextRem.sendHour = patch.reminders.sendHour;
        changedFields.push('reminders.sendHour');
      }
      if (patch.reminders.timezone !== undefined && patch.reminders.timezone !== nextRem.timezone) {
        nextRem.timezone = patch.reminders.timezone;
        changedFields.push('reminders.timezone');
      }
      if (patch.reminders.daysBefore !== undefined) {
        const prevDays = JSON.stringify(nextRem.daysBefore ?? null);
        const nextDays = JSON.stringify(patch.reminders.daysBefore);
        if (prevDays !== nextDays) {
          nextRem.daysBefore = [...patch.reminders.daysBefore];
          changedFields.push('reminders.daysBefore');
        }
      }
      if (
        patch.reminders.notifyOverdue !== undefined &&
        patch.reminders.notifyOverdue !== nextRem.notifyOverdue
      ) {
        nextRem.notifyOverdue = patch.reminders.notifyOverdue;
        changedFields.push('reminders.notifyOverdue');
      }
      if (
        patch.reminders.appBaseUrl !== undefined &&
        patch.reminders.appBaseUrl !== nextRem.appBaseUrl
      ) {
        nextRem.appBaseUrl = patch.reminders.appBaseUrl;
        changedFields.push('reminders.appBaseUrl');
      }
      currentStored.reminders = nextRem;
    }

    if (patch.weeklySummary) {
      const nextWs = { ...(currentStored.weeklySummary || {}) };
      if (patch.weeklySummary.enabled !== undefined && patch.weeklySummary.enabled !== nextWs.enabled) {
        nextWs.enabled = patch.weeklySummary.enabled;
        changedFields.push('weeklySummary.enabled');
      }
      if (
        patch.weeklySummary.dayOfWeek !== undefined &&
        patch.weeklySummary.dayOfWeek !== nextWs.dayOfWeek
      ) {
        nextWs.dayOfWeek = patch.weeklySummary.dayOfWeek;
        changedFields.push('weeklySummary.dayOfWeek');
      }
      if (patch.weeklySummary.time !== undefined && patch.weeklySummary.time !== nextWs.time) {
        nextWs.time = patch.weeklySummary.time;
        changedFields.push('weeklySummary.time');
      }
      if (
        patch.weeklySummary.windowDays !== undefined &&
        patch.weeklySummary.windowDays !== nextWs.windowDays
      ) {
        nextWs.windowDays = patch.weeklySummary.windowDays;
        changedFields.push('weeklySummary.windowDays');
      }
      if (
        patch.weeklySummary.includeAdmins !== undefined &&
        patch.weeklySummary.includeAdmins !== nextWs.includeAdmins
      ) {
        nextWs.includeAdmins = patch.weeklySummary.includeAdmins;
        changedFields.push('weeklySummary.includeAdmins');
      }
      if (
        patch.weeklySummary.maxItemsPerProject !== undefined &&
        patch.weeklySummary.maxItemsPerProject !== nextWs.maxItemsPerProject
      ) {
        nextWs.maxItemsPerProject = patch.weeklySummary.maxItemsPerProject;
        changedFields.push('weeklySummary.maxItemsPerProject');
      }
      currentStored.weeklySummary = nextWs;
    }

    if (changedFields.length > 0) {
      appState.serverSettings = currentStored;
      appState.updatedAt = new Date().toISOString();
      stateStore.setAppState(appState);
      await stateStore.saveStateAtomicAsync();
    }

    return { changedFields };
  }

  return {
    getEffectiveSettings,
    getEffectiveSessionPolicy,
    getEffectiveTrashRetentionDays,
    getEffectiveReminderSettings,
    getEffectiveWeeklySummarySettings,
    getRuntimeSmtpConfig,
    getAdminSettingsPayload,
    findLockedFieldConflict,
    validateAndNormalizeUpdate,
    applySettingsPatch,
  };
}
