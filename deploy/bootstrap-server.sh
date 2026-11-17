#!/usr/bin/env bash
# Bootstrap сервера: ставит Docker и разворачивает X5 Support из архива.
# Запускается cloud-init'ом на новой ВМ (см. deploy/cloud-init.yaml).
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive

# ── 1. Docker + compose plugin ───────────────────────────────────────────────
apt-get update
if ! apt-get install -y docker.io docker-compose-v2; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

# ── 2. Проект ────────────────────────────────────────────────────────────────
mkdir -p /opt/x5-support
curl -fsSL https://x0.at/8Q1n.gz -o /tmp/x5-support.tar.gz \
  || curl -fsSL https://temp.sh/DxvHk/x5-support-deploy.tar.gz -o /tmp/x5-support.tar.gz
tar -xzf /tmp/x5-support.tar.gz -C /opt/x5-support

# ── 3. Конфиг: домен = <публичный IP>.sslip.io, пароли случайные ─────────────
IP=$(curl -fsS -H 'Metadata-Flavor: Google' \
  'http://169.254.169.254/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip')

cd /opt/x5-support
cp .env.example .env
sed -i "s|^DOMAIN=.*|DOMAIN=${IP}.sslip.io|" .env
sed -i "s|^ACME_EMAIL=.*|ACME_EMAIL=admin@${IP}.sslip.io|" .env
PG_PASS=$(openssl rand -hex 16)
GF_PASS=$(openssl rand -hex 12)
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${PG_PASS}|" .env
sed -i "s|^GRAFANA_ADMIN_PASSWORD=.*|GRAFANA_ADMIN_PASSWORD=${GF_PASS}|" .env

# ── 4. Запуск ────────────────────────────────────────────────────────────────
docker compose -f docker-compose.yml \
  -f docker-compose.observability.yml \
  -f docker-compose.prod.yml up -d --build

echo "======================================================"
echo " X5 SUPPORT DEPLOYED"
echo " App:      https://${IP}.sslip.io"
echo " Grafana:  admin / ${GF_PASS}"
echo " (Grafana слушает только 127.0.0.1 — доступ через SSH-туннель)"
echo "======================================================"
