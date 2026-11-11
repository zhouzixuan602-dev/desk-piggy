import AppKit

/// Self-check used by CI: start the app with DESKPIGGY_SMOKE_REPORT=/path/report.json and it
/// waits for the page, exercises the bridge both ways, writes what it saw and exits:
/// status 0 if everything worked, 3 if the web view has no WebGL, 1 otherwise.
@MainActor
final class SmokeTest: NSObject {
    private static var current: SmokeTest?

    static func runIfRequested(pet: PetController, watcher: SiriWatcher) {
        guard let path = ProcessInfo.processInfo.environment["DESKPIGGY_SMOKE_REPORT"], !path.isEmpty else { return }
        let test = SmokeTest(pet: pet, watcher: watcher, path: path)
        current = test
        test.begin()
    }

    private let pet: PetController
    private let watcher: SiriWatcher
    private let path: String
    private let started = Date()
    private var report: [String: Any] = [:]
    private var waiting: Timer?

    private init(pet: PetController, watcher: SiriWatcher, path: String) {
        self.pet = pet
        self.watcher = watcher
        self.path = path
        super.init()
    }

    private func begin() {
        waiting = Timer.scheduledTimer(timeInterval: 0.25, target: self, selector: #selector(waitForPage), userInfo: nil, repeats: true)
    }

    @objc private func waitForPage() {
        let elapsed = Date().timeIntervalSince(started)
        if pet.ready {
            waiting?.invalidate()
            report["readyAfter"] = elapsed
            pet.command("wave")
            perform(#selector(checkWave), with: nil, afterDelay: 2.0)
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

    @objc private func checkWave() {
        pet.evaluate("JSON.stringify(piggy.state())") { value in
            self.report["afterWave"] = value as? String ?? "null"
            self.pet.setAssistant(active: true, manual: true)
            self.perform(#selector(self.checkAssistant), with: nil, afterDelay: 2.5)
        }
    }

    @objc private func checkAssistant() {
        pet.evaluate("JSON.stringify(piggy.state())") { value in
            let state = value as? String ?? "null"
            self.report["inAssistantForm"] = state
            let transformed = state.contains("\"siri\":true")
            // Stay on screen a little longer so CI can take a screenshot of the assistant form.
            self.perform(#selector(self.wrapUp(_:)), with: NSNumber(value: transformed), afterDelay: 3.0)
        }
    }

    @objc private func wrapUp(_ transformed: NSNumber) {
        let moved = pet.messageCount > 3
        let ok = transformed.boolValue && moved
        finish(ok: ok, reason: ok ? "ok" : "transformed=\(transformed.boolValue) messages=\(pet.messageCount)")
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
