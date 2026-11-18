# Демо тимлиду — план и ссылки

Дата: 17.11.2026, вечер. Стенд: Yandex Cloud ВМ `81.26.180.165` (Ubuntu 24.04, 4 vCPU / 8 ГБ).

## Ссылки (в порядке приоритета)

| # | Адрес | Когда использовать |
|---|-------|--------------------|
| 1 | **https://next-bandwidth-ctrl-july.trycloudflare.com** (или короткая **https://clck.ru/3X4WNQ**) (короткая: **https://clck.ru/3X4WNQ**) | Основная. Cloudflare-туннель: работает с любой сети (проверено с 8 узлов US/EU/Asia), не зависит от DNS-кэшей |
| 2 | **https://app.x5-test-task.ru** | Домен, wildcard-сертификат. Работает у всех, кто не кэшировал старый DNS |
| 3 | **https://x5-test-task.ru** | Основной домен. У части сетей может ещё отдавать старый парковочный IP из кэша |
| 4 | **http://81.26.180.165/** | Резерв по IP, работает всегда |
| — | **https://begin-estate-then-version.trycloudflare.com** | Grafana: `admin` / `<GRAFANA_ADMIN_PASSWORD>` |

> URL туннелей «одноразовые» и меняются, если контейнер перезапускался.
> Актуальные: `ssh ubuntu@81.26.180.165 'docker logs x5-support-tunnel 2>&1 | grep trycloudflare'`
> Пересоздать оба туннеля: `ssh ubuntu@81.26.180.165 'cd /opt/x5-support && ./deploy/tunnels.sh'`

## Что показать

1. **Приложение** (лендинг-дашборд «Орбита») — основная ссылка.
2. **Grafana** — дашборды `X5 Support / Overview`, `Infra`, `Logs` (через туннель).
3. **GitLab** (локально, только если демо с твоего ноутбука): http://localhost:8929/root/x5-support-infra
   — пайплайн `lint → test → check → build-image → deploy`, runner online, последний пайплайн зелёный.
4. **Инфраструктура:** Docker Compose (core/observability/prod), Prometheus + Alertmanager + Loki + Alloy,
   Postgres/Redis с экспортерами, autoheal, бэкап Postgres по cron, HTTPS wildcard Let's Encrypt (DNS-01).

## Чек-лист за 30 минут до демо

```bash
# 1. Ссылки живые?
curl -s -o /dev/null -w '%{http_code}\n' https://next-bandwidth-ctrl-july.trycloudflare.com/
curl -s -o /dev/null -w '%{http_code}\n' https://app.x5-test-task.ru/
curl -s -o /dev/null -w '%{http_code}\n' http://81.26.180.165/

# 2. Контейнеры
ssh ubuntu@81.26.180.165 'cd /opt/x5-support && docker compose -f docker-compose.yml -f docker-compose.observability.yml -f docker-compose.prod.yml ps'

# 3. Туннели
ssh ubuntu@81.26.180.165 'docker ps --filter name=tunnel --format "{{.Names}} {{.Status}}"'

# 4. Сертификат
echo | openssl s_client -connect 81.26.180.165:443 -servername x5-test-task.ru 2>/dev/null | openssl x509 -noout -dates

# 5. Ресурсы
ssh ubuntu@81.26.180.165 'df -h / | tail -1; free -h | sed -n 2p'
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
| Бэкапы? | cron 03:00, `pg_dump | gzip` в `/opt/x5-support/backups` |
| Что дальше? | Backend/API, авторизация, реальные данные вместо моков |
