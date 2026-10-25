#!/usr/bin/env bash
# ==============================================================================
# Zarządzanie Projektami - Automatyczna Kopia Zapasowa PostgreSQL (Cron)
# Wersja: 2026-10-25 v 0.2.1
# Repozytorium: https://github.com/FraczekMarcin/Zarzadzanie-Projektami
# Ścieżka: Instalacja/backup.sh
# ==============================================================================
set -e

INSTALL_DIR="/opt/zarzadzanie-projektami"
BACKUP_DIR="${INSTALL_DIR}/backups"
TIMESTAMP=$(date +"%Y-%m-%d_%H%M%S")
FILENAME="zarzadzanie_backup_${TIMESTAMP}.sql.gz"
CONTAINER_NAME="zarzadzanie_db"
DB_USER="zarzadzanie"
DB_NAME="zarzadzanie_db"
RETENTION_DAYS=14

mkdir -p "$BACKUP_DIR"

echo "[$(date)] Tworzenie automatycznej kopii zapasowej bazy PostgreSQL..."
docker exec -t "$CONTAINER_NAME" pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$BACKUP_DIR/$FILENAME"
chmod 600 "$BACKUP_DIR/$FILENAME"

# Rotacja: usuwanie kopii starszych niż 14 dni
find "$BACKUP_DIR" -type f -name "zarzadzanie_backup_*.sql.gz" -mtime +$RETENTION_DAYS -delete

echo "[$(date)] Kopia zapasowa gotowa: $BACKUP_DIR/$FILENAME (Zachowano kopie z $RETENTION_DAYS dni)"
