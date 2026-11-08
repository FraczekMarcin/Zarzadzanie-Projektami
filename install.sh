#!/usr/bin/env bash
# ==============================================================================
# Zarządzanie Projektami - Pracownia Projektowa / Budownictwo
# Wersja: 2026-11-02 v0.4.0
# Repozytorium: https://github.com/FraczekMarcin/Zarzadzanie-Projektami
# Ścieżka skryptu w repozytorium: install.sh / Instalacja/install.sh
# Lokalizacja docelowa na serwerze: /opt/zarzadzanie-projektami
# ==============================================================================
set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}=================================================================${NC}"
echo -e "${GREEN}  🏗️  Zarządzanie Projektami - Instalator (Wersja 2026-11-02 v0.4.0)${NC}"
echo -e "${BLUE}  Repozytorium: https://github.com/FraczekMarcin/Zarzadzanie-Projektami${NC}"
echo -e "${BLUE}=================================================================${NC}"

# 1. Sprawdzenie uprawnień roota
if [ "$EUID" -ne 0 ]; then
  echo -e "${YELLOW}Wskazówka: Zalecane uruchomienie jako root lub przez 'sudo bash install.sh'${NC}"
fi

# 2. Sprawdzenie i ewentualna automatyczna instalacja Dockera
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}Docker nie został wykryty. Instalowanie silnika Docker...${NC}"
    curl -fsSL https://get.docker.com | sh
    systemctl start docker || true
    systemctl enable docker || true
fi

# 3. Wykrycie Docker Compose (wtyczka v2 lub docker-compose v1)
if docker compose version &> /dev/null; then
    DOCKER_CMD="docker compose"
elif command -v docker-compose &> /dev/null; then
    DOCKER_CMD="docker-compose"
else
    echo -e "${RED}Błąd: Nie znaleziono Docker Compose. Zainstaluj wtyczkę Docker Compose v2.${NC}"
    exit 1
fi

INSTALL_DIR="/opt/zarzadzanie-projektami"
echo -e "${BLUE}==> Przygotowanie katalogu instalacji: ${INSTALL_DIR}${NC}"
mkdir -p "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR/backups"

# 4. Wykrycie źródła plików (lokalne repozytorium vs pobieranie z GitHub)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"
REPO_URL="https://github.com/FraczekMarcin/Zarzadzanie-Projektami.git"

if [ -f "$SCRIPT_DIR/../package.json" ]; then
    SRC_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
    echo -e "${BLUE}==> Wykryto lokalne repozytorium źródłowe: ${SRC_DIR}${NC}"
    echo -e "${BLUE}==> Kopiowanie plików aplikacji do ${INSTALL_DIR}...${NC}"
    cp -r "$SRC_DIR"/* "$INSTALL_DIR/" 2>/dev/null || true
    cp -r "$SRC_DIR"/.[!.]* "$INSTALL_DIR/" 2>/dev/null || true
elif [ -f "$SCRIPT_DIR/package.json" ]; then
    SRC_DIR="$SCRIPT_DIR"
    echo -e "${BLUE}==> Wykryto pliki aplikacji w katalogu: ${SRC_DIR}${NC}"
    cp -r "$SRC_DIR"/* "$INSTALL_DIR/" 2>/dev/null || true
    cp -r "$SRC_DIR"/.[!.]* "$INSTALL_DIR/" 2>/dev/null || true
else
    echo -e "${BLUE}==> Klonowanie oficjalnego repozytorium GitHub do katalogu instalacji...${NC}"
    TEMP_CLONE=$(mktemp -d)
    if command -v git &> /dev/null; then
        git clone "$REPO_URL" "$TEMP_CLONE" 2>/dev/null || true
        cp -r "$TEMP_CLONE"/* "$INSTALL_DIR/" 2>/dev/null || true
        cp -r "$TEMP_CLONE"/.[!.]* "$INSTALL_DIR/" 2>/dev/null || true
        rm -rf "$TEMP_CLONE"
    fi
fi

# Upewnij się, że kluczowe pliki wdrożeniowe z katalogu Instalacja/ są umieszczone bezpośrednio w katalogu docelowym
if [ -d "$INSTALL_DIR/Instalacja" ]; then
    cp -f "$INSTALL_DIR/Instalacja/Dockerfile" "$INSTALL_DIR/Dockerfile" 2>/dev/null || true
    cp -f "$INSTALL_DIR/Instalacja/docker-compose.yml" "$INSTALL_DIR/docker-compose.yml" 2>/dev/null || true
    cp -f "$INSTALL_DIR/Instalacja/backup.sh" "$INSTALL_DIR/backup.sh" 2>/dev/null || true
    cp -f "$INSTALL_DIR/Instalacja/.dockerignore" "$INSTALL_DIR/.dockerignore" 2>/dev/null || true
fi

cd "$INSTALL_DIR"

# 5. Generowanie bezpiecznych kluczy sesji
APP_SECRET=$(openssl rand -hex 32 2>/dev/null || date +%s%N | sha256sum | head -c 64)

# 6. Bezpieczny plik .env
if [ ! -f .env ]; then
    echo -e "${BLUE}==> Generowanie pliku konfiguracyjnego .env...${NC}"
    cat <<EOF > .env
PORT=3000
NODE_ENV=production
DATA_DIR=/app/data
APP_VERSION=2026-11-02 v0.4.0
APP_SECRET=${APP_SECRET}
EOF
    chmod 600 .env
    echo -e "${GREEN}Plik .env wygenerowany (uprawnienia 600).${NC}"
fi

# 7. Zabezpieczenie docker-compose.yml
cat <<'EOF' > docker-compose.yml
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: zarzadzanie_app
    restart: unless-stopped
    environment:
      NODE_ENV: production
      PORT: 3000
      DATA_DIR: /app/data
      APP_VERSION: "2026-11-02 v0.4.0"
      APP_SECRET: ${APP_SECRET:?ustaw APP_SECRET w pliku .env}
    ports:
      - "${APP_PORT:-3000}:3000"
    volumes:
      - zarzadzanie_app_data:/app/data
    networks:
      - zarzadzanie_net

volumes:
  zarzadzanie_app_data:
    driver: local

networks:
  zarzadzanie_net:
    driver: bridge
EOF

# 8. Skrypt automatycznej kopii zapasowej (backup.sh)
echo -e "${BLUE}==> Konfiguracja automatycznego skryptu kopii zapasowych (backup.sh)...${NC}"
cat <<'EOF' > /opt/zarzadzanie-projektami/backup.sh
#!/usr/bin/env bash
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

cleanup() {
    rm -f "$TMP_JSON" "$TMP_GZ" 2>/dev/null || true
}
trap cleanup EXIT ERR

mkdir -p "$BACKUP_DIR"

if ! docker inspect --type=container "$CONTAINER_NAME" >/dev/null 2>&1; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] BŁĄD: Kontener '$CONTAINER_NAME' nie istnieje lub nie jest uruchomiony!" >&2
    exit 1
fi

docker exec "$CONTAINER_NAME" cat /app/data/app_state.json > "$TMP_JSON"

if [ ! -f "$TMP_JSON" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] BŁĄD: Plik tymczasowy nie powstał!" >&2
    exit 1
fi

FILE_SIZE=$(wc -c < "$TMP_JSON" | tr -d ' ')
if [ "$FILE_SIZE" -le 100 ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] BŁĄD: Plik stanu ma rozmiar $FILE_SIZE bajtów (wymagane > 100)!" >&2
    exit 1
fi

if command -v jq >/dev/null 2>&1; then
    if ! jq empty "$TMP_JSON" >/dev/null 2>&1; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] BŁĄD: Niepoprawny format JSON (błąd jq empty)!" >&2
        exit 1
    fi
fi

gzip -c "$TMP_JSON" > "$TMP_GZ"

if ! gzip -t "$TMP_GZ" >/dev/null 2>&1; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] BŁĄD: Test gzip -t nie powiódł się!" >&2
    exit 1
fi

mv "$TMP_GZ" "$TARGET_GZ"
chmod 600 "$TARGET_GZ"
rm -f "$TMP_JSON"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Kopia zapasowa utworzona: $TARGET_GZ"

mapfile -t ALL_BACKUPS < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name "app_state_*.json.gz" | sort -r)
COUNT=${#ALL_BACKUPS[@]}

if [ "$COUNT" -gt "$MIN_KEEP" ]; then
    for ((i=MIN_KEEP; i<COUNT; i++)); do
        OLD_FILE="${ALL_BACKUPS[$i]}"
        if [ -n "$(find "$OLD_FILE" -mtime +$RETENTION_DAYS -print 2>/dev/null)" ]; then
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] Rotacja: usuwanie $OLD_FILE"
            rm -f "$OLD_FILE"
        fi
    done
fi
EOF
chmod +x /opt/zarzadzanie-projektami/backup.sh

CRON_FILE="/etc/cron.d/zarzadzanie-projektami-backup"
if [ ! -f "$CRON_FILE" ]; then
    echo "0 2 * * * root /opt/zarzadzanie-projektami/backup.sh >/dev/null 2>&1" > "$CRON_FILE"
    chmod 644 "$CRON_FILE"
    echo -e "${GREEN}Automatyczne kopie zapasowe skonfigurowane w cronie: codziennie o 02:00 (retencja z zachowaniem minimum 7 kopii).${NC}"
fi

# 9. Start kontenera (budowa i uruchomienie)
echo -e "${BLUE}==> Zwalnianie tymczasowej pamięci podręcznej i zbędnych warstw Dockera...${NC}"
docker system prune -f 2>/dev/null || true
docker builder prune -a -f 2>/dev/null || true
docker image prune -f 2>/dev/null || true

echo -e "${BLUE}==> Uruchamianie kontenera aplikacji Zarządzanie Projektami...${NC}"
$DOCKER_CMD up -d --build

SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

echo -e "${GREEN}=================================================================${NC}"
echo -e "${GREEN}  ✅ WDROŻENIE ZAKOŃCZONE SUKCESEM!${NC}"
echo -e "${GREEN}  Wersja: 2026-11-02 v0.4.0${NC}"
echo -e "${GREEN}=================================================================${NC}"
echo -e "Aplikacja działa i jest dostępna pod:"
echo -e "  👉 ${YELLOW}http://${SERVER_IP}:3000${NC} lub ${YELLOW}http://localhost:3000${NC}"
echo -e ""
echo -e "🛡️  Trwałość danych: Wolumen '${BLUE}zarzadzanie_app_data${NC}' zachowuje plik app_state.json."
echo -e "💾  Kopie zapasowe: Skonfigurowane w '${BLUE}/opt/zarzadzanie-projektami/backups${NC}'."
echo -e "Zarządzanie:"
echo -e "  - Podgląd logów:           ${YELLOW}cd ${INSTALL_DIR} && $DOCKER_CMD logs -f${NC}"
echo -e "  - Aktualizacja z GitHub:   ${YELLOW}cd ${INSTALL_DIR} && git pull && $DOCKER_CMD up -d --build${NC}"
echo -e "  - Ręczna kopia zapasowa:   ${YELLOW}/opt/zarzadzanie-projektami/backup.sh${NC}"
echo -e "  - Zatrzymanie:             ${YELLOW}cd ${INSTALL_DIR} && $DOCKER_CMD down${NC}"
echo -e "${GREEN}=================================================================${NC}"
