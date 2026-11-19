// icon.swift <out.png>: the app icon, "c." in white on a dark rounded square, 1024 px.
import Cocoa
let out = CommandLine.arguments[1]
let S: CGFloat = 1024
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(S), pixelsHigh: Int(S), bitsPerSample: 8, samplesPerPixel: 4,
                           hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
NSColor(calibratedRed: 0.066, green: 0.066, blue: 0.075, alpha: 1).setFill()
NSBezierPath(roundedRect: NSRect(x: 100, y: 100, width: 824, height: 824), xRadius: 185, yRadius: 185).fill()
let font = NSFont.systemFont(ofSize: 520, weight: .black)
let text = NSAttributedString(string: "c.", attributes: [.font: font, .foregroundColor: NSColor.white, .kern: -18])
let size = text.size()
text.draw(at: NSPoint(x: (S - size.width) / 2, y: (S - size.height) / 2 + 30))
NSGraphicsContext.current?.flushGraphics()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
