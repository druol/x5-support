# 01. Архитектура

## 1. Схема (локально и на сервере)

```
                         ┌──────────────────────────────┐
   Интернет              │  Caddy edge  (localhost:80/443)│
   ───────────────►      │  TLS, HTTPS→HTTPS, SPA fallback│
                         └──────────────┬───────────────┘
                                        │ reverse_proxy
                         ┌──────────────▼───────────────┐
                         │  app (Caddy внутри контейнера)│
                         │  статика фронтенда, :8080     │
                         │  /healthz, /metrics (:2019)   │
                         └──────────────┬───────────────┘
                                        │
              ┌─────────────────────────┼─────────────────────────┐
              │                         │                         │
      ┌───────▼───────┐        ┌────────▼───────┐        ┌────────▼────────┐
      │ postgres:16   │        │ redis:7        │        │ экспортеры      │
      │ :5432         │        │ :6379          │        │ pg/redis metrics│
      └───────┬───────┘        └────────┬───────┘        └────────┬────────┘
              │                         │                         │
              └─────────────┬───────────┴─────────────────────────┘
                            │  сеть backend
                    ┌───────▼─────────────────────────────┐
                    │  Prometheus (:9090, только localhost)│
                    │  собирает метрики со всех сервисов   │
                    └───────┬──────────────┬───────────────┘
                            │              │
                    ┌───────▼──────┐  ┌────▼─────────────┐
                    │ Grafana      │  │ Alertmanager     │
                    │ дашборды     │  │ алерты           │
                    └──────────────┘  └──────────────────┘

  Loki (:3100) + Grafana Alloy — централизованные логи всех контейнеров.
  autoheal — перезапускает контейнеры со статусом unhealthy.
  Cloudflared quick tunnels (на сервере) — публичный HTTPS-доступ к app и Grafana
  без входящих соединений (обходит блокировки входящего трафика).
```

## 2. Compose-файлы и зачем они нужны

| Файл | Что поднимает | Когда используется |
|---|---|---|
| `docker-compose.yml` | `app`, `postgres`, `redis`, `postgres-exporter`, `redis-exporter` | базовый стек |
| `docker-compose.observability.yml` | `prometheus`, `alertmanager`, `grafana`, `loki`, `alloy`, `node-exporter`, `blackbox-exporter`, `autoheal` (+ профили `cadvisor`, `tracing`) | мониторинг и логи |
| `docker-compose.prod.yml` | `caddy` (edge, 80/443), переопределяет порт app на `127.0.0.1:8090`, монтирует `./certs` | сервер |
| `docker-compose.gitlab.yml` | `gitlab`, `gitlab-runner` | локально, отдельный проект `orbita-gitlab` |

Запуск полного серверного набора:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.observability.yml \
  -f docker-compose.prod.yml up -d --build
```

## 3. Сети

| Сеть | Кто в ней | Зачем |
|---|---|---|
| `backend` | app, postgres, redis, prometheus, caddy | внутренний трафик приложения и БД |
| `monitoring` | prometheus, grafana, alloy, экспортеры, autoheal, app | сбор метрик |
| `edge` | caddy, app | внешний край (Caddy) |

Наружу (на сервере) опубликованы только `80/443` (Caddy). Всё остальное — на `127.0.0.1`:
`8090` app (отладка), `55432` Postgres, `6379` Redis, `3000` Grafana, `9090` Prometheus,
`9093` Alertmanager, `3100` Loki, `16686` Jaeger.

## 4. Порты (локальная машина)

| Порт | Сервис | Почему такой |
|---|---|---|
| 8090 → 8080 | приложение | 8080 часто занят на macOS |
| 55432 → 5432 | Postgres | 5432 занят локальным/старым Postgres |
| 6379 | Redis | стандартный |
| 3000 / 9090 / 9093 / 3100 / 12345 | Grafana / Prometheus / Alertmanager / Loki / Alloy | стандартные |
| 8929 / 2222 | GitLab Web / GitLab SSH | 8929 чтобы не конфликтовать с 80/443 |

## 5. Volumes

| Volume | Что хранит |
|---|---|
| `pgdata` | данные Postgres |
| `redisdata` | AOF Redis |
| `promdata` | TSDB Prometheus |
| `alertdata` | состояние/молчания Alertmanager |
| `grafanadata` | БД Grafana (дашборды, пользователи) |
| `lokidata` | чанки логов Loki |
| `alloydata` | позиции чтения логов Alloy |
| `jaegerdata` | трейсы (profile `tracing`) |
| `caddydata` / `caddyconfig` | сертификаты/автосейв Caddy |

Плюс bind-mount `./certs` → `/certs:ro` (wildcard-сертификат Let's Encrypt).

## 6. Поток запроса

1. Браузер → `https://x5-test-task.ru` (DNS: A → IP сервера).
2. Порт 443 на ВМ → контейнер `orbita-edge` (Caddy).
3. Caddy отдаёт HTTPS (сертификат из `/certs/live/x5-test-task.ru/`), добавляет security-заголовки.
4. `reverse_proxy app:8080` → контейнер `orbita-app` (Caddy внутри, статика SPA).
5. `try_files` отдаёт `index.html` на любой путь (SPA-роутинг).
6. Prometheus раз в 15 секунд скрейпит:
   - `/metrics` самого Caddy (`app:2019`),
   - node-exporter, postgres-exporter, redis-exporter,
   - Loki, Grafana, Alertmanager, blackbox-http.
7. Alloy читает docker-логи и отправляет в Loki; в Grafana — дашборды из provisioning.
8. Alertmanager получает алерты по правилам `infra/prometheus/rules/alerts.yml`.

## 7. Роль Cloudflare-туннелей

```
Пользователь → https://xxx.trycloudflare.com → Cloudflare edge
                                                   ▲
                                                   │ исходящее соединение (443/QUIC)
                                        cloudflared в контейнере на ВМ
                                                   │ HTTP
                                        app:8090 / grafana:3000
```

Зачем: входящие соединения к ВМ из-за рубежа фильтруются (и часть российских сетей
тоже), поэтому прямой доступ по IP/домену работает не у всех. Туннель устанавливает
соединение **изнутри наружу**, и тогда сайт открывается с любой сети. URL quick-туннеля
одноразовый (меняется при перезапуске контейнера) — актуальный смотри в логах.

## 8. Что здесь app-specific, а что нет

**Меняется вместе с приложением:** `frontend/` (или `apps/frontend`, `apps/backend`),
сервис `app` в `docker-compose.yml`, маршруты в `infra/caddy/Caddyfile`, команды
lint/test/build в `.gitlab-ci.yml`, переменные окружения приложения, миграции БД.

**Не меняется:** ВМ, Docker, сети/volumes, Prometheus/Grafana/Loki/Alertmanager, Postgres,
Redis, экспортеры, autoheal, Caddy как edge, GitLab, runner, CI-переменные деплоя,
скрипты деплоя/бэкапа/туннелей, DNS и сертификаты.
