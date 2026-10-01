import SwiftUI

// The things on a purchase request, drawn the same way on the person's own
// Requests tab and on the manager's: each line with its count and what it
// costs, and the total under them. A price is the line's, never each — so
// nothing here multiplies it by the count.

struct SupplyLinesList: View {
    let lines: [SupplyLine]

    private var total: Double? {
        let sum = lines.compactMap(\.estimatedCost).reduce(0, +)
        return sum > 0 ? sum : nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(lines) { line in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Circle().fill(Color.neonOrange.opacity(0.7)).frame(width: 5, height: 5)
                    DirText(line.name, font: .neonSubheadline, fill: false)
                    if let count = line.count {
                        Text(verbatim: "× \(count)")
                            .font(.neonCaption.weight(.semibold))
                            .foregroundStyle(Color.neonTextSecondary)
                            .padding(.horizontal, 6).padding(.vertical, 1)
                            .background(Color.neonInk.opacity(0.06), in: Capsule())
                    }
                    Spacer(minLength: 8)
                    if let cost = line.estimatedCost {
                        Text(NeonFormat.money(cost, decimals: cost.rounded() == cost ? 0 : 2))
                            .font(.neonCaption)
                            .foregroundStyle(Color.neonTextTertiary)
                            .environment(\.layoutDirection, .leftToRight)
                    }
                }
            }
            if lines.count > 1, let total {
                Divider().opacity(0.5)
                HStack {
                    Text(L("Total")).font(.neonCaption.weight(.semibold)).foregroundStyle(Color.neonTextSecondary)
                    Spacer()
                    Text(L("≈ %@", NeonFormat.money(total, decimals: total.rounded() == total ? 0 : 2)))
                        .font(.neonCaption.weight(.semibold))
                        .foregroundStyle(Color.neonTextSecondary)
                }
            }
        }
    }
}

/// One line being typed into the request form.
struct SupplyLineDraft: Identifiable, Equatable {
    let id = UUID()
    var name = ""
    var count: Double?
    var cost: Double?

    var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
}
