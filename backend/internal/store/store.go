package store

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrInvalid    = errors.New("invalid input")
	ErrTransition = errors.New("invalid status transition")
	ErrNotFound   = errors.New("not found")
)

type Store struct{ DB *pgxpool.Pool }
type Ticket struct {
	ID          int64     `json:"id"`
	Topic       string    `json:"topic"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}
type Entry struct {
	ID         int64     `json:"id"`
	Kind       string    `json:"kind"`
	Actor      string    `json:"actor"`
	FromStatus string    `json:"from_status"`
	ToStatus   string    `json:"to_status"`
	Comment    string    `json:"comment"`
	CreatedAt  time.Time `json:"created_at"`
}
type Detail struct {
	Ticket
	History []Entry `json:"history"`
}
type Notification struct {
	ID         int64      `json:"id"`
	EventID    int64      `json:"event_id"`
	TicketID   int64      `json:"ticket_id"`
	Message    string     `json:"message"`
	OccurredAt time.Time  `json:"occurred_at"`
	ReadAt     *time.Time `json:"read_at"`
}
type Inbox struct {
	Items  []Notification `json:"items"`
	Unread int            `json:"unread"`
}

func ValidTopic(topic string) bool {
	return topic == "access" || topic == "service" || topic == "other"
}
func ValidStatus(status string) bool {
	return status == "new" || status == "in_progress" || status == "done"
}
func ValidText(value string, max int) bool {
	n := utf8.RuneCountInString(strings.TrimSpace(value))
	return n > 0 && n <= max
}

const ticketColumns = `id, topic, title, description, status, created_at, updated_at`

func scanTicket(row pgx.Row) (t Ticket, err error) {
	err = row.Scan(&t.ID, &t.Topic, &t.Title, &t.Description, &t.Status, &t.CreatedAt, &t.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		err = ErrNotFound
	}
	return
}
func (s *Store) Create(ctx context.Context, topic, title, description string) (Ticket, error) {
	title, description = strings.TrimSpace(title), strings.TrimSpace(description)
	if !ValidTopic(topic) || !ValidText(title, 200) || !ValidText(description, 10000) {
		return Ticket{}, ErrInvalid
	}
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return Ticket{}, err
	}
	defer tx.Rollback(ctx)
	ticket, err := scanTicket(tx.QueryRow(ctx, `INSERT INTO ticketing.tickets(topic,title,description) VALUES ($1,$2,$3) RETURNING `+ticketColumns, topic, title, description))
	if err != nil {
		return Ticket{}, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO ticketing.history(ticket_id,kind,actor,to_status) VALUES ($1,'created','user','new')`, ticket.ID)
	if err != nil {
		return Ticket{}, err
	}
	return ticket, tx.Commit(ctx)
}
func (s *Store) List(ctx context.Context, topic, status string) ([]Ticket, error) {
	if (topic != "" && !ValidTopic(topic)) || (status != "" && !ValidStatus(status)) {
		return nil, ErrInvalid
	}
	rows, err := s.DB.Query(ctx, `SELECT `+ticketColumns+` FROM ticketing.tickets WHERE ($1='' OR topic=$1) AND ($2='' OR status=$2) ORDER BY id DESC`, topic, status)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Ticket{}
	for rows.Next() {
		item, err := scanTicket(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
func (s *Store) Get(ctx context.Context, id int64) (Detail, error) {
	// A consistent snapshot prevents a new status with an old timeline.
	tx, err := s.DB.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return Detail{}, err
	}
	defer tx.Rollback(ctx)
	ticket, err := scanTicket(tx.QueryRow(ctx, `SELECT `+ticketColumns+` FROM ticketing.tickets WHERE id=$1`, id))
	if err != nil {
		return Detail{}, err
	}
	rows, err := tx.Query(ctx, `SELECT id,kind,actor,from_status,to_status,comment,created_at FROM ticketing.history WHERE ticket_id=$1 ORDER BY id`, id)
	if err != nil {
		return Detail{}, err
	}
	defer rows.Close()
	history := []Entry{}
	for rows.Next() {
		var e Entry
		if err := rows.Scan(&e.ID, &e.Kind, &e.Actor, &e.FromStatus, &e.ToStatus, &e.Comment, &e.CreatedAt); err != nil {
			return Detail{}, err
		}
		history = append(history, e)
	}
	if err := rows.Err(); err != nil {
		return Detail{}, err
	}
	return Detail{Ticket: ticket, History: history}, tx.Commit(ctx)
}

// Change locks the ticket so two simultaneous transitions cannot both succeed.
// An empty target is a plain comment; status+comment is a single history/event entry.
func (s *Store) Change(ctx context.Context, id int64, actor, target, comment string) error {
	comment = strings.TrimSpace(comment)
	if actor != "admin" && actor != "user" {
		return ErrInvalid
	}
	if utf8.RuneCountInString(comment) > 10000 || (target == "" && comment == "") {
		return ErrInvalid
	}
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	ticket, err := scanTicket(tx.QueryRow(ctx, `SELECT `+ticketColumns+` FROM ticketing.tickets WHERE id=$1 FOR UPDATE`, id))
	if err != nil {
		return err
	}
	kind, eventKind, from := "comment", "", ""
	if target != "" {
		if err := ValidateTransition(actor, ticket.Status, target, comment); err != nil {
			return err
		}
		kind, from = "status", ticket.Status
		if _, err := tx.Exec(ctx, `UPDATE ticketing.tickets SET status=$2, updated_at=clock_timestamp() WHERE id=$1`, id, target); err != nil {
			return err
		}
	} else {
		if _, err := tx.Exec(ctx, `UPDATE ticketing.tickets SET updated_at=clock_timestamp() WHERE id=$1`, id); err != nil {
			return err
		}
	}
	var historyID int64
	var occurredAt time.Time
	err = tx.QueryRow(ctx, `INSERT INTO ticketing.history(ticket_id,kind,actor,from_status,to_status,comment,created_at) VALUES ($1,$2,$3,$4,$5,$6,clock_timestamp()) RETURNING id,created_at`, id, kind, actor, from, target, comment).Scan(&historyID, &occurredAt)
	if err != nil {
		return err
	}
	if actor == "admin" {
		switch target {
		case "in_progress":
			eventKind = "accepted"
		case "done":
			eventKind = "completed"
		default:
			eventKind = "commented"
		}
		if _, err := tx.Exec(ctx, `INSERT INTO ticketing.outbox(history_id,ticket_id,kind,comment,occurred_at) VALUES ($1,$2,$3,$4,$5)`, historyID, id, eventKind, comment, occurredAt); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
func ValidateTransition(actor, from, to, comment string) error {
	allowed := (actor == "admin" && ((from == "new" && to == "in_progress") || (from == "in_progress" && to == "done"))) || (actor == "user" && from == "done" && to == "in_progress")
	if !allowed {
		return ErrTransition
	}
	if (to == "done" || actor == "user") && strings.TrimSpace(comment) == "" {
		return ErrInvalid
	}
	return nil
}

// Deliver is run only by the notification service. Both insert and acknowledgement
// are in one transaction: a crash commits both or neither. Replay never resets read_at.
func (s *Store) Deliver(ctx context.Context) (int, error) {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, `SELECT id,ticket_id,kind,comment,occurred_at FROM ticketing.outbox WHERE delivered_at IS NULL ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED`)
	if err != nil {
		return 0, err
	}
	type event struct {
		id, ticketID  int64
		kind, comment string
		at            time.Time
	}
	events := []event{}
	for rows.Next() {
		var e event
		if err := rows.Scan(&e.id, &e.ticketID, &e.kind, &e.comment, &e.at); err != nil {
			rows.Close()
			return 0, err
		}
		events = append(events, e)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	for _, e := range events {
		message := map[string]string{"accepted": "Заявка принята в работу", "commented": "Администратор добавил комментарий", "completed": "Заявка выполнена"}[e.kind]
		if e.comment != "" {
			message += ": " + e.comment
		}
		if _, err := tx.Exec(ctx, `INSERT INTO notifications.items(event_id,ticket_id,message,occurred_at) VALUES ($1,$2,$3,$4) ON CONFLICT (event_id) DO NOTHING`, e.id, e.ticketID, message, e.at); err != nil {
			return 0, err
		}
		if _, err := tx.Exec(ctx, `UPDATE ticketing.outbox SET delivered_at=clock_timestamp() WHERE id=$1`, e.id); err != nil {
			return 0, err
		}
	}
	return len(events), tx.Commit(ctx)
}
func (s *Store) Inbox(ctx context.Context) (Inbox, error) {
	rows, err := s.DB.Query(ctx, `SELECT id,event_id,ticket_id,message,occurred_at,read_at FROM notifications.items ORDER BY occurred_at DESC,event_id DESC`)
	if err != nil {
		return Inbox{}, err
	}
	defer rows.Close()
	inbox := Inbox{Items: []Notification{}}
	for rows.Next() {
		var item Notification
		if err := rows.Scan(&item.ID, &item.EventID, &item.TicketID, &item.Message, &item.OccurredAt, &item.ReadAt); err != nil {
			return Inbox{}, err
		}
		if item.ReadAt == nil {
			inbox.Unread++
		}
		inbox.Items = append(inbox.Items, item)
	}
	return inbox, rows.Err()
}
func (s *Store) Read(ctx context.Context, id int64) error {
	result, err := s.DB.Exec(ctx, `UPDATE notifications.items SET read_at=COALESCE(read_at,clock_timestamp()) WHERE id=$1`, id)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
