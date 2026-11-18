package main

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"uiarc/support/internal/httpapi"
	"uiarc/support/internal/store"
	"uiarc/support/internal/telemetry"
	"uiarc/support/migrations"
)

// Injected by the Docker/CI build.
var (
	version = "dev"
	commit  = "unknown"
)

func main() {
	if !run() {
		os.Exit(1)
	}
}

func run() bool {
	level := slog.LevelInfo
	switch strings.ToLower(os.Getenv("LOG_LEVEL")) {
	case "debug":
		level = slog.LevelDebug
	case "warn":
		level = slog.LevelWarn
	case "error":
		level = slog.LevelError
	}
	handlerOpts := &slog.HandlerOptions{Level: level}
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, handlerOpts)))
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	mode := "api"
	if len(os.Args) > 1 {
		mode = os.Args[1]
	}
	env := os.Getenv("APP_ENV")
	if env == "" {
		env = "production"
	}
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, handlerOpts)).With(
		"service", mode, "env", env, "version", version, "commit", commit,
	))
	slog.Info("service_starting", "mode", mode)

	if os.Getenv("DATABASE_URL") == "" {
		slog.Error("DATABASE_URL is required")
		return false
	}
	config, err := pgxpool.ParseConfig(os.Getenv("DATABASE_URL"))
	if err != nil {
		slog.Error("invalid database configuration")
		return false
	}
	config.MaxConns = 8
	config.ConnConfig.ConnectTimeout = 5 * time.Second
	db, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		slog.Error("database pool unavailable")
		return false
	}
	defer db.Close()
	if mode == "migrate" {
		migrationCtx, stop := context.WithTimeout(ctx, 60*time.Second)
		defer stop()
		if err := migrations.Apply(migrationCtx, db); err != nil {
			slog.Error("migration failed", "error", err)
			return false
		}
		slog.Info("migrations_applied")
		return true
	}
	if mode != "api" && mode != "notifications" {
		slog.Error("expected api, notifications or migrate")
		return false
	}
	s := &store.Store{DB: db}
	metrics := telemetry.New(mode, env, version, commit, db)
	api := &httpapi.API{Store: s, Notifications: mode == "notifications", Telemetry: metrics, Service: mode, Env: env}
	var workers sync.WaitGroup
	if api.Notifications {
		api.LastPoll = &atomic.Int64{}
		workers.Add(1)
		go func() {
			defer workers.Done()
			backoff := time.Second
			for ctx.Err() == nil {
				started := time.Now()
				batchCtx, stop := context.WithTimeout(ctx, 10*time.Second)
				count, err := s.Deliver(batchCtx)
				stop()
				duration := time.Since(started)
				metrics.ObserveDelivery(count, duration, err)
				if err != nil {
					slog.Warn("notification_delivery_failed", "error", err, "retry_seconds", backoff.Seconds(), "batch", count, "duration_ms", float64(duration.Microseconds())/1000)
					backoff = min(backoff*2, 15*time.Second)
				} else {
					api.LastPoll.Store(time.Now().UnixNano())
					backoff = time.Second
					if count > 0 {
						slog.Info("notification_batch_delivered", "count", count, "duration_ms", float64(duration.Microseconds())/1000)
					}
				}
				if err == nil && count == 100 {
					continue
				}
				timer := time.NewTimer(backoff)
				select {
				case <-ctx.Done():
					timer.Stop()
				case <-timer.C:
				}
			}
		}()
	}
	addr := os.Getenv("HTTP_ADDR")
	if addr == "" {
		addr = ":8080"
	}
	server := &http.Server{Addr: addr, Handler: api.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second, BaseContext: func(net.Listener) context.Context { return ctx }}
	errors := make(chan error, 1)
	go func() { slog.Info("listening", "address", addr); errors <- server.ListenAndServe() }()
	ok := true
	select {
	case <-ctx.Done():
	case err := <-errors:
		if err != http.ErrServerClosed {
			slog.Error("http_server_failed", "error", err)
			ok = false
		}
	}
	cancel()
	shutdownCtx, stop := context.WithTimeout(context.Background(), 10*time.Second)
	defer stop()
	_ = server.Shutdown(shutdownCtx)
	workers.Wait()
	slog.Info("service_stopped")
	return ok
}
