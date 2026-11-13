#!/usr/bin/env bash
# ==============================================================================
# Zarządzanie Projektami - Kopia Zapasowa Pliku Stanu (app_state.json)
# Wersja: 2026-11-13 v0.7.0
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
TMP_ENC="${BACKUP_DIR}/.app_state_${TIMESTAMP}.tmp.enc"
MIN_KEEP="${MIN_KEEP:-7}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

# Sprzątanie plików tymczasowych w razie błędu lub wyjścia
cleanup() {
    rm -f "$TMP_JSON" "$TMP_GZ" "$TMP_ENC" 2>/dev/null || true
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

# 6. Opcjonalne szyfrowanie (jeśli ustawiono BACKUP_PASSPHRASE_FILE) i przeniesienie do docelowej lokalizacji
if [ -n "${BACKUP_PASSPHRASE_FILE:-}" ]; then
    if [ ! -f "$BACKUP_PASSPHRASE_FILE" ] || [ ! -s "$BACKUP_PASSPHRASE_FILE" ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] BŁĄD: Plik hasła BACKUP_PASSPHRASE_FILE ('$BACKUP_PASSPHRASE_FILE') nie istnieje lub jest pusty!" >&2
        exit 1
    fi
    KEY_PERM=$(stat -c "%a" "$BACKUP_PASSPHRASE_FILE" 2>/dev/null || stat -f "%Lp" "$BACKUP_PASSPHRASE_FILE" 2>/dev/null || echo "")
    if [ -n "$KEY_PERM" ] && [ "$KEY_PERM" != "600" ] && [ "$KEY_PERM" != "400" ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] OSTRZEŻENIE: Zalecane uprawnienia dla '$BACKUP_PASSPHRASE_FILE' to 600 (obecne: $KEY_PERM)." >&2
    fi
    if ! command -v openssl >/dev/null 2>&1; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] BŁĄD: Narzędzie openssl nie jest zainstalowane!" >&2
        exit 1
    fi

    FILENAME="app_state_${TIMESTAMP}.json.gz.enc"
    TARGET_FINAL="${BACKUP_DIR}/${FILENAME}"
    openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass "file:${BACKUP_PASSPHRASE_FILE}" -in "$TMP_GZ" -out "$TMP_ENC"
    mv "$TMP_ENC" "$TARGET_FINAL"
    chmod 600 "$TARGET_FINAL"
    rm -f "$TMP_GZ" "$TMP_JSON"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Zaszyfrowana kopia zapasowa utworzona pomyślnie: $TARGET_FINAL ($(wc -c < "$TARGET_FINAL" | tr -d ' ') bajtów)"
else
    TARGET_FINAL="$TARGET_GZ"
    mv "$TMP_GZ" "$TARGET_FINAL"
    chmod 600 "$TARGET_FINAL"
    rm -f "$TMP_JSON"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Kopia zapasowa utworzona pomyślnie: $TARGET_FINAL ($(wc -c < "$TARGET_FINAL" | tr -d ' ') bajtów)"
fi

# 7. Rotacja: obsługuje oba rozszerzenia (.json.gz oraz .json.gz.enc), zawsze zostawia minimum MIN_KEEP kopii
mapfile -t ALL_BACKUPS < <(find "$BACKUP_DIR" -maxdepth 1 -type f \( -name "app_state_*.json.gz" -o -name "app_state_*.json.gz.enc" \) | sort -r)
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

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Zakończono rotację lokalną. Zachowano $COUNT kopii (minimum $MIN_KEEP)."

# 8. Opcjonalna kopia poza serwerem (BACKUP_COPY_DIR / BACKUP_REMOTE)
REMOTE_COPY_FAILED=0

if [ -n "${BACKUP_COPY_DIR:-}" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Kopiowanie kopii do katalogu zewnętrznego (BACKUP_COPY_DIR): $BACKUP_COPY_DIR"
    if ! command -v rsync >/dev/null 2>&1; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] OSTRZEŻENIE: Brak narzędzia rsync — nie skopiowano do BACKUP_COPY_DIR ($BACKUP_COPY_DIR). Kopia lokalna została zachowana." >&2
        REMOTE_COPY_FAILED=1
    elif ! mkdir -p "$BACKUP_COPY_DIR" 2>/dev/null || ! rsync -a "$TARGET_FINAL" "$BACKUP_COPY_DIR/"; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] OSTRZEŻENIE: Nie udało się skopiować kopii do BACKUP_COPY_DIR ($BACKUP_COPY_DIR). Kopia lokalna została zachowana." >&2
        REMOTE_COPY_FAILED=1
    fi
fi

if [ -n "${BACKUP_REMOTE:-}" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Wysyłanie kopii na zdalny serwer (BACKUP_REMOTE): $BACKUP_REMOTE"
    if ! command -v rsync >/dev/null 2>&1; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] OSTRZEŻENIE: Brak narzędzia rsync — nie wysłano do BACKUP_REMOTE ($BACKUP_REMOTE). Kopia lokalna została zachowana." >&2
        REMOTE_COPY_FAILED=1
    elif ! rsync -a -e 'ssh -o BatchMode=yes' "$TARGET_FINAL" "$BACKUP_REMOTE"; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] OSTRZEŻENIE: Nie udało się wysłać kopii na zdalny serwer ($BACKUP_REMOTE). Kopia lokalna została zachowana." >&2
        REMOTE_COPY_FAILED=1
    fi
fi

if [ "$REMOTE_COPY_FAILED" -ne 0 ]; then
    exit 2
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Zakończono pomyślnie."

