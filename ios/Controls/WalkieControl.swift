import AppIntents
import SwiftUI
import WidgetKit

// The walkie-talkie as a button on the lock screen and in Control Center
// (iOS 18): put it in place of the torch or the camera at the foot of the lock
// screen, and one press opens NEON on the walkie-talkie, ready to talk. Asked
// for on 2026-10-25. Holding to talk without opening anything is iOS's own
// Push to Talk button, in the Dynamic Island once the walkie-talkie is on.

@main
struct NeonControls: WidgetBundle {
    var body: some Widget {
        WalkieControl()
    }
}

struct WalkieControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "com.neonjo.staff.controls.walkie") {
            ControlWidgetButton(action: OpenWalkieIntent()) {
                Label(String(localized: "Walkie-talkie"), systemImage: "antenna.radiowaves.left.and.right")
            }
        }
        .displayName("NEON walkie-talkie")
        .description("Opens the walkie-talkie, ready to talk.")
    }
}
