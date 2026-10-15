import AppKit
import Foundation

// Keep the complete brand artwork; macOS supplies the visual canvas around
// it. This 824 / 1024 scale matches the intended Dock footprint without
// changing Windows icons or the source artwork.
let artworkFraction = 824.0 / 1024.0
guard CommandLine.arguments.count == 3 else {
    fputs("Usage: swift build-macos-icon.swift SOURCE.png OUTPUT.iconset\n", stderr)
    exit(1)
}
let sourceURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
guard let artwork = NSImage(contentsOf: sourceURL), artwork.isValid else {
    fputs("Unable to read the source icon.\n", stderr)
    exit(1)
}

try FileManager.default.createDirectory(at: outputURL, withIntermediateDirectories: true)
var reports: [[String: Any]] = []
for logicalSize in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let pixels = logicalSize * scale
        guard let bitmap = NSBitmapImageRep(
            bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels,
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
            isPlanar: false, colorSpaceName: .deviceRGB,
            bytesPerRow: pixels * 4, bitsPerPixel: 32
        ), let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
            fatalError("Unable to create a transparent icon canvas.")
        }
        let canvas = Double(pixels)
        let body = canvas * artworkFraction
        let inset = (canvas - body) / 2
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = context
        context.imageInterpolation = .high
        context.cgContext.clear(CGRect(x: 0, y: 0, width: canvas, height: canvas))
        artwork.draw(
            in: NSRect(x: inset, y: inset, width: body, height: body),
            from: .zero, operation: .copy, fraction: 1,
            respectFlipped: false, hints: [.interpolation: NSImageInterpolation.high]
        )
        NSGraphicsContext.restoreGraphicsState()

        // Inspect actual alpha bounds, not only the nominal drawing rectangle.
        guard let bytes = bitmap.bitmapData else { fatalError("Icon pixels unavailable.") }
        var minX = pixels, minY = pixels, maxX = -1, maxY = -1
        for y in 0..<pixels {
            for x in 0..<pixels where bytes[y * bitmap.bytesPerRow + x * 4 + 3] > 0 {
                minX = min(minX, x); minY = min(minY, y)
                maxX = max(maxX, x); maxY = max(maxY, y)
            }
        }
        guard minX > 0, minY > 0, maxX < pixels - 1, maxY < pixels - 1,
              minX >= Int(floor(inset)) - 1, minY >= Int(floor(inset)) - 1 else {
            fatalError("Icon artwork is missing its transparent canvas margin.")
        }
        let filename = "icon_\(logicalSize)x\(logicalSize)\(scale == 2 ? "@2x" : "").png"
        guard let png = bitmap.representation(using: .png, properties: [:]) else {
            fatalError("Unable to encode the icon PNG.")
        }
        try png.write(to: outputURL.appendingPathComponent(filename), options: .atomic)
        reports.append([
            "file": filename, "canvas": pixels, "artworkFraction": artworkFraction,
            "hasAlpha": bitmap.hasAlpha,
            "alphaBounds": [minX, minY, maxX + 1, maxY + 1]
        ])
    }
}
let report = try JSONSerialization.data(withJSONObject: reports, options: [.prettyPrinted, .sortedKeys])
FileHandle.standardOutput.write(report)
FileHandle.standardOutput.write(Data("\n".utf8))
