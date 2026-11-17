import AppKit

// 使用系统 SVG 渲染器，避免第三方转换器丢失路径或透明度。
guard CommandLine.arguments.count == 3,
      let image = NSImage(contentsOfFile: CommandLine.arguments[1]) else {
    fatalError("需要 SVG 输入与 PNG 输出路径")
}
var rect = NSRect(x: 0, y: 0, width: 1024, height: 1024)
guard let cg = image.cgImage(forProposedRect: &rect, context: nil, hints: nil),
      let png = NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:]) else {
    fatalError("无法渲染图标")
}
try png.write(to: URL(fileURLWithPath: CommandLine.arguments[2]))
