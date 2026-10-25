-- ===================================================
-- Skrypt inicjalizacyjny bazy danych PostgreSQL 16
-- Zarządzanie Projektami - Pracownia Projektowa / Budownictwo
-- Wersja: 2026-10-25 v 0.2.1
-- Repozytorium: https://github.com/FraczekMarcin/Zarzadzanie-Projektami
-- Ścieżka: Instalacja/init.sql
-- ===================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Tabela Użytkowników i Projektantów
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

-- 2. Tabela Projektów Budowlanych
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

-- Dane początkowe
INSERT INTO users (id, name, email, role, department, initials)
VALUES 
    ('usr-1', 'Marcin Frączek', 'fraczek.marcin@gmail.com', 'admin', 'Kierownik Pracowni / Główny Projektant', 'MF'),
    ('usr-2', 'Anna Nowak', 'anna.nowak@pracownia.pl', 'project_manager', 'Architektura i Urbanistyka', 'AN')
ON CONFLICT (id) DO NOTHING;
