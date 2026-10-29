#!/usr/bin/env bash
# ==============================================================================
# Zarządzanie Projektami - Pracownia Projektowa / Budownictwo
# Wersja: 2026-10-29 v 0.03.4
# Repozytorium: https://github.com/FraczekMarcin/Zarzadzanie-Projektami
# Ścieżka skryptu w repozytorium: Instalacja/install.sh
# Lokalizacja docelowa na serwerze: /opt/zarzadzanie-projektami
# ==============================================================================
set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}=================================================================${NC}"
echo -e "${GREEN}  🏗️  Zarządzanie Projektami - Instalator (Wersja 2026-10-29 v 0.03.4)${NC}"
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
    # Skrypt uruchomiony z wnętrza sklonowanego repo (np. cd Zarzadzanie-Projektami/Instalacja && sudo bash install.sh)
    SRC_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
    echo -e "${BLUE}==> Wykryto lokalne repozytorium źródłowe: ${SRC_DIR}${NC}"
    echo -e "${BLUE}==> Kopiowanie plików aplikacji do ${INSTALL_DIR}...${NC}"
    cp -r "$SRC_DIR"/* "$INSTALL_DIR/" 2>/dev/null || true
    cp -r "$SRC_DIR"/.[!.]* "$INSTALL_DIR/" 2>/dev/null || true
elif [ -f "$SCRIPT_DIR/package.json" ]; then
    # Skrypt uruchomiony z katalogu głównego repo
    SRC_DIR="$SCRIPT_DIR"
    echo -e "${BLUE}==> Wykryto pliki aplikacji w katalogu: ${SRC_DIR}${NC}"
    cp -r "$SRC_DIR"/* "$INSTALL_DIR/" 2>/dev/null || true
    cp -r "$SRC_DIR"/.[!.]* "$INSTALL_DIR/" 2>/dev/null || true
else
    # Skrypt uruchomiony bezpośrednio (np. curl ... | sudo bash)
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
    cp -f "$INSTALL_DIR/Instalacja/init.sql" "$INSTALL_DIR/init.sql" 2>/dev/null || true
    cp -f "$INSTALL_DIR/Instalacja/backup.sh" "$INSTALL_DIR/backup.sh" 2>/dev/null || true
    cp -f "$INSTALL_DIR/Instalacja/.dockerignore" "$INSTALL_DIR/.dockerignore" 2>/dev/null || true
fi

cd "$INSTALL_DIR"

# 5. Generowanie bezpiecznych haseł PostgreSQL i kluczy sesji
DB_PASS=$(openssl rand -hex 16 2>/dev/null || date +%s%N | sha256sum | head -c 32)
APP_SECRET=$(openssl rand -hex 32 2>/dev/null || date +%s%N | sha256sum | head -c 64)

# 6. Bezpieczny plik .env
if [ ! -f .env ]; then
    echo -e "${BLUE}==> Generowanie pliku konfiguracyjnego .env...${NC}"
    cat <<EOF > .env
PORT=3000
NODE_ENV=production
APP_VERSION=2026-10-29 v 0.03.4
POSTGRES_USER=zarzadzanie
POSTGRES_PASSWORD=${DB_PASS}
POSTGRES_DB=zarzadzanie_db
POSTGRES_PORT=5432
DATABASE_URL=postgres://zarzadzanie:${DB_PASS}@db:5432/zarzadzanie_db
APP_SECRET=${APP_SECRET}
EOF
    chmod 600 .env
    echo -e "${GREEN}Plik .env wygenerowany (uprawnienia 600).${NC}"
else
    echo -e "${YELLOW}Wykryto istniejący plik .env - zachowano konfigurację i hasła bazy danych.${NC}"
    sed -i 's/@zarzadzanie\.local/@pracownia\.pl/g' .env 2>/dev/null || true
fi

# 7. Zabezpieczenie docker-compose.yml (usunięcie zbędnych wersji, upewnienie się o poprawnym kontekście)
if [ ! -f docker-compose.yml ] || grep -q "context: \.\." docker-compose.yml 2>/dev/null || grep -q "version:" docker-compose.yml 2>/dev/null || grep -q "zarzadzanie.local" docker-compose.yml 2>/dev/null; then
    cat <<'EOF' > docker-compose.yml
services:
  db:
    image: postgres:16-alpine
    container_name: zarzadzanie_db
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-zarzadzanie}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-TwojeBezpieczneHaslo2026!}
      POSTGRES_DB: ${POSTGRES_DB:-zarzadzanie_db}
    volumes:
      - zarzadzanie_postgres_data:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql:ro
      - ./backups:/var/backups/postgres
    ports:
      - "${POSTGRES_PORT:-5432}:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-zarzadzanie} -d ${POSTGRES_DB:-zarzadzanie_db}"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - zarzadzanie_net

  app:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: zarzadzanie_app
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      NODE_ENV: production
      PORT: 3000
      APP_VERSION: "2026-10-29 v 0.03.4"
      DATABASE_URL: postgres://${POSTGRES_USER:-zarzadzanie}:${POSTGRES_PASSWORD:-TwojeBezpieczneHaslo2026!}@db:5432/${POSTGRES_DB:-zarzadzanie_db}
      APP_SECRET: ${APP_SECRET:-sekretna-fraza-szyfrowania-zarzadzanie-projektami-2026}
    ports:
      - "${APP_PORT:-3000}:3000"
    networks:
      - zarzadzanie_net

  pgadmin:
    image: dpage/pgadmin4:latest
    container_name: zarzadzanie_pgadmin
    restart: unless-stopped
    environment:
      PGADMIN_DEFAULT_EMAIL: ${PGADMIN_EMAIL:-admin@pracownia.pl}
      PGADMIN_DEFAULT_PASSWORD: ${PGADMIN_PASSWORD:-SuperAdminHaslo2026!}
      PGADMIN_CONFIG_CHECK_EMAIL_DELIVERABILITY: "False"
      PGADMIN_CONFIG_ALLOW_SPECIAL_EMAIL_DOMAINS: "['local']"
    ports:
      - "5050:80"
    depends_on:
      - db
    networks:
      - zarzadzanie_net

volumes:
  zarzadzanie_postgres_data:
    driver: local

networks:
  zarzadzanie_net:
    driver: bridge
EOF
fi

# 8. Utworzenie init.sql jeśli brak
if [ ! -f init.sql ]; then
    cat <<'EOF' > init.sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255),
    role VARCHAR(32) NOT NULL DEFAULT 'developer',
    department VARCHAR(128),
    initials VARCHAR(8),
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS projects (
    id VARCHAR(64) PRIMARY KEY,
    key VARCHAR(32) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    priority VARCHAR(16) NOT NULL DEFAULT 'normal',
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    start_date DATE NOT NULL,
    due_date DATE NOT NULL,
    duration_days INTEGER NOT NULL DEFAULT 30,
    progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    budget VARCHAR(64),
    spent_hours NUMERIC(10, 2) DEFAULT 0,
    color VARCHAR(32) DEFAULT '#0284c7',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tasks (
    id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) REFERENCES projects(id) ON DELETE CASCADE,
    code VARCHAR(32) NOT NULL,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    type VARCHAR(32) NOT NULL DEFAULT 'task',
    priority VARCHAR(16) NOT NULL DEFAULT 'normal',
    status VARCHAR(32) NOT NULL DEFAULT 'to_do',
    assignee_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    reporter_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    start_date DATE NOT NULL,
    due_date DATE NOT NULL,
    duration_days INTEGER NOT NULL DEFAULT 7,
    is_official_deadline BOOLEAN DEFAULT FALSE,
    estimated_hours NUMERIC(8, 2) DEFAULT 0,
    spent_hours NUMERIC(8, 2) DEFAULT 0,
    progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    blocking_task_ids JSONB DEFAULT '[]'::jsonb,
    parent_id VARCHAR(64) REFERENCES tasks(id) ON DELETE SET NULL,
    tags TEXT[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO users (id, name, email, role, department, initials)
VALUES 
    ('usr-1', 'Marcin Frączek', 'fraczek.marcin@gmail.com', 'admin', 'Kierownik Pracowni / Główny Projektant', 'MF'),
    ('usr-2', 'Anna Nowak', 'anna.nowak@pracownia.pl', 'project_manager', 'Architektura i Urbanistyka', 'AN')
ON CONFLICT (id) DO NOTHING;
EOF
fi

# 9. Automatyczny backup cron
echo -e "${BLUE}==> Konfiguracja automatycznego skryptu kopii zapasowych (backup.sh)...${NC}"
cat <<'EOF' > /opt/zarzadzanie-projektami/backup.sh
#!/usr/bin/env bash
BACKUP_DIR="/opt/zarzadzanie-projektami/backups"
TIMESTAMP=$(date +"%Y-%m-%d_%H%M%S")
FILENAME="zarzadzanie_backup_${TIMESTAMP}.sql.gz"
mkdir -p "$BACKUP_DIR"
docker exec -t zarzadzanie_db pg_dump -U zarzadzanie zarzadzanie_db | gzip > "$BACKUP_DIR/$FILENAME"
chmod 600 "$BACKUP_DIR/$FILENAME"
find "$BACKUP_DIR" -type f -name "zarzadzanie_backup_*.sql.gz" -mtime +14 -delete
EOF
chmod +x /opt/zarzadzanie-projektami/backup.sh

CRON_FILE="/etc/cron.d/zarzadzanie-projektami-backup"
if [ ! -f "$CRON_FILE" ]; then
    echo "0 2 * * * root /opt/zarzadzanie-projektami/backup.sh >/dev/null 2>&1" > "$CRON_FILE"
    chmod 644 "$CRON_FILE"
    echo -e "${GREEN}Automatyczne kopie zapasowe skonfigurowane w cronie: codziennie o 02:00 (retencja 14 dni).${NC}"
fi

# 10. Start kontenerów (budowa i uruchomienie)
echo -e "${BLUE}==> Zwalnianie tymczasowej pamięci podręcznej i zbędnych warstw Dockera...${NC}"
docker system prune -f 2>/dev/null || true
docker builder prune -a -f 2>/dev/null || true
docker image prune -f 2>/dev/null || true

echo -e "${BLUE}==> Uruchamianie kontenerów (PostgreSQL 16 + Zarządzanie Projektami)...${NC}"
$DOCKER_CMD up -d --build

SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

echo -e "${GREEN}=================================================================${NC}"
echo -e "${GREEN}  ✅ WDROŻENIE ZAKOŃCZONE SUKCESEM!${NC}"
echo -e "${GREEN}  Wersja: 2026-10-29 v 0.03.4${NC}"
echo -e "${GREEN}=================================================================${NC}"
echo -e "Aplikacja działa i jest dostępna pod:"
echo -e "  👉 ${YELLOW}http://${SERVER_IP}:3000${NC} lub ${YELLOW}http://localhost:3000${NC}"
echo -e ""
echo -e "🛡️  Trwałość danych: Wolumen '${BLUE}zarzadzanie_postgres_data${NC}' zachowuje dane bazy."
echo -e "💾  Kopie zapasowe: Skonfigurowane w '${BLUE}/opt/zarzadzanie-projektami/backups${NC}'."
echo -e "Zarządzanie:"
echo -e "  - Podgląd logów:           ${YELLOW}cd ${INSTALL_DIR} && $DOCKER_CMD logs -f${NC}"
echo -e "  - Aktualizacja z GitHub:   ${YELLOW}cd ${INSTALL_DIR} && git pull && $DOCKER_CMD up -d --build${NC}"
echo -e "  - Ręczna kopia zapasowa:   ${YELLOW}/opt/zarzadzanie-projektami/backup.sh${NC}"
echo -e "  - Zatrzymanie:             ${YELLOW}cd ${INSTALL_DIR} && $DOCKER_CMD down${NC}"
echo -e "${GREEN}=================================================================${NC}"
