# ==========================================
# Zarządzanie Projektami - Dockerfile
# Wersja: 2026-10-25 v 0.2.1
# Repozytorium: https://github.com/FraczekMarcin/Zarzadzanie-Projektami
# ==========================================

FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY . .
RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV APP_VERSION="2026-10-25 v 0.2.1"

COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --only=production; else npm install --omit=dev; fi && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY server.ts ./server.ts
COPY --from=builder /app/node_modules ./node_modules

RUN addgroup -g 1001 -S nodejs && \
    adduser -S appuser -u 1001 -G nodejs && \
    chown -R appuser:nodejs /app

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["npx", "tsx", "server.ts"]
