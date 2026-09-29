import SwiftUI

// MARK: - Tab bar

/// One tab of a `NeonTabBar`.
struct NeonTabItem<Tab: Hashable>: Identifiable {
    let tab: Tab
    let title: String
    let symbol: String
    var badge: Int?
    var dot: Bool

    var id: Tab { tab }

    init(_ tab: Tab, title: String, symbol: String, badge: Int? = nil, dot: Bool = false) {
        self.tab = tab
        self.title = title
        self.symbol = symbol
        self.badge = badge
        self.dot = dot
    }
}

/// The floating tab bar of the mockups: a white rounded bar over the page,
/// with a lavender pill sliding behind the chosen tab, its icon and name in
/// purple, and red counts on the others.
///
/// iOS 26 draws a bar much like it for a plain `TabView`, so this is for a
/// shell that wants the same look on iOS 16–18 too: hide the system bar
/// (`.toolbar(.hidden, for: .tabBar)`) and put this in the bottom safe area
/// inset of the `TabView`.
struct NeonTabBar<Tab: Hashable>: View {
    @Binding var selection: Tab
    let items: [NeonTabItem<Tab>]

    @Namespace private var namespace

    init(selection: Binding<Tab>, items: [NeonTabItem<Tab>]) {
        self._selection = selection
        self.items = items
    }

    var body: some View {
        HStack(spacing: 2) {
            ForEach(items) { item in
                tab(item)
            }
        }
        .padding(6)
        .background {
            let shape = RoundedRectangle(cornerRadius: NeonRadius.xl + 4, style: .continuous)
            shape.fill(Color.white.opacity(0.94))
                .overlay(shape.strokeBorder(LinearGradient.neonGlassEdge, lineWidth: 1))
                .shadow(color: .neonShadowTint.opacity(0.14), radius: 24, x: 0, y: 10)
        }
        .padding(.horizontal, NeonSpace.gutter)
        .dynamicTypeSize(...DynamicTypeSize.xLarge)
    }

    private func tab(_ item: NeonTabItem<Tab>) -> some View {
        let selected = item.tab == selection
        return Button {
            guard !selected else { return }
            Haptic.selection()
            withNeonAnimation(NeonMotion.snappy) { selection = item.tab }
        } label: {
            VStack(spacing: 3) {
                Image(systemName: item.symbol)
                    .font(.system(size: 21, weight: .semibold))
                    .frame(height: 26)
                    .overlay(alignment: .topTrailing) {
                        if let badge = item.badge, badge > 0 {
                            CountBadge(badge, size: 18).offset(x: 12, y: -6)
                        } else if item.dot {
                            Circle()
                                .fill(Color.neonDanger)
                                .frame(width: 9, height: 9)
                                .overlay(Circle().strokeBorder(Color.white, lineWidth: 1.5))
                                .offset(x: 5, y: -1)
                        }
                    }
                Text(item.title)
                    .font(.system(.caption, weight: selected ? .bold : .semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .foregroundStyle(selected ? Color.neonPurpleStrong : Color(hex: 0x4A5066))
            .frame(maxWidth: .infinity)
            .frame(height: 56)
            .background {
                if selected {
                    RoundedRectangle(cornerRadius: NeonRadius.lg, style: .continuous)
                        .fill(LinearGradient(colors: [Color(hex: 0xF1ECFF), Color(hex: 0xE6DDFF)], startPoint: .top, endPoint: .bottom))
                        .overlay(
                            RoundedRectangle(cornerRadius: NeonRadius.lg, style: .continuous)
                                .strokeBorder(Color.neonPurple.opacity(0.12), lineWidth: 1)
                        )
                        .matchedGeometryEffect(id: "tab", in: namespace)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle(scale: 0.94))
        .accessibilityLabel(Text(item.title))
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityValue(item.badge.map { $0 > 0 ? Text(NeonFormat.integer($0)) : Text("") } ?? Text(""))
    }
}
