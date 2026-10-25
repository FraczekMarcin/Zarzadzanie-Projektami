#!/usr/bin/env bash
# ==============================================================================
# Zarządzanie Projektami - Pracownia Projektowa / Budownictwo
# Wersja: 2026-10-25 v 0.2
# Repozytorium: https://github.com/FraczekMarcin/Zarzadzanie-Projektami
# Lokalizacja instalacji: /opt/zarzadzanie-projektami
# Automatyczny Instalator 1-Poleceniem (Docker + PostgreSQL 16 + Auto-Backup)
# ==============================================================================
set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}=================================================================${NC}"
echo -e "${GREEN}  🏗️  Zarządzanie Projektami - Instalator 1-Poleceniem (Wersja 2026-10-25 v 0.2)${NC}"
echo -e "${BLUE}  Repozytorium: https://github.com/FraczekMarcin/Zarzadzanie-Projektami${NC}"
echo -e "${BLUE}=================================================================${NC}"

# 1. Sprawdzenie uprawnień roota
if [ "$EUID" -ne 0 ]; then
  echo -e "${YELLOW}Wskazówka: Zalecane uruchomienie jako root lub przez 'sudo bash install.sh'${NC}"
fi

# 2. Sprawdzenie i ewentualna automatyczna instalacja Dockera
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}Docker nie został wykryty. Rozpoczynanie automatycznej instalacji silnika Docker...${NC}"
    curl -fsSL https://get.docker.com | sh
    systemctl start docker || true
    systemctl enable docker || true
fi

# 3. Wykrycie Docker Compose (wtyczka v2 lub v1)
if docker compose version &> /dev/null; then
    DOCKER_CMD="docker compose"
elif command -v docker-compose &> /dev/null; then
    DOCKER_CMD="docker-compose"
else
    echo -e "${RED}Błąd: Nie znaleziono narzędzia Docker Compose. Zainstaluj wtyczkę Docker Compose v2.${NC}"
    exit 1
fi

INSTALL_DIR="/opt/zarzadzanie-projektami"
echo -e "${BLUE}==> Katalog roboczy instalacji: ${INSTALL_DIR}${NC}"
mkdir -p "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR/backups"
cd "$INSTALL_DIR"

# 4. Klonowanie lub aktualizacja repozytorium GitHub
REPO_URL="https://github.com/FraczekMarcin/Zarzadzanie-Projektami.git"
if [ ! -d ".git" ]; then
    echo -e "${BLUE}==> Klonowanie oficjalnego repozytorium GitHub do ${INSTALL_DIR}...${NC}"
    if command -v git &> /dev/null; then
        git clone "$REPO_URL" . 2>/dev/null || echo -e "${YELLOW}Katalog niepusty lub brak sieci - kontynuowanie z plikami lokalnymi...${NC}"
    fi
else
    echo -e "${BLUE}==> Aktualizacja istniejącego repozytorium (git pull)...${NC}"
    git pull origin main 2>/dev/null || git pull origin master 2>/dev/null || true
fi

# 5. Generowanie bezpiecznych haseł i kluczy szyfrujących
DB_PASS=$(openssl rand -hex 16 2>/dev/null || date +%s%N | sha256sum | head -c 32)
APP_SECRET=$(openssl rand -hex 32 2>/dev/null || date +%s%N | sha256sum | head -c 64)

# 6. Tworzenie bezpiecznego pliku .env (jeśli jeszcze nie istnieje)
if [ ! -f .env ]; then
    echo -e "${BLUE}==> Generowanie pliku .env z unikalnymi kluczami i hasłami PostgreSQL...${NC}"
    cat <<EOF > .env
PORT=3000
NODE_ENV=production
APP_VERSION=2026-10-25 v 0.2
POSTGRES_USER=zarzadzanie
POSTGRES_PASSWORD=${DB_PASS}
POSTGRES_DB=zarzadzanie_db
POSTGRES_PORT=5432
DATABASE_URL=postgres://zarzadzanie:${DB_PASS}@db:5432/zarzadzanie_db
APP_SECRET=${APP_SECRET}
EOF
    chmod 600 .env
    echo -e "${GREEN}Plik .env wygenerowany i zabezpieczony.${NC}"
else
    echo -e "${YELLOW}Wykryto istniejący plik .env - zachowano konfigurację i hasła bazy danych.${NC}"
fi

# 7. Tworzenie pliku docker-compose.yml jeśli brak
if [ ! -f docker-compose.yml ]; then
    echo -e "${BLUE}==> Tworzenie pliku docker-compose.yml...${NC}"
    cat <<'EOF' > docker-compose.yml
version: '3.8'

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
      APP_VERSION: "2026-10-25 v 0.2"
      DATABASE_URL: postgres://${POSTGRES_USER:-zarzadzanie}:${POSTGRES_PASSWORD:-TwojeBezpieczneHaslo2026!}@db:5432/${POSTGRES_DB:-zarzadzanie_db}
      APP_SECRET: ${APP_SECRET:-sekretna-fraza-szyfrowania-zarzadzanie-projektami-2026}
    ports:
      - "${APP_PORT:-3000}:3000"
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

# 8. Tworzenie init.sql jeśli brak
if [ ! -f init.sql ]; then
    echo -e "${BLUE}==> Tworzenie schematu bazy init.sql...${NC}"
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

# 9. Konfiguracja automatycznego skryptu kopii zapasowych (backup.sh + Cron)
echo -e "${BLUE}==> Konfiguracja automatycznych kopii zapasowych (backup.sh)...${NC}"
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

# Wpis do crona systemowego
CRON_FILE="/etc/cron.d/zarzadzanie-projektami-backup"
if [ ! -f "$CRON_FILE" ]; then
    echo "0 2 * * * root /opt/zarzadzanie-projektami/backup.sh >/dev/null 2>&1" > "$CRON_FILE"
    chmod 644 "$CRON_FILE"
    echo -e "${GREEN}Automatyczne kopie zapasowe skonfigurowane w cronie: codziennie o 02:00 w nocy (retencja 14 dni).${NC}"
fi

# 10. Uruchomienie kontenerów
echo -e "${BLUE}==> Uruchamianie kontenerów (PostgreSQL 16 + Zarządzanie Projektami)...${NC}"
$DOCKER_CMD up -d

SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

echo -e "${GREEN}=================================================================${NC}"
echo -e "${GREEN}  ✅ WDROŻENIE ZAKOŃCZONE SUKCESEM!${NC}"
echo -e "${GREEN}  Wersja: 2026-10-25 v 0.2${NC}"
echo -e "${GREEN}=================================================================${NC}"
echo -e "Aplikacja działa i jest dostępna pod:"
echo -e "  👉 ${YELLOW}http://${SERVER_IP}:3000${NC} lub ${YELLOW}http://localhost:3000${NC}"
echo -e ""
echo -e "🛡️  Trwałość danych: Wolumen PostgreSQL '${BLUE}zarzadzanie_postgres_data${NC}' przechowuje dane trwale."
echo -e "💾  Automatyczne kopie: Skonfigurowane w '${BLUE}/opt/zarzadzanie-projektami/backups${NC}' (Cron o 02:00)."
echo -e "Zarządzanie aplikacją:"
echo -e "  - Podgląd logów:           ${YELLOW}cd ${INSTALL_DIR} && $DOCKER_CMD logs -f${NC}"
echo -e "  - Aktualizacja z GitHub:   ${YELLOW}cd ${INSTALL_DIR} && git pull && $DOCKER_CMD up -d --build${NC}"
echo -e "  - Ręczna kopia zapasowa:   ${YELLOW}/opt/zarzadzanie-projektami/backup.sh${NC}"
echo -e "  - Zatrzymanie:             ${YELLOW}cd ${INSTALL_DIR} && $DOCKER_CMD down${NC}"
echo -e "${GREEN}=================================================================${NC}"
