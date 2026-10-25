#if DEBUG
import SwiftUI

/// The walkie-talkie for the debug router (App/DebugScreens.swift), from fixed
/// answers, reading nothing. Push to Talk itself needs a real phone.
enum WalkieScreens {
    static let ids: [String] = ["walkie-fixture", "walkie-fixture-person", "walkie-fixture-closed", "walkie-required", "walkie-hear-card"]

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
        default:
            return nil
        }
    }
}
#endif
