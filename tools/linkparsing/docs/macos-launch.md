# macOS 启动与使用

2026-11-04：桌面窗口已连接 Rust 后端，不再是界面预览。使用现有淡紫色设计与应用图标。导入、提取、分析、设置可随时切换；没有素材时提供空状态与导入入口，长任务期间仍可导航。导出以确认弹窗呈现，支持关闭、返回调整与结果定位。

2026-11-04 UI 更新：实际桌面界面沿用视觉稿的白色、淡紫色与留白。首页改为紧凑链接输入栏，支持多行分享文案、清空和 `⌘ Enter` 下载；空内容时禁用解析与下载。导航、播放、导出入口使用统一线性图标，悬停显示用途。提取页使用输出开关、格式选择器、片段时间输入与导出数量标记；详细说明折叠显示。结果标签可用方向键切换，导出弹窗支持 Escape 关闭并恢复焦点。OCR 已接入本地 Vision；Agent 保留“未接入”状态，视觉输出仍受无水印审核限制。

## 启动

```sh
linkparsing
# 仓库内也可以使用 ./LP
```

也可双击 `~/Applications/LinkParsing.app`。全局命令来自 `~/.local/bin/linkparsing`。当前是绑定此源码目录的本机开发安装，移动源码目录后需重新配置入口与 Python 路径。

## 使用流程

1. 选择素材保存文件夹，粘贴 YouTube、抖音或 Bilibili 单视频分享链接，点击“解析信息”或“下载素材”。下载会产生永久保留的 `download-*` 源素材目录；也可以导入本地音视频，或重新打开包含 `asset.json` 的下载目录。
2. 下载受登录、地区与平台风控限制。需要时在“下载选项”中主动选择 Netscape Cookie 文件。系统 DNS 使用 FakeIP 时，可主动启用公网 DNS 回退；这会向 Cloudflare 查询目标域名，不改变系统配置。`dns_not_public` 错误会显示“启用公网 DNS 并重试”按钮，不必再寻找隐藏选项。仅在主动操作后保存 DNS 偏好，保存目录也会记住；不保存分享文本或 Cookie 内容。不会读取浏览器登录态。
3. 在“素材与导出”中点击播放，加载完成后开始播放完整素材。兼容的 H.264/AAC 等文件直接播放；其他编码或容器先生成完整 H.264/AAC 兼容播放副本，首次打开会显示准备阶段，可取消，同一会话再次播放复用副本。副本存于用户所选目录的私有素材快照内，替换素材或退出时清理，不修改源文件，不参与导出。关闭播放窗口会停止播放；加载失败或超时会显示错误，也可点击文件夹按钮定位源文件。
4. 选择音频格式，按需输入开始/结束秒数（最多三位小数），点击“选择目录并导出”。每个任务新建 `export-*` 目录，不覆盖既有文件；完成后可在 Finder 中查看。
5. 如需画面或原视频，请实际查看完整素材，再点击“人工审核”，在原生对话框中填写审核依据并确认无水印。画面输入以逗号分隔的秒数，最多 300 帧；原视频始终保留完整时长与源字节。
6. 在提取页选择语音语言（默认中文），点击“生成文字”。本地 Whisper 识别完整音轨，显示处理阶段和用时，可取消。完成后自动勾选文字输出；选择 TXT、Markdown 或 SRT，再点击“导出”。分析页可分页查看原文与时间轴。文字和音频不受水印状态阻断；无音轨时不能转写。识别可能有误，需要校对。画面文字可通过 OCR 单独识别，见 [OCR 使用说明](ocr.md)；Agent 自动总结尚未接入。
7. 也可主动导入已有的 Transcript JSON，结构如下。

```json
{"segments":[{"start_ms":0,"end_ms":1000,"text":"已有文字"}]}
```

本次会话只保留一个活动素材。替换素材或退出时清理其私有快照；已下载源文件与已导出结果保留。桌面人工审核与手动导入文字仅对当前会话有效。自动转写结果以私有权限写入所选素材目录下的 `.linkparsing-transcript-<源SHA256>.json`，重新打开同一下载目录或在相同工作目录导入同一文件时恢复；损坏或不匹配的缓存不会加载。已有 CLI 审核记录仍可在重新打开下载目录时按摘要校验读取。

处理时可取消任务。界面显示真实处理阶段，不显示估算百分比；取消不删除已成功完成的输出。关闭应用会等待后端取消与清理。没有持久任务队列或崩溃恢复。

## 桌面调用边界

`desktop/` 页面 → 主 frame 限定的 WKScriptMessageHandler → 原生文件选择/审核界面 → stdin/stdout JSONL → Rust Session → 现有下载与导出服务。

- 页面只能提交白名单动作、分享文本、活动素材编号及受校验的导出选择，不能指定任意磁盘路径、工具路径、shell 命令或水印结论。
- 路径由原生选择器提供，导出路径仅在原生端用于 Finder 定位；素材播放只使用后端当前只读快照。没有 HTTP 监听端口。
- 水印审核结论只能由独立原生对话框生成，绑定后端持有素材的 SHA-256。`ExportRequest` 不接受自报无水印状态。
- 后端按次执行一个任务；取消和管道关闭会触发 CancellationToken，终止媒体进程组并清理临时文件。后端 stderr 不写入分享文本、Cookie、标题或媒体文字；stdout 仅作私有 IPC。
- HTML 的 CSP 禁止网络连接、嵌套页面和外部脚本；页面中的标题、结果与错误使用文本节点渲染，文件路径不作为页面可执行内容。
- 这些限制不是操作系统沙箱；未宣称完成 OS 沙箱、全局磁盘配额、跨账户隔离或平台持续验收。

## 构建与检查

```sh
./LP build
python3 scripts/install-local.py
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo test --workspace --test media_smoke -- --ignored
cargo test --workspace --test download_flow -- --ignored
backend/.venv/bin/python -m unittest discover -s backend/worker/tests -v
node --test desktop/logic.test.mjs
python3 scripts/test-desktop.py
# 独立测试浏览器，不使用个人 Chrome 登录态
npm install --prefix .work/ui-tests --no-save --ignore-scripts playwright@1.64.1
node scripts/test-ui.mjs
# 需已安装 Whisper 和模型；系统 TTS 生成测试语音，不访问平台
python3 scripts/test-asr.py
python3 scripts/test-ocr.py
LINKPARSING_TEST_ASR=1 node scripts/test-ui.mjs
```

需要 macOS、Xcode Command Line Tools（含 Swift）、Rust、Python 3、FFmpeg/ffprobe，以及已缓存的 Cargo 依赖。下载需要 `backend/.venv` 中的锁定依赖，安装见 `backend/README.md`。构建将 worker 脚本复制到应用内；本机 Python 虚拟环境路径写入 `Runtime.plist`，可在构建时用 `LINKPARSING_PYTHON` 显式指定。

开发包使用本地 ad-hoc 签名，未做 Developer ID 签名或 Apple 公证；只验证当前 macOS，不代表旧系统兼容性已验收。更新后需正常退出旧版本再启动。原 CLI 仍可用 `linkparsing doctor`、`linkparsing cli --help` 等命令访问。

测试使用合成媒体、真实 FFmpeg 和下载传输替身，覆盖独立导出、水印阻断、原视频完整性、篡改拒绝、取消、过期素材编号和退出清理；不代表新一轮真实平台下载验收。

## 本轮验证记录

2026-11-04：本机系统 DNS 对视频域名返回 FakeIP；系统模式复现拒绝，显式公网 DNS 回退后同一 Bilibili 视频已成功解析并通过桌面任务服务下载到用户选择的 Downloads 目录。该结果只覆盖这一视频，不代表 YouTube/抖音或所有网络已验收。无水印状态仍为 unknown。

浏览器交互测试使用独立 Chromium 配置，原生文件选择器替换为合成媒体路径，媒体处理连接真实 Rust 后端；覆盖无素材导航、返回、网络错误重试与偏好恢复、任务期间导航、取消、文字原文渲染、导出弹窗关闭、WAV 实际时长。网络错误与恢复在浏览器测试中使用传输替身；真实平台结果来自上述单独验证。

## 本地语音转写

```sh
brew install whisper-cpp
python3 scripts/setup-asr.py
./LP build
```

当前本机安装 whisper.cpp 1.9.5 与多语言 large-v3-turbo-q5_0 模型（约 547 MiB）。模型来自 [whisper.cpp 官方模型仓库](https://huggingface.co/ggerganov/whisper.cpp)，下载固定修订并验证 SHA-256。模型保存在 `~/Library/Application Support/LinkParsing/Models`；构建将可信引擎路径和模型路径写入 Runtime.plist，可通过 `LINKPARSING_WHISPER` / `LINKPARSING_ASR_MODEL` 覆盖。开发包依赖本机 Homebrew 引擎及动态库，尚非自包含发行包。

FFmpeg 将完整音轨转换为 16 kHz 单声道 PCM；Whisper 进程使用本地模型输出时间轴，Rust 校验后再供预览和导出。临时音频和引擎结果在用户所选目录内，完成、失败与取消均清理；不上传媒体、不记录媒体文字、不自动下载模型。单次识别超时 1 小时，无后台任务恢复。无音轨、模型缺失或未识别到有效文字时显示失败，不伪造结果；失败或取消重转写保留先前成功结果。

2026-11-04 真实转写验证：此前下载的约 844.8 秒中文视频，经完整音轨识别用时约 69 秒，得到 184 段、4174 个非空白字符，最后一段到 843.82 秒；TXT、Markdown、SRT 导出完成，重新打开后恢复成功。此记录只证明该素材的识别和导出流程，不代表所有转写文字准确无误。

2026-11-04 播放修复验证：`python3 scripts/test-playback.py` 使用合成 VP9/WebM、真实 FFmpeg 与原生 AVPlayer，验证兼容转换、完整时长、缓存复用、原文件与原视频导出字节不变、取消清理、实际视频帧解码、关闭停止与加载失败反馈。不使用真实平台请求。
