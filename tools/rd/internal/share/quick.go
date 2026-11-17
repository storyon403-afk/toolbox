// Package share manages a foreground Quick Tunnel without accounts or domain setup.
package share

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"time"
)

// Config contains local process settings. OnReady runs only after a public health probe.
type Config struct {
	Binary         string
	Origin         string
	ConfigFile     string
	Log            io.Writer
	Verify         func(context.Context, string) error
	OnReady        func(string)
	StartupTimeout time.Duration
	RetryInterval  time.Duration
}

// Run owns exactly one child process. Cancellation, startup failure and unexpected
// child exit all reap it; it never installs a Windows service or edits global config.
func Run(ctx context.Context, c Config) error {
	if c.Verify == nil {
		return errors.New("a public readiness verifier is required")
	}
	if c.StartupTimeout == 0 {
		c.StartupTimeout = 90 * time.Second
	}
	if c.RetryInterval == 0 {
		c.RetryInterval = 2 * time.Second
	}
	childCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	output := &tunnelOutput{log: c.Log, urls: make(chan string, 1)}
	cmd := exec.CommandContext(childCtx, c.Binary, "tunnel", "--config", c.ConfigFile, "--no-autoupdate", "--protocol", "http2", "--url", c.Origin)
	cmd.Env = cleanEnvironment(os.Environ())
	cmd.Stdout = output
	cmd.Stderr = output
	cmd.WaitDelay = 3 * time.Second
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("cannot start bundled cloudflared: %w", err)
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	reaped := false
	defer func() {
		cancel()
		if !reaped {
			<-done
		}
	}()
	startupCtx, endStartup := context.WithTimeout(childCtx, c.StartupTimeout)
	defer endStartup()
	tick := time.NewTicker(c.RetryInterval)
	defer tick.Stop()
	origin := ""
	lastFailure := "Cloudflare has not assigned an address"
	for {
		select {
		case <-startupCtx.Done():
			if ctx.Err() != nil {
				return nil
			}
			return fmt.Errorf("public sharing could not connect within %s: %s; see share.log", c.StartupTimeout, lastFailure)
		case err := <-done:
			reaped = true
			if ctx.Err() != nil {
				return nil
			}
			return fmt.Errorf("cloudflared stopped before sharing was ready (%v); see share.log", err)
		case found := <-output.urls:
			origin = found
		case <-tick.C:
		}
		if origin == "" {
			continue
		}
		if err := c.Verify(startupCtx, origin); err != nil {
			lastFailure = err.Error()
			continue
		}
		if startupCtx.Err() != nil {
			continue
		}
		if c.OnReady != nil {
			c.OnReady(origin)
		}
		endStartup()
		select {
		case <-ctx.Done():
			return nil
		case err := <-done:
			reaped = true
			if ctx.Err() != nil {
				return nil
			}
			return fmt.Errorf("public sharing stopped because cloudflared exited (%v); restart Start-Share.cmd; see share.log", err)
		}
	}
}

// Keep existing named-tunnel credentials and environment settings out of this child.
func cleanEnvironment(env []string) []string {
	result := make([]string, 0, len(env))
	for _, entry := range env {
		key, _, _ := strings.Cut(entry, "=")
		key = strings.ToUpper(key)
		if strings.HasPrefix(key, "TUNNEL_") || strings.HasPrefix(key, "CLOUDFLARED_") {
			continue
		}
		result = append(result, entry)
	}
	return result
}

var urlPattern = regexp.MustCompile(`https://[^\s"<>|]+`)
var labelPattern = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`)

func quickURL(line string) string {
	for _, candidate := range urlPattern.FindAllString(line, -1) {
		candidate = strings.TrimRight(candidate, "),;]")
		u, err := url.Parse(candidate)
		if err != nil || u.Scheme != "https" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Port() != "" || (u.Path != "" && u.Path != "/") {
			continue
		}
		label, ok := strings.CutSuffix(u.Hostname(), ".trycloudflare.com")
		if ok && labelPattern.MatchString(label) {
			return "https://" + u.Hostname()
		}
	}
	return ""
}

type tunnelOutput struct {
	mu      sync.Mutex
	pending []byte
	log     io.Writer
	logged  int
	urls    chan string
}

func (w *tunnelOutput) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	// Retain a bounded startup/diagnostic log even during long reconnect storms.
	if w.log != nil && w.logged < 2<<20 {
		data := p
		if len(data) > (2<<20)-w.logged {
			data = data[:(2<<20)-w.logged]
		}
		n, _ := w.log.Write(data)
		w.logged += n
	}
	w.pending = append(w.pending, p...)
	for {
		index := bytes.IndexByte(w.pending, '\n')
		if index < 0 {
			break
		}
		if found := quickURL(string(w.pending[:index])); found != "" {
			select {
			case w.urls <- found:
			default:
			}
		}
		w.pending = w.pending[index+1:]
	}
	if len(w.pending) > 64<<10 {
		w.pending = nil
	}
	return len(p), nil
}

// VerifyHealth checks this specific service instance, not merely an HTTP 200 page.
func VerifyHealth(ctx context.Context, origin, instance string) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, origin+"/review/api/health", nil)
	if err != nil {
		return err
	}
	client := &http.Client{Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("public health request failed: %w", err)
	}
	defer response.Body.Close()
	var health struct {
		Instance string `json:"instance"`
	}
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("public health returned HTTP %d", response.StatusCode)
	}
	if err = json.NewDecoder(io.LimitReader(response.Body, 4096)).Decode(&health); err != nil || health.Instance != instance {
		return errors.New("public address has not reached this Pangzhu instance")
	}
	return nil
}
