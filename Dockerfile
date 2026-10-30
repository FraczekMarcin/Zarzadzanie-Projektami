# ==========================================
# Zarządzanie Projektami - Dockerfile
# Wersja: 2026-10-30 v0.3.5
# Repozytorium: https://github.com/FraczekMarcin/Zarzadzanie-Projektami
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
ENV APP_VERSION="2026-10-30 v0.3.5"

# Użytkownik o ograniczonych uprawnieniach (Security best practice)
RUN addgroup -g 1001 -S nodejs && \
    adduser -S appuser -u 1001 -G nodejs

# Kopiowanie skompilowanego frontendu i serwera (zaledwie 650 KB!)
COPY --chown=appuser:nodejs --from=builder /app/dist ./dist

# Instalacja wyłącznie serwera express (zaledwie 2.4 MB bez zbędnych 250 MB devDependencies)
RUN npm --prefix /app init -y && \
    npm --prefix /app install --no-package-lock --no-audit express@^4.21.2 && \
    npm cache clean --force

# Dodaj deklarację ESM ("type": "module") do package.json w kontenerze
RUN node -e "const p = require('./package.json'); p.type = 'module'; require('fs').writeFileSync('./package.json', JSON.stringify(p, null, 2));"

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "dist/server.js"]
