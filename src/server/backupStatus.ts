import fs from 'fs';
import path from 'path';
import { parseBackupFilename } from '../utils/backupFiles.js';
import { logger } from './logger.js';

export const DEFAULT_BACKUP_MAX_AGE_HOURS = 36;

export interface BackupLastInfo {
  filename: string;
  timestamp: string;
  ageHours: number;
  size: number;
  encrypted: boolean;
}

export interface BackupStatusResult {
  active: boolean;
  lastBackup: BackupLastInfo | null;
  totalBackups?: number;
  maxAgeHours: number;
  message: string;
}

export interface ComputeBackupStatusOptions {
  dataDir: string;
  backupDir?: string;
  maxAgeHours?: number;
  nowMs?: number;
}

export async function computeBackupStatus(
  options: ComputeBackupStatusOptions
): Promise<BackupStatusResult> {
  const maxAgeHours =
    typeof options.maxAgeHours === 'number' && Number.isFinite(options.maxAgeHours) && options.maxAgeHours > 0
      ? options.maxAgeHours
      : DEFAULT_BACKUP_MAX_AGE_HOURS;

  const candidateDirs = [
    options.backupDir ?? process.env.BACKUP_DIR,
    '/opt/zarzadzanie-projektami/backups',
    path.resolve(options.dataDir, '..', 'backups'),
    path.resolve(options.dataDir, 'backups'),
    path.resolve(process.cwd(), 'backups'),
  ].filter(Boolean) as string[];

  interface BackupFileInfo {
    filename: string;
    mtime: Date;
    size: number;
    encrypted: boolean;
  }

  const seenDirs = new Set<string>();
  const foundBackups: BackupFileInfo[] = [];

  for (const dir of candidateDirs) {
    const resolvedDir = path.resolve(dir);
    if (seenDirs.has(resolvedDir)) continue;
    seenDirs.add(resolvedDir);

    try {
      const stat = await fs.promises.stat(dir).catch(() => null);
      if (stat && stat.isDirectory()) {
        const files = await fs.promises.readdir(dir);
        for (const file of files) {
          const parsed = parseBackupFilename(file);
          if (parsed.isBackup) {
            const fullPath = path.join(dir, file);
            const fileStat = await fs.promises.stat(fullPath).catch(() => null);
            if (fileStat && fileStat.isFile()) {
              foundBackups.push({
                filename: file,
                mtime: fileStat.mtime,
                size: fileStat.size,
                encrypted: parsed.encrypted,
              });
            }
          }
        }
      }
    } catch (readErr) {
      logger.warn('[Server] Błąd odczytu katalogu kopii:', readErr);
    }
  }

  if (foundBackups.length === 0) {
    return {
      active: false,
      lastBackup: null,
      maxAgeHours,
      message: 'Brak kopii zapasowej na serwerze',
    };
  }

  foundBackups.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  const newest = foundBackups[0];
  const nowMs = options.nowMs ?? Date.now();
  const ageMs = nowMs - newest.mtime.getTime();
  const ageHours = Math.max(0, ageMs / (1000 * 60 * 60));
  const isRecent = ageHours <= maxAgeHours;

  return {
    active: isRecent,
    lastBackup: {
      filename: newest.filename,
      timestamp: newest.mtime.toISOString(),
      ageHours: Math.round(ageHours * 10) / 10,
      size: newest.size,
      encrypted: newest.encrypted,
    },
    totalBackups: foundBackups.length,
    maxAgeHours,
    message: isRecent
      ? `Ostatnia kopia wykonana pomyślnie w ciągu ostatnich ${maxAgeHours}h`
      : `Ostatnia kopia zapasowa jest starsza niż ${maxAgeHours}h (${Math.round(ageHours)}h temu)`,
  };
}
