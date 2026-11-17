package main

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"uiarc/support/internal/httpapi"
	"uiarc/support/internal/store"
	"uiarc/support/migrations"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	if !run() {
		os.Exit(1)
	}
}
func run() bool {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
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
	mode := "api"
	if len(os.Args) > 1 {
		mode = os.Args[1]
	}
	if mode == "migrate" {
		migrationCtx, stop := context.WithTimeout(ctx, 60*time.Second)
		defer stop()
		if err := migrations.Apply(migrationCtx, db); err != nil {
			slog.Error("migration failed", "error", err)
			return false
		}
		slog.Info("migrations applied")
		return true
	}
	if mode != "api" && mode != "notifications" {
		slog.Error("expected api, notifications or migrate")
		return false
	}
	s := &store.Store{DB: db}
	api := &httpapi.API{Store: s, Notifications: mode == "notifications"}
	var workers sync.WaitGroup
	if api.Notifications {
		api.LastPoll = &atomic.Int64{}
		workers.Add(1)
		go func() {
			defer workers.Done()
			backoff := time.Second
			for ctx.Err() == nil {
				batchCtx, stop := context.WithTimeout(ctx, 10*time.Second)
				count, err := s.Deliver(batchCtx)
				stop()
				if err != nil {
					slog.Warn("notification delivery failed; will retry", "retry_seconds", backoff.Seconds())
					backoff = min(backoff*2, 15*time.Second)
				} else {
					api.LastPoll.Store(time.Now().UnixNano())
					backoff = time.Second
					if count > 0 {
						slog.Info("events processed", "count", count)
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
	go func() { slog.Info("listening", "service", mode, "address", addr); errors <- server.ListenAndServe() }()
	ok := true
	select {
	case <-ctx.Done():
	case err := <-errors:
		if err != http.ErrServerClosed {
			slog.Error("http server failed")
			ok = false
		}
	}
	cancel()
	shutdownCtx, stop := context.WithTimeout(context.Background(), 10*time.Second)
	defer stop()
	_ = server.Shutdown(shutdownCtx)
	workers.Wait()
	return ok
}
