# 00. Стартовый контекст для AI-агента

> Прочитай этот файл целиком, прежде чем что-то менять. Здесь факты о текущем
> состоянии стенда, доступы, команды и уже собранные грабли.

## 1. Что происходит в проекте

Пользователь вайб-кодит тестовое задание для X5 (админ-панель / аналитика).
Сначала был сделан лендинг-дашборд «Орбита» (папка `frontend/`), под него — полная
инфраструктура: Docker Compose, Postgres, Redis, Prometheus, Grafana, Loki, GitLab CI,
деплой в Yandex Cloud, домен и HTTPS.

**Локальное приложение уже переписано в тикетную систему:** React-клиент, Go API,
PostgreSQL и отдельный процесс доставки уведомлений через transactional outbox.
Исторический production deployment и CI/CD не обновлялись и в этой работе не
проверялись; этот репозиторий описывает локальную реализацию.

## 2. Текущее состояние (локальная разработка, 17.11.2026)

| Компонент | Статус |
|---|---|
| Локальный тикетный стек (React + Go API + PostgreSQL outbox + notifications + observability) | ✅ проверен локально |
| GitLab CE + runner локально | исторический статус; сейчас не проверялся |
| CI/CD пайплайн | историческая конфигурация; не менялась и не проверялась для тикетной системы |
| Прод-сервер Yandex Cloud | исторический deployment; состояние не проверялось |
| Домен `x5-test-task.ru` | историческая DNS/TLS конфигурация; не проверялась |
| Cloudflare-туннели (резерв) | историческая настройка; не проверялась |

## 3. Адреса

| Что | Адрес |
|---|---|
| Прод (домен) | **https://x5-test-task.ru** |
| Прод (поддомен) | https://app.x5-test-task.ru |
| Прод (резерв по IP) | http://84.252.135.15/ |
| Прод (туннель, работает везде) | https://next-bandwidth-ctrl-july.trycloudflare.com |
| Короткая ссылка на туннель | https://clck.ru/3X4WNQ |
| Grafana (туннель) | https://begin-estate-then-version.trycloudflare.com |
| Локальное приложение | http://localhost:8090 |
| Локальная Grafana | http://localhost:3000 |
| Локальный GitLab | http://localhost:8929 |

## 4. Где что лежит

```
uiarc-dashboard/
├── frontend/                  # приложение (Vite + React + TS), Dockerfile → Caddy
├── docker-compose.yml         # core: app, postgres, redis, экспортеры
├── docker-compose.observability.yml  # prometheus, grafana, loki, alloy, alertmanager, ...
├── docker-compose.prod.yml    # Caddy edge (80/443), приложение только 127.0.0.1
├── docker-compose.gitlab.yml  # локальный GitLab CE + runner (отдельный compose-проект)
├── .gitlab-ci.yml             # пайплайн
├── infra/                     # конфиги Prometheus, Grafana, Loki, Alloy, Caddy, Postgres
├── scripts/                   # smoke, status, backup, deploy, gitlab-bootstrap
├── deploy/                    # cloud-init, bootstrap сервера, HTTPS, туннели, DoH-профиль
├── docs/                      # эта документация + скриншоты
├── Makefile                   # команды для локальной работы
├── .env / .env.example        # локальные секреты и шаблон
├── README-INFRA.md            # подробный «старый» справочник по инфраструктуре
└── .deploy.env                # параметры деплоя с Mac (в .gitignore)
```

Исторически production код размещался в `/opt/orbita`. Локальная переделка тикетной
системы на сервер не выкладывалась, production состояние здесь не проверялось.

## 5. Доступы (где брать, не хардкодить)

- **Сервер**: `ssh -i ~/.ssh/orbita ubuntu@84.252.135.15`
  Ключ с passphrase — сначала `ssh-add ~/.ssh/orbita` (или используй ssh-agent).
- **GitLab root**: `root` / `GITLAB_ROOT_PASSWORD` из `.env` (см. `09-credentials.local.md`).
- **GitLab PAT** для API: лежит в локальном файле/чате, не публикуй.
- **Grafana на сервере**: `admin` / `GRAFANA_ADMIN_PASSWORD` из `/opt/orbita/.env`.
- **CI-переменные деплоя**: GitLab → Settings → CI/CD → Variables
  (`DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_PORT`, `DEPLOY_PATH`, `DEPLOY_SSH_KEY`).

Реальные значения — в [`09-credentials.local.md`](09-credentials.local.md) (файл в `.gitignore`).

## 6. Сервер (кратко)

| Параметр | Значение |
|---|---|
| Провайдер | Yandex Cloud, зона `ru-central1-d` |
| ВМ | 4 vCPU / 8 GiB RAM / 50 GiB SSD, Ubuntu 24.04 |
| Публичный IP | `84.252.135.15` (динамический) |
| instance id | `fv48icm39f5qhc32a7jk` |
| Security Group | `orbita-sg-sec` (вход 22/80/443, выход любой) |
| Каталог | `/opt/orbita` |
| Docker / Compose | 29.1.3 / 2.40.3 |
| Домены | `x5-test-task.ru`, `www`, `app` → A на IP |
| TLS | wildcard `*.x5-test-task.ru`, Let's Encrypt, DNS-01, до 14.02.2027 |

## 7. Что важно знать сразу (грабли)

1. **Docker Hub из РФ нестабилен** → на сервере настроено зеркало `https://dockerproxy.net/`
   в `/etc/docker/daemon.json`. Если pull снова падает — проверь зеркало/сеть.
2. **gcr.io заблокирован** → `cadvisor` отключён (профиль `cadvisor`), метрики контейнеров
   отсутствуют. Включать только при наличии доступного образа amd64.
3. **npm registry недоступен с сервера** → в `frontend/Dockerfile` задан
   `NPM_REGISTRY=https://registry.npmmirror.com`.
4. **Входящие соединения из-за рубежа до ВМ не доходят** → HTTP-01 Let's Encrypt невозможен,
   используется DNS-01 (TXT-записи). По этой же причине Cloudflare прокси (оранжевая тучка)
   для A-записей не включить — origin будет недоступен.
5. **Домашний провайдер пользователя подменяет UDP DNS** (порт 53) и отдаёт старый кэш.
   DoH/DoT работает. Отсюда «то открывается, то парковка» — это не сервер.
6. **PASS-фраза SSH-ключа**: `~/.ssh/orbita` зашифрован, для CI создан отдельный
   ключ `orbita-ci` без пароля (его private лежит в CI-переменной).
7. **Caddyfile на сервере = production (HTTPS)**: локальный `infra/caddy/Caddyfile`
   синхронизирован с ним; `Caddyfile.http` — резервный HTTP-вариант. Деплой rsync
   перезаписывает Caddyfile — не сломай HTTPS.
8. **Туннели Cloudflare** — quick tunnels, URL меняются при перезапуске контейнера.
   Актуальные: `docker logs orbita-tunnel | grep trycloudflare` или `deploy/tunnels.sh`.

Подробнее — [`07-troubleshooting.md`](07-troubleshooting.md).

## 8. Быстрые команды

```bash
# локально
make up            # core + observability
make status        # карта сервисов
make smoke         # проверка health
make gitlab        # поднять локальный GitLab
make backup        # дамп Postgres

# сервер
ssh -i ~/.ssh/orbita ubuntu@84.252.135.15
cd /opt/orbita && docker compose \
  -f docker-compose.yml -f docker-compose.observability.yml -f docker-compose.prod.yml ps

# CI/CD не менялся и в рамках локальной переделки не проверялся.
```

## 9. Правила работы (унаследованы от пользователя)

- Пользователь нетерпелив, любит результат и конкретику, не любит долгие объяснения.
- Менять по одному шагу, проверять результат, не валить 50 ошибок сразу.
- Всё, что можно автоматизировать — автоматизировать (скрипты, CI, Makefile).
- Секреты — только в `.env`/CI Variables, не в коде.
- UI должен выглядеть как бренд X5 (светлая тема, тёмно-зелёный + лайм), но это
  уже про новое приложение.
