# syntax=docker/dockerfile:1.7
#
# TrustLoop queue worker (Temporal support + codex) — production Dockerfile.
#
# Runs via tsx at runtime rather than pre-compiling: apps/queue/src/main.ts
# passes `./runtime/workflows.ts` to Temporal's worker bundler by path, so
# shipping source matches dev behavior and avoids rewriting the resolver.
#
# Build context: monorepo root.
# Build locally:
#   docker build -f deploy/queue.Dockerfile -t trustloop-queue .
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
COPY apps/queue/package.json ./apps/queue/
COPY packages/database/package.json ./packages/database/
COPY packages/env/package.json ./packages/env/
COPY packages/rest/package.json ./packages/rest/
COPY packages/types/package.json ./packages/types/
RUN npm ci --no-audit --no-fund

# -----------------------------------------------------------------------------
# builder — generate Prisma client. No tsc build — we ship source + tsx.
# -----------------------------------------------------------------------------
FROM base AS builder
ENV SKIP_ENV_VALIDATION=1
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.base.json ./
COPY apps/queue ./apps/queue
COPY packages/database ./packages/database
COPY packages/env ./packages/env
COPY packages/rest ./packages/rest
COPY packages/types ./packages/types
RUN npm --workspace @shared/database run db:generate

# -----------------------------------------------------------------------------
# runner — minimal production image (still carries node_modules + source for tsx)
# -----------------------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production

# Temporal's Rust core (rustls) loads system root CAs to reach Temporal
# Cloud. node:24-slim omits them — install before USER switch.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs worker

COPY --from=builder --chown=worker:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=worker:nodejs /app/package.json ./package.json
COPY --from=builder --chown=worker:nodejs /app/tsconfig.base.json ./tsconfig.base.json
COPY --from=builder --chown=worker:nodejs /app/apps/queue ./apps/queue
COPY --from=builder --chown=worker:nodejs /app/packages/database ./packages/database
COPY --from=builder --chown=worker:nodejs /app/packages/env ./packages/env
COPY --from=builder --chown=worker:nodejs /app/packages/rest ./packages/rest
COPY --from=builder --chown=worker:nodejs /app/packages/types ./packages/types

USER worker

WORKDIR /app/apps/queue

CMD ["npx", "tsx", "src/main.ts"]
