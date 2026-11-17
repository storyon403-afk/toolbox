using System.Globalization;
using System.Text;
using System.Text.Json;

namespace LanguageMap.Core;

// Version 1 is exactly the format written by the existing Swift application.
// Keep original JSON strings so future node fields and detached branches survive.
public sealed class SnapshotStore
{
    public const int Limit = 16 * 1024 * 1024;
    private static readonly HashSet<string> Allowed = ["languagemap-v03-edits", "languagemap-ui-language", "languagemap-theme"];
    private readonly object gate = new();
    private Dictionary<string, string> values;
    public string DirectoryPath { get; }
    public string FilePath => Path.Combine(DirectoryPath, "records.json");
    public string BackupPath => Path.Combine(DirectoryPath, "records.previous.json");
    public Dictionary<string, string> Values { get { lock (gate) return new(values); } }

    public SnapshotStore(string directory)
    {
        DirectoryPath = directory;
        Directory.CreateDirectory(directory);
        values = File.Exists(FilePath) ? Decode(ReadLimited(FilePath)) : [];
    }

    public static byte[] ReadLimited(string path)
    {
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete);
        if (stream.Length > Limit) throw new InvalidDataException("备份超过 16 MB 限制。");
        using var buffer = new MemoryStream();
        var block = new byte[8192];
        int read;
        while ((read = stream.Read(block)) > 0)
        {
            if (buffer.Length + read > Limit) throw new InvalidDataException("备份超过 16 MB 限制。");
            buffer.Write(block, 0, read);
        }
        return buffer.ToArray();
    }

    public static Dictionary<string, string> Decode(byte[] data)
    {
        if (data.Length > Limit) throw new InvalidDataException("备份超过 16 MB 限制。");
        using var document = JsonDocument.Parse(data, new JsonDocumentOptions { MaxDepth = 128 });
        var root = document.RootElement;
        Require(root.ValueKind == JsonValueKind.Object && root.GetProperty("format").GetString() == "LanguageMap"
            && root.GetProperty("version").GetInt32() == 1, "不是受支持的 LanguageMap 备份。");
        var result = ParseValues(root.GetProperty("values"));
        Validate(result);
        return result;
    }

    public static Dictionary<string, string> ParseValues(JsonElement element)
    {
        Require(element.ValueKind == JsonValueKind.Object, "词库数据无效。");
        var result = new Dictionary<string, string>();
        foreach (var property in element.EnumerateObject())
        {
            Require(Allowed.Contains(property.Name) && property.Value.ValueKind == JsonValueKind.String
                && !result.ContainsKey(property.Name), "词库包含未知、重复或无效字段。");
            result.Add(property.Name, property.Value.GetString()!);
        }
        return result;
    }

    public static void Validate(IReadOnlyDictionary<string, string> candidate)
    {
        Require(candidate.Keys.All(Allowed.Contains), "词库包含未知字段。");
        if (candidate.TryGetValue("languagemap-ui-language", out var language))
            Require(language is "zh" or "en" or "ja", "界面语言无效。");
        if (candidate.TryGetValue("languagemap-theme", out var theme))
            Require(theme is "mono" or "glass", "外观设置无效。");
        if (!candidate.TryGetValue("languagemap-v03-edits", out var records)) return;
        Require(Encoding.UTF8.GetByteCount(records) <= Limit, "词库超过 16 MB 限制。");
        using var document = JsonDocument.Parse(records, new JsonDocumentOptions { MaxDepth = 128 });
        Require(document.RootElement.ValueKind == JsonValueKind.Object, "词库格式无效。");
        var dates = new HashSet<string>();
        var total = 0;
        foreach (var day in document.RootElement.EnumerateObject())
        {
            Require(DateOnly.TryParseExact(day.Name, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _)
                && dates.Add(day.Name), "记录日期无效或重复。");
            ValidateNodes(day.Value, 0, ref total);
        }
    }

    private static void ValidateNodes(JsonElement list, int depth, ref int total)
    {
        Require(list.ValueKind == JsonValueKind.Array && depth < 32, "词网格式无效或嵌套过深。");
        total += list.GetArrayLength();
        Require(total <= 50000 && list.GetArrayLength() <= 2000, "词网节点数量超出限制。");
        var parents = new Dictionary<string, string?>();
        foreach (var node in list.EnumerateArray())
        {
            var id = Text(node, "id"); var word = Text(node, "word");
            Require(id.Length > 0 && Encoding.UTF8.GetByteCount(id) < 256 && !parents.ContainsKey(id), "词网节点 ID 无效或重复。");
            Require(word.Length > 0 && new StringInfo(word).LengthInTextElements <= 60, "单词长度无效。");
            foreach (var axis in new[] { "x", "y" })
                Require(node.GetProperty(axis).TryGetDouble(out var coordinate) && double.IsFinite(coordinate) && Math.Abs(coordinate) < 1000000, "词网坐标无效。");
            Require(Encoding.UTF8.GetByteCount(Text(node, "zh")) <= 100000 && Encoding.UTF8.GetByteCount(Text(node, "en")) <= 100000, "释义过长。");
            Require(node.GetProperty("folded").ValueKind is JsonValueKind.True or JsonValueKind.False, "词网折叠状态无效。");
            string? parent = null;
            if (node.TryGetProperty("parent", out var parentValue) && parentValue.ValueKind != JsonValueKind.Null)
            {
                Require(parentValue.ValueKind == JsonValueKind.String, "词网连接无效。");
                parent = parentValue.GetString();
            }
            parents.Add(id, parent);
            if (!node.TryGetProperty("detachedBranches", out var branches) || branches.ValueKind == JsonValueKind.Null) continue;
            Require(branches.ValueKind == JsonValueKind.Array, "收起分支无效。");
            foreach (var branch in branches.EnumerateArray())
            {
                _ = Text(branch, "word");
                ValidateNodes(branch.GetProperty("nodes"), depth + 1, ref total);
            }
        }
        foreach (var id in parents.Keys)
        {
            var seen = new HashSet<string>(); string? cursor = id;
            while (cursor is not null)
            {
                Require(seen.Add(cursor), "词网连接形成循环。");
                cursor = parents.GetValueOrDefault(cursor);
            }
        }
    }

    private static string Text(JsonElement node, string key)
    {
        var value = node.GetProperty(key);
        Require(value.ValueKind == JsonValueKind.String, "词网文字无效。");
        return value.GetString()!;
    }
    private static void Require(bool condition, string message)
    {
        if (!condition) throw new InvalidDataException(message);
    }

    public static byte[] Encode(IReadOnlyDictionary<string, string> candidate)
    {
        Validate(candidate);
        var data = JsonSerializer.SerializeToUtf8Bytes(new { format = "LanguageMap", version = 1, values = candidate },
            new JsonSerializerOptions { WriteIndented = true });
        Require(data.Length <= Limit, "备份超过 16 MB 限制。");
        return data;
    }

    public void Save(IReadOnlyDictionary<string, string> candidate)
    {
        // Validation and disk I/O run on a serial worker; UI receives success only after durable flush.
        lock (gate)
        {
            var next = new Dictionary<string, string>(candidate);
            var bytes = Encode(next);
            if (next.Count == values.Count && next.All(pair => values.TryGetValue(pair.Key, out var v) && v == pair.Value) && File.Exists(FilePath)) return;
            if (File.Exists(FilePath)) AtomicWrite(BackupPath, ReadLimited(FilePath));
            AtomicWrite(FilePath, bytes);
            values = next;
        }
    }
    public string Import(byte[] data)
    {
        var next = Decode(data); // Reject before making any changes.
        lock (gate)
        {
            var archive = Path.Combine(DirectoryPath, $"before-import-{Guid.NewGuid()}.json");
            AtomicWrite(archive, Encode(values));
            Save(next);
            return archive;
        }
    }
    public void Export(string path)
    {
        lock (gate) AtomicWrite(path, Encode(values));
    }
    public static void AtomicWrite(string path, byte[] data)
    {
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            { stream.Write(data); stream.Flush(flushToDisk: true); }
            File.Move(temporary, path, overwrite: true);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
}
