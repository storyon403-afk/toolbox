# Release notes

## 0.2.2 - Compact export controls

- Compact floating PDF panel with a small paper overview and one export action.
- Six persisted watermark text positions, reflected in preview and printed pages.
- Disabling watermarks collapses their controls without discarding preferences.
- Watermark text, date and project footer remain outside the document body.

## 0.2.1 - DocsBridge identity and PDF watermarks

- Browser title and menu branding: DocsBridge: Feedback Made Easier.
- Right-side PDF settings with default-on, customizable page marks and live preview.
- Fixed GitHub project footer instead of browser-local document URLs.
- Unmarked PDF option removes the slogan, date and footer together.
- Fixed A4 pagination keeps headers/footers outside the source text.

## 0.2.0 - Portable document files

- New/open/save `.rd` documents with independent browser-local drafts and recovery.
- Ctrl+S / Cmd+S downloads the displayed document without publishing.
- Validated versioned JSON format; selected-document standalone HTML export.
- Local A4 print-to-PDF with source typography, complete text and no editor controls.
- Explicit stale-draft replacement while preserving server version conflicts.
- Existing publication, feedback, access and SQLite contracts remain unchanged.

## 0.1.0 — First portable release

- macOS Apple Silicon and Intel; Windows x64 and ARM64 portable ZIP packages.
- Reading-first document publication and precise, individually identifiable feedback.
- Local author permissions, immutable published versions and SQLite persistence.
- Continuous reading, A4 pagination, typography settings and standalone HTML export.
- Bundled, checksum-pinned cloudflared for one-click temporary public sharing.
- Daily official GitHub release checks, mandatory SHA-256 validation, automatic
  staging and activation on next launch without interrupting active readers.
- Manual update/check commands, check-only and offline modes, version reporting.
- Source upload bundle, release checksums and a tag-triggered draft release workflow.

### Platform limitations

The initial macOS package is a portable Terminal launcher, not a notarized app.
Windows ARM64 requires Windows 11 x64 emulation for its bundled cloudflared.
Native Windows, macOS Intel and real public-tunnel acceptance checks must be
performed on those environments before claiming runtime certification.
No remote repository or release is created by the local packaging command.
