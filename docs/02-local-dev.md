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
cp .env.example .env          # локальные пароли (можно оставить дефолтные)

make up                       # core + observability, сборка app
make status                   # карта сервисов и портов
make smoke                    # проверка health-эндпоинтов и целей Prometheus
```

Открыть:
- приложение: http://localhost:8090
- Grafana: http://localhost:3000 (`admin` / `GRAFANA_ADMIN_PASSWORD` из `.env`)
- Prometheus: http://localhost:9090
- Alertmanager: http://localhost:9093

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
make build     # пересобрать образ app
make backup    # дамп Postgres в backups/
make reset     # УДАЛИТЬ контейнеры и volumes (внимание: данные)
make gitlab    # локальный GitLab CE + runner
make runner    # только runner
make gitlab-bootstrap   # первичная настройка GitLab (root, отключение регистрации)
```

## 4. Скрипты

| Скрипт | Что делает |
|---|---|
| `scripts/status.sh` | таблица: сервис, URL, HTTP-код; опубликованные порты; статус GitLab/runner |
| `scripts/smoke.sh` | контейнеры + health-эндпоинты + цели Prometheus (exit code ≠ 0 при провале) |
| `scripts/backup.sh` | `pg_dump` → `backups/orbita-<timestamp>.sql.gz`, ротация > 7 дней |
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
# Проект: root/orbita-infra
# Runner: docker executor, смонтирован /var/run/docker.sock
```

Runner собирает образы через docker.sock хоста и деплоит по SSH. Клон-URL для runner —
`http://gitlab:8929/root/orbita-infra.git` (внутренняя сеть `orbita-gitlab_default`),
для человека — `http://localhost:8929/...`.

Если `git push` печатает `fatal: failed to store: 100001` (osxkeychain) — пуш всё равно
проходит, это шум macOS.

## 7. Полезные мелочи

- `.env` локальный и серверный — **разные**; серверный лежит в `/opt/orbita/.env`.
- `make reset` уничтожает данные (volumes). Использовать только осознанно.
- Если порт 8080/5432 занят — подними `APP_PORT`/`POSTGRES_PORT` в `.env`.
- Все UI-сервисы слушают `127.0.0.1`, наружу не торчат.
- Скриншоты интерфейса для документации: `docs/infra/*.png`.
