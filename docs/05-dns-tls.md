# 05. Домен, DNS и TLS

> Самый болезненный раздел проекта. Здесь вся история грабель, чтобы новый агент
> не повторял их и понимал, почему сделано именно так.

## 1. Домен

| Параметр | Значение |
|---|---|
| Домен | `x5-test-task.ru` |
| Регистратор | reg.ru |
| DNS | NS `ns1.reg.ru` / `ns2.reg.ru` (бесплатные DNS reg.ru) |
| Сервер | Yandex Cloud, `84.252.135.15` |

### Записи в зоне reg.ru

| Тип | Имя | Значение | Зачем |
|---|---|---|---|
| A | `@` | `84.252.135.15` | основной домен |
| A | `app` | `84.252.135.15` | поддомен приложения (свежий, без старого кэша) |
| A | `www` | `84.252.135.15` | классический алиас |
| TXT | `_acme-challenge` | `5lEZkOmqulkCuWieWAkHpiXonooMSaqKHLz7SxNNKlc` | DNS-01 (wildcard) |
| TXT | `_acme-challenge` | `7OhEjcXiYzjfuNsvNSozL3hPXiD9uAv50xUGTfWIBZA` | DNS-01 (apex) |

> Обе TXT-записи нужны для сертификата `*.x5-test-task.ru` + `x5-test-task.ru`.
> При продлении certbot попросит **новые** значения — старые можно заменять.

`api.x5-test-task.ru` **свободен** — зарезервирован под будущий бэкенд
(wildcard-сертификат его покроет автоматически).

## 2. HTTPS: почему DNS-01, а не HTTP-01

Сервер живет в Yandex Cloud (РФ). Входящие соединения **из-за рубежа до ВМ не доходят**
(проверено: Let's Encrypt не мог забрать `http://IP/.well-known/acme-challenge/...`,
а внешние узлы check-host таймаутят на 80/443). Поэтому обычный HTTP-01 невозможен.

Решение — **DNS-01**: подтверждение домена TXT-записью `_acme-challenge`, входящие
соединения не нужны. Сертификат выпущен через certbot вручную:

```bash
sudo docker run --rm -it -v /opt/orbita/certs:/etc/letsencrypt \
  certbot/certbot certonly --manual --preferred-challenges dns \
  -d "*.x5-test-task.ru" -d x5-test-task.ru \
  --email admin@x5-test-task.ru --agree-tos --no-eff-email \
  --cert-name x5-test-task.ru
```

certbot печатает 2 значения TXT (для wildcard и apex), их добавляют в reg.ru,
затем Enter. Итог: `/opt/orbita/certs/live/x5-test-task.ru/fullchain.pem` +
`privkey.pem`, срок до 14.02.2027.

Caddy монтирует `./certs:/certs:ro` и использует сертификат явно:

```caddy
https://{$DOMAIN}, https://*.{$DOMAIN} {
    tls /certs/live/{$DOMAIN}/fullchain.pem /certs/live/{$DOMAIN}/privkey.pem
    ...
}
```

**Продление:** `sudo ./deploy/enable-https.sh x5-test-task.ru admin@x5-test-task.ru`
(повторяет выпуск; нужны новые TXT). Или перейти на Cloudflare DNS +
`certbot-dns-cloudflare` — тогда TXT ставится автоматически.

## 3. Режимы Caddy в репозитории

| Файл | Режим |
|---|---|
| `infra/caddy/Caddyfile` | **production**: HTTPS wildcard + HTTP→HTTPS, IP остаётся рабочим |
| `infra/caddy/Caddyfile.https` | копия production (для истории/удобства) |
| `infra/caddy/Caddyfile.http` | резервный HTTP-only (если TLS недоступен) |

⚠️ Деплой по rsync перезаписывает `Caddyfile`. Убедись, что в репозитории лежит
production-версия, иначе сайт потеряет HTTPS.

## 4. Главная грабля: TTL и кэши DNS

### Что произошло

1. Изначально домен был «припаркован» в reg.ru: A-записи указывали на
   `95.163.244.138` (парковка), TTL = **1 день**.
2. A-записи поменяли на IP сервера, но **TTL уже был большим** — старый ответ
   остался в кэшах провайдеров/браузеров на срок до суток.
3. У части сетей домен ещё показывал парковку, у части — уже приложение.
4. Попытка снизить TTL в reg.ru **после** смены записи не помогает: старый кэш
   живёт по своему таймеру (reg.ru вообще не даёт TTL меньше 3600).

### Подмена DNS у провайдера

Отдельная проблема: домашний провайдер пользователя **перехватывает UDP DNS (порт 53)**
и отдаёт свой кэш. Проверка:

```
ns1.reg.ru (TCP)   → 84.252.135.15   ✅ (авторитативно)
DoH Google         → 84.252.135.15   ✅
DoH Cloudflare     → 84.252.135.15   ✅

UDP 8.8.8.8        → 95.163.244.138  ❌ (перехвачено, старый кэш)
UDP 1.1.1.1        → 95.163.244.138  ❌
UDP 77.88.8.8      → 95.163.244.138  ❌
```

Поэтому «сменить DNS в настройках на 8.8.8.8» не помогает — перехватчик отвечает
вместо реального сервера. Chrome с DoH работает, Safari (системный DNS) — нет.

### Как проверять правильно

```bash
# авторитативно, без кэшей (обязательно +tcp — UDP до reg.ru часто режется)
dig +tcp +short @ns1.reg.ru x5-test-task.ru
dig +tcp +short @ns1.reg.ru app.x5-test-task.ru

# что видят глобальные резолверы (DoH)
curl -s "https://dns.google/resolve?name=x5-test-task.ru&type=A"
curl -s -H 'accept: application/dns-json' \
  "https://cloudflare-dns.com/dns-query?name=x5-test-task.ru&type=A"

# что видит система (может быть старый кэш)
dig +short x5-test-task.ru
```

Если авторитативно и DoH — правильный IP, а `dig` локально — старый, проблема в кэше
или подмене на стороне пользователя, а не на сервере.

### Лечение для пользователя

1. `sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder` + перезапуск Safari.
2. **DoH-профиль для macOS**: `deploy/macos-doh-cloudflare.mobileconfig`
   (двойной клик → установить) — Safari и системные приложения начинают резолвить
   через HTTPS, перехват перестаёт влиять.
3. На iPhone — приложение «1.1.1.1: Faster Internet» или профиль DoH.
4. Либо просто подождать истечения TTL.

## 5. Резервные пути доступа (когда DNS/сеть ломаются)

| Способ | Адрес | Зависит от |
|---|---|---|
| Домен | `https://x5-test-task.ru` | DNS-кэша сети клиента |
| Поддомен | `https://app.x5-test-task.ru` | DNS (но запись новая, меньше кэша) |
| IP | `http://84.252.135.15/` | доступности IP из сети клиента |
| Cloudflare quick tunnel | `https://next-bandwidth-ctrl-july.trycloudflare.com` | только доступности Cloudflare |
| Короткая ссылка | `https://clck.ru/3X4WNQ` | то же (редирект на туннель) |

Туннель — **самый надёжный** вариант для демо: трафик идёт через Cloudflare,
входящие к ВМ не нужны.

## 6. Почему не включить Cloudflare-прокси (оранжевая тучка)

Cloudflare-прокси означает, что запросы к сайту идут с серверов Cloudflare (за рубежом)
к origin `84.252.135.15`. А входящие из-за рубежа до ВМ не доходят → прокси не сможет
забрать страницу. Поэтому A-записи должны быть **DNS only** (серая тучка).

## 7. Правильное решение на будущее: Cloudflare Tunnel с доменом

1. Завести домен в Cloudflare (бесплатный план), перенести NS в reg.ru на Cloudflare.
2. Создать **named tunnel** (Cloudflare Zero Trust → Networks → Tunnels).
3. Прописать public hostnames: `x5-test-task.ru`, `app.x5-test-task.ru` → `http://app:8080`.
4. Тогда все пользователи ходят через Cloudflare, а не напрямую до Yandex IP:
   ни перехват DNS, ни блокировки провайдера, ни кэши не влияют.
5. Сертификат TLS на клиенте — от Cloudflare; origin может оставаться HTTP.
6. Бонус: `cloudflared` умеет Access (авторизация) для Grafana и админок.

## 8. sslip.io (использовался ранее)

До покупки домена использовался `<IP>.sslip.io` — DNS без настройки. Сейчас не нужен,
но в коде остались следы (`DOMAIN=84.252.135.15.sslip.io` в истории).
