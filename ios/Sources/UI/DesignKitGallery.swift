#if DEBUG
import SwiftUI

/// Every component of the kit on one scrolling page (`-neonScreen kit`), so
/// the design system can be checked in a screenshot. Debug builds only.
struct DesignKitGallery: View {
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Text(verbatim: "NEON kit").font(.largeTitle.bold())
                }
                .padding()
            }
        }
    }
}
#endif
