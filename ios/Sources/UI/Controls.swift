import SwiftUI

// MARK: - Chips

/// A capsule label that can be tapped and selected: a filter, a tag, a choice.
struct Chip: View {
    let title: String
    var symbol: String?
    var isSelected: Bool
    var tint: Color
    var count: Int?
    var action: (() -> Void)?

    init(
        _ title: String,
        symbol: String? = nil,
        isSelected: Bool = false,
        tint: Color = .neonInk,
        count: Int? = nil,
        action: (() -> Void)? = nil
    ) {
        self.title = title
        self.symbol = symbol
        self.isSelected = isSelected
        self.tint = tint
        self.count = count
        self.action = action
    }

    var body: some View {
        if let action {
            Button {
                Haptic.selection()
                action()
            } label: {
                chip
            }
            .buttonStyle(PressableStyle(scale: 0.94))
            .accessibilityAddTraits(isSelected ? .isSelected : [])
        } else {
            chip
        }
    }

    private var chip: some View {
        ChipLabel(title: title, symbol: symbol, count: count, isSelected: isSelected)
            .background {
                if isSelected {
                    Capsule().fill(tint)
                } else {
                    Capsule().fill(Color.white.opacity(0.78))
                        .overlay(Capsule().strokeBorder(Color.neonLine, lineWidth: 1))
                }
            }
            .animation(NeonMotion.snappy, value: isSelected)
    }
}

/// The inside of a chip, shared by `Chip` and `FilterChips`.
struct ChipLabel: View {
    let title: String
    var symbol: String?
    var count: Int?
    var isSelected: Bool

    var body: some View {
        HStack(spacing: 6) {
            if let symbol {
                Image(systemName: symbol)
                    .font(.system(size: 12, weight: .semibold))
            }
            Text(title)
                .lineLimit(1)
            if let count {
                Text(NeonFormat.integer(count))
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .padding(.horizontal, 6)
                    .frame(minWidth: 18, minHeight: 18)
                    .background(Capsule().fill(isSelected ? Color.white.opacity(0.24) : Color.neonInk.opacity(0.07)))
            }
        }
        .font(.system(size: 14, weight: .semibold))
        .foregroundStyle(isSelected ? Color.white : Color.neonInk.opacity(0.72))
        .padding(.horizontal, 14)
        .frame(height: 36)
        .contentShape(Capsule())
    }
}

/// A scrolling row of filter chips. The selection slides between them.
/// Inside a padded stack, bleed it to the screen edge:
/// `FilterChips(…, inset: 16).padding(.horizontal, -16)`.
struct FilterChips<Option: Hashable>: View {
    @Binding var selection: Option
    let options: [Option]
    let title: (Option) -> String
    var symbol: ((Option) -> String?)?
    var count: ((Option) -> Int?)?
    var tint: Color
    var inset: CGFloat

    @Namespace private var namespace

    init(
        selection: Binding<Option>,
        options: [Option],
        tint: Color = .neonInk,
        inset: CGFloat = 0,
        title: @escaping (Option) -> String,
        symbol: ((Option) -> String?)? = nil,
        count: ((Option) -> Int?)? = nil
    ) {
        self._selection = selection
        self.options = options
        self.tint = tint
        self.inset = inset
        self.title = title
        self.symbol = symbol
        self.count = count
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(options, id: \.self) { option in
                        let selected = option == selection
                        Button {
                            guard !selected else { return }
                            Haptic.selection()
                            withNeonAnimation(NeonMotion.snappy) { selection = option }
                            withAnimation(NeonMotion.smooth) { proxy.scrollTo(option, anchor: .center) }
                        } label: {
                            ChipLabel(title: title(option), symbol: symbol?(option), count: count?(option), isSelected: selected)
                                .background {
                                    if selected {
                                        Capsule()
                                            .fill(tint)
                                            .matchedGeometryEffect(id: "selection", in: namespace)
                                    } else {
                                        Capsule()
                                            .fill(Color.white.opacity(0.78))
                                            .overlay(Capsule().strokeBorder(Color.neonLine, lineWidth: 1))
                                    }
                                }
                        }
                        .buttonStyle(PressableStyle(scale: 0.95))
                        .id(option)
                        .accessibilityAddTraits(selected ? .isSelected : [])
                    }
                }
                .padding(.horizontal, inset)
                .padding(.vertical, 4)
            }
        }
    }
}

/// Two to four equal segments with a sliding white pill — for switching
/// between views of the same thing.
struct SegmentedPill<Option: Hashable>: View {
    @Binding var selection: Option
    let options: [Option]
    let title: (Option) -> String
    var symbol: ((Option) -> String?)?
    var badge: ((Option) -> Int?)?

    @Namespace private var namespace

    init(
        selection: Binding<Option>,
        options: [Option],
        title: @escaping (Option) -> String,
        symbol: ((Option) -> String?)? = nil,
        badge: ((Option) -> Int?)? = nil
    ) {
        self._selection = selection
        self.options = options
        self.title = title
        self.symbol = symbol
        self.badge = badge
    }

    var body: some View {
        HStack(spacing: 4) {
            ForEach(options, id: \.self) { option in
                let selected = option == selection
                Button {
                    guard !selected else { return }
                    Haptic.selection()
                    withNeonAnimation(NeonMotion.snappy) { selection = option }
                } label: {
                    HStack(spacing: 6) {
                        if let name = symbol?(option) {
                            Image(systemName: name)
                                .font(.system(size: 12, weight: .semibold))
                        }
                        Text(title(option))
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                        if let count = badge?(option), count > 0 {
                            CountBadge(count, tone: selected ? .purple : .neutral)
                                .scaleEffect(0.85)
                        }
                    }
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(selected ? Color.neonInk : Color.neonInk.opacity(0.5))
                    .frame(maxWidth: .infinity)
                    .frame(height: 36)
                    .background {
                        if selected {
                            Capsule()
                                .fill(Color.white)
                                .shadow(color: .neonInk.opacity(0.12), radius: 6, x: 0, y: 2)
                                .matchedGeometryEffect(id: "pill", in: namespace)
                        }
                    }
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
        .padding(4)
        .background(Capsule().fill(Color.neonInk.opacity(0.06)))
        .overlay(Capsule().strokeBorder(Color.neonInk.opacity(0.04), lineWidth: 1))
    }
}

// MARK: - Search

/// The kit's search box. Filter with `matchesSearch(query, fields…)`, which
/// ignores case, Arabic diacritics and the alef/yaa/taa-marbuta variants.
struct SearchField: View {
    @Binding var text: String
    var prompt: String
    var onSubmit: (() -> Void)?

    @FocusState private var focused: Bool

    init(text: Binding<String>, prompt: String = L("Search"), onSubmit: (() -> Void)? = nil) {
        self._text = text
        self.prompt = prompt
        self.onSubmit = onSubmit
    }

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(focused ? Color.neonPurpleStrong : Color.neonTextTertiary)
            TextField("", text: $text, prompt: Text(prompt).foregroundColor(Color.neonTextTertiary))
                .font(.system(size: 15))
                .foregroundStyle(Color.neonInk)
                .focused($focused)
                .submitLabel(.search)
                .autocorrectionDisabled()
                .onSubmit { onSubmit?() }
            if !text.isEmpty {
                Button {
                    Haptic.tap()
                    text = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 16))
                        .foregroundStyle(Color.neonTextFaint)
                }
                .buttonStyle(.plain)
                .transition(.neonPop)
                .accessibilityLabel(L("Clear"))
            }
        }
        .padding(.horizontal, 14)
        .frame(height: 44)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(Color.white.opacity(focused ? 0.95 : 0.75))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(focused ? Color.neonPurple.opacity(0.55) : Color.neonLine, lineWidth: focused ? 1.5 : 1)
        )
        .shadow(color: focused ? Color.neonPurple.opacity(0.15) : .clear, radius: 10, x: 0, y: 4)
        .animation(NeonMotion.quick, value: focused)
        .animation(NeonMotion.snappy, value: text.isEmpty)
        .contentShape(Rectangle())
        .onTapGesture { focused = true }
    }
}

extension String {
    /// This text folded for searching: no case, no diacritics (tashkeel),
    /// one alef, yaa for alef maqsura, haa for taa marbuta, Western digits.
    var searchFolded: String {
        let folded = folding(options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive], locale: nil)
        var out = String.UnicodeScalarView()
        for scalar in folded.unicodeScalars {
            switch scalar.value {
            case 0x0622, 0x0623, 0x0625, 0x0671: out.append(UnicodeScalar(0x0627)!) // آ أ إ ٱ → ا
            case 0x0649: out.append(UnicodeScalar(0x064A)!) // ى → ي
            case 0x0629: out.append(UnicodeScalar(0x0647)!) // ة → ه
            case 0x0640: continue // tatweel
            case 0x064B...0x065F, 0x0670: continue // harakat left after folding
            case 0x0660...0x0669: out.append(UnicodeScalar(scalar.value - 0x0660 + 48)!)
            case 0x06F0...0x06F9: out.append(UnicodeScalar(scalar.value - 0x06F0 + 48)!)
            default: out.append(scalar)
            }
        }
        return String(out)
    }

    func matchesSearch(_ query: String) -> Bool {
        neonSearchMatches(query, [self])
    }
}

/// Whether every word of `query` appears in at least one of `fields`.
/// An empty query matches everything.
func matchesSearch(_ query: String, _ fields: String?...) -> Bool {
    neonSearchMatches(query, fields.compactMap { $0 })
}

private func neonSearchMatches(_ query: String, _ fields: [String]) -> Bool {
    let words = query.searchFolded
        .split(whereSeparator: { $0.isWhitespace })
    guard !words.isEmpty else { return true }
    let haystack = fields.map(\.searchFolded).joined(separator: " ")
    return words.allSatisfy { haystack.contains($0) }
}
