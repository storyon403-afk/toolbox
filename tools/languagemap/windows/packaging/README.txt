LanguageMap 1.1.0 · Windows

使用方法
1. 解压整个 ZIP 文件。
2. 双击 Install.cmd。应用安装到当前用户目录，不需要以管理员身份运行。
3. 从开始菜单打开 LanguageMap，或在新开的终端输入 languagemap。

若已安装 Microsoft WebView2 Runtime，也可直接双击 app/LanguageMap.exe。
保留整个 app 目录，不要只复制 EXE。软件自带 .NET 运行库，无需安装开发工具。
首次安装若缺少 WebView2，Install.cmd 会验证并运行随包提供的微软安装器；此时需要联网。
应用界面和词库离线运行，不启动本地服务器，不上传词网。

最简单的 Mac ↔ Windows 词网迁移
1. 原电脑：文件 → 导出备份，得到一个 JSON 文件。
2. 用 U 盘、局域网或你习惯的传文件方式复制该文件。
3. 新电脑：文件 → 导入备份 → 选中 JSON → 确认导入。

无需转换格式。单词、母语／外语释义、连接、日期、节点位置、隐藏分支和外观／语言设置一起迁移。
导入会替换目标电脑词库；替换前自动创建 before-import-*.json 完整备份。
这是手动迁移，不是自动同步或合并，两台电脑同时编辑后请先各自导出备份。

快捷键
Ctrl+N：记录今天的新词
Ctrl+K：搜索
Ctrl+Shift+E：导出备份
Ctrl+Shift+I：导入备份
Ctrl+Q：保存后退出

独立目录
应用：%LOCALAPPDATA%\Programs\LanguageMap
数据：%LOCALAPPDATA%\LanguageMap\records.json
上一次保存：%LOCALAPPDATA%\LanguageMap\records.previous.json
导入前存档：%LOCALAPPDATA%\LanguageMap\before-import-*.json

卸载或更换应用目录不会删除词库。请勿在软件运行时手工改写 records.json。
保留备份文件；它包含你的词网明文，不要放入公开代码库或公开安装包。

系统：64 位 Windows 10 / 11；x64 包适用于 Intel/AMD，ARM64 包适用于 Windows on ARM。
本版本未购买 Windows 代码签名证书。Windows 可能显示未知发布者提示。
本包在 macOS 交叉编译；实际 WebView2 冒烟脚本位于 tests，运行 Test-Windows.cmd 可在 Windows 本机检查。
