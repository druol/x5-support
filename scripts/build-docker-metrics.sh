#!/usr/bin/env bash
# Собирает легкий Docker-экспортер и образ из кэшированной базы caddy:2.9-alpine.
# Запускать на машине с Go и Docker; на сервер образ можно доставить docker save/load.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/backend"
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" \
  -o "$ROOT/deploy/offline/x5-docker-metrics" ./cmd/docker-metrics
cd "$ROOT/deploy/offline"
docker build -t x5-support-docker-metrics:local -f Dockerfile.docker-metrics.offline .
