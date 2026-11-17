# Build from source

Use Node.js 22.12 or newer. Electron and build dependencies are pinned in `package-lock.json`.

```sh
npm ci
npm run setup
npm test
npm run check
npm start
```

Build the initial Windows x64 target with `node scripts/package-desktop.mjs win32-x64`. The output is `dist/Toolbox-0.1.0-win32-x64.zip`. `npm run build:mac` builds macOS arm64 and x64 on a Mac; building a target does not certify its runtime compatibility. macOS packages use local ad-hoc signatures, without Developer ID or notarization. Windows packages are unsigned.

Run `npm run test:desktop` on a native desktop to exercise Electron isolation, persistent settings and tool hosting with a disposable profile. It supports both configured and offline catalogs; use the remote acceptance command to verify the published assets.

The `design/v02` directory contains the production renderer sources used by `scripts/prepare-desktop.mjs`. Keep it when cloning or exporting source. `website/` contains the optional product showcase.

## Independent tools

| Tool | Build |
| --- | --- |
| RD | Go SDK from `tools/rd/go.mod`; `npm run tool:build -- rd win32-x64`. Online standalone updates are disabled in this distribution. |
| DesignDoc | `npm run tool:build -- designdoc` |
| LanguageMap | [.NET / Swift build instructions](../tools/languagemap/README.md) |
| LinkParse | [Windows build instructions](../tools/linkparsing/windows/README.md) and [macOS guide](../tools/linkparsing/docs/macos-launch.md) |

`npm run tools:setup` prepares the declared local SDKs and Python dependencies on macOS. Native tool SDKs, architecture support and runtime requirements are independent of Electron. Keep each tool's dependency lockfiles and bundled third-party notices. No CI or paid service is required.
