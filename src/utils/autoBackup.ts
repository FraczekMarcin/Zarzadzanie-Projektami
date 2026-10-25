import { Project, Task, User, Comment, ActivityLog } from '../types';

export interface AutoBackupConfig {
  enabled: boolean;
  intervalMinutes: number; // 15, 60, 360, 1440 (daily)
  retentionCount: number; // e.g. 5, 10, 20
  lastBackupTime?: string;
  autoDownloadOnSchedule?: boolean;
}

export interface AutoBackupSnapshot {
  id: string;
  timestamp: string;
  filename: string;
  projectsCount: number;
  tasksCount: number;
  sizeBytes: number;
  data: {
    version: string;
    exportedAt: string;
    appName: string;
    projects: Project[];
    tasks: Task[];
    users?: User[];
    comments?: Comment[];
    activityLogs?: ActivityLog[];
  };
}

const CONFIG_KEY = 'oph_auto_backup_config';
const SNAPSHOTS_KEY = 'oph_auto_backups';

export const DEFAULT_AUTO_BACKUP_CONFIG: AutoBackupConfig = {
  enabled: true,
  intervalMinutes: 60, // co 1 godzinę
  retentionCount: 10,  // zachowaj 10 ostatnich kopii
  autoDownloadOnSchedule: false,
};

export function getAutoBackupConfig(): AutoBackupConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return DEFAULT_AUTO_BACKUP_CONFIG;
    return { ...DEFAULT_AUTO_BACKUP_CONFIG, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_AUTO_BACKUP_CONFIG;
  }
}

export function saveAutoBackupConfig(config: AutoBackupConfig): void {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch (err) {
    console.warn('Nie udało się zapisać konfiguracji auto-kopii:', err);
  }
}

export function getAutoBackupSnapshots(): AutoBackupSnapshot[] {
  try {
    const raw = localStorage.getItem(SNAPSHOTS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function createAutoBackupSnapshot(payload: {
  projects: Project[];
  tasks: Task[];
  users: User[];
  comments: Comment[];
  activityLogs: ActivityLog[];
}): AutoBackupSnapshot {
  const now = new Date();
  const timestamp = now.toISOString();
  const dateSlug = timestamp.slice(0, 10);
  const timeSlug = timestamp.slice(11, 19).replace(/:/g, '-');
  const filename = `zarzadzanie-projektami-autobackup-${dateSlug}_${timeSlug}.json`;

  const snapshotData = {
    version: '2026-10-25 v 0.2',
    exportedAt: timestamp,
    appName: 'Zarządzanie Projektami',
    projects: payload.projects,
    tasks: payload.tasks,
    users: payload.users,
    comments: payload.comments,
    activityLogs: payload.activityLogs,
  };

  const jsonString = JSON.stringify(snapshotData);
  const sizeBytes = new Blob([jsonString]).size;

  const newSnapshot: AutoBackupSnapshot = {
    id: `auto-bk-${Date.now()}`,
    timestamp,
    filename,
    projectsCount: payload.projects.length,
    tasksCount: payload.tasks.length,
    sizeBytes,
    data: snapshotData,
  };

  const config = getAutoBackupConfig();
  const existing = getAutoBackupSnapshots();

  // Add new and apply retention count policy
  const updated = [newSnapshot, ...existing].slice(0, config.retentionCount || 10);

  try {
    localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(updated));
    config.lastBackupTime = timestamp;
    saveAutoBackupConfig(config);
  } catch (err) {
    console.warn('Błąd zapisu migawki auto-kopii (możliwe przepełnienie localStorage):', err);
    // If quota exceeded, retain fewer snapshots
    try {
      const reduced = [newSnapshot, ...existing.slice(0, 3)];
      localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(reduced));
    } catch {}
  }

  return newSnapshot;
}

export function deleteAutoBackupSnapshot(id: string): AutoBackupSnapshot[] {
  const existing = getAutoBackupSnapshots();
  const filtered = existing.filter((s) => s.id !== id);
  try {
    localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(filtered));
  } catch {}
  return filtered;
}

export function clearAllAutoBackupSnapshots(): void {
  try {
    localStorage.removeItem(SNAPSHOTS_KEY);
  } catch {}
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Generates ready-to-run Linux cron script for host server Docker PostgreSQL automatic backups
 */
export function generateLinuxCronBackupScript(): string {
  return `#!/usr/bin/env bash
# ==============================================================================
# Zarządzanie Projektami - Skrypt Automatycznej Kopii Zapasowej PostgreSQL
# Wersja: 2026-10-25 v 0.2
# Repozytorium: https://github.com/FraczekMarcin/Zarzadzanie-Projektami
# ==============================================================================
set -e

BACKUP_DIR="/opt/zarzadzanie-projektami/backups"
TIMESTAMP=$(date +"%Y-%m-%d_%H%M%S")
FILENAME="zarzadzanie_db_backup_\${TIMESTAMP}.sql.gz"
CONTAINER_NAME="zarzadzanie_db"
DB_NAME="zarzadzanie_db"
DB_USER="zarzadzanie"
RETENTION_DAYS=14

# 1. Upewnij się, że katalog kopii istnieje
mkdir -p "\$BACKUP_DIR"

# 2. Wykonaj zrzut bazy z kontenera Docker i skompresuj gzipem
echo "[$(date)] Rozpoczynanie automatycznej kopii bazy PostgreSQL..."
docker exec -t "\$CONTAINER_NAME" pg_dump -U "\$DB_USER" "\$DB_NAME" | gzip > "\$BACKUP_DIR/\$FILENAME"

# 3. Ustaw bezpieczne uprawnienia pliku (tylko odczyt właściciela)
chmod 600 "\$BACKUP_DIR/\$FILENAME"

# 4. Automatyczna retencja: usuwanie kopii starszych niż 14 dni
find "\$BACKUP_DIR" -type f -name "zarzadzanie_db_backup_*.sql.gz" -mtime +\$RETENTION_DAYS -delete

echo "[$(date)] Kopia zapasowa utworzona pomyślnie: \$BACKUP_DIR/\$FILENAME"
`;
}
