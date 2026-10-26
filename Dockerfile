# ==========================================
# Zarządzanie Projektami - Dockerfile
# Wersja: 2026-10-25 v 0.2.1
# Repozytorium: https://github.com/FraczekMarcin/Zarzadzanie-Projektami
# ==========================================

# Etap 1: Budowanie aplikacji (Builder)
FROM node:20-alpine AS builder

WORKDIR /app

# Kopiowanie definicji zależności i instalacja z obsługą peer dependencies
COPY package*.json ./
RUN npm install --legacy-peer-deps --no-audit

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
ENV APP_VERSION="2026-10-25 v 0.2.1"

# Kopiowanie skompilowanego frontendu, serwera oraz zainstalowanych pakietów z etapu builder
COPY package*.json ./
COPY --from=builder /app/dist ./dist
COPY server.ts ./server.ts
COPY --from=builder /app/node_modules ./node_modules

# Utworzenie użytkownika o ograniczonych uprawnieniach (Security best practice)
RUN addgroup -g 1001 -S nodejs && \
    adduser -S appuser -u 1001 -G nodejs && \
    chown -R appuser:nodejs /app

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["npx", "tsx", "server.ts"]
