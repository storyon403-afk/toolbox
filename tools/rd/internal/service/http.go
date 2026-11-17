package service

import (
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// A loopback peer alone is insufficient: cloudflared also connects over loopback.
// Author sessions require a direct local host AND no proxy headers, on every request.
func directLocal(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.Host)
	if err != nil {
		host = r.Host
	}
	if host != "127.0.0.1" && host != "localhost" && host != "[::1]" && host != "::1" {
		return false
	}
	peer, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return false
	}
	ip := net.ParseIP(peer)
	if ip == nil || !ip.IsLoopback() {
		return false
	}
	for key := range r.Header {
		key = strings.ToLower(key)
		if key == "forwarded" || strings.HasPrefix(key, "x-forwarded-") || strings.HasPrefix(key, "cf-") {
			return false
		}
	}
	return true
}
func (s *Service) owner(r *http.Request) bool {
	if strings.HasPrefix(r.URL.Path, "/review/") || !directLocal(r) {
		return false
	}
	cookie, err := r.Cookie("pangzhu_owner")
	return err == nil && subtle.ConstantTimeCompare([]byte(cookie.Value), []byte(s.key)) == 1
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func writeError(w http.ResponseWriter, err error) {
	status, message := publicError(err)
	writeJSON(w, status, map[string]string{"error": message})
}
func (s *Service) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Referrer-Policy", "same-origin")
	w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
	route := r.URL.Path
	if strings.HasPrefix(route, "/review/api/") {
		route = strings.TrimPrefix(route, "/review")
	}
	if r.Method == http.MethodGet {
		switch route {
		case "/api/health":
			writeJSON(w, 200, map[string]string{"instance": s.instance})
			return
		case "/api/state":
			snapshot, err := s.snapshot(s.owner(r))
			if err != nil {
				writeError(w, err)
				return
			}
			writeJSON(w, 200, snapshot)
			return
		case "/api/events":
			s.events(w, r)
			return
		}
		name, mime := "", ""
		switch route {
		case "/", "/index.html", "/review", "/review/":
			name = "index.html"
			mime = "text/html; charset=utf-8"
		case "/app.js":
			name = "app.js"
			mime = "text/javascript; charset=utf-8"
		case "/style.css":
			name = "style.css"
			mime = "text/css; charset=utf-8"
		default:
			writeError(w, fail(404, "Not found"))
			return
		}
		body, err := fs.ReadFile(s.assets, "design/"+name)
		if err != nil {
			writeError(w, err)
			return
		}
		site := r.Header.Get("Sec-Fetch-Site")
		if (route == "/" || route == "/index.html") && directLocal(r) && !r.URL.Query().Has("review") && (site == "" || site == "none" || site == "same-origin") {
			http.SetCookie(w, &http.Cookie{Name: "pangzhu_owner", Value: s.key, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode, MaxAge: 31536000})
		}
		w.Header().Set("Content-Type", mime)
		_, _ = w.Write(body)
		return
	}
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "GET, POST")
		writeError(w, fail(405, "Method not allowed"))
		return
	}
	if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
		writeError(w, fail(403, "Cross-site writes are not allowed"))
		return
	}
	if origin := r.Header.Get("Origin"); origin != "" {
		u, err := url.Parse(origin)
		if err != nil || u.Host != r.Host || (u.Scheme != "http" && u.Scheme != "https") {
			writeError(w, fail(403, "Origin does not match"))
			return
		}
	}
	owner := s.owner(r)
	if (route == "/api/publish" || route == "/api/resolve") && !owner {
		writeError(w, fail(403, "Only the local author can perform this action"))
		return
	}
	_ = http.NewResponseController(w).SetReadDeadline(time.Now().Add(15 * time.Second))
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1_000_000))
	if err != nil {
		writeError(w, fail(413, "Request body is too large or incomplete"))
		return
	}
	s.mu.Lock()
	var result any
	switch route {
	case "/api/publish":
		result, err = s.publish(body)
	case "/api/commits":
		result, err = s.commit(body, owner)
	case "/api/resolve":
		result, err = s.resolve(body)
	default:
		err = fail(404, "Not found")
	}
	if err == nil {
		s.sequence++
		for listener := range s.listeners {
			select {
			case listener <- s.sequence:
			default:
			}
		}
	}
	s.mu.Unlock()
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 200, result)
}
func (s *Service) events(w http.ResponseWriter, r *http.Request) {
	listener := make(chan uint64, 1)
	s.mu.Lock()
	if len(s.listeners) >= 128 {
		s.mu.Unlock()
		writeError(w, fail(503, "Too many live connections; please retry"))
		return
	}
	s.listeners[listener] = struct{}{}
	seq := s.sequence
	s.mu.Unlock()
	defer func() { s.mu.Lock(); delete(s.listeners, listener); s.mu.Unlock() }()
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	controller := http.NewResponseController(w)
	send := func(message string) error {
		_ = controller.SetWriteDeadline(time.Now().Add(10 * time.Second))
		if _, err := io.WriteString(w, message); err != nil {
			return err
		}
		return controller.Flush()
	}
	if send(fmt.Sprintf("data: %d\n\n", seq)) != nil {
		return
	}
	tick := time.NewTicker(15 * time.Second)
	defer tick.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case seq = <-listener:
			if send(fmt.Sprintf("data: %d\n\n", seq)) != nil {
				return
			}
		case <-tick.C:
			if send(": keepalive\n\n") != nil {
				return
			}
		}
	}
}
