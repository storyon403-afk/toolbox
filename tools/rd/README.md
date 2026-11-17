<p align="center"><img src="../../design/v02/media/rd-icon.svg" width="88" alt="DocsBridge"></p>
<h1 align="center">DocsBridge</h1>
<p align="center">Feedback Made Easier.</p>
<p align="center">English · <a href="README.zh-CN.md">简体中文</a> · <a href="README.ja.md">日本語</a> · <a href="../../website/README.md">Product website ↗</a></p>

Publish a document. Share a link. Keep every suggestion beside the words it belongs to.
DocsBridge is a reading-first, self-hosted document review workspace. Quiet annotation dots,
locked publications, and feedback that stays connected to its original version.

**Local version 0.2.2 · macOS Apple Silicon / Intel · Windows x64 / ARM64.**
The repository folder is `RD`; executable and package names remain `pangzhu`.
The application UI is currently Chinese. These READMEs and the product website support
English, Simplified Chinese and Japanese.

## Get started

1. Build portable packages with `python3 scripts/package_release.py`, or use a matching
   package already prepared in `dist/`. The local release record still lists public
   distribution as pending; no live download is promised here.
2. Extract `pangzhu-0.2.2-<darwin|windows>-<arm64|amd64>.zip` into a writable folder.
3. On **macOS**, open **Start-Pangzhu.command**; on **Windows**, open **Start-Local.cmd**.
   Keep the Terminal / console window open.
4. Open **⋯**, edit a document and publish it. For a temporary public review link,
   launch **Start-Share.command** (macOS) or **Start-Share.cmd** (Windows).

Portable packages include the service and cloudflared. Readers only need a browser.
The macOS package is a command launcher, not a signed or notarized `.app`. Windows
binaries are not Authenticode signed. Windows ARM64 uses x64 emulation for the connector;
native Windows acceptance remains pending.

[macOS guide](docs/macos.md) · [Windows guide](docs/windows.md) · [Release preparation](docs/releases.md)

## Less interface. More document.

- **Read comfortably.** Continuous reading or A4 pagination, with independent typography,
  spacing and paper colors. The source document keeps its own formatting.
- **Point to the exact words.** Select text and leave a suggestion. Closed notes become
  small dots; opening one highlights its source. Panels make room for the text.
- **Keep feedback together.** Reviewers annotate a locked publication. Authors resolve
  suggestions; older notes stay attached to their original version.
- **Keep drafts separate.** Create or switch browser-local documents. Save `.rd` files
  with Cmd+S / Ctrl+S to back up your work or continue on another device.
- **Take a copy with you.** Export standalone HTML, or choose Export PDF and the browser's
  Save as PDF dialog. PDF contains current text and optional watermarks, without notes.

Opening or saving a `.rd` file never publishes it. Offline HTML does not synchronize.
Each server data directory has one active public review document; there is no server-side
multi-document library in this version.

## Share with a clear boundary

Temporary sharing needs no Cloudflare account, domain or token. The launcher verifies
connectivity before presenting a `trycloudflare.com` link. The address changes each launch;
keep the host awake and running. Temporary sharing polls every three seconds and has no
uptime guarantee. Use a configured named tunnel for a stable hostname, or `Start-LAN.cmd`
for a trusted private network.

Anyone with the public review URL can read and annotate the latest publication. Reviewer
labels are not authenticated accounts. Drafts stay browser-local until published;
publications and feedback live in the host's SQLite data directory. Back up `.rd` files
and, with the service stopped, the `data/` directory separately.

## Build and verify

Use Go 1.27.3 or newer, Python 3 and Node.js. From the project root:

```sh
python3 design/build.py
go build -o bin/pangzhu ./cmd/pangzhu
./bin/pangzhu --data-dir ./data
```

Open `http://127.0.0.1:8765/` on the host to author; `/review` permits reading and feedback
only. On Windows, build `bin/pangzhu.exe` instead. Go and SQLite need no C runtime.
See the project profile.

```sh
npm ci
npx playwright install chromium
go test -race ./...
go vet ./...
npm run test:ui
python3 scripts/smoke_update.py
python3 scripts/package_release.py
python3 scripts/verify_packages.py
```

Tests use temporary data. Cross-compilation is not native Windows or real tunnel validation.
See the validation records.

## Product website

Inspired by CallBridge's quiet brand introduction and interactive showcase, the website
uses illustrative content and sends no feedback to a server. Build and preview all three languages:

```sh
python3 website/build.py
python3 -m http.server 8790 --bind 127.0.0.1 --directory dist/site
```

Open `http://127.0.0.1:8790/`. Website editing and checks.
These commands do not configure hosting or publish the site.

## Updates and licensing

This Toolbox distribution disables RD's standalone online updater. Download new
standalone ZIPs from the [Toolbox releases](https://github.com/storyon403-afk/toolbox/releases).
Close RD and back up `data/` before replacing a standalone package. Managed copies
use Toolbox's catalog. See the [release guide](docs/releases.md).

No project-wide open-source license has been chosen. Third-party notices ship with the
packages; they do not license DocsBridge's own source.

[Document files](docs/product/rd-files.md) · Product experience · Architecture · [Changelog](CHANGELOG.md)
