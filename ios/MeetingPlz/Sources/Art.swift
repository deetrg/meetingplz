import SwiftUI

/// Minimal SVG path-data parser (M m L l H h V v C c Z z), enough for shared/art/*.svg and the Google "G".
enum SVGPath {
    private struct Scanner {
        let c: [Character]
        var i = 0
        init(_ s: String) { c = Array(s) }
        mutating func skipSep() { while i < c.count, c[i] == " " || c[i] == "," || c[i] == "\n" || c[i] == "\t" { i += 1 } }
        var atEnd: Bool { i >= c.count }
        mutating func number() -> CGFloat? {
            skipSep()
            guard i < c.count else { return nil }
            var s = ""
            var dot = false
            if c[i] == "-" || c[i] == "+" { s.append(c[i]); i += 1 }
            while i < c.count {
                let ch = c[i]
                if ch.isASCII && ch.isNumber { s.append(ch) }
                else if ch == "." && !dot { dot = true; s.append(ch) }
                else { break }
                i += 1
            }
            guard let d = Double(s) else { return nil }
            return CGFloat(d)
        }
    }

    static func path(_ d: String) -> Path {
        var p = Path()
        var sc = Scanner(d)
        var cur = CGPoint.zero, start = CGPoint.zero
        var cmd: Character = "M"
        while true {
            sc.skipSep()
            if sc.atEnd { break }
            let ch = sc.c[sc.i]
            if ch.isLetter {
                cmd = ch; sc.i += 1
                if cmd == "Z" || cmd == "z" { p.closeSubpath(); cur = start; continue }
            }
            let rel = cmd.isLowercase
            func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint { rel ? CGPoint(x: cur.x + x, y: cur.y + y) : CGPoint(x: x, y: y) }
            switch cmd {
            case "M", "m":
                guard let x = sc.number(), let y = sc.number() else { return p }
                cur = pt(x, y); start = cur; p.move(to: cur)
                cmd = rel ? "l" : "L"
            case "L", "l":
                guard let x = sc.number(), let y = sc.number() else { return p }
                cur = pt(x, y); p.addLine(to: cur)
            case "H", "h":
                guard let x = sc.number() else { return p }
                cur = CGPoint(x: rel ? cur.x + x : x, y: cur.y); p.addLine(to: cur)
            case "V", "v":
                guard let y = sc.number() else { return p }
                cur = CGPoint(x: cur.x, y: rel ? cur.y + y : y); p.addLine(to: cur)
            case "C", "c":
                guard let x1 = sc.number(), let y1 = sc.number(), let x2 = sc.number(), let y2 = sc.number(), let x = sc.number(), let y = sc.number() else { return p }
                let c1 = pt(x1, y1), c2 = pt(x2, y2), e = pt(x, y)
                p.addCurve(to: e, control1: c1, control2: c2)
                cur = e
            default:
                return p
            }
        }
        return p
    }
}

private enum ArtFill { case none, surface, accent }

private struct ArtLayer {
    var path: Path
    var fill: ArtFill = .none
    var stroke = true
    var width: CGFloat = 1.75
    var dash: [CGFloat] = []
    var t: CGAffineTransform = .identity
    var k: CGFloat = 1   // scale applied to the stroke width (SVG group transforms scale strokes too)
}

private func planeLayers(t: CGAffineTransform = .identity, k: CGFloat = 1) -> [ArtLayer] {
    var rect = Path()
    rect.addRoundedRect(in: CGRect(x: 112, y: 69, width: 36, height: 14), cornerSize: CGSize(width: 7, height: 7))
    return [
        ArtLayer(path: SVGPath.path("M66 40 L36 8 L16 8 L32 40 Z"), fill: .surface, t: t, k: k),
        ArtLayer(path: SVGPath.path("M19.6 13.6 L38.8 13.6 L45.4 21.4 L23.2 21.4 Z"), fill: .accent, stroke: false, t: t, k: k),
        ArtLayer(path: SVGPath.path("M60 56 L35 65 L51 65 L82 57 Z"), fill: .surface, t: t, k: k),
        ArtLayer(path: SVGPath.path("M100 61 L66 91 L92 91 L154 61 Z"), fill: .surface, t: t, k: k),
        ArtLayer(path: SVGPath.path("M27 38 L170 38 C198 38 222 46 232 54 C222 62 204 66 176 66 L84 66 C57 66 38 54 23 44 C20.5 42.2 22.5 39 27 38 Z"), fill: .surface, t: t, k: k),
        ArtLayer(path: rect, fill: .surface, t: t, k: k),
        ArtLayer(path: SVGPath.path("M120 72.5 v6"), t: t, k: k),
        ArtLayer(path: SVGPath.path("M186 44 L202 44 L212 50"), t: t, k: k),
        ArtLayer(path: SVGPath.path("M56 53 h.01 M72 53 h.01 M88 53 h.01 M104 53 h.01 M120 53 h.01 M136 53 h.01 M152 53 h.01"), width: 4.2, t: t, k: k),
    ]
}

private let cloudD = "M0 0 H112 C128 0 138 -11 138 -24 C138 -37 127 -47 113 -47 C110 -62 97 -73 81 -73 C65 -73 53 -64 49 -51 C45 -53 40 -54 35 -54 C20 -54 9 -43 9 -29 C3 -26 -4 -18 -4 -9 C-4 -3 -2 0 0 0 Z"

private func cloudsLayers() -> [ArtLayer] {
    let planeT = CGAffineTransform(translationX: 94, y: 14).scaledBy(x: 0.62, y: 0.62)
    var l = planeLayers(t: planeT, k: 0.62)
    l.append(ArtLayer(path: SVGPath.path("M20 74 H80"), width: 2.4, dash: [1, 7]))
    l.append(ArtLayer(path: SVGPath.path("M34 88 H70"), width: 2.4, dash: [1, 7]))
    l.append(ArtLayer(path: SVGPath.path(cloudD), fill: .surface, t: CGAffineTransform(translationX: 176, y: 124).scaledBy(x: 0.78, y: 0.78), k: 0.78))
    l.append(ArtLayer(path: SVGPath.path(cloudD), fill: .surface, t: CGAffineTransform(translationX: 34, y: 168).scaledBy(x: 1.1, y: 1.1), k: 1.1))
    return l
}

private struct LineArt: View {
    let viewBox: CGSize
    let layers: [ArtLayer]
    var ink: Color = MP.ink
    var body: some View {
        Canvas { ctx, size in
            let s = min(size.width / viewBox.width, size.height / viewBox.height)
            let ox = (size.width - viewBox.width * s) / 2, oy = (size.height - viewBox.height * s) / 2
            for l in layers {
                let p = l.path.applying(l.t)
                let q = p.applying(CGAffineTransform(translationX: ox, y: oy).scaledBy(x: s, y: s))
                switch l.fill {
                case .none: break
                case .surface: ctx.fill(q, with: .color(MP.surface))
                case .accent: ctx.fill(q, with: .color(MP.accent))
                }
                if l.stroke {
                    // keep hairlines visible when the art is small
                    let w = max(l.width * l.k * s, 1.15 * (l.width / 1.75).squareRoot())
                    ctx.stroke(q, with: .color(ink), style: StrokeStyle(lineWidth: w, lineCap: .round, lineJoin: .round, dash: l.dash.map { $0 * s }))
                }
            }
        }
        .aspectRatio(viewBox.width / viewBox.height, contentMode: .fit)
        .accessibilityHidden(true)
    }
}

/// Refined line-art plane with the accent tail stripe (shared/art/plane.svg).
struct PlaneArt: View {
    var body: some View { LineArt(viewBox: CGSize(width: 240, height: 100), layers: planeLayers()) }
}

/// Plane over two clouds (shared/art/clouds.svg).
struct CloudsArt: View {
    var body: some View { LineArt(viewBox: CGSize(width: 320, height: 190), layers: cloudsLayers()) }
}

// MARK: fly-by banner

/// Banner of split-flap tiles (surface background, ink mono letters, hairline middle split).
struct BannerTiles: View {
    var text: String
    var tile: CGFloat = 20
    var body: some View {
        HStack(spacing: 3) {
            ForEach(Array(text.enumerated()), id: \.offset) { _, ch in
                if ch == " " {
                    Color.clear.frame(width: tile * 0.45, height: tile * 1.3)
                } else {
                    Text(String(ch))
                        .font(.mono(tile * 0.62, weight: .medium))
                        .foregroundStyle(MP.ink)
                        .frame(width: tile, height: tile * 1.3)
                        .background(MP.surface)
                        .overlay(Rectangle().fill(MP.line).frame(height: 1))
                        .overlay(RoundedRectangle(cornerRadius: 3).stroke(MP.lineStrong, lineWidth: 1))
                        .clipShape(RoundedRectangle(cornerRadius: 3))
                }
            }
        }
    }
    static func width(for text: String, tile: CGFloat = 20) -> CGFloat {
        text.reduce(0) { $0 + ($1 == " " ? tile * 0.45 : tile) + 3 }
    }
}

/// Plane pulling the banner. Nose points right; banner trails on the left. An empty text draws the plane alone.
struct TowedBanner: View {
    var text: String
    var planeWidth: CGFloat = 130
    var tile: CGFloat = 20
    static func totalWidth(_ text: String, planeWidth: CGFloat = 130, tile: CGFloat = 20) -> CGFloat {
        text.isEmpty ? planeWidth : BannerTiles.width(for: text, tile: tile) + 26 + planeWidth
    }
    var body: some View {
        HStack(spacing: 0) {
            if !text.isEmpty {
                BannerTiles(text: text, tile: tile)
                Rectangle().fill(MP.ink).frame(width: 26, height: 1)
            }
            PlaneArt().frame(width: planeWidth)
        }
    }
}

// MARK: empty state

struct EmptyState: View {
    var title = "Clear skies."
    var subtitle = "No meetings in the next 24 hours."
    var body: some View {
        VStack(spacing: 0) {
            CloudsArt().frame(width: 230).padding(.bottom, 16)
            Text(title).font(.serif(30)).tracking(-0.3).foregroundStyle(MP.ink)
            Text(subtitle).font(.ui(15)).foregroundStyle(MP.muted).multilineTextAlignment(.center).padding(.top, 8)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40).padding(.horizontal, 16)
    }
}
