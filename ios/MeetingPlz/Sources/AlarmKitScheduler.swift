import Foundation
import SwiftUI
import AppIntents
#if canImport(AlarmKit)
import AlarmKit
#endif

/// Pending "Join" tap from an AlarmKit alarm, opened when the app becomes active.
enum PendingJoin {
    static let key = "mp.pendingJoin"
    static func set(_ link: String) { UserDefaults.standard.set(link, forKey: key) }
    static func take() -> URL? {
        guard let s = UserDefaults.standard.string(forKey: key), !s.isEmpty else { return nil }
        UserDefaults.standard.removeObject(forKey: key)
        return URL(string: s)
    }
}

struct JoinMeetingIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Join meeting"
    static var openAppWhenRun: Bool = true
    @Parameter(title: "Link") var link: String
    init() { link = "" }
    init(link: String) { self.link = link }
    func perform() async throws -> some IntentResult {
        if !link.isEmpty { PendingJoin.set(link) }
        return .result()
    }
}

#if canImport(AlarmKit)
@available(iOS 26.0, *)
struct MeetingAlarmMetadata: AlarmMetadata {
    var title: String = ""
}
#endif

enum AlarmScheduler {
    static let enabledKey = "mp.alarmkit.enabled"
    static let idsKey = "mp.alarmkit.ids"
    static var enabled: Bool {
        get { UserDefaults.standard.object(forKey: enabledKey) as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: enabledKey) }
    }
    static var isSupported: Bool {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) { return true }
        #endif
        return false
    }

    static func reschedule(events: [MPEvent], settings: Settings) async {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) {
            let mgr = AlarmManager.shared
            // cancel what we scheduled before
            let old = (UserDefaults.standard.array(forKey: idsKey) as? [String]) ?? []
            for s in old { if let u = UUID(uuidString: s) { try? mgr.cancel(id: u) } }
            UserDefaults.standard.removeObject(forKey: idsKey)
            guard enabled else { return }
            if mgr.authorizationState == .notDetermined { _ = try? await mgr.requestAuthorization() }
            guard mgr.authorizationState == .authorized else { return }
            let now = Date()
            var ids: [String] = []
            let list = Core.eventsToShow(events, settings: settings, now: now).compactMap { e -> (MPEvent, Date)? in
                let fire = e.startDate.addingTimeInterval(-TimeInterval(settings.leadSeconds))
                return fire > now.addingTimeInterval(5) && fire < now.addingTimeInterval(24 * 3600) ? (e, fire) : nil
            }.prefix(20)
            for (e, fire) in list {
                let stop = AlarmButton(text: "Stop", textColor: .white, systemImageName: "stop.circle")
                let join = AlarmButton(text: LocalizedStringResource(stringLiteral: Core.providerLabel(e.link)), textColor: .white, systemImageName: "video")
                let alert = AlarmPresentation.Alert(title: LocalizedStringResource(stringLiteral: "Your meeting is boarding. \(e.title)"),
                                                    stopButton: stop, secondaryButton: join, secondaryButtonBehavior: .custom)
                let attrs = AlarmAttributes<MeetingAlarmMetadata>(presentation: AlarmPresentation(alert: alert),
                                                                   metadata: MeetingAlarmMetadata(title: e.title), tintColor: .black)
                let cfg = AlarmManager.AlarmConfiguration<MeetingAlarmMetadata>.alarm(
                    schedule: .fixed(fire), attributes: attrs, stopIntent: nil,
                    secondaryIntent: JoinMeetingIntent(link: e.link ?? ""))
                let id = UUID()
                if (try? await mgr.schedule(id: id, configuration: cfg)) != nil { ids.append(id.uuidString) }
            }
            UserDefaults.standard.set(ids, forKey: idsKey)
        }
        #endif
    }

    static func cancelAll() {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) {
            for s in (UserDefaults.standard.array(forKey: idsKey) as? [String]) ?? [] { if let u = UUID(uuidString: s) { try? AlarmManager.shared.cancel(id: u) } }
        }
        #endif
        UserDefaults.standard.removeObject(forKey: idsKey)
    }
}
