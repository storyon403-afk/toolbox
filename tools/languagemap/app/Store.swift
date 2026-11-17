import Foundation

struct StoreError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

struct WordNode: Decodable {
    let id: String
    let word: String
    let x: Double
    let y: Double
    let parent: String?
    let zh: String
    let en: String
    let folded: Bool
    let detachedBranches: [DetachedBranch]?
}
struct DetachedBranch: Decodable { let word: String; let nodes: [WordNode] }
struct Snapshot: Codable {
    let format: String
    let version: Int
    let values: [String: String]
    init(_ values: [String: String]) {
        format = "LanguageMap"; version = 1; self.values = values
    }
}

final class Store {
    static let limit = 16 * 1024 * 1024
    let directory: URL
    var file: URL { directory.appendingPathComponent("records.json") }
    var backup: URL { directory.appendingPathComponent("records.previous.json") }
    private(set) var values: [String: String] = [:]

    init(directory: URL) throws {
        self.directory = directory
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700])
        if FileManager.default.fileExists(atPath: file.path) {
            // Never overwrite an unreadable library with an empty one.
            values = try Self.decode(Data(contentsOf: file))
        }
    }

    static func validate(_ values: [String: String]) throws {
        let allowed: Set<String> = ["languagemap-v03-edits", "languagemap-ui-language", "languagemap-theme"]
        guard Set(values.keys).isSubset(of: allowed) else { throw StoreError(message: "备份包含未知数据字段。") }
        if let language = values["languagemap-ui-language"], !["zh", "en", "ja"].contains(language) {
            throw StoreError(message: "界面语言无效。")
        }
        if let theme = values["languagemap-theme"], !["mono", "glass"].contains(theme) {
            throw StoreError(message: "外观设置无效。")
        }
        if let records = values["languagemap-v03-edits"] {
            guard records.utf8.count <= limit else { throw StoreError(message: "词库超过 16 MB 限制。") }
            let days = try JSONDecoder().decode([String: [WordNode]].self, from: Data(records.utf8))
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.timeZone = TimeZone(secondsFromGMT: 0)
            formatter.dateFormat = "yyyy-MM-dd"; formatter.isLenient = false
            var total = 0
            for (day, nodes) in days {
                guard day.count == 10, let date = formatter.date(from: day), formatter.string(from: date) == day else {
                    throw StoreError(message: "记录日期无效。")
                }
                try validateNodes(nodes, depth: 0, total: &total)
            }
        }
    }

    private static func validateNodes(_ nodes: [WordNode], depth: Int, total: inout Int) throws {
        total += nodes.count
        guard depth < 32, total <= 50000, nodes.count <= 2000 else { throw StoreError(message: "词网过大或嵌套过深。") }
        var parents: [String: String] = [:], ids = Set<String>()
        for n in nodes {
            guard !n.id.isEmpty, n.id.utf8.count < 256, ids.insert(n.id).inserted,
                  !n.word.isEmpty, n.word.count <= 60, n.x.isFinite, n.y.isFinite,
                  abs(n.x) < 1000000, abs(n.y) < 1000000,
                  n.zh.utf8.count <= 100000, n.en.utf8.count <= 100000 else {
                throw StoreError(message: "词网节点内容无效或超出限制。")
            }
            parents[n.id] = n.parent
            for branch in n.detachedBranches ?? [] { try validateNodes(branch.nodes, depth: depth + 1, total: &total) }
        }
        for id in ids {
            var seen = Set<String>(), cursor: String? = id
            while let current = cursor {
                guard seen.insert(current).inserted else { throw StoreError(message: "词网连接形成循环。") }
                cursor = parents[current]
            }
        }
    }

    static func decode(_ data: Data) throws -> [String: String] {
        guard data.count <= limit else { throw StoreError(message: "备份超过 16 MB 限制。") }
        let snapshot = try JSONDecoder().decode(Snapshot.self, from: data)
        guard snapshot.format == "LanguageMap", snapshot.version == 1 else { throw StoreError(message: "备份格式或版本不受支持。") }
        try validate(snapshot.values)
        return snapshot.values
    }
    func encoded(_ values: [String: String]) throws -> Data {
        try Self.validate(values)
        let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(Snapshot(values))
        guard data.count <= Self.limit else { throw StoreError(message: "词库超过 16 MB 限制。") }
        return data
    }
    func save(_ next: [String: String]) throws {
        let data = try encoded(next)
        if next == values && FileManager.default.fileExists(atPath: file.path) { return }
        if FileManager.default.fileExists(atPath: file.path) {
            try Data(contentsOf: file).write(to: backup, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: backup.path)
        }
        try data.write(to: file, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
        values = next
    }
}
