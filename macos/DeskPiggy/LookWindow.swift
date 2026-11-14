import AppKit
import WebKit

/// The Appearance window.
///
/// It loads the same page the pig runs in, switched to "look" mode: a preview of the pig
/// beside its controls (eye style, colours, scarf, belly, blush). Every change arrives
/// here as a message; we save it and hand it to the pig on the desktop.
///
/// The same window is where a user's own model file is chosen and tuned.
@MainActor
final class LookWindowController: NSObject, WKScriptMessageHandler, NSWindowDelegate {
    private var window: NSWindow?
    private var webView: WKWebView?
    /// Called whenever the user changes the look (it has already been saved to Settings).
    var onChange: (() -> Void)?
    /// A different model was chosen, or the built-in pig was restored.
    var onModelChange: (() -> Void)?
    /// The worn model's size / facing / height changed (already saved).
    var onModelAdjust: (() -> Void)?

    func show() {
        if let existing = window {
            NSApp.activate(ignoringOtherApps: true)
            existing.makeKeyAndOrderFront(nil)
            return
        }
        guard let page = Bundle.main.url(forResource: "pet", withExtension: "html") else { return }

        let configuration = WKWebViewConfiguration()
        let content = WKUserContentController()
        content.addUserScript(Display.bootstrap(mode: "look"))
        content.add(WeakScriptHandler(self), name: "piggy")
        configuration.userContentController = content
        configuration.setURLSchemeHandler(ModelSchemeHandler(), forURLScheme: ModelStore.scheme)

        let size = NSSize(width: 600, height: 420)
        let view = WKWebView(frame: NSRect(origin: .zero, size: size), configuration: configuration)
        let panel = NSWindow(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.titled, .closable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        panel.title = L("小猪的外观", "Piggy's Appearance")
        panel.contentView = view
        panel.isReleasedWhenClosed = false
        panel.delegate = self
        panel.center()
        window = panel
        webView = view

        view.loadFileURL(page, allowingReadAccessTo: page.deletingLastPathComponent())
        NSApp.activate(ignoringOtherApps: true)
        panel.makeKeyAndOrderFront(nil)
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "lookReady":
            // Show what is saved, in the user's language.
            let saved = Settings.shared.look
            let look = saved.isEmpty ? "null" : jsString(saved)
            webView?.evaluateJavaScript("piggyLook.set(\(look), \(jsString(Lang.code)))", completionHandler: nil)
            if ModelStore.fileURL != nil { showModel() }
        case "pickModel":
            pickModel()
        case "clearModel":
            ModelStore.clear()
            showModel()
            onModelChange?()
        case "modelAdjust":
            guard let adjust = body["adjust"] as? [String: Any], JSONSerialization.isValidJSONObject(adjust),
                  let data = try? JSONSerialization.data(withJSONObject: adjust, options: [.sortedKeys]),
                  let json = String(data: data, encoding: .utf8) else { return }
            Settings.shared.modelAdjust = json
            onModelAdjust?()
        case "look":
            guard let look = body["look"] as? [String: Any], JSONSerialization.isValidJSONObject(look),
                  let data = try? JSONSerialization.data(withJSONObject: look, options: [.sortedKeys]),
                  let json = String(data: data, encoding: .utf8) else { return }
            Settings.shared.look = json
            onChange?()
        default:
            break
        }
    }

    /// Tell the preview which model is worn now.
    private func showModel() {
        webView?.evaluateJavaScript("void piggyLook.model(\(ModelStore.script()))", completionHandler: nil)
    }

    private func pickModel() {
        guard let chosen = ModelStore.choose() else { return }
        do {
            try ModelStore.adopt(chosen)
            showModel()
            onModelChange?()
        } catch {
            webView?.evaluateJavaScript("piggyLook.status(\(jsString(error.localizedDescription)))", completionHandler: nil)
        }
    }

    func windowWillClose(_ notification: Notification) {
        // Let go of the page, and with it the second renderer, while the window is closed.
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "piggy")
        webView = nil
        window = nil
    }
}
