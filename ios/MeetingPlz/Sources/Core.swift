import Foundation

struct Settings: Codable, Equatable {
    var leadSeconds: Int = 120
    var style: String = "flyby"
    var alarm: String = "jingle"
    var meetingsOnly: Bool = true
    var snoozeSeconds: Int = 60

    static let leadOptions = [30, 60, 120, 180, 300, 600]
    static let alarmOptions = ["jingle", "buzz", "bell", "beep", "off"]

    init() {}
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        leadSeconds = (try? c.decodeIfPresent(Int.self, forKey: .leadSeconds)) ?? 120
        style = (try? c.decodeIfPresent(String.self, forKey: .style)) ?? "flyby"
        alarm = (try? c.decodeIfPresent(String.self, forKey: .alarm)) ?? "jingle"
        meetingsOnly = (try? c.decodeIfPresent(Bool.self, forKey: .meetingsOnly)) ?? true
        snoozeSeconds = (try? c.decodeIfPresent(Int.self, forKey: .snoozeSeconds)) ?? 60
        if !Settings.leadOptions.contains(leadSeconds) { leadSeconds = 120 }
        if style != "flyby" && style != "takeover" { style = "flyby" }
        if !Settings.alarmOptions.contains(alarm) { alarm = "jingle" }
        if snoozeSeconds < 30 || snoozeSeconds > 1800 { snoozeSeconds = 60 }
    }

    private static let storeKey = "mp.settings"
    static func load() -> Settings {
        if let d = UserDefaults.standard.data(forKey: storeKey), let s = try? JSONDecoder().decode(Settings.self, from: d) { return s }
        return Settings()
    }
    func save() {
        if let d = try? JSONEncoder().encode(self) { UserDefaults.standard.set(d, forKey: Settings.storeKey) }
    }
}

struct Me: Codable, Equatable {
    var email: String
    var name: String?
    var picture: String?
    var settings: Settings?
}

/// Decodes either an ISO-8601 string or a number (ms or seconds since epoch).
struct FlexDate: Codable, Equatable {
    var date: Date
    init(_ d: Date) { date = d }
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let s = try? c.decode(String.self) {
            if let d = FlexDate.parse(s) { date = d; return }
            if let n = Double(s) { date = FlexDate.fromNumber(n); return }
            throw DecodingError.dataCorruptedError(in: c, debugDescription: "bad date \(s)")
        }
        if let n = try? c.decode(Double.self) { date = FlexDate.fromNumber(n); return }
        // Google style { dateTime | date }
        if let o = try? c.decode([String: String].self), let s = o["dateTime"] ?? o["date"], let d = FlexDate.parse(s) { date = d; return }
        throw DecodingError.dataCorruptedError(in: c, debugDescription: "bad date")
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        try c.encode(FlexDate.iso.string(from: date))
    }
    static func fromNumber(_ n: Double) -> Date { Date(timeIntervalSince1970: n > 1e11 ? n / 1000 : n) }
    static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()
    static let isoPlain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime]; return f
    }()
    static func parse(_ s: String) -> Date? {
        iso.date(from: s) ?? isoPlain.date(from: s) ?? {
            let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"; return f.date(from: s)
        }()
    }
}

struct MPEvent: Codable, Identifiable, Equatable {
    var key: String
    var id: String
    var title: String
    var start: FlexDate
    var end: FlexDate
    var link: String?
    var provider: String?
    var calendar: String?
    var attendees: String?
    var attendeeCount: Int?
    var isMeeting: Bool?
    var allDay: Bool?
    var declined: Bool?

    var startDate: Date { start.date }
    var endDate: Date { end.date }

    init(key: String, id: String, title: String, start: Date, end: Date, link: String?, calendar: String?, attendees: String?) {
        self.key = key; self.id = id; self.title = title; self.start = FlexDate(start); self.end = FlexDate(end)
        self.link = link; self.calendar = calendar; self.attendees = attendees
        self.isMeeting = true; self.allDay = false; self.declined = false
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let startV = try c.decode(FlexDate.self, forKey: .start)
        let rawId = (try? c.decodeIfPresent(String.self, forKey: .id)) ?? ""
        let t = (try? c.decodeIfPresent(String.self, forKey: .title)) ?? ""
        title = t.isEmpty ? "Meeting" : t
        start = startV
        end = (try? c.decodeIfPresent(FlexDate.self, forKey: .end)) ?? FlexDate(startV.date.addingTimeInterval(1800))
        id = rawId
        key = ((try? c.decodeIfPresent(String.self, forKey: .key)) ?? nil) ?? "\(rawId)@\(Int(startV.date.timeIntervalSince1970 * 1000))"
        link = try? c.decodeIfPresent(String.self, forKey: .link)
        provider = try? c.decodeIfPresent(String.self, forKey: .provider)
        calendar = try? c.decodeIfPresent(String.self, forKey: .calendar)
        attendees = try? c.decodeIfPresent(String.self, forKey: .attendees)
        attendeeCount = try? c.decodeIfPresent(Int.self, forKey: .attendeeCount)
        isMeeting = try? c.decodeIfPresent(Bool.self, forKey: .isMeeting)
        allDay = try? c.decodeIfPresent(Bool.self, forKey: .allDay)
        declined = try? c.decodeIfPresent(Bool.self, forKey: .declined)
    }
}

struct UpcomingResponse: Decodable {
    var events: [MPEvent]
}

enum Core {
    static let graceSeconds: TimeInterval = 600

    static func isMeeting(_ e: MPEvent) -> Bool {
        if e.allDay == true || e.declined == true { return false }
        if let m = e.isMeeting { return m }
        return !(e.link ?? "").isEmpty || (e.attendeeCount ?? 0) > 1
    }

    static func providerLabel(_ link: String?) -> String {
        guard let link, !link.isEmpty, let host = URL(string: link)?.host?.lowercased() else { return "Got it" }
        if host == "meet.google.com" || host == "g.co" { return "Join on Meet" }
        if host == "zoom.us" || host.hasSuffix(".zoom.us") || host.hasSuffix(".zoom.com") || host == "zoom.com" || host.hasSuffix("zoomgov.com") { return "Join Zoom" }
        if host.hasSuffix("teams.microsoft.com") || host == "teams.live.com" || host == "teams.microsoft.us" { return "Join on Teams" }
        if host.hasSuffix("webex.com") { return "Join Webex" }
        return "Join"
    }

    static func eventsToShow(_ events: [MPEvent], settings: Settings, now: Date = Date()) -> [MPEvent] {
        events
            .filter { !$0.allDay.orFalse && !$0.declined.orFalse }
            .filter { !settings.meetingsOnly || isMeeting($0) }
            .filter { $0.endDate > now }
            .sorted { $0.startDate < $1.startDate }
    }

    static func pickDue(_ events: [MPEvent], now: Date, settings: Settings, fired: Set<String>) -> [MPEvent] {
        let lead = TimeInterval(settings.leadSeconds)
        return eventsToShow(events, settings: settings, now: .distantPast).filter { e in
            e.startDate.addingTimeInterval(-lead) <= now && now < e.startDate.addingTimeInterval(graceSeconds) && !fired.contains(e.key)
        }
    }

    static func inText(_ ms: Double) -> String {
        if !(ms > 0) { return "now" }
        let secs = Int((ms / 1000).rounded(.up))
        if secs >= 60 { let m = Int((Double(secs) / 60).rounded(.up)); return "in \(m) minute\(m == 1 ? "" : "s")" }
        return "in \(secs) second\(secs == 1 ? "" : "s")"
    }

    static func shortIn(_ ms: Double) -> String {
        if !(ms > 0) { return "NOW" }
        let secs = Int((ms / 1000).rounded(.up))
        return secs >= 60 ? "IN \(Int((Double(secs) / 60).rounded(.up))) MIN" : "IN \(secs) SEC"
    }

    static func bannerText(_ title: String, ms: Double) -> String {
        let suffix = " \u{00B7} " + shortIn(ms)
        var t = title.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ").uppercased()
        if t.isEmpty { t = "MEETING" }
        let room = 26 - suffix.count
        if t.count > room {
            t = String(t.prefix(max(1, room - 1))).trimmingCharacters(in: .whitespaces) + "\u{2026}"
        }
        return t + suffix
    }

    static func fmtClock(_ ms: Double) -> String {
        let secs = ms > 0 ? Int((ms / 1000).rounded(.up)) : Int((-ms / 1000).rounded(.down))
        let h = secs / 3600, m = (secs % 3600) / 60, s = secs % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
    }

    static func leadLabel(_ s: Int) -> String {
        s < 60 ? "\(s) sec" : "\(s / 60) min"
    }

    static let timeFmt: DateFormatter = {
        let f = DateFormatter(); f.timeStyle = .short; f.dateStyle = .none; return f
    }()
    static func timeRange(_ e: MPEvent) -> String {
        "\(timeFmt.string(from: e.startDate)) \u{2013} \(timeFmt.string(from: e.endDate))"
    }
}

extension Optional where Wrapped == Bool {
    var orFalse: Bool { self ?? false }
}
