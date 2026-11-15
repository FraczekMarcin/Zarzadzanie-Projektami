import nodemailer from 'nodemailer';
import { BackupStatusResult, computeBackupStatus } from './backupStatus.js';
import { ServerConfig } from './config.js';
import { logger } from './logger.js';
import { StateStore } from './state.js';

export const BACKUP_WATCH_INITIAL_DELAY_MS = 2 * 60 * 1000;
export const BACKUP_WATCH_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const BACKUP_ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export interface BackupAlertEmailPayload {
  to: string[];
  subject: string;
  text: string;
  html: string;
}

export type BackupAlertMailer = (mail: BackupAlertEmailPayload) => Promise<void>;

export interface BackupWatchService {
  runCheck: () => Promise<BackupStatusResult | null>;
  stop: () => void;
}

export function resolveBackupAlertRecipients(
  configuredEmails: string[],
  users: Array<{ role?: string; isApproved?: boolean; email?: string }>
): string[] {
  const fromConfig = Array.from(
    new Set(
      (configuredEmails || [])
        .map((e) => String(e || '').trim())
        .filter((e) => e.length > 0)
    )
  );
  if (fromConfig.length > 0) {
    return fromConfig;
  }

  return Array.from(
    new Set(
      (users || [])
        .filter(
          (u) =>
            u &&
            u.role === 'admin' &&
            u.isApproved !== false &&
            typeof u.email === 'string' &&
            u.email.trim().length > 0
        )
        .map((u) => u.email!.trim())
    )
  );
}

async function sendSmtpMail(payload: BackupAlertEmailPayload): Promise<void> {
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: process.env.SMTP_USER
      ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS || '',
        }
      : undefined,
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM || '"Zarządzanie Projektami" <noreply@pracownia.pl>',
    to: payload.to.join(', '),
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
  });
}

export function createBackupWatchService(deps: {
  config: ServerConfig;
  stateStore: StateStore;
  disableTimers?: boolean;
  checkStatusOverride?: () => Promise<BackupStatusResult>;
  mailerOverride?: BackupAlertMailer;
  now?: () => number;
}): BackupWatchService {
  const { config, stateStore, disableTimers, checkStatusOverride, mailerOverride } = deps;
  const now = deps.now ?? (() => Date.now());
  const mailer: BackupAlertMailer = mailerOverride ?? sendSmtpMail;

  let stopped = false;
  let checking = false;
  let isAlertActive = false;
  let lastAlertAtMs: number | null = null;
  let initialTimer: NodeJS.Timeout | null = null;
  let intervalTimer: NodeJS.Timeout | null = null;

  const checkStatus = async (): Promise<BackupStatusResult> => {
    if (checkStatusOverride) {
      return await checkStatusOverride();
    }
    return await computeBackupStatus({
      dataDir: config.dataDir,
      maxAgeHours: config.backupMaxAgeHours,
      nowMs: now(),
    });
  };

  const runCheck = async (): Promise<BackupStatusResult | null> => {
    if (stopped || checking) return null;
    checking = true;
    try {
      const status = await checkStatus();
      const currentMs = now();
      const ageHours = status.lastBackup ? status.lastBackup.ageHours : null;

      if (!status.active) {
        const shouldAlert =
          lastAlertAtMs === null || currentMs - lastAlertAtMs >= BACKUP_ALERT_COOLDOWN_MS;

        if (shouldAlert) {
          lastAlertAtMs = currentMs;
          isAlertActive = true;

          await stateStore.securityLogger
            .record('backup_stale', {
              details: ageHours !== null ? { ageHours } : undefined,
            })
            .catch(() => {});

          if (!config.isSmtpConfigured()) {
            logger.warn(
              `[BackupWatch] Brak świeżej kopii zapasowej (wiek: ${ageHours !== null ? `${ageHours} h` : 'brak'}); SMTP nie jest skonfigurowane — zapisano wyłącznie zdarzenie.`
            );
          } else {
            const recipients = resolveBackupAlertRecipients(
              config.backupAlertEmails,
              stateStore.getUsers() || []
            );
            if (recipients.length === 0) {
              logger.warn(
                '[BackupWatch] Brak świeżej kopii zapasowej, ale nie znaleziono adresatów alertu.'
              );
            } else {
              const ageText =
                ageHours !== null ? `${ageHours} h temu` : 'brak jakiejkolwiek kopii';
              const subject = 'Alert: brak świeżej kopii zapasowej — Zarządzanie Projektami';
              const text = `Wykryto brak świeżej kopii zapasowej (ostatnia: ${ageText}; próg: ${config.backupMaxAgeHours} h). Zweryfikuj harmonogram wykonywania kopii zapasowych na serwerze.`;
              const html = `<div style="font-family: sans-serif; padding: 20px; color: #1e293b;">
                <h2 style="color: #be123c; margin-top: 0;">Brak świeżej kopii zapasowej</h2>
                <p>Ostatnia kopia zapasowa na serwerze przekroczyła dopuszczalny wiek (${config.backupMaxAgeHours} h): <strong>${ageText}</strong>.</p>
                <p>Zweryfikuj harmonogram kopii zapasowych (cron / skrypt backupu).</p>
              </div>`;

              try {
                await mailer({ to: recipients, subject, text, html });
                logger.warn(
                  `[BackupWatch] Wysłano alert o braku świeżej kopii zapasowej (liczba odbiorców: ${recipients.length}, wiek: ${ageHours ?? 'brak'}).`
                );
              } catch (mailErr: any) {
                logger.error(
                  '[BackupWatch] Błąd wysyłki alertu SMTP o braku kopii zapasowej:',
                  mailErr?.message || mailErr
                );
              }
            }
          }
        }
      } else if (isAlertActive) {
        isAlertActive = false;
        lastAlertAtMs = null;

        await stateStore.securityLogger
          .record('backup_recovered', {
            details: ageHours !== null ? { ageHours } : undefined,
          })
          .catch(() => {});

        if (!config.isSmtpConfigured()) {
          logger.info(
            `[BackupWatch] Kopia zapasowa znów aktualna (wiek: ${ageHours !== null ? `${ageHours} h` : '0 h'}); SMTP nie jest skonfigurowane.`
          );
        } else {
          const recipients = resolveBackupAlertRecipients(
            config.backupAlertEmails,
            stateStore.getUsers() || []
          );
          if (recipients.length > 0) {
            const ageText = ageHours !== null ? `${ageHours} h temu` : 'przed chwilą';
            const subject = 'Zarządzanie Projektami — kopia znów aktualna';
            const text = `Kopia zapasowa na serwerze: kopia znów aktualna (ostatnia kopia: ${ageText}).`;
            const html = `<div style="font-family: sans-serif; padding: 20px; color: #1e293b;">
              <h2 style="color: #047857; margin-top: 0;">Kopia zapasowa znów aktualna</h2>
              <p>Ostatnia kopia zapasowa na serwerze została wykonana prawidłowo (wiek: <strong>${ageText}</strong>).</p>
            </div>`;

            try {
              await mailer({ to: recipients, subject, text, html });
              logger.info(
                `[BackupWatch] Wysłano powiadomienie o powrocie kopii do normy (liczba odbiorców: ${recipients.length}).`
              );
            } catch (mailErr: any) {
              logger.error(
                '[BackupWatch] Błąd wysyłki powiadomienia SMTP o powrocie kopii do normy:',
                mailErr?.message || mailErr
              );
            }
          }
        }
      }

      return status;
    } catch (err: any) {
      logger.error('[BackupWatch] Błąd sprawdzania statusu kopii zapasowej:', err?.message || err);
      return null;
    } finally {
      checking = false;
    }
  };

  if (!disableTimers) {
    initialTimer = setTimeout(() => {
      initialTimer = null;
      if (stopped) return;
      void runCheck();
      intervalTimer = setInterval(() => {
        if (!stopped) {
          void runCheck();
        }
      }, BACKUP_WATCH_INTERVAL_MS);
      intervalTimer.unref?.();
    }, BACKUP_WATCH_INITIAL_DELAY_MS);
    initialTimer.unref?.();
  }

  const stop = () => {
    stopped = true;
    if (initialTimer) {
      clearTimeout(initialTimer);
      initialTimer = null;
    }
    if (intervalTimer) {
      clearInterval(intervalTimer);
      intervalTimer = null;
    }
  };

  return {
    runCheck,
    stop,
  };
}
