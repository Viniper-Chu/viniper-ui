import Foundation
import CoreFoundation

// Replacing a signed bundle can leave its pinned bookmark tied to the old inode.
let destination = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true).standardizedFileURL
let domain = "com.apple.dock" as CFString, key = "persistent-apps" as CFString
func readTiles() -> [[String: Any]] {
    CFPreferencesCopyValue(key, domain, kCFPreferencesCurrentUser, kCFPreferencesAnyHost) as? [[String: Any]] ?? []
}
let original = readTiles()
var tiles = original
var changed = false
for i in tiles.indices {
    guard var tile = tiles[i]["tile-data"] as? [String: Any],
          tile["bundle-identifier"] as? String == "com.viniper.workstation",
          let file = tile["file-data"] as? [String: Any], let raw = file["_CFURLString"] as? String,
          URL(string: raw)?.standardizedFileURL.path == destination.path else { continue }
    if let book = tile["book"] as? Data {
        var stale = false
        let url = try? URL(resolvingBookmarkData: book, options: [.withoutUI, .withoutMounting],
                           relativeTo: nil, bookmarkDataIsStale: &stale)
        if !stale && url?.standardizedFileURL.path == destination.path { continue }
    }
    tile["book"] = try destination.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
    // Dock caches rendered artwork by tile GUID. A new bookmark alone can still
    // resolve to the correct app while displaying the previous bundle's pixels.
    tile.removeValue(forKey: "file-mod-date")
    tile.removeValue(forKey: "parent-mod-date")
    tiles[i]["GUID"] = Int(UInt32.random(in: 1...UInt32.max))
    tiles[i]["tile-data"] = tile
    changed = true
}
if changed {
    guard NSArray(array: original).isEqual(to: readTiles()) else { throw CocoaError(.fileWriteFileExists) }
    CFPreferencesSetValue(key, tiles as CFArray, domain, kCFPreferencesCurrentUser, kCFPreferencesAnyHost)
    guard CFPreferencesSynchronize(domain, kCFPreferencesCurrentUser, kCFPreferencesAnyHost) else { throw CocoaError(.fileWriteUnknown) }
}
print(changed ? "refreshed" : "current")
