FROM caddy:2.9-alpine
COPY dist /srv
COPY frontend/Caddyfile /etc/caddy/Caddyfile
