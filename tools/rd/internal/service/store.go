package service

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io/fs"
	_ "modernc.org/sqlite"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type Service struct {
	db        *sql.DB
	mu        sync.Mutex
	key       string
	assets    fs.FS
	publicURL string
	instance  string
	sequence  uint64
	listeners map[chan uint64]struct{}
}

func trim(s string) string { return strings.TrimSpace(s) }
func now() string          { return time.Now().UTC().Format(time.RFC3339Nano) }
func randomID() string {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}
func Open(dataDir string, assets fs.FS, publicURL string) (*Service, error) {
	if err := os.MkdirAll(dataDir, 0700); err != nil {
		return nil, err
	}
	keyPath := filepath.Join(dataDir, "owner.key")
	key, err := os.ReadFile(keyPath)
	if errors.Is(err, os.ErrNotExist) {
		key = []byte(randomID())
		f, e := os.OpenFile(keyPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if e != nil {
			return nil, e
		}
		_, e = f.Write(key)
		closeErr := f.Close()
		if e != nil {
			return nil, e
		}
		if closeErr != nil {
			return nil, closeErr
		}
	} else if err != nil {
		return nil, err
	}
	if len(trim(string(key))) < 32 {
		return nil, errors.New("owner.key is invalid; restore it from backup")
	}
	db, err := sql.Open("sqlite", filepath.Join(dataDir, "pangzhu.sqlite3"))
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	s := &Service{db: db, key: trim(string(key)), assets: assets, instance: randomID(), publicURL: strings.TrimRight(publicURL, "/"), listeners: map[chan uint64]struct{}{}}
	if err = s.initialize(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

// InstanceID is an ephemeral readiness marker, never an author credential.
func (s *Service) InstanceID() string { return s.instance }

// SetPublicURL is called only by the local launcher; no HTTP setter is exposed.
func (s *Service) SetPublicURL(origin string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.publicURL = strings.TrimRight(origin, "/")
	s.sequence++
	for listener := range s.listeners {
		select {
		case listener <- s.sequence:
		default:
		}
	}
}

func (s *Service) Close() error { return s.db.Close() }
func (s *Service) initialize() error {
	_, err := s.db.Exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS versions(version INTEGER PRIMARY KEY,title TEXT NOT NULL,blocks TEXT NOT NULL,title_size INTEGER NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS commits(id TEXT PRIMARY KEY,request_key TEXT UNIQUE NOT NULL,parent_id TEXT,based_on TEXT,author TEXT NOT NULL,message TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY,commit_id TEXT NOT NULL REFERENCES commits(id),version INTEGER NOT NULL REFERENCES versions(version),block_id TEXT NOT NULL,quote TEXT NOT NULL,range_start INTEGER NOT NULL,range_end INTEGER NOT NULL,body TEXT NOT NULL,resolved INTEGER NOT NULL DEFAULT 0);`)
	if err != nil {
		return err
	}
	rows, err := s.db.Query(`PRAGMA table_info(commits)`)
	if err != nil {
		return err
	}
	found := false
	for rows.Next() {
		var cid, notnull, pk int
		var name, typ string
		var def any
		if err = rows.Scan(&cid, &name, &typ, &notnull, &def, &pk); err != nil {
			rows.Close()
			return err
		}
		found = found || name == "reviewer_id"
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	if !found {
		if _, err = s.db.Exec(`ALTER TABLE commits ADD COLUMN reviewer_id TEXT NOT NULL DEFAULT ''`); err != nil {
			return err
		}
	}
	var count int
	if err = s.db.QueryRow(`SELECT count(*) FROM versions`).Scan(&count); err != nil {
		return err
	}
	if count == 0 {
		seed, err := fs.ReadFile(s.assets, "design/seed.json")
		if err != nil {
			return err
		}
		var snap Snapshot
		if err = json.Unmarshal(seed, &snap); err != nil {
			return err
		}
		d := snap.Versions[0]
		_, err = s.db.Exec(`INSERT INTO versions VALUES(?,?,?,?,?)`, d.Version, d.Title, mustJSON(d.Blocks), d.TitleSize, now())
		return err
	}
	return nil
}

type scanner interface{ Scan(...any) error }

func scanDocument(row scanner) (Document, error) {
	var d Document
	var blocks string
	err := row.Scan(&d.Version, &d.Title, &blocks, &d.TitleSize, &d.CreatedAt)
	if err == nil {
		err = json.Unmarshal([]byte(blocks), &d.Blocks)
	}
	return d, err
}
func (s *Service) snapshot(owner bool) (Snapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	snap := Snapshot{Versions: []Document{}, Commits: []Commit{}, IsOwner: owner, Sequence: s.sequence}
	if s.publicURL != "" {
		snap.ReviewURL = s.publicURL + "/review"
		if strings.HasSuffix(s.publicURL, ".trycloudflare.com") {
			snap.SyncMode = "poll"
		}
	}
	query := `SELECT version,title,blocks,title_size,created_at FROM versions ORDER BY version DESC`
	if !owner {
		query += " LIMIT 1"
	}
	rows, err := s.db.Query(query)
	if err != nil {
		return snap, err
	}
	for rows.Next() {
		d, e := scanDocument(rows)
		if e != nil {
			rows.Close()
			return snap, e
		}
		snap.Versions = append(snap.Versions, d)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return snap, err
	}
	rows, err = s.db.Query(`SELECT id,parent_id,based_on,author,message,created_at,reviewer_id FROM commits ORDER BY rowid DESC`)
	if err != nil {
		return snap, err
	}
	commits := []Commit{}
	for rows.Next() {
		var c Commit
		c.Notes = []Note{}
		if err = rows.Scan(&c.ID, &c.ParentID, &c.BasedOn, &c.Author, &c.Message, &c.CreatedAt, &c.ReviewerID); err != nil {
			rows.Close()
			return snap, err
		}
		commits = append(commits, c)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return snap, err
	}
	for _, c := range commits {
		query = `SELECT id,version,block_id,quote,range_start,range_end,body,resolved FROM notes WHERE commit_id=?`
		args := []any{c.ID}
		if !owner {
			query += " AND version=?"
			args = append(args, snap.Versions[0].Version)
		}
		query += " ORDER BY rowid"
		rows, err = s.db.Query(query, args...)
		if err != nil {
			return snap, err
		}
		for rows.Next() {
			var n Note
			if err = rows.Scan(&n.ID, &n.Version, &n.BlockID, &n.Quote, &n.Start, &n.End, &n.Body, &n.Resolved); err != nil {
				rows.Close()
				return snap, err
			}
			c.Notes = append(c.Notes, n)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return snap, err
		}
		if owner || len(c.Notes) > 0 {
			snap.Commits = append(snap.Commits, c)
		}
	}
	if !owner {
		visible := map[string]bool{}
		for _, c := range snap.Commits {
			visible[c.ID] = true
		}
		for i := range snap.Commits {
			c := &snap.Commits[i]
			if c.ParentID != nil && !visible[*c.ParentID] {
				c.ParentID = nil
			}
			if c.BasedOn != nil && !visible[*c.BasedOn] {
				c.BasedOn = nil
			}
		}
	}
	return snap, nil
}
func (s *Service) publish(data []byte) (any, error) {
	var p publishRequest
	if err := decode(data, &p); err != nil {
		return nil, err
	}
	if err := validateDocument(p); err != nil {
		return nil, err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var latest int
	if err = tx.QueryRow(`SELECT max(version) FROM versions`).Scan(&latest); err != nil {
		return nil, err
	}
	if p.BaseVersion != latest {
		return nil, fail(409, "A newer version exists. Your draft has been retained; review the latest version first.")
	}
	_, err = tx.Exec(`INSERT INTO versions VALUES(?,?,?,?,?)`, latest+1, trim(p.Title), mustJSON(p.Blocks), p.TitleSize, now())
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"version": latest + 1}, nil
}
func (s *Service) commit(data []byte, owner bool) (any, error) {
	var p commitRequest
	if err := decode(data, &p); err != nil {
		return nil, err
	}
	if !textValid(p.RequestKey, 100, false) || !textValid(p.Author, 60, false) || !textValid(p.Message, 200, false) || !textValid(p.ReviewerID, 100, true) || len(p.Notes) < 1 || len(p.Notes) > 100 {
		return nil, fail(400, "Invalid feedback submission")
	}
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var prior string
	err = tx.QueryRow(`SELECT id FROM commits WHERE request_key=?`, p.RequestKey).Scan(&prior)
	if err == nil {
		return map[string]any{"id": prior, "duplicate": true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	var latest int
	if err = tx.QueryRow(`SELECT max(version) FROM versions`).Scan(&latest); err != nil {
		return nil, err
	}
	for _, n := range p.Notes {
		if !owner && n.Version != latest {
			return nil, fail(409, "A newer document version exists; refresh before submitting")
		}
		d, e := scanDocument(tx.QueryRow(`SELECT version,title,blocks,title_size,created_at FROM versions WHERE version=?`, n.Version))
		if errors.Is(e, sql.ErrNoRows) {
			return nil, fail(400, "Document version does not exist")
		}
		if e != nil {
			return nil, e
		}
		if e = validateAnchor(n, d); e != nil {
			return nil, e
		}
	}
	if p.BasedOn != nil {
		var id string
		err = tx.QueryRow(`SELECT id FROM commits WHERE id=?`, *p.BasedOn).Scan(&id)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fail(400, "Feedback baseline does not exist")
		}
		if err != nil {
			return nil, err
		}
	}
	var parent *string
	err = tx.QueryRow(`SELECT id FROM commits ORDER BY rowid DESC LIMIT 1`).Scan(&parent)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	id := randomID()[:12]
	_, err = tx.Exec(`INSERT INTO commits(id,request_key,parent_id,based_on,author,message,created_at,reviewer_id) VALUES(?,?,?,?,?,?,?,?)`, id, p.RequestKey, parent, p.BasedOn, trim(p.Author), trim(p.Message), now(), p.ReviewerID)
	if err != nil {
		return nil, err
	}
	for _, n := range p.Notes {
		_, err = tx.Exec(`INSERT INTO notes VALUES(?,?,?,?,?,?,?,?,0)`, randomID(), id, n.Version, n.BlockID, n.Quote, n.Start, n.End, trim(n.Body))
		if err != nil {
			return nil, err
		}
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"id": id}, nil
}
func (s *Service) resolve(data []byte) (any, error) {
	var p struct {
		ID       string `json:"id"`
		Resolved *bool  `json:"resolved"`
	}
	if err := decode(data, &p); err != nil {
		return nil, err
	}
	if !textValid(p.ID, 100, false) || p.Resolved == nil {
		return nil, fail(400, "Invalid annotation status")
	}
	result, err := s.db.Exec(`UPDATE notes SET resolved=? WHERE id=?`, *p.Resolved, p.ID)
	if err != nil {
		return nil, err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	if n == 0 {
		return nil, fail(404, "Annotation not found")
	}
	return map[string]any{"ok": true}, nil
}
