package service

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"pangzhu"
)

func testService(t *testing.T) (*Service, string) {
	t.Helper()
	folder := t.TempDir()
	s, err := Open(folder, pangzhu.Assets, "https://review.example.com")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s, folder
}
func request(t *testing.T, s *Service, method, path string, body any, cookie bool, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	var data []byte
	if raw, ok := body.([]byte); ok {
		data = raw
	} else if body != nil {
		var err error
		data, err = json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
	}
	r := httptest.NewRequest(method, "http://127.0.0.1:8765"+path, bytes.NewReader(data))
	r.RemoteAddr = "127.0.0.1:44555"
	if cookie {
		r.AddCookie(&http.Cookie{Name: "pangzhu_owner", Value: s.key})
	}
	for k, v := range headers {
		if k == "Host" {
			r.Host = v
		} else {
			r.Header.Set(k, v)
		}
	}
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	return w
}
func requireStatus(t *testing.T, w *httptest.ResponseRecorder, status int) {
	t.Helper()
	if w.Code != status {
		t.Fatalf("status %d, want %d: %s", w.Code, status, w.Body.String())
	}
}
func state(t *testing.T, s *Service, owner bool) Snapshot {
	t.Helper()
	snap, err := s.snapshot(owner)
	if err != nil {
		t.Fatal(err)
	}
	return snap
}
func TestAuthorBoundary(t *testing.T) {
	s, _ := testService(t)
	w := request(t, s, "GET", "/", nil, false, nil)
	requireStatus(t, w, 200)
	if len(w.Result().Cookies()) != 1 {
		t.Fatal("direct local author did not receive a cookie")
	}
	for _, headers := range []map[string]string{
		{"Host": "review.example.com"}, {"Host": "attacker.invalid"}, {"X-Forwarded-For": "203.0.113.4"},
		{"CF-Connecting-IP": "203.0.113.4"}, {"Forwarded": "for=203.0.113.4"}, {"X-Forwarded-Host": "localhost"},
		{"CF-Ray": "test"}, {"Sec-Fetch-Site": "cross-site"},
	} {
		w = request(t, s, "GET", "/", nil, false, headers)
		if len(w.Result().Cookies()) != 0 {
			t.Fatalf("proxy/cross-site bootstrap: %v", headers)
		}
		if headers["Sec-Fetch-Site"] == "" {
			requireStatus(t, request(t, s, "POST", "/api/publish", map[string]any{}, true, headers), 403)
		}
	}
	for _, path := range []string{"/review/api/publish", "/review/api/resolve"} {
		requireStatus(t, request(t, s, "POST", path, map[string]any{}, true, nil), 403)
	}
	for _, headers := range []map[string]string{{"Origin": "https://attacker.invalid"}, {"Sec-Fetch-Site": "cross-site"}, {"Origin": "null"}} {
		requireStatus(t, request(t, s, "POST", "/api/commits", map[string]any{}, false, headers), 403)
	}
	w = request(t, s, "GET", "/review/api/state", nil, true, nil)
	var snap Snapshot
	if err := json.Unmarshal(w.Body.Bytes(), &snap); err != nil {
		t.Fatal(err)
	}
	if snap.IsOwner || snap.ReviewURL != "https://review.example.com/review" {
		t.Fatal("invalid reviewer state")
	}
	r := httptest.NewRequest("GET", "http://127.0.0.1:8765/", nil)
	r.RemoteAddr = "192.168.1.20:12345"
	w = httptest.NewRecorder()
	s.ServeHTTP(w, r)
	if len(w.Result().Cookies()) != 0 {
		t.Fatal("LAN client granted author")
	}
	requireStatus(t, request(t, s, "GET", "/../data/owner.key", nil, false, nil), 404)
}
func TestVersionsTransactionsAndPersistence(t *testing.T) {
	s, folder := testService(t)
	d := state(t, s, true).Versions[0]
	p := publishRequest{BaseVersion: d.Version, Title: "Example 🌿", TitleSize: 38, Blocks: []Block{{ID: "b1", Type: "p", Font: "serif", Size: 18, Text: "A🌿BC"}}}
	requireStatus(t, request(t, s, "POST", "/api/publish", p, true, nil), 200)
	requireStatus(t, request(t, s, "POST", "/api/publish", p, true, nil), 409)
	n := Note{Version: 2, BlockID: "b1", Quote: "🌿", Start: 1, End: 3, Body: "Keep the emoji"}
	c := commitRequest{RequestKey: "retry-me", Author: "Reader", Message: "Suggestion", ReviewerID: "browser-1", Notes: []Note{n}}
	w := request(t, s, "POST", "/review/api/commits", c, false, nil)
	requireStatus(t, w, 200)
	var first map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &first)
	w = request(t, s, "POST", "/review/api/commits", c, false, nil)
	requireStatus(t, w, 200)
	var retry map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &retry)
	if first["id"] != retry["id"] || retry["duplicate"] != true {
		t.Fatal("retry created duplicate")
	}
	bad := n
	bad.Quote = "wrong"
	c.RequestKey = "atomic-failure"
	c.Notes = []Note{n, bad}
	requireStatus(t, request(t, s, "POST", "/review/api/commits", c, false, nil), 409)
	if len(state(t, s, true).Commits) != 1 {
		t.Fatal("partial feedback saved")
	}
	bad = n
	bad.Start = 2
	bad.Quote = "�"
	c.Notes = []Note{bad}
	requireStatus(t, request(t, s, "POST", "/review/api/commits", c, false, nil), 400)
	snap := state(t, s, true)
	id := snap.Commits[0].Notes[0].ID
	requireStatus(t, request(t, s, "POST", "/api/resolve", map[string]any{"id": id, "resolved": true}, true, nil), 200)
	p.BaseVersion = 2
	p.Title = "Third version"
	requireStatus(t, request(t, s, "POST", "/api/publish", p, true, nil), 200)
	public := state(t, s, false)
	if len(public.Versions) != 1 || public.Versions[0].Version != 3 || len(public.Commits) != 0 {
		t.Fatal("history leaked to reviewers")
	}
	c.RequestKey = "stale-version"
	c.Notes = []Note{n}
	requireStatus(t, request(t, s, "POST", "/review/api/commits", c, false, nil), 409)
	c.RequestKey = "retry-me"
	requireStatus(t, request(t, s, "POST", "/review/api/commits", c, false, nil), 200)
	key := s.key
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	restored, err := Open(folder, pangzhu.Assets, "")
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	snap = state(t, restored, true)
	if restored.key != key || len(snap.Versions) != 3 || len(snap.Commits) != 1 || !snap.Commits[0].Notes[0].Resolved {
		t.Fatal("persistence mismatch")
	}
}
func TestMalformedAndConcurrentWrites(t *testing.T) {
	s, _ := testService(t)
	for _, raw := range []string{"null", "[]", "{}", "{", "{\"notes\":[null]}", "{\"titleSize\":true}"} {
		w := request(t, s, "POST", "/api/publish", []byte(raw), true, nil)
		if w.Code != 400 {
			t.Fatalf("malformed body returned %d: %s", w.Code, raw)
		}
	}
	requireStatus(t, request(t, s, "POST", "/api/commits", []byte(strings.Repeat("x", 1_000_001)), false, nil), 413)
	p := publishRequest{BaseVersion: 1, Title: "Concurrent", TitleSize: 38, Blocks: []Block{{ID: "b1", Type: "p", Font: "serif", Size: 18, Text: "Hello"}}}
	var group sync.WaitGroup
	codes := make(chan int, 8)
	for i := 0; i < 8; i++ {
		group.Add(1)
		go func() { defer group.Done(); codes <- request(t, s, "POST", "/api/publish", p, true, nil).Code }()
	}
	group.Wait()
	close(codes)
	success := 0
	for code := range codes {
		if code == 200 {
			success++
		} else if code != 409 {
			t.Fatalf("unexpected concurrent status %d", code)
		}
	}
	if success != 1 || len(state(t, s, true).Versions) != 2 {
		t.Fatal("concurrent publish lost conflict protection")
	}
}
func TestLegacySchemaMigration(t *testing.T) {
	folder := t.TempDir()
	db, err := sql.Open("sqlite", filepath.Join(folder, "pangzhu.sqlite3"))
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`CREATE TABLE commits(id TEXT PRIMARY KEY,request_key TEXT UNIQUE NOT NULL,parent_id TEXT,based_on TEXT,author TEXT NOT NULL,message TEXT NOT NULL,created_at TEXT NOT NULL); INSERT INTO commits VALUES('old','old-key',NULL,NULL,'Reader','Legacy','2026-01-01');`)
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
	key := "a-compatible-existing-owner-key-1234567890"
	if err = os.WriteFile(filepath.Join(folder, "owner.key"), []byte(key), 0600); err != nil {
		t.Fatal(err)
	}
	s, err := Open(folder, pangzhu.Assets, "")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	snap := state(t, s, true)
	if s.key != key || len(snap.Commits) != 1 || snap.Commits[0].ReviewerID != "" {
		t.Fatal("legacy data lost")
	}
}
func TestSSEDisconnect(t *testing.T) {
	s, _ := testService(t)
	server := httptest.NewServer(s)
	defer server.Close()
	resp, err := http.Get(server.URL + "/review/api/events")
	if err != nil {
		t.Fatal(err)
	}
	if resp.Header.Get("Content-Type") != "text/event-stream" {
		t.Fatal("wrong stream type")
	}
	b := make([]byte, len("data: 0\n\n"))
	if _, err = io.ReadFull(resp.Body, b); err != nil {
		t.Fatal(err)
	}
	if string(b) != "data: 0\n\n" {
		t.Fatal("missing initial event")
	}
	resp.Body.Close()
}

func TestQuickSharingMetadataAndHealth(t *testing.T) {
	s, _ := testService(t)
	w := request(t, s, "GET", "/review/api/health", nil, true, map[string]string{"CF-Connecting-IP": "203.0.113.4"})
	requireStatus(t, w, 200)
	var health map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &health); err != nil {
		t.Fatal(err)
	}
	if len(health) != 1 || health["instance"] != s.InstanceID() || health["instance"] == s.key || len(w.Result().Cookies()) > 0 {
		t.Fatal("health endpoint leaked credentials or bootstrapped author")
	}
	s.SetPublicURL("https://fixture-sharing.trycloudflare.com")
	snap := state(t, s, false)
	if snap.SyncMode != "poll" || snap.ReviewURL != "https://fixture-sharing.trycloudflare.com/review" || snap.IsOwner {
		t.Fatal("incorrect quick sharing metadata")
	}
	requireStatus(t, request(t, s, "POST", "/api/share", map[string]string{"url": "https://attacker.example"}, true, nil), 404)
	s.SetPublicURL("")
	snap = state(t, s, false)
	if snap.ReviewURL != "" || snap.SyncMode != "" {
		t.Fatal("stale link after tunnel exit")
	}
}
