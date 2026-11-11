import AppKit
import WebKit

/// The clickable part of the window, reported by the page (window points, origin bottom-left).
struct HitShape {
    var cx: CGFloat = 150
    var cy: CGFloat = 115
    var rx: CGFloat = 80
    var ry: CGFloat = 90
    /// Distance from the bottom of the window up to the soles of the pig's feet.
    var foot: CGFloat = 38

    func contains(_ p: CGPoint) -> Bool {
        guard rx > 0, ry > 0 else { return false }
        let nx = (p.x - cx) / rx
        let ny = (p.y - cy) / ry
        return nx * nx + ny * ny <= 1
    }
}

/// WKUserContentController retains its handlers; this breaks the cycle.
@MainActor
final class WeakScriptHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}

/// Owns the pig's window and translates between the desktop and the page that draws the pig.
///
/// The page (web/src, bundled into pet.html) runs the 3D model, the animation and the
/// behaviour. It thinks in "stage" coordinates: x in points across the screen and y in
/// points above the floor. This class maps those onto real screen positions, feeds the
/// page mouse and Siri events, and moves the window where the pig wants to go.
@MainActor
final class PetController: NSObject, WKScriptMessageHandler, WKNavigationDelegate, InteractionViewDelegate {
    static let baseSize = NSSize(width: 300, height: 340)
    /// World units visible top-to-bottom in the page's camera (VIEW.extent in stage3d.js).
    static let viewExtent: CGFloat = 4.3

    let panel: PetPanel
    private let webView: WKWebView
    private let overlay = InteractionView()

    private(set) var ready = false
    private(set) var pageError: String?
    private(set) var mode = "idle"
    private(set) var hit = HitShape()
    private(set) var position = CGPoint.zero
    private(set) var messageCount = 0
    private var pendingScripts: [String] = []

    private var stageScreen: NSScreen?
    /// Screen rectangle of the stage: minY is the floor, maxY the underside of the menu bar.
    private var stage = NSRect.zero

    private var dragging = false
    private var assistantActive = false
    private var trackTimer: Timer?
    private var ticks = 0
    private var lastPointer = CGPoint(x: CGFloat.greatestFiniteMagnitude, y: 0)

    var menuProvider: (() -> NSMenu)?
    var onDoubleClick: (() -> Void)?
    var onReady: (() -> Void)?

    static func windowSize(for size: PetSize) -> NSSize {
        NSSize(width: (baseSize.width * size.scale).rounded(), height: (baseSize.height * size.scale).rounded())
    }

    override init() {
        let size = PetController.windowSize(for: Settings.shared.size)
        panel = PetPanel(size: size)

        let configuration = WKWebViewConfiguration()
        let content = WKUserContentController()
        configuration.userContentController = content
        webView = WKWebView(frame: NSRect(origin: .zero, size: size), configuration: configuration)
        super.init()

        content.add(WeakScriptHandler(self), name: "piggy")
        webView.navigationDelegate = self
        // Draw nothing behind the page so the desktop shows through. The switch for this has no
        // public name, so check that it is still there rather than risk an exception at launch.
        if webView.responds(to: NSSelectorFromString("_setDrawsBackground:")) || webView.responds(to: NSSelectorFromString("setDrawsBackground:")) {
            webView.setValue(false, forKey: "drawsBackground")
        }
        webView.underPageBackgroundColor = .clear
        webView.autoresizingMask = [.width, .height]

        let container = NSView(frame: NSRect(origin: .zero, size: size))
        container.wantsLayer = true
        container.layer?.backgroundColor = NSColor.clear.cgColor
        overlay.frame = container.bounds
        overlay.autoresizingMask = [.width, .height]
        overlay.delegate = self
        container.addSubview(webView)
        container.addSubview(overlay) // on top: it swallows every mouse event
        panel.contentView = container

        refreshStage(on: NSScreen.main ?? NSScreen.screens.first)
        position = CGPoint(x: stage.width * CGFloat(Settings.shared.lastSpot), y: 0)
        place()
        loadPage()

        NotificationCenter.default.addObserver(self, selector: #selector(screensChanged), name: NSApplication.didChangeScreenParametersNotification, object: nil)
        let timer = Timer(timeInterval: 1.0 / 20.0, target: self, selector: #selector(track), userInfo: nil, repeats: true)
        RunLoop.main.add(timer, forMode: .common)
        trackTimer = timer
    }

    // MARK: - Page

    private func loadPage() {
        ready = false
        guard let url = Bundle.main.url(forResource: "pet", withExtension: "html") else {
            pageError = "pet.html is missing from the app bundle"
            NSLog("DeskPiggy: %@", pageError ?? "")
            return
        }
        webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
    }

    private func run(_ script: String) {
        guard ready else {
            pendingScripts.append(script)
            return
        }
        webView.evaluateJavaScript(script) { _, failure in
            if let failure = failure { NSLog("DeskPiggy: script failed: %@ (%@)", script, failure.localizedDescription) }
        }
    }

    /// Ask the page something; the answer comes back on the main thread.
    func evaluate(_ script: String, completion: @escaping (Any?) -> Void) {
        webView.evaluateJavaScript(script) { value, _ in completion(value) }
    }

    /// Render the page off-screen and report how much of it is see-through (used by the self-check).
    func inspectSnapshot(completion: @escaping ([String: Any]) -> Void) {
        webView.takeSnapshot(with: nil) { image, failure in
            guard let image = image, let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff) else {
                completion(["error": failure?.localizedDescription ?? "no image"])
                return
            }
            let width = bitmap.pixelsWide
            let height = bitmap.pixelsHigh
            var solid = 0
            var samples = 0
            for y in stride(from: 0, to: height, by: 4) {
                for x in stride(from: 0, to: width, by: 4) {
                    samples += 1
                    if let colour = bitmap.colorAt(x: x, y: y), colour.alphaComponent > 0.5 { solid += 1 }
                }
            }
            let corner = bitmap.colorAt(x: 2, y: 2)?.alphaComponent ?? -1
            completion([
                "width": width,
                "height": height,
                "hasAlpha": bitmap.hasAlpha,
                "cornerAlpha": Double(corner),
                "coverage": samples > 0 ? Double(solid) / Double(samples) : 0,
            ])
        }
    }

    private func number(_ value: CGFloat) -> String {
        value.isFinite ? String(format: "%.2f", Double(value)) : "0"
    }

    private func quoted(_ text: String) -> String { jsString(text) }

    private func pageDidBecomeReady() {
        ready = true
        pageError = nil
        let queued = pendingScripts
        pendingScripts = []
        pushStage()
        pushSettings()
        run("piggy.place(\(number(position.x)), 0)")
        for script in queued { run(script) }
        if assistantActive { run("piggy.siri(true, null, {manual: true})") }
        panel.orderFrontRegardless()
        onReady?()
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        messageCount += 1
        func value(_ key: String) -> CGFloat? {
            guard let n = body[key] as? NSNumber else { return nil }
            let v = CGFloat(n.doubleValue)
            return v.isFinite ? v : nil
        }
        switch type {
        case "ready":
            pageDidBecomeReady()
        case "pos":
            guard let x = value("x"), let y = value("y") else { return }
            position = CGPoint(x: x, y: y)
            if !dragging { place() }
        case "hit":
            guard let cx = value("cx"), let cy = value("cy"), let rx = value("rx"), let ry = value("ry"), let foot = value("foot") else { return }
            let footMoved = abs(foot - hit.foot) > 0.5
            hit = HitShape(cx: cx, cy: cy, rx: rx, ry: ry, foot: foot)
            if footMoved && !dragging { place() }
        case "mode":
            mode = body["mode"] as? String ?? mode
        case "hide":
            panel.orderOut(nil)
        case "show":
            panel.orderFrontRegardless()
        case "error":
            pageError = body["message"] as? String ?? "unknown page error"
            NSLog("DeskPiggy: page error: %@", pageError ?? "")
        default:
            break
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        pageError = error.localizedDescription
        NSLog("DeskPiggy: navigation failed: %@", error.localizedDescription)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        pageError = error.localizedDescription
        NSLog("DeskPiggy: load failed: %@", error.localizedDescription)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // The renderer was killed (memory pressure, GPU reset): bring the pig back.
        NSLog("DeskPiggy: web content process terminated, reloading")
        loadPage()
    }

    // MARK: - Stage geometry

    private var isVisible: Bool { panel.isVisible }

    private func stageRect(for screen: NSScreen) -> NSRect {
        let frame = screen.frame
        let visible = screen.visibleFrame
        let floor = Settings.shared.ground == .dock ? visible.minY : frame.minY
        return NSRect(x: frame.minX, y: floor, width: frame.width, height: max(200, visible.maxY - floor))
    }

    /// Recompute the stage for `screen` (or the current one). Returns true if it changed.
    @discardableResult
    private func refreshStage(on screen: NSScreen? = nil) -> Bool {
        var candidate = screen
        if candidate == nil, let current = stageScreen {
            // still plugged in?
            candidate = NSScreen.screens.first(where: { $0.frame == current.frame })
        }
        if candidate == nil { candidate = NSScreen.main ?? NSScreen.screens.first }
        guard let chosen = candidate else { return false }
        let rect = stageRect(for: chosen)
        let changed = rect != stage
        stageScreen = chosen
        stage = rect
        return changed
    }

    /// NSScreen objects come and go; two screens are the same stage if they cover the same area.
    private func isStageScreen(_ screen: NSScreen) -> Bool {
        guard let current = stageScreen else { return false }
        return current.frame == screen.frame
    }

    private func pushStage() {
        run("piggy.stage({width: \(number(stage.width)), height: \(number(stage.height))})")
    }

    private func windowOrigin(for point: CGPoint) -> NSPoint {
        NSPoint(x: stage.minX + point.x - panel.frame.width / 2, y: stage.minY + point.y - hit.foot)
    }

    private func stagePoint(forOrigin origin: NSPoint) -> CGPoint {
        CGPoint(x: origin.x + panel.frame.width / 2 - stage.minX, y: origin.y + hit.foot - stage.minY)
    }

    private func place() {
        panel.setFrameOrigin(windowOrigin(for: position))
    }

    @objc private func screensChanged() {
        if refreshStage() {
            pushStage()
            run("piggy.place(\(number(position.x)), \(number(position.y)))")
        }
        place()
    }

    // MARK: - Settings

    func pushSettings() {
        let s = Settings.shared
        // The look travels as a JSON string; the page validates it before applying anything.
        let look = s.look.isEmpty ? "null" : quoted(s.look)
        run("piggy.config({lang: \(quoted(Lang.code)), name: \(quoted(s.name)), roam: \(s.roam), siriSync: \(s.siriSync), chatty: \(s.chatty), look: \(look)})")
    }

    /// Apply a new size, keeping the pig's feet where they are.
    func applySize() {
        let size = PetController.windowSize(for: Settings.shared.size)
        guard size != panel.frame.size else { return }
        let ratio = size.height / panel.frame.height
        hit = HitShape(cx: hit.cx * ratio, cy: hit.cy * ratio, rx: hit.rx * ratio, ry: hit.ry * ratio, foot: hit.foot * ratio)
        panel.setContentSize(size)
        place() // the page reports the exact hit shape again once it has resized
    }

    func applyGround() {
        if refreshStage() { pushStage() }
        run("piggy.place(\(number(position.x)), \(number(max(0, position.y))))")
        place()
    }

    func rememberSpot() {
        guard stage.width > 0 else { return }
        Settings.shared.lastSpot = Double(position.x / stage.width)
    }

    // MARK: - Commands

    /// Run one of the page's commands (see COMMANDS in web/src/brain.js).
    func command(_ name: String, text: String? = nil) {
        if let words = text {
            run("piggy.command(\(quoted(name)), {text: \(quoted(words))})")
        } else {
            run("piggy.command(\(quoted(name)))")
        }
    }

    var isHidden: Bool { mode == "hidden" }

    /// The assistant appeared or left. `frame` is its window in screen coordinates, if known.
    func setAssistant(active: Bool, frame: NSRect? = nil, level: Int? = nil, manual: Bool = false) {
        assistantActive = active
        guard active else {
            panel.level = PetPanel.restingLevel
            run("piggy.siri(false)")
            return
        }

        // Sit above the assistant's own window so we can overlap it.
        let ceiling = Int(CGShieldingWindowLevel())
        let wanted = max(PetPanel.restingLevel.rawValue, (level ?? PetPanel.restingLevel.rawValue) + 1)
        panel.level = NSWindow.Level(rawValue: min(wanted, ceiling))

        var anchor = "null"
        if let assistantFrame = frame {
            let centre = NSPoint(x: assistantFrame.midX, y: assistantFrame.midY)
            if let screen = NSScreen.screens.first(where: { $0.frame.contains(centre) }) {
                if !isStageScreen(screen), !dragging {
                    refreshStage(on: screen)
                    pushStage()
                }
                let screenArea = screen.frame.width * screen.frame.height
                let isPanel = assistantFrame.width * assistantFrame.height < screenArea * 0.3
                if isPanel, let point = hoverPoint(beside: assistantFrame) {
                    anchor = "{x: \(number(point.x)), y: \(number(point.y))}"
                }
            }
        }
        run("piggy.siri(true, \(anchor), {manual: \(manual)})")
    }

    /// Where the pig's feet should be so that it hovers next to (or on) the assistant's window.
    private func hoverPoint(beside frame: NSRect) -> CGPoint? {
        guard stage.width > 0 else { return nil }
        let unit = panel.frame.height / PetController.viewExtent
        let bodyCentre = unit * 1.35 // feet → middle of the hovering pig
        let centreX: CGFloat
        let centreY: CGFloat
        if frame.width < 170 && frame.height < 170 {
            // Just an orb: take its place.
            centreX = frame.midX
            centreY = frame.midY
        } else {
            // A panel: hover beside it, level with its top, so the reply stays readable.
            let roomOnLeft = frame.minX - stage.minX > panel.frame.width * 0.8
            centreX = roomOnLeft ? frame.minX - unit * 0.95 : frame.maxX + unit * 0.95
            centreY = frame.maxY - min(frame.height, unit * 2.4) / 2
        }
        return CGPoint(x: centreX - stage.minX, y: centreY - bodyCentre - stage.minY)
    }

    // MARK: - Mouse

    func petClicked(clickCount: Int) {
        if clickCount >= 2 {
            onDoubleClick?()
        } else {
            run("piggy.poke()")
        }
    }

    func petDragBegan() {
        dragging = true
        run("piggy.dragStart()")
    }

    func petDragged(toOrigin origin: NSPoint) {
        var target = origin
        target.y = max(target.y, stage.minY - hit.foot) // not through the floor
        panel.setFrameOrigin(target)
        position = stagePoint(forOrigin: target)
        run("piggy.dragMove(\(number(position.x)), \(number(position.y)))")
    }

    func petDragEnded(velocity: CGVector) {
        dragging = false
        // Dropped on another display? That display becomes the stage.
        let centre = NSPoint(x: panel.frame.midX, y: panel.frame.minY + hit.cy)
        if let screen = NSScreen.screens.first(where: { $0.frame.contains(centre) }), !isStageScreen(screen) {
            refreshStage(on: screen)
            pushStage()
        }
        position = stagePoint(forOrigin: panel.frame.origin)
        position.y = max(0, position.y)
        run("piggy.dragMove(\(number(position.x)), \(number(position.y)))")
        run("piggy.dragEnd(\(number(velocity.dx)), \(number(velocity.dy)))")
        rememberSpot()
    }

    func petContextMenu() -> NSMenu? { menuProvider?() }

    /// 20 times a second: decide whether the pointer is on the pig, and let it watch the pointer.
    @objc private func track() {
        ticks += 1
        guard ready else { return }

        if ticks % 30 == 0, !dragging, refreshStage() {
            // The Dock moved or resized, or the display changed.
            pushStage()
            run("piggy.place(\(number(position.x)), \(number(position.y)))")
            place()
        }
        if ticks % 600 == 0 { rememberSpot() }
        guard isVisible else { return }

        let mouse = NSEvent.mouseLocation
        let frame = panel.frame
        let local = CGPoint(x: mouse.x - frame.minX, y: mouse.y - frame.minY)
        let passThrough = !(dragging || hit.contains(local))
        if panel.ignoresMouseEvents != passThrough { panel.ignoresMouseEvents = passThrough }

        let dx = local.x - hit.cx
        let dy = local.y - (hit.cy + hit.ry * 0.3)
        if abs(dx - lastPointer.x) > 1 || abs(dy - lastPointer.y) > 1 {
            lastPointer = CGPoint(x: dx, y: dy)
            if hypot(dx, dy) < 1400 { run("piggy.pointer(\(number(dx)), \(number(dy)))") }
        }
    }
}
