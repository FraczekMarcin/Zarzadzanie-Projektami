#!/usr/bin/env bash
# ==============================================================================
# Zarządzanie Projektami - Pracownia Projektowa / Budownictwo
# Wersja: 2026-11-06 v0.5.0
# Repozytorium: https://github.com/FraczekMarcin/Zarzadzanie-Projektami
# Lokalizacja docelowa na serwerze: /opt/zarzadzanie-projektami
# ==============================================================================
set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}=================================================================${NC}"
echo -e "${GREEN}  🏗️  Zarządzanie Projektami - Instalator (Wersja 2026-11-06 v0.5.0)${NC}"
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
REPO_URL="https://github.com/FraczekMarcin/Zarzadzanie-Projektami.git"

# 4. Ustalenie lokalizacji repozytorium i przejście do katalogu głównego
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"
REPO_ROOT=""

if command -v git &>/dev/null && git -C "$SCRIPT_DIR" rev-parse --show-toplevel &>/dev/null; then
    REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
elif [ -f "$SCRIPT_DIR/package.json" ]; then
    REPO_ROOT="$SCRIPT_DIR"
elif [ -f "$SCRIPT_DIR/../package.json" ]; then
    REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
fi

if [ "$REPO_ROOT" = "$INSTALL_DIR" ]; then
    echo -e "${BLUE}==> Praca w docelowym katalogu instalacji: ${INSTALL_DIR}${NC}"
    cd "$INSTALL_DIR"
elif [ -d "$INSTALL_DIR/.git" ]; then
    echo -e "${BLUE}==> Przechodzenie do istniejącego katalogu instalacji: ${INSTALL_DIR}${NC}"
    cd "$INSTALL_DIR"
else
    echo -e "${BLUE}==> Klonowanie oficjalnego repozytorium do: ${INSTALL_DIR}${NC}"
    mkdir -p /opt
    if ! command -v git &> /dev/null; then
        echo -e "${YELLOW}Instalowanie pakietu git...${NC}"
        if command -v apt-get &>/dev/null; then
            apt-get update -qq && apt-get install -y -qq git
        elif command -v dnf &>/dev/null; then
            dnf install -y git
        elif command -v yum &>/dev/null; then
            yum install -y git
        fi
    fi
    git clone "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

# 5. Przygotowanie katalogu kopii zapasowych
mkdir -p backups

# 6. Generowanie bezpiecznego pliku .env tylko gdy nie istnieje
if [ ! -f .env ]; then
    echo -e "${BLUE}==> Generowanie pliku konfiguracyjnego .env...${NC}"
    APP_SECRET=$(openssl rand -hex 32 2>/dev/null || date +%s%N | sha256sum | head -c 64)
    cat <<EOF > .env
PORT=3000
NODE_ENV=production
DATA_DIR=/app/data
BACKUP_DIR=/app/backups
APP_VERSION=2026-11-06 v0.5.0
APP_SECRET=${APP_SECRET}
EOF
    chmod 600 .env
    echo -e "${GREEN}Plik .env wygenerowany (uprawnienia 600).${NC}"

    echo -e "${YELLOW}┌────────────────────────────────────────────────────────────────────────┐${NC}"
    echo -e "${YELLOW}│  🔐 KLUCZ SZYFROWANIA APLIKACJI (APP_SECRET) - ZAPISZ POZA SERWEREM    │${NC}"
    echo -e "${YELLOW}├────────────────────────────────────────────────────────────────────────┤${NC}"
    echo -e "${YELLOW}│  ${APP_SECRET}  │${NC}"
    echo -e "${YELLOW}├────────────────────────────────────────────────────────────────────────┤${NC}"
    echo -e "${YELLOW}│  ⚠️  UWAGA: Plik .env nie wchodzi w skład backup.sh. Zapisz ten klucz  │${NC}"
    echo -e "${YELLOW}│  w bezpiecznym menedżerze haseł. Bez niego nie da się odszyfrować      │${NC}"
    echo -e "${YELLOW}│  sekretów 2FA po przywróceniu pliku app_state.json na nowym serwerze.  │${NC}"
    echo -e "${YELLOW}└────────────────────────────────────────────────────────────────────────┘${NC}"
else
    echo -e "${YELLOW}Wykryto istniejący plik .env – konfiguracja zachowana bez zmian.${NC}"
fi

# 7. Konfiguracja automatycznego skryptu kopii zapasowych w cronie
if [ -f backup.sh ]; then
    chmod +x backup.sh
fi

CRON_FILE="/etc/cron.d/zarzadzanie-projektami-backup"
if [ -d /etc/cron.d ] && [ ! -f "$CRON_FILE" ]; then
    echo "0 2 * * * root ${INSTALL_DIR}/backup.sh >/dev/null 2>&1" > "$CRON_FILE"
    chmod 644 "$CRON_FILE"
    echo -e "${GREEN}Automatyczne kopie zapasowe skonfigurowane w cronie: codziennie o 02:00.${NC}"
fi

# 8. Uruchomienie aplikacji za pomocą Docker Compose
echo -e "${BLUE}==> Uruchamianie kontenera aplikacji Zarządzanie Projektami...${NC}"
$DOCKER_CMD up -d --build

SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

echo -e "${GREEN}=================================================================${NC}"
echo -e "${GREEN}  ✅ WDROŻENIE ZAKOŃCZONE SUKCESEM!${NC}"
echo -e "${GREEN}  Wersja: 2026-11-06 v0.5.0${NC}"
echo -e "${GREEN}=================================================================${NC}"
echo -e "Aplikacja działa i jest dostępna pod:"
echo -e "  👉 ${YELLOW}http://${SERVER_IP}:3000${NC} lub ${YELLOW}http://localhost:3000${NC}"
echo -e ""
echo -e "🛡️  Trwałość danych: Wolumen '${BLUE}zarzadzanie_app_data${NC}' zachowuje plik app_state.json."
echo -e "💾  Kopie zapasowe: Skonfigurowane w '${BLUE}${INSTALL_DIR}/backups${NC}'."
echo -e "Zarządzanie:"
echo -e "  - Podgląd logów:           ${YELLOW}cd ${INSTALL_DIR} && $DOCKER_CMD logs -f${NC}"
echo -e "  - Aktualizacja z GitHub:   ${YELLOW}cd ${INSTALL_DIR} && ./backup.sh && git pull origin main && $DOCKER_CMD up -d --build${NC}"
echo -e "  - Ręczna kopia zapasowa:   ${YELLOW}${INSTALL_DIR}/backup.sh${NC}"
echo -e "  - Zatrzymanie:             ${YELLOW}cd ${INSTALL_DIR} && $DOCKER_CMD down${NC}"
echo -e "${GREEN}=================================================================${NC}"
