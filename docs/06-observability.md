# 06. Наблюдаемость

## 1. Состав

| Компонент | Версия | Роль | Доступ |
|---|---|---|---|
| Prometheus | v2.55.1 | сбор метрик | `127.0.0.1:9090` (локально/SSH-туннель) |
| Grafana | 11.3.0 | дашборды | `127.0.0.1:3000` / CF-туннель |
| Alertmanager | v0.27.0 | маршрутизация алертов | `127.0.0.1:9093` |
| Loki | 3.2.1 | хранение логов | `127.0.0.1:3100` |
| Alloy | v1.5.1 | сбор docker-логов → Loki | `127.0.0.1:12345` |
| node-exporter | v1.8.2 | метрики хоста | внутри сети |
| blackbox-exporter | v0.25.0 | HTTP-пробы | внутри сети |
| postgres-exporter | v0.16.0 | метрики Postgres | внутри сети |
| docker-metrics | локальный exporter | CPU/память/число контейнеров | внутри сети |

## 2. Prometheus

Конфиг: `infra/prometheus/prometheus.yml`, правила: `infra/prometheus/rules/alerts.yml`.

Джобы (targets):

| Job | Target | Что даёт |
|---|---|---|
| `prometheus` | `localhost:9090` | самометрики |
| `node` | `node-exporter:9100` | CPU/RAM/диск хоста |
| `app` | `app:2019` | метрики Caddy (HTTP-запросы, коды, latency) |
| `backend` | `backend:8080/metrics` | Go API RPS/errors/p95, outbox backlog, Postgres pool |
| `notifications` | `notifications:8080/metrics` | worker delivery/errors/lag и outbox backlog |
| `docker` | `docker-metrics:9101` | CPU, память и число запущенных контейнеров |
| `postgres` | `postgres-exporter:9187` | БД: соединения, транзакции, размер |
| `loki` | `loki:3100` | здоровье Loki |
| `grafana` | `grafana:3000` | здоровье Grafana |
| `alertmanager` | `alertmanager:9093` | самометрики AM |
| `blackbox-http` | blackbox → внешние URL | доступность сайта/домена изнутри |

Проверка целей:

```bash
curl -s http://127.0.0.1:9090/api/v1/targets | jq '.data.activeTargets | length'
# или в UI: Prometheus → Status → Targets
```

## 3. Алерты

`infra/prometheus/rules/alerts.yml`:

| Алерт | Условие (кратко) |
|---|---|
| `TargetDown` | цель недоступна > 2m |
| `HttpProbeFailing` | blackbox HTTP-проба неуспешна |
| `PostgresDown` | `pg_up == 0` |
| `HighErrorRate` | доля 5xx у Caddy выше порога |
| `AppLatencyHigh` | p95 latency приложения выше порога |
| `X5OutboxBacklog` | > 100 событий в outbox или старейшее ждёт > 2 минут |
| `X5High5xxRate` | доля 5xx backend/notifications > 5% |
| `X5P95LatencyHigh` | p95 HTTP latency > 1 секунды |
| `X5NotificationDeliveryErrors` | есть ошибки доставки уведомлений |
| `X5NoDeliveryPolls` | воркер notifications не опрашивает outbox > 2 минут |
| `X5DBPoolSaturated` | занято > 90% соединений пула Postgres |
| `ContainerMemoryHigh` | память контейнера > 80% лимита |
| `DiskSpaceLow` | свободное место на диске < 15% |

Alertmanager (`infra/alertmanager/alertmanager.yml`) по умолчанию без внешних
получателей (заглушка). Чтобы включить Telegram/Slack/email — добавить receiver
и перезапустить alertmanager.

## 4. Grafana

Провижининг (автоматически при старте):

- datasources: `infra/grafana/provisioning/datasources/datasources.yml`
  (Prometheus — default, Loki — для логов).
- dashboards: `infra/grafana/provisioning/dashboards/dashboards.yml` → папка `infra/grafana/dashboards/`.

Дашборды:

| Файл | Название | Что показывает |
|---|---|---|
| `x5-overview.json` | X5 Support / Overview | здоровье приложения, RPS, ошибки, latency, БД |
| `x5-infra.json` | X5 Support / Infra | хост: CPU, RAM, диск, сеть, контейнеры |
| `x5-logs.json` | X5 Support / Logs | логи из Loki (фильтры по контейнерам и уровню) |
| `support-service.json` | Support / Service | HTTP RPS/ошибки/p95, outbox, доставка уведомлений, пул Postgres |

Доступ:

- локально: http://localhost:3000 (admin / `GRAFANA_ADMIN_PASSWORD`);
- сервер: только `127.0.0.1:3000`, поэтому:
  ```bash
  ssh -N -L 3000:127.0.0.1:3000 ubuntu@81.26.180.165
  # затем http://localhost:3000
  ```
- либо через CF-туннель (см. `04-server-production.md`).

## 5. Логи

Все сервисы пишут **structured JSON в stdout**. Уровень задаётся `LOG_LEVEL` (`debug|info|warn|error`, по умолчанию `info`), окружение — `APP_ENV`. Alloy читает stdout/stderr Docker-контейнеров, отправляет в Loki и делает `level` отдельным label; `service`, `env`, `request_id` доступны в LogQL через `| json`.

Формат access-лога backend/notifications:

```json
{
  "time": "2026-11-18T06:47:43.355Z",
  "level": "INFO",
  "msg": "http_request",
  "service": "api",
  "env": "production",
  "version": "2413cd9",
  "commit": "…",
  "request_id": "a447572d04954a2711a5c93ae0a01bdf",
  "method": "GET",
  "route": "/api/user/tickets",
  "path": "/api/user/tickets",
  "status": 200,
  "duration_ms": 10.467,
  "bytes": 734,
  "client_ip": "203.0.113.10",
  "user_agent": "Mozilla/5.0 …"
}
```

Правила:

- `route` нормализован (`/api/admin/tickets/3/status` → `/api/admin/tickets/{id}/status`),
  чтобы не плодить кардинальность и не логировать персональные id как label;
- `request_id` принимается из `X-Request-ID`, иначе генерируется; возвращается клиенту
  в ответе и попадает в access-log Caddy, поэтому запрос можно проследить от edge до backend;
- 5xx и запросы дольше 1 секунды пишутся с `level=WARN`;
- health/metrics-запросы не попадают в access-log;
- Caddy редактирует `Cookie`, `Authorization` и `Proxy-Authorization` из access-логов.

Полезные LogQL-запросы:

```logql
{service="backend"} | json | level="ERROR"
{service="backend"} | json | request_id="a447572d04954a2711a5c93ae0a01bdf"
{service="notifications"} |= "notification_delivery_failed"
{container="x5-support-edge"} | json | status >= 500
```

## 6. Метрики сервисов

`/metrics` отдают и `backend`, и `notifications` (Prometheus text format); собираются
jobs `backend` и `notifications` каждые 15 секунд.

| Метрика | Тип | Что означает |
|---|---|---|
| `x5_http_requests_total{method,route,status}` | counter | HTTP-запросы по методу, нормализованному route и коду |
| `x5_http_request_duration_seconds` | histogram | latency HTTP (p50/p95/p99 через `histogram_quantile`) |
| `x5_http_in_flight_requests` | gauge | запросы, обрабатываемые прямо сейчас |
| `x5_http_response_size_bytes` | histogram | размер ответа |
| `x5_outbox_pending_events` | gauge | недоставленные события outbox |
| `x5_outbox_oldest_pending_seconds` | gauge | возраст старейшего недоставленного события |
| `x5_inbox_unread_items` | gauge | непрочитанные уведомления в inbox |
| `x5_notifications_delivered_total{result}` | counter | успешно доставленные события (только worker) |
| `x5_notifications_delivery_errors_total` | counter | ошибки доставки (только worker) |
| `x5_notifications_delivery_duration_seconds` | histogram | длительность батча доставки |
| `x5_notifications_batch_size` | histogram | размер батча за poll |
| `x5_notifications_last_successful_delivery_timestamp_seconds` | gauge | время последнего успешного poll |
| `x5_docker_containers_running` | gauge | число запущенных Docker-контейнеров |
| `x5_docker_container_cpu_seconds_total{container}` | counter | CPU-время контейнера |
| `x5_docker_container_memory_bytes{container}` | gauge | память контейнера |
| `x5_db_pool_total_conns` / `idle_conns` / `acquired_conns` / `max_conns` | gauge | состояние пула pgx |
| `x5_db_pool_acquire_count_total` | counter | число успешных взятий соединения |
| `x5_build_info{service,env,version,commit,go_version}` | gauge | версия сборки |
| `x5_uptime_seconds` | gauge | uptime процесса |
| `go_*`, `process_*` | — | стандартные Go/process-метрики |

Backend и notifications используют отдельные registry, поэтому серии не смешиваются;
delivery-метрики экспортирует только worker.

Для обзора откройте Grafana → **Support / Service**: RPS, 5xx, p95, outbox,
доставка уведомлений, ошибки доставки и утилизация пула Postgres.

## 7. Быстрая диагностика «всё ли живо»

```bash
# локально
make smoke

# на сервере
cd /opt/x5-support && docker compose -f docker-compose.yml \
  -f docker-compose.observability.yml -f docker-compose.prod.yml ps

# Prometheus targets UP/DOWN
curl -s http://127.0.0.1:9090/api/v1/targets | \
  python3 -c "import json,sys; d=json.load(sys.stdin)['data']['activeTargets']; \
  print('up:',sum(1 for t in d if t['health']=='up'),'/',len(d))"

# локальное API и метрика очереди
curl -fsS http://127.0.0.1:8090/healthz
curl -fsS 'http://127.0.0.1:9090/api/v1/query?query=x5_outbox_pending_events'
```
