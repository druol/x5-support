# 02. Локальная разработка

## 1. Требования

| Инструмент | Версия | Примечание |
|---|---|---|
| Docker Desktop | актуальная | Linux-контейнеры, Docker Compose v2 |
| Node.js | 22+ | для фронтенда (в контейнере тоже 22) |
| pnpm | 9.15.9 | зафиксирован в `frontend/package.json` (`packageManager`) |
| Git | — | локальный GitLab или любой remote |
| make | — | обёртка над docker compose |

## 2. Первый запуск

```bash
cd uiarc-dashboard
test -f .env || cp .env.example .env  # создать локальный env, не перезаписывая существующий

make up                       # frontend + Go API + notifications + observability
make status                   # карта сервисов и портов
make smoke                    # проверка health-эндпоинтов и целей Prometheus
```

Открыть:
- приложение: http://localhost:8090
- Grafana: http://localhost:3000 (`admin` / `GRAFANA_ADMIN_PASSWORD` из `.env`)
- Prometheus: http://localhost:9090
- Alertmanager: http://localhost:9093

Локальный тикетный стек использует порт `APP_PORT` из `.env` (по умолчанию 8090).
Миграции выполняются одноразовым сервисом `migrate` до старта API и worker.
API и worker доступны внутри Compose сети, а UI обращается к API через `/api`.

## 3. Makefile — шпаргалка

```bash
make up        # core + весь observability (сборка app)
make core      # только app + postgres + redis + экспортеры
make obs       # только наблюдаемость (без app)
make prod      # прод-профиль с Caddy (нужен DOMAIN в .env)
make down      # остановить
make ps        # статус контейнеров
make logs      # логи всего стека
make smoke     # health-проверки
make status    # карта: URL, порты, состояние
make build     # пересобрать frontend, API и notifications
make backup    # дамп Postgres в backups/
make reset     # УДАЛИТЬ контейнеры и volumes (внимание: данные)
make gitlab    # локальный GitLab CE + runner
make runner    # только runner
make gitlab-bootstrap   # первичная настройка GitLab (root, отключение регистрации)
make test-backend       # Go integration tests с отдельной тестовой БД
make test-frontend      # lint + unit tests + production build
make check-tickets      # локальная API acceptance проверка полного цикла заявки
make check-recovery     # остановка worker, проверка backlog/replay/restart; только localhost
make check-browser     # headless браузерный acceptance сценарий
```

Перед frontend checks установите зависимости из lockfile: `cd frontend && pnpm install
--frozen-lockfile`. Для browser acceptance дополнительно установите Chromium командой
`pnpm exec playwright install chromium` из `frontend/`. После этого вернитесь в корень
репозитория для запуска `make test-frontend` или `make check-browser`.

## 4. Скрипты

| Скрипт | Что делает |
|---|---|
| `scripts/status.sh` | таблица: сервис, URL, HTTP-код; опубликованные порты; статус GitLab/runner |
| `scripts/smoke.sh` | контейнеры + health-эндпоинты + цели Prometheus (exit code ≠ 0 при провале) |
| `scripts/backup.sh` | `pg_dump` → `backups/x5-support-<timestamp>.sql.gz`, ротация > 7 дней |
| `scripts/deploy.sh` | деплой с Mac: rsync кода на сервер + `docker compose up -d --build` |
| `scripts/gitlab-bootstrap.sh` | создаёт root-пользователя, отключает signup, настраивает runner |
| `deploy/tunnels.sh` | (на сервере) поднимает quick tunnels к app и Grafana, печатает URL |
| `deploy/enable-https.sh` | (на сервере) выпуск/продление wildcard-сертификата через DNS-01 |

## 5. Фронтенд

```bash
cd frontend
pnpm install
pnpm dev          # Vite dev-сервер на :5183
pnpm lint         # ESLint 9 (flat config)
pnpm typecheck    # tsc -b --noEmit
pnpm test         # Vitest (unit)
pnpm build        # tsc + vite build → dist/
pnpm preview      # статичный превью на :5184
```

Структура:

```
frontend/
├── src/
│   ├── App.tsx                # основной лендинг-дашборд
│   ├── data.tsx               # мок-данные, форматтеры, lineData()
│   ├── components/            # UI-кит (arc/*) и секции
│   ├── app.module.css         # стили страницы
│   ├── global.css             # токены/тема
│   └── __tests__/data.test.ts # юнит-тесты Vitest
├── Caddyfile                  # статика + /healthz + admin :2019 (metrics)
├── Dockerfile                 # node:22-alpine (build) → caddy:2.9-alpine (runtime)
├── eslint.config.js
├── vite.config.ts
└── package.json
```

Особенности Dockerfile: `pnpm-workspace.yaml` не копируется (pnpm 9 ломается на
несовместимом плейсхолдере), npm-реестр задаётся через `NPM_REGISTRY`
(по умолчанию `https://registry.npmmirror.com` — из РФ npmjs недоступен).

## 6. Локальный GitLab

```bash
make gitlab                 # поднять GitLab CE (порт 8929) + runner
make gitlab-bootstrap       # root-пользователь, отключить регистрацию

# URL: http://localhost:8929  (root / GITLAB_ROOT_PASSWORD из .env)
# Проект: root/x5-support-infra
# Runner: docker executor, смонтирован /var/run/docker.sock
```

Runner собирает образы через docker.sock хоста и деплоит по SSH. Клон-URL для runner —
`http://gitlab:8929/root/x5-support-infra.git` (внутренняя сеть `x5-support-gitlab_default`),
для человека — `http://localhost:8929/...`.

Если `git push` печатает `fatal: failed to store: 100001` (osxkeychain) — пуш всё равно
проходит, это шум macOS.

## 7. Полезные мелочи

- `.env` локальный и серверный — **разные**; серверный лежит в `/opt/x5-support/.env`.
- `make reset` уничтожает данные (volumes). Использовать только осознанно.
- Если порт 8080/5432 занят — подними `APP_PORT`/`POSTGRES_PORT` в `.env`.
- Все UI-сервисы слушают `127.0.0.1`, наружу не торчат.
- Скриншоты интерфейса для документации: `docs/infra/*.png`.
