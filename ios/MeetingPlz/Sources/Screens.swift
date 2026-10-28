import SwiftUI

struct RootView: View {
    @EnvironmentObject var model: AppModel
    let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        ZStack {
            PaperBackground()
            if model.isSignedIn { HomeView() } else { SignInView() }
            if let r = model.reminder {
                ReminderOverlay(state: r).id(r.id).zIndex(10)
            }
        }
        .onReceive(timer) { _ in model.tick() }
        .animation(.easeInOut(duration: 0.2), value: model.reminder?.id)
    }
}

// MARK: sign in

struct SignInView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            VStack(spacing: 20) {
                PlaneArt().frame(width: 168)
                Wordmark(size: 30)
                (Text("Your meetings, ").font(.serif(42)) + Text("on time.").font(.serif(42, italic: true)))
                    .tracking(-0.42).foregroundStyle(MP.ink)
                    .multilineTextAlignment(.center).lineSpacing(-2)
                    .padding(.horizontal, 28).padding(.top, 4)
            }
            Spacer()
            VStack(spacing: 6) {
                if let err = model.errorText {
                    Text(err).font(.ui(14)).foregroundStyle(MP.ink).multilineTextAlignment(.center).padding(.bottom, 8)
                }
                GoogleSignInButton(loading: model.signingIn) { Task { await model.signIn() } }
                    .disabled(model.signingIn)
                    .padding(.bottom, 8)
                TextButton(title: "Try it without signing in", muted: true) { model.startDemo() }
                    .disabled(model.signingIn)
                Text("Reads your Google Calendar. Nothing else.").font(.ui(13)).foregroundStyle(MP.muted).padding(.top, 10)
                HStack(spacing: 10) {
                    Button("Privacy") { openURL(URL(string: Config.base + "/privacy")!) }
                    Text("\u{00B7}").foregroundStyle(MP.muted)
                    Button("Terms") { openURL(URL(string: Config.base + "/terms")!) }
                }
                .font(.mono(12)).foregroundStyle(MP.muted).padding(.top, 8)
            }
            .padding(.horizontal, 24).padding(.bottom, 20)
        }
    }
}

// MARK: home = departures board

struct HomeView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.openURL) private var openURL
    @State private var showSettings = false

    var body: some View {
        let list = Core.eventsToShow(model.events, settings: model.settings)
        VStack(spacing: 0) {
            if model.isDemo && !AppModel.hideBanner { demoStrip }
            if model.notifStatus == .denied && !model.isDemo { notifStrip }

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    HStack {
                        Wordmark(size: 26)
                        Spacer()
                        Button { showSettings = true } label: {
                            Image(systemName: "gearshape").font(.system(size: 19, weight: .regular)).foregroundStyle(MP.ink)
                                .frame(width: 44, height: 44).contentShape(Rectangle())
                        }
                        .buttonStyle(PressScale())
                        .accessibilityLabel("Settings")
                        .padding(.trailing, -10)
                    }
                    .padding(.top, 6)

                    Text("Departures \u{00B7} next 24 hours").monoLabel().padding(.top, 26)
                    Text("Next up").font(.serif(52)).tracking(-0.52).foregroundStyle(MP.ink).padding(.top, 4)
                    Rectangle().fill(MP.ink).frame(height: 1).padding(.top, 12)

                    if list.isEmpty {
                        if model.isRefreshing && !model.loaded {
                            EmptyState(title: "Loading.", subtitle: "Checking your calendars.")
                        } else {
                            EmptyState(subtitle: model.errorText ?? "No meetings in the next 24 hours.")
                        }
                    } else {
                        ForEach(list) { e in BoardRow(event: e, lead: model.settings.leadSeconds) }
                    }
                }
                .padding(.horizontal, MP.pad).padding(.bottom, 16)
            }
            .refreshable { await model.refresh() }

            VStack(spacing: 8) {
                PrimaryButton(title: "Test it") { startTestAfterDelay() }
                Text("See the reminder exactly as it will appear.").font(.ui(13)).foregroundStyle(MP.muted)
            }
            .padding(.horizontal, MP.pad).padding(.top, 10).padding(.bottom, 10)
            .background(MP.paper.ignoresSafeArea(edges: .bottom))
        }
        .sheet(isPresented: $showSettings) { SettingsView().environmentObject(model) }
        .task {
            if CommandLine.arguments.contains("-mpSettings") { showSettings = true }
        }
    }

    private var demoStrip: some View {
        HStack(spacing: 8) {
            Circle().fill(MP.accent).frame(width: 5, height: 5)
            Text("Demo mode \u{00B7} sample meetings").monoLabel(size: 10.5).lineLimit(1)
            Spacer(minLength: 8)
            Button { model.exitDemo(); Task { await model.signIn() } } label: {
                Text("Sign in").font(.mono(10.5, weight: .medium)).tracking(0.9).textCase(.uppercase).underline().foregroundStyle(MP.ink)
                    .frame(minHeight: 34)
            }
        }
        .padding(.horizontal, MP.pad)
        .frame(minHeight: 34)
        .background(MP.surface.ignoresSafeArea(edges: .top))
        .overlay(alignment: .bottom) { Hairline() }
    }

    private var notifStrip: some View {
        Button { if let u = URL(string: UIApplication.openSettingsURLString) { openURL(u) } } label: {
            HStack(spacing: 8) {
                Circle().fill(MP.accent).frame(width: 5, height: 5)
                Text("Notifications are off. Tap to turn them on.").monoLabel(size: 10.5, color: MP.ink).lineLimit(1).minimumScaleFactor(0.8)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, MP.pad).frame(minHeight: 36)
            .background(MP.accentSoft.ignoresSafeArea(edges: .top))
            .overlay(alignment: .bottom) { Hairline() }
        }
        .buttonStyle(.plain)
    }

    private func startTestAfterDelay() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { model.startTest() }
    }
}

/// One departure: time (mono) | title (serif) + meta | status chip.
struct BoardRow: View {
    let event: MPEvent
    let lead: Int
    var body: some View {
        TimelineView(.periodic(from: .now, by: 15)) { ctx in
            let status = FlightStatus.of(event, now: ctx.date, lead: lead)
            HStack(alignment: .top, spacing: 14) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(Core.boardTime(event.startDate)).font(.mono(13.5, weight: .medium)).foregroundStyle(MP.ink).lineLimit(1).fixedSize()
                    Text(Core.dayWord(event.startDate, now: ctx.date)).monoLabel(size: 10)
                }
                .frame(width: 66, alignment: .leading)
                .padding(.top, 5)
                VStack(alignment: .leading, spacing: 5) {
                    Text(event.title).font(.serif(22)).tracking(-0.22).foregroundStyle(MP.ink).lineLimit(2).fixedSize(horizontal: false, vertical: true)
                    Text(meta).font(.mono(11.5)).foregroundStyle(MP.muted).lineLimit(1).truncationMode(.tail)
                }
                Spacer(minLength: 0)
                StatusChip(status: status).padding(.top, 2)
            }
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .bottom) { Hairline() }
        }
    }

    private var meta: String {
        var parts: [String] = []
        let w = Core.withText(event.attendees)
        if w != "\u{2014}" { parts.append(w) }
        let g = Core.gateLabel(event.link)
        if g != "\u{2014}" { parts.append(g + " \u{2197}") }
        if parts.isEmpty { return "\u{2014}" }
        return parts.joined(separator: " \u{00B7} ")
    }
}

// MARK: settings

struct SettingsView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var confirmDelete = false

    var body: some View {
        ZStack {
            PaperBackground()
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        HStack(alignment: .firstTextBaseline) {
                            Text("Settings").font(.serif(44)).tracking(-0.44).foregroundStyle(MP.ink)
                            Spacer()
                            TextButton(title: "Done") { dismiss() }
                        }
                        .padding(.bottom, 10)
                        Hairline()

                        SettingRow(title: "Remind me", detail: "Before each meeting starts") {
                            Segmented(options: Settings.leadOptions.map { ($0, Core.leadLabel($0)) }, selection: bind(\.leadSeconds))
                        }
                        SettingRow(title: "Style", detail: "How the reminder arrives") {
                            Segmented(options: [("flyby", "Fly-by"), ("takeover", "Takeover")], selection: bind(\.style), stretch: false)
                        }
                        SettingRow(title: "Alarm", detail: "Plays with the reminder") {
                            Segmented(options: Settings.alarmOptions.map { ($0, $0.capitalized) }, selection: bind(\.alarm))
                        }
                        SettingRow(title: "Only real meetings", detail: "Skips all-day events and solo blocks") {
                            Segmented(options: [(true, "On"), (false, "Off")], selection: bind(\.meetingsOnly), stretch: false)
                        }
                        if AlarmScheduler.isSupported && !model.isDemo {
                            SettingRow(title: "Ring like an alarm") {
                                Segmented(options: [(true, "On"), (false, "Off")],
                                          selection: Binding(get: { model.alarmKitOn }, set: { model.setAlarmKit($0) }), stretch: false)
                            }
                        }

                        accounts.id("accounts")

                        VStack(alignment: .leading, spacing: 0) {
                            if model.isDemo {
                                TextButton(title: "Exit demo") { dismiss(); model.exitDemo() }
                            } else {
                                TextButton(title: "Sign out") { Task { await model.signOut(); dismiss() } }
                                TextButton(title: "Delete account", tint: MP.accent) { confirmDelete = true }
                            }
                            if let err = model.errorText { Text(err).font(.ui(13)).foregroundStyle(MP.muted).padding(.top, 4) }
                        }
                        .padding(.top, 22)

                        Hairline().padding(.top, 20)
                        HStack(spacing: 10) {
                            Button("Privacy") { openURL(URL(string: Config.base + "/privacy")!) }
                            Text("\u{00B7}").foregroundStyle(MP.muted)
                            Button("Terms") { openURL(URL(string: Config.base + "/terms")!) }
                            Spacer()
                            Text(version).foregroundStyle(MP.muted)
                        }
                        .font(.mono(12)).foregroundStyle(MP.muted).padding(.top, 14)
                    }
                    .padding(.horizontal, MP.pad).padding(.top, 22).padding(.bottom, 40)
                }
                .onAppear {
                    if CommandLine.arguments.contains("-mpAccounts") {
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { withAnimation { proxy.scrollTo("accounts", anchor: .top) } }
                    }
                }
            }
        }
        .presentationBackground(MP.paper)
        .alert("Delete your account?", isPresented: $confirmDelete) {
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive) { Task { await model.deleteAccount(); dismiss() } }
        } message: {
            Text("This removes your MeetingPlz account and settings. Your Google Calendar is not touched.")
        }
    }

    private var accounts: some View {
        let list = model.me?.accounts ?? []
        let canRemove = list.count > 1 && !model.isDemo
        return VStack(alignment: .leading, spacing: 0) {
            Text("Accounts").font(.serif(30)).tracking(-0.3).foregroundStyle(MP.ink).padding(.top, 34).padding(.bottom, 14)
            VStack(spacing: 10) {
                if list.isEmpty, let me = model.me { PassportStamp(email: me.email) }
                ForEach(list) { a in
                    PassportStamp(email: a.email,
                                  tag: a.error != nil ? "Sign in again" : (a.primary ? "Main" : nil),
                                  tagAccent: a.error != nil,
                                  onRemove: canRemove ? { Task { await model.removeAccount(a.id) } } : nil)
                }
            }
            if model.isDemo {
                Text("Sign in to connect your Google accounts. Meetings from every account get a reminder.")
                    .font(.ui(13)).foregroundStyle(MP.muted).padding(.top, 12)
                TextButton(title: "Sign in to add your Google accounts") { dismiss(); model.exitDemo(); Task { await model.signIn() } }
                    .padding(.top, 4)
            } else {
                if canRemove { Text("Swipe an account left to remove it.").font(.ui(13)).foregroundStyle(MP.muted).padding(.top, 10) }
                Button { Task { await model.addAccount() } } label: {
                    if model.linking { ProgressView().tint(MP.ink) } else {
                        Text("+ Add another Google account").font(.ui(15, .medium)).foregroundStyle(MP.ink)
                    }
                }
                .disabled(model.linking)
                .padding(.vertical, 10).padding(.top, 4)
            }
        }
    }

    private var version: String {
        let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
        let b = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
        return "\(v) (\(b))"
    }

    private func bind<T>(_ kp: WritableKeyPath<Settings, T>) -> Binding<T> {
        Binding(get: { model.settings[keyPath: kp] }, set: { v in var s = model.settings; s[keyPath: kp] = v; model.updateSettings(s) })
    }
}
