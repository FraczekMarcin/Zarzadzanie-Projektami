# ==========================================
# Zarządzanie Projektami - Dockerfile
# Wersja: 2026-10-25 v 0.2.1
# Repozytorium: https://github.com/FraczekMarcin/Zarzadzanie-Projektami
# Ścieżka: Instalacja/Dockerfile
# ==========================================

# Etap 1: Budowanie aplikacji (Builder)
FROM node:20-alpine AS builder

WORKDIR /app

# Kopiowanie definicji zależności i instalacja
COPY package*.json ./
RUN npm install --legacy-peer-deps --no-audit

# Kopiowanie kodu źródłowego i kompilacja (frontend + serwer)
COPY . .
RUN npm run build

# ==========================================
# Etap 2: Super-lekkie środowisko produkcyjne (Runtime < 140MB)
# ==========================================
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV APP_VERSION="2026-10-25 v 0.2.1"

# Użytkownik o ograniczonych uprawnieniach (Security best practice)
RUN addgroup -g 1001 -S nodejs && \
    adduser -S appuser -u 1001 -G nodejs

# Kopiowanie wyłącznie skompilowanych plików z etapu builder (bez ciężkich devDependencies)
COPY --chown=appuser:nodejs --from=builder /app/dist ./dist

# Instalacja wyłącznie serwera express (zaledwie 2.4 MB zamiast 250 MB devDependencies)
RUN npm install --omit=dev --no-audit express && npm cache clean --force

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "dist/server.js"]
