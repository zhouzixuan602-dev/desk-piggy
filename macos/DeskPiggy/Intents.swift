import AppIntents
import AppKit

// Siri and Shortcuts integration.
//
// Every intent below shows up as an action in the Shortcuts app, and the phrases in
// `PiggyShortcuts` work with Siri as soon as the app has been launched once — no setup:
// "嘿 Siri，让小猪跳舞" / "Hey Siri, make Piggy dance".
//
// The source language of this file is Simplified Chinese; English lives in
// en.lproj/Localizable.strings (titles, replies) and en.lproj/AppShortcuts.strings (phrases).

/// Hands intents over to the pig. Intents can arrive before the window is up
/// (Siri launches the app in the background), so early commands wait in a backlog.
@MainActor
final class PetCenter {
    static let shared = PetCenter()

    private weak var controller: PetController?
    private var backlog: [(command: String, text: String?)] = []
    /// Set by the app delegate: switches the assistant form on or off.
    var onAssistantForm: ((Bool) -> Void)?
    private var pendingAssistantForm: Bool?

    func attach(_ controller: PetController) {
        self.controller = controller
        for entry in backlog { controller.command(entry.command, text: entry.text) }
        backlog.removeAll()
        if let wanted = pendingAssistantForm {
            pendingAssistantForm = nil
            onAssistantForm?(wanted)
        }
    }

    func send(_ command: String, text: String? = nil) {
        if let controller = controller {
            controller.command(command, text: text)
        } else {
            backlog.append((command, text))
        }
    }

    func setAssistantForm(_ on: Bool) {
        if controller != nil, let handler = onAssistantForm {
            handler(on)
        } else {
            pendingAssistantForm = on
        }
    }
}

// MARK: - Simple actions (these are the ones Siri understands by voice)

struct WaveIntent: AppIntent {
    static var title: LocalizedStringResource = "跟小猪打招呼"
    static var description = IntentDescription("桌面小猪会向你挥手问好。")
    static var openAppWhenRun: Bool = false

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        PetCenter.shared.send("wave")
        return .result(dialog: "小猪在跟你打招呼～")
    }
}

struct DanceIntent: AppIntent {
    static var title: LocalizedStringResource = "让小猪跳舞"
    static var description = IntentDescription("桌面小猪跳一支舞。")
    static var openAppWhenRun: Bool = false

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        PetCenter.shared.send("dance")
        return .result(dialog: "小猪跳起来啦～")
    }
}

struct HopIntent: AppIntent {
    static var title: LocalizedStringResource = "让小猪跳一下"
    static var description = IntentDescription("桌面小猪原地蹦一下。")
    static var openAppWhenRun: Bool = false

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        PetCenter.shared.send("hop")
        return .result(dialog: "蹦！")
    }
}

struct FeedIntent: AppIntent {
    static var title: LocalizedStringResource = "喂小猪"
    static var description = IntentDescription("给桌面小猪一个苹果。")
    static var openAppWhenRun: Bool = false

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        PetCenter.shared.send("eat")
        return .result(dialog: "小猪开饭啦～")
    }
}

struct SleepIntent: AppIntent {
    static var title: LocalizedStringResource = "让小猪睡觉"
    static var description = IntentDescription("桌面小猪坐下打个盹。")
    static var openAppWhenRun: Bool = false

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        PetCenter.shared.send("sleep")
        return .result(dialog: "小猪去睡觉了，晚安～")
    }
}

struct WakeIntent: AppIntent {
    static var title: LocalizedStringResource = "叫醒小猪"
    static var description = IntentDescription("把睡着的桌面小猪叫醒。")
    static var openAppWhenRun: Bool = false

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        PetCenter.shared.send("wake")
        return .result(dialog: "小猪醒啦～")
    }
}

struct ComeIntent: AppIntent {
    static var title: LocalizedStringResource = "叫小猪过来"
    static var description = IntentDescription("桌面小猪会跑到鼠标指针旁边。")
    static var openAppWhenRun: Bool = false

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        PetCenter.shared.send("come")
        return .result(dialog: "小猪跑过来了～")
    }
}

struct HideIntent: AppIntent {
    static var title: LocalizedStringResource = "让小猪躲起来"
    static var description = IntentDescription("暂时把桌面小猪藏起来。")
    static var openAppWhenRun: Bool = false

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        PetCenter.shared.send("hide")
        return .result(dialog: "小猪躲起来了。")
    }
}

struct ShowIntent: AppIntent {
    static var title: LocalizedStringResource = "让小猪出来"
    static var description = IntentDescription("让藏起来的桌面小猪回到桌面。")
    static var openAppWhenRun: Bool = false

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        PetCenter.shared.send("show")
        return .result(dialog: "小猪回来啦～")
    }
}

struct TransformIntent: AppIntent {
    static var title: LocalizedStringResource = "让小猪变身"
    static var description = IntentDescription("让桌面小猪进入或退出发光悬浮的助手形态。")
    static var openAppWhenRun: Bool = false

    @Parameter(title: "助手形态", default: true)
    var enabled: Bool

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        PetCenter.shared.setAssistantForm(enabled)
        return .result(dialog: enabled ? "小猪变身！" : "小猪变回来了。")
    }
}

// MARK: - Actions with parameters (for building your own Shortcuts)

enum PiggyTrick: String, AppEnum {
    case wave, dance, hop, eat, sit, sleep, wake, come

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "小猪的动作"
    static var caseDisplayRepresentations: [PiggyTrick: DisplayRepresentation] = [
        .wave: "打招呼",
        .dance: "跳舞",
        .hop: "跳一下",
        .eat: "吃苹果",
        .sit: "坐下",
        .sleep: "睡觉",
        .wake: "起床",
        .come: "过来",
    ]
}

struct PerformTrickIntent: AppIntent {
    static var title: LocalizedStringResource = "让小猪做动作"
    static var description = IntentDescription("让桌面小猪做一个指定的动作。")
    static var openAppWhenRun: Bool = false

    @Parameter(title: "动作")
    var trick: PiggyTrick

    static var parameterSummary: some ParameterSummary {
        Summary("让小猪\(\.$trick)")
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        PetCenter.shared.send(trick.rawValue)
        return .result()
    }
}

struct SayIntent: AppIntent {
    static var title: LocalizedStringResource = "让小猪说话"
    static var description = IntentDescription("让桌面小猪用气泡说一句话。")
    static var openAppWhenRun: Bool = false

    @Parameter(title: "内容")
    var text: String

    static var parameterSummary: some ParameterSummary {
        Summary("让小猪说\(\.$text)")
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        PetCenter.shared.send("say", text: text)
        return .result()
    }
}

// MARK: - Voice phrases

struct PiggyShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: WaveIntent(),
            phrases: ["跟\(.applicationName)打招呼", "\(.applicationName)打个招呼", "\(.applicationName)你好"],
            shortTitle: "打招呼",
            systemImageName: "hand.wave"
        )
        AppShortcut(
            intent: DanceIntent(),
            phrases: ["让\(.applicationName)跳舞", "\(.applicationName)跳舞", "\(.applicationName)跳个舞"],
            shortTitle: "跳舞",
            systemImageName: "music.note"
        )
        AppShortcut(
            intent: HopIntent(),
            phrases: ["让\(.applicationName)跳一下", "\(.applicationName)跳一下"],
            shortTitle: "跳一下",
            systemImageName: "arrow.up"
        )
        AppShortcut(
            intent: FeedIntent(),
            phrases: ["喂\(.applicationName)", "给\(.applicationName)吃苹果", "\(.applicationName)吃饭"],
            shortTitle: "喂苹果",
            systemImageName: "fork.knife"
        )
        AppShortcut(
            intent: SleepIntent(),
            phrases: ["让\(.applicationName)睡觉", "\(.applicationName)睡觉", "\(.applicationName)晚安"],
            shortTitle: "睡觉",
            systemImageName: "moon.zzz"
        )
        AppShortcut(
            intent: WakeIntent(),
            phrases: ["叫醒\(.applicationName)", "\(.applicationName)起床"],
            shortTitle: "起床",
            systemImageName: "sun.max"
        )
        AppShortcut(
            intent: ComeIntent(),
            phrases: ["叫\(.applicationName)过来", "\(.applicationName)过来"],
            shortTitle: "过来",
            systemImageName: "figure.walk"
        )
        AppShortcut(
            intent: HideIntent(),
            phrases: ["让\(.applicationName)躲起来", "\(.applicationName)躲起来"],
            shortTitle: "躲起来",
            systemImageName: "eye.slash"
        )
        AppShortcut(
            intent: ShowIntent(),
            phrases: ["让\(.applicationName)出来", "\(.applicationName)出来"],
            shortTitle: "出来",
            systemImageName: "eye"
        )
        AppShortcut(
            intent: TransformIntent(),
            phrases: ["让\(.applicationName)变身", "\(.applicationName)变身"],
            shortTitle: "变身",
            systemImageName: "sparkles"
        )
    }
}
