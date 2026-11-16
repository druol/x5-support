# 03. CI/CD

## 1. Модель

- **GitLab CE и runner — локально** (Docker, `docker-compose.gitlab.yml`).
- **Сервер — только рантайм и цель деплоя.**
- Runner использует **docker executor** и смонтированный `/var/run/docker.sock`:
  образы приложения собираются на хосте Mac, а не внутри контейнера runner'а.
- Деплой — по SSH: `rsync` кода на сервер + `docker compose up -d --build`.

## 2. Пайплайн

`.gitlab-ci.yml`, стадии по порядку:

```
lint  →  test  →  check  →  build  →  deploy
```

| Стадия | Джоба | Образ | Что делает |
|---|---|---|---|
| `lint` | `lint` | `node:22-alpine` | `pnpm lint` (ESLint 9) + `pnpm typecheck` (tsc) |
| `test` | `test` | `node:22-alpine` | `pnpm test` (Vitest, 5 юнит-тестов) |
| `check` | `check` | `node:22-alpine` | `pnpm build` (Vite), артефакт `frontend/dist` на неделю |
| `build` | `build-image` | `docker:27-cli` | `docker build -t orbita-dashboard:$CI_COMMIT_SHORT_SHA ./frontend` |
| `deploy` | `deploy` | `alpine:3.20` | **manual**: rsync + `docker compose up -d --build` на сервере |

Особенности:

- `lint`/`test`/`check` используют `corepack enable` + `corepack prepare pnpm@9.15.9`.
- `build-image` запускается только на дефолтной ветке (`main`).
- `deploy` — `when: manual`, `environment: production`, `needs: [build-image]`.
- `default.interruptible: true` — новые пайплайны отменяют старые.

## 3. CI/CD-переменные (GitLab → Settings → CI/CD → Variables)

| Переменная | Значение | Тип |
|---|---|---|
| `DEPLOY_HOST` | `84.252.135.15` | env_var |
| `DEPLOY_USER` | `ubuntu` | env_var |
| `DEPLOY_PORT` | `22` | env_var |
| `DEPLOY_PATH` | `/opt/orbita` | env_var |
| `DEPLOY_SSH_KEY` | приватный ключ `orbita-ci` (ed25519, без пароля) | env_var |

Ключ `orbita-ci` добавлен в `~/.ssh/authorized_keys` пользователя `ubuntu` на сервере.
Его публичная часть — на сервере, приватная — только в GitLab.

## 4. Как устроен deploy-джоб

```yaml
before_script:
  - apk add --no-cache openssh-client rsync
  - echo "$DEPLOY_SSH_KEY" > ~/.ssh/id_deploy
  - ssh-keyscan -p ... "$DEPLOY_HOST" >> ~/.ssh/known_hosts
script:
  - rsync -az --delete <excludes> ./ user@host:/opt/orbita/
  - ssh ... "cd /opt/orbita && docker compose <files> up -d --build && docker compose ps"
```

Excludes (важно, чтобы не затереть серверное):
`.git`, `.env`, `node_modules`, `backups`, `dev-scratch`, `frontend/dist`, **`certs`**.

> ⚠️ локальный `infra/caddy/Caddyfile` = production-вариант с HTTPS.
> Если запушить HTTP-вариант (`Caddyfile.http`), деплой перезапишет Caddyfile
> и сайт потеряет HTTPS. См. `05-dns-tls.md`.

## 5. Runner

- Регистрация: `scripts/gitlab-bootstrap.sh` (создаёт root, отключает signup, регистрирует runner).
- Executor: docker, image по умолчанию — `node:22-alpine`.
- Монтирование `/var/run/docker.sock` в контейнер runner'а — чтобы `docker build` работал.
- Клон по внутреннему адресу `http://gitlab:8929/root/orbita-infra.git` (сеть `orbita-gitlab_default`).
- Проверка: `docker exec orbita-gitlab-runner gitlab-runner verify`.

## 6. Как менять пайплайн под новое приложение

1. Добавить код (`apps/frontend`, `apps/backend`).
2. Для каждой части — свои джобы: `lint-frontend`, `test-frontend`, `build-frontend-image`,
   `lint-backend`, `test-backend`, `build-backend-image`.
3. `check` оставить как сборку фронта; для бэкенда — компиляция/тесты.
4. `deploy`: либо остаётся rsync+`up --build` (как сейчас), либо перейти на
   **registry**: собирать образы в CI и `docker compose pull`.
5. При появлении БД — добавить джобу миграций перед деплоем:
   `docker compose run --rm backend migrate`.

Подробный план — [`08-rebuild-ticketing.md`](08-rebuild-ticketing.md).

## 7. Registry (опционально)

Сейчас registry не используется: образ app собирается локально и на сервере.
Если образов станет много или сборка тяжёлой:

- включить **GitLab Container Registry** в локальном GitLab (`gitlab.rb`:
  `registry_external_url`, `registry_nginx`, порт 5050, insecure registry для docker);
- в CI добавить `docker login` + `docker push`;
- на сервере деплой заменить на `docker compose pull && up -d`.

Альтернатива без своего registry — Docker Hub / GHCR (но внешние registry из РФ
могут быть нестабильны, как Docker Hub).

## 8. Проверка пайплайна

```bash
# через API локального GitLab (PAT нужен)
curl -s -H "PRIVATE-TOKEN: $PAT" \
  "http://127.0.0.1:8929/api/v4/projects/1/pipelines" | head

# запустить manual deploy
curl -s -X POST -H "PRIVATE-TOKEN: $PAT" \
  "http://127.0.0.1:8929/api/v4/projects/1/jobs/<job_id>/play"
```

Артефакт `frontend/dist` можно скачать из GitLab и открыть локально — удобно как
офлайн-фолбэк для демо.
