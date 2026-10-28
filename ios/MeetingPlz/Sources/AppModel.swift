import Foundation
import SwiftUI
import UserNotifications
import BackgroundTasks

struct ReminderState: Identifiable, Equatable {
    let id = UUID()
    var event: MPEvent
    var isTest: Bool
}

@MainActor
final class AppModel: ObservableObject {
    static let shared = AppModel()

    /// Demo mode: sample meetings, nothing stored or sent. On via the "Try it without signing in" link, or the -mpDemo launch argument (CI screenshots).
    @Published var isDemo = CommandLine.arguments.contains("-mpDemo")
    static let hideBanner = CommandLine.arguments.contains("-mpClean")
    @Published var token: String? = CommandLine.arguments.contains("-mpDemo") ? (CommandLine.arguments.contains("-mpSignedOut") ? nil : "demo") : Keychain.get()
    @Published var me: Me?
    @Published var settings = Settings.load()
    @Published var events: [MPEvent] = AppModel.loadCachedEvents()
    @Published var isRefreshing = false
    @Published var loaded = false
    @Published var errorText: String?
    @Published var signingIn = false
    @Published var linking = false
    @Published var reminder: ReminderState?
    @Published var notifStatus: UNAuthorizationStatus = .notDetermined
    @Published var alarmKitOn: Bool = AlarmScheduler.enabled

    private var fired: [String: Double] = (UserDefaults.standard.dictionary(forKey: "mp.fired") as? [String: Double]) ?? [:]
    private var snoozed: [String: Date] = [:]
    private var snoozedEvents: [String: MPEvent] = [:]

    var isSignedIn: Bool { token != nil }
    var api: APIClient { APIClient(token: token) }

    static func loadCachedEvents() -> [MPEvent] {
        guard let d = UserDefaults.standard.data(forKey: "mp.events"), let e = try? JSONDecoder().decode([MPEvent].self, from: d) else { return [] }
        return e
    }

    // MARK: demo

    func startDemo() {
        isDemo = true
        demoDone = false
        errorText = nil
        token = "demo"
        setupDemo()
    }

    func exitDemo() {
        isDemo = false; demoDone = false
        token = nil; me = nil; events = []; reminder = nil; loaded = false
        settings = Settings.load()
        AlarmPlayer.shared.stop()
    }

    private var demoDone = false
    func setupDemo() {
        guard !demoDone, token != nil else { return }
        demoDone = true
        let now = Date()
        func ev(_ k: String, _ t: String, _ m: Double, _ len: Double, _ link: String?, _ att: String) -> MPEvent {
            MPEvent(key: k, id: k, title: t, start: now.addingTimeInterval(m * 60), end: now.addingTimeInterval((m + len) * 60), link: link, calendar: "you@example.com", attendees: att)
        }
        me = Me(email: "you@example.com", name: "Demo", picture: nil, settings: nil,
                accounts: [GoogleAccount(id: "1", email: "you@example.com", picture: nil, primary: true, error: nil),
                           GoogleAccount(id: "2", email: "you@work.example", picture: nil, primary: false, error: nil)])
        events = CommandLine.arguments.contains("-mpEmpty") ? [] : [
            ev("a", "Quick sync with design", 1.5, 30, "https://meet.google.com/abc-defg-hij", "with Miles and 3 others"),
            ev("b", "Pipeline review", 62, 45, "https://zoom.us/j/123456", "with Anh"),
            ev("c", "Customer call: Northwind", 185, 30, "https://teams.microsoft.com/l/meetup-join/x", "with Priya and 1 other"),
            ev("d", "Weekly planning", 400, 30, nil, "with Lena and 5 others")]
        settings = Settings()
        if CommandLine.arguments.contains("-mpTakeover") { settings.style = "takeover" }
        loaded = true
        if CommandLine.arguments.contains("-mpReminder") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { self.startTest() }
        }
    }

    // MARK: auth

    func signIn() async {
        signingIn = true; errorText = nil
        defer { signingIn = false }
        do {
            let t = try await WebAuth.shared.start()
            Keychain.set(t); token = t
            _ = await NotificationScheduler.shared.requestAuthorization()
            await refresh()
            scheduleBackgroundRefresh()
        } catch let e as NSError where e.domain == "com.apple.AuthenticationServices.WebAuthenticationSession" && e.code == 1 {
            // user cancelled
        } catch {
            errorText = error.localizedDescription
        }
    }

    func addAccount() async {
        guard isSignedIn, !linking else { return }
        linking = true; errorText = nil
        defer { linking = false }
        do {
            let url = try await api.linkURL()
            let code = try await WebAuth.shared.link(url: url)
            try await api.completeLink(code: code)
            await refresh()
        } catch let e as NSError where e.domain == "com.apple.AuthenticationServices.WebAuthenticationSession" && e.code == 1 {
            // user cancelled
        } catch {
            errorText = error.localizedDescription
        }
    }

    func removeAccount(_ id: String) async {
        errorText = nil
        do {
            try await api.removeAccount(id)
            await refresh()
        } catch {
            errorText = "Couldn't remove that account. Please try again."
        }
    }

    func signOut() async {
        await api.logout()
        wipeLocal()
    }

    func deleteAccount() async {
        do {
            try await api.deleteAccount()
            wipeLocal()
        } catch {
            errorText = "Couldn't delete the account. Please try again."
        }
    }

    private func wipeLocal() {
        Keychain.set(nil); token = nil; me = nil; events = []; reminder = nil
        UserDefaults.standard.removeObject(forKey: "mp.events")
        fired = [:]; UserDefaults.standard.removeObject(forKey: "mp.fired")
        NotificationScheduler.shared.clearAll()
        AlarmScheduler.cancelAll()
        AlarmPlayer.shared.stop()
    }

    // MARK: data

    func refresh() async {
        guard isSignedIn, !isDemo else { return }
        isRefreshing = true
        defer { isRefreshing = false; loaded = true }
        do {
            let client = api
            async let meReq = client.me()
            async let evReq = client.upcoming()
            let (m, ev) = try await (meReq, evReq)
            me = m
            if let s = m.settings, s != settings { settings = s; s.save() }
            events = ev
            if let d = try? JSONEncoder().encode(ev) { UserDefaults.standard.set(d, forKey: "mp.events") }
            errorText = nil
            await rescheduleAll()
        } catch let e as APIError where e.status == 401 {
            wipeLocal()
            errorText = e.message
        } catch {
            if events.isEmpty { errorText = "Couldn't load your meetings. Pull down to retry." }
        }
        notifStatus = await NotificationScheduler.shared.status()
    }

    func rescheduleAll() async {
        if isDemo { return }
        await NotificationScheduler.shared.reschedule(events: events, settings: settings)
        await AlarmScheduler.reschedule(events: events, settings: settings)
    }

    func updateSettings(_ new: Settings) {
        if isDemo { settings = new; return }   // demo: local only, nothing saved or sent
        settings = new; new.save()
        Task {
            if let saved = try? await api.putSettings(new) { settings = saved; saved.save() }
            await rescheduleAll()
        }
    }

    func setAlarmKit(_ on: Bool) {
        if isDemo { return }
        AlarmScheduler.enabled = on; alarmKitOn = on
        Task { await rescheduleAll() }
    }

    func refreshNotifStatus() async { notifStatus = await NotificationScheduler.shared.status() }

    // MARK: reminders

    func markFired(_ key: String) {
        fired[key] = Date().timeIntervalSince1970
        let cutoff = Date().timeIntervalSince1970 - 2 * 86400
        fired = fired.filter { $0.value > cutoff }
        UserDefaults.standard.set(fired, forKey: "mp.fired")
    }

    func present(_ e: MPEvent, fromNotification: Bool = false) {
        if let r = reminder, r.event.key == e.key { return }
        markFired(e.key)
        reminder = ReminderState(event: e, isTest: false)
        AlarmPlayer.shared.start(kind: settings.alarm)
        AlarmScheduler.cancelAll()
    }

    func startTest() {
        // -mpLate (CI screenshots): the test meeting started 42 seconds ago, so the pass shows "Final call."
        let start = Date().addingTimeInterval(CommandLine.arguments.contains("-mpLate") ? -42 : TimeInterval(settings.leadSeconds))
        let e = MPEvent(key: "test@\(Int(Date().timeIntervalSince1970))", id: "test", title: "Quick sync", start: start,
                        end: start.addingTimeInterval(1800), link: "https://meet.google.com/",
                        calendar: me?.email ?? "you@example.com", attendees: "with Miles and 3 others")
        reminder = ReminderState(event: e, isTest: true)
        AlarmPlayer.shared.start(kind: settings.alarm)
    }

    func dismissReminder() {
        if let r = reminder {
            NotificationScheduler.shared.clear(key: r.event.key)
            snoozed[r.event.key] = nil
        }
        reminder = nil
        AlarmPlayer.shared.stop()
        if isSignedIn, !isDemo { Task { await rescheduleAll() } }
    }

    func snooze() {
        guard let r = reminder else { return }
        if !r.isTest {
            snoozed[r.event.key] = Date().addingTimeInterval(TimeInterval(settings.snoozeSeconds))
            snoozedEvents[r.event.key] = r.event
            let ev = r.event, secs = settings.snoozeSeconds
            Task { await NotificationScheduler.shared.scheduleSnooze(for: ev, seconds: secs) }
        }
        reminder = nil
        AlarmPlayer.shared.stop()
    }

    func join() {
        if let r = reminder, let l = r.event.link, let url = URL(string: l) { UIApplication.shared.open(url, options: [:], completionHandler: nil) }
        dismissReminder()
    }

    /// Called every second while the app is active.
    func tick() {
        guard isSignedIn, !isDemo, reminder == nil else { return }
        let now = Date()
        for (key, until) in snoozed where until <= now {
            snoozed[key] = nil
            if let e = snoozedEvents[key] {
                NotificationScheduler.shared.clear(key: key)
                reminder = ReminderState(event: e, isTest: false)
                AlarmPlayer.shared.start(kind: settings.alarm)
                return
            }
        }
        let due = Core.pickDue(events, now: now, settings: settings, fired: Set(fired.keys)).filter { snoozed[$0.key] == nil }
        if let first = due.first { present(first) }
    }

    func handleActive() async {
        if let url = PendingJoin.take() { _ = await UIApplication.shared.open(url) }
        if isDemo { setupDemo(); return }
        await refreshNotifStatus()
        await refresh()
    }

    // MARK: background

    func scheduleBackgroundRefresh() {
        let req = BGAppRefreshTaskRequest(identifier: Config.refreshTaskId)
        req.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        try? BGTaskScheduler.shared.submit(req)
    }

    func runBackgroundRefresh(_ task: BGAppRefreshTask) {
        scheduleBackgroundRefresh()
        let work = Task { @MainActor in
            await self.refresh()
            task.setTaskCompleted(success: true)
        }
        task.expirationHandler = { work.cancel() }
    }
}
