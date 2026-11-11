import AppKit

/// Self-check used by CI: start the app with DESKPIGGY_SMOKE_REPORT=/path/report.json and it
/// waits for the page, exercises the bridge both ways, writes what it saw and exits:
/// status 0 if everything worked, 3 if the web view has no WebGL, 1 otherwise.
///
/// Along the way it measures how often the page is allowed to animate (WebKit slows pages
/// it considers idle) and looks at a snapshot to confirm the pig is drawn on a clear page.
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
    private var framesAfterWave = 0
    private var transformed = false

    private init(pet: PetController, watcher: SiriWatcher, path: String) {
        self.pet = pet
        self.watcher = watcher
        self.path = path
        super.init()
    }

    private func begin() {
        waiting = Timer.scheduledTimer(timeInterval: 0.25, target: self, selector: #selector(waitForPage), userInfo: nil, repeats: true)
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
            perform(#selector(readQuietProbe), with: nil, afterDelay: 1.4)
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

    @objc private func readQuietProbe() {
        pet.evaluate("JSON.stringify(window.__probe)") { value in
            self.report["rafQuiet"] = value as? String ?? "null"
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
            self.framesAfterWave = self.frameCount(in: state)
            self.report["fpsQuiet"] = Double(self.framesAfterWave - self.framesAtStart) / 2.0
            // From here on the shell redraws a one-point layer of its own on every tick.
            self.pet.heartbeat = true
            self.pet.setAssistant(active: true, manual: true)
            self.perform(#selector(self.checkAssistant), with: nil, afterDelay: 2.5)
        }
    }

    @objc private func checkAssistant() {
        pet.evaluate("JSON.stringify(piggy.state())") { value in
            let state = value as? String ?? "null"
            self.report["inAssistantForm"] = state
            self.transformed = state.contains("\"siri\":true")
            self.report["fpsHeartbeat"] = Double(self.frameCount(in: state) - self.framesAfterWave) / 2.5
            self.pet.inspectSnapshot { result in
                self.report["snapshot"] = result
                self.pet.evaluate(SmokeTest.probe) { _ in }
                self.perform(#selector(self.readHeartbeatProbe), with: nil, afterDelay: 1.4)
            }
        }
    }

    @objc private func readHeartbeatProbe() {
        pet.evaluate("JSON.stringify(window.__probe)") { value in
            self.report["rafHeartbeat"] = value as? String ?? "null"
            self.pet.evaluate("piggy.pause(false)") { _ in }
            // Stay on screen a little longer so CI can take a screenshot of the assistant form.
            self.perform(#selector(self.wrapUp), with: nil, afterDelay: 1.5)
        }
    }

    @objc private func wrapUp() {
        let talked = pet.messageCount > 3
        let ok = transformed && talked
        finish(ok: ok, reason: ok ? "ok" : "transformed=\(transformed) messages=\(pet.messageCount)")
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
