import SwiftUI

// MARK: segmented control

/// Mono labels split by hairlines. Selected = ink text + 2 pt accent underline; unselected = muted. No pill backgrounds.
struct Segmented<V: Hashable>: View {
    let options: [(V, String)]
    @Binding var selection: V
    var stretch = true

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(options.enumerated()), id: \.offset) { i, o in
                let on = o.0 == selection
                Button {
                    if !on { selection = o.0 }
                } label: {
                    Text(o.1)
                        .font(.mono(12, weight: on ? .medium : .regular))
                        .foregroundStyle(on ? MP.ink : MP.muted)
                        .lineLimit(1).fixedSize()
                        .padding(.vertical, 11)
                        .overlay(alignment: .bottom) {
                            if on { Rectangle().fill(MP.accent).frame(height: 2).clipShape(RoundedRectangle(cornerRadius: 1)) }
                        }
                        .padding(.leading, stretch ? 0 : (i == 0 ? 0 : 14))
                        .padding(.trailing, stretch ? 0 : 14)
                        .frame(maxWidth: stretch ? .infinity : nil)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(o.1)
                .accessibilityAddTraits(on ? .isSelected : [])
                if i < options.count - 1 {
                    Rectangle().fill(MP.line).frame(width: 1, height: 14)
                }
            }
        }
    }
}

// MARK: rows

/// Settings row: label (+ small description) on top, control underneath, hairline below, no outer box.
struct SettingRow<Control: View>: View {
    let title: String
    var detail: String? = nil
    @ViewBuilder var control: () -> Control
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.ui(15, .medium)).foregroundStyle(MP.ink)
                if let detail { Text(detail).font(.ui(13)).foregroundStyle(MP.muted) }
            }
            control()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 14)
        .overlay(alignment: .bottom) { Hairline() }
    }
}

/// Simple label-left, value-right row (52 pt).
struct ValueRow: View {
    let title: String
    let value: String
    var body: some View {
        HStack {
            Text(title).font(.ui(15, .medium)).foregroundStyle(MP.ink)
            Spacer()
            Text(value).font(.mono(13)).foregroundStyle(MP.muted)
        }
        .frame(minHeight: 52)
        .overlay(alignment: .bottom) { Hairline() }
    }
}

// MARK: status chip

enum FlightStatus {
    case onTime, boarding, finalCall

    static func of(_ e: MPEvent, now: Date, lead: Int) -> FlightStatus {
        let s = e.startDate.timeIntervalSince(now)
        if s <= 0 { return .finalCall }
        if s <= TimeInterval(lead) { return .boarding }
        return .onTime
    }
    var label: String {
        switch self { case .onTime: "On time"; case .boarding: "Boarding"; case .finalCall: "Final call" }
    }
}

/// Mono 10.5 pt uppercase with a 6 pt dot. ON TIME (ink dot), BOARDING (accent dot, pulsing 2 s), FINAL CALL (accent text).
struct StatusChip: View {
    let status: FlightStatus
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse = false

    var body: some View {
        let accent = status != .onTime
        HStack(spacing: 7) {
            ZStack {
                if status == .boarding && !reduceMotion {
                    Circle().fill(MP.accentSoft).frame(width: 6, height: 6).scaleEffect(pulse ? 2.6 : 1).opacity(pulse ? 0 : 1)
                }
                Circle().fill(accent ? MP.accent : MP.ink).frame(width: 6, height: 6).opacity(status == .boarding && pulse ? 0.55 : 1)
            }
            .frame(width: 6, height: 6)
            Text(status.label).font(.mono(10.5)).tracking(10.5 * 0.08).textCase(.uppercase)
                .foregroundStyle(status == .finalCall ? MP.accent : MP.ink)
                .lineLimit(1).fixedSize()
        }
        .padding(.horizontal, 9).frame(height: 24)
        .overlay(RoundedRectangle(cornerRadius: MP.rChip).stroke(status == .finalCall ? MP.accent : MP.lineStrong, lineWidth: 1))
        .onAppear {
            guard status == .boarding, !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 1.0).repeatForever(autoreverses: true)) { pulse = true }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(status.label)
    }
}

// MARK: Google sign-in button (Google branding)

struct GoogleG: View {
    private static let layers: [(String, UInt32)] = [
        ("M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z", 0xEA4335),
        ("M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z", 0x4285F4),
        ("M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z", 0xFBBC05),
        ("M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z", 0x34A853),
    ]
    private static let paths: [(Path, Color)] = layers.map { (SVGPath.path($0.0), Color(red: Double(($0.1 >> 16) & 255) / 255, green: Double(($0.1 >> 8) & 255) / 255, blue: Double($0.1 & 255) / 255)) }
    var body: some View {
        Canvas { ctx, size in
            let s = min(size.width, size.height) / 48
            for (p, c) in GoogleG.paths { ctx.fill(p.applying(CGAffineTransform(scaleX: s, y: s)), with: .color(c)) }
        }
        .frame(width: 20, height: 20)
        .accessibilityHidden(true)
    }
}

/// White surface + 1 pt #747775 border, 4-colour G, "Continue with Google". Dark: #131314 / #8E918F.
struct GoogleSignInButton: View {
    var loading = false
    let action: () -> Void
    @Environment(\.colorScheme) private var scheme
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        let dark = scheme == .dark
        let bg = dark ? Color(red: 0x13 / 255, green: 0x13 / 255, blue: 0x14 / 255) : Color.white
        let border = dark ? Color(red: 0x8E / 255, green: 0x91 / 255, blue: 0x8F / 255) : Color(red: 0x74 / 255, green: 0x77 / 255, blue: 0x75 / 255)
        let text = dark ? Color(red: 0xE3 / 255, green: 0xE3 / 255, blue: 0xE3 / 255) : Color(red: 0x1F / 255, green: 0x1F / 255, blue: 0x1F / 255)
        Button(action: action) {
            HStack(spacing: 12) {
                if loading { ProgressView().tint(text) } else {
                    GoogleG()
                    Text("Continue with Google").font(.ui(15.5, .medium)).foregroundStyle(text)
                }
            }
            .frame(maxWidth: .infinity).frame(height: 52)
            .background(RoundedRectangle(cornerRadius: MP.rBtn, style: .continuous).fill(bg))
            .overlay(RoundedRectangle(cornerRadius: MP.rBtn, style: .continuous).stroke(border, lineWidth: 1))
            .opacity(isEnabled ? 1 : 0.4)
        }
        .buttonStyle(PressScale())
        .accessibilityLabel("Continue with Google")
    }
}

// MARK: passport stamp (account chip)

/// Email in mono inside a 1 pt dashed rounded rect. Swipe left to reveal Remove (only when `onRemove` is set).
struct PassportStamp: View {
    let email: String
    var tag: String? = nil
    var tagAccent = false
    var onRemove: (() -> Void)? = nil
    @State private var offset: CGFloat = 0
    @State private var base: CGFloat = 0
    private let reveal: CGFloat = 92

    var body: some View {
        ZStack(alignment: .trailing) {
            if let onRemove {
                Button {
                    withAnimation(.easeOut(duration: 0.2)) { offset = 0 }
                    base = 0
                    onRemove()
                } label: {
                    Text("Remove").font(.mono(12, weight: .medium)).foregroundStyle(MP.accent)
                        .frame(width: reveal - 8, height: 44)
                }
                .buttonStyle(.plain)
                .opacity(offset < -8 ? 1 : 0)
            }
            HStack(spacing: 10) {
                Text(email).font(.mono(14)).foregroundStyle(MP.ink).lineLimit(1).truncationMode(.middle)
                Spacer(minLength: 8)
                if let tag { Text(tag).monoLabel(size: 10, color: tagAccent ? MP.accent : MP.muted).lineLimit(1).fixedSize() }
            }
            .padding(.horizontal, 14).frame(height: 44)
            .background(RoundedRectangle(cornerRadius: 8).fill(MP.paper.opacity(0.001)))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(MP.lineStrong, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
            .offset(x: offset)
            .gesture(
                DragGesture(minimumDistance: 16)
                    .onChanged { g in
                        guard onRemove != nil, abs(g.translation.width) > abs(g.translation.height) else { return }
                        offset = max(-reveal, min(0, base + g.translation.width))
                    }
                    .onEnded { g in
                        guard onRemove != nil else { return }
                        let open = (base + g.translation.width) < -reveal / 2
                        withAnimation(.easeOut(duration: 0.2)) { offset = open ? -reveal : 0 }
                        base = open ? -reveal : 0
                    }
            )
        }
        .accessibilityElement(children: .combine)
        .accessibilityActions { if let onRemove { Button("Remove account", action: onRemove) } }
    }
}
