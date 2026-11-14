#!/usr/bin/env bash
# ==============================================================================
# Zarządzanie Projektami - Automatyczny Test Przywracania Kopii Zapasowej
# Repozytorium: https://github.com/FraczekMarcin/Zarzadzanie-Projektami
# ==============================================================================
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="${INSTALL_DIR:-$SCRIPT_DIR}"
BACKUP_DIR="${BACKUP_DIR:-${BASE_DIR}/backups}"
ENV_FILE="${ENV_FILE:-${BASE_DIR}/.env}"

TEST_ID="zp_restore_test_$(date +%s)_$$"
TMP_VOLUME="${TEST_ID}_vol"
TMP_CONTAINER="${TEST_ID}_app"
TMP_DIR=$(mktemp -d)
TMP_GZ="${TMP_DIR}/restore.json.gz"
TMP_JSON="${TMP_DIR}/app_state.json"

cleanup() {
    set +e
    docker rm -f "$TMP_CONTAINER" >/dev/null 2>&1 || true
    docker volume rm -f "$TMP_VOLUME" >/dev/null 2>&1 || true
    rm -rf "$TMP_DIR" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Rozpoczynanie testu przywracania kopii zapasowej..."

# 1. Wybór pliku kopii (argument albo najnowsza kopia z BACKUP_DIR)
BACKUP_FILE=""
if [ $# -ge 1 ] && [ -n "${1:-}" ]; then
    BACKUP_FILE="$1"
else
    if [ ! -d "$BACKUP_DIR" ]; then
        echo "BŁĄD: Katalog kopii zapasowych nie istnieje: $BACKUP_DIR" >&2
        exit 1
    fi
    BACKUP_FILE=$(find "$BACKUP_DIR" -maxdepth 1 -type f \( -name "*.json.gz" -o -name "*.json.gz.enc" \) ! -name ".*" ! -name "*.tmp*" | sort -r | head -n 1 || true)
fi

if [ -z "$BACKUP_FILE" ] || [ ! -f "$BACKUP_FILE" ]; then
    echo "BŁĄD: Nie znaleziono pliku kopii zapasowej do przetestowania (${BACKUP_FILE:-$BACKUP_DIR})." >&2
    exit 1
fi

echo "Testowana kopia: $BACKUP_FILE"

# 2. Odszyfrowanie (jeśli .enc) oraz rozpakowanie
IS_ENCRYPTED="nie"
if [[ "$BACKUP_FILE" == *.enc ]]; then
    IS_ENCRYPTED="tak"
    if [ -z "${BACKUP_PASSPHRASE_FILE:-}" ]; then
        echo "BŁĄD: Kopia jest zaszyfrowana (.enc), ale zmienna BACKUP_PASSPHRASE_FILE nie została ustawiona." >&2
        exit 1
    fi
    if [ ! -f "$BACKUP_PASSPHRASE_FILE" ] || [ ! -s "$BACKUP_PASSPHRASE_FILE" ]; then
        echo "BŁĄD: Plik hasła BACKUP_PASSPHRASE_FILE ('$BACKUP_PASSPHRASE_FILE') nie istnieje lub jest pusty." >&2
        exit 1
    fi
    if ! command -v openssl >/dev/null 2>&1; then
        echo "BŁĄD: Brak narzędzia openssl do odszyfrowania kopii." >&2
        exit 1
    fi
    if ! openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass "file:${BACKUP_PASSPHRASE_FILE}" -in "$BACKUP_FILE" -out "$TMP_GZ"; then
        echo "BŁĄD: Nie udało się odszyfrować pliku kopii (nieprawidłowy klucz lub uszkodzony plik)." >&2
        exit 1
    fi
else
    cp "$BACKUP_FILE" "$TMP_GZ"
fi

if ! gzip -t "$TMP_GZ" >/dev/null 2>&1; then
    echo "BŁĄD: Archiwum gzip jest uszkodzone (gzip -t nie powiódł się)." >&2
    exit 1
fi

gzip -dc "$TMP_GZ" > "$TMP_JSON"

if [ ! -s "$TMP_JSON" ]; then
    echo "BŁĄD: Rozpakowany plik app_state.json jest pusty." >&2
    exit 1
fi

# 3. Walidacja poprawności JSON (jq lub node)
if command -v jq >/dev/null 2>&1; then
    if ! jq empty "$TMP_JSON" >/dev/null 2>&1; then
        echo "BŁĄD: Rozpakowany plik nie jest poprawnym dokumentem JSON (jq empty zwróciło błąd)." >&2
        exit 1
    fi
elif command -v node >/dev/null 2>&1; then
    if ! node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" "$TMP_JSON" 2>/dev/null; then
        echo "BŁĄD: Rozpakowany plik nie jest poprawnym dokumentem JSON (node JSON.parse zwrócił błąd)." >&2
        exit 1
    fi
else
    echo "BŁĄD: Wymagane narzędzie jq lub node do weryfikacji JSON." >&2
    exit 1
fi

# 4. Wczytanie APP_SECRET z pliku .env
if [ ! -f "$ENV_FILE" ]; then
    echo "BŁĄD: Brak pliku .env w '$ENV_FILE' — nie można odczytać APP_SECRET." >&2
    exit 1
fi

APP_SECRET=$(grep -E '^APP_SECRET=' "$ENV_FILE" | tail -n 1 | cut -d'=' -f2- | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" || true)
if [ -z "$APP_SECRET" ]; then
    echo "BŁĄD: Brak zmiennej APP_SECRET w pliku $ENV_FILE." >&2
    exit 1
fi

# 5. Ustalenie nazwy obrazu aplikacji z docker compose images
if ! command -v docker >/dev/null 2>&1; then
    echo "BŁĄD: Polecenie docker nie jest dostępne." >&2
    exit 1
fi

APP_IMAGE=$(cd "$BASE_DIR" && docker compose images app 2>/dev/null | awk 'NR==2 && $2 != "" { if ($3 != "" && $3 != "<none>") print $2":"$3; else print $4 }' || true)
if [ -z "$APP_IMAGE" ]; then
    APP_IMAGE=$(cd "$BASE_DIR" && docker compose images -q app 2>/dev/null | head -n 1 || true)
fi

if [ -z "$APP_IMAGE" ]; then
    echo "BŁĄD: Brak zbudowanego obrazu aplikacji w 'docker compose images' (usługa app). Zbuduj najpierw obraz poleceniem: docker compose build" >&2
    exit 1
fi

echo "Obraz aplikacji: $APP_IMAGE"

# 6. Utworzenie tymczasowego wolumenu Dockera i skopiowanie app_state.json przez kontener alpine
docker volume create "$TMP_VOLUME" >/dev/null
docker run --rm \
    -v "${TMP_VOLUME}:/data" \
    -v "${TMP_JSON}:/tmp/app_state.json:ro" \
    alpine:3 \
    sh -c 'cp /tmp/app_state.json /data/app_state.json && chown -R 1001:1001 /data && chmod 600 /data/app_state.json'

# 7. Uruchomienie tymczasowego kontenera bez publikowania portów
docker run -d \
    --name "$TMP_CONTAINER" \
    --read-only \
    --tmpfs /tmp \
    -e NODE_ENV=production \
    -e DATA_DIR=/app/data \
    -e APP_SECRET="$APP_SECRET" \
    -v "${TMP_VOLUME}:/app/data" \
    "$APP_IMAGE" >/dev/null

# 8. Oczekiwanie na /api/health przez docker exec i wget (maks. 30 s)
HEALTH_OK=0
HEALTH_BODY=""
for _ in $(seq 1 30); do
    IS_RUNNING=$(docker inspect -f '{{.State.Running}}' "$TMP_CONTAINER" 2>/dev/null || echo "false")
    if [ "$IS_RUNNING" != "true" ]; then
        echo "BŁĄD: Tymczasowy kontener testowy zatrzymał się przedwcześnie!" >&2
        docker logs "$TMP_CONTAINER" >&2 || true
        exit 1
    fi

    HEALTH_BODY=$(docker exec "$TMP_CONTAINER" wget -qO- http://localhost:3000/api/health 2>/dev/null || true)
    if echo "$HEALTH_BODY" | grep -q '"status":"ok"'; then
        HEALTH_OK=1
        break
    fi
    sleep 1
done

LOGS=$(docker logs "$TMP_CONTAINER" 2>&1 || true)

if [ "$HEALTH_OK" -ne 1 ]; then
    echo "BŁĄD: Endpoint /api/health nie zwrócił statusu ok w ciągu 30 s." >&2
    echo "$LOGS" >&2
    exit 1
fi

# 9. Weryfikacja braku błędów odszyfrowania sekretów oraz odczyt statystyk z logów
if echo "$LOGS" | grep -qiE 'APP_SECRET nie pasuje|nie można było odszyfrować|Błąd odszyfrowania|Error reading app_state\.json'; then
    echo "BŁĄD: Wykryto błąd odszyfrowania sekretów lub wczytywania app_state.json w logach kontenera!" >&2
    echo "$LOGS" >&2
    exit 1
fi

LOADED_LINE=$(echo "$LOGS" | grep 'Loaded persistent state from' | tail -n 1 || true)
TASKS_COUNT=$(echo "$LOADED_LINE" | sed -nE 's/.*\(([0-9]+) tasks.*/\1/p')
USERS_COUNT=$(echo "$LOADED_LINE" | sed -nE 's/.*tasks, ([0-9]+) users.*/\1/p')

if [ -z "$LOADED_LINE" ]; then
    echo "BŁĄD: W logach kontenera nie znaleziono potwierdzenia wczytania app_state.json." >&2
    echo "$LOGS" >&2
    exit 1
fi

echo "================================================================="
echo "  TEST PRZYWRACANIA KOPII ZAPASOWEJ: SUKCES"
echo "================================================================="
echo "  Plik kopii:              $BACKUP_FILE"
echo "  Kopia zaszyfrowana:      $IS_ENCRYPTED"
echo "  Obraz aplikacji:         $APP_IMAGE"
echo "  /api/health:             ok"
echo "  Sekrety 2FA (APP_SECRET): poprawne"
echo "  Liczba zadań:            ${TASKS_COUNT:-0}"
echo "  Liczba użytkowników:     ${USERS_COUNT:-0}"
echo "================================================================="
exit 0
