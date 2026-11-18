# Support Tickets

Тикетная система на React, Go и PostgreSQL. Тикеты, история событий и outbox сохраняются
в PostgreSQL. Отдельный Go `notifications` процесс доставляет события в inbox.

**Область применения:** пользовательский и административный порталы поддержки —
создание заявок, история событий, комментарии, смена статусов и уведомления.

## Демо для показа

Для запуска не требуется устанавливать Node, Go и pnpm — достаточно Docker Desktop с Compose v2
и Python 3 (есть на macOS по умолчанию).

```bash
make demo
# или: ./scripts/demo.sh
```

Скрипт сам соберёт образы, поднимет изолированный стек `x5-support-demo`, дождётся health,
создаст 3 демо-заявки, откроет браузер и напечатает ссылки:

- пользователь: `http://127.0.0.1:<порт>/user`
- администратор: `http://127.0.0.1:<порт>/admin`

Остановить: `make demo-down` / `./scripts/demo.sh down`.
Удалить вместе с данными: `make demo-reset` / `./scripts/demo.sh reset`.

Демо использует отдельные container names, volumes и проект Compose, поэтому не конфликтует
с обычным dev-стеком.

## Запуск для разработки

Требуются Docker Desktop с Compose v2, Node.js 22+, pnpm 9 и Python 3 для проверок.

```bash
test -f .env || cp .env.example .env  # создать локальный env, не перезаписывая существующий
make up                # frontend, PostgreSQL, Go API, notifications и observability
make status
make smoke
```

Порты берутся из локального `.env`; типично приложение доступно на
[http://localhost:8090](http://localhost:8090), Grafana — на
[http://localhost:3000](http://localhost:3000), Prometheus — на
[http://localhost:9090](http://localhost:9090). Если приложение опубликовано на другом
`APP_PORT`, используйте его. Миграция схемы запускается Compose сервисом `migrate`
перед API/worker. Не используйте `make reset` для обычной остановки: он удаляет volumes.

Полезные команды:

```bash
make logs
make test-backend
make test-frontend       # lint, frontend tests, build
make check-tickets       # end-to-end API acceptance
make check-recovery      # локальный outage/replay/restart recovery
make check-browser       # browser acceptance (если браузерные зависимости установлены)
```

Для локальных frontend checks установите зависимости из lockfile; для browser acceptance
дополнительно установите Chromium:

```bash
cd frontend
pnpm install --frozen-lockfile
pnpm exec playwright install chromium  # нужно только для браузерного сценария
cd ..
```

Затем запускайте нужную команду `make` из корня репозитория.

`make check-recovery` меняет состояние только локальных `backend`/`notifications`
контейнеров и добавляет тестовую заявку в локальную БД; он восстанавливает остановленный
worker даже при ошибке. Не запускайте его с внешним `--base-url`.

## Архитектура и решения

- React SPA хранит маршруты пользователя и администратора; same-origin запросы идут
  через `/api` к Go API.
- Go API валидирует переходы статусов и в одной PostgreSQL транзакции сохраняет
  заявку, history event и outbox event. История фиксирует автора, время, текст и
  переход состояния.
- Независимый `notifications` процесс выбирает outbox строки с
  `FOR UPDATE SKIP LOCKED`, записывает inbox и выставляет `delivered_at` атомарно.
  Уникальный `event_id` делает повторы идемпотентными; прочитанное состояние при replay
  сохраняется.
- `migrate` применяет версионированные SQL миграции перед стартом API/worker.
- Prometheus опрашивает Caddy, Go API и notifications. Grafana dashboard
  `Support / Service` показывает запросы, ошибки, среднюю длительность и backlog;
  `SupportOutboxBacklog` предупреждает о старейшем событии старше 5 минут.

Подробности реализации и известных ограничений: [docs/01-architecture.md](docs/01-architecture.md),
[docs/02-local-dev.md](docs/02-local-dev.md), [docs/06-observability.md](docs/06-observability.md),
[docs/08-rebuild-ticketing.md](docs/08-rebuild-ticketing.md).

## Ручная приёмка

1. Откройте приложение. Как **Пользователь**, выберите тему **Проблема с доступом**,
   **Ошибка в работе сервиса** или **Другое**, создайте заявку и убедитесь, что она
   появилась со статусом **Новое**.
2. Переключитесь в раздел **Администратор**, откройте заявку, при желании добавьте
   комментарий и нажмите **Принять в работу**. Завершите её кнопкой **Завершить заявку**,
   указав обязательный результат. Убедитесь, что история показывает автора, время,
   текст и смену статусов.
3. Вернитесь в раздел **Пользователь** и нажмите **Вернуть в работу**, указав причину.
   Проверьте, что повторный или недопустимый переход отклоняется.
4. Откройте **Уведомления**: самые новые события должны быть сверху. Нажатие на
   уведомление отмечает его прочитанным и открывает соответствующую заявку; счётчик
   непрочитанных уменьшается.
5. В Grafana откройте **Support / Service**. После активности должны появиться API
   метрики; при исправном worker pending outbox обычно равен нулю.

## Автоматизированные проверки и восстановление

- `make test-backend` — Go integration/unit тесты на отдельной тестовой БД.
- `make test-frontend` — lint, frontend unit tests и production build.
- `make check-tickets` — полный API lifecycle и уведомления.
- `make check-recovery` — остановка notifications, проверка накопления outbox,
  доставка после старта worker, replay без дубликатов и рестарт API/worker.
- `make check-browser` — headless browser flow; запускать отдельно при доступном
  браузере.
- `make smoke` — health checks и доступность локальных Prometheus targets.

При накоплении очереди посмотрите `make status`, `docker compose logs --tail=100 notifications backend postgres`, метрику `support_outbox_pending` и возраст
`support_outbox_oldest_seconds`. Проверьте здоровье Postgres и notifications, затем
восстановите worker через Compose (`docker compose start notifications`). Не удаляйте
outbox записи и не сбрасывайте volumes как способ восстановления.

CI/CD, деплой, production сервер, DNS/TLS и production метрики этой локальной
реализации не проверялись и здесь не менялись.
