#if DEBUG
import AVFoundation
import SwiftUI

/// The walkie-talkie for the debug router (App/DebugScreens.swift), from fixed
/// answers, reading nothing. Push to Talk itself needs a real phone.
enum WalkieScreens {
    static let ids: [String] = ["walkie-fixture", "walkie-fixture-person", "walkie-fixture-closed", "walkie-required", "walkie-hear-card", "walkie-radio-sample"]

    private static let people: [WalkiePerson] = [
        WalkiePerson(id: "admin", name: "The manager", role: nil, photoUrl: nil, manager: true, allowed: true),
        WalkiePerson(id: "fx-wael", name: "Wael", role: "Designer", photoUrl: nil, allowed: true),
        WalkiePerson(id: "fx-sally", name: "Sally", role: "Designer", photoUrl: nil, allowed: true),
        WalkiePerson(id: "fx-salem", name: "Salem", role: "Site", photoUrl: nil, allowed: false),
    ]

    @MainActor static func view(_ id: String) -> AnyView? {
        switch id {
        case "walkie-fixture":
            WalkieCenter.shared.preview(.on)
            return debugPushed(WalkieTalkieView(preview: people))
        case "walkie-fixture-person":
            WalkieCenter.shared.preview(.on)
            return debugPushed(WalkieTalkieView(preview: people, chosen: "fx-wael"))
        case "walkie-fixture-closed":
            WalkieCenter.shared.preview(.on)
            return debugPushed(WalkieTalkieView(preview: people, open: false))
        case "walkie-required":
            WalkieCenter.shared.preview(.off)
            return AnyView(WalkieRequiredView())
        case "walkie-hear-card":
            WalkieCenter.shared.preview(.off)
            return debugPushed(WalkieTalkieView(preview: people))
        case "walkie-radio-sample":
            // A recording handed in by path (NEON_WALKIE_SAMPLE), played as the
            // receiving phone plays it: static, the radio's band, the roger beep.
            return AnyView(WalkieRadioSample())
        default:
            return nil
        }
    }
}

private struct WalkieRadioSample: View {
    @State private var played = 0

    var body: some View {
        NeonScroll(spacing: NeonSpace.stack, lazy: false) {
            SectionCard(L("Walkie-talkie"), subtitle: "Radio sound sample", symbol: "antenna.radiowaves.left.and.right", hue: .orange) {
                NeonButton("Play again", symbol: "play.fill", kind: .brand) { play() }
                Text("Played \(played)×").font(.neonCaption)
            }
        }
        .task {
            try? await Task.sleep(nanoseconds: 800_000_000)
            play()
        }
    }

    private func play() {
        guard let path = ProcessInfo.processInfo.environment["NEON_WALKIE_SAMPLE"] else { return }
        try? AVAudioSession.sharedInstance().setCategory(.playback)
        try? AVAudioSession.sharedInstance().setActive(true)
        try? WalkieRadio.shared.play(file: URL(fileURLWithPath: path)) { played += 1 }
    }
}
#endif
