<p align="center"><img src="icon/app-icon.png" width="112" alt="LinkParse"></p>
<h1 align="center">LinkParse</h1>
<p align="center">Bring what is inside a video into your next creation.</p>

[简体中文](README.md) · [English](README.en.md) · [日本語](README.ja.md) · Product page

LinkParse is a local media extraction tool for macOS, with a Windows x64 adapter maintained in Toolbox. Paste a single-video share link or import a local media file, then turn speech, on-screen text, audio and frames into reusable files.

**macOS native host · Windows x64 Electron host · Rust backend**

See the [Windows build and runtime contract](windows/README.md). Windows OCR and Agent are unavailable; ASR requires a separate engine/model.

LinkParse is the product name used here. Source code, app bundles and commands currently retain LinkParsing / `linkparsing`.

## Features

- **Links & local files** — Single-video parsing/download adapters for YouTube, Douyin and Bilibili; reopen previously downloaded folders.
- **Speech to text** — Local Whisper transcription with a timeline and TXT, Markdown or SRT export. Engine and model installation is required separately.
- **On-screen text** — Sampled Apple Vision OCR, stored separately from speech. This is not frame-by-frame subtitle extraction; review the results.
- **Independent exports** — Text, MP3/WAV audio, PNG frames and full source video. Source video preserves the complete duration and downloaded/merged bytes regardless of the selected range.
- **Local workflow** — Choose storage folders, cancel tasks, play media and locate results. Browser login sessions are never read automatically.

## Get started

1. Open the app, choose a storage folder, then paste a link or import a local file.
2. Generate speech text or recognize on-screen text; choose output formats and a time range.
3. Export to your selected folder. Frames and source video require viewing the media and completing a manual watermark review first.

A successful download does not establish watermark-free status. Unknown or watermarked sources cannot produce visual exports; text and audio remain independent. The app does not automatically detect or remove watermarks.

[macOS guide (Chinese)](docs/macos-launch.md) · [OCR guide (Chinese)](docs/ocr.md) · [Backend & CLI (Chinese)](backend/README.md)

## Build from source

Install macOS Xcode Command Line Tools, Rust, Python 3.10+, Node 22+ and FFmpeg/ffprobe first. From the project root:

```sh
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/worker/requirements.lock
cargo run -p linkparsing-core -- doctor
./LP build
./LP
```

Optional local speech transcription (setup downloads and verifies a model):

```sh
brew install whisper-cpp
python3 scripts/setup-asr.py
./LP build
```

The app uses local ad-hoc signing and depends on the host environment. A self-contained, Developer ID signed and notarized release has not been validated. Minimum macOS and other OS compatibility are not verified.

## Current limits

- Platform access depends on authentication, network, region and rate limits. Existing records show one successful Bilibili sample; YouTube required authentication and Douyin was rate-limited. Adapter availability does not establish successful access across platforms.
- Playlists, live streams and DRM content are unsupported. One active asset per session; no persistent task queue or crash recovery.
- Agent summaries, a task database and an OS sandbox are not integrated. These trilingual docs and website do not imply a trilingual desktop interface.
- ASR/OCR process media locally; downloads and model installation need a network. Optional public DNS fallback sends target domains to Cloudflare and must be enabled by the user. Cookies come only from a user-provided file.
- Process only content you have permission to use. Source video means the downloaded/merged file, not the creator’s original master.

## Development & checks

```sh
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
backend/.venv/bin/python -m unittest discover -s backend/worker/tests -v
# FFmpeg / ffprobe / Python
cargo test --workspace --test media_smoke -- --ignored
cargo test --workspace --test download_flow -- --ignored
```

Offline integration tests use synthetic media and transport substitutes, not real platform acceptance. See the macOS guide for desktop, ASR and OCR checks. This README does not claim every check runs on every documentation update.

`backend/` core · `desktop/` UI · `macos/` native host · `design/` design sources · `website/` trilingual product page.

See website/README.md for local preview. Page structure references local CallBridge; imagery and icon belong to this project.
