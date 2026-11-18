# 07. Troubleshooting

Собраны реальные проблемы этого проекта и их решения. Если что-то «не работает» —
сначала сверься с этим файлом.

## Инфраструктура и Docker

### Docker Hub не пуллит образы (i/o timeout)
Симптом: `failed to resolve reference "docker.io/...": i/o timeout`, при этом curl до
registry иногда работает.

Причина: Docker Hub из РФ нестабилен/блокируется; разные IP могут отваливаться.

Решение (уже применено на сервере):
```bash
echo '{"registry-mirrors":["https://dockerproxy.net"]}' | sudo tee /etc/docker/daemon.json
sudo systemctl restart docker
```
Альтернатива: `docker save | gzip | ssh host 'gunzip | docker load'` с машины, где
интернет работает.

### `gcr.io` недоступен → контейнерные метрики
Симптом: `failed to resolve reference "gcr.io/cadvisor/cadvisor"`.

Решение: cAdvisor не используется; CPU/память контейнеров отдаёт `docker-metrics`.

### `pnpm build` падает в Docker при установке
Симптом: `npm error network ... registry.npmjs.org`.

Причина: npm registry недоступен с сервера.

Решение: в `frontend/Dockerfile` задан `ARG NPM_REGISTRY=https://registry.npmmirror.com`
и `ENV NPM_CONFIG_REGISTRY`. При необходимости поменять зеркало.

### `path / is mounted on / but it is not a shared or slave mount`
node-exporter на macOS. Решение: монтировать `/:/host:ro` без `rslave` (уже так).

### Порт 8080/5432 занят
`bind: address already in use`. Решение: `APP_PORT=8090`, `POSTGRES_PORT=55432` в `.env`.

### `docker compose` не видит plugin (локальный DOCKER_CONFIG)
Симптом: `unknown command: compose`. Решение: использовать стандартный конфиг Docker
Desktop или симлинк `~/.docker/cli-plugins` в используемый DOCKER_CONFIG.

### Контейнеры перезапускаются (permission denied)
Симптом: Prometheus/Grafana/Loki падают `open ... permission denied`.

Причина: конфиги после rsync с Mac имеют mode `600`, а контейнеры бегут не от root.

Решение: `sudo chmod -R a+rX /opt/x5-support/infra`, или `user: "0:0"` в compose
(в observability уже сделано для prometheus/alertmanager/grafana/loki).

### `no such service: edge`
Имя сервиса — `caddy`, а контейнер называется `x5-support-edge`. Используй
`docker compose ... up -d --force-recreate caddy`.

## GitLab / CI

### `git push` пишет `fatal: failed to store: 100001`
Это шум osxkeychain, пуш при этом проходит. Игнорировать.

### GitLab не стартует / нет root-пользователя
`/etc/gitlab/initial_root_password` может отсутствовать. Bootstrap-скрипт создаёт root
через `Users::CreateService`; пароль должен быть сложным (словарные не принимаются).
Скрипт: `scripts/gitlab-bootstrap.sh`.

### Runner не может собрать docker-образ
Нужен смонтированный `/var/run/docker.sock` (есть в `docker-compose.gitlab.yml`) и
клон по внутреннему URL `http://gitlab:8929/...` (внешняя сеть `x5-support-gitlab_default`).

### deploy перезаписал Caddyfile и пропал HTTPS
Причина: rsync в деплое синхронизирует `infra/caddy/Caddyfile`. В репозитории должен
лежать **production HTTPS**-вариант. Если случайно задеплоили HTTP-версию — вернуть:
```bash
cp infra/caddy/Caddyfile.https infra/caddy/Caddyfile
# на сервере
docker compose ... up -d --force-recreate caddy
```

## DNS и домен

### Домен открывает парковку reg.ru, хотя сервер работает
Причина: старый A-кэш (parковочный IP `95.163.244.138`) с TTL 1 день; либо провайдер
подменяет UDP DNS и отдаёт свой кэш.

Проверка:
```bash
dig +tcp +short @ns1.reg.ru x5-test-task.ru        # должно быть 81.26.180.165
curl -s "https://dns.google/resolve?name=x5-test-task.ru&type=A" | head
dig +short x5-test-task.ru                          # тут может быть старый
```

Лечение:
1. `sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder`, перезапустить браузер.
2. DoH-профиль `deploy/macos-doh-cloudflare.mobileconfig` (macOS) — обходит перехват.
3. На iPhone — приложение «1.1.1.1» или Private DNS на Android (`one.one.one.one`).
4. Подождать истечения TTL (до суток).
5. Для демо — использовать Cloudflare quick tunnel (`https://clck.ru/3X4WNQ`).

### `dig @ns1.reg.ru` возвращает пустоту/таймаут
UDP до reg.ru часто режется. Используй TCP: `dig +tcp @ns1.reg.ru ...`.
Если запись в панели есть, а NS её не отдаёт — reg.ru применяет зону с задержкой
(5–30 минут). Ждать; если больше часа — поддержка reg.ru.

### `app.x5-test-task.ru` не резолвится
A-запись `app` добавлена позже остальных — reg.ru применяет зону с задержкой.
Проверять `dig +tcp +short A app.x5-test-task.ru @ns1.reg.ru`. Пока нет — у клиента
может кэшироваться NXDOMAIN (до 30 мин), помогает DoH/Private DNS.

### Let's Encrypt не выдаёт сертификат (HTTP-01 timeout)
Ожидаемо: входящие из-за рубежа до ВМ не доходят. Использовать DNS-01
(`deploy/enable-https.sh`).

## SSH и доступ

### `Permission denied (publickey)`, при этом сервер принимает ключ
Симптом: `Server accepts key ... we did not send a packet, disable method`.

Причина: приватный ключ под passphrase, а SSH в неинтерактивном режиме не может
спросить пароль.

Решение: `ssh-add ~/.ssh/x5-support` (ввести пароль один раз) или снять пароль:
`ssh-keygen -p -f ~/.ssh/x5-support` (новый пароль — пустой). Для CI — отдельный ключ
`x5-support-ci` без пароля.

### SSH/curl до IP таймаутит
Возможные причины:
1. Сеть клиента не маршрутизирует к IP (провайдер/роутер, остатки VPN-маршрутов).
   Проверка: `traceroute 81.26.180.165`, `nc -vz 81.26.180.165 22`.
2. ВМ остановлена/сменился публичный IP (динамический).
3. Security Group закрыл порт (должен быть `x5-support-sg-sec` с 22/80/443).

Быстрый обход — Cloudflare-туннель (работает независимо от входящих).

## Приложение

### Уведомления не появляются или растёт PostgreSQL outbox

Проверьте `backend`, `notifications` и `postgres` через `make status` и логи:
`docker compose logs --tail=100 backend notifications postgres`. В Prometheus
`support_outbox_pending` показывает число недоставленных событий, а
`support_outbox_oldest_seconds` — возраст старейшего. В Grafana откройте
**Support / Service**; алерт `SupportOutboxBacklog` срабатывает при задержке дольше
5 минут.

Если worker остановлен локально, сначала проверьте здоровье БД, затем запустите
`docker compose start notifications` и дождитесь снижения backlog. Повторная доставка
безопасна по `event_id`; не редактируйте и не удаляйте outbox вручную. Для полной
локальной проверки outage/replay/restart используйте `make check-recovery`.

### `/healthz` отдаёт HTML вместо `ok`
Запрос проходит через edge в Caddy приложения; healthcheck Docker использует
внутренний порт и работает. Косметика, не влияет.

### Пустые панели Grafana
Проверь datasource (Prometheus default) и имена метрик; дашборды в репозитории
(`infra/grafana/dashboards/*.json`) — правились под `caddy_http_*` с фильтром
`handler="file_server"`.

## Cloudflare tunnels

### URL туннеля перестал работать
Quick tunnel перегенерировал URL при рестарте контейнера.

```bash
docker logs x5-support-tunnel 2>&1 | grep trycloudflare
# или пересоздать оба:
cd /opt/x5-support && ./deploy/tunnels.sh
```

### Сайт через туннель открывается, по домену нет
Ожидаемо: туннель ходит через Cloudflare и не зависит от DNS; домен зависит от
DNS-кэша клиента/подмены. Для демо использовать туннель.
