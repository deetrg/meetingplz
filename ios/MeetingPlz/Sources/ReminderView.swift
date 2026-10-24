import SwiftUI

struct ReminderOverlay: View {
    @EnvironmentObject var model: AppModel
    let state: ReminderState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var showCard = false
    @State private var planeProgress: CGFloat = 0
    @State private var holdProgress: CGFloat = 0

    private var takeover: Bool { model.settings.style == "takeover" }
    private var e: MPEvent { state.event }

    var body: some View {
        GeometryReader { geo in
            ZStack {
                if takeover {
                    MP.paper.ignoresSafeArea()
                }
                if !takeover { flyby(width: geo.size.width, top: geo.safeAreaInsets.top) }
                if showCard || takeover || reduceMotion {
                    card
                        .padding(takeover ? 28 : 20)
                        .frame(maxWidth: takeover ? .infinity : 460, maxHeight: takeover ? .infinity : nil)
                        .transition(.scale(scale: 0.92).combined(with: .opacity))
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .onAppear {
            guard !takeover, !reduceMotion else { showCard = true; return }
            withAnimation(.linear(duration: 4.2)) { planeProgress = 1 }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                withAnimation(.spring(response: 0.45, dampingFraction: 0.82)) { showCard = true }
            }
        }
    }

    @ViewBuilder private func flyby(width: CGFloat, top: CGFloat) -> some View {
        if !reduceMotion {
            TimelineView(.periodic(from: .now, by: 1)) { ctx in
                let ms = e.startDate.timeIntervalSince(ctx.date) * 1000
                let text = Core.bannerText(e.title, ms: ms)
                let total = TowedBanner.totalWidth(text)
                VStack {
                    TowedBanner(text: text)
                        .fixedSize()
                        .offset(x: -total + (width + total) * planeProgress - width / 2 + total / 2)
                        .frame(width: width, alignment: .center)
                        .padding(.top, top + 24)
                    Spacer()
                }
                .allowsHitTesting(false)
            }
        }
    }

    private var card: some View {
        TimelineView(.periodic(from: .now, by: 0.5)) { ctx in
            let ms = e.startDate.timeIntervalSince(ctx.date) * 1000
            let started = ms <= 0
            VStack(spacing: 12) {
                Text(started ? "It started." : "Join the meeting.")
                    .font(.mpHead(takeover ? 40 : 30)).tracking(-0.8).lineLimit(1).minimumScaleFactor(0.6)
                    .foregroundStyle(MP.ink)
                    .multilineTextAlignment(.center)
                Text(started ? "Everyone's in there. Join now." : "Your meeting starts \(Core.inText(ms)).")
                    .font(.system(size: 16)).foregroundStyle(MP.muted)
                    .multilineTextAlignment(.center)
                Rectangle().fill(MP.ink).frame(height: 1.5).padding(.vertical, 4)
                Text(e.title).font(.system(size: 20, weight: .bold)).foregroundStyle(MP.ink).multilineTextAlignment(.center)
                VStack(spacing: 3) {
                    Text(Core.timeRange(e)).font(.system(size: 15)).foregroundStyle(MP.ink)
                    if let c = e.calendar, !c.isEmpty { Text(c).font(.system(size: 14)).foregroundStyle(MP.muted) }
                    if let a = e.attendees, !a.isEmpty { Text(a).font(.system(size: 14)).foregroundStyle(MP.muted) }
                }
                Text(started ? "late by \(Core.fmtClock(ms))" : Core.fmtClock(ms))
                    .font(.system(size: started ? 28 : 56, weight: .heavy).monospacedDigit())
                    .foregroundStyle(MP.ink)
                    .padding(.vertical, 4)
                VStack(spacing: 10) {
                    Button(Core.providerLabel(e.link)) { model.join() }
                        .buttonStyle(PillButtonStyle(primary: true, big: true))
                    Button("I'm in") { model.dismissReminder() }
                        .buttonStyle(PillButtonStyle(primary: false))
                    Button("Snooze \(model.settings.snoozeSeconds >= 60 ? "\(model.settings.snoozeSeconds / 60) min" : "\(model.settings.snoozeSeconds) sec")") { model.snooze() }
                        .font(.system(size: 15, weight: .semibold)).foregroundStyle(MP.ink)
                        .padding(.vertical, 6)
                }
                holdToClose
            }
            .padding(24)
            .background(RoundedRectangle(cornerRadius: takeover ? 0 : MP.radius).fill(MP.paper))
            .overlay(RoundedRectangle(cornerRadius: takeover ? 0 : MP.radius).stroke(takeover ? .clear : MP.ink, lineWidth: MP.line))
            .shadow(color: .black.opacity(takeover ? 0 : 0.28), radius: 30, x: 0, y: 18)
        }
    }

    private var holdToClose: some View {
        Text("Hold to close")
            .font(.system(size: 12, weight: .medium)).foregroundStyle(MP.muted)
            .padding(.vertical, 6).padding(.horizontal, 12)
            .background(alignment: .leading) {
                GeometryReader { g in Capsule().fill(MP.soft).frame(width: g.size.width * holdProgress) }
            }
            .overlay(Capsule().stroke(MP.muted.opacity(0.5), lineWidth: 1))
            .onLongPressGesture(minimumDuration: 1.0, maximumDistance: 40, perform: {
                model.dismissReminder()
            }, onPressingChanged: { pressing in
                withAnimation(.linear(duration: pressing ? 1.0 : 0.15)) { holdProgress = pressing ? 1 : 0 }
            })
            .padding(.top, 2)
    }
}
