import SwiftUI
import UIKit

/// MeetingPlz design v2 ("Final call"). Source of truth: DESIGN.md and shared/design/tokens.css.
/// Colours live in Assets.xcassets (light + dark), fonts are bundled (UIAppFonts), never loaded at runtime from the web.
enum MP {
    static let paper = Color("Paper")
    static let surface = Color("Surface")
    static let ink = Color("Ink")
    static let ink2 = Color("Ink2")
    static let muted = Color("Muted")
    static let line = Color("Line")
    static let lineStrong = Color("LineStrong")
    static let accent = Color("Accent")
    static let accentSoft = Color("AccentSoft")

    static let rChip: CGFloat = 6
    static let rBtn: CGFloat = 12
    static let rCard: CGFloat = 18
    static let pad: CGFloat = 20
}

// MARK: fonts

extension Font {
    /// Instrument Serif (display).
    static func serif(_ size: CGFloat, italic: Bool = false) -> Font {
        .custom(italic ? "InstrumentSerif-Italic" : "InstrumentSerif-Regular", fixedSize: size)
    }
    /// Geist Mono (400 or 500).
    static func mono(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .custom(weight == .medium || weight == .semibold || weight == .bold ? "GeistMono-Medium" : "GeistMono-Regular", fixedSize: size)
    }
    static func ui(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font { .system(size: size, weight: weight) }
}

extension View {
    /// Mono label: 11 pt, uppercase, tracking .09em, muted.
    func monoLabel(size: CGFloat = 11, color: Color = MP.muted) -> some View {
        self.font(.mono(size)).tracking(size * 0.09).textCase(.uppercase).foregroundStyle(color)
    }
}

// MARK: paper grain

private struct SplitMix64: RandomNumberGenerator {
    var state: UInt64
    mutating func next() -> UInt64 {
        state &+= 0x9E3779B97F4A7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58476D1CE4E5B9
        z = (z ^ (z >> 27)) &* 0x94D049BB133111EB
        return z ^ (z >> 31)
    }
}

enum Grain {
    /// Tiled noise, generated once. 3.5 % opacity (5 % in dark) with multiply (screen in dark), see tokens.css.
    static let image: UIImage = {
        let n = 192
        var rng = SplitMix64(state: 7)
        var px = [UInt8](repeating: 0, count: n * n)
        for i in 0..<px.count { px[i] = UInt8(truncatingIfNeeded: rng.next() >> 56) }
        let cs = CGColorSpaceCreateDeviceGray()
        guard let provider = CGDataProvider(data: Data(px) as CFData),
              let cg = CGImage(width: n, height: n, bitsPerComponent: 8, bitsPerPixel: 8, bytesPerRow: n, space: cs,
                               bitmapInfo: CGBitmapInfo(rawValue: 0), provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)
        else { return UIImage() }
        return UIImage(cgImage: cg, scale: 3, orientation: .up)
    }()
}

/// Paper colour plus the grain layer. Used as the page background, never inside the reminder pass.
struct PaperBackground: View {
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        ZStack {
            MP.paper
            Image(uiImage: Grain.image)
                .resizable(resizingMode: .tile)
                .opacity(scheme == .dark ? 0.05 : 0.035)
                .blendMode(scheme == .dark ? .screen : .multiply)
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }
}

// MARK: wordmark

/// "Meeting" serif + "Plz" italic + small accent dot.
struct Wordmark: View {
    var size: CGFloat = 26
    var body: some View {
        HStack(alignment: .lastTextBaseline, spacing: 0) {
            Text("Meeting").font(.serif(size))
            Text("Plz").font(.serif(size, italic: true))
            Circle().fill(MP.accent).frame(width: size * 0.2, height: size * 0.2)
                .padding(.leading, size * 0.08).padding(.bottom, size * 0.12)
        }
        .tracking(-0.01 * size)
        .foregroundStyle(MP.ink)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("MeetingPlz")
    }
}

// MARK: buttons

struct PressScale: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.scaleEffect(configuration.isPressed ? 0.98 : 1).animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    var arrow: Bool = true
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 10) {
            configuration.label.font(.ui(16, .semibold))
            if arrow { Image(systemName: "arrow.right").font(.system(size: 15, weight: .medium)) }
        }
        .foregroundStyle(MP.paper)
        .frame(maxWidth: .infinity).frame(height: 52)
        .background(RoundedRectangle(cornerRadius: MP.rBtn, style: .continuous).fill(configuration.isPressed ? MP.ink2 : MP.ink))
        .scaleEffect(configuration.isPressed ? 0.98 : 1)
        .opacity(isEnabled ? 1 : 0.4)
        .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

/// Ink button, radius 12, height 52, trailing arrow.
struct PrimaryButton: View {
    let title: String
    var arrow: Bool = true
    let action: () -> Void
    var body: some View {
        Button(action: action) { Text(title) }.buttonStyle(PrimaryButtonStyle(arrow: arrow))
    }
}

/// No box. Label in sans 500, optional underline.
struct TextButton: View {
    let title: String
    var muted: Bool = false
    var underline: Bool = false
    var tint: Color? = nil
    let action: () -> Void
    var body: some View {
        let c = tint ?? (muted ? MP.muted : MP.ink)
        Button(action: action) {
            Text(title).font(.ui(15, .medium)).underline(underline, color: c)
                .foregroundStyle(c)
                .padding(.vertical, 10).padding(.horizontal, 4).contentShape(Rectangle())
        }
        .buttonStyle(PressScale())
    }
}

struct Hairline: View {
    var strong = false
    var body: some View { Rectangle().fill(strong ? MP.lineStrong : MP.line).frame(height: 1) }
}
