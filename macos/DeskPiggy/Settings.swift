import AppKit

/// Picks between the two languages the app speaks, following the system language.
enum Lang {
    static let isChinese: Bool = (Locale.preferredLanguages.first ?? "en").lowercased().hasPrefix("zh")
    static var code: String { isChinese ? "zh" : "en" }
}

/// Inline bilingual strings keep the menu code readable without a strings table.
func L(_ zh: String, _ en: String) -> String { Lang.isChinese ? zh : en }

/// `text` as a JavaScript string literal, safe to splice into a script.
func jsString(_ text: String) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: [text]),
          let json = String(data: data, encoding: .utf8) else { return "\"\"" }
    return String(json.dropFirst().dropLast())
}

enum PetSize: String, CaseIterable {
    case small, medium, large

    var scale: CGFloat {
        switch self {
        case .small: return 0.75
        case .medium: return 1.0
        case .large: return 1.35
        }
    }

    var title: String {
        switch self {
        case .small: return L("小", "Small")
        case .medium: return L("中", "Medium")
        case .large: return L("大", "Large")
        }
    }
}

/// Which line the pig treats as the floor.
enum GroundLine: String, CaseIterable {
    case dock, screenBottom

    var title: String {
        switch self {
        case .dock: return L("程序坞上方", "On top of the Dock")
        case .screenBottom: return L("屏幕底边", "Bottom of the screen")
        }
    }
}

/// User preferences, stored in UserDefaults.
final class Settings {
    static let shared = Settings()
    private let defaults = UserDefaults.standard

    private func bool(_ key: String, default fallback: Bool) -> Bool {
        defaults.object(forKey: key) == nil ? fallback : defaults.bool(forKey: key)
    }

    var size: PetSize {
        get { PetSize(rawValue: defaults.string(forKey: "size") ?? "") ?? .medium }
        set { defaults.set(newValue.rawValue, forKey: "size") }
    }

    var ground: GroundLine {
        get { GroundLine(rawValue: defaults.string(forKey: "ground") ?? "") ?? .dock }
        set { defaults.set(newValue.rawValue, forKey: "ground") }
    }

    /// Wander around on its own.
    var roam: Bool {
        get { bool("roam", default: true) }
        set { defaults.set(newValue, forKey: "roam") }
    }

    /// Turn into the assistant's face whenever Siri shows up.
    var siriSync: Bool {
        get { bool("siriSync", default: true) }
        set { defaults.set(newValue, forKey: "siriSync") }
    }

    /// Speech bubbles for everyday reactions.
    var chatty: Bool {
        get { bool("chatty", default: true) }
        set { defaults.set(newValue, forKey: "chatty") }
    }

    var name: String {
        get { defaults.string(forKey: "name") ?? "" }
        set { defaults.set(String(newValue.trimmingCharacters(in: .whitespacesAndNewlines).prefix(24)), forKey: "name") }
    }

    /// The pig's appearance, as the JSON the Appearance window produced (see web/src/look.js).
    /// Empty means the default look.
    var look: String {
        get { defaults.string(forKey: "look") ?? "" }
        set { defaults.set(newValue, forKey: "look") }
    }

    /// Where along the screen the pig was last standing, 0…1.
    var lastSpot: Double {
        get { defaults.object(forKey: "lastSpot") == nil ? 0.72 : min(1, max(0, defaults.double(forKey: "lastSpot"))) }
        set { defaults.set(newValue, forKey: "lastSpot") }
    }
}
