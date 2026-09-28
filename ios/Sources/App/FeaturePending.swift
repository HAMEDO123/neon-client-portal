import SwiftUI

/// Shown only while an area is being built. Nothing ships with one of these in
/// front of a person: every use is replaced by the area that owns it.
struct FeaturePending: View {
    let title: String
    var inline = false

    var body: some View {
        let content = VStack(spacing: 10) {
            Image(systemName: "hammer")
                .font(.system(size: 28))
                .foregroundStyle(Color.neonInk.opacity(0.25))
            Text(title)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.neonInk.opacity(0.6))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)

        if inline {
            content
        } else {
            ScrollView { content }
                .navigationTitle(title)
                .neonAmbientBackground()
        }
    }
}
