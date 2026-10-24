import SwiftUI
import UIKit

enum MP {
    private static func dyn(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(uiColor: UIColor { t in
            let v = t.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: CGFloat((v >> 16) & 0xFF) / 255, green: CGFloat((v >> 8) & 0xFF) / 255, blue: CGFloat(v & 0xFF) / 255, alpha: 1)
        })
    }
    static let paper = dyn(0xFFFFFF, 0x0E0E0E)
    static let ink = dyn(0x111111, 0xF5F5F5)
    static let soft = dyn(0xF2F2F2, 0x1C1C1C)
    static let muted = dyn(0x6B6B6B, 0xA0A0A0)
    static let line: CGFloat = 2
    static let radius: CGFloat = 20
}

struct PillButtonStyle: ButtonStyle {
    var primary: Bool = true
    var big: Bool = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: big ? 19 : 16, weight: .bold))
            .foregroundStyle(primary ? MP.paper : MP.ink)
            .frame(maxWidth: .infinity)
            .padding(.vertical, big ? 18 : 14)
            .background(Capsule().fill(primary ? MP.ink : MP.paper))
            .overlay(Capsule().stroke(MP.ink, lineWidth: MP.line))
            .opacity(configuration.isPressed ? 0.8 : 1)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
    }
}

struct OutlineCard: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(16)
            .background(RoundedRectangle(cornerRadius: MP.radius).fill(MP.paper))
            .overlay(RoundedRectangle(cornerRadius: MP.radius).stroke(MP.ink, lineWidth: MP.line))
    }
}
extension View { func outlineCard() -> some View { modifier(OutlineCard()) } }

extension Font {
    static func mpHead(_ size: CGFloat) -> Font { .system(size: size, weight: .heavy) }
}
