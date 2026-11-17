# DocsBridge setup and development guide

[Product overview](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md)

A reading-first, self-hosted document review tool. Publish a locked document,
share a review URL, and collect precise text annotations as quiet, collapsible dots.
Authors manage feedback in one place while every note retains its original version.

## Local release: 0.2.2

Official repository and update source: `storyon403-afk/RD` (local release preparation;
not yet published). Four portable packages support macOS Apple Silicon / Intel and
Windows x64 / ARM64. See [release preparation](docs/releases.md).

## Run on macOS

Extract the matching `pangzhu-0.2.2-darwin-<arm64|amd64>.zip`, then double-click
**Start-Pangzhu.command** for local use or **Start-Share.command** for public sharing.
Keep the Terminal window open. This is a portable launcher, not a notarized `.app`;
see [macOS setup](docs/macos.md).

## Run on Windows

Extract the Intel/AMD package into a writable
folder, then double-click **Start-Share.cmd**. The package includes cloudflared;
there is no separate installation, account, domain or token setup. The launcher
starts both processes, verifies the public connection and opens the local author
page with the share dialog. Copy its HTTPS review URL for other readers.

The generated `trycloudflare.com` address is temporary and changes each launch.
Keep the app window and Windows computer running. Quick sharing polls for updates
every three seconds because Quick Tunnels do not support SSE. Cloudflare provides
no uptime guarantee for these temporary tunnels. [Official limitations](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)

For a fixed hostname, use `Start-Tunnel.cmd` with a configured named tunnel.
For same-network access, use `Start-LAN.cmd`. See [Windows setup](docs/windows.md),
including migration from an older package. The ARM64 package needs Windows 11 x64
emulation for its bundled cloudflared; Pangzhu itself is native ARM64.

Everyone who has the public review URL can read and annotate the latest publication.
Reviewer labels are not authenticated accounts. Local drafts are not uploaded by
the launcher; publishing a document makes that publication accessible to reviewers.

## Write separate documents and export PDF

Use **Menu > Documents** to create a new document, open a `.rd` file, or switch
between browser-local drafts. **Save .rd** (Ctrl+S / Cmd+S) downloads the current
document for backup or editing on another device. HTML export remains available.
Choose **Export PDF**, set the optional/custom watermark in the right-side panel,
then continue to **Save as PDF** in the browser print dialog for an A4 document. Opening and saving files never publishes them.

See [document files and PDF conversion](docs/product/rd-files.md) for the format,
storage limits and publication behavior.

## Automatic updates

While running, release builds check the official GitHub repository once every 24
hours. New stable packages are downloaded and SHA-256 verified, then enabled on
the next launch without interrupting readers or changing the data directory.
Check-Update and Update launchers provide manual controls. `--updates check` checks
without downloading; `--updates off` makes no update network requests. The app does
not run background checks when closed. The repository and first release must be
published before online updates can succeed.

## Develop

Use Go 1.27.3 or newer, Python 3, and Node.js for browser tests.

```sh
python3 design/build.py
go build -o bin/pangzhu ./cmd/pangzhu
./bin/pangzhu --data-dir ./data
```

Open `http://127.0.0.1:8765/` on the host computer to author. Use `/review` for
review-only access. LAN listening requires `--host 0.0.0.0`; public link generation
can be set with `--public-url https://review.example.com`.

The service uses Go and SQLite, with no C runtime dependency. Rust would also meet
the memory-safety and speed goals; Go was selected for straightforward single-file
Windows delivery and maintainability. Existing Python-prototype SQLite data is
compatible; stop the old server and make a backup before switching implementations.

## Read and review

- Open the menu to edit, publish, inspect suggestions or adjust reading appearance.
- Select text and choose the suggestion button. Confirm with the checkmark or Enter;
  Shift+Enter inserts a line break. Chinese IME confirmation does not submit.
- Suggestion panels choose free space around the selection and grow with content.
  When space is scarce, a separate scrollable reading area keeps source text clear.
- Click a dot to open its suggestion; Escape closes it. The suggestions panel lets
  the author resolve feedback. Versions and submitted feedback persist in SQLite.
- Open `design/index.html` directly for offline use. Export a standalone copy from
  the document panel; it includes the selected document and applicable feedback.
  Offline copies do not synchronize with the server.

## Checks and packages

```sh
npm ci
npx playwright install chromium
go test -race ./...
go vet ./...
npm run test:ui
python3 scripts/package_release.py
```

Build the native executable before integration tests. Tests use temporary databases.
Packaging regenerates web assets and builds macOS and Windows amd64/arm64 packages,
a clean GitHub source upload ZIP and checksums.
Build outputs are local artifacts; nothing is published or installed automatically.

See [build instructions](../../docs/BUILD.md) and [release preparation](docs/releases.md).
