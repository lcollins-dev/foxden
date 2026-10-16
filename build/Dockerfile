# syntax=docker/dockerfile:1

## Build container ##
FROM node:22.23.3-alpine AS builder

# better-sqlite3 compiles its native module here when no prebuilt binary matches.
RUN apk --no-cache add python3 make g++

WORKDIR /build

# The manifests go in before the source, so a source edit leaves the install layer cached.
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY libs/dto/package.json ./libs/dto/
COPY libs/fxa-crypto/package.json ./libs/fxa-crypto/

RUN --mount=type=cache,target=/root/.npm npm ci --workspace apps/api --workspace apps/web --workspace libs/dto \
      --workspace libs/fxa-crypto --include-workspace-root

COPY tsconfig.json tsconfig.base.json eslint.root.mjs ./
COPY apps/api ./apps/api
COPY apps/web ./apps/web
COPY libs ./libs

RUN npm run build:libs
RUN npm run build:api

# Last before the web build, so a new version reuses every layer above.
ARG APP_VERSION=0.0.0
ENV VITE_APP_VERSION=${APP_VERSION}

RUN npm run build:web

## Runtime dependencies ##
FROM node:22.23.3-alpine AS deps

RUN apk --no-cache add python3 make g++

WORKDIR /deps

# Only the api's and the libs' manifests, so the install carries nothing the web app or the test suites need. Optional
# is omitted because typeorm's optional peers would otherwise bring typescript, ts-node and swc.
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY libs/dto/package.json ./libs/dto/
COPY libs/fxa-crypto/package.json ./libs/fxa-crypto/

RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --omit=optional

# The final stage merges apps/api/node_modules into the root, so refuse a nested module that would replace a root one.
RUN mkdir -p apps/api/node_modules && cd apps/api/node_modules && for module in $(ls -d [!@.]* @*/* 2>/dev/null); do \
      if [ -e "/deps/node_modules/$module" ]; then echo "apps/api/node_modules/$module clashes with a root module" >&2; exit 1; fi; \
    done

## Final container ##
# The same alpine base as the builder, so better-sqlite3's native module matches its musl libc.
FROM node:22.23.3-alpine

ENV NODE_ENV=production
ENV WEB_ROOT_PATH=/app/web
ENV DATABASE_PATH=/data/foxden.sqlite
ENV BACKUP_PATH=/data/backups

RUN apk --no-cache add curl

RUN mkdir /data && chown node:node /data

VOLUME /data

USER node
WORKDIR /app

COPY package.json package-lock.json ./

COPY --from=builder /build/apps/api/dist ./
COPY --from=builder /build/apps/api/email-templates ./email-templates
COPY --from=builder /build/libs ./libs
COPY --from=builder /build/apps/api/production.env ./

COPY --from=builder /build/apps/web/dist ./web

# npm nests a dependency under apps/api/node_modules when a hoisted package clashes with its version. The clashing
# hoisted ones are dev-only or belong to another workspace, so are not installed and the api's nested modules merge into
# the root.
COPY --from=deps /deps/node_modules ./node_modules
COPY --from=deps /deps/apps/api/node_modules ./node_modules

# Last, so a new version reuses every layer above.
ARG APP_VERSION=0.0.0
ENV VERSION=${APP_VERSION}

HEALTHCHECK --start-period=15s CMD curl --fail http://localhost:3000/api/v1/availability || exit 1

EXPOSE 3000

CMD ["node", "main.js"]
