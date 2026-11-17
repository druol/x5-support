CREATE SCHEMA IF NOT EXISTS ticketing;
CREATE SCHEMA IF NOT EXISTS notifications;

CREATE TABLE ticketing.tickets (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    topic text NOT NULL CHECK (topic IN ('access', 'service', 'other')),
    title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
    description text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 10000),
    status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'done')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tickets_filters ON ticketing.tickets (status, topic, id DESC);

-- One chronological timeline: comments and status changes retain author and time.
CREATE TABLE ticketing.history (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ticket_id bigint NOT NULL REFERENCES ticketing.tickets(id),
    kind text NOT NULL CHECK (kind IN ('created', 'comment', 'status')),
    actor text NOT NULL CHECK (actor IN ('user', 'admin')),
    from_status text NOT NULL DEFAULT '',
    to_status text NOT NULL DEFAULT '',
    comment text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX history_ticket ON ticketing.history(ticket_id, id);

-- The event is committed in the SAME transaction as the ticket mutation.
CREATE TABLE ticketing.outbox (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    history_id bigint NOT NULL UNIQUE REFERENCES ticketing.history(id),
    ticket_id bigint NOT NULL REFERENCES ticketing.tickets(id),
    kind text NOT NULL CHECK (kind IN ('accepted', 'commented', 'completed')),
    comment text NOT NULL DEFAULT '',
    occurred_at timestamptz NOT NULL DEFAULT now(),
    delivered_at timestamptz
);
CREATE INDEX outbox_pending ON ticketing.outbox(id) WHERE delivered_at IS NULL;

-- Owned by the notification service. event_id is the idempotency key.
CREATE TABLE notifications.items (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id bigint NOT NULL UNIQUE REFERENCES ticketing.outbox(id),
    ticket_id bigint NOT NULL,
    message text NOT NULL,
    occurred_at timestamptz NOT NULL,
    read_at timestamptz
);
CREATE INDEX notification_order ON notifications.items(occurred_at DESC, event_id DESC);
