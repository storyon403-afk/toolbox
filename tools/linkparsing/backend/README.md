# LinkParsing Rust 后端

本地桌面工具的 Rust 业务内核与开发 CLI。已接入 YouTube、抖音、Bilibili 的 yt-dlp 解析/下载适配器，并连接本地音频、已有文本、画面与完整原视频导出。真实访问仍受平台登录、风控、地区和网络限制。桌面 UI 已连接下载、本地导入、人工审核与导出。已接入本地 Whisper 语音转写和 macOS Vision 画面文字 OCR；Agent、任务数据库尚未接入。

后端设计 · [Export validation rules](src/domain.rs)

已提供[macOS 应用与全局启动入口](../docs/macos-launch.md)：`linkparsing` 打开已连接业务的桌面窗口，`linkparsing doctor` 等命令仍可直接调用后端。桌面端采用独立受限 IPC，不将开发 CLI 直接暴露给网页。

## 安装与检查

本轮在 macOS、Rust 1.97.1、Python 3.14、Node 22.23.2、FFmpeg/ffprobe 8.1.2 验证。先安装 Rust、FFmpeg、Python 3.10+ 和 Node 22+，在项目根目录运行：

```sh
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/worker/requirements.lock
cargo run -p linkparsing-core -- doctor
```

`Cargo.lock` 和 `requirements.lock` 固定当前依赖解析。Python 使用独立虚拟环境，yt-dlp 版本为 2026.10.26，YouTube JS 挑战组件随依赖安装，不下载远程组件。已验证当前 macOS 的本机开发应用打包，尚未验证最低 Rust 版本、其他系统或独立发行包。开发 CLI 默认使用源码目录下的 worker 和 `.venv`，打包时需通过 `DownloadTools` 注入资源路径。工具从 Homebrew、系统和绝对 PATH 目录寻找；可用 `LINKPARSING_PYTHON` / `LINKPARSING_NODE` 指定可信的绝对可执行路径。

## 分享链接 → 下载 → 导出

命令接受完整分享文案，自动提取单个链接并去除分享追踪参数。以用户提供的 Bilibili 视频为例：

```sh
cargo run -p linkparsing-core -- resolve-link 'https://www.bilibili.com/video/BV1g2sQ6FET3' .work/videos
cargo run -p linkparsing-core -- download-link 'https://www.bilibili.com/video/BV1g2sQ6FET3' .work/videos
cargo run -p linkparsing-core -- export-link 'https://www.bilibili.com/video/BV1g2sQ6FET3' backend/examples/audio-request.json .work/exports
```

`export-link` 一次完成下载、ffprobe、SHA-256 校验、导出并返回源目录与逐类结果。示例请求导出 0.5–1.5 秒 WAV；使用 `audio-full-request.json` 导出完整 MP3。原始下载保存在输出目录下随机命名的 `download-*` 子目录，可重用它，无须重复下载：

```sh
cargo run -p linkparsing-core -- export-downloaded /absolute/path/download-XXXX backend/examples/audio-full-request.json .work/exports
```

三个平台同样支持上述命令。支持单视频，YouTube 短链/Shorts、Bilibili b23 短链/分 P、抖音分享短链经过重定向处理；不接收合集、直播或 DRM 内容。短链处理尚未对各平台真实短链逐一验收。

可选参数：

- `--cookies /absolute/path/cookies.txt`：仅使用用户主动提供的 Netscape 格式 Cookie 文件；复制到私有临时目录使用，任务结束删除副本，不修改原文件、不读取浏览器登录态。
- `--dns auto`: opt-in public DNS fallback through Cloudflare HTTPS DNS for direct connections when local resolution fails or returns FakeIP. It sends destination hostnames to Cloudflare without changing system DNS. Direct private/local destinations remain blocked. Windows proxy-routed hostnames are resolved by the configured proxy; see the [proxy contract](../windows/README.md#windows-system-proxy).
- `--transcript /absolute/path/transcript.json`：仅导出命令接受已有文字；结构见下例。开发 CLI 仍使用外部文字输入；桌面应用可本地转写音轨，尚未自动下载字幕；桌面支持本地画面 OCR。

```json
{"segments":[{"start_ms":0,"end_ms":1000,"text":"已有文字"}]}
```

平台错误返回稳定代码：`authentication_required`、`rate_limited`、`network_unavailable`、`dns_not_public`、`network_policy`、`video_unavailable` 等。错误不包含 Cookie、签名媒体地址或原始下载器诊断。CLI 退出码：0 完成；1 请求/平台错误；2 导出部分完成、阻断或失败；130 取消。调用方应同时检查 JSON 的每项 `outputs`。Ctrl+C 取消任务并终止进程组中的下载器、Node、FFmpeg；已完成的类别保留。

## 无水印与原视频

下载源是供用户查看的素材，`asset.json` 中固定为 `downloaded_unreviewed`，不代表通过无水印审核。下载成功不会自动标记无水印。音频/文字可独立导出；画面/原视频需要用户实际审阅并留下绑定 SHA-256 的人工记录：

```sh
# 仅在已经查看并确认素材无水印后执行；有水印时用 watermarked。
cargo run -p linkparsing-core -- review-download /absolute/path/download-XXXX clean '已查看素材并确认无水印'
cargo run -p linkparsing-core -- export-downloaded /absolute/path/download-XXXX backend/examples/visual-request.json .work/exports
```

这不是自动水印检测或去水印功能。审阅文件只作为本机操作者的可信记录，不应由前端/Agent 写入。修改源文件后校验失败；导出请求 JSON 无权自报 clean。完整原视频为下载后合并的源容器逐字节复制，不受片段范围影响，也不是平台创作者上传前的母版。工具不会增加水印。

## 验证

```sh
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo test --workspace -- --ignored
backend/.venv/bin/python -m unittest discover -s backend/worker/tests -v
```

忽略测试调用本机 FFmpeg/ffprobe/Python，使用合成媒体和明确的下载传输替身，验证三个平台分享入口到落盘、Cookie 副本清理、人工审核、导出、篡改阻断；不代表真实网站下载验收。Python 测试覆盖地址限制、公开 DNS 回退、URL 规范化、媒体限制和错误分类。

2026-11-04 本机验证：21 项 Rust 测试（含 3 项显式运行的媒体集成测试）、12 项 Python 测试，以及 fmt/clippy 通过。真实访问均未使用 Cookie，使用 `--dns auto`：

| 平台样本 | 实际结果 |
| --- | --- |
| Bilibili `BV1g2sQ6FET3` | 完成下载，1280×720，844.757 秒；完整 MP3 同时长，SHA-256 复核通过；未审核的画面/原视频导出被阻断 |
| YouTube `jNQXAC9IVRw` | `authentication_required`；未完成下载 |
| 抖音 `6961737553342991651` | `rate_limited`；未完成下载 |

Bilibili 媒体请求使用 `Range: bytes=0-` 兼容本次遇到的 CDN HTTP 567，保留已有显式 Range，不影响其他平台或网页/API 请求。背景见 [yt-dlp 上游问题 #17847](https://github.com/yt-dlp/yt-dlp/issues/17847)。这只证明本次样本可用，仍需持续进行平台回归。

模块：`download` 平台服务与来源清单；`source` 分享链接；`media` 私有源快照；`process` 受限进程组；`domain` 领域规则；`text` 文字序列化；`export` 独立导出。下载并发 1，单文件 4 GiB、12 小时，worker 目录软预算 8 GiB；快照和导出另占空间。Python 网络检查不是操作系统沙箱，尚未实现全局磁盘/内存配额或崩溃恢复。`main.rs` 是开发入口，不应直接作为生产 IPC 暴露。

桌面 ASR：`brew install whisper-cpp`，运行 `python3 scripts/setup-asr.py` 安装校验模型，再 `./LP build`。在提取页点击“生成文字”即可识别视频 / 音频；详见 [macOS 使用说明](../docs/macos-launch.md#本地语音转写)。验证：`python3 scripts/test-asr.py`（macOS 系统 TTS 合成中文、真实 FFmpeg/Whisper、无平台请求）。

桌面 OCR：构建应用后在提取页选择语言、采样间隔与时间范围，点击“识别画面文字”。结果与语音转写独立存储，选择“文字来源”后预览或导出。详见 [OCR 使用与验收](../docs/ocr.md)。验证：`python3 scripts/test-ocr.py`，使用合成中英文画面和真实 Vision/FFmpeg，不访问平台。

The Toolbox Windows adapter automatically uses enabled manual HTTP system proxies for HTTP and HTTPS CONNECT. Proxied hostname DNS belongs to the trusted proxy; direct/bypassed connections retain address checks and optional public-DNS fallback. See the [Windows proxy contract](../windows/README.md#windows-system-proxy).
