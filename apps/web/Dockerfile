# syntax=docker/dockerfile:1
# Garfo web — multi-stage build (deps -> build -> runtime). Build context: repository root.
# NEXT_PUBLIC_* values are inlined into the JS bundle at build time, so they are build ARGs
# (changing the API URL means rebuilding the image).

FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

# 1) deps: download every package into the pnpm store using only the lockfile (cache-friendly).
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch --frozen-lockfile

# 2) build: install offline, build shared + web (Next standalone output).
FROM deps AS build
ARG NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1
ARG NEXT_PUBLIC_GITHUB_URL=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_GITHUB_URL=$NEXT_PUBLIC_GITHUB_URL
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --offline
RUN pnpm --filter "@garfo/web..." build

# 3) runtime: only the standalone server and static assets, non-root user.
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
