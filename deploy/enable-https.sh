#!/usr/bin/env bash
# Включение HTTPS на сервере через DNS-01 (не требует входящих соединений).
# Запускать НА СЕРВЕРЕ:
#   cd /opt/orbita && sudo ./deploy/enable-https.sh x5-test-task.ru admin@example.ru
#
# Скрипт попросит добавить TXT-записи _acme-challenge.<домен> в DNS регистратора.
set -euo pipefail

DOMAIN="${1:-${DOMAIN:-x5-test-task.ru}}"
EMAIL="${2:-${ACME_EMAIL:-admin@${DOMAIN}}}"
ROOT="/opt/orbita"
CERTS="${ROOT}/certs"

if [[ $EUID -ne 0 ]]; then
  echo "Запусти через sudo: sudo ./deploy/enable-https.sh ${DOMAIN} ${EMAIL}"
  exit 1
fi

mkdir -p "${CERTS}"

echo "==> Выпуск сертификата для ${DOMAIN} и www.${DOMAIN}"
echo "    Certbot покажет TXT-записи — добавь их в DNS регистратора."
docker run --rm -it \
  -v "${CERTS}:/etc/letsencrypt" \
  certbot/certbot certonly \
  --manual --preferred-challenges dns \
  -d "*.${DOMAIN}" -d "${DOMAIN}" \
  --email "${EMAIL}" --agree-tos --no-eff-email

if [[ ! -f "${CERTS}/live/${DOMAIN}/fullchain.pem" ]]; then
  echo "Сертификат не найден в ${CERTS}/live/${DOMAIN}/"
  exit 1
fi

echo "==> Переключаю Caddy на HTTPS"
cp "${ROOT}/infra/caddy/Caddyfile.https" "${ROOT}/infra/caddy/Caddyfile"

cd "${ROOT}"
docker compose \
  -f docker-compose.yml \
  -f docker-compose.observability.yml \
  -f docker-compose.prod.yml \
  up -d --force-recreate caddy

sleep 3
curl -fsS -o /dev/null "https://${DOMAIN}/" && echo "HTTPS работает: https://${DOMAIN}/"

cat <<EOF

Готово.
  https://${DOMAIN}/
  https://www.${DOMAIN}/

Продление (раз в ~80 дней): повторить запуск этого скрипта.
Crontab-напоминание можно добавить так:
  0 3 1 */2 *  cd /opt/orbita && ./deploy/enable-https.sh ${DOMAIN} ${EMAIL}
EOF
