import Foundation
import UserNotifications
import UIKit

final class NotificationScheduler: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationScheduler()
    static let category = "MEETING"
    static let evtPrefix = "mp.evt."
    static let snoozePrefix = "mp.snooze."

    func register() {
        let join = UNNotificationAction(identifier: "JOIN", title: "Join", options: [.foreground])
        let snooze = UNNotificationAction(identifier: "SNOOZE", title: "Snooze 1 min", options: [])
        let cat = UNNotificationCategory(identifier: Self.category, actions: [join, snooze], intentIdentifiers: [], options: [])
        let c = UNUserNotificationCenter.current()
        c.setNotificationCategories([cat])
        c.delegate = self
    }

    func requestAuthorization() async -> Bool {
        (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
    }

    func status() async -> UNAuthorizationStatus {
        await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    private func content(for e: MPEvent, lead: Int?, snoozed: Bool = false) -> UNMutableNotificationContent {
        let c = UNMutableNotificationContent()
        c.title = "Join the meeting."
        let label = Core.providerLabel(e.link)
        if snoozed {
            c.body = "\(e.title) is starting now \u{00B7} \(label)"
        } else {
            c.body = "\(e.title) starts in \(Core.leadLabel(lead ?? 120)) \u{00B7} \(label)"
        }
        c.sound = .default
        c.interruptionLevel = .timeSensitive
        c.categoryIdentifier = Self.category
        c.userInfo = ["key": e.key, "title": e.title, "link": e.link ?? "", "start": e.startDate.timeIntervalSince1970,
                      "end": e.endDate.timeIntervalSince1970, "calendar": e.calendar ?? "", "attendees": e.attendees ?? ""]
        return c
    }

    /// Replace all scheduled meeting notifications with the next ones in the window.
    func reschedule(events: [MPEvent], settings: Settings) async {
        let c = UNUserNotificationCenter.current()
        let pending = await c.pendingNotificationRequests()
        c.removePendingNotificationRequests(withIdentifiers: pending.map(\.identifier).filter { $0.hasPrefix(Self.evtPrefix) })
        guard await status() != .denied else { return }
        let now = Date()
        let horizon = now.addingTimeInterval(24 * 3600)
        let due = Core.eventsToShow(events, settings: settings, now: now)
            .compactMap { e -> (MPEvent, Date)? in
                let fire = e.startDate.addingTimeInterval(-TimeInterval(settings.leadSeconds))
                return fire > now.addingTimeInterval(2) && fire < horizon ? (e, fire) : nil
            }
            .prefix(50)
        for (e, fire) in due {
            let comps = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: fire)
            let trigger = UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)
            let req = UNNotificationRequest(identifier: Self.evtPrefix + e.key, content: content(for: e, lead: settings.leadSeconds), trigger: trigger)
            try? await c.add(req)
        }
    }

    func scheduleSnooze(for e: MPEvent, seconds: Int) async {
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: TimeInterval(max(5, seconds)), repeats: false)
        let req = UNNotificationRequest(identifier: Self.snoozePrefix + e.key, content: content(for: e, lead: nil, snoozed: true), trigger: trigger)
        try? await UNUserNotificationCenter.current().add(req)
    }

    func clear(key: String) {
        let c = UNUserNotificationCenter.current()
        c.removeDeliveredNotifications(withIdentifiers: [Self.evtPrefix + key, Self.snoozePrefix + key])
        c.removePendingNotificationRequests(withIdentifiers: [Self.snoozePrefix + key])
    }

    func clearAll() {
        let c = UNUserNotificationCenter.current()
        c.removeAllPendingNotificationRequests()
        c.removeAllDeliveredNotifications()
    }

    static func event(from info: [AnyHashable: Any]) -> MPEvent? {
        guard let key = info["key"] as? String, let start = info["start"] as? Double else { return nil }
        let end = (info["end"] as? Double) ?? start + 1800
        let link = info["link"] as? String
        return MPEvent(key: key, id: key, title: (info["title"] as? String) ?? "Meeting", start: Date(timeIntervalSince1970: start),
                       end: Date(timeIntervalSince1970: end), link: (link ?? "").isEmpty ? nil : link,
                       calendar: info["calendar"] as? String, attendees: info["attendees"] as? String)
    }

    // MARK: delegate

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        // App is open: show the full-screen reminder instead of a banner.
        if let e = Self.event(from: notification.request.content.userInfo) {
            await MainActor.run { AppModel.shared.present(e, fromNotification: true) }
            return []
        }
        return [.banner, .sound]
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let info = response.notification.request.content.userInfo
        guard let e = Self.event(from: info) else { return }
        switch response.actionIdentifier {
        case "JOIN":
            if let l = e.link, let url = URL(string: l) { await MainActor.run { UIApplication.shared.open(url, options: [:], completionHandler: nil) } }
            await MainActor.run { AppModel.shared.markFired(e.key) }
        case "SNOOZE":
            await scheduleSnooze(for: e, seconds: Settings.load().snoozeSeconds)
            await MainActor.run { AppModel.shared.markFired(e.key) }
        default:
            await MainActor.run { AppModel.shared.present(e, fromNotification: true) }
        }
    }
}
