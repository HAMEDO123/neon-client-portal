import SwiftUI

// The pieces the conversation list is drawn from: people's faces, the
// studio's mark, the filters, a conversation's card with its ticks and
// streak, a task card for the Tasks filter, and the search box.

// MARK: - Colour

/// A person's colour family: the one the studio gave them (`color` on the
/// server: "cyan", "purple"…) when there is one, else a stable one for their
/// name. The chat room colours senders' names from the same family.
enum ChatTint {
    /// In the order a name without a colour of its own picks from — kept
    /// stable, so nobody's colour changes between releases.
    static let hues: [NeonHue] = [.purple, .pink, .cyan, .orange, .green, .indigo]

    /// nil for "ink", the manager's: a dark face rather than a colour.
    static func hue(name: String, color: String? = nil) -> NeonHue? {
        switch color?.lowercased() {
        case "ink": return nil
        case "purple", "violet": return .purple
        case "pink", "rose", "fuchsia": return .pink
        case "cyan", "sky", "teal": return .cyan
        case "orange", "amber", "yellow": return .orange
        case "green", "emerald", "lime": return .green
        case "blue", "indigo": return .indigo
        default:
            let seed = name.unicodeScalars.reduce(0) { ($0 &* 31 &+ Int($1.value)) & 0x7FFF_FFFF }
            return hues[seed % hues.count]
        }
    }

    /// The light and the deep end of somebody's colour.
    static func pair(name: String, color: String? = nil) -> (Color, Color) {
        guard let hue = hue(name: name, color: color) else { return (NeonHue.grey.deep, .neonInk) }
        return (hue.color, hue.deep)
    }

    static func gradient(name: String, color: String? = nil) -> LinearGradient {
        let (light, deep) = pair(name: name, color: color)
        return LinearGradient(colors: [light, deep], startPoint: .topLeading, endPoint: .bottomTrailing)
    }
}

// MARK: - Faces

/// What the server hands over as somebody's picture. Most people have no
/// photo, and the server then answers `/api/avatar?name=…&color=…` — their
/// initials on the colour the studio gave them, the face the web and the
/// notifications show. That one is drawn here, crisp at any size and with no
/// download; anything else is a real photo and is loaded.
struct ChatFace {
    let photo: URL?
    let color: String?

    init(url: URL?, color: String? = nil) {
        if let url, url.path == "/api/avatar" {
            let items = URLComponents(url: url, resolvingAgainstBaseURL: true)?.queryItems ?? []
            self.photo = nil
            self.color = color ?? items.first { $0.name == "color" }?.value
        } else {
            self.photo = url
            self.color = color
        }
    }

    /// GROUP_AVATAR in src/lib/chat-conversations.ts: the studio's icon, which
    /// the team and every group without a photo of its own are sent.
    static let studioIconPath = "/admin-icon-192.png"

    static func isStudioIcon(_ url: URL?) -> Bool { url?.path == studioIconPath }
}

/// A photo, or bold white initials on the person's own colour — with the
/// green dot when they are here right now.
struct ChatAvatar: View {
    let url: URL?
    let name: String
    var size: CGFloat = 54
    var color: String?
    var online = false
    var isGroup = false

    var body: some View {
        let face = ChatFace(url: url, color: color)
        ZStack {
            ChatTint.gradient(name: name, color: face.color)
            if isGroup && face.photo == nil {
                Image(systemName: "person.3.fill")
                    .font(.system(size: size * 0.3, weight: .semibold))
                    .foregroundStyle(.white)
            } else {
                Text(AvatarView.initials(name, size: size))
                    .font(.system(size: size * 0.4, weight: .bold))
                    .foregroundStyle(.white)
            }
            if let photo = face.photo {
                PipelineImage(url: photo, points: size)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(alignment: .bottomTrailing) {
            if online {
                OnlineDot(size: max(10, size * 0.27))
                    .offset(x: size * 0.02, y: size * 0.02)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: name))
        .accessibilityValue(online ? Text(L("Online now")) : Text(""))
    }
}

/// The studio's own mark, round: the app icon, or the website's icon.
struct ChatStudioMark: View {
    var size: CGFloat = 48
    private static let icon = UIImage(named: "AppIcon60x60")

    var body: some View {
        ZStack {
            Color.white
            if let icon = Self.icon {
                Image(uiImage: icon).resizable().interpolation(.high).scaledToFill()
            } else {
                PipelineImage(url: resolvedMediaURL(ChatFace.studioIconPath), points: size)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        // A hairline, so the white disc stays a disc on the lavender page.
        .overlay(Circle().strokeBorder(Color.neonLine, lineWidth: 1))
        .neonShadow(.low)
        .accessibilityLabel(Text(verbatim: "NEON"))
    }
}

/// A conversation's face: the studio's mark for the team, a group's photo or
/// its colour with a group glyph, a person's face with their green dot.
struct ChatConversationAvatar: View {
    let conversation: ConversationSummary
    var size: CGFloat = 50
    var showsOnline = true

    var body: some View {
        if conversation.slug == "team" {
            ChatStudioMark(size: size)
        } else {
            ChatAvatar(
                url: conversation.isGroup && ChatFace.isStudioIcon(conversation.avatarURL) ? nil : conversation.avatarURL,
                name: conversation.title,
                size: size,
                online: showsOnline && conversation.online == true,
                isGroup: conversation.isGroup
            )
        }
    }
}

// MARK: - Filters

enum ChatListFilter: String, CaseIterable, Hashable {
    case all, unread, groups, tasks, favorites

    var label: String {
        switch self {
        case .all: return L("All")
        case .unread: return L("Unread")
        case .groups: return L("Groups")
        case .tasks: return L("Tasks")
        case .favorites: return L("Favorites")
        }
    }
}

// MARK: - Search

/// The kit's search capsule, with focus that can be set from outside, so
/// tapping the header's magnifier puts the cursor straight in it.
struct ChatListSearchField: View {
    @Binding var text: String
    var prompt: String
    var focus: FocusState<Bool>.Binding

    var body: some View {
        let focused = focus.wrappedValue
        HStack(spacing: NeonSpace.sm) {
            Image(systemName: "magnifyingglass")
                .font(.system(.subheadline, weight: .semibold))
                .foregroundStyle(focused ? Color.neonAccent : Color.neonTextTertiary)
            TextField("", text: $text, prompt: Text(prompt).foregroundColor(Color.neonTextTertiary))
                .font(.neonCallout)
                .foregroundStyle(Color.neonInk)
                .focused(focus)
                .submitLabel(.search)
                .autocorrectionDisabled()
            if !text.isEmpty {
                Button {
                    Haptic.tap()
                    text = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(.callout))
                        .foregroundStyle(Color.neonTextFaint)
                }
                .buttonStyle(.plain)
                .transition(.neonPop)
                .accessibilityLabel(L("Clear"))
            }
        }
        .padding(.horizontal, NeonSpace.lg)
        .frame(minHeight: 46)
        .background(Capsule().fill(Color.white.opacity(focused ? 1 : 0.94)))
        .overlay(
            Capsule().strokeBorder(focused ? Color.neonAccent.opacity(0.5) : Color.neonLine, lineWidth: focused ? 1.5 : 1)
        )
        .neonShadow(focused ? .glow(.neonAccent.opacity(0.4)) : .low)
        .animation(NeonMotion.quick, value: focused)
        .animation(NeonMotion.snappy, value: text.isEmpty)
        .contentShape(Capsule())
        .onTapGesture { focus.wrappedValue = true }
    }
}

// MARK: - A conversation

/// What the card says under a conversation's name: who wrote last, set apart
/// from what they wrote.
struct ChatListPreview: Equatable {
    var prefix: String?
    var text: String

    init(_ conversation: ConversationSummary) {
        guard let last = conversation.last else {
            prefix = nil
            if conversation.isGroup, let count = conversation.memberCount {
                text = ChatCount.members(count)
            } else {
                text = conversation.subtitle ?? L("No messages yet")
            }
            return
        }
        let what = Self.what(last)
        if last.mine == true {
            // "You: %@" in whichever language; the part before the message is the prefix.
            let full = L("You: %@", what)
            if full.hasSuffix(what), full.count > what.count {
                prefix = String(full.dropLast(what.count))
                text = what
            } else {
                prefix = nil
                text = full
            }
        } else if conversation.isGroup, let author = last.authorName, !author.isEmpty, last.kind != "CALL" {
            prefix = "\(author): "
            text = what
        } else {
            prefix = nil
            text = what
        }
    }

    /// The same words `LastMessage.preview` uses for each kind.
    private static func what(_ last: LastMessage) -> String {
        switch last.kind {
        case "IMAGE": return L("📷 Photo")
        case "FILE":
            return chatIsVideoAttachment(type: nil, name: last.attachmentName) ? L("🎥 Video") : "📎 " + (last.attachmentName ?? L("File"))
        case "VOICE": return L("🎤 Voice message")
        case "TASK": return "✅ " + (last.body ?? L("Task"))
        case "MEETING": return "📅 " + (last.body ?? L("Meeting"))
        case "CALL": return "📞 " + (last.body ?? L("Call"))
        default: return last.body ?? ""
        }
    }

    var full: String { (prefix ?? "") + text }
}

/// One conversation on its own white card, as in the owner's mockup: the
/// face with its green dot; the name, a pin and the streak; the time and a
/// chevron; under it who wrote last and what, with my ticks; and on the
/// trailing side the muted bell and the red unread count. Pinned adds the
/// accent bar on the leading edge.
struct ChatConversationCard: View {
    let conversation: ConversationSummary
    /// How far my last message has got, when it is mine and the server said.
    var delivery: ChatDelivery?

    var body: some View {
        let unread = conversation.unread > 0
        let preview = ChatListPreview(conversation)
        HStack(spacing: NeonSpace.md) {
            ChatConversationAvatar(conversation: conversation, size: 50)

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    DirText(conversation.title, font: .system(.body, weight: .bold), fill: false, lineLimit: 1)
                        .layoutPriority(1)
                    if conversation.pinned {
                        Image(systemName: "pin.fill")
                            .font(.system(.caption, weight: .semibold))
                            .rotationEffect(.degrees(40))
                            .foregroundStyle(Color.neonTextTertiary)
                            .transition(.neonPop)
                            .accessibilityLabel(L("Pinned"))
                    }
                    if let streak = conversation.streak, streak.count >= ChatStreakBadge.shownFrom {
                        ChatStreakBadge(streak: streak)
                    }
                    if conversation.favorite {
                        Image(systemName: "star.fill")
                            .font(.system(.caption2, weight: .bold))
                            .foregroundStyle(Color.neonAmber)
                            .transition(.neonPop)
                            .accessibilityLabel(L("Favorite"))
                    }
                    Spacer(minLength: 6)
                    if let time = chatListTime(conversation.last?.createdAt) {
                        Text(time)
                            .font(.system(.footnote, weight: unread ? .semibold : .regular))
                            .foregroundStyle(unread ? Color.neonAccent : Color.neonTextTertiary)
                            .lineLimit(1)
                            .fixedSize()
                    }
                    Image(systemName: "chevron.forward")
                        .font(.system(.caption, weight: .semibold))
                        .foregroundStyle(Color.neonTextFaint)
                }

                HStack(spacing: 5) {
                    if let delivery {
                        ChatTicks(delivery: delivery, tint: Color.neonTextTertiary, readTint: ChatTickPalette.readOnLight)
                            .transition(.neonPop)
                    }
                    ChatListPreviewText(preview: preview, emphasised: unread)
                    Spacer(minLength: 4)
                    if conversation.muted {
                        Image(systemName: "bell.slash.fill")
                            .font(.system(.footnote, weight: .semibold))
                            .foregroundStyle(Color.neonTextFaint)
                            .transition(.neonPop)
                            .accessibilityLabel(L("Muted"))
                    }
                    if unread {
                        CountBadge(conversation.unread, tone: conversation.muted ? .neutral : .danger, size: 22)
                            .neonShadow(conversation.muted ? .none : .glow(.neonDanger.opacity(0.5)))
                    }
                }
            }
        }
        .padding(.vertical, 8)
        .padding(.leading, NeonSpace.md)
        .padding(.trailing, NeonSpace.md + 2)
        .rowCard(pinned: conversation.pinned, highlighted: unread)
        .animation(NeonMotion.snappy, value: conversation.pinned)
        .animation(NeonMotion.snappy, value: conversation.muted)
        .animation(NeonMotion.snappy, value: conversation.favorite)
        .animation(NeonMotion.bouncy, value: conversation.unread)
        .dynamicTypeSize(...DynamicTypeSize.accessibility1)
        .accessibilityElement(children: .combine)
        .accessibilityHint(unread ? L("%d unread", conversation.unread) : "")
    }
}

/// The preview line: the prefix ("You: ", "Ahmed: ") in ink, the message in
/// grey, laid out in the direction the whole line is written.
struct ChatListPreviewText: View {
    let preview: ChatListPreview
    var emphasised = false

    var body: some View {
        let direction = naturalDirection(preview.full) ?? AppLanguage.current.layoutDirection
        let body = Text(verbatim: preview.text)
            .foregroundColor(emphasised ? Color.neonInk.opacity(0.8) : Color.neonTextSecondary)
        Group {
            if let prefix = preview.prefix {
                Text(verbatim: prefix).foregroundColor(Color.neonInk.opacity(0.72)).fontWeight(.medium) + body
            } else {
                body
            }
        }
        .font(.system(.subheadline, weight: emphasised ? .medium : .regular))
        .lineLimit(1)
        .environment(\.layoutDirection, direction)
    }
}

/// Days in a row, in the kit's badge language: a flame and the count, and a
/// clock instead of the flame while today still needs a message from both.
/// Shown from three days: a day or two is every recent chat, and it would
/// only compete with the name.
struct ChatStreakBadge: View {
    let streak: ChatStreak

    static let shownFrom = 3

    var body: some View {
        BadgeView(
            text: NeonFormat.integer(streak.count),
            tone: streak.atRisk ? .warning : .orange,
            symbol: streak.atRisk ? "clock.fill" : "flame.fill"
        )
        .monospacedDigit()
        .fixedSize()
        .accessibilityElement(children: .ignore)
        // "5-day streak"; Arabic takes its plural forms from ChatList.stringsdict.
        .accessibilityLabel(ChatCount.streak(streak.count, atRisk: streak.atRisk))
    }
}

// MARK: - A task card, for the Tasks filter

/// One task handed out in a chat: where it lives, when it is due, and each
/// person on it with where their part stands. Done comes only from the
/// manager, so a card reads "Sent for review" until then.
struct ChatListTaskCard: View {
    let item: ChatTaskListItem

    private var overdue: Bool {
        guard item.overall != "DONE", let due = parseISODate(item.dueAt) else { return false }
        return due < Date()
    }

    private var hue: NeonHue {
        switch item.overall {
        case "IN_PROGRESS": return .cyan
        case "SUBMITTED": return .purple
        case "DONE": return .green
        default: return overdue ? .red : .indigo
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: NeonSpace.md) {
            IconTile(StateBadge.symbol(for: item.overall) ?? "checklist", hue: hue, size: NeonSize.iconTileLarge)
            VStack(alignment: .leading, spacing: 8) {
                VStack(alignment: .leading, spacing: 4) {
                    DirText(item.title, font: .neonRowTitle, fill: false, lineLimit: 2)
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 10) { whereLabel; dueLabel }
                        VStack(alignment: .leading, spacing: 3) { whereLabel; dueLabel }
                    }
                }
                FlowRow(spacing: 6) {
                    StateBadge(cardStateLabel(item.overall), tone: taskStateTone(item.overall),
                               symbol: StateBadge.symbol(for: item.overall), pulsing: item.overall == "IN_PROGRESS")
                    ForEach(item.assignments) { part in
                        // Where this person's part stands, as a symbol on the
                        // state's own wash — never a green dot, which is "online".
                        let tone = taskStateTone(part.state)
                        HStack(spacing: 5) {
                            Image(systemName: Self.partSymbol(part.state))
                                .font(.system(.caption2, weight: .bold))
                                .foregroundStyle(tone.hue.deep)
                            DirText(part.employee?.name ?? "—", font: .system(.caption, weight: .semibold),
                                    color: .neonInk.opacity(0.85), fill: false, lineLimit: 1)
                        }
                        .padding(.horizontal, 9)
                        .padding(.vertical, 4)
                        .background(Capsule().fill(tone.hue.wash))
                        .overlay(Capsule().strokeBorder(tone.hue.color.opacity(0.16), lineWidth: 1))
                        .accessibilityElement(children: .combine)
                        .accessibilityValue(cardStateLabel(part.state))
                    }
                }
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.forward")
                .font(.system(.caption, weight: .semibold))
                .foregroundStyle(Color.neonTextFaint)
                .padding(.top, 4)
        }
        .padding(NeonSpace.md + 2)
        .rowCard(highlighted: item.overall == "SUBMITTED")
        .accessibilityElement(children: .combine)
    }

    private var whereLabel: some View {
        HStack(spacing: 4) {
            Image(systemName: item.isGroup ? "person.3.fill" : "bubble.left.fill")
                .font(.system(.caption2, weight: .semibold))
                .foregroundStyle(Color.neonTextTertiary)
            DirText(item.conversationTitle, font: .neonCaption, color: .neonTextSecondary, fill: false, lineLimit: 1)
        }
    }

    /// A finished card has no due date worth reading: the badge already says Done.
    @ViewBuilder
    private var dueLabel: some View {
        if item.overall != "DONE", let due = parseISODate(item.dueAt) {
            MetaLabel(L("Due %@", chatDueText(due)), symbol: overdue ? "exclamationmark.circle.fill" : "clock",
                      tint: overdue ? .neonDangerStrong : .neonTextTertiary)
        }
    }

    /// StateBadge's symbols, with a half-filled circle for work under way.
    static func partSymbol(_ state: String) -> String {
        StateBadge.symbol(for: state) ?? (state == "IN_PROGRESS" ? "circle.lefthalf.filled" : "circle")
    }
}

// MARK: - Counts and dates

/// A count with its noun. English picks "1 view" or "3 views" by the key;
/// Arabic reads every form (one, two, 3–10, 11–99, 100…) from
/// ChatList.stringsdict, which holds both keys. `%lld` keys, so that a plain
/// `%d` entry in another table can never answer first.
///
/// Formatted in the app's own language: `L(_:_:)` formats with no locale,
/// and a stringsdict then picks its form by English rules (one / other), so
/// Arabic would read «3 مشاهدة» instead of «3 مشاهدات».
enum ChatCount {
    static func views(_ n: Int) -> String { plural(n == 1 ? "%lld view" : "%lld views", n) }
    static func people(_ n: Int) -> String { plural(n == 1 ? "%lld person" : "%lld people", n) }
    static func members(_ n: Int) -> String { plural(n == 1 ? "%lld member" : "%lld members", n) }
    static func streak(_ n: Int, atRisk: Bool) -> String {
        plural(atRisk ? "%lld-day streak, write today to keep it" : "%lld-day streak", n)
    }

    private static func plural(_ key: String, _ n: Int) -> String {
        String(format: L(key), locale: AppLanguage.current.locale, n)
    }
}

/// When a conversation last moved, as short as it can be said: the time
/// today, "Yesterday", the weekday within the week, "Sep 10" within the
/// year, and the year only before that — never a numeric date, which a
/// Jordanian reader takes day-first and an English phone writes month-first.
func chatListTime(_ iso: String?, now: Date = Date()) -> String? {
    guard let date = parseISODate(iso) else { return nil }
    let calendar = Calendar.current
    let locale = AppLanguage.current.locale
    if calendar.isDateInToday(date) {
        return date.formatted(Date.FormatStyle(date: .omitted, time: .shortened, locale: locale))
    }
    if calendar.isDateInYesterday(date) { return L("Yesterday") }
    let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: date), to: calendar.startOfDay(for: now)).day ?? 0
    if days > 0, days < 7 {
        return date.formatted(Date.FormatStyle(locale: locale).weekday(.wide))
    }
    if calendar.isDate(date, equalTo: now, toGranularity: .year) {
        return date.formatted(Date.FormatStyle(locale: locale).month(.abbreviated).day())
    }
    return date.formatted(Date.FormatStyle(locale: locale).year().month(.abbreviated).day())
}

/// A due moment, short: "Sep 16, 7 PM" (minutes only when there are some,
/// the year only when it is not this one).
func chatDueText(_ date: Date, now: Date = Date()) -> String {
    let calendar = Calendar.current
    var style = Date.FormatStyle(locale: AppLanguage.current.locale).month(.abbreviated).day()
    if !calendar.isDate(date, equalTo: now, toGranularity: .year) { style = style.year() }
    style = style.hour(.defaultDigits(amPM: .abbreviated))
    if calendar.component(.minute, from: date) != 0 { style = style.minute() }
    return date.formatted(style)
}

// MARK: - The filters, on one line where they fit

/// The kit's pill bar, drawn a little tighter first so the five filters sit
/// on one line as in the mockup; where even that does not fit (a narrow phone,
/// large text) it is the kit's own bar, which scrolls.
struct ChatListFilterBar: View {
    @Binding var selection: ChatListFilter
    let unreadCount: Int

    @Namespace private var namespace

    var body: some View {
        ViewThatFits(in: .horizontal) {
            row(padding: 10)
            row(padding: 6)
            PillFilterBar(
                selection: $selection,
                options: ChatListFilter.allCases,
                title: { $0.label },
                count: { $0 == .unread ? unreadCount : nil }
            )
        }
    }

    private func row(padding: CGFloat) -> some View {
        HStack(spacing: 0) {
            ForEach(ChatListFilter.allCases, id: \.self) { option in
                pill(option, padding: padding).frame(maxWidth: .infinity)
            }
        }
        .padding(4)
        .background(Capsule().fill(Color.white.opacity(0.94)))
        .overlay(Capsule().strokeBorder(Color.neonLine, lineWidth: 1))
        .clipShape(Capsule())
        .neonShadow(.low)
    }

    private func pill(_ option: ChatListFilter, padding: CGFloat) -> some View {
        let selected = option == selection
        return Button {
            guard !selected else { return }
            Haptic.selection()
            withNeonAnimation(NeonMotion.snappy) { selection = option }
        } label: {
            HStack(spacing: 5) {
                Text(option.label)
                    .lineLimit(1)
                    .fixedSize()
                if option == .unread, unreadCount > 0 {
                    CountBadge(unreadCount, tone: .danger, size: 18)
                }
            }
            .font(.system(.subheadline, weight: selected ? .semibold : .medium))
            .foregroundStyle(selected ? Color.white : Color.neonInk.opacity(0.82))
            .padding(.horizontal, padding)
            .frame(minHeight: 38)
            .frame(maxWidth: .infinity)
            .background {
                if selected {
                    Capsule()
                        .fill(LinearGradient.neonAccent)
                        .shadow(color: Color.neonAccent.opacity(0.3), radius: 4, x: 0, y: 2)
                        .matchedGeometryEffect(id: "pill", in: namespace)
                }
            }
            .contentShape(Capsule())
        }
        .buttonStyle(PressableStyle(scale: 0.95))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

// MARK: - A big choice

/// A tappable white card with a filled tile, a title and a line under it,
/// washed with its colour towards the trailing corner: "New group", "Camera".
/// The label only — wrap it in a Button or a NavigationLink with `.pressableCard`.
struct ChatListActionTile: View {
    let title: String
    let detail: String
    let symbol: String
    var hue: NeonHue = .indigo

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: NeonRadius.lg, style: .continuous)
        HStack(spacing: 14) {
            IconTile(symbol, hue: hue, size: 52, style: .filled)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.neonCardTitle)
                    .foregroundStyle(Color.neonInk)
                Text(detail)
                    .font(.neonSubtitle)
                    .foregroundStyle(Color.neonTextSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.forward")
                .font(.system(.footnote, weight: .semibold))
                .foregroundStyle(Color.neonTextFaint)
        }
        .padding(NeonSpace.card)
        .background(shape.fill(LinearGradient(colors: [.white, hue.wash], startPoint: .topLeading, endPoint: .bottomTrailing)))
        .overlay(shape.strokeBorder(LinearGradient.neonGlassEdge, lineWidth: 1))
        .neonShadow(.card)
        .contentShape(shape)
        .accessibilityElement(children: .combine)
    }
}
