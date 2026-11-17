using System.Text;
using System.Text.Json;
using LanguageMap.Core;

if (args.Length == 3 && args[0] == "roundtrip")
{
    var values = SnapshotStore.Decode(SnapshotStore.ReadLimited(args[1]));
    SnapshotStore.AtomicWrite(args[2], SnapshotStore.Encode(values));
    Console.WriteLine("PASS: .NET decoded and re-exported the complete Swift-compatible backup"); return;
}
var directory = Path.Combine(Path.GetTempPath(), "LanguageMap-core-test-" + Guid.NewGuid());
Directory.CreateDirectory(directory);
try
{
    int checks = 0;
    void Check(bool condition, string message) { if (!condition) throw new Exception(message); checks++; }
    void Reject(Action action)
    {
        bool rejected = false;
        try { action(); } catch (Exception) { rejected = true; }
        Check(rejected, "Invalid backup accepted");
    }
    var fixture = SnapshotStore.ReadLimited(args[0]);
    var original = SnapshotStore.Decode(fixture);
    var store = new SnapshotStore(directory);
    Check(store.Values.Count == 0, "Fresh profile must be empty");
    store.Save(original);
    Check(new SnapshotStore(directory).Values["languagemap-v03-edits"] == original["languagemap-v03-edits"], "Restart preserves every node field");
    var next = new Dictionary<string, string>(original) { ["languagemap-theme"] = "glass" };
    store.Save(next);
    Check(SnapshotStore.Decode(SnapshotStore.ReadLimited(store.BackupPath))["languagemap-theme"] == original["languagemap-theme"], "Previous-save backup missing");
    var export = Path.Combine(directory, "export.json"); store.Export(export);
    var restored = new SnapshotStore(Path.Combine(directory, "other-platform"));
    var archive = restored.Import(SnapshotStore.ReadLimited(export));
    Check(restored.Values["languagemap-v03-edits"] == original["languagemap-v03-edits"], "Export/import lost content");
    Check(SnapshotStore.Decode(SnapshotStore.ReadLimited(archive)).Count == 0, "Import must archive prior library");
    Reject(() => store.Save(new Dictionary<string, string> { ["unknown"] = "x" }));
    Reject(() => store.Save(new Dictionary<string, string> { ["languagemap-ui-language"] = "xx" }));
    Reject(() => store.Save(new Dictionary<string, string> { ["languagemap-v03-edits"] = original["languagemap-v03-edits"].Replace("2024-02-29", "2024-02-30") }));
    Reject(() => store.Save(new Dictionary<string, string> { ["languagemap-v03-edits"] = "{\"2026-11-05\":[{}]}" }));
    Reject(() => store.Import(Encoding.UTF8.GetBytes("{}")));
    Check(store.Values["languagemap-theme"] == "glass", "Invalid imports changed current data");
    using (var doc = JsonDocument.Parse(original["languagemap-v03-edits"]))
    {
        var node = JsonSerializer.Deserialize<Dictionary<string, object?>>(doc.RootElement.EnumerateObject().First().Value[0].GetRawText())!;
        node["parent"] = node["id"];
        Reject(() => store.Save(new Dictionary<string, string> { ["languagemap-v03-edits"] = JsonSerializer.Serialize(new Dictionary<string, object> { ["2026-11-05"] = new[] { node } }) }));
    }
    Reject(() => SnapshotStore.Decode(new byte[SnapshotStore.Limit + 1]));
    File.WriteAllText(store.FilePath, "broken");
    Reject(() => new SnapshotStore(directory));
    Check(File.ReadAllText(store.FilePath) == "broken", "Startup overwrote corrupt records");
    Check(Directory.GetFiles(directory, "*.tmp").Length == 0, "Leaked temporary file");
    Console.WriteLine($"PASS: {checks} Windows store checks (executed on {System.Runtime.InteropServices.RuntimeInformation.OSDescription})");
}
finally { Directory.Delete(directory, recursive: true); }
