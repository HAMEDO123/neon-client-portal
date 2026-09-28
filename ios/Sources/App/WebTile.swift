import SwiftUI

struct WebTile: View {
    let title: String
    let symbol: String
    var badge = 0
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: symbol)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(Color.neonPurpleStrong)
                Text(title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color.neonInk)
                Spacer(minLength: 0)
                if badge > 0 {
                    Text("\(badge)")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 7)
                        .frame(minHeight: 22)
                        .background(Color.neonPinkStrong, in: Capsule())
                }
                Image(systemName: "arrow.up.forward.square")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.neonInk.opacity(0.35))
            }
            .padding(14)
            .frame(maxWidth: .infinity)
            .glassCard(radius: 16)
        }
        .buttonStyle(.pressable)
    }
}
