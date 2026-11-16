# 04. Прод-сервер

## 1. Параметры ВМ

| Параметр | Значение |
|---|---|
| Провайдер | Yandex Cloud |
| Зона | `ru-central1-d` |
| ВМ | `compute-vm-4-8-50-ssd-1794859500950`, id `fv48icm39f5qhc32a7jk` |
| Ресурсы | 4 vCPU, 8 GiB RAM, 50 GiB SSD |
| ОС | Ubuntu 24.04.5 LTS |
| Публичный IP | `84.252.135.15` (динамический) |
| Security Group | `orbita-sg-sec`: вход 22/80/443, выход любой |
| Docker | 29.1.3, Compose 2.40.3 |
| Каталог проекта | `/opt/orbita` |
| Владелец файлов | `ubuntu:ubuntu` |

## 2. Доступ

```bash
# ключ с паролем — сначала добавить в агент
ssh-add ~/.ssh/orbita
ssh -i ~/.ssh/orbita ubuntu@84.252.135.15

# для CI — отдельный ключ без пароля
ssh -i /tmp/orbita-ci ubuntu@84.252.135.15
```

Sudo без пароля у `ubuntu` настроен образом Yandex Cloud.

## 3. Что установлено и настроено

- Docker + compose plugin, `systemctl enable docker` (переживает перезагрузку).
- **Зеркало Docker Hub**: `/etc/docker/daemon.json`
  ```json
  {"registry-mirrors": ["https://dockerproxy.net"]}
  ```
  Причина: прямой Docker Hub из РФ нестабилен. После правки — `systemctl restart docker`.
- **UFW**: разрешены 22/80/443 (v4+v6). Docker публикует порты своими iptables-правилами,
  но Caddy слушает 80/443.
- `tmux` — для интерактивных сессий (certbot).
- `certbot/certbot` — образ для выпуска сертификата.
- **Пользовательский crontab** (ubuntu):
  ```
  0 3 * * * cd /opt/orbita && ./scripts/backup.sh >> /var/log/orbita-backup.log 2>&1
  ```

## 4. Контейнеры

| Контейнер | Образ | Роль |
|---|---|---|
| `orbita-edge` | caddy:2.9-alpine | HTTPS-edge, 80/443 |
| `orbita-app` | orbita-dashboard:local | статика приложения |
| `orbita-postgres` | postgres:16-alpine | БД |
| `orbita-redis` | redis:7-alpine | кэш |
| `orbita-postgres-exporter` | prometheuscommunity/postgres-exporter | метрики PG |
| `orbita-redis-exporter` | oliver006/redis_exporter | метрики Redis |
| `orbita-prometheus` | prom/prometheus:v2.55.1 | сбор метрик |
| `orbita-alertmanager` | prom/alertmanager:v0.27.0 | алерты |
| `orbita-grafana` | grafana/grafana:11.3.0 | дашборды |
| `orbita-loki` | grafana/loki:3.2.1 | логи |
| `orbita-alloy` | grafana/alloy:v1.5.1 | сбор docker-логов → Loki |
| `orbita-node-exporter` | prom/node-exporter:v1.8.2 | метрики хоста |
| `orbita-blackbox` | prom/blackbox-exporter:v0.25.0 | HTTP-пробы |
| `orbita-autoheal` | willfarrell/autoheal | перезапуск unhealthy |
| `orbita-tunnel` | cloudflare/cloudflared | туннель к app (порт 8090) |
| `orbita-tunnel-grafana` | cloudflare/cloudflared | туннель к Grafana (3000) |

У всех `restart: unless-stopped`, автостарт после перезагрузки ВМ.

> cAdvisor **отключён** (профиль `cadvisor`): образ только на `gcr.io`, он блокируется
> из РФ, а перенос с Mac дал arm64-образ.

## 5. Каталоги

```
/opt/orbita/
├── .env                 # секреты сервера (НЕ перезаписывается деплоем)
├── docker-compose*.yml
├── frontend/, infra/, scripts/, deploy/, docs/
├── certs/               # Let's Encrypt: live/x5-test-task.ru/{fullchain,privkey}.pem
└── backups/             # orbita-<ts>.sql.gz (ротация 7 дней)
```

## 6. Деплой

**Из GitLab CI** (ручной): пайплайн → джоба `deploy` → ▶.

**С Mac вручную:**

```bash
cp .deploy.env.example .deploy.env   # один раз, заполнить
./scripts/deploy.sh
```

Скрипт делает `rsync` (без `.env`, `certs`, `backups`, `node_modules`, `dist`) и
`docker compose ... up -d --build` по SSH.

**Первичная настройка сервера** — `deploy/cloud-init.yaml` + `deploy/bootstrap-server.sh`
(для пересоздания ВМ через Cloud Shell: удаляет старую, создаёт новую с cloud-init,
которая сама ставит Docker, тянет архив и поднимает стек).

## 7. HTTPS

- Сертификат: **wildcard** `*.x5-test-task.ru` + apex, Let's Encrypt, DNS-01.
- Файлы: `/opt/orbita/certs/live/x5-test-task.ru/{fullchain.pem,privkey.pem}`.
- Caddy монтирует `./certs:/certs:ro`, конфиг `infra/caddy/Caddyfile` (HTTPS).
- HTTP (порт 80): для доменов — 301 на HTTPS, для прямого IP — reverse_proxy на app.
- Перевыпуск/продление: `sudo ./deploy/enable-https.sh x5-test-task.ru admin@x5-test-task.ru`
  (certbot попросит новые TXT-записи `_acme-challenge`; добавлять в reg.ru).
- Действует до 14.02.2027; **автопродления нет** (manual-плагин), нужен ручной запуск
  или переход на Cloudflare DNS + `certbot-dns-cloudflare`.

## 8. Резервный доступ (Cloudflare quick tunnels)

```bash
# поднять/пересоздать и получить URL
cd /opt/orbita && ./deploy/tunnels.sh

# текущие URL
docker logs orbita-tunnel 2>&1 | grep trycloudflare
docker logs orbita-tunnel-grafana 2>&1 | grep trycloudflare
```

Зачем: входящие соединения из-за рубежа до ВМ не доходят, а некоторые российские сети
тоже не пускают. Туннель работает из любой сети. URL меняется при перезапуске —
перед демо проверять актуальный.

Текущие (на момент документирования):
- app: `https://next-bandwidth-ctrl-july.trycloudflare.com` (короткая: `https://clck.ru/3X4WNQ`)
- grafana: `https://begin-estate-then-version.trycloudflare.com`

## 9. Обслуживание

```bash
# статус
cd /opt/orbita && docker compose -f docker-compose.yml \
  -f docker-compose.observability.yml -f docker-compose.prod.yml ps

# бэкап вручную
./scripts/backup.sh

# логи
docker logs orbita-app --tail 100
docker logs orbita-edge --tail 100

# рестарт после изменений
docker compose ... up -d --build

# проверка сертификата
echo | openssl s_client -connect 84.252.135.15:443 -servername x5-test-task.ru 2>/dev/null \
  | openssl x509 -noout -dates
```

## 10. Перезагрузка / восстановление

- Docker включён в автозапуск, контейнеры `unless-stopped` → поднимутся сами.
- Сертификаты и данные — в volumes и `/opt/orbita/certs` (переживают перезагрузку).
- `.env` на сервере — единственный источник паролей; держи его в тайне и делай бэкап.
- При пересоздании ВМ: сменится публичный IP → обновить A-записи в reg.ru и
  `.deploy.env`/CI-переменную `DEPLOY_HOST`; сертификат и домен останутся валидными.
