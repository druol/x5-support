# Контракт завершения реализации

Источник требований: PDF «Сервис заявок поддержки», сверенный с docs/10-support-tickets-tz.md.
Уточнения пользователя: при принятии комментарий необязателен; доставка через PostgreSQL outbox; работать только локально, без CI/CD, push, деплоя и изменения production TLS/DNS.

## Уже реализованный контракт

- Go API /api/user/tickets и /api/admin/tickets: GET список, GET /{id}, POST создание только user, POST /{id}/comments {comment}, POST /{id}/status {status,comment}.
- Темы: access, service, other. Статусы: new, in_progress, done.
- Переходы: admin new→in_progress (комментарий необязателен); admin in_progress→done (результат обязателен); user done→in_progress (причина обязательна). Другие переходы 409, неверные поля 400.
- Один пользователь и один администратор, без регистрации и авторизации.
- History хранит автора, время, текст и переход. Завершение с результатом — одно событие.
- Транзакция API сохраняет заявку/history/outbox. Отдельный процесс notifications читает outbox с FOR UPDATE SKIP LOCKED, записывает notifications.items и delivered_at атомарно. UNIQUE(event_id), повтор не меняет read_at.
- GET /api/notifications → {items,unread}, порядок occurred_at DESC,event_id DESC; POST /api/notifications/{id}/read.
- React: /user, /user/new, /user/tickets/:id, /admin, /admin/tickets/:id; polling 2–3 секунды, сохранён components/arc, тема X5.
- frontend/Caddyfile проксирует API, production infra/caddy/Caddyfile не меняется.

## Владение файлами агентов

1. frontend: frontend/src/** (кроме components/**), frontend/index.html, frontend/public/favicon.svg, frontend/vite.config.ts, scripts/check-browser.mjs. Исправить найденные функциональные/адаптивные проблемы и прогнать браузерный сценарий.
2. reliability: backend/** и scripts/check-tickets.py. Проверить атомарность, конкуренцию, replay, восстановление и тесты. Без изменения контрактов без согласования.
3. docs_observability: docs/** кроме этого файла и 10-support-tickets-tz.md; README.md, infra/prometheus/**, отдельный Grafana dashboard. Документировать реальное состояние, добавить метрики существующих /metrics. Не трогать CI/CD/production конфигурацию.
4. Главный агент: Makefile, compose, smoke/status, интеграция, локальные коммиты.

## Приёмка

make up; make test-backend; lint/test/build фронтенда; python3 scripts/check-tickets.py --recovery; headless scripts/check-browser.mjs; smoke существующего мониторинга. Проверить отсутствие изменений components, CI/CD, production Caddy и секретов. Внешние сервисы/сервер не трогать.
