package share

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// Reuse the test executable as a cross-platform fake cloudflared process.
// It never contacts Cloudflare or publishes any local service.
func TestMain(m *testing.M) {
	if mode := os.Getenv("PANGZHU_SHARE_TEST_CHILD"); mode != "" {
		if os.Getenv("TUNNEL_TOKEN") != "" || os.Getenv("CLOUDFLARED_CONFIG") != "" {
			os.Exit(17)
		}
		args := strings.Join(os.Args[1:], " ")
		if !strings.Contains(args, "--protocol http2") || !strings.Contains(args, "--config") || !strings.Contains(args, "--url http://127.0.0.1:8765") {
			os.Exit(18)
		}
		if mode == "fail" {
			fmt.Fprintln(os.Stderr, "simulated network failure")
			os.Exit(2)
		}
		if mode != "silent" {
			fmt.Fprint(os.Stderr, "| https://fixture-")
			time.Sleep(10 * time.Millisecond)
			fmt.Fprintln(os.Stderr, "sharing.trycloudflare.com |")
		}
		if mode == "exit" {
			time.Sleep(100 * time.Millisecond)
			os.Exit(3)
		}
		for {
			time.Sleep(time.Second)
		}
	}
	os.Exit(m.Run())
}
func fixture(t *testing.T, mode string) Config {
	t.Helper()
	t.Setenv("PANGZHU_SHARE_TEST_CHILD", mode)
	t.Setenv("TUNNEL_TOKEN", "must-not-be-inherited")
	t.Setenv("CLOUDFLARED_CONFIG", "must-not-be-used")
	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	return Config{Binary: binary, Origin: "http://127.0.0.1:8765", ConfigFile: "isolated.yml", StartupTimeout: 3 * time.Second, RetryInterval: 10 * time.Millisecond}
}
func TestQuickURLParsing(t *testing.T) {
	for _, line := range []string{
		"https://attacker.example", "https://test.trycloudflare.com.attacker.example", "https://nested.test.trycloudflare.com",
		"https://test.trycloudflare.com/path", "https://user@test.trycloudflare.com", "https://test.trycloudflare.com:443",
		"https://test.trycloudflare.com?redirect=1", "https://-test.trycloudflare.com", "https://trycloudflare.com",
	} {
		if got := quickURL(line); got != "" {
			t.Errorf("accepted %q as %q", line, got)
		}
	}
	if got := quickURL(`{"message":"| https://valid-link.trycloudflare.com |"}`); got != "https://valid-link.trycloudflare.com" {
		t.Fatal(got)
	}
}
func TestReadyRequiresReachabilityAndCancellationReapsChild(t *testing.T) {
	c := fixture(t, "wait")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	attempts := 0
	ready := false
	c.Verify = func(_ context.Context, origin string) error {
		attempts++
		if origin != "https://fixture-sharing.trycloudflare.com" {
			t.Fatal(origin)
		}
		if attempts < 3 {
			return fmt.Errorf("not reachable yet")
		}
		return nil
	}
	c.OnReady = func(string) { ready = true; cancel() }
	if err := Run(ctx, c); err != nil {
		t.Fatal(err)
	}
	if !ready || attempts != 3 {
		t.Fatalf("ready=%v attempts=%d", ready, attempts)
	}
}
func TestStartupFailuresNeverAdvertiseReady(t *testing.T) {
	for _, mode := range []string{"fail", "silent", "wait"} {
		t.Run(mode, func(t *testing.T) {
			c := fixture(t, mode)
			c.StartupTimeout = 150 * time.Millisecond
			c.Verify = func(context.Context, string) error { return fmt.Errorf("probe failed") }
			c.OnReady = func(string) { t.Fatal("advertised an unverified link") }
			if err := Run(context.Background(), c); err == nil {
				t.Fatal("expected startup failure")
			}
		})
	}
}
func TestUnexpectedExitIsReported(t *testing.T) {
	c := fixture(t, "exit")
	ready := false
	c.Verify = func(context.Context, string) error { return nil }
	c.OnReady = func(string) { ready = true }
	err := Run(context.Background(), c)
	if err == nil || !ready || !strings.Contains(err.Error(), "public sharing stopped") {
		t.Fatalf("ready=%v err=%v", ready, err)
	}
}
func TestVerifyHealthRejectsWrongServiceAndRedirect(t *testing.T) {
	var mode atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/review/api/health" {
			t.Error(r.URL.Path)
		}
		switch mode.Load() {
		case 0:
			fmt.Fprint(w, `{"instance":"expected"}`)
		case 1:
			fmt.Fprint(w, `{"instance":"different"}`)
		case 2:
			http.Redirect(w, r, "/redirect", 302)
		case 3:
			w.WriteHeader(502)
		case 4:
			fmt.Fprint(w, "not JSON")
		}
	}))
	defer server.Close()
	if err := VerifyHealth(context.Background(), server.URL, "expected"); err != nil {
		t.Fatal(err)
	}
	for _, value := range []int32{1, 2, 3, 4} {
		mode.Store(value)
		if VerifyHealth(context.Background(), server.URL, "expected") == nil {
			t.Fatalf("accepted mode %d", value)
		}
	}
}
