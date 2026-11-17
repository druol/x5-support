SHELL := /bin/bash
COMPOSE_BASE := docker compose -f docker-compose.yml
COMPOSE_OBS := $(COMPOSE_BASE) -f docker-compose.observability.yml
COMPOSE_PROD := $(COMPOSE_OBS) -f docker-compose.prod.yml

.PHONY: help up core obs prod down ps logs smoke status build gitlab gitlab-down gitlab-bootstrap runner backup reset

help:
	@echo "X5 Support infra:"
	@echo "  make up        core + весь observability-стек"
	@echo "  make core      только app + postgres + redis + экспортеры"
	@echo "  make obs       только наблюдаемость (без app)"
	@echo "  make prod      прод-конфигурация с Caddy и HTTPS (нужен DOMAIN в .env)"
	@echo "  make gitlab    локальный GitLab CE + runner"
	@echo "  make smoke     проверка всех сервисов"
	@echo "  make status    карта сервисов: URL, порты, состояние"
	@echo "  make backup    дамп Postgres в backups/"
	@echo "  make logs      логи всего стека"
	@echo "  make reset     остановить и удалить volumes (ВНИМАНИЕ: данные)"

up:
	$(COMPOSE_OBS) up -d --build

core:
	$(COMPOSE_BASE) up -d --build

obs:
	$(COMPOSE_OBS) up -d --build prometheus alertmanager grafana loki alloy cadvisor node-exporter blackbox-exporter

prod:
	$(COMPOSE_PROD) up -d --build

down:
	$(COMPOSE_OBS) down

ps:
	$(COMPOSE_OBS) ps

logs:
	$(COMPOSE_OBS) logs -f --tail=100

smoke:
	./scripts/smoke.sh

status:
	./scripts/status.sh

build:
	docker compose build app backend notifications

.PHONY: test-backend
test-backend:
	@docker compose -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from tests; result=$$?; docker compose -f docker-compose.test.yml down; exit $$result

.PHONY: test-frontend check-tickets check-recovery check-browser
test-frontend:
	cd frontend && pnpm lint && pnpm test && pnpm build

check-tickets:
	python3 scripts/check-tickets.py

check-recovery:
	python3 scripts/check-tickets.py --recovery

check-browser:
	node scripts/check-browser.mjs

gitlab:
	docker compose -f docker-compose.gitlab.yml up -d

gitlab-bootstrap:
	./scripts/gitlab-bootstrap.sh

gitlab-down:
	docker compose -f docker-compose.gitlab.yml down

runner:
	docker compose -f docker-compose.gitlab.yml up -d gitlab-runner

backup:
	./scripts/backup.sh

reset:
	$(COMPOSE_OBS) down -v
	docker compose -f docker-compose.gitlab.yml down -v 2>/dev/null || true
