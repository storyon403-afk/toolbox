using System.IO.Pipes;
using LanguageMap.Core;

namespace LanguageMap.Windows;

internal static class Program
{
    internal static string DataDirectory => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "LanguageMap");
    internal const string PipeName = "LanguageMap-1-";
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        var testing = args.Length == 3 && args[0] == "--self-test";
        var managed = Environment.GetEnvironmentVariable("TOOLBOX_DATA_DIR");
        var data = testing ? Path.GetFullPath(args[1]) : string.IsNullOrEmpty(managed) ? DataDirectory : Path.GetFullPath(managed);
        if (args.Length > 0 && !testing)
        {
            if (args[0] == "--data-dir") { MessageBox.Show(data, "LanguageMap 资料目录"); return; }
            MessageBox.Show("请通过 languagemap --help 查看命令用法。", "LanguageMap"); return;
        }
        var identity = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(data)))[..16];
        using var mutex = new Mutex(true, @"Local\LanguageMap-" + identity, out var isFirst);
        if (!isFirst)
        {
            try
            {
                using var client = new NamedPipeClientStream(".", PipeName + identity, PipeDirection.Out);
                client.Connect(3000); client.WriteByte(1);
            }
            catch (Exception) { MessageBox.Show("LanguageMap 已在运行，请从任务栏打开。", "LanguageMap"); }
            return;
        }
        try
        {
            var store = new SnapshotStore(data);
            using var form = new MainForm(store, identity, testing ? Path.GetFullPath(args[2]) : null);
            Application.Run(form);
        }
        catch (Exception error)
        {
            if (testing) { File.WriteAllText(Path.Combine(data, "test-result.json"), System.Text.Json.JsonSerializer.Serialize(new { ok = false, error = error.Message })); Environment.ExitCode = 1; }
            else MessageBox.Show($"无法打开 LanguageMap，原始词库未被覆盖。\n\n{error.Message}\n\n资料目录：{data}", "LanguageMap", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
