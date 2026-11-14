import AppKit
import UniformTypeIdentifiers
import WebKit

/// The user's own model file, worn instead of the built-in pig.
///
/// When a file is chosen it is copied into Application Support, so it keeps working if the
/// original is moved, and so the app never needs to remember a path outside its own
/// folder. The page fetches the bytes through a private URL scheme; nothing leaves the Mac.
enum ModelStore {
    static let scheme = "deskpiggy-model"
    static let formats = ["glb", "gltf", "fbx", "obj"]
    static let sizeLimit = 200 * 1024 * 1024

    enum Problem: LocalizedError {
        case unsupported(String)
        case tooLarge

        var errorDescription: String? {
            switch self {
            case .unsupported(let ext):
                return L("不支持 .\(ext) 文件，请选 GLB、glTF、FBX 或 OBJ。", "A .\(ext) file is not supported. Choose a GLB, glTF, FBX or OBJ.")
            case .tooLarge:
                return L("文件太大了（上限 200 MB）。", "The file is too large (200 MB at most).")
            }
        }
    }

    static var directory: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSTemporaryDirectory())
        return base.appendingPathComponent("Desk Piggy", isDirectory: true)
    }

    /// The stored copy, if one was chosen and is still there.
    static var fileURL: URL? {
        let name = Settings.shared.modelFile
        guard !name.isEmpty else { return nil }
        let url = directory.appendingPathComponent(name)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    /// Copy `source` into the store and make it the model to wear.
    static func adopt(_ source: URL) throws {
        let ext = source.pathExtension.lowercased()
        guard formats.contains(ext) else { throw Problem.unsupported(ext.isEmpty ? "?" : ext) }
        let size = try source.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard size <= sizeLimit else { throw Problem.tooLarge }

        let files = FileManager.default
        try files.createDirectory(at: directory, withIntermediateDirectories: true)
        // Copy first, then swap, so a failed copy leaves the previous model in place.
        let incoming = directory.appendingPathComponent("incoming.\(ext)")
        try? files.removeItem(at: incoming)
        try files.copyItem(at: source, to: incoming)
        clear()
        let stored = directory.appendingPathComponent("model.\(ext)")
        try files.moveItem(at: incoming, to: stored)
        Settings.shared.modelFile = stored.lastPathComponent
        Settings.shared.modelName = source.lastPathComponent
    }

    /// Forget the model and delete the stored copy.
    static func clear() {
        if let url = fileURL { try? FileManager.default.removeItem(at: url) }
        Settings.shared.modelFile = ""
        Settings.shared.modelName = ""
        Settings.shared.modelAdjust = ""
    }

    /// The argument for the page's `piggy.model(...)`: an object literal, or `null`.
    static func script() -> String {
        guard let url = fileURL else { return "null" }
        let ext = url.pathExtension.lowercased()
        // The number only defeats caching; the handler always serves the current file.
        let stamp = Int(Date().timeIntervalSince1970 * 1000)
        let address = "\(scheme)://file/\(stamp).\(ext)"
        let adjust = Settings.shared.modelAdjust
        let adjustLiteral = adjust.isEmpty ? "null" : jsString(adjust)
        return "{url: \(jsString(address)), name: \(jsString(Settings.shared.modelName)), format: \(jsString(ext)), adjust: \(adjustLiteral)}"
    }

    /// Ask for a model file. Returns nil if the user cancelled.
    @MainActor
    static func choose() -> URL? {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.allowedContentTypes = formats.compactMap { UTType(filenameExtension: $0) }
        panel.message = L("选择一个 GLB、glTF、FBX 或 OBJ 模型文件。它只会被拷贝到这台 Mac 上本应用的文件夹里。", "Choose a GLB, glTF, FBX or OBJ model. It is only copied into this app's folder on this Mac.")
        panel.prompt = L("使用这个模型", "Use This Model")
        NSApp.activate(ignoringOtherApps: true)
        return panel.runModal() == .OK ? panel.url : nil
    }
}

/// Serves the stored model to the page. Whatever path is asked for, the answer is the one
/// stored file, so the page cannot use this to read anything else.
final class ModelSchemeHandler: NSObject, WKURLSchemeHandler {
    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let requested = urlSchemeTask.request.url,
              let file = ModelStore.fileURL,
              let data = try? Data(contentsOf: file, options: .mappedIfSafe),
              let response = HTTPURLResponse(url: requested, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: [
                  "Content-Type": "application/octet-stream",
                  "Content-Length": String(data.count),
                  "Access-Control-Allow-Origin": "*", // the page itself is a local file
                  "Cache-Control": "no-store",
              ]) else {
            urlSchemeTask.didFailWithError(NSError(domain: NSURLErrorDomain, code: NSURLErrorFileDoesNotExist))
            return
        }
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // Everything is delivered inside `start`, so there is nothing to cancel.
    }
}
