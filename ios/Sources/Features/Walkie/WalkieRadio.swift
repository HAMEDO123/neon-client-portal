import AVFoundation

/// What makes it sound like a walkie-talkie, asked for in so many words ("like
/// a military radio"): a burst of static as the channel opens, the voice
/// through a radio's narrow band with a little grit, and a tail of static as it
/// closes. No beep: the studio wanted the hiss of the radio and nothing that
/// sounds like a patrol car's tone. Made here, from noise and a tone, rather than
/// shipped as files — nothing to keep in step, and every press sounds alike.
@MainActor
final class WalkieRadio {
    static let shared = WalkieRadio()

    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let band = AVAudioUnitEQ(numberOfBands: 2)
    private let grit = AVAudioUnitDistortion()
    private var wired: AVAudioFormat?

    private init() {
        // A radio's band: nothing below ~350 Hz, nothing above ~3.2 kHz.
        let low = band.bands[0]
        low.filterType = .highPass
        low.frequency = 350
        low.bypass = false
        let high = band.bands[1]
        high.filterType = .lowPass
        high.frequency = 3200
        high.bypass = false
        grit.loadFactoryPreset(.speechRadioTower)
        grit.wetDryMix = 32
        engine.attach(player)
        engine.attach(band)
        engine.attach(grit)
    }

    private func wire(_ format: AVAudioFormat) throws {
        if wired != format {
            engine.stop()
            engine.disconnectNodeOutput(player)
            engine.disconnectNodeOutput(band)
            engine.disconnectNodeOutput(grit)
            engine.connect(player, to: band, format: format)
            engine.connect(band, to: grit, format: format)
            engine.connect(grit, to: engine.mainMixerNode, format: format)
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
        player.scheduleBuffer(Self.hiss(format: format, seconds: 0.22, fade: true), completionHandler: nil)
        player.scheduleFile(file, at: nil, completionHandler: nil)
        player.scheduleBuffer(Self.hiss(format: format, seconds: 0.18, fade: true)) {
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
}
