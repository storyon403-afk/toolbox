import Foundation

@main enum Interop {
    static func main() throws {
        let args = CommandLine.arguments
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("LanguageMapInterop-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try Store(directory: directory)
        let data = try Data(contentsOf: URL(fileURLWithPath: args[1]))
        let values = try Store.decode(data)
        try store.save(values)
        let reloaded = try Store(directory: directory)
        guard reloaded.values == values else { throw StoreError(message: "Interop lost values") }
        try reloaded.encoded(reloaded.values).write(to: URL(fileURLWithPath: args[2]), options: .atomic)
        print("PASS: Swift decoded, saved, reopened and exported the complete cross-platform backup")
    }
}
