#!/usr/bin/env bash
# Ручной деплой на сервер без GitLab: rsync + docker compose по SSH.
#
# Переменные берутся из окружения или из .deploy.env (не коммитится):
#   DEPLOY_HOST=203.0.113.10
#   DEPLOY_USER=deploy
#   DEPLOY_PORT=22
#   DEPLOY_PATH=/opt/orbita
#   DEPLOY_SSH_KEY=~/.ssh/orbita_deploy
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -f .deploy.env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .deploy.env
  set +a
fi

: "${DEPLOY_HOST:?Укажите DEPLOY_HOST (в .deploy.env или окружении)}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/orbita}"
DEPLOY_SSH_KEY="${DEPLOY_SSH_KEY:-$HOME/.ssh/id_ed25519}"

SSH_KEY="${DEPLOY_SSH_KEY/#\~/$HOME}"
SSH_OPTS=(-p "$DEPLOY_PORT" -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new)

echo "→ Проверка SSH-доступа к ${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_PORT}"
ssh "${SSH_OPTS[@]}" "${DEPLOY_USER}@${DEPLOY_HOST}" "echo ok" >/dev/null

echo "→ Копирование файлов в ${DEPLOY_PATH}"
ssh "${SSH_OPTS[@]}" "${DEPLOY_USER}@${DEPLOY_HOST}" "mkdir -p ${DEPLOY_PATH}"
rsync -az --delete \
  --exclude '.git' \
  --exclude '.env' \
  --exclude 'node_modules' \
  --exclude 'backups' \
  --exclude 'dev-scratch' \
  --exclude 'frontend/dist' \
  --exclude 'certs' \
  -e "ssh -p ${DEPLOY_PORT} -i ${SSH_KEY}" \
  ./ "${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_PATH}/"

echo "→ Сборка и запуск на сервере"
ssh "${SSH_OPTS[@]}" "${DEPLOY_USER}@${DEPLOY_HOST}" \
  "cd ${DEPLOY_PATH} && docker compose -f docker-compose.yml -f docker-compose.observability.yml -f docker-compose.prod.yml up -d --build && docker compose ps"

echo "✓ Деплой завершён"
