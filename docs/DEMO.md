# Демо тимлиду — план и ссылки

Дата: 17.11.2026, вечер. Стенд: Yandex Cloud ВМ `84.252.135.15` (Ubuntu 24.04, 4 vCPU / 8 ГБ).

## Ссылки (в порядке приоритета)

| # | Адрес | Когда использовать |
|---|-------|--------------------|
| 1 | **https://next-bandwidth-ctrl-july.trycloudflare.com** (или короткая **https://clck.ru/3X4WNQ**) (короткая: **https://clck.ru/3X4WNQ**) | Основная. Cloudflare-туннель: работает с любой сети (проверено с 8 узлов US/EU/Asia), не зависит от DNS-кэшей |
| 2 | **https://app.x5-test-task.ru** | Домен, wildcard-сертификат. Работает у всех, кто не кэшировал старый DNS |
| 3 | **https://x5-test-task.ru** | Основной домен. У части сетей может ещё отдавать старый парковочный IP из кэша |
| 4 | **http://84.252.135.15/** | Резерв по IP, работает всегда |
| — | **https://begin-estate-then-version.trycloudflare.com** | Grafana: `admin` / `change-me-before-use` |

> URL туннелей «одноразовые» и меняются, если контейнер перезапускался.
> Актуальные: `ssh ubuntu@84.252.135.15 'docker logs orbita-tunnel 2>&1 | grep trycloudflare'`
> Пересоздать оба туннеля: `ssh ubuntu@84.252.135.15 'cd /opt/orbita && ./deploy/tunnels.sh'`

## Что показать

1. **Приложение** (лендинг-дашборд «Орбита») — основная ссылка.
2. **Grafana** — дашборды `Orbita / Overview`, `Infra`, `Logs` (через туннель).
3. **GitLab** (локально, только если демо с твоего ноутбука): http://localhost:8929/root/orbita-infra
   — пайплайн `lint → test → check → build-image → deploy`, runner online, последний пайплайн зелёный.
4. **Инфраструктура:** Docker Compose (core/observability/prod), Prometheus + Alertmanager + Loki + Alloy,
   Postgres/Redis с экспортерами, autoheal, бэкап Postgres по cron, HTTPS wildcard Let's Encrypt (DNS-01).

## Чек-лист за 30 минут до демо

```bash
# 1. Ссылки живые?
curl -s -o /dev/null -w '%{http_code}\n' https://next-bandwidth-ctrl-july.trycloudflare.com/
curl -s -o /dev/null -w '%{http_code}\n' https://app.x5-test-task.ru/
curl -s -o /dev/null -w '%{http_code}\n' http://84.252.135.15/

# 2. Контейнеры
ssh ubuntu@84.252.135.15 'cd /opt/orbita && docker compose -f docker-compose.yml -f docker-compose.observability.yml -f docker-compose.prod.yml ps'

# 3. Туннели
ssh ubuntu@84.252.135.15 'docker ps --filter name=tunnel --format "{{.Names}} {{.Status}}"'

# 4. Сертификат
echo | openssl s_client -connect 84.252.135.15:443 -servername x5-test-task.ru 2>/dev/null | openssl x509 -noout -dates

# 5. Ресурсы
ssh ubuntu@84.252.135.15 'df -h / | tail -1; free -h | sed -n 2p'
```

Если туннель «отвалился» — пересоздать: `./deploy/tunnels.sh` на сервере, взять новые URL.

## План Б (если интернет/сеть подведёт)

- Скриншоты всех экранов: `docs/infra/demo-1-hero.png`, `demo-2-section.png`, `demo-3-section.png`, `demo-full.png`.
- Приложение — статический SPA: можно открыть локально из `frontend/dist` после `pnpm build`.
- Grafana-дашборды тоже имеют скриншоты: `docs/infra/grafana-*.png`.

## Вероятные вопросы тимлида

| Вопрос | Ответ |
|---|---|
| Где хостится? | Yandex Cloud, ВМ 4 vCPU / 8 ГБ, Ubuntu 24.04, Docker Compose |
| Как деплоится? | GitLab CI (локальный runner): lint → vitest → build → docker build → ручной deploy по SSH |
| Есть ли HTTPS? | Да, Let's Encrypt wildcard `*.x5-test-task.ru` через DNS-01 (HTTP-01 не проходит из-за блокировки входящих из-за рубежа) |
| Мониторинг? | Prometheus (10/10 целей), Grafana, Loki+Alloy, Alertmanager |
| Бэкапы? | cron 03:00, `pg_dump | gzip` в `/opt/orbita/backups` |
| Что дальше? | Backend/API, авторизация, реальные данные вместо моков |
