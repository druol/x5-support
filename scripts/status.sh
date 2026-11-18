#!/usr/bin/env bash
# Карта сервисов: что где слушает, живо ли, куда открывать.
set -uo pipefail
cd "$(dirname "$0")/.."

if [[ -f .env ]]; then set -a; source .env; set +a; fi

APP_PORT="${APP_PORT:-8090}"
GRAFANA_PORT="${GRAFANA_PORT:-3000}"
PROMETHEUS_PORT="${PROMETHEUS_PORT:-9090}"
ALERTMANAGER_PORT="${ALERTMANAGER_PORT:-9093}"
LOKI_PORT="${LOKI_PORT:-3100}"
GITLAB_WEB_PORT="${GITLAB_WEB_PORT:-8929}"

code() { curl -s -o /dev/null -m 4 -w '%{http_code}' "$1" 2>/dev/null || echo "000"; }
line() { printf '%-22s %-46s %-6s\n' "$1" "$2" "$3"; }

echo "════════ ЛОКАЛЬНЫЙ СТЕК (IP: 127.0.0.1) ════════"
line "SERVICE" "URL" "HTTP"
line "app" "http://localhost:${APP_PORT}" "$(code "http://127.0.0.1:${APP_PORT}/healthz")"
line "grafana" "http://localhost:${GRAFANA_PORT}" "$(code "http://127.0.0.1:${GRAFANA_PORT}/api/health")"
line "prometheus" "http://localhost:${PROMETHEUS_PORT}" "$(code "http://127.0.0.1:${PROMETHEUS_PORT}/-/ready")"
line "alertmanager" "http://localhost:${ALERTMANAGER_PORT}" "$(code "http://127.0.0.1:${ALERTMANAGER_PORT}/-/ready")"
line "loki" "http://localhost:${LOKI_PORT}" "$(code "http://127.0.0.1:${LOKI_PORT}/ready")"
line "alloy" "http://localhost:12345" "$(code "http://127.0.0.1:12345/")"
line "gitlab" "http://localhost:${GITLAB_WEB_PORT}" "$(code "http://127.0.0.1:${GITLAB_WEB_PORT}/users/sign_in")"
line "postgres" "localhost:${POSTGRES_PORT:-55432}" "$(docker compose exec -T postgres pg_isready -U "${POSTGRES_USER:-x5-support}" -d "${POSTGRES_DB:-x5-support}" >/dev/null 2>&1 && echo OK || echo DOWN)"

echo
echo "════════ ВНУТРЕННИЕ (без публикации наружу) ════════"
for pair in \
  "node-exporter:node-exporter:9100" \
  "docker-metrics:docker-metrics:9101" \
  "blackbox:blackbox-exporter:9115" \
  "postgres-exporter:postgres-exporter:9187"; do
  name="${pair%%:*}"; rest="${pair#*:}"; host="${rest%%:*}"; port="${rest##*:}"
  st=$(docker exec x5-support-prometheus wget -qO- "http://${host}:${port}/metrics" >/dev/null 2>&1 && echo OK || echo DOWN)
  line "$name" "${host}:${port} (docker network)" "$st"
done

echo
echo "════════ GITLAB ════════"
if docker inspect x5-support-gitlab >/dev/null 2>&1; then
  echo "Web UI:      http://localhost:${GITLAB_WEB_PORT}   (root / ${GITLAB_ROOT_PASSWORD:-change-me-before-use})"
  echo "SSH clone:   ssh://git@localhost:2222/<group>/<project>.git"
  st=$(docker inspect x5-support-gitlab --format '{{.State.Health.Status}}' 2>/dev/null)
  echo "Container:   ${st:-unknown}"
else
  echo "GitLab не запущен: make gitlab"
fi
if docker inspect x5-support-gitlab-runner >/dev/null 2>&1; then
  echo "Runner:      $(docker exec x5-support-gitlab-runner gitlab-runner verify 2>&1 | grep -c alive) alive"
fi

echo
echo "════════ ОПУБЛИКОВАННЫЕ ПОРТЫ ════════"
docker ps --format '{{.Names}}\t{{.Ports}}' | grep -E '^x5-support' | grep -E -- '->' | sed 's/,.*//'
