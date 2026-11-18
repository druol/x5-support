#!/usr/bin/env bash
# Проверка локального стека: контейнеры, health-эндпоинты, цели Prometheus.
set -uo pipefail

cd "$(dirname "$0")/.."

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

APP_PORT="${APP_PORT:-8080}"
GRAFANA_PORT="${GRAFANA_PORT:-3000}"
PROMETHEUS_PORT="${PROMETHEUS_PORT:-9090}"
ALERTMANAGER_PORT="${ALERTMANAGER_PORT:-9093}"
LOKI_PORT="${LOKI_PORT:-3100}"

FAILED=0

check() {
  local name="$1" url="$2"
  local code
  code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$url" 2>/dev/null || echo "000")"
  if [[ "$code" == "200" || "$code" == "204" ]]; then
    printf '  ✅ %-28s %s\n' "$name" "$code"
  else
    printf '  ❌ %-28s %s (%s)\n' "$name" "$code" "$url"
    FAILED=$((FAILED + 1))
  fi
}

echo "── Контейнеры ─────────────────────────────────────────────"
docker compose -f docker-compose.yml -f docker-compose.observability.yml ps --format 'table {{.Name}}\t{{.Status}}' 2>/dev/null || true

echo
echo "── HTTP-эндпоинты ─────────────────────────────────────────"
check "app"            "http://127.0.0.1:${APP_PORT}/healthz"
check "tickets API"    "http://127.0.0.1:${APP_PORT}/api/healthz"
check "notifications"  "http://127.0.0.1:${APP_PORT}/api/notifications"
check "prometheus"     "http://127.0.0.1:${PROMETHEUS_PORT}/-/ready"
check "grafana"        "http://127.0.0.1:${GRAFANA_PORT}/api/health"
check "alertmanager"   "http://127.0.0.1:${ALERTMANAGER_PORT}/-/ready"
check "loki"           "http://127.0.0.1:${LOKI_PORT}/ready"

echo
echo "── Postgres ─────────────────────────────────────────────────"
if docker compose exec -T postgres pg_isready -U "${POSTGRES_USER:-x5-support}" -d "${POSTGRES_DB:-x5-support}" >/dev/null 2>&1; then
  echo "  ✅ postgres                    ready"
else
  echo "  ❌ postgres                    not ready"
  FAILED=$((FAILED + 1))
fi

echo
echo "── Цели Prometheus ────────────────────────────────────────"
TARGETS_JSON="$(curl -s -m 5 "http://127.0.0.1:${PROMETHEUS_PORT}/api/v1/targets" 2>/dev/null || true)"
if [[ -n "$TARGETS_JSON" ]]; then
  python3 - "$TARGETS_JSON" <<'PY'
import json, sys
data = json.loads(sys.argv[1])
active = data.get('data', {}).get('activeTargets', [])
down = [t for t in active if t.get('health') != 'up']
for t in active:
    mark = '✅' if t.get('health') == 'up' else '❌'
    print(f"  {mark} {t.get('labels', {}).get('job', '?'):<16} {t.get('health')}")
print(f"\n  Всего целей: {len(active)}, проблемных: {len(down)}")
sys.exit(1 if down else 0)
PY
  if [[ $? -ne 0 ]]; then
    FAILED=$((FAILED + 1))
  fi
else
  echo "  ❌ Prometheus API недоступен"
  FAILED=$((FAILED + 1))
fi

echo
if [[ $FAILED -eq 0 ]]; then
  echo "ИТОГ: всё зелёное ✅"
  echo "Grafana:    http://127.0.0.1:${GRAFANA_PORT}  (доступы в .env)"
  echo "Prometheus: http://127.0.0.1:${PROMETHEUS_PORT}"
  echo "Приложение: http://127.0.0.1:${APP_PORT}"
  exit 0
else
  echo "ИТОГ: проблем — ${FAILED} ❌ (см. docker compose logs)"
  exit 1
fi
