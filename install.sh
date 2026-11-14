#!/usr/bin/env bash
# ==============================================================================
# Zarządzanie Projektami - Pracownia Projektowa / Budownictwo
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
echo -e "${GREEN}  🏗️  Zarządzanie Projektami - Instalator${NC}"
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
    APP_SECRET=""
    if command -v openssl >/dev/null 2>&1; then
        APP_SECRET=$(openssl rand -hex 32 2>/dev/null || true)
    fi
    if [ -z "$APP_SECRET" ]; then
        APP_SECRET=$(head -c 48 /dev/urandom 2>/dev/null | base64 | tr -d '\n=+/' | head -c 64 || true)
    fi
    if [ -z "$APP_SECRET" ] || [ "${#APP_SECRET}" -lt 32 ]; then
        echo -e "${RED}Błąd: Nie udało się wygenerować bezpiecznego klucza APP_SECRET (brak openssl oraz /dev/urandom).${NC}" >&2
        exit 1
    fi
    cat <<EOF > .env
PORT=3000
NODE_ENV=production
DATA_DIR=/app/data
BACKUP_DIR=/app/backups
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

# 6b. Opcjonalne szyfrowanie automatycznych kopii zapasowych (backup.key)
BACKUP_KEY_FILE="${INSTALL_DIR}/backup.key"
ENABLE_BACKUP_ENCRYPTION="n"
if [ ! -f "$BACKUP_KEY_FILE" ] && [ -t 0 ]; then
    echo ""
    read -r -p "Czy chcesz włączyć szyfrowanie kopii zapasowych (.json.gz.enc)? (t/N) [Domyślnie: nie]: " USER_BACKUP_ENC || USER_BACKUP_ENC="n"
    if [[ "$USER_BACKUP_ENC" =~ ^([tT]|[tT][aA][kK]|[yY]|[yY][eE][sS])$ ]]; then
        ENABLE_BACKUP_ENCRYPTION="t"
    fi
elif [ -f "$BACKUP_KEY_FILE" ]; then
    ENABLE_BACKUP_ENCRYPTION="t"
fi

if [ "$ENABLE_BACKUP_ENCRYPTION" = "t" ] && [ ! -f "$BACKUP_KEY_FILE" ]; then
    BACKUP_PASSPHRASE=""
    if command -v openssl >/dev/null 2>&1; then
        BACKUP_PASSPHRASE=$(openssl rand -base64 32 2>/dev/null || true)
    fi
    if [ -z "$BACKUP_PASSPHRASE" ]; then
        BACKUP_PASSPHRASE=$(head -c 32 /dev/urandom 2>/dev/null | base64 | tr -d '\n' || true)
    fi
    if [ -z "$BACKUP_PASSPHRASE" ]; then
        echo -e "${RED}Błąd: Nie udało się wygenerować hasła szyfrowania kopii zapasowych.${NC}" >&2
        exit 1
    fi
    printf '%s\n' "$BACKUP_PASSPHRASE" > "$BACKUP_KEY_FILE"
    chmod 600 "$BACKUP_KEY_FILE"
    echo -e "${GREEN}Wygenerowano klucz szyfrowania kopii: ${BACKUP_KEY_FILE} (uprawnienia 600).${NC}"
    echo -e "${YELLOW}┌────────────────────────────────────────────────────────────────────────┐${NC}"
    echo -e "${YELLOW}│  🔐 HASŁO DO KOPII ZAPASOWYCH (backup.key) - ZAPISZ POZA SERWEREM     │${NC}"
    echo -e "${YELLOW}├────────────────────────────────────────────────────────────────────────┤${NC}"
    echo -e "${YELLOW}│  ${BACKUP_PASSPHRASE}                              │${NC}"
    echo -e "${YELLOW}├────────────────────────────────────────────────────────────────────────┤${NC}"
    echo -e "${YELLOW}│  ⚠️  Zapisz to hasło teraz w swoim menedżerze haseł!                   │${NC}"
    echo -e "${YELLOW}│  Jest wyświetlane JEDEN RAZ i nie jest częścią samej kopii zapasowej.  │${NC}"
    echo -e "${YELLOW}└────────────────────────────────────────────────────────────────────────┘${NC}"
    unset BACKUP_PASSPHRASE
fi

# 7. Konfiguracja automatycznego skryptu kopii zapasowych w cronie
if [ -f backup.sh ]; then
    chmod +x backup.sh
fi
if [ -f restore-test.sh ]; then
    chmod +x restore-test.sh
fi

CRON_FILE="/etc/cron.d/zarzadzanie-projektami-backup"
if [ -d /etc/cron.d ] && [ ! -f "$CRON_FILE" ]; then
    if [ -f "$BACKUP_KEY_FILE" ]; then
        echo "0 2 * * * root BACKUP_PASSPHRASE_FILE=${BACKUP_KEY_FILE} ${INSTALL_DIR}/backup.sh >/dev/null 2>&1" > "$CRON_FILE"
    else
        echo "0 2 * * * root ${INSTALL_DIR}/backup.sh >/dev/null 2>&1" > "$CRON_FILE"
    fi
    chmod 644 "$CRON_FILE"
    echo -e "${GREEN}Automatyczne kopie zapasowe skonfigurowane w cronie: codziennie o 02:00.${NC}"
fi

# 8. Opcjonalna konfiguracja HTTPS dla sieci lokalnej (Caddy)
ENABLE_HTTPS="n"
if [ -t 0 ]; then
    echo ""
    read -r -p "Czy chcesz włączyć opcjonalny HTTPS przez Caddy w sieci lokalnej? (t/N) [Domyślnie: nie]: " USER_HTTPS_CHOICE || USER_HTTPS_CHOICE="n"
    if [[ "$USER_HTTPS_CHOICE" =~ ^([tT]|[tT][aA][kK]|[yY]|[yY][eE][sS])$ ]]; then
        # Sprawdzenie wersji Docker Compose (wymagane >= 2.24 dla dyrektywy '!reset')
        COMPOSE_VER_RAW=$($DOCKER_CMD version --short 2>/dev/null || echo "")
        COMPOSE_VER="${COMPOSE_VER_RAW#v}"
        COMPOSE_MAJOR=$(echo "$COMPOSE_VER" | awk -F. '{print $1}')
        COMPOSE_MINOR=$(echo "$COMPOSE_VER" | awk -F. '{print $2}')

        if ! [[ "$COMPOSE_MAJOR" =~ ^[0-9]+$ ]] || ! [[ "$COMPOSE_MINOR" =~ ^[0-9]+$ ]] || [ "$COMPOSE_MAJOR" -lt 2 ] || ( [ "$COMPOSE_MAJOR" -eq 2 ] && [ "$COMPOSE_MINOR" -lt 24 ] ); then
            echo -e "${YELLOW}Ostrzeżenie: Wykryta wersja Docker Compose (${COMPOSE_VER_RAW:-nieznana}) jest niższa niż 2.24.${NC}"
            echo -e "${YELLOW}Plik konfiguracyjny docker-compose.https.yml korzysta z dyrektywy '!reset' (wymaga Docker Compose >= 2.24).${NC}"
            echo -e "${YELLOW}HTTPS nie został włączony. Zaktualizuj Docker Compose do wersji >= 2.24, aby korzystać z bezpiecznego HTTPS.${NC}"
            ENABLE_HTTPS="n"
        else
            ENABLE_HTTPS="t"
        fi
    fi
fi

SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

if [ "$ENABLE_HTTPS" = "t" ]; then
    echo -e "${BLUE}==> Konfiguracja HTTPS przez Caddy (certyfikat lokalny TLS)...${NC}"
    HOST_DEFAULT="$SERVER_IP"
    if [ -t 0 ]; then
        read -r -p "Podaj adres IP lub nazwę hosta serwera (APP_HOST) [Domyślnie: $HOST_DEFAULT]: " USER_APP_HOST || USER_APP_HOST=""
        APP_HOST="${USER_APP_HOST:-$HOST_DEFAULT}"
    else
        APP_HOST="$HOST_DEFAULT"
    fi

    # Zapisz lub zaktualizuj APP_HOST i TRUST_PROXY w pliku .env
    if grep -q "^APP_HOST=" .env; then
        sed -i "s/^APP_HOST=.*/APP_HOST=${APP_HOST}/" .env
    else
        echo "APP_HOST=${APP_HOST}" >> .env
    fi

    if grep -q "^TRUST_PROXY=" .env; then
        sed -i "s/^TRUST_PROXY=.*/TRUST_PROXY=1/" .env
    else
        echo "TRUST_PROXY=1" >> .env
    fi

    # Dopisz lub zamień w .env linię COMPOSE_FILE=docker-compose.yml:docker-compose.https.yml
    if grep -q "^COMPOSE_FILE=" .env; then
        sed -i "s|^COMPOSE_FILE=.*|COMPOSE_FILE=docker-compose.yml:docker-compose.https.yml|" .env
    else
        echo "COMPOSE_FILE=docker-compose.yml:docker-compose.https.yml" >> .env
    fi
fi

# 9. Uruchomienie aplikacji za pomocą Docker Compose
echo -e "${BLUE}==> Uruchamianie kontenerów Zarządzanie Projektami...${NC}"
$DOCKER_CMD up -d --build

INSTALLED_VERSION=$(cat VERSION 2>/dev/null | tr -d '\r\n' || echo "brak")
echo -e "${GREEN}=================================================================${NC}"
echo -e "${GREEN}  ✅ WDROŻENIE ZAKOŃCZONE SUKCESEM!${NC}"
echo -e "${GREEN}  Wersja: ${INSTALLED_VERSION}${NC}"
echo -e "${GREEN}=================================================================${NC}"

if [ "$ENABLE_HTTPS" = "t" ]; then
    echo -e "Aplikacja działa w trybie bezpiecznym HTTPS:"
    echo -e "  👉 ${YELLOW}https://${APP_HOST}${NC}"
    echo -e "  (Port 3000 jest niewidoczny z zewnątrz, ruch HTTP jest przekierowywany na HTTPS 443)."
    echo -e "  (Zmienna COMPOSE_FILE została ustawiona w pliku .env)."
    echo -e ""
    echo -e "Instalacja certyfikatu głównego na stanowiskach pracy (aby uniknąć ostrzeżeń w przeglądarkach):"
    echo -e "  1. Wyeksportuj certyfikat z kontenera Caddy:"
    echo -e "     ${YELLOW}$DOCKER_CMD exec caddy cat /data/caddy/pki/authorities/local/root.crt > caddy-root.crt${NC}"
    echo -e "  2. Zainstaluj plik caddy-root.crt w systemie lub przeglądarce jako zaufany główny urząd certyfikacji."
else
    echo -e "Aplikacja działa i jest dostępna pod:"
    echo -e "  👉 ${YELLOW}http://${SERVER_IP}:3000${NC} lub ${YELLOW}http://localhost:3000${NC}"
fi

echo -e ""
echo -e "🛡️  Trwałość danych: Wolumen '${BLUE}zarzadzanie_app_data${NC}' zachowuje plik app_state.json."
echo -e "💾  Kopie zapasowe: Skonfigurowane w '${BLUE}${INSTALL_DIR}/backups${NC}'."
echo -e "Zarządzanie:"
echo -e "  - Podgląd logów:           ${YELLOW}cd ${INSTALL_DIR} && $DOCKER_CMD logs -f${NC}"
echo -e "  - Aktualizacja z GitHub:   ${YELLOW}cd ${INSTALL_DIR} && ./backup.sh && git pull origin main && $DOCKER_CMD up -d --build${NC}"
if [ "$ENABLE_HTTPS" = "t" ]; then
echo -e "    ${BLUE}(Nota: COMPOSE_FILE jest ustawione w .env – komenda automatycznie stosuje plik override HTTPS)${NC}"
fi
echo -e "  - Ręczna kopia zapasowa:   ${YELLOW}${INSTALL_DIR}/backup.sh${NC}"
echo -e "  - Zatrzymanie:             ${YELLOW}cd ${INSTALL_DIR} && $DOCKER_CMD down${NC}"
echo -e "${GREEN}=================================================================${NC}"
