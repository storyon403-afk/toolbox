// Package update stages verified official releases without interrupting readers.
package update

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Version is set by the release build. Development binaries never check online.
var Version = "dev"

// Repository may be overridden at release build time; empty disables online updates.
var Repository = ""

const interval = 24 * time.Hour
const maxArchive = 160 << 20
const maxExpanded = 400 << 20

var versionPattern = regexp.MustCompile(`^v?(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$`)

func version(s string) ([3]int, error) {
	var result [3]int
	m := versionPattern.FindStringSubmatch(s)
	if m == nil {
		return result, fmt.Errorf("invalid stable version: %q", s)
	}
	for i := range result {
		result[i], _ = strconv.Atoi(m[i+1])
	}
	return result, nil
}

func newer(candidate, current string) bool {
	a, e1 := version(candidate)
	b, e2 := version(current)
	if e1 != nil || e2 != nil {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return a[i] > b[i]
		}
	}
	return false
}

type Manifest struct {
	Version    string `json:"version"`
	Repository string `json:"repository"`
	OS         string `json:"os"`
	Arch       string `json:"arch"`
}

type release struct {
	Tag        string `json:"tag_name"`
	Draft      bool   `json:"draft"`
	Prerelease bool   `json:"prerelease"`
	Assets     []struct {
		Name   string `json:"name"`
		URL    string `json:"browser_download_url"`
		Digest string `json:"digest"`
		Size   int64  `json:"size"`
	} `json:"assets"`
}

type Candidate struct{ Version, URL, SHA256 string }
type State struct {
	LastAttempt time.Time `json:"last_attempt"`
	Available   string    `json:"available,omitempty"`
	Ready       string    `json:"ready,omitempty"`
	Error       string    `json:"error,omitempty"`
}
type Manager struct {
	Root, OS, Arch, Current string
	Client                  *http.Client
}

func New(root, goos, arch, current string) *Manager {
	return &Manager{Root: root, OS: goos, Arch: arch, Current: current, Client: &http.Client{
		Timeout: 3 * time.Minute,
		CheckRedirect: func(r *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return errors.New("too many update redirects")
			}
			h := r.URL.Hostname()
			if r.URL.Scheme != "https" || r.URL.User != nil || r.URL.Port() != "" ||
				(h != "github.com" && h != "release-assets.githubusercontent.com" && h != "objects.githubusercontent.com") {
				return errors.New("update redirected outside GitHub release storage")
			}
			return nil
		},
	}}
}

func (m *Manager) folder() string { return filepath.Join(m.Root, ".updates") }
func (m *Manager) packageName(v string) string {
	return "pangzhu-" + strings.TrimPrefix(v, "v") + "-" + m.OS + "-" + m.Arch
}
func (m *Manager) binary() string {
	if m.OS == "windows" {
		return "pangzhu.exe"
	}
	return "pangzhu"
}

func (m *Manager) parse(body []byte) (*Candidate, error) {
	var r release
	if err := json.Unmarshal(body, &r); err != nil {
		return nil, err
	}
	if _, err := version(r.Tag); err != nil {
		return nil, err
	}
	if r.Draft || r.Prerelease {
		return nil, errors.New("release is not stable")
	}
	if !newer(r.Tag, m.Current) {
		return nil, nil
	}
	name := m.packageName(r.Tag) + ".zip"
	for _, a := range r.Assets {
		if a.Name != name {
			continue
		}
		expected := "https://github.com/" + Repository + "/releases/download/" + r.Tag + "/" + name
		if a.URL != expected || a.Size <= 0 || a.Size > maxArchive {
			return nil, errors.New("invalid official release asset")
		}
		hash := strings.TrimPrefix(a.Digest, "sha256:")
		decoded, err := hex.DecodeString(hash)
		if !strings.HasPrefix(a.Digest, "sha256:") || err != nil || len(decoded) != 32 {
			return nil, errors.New("release has no valid SHA-256 digest")
		}
		return &Candidate{Version: strings.TrimPrefix(r.Tag, "v"), URL: a.URL, SHA256: strings.ToLower(hash)}, nil
	}
	return nil, fmt.Errorf("release has no %s asset", name)
}

func (m *Manager) get(ctx context.Context, target string) (*http.Response, error) {
	u, err := url.Parse(target)
	if err != nil || u.Scheme != "https" {
		return nil, errors.New("updates require HTTPS")
	}
	r, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, err
	}
	r.Header.Set("Accept", "application/vnd.github+json")
	r.Header.Set("User-Agent", "Pangzhu/"+m.Current)
	r.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	response, err := m.Client.Do(r)
	if err != nil {
		return nil, err
	}
	if response.StatusCode != http.StatusOK {
		response.Body.Close()
		return nil, fmt.Errorf("GitHub returned HTTP %d (repository or release may not exist yet)", response.StatusCode)
	}
	return response, nil
}

func (m *Manager) readState() State {
	var state State
	b, err := os.ReadFile(filepath.Join(m.folder(), "state.json"))
	if err == nil {
		_ = json.Unmarshal(b, &state)
	}
	return state
}

func atomicJSON(filename string, value any) error {
	b, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(filename), ".write-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(append(b, '\n')); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(f.Name(), filename)
}

// Check persists attempts even on failure, so restarts cannot hammer a missing feed.
// Its caller holds the installation lock; only one updater can write this root.
func (m *Manager) Check(ctx context.Context, install, force bool) (message string, err error) {
	if Repository == "" {
		return "Updates disabled: release repository is not configured", nil
	}
	if _, err := version(m.Current); err != nil {
		return "Development build: updates disabled", nil
	}
	if err = os.MkdirAll(m.folder(), 0700); err != nil {
		return "", err
	}
	state := m.readState()
	now := time.Now()
	if !force && !state.LastAttempt.IsZero() && now.Sub(state.LastAttempt) >= 0 && now.Sub(state.LastAttempt) < interval {
		return "", nil
	}
	state.LastAttempt = now
	state.Error = ""
	if err = atomicJSON(filepath.Join(m.folder(), "state.json"), state); err != nil {
		return "", err
	}
	defer func() {
		if err != nil {
			state.Error = err.Error()
		}
		if saveErr := atomicJSON(filepath.Join(m.folder(), "state.json"), state); err == nil && saveErr != nil {
			err = saveErr
		}
	}()
	checkCtx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	response, err := m.get(checkCtx, "https://api.github.com/repos/"+Repository+"/releases/latest")
	if err != nil {
		return "", err
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, (2<<20)+1))
	response.Body.Close()
	if err != nil {
		return "", err
	}
	if len(body) > 2<<20 {
		return "", errors.New("release metadata too large")
	}
	candidate, err := m.parse(body)
	if err != nil {
		return "", err
	}
	if candidate == nil {
		state.Available = ""
		return "Pangzhu is up to date (" + m.Current + ")", nil
	}
	state.Available = candidate.Version
	if !install {
		return "Update available: " + candidate.Version + "; run Update to download it", nil
	}
	if err = m.stage(ctx, candidate); err != nil {
		return "", err
	}
	state.Ready = candidate.Version
	return "Update " + candidate.Version + " verified and ready; it will run on the next launch", nil
}

func (m *Manager) Run(ctx context.Context, install bool, report func(string)) {
	check := func() {
		message, err := m.Check(ctx, install, false)
		if err != nil {
			report("Update check: " + err.Error())
		} else if message != "" {
			report(message)
		}
	}
	check()
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			check()
		}
	}
}

func (m *Manager) stage(ctx context.Context, c *Candidate) error {
	work, err := os.MkdirTemp(m.folder(), ".stage-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(work)
	r, err := m.get(ctx, c.URL)
	if err != nil {
		return err
	}
	defer r.Body.Close()
	f, err := os.Create(filepath.Join(work, "release.zip"))
	if err != nil {
		return err
	}
	h := sha256.New()
	n, copyErr := io.Copy(io.MultiWriter(f, h), io.LimitReader(r.Body, maxArchive+1))
	closeErr := f.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	if n > maxArchive || hex.EncodeToString(h.Sum(nil)) != c.SHA256 {
		return errors.New("update archive failed SHA-256 or size verification")
	}
	unpacked := filepath.Join(work, "unpacked")
	if err = m.extract(filepath.Join(work, "release.zip"), unpacked, c.Version); err != nil {
		return err
	}
	destination := filepath.Join(m.folder(), "v"+c.Version)
	if _, err = os.Stat(destination); err == nil {
		// Never replace an existing version directory, which could be running.
		if err = m.validate(destination, c.Version); err != nil {
			return err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	} else if err = os.Rename(unpacked, destination); err != nil {
		return err
	}
	return atomicJSON(filepath.Join(m.folder(), "current.json"), Manifest{c.Version, Repository, m.OS, m.Arch})
}

func (m *Manager) extract(archive, destination, v string) error {
	z, err := zip.OpenReader(archive)
	if err != nil {
		return err
	}
	defer z.Close()
	if len(z.File) > 256 {
		return errors.New("too many archive entries")
	}
	seen := map[string]bool{}
	var total uint64
	prefix := m.packageName(v) + "/"
	for _, entry := range z.File {
		name := strings.TrimPrefix(entry.Name, prefix)
		if name == entry.Name || name == "" || strings.ContainsAny(name, `\:`) || path.Clean(name) != name || strings.HasPrefix(name, "/") || name == ".." || strings.HasPrefix(name, "../") || !entry.Mode().IsRegular() {
			return errors.New("unsafe archive entry")
		}
		allowed := name == m.binary() || name == "cloudflared" || name == "cloudflared.exe" || name == "release.json" || name == "README.md" || name == "RELEASE-NOTES.md" || name == "cloudflared.example.yml" ||
			name == "Start-Share.cmd" || name == "Start-Local.cmd" || name == "Start-LAN.cmd" || name == "Start-Tunnel.cmd" || name == "Start-Pangzhu.ps1" || name == "Enable-LAN.ps1" || name == "Check-Update.cmd" || name == "Update.cmd" ||
			name == "Start-Pangzhu.command" || name == "Start-Share.command" || name == "Check-Update.command" || name == "Update.command" || (strings.HasPrefix(name, "licenses/") && strings.Count(name, "/") == 1)
		key := strings.ToLower(name)
		total += entry.UncompressedSize64
		if !allowed || seen[key] || entry.UncompressedSize64 > maxExpanded || total > maxExpanded {
			return errors.New("unexpected, duplicate or oversized archive entry")
		}
		seen[key] = true
		target := filepath.Join(destination, filepath.FromSlash(name))
		if err = os.MkdirAll(filepath.Dir(target), 0700); err != nil {
			return err
		}
		input, err := entry.Open()
		if err != nil {
			return err
		}
		mode := os.FileMode(0600)
		if name == m.binary() || name == "cloudflared" || strings.HasSuffix(name, ".command") {
			mode = 0700
		}
		output, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
		if err != nil {
			input.Close()
			return err
		}
		n, copyErr := io.Copy(output, io.LimitReader(input, int64(entry.UncompressedSize64)+1))
		input.Close()
		closeErr := output.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
		if uint64(n) != entry.UncompressedSize64 {
			return errors.New("archive entry size mismatch")
		}
	}
	return m.validate(destination, v)
}

func (m *Manager) validate(folder, v string) error {
	var manifest Manifest
	b, err := os.ReadFile(filepath.Join(folder, "release.json"))
	if err != nil {
		return err
	}
	if err = json.Unmarshal(b, &manifest); err != nil {
		return err
	}
	if manifest != (Manifest{v, Repository, m.OS, m.Arch}) {
		return errors.New("release identity or platform mismatch")
	}
	connector := "cloudflared"
	if m.OS == "windows" {
		connector += ".exe"
	}
	for _, name := range []string{m.binary(), connector} {
		info, err := os.Lstat(filepath.Join(folder, name))
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() || info.Size() == 0 {
			return errors.New("release executable missing or unsafe")
		}
	}
	return nil
}

// Target resolves only a newer, completely staged release. No remote input reaches
// a shell, and data stays rooted at the original installation across upgrades.
func (m *Manager) Target() (string, error) {
	b, err := os.ReadFile(filepath.Join(m.folder(), "current.json"))
	if errors.Is(err, os.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	var manifest Manifest
	if err = json.Unmarshal(b, &manifest); err != nil {
		return "", err
	}
	if _, err = version(manifest.Version); err != nil {
		return "", err
	}
	if manifest.Repository != Repository || manifest.OS != m.OS || manifest.Arch != m.Arch {
		return "", errors.New("staged pointer identity or platform mismatch")
	}
	if !newer(manifest.Version, m.Current) {
		return "", nil
	}
	folder := filepath.Join(m.folder(), "v"+manifest.Version)
	if err = m.validate(folder, manifest.Version); err != nil {
		return "", err
	}
	return filepath.Join(folder, m.binary()), nil
}
