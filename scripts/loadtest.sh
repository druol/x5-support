#!/usr/bin/env bash
# Небольшой read-only нагрузочный тест production/staging.
# Требует ApacheBench (ab). Запуск:
#   BASE_URL=https://x5-test-task.ru REQUESTS=300 CONCURRENCY=10 ./scripts/loadtest.sh
set -euo pipefail

BASE_URL="${BASE_URL:-https://x5-test-task.ru}"
REQUESTS="${REQUESTS:-300}"
CONCURRENCY="${CONCURRENCY:-10}"
TIMEOUT="${TIMEOUT:-15}"

run() {
  local path="$1"
  echo
  echo "### GET ${BASE_URL}${path} (n=${REQUESTS}, c=${CONCURRENCY})"
  ab -k -n "${REQUESTS}" -c "${CONCURRENCY}" -s "${TIMEOUT}" \
    -H 'Accept: application/json' "${BASE_URL}${path}" |
    grep -E "Complete requests|Failed requests|Non-2xx|Requests per second|Time per request|50%|95%|99%"
}

run "/api/user/tickets"
run "/api/notifications"
run "/user"

echo
echo "Готово. Серверные метрики: http://127.0.0.1:9090 (Support / Service dashboard)."
