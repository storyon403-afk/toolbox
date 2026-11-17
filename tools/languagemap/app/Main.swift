import AppKit
import WebKit
import UniformTypeIdentifiers

final class BundleScheme: NSObject, WKURLSchemeHandler {
    let root: URL
    init(root: URL) { self.root = root }
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, url.host == "app",
              url.pathComponents.count == 2, !url.lastPathComponent.hasPrefix(".") else {
            task.didFailWithError(URLError(.noPermissionsToReadFile)); return
        }
        let file = root.appendingPathComponent(url.lastPathComponent)
        do {
            let data = try Data(contentsOf: file)
            let mime = ["html":"text/html", "js":"text/javascript", "css":"text/css", "svg":"image/svg+xml"][file.pathExtension] ?? "application/octet-stream"
            task.didReceive(URLResponse(url: url, mimeType: mime, expectedContentLength: data.count, textEncodingName: "utf-8"))
            task.didReceive(data); task.didFinish()
        } catch { task.didFailWithError(error) }
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandlerWithReply {
    var window: NSWindow!
    var web: WKWebView!
    var store: Store!
    var ready = false
    var closing = false
    let args = CommandLine.arguments
    var testing: Bool { args.count >= 4 && args[1] == "--self-test" }
    let managedDirectory = ProcessInfo.processInfo.environment["TOOLBOX_DATA_DIR"]

    func applicationDidFinishLaunching(_ notification: Notification) {
        if !testing, managedDirectory == nil, let identifier = Bundle.main.bundleIdentifier,
           let other = NSRunningApplication.runningApplications(withBundleIdentifier: identifier).first(where: { $0.processIdentifier != ProcessInfo.processInfo.processIdentifier }) {
            other.activate(options: [.activateAllWindows])
            exit(0)
        }
        do {
            let directory = testing ? URL(fileURLWithPath: args[2], isDirectory: true) : managedDirectory.map { URL(fileURLWithPath: $0, isDirectory: true) } ??
                FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("LanguageMap", isDirectory: true)
            store = try Store(directory: directory)
            makeMenu()
            window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1180, height: 780), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
            window.title = "LanguageMap"
            window.minSize = NSSize(width: 720, height: 540)
            window.isReleasedWhenClosed = false; window.delegate = self
            if !testing && managedDirectory == nil { window.setFrameAutosaveName("LanguageMapMain") }
            if ProcessInfo.processInfo.environment["TOOLBOX_READY_TOKEN"] != nil {
                FileHandle.standardInput.readabilityHandler = { handle in
                    if handle.availableData.isEmpty {
                        handle.readabilityHandler = nil
                        Task { @MainActor in NSApp.terminate(nil) }
                    }
                }
            }
            window.center()
            try loadWeb()
            window.makeKeyAndOrderFront(nil)
            if !testing { NSApp.activate(ignoringOtherApps: true) }
        } catch {
            if testing { finishTest(false, error.localizedDescription); return }
            let alert = NSAlert(); alert.messageText = "无法打开 LanguageMap 词库"
            alert.informativeText = "原始文件已保留，没有覆盖。\n\(error.localizedDescription)\n请检查资料目录中的 records.json 和 records.previous.json。"
            alert.addButton(withTitle: "打开资料目录"); alert.addButton(withTitle: "退出")
            if alert.runModal() == .alertFirstButtonReturn {
                NSWorkspace.shared.open(FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("LanguageMap"))
            }
            NSApp.terminate(nil)
        }
    }

    func loadWeb() throws {
        ready = false
        let root = Bundle.main.resourceURL!.appendingPathComponent("Web")
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.setURLSchemeHandler(BundleScheme(root: root), forURLScheme: "languagemap")
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        config.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "storage")
        let json = String(data: try JSONSerialization.data(withJSONObject: store.values), encoding: .utf8)!
        if testing {
            config.userContentController.addUserScript(WKUserScript(source: "window.__testErrors=[]; addEventListener('error',e=>__testErrors.push(e.message));", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        let storageJS = try String(contentsOf: root.appendingPathComponent("storage.js"), encoding: .utf8)
        config.userContentController.addUserScript(WKUserScript(source: "window.__initialStorage = \(json);\n" + storageJS, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        if let previous = web { previous.configuration.userContentController.removeAllScriptMessageHandlers() }
        web = WKWebView(frame: window.contentView!.bounds, configuration: config)
        web.navigationDelegate = self; web.uiDelegate = self
        web.autoresizingMask = [.width, .height]
        web.allowsBackForwardNavigationGestures = false
        window.contentView = web
        web.load(URLRequest(url: URL(string: "languagemap://app/index.html")!))
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame, message.frameInfo.request.url?.scheme == "languagemap",
              message.frameInfo.request.url?.host == "app", let values = message.body as? [String: String] else {
            replyHandler(nil, "不允许的保存请求。"); return
        }
        do { try store.save(values); replyHandler(true, nil) }
        catch { replyHandler(nil, error.localizedDescription) }
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
        let url = action.request.url
        decisionHandler(url?.scheme == "languagemap" && url?.host == "app" && url?.path == "/index.html" && action.targetFrame?.isMainFrame == true ? .allow : .cancel)
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable (Bool) -> Void) {
        let alert = NSAlert(); alert.messageText = message
        alert.informativeText = "删除后可从先前导出的备份恢复。"
        alert.addButton(withTitle: "取消"); alert.addButton(withTitle: "删除")
        alert.beginSheetModal(for: window) { response in completionHandler(response == .alertSecondButtonReturn) }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        ready = true
        if let token = ProcessInfo.processInfo.environment["TOOLBOX_READY_TOKEN"] {
            let message = ["toolboxReady": token, "dataDir": store.directory.path]
            if let data = try? JSONSerialization.data(withJSONObject: message) {
                FileHandle.standardOutput.write(data + Data([10]))
            }
        }
        if testing { runTest() }
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        ready = false
        showError(StoreError(message: "界面进程已停止。已写入的词库仍在本机；请重新启动应用。"))
    }

    func flush(_ completion: @escaping (Bool) -> Void) {
        guard ready else { completion(web == nil); return }
        web.callAsyncJavaScript("saveNotes(); await AppStorage.flush(); return true;", arguments: [:], in: nil, in: .page) { result in
            switch result {
            case .success: completion(true)
            case .failure(let error): self.showError(error); completion(false)
            }
        }
    }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if web == nil || !ready { return .terminateNow }
        flush { success in sender.reply(toApplicationShouldTerminate: success) }
        return .terminateLater
    }
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if closing || !ready { return true }
        flush { success in if success { self.closing = true; sender.close(); self.closing = false } }
        return false
    }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        window?.makeKeyAndOrderFront(nil); return true
    }
    func applicationDidBecomeActive(_ notification: Notification) {
        if ready { web.evaluateJavaScript("ensureToday()", completionHandler: nil) }
    }

    func showError(_ error: Error) {
        if testing { finishTest(false, error.localizedDescription); return }
        let alert = NSAlert(); alert.messageText = "操作未完成"
        alert.informativeText = error.localizedDescription
        alert.beginSheetModal(for: window)
    }
    func makeMenu() {
        let menu = NSMenu()
        func submenu(_ title: String) -> NSMenu {
            let item = NSMenuItem(); item.title = title; menu.addItem(item)
            let child = NSMenu(title: title); item.submenu = child; return child
        }
        func item(_ menu: NSMenu, _ title: String, _ action: Selector, _ key: String = "", _ target: AnyObject? = nil) {
            let i = NSMenuItem(title: title, action: action, keyEquivalent: key); i.target = target; menu.addItem(i)
        }
        let app = submenu("LanguageMap")
        item(app, "关于 LanguageMap", #selector(about), "", self)
        app.addItem(.separator()); item(app, "隐藏 LanguageMap", #selector(NSApplication.hide(_:)), "h")
        app.addItem(.separator()); item(app, "退出 LanguageMap", #selector(NSApplication.terminate(_:)), "q")
        let file = submenu("文件")
        item(file, "记录今天的新词", #selector(newWord), "n", self)
        file.addItem(.separator())
        item(file, "导出备份…", #selector(exportBackup), "", self)
        item(file, "导入备份…", #selector(importBackup), "", self)
        item(file, "打开资料目录", #selector(showData), "", self)
        file.addItem(.separator()); item(file, "关闭窗口", #selector(NSWindow.performClose(_:)), "w")
        let edit = submenu("编辑")
        item(edit, "撤销", Selector(("undo:")), "z")
        let redo = NSMenuItem(title: "重做", action: Selector(("redo:")), keyEquivalent: "z"); redo.keyEquivalentModifierMask = [.command, .shift]; edit.addItem(redo)
        item(edit, "剪切", #selector(NSText.cut(_:)), "x")
        item(edit, "复制", #selector(NSText.copy(_:)), "c")
        item(edit, "粘贴", #selector(NSText.paste(_:)), "v")
        item(edit, "全选", #selector(NSText.selectAll(_:)), "a")
        item(edit, "搜索单词", #selector(search), "k", self)
        let windows = submenu("窗口")
        item(windows, "最小化", #selector(NSWindow.performMiniaturize(_:)), "m")
        item(windows, "显示 LanguageMap", #selector(showWindow), "", self)
        NSApp.windowsMenu = windows; NSApp.mainMenu = menu
    }
    @objc func about() { NSApp.orderFrontStandardAboutPanel(options: [.credits: NSAttributedString(string: "把遇见的词，连成自己的地图。\nSwift · WebKit · 本机离线保存")]) }
    @objc func newWord() { if ready { web.evaluateJavaScript("if(!document.querySelector('dialog[open]')) { ensureToday(); enterDay(TODAY); openInsert(); }", completionHandler: nil) } }
    @objc func search() { if ready { web.evaluateJavaScript("if(!document.querySelector('#search-dialog').open)openSearch()", completionHandler: nil) } }
    @objc func showData() { NSWorkspace.shared.open(store.directory) }
    @objc func showWindow() { window.makeKeyAndOrderFront(nil) }
    @objc func exportBackup() {
        flush { success in
            guard success else { return }
            let panel = NSSavePanel(); panel.allowedContentTypes = [.json]
            panel.nameFieldStringValue = "LanguageMap-backup.json"
            panel.beginSheetModal(for: self.window) { result in
                guard result == .OK, let url = panel.url else { return }
                do { try self.store.encoded(self.store.values).write(to: url, options: .atomic) }
                catch { self.showError(error) }
            }
        }
    }
    @objc func importBackup() {
        flush { success in
            guard success else { return }
            let panel = NSOpenPanel(); panel.allowedContentTypes = [.json]; panel.allowsMultipleSelection = false
            panel.beginSheetModal(for: self.window) { result in
                guard result == .OK, let url = panel.url else { return }
                do {
                    let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                    guard size <= Store.limit else { throw StoreError(message: "备份超过 16 MB 限制。") }
                    let next = try Store.decode(Data(contentsOf: url))
                    let alert = NSAlert(); alert.messageText = "用备份替换当前词库？"
                    alert.informativeText = "导入前将另外保存完整词库，文件名以 before-import 开头。"
                    alert.addButton(withTitle: "取消"); alert.addButton(withTitle: "导入")
                    alert.beginSheetModal(for: self.window) { response in
                        guard response == .alertSecondButtonReturn else { return }
                        do {
                            let archive = self.store.directory.appendingPathComponent("before-import-\(UUID().uuidString).json")
                            try self.store.encoded(self.store.values).write(to: archive, options: .atomic)
                            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: archive.path)
                            try self.store.save(next); try self.loadWeb()
                        } catch { self.showError(error) }
                    }
                } catch { self.showError(error) }
            }
        }
    }

    func runTest() {
        do {
            let script = try String(contentsOfFile: args[3], encoding: .utf8)
            web.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { result in
                switch result {
                case .failure(let error): self.finishTest(false, error.localizedDescription)
                case .success(let value):
                    if value as? String == "TEST_QUIT" {
                        print("Testing normal quit with pending edits")
                        NSApp.terminate(nil)
                        return
                    }
                    self.web.takeSnapshot(with: nil) { image, error in
                        if let image, let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff), let png = rep.representation(using: .png, properties: [:]) {
                            try? png.write(to: self.store.directory.appendingPathComponent("screenshot.png"))
                        }
                        self.finishTest(error == nil, String(describing: value))
                    }
                }
            }
        } catch { finishTest(false, error.localizedDescription) }
    }
    func finishTest(_ ok: Bool, _ message: String) {
        print("\(ok ? "PASS" : "FAIL"): \(message)")
        fflush(stdout); exit(ok ? 0 : 1)
    }
}

@main
enum LanguageMap {
    @MainActor static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        app.run()
    }
}
