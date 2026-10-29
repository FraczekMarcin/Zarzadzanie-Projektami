export interface DockerConfigFile {
  name: string;
  filename: string;
  description: string;
  language: string;
  content: string;
}

export const GITHUB_REPO_URL = 'https://github.com/FraczekMarcin/Zarzadzanie-Projektami';
export const CURRENT_APP_VERSION = '2026-10-29 v 0.03.4';
export const INSTALL_TARGET_DIR = '/opt/zarzadzanie-projektami';
export const RAW_INSTALL_SCRIPT_URL = 'https://raw.githubusercontent.com/FraczekMarcin/Zarzadzanie-Projektami/main/Instalacja/install.sh';
export const GITHUB_RAW_FALLBACK_URL = 'https://github.com/FraczekMarcin/Zarzadzanie-Projektami/raw/main/Instalacja/install.sh';

export const DOCKER_COMPOSE_YML = `# ==============================================================================
# Zarządzanie Projektami (Pracownia Projektowa / Budownictwo)
# Wersja: 2026-10-29 v 0.03.4
# Repozytorium: https://github.com/FraczekMarcin/Zarzadzanie-Projektami
# Lokalizacja docelowa na serwerze: /opt/zarzadzanie-projektami
# ==============================================================================

services:
  # 1. Baza danych PostgreSQL 16 (Trwały wolumen danych)
  db:
    image: postgres:16-alpine
    container_name: zarzadzanie_db
    restart: unless-stopped
    environment:
      POSTGRES_USER: \${POSTGRES_USER:-zarzadzanie}
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:-TwojeBezpieczneHaslo2026!}
      POSTGRES_DB: \${POSTGRES_DB:-zarzadzanie_db}
    volumes:
      - zarzadzanie_postgres_data:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql:ro
      - ./backups:/var/backups/postgres
    ports:
      - "\${POSTGRES_PORT:-5432}:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \${POSTGRES_USER:-zarzadzanie} -d \${POSTGRES_DB:-zarzadzanie_db}"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - zarzadzanie_net

  # 2. Aplikacja Zarządzanie Projektami (Node.js & Frontend & REST API)
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
      DATABASE_URL: postgres://\${POSTGRES_USER:-zarzadzanie}:\${POSTGRES_PASSWORD:-TwojeBezpieczneHaslo2026!}@db:5432/\${POSTGRES_DB:-zarzadzanie_db}
      APP_SECRET: \${APP_SECRET:-sekretna-fraza-szyfrowania-zarzadzanie-projektami-2026}
    ports:
      - "\${APP_PORT:-3000}:3000"
    volumes:
      - ./data:/app/data
    networks:
      - zarzadzanie_net

  # 3. Opcjonalny interfejs graficzny bazy danych (pgAdmin 4)
  pgadmin:
    image: dpage/pgadmin4:latest
    container_name: zarzadzanie_pgadmin
    restart: unless-stopped
    environment:
      PGADMIN_DEFAULT_EMAIL: \${PGADMIN_EMAIL:-admin@pracownia.pl}
      PGADMIN_DEFAULT_PASSWORD: \${PGADMIN_PASSWORD:-SuperAdminHaslo2026!}
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
`;

export const DOCKERFILE_CONTENT = `# ==========================================
# Zarządzanie Projektami - Dockerfile
# Wersja: 2026-10-29 v 0.03.4
# Repozytorium: https://github.com/FraczekMarcin/Zarzadzanie-Projektami
# Ścieżka: Instalacja/Dockerfile
# ==========================================

# Etap 1: Budowanie aplikacji z kodu źródłowego
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install --legacy-peer-deps --no-audit

COPY . .
RUN npm run build

# ==========================================
# Etap 2: Super-lekkie środowisko produkcyjne (Runtime < 130MB)
# ==========================================
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV APP_VERSION="2026-10-29 v 0.03.4"

# Użytkownik o ograniczonych uprawnieniach (Security best practice)
RUN addgroup -g 1001 -S nodejs && \\
    adduser -S appuser -u 1001 -G nodejs

# Kopiowanie skompilowanego frontendu i serwera (zaledwie 650 KB!)
COPY --chown=appuser:nodejs --from=builder /app/dist ./dist

# Instalacja wyłącznie serwera express (zaledwie 2.4 MB bez zbędnych 250 MB devDependencies)
RUN npm --prefix /app init -y && \\
    npm --prefix /app install --no-package-lock --no-audit express@^4.21.2 && \\
    npm cache clean --force

# Dodaj deklarację ESM ("type": "module") do package.json w kontenerze
RUN node -e "const p = require('./package.json'); p.type = 'module'; require('fs').writeFileSync('./package.json', JSON.stringify(p, null, 2));"

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \\
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "dist/server.js"]
`;

export const INIT_SQL_CONTENT = `-- ===================================================
-- Skrypt inicjalizacyjny bazy danych PostgreSQL 16
-- Zarządzanie Projektami - Pracownia Projektowa / Budownictwo
-- Wersja: 2026-10-25 v 0.2
-- Repozytorium: https://github.com/FraczekMarcin/Zarzadzanie-Projektami
-- ===================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Tabela Użytkowników i Projektantów
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255),
    role VARCHAR(32) NOT NULL DEFAULT 'developer', -- 'admin', 'project_manager', 'developer', 'tester', 'viewer'
    department VARCHAR(128),
    initials VARCHAR(8),
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Tabela Projektów Budowlanych
CREATE TABLE IF NOT EXISTS projects (
    id VARCHAR(64) PRIMARY KEY,
    key VARCHAR(32) UNIQUE NOT NULL,              -- Schemat roku i numeru: np. 2026-01, 2026-02
    name VARCHAR(255) NOT NULL,
    description TEXT,
    priority VARCHAR(16) NOT NULL DEFAULT 'normal', -- 'critical', 'high', 'normal', 'low'
    status VARCHAR(32) NOT NULL DEFAULT 'active',   -- 'active', 'planning', 'on_hold', 'completed'
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

-- Powiązanie projektantów z projektami (M:N)
CREATE TABLE IF NOT EXISTS project_members (
    project_id VARCHAR(64) REFERENCES projects(id) ON DELETE CASCADE,
    user_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (project_id, user_id)
);

-- 3. Tabela Etapów Projektowych i Zadań (PZT, PAB, PT, PW, PnB)
CREATE TABLE IF NOT EXISTS tasks (
    id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) REFERENCES projects(id) ON DELETE CASCADE,
    code VARCHAR(32) NOT NULL,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    type VARCHAR(32) NOT NULL DEFAULT 'task',       -- 'task', 'milestone', 'bug', 'feature', 'phase'
    priority VARCHAR(16) NOT NULL DEFAULT 'normal', -- 'critical', 'high', 'normal', 'low'
    status VARCHAR(32) NOT NULL DEFAULT 'to_do',     -- 'to_do', 'in_progress', 'review', 'done', 'blocked'
    assignee_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    reporter_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    start_date DATE NOT NULL,
    due_date DATE NOT NULL,
    duration_days INTEGER NOT NULL DEFAULT 7,
    is_official_deadline BOOLEAN DEFAULT FALSE,    -- Termin urzędowy (ostrzeżenie 3 dni robocze)
    estimated_hours NUMERIC(8, 2) DEFAULT 0,
    spent_hours NUMERIC(8, 2) DEFAULT 0,
    progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    blocking_task_ids JSONB DEFAULT '[]'::jsonb,   -- Zależności i blokady między zadaniami
    parent_id VARCHAR(64) REFERENCES tasks(id) ON DELETE SET NULL, -- Hierarchia WBS
    tags TEXT[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indeksy optymalizacyjne
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_dates ON tasks(start_date, due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_official ON tasks(is_official_deadline);

-- 4. Tabela Szablonów Projektów
CREATE TABLE IF NOT EXISTS project_templates (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(64) NOT NULL,
    description TEXT,
    default_duration_days INTEGER NOT NULL DEFAULT 60,
    default_priority VARCHAR(16) DEFAULT 'normal',
    tasks_blueprint JSONB NOT NULL,
    is_custom BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Tabela Historii Aktywności (Audit Log)
CREATE TABLE IF NOT EXISTS activity_logs (
    id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) REFERENCES projects(id) ON DELETE CASCADE,
    task_id VARCHAR(64) REFERENCES tasks(id) ON DELETE SET NULL,
    user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    details TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. Tabela Komentarzy i Uzgodnień
CREATE TABLE IF NOT EXISTS comments (
    id VARCHAR(64) PRIMARY KEY,
    task_id VARCHAR(64) REFERENCES tasks(id) ON DELETE CASCADE,
    user_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Dane początkowe dla zespołu projektowego
INSERT INTO users (id, name, email, role, department, initials)
VALUES 
    ('usr-1', 'Marcin Frączek', 'fraczek.marcin@gmail.com', 'admin', 'Kierownik Pracowni / Główny Projektant', 'MF'),
    ('usr-2', 'Anna Nowak', 'anna.nowak@pracownia.pl', 'project_manager', 'Architektura i Urbanistyka', 'AN'),
    ('usr-3', 'Piotr Wiśniewski', 'piotr.wisniewski@pracownia.pl', 'developer', 'Konstrukcje Budowlane', 'PW'),
    ('usr-4', 'Tomasz Zieliński', 'tomasz.zielinski@pracownia.pl', 'developer', 'Instalacje Sanitarne i HVAC', 'TZ'),
    ('usr-5', 'Magdalena Lewandowska', 'magda.lewandowska@pracownia.pl', 'viewer', 'Koordynacja Formalno-Prawna', 'ML')
ON CONFLICT (id) DO NOTHING;
`;

export const ENV_EXAMPLE_CONTENT = `# ==============================================================================
# Zarządzanie Projektami - Konfiguracja Środowiska Produkcyjnego
# Wersja: 2026-10-28 v 0.3.2
# Repozytorium: https://github.com/FraczekMarcin/Zarzadzanie-Projektami
# Ścieżka docelowa: /opt/zarzadzanie-projektami/.env
# ==============================================================================
PORT=3000
NODE_ENV=production
APP_VERSION=2026-10-28 v 0.3.2

# Baza danych PostgreSQL 16
POSTGRES_USER=zarzadzanie
POSTGRES_PASSWORD=SilneBezpieczneHasloPostgres2026!
POSTGRES_DB=zarzadzanie_db
POSTGRES_PORT=5432

# Ciąg połączeniowy do kontenera db:
DATABASE_URL=postgres://zarzadzanie:SilneBezpieczneHasloPostgres2026!@db:5432/zarzadzanie_db

# Klucze szyfrowania sesji i bezpieczeństwo
APP_SECRET=wygeneruj_unikalny_ciag_znakow_dla_tokenow_bezpieczenstwa_2026
`;

export const CRON_BACKUP_SCRIPT_CONTENT = `#!/usr/bin/env bash
# ==============================================================================
# Zarządzanie Projektami - Automatyczna Kopia Zapasowa PostgreSQL (Cron)
# Wersja: 2026-10-28 v 0.3.2
# Repozytorium: https://github.com/FraczekMarcin/Zarzadzanie-Projektami
# Lokalizacja skryptu: /opt/zarzadzanie-projektami/backup.sh
# ==============================================================================
set -e

INSTALL_DIR="/opt/zarzadzanie-projektami"
BACKUP_DIR="\${INSTALL_DIR}/backups"
TIMESTAMP=$(date +"%Y-%m-%d_%H%M%S")
FILENAME="zarzadzanie_backup_\${TIMESTAMP}.sql.gz"
CONTAINER_NAME="zarzadzanie_db"
DB_USER="zarzadzanie"
DB_NAME="zarzadzanie_db"
RETENTION_DAYS=14

mkdir -p "\$BACKUP_DIR"

echo "[$(date)] Tworzenie automatycznej kopii zapasowej bazy PostgreSQL..."
docker exec -t "\$CONTAINER_NAME" pg_dump -U "\$DB_USER" "\$DB_NAME" | gzip > "\$BACKUP_DIR/\$FILENAME"
chmod 600 "\$BACKUP_DIR/\$FILENAME"

# Rotacja: usuwanie kopii starszych niż 14 dni
find "\$BACKUP_DIR" -type f -name "zarzadzanie_backup_*.sql.gz" -mtime +\$RETENTION_DAYS -delete

echo "[$(date)] Kopia zapasowa gotowa: \$BACKUP_DIR/\$FILENAME (Zachowano kopie z \$RETENTION_DAYS dni)"
`;

export const INSTALL_SCRIPT_CONTENT = `#!/usr/bin/env bash
# ==============================================================================
# Zarządzanie Projektami - Pracownia Projektowa / Budownictwo
# Wersja: 2026-10-29 v 0.03.4
# Repozytorium: https://github.com/FraczekMarcin/Zarzadzanie-Projektami
# Ścieżka skryptu w repozytorium: Instalacja/install.sh
# Lokalizacja instalacji na serwerze: /opt/zarzadzanie-projektami
# Automatyczny Instalator 1-Poleceniem (Docker + PostgreSQL 16 + Auto-Backup)
# ==============================================================================
set -e

GREEN='\\033[0;32m'
BLUE='\\033[0;34m'
YELLOW='\\033[1;33m'
RED='\\033[0;31m'
NC='\\033[0m'

echo -e "\${BLUE}=================================================================\${NC}"
echo -e "\${GREEN}  🏗️  Zarządzanie Projektami - Instalator (Wersja 2026-10-29 v 0.03.4)\${NC}"
echo -e "\${BLUE}  Repozytorium: https://github.com/FraczekMarcin/Zarzadzanie-Projektami\${NC}"
echo -e "\${BLUE}=================================================================\${NC}"

# 1. Sprawdzenie uprawnień roota
if [ "$EUID" -ne 0 ]; then
  echo -e "\${YELLOW}Wskazówka: Uruchom instalator jako root lub przez 'sudo bash install.sh'\${NC}"
fi

# 2. Sprawdzenie i ewentualna automatyczna instalacja Dockera
if ! command -v docker &> /dev/null; then
    echo -e "\${YELLOW}Docker nie został wykryty. Rozpoczynanie automatycznej instalacji silnika Docker...\${NC}"
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
    echo -e "\${RED}Błąd: Nie znaleziono narzędzia Docker Compose. Zainstaluj wtyczkę Docker Compose v2.\${NC}"
    exit 1
fi

INSTALL_DIR="/opt/zarzadzanie-projektami"
echo -e "\${BLUE}==> Katalog roboczy instalacji: \${INSTALL_DIR}\${NC}"
mkdir -p "\$INSTALL_DIR"
mkdir -p "\$INSTALL_DIR/backups"

# 4. Wykrycie źródła plików (lokalne repozytorium vs pobieranie z GitHub)
SCRIPT_DIR="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"
REPO_URL="https://github.com/FraczekMarcin/Zarzadzanie-Projektami.git"

if [ -f "\$SCRIPT_DIR/../package.json" ]; then
    SRC_DIR="\$(cd "\$SCRIPT_DIR/.." && pwd)"
    echo -e "\${BLUE}==> Wykryto lokalne repozytorium źródłowe: \${SRC_DIR}\${NC}"
    echo -e "\${BLUE}==> Kopiowanie plików aplikacji do \${INSTALL_DIR}...\${NC}"
    cp -r "\$SRC_DIR"/* "\$INSTALL_DIR/" 2>/dev/null || true
    cp -r "\$SRC_DIR"/.[!.]* "\$INSTALL_DIR/" 2>/dev/null || true
elif [ -f "\$SCRIPT_DIR/package.json" ]; then
    SRC_DIR="\$SCRIPT_DIR"
    echo -e "\${BLUE}==> Wykryto pliki aplikacji w katalogu: \${SRC_DIR}\${NC}"
    cp -r "\$SRC_DIR"/* "\$INSTALL_DIR/" 2>/dev/null || true
    cp -r "\$SRC_DIR"/.[!.]* "\$INSTALL_DIR/" 2>/dev/null || true
else
    echo -e "\${BLUE}==> Klonowanie oficjalnego repozytorium GitHub do katalogu instalacji...\${NC}"
    TEMP_CLONE=\$(mktemp -d)
    if command -v git &> /dev/null; then
        git clone "\$REPO_URL" "\$TEMP_CLONE" 2>/dev/null || true
        cp -r "\$TEMP_CLONE"/* "\$INSTALL_DIR/" 2>/dev/null || true
        cp -r "\$TEMP_CLONE"/.[!.]* "\$INSTALL_DIR/" 2>/dev/null || true
        rm -rf "\$TEMP_CLONE"
    fi
fi

# Upewnij się, że kluczowe pliki wdrożeniowe z katalogu Instalacja/ są umieszczone bezpośrednio w katalogu docelowym
if [ -d "\$INSTALL_DIR/Instalacja" ]; then
    cp -f "\$INSTALL_DIR/Instalacja/Dockerfile" "\$INSTALL_DIR/Dockerfile" 2>/dev/null || true
    cp -f "\$INSTALL_DIR/Instalacja/docker-compose.yml" "\$INSTALL_DIR/docker-compose.yml" 2>/dev/null || true
    cp -f "\$INSTALL_DIR/Instalacja/init.sql" "\$INSTALL_DIR/init.sql" 2>/dev/null || true
    cp -f "\$INSTALL_DIR/Instalacja/backup.sh" "\$INSTALL_DIR/backup.sh" 2>/dev/null || true
    cp -f "\$INSTALL_DIR/Instalacja/.dockerignore" "\$INSTALL_DIR/.dockerignore" 2>/dev/null || true
fi

cd "\$INSTALL_DIR"

# 5. Generowanie bezpiecznych haseł i kluczy szyfrujących
DB_PASS=\$(openssl rand -hex 16 2>/dev/null || date +%s%N | sha256sum | head -c 32)
APP_SECRET=\$(openssl rand -hex 32 2>/dev/null || date +%s%N | sha256sum | head -c 64)

# 6. Tworzenie bezpiecznego pliku .env (jeśli jeszcze nie istnieje)
if [ ! -f .env ]; then
    echo -e "\${BLUE}==> Generowanie pliku .env z unikalnymi kluczami i hasłami PostgreSQL...\${NC}"
    cat <<EOF > .env
PORT=3000
NODE_ENV=production
APP_VERSION=2026-10-28 v 0.3.2
POSTGRES_USER=zarzadzanie
POSTGRES_PASSWORD=\${DB_PASS}
POSTGRES_DB=zarzadzanie_db
POSTGRES_PORT=5432
DATABASE_URL=postgres://zarzadzanie:\${DB_PASS}@db:5432/zarzadzanie_db
APP_SECRET=\${APP_SECRET}
EOF
    chmod 600 .env
    echo -e "\${GREEN}Plik .env wygenerowany i zabezpieczony.\${NC}"
else
    echo -e "\${YELLOW}Wykryto istniejący plik .env - zachowano konfigurację i hasła bazy danych.\${NC}"
fi

# 7. Zabezpieczenie docker-compose.yml (usunięcie zbędnych wersji, upewnienie się o poprawnym kontekście)
if [ ! -f docker-compose.yml ] || grep -q "context: \\.\\." docker-compose.yml 2>/dev/null || grep -q "version:" docker-compose.yml 2>/dev/null || grep -q "zarzadzanie.local" docker-compose.yml 2>/dev/null; then
    cat <<'EOF' > docker-compose.yml
services:
  db:
    image: postgres:16-alpine
    container_name: zarzadzanie_db
    restart: unless-stopped
    environment:
      POSTGRES_USER: \${POSTGRES_USER:-zarzadzanie}
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:-TwojeBezpieczneHaslo2026!}
      POSTGRES_DB: \${POSTGRES_DB:-zarzadzanie_db}
    volumes:
      - zarzadzanie_postgres_data:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql:ro
      - ./backups:/var/backups/postgres
    ports:
      - "\${POSTGRES_PORT:-5432}:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \${POSTGRES_USER:-zarzadzanie} -d \${POSTGRES_DB:-zarzadzanie_db}"]
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
      APP_VERSION: "2026-10-28 v 0.3.2"
      DATABASE_URL: postgres://\${POSTGRES_USER:-zarzadzanie}:\${POSTGRES_PASSWORD:-TwojeBezpieczneHaslo2026!}@db:5432/\${POSTGRES_DB:-zarzadzanie_db}
      APP_SECRET: \${APP_SECRET:-sekretna-fraza-szyfrowania-zarzadzanie-projektami-2026}
    ports:
      - "\${APP_PORT:-3000}:3000"
    networks:
      - zarzadzanie_net

  pgadmin:
    image: dpage/pgadmin4:latest
    container_name: zarzadzanie_pgadmin
    restart: unless-stopped
    environment:
      PGADMIN_DEFAULT_EMAIL: \${PGADMIN_EMAIL:-admin@pracownia.pl}
      PGADMIN_DEFAULT_PASSWORD: \${PGADMIN_PASSWORD:-SuperAdminHaslo2026!}
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
echo -e "\${BLUE}==> Konfiguracja automatycznego skryptu kopii zapasowych (backup.sh)...\${NC}"
cat <<'EOF' > /opt/zarzadzanie-projektami/backup.sh
#!/usr/bin/env bash
BACKUP_DIR="/opt/zarzadzanie-projektami/backups"
TIMESTAMP=$(date +"%Y-%m-%d_%H%M%S")
FILENAME="zarzadzanie_backup_\${TIMESTAMP}.sql.gz"
mkdir -p "$BACKUP_DIR"
docker exec -t zarzadzanie_db pg_dump -U zarzadzanie zarzadzanie_db | gzip > "$BACKUP_DIR/$FILENAME"
chmod 600 "$BACKUP_DIR/$FILENAME"
find "$BACKUP_DIR" -type f -name "zarzadzanie_backup_*.sql.gz" -mtime +14 -delete
EOF
chmod +x /opt/zarzadzanie-projektami/backup.sh

CRON_FILE="/etc/cron.d/zarzadzanie-projektami-backup"
if [ ! -f "\$CRON_FILE" ]; then
    echo "0 2 * * * root /opt/zarzadzanie-projektami/backup.sh >/dev/null 2>&1" > "\$CRON_FILE"
    chmod 644 "\$CRON_FILE"
    echo -e "\${GREEN}Automatyczne kopie zapasowe skonfigurowane w cronie: codziennie o 02:00 w nocy (retencja 14 dni).\${NC}"
fi

# 10. Start kontenerów (budowa i uruchomienie)
echo -e "\${BLUE}==> Zwalnianie tymczasowej pamięci podręcznej i zbędnych warstw Dockera...\${NC}"
docker system prune -f 2>/dev/null || true
docker builder prune -a -f 2>/dev/null || true
docker image prune -f 2>/dev/null || true

echo -e "\${BLUE}==> Uruchamianie kontenerów (PostgreSQL 16 + Zarządzanie Projektami)...\${NC}"
\$DOCKER_CMD up -d --build

SERVER_IP=\$(hostname -I 2>/dev/null | awk '{print \$1}' || echo "localhost")

echo -e "\${GREEN}=================================================================\${NC}"
echo -e "\${GREEN}  ✅ WDROŻENIE ZAKOŃCZONE SUKCESEM!\${NC}"
echo -e "\${GREEN}  Wersja: 2026-10-29 v 0.03.4\${NC}"
echo -e "\${GREEN}=================================================================\${NC}"
echo -e "Aplikacja działa i jest dostępna pod:"
echo -e "  👉 \${YELLOW}http://\${SERVER_IP}:3000\${NC} lub \${YELLOW}http://localhost:3000\${NC}"
echo -e ""
echo -e "🛡️  Trwałość danych: Wolumen PostgreSQL '\${BLUE}zarzadzanie_postgres_data\${NC}' przechowuje dane trwale."
echo -e "💾  Automatyczne kopie: Skonfigurowane w '\${BLUE}/opt/zarzadzanie-projektami/backups\${NC}' (Cron o 02:00)."
echo -e "Zarządzanie aplikacją:"
echo -e "  - Podgląd logów:           \${YELLOW}cd \${INSTALL_DIR} && \$DOCKER_CMD logs -f\${NC}"
echo -e "  - Aktualizacja z GitHub:   \${YELLOW}cd \${INSTALL_DIR} && git pull && \$DOCKER_CMD up -d --build\${NC}"
echo -e "  - Ręczna kopia zapasowa:   \${YELLOW}/opt/zarzadzanie-projektami/backup.sh\${NC}"
echo -e "  - Zatrzymanie:             \${YELLOW}cd \${INSTALL_DIR} && \$DOCKER_CMD down\${NC}"
echo -e "\${GREEN}=================================================================\${NC}"
`;

export const README_MD_CONTENT = `# 🏗️ Zarządzanie Projektami (Pracownia Projektowa / Budownictwo)

[![Wersja](https://img.shields.io/badge/Wersja-2026--10--29%20v%200.3.3-emerald.svg)](https://github.com/FraczekMarcin/Zarzadzanie-Projektami)
[![Docker](https://img.shields.io/badge/Docker-PostgreSQL%2016-blue.svg)](https://www.docker.com/)
[![GitHub](https://img.shields.io/badge/GitHub-FraczekMarcin%2FZarzadzanie--Projektami-purple.svg)](https://github.com/FraczekMarcin/Zarzadzanie-Projektami)

Nowoczesny system zarządzania projektami dla biur projektowych i inżynieryjnych.

## ⚡ Instalacja 1-poleceniem (Linux VPS / Serwer)

\`\`\`bash
# Wariant 1: Bezpośrednie pobranie i instalacja z katalogu Instalacja na GitHub
curl -fsSL https://raw.githubusercontent.com/FraczekMarcin/Zarzadzanie-Projektami/main/Instalacja/install.sh | sudo bash

# Wariant 2: Tradycyjne klonowanie Git (100% niezawodne na każdym serwerze)
git clone https://github.com/FraczekMarcin/Zarzadzanie-Projektami.git
cd Zarzadzanie-Projektami/Instalacja && sudo bash install.sh
\`\`\`

Aplikacja uruchamia się pod adresem: http://twoj-serwer:3000

## 🛡️ Trwałość danych (PostgreSQL 16)
Baza danych zapisywana jest w niezależnym wolumenie Docker \`zarzadzanie_postgres_data\`.
Aktualizacja kodu komendą \`git pull && docker compose up -d --build\` NIE USUWA danych projektów ani zadań!

## 💾 Automatyczne kopie zapasowe (Cron)
Skrypt \`/opt/zarzadzanie-projektami/backup.sh\` wykonuje codzienny zrzut bazy o 02:00 w nocy do formatu gzip z 14-dniową rotacją.
`;

export const DOCKER_FILES: DockerConfigFile[] = [
  {
    name: 'Skrypt 1-poleceniem',
    filename: 'install.sh',
    description: 'Automatyczny skrypt instalacyjny dla Linux - pobiera projekt z GitHub, konfiguruje Docker, PostgreSQL 16, wolumeny oraz automatyczny cron kopii zapasowych.',
    language: 'bash',
    content: INSTALL_SCRIPT_CONTENT,
  },
  {
    name: 'Dokumentacja README',
    filename: 'README.md',
    description: 'Oficjalna dokumentacja projektu dla GitHub, opis instalacji 1-poleceniem, architektury bazy i kopii zapasowych.',
    language: 'markdown',
    content: README_MD_CONTENT,
  },
  {
    name: 'Docker Compose',
    filename: 'docker-compose.yml',
    description: 'Orkiestracja kontenerów: PostgreSQL 16 + Aplikacja Zarządzanie Projektami + pgAdmin 4 + wolumeny trwałe.',
    language: 'yaml',
    content: DOCKER_COMPOSE_YML,
  },
  {
    name: 'Skrypt Auto-Backup (Cron)',
    filename: 'backup.sh',
    description: 'Skrypt automatycznych kopii zapasowych bazy PostgreSQL z kompresją gzip i 14-dniową polityką retencji.',
    language: 'bash',
    content: CRON_BACKUP_SCRIPT_CONTENT,
  },
  {
    name: 'Dockerfile',
    filename: 'Dockerfile',
    description: 'Wieloetapowy (multi-stage) build na bazie Alpine Linux z użytkownikiem non-root i healthcheckiem.',
    language: 'dockerfile',
    content: DOCKERFILE_CONTENT,
  },
  {
    name: 'Schemat PostgreSQL',
    filename: 'init.sql',
    description: 'Relacyjna struktura tabel: użytkownicy, projekty budowlane, etapy i zadania, zależności Gantta, historia zmian i szablony.',
    language: 'sql',
    content: INIT_SQL_CONTENT,
  },
  {
    name: 'Zmienne środowiskowe',
    filename: '.env.production',
    description: 'Konfiguracja haseł do bazy danych, portów oraz kluczy szyfrujących.',
    language: 'bash',
    content: ENV_EXAMPLE_CONTENT,
  },
];

