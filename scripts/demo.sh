#!/usr/bin/env bash
# Одна команда для локального демо приложения.
#
#   ./scripts/demo.sh          # собрать, поднять, открыть браузер
#   ./scripts/demo.sh --no-open
#   ./scripts/demo.sh down      # остановить демо
#   ./scripts/demo.sh reset     # остановить и удалить данные демо
#
# Нужен только Docker Desktop с Compose v2. Node/Go/Python не нужны.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="x5-support-demo"
ENV_FILE="$ROOT/.demo.env"
COMPOSE=(docker compose --project-name "$PROJECT" --env-file "$ENV_FILE" -f "$ROOT/docker-compose.yml" -f "$ROOT/docker-compose.demo.yml")

usage() { sed -n '2,12p' "$0"; }

if ! command -v docker >/dev/null 2>&1; then
  echo "Ошибка: не найден docker. Установите Docker Desktop." >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Ошибка: нужен Docker Compose v2 (docker compose)." >&2
  exit 1
fi

action="${1:-up}"
case "$action" in
  down|stop)
    "${COMPOSE[@]}" down --remove-orphans
    echo "Демо остановлено. Данные сохранены (запуск снова: ./scripts/demo.sh)."
    exit 0
    ;;
  reset)
    "${COMPOSE[@]}" down -v --remove-orphans
    rm -f "$ENV_FILE"
    echo "Демо остановлено, данные и .demo.env удалены."
    exit 0
    ;;
  --no-open|up|"")
    ;;
  -h|--help|help)
    usage; exit 0 ;;
  *)
    echo "Неизвестная команда: $action" >&2; usage; exit 2 ;;
esac

OPEN=1
[ "${1:-}" = "--no-open" ] && OPEN=0

# Свободный порт: 8090, затем 8091..8120.
find_port() {
  python3 - "$@" <<'PY'
import socket, sys
for port in range(8090, 8121):
    with socket.socket() as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind(("127.0.0.1", port))
        except OSError:
            continue
        print(port)
        sys.exit(0)
raise SystemExit("нет свободного порта в 8090..8120")
PY
}
APP_PORT="$(find_port)"

cat > "$ENV_FILE" <<ENV
COMPOSE_PROJECT_NAME=$PROJECT
APP_PORT=$APP_PORT
BIND_ADDR=127.0.0.1
POSTGRES_DB=x5_support
POSTGRES_USER=x5
POSTGRES_PASSWORD=x5_local_password
POSTGRES_PORT=0
APP_ENV=local
LOG_LEVEL=info
DEBUG_RESET=1
TZ=Europe/Moscow
ENV

# Не даём параллельно поднимать второй экземпляр с теми же container_name.
if docker ps --format '{{.Names}}' | grep -q '^x5-support-demo-'; then
  echo "Демо уже запущено (x5-support-demo-*). Останови: ./scripts/demo.sh down" >&2
  exit 1
fi

echo "Собираю и запускаю демо (первый запуск может занять несколько минут)..."
"${COMPOSE[@]}" up -d --build --remove-orphans

echo "Жду готовности приложения на http://127.0.0.1:$APP_PORT ..."
for _ in $(seq 1 60); do
  if curl -fsS --max-time 2 "http://127.0.0.1:$APP_PORT/api/healthz" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
if ! curl -fsS --max-time 3 "http://127.0.0.1:$APP_PORT/api/healthz" >/dev/null; then
  echo "Приложение не поднялось за 120 секунд. Логи:" >&2
  "${COMPOSE[@]}" ps >&2 || true
  "${COMPOSE[@]}" logs --tail=80 >&2 || true
  exit 1
fi

seed_demo() {
  local base="http://127.0.0.1:$APP_PORT"
  # Повторный запуск после `down` не должен плодить дубли.
  local existing
  existing="$(curl -fsS "$base/api/user/tickets" | python3 -c 'import json,sys; print(len(json.load(sys.stdin).get("items", [])))' 2>/dev/null || echo 0)"
  if [ "${existing:-0}" -gt 0 ]; then
    echo "Демо-данные уже есть (${existing} заявок), пропускаю seed."
    return
  fi
  local title
  local -a titles=(
    "Не открывается раздел с заявками"
    "Медленно загружается список обращений"
    "Предложение по улучшению интерфейса"
  )
  for title in "${titles[@]}"; do
    curl -fsS -X POST "$base/api/user/tickets" \
      -H 'Content-Type: application/json' \
      -d "{\"topic\":\"service\",\"title\":\"$title\",\"description\":\"Демо-заявка для проверки интерфейса и уведомлений.\"}" \
      >/dev/null || true
  done
  local id
  id="$(curl -fsS "$base/api/user/tickets" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["items"][0]["id"] if d.get("items") else "")' 2>/dev/null || true)"
  if [ -n "$id" ]; then
    curl -fsS -X POST "$base/api/admin/tickets/$id/status" \
      -H 'Content-Type: application/json' \
      -d '{"status":"in_progress","comment":"Беру в работу"}' >/dev/null || true
    curl -fsS -X POST "$base/api/admin/tickets/$id/comments" \
      -H 'Content-Type: application/json' \
      -d '{"comment":"Проверяю воспроизведение"}' >/dev/null || true
  fi
}
seed_demo

cat <<MSG

============================================================
  X5 Support демо готово
  Пользователь:  http://127.0.0.1:$APP_PORT/user
  Администратор: http://127.0.0.1:$APP_PORT/admin
  Остановить:    ./scripts/demo.sh down
  Сбросить всё:  ./scripts/demo.sh reset
============================================================
MSG

if [ "$OPEN" = 1 ]; then
  if command -v open >/dev/null 2>&1; then
    open "http://127.0.0.1:$APP_PORT/user" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "http://127.0.0.1:$APP_PORT/user" >/dev/null 2>&1 || true
  fi
fi
