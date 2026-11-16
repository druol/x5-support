# Документация проекта «Орбита» / инфраструктура

> **Если ты AI-агент и попал в этот проект — начни с [`00-ai-context.md`](00-ai-context.md).**
> Там сжатый контекст: что сделано, где что лежит, какие грабли уже собраны.
> Детали — в остальных файлах.

## Что это за проект

| Что | Значение |
|---|---|
| Приложение | «Орбита» — лендинг-дашборд продуктовой команды (Vite 7 + React 19 + TypeScript), статика, отдаётся Caddy |
| Статус | Демо-стенд развёрнут в Yandex Cloud, домен + HTTPS работают |
| Планы | Полностью переделать приложение (тикетная система), инфраструктуру переиспользовать |
| Репозиторий | локальный GitLab CE `http://localhost:8929/root/orbita-infra` |
| Прод | `https://x5-test-task.ru` (Yandex Cloud ВМ `84.252.135.15`) |

## Навигация

| Файл | О чём |
|---|---|
| [`00-ai-context.md`](00-ai-context.md) | **Стартовый контекст для AI**: факты, доступы, команды, грабли |
| [`01-architecture.md`](01-architecture.md) | Компоненты, сети, порты, потоки запросов, volumes |
| [`02-local-dev.md`](02-local-dev.md) | Локальный запуск, Makefile, скрипты, локальный GitLab |
| [`03-cicd.md`](03-cicd.md) | GitLab CI/CD: стадии, джобы, переменные, runner, деплой |
| [`04-server-production.md`](04-server-production.md) | Прод-сервер: ВМ, доступ, каталоги, контейнеры, бэкапы, туннели |
| [`05-dns-tls.md`](05-dns-tls.md) | Домен, DNS-записи, wildcard-сертификат (DNS-01), история с кэшами |
| [`06-observability.md`](06-observability.md) | Prometheus, Grafana, Loki, Alloy, Alertmanager, алерты и дашборды |
| [`07-troubleshooting.md`](07-troubleshooting.md) | Собранные проблемы и их решения (Docker Hub, gcr, npm, DNS-кэш и т.д.) |
| [`08-rebuild-ticketing.md`](08-rebuild-ticketing.md) | Как переделать приложение под тикетную систему, что менять в CI/CD |
| [`09-credentials.local.md`](09-credentials.local.md) | Локальные пароли/токены (**не коммитится**, лежит только на машине) |
| [`10-support-tickets-tz.md`](10-support-tickets-tz.md) | Полный текст тестового задания «Сервис заявок поддержки» |
| [`PROMPT-ASTRA.md`](PROMPT-ASTRA.md) | Готовый промпт для передачи проекта другому AI |
| [`DEMO.md`](DEMO.md) | План демо тимлиду: ссылки, чек-лист, план Б |
| `infra/*.png` | Скриншоты: приложение, Grafana, GitLab, demo-* |

## Быстрые ссылки

| Сервис | Локально | На сервере |
|---|---|---|
| Приложение | http://localhost:8090 | https://x5-test-task.ru |
| Grafana | http://localhost:3000 | SSH-туннель → localhost:3000 |
| Prometheus | http://localhost:9090 | SSH-туннель → localhost:9090 |
| GitLab | http://localhost:8929 | — (только локально) |
| Короткая ссылка-резерв | — | https://clck.ru/3X4WNQ (Cloudflare-туннель) |

## Главные принципы

1. **GitLab и runner живут локально**, сервер — только рантайм и цель деплоя.
2. **Инфраструктура не зависит от приложения**: замена фронтенда/бэкенда не требует переделки сервера, CI-механики и мониторинга (см. `08-rebuild-ticketing.md`).
3. **Секреты не в git**: `.env` на сервере, GitLab CI Variables для деплоя.
4. **Всё, что можно проверить скриптом — проверяется скриптом**: `make status`, `make smoke`, `scripts/*.sh`.
