package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"uiarc/support/internal/store"
	"uiarc/support/internal/telemetry"
)

type API struct {
	Store         *store.Store
	Notifications bool
	LastPoll      *atomic.Int64
	Telemetry     *telemetry.Telemetry
	Service       string
	Env           string
}

func (a *API) Handler() http.Handler {
	if a.Telemetry == nil {
		a.Telemetry = telemetry.New("api", "test", "test", "test", nil)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", a.health)
	mux.Handle("GET /metrics", a.Telemetry.Handler())
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
	return a.observe(mux)
}

// observe adds request IDs, access logging, latency/size metrics and a 10s deadline.
func (a *API) observe(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		requestID := incomingRequestID(r)
		recorder := &responseWriter{ResponseWriter: w, status: http.StatusOK}
		w.Header().Set("X-Request-ID", requestID)
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")

		trackInFlight := r.URL.Path != "/metrics"
		if trackInFlight {
			a.Telemetry.SetInFlight(1)
			defer a.Telemetry.SetInFlight(-1)
		}

		ctx, cancel := context.WithTimeout(context.WithValue(r.Context(), requestIDKey{}, requestID), 10*time.Second)
		defer cancel()
		next.ServeHTTP(recorder, r.WithContext(ctx))

		route := normalizeRoute(r.URL.Path)
		duration := time.Since(start)
		a.Telemetry.ObserveHTTP(r.Method, route, recorder.status, duration, recorder.bytes)

		// Health/metrics scrapes would otherwise flood the access log.
		if r.URL.Path == "/metrics" || r.URL.Path == "/healthz" || r.URL.Path == "/api/healthz" {
			return
		}
		attrs := []any{
			"request_id", requestID,
			"method", r.Method,
			"route", route,
			"path", r.URL.Path,
			"status", recorder.status,
			"duration_ms", float64(duration.Microseconds()) / 1000,
			"bytes", recorder.bytes,
			"client_ip", clientIP(r),
			"user_agent", r.UserAgent(),
		}
		if recorder.status >= http.StatusInternalServerError || duration > time.Second {
			slog.Warn("http_request", attrs...)
			return
		}
		slog.Info("http_request", attrs...)
	})
}

type requestIDKey struct{}

func incomingRequestID(r *http.Request) string {
	if value := strings.TrimSpace(r.Header.Get("X-Request-ID")); value != "" && len(value) <= 128 {
		return value
	}
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err == nil {
		return hex.EncodeToString(buf)
	}
	return fmt.Sprintf("fallback-%d", time.Now().UnixNano())
}

func clientIP(r *http.Request) string {
	if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
		return strings.TrimSpace(strings.Split(forwarded, ",")[0])
	}
	return r.RemoteAddr
}

var (
	userTicketRoute = regexp.MustCompile(`^/api/(user|admin)/tickets/\d+$`)
	userStatusRoute = regexp.MustCompile(`^/api/(user|admin)/tickets/\d+/(comments|status)$`)
	notifReadRoute  = regexp.MustCompile(`^/api/notifications/\d+/read$`)
)

// normalizeRoute keeps metric cardinality bounded and turns request paths into
// stable route labels (ids are replaced by {id}).
func normalizeRoute(path string) string {
	switch {
	case path == "/healthz" || path == "/api/healthz":
		return "/healthz"
	case path == "/metrics":
		return "/metrics"
	case path == "/api/notifications":
		return "/api/notifications"
	case path == "/api/user/tickets" || path == "/api/admin/tickets":
		return path
	case path == "/api/debug/notifications" || path == "/api/debug/tickets":
		return path
	case userTicketRoute.MatchString(path):
		parts := strings.Split(path, "/")
		return "/api/" + parts[2] + "/tickets/{id}"
	case userStatusRoute.MatchString(path):
		parts := strings.Split(path, "/")
		return "/api/" + parts[2] + "/tickets/{id}/" + parts[5]
	case notifReadRoute.MatchString(path):
		return "/api/notifications/{id}/read"
	default:
		return "other"
	}
}

type responseWriter struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (w *responseWriter) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (w *responseWriter) Write(body []byte) (int, error) {
	n, err := w.ResponseWriter.Write(body)
	w.bytes += n
	return n, err
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
			slog.Error("request_failed", "error", err, "error_type", fmt.Sprintf("%T", err))
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
