# syntax=docker/dockerfile:1
# Garfo API — multi-stage build (deps -> build -> runtime). Build context: repository root.

FROM node:20-alpine AS base
RUN apk add --no-cache openssl
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

# 1) deps: download every package into the pnpm store using only the lockfile (cache-friendly).
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch --frozen-lockfile

# 2) build: install offline, build shared + api, then produce a pruned production bundle.
FROM deps AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --offline
RUN pnpm --filter "@garfo/api..." build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter @garfo/api deploy --prod /out \
    && cd /out && node_modules/.bin/prisma generate

# 3) runtime: only production files, non-root user.
FROM node:20-alpine AS runtime
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3001
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node dist/main.js"]
