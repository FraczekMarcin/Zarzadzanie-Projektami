export interface DockerConfigFile {
  name: string;
  filename: string;
  description: string;
  language: string;
  content: string;
}

export const DOCKER_COMPOSE_YML = `version: '3.8'

services:
  # 1. Baza danych PostgreSQL 16
  db:
    image: postgres:16-alpine
    container_name: openproject_hub_db
    restart: unless-stopped
    environment:
      POSTGRES_USER: \${POSTGRES_USER:-openproject}
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:-TwojeBezpieczneHaslo2026!}
      POSTGRES_DB: \${POSTGRES_DB:-openproject_db}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    ports:
      - "\${POSTGRES_PORT:-5432}:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \${POSTGRES_USER:-openproject} -d \${POSTGRES_DB:-openproject_db}"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - openproject_net

  # 2. Aplikacja OpenProject Hub (Node.js & Frontend & API)
  app:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: openproject_hub_app
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      NODE_ENV: production
      PORT: 3000
      DATABASE_URL: postgres://\${POSTGRES_USER:-openproject}:\${POSTGRES_PASSWORD:-TwojeBezpieczneHaslo2026!}@db:5432/\${POSTGRES_DB:-openproject_db}
      APP_SECRET: \${APP_SECRET:-sekretna-fraza-szyfrowania-sesji-jwt}
    ports:
      - "\${APP_PORT:-3000}:3000"
    networks:
      - openproject_net

  # 3. Opcjonalny interfejs graficzny bazy danych (pgAdmin 4)
  pgadmin:
    image: dpage/pgadmin4:latest
    container_name: openproject_hub_pgadmin
    restart: unless-stopped
    environment:
      PGADMIN_DEFAULT_EMAIL: admin@twojadomena.pl
      PGADMIN_DEFAULT_PASSWORD: SuperAdminHaslo2026!
    ports:
      - "5050:80"
    depends_on:
      - db
    networks:
      - openproject_net

volumes:
  postgres_data:
    driver: local

networks:
  openproject_net:
    driver: bridge
`;

export const DOCKERFILE_CONTENT = `# ==========================================
# Etap 1: Budowanie aplikacji (Builder)
# ==========================================
FROM node:20-alpine AS builder

WORKDIR /app

# Instalacja zależności
COPY package*.json ./
RUN npm ci

# Kopiowanie kodu źródłowego i kompilacja
COPY . .
RUN npm run build

# ==========================================
# Etap 2: Środowisko produkcyjne (Runtime)
# ==========================================
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Instalacja wyłącznie produkcyjnych zależności
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Kopiowanie skompilowanego frontendu oraz serwera
COPY --from=builder /app/dist ./dist
COPY server.ts ./server.ts
COPY --from=builder /app/node_modules ./node_modules

# Utworzenie użytkownika o ograniczonych uprawnieniach (Security best practice)
RUN addgroup -g 1001 -S nodejs && \\
    adduser -S appuser -u 1001 -G nodejs && \\
    chown -R appuser:nodejs /app

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \\
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["npx", "tsx", "server.ts"]
`;

export const INIT_SQL_CONTENT = `-- ===================================================
-- Skrypt inicjalizacyjny bazy danych PostgreSQL 16
-- OpenProject Hub - Relacyjny schemat bazodanowy
-- ===================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Tabela Użytkowników
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

-- 2. Tabela Projektów
CREATE TABLE IF NOT EXISTS projects (
    id VARCHAR(64) PRIMARY KEY,
    key VARCHAR(16) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    priority VARCHAR(16) NOT NULL DEFAULT 'medium',
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    start_date DATE NOT NULL,
    due_date DATE NOT NULL,
    progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    budget VARCHAR(64),
    spent_hours NUMERIC(10, 2) DEFAULT 0,
    color VARCHAR(32) DEFAULT '#0284c7',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Powiązanie użytkowników z projektami (M:N)
CREATE TABLE IF NOT EXISTS project_members (
    project_id VARCHAR(64) REFERENCES projects(id) ON DELETE CASCADE,
    user_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (project_id, user_id)
);

-- 3. Tabela Zadań i Pakietów Roboczych (Work Packages)
CREATE TABLE IF NOT EXISTS tasks (
    id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) REFERENCES projects(id) ON DELETE CASCADE,
    code VARCHAR(32) NOT NULL,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    type VARCHAR(32) NOT NULL DEFAULT 'task',     -- 'task', 'milestone', 'bug', 'feature', 'phase'
    priority VARCHAR(16) NOT NULL DEFAULT 'medium', -- 'critical', 'high', 'medium', 'low'
    status VARCHAR(32) NOT NULL DEFAULT 'to_do',   -- 'to_do', 'in_progress', 'review', 'done', 'blocked'
    assignee_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    reporter_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    start_date DATE NOT NULL,
    due_date DATE NOT NULL,
    estimated_hours NUMERIC(8, 2) DEFAULT 0,
    spent_hours NUMERIC(8, 2) DEFAULT 0,
    progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    tags TEXT[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indeksy dla optymalizacji zapytań o terminarz i harmonogram
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_dates ON tasks(start_date, due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);

-- 4. Tabela Zależności między Zadaniami (Gantt dependencies)
CREATE TABLE IF NOT EXISTS task_dependencies (
    task_id VARCHAR(64) REFERENCES tasks(id) ON DELETE CASCADE,
    depends_on_task_id VARCHAR(64) REFERENCES tasks(id) ON DELETE CASCADE,
    dependency_type VARCHAR(16) DEFAULT 'finish_to_start',
    PRIMARY KEY (task_id, depends_on_task_id)
);

-- 5. Tabela Historii Aktywności (Audit Log & Multi-user tracking)
CREATE TABLE IF NOT EXISTS activity_logs (
    id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) REFERENCES projects(id) ON DELETE CASCADE,
    task_id VARCHAR(64) REFERENCES tasks(id) ON DELETE SET NULL,
    user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    details TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. Tabela Komentarzy
CREATE TABLE IF NOT EXISTS comments (
    id VARCHAR(64) PRIMARY KEY,
    task_id VARCHAR(64) REFERENCES tasks(id) ON DELETE CASCADE,
    user_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Dane początkowe dla administratora
INSERT INTO users (id, name, email, role, department, initials)
VALUES 
    ('usr-1', 'Marcin Frączek', 'fraczek.marcin@gmail.com', 'admin', 'Architektura & Rozwój', 'MF'),
    ('usr-2', 'Anna Nowak', 'anna.nowak@firma.pl', 'project_manager', 'Zarządzanie Projektami', 'AN')
ON CONFLICT (id) DO NOTHING;
`;

export const ENV_EXAMPLE_CONTENT = `# Konfiguracja środowiska produkcyjnego OpenProject Hub
PORT=3000
NODE_ENV=production

# Baza danych PostgreSQL
POSTGRES_USER=openproject
POSTGRES_PASSWORD=WpiszTutajSilneLosoweHaslo123!
POSTGRES_DB=openproject_db
POSTGRES_PORT=5432

# Połączenie dla aplikacji:
DATABASE_URL=postgres://openproject:WpiszTutajSilneLosoweHaslo123!@db:5432/openproject_db

# Bezpieczeństwo i sesje
APP_SECRET=wygeneruj_dlugi_ciag_znakow_dla_tokenow_jwt
`;

export const DOCKER_FILES: DockerConfigFile[] = [
  {
    name: 'Docker Compose',
    filename: 'docker-compose.yml',
    description: 'Orkiestracja kontenerów: PostgreSQL 16 + Aplikacja Node.js + pgAdmin 4 + wolumeny trwałe.',
    language: 'yaml',
    content: DOCKER_COMPOSE_YML,
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
    description: 'Relacyjna struktura tabel: użytkownicy, projekty, zadania, zależności Gantta, historia zmian i indeksy.',
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
