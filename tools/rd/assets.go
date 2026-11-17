// Package pangzhu contains the public web assets embedded in every release.
package pangzhu

import "embed"

//go:embed design/index.html design/app.js design/style.css design/seed.json
var Assets embed.FS
