# 08. Переделка приложения под тикетную систему

## Статус: локальная переделка реализована

Исторический план ниже сохранён как контекст, но большая часть его предположений
устарела. Локальный репозиторий содержит React frontend, Go API, Postgres migrations,
`migrate`, `backend` и отдельный `notifications` процесс. Доставка уведомлений
выполняется из transactional outbox в PostgreSQL. Prometheus jobs и dashboard для
Go сервисов добавлены локально.

Production server и CI/CD в этой переделке не менялись и не проверялись. Не считайте
описанные ниже серверные адреса/деплой инструкцией по выпуску новой версии.

## 1. Исторический контекст: планировалось не менять

- ВМ Yandex Cloud, SSH, Security Group, Docker, UFW.
- `docker-compose.prod.yml` (Caddy edge), `infra/caddy/*` (кроме маршрутов `/api`).
- Prometheus, Grafana, Loki, Alloy, Alertmanager, экспортеры, autoheal.
- Postgres/Redis как сервисы (только схема БД и креды приложения).
- GitLab, runner, CI-переменные деплоя, `scripts/deploy.sh`, `deploy/tunnels.sh`.
- Домен, DNS, wildcard-сертификат, Cloudflare-туннели, бэкапы.
- `docs/` — эта документация остаётся актуальной, дополняй её.

## 2. Исторический план изменений (выполнен локально, кроме CI/CD)

| Слой | Файлы | Действие |
|---|---|---|
| Код | `frontend/` → новое | заменить; можно переименовать в `apps/frontend` |
| Бэкенд | `apps/backend/` (новое) | новый сервис + Dockerfile |
| Compose | `docker-compose.yml` | добавить `backend`, env, `depends_on`, healthcheck |
| Маршруты | `infra/caddy/Caddyfile` | `/api/*` → `backend:8080`, остальное → `app:8080` |
| CI | `.gitlab-ci.yml` | джобы под фронт и бэк, миграции, две сборки образов |
| Env | `.env.example` (+ серверный `/.env`) | `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `VITE_API_URL` |
| Метрики | `infra/prometheus/prometheus.yml` | job `backend` → `backend:8080/metrics` |
| БД | `infra/postgres/init/` | схемы/расширения; миграции — в приложении |

## 3. Рекомендуемая структура репозитория

```
uiarc-dashboard/
├── apps/
│   ├── frontend/          # бывший frontend/
│   │   ├── Dockerfile
│   │   └── ...
│   └── backend/           # новый бэкенд
│       ├── Dockerfile
│       └── ...
├── infra/                 # без изменений
├── docker-compose*.yml
├── .gitlab-ci.yml
└── docs/
```

Если не хочется двигать папки — можно оставить `frontend/` и добавить `backend/`
рядом. Главное — обновить пути в compose и CI.

## 4. Compose: добавить бэкенд

```yaml
  backend:
    build:
      context: ./apps/backend
    image: x5-support-backend:local
    container_name: x5-support-backend
    restart: unless-stopped
    environment:
      TZ: ${TZ:-Europe/Moscow}
      DATABASE_URL: postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}?sslmode=disable
      REDIS_URL: redis://redis:6379/0
      JWT_SECRET: ${JWT_SECRET}
      HTTP_ADDR: :8080
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
    networks: [backend, monitoring]
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:8080/healthz"]
      interval: 15s
      timeout: 3s
      retries: 5
    logging: *default-logging
```

## 5. Caddy: маршруты

`infra/caddy/Caddyfile` (production HTTPS-вариант!):

```caddy
https://{$DOMAIN}, https://*.{$DOMAIN} {
    tls /certs/live/{$DOMAIN}/fullchain.pem /certs/live/{$DOMAIN}/privkey.pem
    encode zstd gzip

    handle /api/* {
        reverse_proxy backend:8080
    }
    handle {
        reverse_proxy app:8080 {
            health_uri /healthz
            health_interval 30s
        }
    }

    header { ... }
    log { output stdout; format json }
}
```

Вариант с отдельным поддоменом (если нужен):

```caddy
https://api.{$DOMAIN} {
    tls /certs/live/{$DOMAIN}/fullchain.pem /certs/live/{$DOMAIN}/privkey.pem
    reverse_proxy backend:8080
}
```

Wildcard-сертификат уже покрывает `api.x5-test-task.ru` — нужен только A-record и
блок в Caddy, перевыпуск не требуется.

## 6. CI: что добавить

```yaml
stages: [lint, test, check, build, deploy]

lint-frontend:   # pnpm lint + typecheck
test-frontend:   # pnpm test
build-frontend:  # pnpm build → artifact dist

lint-backend:    # gofmt/go vet  (или ruff / eslint)
test-backend:    # go test ./...  (services: postgres)
build-backend-image:  # docker build backend

deploy:
  # rsync кода + docker compose up -d --build
  # либо: pull образов из registry
```

Когда появится БД — **миграции**:

```yaml
migrate:
  stage: deploy
  needs: [build-backend-image]
  when: manual
  script:
    - ssh ... "cd /opt/x5-support && docker compose -f ... run --rm backend migrate"
```

Порядок: `build-backend-image → migrate → deploy`.

## 7. Переменные окружения нового приложения

Добавить в `.env.example`, серверный `/opt/x5-support/.env` и (при необходимости) в CI:

```dotenv
# backend
DATABASE_URL=postgres://x5-support:${POSTGRES_PASSWORD}@postgres:5432/x5-support?sslmode=disable
REDIS_URL=redis://redis:6379/0
JWT_SECRET=change_me
HTTP_ADDR=:8080

# frontend (build-time)
VITE_API_URL=/api
```

Для SPA удобнее один origin (`/api`), чтобы не настраивать CORS.

## 8. Миграции и схема БД

- Postgres уже в compose; `infra/postgres/init/` — только начальные скрипты
  (расширения, роли). Схему приложения лучше держать в миграциях (goose/golang-migrate,
  knex/prisma, alembic).
- Миграции запускать отдельной джобой/шагом перед деплоем.
- Бэкапы уже настроены (`scripts/backup.sh`, cron 03:00) — не переделывать.
  Перед крупными миграциями делать `./scripts/backup.sh` вручную.

## 9. Метрики и логи

- Бэкенд: добавить `/metrics` (Prometheus client) и job в `infra/prometheus/prometheus.yml`.
- Логи: ничего не делать — Alloy уже собирает stdout всех контейнеров в Loki.
- Grafana: добавить панели RPS/latency/error/DB в `x5-support-overview.json`.
- Алерты: добавить правила в `infra/prometheus/rules/alerts.yml` для бизнес-метрик.

## 10. Пошаговый план переделки

1. Создать `/apps/frontend` и `/apps/backend` (или `frontend/` + `backend/`), обновить
   пути в `docker-compose.yml`.
2. Поднять локально: `make up`, проверить app + API.
3. Добавить маршрут `/api` в `infra/caddy/Caddyfile`, проверить локально через
   `make prod` (или edge на localhost).
4. Обновить `.env.example`, добавить секреты в серверный `.env`.
5. Переписать джобы `lint/test/check` под оба стека, добавить `build-backend-image`.
6. Прописать миграции (если БД).
7. Прогнать пайплайн до зелёного, запустить `deploy` вручную.
8. Проверить на сервере: `https://x5-test-task.ru`, API, Grafana (метрики/логи).
9. Обновить `docs/` (architecture, cicd, rebuild — этот файл).

## 11. Чего избегать

- Не менять `docker-compose.prod.yml` без необходимости — там Caddy/TLS/порты.
- Не затирать серверный `.env` деплоем (rsync уже исключает).
- Не включать Cloudflare-прокси для A-записей (см. `05-dns-tls.md`).
- Не пушить HTTP-вариант `Caddyfile` в прод.
- Не добавлять секреты в код/репозиторий.
