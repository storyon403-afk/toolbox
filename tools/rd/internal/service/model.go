package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"unicode/utf16"
	"unicode/utf8"
)

type Block struct {
	ID   string `json:"id"`
	Type string `json:"type"`
	Font string `json:"font"`
	Size int    `json:"size"`
	Text string `json:"text"`
}
type Document struct {
	Version   int     `json:"version"`
	Title     string  `json:"title"`
	TitleSize int     `json:"titleSize"`
	Blocks    []Block `json:"blocks"`
	CreatedAt string  `json:"createdAt"`
}
type Note struct {
	ID       string `json:"id"`
	Version  int    `json:"version"`
	BlockID  string `json:"blockId"`
	Quote    string `json:"quote"`
	Start    int    `json:"start"`
	End      int    `json:"end"`
	Body     string `json:"body"`
	Resolved bool   `json:"resolved"`
}
type Commit struct {
	ID         string  `json:"id"`
	ParentID   *string `json:"parentId"`
	BasedOn    *string `json:"basedOn"`
	Author     string  `json:"author"`
	Message    string  `json:"message"`
	CreatedAt  string  `json:"createdAt"`
	ReviewerID string  `json:"reviewerId"`
	Notes      []Note  `json:"notes"`
}
type Snapshot struct {
	Versions  []Document `json:"versions"`
	Commits   []Commit   `json:"commits"`
	IsOwner   bool       `json:"isOwner"`
	Sequence  uint64     `json:"sequence"`
	ReviewURL string     `json:"reviewUrl,omitempty"`
	SyncMode  string     `json:"syncMode,omitempty"`
}
type publishRequest struct {
	BaseVersion int     `json:"baseVersion"`
	Title       string  `json:"title"`
	TitleSize   int     `json:"titleSize"`
	Blocks      []Block `json:"blocks"`
}
type commitRequest struct {
	RequestKey string  `json:"requestKey"`
	BasedOn    *string `json:"basedOn"`
	Author     string  `json:"author"`
	Message    string  `json:"message"`
	ReviewerID string  `json:"reviewerId"`
	Notes      []Note  `json:"notes"`
}
type apiError struct {
	status  int
	message string
}

func (e *apiError) Error() string           { return e.message }
func fail(status int, message string) error { return &apiError{status, message} }
func textValid(s string, max int, empty bool) bool {
	if !utf8.ValidString(s) || utf8.RuneCountInString(s) > max {
		return false
	}
	return empty || len(trim(s)) > 0
}
func validateDocument(p publishRequest) error {
	if !textValid(p.Title, 200, false) || p.TitleSize < 20 || p.TitleSize > 64 || len(p.Blocks) < 1 || len(p.Blocks) > 200 {
		return fail(400, "Invalid document title, size or block count")
	}
	ids := map[string]bool{}
	for _, b := range p.Blocks {
		if !textValid(b.ID, 100, false) || b.ID == "title" || ids[b.ID] || (b.Type != "p" && b.Type != "h2") || (b.Font != "serif" && b.Font != "sans" && b.Font != "mono") || b.Size < 12 || b.Size > 48 || !textValid(b.Text, 20000, true) {
			return fail(400, "Invalid or duplicate document block")
		}
		ids[b.ID] = true
	}
	return nil
}
func validateAnchor(n Note, d Document) error {
	source := d.Title
	if n.BlockID != "title" {
		found := false
		for _, b := range d.Blocks {
			if b.ID == n.BlockID {
				source = b.Text
				found = true
				break
			}
		}
		if !found {
			return fail(400, "Annotation block does not exist")
		}
	}
	units := utf16.Encode([]rune(source))
	if n.Start < 0 || n.End <= n.Start || n.End > len(units) || n.End > 40000 || !textValid(n.Quote, 4000, false) || !textValid(n.Body, 4000, false) {
		return fail(400, "Invalid annotation range or text")
	}
	// Browser ranges use UTF-16 units; never accept a boundary inside a surrogate pair.
	if (n.Start > 0 && units[n.Start] >= 0xdc00 && units[n.Start] <= 0xdfff) || (units[n.End-1] >= 0xd800 && units[n.End-1] <= 0xdbff) {
		return fail(400, "Invalid UTF-16 range")
	}
	if string(utf16.Decode(units[n.Start:n.End])) != n.Quote {
		return fail(409, "Selected text does not match the document version")
	}
	return nil
}
func decode(data []byte, dst any) error {
	if err := json.Unmarshal(data, dst); err != nil {
		return fail(400, "Invalid JSON request")
	}
	if string(data) == "null" {
		return fail(400, "Expected a JSON object")
	}
	return nil
}
func publicError(err error) (int, string) {
	var e *apiError
	if errors.As(err, &e) {
		return e.status, e.message
	}
	return 500, "Unable to save or read data; please retry"
}
func mustJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		panic(fmt.Sprintf("invalid internal JSON: %v", err))
	}
	return string(b)
}
