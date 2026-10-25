#if DEBUG
import AVFoundation
import SwiftUI

/// The walkie-talkie for the debug router (App/DebugScreens.swift), from fixed
/// answers, reading nothing. Push to Talk itself needs a real phone.
enum WalkieScreens {
    static let ids: [String] = [
        "walkie-fixture", "walkie-fixture-closed", "walkie-thread", "walkie-thread-all",
        "walkie-required", "walkie-hear-card", "walkie-radio-sample",
    ]

    private static func ago(_ minutes: Double) -> String {
        ISO8601DateFormatter().string(from: Date().addingTimeInterval(-minutes * 60))
    }

    private static var people: [WalkiePerson] {
        [
            WalkiePerson(id: "admin", name: "The manager", role: nil, photoUrl: nil, manager: true, allowed: true, lastAt: ago(3), unheard: 1),
            WalkiePerson(id: "fx-wael", name: "Wael", role: "Designer", photoUrl: nil, allowed: true, lastAt: ago(12), unheard: 0),
            WalkiePerson(id: "fx-sally", name: "Sally", role: "Designer", photoUrl: nil, allowed: true, lastAt: nil, unheard: 0),
            WalkiePerson(id: "fx-salem", name: "Salem", role: "Site", photoUrl: nil, allowed: false),
        ]
    }

    private static var thread: [WalkieItem] {
        [
            WalkieItem(id: "1", mine: true, fromName: "The manager", scope: "one", audioUrl: "", seconds: 4, at: ago(14), phones: 1, heardAt: ago(13)),
            WalkieItem(id: "2", mine: false, fromName: "Wael", scope: "one", audioUrl: "", seconds: 6, at: ago(12), phones: 1, heardAt: ago(12)),
            WalkieItem(id: "3", mine: false, fromName: "Wael", scope: "all", audioUrl: "", seconds: 3, at: ago(9), phones: 1, heardAt: ago(9)),
            WalkieItem(id: "4", mine: true, fromName: "The manager", scope: "one", audioUrl: "", seconds: 2, at: ago(2), phones: 1, heardAt: nil),
            WalkieItem(id: "5", mine: true, fromName: "The manager", scope: "one", audioUrl: "", seconds: 5, at: ago(1), phones: 0, heardAt: nil),
        ]
    }

    private static var allThread: [WalkieItem] {
        [
            WalkieItem(id: "a1", mine: true, fromName: "The manager", scope: "all", audioUrl: "", seconds: 7, at: ago(30), phones: 3, heardAt: nil,
                       recipients: [.init(key: "fx-wael", phones: 1, heardAt: ago(29)), .init(key: "fx-sally", phones: 1, heardAt: ago(29)), .init(key: "fx-salem", phones: 0, heardAt: nil)]),
        ]
    }

    @MainActor static func view(_ id: String) -> AnyView? {
        switch id {
        case "walkie-fixture":
            WalkieCenter.shared.preview(.on)
            return debugPushed(WalkieTalkieView(preview: people))
        case "walkie-fixture-closed":
            WalkieCenter.shared.preview(.on)
            return debugPushed(WalkieTalkieView(preview: people, open: false))
        case "walkie-thread":
            WalkieCenter.shared.preview(.on)
            return debugPushed(WalkieThreadView(conversation: WalkieConversation(key: "fx-wael", name: "Wael", photo: nil), preview: thread))
        case "walkie-thread-all":
            WalkieCenter.shared.preview(.on)
            return debugPushed(WalkieThreadView(conversation: WalkieConversation(key: "all", name: L("Everybody"), photo: nil), preview: allThread))
        case "walkie-required":
            WalkieCenter.shared.preview(.off)
            return AnyView(WalkieRequiredView())
        case "walkie-hear-card":
            WalkieCenter.shared.preview(.off)
            return debugPushed(WalkieTalkieView(preview: people))
        case "walkie-radio-sample":
            // A recording handed in by path (NEON_WALKIE_SAMPLE), played as the
            // receiving phone plays it.
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
            SectionCard(L("Walkie-talkie"), subtitle: "As the listener hears it", symbol: "antenna.radiowaves.left.and.right", hue: .orange) {
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
