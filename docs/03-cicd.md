# 03. CI/CD

## 1. Модель

- **GitLab CE и runner — локально** (`docker-compose.gitlab.yml`), проект `root/x5-support-infra`.
- **Сервер — цель деплоя**; приложение на нём не собирается из GitLab-образов,
  а пересобирается через `docker compose up -d --build` по SSH.
- Runner — docker executor с `/var/run/docker.sock`: `docker build` идёт на хосте Mac.
- Деплой — rsync кода + compose на сервере. Серверный `.env` не перезаписывается.

## 2. Пайплайн

`.gitlab-ci.yml`: `validate → test → build → deploy`.

| Стадия | Джоба | Образ | Что проверяет/делает |
|---|---|---|---|
| validate | `frontend-lint` | node:22-alpine | ESLint + `tsc --noEmit` |
| validate | `backend-lint` | golang:1.25-alpine | `gofmt -l`, `go vet ./...` |
| validate | `compose-validate` | docker:27-cli | `docker compose config -q` для base + observability + prod |
| test | `frontend-test` | node:22-alpine | Vitest: api + domain-хелперы заявок |
| test | `backend-test` | golang:1.25-alpine | unit-тесты store/httpapi |
| test | `backend-integration` | golang:1.25-alpine + `postgres:16-alpine` service | полный сценарий, outbox, восстановление, дубли, гонки |
| build | `frontend-build` | node:22-alpine | Vite production build, артефакт `frontend/dist` |
| build | `build-app` | docker:27-cli | образ `x5-support-app:$CI_COMMIT_SHORT_SHA` |
| build | `build-api` | docker:27-cli | образ `x5-support-api:$CI_COMMIT_SHORT_SHA` |
| deploy | `deploy` | alpine:3.20 | **manual**: rsync → `docker compose up -d --build --remove-orphans` → `/healthz` |

Особенности:

- pnpm 9.15.9 через corepack, store кэшируется по `frontend/pnpm-lock.yaml`.
- Go-модули кэшируются по `backend/go.sum`, `GOCACHE` — в `.go-cache`.
- `build-*` запускаются только после зелёных тестов соответствующих частей.
- `deploy` — только для `main`, `environment: production/x5-support`.
- `default.interruptible: true`.

## 3. Переменные GitLab

| Переменная | Значение |
|---|---|
| `DEPLOY_HOST` | `81.26.180.165` |
| `DEPLOY_USER` | `ubuntu` |
| `DEPLOY_PORT` | `22` |
| `DEPLOY_PATH` | `/opt/x5-support` |
| `DEPLOY_SSH_KEY` | приватный ed25519-ключ деплоя (masked) |

Серверный `.env` (`POSTGRES_PASSWORD`, `GRAFANA_ADMIN_PASSWORD`, `DOMAIN`, `ACME_EMAIL`)
хранится только на сервере и rsync-ом не перезаписывается.

## 4. Деплой

Образы собираются в CI под `linux/amd64`, сохраняются в `api-image.tar.gz` /
`app-image.tar.gz` и передаются на сервер через `scp` + `docker load`.
Сервер **не собирает образы** и не зависит от Docker Hub.

```bash
# build-api / build-app
docker build -t x5-support-api:local ./backend
docker save x5-support-api:local | gzip > api-image.tar.gz

# deploy
scp api-image.tar.gz app-image.tar.gz ubuntu@host:/tmp/
ssh ubuntu@host "docker load -i /tmp/api-image.tar.gz && docker load -i /tmp/app-image.tar.gz"
rsync -az --delete ... ./ ubuntu@host:/opt/x5-support/
ssh ubuntu@host "cd /opt/x5-support && docker compose \
  -f docker-compose.yml -f docker-compose.observability.yml -f docker-compose.prod.yml \
  up -d --remove-orphans && docker compose ps"
ssh ubuntu@host "curl -fsS http://127.0.0.1:8080/healthz"
```

Исключения rsync: `.git`, `.env`, `node_modules`, `backups`, `dev-scratch`,
`frontend/dist`, `certs`, `.pnpm-store`, `.go-cache`, `*-image.tar.gz`.

> На сервере Docker Hub через `dockerproxy.net` может быть недоступен.
> Поэтому база образов (caddy, postgres, exporters) уже загружена,
> а API/UI приезжают готовыми linux/amd64-образами из CI.

## 5. Runner

- Регистрация: `scripts/gitlab-bootstrap.sh`.
- Executor: docker, привилегированный, с `/var/run/docker.sock`.
- Внутренний клон: `http://gitlab:8929/root/x5-support-infra.git`.
- Проверка: `docker exec x5-support-gitlab-runner gitlab-runner verify`.

## 6. Локальная проверка без GitLab

```bash
pnpm --dir frontend lint && pnpm --dir frontend typecheck && pnpm --dir frontend test
cd backend && test -z "$(gofmt -l .)" && go vet ./... && go test ./...
docker compose -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from tests
python3 scripts/check-tickets.py
```

## 7. Registry (опционально)

Сейчас registry не используется: образы собираются в CI как проверка Dockerfile,
а на сервере пересобираются локально. При росте проекта — включить GitLab Container
Registry, `docker login/push` в CI и `docker compose pull` в деплое.
