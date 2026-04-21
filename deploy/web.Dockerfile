# syntax=docker/dockerfile:1.7
#
# TrustLoop web — production Dockerfile.
#
# Build context: monorepo root (npm workspaces + @shared/* must resolve).
# Build locally:
#   docker build -f deploy/web.Dockerfile -t trustloop-web .
#
# Railway: deploy/railway.web.json references this file.
#

FROM node:24-slim AS base
WORKDIR /app

# -----------------------------------------------------------------------------
# deps — install workspace dependencies from the committed lockfile so deploys
# resolve the same graph as local development and CI.
# -----------------------------------------------------------------------------
FROM base AS deps
COPY package.json ./
COPY package-lock.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/brand/package.json ./packages/brand/
COPY packages/database/package.json ./packages/database/
COPY packages/env/package.json ./packages/env/
COPY packages/rest/package.json ./packages/rest/
COPY packages/types/package.json ./packages/types/
RUN npm ci --no-audit --no-fund

# -----------------------------------------------------------------------------
# builder — generate Prisma client, build Next standalone output
# -----------------------------------------------------------------------------
FROM base AS builder
ENV NEXT_TELEMETRY_DISABLED=1
ENV SKIP_ENV_VALIDATION=1
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.base.json ./
COPY apps/web ./apps/web
COPY packages/brand ./packages/brand
COPY packages/database ./packages/database
COPY packages/env ./packages/env
COPY packages/rest ./packages/rest
COPY packages/types ./packages/types
RUN npm --workspace @shared/database run db:generate
RUN npm run build --workspace=@trustloop/web

# -----------------------------------------------------------------------------
# runner — minimal production image
# -----------------------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# @temporalio/client dispatches workflows via a Rust core (rustls) that
# loads system root CAs to reach Temporal Cloud. node:24-slim omits them.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nextjs

# Next's standalone output bundles a self-contained server tree. Static and
# public assets live outside standalone and must be copied in explicitly.
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

# Prisma runtime needs the generated client + the schema.
COPY --from=builder --chown=nextjs:nodejs /app/packages/database/src/generated ./packages/database/src/generated
COPY --from=builder --chown=nextjs:nodejs /app/packages/database/prisma ./packages/database/prisma

USER nextjs
EXPOSE 3000

CMD ["node", "apps/web/server.js"]
