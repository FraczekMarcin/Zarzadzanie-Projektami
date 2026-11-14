import { Project, Task, User, Comment, ActivityLog } from '../types';
import { sanitizeUsersForBackup } from './authSecurity';
import { CURRENT_APP_VERSION } from '../data/dockerConfig';

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
    version: CURRENT_APP_VERSION,
    exportedAt: timestamp,
    appName: 'Zarządzanie Projektami',
    projects: payload.projects,
    tasks: payload.tasks,
    users: sanitizeUsersForBackup(payload.users),
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
 * Generates ready-to-run Linux cron script for host server Docker automatic backups of app_state.json
 */
export function generateLinuxCronBackupScript(): string {
  return `#!/usr/bin/env bash
# ==============================================================================
# Zarządzanie Projektami - Kopia Zapasowa Pliku Stanu (app_state.json)
# Wersja: ${CURRENT_APP_VERSION}
# Repozytorium: https://github.com/FraczekMarcin/Zarzadzanie-Projektami
# Ścieżka docelowa: /opt/zarzadzanie-projektami/backup.sh
# ==============================================================================
set -Eeuo pipefail

INSTALL_DIR="\${INSTALL_DIR:-/opt/zarzadzanie-projektami}"
BACKUP_DIR="\${BACKUP_DIR:-\${INSTALL_DIR}/backups}"
CONTAINER_NAME="\${CONTAINER_NAME:-zarzadzanie_app}"
TIMESTAMP=\$(date +"%Y-%m-%d_%H%M%S")
FILENAME="app_state_\${TIMESTAMP}.json.gz"
TARGET_GZ="\${BACKUP_DIR}/\${FILENAME}"
TMP_JSON="\${BACKUP_DIR}/.app_state_\${TIMESTAMP}.tmp.json"
TMP_GZ="\${BACKUP_DIR}/.app_state_\${TIMESTAMP}.tmp.gz"
MIN_KEEP=7
RETENTION_DAYS=14

cleanup() {
    rm -f "\$TMP_JSON" "\$TMP_GZ" 2>/dev/null || true
}
trap cleanup EXIT ERR

mkdir -p "\$BACKUP_DIR"

if ! docker inspect --type=container "\$CONTAINER_NAME" >/dev/null 2>&1; then
    echo "[\$(date '+%Y-%m-%d %H:%M:%S')] BŁĄD: Kontener '\$CONTAINER_NAME' nie istnieje lub nie jest dostępny!" >&2
    exit 1
fi

docker exec "\$CONTAINER_NAME" cat /app/data/app_state.json > "\$TMP_JSON"

if [ ! -f "\$TMP_JSON" ] || [ \$(wc -c < "\$TMP_JSON" | tr -d ' ') -le 100 ]; then
    echo "[\$(date '+%Y-%m-%d %H:%M:%S')] BŁĄD: Plik stanu jest pusty lub zbyt mały!" >&2
    exit 1
fi

if command -v jq >/dev/null 2>&1; then
    if ! jq empty "\$TMP_JSON" >/dev/null 2>&1; then
        echo "[\$(date '+%Y-%m-%d %H:%M:%S')] BŁĄD: Niepoprawny format JSON!" >&2
        exit 1
    fi
fi

gzip -c "\$TMP_JSON" > "\$TMP_GZ"

if ! gzip -t "\$TMP_GZ" >/dev/null 2>&1; then
    echo "[\$(date '+%Y-%m-%d %H:%M:%S')] BŁĄD: Test integralności gzip -t nie powiódł się!" >&2
    exit 1
fi

mv "\$TMP_GZ" "\$TARGET_GZ"
chmod 600 "\$TARGET_GZ"
rm -f "\$TMP_JSON"

mapfile -t ALL_BACKUPS < <(find "\$BACKUP_DIR" -maxdepth 1 -type f -name "app_state_*.json.gz" | sort -r)
COUNT=\${#ALL_BACKUPS[@]}

if [ "\$COUNT" -gt "\$MIN_KEEP" ]; then
    for ((i=MIN_KEEP; i<COUNT; i++)); do
        OLD_FILE="\${ALL_BACKUPS[\$i]}"
        if [ -n "\$(find "\$OLD_FILE" -mtime +\$RETENTION_DAYS -print 2>/dev/null)" ]; then
            rm -f "\$OLD_FILE"
        fi
    done
fi

echo "[\$(date '+%Y-%m-%d %H:%M:%S')] Kopia zapasowa gotowa: \$TARGET_GZ"
`;
}
