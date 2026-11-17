import fs from 'fs';
import { resolveBackupAlertRecipients } from './backupWatch.js';
import type { ServerConfig } from './config.js';
import { logger } from './logger.js';
import type { MailerService } from './mailer.js';
import type { StateStore } from './state.js';

export const DISK_WATCH_INITIAL_DELAY_MS = 2 * 60 * 1000;
export const DISK_WATCH_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const DISK_ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const DISK_WARN_PERCENT = 15;
export const DISK_CRITICAL_PERCENT = 5;
export const DISK_CRITICAL_MIN_MB = 200;

export interface DiskStatus {
  freeBytes: number;
  totalBytes: number;
  freePercent: number;
}

export type DiskLevel = 'ok' | 'warn' | 'critical';

export interface DiskStatusWithLevel extends DiskStatus {
  level: DiskLevel;
}

export interface DiskAlertEmailPayload {
  to: string[];
  subject: string;
  text: string;
  html: string;
}

export type DiskAlertMailer = (mail: DiskAlertEmailPayload) => Promise<void>;

export type StatfsFn = (targetPath: string) => Promise<{
  bsize: number;
  blocks: number;
  bavail: number;
  bfree?: number;
}>;

export interface DiskWatchService {
  runCheck: () => Promise<DiskStatus | null>;
  stop: () => void;
}

export async function getDiskStatus(
  dir: string,
  statfsFn?: StatfsFn
): Promise<DiskStatus | null> {
  if (!dir || typeof dir !== 'string') return null;
  try {
    const fn: StatfsFn = statfsFn ?? ((p) => fs.promises.statfs(p) as any);
    const stats = await fn(dir);
    if (!stats) return null;

    const bsize = Number(stats.bsize);
    const blocks = Number(stats.blocks);
    const availBlocks =
      stats.bavail !== undefined && Number.isFinite(Number(stats.bavail))
        ? Number(stats.bavail)
        : Number(stats.bfree);

    if (
      !Number.isFinite(bsize) ||
      !Number.isFinite(blocks) ||
      !Number.isFinite(availBlocks) ||
      bsize <= 0 ||
      blocks <= 0 ||
      availBlocks < 0
    ) {
      return null;
    }

    const totalBytes = Math.round(blocks * bsize);
    const freeBytes = Math.min(totalBytes, Math.max(0, Math.round(availBlocks * bsize)));
    const freePercent =
      totalBytes > 0
        ? Math.min(100, Math.max(0, Math.round((freeBytes / totalBytes) * 1000) / 10))
        : 0;

    return {
      freeBytes,
      totalBytes,
      freePercent,
    };
  } catch {
    return null;
  }
}

export function classifyDiskLevel(status: DiskStatus): DiskLevel {
  const criticalMinBytes = DISK_CRITICAL_MIN_MB * 1024 * 1024;
  if (status.freePercent < DISK_CRITICAL_PERCENT || status.freeBytes < criticalMinBytes) {
    return 'critical';
  }
  if (status.freePercent < DISK_WARN_PERCENT) {
    return 'warn';
  }
  return 'ok';
}

export function isDiskLowForAlert(
  status: DiskStatus,
  thresholdPercent: number,
  thresholdMinMb: number
): boolean {
  const minBytes = thresholdMinMb * 1024 * 1024;
  return status.freePercent < thresholdPercent || status.freeBytes < minBytes;
}

function toFreeMb(freeBytes: number): number {
  return Math.max(0, Math.round(freeBytes / (1024 * 1024)));
}

export function createDiskWatchService(deps: {
  config: ServerConfig;
  stateStore: StateStore;
  mailer?: MailerService;
  disableTimers?: boolean;
  checkStatusOverride?: () => Promise<DiskStatus | null>;
  mailerOverride?: DiskAlertMailer;
  now?: () => number;
}): DiskWatchService {
  const { config, stateStore, disableTimers, checkStatusOverride, mailerOverride } = deps;
  const now = deps.now ?? (() => Date.now());
  const isMailConfigured = () =>
    deps.mailer ? deps.mailer.isMailConfigured() : config.isSmtpConfigured();

  const sendAlertMail: DiskAlertMailer | null = mailerOverride
    ? mailerOverride
    : deps.mailer
    ? (payload) => deps.mailer!.sendMail(payload)
    : null;

  let stopped = false;
  let checking = false;
  let isAlertActive = false;
  let lastAlertAtMs: number | null = null;
  let initialTimer: NodeJS.Timeout | null = null;
  let intervalTimer: NodeJS.Timeout | null = null;

  const checkDisk = async (): Promise<DiskStatus | null> => {
    if (checkStatusOverride) {
      return await checkStatusOverride();
    }
    return await getDiskStatus(config.dataDir);
  };

  const runCheck = async (): Promise<DiskStatus | null> => {
    if (stopped || checking) return null;
    checking = true;
    try {
      const status = await checkDisk();
      if (!status) {
        return null;
      }

      const currentMs = now();
      const freeMb = toFreeMb(status.freeBytes);
      const low = isDiskLowForAlert(
        status,
        config.diskAlertPercent,
        config.diskAlertMinMb
      );

      if (low) {
        const shouldAlert =
          lastAlertAtMs === null || currentMs - lastAlertAtMs >= DISK_ALERT_COOLDOWN_MS;

        if (shouldAlert) {
          lastAlertAtMs = currentMs;
          isAlertActive = true;

          await stateStore.securityLogger
            .record('disk_low', {
              details: {
                freePercent: status.freePercent,
                freeMb,
              },
            })
            .catch(() => {});

          if (!isMailConfigured() || !sendAlertMail) {
            logger.warn(
              `[DiskWatch] Mało miejsca na dysku serwera (wolne: ${status.freePercent}%, ${freeMb} MB); SMTP nie jest skonfigurowane — zapisano wyłącznie zdarzenie.`
            );
          } else {
            const recipients = resolveBackupAlertRecipients(
              config.backupAlertEmails,
              stateStore.getUsers() || []
            );
            if (recipients.length === 0) {
              logger.warn(
                '[DiskWatch] Mało miejsca na dysku serwera, ale nie znaleziono adresatów alertu.'
              );
            } else {
              const subject = 'Alert: mało miejsca na dysku serwera — Zarządzanie Projektami';
              const text =
                `Wykryto niski poziom wolnego miejsca na dysku serwera: pozostało ${status.freePercent}% (${freeMb} MB).\n` +
                `Progi alertu: poniżej ${config.diskAlertPercent}% lub ${config.diskAlertMinMb} MB.\n` +
                `Zalecane sprawdzenie zajętości dysku oraz bezpieczne usunięcie nieużywanych obrazów i cache budowania Docker (docker image prune -f).`;
              const html = `<div style="font-family: sans-serif; padding: 20px; color: #1e293b;">
                <h2 style="color: #be123c; margin-top: 0;">Mało miejsca na dysku serwera</h2>
                <p>Wolne miejsce na dysku serwera spadło poniżej progu ostrzegawczego (${config.diskAlertPercent}% lub ${config.diskAlertMinMb} MB): pozostało <strong>${status.freePercent}% (${freeMb} MB)</strong>.</p>
                <p>Zwolnij miejsce na serwerze (np. usuwając nieużywane obrazy przez <code>docker image prune -f</code>), aby uniknąć błędów zapisu stanu.</p>
              </div>`;

              try {
                await sendAlertMail({ to: recipients, subject, text, html });
                logger.warn(
                  `[DiskWatch] Wysłano alert o niskim miejscu na dysku (liczba odbiorców: ${recipients.length}, wolne: ${status.freePercent}%, ${freeMb} MB).`
                );
              } catch (mailErr: any) {
                logger.error(
                  '[DiskWatch] Błąd wysyłki alertu SMTP o niskim miejscu na dysku:',
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
          .record('disk_recovered', {
            details: {
              freePercent: status.freePercent,
              freeMb,
            },
          })
          .catch(() => {});

        if (!isMailConfigured() || !sendAlertMail) {
          logger.info(
            `[DiskWatch] Na dysku serwera miejsca znów wystarcza (wolne: ${status.freePercent}%, ${freeMb} MB); SMTP nie jest skonfigurowane.`
          );
        } else {
          const recipients = resolveBackupAlertRecipients(
            config.backupAlertEmails,
            stateStore.getUsers() || []
          );
          if (recipients.length > 0) {
            const subject = 'Zarządzanie Projektami — miejsca znów wystarcza';
            const text = `Na dysku serwera miejsca znów wystarcza (wolne: ${status.freePercent}%, ${freeMb} MB).`;
            const html = `<div style="font-family: sans-serif; padding: 20px; color: #1e293b;">
              <h2 style="color: #047857; margin-top: 0;">Miejsce na dysku wróciło do normy</h2>
              <p>Na dysku serwera <strong>miejsca znów wystarcza</strong> (wolne: <strong>${status.freePercent}% / ${freeMb} MB</strong>).</p>
            </div>`;

            try {
              await sendAlertMail({ to: recipients, subject, text, html });
              logger.info(
                `[DiskWatch] Wysłano powiadomienie o powrocie miejsca na dysku do normy (liczba odbiorców: ${recipients.length}).`
              );
            } catch (mailErr: any) {
              logger.error(
                '[DiskWatch] Błąd wysyłki powiadomienia SMTP o powrocie miejsca na dysku do normy:',
                mailErr?.message || mailErr
              );
            }
          }
        }
      }

      return status;
    } catch (err: any) {
      logger.error('[DiskWatch] Błąd sprawdzania wolnego miejsca na dysku:', err?.message || err);
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
      }, DISK_WATCH_INTERVAL_MS);
      intervalTimer.unref?.();
    }, DISK_WATCH_INITIAL_DELAY_MS);
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
