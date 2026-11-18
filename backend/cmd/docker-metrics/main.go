// Command docker-metrics exposes a small, dependency-free Prometheus view of
// Docker containers. It is used instead of cAdvisor, whose amd64 image is not
// available on the offline production host.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"strings"
	"time"
)

type container struct {
	ID    string   `json:"Id"`
	Names []string `json:"Names"`
	State string   `json:"State"`
}

type stats struct {
	CPUStats struct {
		CPUUsage struct {
			TotalUsage uint64 `json:"total_usage"`
		} `json:"cpu_usage"`
	} `json:"cpu_stats"`
	MemoryStats struct {
		Usage uint64 `json:"usage"`
		Limit uint64 `json:"limit"`
	} `json:"memory_stats"`
}

var docker = &http.Client{
	Transport: &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "unix", "/var/run/docker.sock")
		},
	},
	Timeout: 3 * time.Second,
}

func dockerJSON(ctx context.Context, path string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://docker"+path, nil)
	if err != nil {
		return nil, err
	}
	resp, err := docker.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("docker API %s: %s", path, resp.Status)
	}
	var buf []byte
	dec := json.NewDecoder(resp.Body)
	var raw json.RawMessage
	if err := dec.Decode(&raw); err != nil {
		return nil, err
	}
	buf = raw
	return buf, nil
}

func metricName(raw string) string {
	raw = strings.TrimPrefix(raw, "/")
	return strings.NewReplacer("\\", "_", "\"", "_", "\n", "_").Replace(raw)
}

func metrics(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	w.Header().Set("Content-Type", "text/plain; version=0.0.4")
	var list []container
	body, err := dockerJSON(ctx, "/containers/json?all=0")
	if err != nil {
		fmt.Fprintf(w, "# HELP x5_docker_scrape_error Docker API scrape failed.\n# TYPE x5_docker_scrape_error gauge\nx5_docker_scrape_error 1\n")
		return
	}
	if err := json.Unmarshal(body, &list); err != nil {
		fmt.Fprintf(w, "x5_docker_scrape_error 1\n")
		return
	}
	fmt.Fprintf(w, "# HELP x5_docker_containers_running Running Docker containers.\n# TYPE x5_docker_containers_running gauge\nx5_docker_containers_running %d\n", len(list))
	fmt.Fprintf(w, "# HELP x5_docker_container_cpu_seconds_total Cumulative container CPU time.\n# TYPE x5_docker_container_cpu_seconds_total counter\n")
	fmt.Fprintf(w, "# HELP x5_docker_container_memory_bytes Container memory usage.\n# TYPE x5_docker_container_memory_bytes gauge\n")
	fmt.Fprintf(w, "# HELP x5_docker_container_memory_limit_bytes Container memory limit.\n# TYPE x5_docker_container_memory_limit_bytes gauge\n")
	for _, c := range list {
		st, err := dockerJSON(ctx, "/containers/"+c.ID+"/stats?stream=false")
		if err != nil {
			continue
		}
		var s stats
		if json.Unmarshal(st, &s) != nil {
			continue
		}
		name := c.ID[:12]
		if len(c.Names) > 0 {
			name = metricName(c.Names[0])
		}
		fmt.Fprintf(w, "x5_docker_container_cpu_seconds_total{container=%q} %.6f\n", name, float64(s.CPUStats.CPUUsage.TotalUsage)/1e9)
		fmt.Fprintf(w, "x5_docker_container_memory_bytes{container=%q} %d\n", name, s.MemoryStats.Usage)
		fmt.Fprintf(w, "x5_docker_container_memory_limit_bytes{container=%q} %d\n", name, s.MemoryStats.Limit)
	}
}

func main() {
	http.HandleFunc("/metrics", metrics)
	http.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("ok")) })
	log.Println("docker-metrics listening on :9101")
	log.Fatal(http.ListenAndServe(":9101", nil))
}
