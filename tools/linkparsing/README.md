<p align="center"><img src="icon/app-icon.png" width="112" alt="LinkParse"></p>
<h1 align="center">LinkParse</h1>
<p align="center">把视频里的内容，带到你的创作里。</p>

[简体中文](README.md) · [English](README.en.md) · [日本語](README.ja.md) · 产品网页

LinkParse 是面向 macOS 的本地媒体提取工具。粘贴单视频分享链接，或导入本地音视频，将语音、画面文字、音频与画面整理成可以继续使用的文件。

**macOS · 本机开发版本 · Rust + 原生 macOS 宿主**

产品展示名为 LinkParse；源码、应用包和命令当前沿用 LinkParsing / `linkparsing`。

## 功能

- **链接与本地导入** — YouTube、抖音、Bilibili 单视频解析/下载适配器，支持重新打开已下载目录。
- **语音转写** — 本地 Whisper 生成时间轴，可预览并导出 TXT、Markdown、SRT；需要单独安装引擎与模型。
- **画面文字** — Apple Vision 按间隔采样 OCR，结果与语音文字独立保存；不是逐帧字幕提取，需要校对。
- **独立导出** — 文字、MP3/WAV 音频、PNG 画面与完整原视频分别处理。原视频保留完整时长及下载合并后的源字节，不受片段选择影响。
- **本地工作流** — 用户选择保存目录，可取消任务、播放素材、查看结果；不自动读取浏览器登录态。

## 开始使用

1. 启动应用，选择保存文件夹，粘贴链接或导入本地文件。
2. 按需生成语音文字、识别画面文字，选择格式与时间范围。
3. 导出到所选文件夹。画面和原视频须先实际查看素材并完成无水印人工审核。

下载成功不等于无水印；状态未知或有水印时禁止视觉导出，文字和音频可独立处理。本工具不自动检测或去除水印。

[macOS 使用说明](docs/macos-launch.md) · [OCR 说明](docs/ocr.md) · [后端与 CLI](backend/README.md)

## 从源码运行

需预先安装 macOS Xcode Command Line Tools、Rust、Python 3.10+、Node 22+、FFmpeg/ffprobe。在项目根目录执行：

```sh
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/worker/requirements.lock
cargo run -p linkparsing-core -- doctor
./LP build
./LP
```

可选本地语音转写（模型安装会联网下载并校验模型）：

```sh
brew install whisper-cpp
python3 scripts/setup-asr.py
./LP build
```

当前应用采用本地 ad-hoc 签名，依赖本机环境；尚无已验收的自包含、Developer ID 签名及公证发行包。最低 macOS 版本和其他系统兼容性尚未验收。

## 当前边界

- Windows 11 x64 sample acceptance passed for Bilibili, YouTube through the system proxy, and Douyin through in-app official login, including download/export. Access still depends on login, network, region and platform limits. See the [Windows guide](../../docs/INSTALL.md).
- 不支持合集、直播或 DRM 内容；当前只处理一个活动素材，无持久任务队列或崩溃恢复。
- Agent 总结、任务数据库和操作系统沙箱未接入。三语 README 与网页不代表桌面界面已完成三语本地化。
- ASR/OCR 在本地处理媒体；下载和模型安装需要网络。可选公网 DNS 回退会将目标域名发送给 Cloudflare，须由用户主动启用。Windows can use an explicitly confirmed, isolated Douyin in-app login; manual Cookie-file import remains available. Personal browser sessions are not automatically imported.
- 请仅处理你有权使用的内容。原视频指下载合并后的源文件，不是创作者上传前的母版。

## 开发与验证

```sh
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
backend/.venv/bin/python -m unittest discover -s backend/worker/tests -v
# FFmpeg / ffprobe / Python
cargo test --workspace --test media_smoke -- --ignored
cargo test --workspace --test download_flow -- --ignored
```

离线集成测试使用合成素材和传输替身，不代表真实平台验收。更多桌面、ASR、OCR 检查见使用说明。此 README 不宣称上述检查在每次文档更新中均已运行。

`backend/` 业务核心 · `desktop/` 界面 · `macos/` 原生宿主 · `design/` 设计源 · `website/` 三语产品网页。

网页本地预览见 website/README.md。页面结构参考本地 CallBridge，使用 LinkParse 自有图标与设计图。
