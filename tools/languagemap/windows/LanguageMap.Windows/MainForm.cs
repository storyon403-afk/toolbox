using System.Diagnostics;
using System.IO.Pipes;
using System.Text.Json;
using LanguageMap.Core;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace LanguageMap.Windows;

internal sealed class MainForm : Form
{
    private const string Origin = "https://languagemap.invalid/";
    private const string Page = Origin + "index.html";
    private readonly WebView2 web = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(237, 237, 237), AllowExternalDrop = false };
    private readonly SnapshotStore store;
    private readonly string? testScript;
    private readonly string pipeName;
    private readonly CancellationTokenSource lifetime = new();
    private readonly SemaphoreSlim writes = new(1, 1);
    private readonly Dictionary<string, TaskCompletionSource<JsonElement>> evaluations = [];
    private string? initializationScript;
    private bool ready, allowClose, closing, transferring, disposedResources;
    private TaskCompletionSource<bool>? loadComplete;

    public MainForm(SnapshotStore store, string identity, string? testScript)
    {
        this.store = store; this.testScript = testScript; pipeName = Program.PipeName + identity;
        Text = "LanguageMap"; ClientSize = new Size(1180, 804); MinimumSize = new Size(736, 602);
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.Dpi;
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        var menu = MakeMenu(); MainMenuStrip = menu;
        Controls.Add(web); Controls.Add(menu);
        Shown += async (_, _) => { try { await InitializeAsync(); } catch (Exception error) { ShowError(error); } };
        Activated += async (_, _) => { if (ready) await RunSafelyAsync(() => EvaluateAsync("ensureToday(); return true;")); };
        FormClosing += OnClosing;
        FormClosed += (_, _) => lifetime.Cancel();
        _ = ListenForActivationAsync();
    }

    private async Task ListenForActivationAsync()
    {
        try
        {
            while (!lifetime.IsCancellationRequested)
            {
                using var pipe = new NamedPipeServerStream(pipeName, PipeDirection.In, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                await pipe.WaitForConnectionAsync(lifetime.Token);
                var buffer = new byte[1]; await pipe.ReadExactlyAsync(buffer, lifetime.Token);
                if (IsDisposed) break;
                BeginInvoke(() => { if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal; Show(); Activate(); });
            }
        }
        catch (OperationCanceledException) { }
        catch (IOException) { } // The primary window remains usable if its activation pipe fails.
    }

    private async Task InitializeAsync()
    {
        var available = CoreWebView2Environment.GetAvailableBrowserVersionString();
        if (!int.TryParse(available.Split('.')[0], out var major) || major < 130)
            throw new InvalidOperationException("Microsoft WebView2 Runtime 版本过旧，请运行安装包中的 Install.cmd 更新后再打开应用。");
        var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(store.DirectoryPath, "WebView2"));
        var options = environment.CreateCoreWebView2ControllerOptions(); options.IsInPrivateModeEnabled = true;
        await web.EnsureCoreWebView2Async(environment, options);
        var core = web.CoreWebView2;
        core.SetVirtualHostNameToFolderMapping("languagemap.invalid", Path.Combine(AppContext.BaseDirectory, "Web"), CoreWebView2HostResourceAccessKind.Deny);
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.AreBrowserAcceleratorKeysEnabled = false;
        core.Settings.AreDefaultScriptDialogsEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = false;
        core.Settings.IsPinchZoomEnabled = false;
        core.Settings.IsPasswordAutosaveEnabled = false;
        core.Settings.IsGeneralAutofillEnabled = false;
        core.Settings.IsBuiltInErrorPageEnabled = false;
        core.NavigationStarting += (_, e) => { if (e.Uri != Page) e.Cancel = true; };
        core.FrameNavigationStarting += (_, e) => e.Cancel = true;
        core.NewWindowRequested += (_, e) => e.Handled = true;
        core.DownloadStarting += (_, e) => e.Cancel = true;
        core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
        core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All, CoreWebView2WebResourceRequestSourceKinds.All);
        core.WebResourceRequested += (_, e) =>
        {
            if (!Uri.TryCreate(e.Request.Uri, UriKind.Absolute, out var uri) || uri.Scheme != "https" || uri.Host != "languagemap.invalid")
                e.Response = environment.CreateWebResourceResponse(new MemoryStream(), 403, "Blocked", "Content-Type: text/plain");
        };
        core.ProcessFailed += (_, e) =>
        {
            ready = false;
            foreach (var promise in evaluations.Values) promise.TrySetException(new IOException("界面进程已停止，请重新打开应用。"));
            evaluations.Clear(); ShowError(new IOException($"界面进程已停止（{e.ProcessFailedKind}），已保存的词库仍在本机。"));
        };
        core.ScriptDialogOpening += (_, e) =>
        {
            if (e.Kind == CoreWebView2ScriptDialogKind.Confirm && MessageBox.Show(this, e.Message, "LanguageMap", MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2) == DialogResult.Yes) e.Accept();
            else if (e.Kind == CoreWebView2ScriptDialogKind.Alert) { MessageBox.Show(this, e.Message, "LanguageMap"); e.Accept(); }
        };
        core.WebMessageReceived += ReceiveMessage;
        web.KeyDown += (_, e) =>
        {
            var key = e.KeyData;
            Func<Task>? action = key switch
            {
                Keys.Control | Keys.Q => () => { Close(); return Task.CompletedTask; },
                Keys.Control | Keys.Shift | Keys.E => ExportAsync,
                Keys.Control | Keys.Shift | Keys.I => ImportAsync,
                _ => null
            };
            if (action is null) return;
            e.Handled = true; e.SuppressKeyPress = true;
            BeginInvoke(async () => await RunSafelyAsync(action));
        };
        core.NavigationCompleted += async (_, e) =>
        {
            try
            {
                if (!e.IsSuccess) throw new IOException($"界面加载失败：{e.WebErrorStatus}");
                await EvaluateAsync("if(typeof enterDay !== 'function' || window.__testErrors.length) throw Error('界面加载失败：'+JSON.stringify(window.__testErrors)); return true;");
                ready = true; loadComplete?.TrySetResult(true);
            }
            catch (Exception error) { loadComplete?.TrySetException(error); }
        };
        await LoadPageAsync();
        if (testScript is not null) await RunSelfTestAsync();
        else if (Environment.GetEnvironmentVariable("TOOLBOX_READY_TOKEN") is { } token)
        {
            // The manager owns these redirected pipes; EOF requests a normal flushed close.
            using (var output = new StreamWriter(Console.OpenStandardOutput(), new System.Text.UTF8Encoding(false), leaveOpen: true) { AutoFlush = true })
                await output.WriteLineAsync(JsonSerializer.Serialize(new { toolboxReady = token, dataDir = store.DirectoryPath }));
            _ = Task.Run(async () =>
            {
                using var input = new StreamReader(Console.OpenStandardInput());
                while (await input.ReadLineAsync() is not null) { }
                if (!IsDisposed) BeginInvoke(() => Close());
            });
        }
    }

    private async Task LoadPageAsync()
    {
        ready = false; loadComplete = new(TaskCreationOptions.RunContinuationsAsynchronously);
        if (initializationScript is not null) web.CoreWebView2.RemoveScriptToExecuteOnDocumentCreated(initializationScript);
        using var bridgeReader = new StreamReader(typeof(MainForm).Assembly.GetManifestResourceStream("LanguageMap.Bridge.js")!);
        var bootstrap = "window.__initialStorage=" + JsonSerializer.Serialize(store.Values) + ";\n"
            + "window.__testErrors=[]; addEventListener('error',e=>__testErrors.push(e.message));\n"
            + await bridgeReader.ReadToEndAsync()
            + File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Web", "storage.js"));
        initializationScript = await web.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(bootstrap);
        web.CoreWebView2.Navigate(Page);
        await loadComplete.Task.WaitAsync(TimeSpan.FromSeconds(30));
    }

    private async void ReceiveMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (e.Source != Page) return;
        string? id = null;
        try
        {
            var raw = e.WebMessageAsJson;
            if (System.Text.Encoding.UTF8.GetByteCount(raw) > SnapshotStore.Limit + 4096) throw new InvalidDataException("保存请求过大。");
            using var doc = JsonDocument.Parse(raw);
            var root = doc.RootElement; id = root.GetProperty("id").GetString();
            if (string.IsNullOrEmpty(id) || id.Length > 80) return;
            var method = root.GetProperty("method").GetString();
            if (method == "evalResult")
            {
                if (!evaluations.Remove(id, out var promise)) return;
                if (root.TryGetProperty("error", out var error)) promise.TrySetException(new InvalidOperationException(error.GetString()));
                else promise.TrySetResult(root.GetProperty("result").Clone());
                return;
            }
            if (method != "save") throw new InvalidDataException("不允许的请求。");
            var values = SnapshotStore.ParseValues(root.GetProperty("values"));
            await writes.WaitAsync();
            try { await Task.Run(() => store.Save(values)); }
            finally { writes.Release(); }
            web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { id, result = true }));
        }
        catch (Exception error)
        {
            if (id is not null && !IsDisposed) web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { id, error = error.Message }));
        }
    }

    private async Task<JsonElement> EvaluateAsync(string body)
    {
        var id = Guid.NewGuid().ToString("N");
        var completion = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        evaluations.Add(id, completion);
        try
        {
            await web.CoreWebView2.ExecuteScriptAsync("(async()=>{try { const result=await (async()=>{" + body + "})(); chrome.webview.postMessage({method:'evalResult',id:'" + id + "',result:result??null}); }catch(e){chrome.webview.postMessage({method:'evalResult',id:'" + id + "',error:String(e.message||e)});}})()");
            return await completion.Task.WaitAsync(TimeSpan.FromSeconds(35));
        }
        finally { evaluations.Remove(id); }
    }
    private async Task FlushAsync()
    {
        if (!ready) throw new InvalidOperationException("界面尚未准备好，请稍后重试。");
        await EvaluateAsync("saveNotes(); await AppStorage.flush(); return true;");
    }
    private async void OnClosing(object? sender, FormClosingEventArgs e)
    {
        if (allowClose || !ready) return;
        e.Cancel = true;
        if (closing || transferring) return;
        closing = true; web.Enabled = false;
        try { await FlushAsync(); allowClose = true; Close(); }
        catch (Exception error) { ShowError(error); }
        finally { closing = false; if (!IsDisposed) web.Enabled = true; }
    }

    private MenuStrip MakeMenu()
    {
        var menu = new MenuStrip { BackColor = Color.FromArgb(247, 247, 247), Renderer = new ToolStripProfessionalRenderer() };
        var file = new ToolStripMenuItem("文件(&F)");
        void Add(ToolStripMenuItem group, string title, Func<Task> action, Keys shortcut = Keys.None)
        {
            var item = new ToolStripMenuItem(title) { ShortcutKeys = shortcut };
            item.Click += async (_, _) => await RunSafelyAsync(action); group.DropDownItems.Add(item);
        }
        Add(file, "记录今天的新词", () => EvaluateAsync("if(!document.querySelector('dialog[open]')){ensureToday(); enterDay(TODAY); openInsert();}return true;"), Keys.Control | Keys.N);
        file.DropDownItems.Add(new ToolStripSeparator());
        Add(file, "导出备份…", ExportAsync, Keys.Control | Keys.Shift | Keys.E);
        Add(file, "导入备份…", ImportAsync, Keys.Control | Keys.Shift | Keys.I);
        Add(file, "打开资料目录", () => { Process.Start(new ProcessStartInfo(store.DirectoryPath) { UseShellExecute = true }); return Task.CompletedTask; });
        file.DropDownItems.Add(new ToolStripSeparator());
        Add(file, "退出", () => { Close(); return Task.CompletedTask; }, Keys.Control | Keys.Q);
        var edit = new ToolStripMenuItem("编辑(&E)");
        foreach (var (name, command) in new[] { ("撤销", "undo"), ("重做", "redo"), ("剪切", "cut"), ("复制", "copy"), ("全选", "selectAll") })
            Add(edit, name, () => EvaluateAsync($"document.execCommand('{command}'); return true;"));
        Add(edit, "粘贴", async () =>
        {
            if (!Clipboard.ContainsText()) return;
            var text = JsonSerializer.Serialize(Clipboard.GetText());
            await EvaluateAsync($"if(document.activeElement.matches('input,textarea,[contenteditable=true]')) document.execCommand('insertText',false,{text});return true;");
        });
        Add(edit, "搜索单词", () => EvaluateAsync("if(!document.querySelector('#search-dialog').open)openSearch();return true;"), Keys.Control | Keys.K);
        var help = new ToolStripMenuItem("帮助(&H)");
        Add(help, "跨平台迁移", () => { MessageBox.Show(this, "1. 在原电脑选择 文件 → 导出备份。\n2. 将 JSON 文件复制到新电脑。\n3. 在新电脑选择 文件 → 导入备份。\n\nMac 与 Windows 使用同一格式，无需转换。\n导入替换当前词库，替换前自动保存完整副本。", "词网迁移"); return Task.CompletedTask; });
        Add(help, "关于 LanguageMap", () => { MessageBox.Show(this, "LanguageMap 1.1.0\n把遇见的词，连成自己的地图。\n\n本机离线保存 · C# / .NET / WebView2", "LanguageMap"); return Task.CompletedTask; });
        menu.Items.AddRange([file, edit, help]); return menu;
    }

    private async Task TransferAsync(Func<Task> action)
    {
        if (transferring || closing || !ready) return;
        transferring = true; web.Enabled = false;
        try { await FlushAsync(); await action(); }
        finally { transferring = false; if (!IsDisposed) web.Enabled = true; }
    }
    private Task ExportAsync() => TransferAsync(async () =>
    {
        using var dialog = new SaveFileDialog { Filter = "LanguageMap 备份 (*.json)|*.json", FileName = $"LanguageMap-backup-{DateTime.Now:yyyy-MM-dd}.json", AddExtension = true, DefaultExt = "json" };
        if (dialog.ShowDialog(this) == DialogResult.OK) await Task.Run(() => store.Export(dialog.FileName));
    });
    private Task ImportAsync() => TransferAsync(async () =>
    {
        using var dialog = new OpenFileDialog { Filter = "LanguageMap 备份 (*.json)|*.json", Multiselect = false, CheckFileExists = true };
        if (dialog.ShowDialog(this) != DialogResult.OK) return;
        var bytes = await Task.Run(() => SnapshotStore.ReadLimited(dialog.FileName));
        var values = await Task.Run(() => SnapshotStore.Decode(bytes));
        var count = 0;
        if (values.TryGetValue("languagemap-v03-edits", out var records))
        { using var document = JsonDocument.Parse(records); count = document.RootElement.EnumerateObject().Sum(day => day.Value.GetArrayLength()); }
        if (MessageBox.Show(this, $"备份包含 {count} 个单词。\n\n用此备份替换当前词库？\n导入前会自动保存完整副本，文件名以 before-import 开头。", "导入词网", MessageBoxButtons.OKCancel, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2) != DialogResult.OK) return;
        await Task.Run(() => store.Import(bytes));
        await LoadPageAsync();
    });
    private async Task RunSafelyAsync(Func<Task> action)
    {
        try { await action(); } catch (Exception error) { ShowError(error); }
    }
    private void ShowError(Exception error)
    {
        if (IsDisposed) return;
        if (testScript is not null)
        {
            File.WriteAllText(Path.Combine(store.DirectoryPath, "test-result.json"), JsonSerializer.Serialize(new { ok = false, error = error.ToString() }));
            Environment.ExitCode = 1; allowClose = true; Close(); return;
        }
        var message = error is WebView2RuntimeNotFoundException
            ? "缺少 Microsoft Edge WebView2 Runtime。请运行安装包中的 Install.cmd 完成安装，再打开 LanguageMap。"
            : error.Message;
        MessageBox.Show(this, message, "操作未完成", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }
    private async Task RunSelfTestAsync()
    {
        var result = await EvaluateAsync(await File.ReadAllTextAsync(testScript!));
        if (result.ValueKind == JsonValueKind.String && result.GetString() == "TEST_QUIT")
        {
            File.WriteAllText(Path.Combine(store.DirectoryPath, "test-result.json"), "{\"ok\":true,\"result\":\"quit requested\"}");
            Close(); return;
        }
        using (var image = File.Create(Path.Combine(store.DirectoryPath, "screenshot.png")))
            await web.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, image);
        File.WriteAllText(Path.Combine(store.DirectoryPath, "test-result.json"), JsonSerializer.Serialize(new { ok = true, result }));
        await FlushAsync(); allowClose = true; Close();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing && !disposedResources)
        {
            disposedResources = true; lifetime.Cancel(); web.Dispose(); lifetime.Dispose();
        }
        base.Dispose(disposing);
    }
}
