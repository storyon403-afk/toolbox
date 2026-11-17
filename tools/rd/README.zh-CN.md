<p align="center"><img src="../../design/v02/media/rd-icon.svg" width="88" alt="DocsBridge"></p>
<h1 align="center">DocsBridge</h1>
<p align="center">让反馈更简单。</p>
<p align="center"><a href="README.md">English</a> · 简体中文 · <a href="README.ja.md">日本語</a> · <a href="../../website/README.md">产品网页 ↗</a></p>

发布一篇文稿，分享一个链接，让每条建议都留在对应的文字旁。
DocsBridge 是一个以阅读为先的自托管文稿审阅工具：批注收成小圆点，发布版本保持锁定，回看反馈时始终能找到原文。

**本地版本 0.2.2 · macOS Apple Silicon / Intel · Windows x64 / ARM64。**
项目目录名为 `RD`，可执行文件和安装包沿用 `pangzhu`。应用界面目前为中文；README 和产品介绍网页提供中文、英文和日文。

## 怎么开始

1. 运行 `python3 scripts/package_release.py` 构建便携包，或使用 `dist/` 中已准备好的对应包。现有本地发行记录仍处于发布准备阶段，此处不承诺已有公开下载。
2. 将 `pangzhu-0.2.2-<darwin|windows>-<arm64|amd64>.zip` 解压到可写目录。
3. **macOS** 双击 **Start-Pangzhu.command**；**Windows** 双击 **Start-Local.cmd**。使用期间保持终端或命令窗口开启。
4. 打开 **⋯** 菜单，编辑并发布文稿。需要临时公开审阅链接时，运行 **Start-Share.command**（macOS）或 **Start-Share.cmd**（Windows）。

便携包包含服务程序和 cloudflared，审阅者只需浏览器。macOS 版是命令启动器，尚非经过签名、公证的 `.app`。Windows 程序尚未进行 Authenticode 签名；ARM64 包的连接器需要 x64 模拟运行。Windows 原生运行验收仍待完成。

[macOS 使用说明（英文）](docs/macos.md) · [Windows 使用说明（英文）](docs/windows.md) · [发行准备（英文）](docs/releases.md)

## 把空间留给文稿

- **舒服地读。** 连续阅读或 A4 分页，独立调整字号、行距、段距和纸张颜色，不改动文稿原始样式。
- **准确地提建议。** 选中文字，写下建议。收起后只留一个小圆点；展开时高亮对应原文，面板为文字让出空间。
- **集中处理反馈。** 审阅者在锁定版本上批注，作者统一处理。历史建议留在原来的版本，不自动挪到新稿。
- **分别保留草稿。** 新建或切换浏览器本地文稿；用 Cmd+S / Ctrl+S 保存 `.rd` 文件，备份或换设备继续编辑。
- **带走一份副本。** 导出独立 HTML，或选择“导出 PDF”后在浏览器打印窗口“另存为 PDF”。PDF 保留当前正文和可选水印，不包含批注。

打开、保存 `.rd` 都不会发布文稿。离线 HTML 副本不与服务同步。每个服务数据目录目前只有一个对外审阅的已发布文稿，尚无服务端多文稿库。

## 分享范围，说清楚

临时分享不需要 Cloudflare 账号、域名或令牌。启动器验证连接后提供 `trycloudflare.com` 链接；每次启动地址会变化，主机需要保持唤醒和运行。临时分享每三秒轮询一次，无可用性保证。固定域名需要配置命名隧道；可信局域网可使用 `Start-LAN.cmd`。

获得公开审阅链接的人都可以阅读和批注最新发布版本。审阅者标签不是经过认证的账号。草稿在发布前保留于浏览器；发布版本与反馈保存在主机的 SQLite 数据目录。请分别保存 `.rd` 备份，并在服务停止后备份 `data/`。

## 从源码运行与验证

准备 Go 1.27.3 或更新版本、Python 3 和 Node.js，在项目根目录运行：

```sh
python3 design/build.py
go build -o bin/pangzhu ./cmd/pangzhu
./bin/pangzhu --data-dir ./data
```

在主机打开 `http://127.0.0.1:8765/` 编辑；`/review` 仅允许阅读和反馈。Windows 构建时将输出改为 `bin/pangzhu.exe`。服务使用 Go 与 SQLite，无需 C 运行时。详见项目说明（英文）。

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

测试使用临时数据。交叉编译不能证明 Windows 原生运行或真实隧道已验收。验证记录（英文）说明已有证据和限制。

## 产品网页

参考 CallBridge 的简洁品牌展示与交互体验，网页提供三语介绍和示例操作，不向服务端发送反馈。本地构建与预览：

```sh
python3 website/build.py
python3 -m http.server 8790 --bind 127.0.0.1 --directory dist/site
```

打开 `http://127.0.0.1:8790/zh-CN/`。网页维护与检查（英文）。上述命令不会配置托管或发布网站。

## 更新与许可

Standalone online updates are disabled in this Toolbox distribution. Obtain new ZIPs from [Toolbox releases](https://github.com/storyon403-afk/toolbox/releases); back up data before replacement.

项目尚未选定整体开源许可。发行包随附第三方许可声明，它们不授予 DocsBridge 自有源码的使用许可。

[文稿文件（英文）](docs/product/rd-files.md) · 产品体验（英文） · 架构（英文） · [更新记录（英文）](CHANGELOG.md)
