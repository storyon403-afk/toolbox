// Synthetic bilingual screen for offline OCR acceptance, not user media.
import AppKit
let image = NSImage(size: NSSize(width: 1280, height: 720))
image.lockFocus()
NSColor.white.setFill()
NSRect(x: 0, y: 0, width: 1280, height: 720).fill()
let attributes: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 64), .foregroundColor: NSColor.black]
("LinkParsing OCR 2026" as NSString).draw(at: NSPoint(x: 90, y: 420), withAttributes: attributes)
("本地画面文字识别测试" as NSString).draw(at: NSPoint(x: 90, y: 280), withAttributes: attributes)
image.unlockFocus()
let bitmap = NSBitmapImageRep(data: image.tiffRepresentation!)!
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
