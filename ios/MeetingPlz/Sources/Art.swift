import SwiftUI

/// Side-view airliner, single-weight line art. Drawn in a 200 x 80 box and scaled to rect.
struct PlaneShape: Shape {
    func path(in rect: CGRect) -> Path {
        let sx = rect.width / 200, sy = rect.height / 80
        func P(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: rect.minX + x * sx, y: rect.minY + y * sy) }
        var p = Path()
        // fuselage + tail fin
        p.move(to: P(12, 10))
        p.addLine(to: P(32, 10))
        p.addLine(to: P(62, 33))
        p.addCurve(to: P(160, 31), control1: P(95, 31), control2: P(130, 30))
        p.addCurve(to: P(194, 43), control1: P(178, 32), control2: P(190, 37))
        p.addCurve(to: P(168, 53), control1: P(194, 49), control2: P(184, 53))
        p.addLine(to: P(52, 53))
        p.addCurve(to: P(20, 36), control1: P(34, 53), control2: P(24, 46))
        p.closeSubpath()
        // wing
        p.move(to: P(110, 41))
        p.addLine(to: P(78, 70))
        p.addLine(to: P(98, 70))
        p.addLine(to: P(146, 42))
        // engine
        p.addRoundedRect(in: CGRect(x: rect.minX + 112 * sx, y: rect.minY + 56 * sy, width: 26 * sx, height: 10 * sy), cornerSize: CGSize(width: 5 * sx, height: 5 * sy))
        // windows
        var x: CGFloat = 70
        while x <= 150 {
            p.addEllipse(in: CGRect(x: rect.minX + (x - 2) * sx, y: rect.minY + 38 * sy, width: 4 * sx, height: 4 * sy))
            x += 11
        }
        return p
    }
}

struct PlaneView: View {
    var color: Color = MP.ink
    var body: some View {
        PlaneShape()
            .stroke(color, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
            .aspectRatio(200.0 / 80.0, contentMode: .fit)
    }
}

/// Banner of outlined letter tiles towed by a rope.
struct BannerTiles: View {
    var text: String
    var tile: CGFloat = 22
    var body: some View {
        HStack(spacing: 3) {
            ForEach(Array(text.enumerated()), id: \.offset) { _, ch in
                if ch == " " {
                    Color.clear.frame(width: tile * 0.5, height: tile * 1.2)
                } else {
                    Text(String(ch))
                        .font(.system(size: tile * 0.62, weight: .heavy))
                        .foregroundStyle(MP.ink)
                        .frame(width: tile, height: tile * 1.2)
                        .background(MP.paper)
                        .overlay(RoundedRectangle(cornerRadius: 3).stroke(MP.ink, lineWidth: 1.5))
                }
            }
        }
    }
    static func width(for text: String, tile: CGFloat = 22) -> CGFloat {
        text.reduce(0) { $0 + ($1 == " " ? tile * 0.5 : tile) + 3 }
    }
}

/// Plane pulling the banner. Nose points right; banner trails on the left.
struct TowedBanner: View {
    var text: String
    var planeWidth: CGFloat = 120
    var tile: CGFloat = 22
    static func totalWidth(_ text: String, planeWidth: CGFloat = 120, tile: CGFloat = 22) -> CGFloat {
        BannerTiles.width(for: text, tile: tile) + 26 + planeWidth
    }
    var body: some View {
        HStack(spacing: 0) {
            BannerTiles(text: text, tile: tile)
            Rectangle().fill(MP.ink).frame(width: 26, height: 1.5)
            PlaneView().frame(width: planeWidth)
        }
    }
}

struct CalendarCheckShape: Shape {
    func path(in rect: CGRect) -> Path {
        let w = rect.width, h = rect.height
        var p = Path()
        p.addRoundedRect(in: CGRect(x: rect.minX + w * 0.08, y: rect.minY + h * 0.16, width: w * 0.84, height: h * 0.76), cornerSize: CGSize(width: w * 0.1, height: w * 0.1))
        p.move(to: CGPoint(x: rect.minX + w * 0.08, y: rect.minY + h * 0.38))
        p.addLine(to: CGPoint(x: rect.minX + w * 0.92, y: rect.minY + h * 0.38))
        p.move(to: CGPoint(x: rect.minX + w * 0.3, y: rect.minY + h * 0.06))
        p.addLine(to: CGPoint(x: rect.minX + w * 0.3, y: rect.minY + h * 0.26))
        p.move(to: CGPoint(x: rect.minX + w * 0.7, y: rect.minY + h * 0.06))
        p.addLine(to: CGPoint(x: rect.minX + w * 0.7, y: rect.minY + h * 0.26))
        p.move(to: CGPoint(x: rect.minX + w * 0.3, y: rect.minY + h * 0.65))
        p.addLine(to: CGPoint(x: rect.minX + w * 0.45, y: rect.minY + h * 0.78))
        p.addLine(to: CGPoint(x: rect.minX + w * 0.72, y: rect.minY + h * 0.52))
        return p
    }
}

struct CalendarCheckView: View {
    var body: some View {
        CalendarCheckShape()
            .stroke(MP.ink, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
            .aspectRatio(1, contentMode: .fit)
    }
}
