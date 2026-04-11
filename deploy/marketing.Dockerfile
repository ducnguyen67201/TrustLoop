# syntax=docker/dockerfile:1.7
#
# TrustLoop AI marketing site — production Dockerfile.
#
# Build context: monorepo root (so npm workspaces + @shared/brand resolve).
# Build locally with:
#   docker build -f deploy/marketing.Dockerfile -t trustloop-marketing .
#
# Railway: referenced from railway.json at the repo root.
#

FROM node:24-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app

# -----------------------------------------------------------------------------
# Stage: deps — install workspace dependencies only
# -----------------------------------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/marketing/package.json ./apps/marketing/
COPY packages/brand/package.json ./packages/brand/
RUN npm ci --ignore-scripts

# -----------------------------------------------------------------------------
# Stage: builder — build marketing with standalone output
# -----------------------------------------------------------------------------
FROM base AS builder
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/marketing ./apps/marketing
COPY packages/brand ./packages/brand
RUN npm run build --workspace=@trustloop/marketing

# -----------------------------------------------------------------------------
# Stage: runner — minimal production image
# -----------------------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Next's standalone output places a self-contained server tree inside
# .next/standalone. Static assets live next to it under .next/static and
# must be copied explicitly.
COPY --from=builder --chown=nextjs:nodejs /app/apps/marketing/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/marketing/.next/static ./apps/marketing/.next/static

USER nextjs
EXPOSE 3000

# standalone server entry for the marketing app
CMD ["node", "apps/marketing/server.js"]
