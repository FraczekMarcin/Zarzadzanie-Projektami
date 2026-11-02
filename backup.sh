#!/usr/bin/env bash
# ==============================================================================
# Zarządzanie Projektami - Kopia Zapasowa Pliku Stanu (app_state.json)
# Wersja: 2026-11-02 v 0.4.0
# Repozytorium: https://github.com/FraczekMarcin/Zarzadzanie-Projektami
# ==============================================================================
set -Eeuo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/zarzadzanie-projektami}"
BACKUP_DIR="${BACKUP_DIR:-${INSTALL_DIR}/backups}"
CONTAINER_NAME="${CONTAINER_NAME:-zarzadzanie_app}"
TIMESTAMP=$(date +"%Y-%m-%d_%H%M%S")
FILENAME="app_state_${TIMESTAMP}.json.gz"
TARGET_GZ="${BACKUP_DIR}/${FILENAME}"
TMP_JSON="${BACKUP_DIR}/.app_state_${TIMESTAMP}.tmp.json"
TMP_GZ="${BACKUP_DIR}/.app_state_${TIMESTAMP}.tmp.gz"
MIN_KEEP=7
RETENTION_DAYS=14

# Sprzątanie plików tymczasowych w razie błędu lub wyjścia
cleanup() {
    rm -f "$TMP_JSON" "$TMP_GZ" 2>/dev/null || true
}
trap cleanup EXIT ERR

mkdir -p "$BACKUP_DIR"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Rozpoczynanie kopii zapasowej pliku stanu z kontenera '$CONTAINER_NAME'..."

# Sprawdzenie czy kontener istnieje i działa
if ! docker inspect --type=container "$CONTAINER_NAME" >/dev/null 2>&1; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] BŁĄD: Kontener '$CONTAINER_NAME' nie istnieje lub nie jest dostępny!" >&2
    exit 1
fi

# Pobranie app_state.json z kontenera
docker exec "$CONTAINER_NAME" cat /app/data/app_state.json > "$TMP_JSON"

# 1. Sprawdzenie czy plik tymczasowy istnieje
if [ ! -f "$TMP_JSON" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] BŁĄD: Plik tymczasowy nie został utworzony!" >&2
    exit 1
fi

# 2. Sprawdzenie rozmiaru (> 100 bajtów)
FILE_SIZE=$(wc -c < "$TMP_JSON" | tr -d ' ')
if [ "$FILE_SIZE" -le 100 ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] BŁĄD: Plik stanu jest zbyt mały ($FILE_SIZE bajtów <= 100 bajtów) lub pusty!" >&2
    exit 1
fi

# 3. Sprawdzenie poprawności JSON (jq empty)
if command -v jq >/dev/null 2>&1; then
    if ! jq empty "$TMP_JSON" >/dev/null 2>&1; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] BŁĄD: Wygenerowany plik nie jest poprawnym formatem JSON (jq empty zwróciło błąd)!" >&2
        exit 1
    fi
else
    if command -v node >/dev/null 2>&1; then
        node -e "JSON.parse(require('fs').readFileSync(process.argv[1]))" "$TMP_JSON"
    fi
fi

# 4. Kompresja gzip
gzip -c "$TMP_JSON" > "$TMP_GZ"

# 5. Sprawdzenie integralności archiwum gzip (gzip -t)
if ! gzip -t "$TMP_GZ" >/dev/null 2>&1; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] BŁĄD: Test integralności gzip -t nie powiódł się!" >&2
    exit 1
fi

# Przeniesienie pliku do docelowej lokalizacji
mv "$TMP_GZ" "$TARGET_GZ"
chmod 600 "$TARGET_GZ"
rm -f "$TMP_JSON"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Kopia zapasowa utworzona pomyślnie: $TARGET_GZ ($(wc -c < "$TARGET_GZ" | tr -d ' ') bajtów)"

# 6. Rotacja: tylko jeśli nowa kopia powstała poprawnie i zawsze zostawiamy minimum 7 ostatnich kopii
mapfile -t ALL_BACKUPS < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name "app_state_*.json.gz" | sort -r)
COUNT=${#ALL_BACKUPS[@]}

if [ "$COUNT" -gt "$MIN_KEEP" ]; then
    for ((i=MIN_KEEP; i<COUNT; i++)); do
        OLD_FILE="${ALL_BACKUPS[$i]}"
        if [ -n "$(find "$OLD_FILE" -mtime +$RETENTION_DAYS -print 2>/dev/null)" ]; then
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] Rotacja: usuwanie kopii starszej niż $RETENTION_DAYS dni: $OLD_FILE"
            rm -f "$OLD_FILE"
        fi
    done
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Zakończono pomyślnie. Zachowano $COUNT kopii (minimum $MIN_KEEP)."
