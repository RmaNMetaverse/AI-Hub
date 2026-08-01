# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=22-bookworm-slim

FROM node:${NODE_VERSION} AS base
WORKDIR /app
ENV NPM_CONFIG_FUND=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false
COPY package*.json ./

FROM base AS dependencies
RUN --mount=type=cache,target=/root/.npm npm ci \
  && node -e "const fs=require('node:fs');const crypto=require('node:crypto');const hash=crypto.createHash('sha256').update(fs.readFileSync('package-lock.json')).digest('hex');fs.writeFileSync('node_modules/.ai-hub-lock-hash',hash)"

FROM dependencies AS development
ENV NODE_ENV=development \
    PORT=4310 \
    DB_PATH=/app/data/ai-hub.db \
    MEDIA_ROOT=/app/storage
COPY . .
RUN npm run css:build
EXPOSE 4310
CMD ["node", "scripts/container-dev.js"]

FROM dependencies AS verification
ENV NODE_ENV=test \
    PORT=4310 \
    DB_PATH=/tmp/ai-hub-test.db \
    MEDIA_ROOT=/tmp/ai-hub-media
COPY . .
RUN npm run css:build
CMD ["npm", "run", "verify"]

FROM dependencies AS builder
COPY . .
RUN npm run css:build && npm prune --omit=dev

FROM node:${NODE_VERSION} AS production
WORKDIR /app
ENV NODE_ENV=production \
    PORT=4310 \
    DB_PATH=/app/data/ai-hub.db \
    MEDIA_ROOT=/app/storage \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false

COPY --from=builder --chown=node:node /app/package*.json ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/server.js ./server.js
COPY --from=builder --chown=node:node /app/assets ./assets
COPY --from=builder --chown=node:node /app/src ./src
COPY --from=builder --chown=node:node /app/views ./views
COPY --from=builder --chown=node:node /app/public ./public

RUN mkdir -p /app/data /app/storage && chown node:node /app/data /app/storage
USER node
EXPOSE 4310
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4310/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1))"]
CMD ["node", "server.js"]
