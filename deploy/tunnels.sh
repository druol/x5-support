#!/usr/bin/env bash
# Быстрые Cloudflare-туннели к приложению и Grafana — доступ с любой сети,
# без входящих соединений к ВМ. Запускать НА СЕРВЕРЕ.
#   cd /opt/orbita && ./deploy/tunnels.sh
set -euo pipefail

APP_PORT="${APP_PORT:-8090}"
GRAFANA_PORT="${GRAFANA_PORT:-3000}"

start() {
  local name="$1" port="$2" url=""
  sudo docker rm -f "$name" >/dev/null 2>&1 || true
  sudo docker run -d --name "$name" --restart unless-stopped --network host \
    cloudflare/cloudflared:latest tunnel --url "http://127.0.0.1:${port}" --no-autoupdate >/dev/null
  for _ in $(seq 1 40); do
    url=$(sudo docker logs "$name" 2>&1 | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | head -1 || true)
    [ -n "$url" ] && { printf '%-24s %s\n' "$name" "$url"; return; }
    sleep 1
  done
  printf '%-24s FAILED\n' "$name"
}

echo "Публичные адреса (пока процесс жив):"
start orbita-tunnel "$APP_PORT"
start orbita-tunnel-grafana "$GRAFANA_PORT"
echo
echo "Если URL изменился после перезапуска: docker logs orbita-tunnel | grep trycloudflare"
