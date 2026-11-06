# ==========================================
# Zarządzanie Projektami - Dockerfile
# Wersja: 2026-10-30 v0.3.5
# Repozytorium: https://github.com/FraczekMarcin/Zarzadzanie-Projektami
# Ścieżka: Instalacja/Dockerfile
# ==========================================

# Etap 1: Budowanie aplikacji z kodu źródłowego
FROM node:22-slim AS builder

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
RUN addgroup -g 1001 -S nodejs && \
    adduser -S appuser -u 1001 -G nodejs

# Tworzenie i uprawnienia do trwałego katalogu danych
RUN mkdir -p /app/data && chown -R appuser:nodejs /app/data

# Kopiowanie skompilowanego frontendu i serwera (zaledwie 650 KB!)
COPY --chown=appuser:nodejs --from=builder /app/dist ./dist

# Instalacja wyłącznie zależności produkcyjnych (express, nodemailer, dotenv)
COPY --chown=appuser:nodejs package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "dist/server.js"]
