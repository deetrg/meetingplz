import SwiftUI

/// Pass outline: rounded rect (r 18) with a half-circle notch (r 9) cut into both side edges at `notchY`.
struct PassShape: Shape {
    var notchY: CGFloat
    var radius: CGFloat = 18
    var notch: CGFloat = 9
    var animatableData: CGFloat { get { notchY } set { notchY = newValue } }

    func path(in rect: CGRect) -> Path {
        let r = radius, n = notch, k: CGFloat = 0.5523
        let x0 = rect.minX, x1 = rect.maxX, y0 = rect.minY, y1 = rect.maxY
        let ny = min(max(notchY, y0 + r + n), y1 - r - n)
        var p = Path()
        p.move(to: CGPoint(x: x0 + r, y: y0))
        p.addLine(to: CGPoint(x: x1 - r, y: y0))
        p.addCurve(to: CGPoint(x: x1, y: y0 + r), control1: CGPoint(x: x1 - r + r * k, y: y0), control2: CGPoint(x: x1, y: y0 + r - r * k))
        p.addLine(to: CGPoint(x: x1, y: ny - n))
        // right notch, bulging inwards
        p.addCurve(to: CGPoint(x: x1 - n, y: ny), control1: CGPoint(x: x1 - n * k, y: ny - n), control2: CGPoint(x: x1 - n, y: ny - n * k))
        p.addCurve(to: CGPoint(x: x1, y: ny + n), control1: CGPoint(x: x1 - n, y: ny + n * k), control2: CGPoint(x: x1 - n * k, y: ny + n))
        p.addLine(to: CGPoint(x: x1, y: y1 - r))
        p.addCurve(to: CGPoint(x: x1 - r, y: y1), control1: CGPoint(x: x1, y: y1 - r + r * k), control2: CGPoint(x: x1 - r + r * k, y: y1))
        p.addLine(to: CGPoint(x: x0 + r, y: y1))
        p.addCurve(to: CGPoint(x: x0, y: y1 - r), control1: CGPoint(x: x0 + r - r * k, y: y1), control2: CGPoint(x: x0, y: y1 - r + r * k))
        p.addLine(to: CGPoint(x: x0, y: ny + n))
        // left notch
        p.addCurve(to: CGPoint(x: x0 + n, y: ny), control1: CGPoint(x: x0 + n * k, y: ny + n), control2: CGPoint(x: x0 + n, y: ny + n * k))
        p.addCurve(to: CGPoint(x: x0, y: ny - n), control1: CGPoint(x: x0 + n, y: ny - n * k), control2: CGPoint(x: x0 + n * k, y: ny - n))
        p.addLine(to: CGPoint(x: x0, y: y0 + r))
        p.addCurve(to: CGPoint(x: x0 + r, y: y0), control1: CGPoint(x: x0, y: y0 + r - r * k), control2: CGPoint(x: x0 + r - r * k, y: y0))
        p.closeSubpath()
        return p
    }
}

/// Everything except the two notch circles (even-odd), so the pass shadow never fills the cut-outs.
struct NotchMask: Shape {
    var notchY: CGFloat
    var hole: CGFloat = 9
    var animatableData: CGFloat { get { notchY } set { notchY = newValue } }
    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.addRect(rect.insetBy(dx: -140, dy: -140))
        p.addEllipse(in: CGRect(x: rect.minX - hole, y: notchY - hole, width: hole * 2, height: hole * 2))
        p.addEllipse(in: CGRect(x: rect.maxX - hole, y: notchY - hole, width: hole * 2, height: hole * 2))
        return p
    }
}

private struct TopHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

struct ReminderOverlay: View {
    @EnvironmentObject var model: AppModel
    let state: ReminderState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var scheme
    @State private var showCard = false
    @State private var planeProgress: CGFloat = 0
    @State private var holdProgress: CGFloat = 0
    @State private var topHeight: CGFloat = 300

    private var takeover: Bool { model.settings.style == "takeover" }
    private var e: MPEvent { state.event }
    private var visible: Bool { showCard || takeover || reduceMotion }

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                if takeover {
                    PaperBackground()
                    boardBackdrop
                } else {
                    Color.black.opacity(visible ? (scheme == .dark ? 0.5 : 0.32) : 0).ignoresSafeArea()
                }
                pass
                    .padding(.horizontal, 16)
                    .frame(maxWidth: 520)
                    .frame(width: geo.size.width, height: geo.size.height)
                    .offset(y: visible ? 0 : 24)
                    .opacity(visible ? 1 : 0)
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .overlay(alignment: .topLeading) { plane(width: geo.size.width, height: geo.size.height) }
        }
        .onAppear {
            guard !reduceMotion else { showCard = true; return }
            withAnimation(.linear(duration: 4.2)) { planeProgress = 1 }
            guard !takeover else { return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) {
                withAnimation(.spring(response: 0.6, dampingFraction: 0.86)) { showCard = true }
            }
        }
    }

    // MARK: fly-by

    @ViewBuilder private func plane(width: CGFloat, height: CGFloat) -> some View {
        if !reduceMotion {
            TimelineView(.periodic(from: .now, by: 1)) { ctx in
                let ms = e.startDate.timeIntervalSince(ctx.date) * 1000
                let text = takeover ? "" : Core.bannerText(e.title, ms: ms)
                let total = TowedBanner.totalWidth(text)
                TowedBanner(text: text)
                    .fixedSize()
                    .offset(x: -total + (width + total) * planeProgress, y: height * 0.075)
                    .allowsHitTesting(false)
            }
        }
    }

    // MARK: takeover backdrop (a faint departures board)

    private var boardBackdrop: some View {
        let rows = Array(Core.eventsToShow(model.events, settings: model.settings).filter { $0.key != e.key }.prefix(4))
        func row(_ r: MPEvent) -> some View {
            HStack(spacing: 14) {
                Text(Core.boardTime(r.startDate))
                Text(r.title).lineLimit(1)
                Spacer(minLength: 0)
            }
            .font(.mono(14))
        }
        return VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 22) { ForEach(Array(rows.prefix(2))) { row($0) } }
            Spacer(minLength: 0)
            VStack(alignment: .leading, spacing: 22) { ForEach(Array(rows.dropFirst(2))) { row($0) } }
        }
        .foregroundStyle(MP.ink).opacity(0.07)
        .padding(.horizontal, 28).padding(.top, 36).padding(.bottom, 36)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .allowsHitTesting(false)
    }

    // MARK: the boarding pass

    private var pass: some View {
        TimelineView(.periodic(from: .now, by: 0.5)) { ctx in
            let ms = e.startDate.timeIntervalSince(ctx.date) * 1000
            let started = ms <= 0
            VStack(spacing: 0) {
                topPart(started: started)
                    .background(GeometryReader { g in Color.clear.preference(key: TopHeightKey.self, value: g.size.height) })
                bottomPart(ms: ms, started: started)
            }
            .background(alignment: .topLeading) {
                PassShape(notchY: topHeight)
                    .fill(MP.surface)
                    .shadow(color: .black.opacity(scheme == .dark ? 0.55 : 0.28), radius: 28, x: 0, y: 18)
                    // keep the notches clean: no shadow inside the two cut-outs
                    .mask { NotchMask(notchY: topHeight).fill(Color.black, style: FillStyle(eoFill: true)) }
            }
            .overlay(alignment: .topLeading) { PassShape(notchY: topHeight).stroke(MP.line, lineWidth: 1) }
            .overlay(alignment: .topLeading) {
                DashedLine()
                    .stroke(MP.lineStrong, style: StrokeStyle(lineWidth: 1, dash: [3, 4]))
                    .frame(height: 1)
                    .padding(.horizontal, 20)
                    .offset(y: topHeight)
            }
            .onPreferenceChange(TopHeightKey.self) { topHeight = $0 }
        }
    }

    private func field(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label).monoLabel(size: 10.5)
            Text(value).font(.mono(15)).foregroundStyle(MP.ink).lineLimit(1).minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func topPart(started: Bool) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center) {
                Text("MeetingPlz \u{00B7} Boarding pass").monoLabel(size: 10).lineLimit(1).minimumScaleFactor(0.8)
                Spacer(minLength: 8)
                StatusChip(status: started ? .finalCall : .boarding)
            }
            Text(started ? "Final call." : "Your meeting is boarding.")
                .font(.serif(38)).tracking(-0.38).foregroundStyle(MP.ink)
                .lineLimit(1).minimumScaleFactor(0.6)
                .padding(.top, 20)
            Text(e.title)
                .font(.serif(26)).tracking(-0.26).foregroundStyle(MP.ink2)
                .lineLimit(2).fixedSize(horizontal: false, vertical: true)
                .padding(.top, 6)
            VStack(alignment: .leading, spacing: 16) {
                field("Departs", Core.passRange(e))
                HStack(alignment: .top, spacing: 12) {
                    field("Gate", Core.gateLabel(e.link))
                    field("With", Core.withText(e.attendees))
                }
                if let c = e.calendar, !c.isEmpty {
                    HStack(spacing: 10) {
                        Text("From").monoLabel(size: 10.5)
                        Text(c).font(.mono(12)).foregroundStyle(MP.muted).lineLimit(1).truncationMode(.middle)
                    }
                }
            }
            .padding(.top, 20)
        }
        .padding(.horizontal, 22).padding(.top, 22).padding(.bottom, 24)
    }

    private func bottomPart(ms: Double, started: Bool) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(started ? "Late by" : "Boards in").monoLabel(size: 10.5)
            Text(Core.fmtPass(ms))
                .font(.mono(56)).tracking(-1.5)
                .foregroundStyle(started ? MP.accent : MP.ink)
                .lineLimit(1).minimumScaleFactor(0.6)
                .padding(.top, 4)
            PrimaryButton(title: Core.providerLabel(e.link)) { model.join() }
                .padding(.top, 14)
            HStack(spacing: 0) {
                TextButton(title: "I\u{2019}m in") { model.dismissReminder() }
                Spacer(minLength: 4)
                TextButton(title: "Snooze \(model.settings.snoozeSeconds >= 60 ? "\(model.settings.snoozeSeconds / 60) min" : "\(model.settings.snoozeSeconds) sec")") { model.snooze() }
                Spacer(minLength: 4)
                holdToClose
            }
            .padding(.top, 6)
        }
        .padding(.horizontal, 22).padding(.top, 24).padding(.bottom, 16)
    }

    private var holdToClose: some View {
        Text("Hold to close")
            .font(.ui(15, .medium)).foregroundStyle(MP.muted)
            .padding(.bottom, 3)
            .overlay(alignment: .bottomLeading) {
                GeometryReader { g in
                    Rectangle().fill(MP.accent).frame(width: g.size.width * holdProgress, height: 2)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
                }
            }
            .padding(.vertical, 10).padding(.horizontal, 4)
            .contentShape(Rectangle())
            .onLongPressGesture(minimumDuration: 1.0, maximumDistance: 40, perform: {
                model.dismissReminder()
            }, onPressingChanged: { pressing in
                withAnimation(.linear(duration: pressing ? 1.0 : 0.15)) { holdProgress = pressing ? 1 : 0 }
            })
            .accessibilityLabel("Hold to close")
    }
}

private struct DashedLine: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: rect.minX, y: rect.midY))
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
        return p
    }
}
