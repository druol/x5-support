# Документация проекта «Орбита» / инфраструктура

> **Если ты AI-агент и попал в этот проект — начни с [`00-ai-context.md`](00-ai-context.md).**
> Там сжатый контекст: что сделано, где что лежит, какие грабли уже собраны.
> Детали — в остальных файлах.

## Что это за проект

| Что | Значение |
|---|---|
| Приложение | Локальная тикетная система: React + Go API + PostgreSQL transactional outbox |
| Исторический стенд | «Орбита» был развёрнут в Yandex Cloud; production состояние после локальной переделки не проверялось |
| CI/CD | Историческая конфигурация сохранена, в рамках локальной переделки не менялась и не проверялась |
| Репозиторий | локальный GitLab CE `http://localhost:8929/root/x5-support-infra` |
| Прод | `https://x5-test-task.ru` (Yandex Cloud ВМ `81.26.180.165`) |

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
2. **Среда разработки и production разведены**: локальный стек поднимается через Compose, production описан в `04-server-production.md`, CI/CD — в `03-cicd.md`.
3. **Секреты не в git**: `.env` на сервере, GitLab CI Variables для деплоя.
4. **Всё, что можно проверить скриптом — проверяется скриптом**: `make status`, `make smoke`, `scripts/*.sh`.
