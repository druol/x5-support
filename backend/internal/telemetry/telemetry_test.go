package telemetry

import (
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestHandlerExposesBuildAndHTTPMetrics(t *testing.T) {
	tel := New("api", "test", "v1", "c1", nil)
	tel.ObserveHTTP("GET", "/api/user/tickets", 200, 12*time.Millisecond, 128)

	req := httptest.NewRequest("GET", "/metrics", nil)
	rec := httptest.NewRecorder()
	tel.Handler().ServeHTTP(rec, req)

	body := rec.Body.String()
	for _, want := range []string{
		`x5_build_info{commit="c1",env="test",go_version=`,
		`x5_http_requests_total{env="test",method="GET",route="/api/user/tickets",service="api",status="200"} 1`,
		`x5_http_request_duration_seconds_count{env="test",method="GET",route="/api/user/tickets",service="api"} 1`,
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("metrics output missing %q\n%s", want, body)
		}
	}
}

func TestDeliveryMetricsOnlyOnWorker(t *testing.T) {
	api := New("api", "test", "v1", "c1", nil)
	worker := New("notifications", "test", "v1", "c1", nil)

	apiReq := httptest.NewRequest("GET", "/metrics", nil)
	apiRec := httptest.NewRecorder()
	api.Handler().ServeHTTP(apiRec, apiReq)
	if strings.Contains(apiRec.Body.String(), "x5_notifications_delivered_total") {
		t.Fatal("API service must not expose notification delivery metrics")
	}

	worker.ObserveDelivery(3, 5*time.Millisecond, nil)
	workerReq := httptest.NewRequest("GET", "/metrics", nil)
	workerRec := httptest.NewRecorder()
	worker.Handler().ServeHTTP(workerRec, workerReq)
	if !strings.Contains(workerRec.Body.String(), `x5_notifications_delivered_total{env="test",result="ok",service="notifications"} 3`) {
		t.Fatalf("worker metrics missing delivery counter\n%s", workerRec.Body.String())
	}
}
