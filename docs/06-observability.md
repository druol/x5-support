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
| redis-exporter | v1.62.0 | метрики Redis | внутри сети |
| cAdvisor | v0.49.1 | метрики контейнеров | **отключён** (профиль) |
| Jaeger | all-in-one 1.62 | трейсы | профиль `tracing` |

## 2. Prometheus

Конфиг: `infra/prometheus/prometheus.yml`, правила: `infra/prometheus/rules/alerts.yml`.

Джобы (targets):

| Job | Target | Что даёт |
|---|---|---|
| `prometheus` | `localhost:9090` | самометрики |
| `node` | `node-exporter:9100` | CPU/RAM/диск хоста |
| `app` | `app:2019` | метрики Caddy (HTTP-запросы, коды, latency) |
| `backend` | `backend:8080/metrics` | Go API requests, errors, duration, outbox backlog |
| `notifications` | `notifications:8080/metrics` | health and service metrics for outbox worker |
| `postgres` | `postgres-exporter:9187` | БД: соединения, транзакции, размер |
| `redis` | `redis-exporter:9121` | память, ключи, hit-rate |
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
| `RedisDown` | `redis_up == 0` |
| `HighErrorRate` | доля 5xx у Caddy выше порога |
| `AppLatencyHigh` | p95 latency приложения выше порога |
| `SupportOutboxBacklog` | возраст старейшего неподтверждённого outbox event > 5 минут в течение 5 минут |
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
| `orbita-overview.json` | Orbita / Overview | здоровье приложения, RPS, ошибки, latency, БД/Redis |
| `orbita-infra.json` | Orbita / Infra | хост: CPU, RAM, диск, сеть, контейнеры |
| `orbita-logs.json` | Orbita / Logs | логи из Loki (фильтры по контейнерам) |
| `support-service.json` | Support / Service | API request/error rate, средняя длительность, pending outbox count и возраст |

Доступ:

- локально: http://localhost:3000 (admin / `GRAFANA_ADMIN_PASSWORD`);
- сервер: только `127.0.0.1:3000`, поэтому:
  ```bash
  ssh -N -L 3000:127.0.0.1:3000 ubuntu@84.252.135.15
  # затем http://localhost:3000
  ```
- либо через CF-туннель (см. `04-server-production.md`).

## 5. Логи

Alloy (`infra/alloy/config.alloy`) читает stdout/stderr всех docker-контейнеров
через `/var/run/docker.sock` и отправляет в Loki. В Grafana → Explore → Loki можно
фильтровать по `container`, `stream`, тексту.

```logql
{container="orbita-app"} |= "error"
{container="orbita-edge"} |= "error"
```

Полезные команды без Grafana:

```bash
docker logs orbita-app --tail 100
docker logs orbita-edge --tail 100
docker compose ... logs -f --tail=100
```

## 6. Метрики тикетного приложения

Go API и notifications worker публикуют Prometheus text format на `/metrics` порта
8080 внутри Compose сети. Prometheus собирает их отдельными jobs с интервалом 15 с.

| Метрика | Значение |
|---|---|
| `support_http_requests_total` | число обработанных HTTP-запросов |
| `support_http_errors_total` | число ответов с ошибкой |
| `support_http_duration_seconds_sum` / `_count` | накопленная длительность и число запросов; отношение rate sum/count — средняя длительность |
| `support_outbox_pending` | количество событий без `delivered_at` |
| `support_outbox_oldest_seconds` | возраст самого старого недоставленного события |

Обе службы экспортируют один и тот же набор; актуальный backlog берите с `job="backend"`.
Для обзора откройте Grafana → Support / Service. Алерт `SupportOutboxBacklog`
срабатывает, если старейший event ожидает больше пяти минут непрерывно пять минут.

## 7. Быстрая диагностика «всё ли живо»

```bash
# локально
make smoke

# на сервере
cd /opt/orbita && docker compose -f docker-compose.yml \
  -f docker-compose.observability.yml -f docker-compose.prod.yml ps

# Prometheus targets UP/DOWN
curl -s http://127.0.0.1:9090/api/v1/targets | \
  python3 -c "import json,sys; d=json.load(sys.stdin)['data']['activeTargets']; \
  print('up:',sum(1 for t in d if t['health']=='up'),'/',len(d))"

# локальное API и метрика очереди
curl -fsS http://127.0.0.1:8090/healthz
curl -fsS 'http://127.0.0.1:9090/api/v1/query?query=support_outbox_pending'
```
