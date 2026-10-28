# Public website production image. Multi-stage:
#   deps → build (lint, typecheck, unit tests, `next build`) → runtime (`next start`, non-root).
# Build arguments (they end up in the static pages, so they are fixed per image):
#   SITE_URL      the site's public address (canonical links, hreflang, sitemap)
#   SITE_NOINDEX  "1" for a staging / demo copy: kept out of search engines
# Runtime: API_ORIGIN (where the server reads the public API) comes from the environment.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS build
ARG SITE_URL=https://livemodeltest.com
ARG SITE_NOINDEX=
ENV NEXT_TELEMETRY_DISABLED=1 \
    SITE_URL=${SITE_URL} \
    SITE_NOINDEX=${SITE_NOINDEX}
COPY . .
# The same gates as Public Website CI, so a broken tree never becomes an image (unit tests
# run with the default settings, not this image's SITE_URL / SITE_NOINDEX). The build needs
# no backend: sections fall back and the pages refresh from the API at run time.
RUN npm run lint && npm run typecheck && env -u SITE_URL -u SITE_NOINDEX npm test && npm run build

FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
# `next start` loads next.config.ts, which needs the TypeScript compiler at run time: add the
# exact version pinned in package-lock.json (still no other dev dependencies).
RUN npm ci --omit=dev --no-audit --no-fund \
 && npm install --no-save --no-audit --no-fund \
      "typescript@$(node -p "require('./package-lock.json').packages['node_modules/typescript'].version")"

FROM node:22-alpine AS runtime
ARG SITE_URL=https://livemodeltest.com
ARG SITE_NOINDEX=
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    SITE_URL=${SITE_URL} \
    SITE_NOINDEX=${SITE_NOINDEX}
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --chown=node:node package.json next.config.ts ./
# The official image's unprivileged user.
USER node
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "-p", "3000", "-H", "0.0.0.0"]
