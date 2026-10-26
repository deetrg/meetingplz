import SwiftUI

struct RootView: View {
    @EnvironmentObject var model: AppModel
    let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        ZStack {
            MP.paper.ignoresSafeArea()
            if model.isSignedIn { HomeView() } else { SignInView() }
            if let r = model.reminder {
                ReminderOverlay(state: r).id(r.id).zIndex(10)
            }
        }
        .onReceive(timer) { _ in model.tick() }
        .animation(.easeInOut(duration: 0.2), value: model.reminder?.id)
    }
}

struct SignInView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.openURL) private var openURL
    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            VStack(spacing: 18) {
                TowedBanner(text: "MEETINGPLZ", planeWidth: 130, tile: 22)
                    .fixedSize()
                    .scaleEffect(0.78)
                    .frame(maxWidth: .infinity)
                    .padding(.bottom, 24)
                Text("MeetingPlz.").font(.mpHead(44)).tracking(-1.2).foregroundStyle(MP.ink)
                Text("A loud, clear reminder two minutes before every meeting, with one big Join button.")
                    .font(.system(size: 17)).foregroundStyle(MP.muted).multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
            }
            Spacer()
            VStack(spacing: 14) {
                if let err = model.errorText {
                    Text(err).font(.system(size: 14)).foregroundStyle(MP.ink).multilineTextAlignment(.center)
                }
                Button { Task { await model.signIn() } } label: {
                    if model.signingIn { ProgressView().tint(MP.paper) } else { Text("Continue with Google") }
                }
                .buttonStyle(PillButtonStyle(primary: true, big: true))
                .disabled(model.signingIn)
                Button { model.startDemo() } label: {
                    Text("Try it without signing in").font(.system(size: 16, weight: .bold)).foregroundStyle(MP.ink)
                        .underline().frame(maxWidth: .infinity, minHeight: 44)
                }
                .disabled(model.signingIn)
                Text("Reads your Google Calendar. Nothing else.").font(.system(size: 13)).foregroundStyle(MP.muted)
                HStack(spacing: 18) {
                    Button("Privacy") { openURL(URL(string: Config.base + "/privacy")!) }
                    Button("Terms") { openURL(URL(string: Config.base + "/terms")!) }
                }
                .font(.system(size: 13, weight: .semibold)).foregroundStyle(MP.ink)
            }
            .padding(.horizontal, 24).padding(.bottom, 24)
        }
    }
}

struct HomeView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.openURL) private var openURL
    @State private var showSettings = false

    var body: some View {
        let list = Core.eventsToShow(model.events, settings: model.settings)
        VStack(spacing: 0) {
            HStack {
                Text("Next up").font(.mpHead(36)).tracking(-1).foregroundStyle(MP.ink)
                Spacer()
                Button { showSettings = true } label: {
                    Image(systemName: "gearshape").font(.system(size: 20, weight: .semibold)).foregroundStyle(MP.ink)
                        .frame(width: 44, height: 44).overlay(Circle().stroke(MP.ink, lineWidth: MP.line))
                }
                .accessibilityLabel("Settings")
            }
            .padding(.horizontal, 20).padding(.top, 12).padding(.bottom, 8)

            if model.isDemo && !AppModel.hideBanner {
                Button { model.exitDemo(); Task { await model.signIn() } } label: {
                    Text("Demo mode \u{00B7} Sign in to use your calendar")
                        .font(.system(size: 14, weight: .semibold)).foregroundStyle(MP.ink)
                        .frame(maxWidth: .infinity).outlineCard()
                }
                .padding(.horizontal, 20).padding(.bottom, 8)
            }

            if model.notifStatus == .denied && !model.isDemo {
                Button { if let u = URL(string: UIApplication.openSettingsURLString) { openURL(u) } } label: {
                    Text("Notifications are off. Tap to turn them on in Settings.")
                        .font(.system(size: 14, weight: .semibold)).foregroundStyle(MP.ink)
                        .frame(maxWidth: .infinity).outlineCard()
                }
                .padding(.horizontal, 20).padding(.bottom, 8)
            }

            ScrollView {
                LazyVStack(spacing: 12) {
                    if list.isEmpty {
                        VStack(spacing: 16) {
                            CalendarCheckView().frame(width: 90)
                            Text(model.isRefreshing && !model.loaded ? "Loading your meetings." : "Nothing coming up.")
                                .font(.mpHead(22)).foregroundStyle(MP.ink)
                            Text(model.errorText ?? "Your next 24 hours are clear. We will remind you when a meeting is close.")
                                .font(.system(size: 15)).foregroundStyle(MP.muted).multilineTextAlignment(.center)
                        }
                        .padding(.top, 60).padding(.horizontal, 24)
                    }
                    ForEach(list) { e in EventRow(event: e) }
                }
                .padding(.horizontal, 20).padding(.top, 8).padding(.bottom, 12)
            }
            .refreshable { await model.refresh() }

            Button("Test it") { startTestAfterDelay() }
                .buttonStyle(PillButtonStyle(primary: true, big: true))
                .padding(.horizontal, 20).padding(.bottom, 16)
        }
        .sheet(isPresented: $showSettings) { SettingsView().environmentObject(model) }
        .task {
            if CommandLine.arguments.contains("-mpSettings") { showSettings = true }
        }
    }

    private func startTestAfterDelay() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { model.startTest() }
    }
}

struct EventRow: View {
    let event: MPEvent
    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { ctx in
            let ms = event.startDate.timeIntervalSince(ctx.date) * 1000
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(event.title).font(.system(size: 18, weight: .bold)).foregroundStyle(MP.ink).lineLimit(2)
                    Text("\(Core.timeRange(event)) \u{00B7} \(ms > 0 ? Core.inText(ms) : "now")")
                        .font(.system(size: 14)).foregroundStyle(MP.muted)
                    if let a = event.attendees, !a.isEmpty { Text(a).font(.system(size: 14)).foregroundStyle(MP.muted) }
                    if let c = event.calendar, !c.isEmpty { Text(c).font(.system(size: 12)).foregroundStyle(MP.muted) }
                }
                Spacer(minLength: 0)
                if let l = event.link, !l.isEmpty {
                    Text(Core.providerLabel(l).replacingOccurrences(of: "Join on ", with: "").replacingOccurrences(of: "Join ", with: ""))
                        .font(.system(size: 12, weight: .bold)).foregroundStyle(MP.ink)
                        .padding(.horizontal, 10).padding(.vertical, 5)
                        .overlay(Capsule().stroke(MP.ink, lineWidth: 1.5))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .outlineCard()
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var confirmDelete = false

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
            Form {
                Section("Reminder") {
                    Picker("Remind me", selection: bind(\.leadSeconds)) {
                        ForEach(Settings.leadOptions, id: \.self) { Text("\(Core.leadLabel($0)) before").tag($0) }
                    }
                    Picker("Style", selection: bind(\.style)) {
                        Text("Plane fly-by").tag("flyby")
                        Text("Full screen").tag("takeover")
                    }
                    Picker("Sound", selection: bind(\.alarm)) {
                        ForEach(Settings.alarmOptions, id: \.self) { Text($0.capitalized).tag($0) }
                    }
                    Toggle("Real meetings only", isOn: bind(\.meetingsOnly))
                    if AlarmScheduler.isSupported && !model.isDemo {
                        Toggle("Ring like an alarm", isOn: Binding(get: { model.alarmKitOn }, set: { model.setAlarmKit($0) }))
                    }
                }
                Section("Accounts") {
                    let accounts = model.me?.accounts ?? []
                    if accounts.isEmpty, let me = model.me { Text(me.email).foregroundStyle(MP.muted) }
                    ForEach(accounts) { a in
                        HStack {
                            Text(a.email).foregroundStyle(MP.ink)
                            Spacer()
                            if a.error != nil { Text("Sign in again").font(.footnote).foregroundStyle(MP.muted) }
                            else if a.primary { Text("Main").font(.footnote).foregroundStyle(MP.muted) }
                        }
                        .deleteDisabled(accounts.count <= 1 || model.isDemo)
                    }
                    .onDelete { idx in
                        let ids = idx.map { accounts[$0].id }
                        if !model.isDemo { for id in ids { Task { await model.removeAccount(id) } } }
                    }
                    if model.isDemo {
                        Button("Sign in to add your Google accounts") { dismiss(); model.exitDemo(); Task { await model.signIn() } }
                    } else {
                        Button { Task { await model.addAccount() } } label: {
                            if model.linking { ProgressView() } else { Text("Add another Google account") }
                        }
                        .disabled(model.linking)
                    }
                }
                .id("accounts")
                Section("Account") {
                    if model.isDemo {
                        Button("Exit demo") { dismiss(); model.exitDemo() }
                    } else {
                        Button("Sign out") { Task { await model.signOut(); dismiss() } }
                        Button("Delete account", role: .destructive) { confirmDelete = true }
                    }
                    if let err = model.errorText { Text(err).font(.footnote).foregroundStyle(MP.muted) }
                }
                Section {
                    Button("Privacy") { openURL(URL(string: Config.base + "/privacy")!) }
                    Button("Terms") { openURL(URL(string: Config.base + "/terms")!) }
                    HStack { Text("Version"); Spacer(); Text(version).foregroundStyle(MP.muted) }
                }
            }
            .onAppear {
                if CommandLine.arguments.contains("-mpAccounts") {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { withAnimation { proxy.scrollTo("accounts", anchor: .top) } }
                }
            }
            }
            .scrollContentBackground(.hidden)
            .background(MP.paper)
            .tint(MP.ink)
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() }.fontWeight(.bold) } }
            .alert("Delete your account?", isPresented: $confirmDelete) {
                Button("Cancel", role: .cancel) {}
                Button("Delete", role: .destructive) { Task { await model.deleteAccount(); dismiss() } }
            } message: {
                Text("This removes your MeetingPlz account and settings. Your Google Calendar is not touched.")
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
