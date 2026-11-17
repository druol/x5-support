package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"uiarc/support/internal/store"
	"uiarc/support/migrations"
)

func TestFullScenarioAndRecovery(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set TEST_DATABASE_URL for PostgreSQL integration test")
	}
	ctx := context.Background()
	db, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if !strings.HasSuffix(db.Config().ConnConfig.Database, "_test") {
		t.Fatal("test database name must end in _test")
	}
	if err := migrations.Apply(ctx, db); err != nil {
		t.Fatal(err)
	}
	if err := migrations.Apply(ctx, db); err != nil {
		t.Fatalf("repeat migration: %v", err)
	}
	s := &store.Store{DB: db}
	api := (&API{Store: s}).Handler()
	notifications := (&API{Store: s, Notifications: true}).Handler()
	call := func(handler http.Handler, method, path string, body any, code int, out any) {
		t.Helper()
		data, _ := json.Marshal(body)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest(method, path, bytes.NewReader(data)))
		if w.Code != code {
			t.Fatalf("%s %s: got %d, want %d: %s", method, path, w.Code, code, w.Body)
		}
		if out != nil {
			if err := json.Unmarshal(w.Body.Bytes(), out); err != nil {
				t.Fatal(err)
			}
		}
	}
	for _, body := range []any{
		map[string]string{"topic": "invalid", "title": "Title", "description": "Description"},
		map[string]string{"topic": "access", "title": "   ", "description": "Description"},
		map[string]string{"topic": "access", "title": "Title", "description": ""},
	} {
		call(api, "POST", "/api/user/tickets", body, 400, nil)
	}
	var ticket store.Ticket
	call(api, "POST", "/api/user/tickets", map[string]string{"topic": "access", "title": "Нет доступа", "description": "Не открывается сервис"}, 201, &ticket)
	if ticket.Status != "new" {
		t.Fatal("new ticket status")
	}
	user := fmt.Sprintf("/api/user/tickets/%d", ticket.ID)
	admin := fmt.Sprintf("/api/admin/tickets/%d", ticket.ID)
	call(api, "POST", user+"/status", map[string]string{"status": "in_progress", "comment": "Рано"}, 409, nil)
	call(api, "POST", admin+"/status", map[string]string{"status": "done", "comment": "Пропуск шага"}, 409, nil)
	call(api, "POST", admin+"/status", map[string]string{"status": "in_progress"}, 200, nil)
	call(api, "POST", admin+"/status", map[string]string{"status": "in_progress"}, 409, nil)
	call(api, "POST", admin+"/comments", map[string]string{"comment": "Проверяем доступ"}, 200, nil)
	call(api, "POST", admin+"/status", map[string]string{"status": "done", "comment": "  "}, 400, nil)
	call(api, "POST", admin+"/status", map[string]string{"status": "done", "comment": "Доступ восстановлен"}, 200, nil)
	call(api, "POST", user+"/status", map[string]string{"status": "in_progress"}, 400, nil)
	call(api, "POST", user+"/status", map[string]string{"status": "in_progress", "comment": "Ошибка повторилась"}, 200, nil)
	call(api, "POST", user+"/comments", map[string]string{"comment": "Дополнительные сведения"}, 200, nil)
	call(api, "POST", user+"/comments", map[string]string{"comment": " "}, 400, nil)
	call(api, "POST", user+"/comments", map[string]string{"comment": "Комментарий", "status": "done"}, 400, nil)
	var detail store.Detail
	call(api, "GET", user, nil, 200, &detail)
	if detail.Status != "in_progress" || len(detail.History) != 6 {
		t.Fatalf("timeline: %+v", detail)
	}
	for _, h := range detail.History {
		if h.Actor == "" || h.CreatedAt.IsZero() {
			t.Fatal("missing author/time")
		}
	}
	if detail.History[3].Comment != "Доступ восстановлен" || detail.History[4].Actor != "user" {
		t.Fatal("result/reopen lost")
	}
	var filtered struct {
		Items []store.Ticket `json:"items"`
	}
	call(api, "GET", "/api/admin/tickets?topic=access&status=in_progress", nil, 200, &filtered)
	found := false
	for _, item := range filtered.Items {
		if item.Topic != "access" || item.Status != "in_progress" {
			t.Fatal("filter mismatch")
		}
		found = found || item.ID == ticket.ID
	}
	if !found {
		t.Fatal("created ticket missing from filtered list")
	}
	call(api, "GET", "/api/admin/tickets?status=invalid", nil, 400, nil)
	call(api, "GET", "/api/user/tickets/999999999", nil, 404, nil)
	call(api, "GET", "/api/user/tickets/not-an-id", nil, 400, nil)
	// No worker has run: every request above completed while notifications were down.
	var pending int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM ticketing.outbox WHERE ticket_id=$1 AND delivered_at IS NULL`, ticket.ID).Scan(&pending); err != nil || pending != 3 {
		t.Fatalf("pending=%d: %v", pending, err)
	}
	var count int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM notifications.items WHERE ticket_id=$1`, ticket.ID).Scan(&count); err != nil || count != 0 {
		t.Fatal("notifications created synchronously")
	}
	// Multiple worker instances may run; row locks and unique keys prevent duplicates.
	var workers sync.WaitGroup
	for range 4 {
		workers.Add(1)
		go func() {
			defer workers.Done()
			if _, err := s.Deliver(ctx); err != nil {
				t.Error(err)
			}
		}()
	}
	workers.Wait()
	var inbox store.Inbox
	call(notifications, "GET", "/api/notifications", nil, 200, &inbox)
	items := []store.Notification{}
	for _, item := range inbox.Items {
		if item.TicketID == ticket.ID {
			items = append(items, item)
		}
	}
	if len(items) != 3 {
		t.Fatalf("expected 3 notifications, got %d", len(items))
	}
	if items[0].Message != "Заявка выполнена: Доступ восстановлен" {
		t.Fatal("completion must include result and be newest")
	}
	readPath := fmt.Sprintf("/api/notifications/%d/read", items[0].ID)
	call(notifications, "POST", readPath, nil, 200, nil)
	call(notifications, "POST", readPath, nil, 200, nil)
	// Force transport redelivery after acknowledgement loss; public API has no replay endpoint.
	if _, err := db.Exec(ctx, `UPDATE ticketing.outbox SET delivered_at=NULL WHERE ticket_id=$1`, ticket.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Deliver(ctx); err != nil {
		t.Fatal(err)
	}
	// New DB connection/service instance sees durable data and read state.
	fresh, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer fresh.Close()
	restarted := (&API{Store: &store.Store{DB: fresh}, Notifications: true}).Handler()
	call(restarted, "GET", "/api/notifications", nil, 200, &inbox)
	count = 0
	for _, item := range inbox.Items {
		if item.TicketID == ticket.ID {
			count++
			if item.ID == items[0].ID && item.ReadAt == nil {
				t.Fatal("read state lost on replay/restart")
			}
		}
	}
	if count != 3 {
		t.Fatalf("duplicate delivery: %d", count)
	}
	// Two admins completing the same ticket produce one completion, one conflict.
	results := make(chan int, 2)
	for range 2 {
		go func() {
			w := httptest.NewRecorder()
			api.ServeHTTP(w, httptest.NewRequest("POST", admin+"/status", strings.NewReader(`{"status":"done","comment":"Повторное решение"}`)))
			results <- w.Code
		}()
	}
	one, two := <-results, <-results
	if !((one == 200 && two == 409) || (one == 409 && two == 200)) {
		t.Fatalf("concurrent transitions: %d, %d", one, two)
	}
}

func TestDeliverRollsBackNotificationWhenOutboxAckFails(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set TEST_DATABASE_URL for PostgreSQL integration test")
	}
	ctx := context.Background()
	db, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if !strings.HasSuffix(db.Config().ConnConfig.Database, "_test") {
		t.Fatal("test database name must end with _test")
	}
	if err := migrations.Apply(ctx, db); err != nil {
		t.Fatal(err)
	}
	s := &store.Store{DB: db}
	ticket, err := s.Create(ctx, "access", "Rollback delivery", "Verify atomic notification delivery")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Change(ctx, ticket.ID, "admin", "in_progress", ""); err != nil {
		t.Fatal(err)
	}

	// Fail the acknowledgement update, after the notification INSERT has run.
	// The transaction must roll both operations back so retry can deliver once.
	function := fmt.Sprintf("fail_test_outbox_ack_%d", ticket.ID)
	trigger := fmt.Sprintf("fail_test_outbox_ack_%d", ticket.ID)
	ddl := fmt.Sprintf(`CREATE FUNCTION ticketing.%s() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.ticket_id = %d AND OLD.delivered_at IS NULL AND NEW.delivered_at IS NOT NULL THEN
    RAISE EXCEPTION 'simulated outbox acknowledgement failure';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER %s BEFORE UPDATE OF delivered_at ON ticketing.outbox
FOR EACH ROW EXECUTE FUNCTION ticketing.%s()`, function, ticket.ID, trigger, function)
	if _, err := db.Exec(ctx, ddl); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_, _ = db.Exec(ctx, fmt.Sprintf("DROP TRIGGER IF EXISTS %s ON ticketing.outbox", trigger))
		_, _ = db.Exec(ctx, fmt.Sprintf("DROP FUNCTION IF EXISTS ticketing.%s()", function))
	}()
	if _, err := s.Deliver(ctx); err == nil {
		t.Fatal("expected simulated acknowledgement failure")
	}
	var delivered, notifications int
	if err := db.QueryRow(ctx, `SELECT count(*) FILTER (WHERE delivered_at IS NOT NULL),
       (SELECT count(*) FROM notifications.items WHERE ticket_id=$1)
       FROM ticketing.outbox WHERE ticket_id=$1`, ticket.ID).Scan(&delivered, &notifications); err != nil {
		t.Fatal(err)
	}
	if delivered != 0 || notifications != 0 {
		t.Fatalf("failed delivery left delivered=%d notifications=%d", delivered, notifications)
	}
	if _, err := db.Exec(ctx, fmt.Sprintf("DROP TRIGGER %s ON ticketing.outbox", trigger)); err != nil {
		t.Fatal(err)
	}
	if count, err := s.Deliver(ctx); err != nil || count < 1 {
		t.Fatalf("retry delivery count=%d err=%v", count, err)
	}
	var deliveredForTicket int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM ticketing.outbox WHERE ticket_id=$1 AND delivered_at IS NOT NULL`, ticket.ID).Scan(&deliveredForTicket); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(ctx, `SELECT count(*) FROM notifications.items WHERE ticket_id=$1`, ticket.ID).Scan(&notifications); err != nil {
		t.Fatal(err)
	}
	if deliveredForTicket != 1 || notifications != 1 {
		t.Fatalf("retry left delivered=%d notifications=%d, want one each", deliveredForTicket, notifications)
	}
}

func TestInvalidJSON(t *testing.T) {
	handler := (&API{}).Handler() // Bad bodies are rejected before any DB access.
	for _, body := range []string{`{`, `{"topic":"access","unknown":1}`, `{} {}`, strings.Repeat("x", 129*1024)} {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest("POST", "/api/user/tickets", strings.NewReader(body)))
		if w.Code != 400 {
			t.Fatalf("got %d", w.Code)
		}
	}
}
