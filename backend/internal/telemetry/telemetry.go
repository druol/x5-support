// Package telemetry owns the process metrics exposed by the ticket services.
// Every service gets its own registry so the backend and notification worker
// never share mutable state.
package telemetry

import (
	"context"
	"fmt"
	"net/http"
	"runtime"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Telemetry holds the registry and the collectors used by one service instance.
type Telemetry struct {
	Registry *prometheus.Registry
	service  string
	env      string
	started  time.Time
	pool     *pgxpool.Pool

	requests       *prometheus.CounterVec
	requestLatency *prometheus.HistogramVec
	responseBytes  *prometheus.HistogramVec
	inFlight       prometheus.Gauge
	deliveries     *prometheus.CounterVec
	deliveryErrors prometheus.Counter
	deliveryTime   prometheus.Histogram
	batchSize      prometheus.Histogram
	lastSuccess    prometheus.Gauge
}

// New builds a registry with Go/process collectors, HTTP metrics and DB-backed gauges.
// db is optional; when nil, database gauges are not registered.
func New(service, env, version, commit string, db *pgxpool.Pool) *Telemetry {
	t := &Telemetry{Registry: prometheus.NewRegistry(), service: service, env: env, started: time.Now(), pool: db}

	labels := prometheus.Labels{"service": service, "env": env}
	requests := prometheus.NewCounterVec(prometheus.CounterOpts{
		Namespace: "x5", Subsystem: "http", Name: "requests_total",
		Help:        "HTTP requests handled, by method, normalized route and status.",
		ConstLabels: labels,
	}, []string{"method", "route", "status"})
	latency := prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Namespace: "x5", Subsystem: "http", Name: "request_duration_seconds",
		Help:        "HTTP request latency.",
		Buckets:     prometheus.DefBuckets,
		ConstLabels: labels,
	}, []string{"method", "route"})
	bytes := prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Namespace: "x5", Subsystem: "http", Name: "response_size_bytes",
		Help:        "HTTP response body size in bytes.",
		Buckets:     []float64{128, 512, 2048, 8192, 32768, 131072, 524288, 2097152},
		ConstLabels: labels,
	}, []string{"route"})
	inFlight := prometheus.NewGauge(prometheus.GaugeOpts{
		Namespace: "x5", Subsystem: "http", Name: "in_flight_requests",
		Help: "HTTP requests currently being served.", ConstLabels: labels,
	})
	deliveries := prometheus.NewCounterVec(prometheus.CounterOpts{
		Namespace: "x5", Subsystem: "notifications", Name: "delivered_total",
		Help:        "Outbox events successfully written to the inbox, by result.",
		ConstLabels: labels,
	}, []string{"result"})
	deliveryErrors := prometheus.NewCounter(prometheus.CounterOpts{
		Namespace: "x5", Subsystem: "notifications", Name: "delivery_errors_total",
		Help: "Failed notification delivery attempts.", ConstLabels: labels,
	})
	deliveryTime := prometheus.NewHistogram(prometheus.HistogramOpts{
		Namespace: "x5", Subsystem: "notifications", Name: "delivery_duration_seconds",
		Help: "Duration of a delivery batch.", Buckets: prometheus.DefBuckets, ConstLabels: labels,
	})
	batchSize := prometheus.NewHistogram(prometheus.HistogramOpts{
		Namespace: "x5", Subsystem: "notifications", Name: "batch_size",
		Help:    "Number of outbox events claimed per delivery batch.",
		Buckets: []float64{0, 1, 5, 10, 25, 50, 100}, ConstLabels: labels,
	})
	lastSuccess := prometheus.NewGauge(prometheus.GaugeOpts{
		Namespace: "x5", Subsystem: "notifications", Name: "last_successful_delivery_timestamp_seconds",
		Help: "Unix timestamp of the last successful delivery poll.", ConstLabels: labels,
	})
	buildInfo := prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "x5", Name: "build_info", Help: "Build information for the running service.",
	}, []string{"service", "env", "version", "commit", "go_version"})
	uptime := prometheus.NewGaugeFunc(prometheus.GaugeOpts{
		Namespace: "x5", Name: "uptime_seconds", Help: "Process uptime in seconds.", ConstLabels: labels,
	}, func() float64 { return time.Since(t.started).Seconds() })

	t.requests, t.requestLatency, t.responseBytes = requests, latency, bytes
	t.inFlight, t.deliveries, t.deliveryErrors = inFlight, deliveries, deliveryErrors
	t.deliveryTime, t.batchSize, t.lastSuccess = deliveryTime, batchSize, lastSuccess

	reg := t.Registry
	reg.MustRegister(collectors.NewGoCollector(), collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}))
	reg.MustRegister(requests, latency, bytes, inFlight, buildInfo, uptime)
	// Delivery metrics only make sense on the worker; do not expose dead zero
	// series on the API service where no delivery loop runs.
	if service == "notifications" {
		reg.MustRegister(deliveries, deliveryErrors, deliveryTime, batchSize, lastSuccess)
	}
	buildInfo.WithLabelValues(service, env, version, commit, runtime.Version()).Set(1)

	if db != nil {
		reg.MustRegister(
			prometheus.NewGaugeFunc(prometheus.GaugeOpts{
				Namespace: "x5", Subsystem: "db", Name: "pool_total_conns",
				Help: "Total connections in the PostgreSQL pool.", ConstLabels: labels,
			}, func() float64 { return float64(db.Stat().TotalConns()) }),
			prometheus.NewGaugeFunc(prometheus.GaugeOpts{
				Namespace: "x5", Subsystem: "db", Name: "pool_idle_conns",
				Help: "Idle connections in the PostgreSQL pool.", ConstLabels: labels,
			}, func() float64 { return float64(db.Stat().IdleConns()) }),
			prometheus.NewGaugeFunc(prometheus.GaugeOpts{
				Namespace: "x5", Subsystem: "db", Name: "pool_acquired_conns",
				Help: "Connections currently in use.", ConstLabels: labels,
			}, func() float64 { return float64(db.Stat().AcquiredConns()) }),
			prometheus.NewGaugeFunc(prometheus.GaugeOpts{
				Namespace: "x5", Subsystem: "db", Name: "pool_max_conns",
				Help: "Maximum connections allowed by the pool.", ConstLabels: labels,
			}, func() float64 { return float64(db.Stat().MaxConns()) }),
			prometheus.NewCounterFunc(prometheus.CounterOpts{
				Namespace: "x5", Subsystem: "db", Name: "pool_acquire_count_total",
				Help: "Successful connection acquisitions from the pool.", ConstLabels: labels,
			}, func() float64 { return float64(db.Stat().AcquireCount()) }),
			prometheus.NewGaugeFunc(prometheus.GaugeOpts{
				Namespace: "x5", Subsystem: "outbox", Name: "pending_events",
				Help: "Undelivered outbox events.", ConstLabels: labels,
			}, func() float64 {
				return t.count(context.Background(), `SELECT count(*) FROM ticketing.outbox WHERE delivered_at IS NULL`)
			}),
			prometheus.NewGaugeFunc(prometheus.GaugeOpts{
				Namespace: "x5", Subsystem: "outbox", Name: "oldest_pending_seconds",
				Help: "Age of the oldest undelivered outbox event.", ConstLabels: labels,
			}, func() float64 {
				return t.queryFloat(context.Background(), `SELECT COALESCE(EXTRACT(EPOCH FROM now()-min(occurred_at)),0)::float8 FROM ticketing.outbox WHERE delivered_at IS NULL`)
			}),
			prometheus.NewGaugeFunc(prometheus.GaugeOpts{
				Namespace: "x5", Subsystem: "inbox", Name: "unread_items",
				Help: "Unread notifications currently in the inbox.", ConstLabels: labels,
			}, func() float64 {
				return t.count(context.Background(), `SELECT count(*) FROM notifications.items WHERE read_at IS NULL`)
			}),
		)
	}
	return t
}

func (t *Telemetry) count(ctx context.Context, query string) float64 {
	if t == nil {
		return 0
	}
	var value int64
	if err := t.db().QueryRow(ctx, query).Scan(&value); err != nil {
		return 0
	}
	return float64(value)
}

func (t *Telemetry) queryFloat(ctx context.Context, query string) float64 {
	var value float64
	if err := t.db().QueryRow(ctx, query).Scan(&value); err != nil {
		return 0
	}
	return value
}

// db is kept separately from collectors so the helpers stay small.
func (t *Telemetry) db() *pgxpool.Pool { return t.pool }

func (t *Telemetry) Handler() http.Handler {
	return promhttp.HandlerFor(t.Registry, promhttp.HandlerOpts{})
}

// ObserveHTTP records one completed HTTP request.
func (t *Telemetry) ObserveHTTP(method, route string, status int, duration time.Duration, size int) {
	if t == nil {
		return
	}
	t.requests.WithLabelValues(method, route, fmt.Sprintf("%d", status)).Inc()
	t.requestLatency.WithLabelValues(method, route).Observe(duration.Seconds())
	t.responseBytes.WithLabelValues(route).Observe(float64(size))
}

// ObserveDelivery records one delivery polling iteration.
func (t *Telemetry) ObserveDelivery(count int, duration time.Duration, err error) {
	if t == nil {
		return
	}
	t.batchSize.Observe(float64(count))
	t.deliveryTime.Observe(duration.Seconds())
	if err != nil {
		t.deliveryErrors.Inc()
		t.deliveries.WithLabelValues("error").Add(float64(count))
		return
	}
	if count > 0 {
		t.deliveries.WithLabelValues("ok").Add(float64(count))
	}
	t.lastSuccess.SetToCurrentTime()
}

// SetInFlight is called by the HTTP middleware around the handler.
func (t *Telemetry) SetInFlight(delta float64) {
	if t != nil {
		t.inFlight.Add(delta)
	}
}
