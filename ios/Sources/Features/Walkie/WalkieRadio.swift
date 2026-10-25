import AVFoundation

/// What makes it sound like a walkie-talkie: a short burst of static as the
/// channel opens, the voice as it was said — no filter on it, the studio's
/// choice after hearing one — and the walkie-talkie's "tit" with a tail of
/// static as it closes. Made here, from noise and a tone, rather than
/// shipped as files — nothing to keep in step, and every press sounds alike.
@MainActor
final class WalkieRadio {
    static let shared = WalkieRadio()

    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private var wired: AVAudioFormat?

    private init() {
        engine.attach(player)
    }

    private func wire(_ format: AVAudioFormat) throws {
        if wired != format {
            engine.stop()
            engine.disconnectNodeOutput(player)
            // Straight to the speaker: the voice is played as it was said.
            engine.connect(player, to: engine.mainMixerNode, format: format)
            wired = format
        }
        if !engine.isRunning {
            engine.prepare()
            try engine.start()
        }
    }

    /// What somebody said, as a radio says it. `done` runs once it has all played.
    func play(file url: URL, done: @escaping @MainActor () -> Void) throws {
        let file = try AVAudioFile(forReading: url)
        let format = file.processingFormat
        try wire(format)
        player.stop()
        player.scheduleBuffer(Self.hiss(format: format, seconds: 0.14, fade: true), completionHandler: nil)
        player.scheduleFile(file, at: nil, completionHandler: nil)
        player.scheduleBuffer(Self.roger(format: format), completionHandler: nil)
        player.scheduleBuffer(Self.hiss(format: format, seconds: 0.14, fade: true)) {
            Task { @MainActor in done() }
        }
        player.play()
    }

    /// The click of the channel opening or closing, on the speaker's own phone.
    func squelch() {
        guard let format = AVAudioFormat(standardFormatWithSampleRate: 22_050, channels: 1) else { return }
        do {
            try wire(format)
            player.scheduleBuffer(Self.hiss(format: format, seconds: 0.16, fade: true), completionHandler: nil)
            player.play()
        } catch {}
    }

    func stop() {
        player.stop()
    }

    // MARK: - The sounds

    /// White noise that falls away: the hiss of an open channel.
    private static func hiss(format: AVAudioFormat, seconds: Double, fade: Bool) -> AVAudioPCMBuffer {
        let frames = AVAudioFrameCount(format.sampleRate * seconds)
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames)!
        buffer.frameLength = frames
        for channel in 0..<Int(format.channelCount) {
            guard let data = buffer.floatChannelData?[channel] else { continue }
            for frame in 0..<Int(frames) {
                let progress = Float(frame) / Float(frames)
                let envelope: Float = fade ? (1 - progress) * (1 - progress) : 1
                data[frame] = Float.random(in: -1...1) * 0.32 * envelope
            }
        }
        return buffer
    }

    /// The "roger" beep: a short, square-ish tone at the end of a transmission.
    private static func roger(format: AVAudioFormat) -> AVAudioPCMBuffer {
        let seconds = 0.12
        let frames = AVAudioFrameCount(format.sampleRate * seconds)
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames)!
        buffer.frameLength = frames
        let frequency = 1_250.0
        for channel in 0..<Int(format.channelCount) {
            guard let data = buffer.floatChannelData?[channel] else { continue }
            for frame in 0..<Int(frames) {
                let phase = sin(2 * .pi * frequency * Double(frame) / format.sampleRate)
                let edge = min(1, Double(min(frame, Int(frames) - frame)) / 120)
                data[frame] = Float((phase >= 0 ? 1 : -1) * 0.22 * edge)
            }
        }
        return buffer
    }
}
