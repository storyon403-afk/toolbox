# Windows adapter

This is the Toolbox-owned Windows import of the sibling LinkParse 0.1.0 host. Its approved Windows UI lives in `ui/`; the macOS UI and native host remain separate. The adapted portable package passed Windows 11 x64 acceptance; see the [Windows guide](../../../docs/INSTALL.md) for exact coverage and remaining limits.

## Runtime contract

- `TOOLBOX_DATA_DIR` isolates Electron storage and `preferences.json`. That preferences file contains only workspace and public-DNS settings; manually selected cookie-file paths remain session-only. Confirmed Douyin login uses a separate persistent application session under `accounts/douyin`.
- `TOOLBOX_READY_TOKEN` is echoed as JSON on stdout after the UI loads and the backend media/downloader doctor succeeds. Closing stdin requests graceful app/backend shutdown and cancellation. The managed entry is `resources/app/runtime/node.exe resources/app/windows/managed.cjs`; it bridges stdio to a private named pipe because Electron Windows GUI stdin can start already ended. `LinkParse.exe` remains the standalone UI entry.
- Portable packages resolve Python, Node, FFmpeg, ffprobe, ffplay and the Rust backend relative to `resources/app/runtime`. Restricted-PATH relocation tests passed; the Rust backend also loads its included VC runtime from this directory.
- If the Windows file association cannot open a preview, bundled ffplay opens the complete media instead. Its process is owned by LinkParse and closes with the app; watermark review still requires explicit confirmation.
- ASR still requires an optional local whisper.cpp executable and model. Windows OCR and Agent are unavailable.

## Native build

Use Windows x64 with the Rust MSVC toolchain and the locked Electron dependencies installed by `scripts/windows.ps1 build`. Prepare a base CPython installation and a separate environment containing `backend/worker/requirements.lock`. Supply explicit paths (example placeholders below):

```powershell
python scripts/package-windows.py --python-home C:/Python314 --python-packages PATH/TO/VENV/Lib/site-packages --ffmpeg PATH/TO/ffmpeg.exe --ffprobe PATH/TO/ffprobe.exe --ffplay PATH/TO/ffplay.exe --node PATH/TO/node.exe --ffmpeg-notices PATH/TO/FFMPEG-DISTRIBUTION
```

The script checks x64 executable headers, locked Python versions and bundled runtime execution with a restricted PATH. It creates `.build/windows-x64` and `dist/LinkParse-0.1.0-Windows-x64.zip`, with a manifest of hashes. It does not certify native GUI or Toolbox lifecycle acceptance.

From the Toolbox root, after building on Windows:

```powershell
node scripts/verify-linkparse-windows.mjs tools/linkparsing/dist/LinkParse-0.1.0-Windows-x64.zip
node scripts/build-windows-managed-fixtures.mjs --include-linkparse
```

Run the existing Windows real-tool harness using those fixtures. It checks install, simultaneous launch, restart, staged updates, checksum rejection, retained preferences, uninstall/reinstall and recovery. The portable harness substitutes file/directory selection and the initial system-player handoff, then verifies real fallback playback and cleanup. Separate native evidence covers user-assisted file selection and review confirmation, plus final-package Bilibili download and real export-folder selection. Release staging requires matching portable, live-download and native-export evidence. Public catalog delivery remains gated.

## Download limits

Unix retains `RLIMIT_FSIZE`. On all hosts, the Rust parent polls the private download scratch directory every 100 ms and checks it again before accepting the worker result: 4 GiB per file, 8 GiB total, bounded entry count, no symlinks. Windows Job Object teardown stops descendants on cancellation or an exceeded limit. Python progress/postprocessor hooks also check sizes. This detects overshoot and prevents successful publication; it is not a filesystem quota or OS security sandbox. No browser cookies, user config or raw signed URLs are logged.

## Windows system proxy

Each download/resolve worker reads the current user's enabled manual Windows Internet Settings proxy. HTTP proxy endpoints support HTTP forwarding and HTTPS CONNECT, including a loopback proxy on a custom port. The registry bypass list is honored by urllib. Changes apply to the next operation; no proxy settings or credentials are persisted by LinkParse. Environment proxy variables, PAC scripts, SOCKS endpoints and HTTPS-to-proxy endpoints are not supported. macOS behavior is unchanged.

The configured proxy is a trusted network boundary: it resolves destination hostnames, avoiding local FakeIP or poisoned DNS. LinkParse cannot inspect the proxy's upstream DNS or peer, or guarantee that it rejects private destinations. Every request and redirect still rejects private IP literals, local-only hostnames, URL credentials and ports other than 80/443. Only the pinned configured proxy endpoints are exempt from direct socket restrictions; direct and bypassed connections retain public-DNS and actual-peer checks. This does not bypass platform login, rate limits, regional restrictions or proxy connectivity failures.

## Douyin login

Settings provides an official-site login window and local removal; authentication errors offer login followed by one retry of the original action. The main process hosts the official page in a sandboxed WebContentsView without a preload or application bridge. Separate local controls accept completion/cancellation only from their own main frame. Opening the page alone does not activate credentials: the user must choose Continue. Saved sessions remain unverified until an actual platform request succeeds. Expiry requests reconnection; network failures do not erase a session.

Only confirmed application-owned Douyin/iesdouyin cookies become a bounded private temporary Netscape file for the existing Rust downloader. Files are removed after completion, errors, cancellation and shutdown; startup sweeps directories whose owning processes have exited. No cookie values enter renderer replies, ordinary logs, preferences or release artifacts. Removing local login closes page connections and clears the isolated session, without changing personal browsers. Manual file import remains under Advanced and takes precedence until a new in-app login is confirmed.

Synthetic-session Windows tests cover persistence, activation, cancellation, removal and remote-page isolation. Official login, complete download, native Chinese-directory export and restart reuse passed with the user-supplied sample on Windows 11 x64. The scoped web-detail adapter signs requests with the explicitly supplied session and preserves the official media Referer. See the [login guide](../../../docs/INSTALL.md#linkparse-on-windows).
