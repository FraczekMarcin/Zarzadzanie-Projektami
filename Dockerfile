# ==========================================
# Zarządzanie Projektami - Dockerfile
# Repozytorium: https://github.com/FraczekMarcin/Zarzadzanie-Projektami
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
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data
ENV BACKUP_DIR=/app/backups

# Użytkownik o ograniczonych uprawnieniach (Security best practice)
RUN addgroup -g 1001 -S nodejs && \
    adduser -S appuser -u 1001 -G nodejs

# Tworzenie i uprawnienia do trwałego katalogu danych
RUN mkdir -p /app/data && chown -R appuser:nodejs /app/data

# Kopiowanie skompilowanego frontendu, serwera i pliku VERSION
COPY --chown=appuser:nodejs --from=builder /app/dist ./dist
COPY --chown=appuser:nodejs VERSION ./VERSION

# Instalacja wyłącznie zależności produkcyjnych
COPY --chown=appuser:nodejs package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "dist/server.js"]
