import AppKit
import Foundation

// Render the app icon and monochrome marks from the same vector paths.
let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
let brand = root.appendingPathComponent("assets/branding")
let web = root.appendingPathComponent("resources/viniper-ui/static/assets")
let svg = try String(contentsOf: brand.appendingPathComponent("v-icon-harness.svg"), encoding: .utf8)
let document = try XMLDocument(xmlString: svg)
guard let mark = try document.nodes(forXPath: "//*[@id='viniper-mark']").first as? XMLElement else { fatalError("SVG mark missing") }
let markSVG = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"5 3 54 54\">\(mark.xmlString)</svg>"

func png(_ source: String, _ size: Int, monochrome: Bool = false) throws -> Data {
    guard let image = NSImage(data: Data(source.utf8)), image.isValid,
          let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
            colorSpaceName: .deviceRGB, bytesPerRow: size * 4, bitsPerPixel: 32),
          let context = NSGraphicsContext(bitmapImageRep: bitmap) else { fatalError("Unable to render SVG") }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    context.imageInterpolation = .high
    context.cgContext.clear(CGRect(x: 0, y: 0, width: size, height: size))
    image.draw(in: NSRect(x: 0, y: 0, width: size, height: size), from: .zero,
               operation: .copy, fraction: 1, respectFlipped: false, hints: nil)
    if monochrome {
        context.cgContext.setBlendMode(.sourceIn)
        context.cgContext.setFillColor(NSColor.black.cgColor)
        context.cgContext.fill(CGRect(x: 0, y: 0, width: size, height: size))
    }
    NSGraphicsContext.restoreGraphicsState()
    return bitmap.representation(using: .png, properties: [:])!
}

let stem = "viniper-harness-circuit-node" // Retain public asset paths for older renderers.
for destination in [brand, web] {
    try png(svg, 1024).write(to: destination.appendingPathComponent("\(stem).png"))
    for size in [16, 32, 64] {
        try png(svg, size).write(to: destination.appendingPathComponent("\(stem)-\(size).png"))
    }
}
for size in [20, 24] {
    try png(svg, size).write(to: web.appendingPathComponent("\(stem)-\(size).png"))
}
let badge = svg.replacingOccurrences(of: "</svg>", with:
    "<circle cx=\"54\" cy=\"10\" r=\"8\" fill=\"#FFFFFF\"/><circle cx=\"54\" cy=\"10\" r=\"6\" fill=\"#AD443D\"/></svg>")
for size in [16, 20, 24, 32] {
    try png(badge, size).write(to: web.appendingPathComponent("\(stem)-badge-\(size).png"))
}
try png(markSVG, 256, monochrome: true).write(to: web.appendingPathComponent("viniper-woven-mark.png"))
for badged in [false, true] {
    let dot = badged ? "<circle cx=\"54.5\" cy=\"7\" r=\"3.4\"/>" : ""
    let template = markSVG.replacingOccurrences(of: "</svg>", with: "\(dot)</svg>")
    for scale in [1, 2] {
        let name = "viniper-tray\(badged ? "-badge" : "")Template\(scale == 2 ? "@2x" : "").png"
        try png(template, 22 * scale, monochrome: true).write(to: web.appendingPathComponent(name))
    }
}

// PNG-backed ICO frames retain the existing Windows/browser consumer contract.
func little(_ value: Int, _ bytes: Int) -> Data {
    Data((0..<bytes).map { UInt8((value >> ($0 * 8)) & 255) })
}
let sizes = [16, 24, 32, 48, 64, 128, 256]
let frames = try sizes.map { try png(svg, $0) }
var ico = little(0, 2) + little(1, 2) + little(frames.count, 2)
var offset = 6 + frames.count * 16
for (size, frame) in zip(sizes, frames) {
    ico += Data([UInt8(size == 256 ? 0 : size), UInt8(size == 256 ? 0 : size), 0, 0])
    ico += little(1, 2) + little(32, 2) + little(frame.count, 4) + little(offset, 4)
    offset += frame.count
}
for frame in frames { ico += frame }
for destination in [brand, web] { try ico.write(to: destination.appendingPathComponent("\(stem).ico")) }
try ico.write(to: root.appendingPathComponent("resources/viniper-ui/static/favicon.ico"))

// Older shortcuts and exported pages still request these public filenames.
try png(svg, 512).write(to: web.appendingPathComponent("viniper-icon.png"))
for size in [16, 32, 64] {
    try Data(contentsOf: web.appendingPathComponent("\(stem)-\(size).png"))
        .write(to: web.appendingPathComponent("viniper-icon-\(size).png"))
}
try Data(contentsOf: web.appendingPathComponent("\(stem)-badge-32.png"))
    .write(to: web.appendingPathComponent("viniper-icon-badge-1.png"))
try ico.write(to: web.appendingPathComponent("viniper-icon.ico"))

print("Generated app, favicon, UI alpha mask and template icons from the folded V vector")
