import Foundation
import AVFoundation

/// Synthesised alarms (no audio files). Repeats every 6 s while active.
@MainActor
final class AlarmPlayer {
    static let shared = AlarmPlayer()
    private var player: AVAudioPlayer?
    private var timer: Timer?

    func start(kind: String) {
        stop()
        guard kind != "off" else { return }
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.duckOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
        let data = AlarmPlayer.wav(kind: kind)
        player = try? AVAudioPlayer(data: data)
        player?.prepareToPlay()
        player?.play()
        timer = Timer.scheduledTimer(withTimeInterval: 6, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.player?.currentTime = 0; self?.player?.play() }
        }
    }

    func stop() {
        timer?.invalidate(); timer = nil
        player?.stop(); player = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    nonisolated static func wav(kind: String) -> Data {
        let rate = 22050.0
        var s: [Float] = []
        func tone(_ f: Double, _ dur: Double, vol: Float = 0.5, square: Bool = false, decay: Bool = true, harmonics: [(Double, Float)] = []) {
            let n = Int(dur * rate)
            for i in 0..<n {
                let t = Double(i) / rate
                var v = square ? (sin(2 * .pi * f * t) >= 0 ? 0.6 : -0.6) : sin(2 * .pi * f * t)
                for (m, a) in harmonics { v += Double(a) * sin(2 * .pi * f * m * t) }
                let attack = min(1.0, t / 0.005)
                let env = decay ? exp(-3.0 * t / dur) : 1.0
                let tail = min(1.0, (dur - t) / 0.01)
                s.append(Float(v) * vol * Float(attack * env * tail))
            }
        }
        func gap(_ d: Double) { s.append(contentsOf: [Float](repeating: 0, count: Int(d * rate))) }
        switch kind {
        case "buzz": for _ in 0..<3 { tone(190, 0.28, vol: 0.45, square: true, decay: false); gap(0.1) }
        case "bell": tone(880, 1.6, vol: 0.4, harmonics: [(2.4, 0.5), (3.9, 0.25)])
        case "beep": for _ in 0..<3 { tone(1000, 0.12, vol: 0.45, decay: false); gap(0.1) }
        default: for f in [523.25, 659.25, 783.99, 1046.5] { tone(f, 0.17, vol: 0.45, harmonics: [(2, 0.3)]) }
        }
        var pcm = Data()
        for v in s { var x = Int16(max(-1, min(1, v)) * 32000).littleEndian; pcm.append(Data(bytes: &x, count: 2)) }
        var h = Data()
        func u32(_ v: UInt32) { var x = v.littleEndian; h.append(Data(bytes: &x, count: 4)) }
        func u16(_ v: UInt16) { var x = v.littleEndian; h.append(Data(bytes: &x, count: 2)) }
        h.append("RIFF".data(using: .ascii)!); u32(UInt32(36 + pcm.count)); h.append("WAVEfmt ".data(using: .ascii)!)
        u32(16); u16(1); u16(1); u32(UInt32(rate)); u32(UInt32(rate) * 2); u16(2); u16(16)
        h.append("data".data(using: .ascii)!); u32(UInt32(pcm.count))
        return h + pcm
    }
}
