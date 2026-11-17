#!/usr/bin/env bash
# Бэкап Postgres в backups/ + ротация старше 7 дней.
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

DB_USER="${POSTGRES_USER:-x5-support}"
DB_NAME="${POSTGRES_DB:-x5-support}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="backups/${DB_NAME}-${STAMP}.sql.gz"

mkdir -p backups

if ! docker compose ps postgres --status running >/dev/null 2>&1; then
  echo "Postgres не запущен — сначала: docker compose up -d postgres"
  exit 1
fi

echo "Дамп ${DB_NAME} → ${OUT}"
docker compose exec -T postgres pg_dump -U "$DB_USER" -d "$DB_NAME" --clean --if-exists | gzip > "$OUT"

echo "Готово: $(du -h "$OUT" | cut -f1)"

# Ротация: удаляем дампы старше 7 дней.
find backups -name '*.sql.gz' -type f -mtime +7 -print -delete || true
