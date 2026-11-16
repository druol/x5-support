-- Начальная схема для будущего API.
-- Приложение сейчас статичное, но база готова: схема, расширения, health-таблица.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS orbita;

CREATE TABLE IF NOT EXISTS orbita.service_health (
    id          bigserial PRIMARY KEY,
    service     text        NOT NULL,
    status      text        NOT NULL DEFAULT 'ok',
    checked_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON SCHEMA orbita IS 'Схема приложения Orbita';
COMMENT ON TABLE orbita.service_health IS 'История health-check сервисов (для будущего API)';
