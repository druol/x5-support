package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"sync/atomic"
	"time"

	"uiarc/support/internal/store"
)

type API struct {
	Store         *store.Store
	Notifications bool
	LastPoll      *atomic.Int64
	requests      atomic.Uint64
	errors        atomic.Uint64
	durationNS    atomic.Uint64
}

func (a *API) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", a.health)
	mux.HandleFunc("GET /metrics", a.metrics)
	if a.Notifications {
		mux.HandleFunc("GET /api/notifications", func(w http.ResponseWriter, r *http.Request) {
			inbox, err := a.Store.Inbox(r.Context())
			respond(w, inbox, err)
		})
		mux.HandleFunc("POST /api/notifications/{id}/read", func(w http.ResponseWriter, r *http.Request) {
			id, err := parseID(r)
			if err == nil {
				err = a.Store.Read(r.Context(), id)
			}
			respond(w, map[string]bool{"ok": true}, err)
		})
	} else {
		mux.HandleFunc("GET /api/healthz", a.health)
		for _, actor := range []string{"user", "admin"} {
			prefix := "/api/" + actor + "/tickets"
			mux.HandleFunc("GET "+prefix, a.list)
			mux.HandleFunc("GET "+prefix+"/{id}", a.detail)
			mux.HandleFunc("POST "+prefix+"/{id}/comments", a.change(actor, false))
			mux.HandleFunc("POST "+prefix+"/{id}/status", a.change(actor, true))
		}
		mux.HandleFunc("POST /api/user/tickets", a.create)
		if os.Getenv("DEBUG_RESET") == "1" {
			mux.HandleFunc("POST /api/debug/notifications", func(w http.ResponseWriter, r *http.Request) {
				respond(w, map[string]bool{"ok": true}, a.Store.DeleteAllNotifications(r.Context()))
			})
			mux.HandleFunc("POST /api/debug/tickets", func(w http.ResponseWriter, r *http.Request) {
				respond(w, map[string]bool{"ok": true}, a.Store.DeleteAllTickets(r.Context()))
			})
		}
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		recorder := &responseWriter{ResponseWriter: w, status: 200}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		mux.ServeHTTP(recorder, r.WithContext(ctx))
		if r.URL.Path != "/metrics" && r.URL.Path != "/healthz" {
			a.requests.Add(1)
			a.durationNS.Add(uint64(time.Since(start)))
			if recorder.status >= 500 {
				a.errors.Add(1)
			}
			slog.Info("http", "method", r.Method, "path", r.URL.Path, "status", recorder.status, "duration_ms", time.Since(start).Milliseconds())
		}
	})
}

type responseWriter struct {
	http.ResponseWriter
	status int
}

func (w *responseWriter) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func parseID(r *http.Request) (int64, error) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id < 1 {
		return 0, store.ErrInvalid
	}
	return id, nil
}
func decode(w http.ResponseWriter, r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 128*1024)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		return store.ErrInvalid
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return store.ErrInvalid
	}
	return nil
}
func respond(w http.ResponseWriter, value any, err error) {
	if err != nil {
		status, message := 500, "Сервис временно недоступен. Повторите попытку."
		switch {
		case errors.Is(err, store.ErrInvalid):
			status, message = 400, "Проверьте обязательные поля, допустимые значения и длину текста."
		case errors.Is(err, store.ErrTransition):
			status, message = 409, "Статус уже изменился или этот переход недоступен. Обновите заявку."
		case errors.Is(err, store.ErrNotFound):
			status, message = 404, "Запись не найдена."
		default:
			slog.Error("request failed", "error_type", fmt.Sprintf("%T", err))
		}
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
		return
	}
	_ = json.NewEncoder(w).Encode(value)
}
func (a *API) create(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Topic       string `json:"topic"`
		Title       string `json:"title"`
		Description string `json:"description"`
	}
	if err := decode(w, r, &input); err != nil {
		respond(w, nil, err)
		return
	}
	ticket, err := a.Store.Create(r.Context(), input.Topic, input.Title, input.Description)
	if err == nil {
		w.WriteHeader(http.StatusCreated)
	}
	respond(w, ticket, err)
}
func (a *API) list(w http.ResponseWriter, r *http.Request) {
	items, err := a.Store.List(r.Context(), r.URL.Query().Get("topic"), r.URL.Query().Get("status"))
	respond(w, map[string]any{"items": items}, err)
}
func (a *API) detail(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		respond(w, nil, err)
		return
	}
	ticket, err := a.Store.Get(r.Context(), id)
	respond(w, ticket, err)
}
func (a *API) change(actor string, status bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := parseID(r)
		if err != nil {
			respond(w, nil, err)
			return
		}
		var input struct {
			Status  string `json:"status"`
			Comment string `json:"comment"`
		}
		if err = decode(w, r, &input); err != nil {
			respond(w, nil, err)
			return
		}
		if (status && input.Status == "") || (!status && input.Status != "") {
			respond(w, nil, store.ErrInvalid)
			return
		}
		err = a.Store.Change(r.Context(), id, actor, input.Status, input.Comment)
		respond(w, map[string]bool{"ok": true}, err)
	}
}
func (a *API) health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if a.Store.DB.Ping(ctx) != nil || (a.LastPoll != nil && time.Since(time.Unix(0, a.LastPoll.Load())) > 30*time.Second) {
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "unavailable"})
		return
	}
	respond(w, map[string]string{"status": "ok"}, nil)
}
func (a *API) metrics(w http.ResponseWriter, r *http.Request) {
	var pending int64
	var oldest float64
	err := a.Store.DB.QueryRow(r.Context(), `SELECT count(*), COALESCE(EXTRACT(EPOCH FROM now()-min(occurred_at)),0)::float8 FROM ticketing.outbox WHERE delivered_at IS NULL`).Scan(&pending, &oldest)
	if err != nil {
		respond(w, nil, err)
		return
	}
	w.Header().Set("Content-Type", "text/plain; version=0.0.4")
	fmt.Fprintf(w, "# TYPE support_http_requests_total counter\nsupport_http_requests_total %d\n# TYPE support_http_errors_total counter\nsupport_http_errors_total %d\n# TYPE support_http_duration_seconds summary\nsupport_http_duration_seconds_sum %f\nsupport_http_duration_seconds_count %d\n# TYPE support_outbox_pending gauge\nsupport_outbox_pending %d\n# TYPE support_outbox_oldest_seconds gauge\nsupport_outbox_oldest_seconds %f\n", a.requests.Load(), a.errors.Load(), float64(a.durationNS.Load())/1e9, a.requests.Load(), pending, oldest)
}
