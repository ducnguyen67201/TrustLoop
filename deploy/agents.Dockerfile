# syntax=docker/dockerfile:1.7
#
# TrustLoop agents (Hono HTTP service for AI analysis) — production Dockerfile.
#
# Runs via tsx at runtime to match apps/queue and the `dev`/`start` scripts.
#
# Build context: monorepo root.
# Build locally:
#   docker build -f deploy/agents.Dockerfile -t trustloop-agents .
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
COPY apps/agents/package.json ./apps/agents/
COPY packages/database/package.json ./packages/database/
COPY packages/env/package.json ./packages/env/
COPY packages/prompting/package.json ./packages/prompting/
COPY packages/rest/package.json ./packages/rest/
COPY packages/types/package.json ./packages/types/
RUN npm ci --no-audit --no-fund

# -----------------------------------------------------------------------------
# builder — generate Prisma client. Source is shipped; tsx runs it.
# -----------------------------------------------------------------------------
FROM base AS builder
ENV SKIP_ENV_VALIDATION=1
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.base.json ./
COPY apps/agents ./apps/agents
COPY packages/database ./packages/database
COPY packages/env ./packages/env
COPY packages/prompting ./packages/prompting
COPY packages/rest ./packages/rest
COPY packages/types ./packages/types
RUN npm --workspace @shared/database run db:generate

# -----------------------------------------------------------------------------
# runner — minimal production image.
# -----------------------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=4000

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs agent

COPY --from=builder --chown=agent:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=agent:nodejs /app/package.json ./package.json
COPY --from=builder --chown=agent:nodejs /app/tsconfig.base.json ./tsconfig.base.json
COPY --from=builder --chown=agent:nodejs /app/apps/agents ./apps/agents
COPY --from=builder --chown=agent:nodejs /app/packages/database ./packages/database
COPY --from=builder --chown=agent:nodejs /app/packages/env ./packages/env
COPY --from=builder --chown=agent:nodejs /app/packages/prompting ./packages/prompting
COPY --from=builder --chown=agent:nodejs /app/packages/rest ./packages/rest
COPY --from=builder --chown=agent:nodejs /app/packages/types ./packages/types

USER agent
EXPOSE 4000

CMD ["npx", "tsx", "apps/agents/src/server.ts"]
