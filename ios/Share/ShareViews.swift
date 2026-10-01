import SwiftUI

// The share sheet's screen, in the app's look (the kit's lavender page, white
// cards, the chat list's faces): what is being shared, a search, the chats to
// tick, a caption, and Send — or, with nobody signed in, where to go first.

struct ShareRootView: View {
    @ObservedObject var model: ShareModel

    var body: some View {
        Group {
            switch model.stage {
            case .signedOut: ShareSignedOutView(onClose: model.cancel)
            case .picking: SharePickerView(model: model)
            }
        }
        .background(NeonAmbient().ignoresSafeArea())
        .environment(\.layoutDirection, AppLanguage.current.layoutDirection)
        .environment(\.locale, AppLanguage.current.locale)
        .preferredColorScheme(.light)
        .tint(.neonAccent)
    }
}

// MARK: - Nobody signed in

struct ShareSignedOutView: View {
    let onClose: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            ShareHeader(title: "NEON", subtitle: nil, leading: L("Close"), onLeading: onClose)
            Spacer(minLength: NeonSpace.lg)
            VStack(spacing: NeonSpace.lg) {
                ShareStudioBadge(size: 76)
                VStack(spacing: NeonSpace.sm) {
                    Text(L("Open NEON and sign in first"))
                        .font(.neonTitle3)
                        .foregroundStyle(Color.neonInk)
                    Text(L("Sharing sends from the account signed in to the NEON app on this iPhone. Open NEON and sign in — or, just after an update, simply open it once — then share again."))
                        .font(.neonSubheadline)
                        .foregroundStyle(Color.neonTextSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .multilineTextAlignment(.center)
            }
            .padding(NeonSpace.xxl)
            .neonSurface(.strong, radius: NeonRadius.xl)
            .padding(.horizontal, NeonSpace.xl)
            Spacer(minLength: NeonSpace.lg)
            Spacer(minLength: NeonSpace.lg)
        }
    }
}

// MARK: - Picking

struct SharePickerView: View {
    @ObservedObject var model: ShareModel
    @FocusState private var searching: Bool

    private var subtitle: String {
        model.selected.isEmpty ? L("Choose who gets it") : L("%d chosen", model.selected.count)
    }

    var body: some View {
        VStack(spacing: 0) {
            ShareHeader(title: L("Send to…"), subtitle: subtitle, leading: L("Cancel"), onLeading: model.cancel)
            ScrollView {
                VStack(spacing: NeonSpace.stack) {
                    if !model.items.isEmpty || model.itemsPending > 0 {
                        ShareAttachmentStrip(model: model)
                    }
                    notes
                    ShareSearchField(text: $model.query, focus: $searching)
                    conversationList
                }
                .padding(.horizontal, NeonSpace.gutter)
                .padding(.top, NeonSpace.xs)
                .padding(.bottom, NeonSpace.lg)
            }
            .scrollDismissesKeyboard(.interactively)
            .disabled(model.sending != nil)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            ShareBottomBar(model: model)
        }
    }

    @ViewBuilder
    private var notes: some View {
        ForEach(model.items.filter { $0.refusal != nil }) { item in
            ShareNote(symbol: "exclamationmark.triangle.fill", tone: .warning, text: item.refusal ?? "")
        }
        if model.droppedCount > 0 {
            ShareNote(symbol: "info.circle.fill", tone: .info, text: L("Only the first %d are sent.", ShareInbox.maxItems))
        }
    }

    @ViewBuilder
    private var conversationList: some View {
        if let error = model.listError {
            VStack(spacing: NeonSpace.md) {
                Image(systemName: "wifi.exclamationmark")
                    .font(.system(.title2, weight: .semibold))
                    .foregroundStyle(NeonHue.orange.deep)
                Text(error)
                    .font(.neonSubheadline)
                    .foregroundStyle(Color.neonTextSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                ShareCapsuleButton(title: L("Try again"), kind: .primary) {
                    Task { await model.loadConversations() }
                }
            }
            .padding(NeonSpace.xl)
            .frame(maxWidth: .infinity)
            .neonSurface(.glass)
        } else if model.conversations == nil {
            VStack(spacing: 8) {
                ForEach(0..<6, id: \.self) { _ in ShareSkeletonRow() }
            }
        } else {
            let shown = model.shownConversations
            if shown.isEmpty {
                Text(model.query.isEmpty ? L("No chats yet.") : L("No chat matches “%@”.", model.query))
                    .font(.neonSubheadline)
                    .foregroundStyle(Color.neonTextSecondary)
                    .padding(.vertical, NeonSpace.xxl)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    Text(L("Chats").uppercased())
                        .font(.neonOverline)
                        .tracking(0.6)
                        .foregroundStyle(Color.neonTextTertiary)
                        .padding(.leading, NeonSpace.xs)
                    LazyVStack(spacing: 8) {
                        ForEach(shown) { conversation in
                            ShareConversationRow(
                                conversation: conversation,
                                isSelected: model.selected.contains(conversation.slug)
                            ) {
                                searching = false
                                model.toggle(conversation)
                            }
                        }
                    }
                }
            }
        }
    }
}

/// Cancel on the leading side, the title in the middle.
struct ShareHeader: View {
    let title: String
    let subtitle: String?
    let leading: String
    let onLeading: () -> Void

    var body: some View {
        ZStack {
            VStack(spacing: 1) {
                Text(title)
                    .font(.neonHeadline)
                    .foregroundStyle(Color.neonInk)
                if let subtitle {
                    Text(subtitle)
                        .font(.neonCaption)
                        .foregroundStyle(Color.neonTextSecondary)
                        .contentTransition(.opacity)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 90)
            HStack {
                Button(leading, action: onLeading)
                    .font(.system(.body, weight: .medium))
                    .foregroundStyle(Color.neonAccent)
                    .frame(minHeight: NeonSize.touch)
                Spacer()
            }
        }
        .padding(.horizontal, NeonSpace.gutter)
        .padding(.top, NeonSpace.sm)
        .padding(.bottom, NeonSpace.xs)
        .lineLimit(1)
    }
}

// MARK: - What is being shared

struct ShareAttachmentStrip: View {
    @ObservedObject var model: ShareModel

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: NeonSpace.md) {
                ForEach(model.items) { item in
                    ShareAttachmentTile(item: item, canRemove: model.items.count > 1 && model.sending == nil) {
                        model.remove(item)
                    }
                    .transition(.neonPop)
                }
                ForEach(0..<model.itemsPending, id: \.self) { _ in
                    ShareAttachmentTile.placeholder
                }
            }
            .padding(NeonSpace.md)
        }
        .neonSurface(.glass)
    }
}

struct ShareAttachmentTile: View {
    let item: ShareItem
    var canRemove = false
    var onRemove: () -> Void = {}

    static let side: CGFloat = 76

    var body: some View {
        VStack(spacing: 4) {
            ZStack {
                if let thumbnail = item.thumbnail {
                    Image(uiImage: thumbnail).resizable().scaledToFill()
                } else {
                    NeonHue.indigo.wash
                    Image(systemName: symbol)
                        .font(.system(size: 26, weight: .semibold))
                        .foregroundStyle(NeonHue.indigo.deep)
                }
                if item.kind == .video {
                    Image(systemName: "play.circle.fill")
                        .font(.system(size: 24))
                        .foregroundStyle(.white, .black.opacity(0.35))
                }
                if item.refusal != nil {
                    Color.neonDanger.opacity(0.55)
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 22, weight: .bold))
                        .foregroundStyle(.white)
                }
            }
            .frame(width: Self.side, height: Self.side)
            .clipShape(RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous).strokeBorder(Color.neonLine, lineWidth: 1))
            .overlay(alignment: .topTrailing) {
                if canRemove {
                    Button(action: onRemove) {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 22))
                            .foregroundStyle(.white, Color.neonInk.opacity(0.62))
                    }
                    .buttonStyle(.plain)
                    .offset(x: 7, y: -7)
                    .accessibilityLabel(L("Leave this out"))
                }
            }

            Text(verbatim: item.name)
                .font(.system(.caption2, weight: .medium))
                .foregroundStyle(Color.neonInk.opacity(0.85))
                .lineLimit(1)
                .truncationMode(.middle)
            if item.bytes > 0 {
                Text(ByteCountFormatter.string(fromByteCount: item.bytes, countStyle: .file))
                    .font(.system(.caption2))
                    .foregroundStyle(Color.neonTextTertiary)
                    .lineLimit(1)
            }
        }
        .frame(width: Self.side + 8)
        .accessibilityElement(children: .combine)
    }

    private var symbol: String {
        switch item.kind {
        case .photo: return "photo"
        case .video: return "film"
        case .voice: return "waveform"
        case .file: return "doc.fill"
        }
    }

    static var placeholder: some View {
        VStack(spacing: 6) {
            RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous)
                .fill(Color.neonPurple.opacity(0.08))
                .frame(width: side, height: side)
                .overlay(ProgressView())
            RoundedRectangle(cornerRadius: 3).fill(Color.neonInk.opacity(0.06)).frame(width: 56, height: 8)
        }
        .frame(width: side + 8)
        .accessibilityLabel(L("Getting it ready"))
    }
}

struct ShareNote: View {
    let symbol: String
    let tone: BadgeTone
    let text: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: NeonSpace.sm) {
            Image(systemName: symbol)
                .font(.system(.footnote, weight: .semibold))
                .foregroundStyle(tone.foreground)
            Text(text)
                .font(.neonFootnote)
                .foregroundStyle(Color.neonInk.opacity(0.82))
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, NeonSpace.md)
        .padding(.vertical, 10)
        .neonSurface(.tinted(tone.color), radius: NeonRadius.md)
    }
}

// MARK: - Search and the list

struct ShareSearchField: View {
    @Binding var text: String
    var focus: FocusState<Bool>.Binding

    var body: some View {
        let focused = focus.wrappedValue
        HStack(spacing: NeonSpace.sm) {
            Image(systemName: "magnifyingglass")
                .font(.system(.subheadline, weight: .semibold))
                .foregroundStyle(focused ? Color.neonAccent : Color.neonTextTertiary)
            TextField("", text: $text, prompt: Text(L("Search")).foregroundColor(Color.neonTextTertiary))
                .font(.neonCallout)
                .foregroundStyle(Color.neonInk)
                .focused(focus)
                .submitLabel(.search)
                .autocorrectionDisabled()
            if !text.isEmpty {
                Button {
                    text = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(.callout))
                        .foregroundStyle(Color.neonTextFaint)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(L("Clear"))
            }
        }
        .padding(.horizontal, NeonSpace.lg)
        .frame(minHeight: 46)
        .background(Capsule().fill(Color.white.opacity(focused ? 1 : 0.94)))
        .overlay(Capsule().strokeBorder(focused ? Color.neonAccent.opacity(0.5) : Color.neonLine, lineWidth: focused ? 1.5 : 1))
        .neonShadow(.low)
        .animation(NeonMotion.quick, value: focused)
        .contentShape(Capsule())
        .onTapGesture { focus.wrappedValue = true }
    }
}

struct ShareConversationRow: View {
    let conversation: ShareConversation
    let isSelected: Bool
    let onTap: () -> Void

    private var secondLine: String? {
        if conversation.isGroup, let count = conversation.memberCount {
            return shareCount(count == 1 ? "%lld member" : "%lld members", count)
        }
        guard let subtitle = conversation.subtitle, !subtitle.isEmpty else { return nil }
        return subtitle
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: NeonRadius.lg, style: .continuous)
        Button(action: onTap) {
            HStack(spacing: NeonSpace.md) {
                ShareConversationFace(conversation: conversation, size: 46)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(verbatim: conversation.title)
                            .font(.neonRowTitle)
                            .foregroundStyle(Color.neonInk)
                            .lineLimit(1)
                            .environment(\.layoutDirection, shareTextDirection(conversation.title) ?? AppLanguage.current.layoutDirection)
                        if conversation.pinned {
                            Image(systemName: "pin.fill")
                                .font(.system(.caption, weight: .semibold))
                                .rotationEffect(.degrees(40))
                                .foregroundStyle(Color.neonTextTertiary)
                                .accessibilityLabel(L("Pinned"))
                        }
                    }
                    if let secondLine {
                        Text(verbatim: secondLine)
                            .font(.neonSubheadline)
                            .foregroundStyle(Color.neonTextSecondary)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: NeonSpace.sm)
                ShareCheck(isOn: isSelected)
            }
            .padding(.vertical, 9)
            .padding(.horizontal, NeonSpace.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(shape.fill(isSelected ? NeonHue.indigo.wash : Color.white.opacity(0.92)))
            .overlay(shape.strokeBorder(isSelected ? AnyShapeStyle(Color.neonAccent.opacity(0.45)) : AnyShapeStyle(LinearGradient.neonGlassEdge), lineWidth: isSelected ? 1.5 : 1))
            .neonShadow(.low)
            .contentShape(shape)
        }
        .buttonStyle(PressableStyle(scale: 0.985))
        .dynamicTypeSize(...DynamicTypeSize.accessibility1)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

/// The tick: an indigo disc with a check, or an empty grey ring.
struct ShareCheck: View {
    let isOn: Bool
    var size: CGFloat = 26

    var body: some View {
        ZStack {
            if isOn {
                Circle()
                    .fill(LinearGradient.neonAccent)
                    .shadow(color: Color.neonAccent.opacity(0.3), radius: 5, x: 0, y: 2)
                Image(systemName: "checkmark")
                    .font(.system(size: size * 0.46, weight: .bold))
                    .foregroundStyle(.white)
                    .transition(.neonPop)
            } else {
                Circle().strokeBorder(Color.neonTextFaint, lineWidth: 1.8)
            }
        }
        .frame(width: size, height: size)
        .animation(NeonMotion.bouncy, value: isOn)
        .accessibilityHidden(true)
    }
}

struct ShareSkeletonRow: View {
    @State private var dim = false

    var body: some View {
        HStack(spacing: NeonSpace.md) {
            Circle().fill(Color.neonInk.opacity(0.07)).frame(width: 46, height: 46)
            VStack(alignment: .leading, spacing: 7) {
                RoundedRectangle(cornerRadius: 4).fill(Color.neonInk.opacity(0.08)).frame(width: 140, height: 12)
                RoundedRectangle(cornerRadius: 4).fill(Color.neonInk.opacity(0.05)).frame(width: 90, height: 10)
            }
            Spacer()
        }
        .padding(.vertical, 9)
        .padding(.horizontal, NeonSpace.md)
        .background(RoundedRectangle(cornerRadius: NeonRadius.lg, style: .continuous).fill(Color.white.opacity(0.85)))
        .opacity(dim ? 0.55 : 1)
        .onAppear {
            guard !NeonMotion.reduceMotion else { return }
            withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { dim = true }
        }
        .accessibilityHidden(true)
    }
}

// MARK: - The bottom: who, the caption, Send

struct ShareBottomBar: View {
    @ObservedObject var model: ShareModel
    @FocusState private var writing: Bool

    var body: some View {
        VStack(spacing: 10) {
            if let sending = model.sending {
                ShareSendingCard(model: model, sending: sending)
                    .transition(.neonRise)
            } else {
                if !model.selectedConversations.isEmpty {
                    chosen.transition(.neonRise)
                }
                composer
            }
        }
        .padding(.horizontal, NeonSpace.gutter)
        .padding(.top, NeonSpace.md)
        .padding(.bottom, NeonSpace.sm)
        .background {
            Rectangle()
                .fill(.ultraThinMaterial)
                .overlay(alignment: .top) { Rectangle().fill(Color.neonLine).frame(height: 1) }
                .ignoresSafeArea(edges: .bottom)
        }
        .animation(NeonMotion.snappy, value: model.selected)
        .animation(NeonMotion.snappy, value: model.sending)
    }

    /// The chats ticked so far, each with a way to take it off again.
    private var chosen: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(model.selectedConversations) { conversation in
                    Button {
                        model.toggle(conversation)
                    } label: {
                        HStack(spacing: 6) {
                            ShareConversationFace(conversation: conversation, size: 22)
                            Text(verbatim: conversation.title)
                                .font(.system(.footnote, weight: .semibold))
                                .foregroundStyle(Color.neonInk)
                                .lineLimit(1)
                            Image(systemName: "xmark")
                                .font(.system(size: 9, weight: .bold))
                                .foregroundStyle(Color.neonTextTertiary)
                        }
                        .padding(.leading, 4)
                        .padding(.trailing, 10)
                        .padding(.vertical, 4)
                        .background(Capsule().fill(Color.white))
                        .overlay(Capsule().strokeBorder(Color.neonAccent.opacity(0.25), lineWidth: 1))
                    }
                    .buttonStyle(PressableStyle(scale: 0.95))
                    .accessibilityLabel(L("Remove %@", conversation.title))
                }
            }
        }
    }

    private var composer: some View {
        HStack(alignment: .bottom, spacing: 10) {
            TextField(
                "",
                text: $model.message,
                prompt: Text(model.isTextOnly ? L("Message") : L("Add a caption…")).foregroundColor(Color.neonTextTertiary),
                axis: .vertical
            )
            .lineLimit(1...(model.isTextOnly ? 6 : 4))
            .font(.neonCallout)
            .foregroundStyle(Color.neonInk)
            .focused($writing)
            .padding(.horizontal, NeonSpace.lg)
            .padding(.vertical, 12)
            .background(RoundedRectangle(cornerRadius: 23, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 23, style: .continuous).strokeBorder(writing ? Color.neonAccent.opacity(0.5) : Color.neonLine, lineWidth: writing ? 1.5 : 1))
            .onChange(of: model.message) { value in
                if value.count > ShareModel.maxMessage { model.message = String(value.prefix(ShareModel.maxMessage)) }
            }

            Button {
                writing = false
                model.send()
            } label: {
                ZStack {
                    Circle().fill(model.canSend ? AnyShapeStyle(LinearGradient.neonAction) : AnyShapeStyle(Color.neonInk.opacity(0.12)))
                    Image(systemName: "paperplane.fill")
                        .font(.system(size: 19, weight: .semibold))
                        .foregroundStyle(.white)
                        .flipsForRightToLeftLayoutDirection(true)
                }
                .frame(width: 48, height: 48)
                .shadow(color: model.canSend ? Color.neonIndigo.opacity(0.35) : .clear, radius: 8, x: 0, y: 4)
            }
            .buttonStyle(PressableStyle(scale: 0.92))
            .disabled(!model.canSend)
            .accessibilityLabel(L("Send"))
        }
    }
}

/// Where a send stands: which of how many, the bar, and then Sent — or what
/// failed, with the way on.
struct ShareSendingCard: View {
    @ObservedObject var model: ShareModel
    let sending: ShareModel.Sending

    var body: some View {
        Group {
            switch sending {
            case let .working(step, total, detail, fraction):
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: NeonSpace.md) {
                        ProgressView().tint(Color.neonAccent)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(total > 1 ? L("Sending %d of %d…", step, total) : L("Sending…"))
                                .font(.neonHeadline)
                                .foregroundStyle(Color.neonInk)
                                .monospacedDigit()
                            Text(verbatim: detail)
                                .font(.neonFootnote)
                                .foregroundStyle(Color.neonTextSecondary)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        }
                        Spacer(minLength: 0)
                    }
                    ProgressView(value: min(1, (Double(step - 1) + (fraction ?? 0)) / Double(max(total, 1))))
                        .tint(Color.neonAccent)
                        .animation(NeonMotion.smooth, value: fraction)
                }
            case let .failed(message, skippable):
                VStack(alignment: .leading, spacing: NeonSpace.md) {
                    HStack(alignment: .top, spacing: NeonSpace.md) {
                        Image(systemName: "exclamationmark.circle.fill")
                            .font(.system(.title3, weight: .semibold))
                            .foregroundStyle(Color.neonDanger)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(L("Not sent"))
                                .font(.neonHeadline)
                                .foregroundStyle(Color.neonInk)
                            Text(message)
                                .font(.neonFootnote)
                                .foregroundStyle(Color.neonTextSecondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer(minLength: 0)
                    }
                    HStack(spacing: NeonSpace.sm) {
                        ShareCapsuleButton(title: L("Try again"), kind: .primary, action: model.retry)
                        if let skippable {
                            ShareCapsuleButton(title: L("Skip it"), kind: .secondary) { model.skip(skippable) }
                        }
                    }
                }
            case .done:
                HStack(spacing: NeonSpace.md) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 30, weight: .semibold))
                        .foregroundStyle(Color.neonSuccess)
                        .transition(.neonPop)
                    Text(L("Sent"))
                        .font(.neonTitle3)
                        .foregroundStyle(Color.neonInk)
                    Spacer(minLength: 0)
                }
            }
        }
        .padding(NeonSpace.card)
        .frame(maxWidth: .infinity, alignment: .leading)
        .neonSurface(.strong)
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Small pieces

struct ShareCapsuleButton: View {
    enum Kind { case primary, secondary }

    let title: String
    var kind: Kind = .primary
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(.subheadline, weight: .semibold))
                .foregroundStyle(kind == .primary ? Color.white : Color.neonInk)
                .padding(.horizontal, NeonSpace.xl)
                .frame(minHeight: 42)
                .background {
                    if kind == .primary {
                        Capsule().fill(LinearGradient.neonAccent)
                    } else {
                        Capsule().fill(Color.white).overlay(Capsule().strokeBorder(Color.neonLineStrong, lineWidth: 1))
                    }
                }
                .contentShape(Capsule())
        }
        .buttonStyle(PressableStyle(scale: 0.95))
    }
}

/// The studio's mark on a white disc with a soft halo.
struct ShareStudioBadge: View {
    var size: CGFloat = 76

    var body: some View {
        ShareConversationFace(conversation: ShareConversation(slug: "team", title: "NEON", isGroup: true), size: size)
            .padding(6)
            .background(Circle().fill(Color.white))
            .shadow(color: Color.neonIndigo.opacity(0.25), radius: 18, x: 0, y: 8)
    }
}
