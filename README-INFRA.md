# X5 Support — инфраструктура

> 📚 Полный handover для людей и AI-агентов: [`docs/`](docs/README.md)
> (начинать с [`docs/00-ai-context.md`](docs/00-ai-context.md)).

Локальный, полностью переносимый на сервер стек для проекта `uiarc-dashboard`
(«Орбита — диспетчерская продуктовой команды»): контейнеры, базы, наблюдаемость,
GitLab и CI/CD.

Всё описано кодом — никаких ручных настроек в контейнерах. Достаточно скопировать
репозиторий и выполнить `make up`.

---

## 0. Развёрнутый сервер (актуально)

| Что | Значение |
| --- | --- |
| Приложение | **http://81.26.180.165/** |
| SSH | `ssh -i ~/.ssh/x5-support ubuntu@81.26.180.165` (ключ в ssh-agent) |
| Каталог | `/opt/x5-support` |
| Grafana | `ssh -N -L 3000:127.0.0.1:3000 ubuntu@81.26.180.165` → http://localhost:3000 |
| Prometheus | `ssh -N -L 9090:127.0.0.1:9090 ubuntu@81.26.180.165` → http://localhost:9090 |
| Grafana admin | `admin` / пароль из `/opt/x5-support/.env` (`GRAFANA_ADMIN_PASSWORD`) |
| Деплой с Mac | `./scripts/deploy.sh` (настройки в `.deploy.env`) |

**Особенности этого сервера (РФ, Yandex Cloud):**

- **HTTPS не включён**: Let's Encrypt не может достучаться до ВМ (входящие из-за рубежа
  фильтруются), поэтому Caddy работает в режиме `auto_https off` на `:80`.
  Когда появится домен и внешний доступ — вернуть TLS одним изменением Caddyfile.
- **Docker Hub нестабилен** — в `/etc/docker/daemon.json` прописано зеркало
  `https://dockerproxy.net/`.
- **npm registry недоступен** — в `frontend/Dockerfile` используется
  `NPM_REGISTRY=https://registry.npmmirror.com`.
- **cAdvisor отключён** (образ только на `gcr.io`, он блокируется; плюс перенос с Mac
  дал arm64-образ). Сервис спрятан в профиль `cadvisor`, включается вручную.
- **Grafana/Prometheus слушают только 127.0.0.1** — доступ через SSH-туннель.

## 0.1. Включение HTTPS (когда домен указывает на сервер)

Из-за фильтрации входящих из-за рубежа HTTP-01 не работает, поэтому используется **DNS-01**:
сертификат подтверждается TXT-записью, входящие соединения не нужны.

```bash
ssh -i ~/.ssh/x5-support ubuntu@81.26.180.165
cd /opt/x5-support
sudo ./deploy/enable-https.sh x5-test-task.ru admin@x5-test-task.ru
```

Скрипт:
1. запускает certbot (`--manual --preferred-challenges dns`) и печатает TXT-записи;
2. вы добавляете их в reg.ru: имя `_acme-challenge`, значение из вывода (для apex и www — две записи с одним именем);
3. проверяете `dig +short TXT _acme-challenge.x5-test-task.ru`, жмёте Enter;
4. скрипт копирует `Caddyfile.https`, монтирует `./certs` и перезапускает Caddy.

Проверка:

```bash
curl -I https://x5-test-task.ru/
```

Сертификат живёт 90 дней; продление — повторить скрипт (напоминание можно повесить в cron).

## 1. Схема

```
┌─ ЛОКАЛЬНО (Mac) ──────────────────────┐     ┌─ СЕРВЕР (VPS) ───────────────────┐
│ GitLab CE + runner                    │     │ app + postgres + redis           │
│  check → build → deploy (manual)      │────▶│ observability (Prometheus,        │
│  rsync по SSH                         │ SSH │ Grafana, Loki, Alloy, exporters) │
└───────────────────────────────────────┘     │ Caddy :80/:443 + HTTPS           │
                                              └──────────────────────────────────┘

                        ┌──────────────────────────────┐
   Браузер ── :8080 ───▶│ app: Caddy + статика (SPA)   │──┐
                        └──────────────────────────────┘  │ метрики
   ┌──────────────────────────────────────────────────┐   │
   │ monitoring network                               │   │
   │  Prometheus ◀── app:2019, cadvisor, node-exporter│◀──┘
   │      │            postgres/redis-exporter,       │
   │      │            blackbox, loki, grafana        │
   │      ├──▶ Alertmanager                           │
   │      └──▶ Grafana ◀── Loki ◀── Alloy ◀ docker.sock│
   └──────────────────────────────────────────────────┘

   app ──▶ Postgres 16        app ──▶ Redis 7
        (публикация в БД — на будущее API)
```

- **app** — многоступенчатая сборка: `node:22` + pnpm → статика → `caddy:2-alpine`.
  Caddy отдаёт SPA, `/healthz` и метрики на `:2019`.
- **Postgres / Redis** — готовы под будущий API; сейчас приложение статичное.
- **Наблюдаемость** — отдельным compose-файлом, включает и выключается независимо.

## 2. Порты и доступы

| Сервис | URL | Логин / пароль (из `.env`) |
| --- | --- | --- |
| Приложение | http://localhost:8090 | — |
| Grafana | http://localhost:3000 | `admin` / `x5_admin` |
| Prometheus | http://localhost:9090 | — |
| Alertmanager | http://localhost:9093 | — |
| Loki (API) | http://localhost:3100 | — |
| Alloy UI | http://localhost:12345 | — |
| Jaeger (профиль tracing) | http://localhost:16686 | — |
| Postgres | `localhost:55432` | `x5-support` / `x5_local_password` |
| Redis | `localhost:6379` | без пароля (только localhost) |
| GitLab | http://localhost:8929 | `root` / `<GITLAB_ROOT_PASSWORD>` |
| GitLab SSH | `ssh://git@localhost:2222` | — |

Все порты по умолчанию слушают **только 127.0.0.1**. Чтобы открыть в локальной сети —
поставьте `BIND_ADDR=0.0.0.0` в `.env`.

## 3. Быстрый старт

```bash
cp .env.example .env      # поменяйте пароли (обязательно перед сервером)
make up                   # сборка образа + запуск всех контейнеров
make smoke                # проверить все сервисы
```

Остановить: `make down`. Удалить вместе с данными: `make reset`.

**Проверить, что всё живо, и увидеть карту сервисов:**

```bash
make status     # таблица: сервис → URL → статус, порты, GitLab
make smoke      # подробная проверка + цели Prometheus
```


Дальше:

- Grafana → **Dashboards → X5 Support** — три готовых дашборда: Overview, Infrastructure, Logs;
- Prometheus → **Status → Targets** — все цели должны быть `UP`;
- логи приложения — в Grafana → X5 Support · Logs.

## 4. Наблюдаемость: что собирается

| Источник | Метрики | Дашборд |
| --- | --- | --- |
| Caddy (app) | запросы, коды ответов, латентность | Overview |
| cAdvisor | CPU/память/сеть контейнеров | Overview, Infrastructure |
| node-exporter | CPU/память/диск/сеть хоста | Infrastructure |
| postgres-exporter | соединения, размер БД, аптайм | Overview |
| redis-exporter | команды, клиенты, память | Overview |
| blackbox-exporter | доступность приложения и Grafana «как пользователь» | Overview |
| Loki + Alloy | stdout/stderr всех контейнеров | Logs |
| Prometheus | здоровье самих скрейп-целей | Overview |

**Алерты** (`infra/prometheus/rules/alerts.yml`): TargetDown, HttpProbeFailing,
PostgresDown, RedisDown, HighErrorRate (>5% 5xx), AppLatencyHigh (p95 > 500 мс),
ContainerMemoryHigh (>90% лимита), DiskSpaceLow (<15%).

Получатель алертов по умолчанию — заглушка. Реальные каналы (webhook, email, Telegram)
включаются в `infra/alertmanager/alertmanager.yml` (там готовые заготовки).

**Профиль tracing.** Jaeger поднимается по желанию:

```bash
docker compose -f docker-compose.yml -f docker-compose.observability.yml --profile tracing up -d
```

OTLP-эндпоинты: `localhost:4317` (gRPC) и `localhost:4318` (HTTP). Подключайте SDK,
когда появится API.

## 5. GitLab и CI/CD

GitLab запускается **отдельным compose-проектом**, чтобы не занимать память постоянно:

```bash
make gitlab                  # первый старт 3–5 минут, ~5 ГБ RAM
make gitlab-bootstrap        # создаёт root-админа и закрывает регистрацию
make gitlab-down             # остановить
```

| Что | Значение |
| --- | --- |
| Web UI | http://localhost:8929 |
| Логин / пароль | `root` / `<GITLAB_ROOT_PASSWORD>` (из `.env` → `GITLAB_ROOT_PASSWORD`) |
| SSH-клонирование | `ssh://git@localhost:2222/<group>/<project>.git` |
| Проект | http://localhost:8929/root/x5-support-infra |
| Runner | `local-docker`, Docker executor, зарегистрирован и online |
| Пайплайн | `.gitlab-ci.yml`, последний прогон — **success** |

### Репозиторий и первый пуш

Проект и репозиторий уже созданы. Если нужно подключить существующую папку:

```bash
git init -b main
git add -A && git commit -m "initial"
git remote add origin http://oauth2:<TOKEN>@localhost:8929/root/x5-support-infra.git
git push -u origin main
```

Токен создаётся в GitLab: **Preferences → Access tokens** (scopes: `api`, `write_repository`),
либо через `scripts/gitlab-bootstrap.sh`.

### Runner

Уже зарегистрирован (instance runner). Конфиг — в volume `x5-support-gitlab_runner-config`.
Ключевые параметры:

- URL и `--clone-url` → `http://gitlab:8929` (внутри docker-сети);
- сеть job-контейнеров → `x5-support-gitlab_default`;
- смонтирован `/var/run/docker.sock` (для шага сборки образа).

Перерегистрировать runner (новый токен из **Admin Area → CI/CD → Runners**):

```bash
docker exec -it x5-support-gitlab-runner gitlab-runner register \
  --non-interactive --url "http://gitlab:8929" --clone-url "http://gitlab:8929" \
  --token "<RUNNER_TOKEN>" --executor docker --docker-image alpine:3.20 \
  --docker-network-mode x5-support-gitlab_default \
  --docker-volumes /var/run/docker.sock:/var/run/docker.sock \
  --docker-pull-policy if-not-present --description local-docker
```

### Пайплайн

| Стадия | Что делает | Статус |
| --- | --- | --- |
| `check` | `pnpm install --frozen-lockfile` + `pnpm build` (типы + сборка) | ✅ |
| `build-image` | `docker build ./frontend` через docker.sock, без registry | ✅ |
| `deploy` | ручной шаг, заготовка SSH-деплоя | ⏸ manual |

Пайплайн запускается на каждый пуш в `main`. Для деплоя добавьте в
**Settings → CI/CD → Variables**: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`
и раскомментируйте команды в `.gitlab-ci.yml`.

> ⚠️ На Apple Silicon образ GitLab CE (`linux/amd64`) работает через Rosetta:
> первый старт ~5 минут, ~2.5 ГБ RAM. На x86-сервере — быстрее и нативно.

## 6. Структура

```
uiarc-dashboard/
├── frontend/                       # React + Vite приложение
│   ├── src/                        # компоненты и стили
│   ├── public/
│   ├── index.html
│   ├── package.json
│   ├── pnpm-lock.yaml
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── Caddyfile                   # статика + /healthz + метрики
│   └── Dockerfile                  # multi-stage: pnpm build → Caddy
├── docker-compose.yml              # core: app, postgres, redis, экспортеры
├── docker-compose.observability.yml# Prometheus, Grafana, Loki, Alloy, cAdvisor…
├── docker-compose.prod.yml         # Caddy 80/443 + HTTPS для сервера
├── docker-compose.gitlab.yml       # GitLab CE + runner (отдельный проект)
├── .gitlab-ci.yml                  # check → build-image → deploy
├── .env.example
├── Makefile
├── scripts/
│   ├── smoke.sh                    # проверка стека
│   └── backup.sh                   # дамп Postgres + ротация
├── dev-scratch/                    # локальные эксперименты (не в git)
└── infra/
    ├── caddy/Caddyfile             # edge-прокси с TLS (прод)
    ├── prometheus/                 # конфиг скрейпа + правила алертов
    ├── alertmanager/
    ├── blackbox/
    ├── loki/
    ├── alloy/
    ├── grafana/provisioning/       # datasources + dashboards (as code)
    ├── grafana/dashboards/*.json
    └── postgres/init/01-init.sql
```

## 7. Секреты

- Все пароли — в `.env` (не коммитится, есть в `.gitignore`).
- Перед публикацией на сервере поменяйте: `POSTGRES_PASSWORD`, `GRAFANA_ADMIN_PASSWORD`,
  `GITLAB_ROOT_PASSWORD`; сгенерируйте: `openssl rand -hex 24`.
- Grafana и Prometheus не имеют публичного доступа: в прод-профиле наружу смотрит только
  Caddy на 80/443. Для Grafana сделайте отдельный поддомен и basic-auth, когда понадобится.

## 8. Модель деплоя: GitLab локально, сервер — только рантайм

Это нормальная схема для одного разработчика и небольшого проекта:

- **Плюсы:** сервер не тратит 4–5 ГБ на GitLab; меньше поверхность атаки; CI гоняется
  на твоём железе; сервер — чистый рантайм (app + БД + наблюдаемость).
- **Минусы:** деплой зависит от включённого Mac; GitLab недоступен снаружи (это плюс
  для безопасности, но нельзя пушить с другой машины без туннеля/VPN).
- **Обязательно:** git-репозиторий стоит продублировать (GitHub/внешний remote), чтобы
  код не жил в одном месте.

### Один раз подготовить сервер

```bash
# пользователь деплоя
sudo adduser --disabled-password --gecos "" deploy
sudo usermod -aG docker deploy
sudo mkdir -p /opt/x5-support && sudo chown deploy:deploy /opt/x5-support

# ключ для деплоя (на Mac)
ssh-keygen -t ed25519 -f ~/.ssh/x5_deploy -C "x5-support-deploy"
ssh-copy-id -i ~/.ssh/x5_deploy.pub deploy@SERVER_IP
```

Секреты на сервере создаются **один раз** вручную — деплой их не перезаписывает:

```bash
ssh deploy@SERVER_IP
cd /opt/x5-support && cp .env.example .env && nano .env   # пароли + DOMAIN + ACME_EMAIL
```

### Деплой из GitLab

Добавьте в **Settings → CI/CD → Variables** (protected + masked для ключа):

| Переменная | Значение |
| --- | --- |
| `DEPLOY_HOST` | IP или домен сервера |
| `DEPLOY_USER` | `deploy` |
| `DEPLOY_PORT` | `22` |
| `DEPLOY_PATH` | `/opt/x5-support` |
| `DEPLOY_SSH_KEY` | содержимое `~/.ssh/x5_deploy` (приватный ключ) |

Затем в пайплайне нажимаете **deploy** (он manual). Джоба делает `rsync` кода на сервер
(без `.env`, `.git`, `node_modules`) и запускает `docker compose ... -f docker-compose.prod.yml up -d --build`.

### Деплой без GitLab (с Mac)

```bash
cp .deploy.env.example .deploy.env   # заполнить host/user/ключ
./scripts/deploy.sh
```

## 9. Переезд на сервер

Нужен VPS: **2 vCPU / 4 ГБ RAM / 40 ГБ SSD** минимум (без GitLab), **4 vCPU / 8 ГБ / 80 ГБ**
если GitLab будет жить там же. Docker + Docker Compose plugin.

```bash
# 1. На сервере: пользователь, Docker, firewall
sudo apt update && sudo apt install -y docker.io docker-compose-v2 git ufw
sudo usermod -aG docker $USER
sudo ufw allow 22,80,443/tcp && sudo ufw enable

# 2. Код
git clone <repo> /opt/x5-support && cd /opt/x5-support

# 3. Конфиг
cp .env.example .env && nano .env      # пароли, DOMAIN, ACME_EMAIL
# BIND_ADDR=127.0.0.1 оставить: наружу смотрит Caddy

# 4. Домен: A-запись example.ru → IP сервера (и www, если нужно)

# 5. Запуск
docker compose -f docker-compose.yml -f docker-compose.observability.yml \
  -f docker-compose.prod.yml up -d --build

# 6. Проверка
curl -fsS https://example.ru/healthz
```

Caddy сам получит сертификат Let's Encrypt (нужны открытые 80/443 и корректная A-запись).

**Как доставить код на сервер.** Локальный GitLab доступен только на `127.0.0.1`, поэтому:

```bash
# вариант 1 — rsync без мусора
rsync -av --exclude node_modules --exclude .git --exclude .env \
  ./ user@SERVER_IP:/opt/x5-support/

# вариант 2 — запушить в GitLab, который доступен серверу (или в GitHub), и git clone на сервере
```

**Чек-лист перед публикацией:**

- [ ] `.env` создан, все пароли заменены (`POSTGRES_PASSWORD`, `GRAFANA_ADMIN_PASSWORD`, `GITLAB_ROOT_PASSWORD`)
- [ ] `DOMAIN` и `ACME_EMAIL` заполнены
- [ ] A-запись домена указывает на IP сервера
- [ ] открыты только 22/80/443 (`ufw`)
- [ ] `BIND_ADDR=127.0.0.1` — приложение и БД не торчат наружу
- [ ] `docker compose ... -f docker-compose.prod.yml config -q` проходит
- [ ] `https://DOMAIN/healthz` отвечает `ok`
- [ ] Grafana/Prometheus доступны только через SSH-туннель или отдельный защищённый поддомен
- [ ] настроен `make backup` по cron и выгрузка дампов за пределы сервера

**Доступ к мониторингу на сервере** (наружу не публикуем):

```bash
ssh -N -L 3000:127.0.0.1:3000 -L 9090:127.0.0.1:9090 user@SERVER_IP
# затем http://localhost:3000 и http://localhost:9090
```

**Порядок для слабого сервера:** сначала core+obs, GitLab — на отдельной машине или
локально (он требует ~5 ГБ RAM и 4+ ГБ диска).

## 10. Обслуживание

```bash
make backup        # pg_dump в backups/ (хранится 7 дней)
make logs          # логи всего стека
docker compose -f docker-compose.yml -f docker-compose.observability.yml pull
docker compose -f docker-compose.yml -f docker-compose.observability.yml up -d
```

Бэкап стоит вынести за пределы машины: cron + `rclone`/`scp` в S3 или на другой сервер.
Для Grafana полезна настройка `GF_BACKUP_...` — но проще хранить дашборды в git (они уже
провижинятся из JSON).

## 11. Troubleshooting

| Симптом | Причина / решение |
| --- | --- |
| `port is already allocated` | занят 8080/3000/9090 — поменяйте порт в `.env` |
| Grafana пустая, дашбордов нет | проверьте `docker compose logs grafana`, путь `/var/lib/grafana/dashboards` |
| Prometheus target `DOWN` | `docker compose logs <service>`; проверьте сеть `monitoring` |
| cAdvisor падает на macOS | Docker Desktop даёт урезанный `/var/lib/docker`; на Linux-сервере работает полноценно |
| node-exporter показывает «чужой» хост | на macOS это Linux-VM Docker Desktop, а не macOS — это нормально |
| GitLab не стартует / OOM | нужно ≥5 ГБ свободной памяти Docker; `make down` перед `make gitlab` |
| Логи не появляются в Loki | проверьте `docker compose logs alloy`, доступ к `/var/run/docker.sock` |
| Сертификат не выдаётся | DNS ещё не разошёлся, закрыт 80/443, или `DOMAIN` не совпадает с A-записью |

## 12. Что дальше

1. **API-сервис** (Go/Node) в этом же compose: подключить к Postgres/Redis, добавить
   `/metrics` и OTLP-трейсинг в Jaeger.
2. **Алерты в Telegram** — 10 строк в `alertmanager.yml`.
3. **Grafana за доменом** — поддомен `grafana.example.ru` + basic-auth в Caddy.
4. **Бэкапы в S3** — cron + rclone, проверка восстановления раз в месяц.
5. **GitLab Runner на сервере** вместо локального — тогда CI деплоит сам.
