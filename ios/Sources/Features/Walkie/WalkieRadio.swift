import AVFoundation

/// What makes it sound like a walkie-talkie, asked for in so many words ("like
/// a military radio", then "like the police's"): the police radio's talk-permit
/// chirp as the channel opens — on the speaker's phone as they press, and on
/// the listener's before the voice — the voice through a radio's narrow band
/// with a little grit, and the roger beep, the data burst ("brrrt") and a tail
/// of static as it closes. Made here, from noise and a tone, rather than
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
        player.scheduleBuffer(Self.hiss(format: format, seconds: 0.12, fade: true), completionHandler: nil)
        player.scheduleBuffer(Self.talkPermit(format: format), completionHandler: nil)
        player.scheduleFile(file, at: nil, completionHandler: nil)
        player.scheduleBuffer(Self.roger(format: format), completionHandler: nil)
        player.scheduleBuffer(Self.dataBurst(format: format), completionHandler: nil)
        player.scheduleBuffer(Self.hiss(format: format, seconds: 0.18, fade: true)) {
            Task { @MainActor in done() }
        }
        player.play()
    }

    /// The channel closing, on the speaker's own phone: the data burst and static.
    func squelch() {
        guard let format = Self.localFormat else { return }
        do {
            try wire(format)
            player.scheduleBuffer(Self.dataBurst(format: format), completionHandler: nil)
            player.scheduleBuffer(Self.hiss(format: format, seconds: 0.16, fade: true), completionHandler: nil)
            player.play()
        } catch {}
    }

    /// The talk-permit chirp, on the speaker's own phone as they press — the
    /// recording starts once it is over (`chirpSeconds`), so it is not in it.
    func chirp() {
        guard let format = Self.localFormat else { return }
        do {
            try wire(format)
            player.scheduleBuffer(Self.talkPermit(format: format), completionHandler: nil)
            player.play()
        } catch {}
    }

    /// How long the chirp lasts, with a breath after it.
    static let chirpSeconds = 0.36

    private static let localFormat = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 1)

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

    /// The talk-permit tone: three quick high beeps, the police radio's "go ahead".
    private static func talkPermit(format: AVAudioFormat) -> AVAudioPCMBuffer {
        let beep = 0.055, gap = 0.035, frequency = 1_820.0
        let seconds = beep * 3 + gap * 2 + 0.02
        let frames = AVAudioFrameCount(format.sampleRate * seconds)
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames)!
        buffer.frameLength = frames
        for channel in 0..<Int(format.channelCount) {
            guard let data = buffer.floatChannelData?[channel] else { continue }
            for frame in 0..<Int(frames) {
                let time = Double(frame) / format.sampleRate
                let slot = time.truncatingRemainder(dividingBy: beep + gap)
                let on = slot < beep && time < beep * 3 + gap * 2
                let edge = min(1, min(slot, beep - slot) / 0.004)
                data[frame] = on ? Float(sin(2 * .pi * frequency * time) * 0.3 * edge) : 0
            }
        }
        return buffer
    }

    /// The data burst at the end of a police transmission — the "brrrt": a
    /// fast warble between two tones, as the radio's ID signal sounds.
    private static func dataBurst(format: AVAudioFormat) -> AVAudioPCMBuffer {
        let seconds = 0.2
        let frames = AVAudioFrameCount(format.sampleRate * seconds)
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames)!
        buffer.frameLength = frames
        let bitSeconds = 1.0 / 1_200
        var phase = 0.0
        var bit = Bool.random()
        var nextBit = bitSeconds
        for frame in 0..<Int(frames) {
            let time = Double(frame) / format.sampleRate
            if time >= nextBit {
                bit = Bool.random()
                nextBit += bitSeconds
            }
            phase += 2 * .pi * (bit ? 1_800 : 1_200) / format.sampleRate
            let edge = min(1, min(time, seconds - time) / 0.006)
            let sample = Float(sin(phase) * 0.26 * edge)
            for channel in 0..<Int(format.channelCount) {
                buffer.floatChannelData?[channel][frame] = sample
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
