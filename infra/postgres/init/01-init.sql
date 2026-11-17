-- Начальная схема для будущего API.
-- Приложение сейчас статичное, но база готова: схема, расширения, health-таблица.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS x5-support;

CREATE TABLE IF NOT EXISTS x5-support.service_health (
    id          bigserial PRIMARY KEY,
    service     text        NOT NULL,
    status      text        NOT NULL DEFAULT 'ok',
    checked_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON SCHEMA x5-support IS 'Схема приложения X5 Support';
COMMENT ON TABLE x5-support.service_health IS 'История health-check сервисов (для будущего API)';
