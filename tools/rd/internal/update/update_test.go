package update

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestMain(m *testing.M) {
	Repository = "test-owner/rd-fixture"
	os.Exit(m.Run())
}

type transport func(*http.Request) (*http.Response, error)

func (f transport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func manager(t *testing.T) *Manager                                   { t.Helper(); return New(t.TempDir(), "darwin", "arm64", "0.1.0") }
func metadata(m *Manager, data []byte) []byte {
	hash := sha256.Sum256(data)
	b, _ := json.Marshal(map[string]any{"tag_name": "v0.2.0", "draft": false, "prerelease": false, "assets": []map[string]any{{"name": m.packageName("0.2.0") + ".zip", "browser_download_url": "https://github.com/" + Repository + "/releases/download/v0.2.0/" + m.packageName("0.2.0") + ".zip", "digest": "sha256:" + hex.EncodeToString(hash[:]), "size": len(data)}}})
	return b
}
func archive(t *testing.T, m *Manager, extra map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	z := zip.NewWriter(&buf)
	manifest, _ := json.Marshal(Manifest{"0.2.0", Repository, m.OS, m.Arch})
	files := map[string]string{m.binary(): "new-binary", "cloudflared": "connector", "release.json": string(manifest), "licenses/NOTICE.txt": "license"}
	for k, v := range extra {
		if v == "<remove>" {
			delete(files, k)
		} else {
			files[k] = v
		}
	}
	for k, v := range files {
		w, err := z.Create(m.packageName("0.2.0") + "/" + k)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = w.Write([]byte(v)); err != nil {
			t.Fatal(err)
		}
	}
	if err := z.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}
func response(status int, body []byte) *http.Response {
	return &http.Response{StatusCode: status, Body: io.NopCloser(bytes.NewReader(body)), Header: make(http.Header)}
}
func TestVersionAndFeed(t *testing.T) {
	m := manager(t)
	for _, bad := range []string{"", "dev", "1.2", "1.2.3-beta", "01.2.3", "1.2.1000000", "../../1.2.3"} {
		if _, err := version(bad); err == nil {
			t.Errorf("accepted %q", bad)
		}
	}
	for _, pair := range [][2]string{{"0.10.0", "0.9.9"}, {"v1.0.0", "0.99.99"}} {
		if !newer(pair[0], pair[1]) {
			t.Fatal(pair)
		}
	}
	if newer("0.1.0", "0.1.0") || newer("0.0.9", "0.1.0") {
		t.Fatal("downgrade accepted")
	}
	good := metadata(m, []byte("archive"))
	c, err := m.parse(good)
	if err != nil || c == nil {
		t.Fatal(c, err)
	}
	for _, change := range []func(map[string]any){
		func(r map[string]any) { r["draft"] = true }, func(r map[string]any) { r["prerelease"] = true },
		func(r map[string]any) { r["tag_name"] = "../../1.0.0" },
		func(r map[string]any) { r["assets"].([]any)[0].(map[string]any)["digest"] = "" },
		func(r map[string]any) {
			r["assets"].([]any)[0].(map[string]any)["digest"] = "sha256:" + strings.Repeat("z", 64)
		},
		func(r map[string]any) {
			r["assets"].([]any)[0].(map[string]any)["browser_download_url"] = "https://github.com/attacker/RD/releases/download/v0.2.0/app.zip"
		},
		func(r map[string]any) { r["assets"].([]any)[0].(map[string]any)["size"] = maxArchive + 1 },
		func(r map[string]any) { r["assets"].([]any)[0].(map[string]any)["name"] = "wrong-platform.zip" },
	} {
		var r map[string]any
		_ = json.Unmarshal(good, &r)
		change(r)
		b, _ := json.Marshal(r)
		if _, err := m.parse(b); err == nil {
			t.Fatalf("accepted %s", b)
		}
	}
}
func TestStageAndRestartPreserveData(t *testing.T) {
	m := manager(t)
	z := archive(t, m, nil)
	calls := 0
	m.Client.Transport = transport(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.Host == "api.github.com" {
			return response(200, metadata(m, z)), nil
		}
		return response(200, z), nil
	})
	if err := os.Mkdir(filepath.Join(m.Root, "data"), 0700); err != nil {
		t.Fatal(err)
	}
	data := filepath.Join(m.Root, "data", "sentinel")
	_ = os.WriteFile(data, []byte("private"), 0600)
	message, err := m.Check(context.Background(), true, true)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(message, "next launch") {
		t.Fatal(message)
	}
	target, err := m.Target()
	if err != nil || target != filepath.Join(m.folder(), "v0.2.0", "pangzhu") {
		t.Fatal(target, err)
	}
	content, _ := os.ReadFile(data)
	if string(content) != "private" {
		t.Fatal("data changed")
	}
	m2 := New(m.Root, m.OS, m.Arch, m.Current)
	m2.Client = m.Client
	if _, err := m2.Check(context.Background(), true, false); err != nil {
		t.Fatal(err)
	}
	if calls != 2 {
		t.Fatal("restart ignored daily interval", calls)
	}
	m2.Current = "0.2.0"
	if target, err := m2.Target(); target != "" || err != nil {
		t.Fatal("dispatch loop", target, err)
	}
	m2.Current = "0.3.0"
	if target, _ := m2.Target(); target != "" {
		t.Fatal("downgrade")
	}
}
func TestFailureAndCheckOnly(t *testing.T) {
	for _, status := range []int{404, 403, 429, 500} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			m := manager(t)
			calls := 0
			m.Client.Transport = transport(func(r *http.Request) (*http.Response, error) { calls++; return response(status, nil), nil })
			if _, err := m.Check(context.Background(), true, false); err == nil {
				t.Fatal("expected HTTP error")
			}
			m2 := New(m.Root, m.OS, m.Arch, m.Current)
			m2.Client = m.Client
			if _, err := m2.Check(context.Background(), true, false); err != nil || calls != 1 {
				t.Fatal(err, calls)
			}
			if m.readState().Error == "" {
				t.Fatal("failure not persisted")
			}
		})
	}
	m := manager(t)
	z := archive(t, m, nil)
	calls := 0
	m.Client.Transport = transport(func(r *http.Request) (*http.Response, error) { calls++; return response(200, metadata(m, z)), nil })
	if _, err := m.Check(context.Background(), false, true); err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Fatal("check-only downloaded")
	}
	if target, err := m.Target(); target != "" || err != nil {
		t.Fatal(target, err)
	}
}
func TestFailedDownloadNeverActivates(t *testing.T) {
	m := manager(t)
	z := archive(t, m, nil)
	m.Client.Transport = transport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Host == "api.github.com" {
			return response(200, metadata(m, z)), nil
		}
		return response(200, []byte("corrupt")), nil
	})
	if _, err := m.Check(context.Background(), true, true); err == nil {
		t.Fatal("checksum mismatch accepted")
	}
	if target, err := m.Target(); target != "" || err != nil {
		t.Fatal(target, err)
	}
	entries, _ := os.ReadDir(m.folder())
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".stage-") {
			t.Fatal("partial stage leaked")
		}
	}
}
func TestUnsafeArchives(t *testing.T) {
	cases := []map[string]string{{"../escape": "x"}, {"data/owner.key": "x"}, {`licenses\evil`: "x"}, {"/absolute": "x"}, {"licenses/../../escape": "x"}, {"README.md": "a", "readme.md": "b"}, {"release.json": "{}"}, {"pangzhu": "<remove>"}, {"cloudflared": "<remove>"}}
	for _, extra := range cases {
		m := manager(t)
		p := filepath.Join(t.TempDir(), "a.zip")
		_ = os.WriteFile(p, archive(t, m, extra), 0600)
		if err := m.extract(p, filepath.Join(t.TempDir(), "out"), "0.2.0"); err == nil {
			t.Fatal("accepted", extra)
		}
	}
	m := manager(t)
	var buf bytes.Buffer
	z := zip.NewWriter(&buf)
	h := &zip.FileHeader{Name: m.packageName("0.2.0") + "/pangzhu"}
	h.SetMode(os.ModeSymlink | 0777)
	w, _ := z.CreateHeader(h)
	_, _ = w.Write([]byte("/tmp/evil"))
	_ = z.Close()
	p := filepath.Join(t.TempDir(), "symlink.zip")
	_ = os.WriteFile(p, buf.Bytes(), 0600)
	if err := m.extract(p, t.TempDir(), "0.2.0"); err == nil {
		t.Fatal("accepted symlink")
	}
}
func TestCancellationRedirectAndLock(t *testing.T) {
	m := manager(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	m.Client.Transport = transport(func(r *http.Request) (*http.Response, error) { return nil, r.Context().Err() })
	if _, err := m.Check(ctx, true, true); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	for _, address := range []string{"http://github.com/a", "https://evil.example/a", "https://github.com:443/a", "https://user@github.com/a"} {
		r, _ := http.NewRequest("GET", address, nil)
		if err := m.Client.CheckRedirect(r, nil); err == nil {
			t.Fatal("accepted redirect", address)
		}
	}
	unlock, err := m.Lock()
	if err != nil {
		t.Fatal(err)
	}
	if unlock2, err := m.Lock(); err == nil {
		unlock2()
		t.Fatal("concurrent updater lock accepted")
	}
	unlock()
	unlock, err = m.Lock()
	if err != nil {
		t.Fatal(err)
	}
	unlock()
}
func TestClockCorrectionAndInvalidPointer(t *testing.T) {
	m := manager(t)
	_ = os.MkdirAll(m.folder(), 0700)
	_ = atomicJSON(filepath.Join(m.folder(), "state.json"), State{LastAttempt: time.Now().Add(48 * time.Hour)})
	calls := 0
	m.Client.Transport = transport(func(r *http.Request) (*http.Response, error) { calls++; return response(404, nil), nil })
	_, _ = m.Check(context.Background(), true, false)
	if calls != 1 {
		t.Fatal("future timestamp blocked checks")
	}
	_ = atomicJSON(filepath.Join(m.folder(), "current.json"), Manifest{"../../outside", Repository, m.OS, m.Arch})
	if _, err := m.Target(); err == nil {
		t.Fatal("unsafe pointer accepted")
	}
}

func TestUnconfiguredRepositoryNeverRequestsOrStages(t *testing.T) {
	previous := Repository
	Repository = ""
	defer func() { Repository = previous }()
	root := t.TempDir()
	m := New(root, "windows", "amd64", "0.2.2")
	message, err := m.Check(context.Background(), true, true)
	if err != nil || !strings.Contains(message, "not configured") {
		t.Fatalf("unexpected result: %q %v", message, err)
	}
	if _, err := os.Stat(filepath.Join(root, ".updates")); !os.IsNotExist(err) {
		t.Fatalf("unconfigured update created state: %v", err)
	}
}
