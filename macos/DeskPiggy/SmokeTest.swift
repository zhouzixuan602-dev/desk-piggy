import AppKit

/// Self-check used by CI: start the app with DESKPIGGY_SMOKE_REPORT=/path/report.json and it
/// waits for the page, exercises the bridge both ways, writes what it saw and exits:
/// status 0 if everything worked, 3 if the web view has no WebGL, 1 otherwise.
///
/// Along the way it counts how often the page is allowed to animate (WebKit slows pages it
/// considers idle) and inspects a snapshot to confirm the pig is drawn on a clear page.
@MainActor
final class SmokeTest: NSObject {
    private static var current: SmokeTest?

    static func runIfRequested(pet: PetController, watcher: SiriWatcher) {
        guard let path = ProcessInfo.processInfo.environment["DESKPIGGY_SMOKE_REPORT"], !path.isEmpty else { return }
        let test = SmokeTest(pet: pet, watcher: watcher, path: path)
        current = test
        test.begin()
    }

    /// Counts animation-frame callbacks for one second while the pig itself is paused.
    private static let probe = "piggy.pause(true);(function(){var p={n:0,ms:0,done:false};window.__probe=p;var t0=performance.now();function f(){p.n++;p.ms=Math.round(performance.now()-t0);if(p.ms<1000)requestAnimationFrame(f);else p.done=true;}requestAnimationFrame(f);})()"

    private let pet: PetController
    private let watcher: SiriWatcher
    private let path: String
    private let started = Date()
    private var report: [String: Any] = [:]
    private var waiting: Timer?
    private var framesAtStart = 0
    private var transformed = false
    private var drawn = false
    private var controls: [NSWindow] = []

    private init(pet: PetController, watcher: SiriWatcher, path: String) {
        self.pet = pet
        self.watcher = watcher
        self.path = path
        super.init()
    }

    private func begin() {
        showControlWindows()
        waiting = Timer.scheduledTimer(timeInterval: 0.25, target: self, selector: #selector(waitForPage), userInfo: nil, repeats: true)
    }

    /// TEMPORARY, for reading CI screenshots: an ordinary window and a see-through panel with
    /// native content. If a screenshot shows these but not the pig, the web view is at fault;
    /// if it shows neither, the screenshot simply cannot see application windows.
    private func showControlWindows() {
        let ordinary = NSWindow(contentRect: NSRect(x: 40, y: 480, width: 220, height: 120), styleMask: [.titled], backing: .buffered, defer: false)
        ordinary.title = "control: ordinary"
        ordinary.backgroundColor = .systemRed
        ordinary.isReleasedWhenClosed = false
        ordinary.level = .floating
        ordinary.orderFrontRegardless()

        let clear = NSPanel(contentRect: NSRect(x: 300, y: 480, width: 120, height: 120), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        clear.isOpaque = false
        clear.backgroundColor = .clear
        clear.hasShadow = false
        clear.isReleasedWhenClosed = false
        clear.level = .floating
        let dot = NSView(frame: NSRect(x: 10, y: 10, width: 100, height: 100))
        dot.wantsLayer = true
        dot.layer?.backgroundColor = NSColor.systemGreen.cgColor
        dot.layer?.cornerRadius = 50
        clear.contentView?.addSubview(dot)
        clear.orderFrontRegardless()
        controls = [ordinary, clear]
    }

    /// What the window server knows about this app's windows.
    private func ownWindows() -> [[String: Any]] {
        let pid = ProcessInfo.processInfo.processIdentifier
        guard let list = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] else { return [] }
        var result: [[String: Any]] = []
        for info in list {
            guard let owner = info[kCGWindowOwnerPID as String] as? NSNumber, owner.int32Value == pid else { continue }
            var entry: [String: Any] = [:]
            entry["name"] = info[kCGWindowName as String] as? String ?? ""
            entry["layer"] = info[kCGWindowLayer as String] as? NSNumber ?? 0
            entry["alpha"] = info[kCGWindowAlpha as String] as? NSNumber ?? 0
            entry["onscreen"] = info[kCGWindowIsOnscreen as String] as? NSNumber ?? 0
            entry["sharing"] = info[kCGWindowSharingState as String] as? NSNumber ?? 0
            entry["memory"] = info[kCGWindowMemoryUsage as String] as? NSNumber ?? 0
            entry["bounds"] = info[kCGWindowBounds as String] as? NSDictionary ?? NSDictionary()
            result.append(entry)
        }
        return result
    }

    private func frameCount(in state: String) -> Int {
        guard let object = try? JSONSerialization.jsonObject(with: Data(state.utf8)) as? [String: Any],
              let frames = object["frames"] as? NSNumber else { return 0 }
        return frames.intValue
    }

    @objc private func waitForPage() {
        let elapsed = Date().timeIntervalSince(started)
        if pet.ready {
            waiting?.invalidate()
            report["readyAfter"] = elapsed
            pet.evaluate(SmokeTest.probe) { _ in }
            perform(#selector(readProbe), with: nil, afterDelay: 1.4)
        } else if let problem = pet.pageError {
            waiting?.invalidate()
            // Virtual machines often have no GPU for the web view; report that separately (status 3).
            let noWebGL = problem.lowercased().contains("webgl")
            finish(ok: false, reason: "page error: \(problem)", status: noWebGL ? 3 : 1)
        } else if elapsed > 40 {
            waiting?.invalidate()
            finish(ok: false, reason: "the page never became ready")
        }
    }

    @objc private func readProbe() {
        pet.evaluate("JSON.stringify(window.__probe)") { value in
            // ~60 means the page animates freely; ~10 or less would mean it is being throttled.
            self.report["animationFramesPerSecond"] = value as? String ?? "null"
            self.pet.evaluate("piggy.pause(false); piggy.state().frames") { frames in
                self.framesAtStart = (frames as? NSNumber)?.intValue ?? 0
                self.pet.command("wave")
                self.perform(#selector(self.checkWave), with: nil, afterDelay: 2.0)
            }
        }
    }

    @objc private func checkWave() {
        pet.evaluate("JSON.stringify(piggy.state())") { value in
            let state = value as? String ?? "null"
            self.report["afterWave"] = state
            self.report["renderedFramesPerSecond"] = Double(self.frameCount(in: state) - self.framesAtStart) / 2.0
            self.pet.setAssistant(active: true, manual: true)
            self.perform(#selector(self.checkAssistant), with: nil, afterDelay: 2.5)
        }
    }

    @objc private func checkAssistant() {
        pet.evaluate("JSON.stringify(piggy.state())") { value in
            let state = value as? String ?? "null"
            self.report["inAssistantForm"] = state
            self.transformed = state.contains("\"siri\":true")
            self.pet.inspectSnapshot { result in
                self.report["snapshot"] = result
                let clearCorner = (result["cornerAlpha"] as? Double ?? 1) < 0.1
                let coverage = result["coverage"] as? Double ?? 0
                self.drawn = clearCorner && coverage > 0.03 && coverage < 0.7
                self.report["windows"] = self.ownWindows()
                // Stay on screen a little longer so CI can take a screenshot of the assistant form.
                self.perform(#selector(self.wrapUp), with: nil, afterDelay: 3.5)
            }
        }
    }

    @objc private func wrapUp() {
        let talked = pet.messageCount > 3
        let ok = transformed && talked && drawn
        finish(ok: ok, reason: ok ? "ok" : "transformed=\(transformed) drawn=\(drawn) messages=\(pet.messageCount)")
    }

    private func finish(ok: Bool, reason: String, status: Int32? = nil) {
        let frame = pet.panel.frame
        report["ok"] = ok
        report["reason"] = reason
        report["ready"] = pet.ready
        report["pageError"] = pet.pageError ?? ""
        report["mode"] = pet.mode
        report["messages"] = pet.messageCount
        report["window"] = ["x": Double(frame.minX), "y": Double(frame.minY), "width": Double(frame.width), "height": Double(frame.height)]
        report["windowVisible"] = pet.panel.isVisible
        report["windowLevel"] = pet.panel.level.rawValue
        report["hit"] = ["cx": Double(pet.hit.cx), "cy": Double(pet.hit.cy), "rx": Double(pet.hit.rx), "ry": Double(pet.hit.ry), "foot": Double(pet.hit.foot)]
        report["screens"] = NSScreen.screens.map { NSStringFromRect($0.frame) }
        report["watcher"] = watcher.diagnostics()
        report["seconds"] = Date().timeIntervalSince(started)
        if let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) {
            try? data.write(to: URL(fileURLWithPath: path))
        }
        exit(status ?? (ok ? 0 : 1))
    }
}
