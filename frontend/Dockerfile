# syntax=docker/dockerfile:1.7

# ── build ────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build

WORKDIR /app

# Зеркало npm: registry.npmjs.org из РФ часто недоступен.
ARG NPM_REGISTRY=https://registry.npmmirror.com
ENV NPM_CONFIG_REGISTRY=${NPM_REGISTRY}

# pnpm 9 совместим с lockfileVersion 9.0 и не требует интерактивных подтверждений.
RUN npm i -g pnpm@9.15.9

# pnpm-workspace.yaml не копируем: проект одиночный, а файл содержит несовместимый
# для pnpm 9 плейсхолдер allowBuilds (ломает install).
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ── runtime ──────────────────────────────────────────────────────────────────
FROM caddy:2.9-alpine AS runtime

COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv

# 8080 — статика, 2019 — admin/metrics для Prometheus
EXPOSE 8080 2019

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
