import AppKit
import ServiceManagement

/// A menu item that runs a closure.
final class ActionItem: NSMenuItem {
    private let handler: () -> Void

    init(_ title: String, checked: Bool = false, handler: @escaping () -> Void) {
        self.handler = handler
        super.init(title: title, action: #selector(fire), keyEquivalent: "")
        target = self
        state = checked ? .on : .off
    }

    required init(coder: NSCoder) {
        fatalError("ActionItem is created in code only")
    }

    @objc private func fire() {
        handler()
    }
}

/// Desk Piggy is a menu-bar ("accessory") app: no Dock icon and no main window —
/// just the pig on the desktop and a status item to talk to it.
@main
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private static var retained: AppDelegate?

    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        retained = delegate // NSApplication does not retain its delegate
        app.delegate = delegate
        app.setActivationPolicy(.accessory)
        app.run()
    }

    private var pet: PetController!
    private var watcher: SiriWatcher!
    private var lookWindow: LookWindowController!
    private var statusItem: NSStatusItem!
    /// Assistant form switched on by hand (menu, URL or Shortcut) rather than by Siri appearing.
    private var manualAssistant = false
    private var summonTimeout: Timer?

    // MARK: - Lifecycle

    func applicationDidFinishLaunching(_ notification: Notification) {
        pet = PetController()
        pet.menuProvider = { [weak self] in
            let menu = NSMenu()
            self?.fill(menu)
            return menu
        }
        pet.onDoubleClick = { [weak self] in self?.summonSiri() }

        lookWindow = LookWindowController()
        lookWindow.onChange = { [weak self] in self?.pet.pushSettings() }
        lookWindow.onModelChange = { [weak self] in self?.pet.applyModel() }
        lookWindow.onModelAdjust = { [weak self] in self?.pet.applyModelAdjust() }

        let center = PetCenter.shared
        center.onAssistantForm = { [weak self] on in self?.setManualAssistant(on) }
        center.attach(pet)

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "🐷"
        statusItem.button?.toolTip = "Desk Piggy"
        let menu = NSMenu()
        menu.delegate = self
        statusItem.menu = menu

        watcher = SiriWatcher()
        watcher.onChange = { [weak self] presence in self?.assistantChanged(presence) }
        watcher.start()

        SmokeTest.runIfRequested(pet: pet, watcher: watcher)
    }

    func applicationWillTerminate(_ notification: Notification) {
        pet?.rememberSpot()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    /// deskpiggy://dance · deskpiggy://say?text=Hello · deskpiggy://assistant/on
    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls { handle(url) }
    }

    private func handle(_ url: URL) {
        guard url.scheme?.lowercased() == "deskpiggy" else { return }
        let verb = (url.host ?? "").lowercased()
        let argument = url.pathComponents.dropFirst().first?.lowercased()
        switch verb {
        case "assistant", "siri":
            if argument == "on" {
                setManualAssistant(true)
            } else if argument == "off" {
                setManualAssistant(false)
            } else {
                setManualAssistant(!manualAssistant)
            }
        case "summon":
            summonSiri()
        case "say":
            let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            let text = items.first { $0.name == "text" }?.value ?? ""
            pet.command("say", text: text)
        default:
            pet.command(verb) // the page ignores anything it doesn't know
        }
    }

    // MARK: - Assistant form

    private func assistantChanged(_ presence: AssistantPresence) {
        if presence.active {
            summonTimeout?.invalidate()
            summonTimeout = nil
            pet.setAssistant(active: true, frame: presence.frame, level: presence.level, manual: manualAssistant)
        } else if !manualAssistant {
            pet.setAssistant(active: false)
        }
    }

    private func setManualAssistant(_ on: Bool) {
        manualAssistant = on
        if on {
            pet.setAssistant(active: true, frame: watcher.presence.frame, level: watcher.presence.level, manual: true)
        } else if !watcher.presence.active || !Settings.shared.siriSync {
            pet.setAssistant(active: false)
        }
    }

    /// Double-clicking the pig calls Siri — and the pig goes into assistant form straight away.
    private func summonSiri() {
        if watcher.presence.active { return }
        guard let siri = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.apple.Siri") else {
            setManualAssistant(!manualAssistant)
            return
        }
        NSWorkspace.shared.openApplication(at: siri, configuration: NSWorkspace.OpenConfiguration(), completionHandler: nil)
        pet.setAssistant(active: true, manual: true)
        // If Siri never shows up (it is switched off, or this macOS draws it somewhere we can't see), give up.
        summonTimeout?.invalidate()
        summonTimeout = Timer.scheduledTimer(timeInterval: 7, target: self, selector: #selector(summonTimedOut), userInfo: nil, repeats: false)
    }

    @objc private func summonTimedOut() {
        summonTimeout = nil
        if !watcher.presence.active && !manualAssistant { pet.setAssistant(active: false) }
    }

    // MARK: - Menu

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        fill(menu)
    }

    private func fill(_ menu: NSMenu) {
        let settings = Settings.shared
        func add(_ title: String, checked: Bool = false, to target: NSMenu? = nil, _ handler: @escaping () -> Void) {
            (target ?? menu).addItem(ActionItem(title, checked: checked, handler: handler))
        }
        func tell(_ title: String, _ command: String) {
            add(title) { [weak self] in self?.pet.command(command) }
        }

        let header = NSMenuItem(title: settings.name.isEmpty ? L("桌面小猪", "Desk Piggy") : settings.name, action: nil, keyEquivalent: "")
        header.isEnabled = false
        menu.addItem(header)
        menu.addItem(.separator())

        tell(L("打招呼", "Wave"), "wave")
        tell(L("跳舞", "Dance"), "dance")
        tell(L("跳一下", "Hop"), "hop")
        tell(L("喂苹果", "Feed an apple"), "eat")
        tell(L("坐下", "Sit"), "sit")
        if pet.mode == "sleep" {
            tell(L("叫醒", "Wake up"), "wake")
        } else {
            tell(L("睡觉", "Sleep"), "sleep")
        }
        tell(L("过来", "Come here"), "come")
        menu.addItem(.separator())

        add(L("呼叫 Siri（也可双击小猪）", "Call Siri (or double-click the pig)")) { [weak self] in self?.summonSiri() }
        add(L("Siri 出现时自动变身", "Transform when Siri appears"), checked: settings.siriSync) { [weak self] in
            settings.siriSync.toggle()
            self?.pet.pushSettings()
        }
        add(L("保持助手形态", "Stay in assistant form"), checked: manualAssistant) { [weak self] in
            guard let self = self else { return }
            self.setManualAssistant(!self.manualAssistant)
        }
        menu.addItem(.separator())

        add(L("自由走动", "Roam around"), checked: settings.roam) { [weak self] in
            settings.roam.toggle()
            self?.pet.pushSettings()
        }
        add(L("爱说话", "Chatty"), checked: settings.chatty) { [weak self] in
            settings.chatty.toggle()
            self?.pet.pushSettings()
        }

        let sizeItem = NSMenuItem(title: L("大小", "Size"), action: nil, keyEquivalent: "")
        let sizeMenu = NSMenu()
        for size in PetSize.allCases {
            add(size.title, checked: settings.size == size, to: sizeMenu) { [weak self] in
                settings.size = size
                self?.pet.applySize()
            }
        }
        sizeItem.submenu = sizeMenu
        menu.addItem(sizeItem)

        let groundItem = NSMenuItem(title: L("站在哪里", "Stand on"), action: nil, keyEquivalent: "")
        let groundMenu = NSMenu()
        for ground in GroundLine.allCases {
            add(ground.title, checked: settings.ground == ground, to: groundMenu) { [weak self] in
                settings.ground = ground
                self?.pet.applyGround()
            }
        }
        groundItem.submenu = groundMenu
        menu.addItem(groundItem)

        add(L("外观与模型…", "Appearance and Model…")) { [weak self] in self?.lookWindow.show() }
        add(L("起名字…", "Name…")) { [weak self] in self?.askForName() }

        let launchesAtLogin = SMAppService.mainApp.status == .enabled
        add(L("登录时启动", "Launch at login"), checked: launchesAtLogin) { [weak self] in
            do {
                if launchesAtLogin {
                    try SMAppService.mainApp.unregister()
                } else {
                    try SMAppService.mainApp.register()
                }
            } catch {
                self?.show(L("没能更改登录项", "Couldn't change the login item"), detail: error.localizedDescription)
            }
        }
        menu.addItem(.separator())

        tell(pet.isHidden ? L("让小猪出来", "Show the pig") : L("让小猪躲起来", "Hide the pig"), "toggle")
        add(L("兼容显示（看不到小猪时开启）", "Compatibility display (if the pig is invisible)"), checked: Display.copiesFrames) { [weak self] in
            settings.compatibleDisplay.toggle()
            self?.pet.reloadDisplay()
        }
        add(L("Siri 诊断…", "Siri diagnostics…")) { [weak self] in self?.showDiagnostics() }
        add(L("关于桌面小猪", "About Desk Piggy")) {
            NSApp.activate(ignoringOtherApps: true)
            NSApp.orderFrontStandardAboutPanel(nil)
        }
        add(L("退出", "Quit")) { NSApp.terminate(nil) }
    }

    // MARK: - Dialogs

    private func show(_ message: String, detail: String) {
        let alert = NSAlert()
        alert.messageText = message
        alert.informativeText = detail
        NSApp.activate(ignoringOtherApps: true)
        alert.runModal()
    }

    private func askForName() {
        let alert = NSAlert()
        alert.messageText = L("给小猪起个名字", "Name your piggy")
        alert.informativeText = L("它打招呼时会用这个名字介绍自己。", "It introduces itself with this name when it says hello.")
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 240, height: 24))
        field.stringValue = Settings.shared.name
        field.placeholderString = L("小猪", "Piggy")
        alert.accessoryView = field
        alert.addButton(withTitle: L("好", "OK"))
        alert.addButton(withTitle: L("取消", "Cancel"))
        alert.window.initialFirstResponder = field
        NSApp.activate(ignoringOtherApps: true)
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        Settings.shared.name = field.stringValue
        pet.pushSettings()
        pet.command("wave")
    }

    private func showDiagnostics() {
        let report = watcher.diagnostics()
        let alert = NSAlert()
        alert.messageText = L("Siri 诊断", "Siri diagnostics")
        alert.informativeText = L(
            "先唤起 Siri，再打开这个面板，就能看到小猪是怎么认出它的。如果 Siri 出现时小猪没有变身，请把下面的内容贴到 GitHub issue 里。\n\n",
            "Summon Siri, then open this panel to see how the pig recognises it. If the pig doesn't transform when Siri appears, please paste the text below into a GitHub issue.\n\n"
        ) + report
        alert.addButton(withTitle: L("拷贝", "Copy"))
        alert.addButton(withTitle: L("关闭", "Close"))
        NSApp.activate(ignoringOtherApps: true)
        if alert.runModal() == .alertFirstButtonReturn {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(report, forType: .string)
        }
    }
}
