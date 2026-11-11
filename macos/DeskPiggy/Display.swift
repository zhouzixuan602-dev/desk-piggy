import Metal
import WebKit

/// How the page puts its frames on screen (see web/src/stage3d.js).
///
/// Normally WebGL draws straight into the visible canvas. On a virtual GPU that canvas is
/// rendered but never composited, so there, or when the user asks for it, the page copies
/// each frame onto a 2D canvas instead: slower, but it shows up everywhere.
enum Display {
    /// The system GPU's name, or nil if there is no Metal device at all.
    static let gpuName: String? = MTLCreateSystemDefaultDevice()?.name

    /// True in virtual machines ("Apple Paravirtual device") and when there is no GPU.
    static let gpuIsVirtual: Bool = {
        guard let name = gpuName else { return true }
        return name.lowercased().contains("virtual")
    }()

    static var copiesFrames: Bool { gpuIsVirtual || Settings.shared.compatibleDisplay }

    /// One line for diagnostics.
    static var summary: String {
        let gpu = gpuName ?? "no Metal device"
        if !copiesFrames { return "direct (\(gpu))" }
        return gpuIsVirtual ? "copy, because the GPU is virtual (\(gpu))" : "copy, chosen in the menu (\(gpu))"
    }

    /// Runs before the page's own code and tells it how to start.
    /// `mode` is "look" for the Appearance window and nil for the pig itself.
    @MainActor
    static func bootstrap(mode: String? = nil) -> WKUserScript {
        var source = "window.__DESKPIGGY_PRESENT = '\(copiesFrames ? "copy" : "direct")';"
        if let mode = mode { source += " window.__DESKPIGGY_MODE = '\(mode)';" }
        return WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }
}
