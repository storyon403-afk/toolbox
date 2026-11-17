import AppKit

let output = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
for (name, pixels) in [("icon_16x16",16),("icon_16x16@2x",32),("icon_32x32",32),("icon_32x32@2x",64),("icon_128x128",128),("icon_128x128@2x",256),("icon_256x256",256),("icon_256x256@2x",512),("icon_512x512",512),("icon_512x512@2x",1024)] {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    let context = NSGraphicsContext(bitmapImageRep: bitmap)!
    NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = context
    context.cgContext.scaleBy(x: CGFloat(pixels)/1024, y: CGFloat(pixels)/1024)
    let tile = NSBezierPath(roundedRect: NSRect(x: 82, y: 82, width: 860, height: 860), xRadius: 194, yRadius: 194)
    NSGraphicsContext.saveGraphicsState()
    let shadow = NSShadow(); shadow.shadowColor = NSColor.black.withAlphaComponent(0.18); shadow.shadowBlurRadius = 22; shadow.shadowOffset = NSSize(width: 0, height: -12); shadow.set()
    NSColor(calibratedRed: 0.96, green: 0.95, blue: 0.92, alpha: 1).setFill(); tile.fill()
    NSGraphicsContext.restoreGraphicsState()
    NSGradient(starting: NSColor(calibratedRed: 0.91, green: 0.91, blue: 0.87, alpha: 1), ending: NSColor(calibratedRed: 1, green: 0.99, blue: 0.96, alpha: 1))!.draw(in: tile, angle: 65)
    NSColor.white.withAlphaComponent(0.9).setStroke(); tile.lineWidth = 3; tile.stroke()
    let ink = NSColor(calibratedRed: 0.15, green: 0.23, blue: 0.22, alpha: 1)
    ink.setStroke()
    for angle in [0.0,45,90,135] {
        let a = angle * .pi / 180, radius = angle == 45 || angle == 135 ? 221.0 : 252.0
        let path = NSBezierPath(); path.lineWidth = 42; path.lineCapStyle = .round
        path.move(to: NSPoint(x: 512 - cos(a)*radius, y: 512 - sin(a)*radius))
        path.line(to: NSPoint(x: 512 + cos(a)*radius, y: 512 + sin(a)*radius)); path.stroke()
    }
    for (x,y) in [(512.0,228.0),(796,512),(512,796),(228,512)] {
        ink.setFill(); NSBezierPath(ovalIn: NSRect(x: x-33,y: y-33,width: 66,height: 66)).fill()
    }
    NSColor(calibratedRed: 0.96, green: 0.95, blue: 0.91, alpha: 1).setFill()
    let center = NSBezierPath(ovalIn: NSRect(x: 420,y: 420,width: 184,height: 184));center.fill();ink.setStroke();center.lineWidth=34;center.stroke()
    NSColor(calibratedRed: 0.68, green: 0.50, blue: 0.31, alpha: 1).setFill()
    NSBezierPath(ovalIn: NSRect(x: 656,y: 656,width: 80,height: 80)).fill()
    NSGraphicsContext.restoreGraphicsState()
    try bitmap.representation(using: .png, properties: [:])!.write(to: output.appendingPathComponent(name+".png"))
}
