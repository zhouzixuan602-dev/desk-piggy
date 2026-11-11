import AppKit

/// Whether the assistant is on screen right now, and where.
struct AssistantPresence: Equatable {
    var active = false
    /// The assistant's panel in Cocoa screen coordinates, when it has a compact one.
    var frame: CGRect?
    /// The window level it is drawn at, so the pig can sit just above it.
    var level: Int?
}

/// Watches for Siri's window.
///
/// macOS has no API that says "Siri is showing", and none that lets another app restyle it.
/// What every app may do is list the windows on screen (owner, bounds and layer only — no
/// contents, no Screen Recording permission). So a few times a second we look for an
/// on-screen window owned by Siri; when one appears, the pig goes and becomes its face.
@MainActor
final class SiriWatcher: NSObject {
    static let bundleIdentifiers: Set<String> = ["com.apple.Siri"]

    struct Entry {
        let owner: String
        let bundleID: String?
        let frame: CGRect
        let level: Int
        let alpha: Double
        let coversScreen: Bool
    }

    var onChange: ((AssistantPresence) -> Void)?
    private(set) var presence = AssistantPresence()

    private var timer: Timer?
    private var polls = 0
    private var misses = 0
    /// Some macOS versions keep a screen-sized, see-through Siri window around all the time.
    /// If one is already there on our first look, it tells us nothing and we ignore it.
    private var screenSizedIsFurniture: Bool?
    private var assistantPIDs: [pid_t: Bool] = [:]
    /// Extra window owners to treat as the assistant, for testing without Siri:
    /// DESKPIGGY_ASSISTANT_OWNERS="TextEdit,Notes"
    private let extraOwners: Set<String>

    override init() {
        let raw = ProcessInfo.processInfo.environment["DESKPIGGY_ASSISTANT_OWNERS"] ?? ""
        extraOwners = Set(raw.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty })
        super.init()
    }

    func start() {
        guard timer == nil else { return }
        let t = Timer(timeInterval: 0.25, target: self, selector: #selector(poll), userInfo: nil, repeats: true)
        RunLoop.main.add(t, forMode: .common)
        timer = t
        poll()
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }

    private func isAssistant(pid: pid_t, owner: String) -> Bool {
        if extraOwners.contains(owner) { return true }
        if let known = assistantPIDs[pid] { return known }
        let bundleID = NSRunningApplication(processIdentifier: pid)?.bundleIdentifier
        let match = bundleID.map { SiriWatcher.bundleIdentifiers.contains($0) } ?? (owner == "Siri")
        assistantPIDs[pid] = match
        return match
    }

    /// Every on-screen window that passes `wanted`, front to back.
    private func windows(where wanted: (pid_t, String) -> Bool) -> [Entry] {
        let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
        guard let list = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else { return [] }
        // Quartz measures from the top-left of the primary display, AppKit from its bottom-left.
        let primaryHeight = NSScreen.screens.first?.frame.height ?? 0
        var found: [Entry] = []
        for info in list {
            guard let pidNumber = info[kCGWindowOwnerPID as String] as? NSNumber else { continue }
            let pid = pidNumber.int32Value
            let owner = info[kCGWindowOwnerName as String] as? String ?? ""
            guard wanted(pid, owner) else { continue }
            guard let boundsInfo = info[kCGWindowBounds as String] as? NSDictionary,
                  let bounds = CGRect(dictionaryRepresentation: boundsInfo as CFDictionary) else { continue }
            let frame = CGRect(x: bounds.minX, y: primaryHeight - bounds.maxY, width: bounds.width, height: bounds.height)
            let level = (info[kCGWindowLayer as String] as? NSNumber)?.intValue ?? 0
            let alpha = (info[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? 1
            let centre = CGPoint(x: frame.midX, y: frame.midY)
            let screen = NSScreen.screens.first { $0.frame.contains(centre) } ?? NSScreen.screens.first
            let screenArea = (screen?.frame.width ?? 1) * (screen?.frame.height ?? 1)
            found.append(Entry(
                owner: owner,
                bundleID: NSRunningApplication(processIdentifier: pid)?.bundleIdentifier,
                frame: frame,
                level: level,
                alpha: alpha,
                coversScreen: frame.width * frame.height > screenArea * 0.6
            ))
        }
        return found
    }

    @objc private func poll() {
        polls += 1
        if polls % 240 == 0 { assistantPIDs.removeAll() } // process IDs get reused eventually

        let owned = windows { pid, owner in self.isAssistant(pid: pid, owner: owner) }
        let visible = owned.filter { $0.alpha > 0.05 && $0.frame.width >= 40 && $0.frame.height >= 40 }
        if screenSizedIsFurniture == nil { screenSizedIsFurniture = visible.contains { $0.coversScreen } }

        let panels = visible.filter { !$0.coversScreen }
        let overlays = visible.filter { $0.coversScreen }
        var next = AssistantPresence()
        if let panel = panels.max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }) {
            // Snap to a grid so a panel that is still animating doesn't flood the page with updates.
            let grid: CGFloat = 4
            let f = panel.frame
            let snapped = CGRect(
                x: (f.minX / grid).rounded() * grid,
                y: (f.minY / grid).rounded() * grid,
                width: (f.width / grid).rounded() * grid,
                height: (f.height / grid).rounded() * grid
            )
            next = AssistantPresence(active: true, frame: snapped, level: visible.map { $0.level }.max())
        } else if !overlays.isEmpty && screenSizedIsFurniture == false {
            next = AssistantPresence(active: true, frame: nil, level: overlays.map { $0.level }.max())
        }

        if next.active {
            misses = 0
        } else if presence.active {
            // One empty reading can be a window swap mid-animation; wait for a second one.
            misses += 1
            if misses < 2 { return }
        }
        guard next != presence else { return }
        presence = next
        onChange?(next)
    }

    /// A plain-text report of what the watcher can see, for troubleshooting on new macOS versions.
    func diagnostics() -> String {
        let related = windows { pid, owner in
            if self.isAssistant(pid: pid, owner: owner) { return true }
            let id = NSRunningApplication(processIdentifier: pid)?.bundleIdentifier?.lowercased() ?? ""
            let name = owner.lowercased()
            return name.contains("siri") || id.contains("siri") || id.contains("assistant") || id.contains("intelligence")
        }
        let version = ProcessInfo.processInfo.operatingSystemVersionString
        let appVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"
        let frameText = presence.frame.map { NSStringFromRect($0) } ?? "-"
        let levelText = presence.level.map { "\($0)" } ?? "-"
        let furnitureText = screenSizedIsFurniture.map { "\($0)" } ?? "undecided"
        var lines: [String] = []
        lines.append("Desk Piggy \(appVersion) · macOS \(version)")
        lines.append("display: \(Display.summary)")
        lines.append("assistant active: \(presence.active)  frame: \(frameText)  level: \(levelText)")
        lines.append("screen-sized window treated as furniture: \(furnitureText)")
        lines.append("")
        lines.append(related.isEmpty ? "No Siri-related windows are on screen right now." : "Siri-related windows on screen:")
        for w in related {
            let f = w.frame
            let size = "\(Int(f.width))x\(Int(f.height)) at (\(Int(f.minX)), \(Int(f.minY)))"
            let alpha = String(format: "%.2f", w.alpha)
            let note = w.coversScreen ? "  (screen-sized)" : ""
            lines.append("• \(w.owner) [\(w.bundleID ?? "?")] level \(w.level) alpha \(alpha)  \(size)\(note)")
        }
        return lines.joined(separator: "\n")
    }
}
