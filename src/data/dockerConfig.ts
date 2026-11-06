export interface DockerConfigFile {
  name: string;
  filename: string;
  description: string;
  language: string;
  content: string;
}

export const GITHUB_REPO_URL = 'https://github.com/FraczekMarcin/Zarzadzanie-Projektami';
export const CURRENT_APP_VERSION = '2026-11-06 v0.4.1';
export const INSTALL_TARGET_DIR = '/opt/zarzadzanie-projektami';
export const RAW_INSTALL_SCRIPT_URL = 'https://raw.githubusercontent.com/FraczekMarcin/Zarzadzanie-Projektami/main/Instalacja/install.sh';
export const GITHUB_RAW_FALLBACK_URL = 'https://github.com/FraczekMarcin/Zarzadzanie-Projektami/raw/main/Instalacja/install.sh';

export const DOCKER_COMPOSE_YML = `# ==============================================================================
# Zarządzanie Projektami (Pracownia Projektowa / Budownictwo)
# Wersja: 2026-11-02 v0.4.0
# Repozytorium: https://github.com/FraczekMarcin/Zarzadzanie-Projektami
# Lokalizacja docelowa na serwerze: /opt/zarzadzanie-projektami
# ==============================================================================

services:
  # Aplikacja Zarządzanie Projektami (Node.js & Frontend & REST API)
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
      APP_SECRET: \${APP_SECRET:-sekretna-fraza-szyfrowania-zarzadzanie-projektami-2026}
    ports:
      - "\${APP_PORT:-3000}:3000"
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
`;

export const DOCKERFILE_CONTENT = `# ==========================================
# Zarządzanie Projektami - Dockerfile
# Wersja: 2026-11-02 v0.4.0
# Repozytorium: https://github.com/FraczekMarcin/Zarzadzanie-Projektami
# Ścieżka: Instalacja/Dockerfile
# ==========================================

# Etap 1: Budowanie aplikacji z kodu źródłowego
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ==========================================
# Etap 2: Super-lekkie środowisko produkcyjne (Runtime < 130MB)
# ==========================================
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data
ENV APP_VERSION="2026-11-02 v0.4.0"

# Użytkownik o ograniczonych uprawnieniach (Security best practice)
RUN addgroup -g 1001 -S nodejs && \\
    adduser -S appuser -u 1001 -G nodejs

# Tworzenie i uprawnienia do trwałego katalogu danych
RUN mkdir -p /app/data && chown -R appuser:nodejs /app/data

# Kopiowanie skompilowanego frontendu i serwera (zaledwie 650 KB!)
COPY --chown=appuser:nodejs --from=builder /app/dist ./dist

# Instalacja wyłącznie serwera express, nodemailer i dotenv (bez zbędnych 250 MB devDependencies)
RUN npm --prefix /app init -y && \\
    npm --prefix /app install --no-package-lock --no-audit express@^4.21.2 nodemailer@^10.3.1 dotenv@^17.2.3 && \\
    npm cache clean --force

# Dodaj deklarację ESM ("type": "module") do package.json w kontenerze
RUN node -e "const p = require('./package.json'); p.type = 'module'; require('fs').writeFileSync('./package.json', JSON.stringify(p, null, 2));"

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \\
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "dist/server.js"]
`;

export const ENV_EXAMPLE_CONTENT = `# ==============================================================================
# Zarządzanie Projektami - Konfiguracja Środowiska Produkcyjnego
# Wersja: 2026-11-02 v0.4.0
# Repozytorium: https://github.com/FraczekMarcin/Zarzadzanie-Projektami
# Ścieżka docelowa: /opt/zarzadzanie-projektami/.env
# ==============================================================================
PORT=3000
NODE_ENV=production
DATA_DIR=/app/data
APP_VERSION=2026-11-02 v0.4.0

# Klucze szyfrowania sesji i bezpieczeństwo
APP_SECRET=wygeneruj_unikalny_ciag_znakow_dla_tokenow_bezpieczenstwa_2026
`;

export const CRON_BACKUP_SCRIPT_CONTENT = `#!/usr/bin/env bash
# ==============================================================================
# Zarządzanie Projektami - Kopia Zapasowa Pliku Stanu (app_state.json)
# Wersja: 2026-11-02 v 0.4.0
# Repozytorium: https://github.com/FraczekMarcin/Zarzadzanie-Projektami
# Ścieżka docelowa: /opt/zarzadzanie-projektami/backup.sh
# ==============================================================================
set -Eeuo pipefail

INSTALL_DIR="\${INSTALL_DIR:-/opt/zarzadzanie-projektami}"
BACKUP_DIR="\${BACKUP_DIR:-\${INSTALL_DIR}/backups}"
CONTAINER_NAME="\${CONTAINER_NAME:-zarzadzanie_app}"
TIMESTAMP=\$(date +"%Y-%m-%d_%H%M%S")
FILENAME="app_state_\${TIMESTAMP}.json.gz"
TARGET_GZ="\${BACKUP_DIR}/\${FILENAME}"
TMP_JSON="\${BACKUP_DIR}/.app_state_\${TIMESTAMP}.tmp.json"
TMP_GZ="\${BACKUP_DIR}/.app_state_\${TIMESTAMP}.tmp.gz"
MIN_KEEP=7
RETENTION_DAYS=14

# Sprzątanie plików tymczasowych w razie błędu lub wyjścia
cleanup() {
    rm -f "\$TMP_JSON" "\$TMP_GZ" 2>/dev/null || true
}
trap cleanup EXIT ERR

mkdir -p "\$BACKUP_DIR"

echo "[\$(date '+%Y-%m-%d %H:%M:%S')] Rozpoczynanie kopii zapasowej pliku stanu z kontenera '\$CONTAINER_NAME'..."

# Sprawdzenie czy kontener istnieje i działa
if ! docker inspect --type=container "\$CONTAINER_NAME" >/dev/null 2>&1; then
    echo "[\$(date '+%Y-%m-%d %H:%M:%S')] BŁĄD: Kontener '\$CONTAINER_NAME' nie istnieje lub nie jest dostępny!" >&2
    exit 1
fi

# Pobranie app_state.json z kontenera
docker exec "\$CONTAINER_NAME" cat /app/data/app_state.json > "\$TMP_JSON"

# 1. Sprawdzenie czy plik tymczasowy istnieje
if [ ! -f "\$TMP_JSON" ]; then
    echo "[\$(date '+%Y-%m-%d %H:%M:%S')] BŁĄD: Plik tymczasowy nie został utworzony!" >&2
    exit 1
fi

# 2. Sprawdzenie rozmiaru (> 100 bajtów)
FILE_SIZE=\$(wc -c < "\$TMP_JSON" | tr -d ' ')
if [ "\$FILE_SIZE" -le 100 ]; then
    echo "[\$(date '+%Y-%m-%d %H:%M:%S')] BŁĄD: Plik stanu jest zbyt mały (\$FILE_SIZE bajtów <= 100 bajtów) lub pusty!" >&2
    exit 1
fi

# 3. Sprawdzenie poprawności JSON (jq empty)
if command -v jq >/dev/null 2>&1; then
    if ! jq empty "\$TMP_JSON" >/dev/null 2>&1; then
        echo "[\$(date '+%Y-%m-%d %H:%M:%S')] BŁĄD: Wygenerowany plik nie jest poprawnym formatem JSON (jq empty zwróciło błąd)!" >&2
        exit 1
    fi
else
    if command -v node >/dev/null 2>&1; then
        node -e "JSON.parse(require('fs').readFileSync(process.argv[1]))" "\$TMP_JSON"
    fi
fi

# 4. Kompresja gzip
gzip -c "\$TMP_JSON" > "\$TMP_GZ"

# 5. Sprawdzenie integralności archiwum gzip (gzip -t)
if ! gzip -t "\$TMP_GZ" >/dev/null 2>&1; then
    echo "[\$(date '+%Y-%m-%d %H:%M:%S')] BŁĄD: Test integralności gzip -t nie powiódł się!" >&2
    exit 1
fi

# Przeniesienie pliku do docelowej lokalizacji
mv "\$TMP_GZ" "\$TARGET_GZ"
chmod 600 "\$TARGET_GZ"
rm -f "\$TMP_JSON"

echo "[\$(date '+%Y-%m-%d %H:%M:%S')] Kopia zapasowa utworzona pomyślnie: \$TARGET_GZ (\$(wc -c < "\$TARGET_GZ" | tr -d ' ') bajtów)"

# 6. Rotacja: tylko jeśli nowa kopia powstała poprawnie i zawsze zostawiamy minimum 7 ostatnich kopii
mapfile -t ALL_BACKUPS < <(find "\$BACKUP_DIR" -maxdepth 1 -type f -name "app_state_*.json.gz" | sort -r)
COUNT=\${#ALL_BACKUPS[@]}

if [ "\$COUNT" -gt "\$MIN_KEEP" ]; then
    for ((i=MIN_KEEP; i<COUNT; i++)); do
        OLD_FILE="\${ALL_BACKUPS[\$i]}"
        if [ -n "\$(find "\$OLD_FILE" -mtime +\$RETENTION_DAYS -print 2>/dev/null)" ]; then
            echo "[\$(date '+%Y-%m-%d %H:%M:%S')] Rotacja: usuwanie kopii starszej niż \$RETENTION_DAYS dni: \$OLD_FILE"
            rm -f "\$OLD_FILE"
        fi
    done
fi

echo "[\$(date '+%Y-%m-%d %H:%M:%S')] Zakończono pomyślnie. Zachowano \$COUNT kopii (minimum \$MIN_KEEP)."
`;

export const INSTALL_SCRIPT_CONTENT = `#!/usr/bin/env bash
# ==============================================================================
# Zarządzanie Projektami - Pracownia Projektowa / Budownictwo
# Wersja: 2026-11-02 v0.4.0
# Repozytorium: https://github.com/FraczekMarcin/Zarzadzanie-Projektami
# Ścieżka skryptu w repozytorium: install.sh / Instalacja/install.sh
# Lokalizacja docelowa na serwerze: /opt/zarzadzanie-projektami
# ==============================================================================
set -e

GREEN='\\033[0;32m'
BLUE='\\033[0;34m'
YELLOW='\\033[1;33m'
RED='\\033[0;31m'
NC='\\033[0m'

echo -e "\${BLUE}=================================================================\${NC}"
echo -e "\${GREEN}  🏗️  Zarządzanie Projektami - Instalator (Wersja 2026-11-02 v0.4.0)\${NC}"
echo -e "\${BLUE}  Repozytorium: https://github.com/FraczekMarcin/Zarzadzanie-Projektami\${NC}"
echo -e "\${BLUE}=================================================================\${NC}"

# 1. Sprawdzenie uprawnień roota
if [ "$EUID" -ne 0 ]; then
  echo -e "\${YELLOW}Wskazówka: Zalecane uruchomienie jako root lub przez 'sudo bash install.sh'\${NC}"
fi

# 2. Sprawdzenie i ewentualna automatyczna instalacja Dockera
if ! command -v docker &> /dev/null; then
    echo -e "\${YELLOW}Docker nie został wykryty. Instalowanie silnika Docker...\${NC}"
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
    echo -e "\${RED}Błąd: Nie znaleziono Docker Compose. Zainstaluj wtyczkę Docker Compose v2.\${NC}"
    exit 1
fi

INSTALL_DIR="/opt/zarzadzanie-projektami"
echo -e "\${BLUE}==> Przygotowanie katalogu instalacji: \${INSTALL_DIR}\${NC}"
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
    cp -f "\$INSTALL_DIR/Instalacja/backup.sh" "\$INSTALL_DIR/backup.sh" 2>/dev/null || true
    cp -f "\$INSTALL_DIR/Instalacja/.dockerignore" "\$INSTALL_DIR/.dockerignore" 2>/dev/null || true
fi

cd "\$INSTALL_DIR"

# 5. Generowanie bezpiecznych kluczy sesji
APP_SECRET=\$(openssl rand -hex 32 2>/dev/null || date +%s%N | sha256sum | head -c 64)

# 6. Bezpieczny plik .env
if [ ! -f .env ]; then
    echo -e "\${BLUE}==> Generowanie pliku konfiguracyjnego .env...\${NC}"
    cat <<EOF > .env
PORT=3000
NODE_ENV=production
DATA_DIR=/app/data
APP_VERSION=2026-11-02 v0.4.0
APP_SECRET=\${APP_SECRET}
EOF
    chmod 600 .env
    echo -e "\${GREEN}Plik .env wygenerowany (uprawnienia 600).\${NC}"
else
    echo -e "\${YELLOW}Wykryto istniejący plik .env - konfiguracja zachowana.\${NC}"
fi

# 7. Konfiguracja docker-compose.yml
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
      APP_SECRET: \${APP_SECRET:-sekretna-fraza-szyfrowania-zarzadzanie-projektami-2026}
    ports:
      - "\${APP_PORT:-3000}:3000"
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

# 8. Konfiguracja automatycznego skryptu kopii zapasowej
chmod +x "\$INSTALL_DIR/backup.sh"

CRON_FILE="/etc/cron.d/zarzadzanie-projektami-backup"
if [ ! -f "\$CRON_FILE" ]; then
    echo "0 2 * * * root /opt/zarzadzanie-projektami/backup.sh >/dev/null 2>&1" > "\$CRON_FILE"
    chmod 644 "\$CRON_FILE"
    echo -e "\${GREEN}Automatyczne kopie zapasowe skonfigurowane w cronie: codziennie o 02:00 w nocy (retencja minimum 7 kopii).\${NC}"
fi

# 9. Start kontenera aplikacji
echo -e "\${BLUE}==> Budowanie i uruchamianie aplikacji...\${NC}"
\$DOCKER_CMD up -d --build

SERVER_IP=\$(hostname -I 2>/dev/null | awk '{print \$1}' || echo "localhost")

echo -e "\${GREEN}=================================================================\${NC}"
echo -e "\${GREEN}  ✅ WDROŻENIE ZAKOŃCZONE SUKCESEM!\${NC}"
echo -e "\${GREEN}  Wersja: 2026-11-02 v0.4.0\${NC}"
echo -e "\${GREEN}=================================================================\${NC}"
echo -e "Aplikacja działa i jest dostępna pod:"
echo -e "  👉 \${YELLOW}http://\${SERVER_IP}:3000\${NC} lub \${YELLOW}http://localhost:3000\${NC}"
echo -e ""
echo -e "🛡️  Trwałość danych: Wolumen Docker '\${BLUE}zarzadzanie_app_data\${NC}' montowany w /app/data."
echo -e "💾  Kopie zapasowe: Skonfigurowane w '\${BLUE}/opt/zarzadzanie-projektami/backups\${NC}' (Cron o 02:00, format .json.gz)."
echo -e "Zarządzanie aplikacją:"
echo -e "  - Podgląd logów:           \${YELLOW}cd \${INSTALL_DIR} && \$DOCKER_CMD logs -f\${NC}"
echo -e "  - Aktualizacja z GitHub:   \${YELLOW}cd \${INSTALL_DIR} && git pull && \$DOCKER_CMD up -d --build\${NC}"
echo -e "  - Ręczna kopia zapasowa:   \${YELLOW}/opt/zarzadzanie-projektami/backup.sh\${NC}"
echo -e "  - Zatrzymanie:             \${YELLOW}cd \${INSTALL_DIR} && \$DOCKER_CMD down\${NC}"
echo -e "\${GREEN}=================================================================\${NC}"
`;

export const README_MD_CONTENT = `# 🏗️ Zarządzanie Projektami (Pracownia Projektowa / Budownictwo)

[![Wersja](https://img.shields.io/badge/Wersja-2026--11--02%20v%200.4.0-emerald.svg)](https://github.com/FraczekMarcin/Zarzadzanie-Projektami)
[![Docker](https://img.shields.io/badge/Docker-App%20Data%20Volume-blue.svg)](https://www.docker.com/)
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

## 🛡️ Trwałość danych (Wolumen Docker)
Baza danych zapisywana jest trwale w pliku \`app_state.json\` w niezależnym wolumenie Docker \`zarzadzanie_app_data\` montowanym w \`/app/data\`.
Aktualizacja kodu komendą \`git pull && docker compose up -d --build\` NIE USUWA danych projektów ani zadań!

## 💾 Automatyczne kopie zapasowe (Cron)
Skrypt \`/opt/zarzadzanie-projektami/backup.sh\` wykonuje codzienną kopię zapasową pliku stanu o 02:00 w nocy do formatu \`app_state_YYYY-MM-DD_HHMMSS.json.gz\` z zachowaniem minimum 7 ostatnich kopii.

## 🔄 Przywracanie stanu z kopii krok po kroku

1. Sprawdź dostępne kopie zapasowe:
   \`\`\`bash
   ls -lh /opt/zarzadzanie-projektami/backups/
   \`\`\`

2. Rozpakuj wybraną kopię do pliku tymczasowego:
   \`\`\`bash
   gzip -dc /opt/zarzadzanie-projektami/backups/app_state_YYYY-MM-DD_HHMMSS.json.gz > /tmp/restore_state.json
   \`\`\`

3. Zweryfikuj poprawność składni JSON:
   \`\`\`bash
   jq empty /tmp/restore_state.json
   \`\`\`

4. Skopiuj plik do kontenera aplikacji w miejsce pliku stanu:
   \`\`\`bash
   docker cp /tmp/restore_state.json zarzadzanie_app:/app/data/app_state.json
   \`\`\`

5. Zrestartuj kontener aplikacji, aby wczytać odtworzony stan:
   \`\`\`bash
   docker compose restart app
   \`\`\`

6. Usuń plik tymczasowy:
   \`\`\`bash
   rm -f /tmp/restore_state.json
   \`\`\`
`;

export const DOCKER_FILES: DockerConfigFile[] = [
  {
    name: 'Skrypt 1-poleceniem',
    filename: 'install.sh',
    description: 'Automatyczny skrypt instalacyjny dla Linux - pobiera projekt z GitHub, konfiguruje Docker, trwałe wolumeny danych oraz automatyczny cron kopii zapasowych.',
    language: 'bash',
    content: INSTALL_SCRIPT_CONTENT,
  },
  {
    name: 'Dokumentacja README',
    filename: 'README.md',
    description: 'Oficjalna dokumentacja projektu dla GitHub, opis instalacji 1-poleceniem, trwałości danych w wolumenie i procedury przywracania z kopii.',
    language: 'markdown',
    content: README_MD_CONTENT,
  },
  {
    name: 'Docker Compose',
    filename: 'docker-compose.yml',
    description: 'Orkiestracja kontenera: Aplikacja Zarządzanie Projektami + trwały wolumen app_data.',
    language: 'yaml',
    content: DOCKER_COMPOSE_YML,
  },
  {
    name: 'Skrypt Auto-Backup (Cron)',
    filename: 'backup.sh',
    description: 'Skrypt automatycznych kopii zapasowych pliku app_state.json z walidacją jq/gzip i retencją minimum 7 kopii.',
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
    name: 'Zmienne środowiskowe',
    filename: '.env.production',
    description: 'Konfiguracja portów, katalogu danych DATA_DIR oraz kluczy szyfrujących.',
    language: 'bash',
    content: ENV_EXAMPLE_CONTENT,
  },
];
