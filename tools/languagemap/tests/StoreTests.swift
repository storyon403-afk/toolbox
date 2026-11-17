import Foundation

@main enum StoreTests {
    static func main() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("LanguageMapStoreTests-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try Store(directory: directory)
        var checked = 0
        func check(_ condition: Bool, _ message: String) {
            precondition(condition, message); checked += 1
        }
        func rejects(_ action: () throws -> Void) {
            do { try action(); fatalError("Invalid data accepted") } catch { checked += 1 }
        }
        let records = #"{"2026-11-05":[{"id":"root","word":"hello","x":1,"y":2,"parent":null,"zh":"你好","en":"greeting","folded":false}]}"#
        let initial = ["languagemap-v03-edits": records, "languagemap-ui-language": "zh"]
        try store.save(initial)
        check(try Store(directory: directory).values == initial, "Reopen must retain values")
        var next = initial; next["languagemap-theme"] = "glass"
        try store.save(next)
        check(try Store.decode(Data(contentsOf: store.backup)) == initial, "Previous save must be recoverable")
        check(try Store.decode(store.encoded(next)) == next, "Export/import round trip")
        rejects { try store.save(["unexpected": "x"]) }
        rejects { try store.save(["languagemap-ui-language": "xx"]) }
        rejects { try store.save(["languagemap-v03-edits": records.replacingOccurrences(of: "2026-11-05", with: "2026-02-30")]) }
        rejects { try store.save(["languagemap-v03-edits": records.replacingOccurrences(of: "\"parent\":null", with: "\"parent\":\"root\"")]) }
        rejects { try store.save(["languagemap-v03-edits": "{\"2026-11-05\":[{}]}"]) }
        check(try Store(directory: directory).values == next, "Rejected data must not corrupt library")
        let permissions = try FileManager.default.attributesOfItem(atPath: store.file.path)[.posixPermissions] as! NSNumber
        check(permissions.intValue == 0o600, "User-only record permissions")
        try Data("broken".utf8).write(to: store.file)
        rejects { _ = try Store(directory: directory) }
        check(try String(contentsOf: store.file, encoding: .utf8) == "broken", "Corrupt input must remain untouched")
        print("PASS: \(checked) store checks")
    }
}
