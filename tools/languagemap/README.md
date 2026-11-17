# LanguageMap · macOS / Windows

本机离线词网。macOS 与 Windows 共用 V07 的时间轴、黑白／半透明外观和中英日界面，支持新词记录、双语释义、选词延伸、搜索与年月统计。释义由自己录入，无联网翻译和账号同步。

## Windows 安装

Intel/AMD 电脑使用 `dist/LanguageMap-1.1.0-Windows-x64.zip`；Windows on ARM 使用 `dist/LanguageMap-1.1.0-Windows-arm64.zip`。解压整个 ZIP，双击 `Install.cmd`。开始菜单会出现 LanguageMap，新开的终端可运行 `languagemap`。

应用安装在 `%LOCALAPPDATA%\Programs\LanguageMap`，数据位于 `%LOCALAPPDATA%\LanguageMap`，与源码、解压目录分离。安装包自带 .NET 运行库；若缺少或需要更新 WebView2，安装脚本会验证并运行随包提供的 Microsoft 安装器，这一步需要联网。安装后词网与界面离线工作。[微软 WebView2 部署说明](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)

已具备 WebView2 Runtime 130+ 时，也可直接打开解压目录的 `app/LanguageMap.exe`，须保留整个 `app` 文件夹。Windows 的快捷键为 `Ctrl+N`、`Ctrl+K`、`Ctrl+Q`，导出／导入备份为 `Ctrl+Shift+E`／`Ctrl+Shift+I`。

## 最简单的跨平台迁移

1. 原电脑选择 **文件 → 导出备份**，得到一个 JSON 文件。
2. 把文件复制到新电脑。
3. 新电脑选择 **文件 → 导入备份**，选择该 JSON 并确认。

**Mac 1.0 与 Windows 1.1 直接兼容，无需转换。** 单词、释义、日期、连接、布局坐标、隐藏分支和语言／外观设置一起迁移。导入会替换目标词库，并提前保存 `before-import-*.json` 完整副本。这里提供手动迁移，不做自动同步或多端合并；两台电脑各有新记录时，应先分别备份。

备份协议仍为 `{"format":"LanguageMap","version":1,"values":{...}}`，保留原有三个存储键与完整节点字段。测试用样本位于 `tests/fixtures/`；个人导出的备份必须保存在项目和公开发布包之外。

## macOS 使用

正式应用安装在 `~/Applications/LanguageMap.app`，与本项目开发目录分开。双击应用，或在任意目录运行：

```sh
languagemap
languagemap --version
languagemap --data-dir
```

首页点击“记录今天的新词”，或按 `⌘N`。点击词语编辑释义；在外语释义中选中完整词语，可延伸子连接。`⌘K` 搜索；`⌘Q` 等待最后一次保存后退出。文件菜单提供备份导出、导入和资料目录入口。

## 应用与数据分离

- 应用：`~/Applications/LanguageMap.app`。
- 启动器：`~/.local/bin/languagemap`，只调用已安装应用，不依赖开发目录。
- 词库：`~/Library/Application Support/LanguageMap/records.json`。
- 上一次成功保存：同目录下 `records.previous.json`。
- 导入前存档：同目录下 `before-import-<UUID>.json`。
- 发布包：`dist/LanguageMap-1.0.0-macOS-arm64.zip`。

第一次打开从当天空白记录开始，不加载原型的示例数据；设计原型中的浏览器存储不会自动迁入。正式版用系统当前本地日期，跨天自动刷新今日入口。卸载应用不会删除词库。建议通过“文件 → 导出备份”保存独立副本。

若词库损坏，应用会停止加载并保留原始文件；先复制整个资料目录，再用已导出的备份或 `records.previous.json` 恢复 `records.json`。不要在应用运行期间手工编辑词库。

## 实现与约束

macOS 原生层使用 Swift 6 严格并发检查及优化编译，AppKit 管理窗口与系统菜单，WKWebView 渲染界面。Windows 原生层使用 C# / .NET 10 安全托管代码与 WebView2，磁盘保存放在串行后台任务中，关闭窗口前等待最终保存确认。两端直接打包同一份 `app/Web/`，保留布局、配色、图标和交互；系统窗口装饰与字体渲染由各操作系统负责。无需 Node、Python、Rust 或开发服务器即可运行。

所有界面资源随应用打包。macOS 使用临时 WebKit 数据存储，Windows 使用独立 WebView2 InPrivate 配置，真实词库由原生层校验并原子写入；保存成功会收到原生确认。CSP 禁止网络连接和远程脚本，页面不能导航到其他来源；原生桥只允许主页面保存三种许可字段。macOS 资料目录权限为 0700、词库文件为 0600；Windows 资料目录继承当前用户 LocalAppData 的访问权限。无法保存时状态栏显示错误并支持点击重试，正常退出会等待保存，失败则保留窗口。

macOS 发布包针对 Apple Silicon / macOS 13+，采用本机 ad-hoc 签名，未做 Apple 公证。Windows 发布包针对 64 位 Windows 10 / 11，未购买代码签名证书，系统可能显示未知发布者。数据上限：单文件 16 MB、每日活动词节点 2,000 个、包含收起分支的总节点 50,000 个；应用不是加密词库。系统强制结束或断电仍可能丢失尚未写入的最近编辑。

本轮验证包括 Swift 实际应用流程、Windows 可执行文件交叉编译、C# 存储层检查、Mac → Windows → Mac 备份往返，以及 Chromium 中的 Windows 界面／原生桥模拟检查。**当前开发机是 Mac，尚未进行 Windows 原生 WebView2 与安装器的实机运行验证。** 发行包包含 `Test-Windows.cmd`，可在目标 Windows 上运行真实新增、释义、连接、重启及退出保存检查，测试数据使用独立临时目录。

## 开发与复现

```sh
bash scripts/build.sh   # 编译、生成图标、签名并制作 ZIP
bash scripts/test.sh    # JS 回归、Swift 存储检查、实际 WKWebView 流程与退出重启检查
bash scripts/install.sh
bash scripts/build-windows.sh x64
bash scripts/build-windows.sh arm64
bash scripts/test-cross-platform.sh
```

Windows builds require .NET SDK 10.0.403; the script checks `.build/dotnet/dotnet`, `LANGUAGEMAP_DOTNET`, then PATH. Dependencies are locked in `packages.lock.json`. In the Toolbox repository, run `npm run tools:setup` from the repository root for the local SDK, then `node scripts/test-chromium.cjs` from this directory. Browser tests reuse the root Playwright dependency. `package.json` explicitly preserves this tool's CommonJS test boundary.

Toolbox sets `TOOLBOX_DATA_DIR` to a dedicated managed directory. Managed launches do not adopt the standalone vocabulary or activate a standalone instance. The native host acknowledges readiness after the web view loads and flushes pending edits when its parent closes the management pipe.

两端安装脚本保留被替换的旧应用，不修改词库。测试全部使用临时资料目录，界面截图保存在 `.build/`。共用界面和 Mac 宿主位于 `app/`；Windows 宿主与存储层位于 `windows/`；原型与历史视觉稿保留在 `design/`。发布 ZIP 中含第三方许可和文件 SHA-256 清单。
