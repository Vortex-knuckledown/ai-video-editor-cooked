// icon.swift <out.png>: the Framewise icon, 1024 px. A blue rounded square, a white frame with two corners open, a play head.
import Cocoa
let out = CommandLine.arguments[1]
let S: CGFloat = 1024
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(S), pixelsHigh: Int(S), bitsPerSample: 8, samplesPerPixel: 4,
                           hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
let box = NSRect(x: 100, y: 100, width: 824, height: 824)
let tile = NSBezierPath(roundedRect: box, xRadius: 190, yRadius: 190)
NSGradient(colors: [NSColor(calibratedRed: 0.36, green: 0.57, blue: 1.0, alpha: 1), NSColor(calibratedRed: 0.165, green: 0.384, blue: 0.91, alpha: 1)])!.draw(in: tile, angle: -90)
// the mark is drawn on a 64-unit grid (the same paths as the sidebar's SVG), y flipped for AppKit
let k = box.width / 64
func p(_ x: CGFloat, _ y: CGFloat) -> NSPoint { NSPoint(x: box.minX + x * k, y: box.maxY - y * k) }
NSColor.white.setStroke(); NSColor.white.setFill()
func stroke(_ build: (NSBezierPath) -> Void) { let b = NSBezierPath(); b.lineWidth = 4.2 * k; b.lineCapStyle = .round; b.lineJoinStyle = .round; build(b); b.stroke() }
stroke { b in b.move(to: p(33, 17)); b.line(to: p(24, 17)); b.curve(to: p(19, 22), controlPoint1: p(21.2, 17), controlPoint2: p(19, 19.2)) }          // top left
stroke { b in b.move(to: p(31, 47)); b.line(to: p(40, 47)); b.curve(to: p(45, 42), controlPoint1: p(42.8, 47), controlPoint2: p(45, 44.8)) }          // bottom right
stroke { b in b.move(to: p(19, 31)); b.line(to: p(19, 42)); b.curve(to: p(24, 47), controlPoint1: p(19, 44.8), controlPoint2: p(21.2, 47)) }          // left and bottom left
stroke { b in b.move(to: p(45, 33)); b.line(to: p(45, 22)); b.curve(to: p(40, 17), controlPoint1: p(45, 19.2), controlPoint2: p(42.8, 17)) }          // right and top right
let play = NSBezierPath(); play.move(to: p(27.5, 24.5)); play.line(to: p(40, 32)); play.line(to: p(27.5, 39.5)); play.close(); play.lineJoinStyle = .round; play.lineWidth = 1.4 * k
play.fill(); play.stroke()
NSGraphicsContext.current?.flushGraphics()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
