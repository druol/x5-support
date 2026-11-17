# 01. Архитектура

## 1. Схема локального тикетного стека

```
Браузер → app / Caddy (APP_PORT)
            ├── SPA и статические файлы
            ├── /api/user/*, /api/admin/* → backend Go API :8080
            └── /api/notifications*       → notifications Go service :8080

backend ──────────────┐
                      ▼
                 PostgreSQL 16
                 tickets + history + outbox + notification inbox
                      ▲
notifications worker ┘  (FOR UPDATE SKIP LOCKED; доставляет outbox в inbox)

Prometheus скрейпит app, backend, notifications и exporters; Grafana показывает
дашборды, Alertmanager обрабатывает правила. Alloy отправляет container logs в Loki.
```

## 2. Compose-файлы и зачем они нужны

| Файл | Что поднимает | Когда используется |
|---|---|---|
| `docker-compose.yml` | `app`, `migrate`, `backend`, `notifications`, `postgres`, `redis`, exporters | базовый стек |
| `docker-compose.observability.yml` | `prometheus`, `alertmanager`, `grafana`, `loki`, `alloy`, `node-exporter`, `blackbox-exporter`, `autoheal` (+ профили `cadvisor`, `tracing`) | мониторинг и логи |
| `docker-compose.prod.yml` | `caddy` (edge, 80/443), переопределяет порт app на `127.0.0.1:8090`, монтирует `./certs` | сервер |
| `docker-compose.gitlab.yml` | `gitlab`, `gitlab-runner` | локально, отдельный проект `x5-support-gitlab` |

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

## 6. Локальный поток запроса

1. Браузер → локальный порт `APP_PORT` → контейнер `app` (Caddy).
2. Caddy отдаёт SPA файлы и проксирует `/api/*` к Go API.
3. Go API атомарно сохраняет заявку, историю и outbox event в Postgres. Отдельный
   `notifications` процесс читает outbox через `FOR UPDATE SKIP LOCKED`, создаёт
   inbox notification и помечает event доставленным в одной транзакции. Уникальный
   `event_id` делает повторную доставку идемпотентной.
4. Prometheus раз в 15 секунд скрейпит:
   - `/metrics` самого Caddy (`app:2019`),
   - Go API (`backend:8080/metrics`) и notifications (`notifications:8080/metrics`),
   - node-exporter, postgres-exporter, redis-exporter,
   - Loki, Grafana, Alertmanager, blackbox-http.
5. Alloy читает docker-логи и отправляет в Loki; в Grafana — дашборды из provisioning.
6. Alertmanager получает алерты по правилам `infra/prometheus/rules/alerts.yml`.

Исторический production поток шёл через DNS, Caddy edge и TLS на ВМ. Он сохранён в
`docs/04-server-production.md`; серверный deployment не менялся и не проверялся.

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

**Локальная реализация:** `frontend/` + `backend/`; сервисы `backend`, `migrate` и
`notifications` в `docker-compose.yml`; `/api/*` обслуживается API. Схема лежит в
`backend/migrations/`.

Production сервер, CI/CD, DNS/TLS и деплой в этой локальной работе не менялись и не
проверялись. Исторические deployment конфиги и описания инфраструктуры сохранены.
