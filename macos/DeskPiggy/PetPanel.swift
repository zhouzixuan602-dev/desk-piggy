import AppKit

/// The borderless, transparent, always-on-top window the pig lives in.
/// It never takes focus, follows you across Spaces and sits just above the Dock's layer.
final class PetPanel: NSPanel {
    /// One above the Dock, so the pig can stroll in front of it.
    static let restingLevel = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.dockWindow)) + 1)

    init(size: NSSize) {
        super.init(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        level = PetPanel.restingLevel
        collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
        hidesOnDeactivate = false
        isFloatingPanel = true
        becomesKeyOnlyIfNeeded = true
        isMovable = false
        isReleasedWhenClosed = false
        isExcludedFromWindowsMenu = true
        animationBehavior = .none
        // Clicks fall through until the pointer is actually over the pig (see PetController.track).
        ignoresMouseEvents = true
    }

    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }

    // Let the pig hang off the edge of the screen instead of being nudged back.
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }
}

@MainActor
protocol InteractionViewDelegate: AnyObject {
    func petClicked(clickCount: Int)
    func petDragBegan()
    func petDragged(toOrigin origin: NSPoint)
    func petDragEnded(velocity: CGVector)
    func petContextMenu() -> NSMenu?
}

/// A transparent view on top of the web view that owns every mouse event.
/// The web page only draws; clicking, dragging and the context menu are native.
final class InteractionView: NSView {
    weak var delegate: InteractionViewDelegate?

    private var downMouse = NSPoint.zero
    private var downOrigin = NSPoint.zero
    private var dragging = false
    private var trail: [(time: TimeInterval, point: NSPoint)] = []

    override var mouseDownCanMoveWindow: Bool { false }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func hitTest(_ point: NSPoint) -> NSView? { frame.contains(point) ? self : nil }

    override func mouseDown(with event: NSEvent) {
        guard let window = window else { return }
        downMouse = NSEvent.mouseLocation
        downOrigin = window.frame.origin
        dragging = false
        trail = [(event.timestamp, downMouse)]
    }

    override func mouseDragged(with event: NSEvent) {
        let now = NSEvent.mouseLocation
        let dx = now.x - downMouse.x
        let dy = now.y - downMouse.y
        if !dragging {
            guard hypot(dx, dy) >= 4 else { return }
            dragging = true
            delegate?.petDragBegan()
        }
        trail.append((event.timestamp, now))
        if trail.count > 6 { trail.removeFirst() }
        delegate?.petDragged(toOrigin: NSPoint(x: downOrigin.x + dx, y: downOrigin.y + dy))
    }

    override func mouseUp(with event: NSEvent) {
        guard dragging else {
            delegate?.petClicked(clickCount: event.clickCount)
            return
        }
        dragging = false
        var velocity = CGVector.zero
        if let first = trail.first, let last = trail.last, last.time - first.time > 0.01, event.timestamp - last.time < 0.12 {
            let dt = CGFloat(last.time - first.time)
            velocity = CGVector(dx: (last.point.x - first.point.x) / dt, dy: (last.point.y - first.point.y) / dt)
        }
        delegate?.petDragEnded(velocity: velocity)
    }

    override func rightMouseDown(with event: NSEvent) {
        guard let menu = delegate?.petContextMenu() else { return }
        NSMenu.popUpContextMenu(menu, with: event, for: self)
    }
}
