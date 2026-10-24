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

    static let demo = CommandLine.arguments.contains("-mpDemo")
    @Published var token: String? = CommandLine.arguments.contains("-mpDemo") ? (CommandLine.arguments.contains("-mpSignedOut") ? nil : "demo") : Keychain.get()
    @Published var me: Me?
    @Published var settings = Settings.load()
    @Published var events: [MPEvent] = AppModel.loadCachedEvents()
    @Published var isRefreshing = false
    @Published var loaded = false
    @Published var errorText: String?
    @Published var signingIn = false
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

    // MARK: demo (used for CI screenshots only)

    private var demoDone = false
    func setupDemo() {
        guard !demoDone, token != nil else { return }
        demoDone = true
        let now = Date()
        func ev(_ k: String, _ t: String, _ m: Double, _ len: Double, _ link: String?, _ att: String) -> MPEvent {
            MPEvent(key: k, id: k, title: t, start: now.addingTimeInterval(m * 60), end: now.addingTimeInterval((m + len) * 60), link: link, calendar: "dai@example.com", attendees: att)
        }
        me = Me(email: "dai@example.com", name: "Dai", picture: nil, settings: nil)
        events = [ev("a", "Quick sync", 32, 30, "https://meet.google.com/abc-defg-hij", "with Miles and 3 others"),
                  ev("b", "Design review", 95, 45, "https://zoom.us/j/123456", "with Lan and 1 other"),
                  ev("c", "Weekly 1:1", 240, 30, "https://teams.microsoft.com/l/meetup-join/x", "with Phi")]
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
        guard isSignedIn, !AppModel.demo else { return }
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
        await NotificationScheduler.shared.reschedule(events: events, settings: settings)
        await AlarmScheduler.reschedule(events: events, settings: settings)
    }

    func updateSettings(_ new: Settings) {
        settings = new; new.save()
        Task {
            if let saved = try? await api.putSettings(new) { settings = saved; saved.save() }
            await rescheduleAll()
        }
    }

    func setAlarmKit(_ on: Bool) {
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
        let start = Date().addingTimeInterval(TimeInterval(settings.leadSeconds))
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
        if isSignedIn { Task { await rescheduleAll() } }
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
        guard isSignedIn, reminder == nil else { return }
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
        if AppModel.demo { setupDemo(); return }
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
