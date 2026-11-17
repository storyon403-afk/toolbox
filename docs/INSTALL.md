# Install and use Toolbox

The initial distribution target is **Windows 11 x64**. Packages are unsigned portable ZIPs. Code signing and macOS notarization are deferred. Windows 10, Windows ARM64, Intel Mac and clean-machine compatibility are not certified by this release. macOS Apple Silicon builds are available for local development testing.

Download from [Toolbox Releases](https://github.com/storyon403-afk/toolbox/releases/latest). The public build is configured for `storyon403-afk/toolbox`. Source builds with an unset repository keep online installation disabled. Uploading ZIPs alone does not configure an existing binary.

| Package | Start |
| --- | --- |
| Toolbox | Extract the entire ZIP, then open `Toolbox.exe`. Open Settings and check for updates to refresh the tool catalog. |
| RD / DocsBridge | Extract the ZIP and run `Start-Local.cmd`. |
| DesignDoc / Forma | Extract and open `Forma.html` in a browser. |
| LanguageMap | Extract and run `Install.cmd`. Microsoft WebView2 130+ is required; a bootstrapper is included. Install WebView2 before using the Toolbox-managed copy too. |
| LinkParse | Extract the entire ZIP and open `LinkParse.exe`. Python, Node and media runtimes are bundled. |

Download packages only from the repository named in the release announcement. Verify `SHA256SUMS` before opening them. An unknown-publisher warning is expected for these unsigned packages; verify the source before choosing to run. Do not disable Windows security globally.

Toolbox installs tools on demand into `%APPDATA%/Toolbox/tools`. Its settings and installation records are under `%APPDATA%/Toolbox`. Standalone tools remain separate. Uninstalling a managed tool preserves its data; reinstalling restores access. Close a running tool before updating or uninstalling it. Back up important tool data using that tool's export function.

Daily checks run while Toolbox is open and catch up at the next launch. Automatic downloads and installation are off by default. Failed updates preserve the installed version. Offline checks keep the last accepted catalog; previously installed tools can still open. Toolbox itself is updated manually by extracting a newer Toolbox ZIP while the app is closed; its user-data directory remains in place. Standalone RD online updates are disabled in this distribution; obtain a newer independent ZIP from the same Toolbox repository and follow its included data migration instructions.

## LinkParse on Windows

Bilibili, YouTube and Douyin sample downloads and exports have passed Windows 11 x64 testing. Availability depends on login, network, region and platform restrictions. For Douyin, open Settings → Douyin → Log in, complete the official page, then Continue. The application reuses its own confirmed login after restart; removal affects only its own login session.

Enabled manual Windows HTTP system proxies are supported; the proxy service must be running. PAC, SOCKS and HTTPS-to-proxy endpoints are not supported. Optional ASR requires a separate local engine/model. Windows OCR and Agent are unavailable.

See [build instructions](BUILD.md) for source builds and [release preparation](RELEASING.md) for repository configuration.
