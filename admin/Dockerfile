# Admin Panel production image (staging demo first). Multi-stage:
#   deps → build (lint, typecheck, `next build`) → runtime (`next start`, non-root).
# No dev server, no source mount; runtime settings (API_ORIGIN) come from the environment.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
# The same gates as Admin Panel CI, so a broken tree never becomes an image.
RUN npm run lint && npm run typecheck && npm run build

FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
# `next start` loads next.config.ts, which needs the TypeScript compiler at run time: add the
# exact version pinned in package-lock.json (still no other dev dependencies).
RUN npm ci --omit=dev --no-audit --no-fund \
 && npm install --no-save --no-audit --no-fund \
      "typescript@$(node -p "require('./package-lock.json').packages['node_modules/typescript'].version")"

FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --chown=node:node package.json next.config.ts ./
# The official image's unprivileged user.
USER node
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "-p", "3000", "-H", "0.0.0.0"]
