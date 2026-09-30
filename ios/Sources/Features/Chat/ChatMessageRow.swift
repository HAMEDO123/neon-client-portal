import SwiftUI
import UIKit

// How a conversation's messages are laid out: the rows (a day's heading,
// one message, a grid of photos, a message still on its way), and how each
// message is drawn — a bubble with a tail on the first of a run, its time and
// ticks inside it, WhatsApp's way; a photo with no bubble at all, its time and
// ticks over the picture; a voice note with its own sound's bars; the task
// and meeting cards; a call's line across the conversation.

// MARK: - Rows

/// One row of the conversation.
enum ChatRowItem: Identifiable {
    case day(key: String, iso: String)
    /// `firstInRun`: the first of a run of messages from one person, which
    /// wears the bubble's tail and a little more space above it.
    case message(ChatMessage, showAuthor: Bool, firstInRun: Bool)
    /// Four or more photos in a row from one person, as one grid.
    case album([ChatMessage], showAuthor: Bool)
    case outgoing(ChatOutgoing, firstInRun: Bool)

    var id: String {
        switch self {
        case .day(let key, _): return "day-\(key)"
        case .message(let message, _, _): return message.id
        case .album(let photos, _): return "album-\(photos.first?.id ?? "")"
        case .outgoing(let item, _): return item.id
        }
    }

    /// The messages a row holds, for finding the row a message is in.
    var messageIds: [String] {
        switch self {
        case .day: return []
        case .message(let message, _, _): return [message.id]
        case .album(let photos, _): return photos.map(\.id)
        case .outgoing(let item, _): return [item.id]
        }
    }
}

/// How many photos in a row become a grid — WhatsApp's own number.
private let chatAlbumMinimum = 4

/// Builds the rows: day headings between days, runs of photos folded into
/// grids, and what this phone is still sending at the end. While searching,
/// only the matching messages, with no headings and no grids.
func chatRows(
    messages: [ChatMessage],
    pending: [ChatOutgoing],
    searching: Bool,
    isGroup: Bool,
    identity: Identity?,
    groupable: (ChatMessage) -> Bool
) -> [ChatRowItem] {
    var rows: [ChatRowItem] = []
    var previous: ChatMessage?
    var index = 0

    func sameAuthor(_ a: ChatMessage?, _ b: ChatMessage) -> Bool {
        guard let a else { return false }
        return a.authorType == b.authorType && a.authorId == b.authorId && a.kind != "CALL" && b.kind != "CALL"
    }

    func sameDay(_ a: ChatMessage?, _ b: ChatMessage) -> Bool {
        guard let a, let first = parseISODate(a.createdAt), let second = parseISODate(b.createdAt) else { return false }
        return Calendar.current.isDate(first, inSameDayAs: second)
    }

    while index < messages.count {
        let message = messages[index]
        if !searching, !sameDay(previous, message), let date = parseISODate(message.createdAt) {
            let key = NeonFormat.dayKey(date)
            rows.append(.day(key: key, iso: message.createdAt))
        }
        let firstInRun = !sameAuthor(previous, message) || !sameDay(previous, message)
        let showAuthor = isGroup && firstInRun && !message.isMine(identity)

        // A run of photos from one person, close together: a grid.
        if !searching, groupable(message) {
            var end = index + 1
            while end < messages.count,
                  groupable(messages[end]),
                  sameAuthor(messages[end - 1], messages[end]),
                  sameDay(messages[end - 1], messages[end]),
                  let before = parseISODate(messages[end - 1].createdAt),
                  let after = parseISODate(messages[end].createdAt),
                  after.timeIntervalSince(before) < 10 * 60 {
                end += 1
            }
            if end - index >= chatAlbumMinimum {
                let photos = Array(messages[index..<end])
                rows.append(.album(photos, showAuthor: showAuthor))
                previous = photos.last
                index = end
                continue
            }
        }

        rows.append(.message(message, showAuthor: showAuthor, firstInRun: firstInRun))
        previous = message
        index += 1
    }

    for item in pending {
        if !searching, !sameDay(previous, item.message), let date = parseISODate(item.message.createdAt) {
            rows.append(.day(key: NeonFormat.dayKey(date), iso: item.message.createdAt))
        }
        let firstInRun = !sameAuthor(previous, item.message) || !sameDay(previous, item.message)
        rows.append(.outgoing(item, firstInRun: firstInRun))
        previous = item.message
    }
    return rows
}

/// The day's chip between days: Today, Yesterday, or the date.
struct ChatDaySeparator: View {
    let iso: String

    var body: some View {
        Text(label)
            .font(.system(.caption, weight: .semibold))
            .foregroundStyle(Color.neonTextSecondary)
            .padding(.horizontal, 12)
            .padding(.vertical, 5)
            .background(Capsule().fill(Color.white.opacity(0.92)))
            .overlay(Capsule().strokeBorder(Color.neonLine, lineWidth: 0.75))
            .neonShadow(.low)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .accessibilityAddTraits(.isHeader)
    }

    private var label: String {
        guard let date = parseISODate(iso) else { return "" }
        if Calendar.current.isDateInToday(date) { return L("Today") }
        if Calendar.current.isDateInYesterday(date) { return L("Yesterday") }
        let sameYear = Calendar.current.isDate(date, equalTo: Date(), toGranularity: .year)
        let style = sameYear
            ? Date.FormatStyle(locale: AppLanguage.current.locale).weekday(.wide).day().month(.wide)
            : Date.FormatStyle(date: .abbreviated, time: .omitted, locale: AppLanguage.current.locale)
        return date.formatted(style)
    }
}

/// A message's time as the conversation shows it.
func chatClock(_ iso: String) -> String {
    guard let time = parseISODate(iso) else { return "" }
    return time.formatted(Date.FormatStyle(date: .omitted, time: .shortened, locale: AppLanguage.current.locale))
}

/// "1:05" — a voice note's length, or how far into it the player is.
func chatDuration(_ seconds: Double) -> String {
    let whole = max(0, Int(seconds.rounded()))
    return String(format: "%d:%02d", whole / 60, whole % 60)
}

/// Only emoji, and no more than three: drawn large with no bubble, as a
/// messaging app does.
func chatIsJumboEmoji(_ text: String) -> Bool {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, trimmed.count <= 3 else { return false }
    return trimmed.allSatisfy { character in
        let scalars = character.unicodeScalars
        guard let first = scalars.first else { return false }
        // Digits and # are "emoji" to Unicode only when a keycap follows.
        return first.properties.isEmojiPresentation || (first.properties.isEmoji && scalars.count > 1)
    }
}

// MARK: - The time inside a bubble

/// The time, and on my own messages the ticks, in a bubble's bottom corner.
struct ChatBubbleMeta: View {
    let time: String
    let delivery: ChatDelivery?
    let onDark: Bool
    var pinned = false
    var managerOnly = false

    var body: some View {
        HStack(spacing: 3) {
            if pinned { Image(systemName: "pin.fill").font(.system(size: 9, weight: .semibold)) }
            if managerOnly {
                Image(systemName: "eye.slash").font(.system(size: 9, weight: .semibold))
                Text(L("Only you"))
            }
            Text(time).monospacedDigit()
            if let delivery {
                // On my own indigo-to-violet bubble, read is solid white and
                // on its way a paler white — green belongs on white bubbles
                // and the list, not on violet.
                ChatTicks(
                    delivery: delivery,
                    tint: onDark ? .white.opacity(0.55) : Color.neonTextTertiary,
                    readTint: onDark ? Color.white : ChatTickPalette.readOnLight
                )
                .padding(.leading, 1)
            }
        }
        .font(.system(.caption2))
        .foregroundStyle(onDark ? Color.white.opacity(0.78) : Color.neonTextTertiary)
        .lineLimit(1)
        .fixedSize()
        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
    }
}

// MARK: - One message

struct ChatMessageRow: View {
    let message: ChatMessage
    let mine: Bool
    let showAuthor: Bool
    let tail: Bool
    /// The ticks, on my own messages; nil on anybody else's.
    let delivery: ChatDelivery?
    let viewerIdentity: Identity?
    let tallies: [ChatReactionTally]
    let isPinned: Bool
    let callSlug: String
    /// A group or the team: somebody else's messages carry who wrote them.
    var inGroup = false
    /// A stand-in for a message this phone is sending (or failed to).
    var outgoing: ChatOutgoing?
    let openImage: () -> Void
    let sendProof: (TaskCard.Assignment, TaskCard) -> Void
    let onReact: (String) -> Void
    let onPin: (Bool) -> Void
    let onDelete: (() -> Void)?
    let onCardChanged: () -> Void
    var onRetry: (() -> Void)?
    var onDiscard: (() -> Void)?
    var onMediaResize: (() -> Void)?

    @Environment(\.chatRoomPalette) private var palette

    private var bubbleShape: ChatBubbleShape { ChatBubbleShape(mine: mine, tail: tail) }
    private var isAgent: Bool { message.authorType == "AGENT" }

    var body: some View {
        switch message.kind {
        case "CALL":
            ChatCallLine(message: message, mine: mine)
        case "TASK":
            if let card = message.task {
                aligned(metaBelow: true, authorAbove: true) {
                    ChatTaskCardView(card: card, message: message, viewer: viewerIdentity, sendProof: sendProof, onChanged: onCardChanged)
                        .contextMenu { pinMenu }
                }
            } else {
                aligned { textBubble }
            }
        case "MEETING":
            if let meeting = message.meeting {
                aligned(metaBelow: true, authorAbove: true) {
                    ChatMeetingCardView(meeting: meeting, callSlug: callSlug, callTitle: message.body ?? "", viewer: viewerIdentity, onChanged: onCardChanged)
                        .contextMenu { pinMenu }
                }
            } else {
                aligned { textBubble }
            }
        default:
            if message.isPicture && (message.attachmentURL != nil || outgoing?.localImage != nil) {
                aligned(authorAbove: true) { photo }
            } else if message.kind == "TEXT", let text = message.body, message.project == nil, chatIsJumboEmoji(text) {
                aligned(metaBelow: true, authorAbove: true) { jumbo(text) }
            } else {
                aligned { textBubble }
            }
        }
    }

    // MARK: Menus

    @ViewBuilder
    private var menu: some View {
        if let outgoing {
            if outgoing.failure != nil {
                if let onRetry {
                    Button(action: onRetry) { Label(L("Retry"), systemImage: "arrow.clockwise") }
                }
                if let onDiscard {
                    Button(role: .destructive, action: onDiscard) { Label(L("Delete"), systemImage: "trash") }
                }
            }
        } else {
            ForEach(chatReactionSet, id: \.self) { emoji in
                Button { onReact(emoji) } label: { Text(emoji) }
            }
            if let body = message.body, !body.isEmpty {
                Button {
                    UIPasteboard.general.string = body
                    Haptic.tap()
                    Toast.info(L("Copied"))
                } label: { Label(L("Copy"), systemImage: "doc.on.doc") }
            }
            pinMenu
            if let onDelete {
                Button(role: .destructive, action: onDelete) { Label(L("Delete"), systemImage: "trash") }
            }
        }
    }

    @ViewBuilder
    private var pinMenu: some View {
        Button { onPin(!isPinned) } label: {
            Label(isPinned ? L("Unpin") : L("Pin"), systemImage: isPinned ? "pin.slash" : "pin")
        }
    }

    // MARK: Layout

    /// Mine on the trailing side, everybody else's on the leading side — which
    /// flips with the app's language, as a chat on either kind of phone does.
    /// In a group, somebody else's run starts with their initials beside it.
    private func aligned<Content: View>(metaBelow: Bool = false, authorAbove: Bool = false, @ViewBuilder _ content: () -> Content) -> some View {
        HStack(alignment: .top, spacing: 6) {
            if inGroup && !mine {
                ChatAuthorBadge(name: message.authorName, key: message.authorKey, isAgent: isAgent)
                    .opacity(showAuthor ? 1 : 0)
                    .accessibilityHidden(true)
            }
            VStack(alignment: mine ? .trailing : .leading, spacing: 0) {
                if authorAbove, showAuthor, !mine, let name = message.authorName {
                    authorLabel(name)
                        .padding(.leading, ChatBubbleShape.tailWidth + 4)
                        .padding(.bottom, 3)
                }
                // What is not a bubble (a photo, a card, big emoji) lines up
                // with the bubbles' bodies, clear of where their tails go.
                content()
                    .padding(mine ? .trailing : .leading, authorAbove ? ChatBubbleShape.tailWidth : 0)
                // Tucked up against the bubble's lower edge.
                ChatReactionRow(tallies: tallies, onToggle: onReact)
                    .fixedSize(horizontal: true, vertical: false)
                    .padding(.horizontal, 10 + (mine ? ChatBubbleShape.tailWidth : 0))
                    .padding(.leading, mine ? 0 : ChatBubbleShape.tailWidth)
                    .padding(.top, tallies.isEmpty ? 0 : -6)
                if metaBelow {
                    ChatBubbleMeta(time: chatClock(message.createdAt), delivery: delivery, onDark: false, pinned: isPinned, managerOnly: message.managerOnly == true)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Capsule().fill(Color.white.opacity(0.85)))
                        .padding(.top, 4)
                        .padding(mine ? .trailing : .leading, ChatBubbleShape.tailWidth)
                }
                if let failure = outgoing?.failure {
                    Button { onRetry?() } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "arrow.clockwise")
                            Text(L("Not sent. Tap to retry."))
                        }
                        .font(.system(.caption, weight: .semibold))
                        .foregroundStyle(Color.neonDangerStrong)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(Capsule().fill(NeonHue.red.wash))
                    }
                    .buttonStyle(.pressable)
                    .padding(.top, 4)
                    .accessibilityHint(failure)
                    .transition(.neonPop)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: mine ? .trailing : .leading)
        .padding(mine ? .leading : .trailing, 44)
        .padding(.top, tail ? 6 : 0)
    }

    private func authorLabel(_ name: String) -> some View {
        HStack(spacing: 4) {
            if isAgent {
                Image(systemName: "sparkles").font(.system(size: 10, weight: .bold))
            }
            Text(verbatim: name).lineLimit(1)
        }
        .font(.system(.caption, weight: .semibold))
        .foregroundStyle(isAgent ? NeonHue.purple.deep : palette.nameColor(key: message.authorKey, name: name))
    }

    private var bubbleFill: AnyShapeStyle {
        if mine { return AnyShapeStyle(LinearGradient.neonAction) }
        if isAgent { return AnyShapeStyle(NeonHue.purple.wash) }
        return AnyShapeStyle(Color.white)
    }

    private var bubbleText: Color { mine ? .white : .neonInk }

    private var meta: some View {
        ChatBubbleMeta(
            time: chatClock(message.createdAt),
            delivery: delivery,
            onDark: mine,
            pinned: isPinned,
            managerOnly: message.managerOnly == true
        )
    }

    /// The project a message is filed under: a small capsule at the top of
    /// the bubble — or, on a photo, over its top corner on frosted glass —
    /// the same on either side of the conversation.
    private func projectTag(_ project: ChatMessage.ProjectTag, onPhoto: Bool = false) -> some View {
        HStack(spacing: 4) {
            Image(systemName: "folder.fill").font(.system(size: 10, weight: .semibold))
            Text(verbatim: project.name).lineLimit(1)
        }
        .font(.system(.caption2, weight: .semibold))
        .foregroundStyle(onPhoto ? Color.neonInk : (mine ? Color.white : NeonHue.blue.deep))
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background {
            if onPhoto {
                Capsule().fill(.ultraThinMaterial)
            } else {
                Capsule().fill(mine ? Color.white.opacity(0.2) : NeonHue.blue.wash)
            }
        }
        .overlay(
            Capsule().strokeBorder(
                onPhoto ? Color.white.opacity(0.6) : (mine ? Color.white.opacity(0.28) : Color.neonBlue.opacity(0.2)),
                lineWidth: 0.75
            )
        )
        .accessibilityLabel(L("Project: %@", project.name))
    }

    private var textBubble: some View {
        VStack(alignment: .leading, spacing: 4) {
            if showAuthor, !mine, let name = message.authorName {
                authorLabel(name)
            }
            if let project = message.project {
                projectTag(project)
            }

            if let body = message.body, !body.isEmpty {
                attachment
                // WhatsApp's layout: a short message keeps its time on the
                // same line; a longer one wraps and puts it under the last line.
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .bottom, spacing: 8) {
                        DirText(body, font: .neonCallout, color: bubbleText, fill: false)
                            .fixedSize(horizontal: true, vertical: false)
                        meta.offset(y: 3)
                    }
                    VStack(alignment: .trailing, spacing: 1) {
                        DirText(body, font: .neonCallout, color: bubbleText, fill: true)
                        meta
                    }
                }
            } else {
                // A voice note or a file on its own: the time beside it, so
                // the bubble stays the attachment's own width.
                HStack(alignment: .bottom, spacing: 8) {
                    attachment
                    meta
                }
            }
        }
        .padding(.leading, 12 + (mine ? 0 : ChatBubbleShape.tailWidth))
        .padding(.trailing, 12 + (mine ? ChatBubbleShape.tailWidth : 0))
        .padding(.top, 7)
        .padding(.bottom, 6)
        .background(bubbleShape.fill(bubbleFill))
        .overlay {
            if !mine { bubbleShape.stroke(isAgent ? Color.neonPurple.opacity(0.22) : Color.neonLine, lineWidth: 0.75) }
        }
        .shadow(color: mine ? Color.neonIndigo.opacity(0.18) : Color.neonShadowTint.opacity(0.07), radius: mine ? 6 : 5, x: 0, y: 2)
        .fixedSize(horizontal: false, vertical: true)
        .opacity(outgoing?.failure != nil ? 0.72 : 1)
        .contentShape(.contextMenuPreview, bubbleShape)
        .contextMenu { menu }
    }

    private func jumbo(_ text: String) -> some View {
        Text(verbatim: text.trimmingCharacters(in: .whitespacesAndNewlines))
            .font(.system(.largeTitle))
            .padding(.horizontal, 4)
            .contentShape(Rectangle())
            .contextMenu { menu }
            .accessibilityLabel(Text(verbatim: text))
    }

    @ViewBuilder
    private var attachment: some View {
        switch message.kind {
        case "VOICE":
            ChatVoiceNoteView(message: message, outgoing: outgoing, mine: mine)
        case "FILE", "IMAGE":
            ChatFileAttachment(message: message, mine: mine)
        default:
            EmptyView()
        }
    }

    // MARK: A photo, WhatsApp's way

    @ViewBuilder
    private var photo: some View {
        let shape = RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous)
        VStack(alignment: mine ? .trailing : .leading, spacing: 4) {
            Button(action: openImage) {
                ChatPhotoFrame(url: message.attachmentURL, local: outgoing?.localImage, onResize: onMediaResize)
                    .overlay { ChatPhotoShade() }
                    .overlay(alignment: .topLeading) {
                        if let project = message.project {
                            projectTag(project, onPhoto: true)
                                .padding(8)
                                .allowsHitTesting(false)
                        }
                    }
                    .overlay(alignment: .bottomTrailing) {
                        ChatPhotoMeta(time: chatClock(message.createdAt), delivery: delivery, pinned: isPinned)
                    }
                    .overlay {
                        if outgoing != nil, outgoing?.failure == nil {
                            ProgressView()
                                .tint(.white)
                                .padding(12)
                                .background(.black.opacity(0.35), in: Circle())
                        }
                    }
                    .clipShape(shape)
                    .overlay(shape.strokeBorder(Color.white.opacity(0.7), lineWidth: 1))
                    .contentShape(shape)
            }
            .buttonStyle(PressableStyle(scale: 0.98))
            .neonShadow(.low)
            .disabled(message.attachmentURL == nil)
            .neonContextShape(radius: NeonRadius.md)
            .contextMenu { menu }
            .accessibilityLabel(L("Photo"))

            if let caption = message.body, !caption.isEmpty {
                let captionShape = RoundedRectangle(cornerRadius: 14, style: .continuous)
                DirText(caption, font: .neonCallout, color: bubbleText, fill: true)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .frame(width: ChatPhotoLayout.width)
                    .background(captionShape.fill(bubbleFill))
                    .overlay { if !mine { captionShape.strokeBorder(Color.neonLine, lineWidth: 0.75) } }
                    .neonContextShape(radius: 14)
                    .contextMenu { menu }
            }
        }
    }
}

// MARK: - Pieces of a message

/// Who wrote a message in a group: their initials on the colour the studio
/// gave them (the chat list's own face for them), or the assistant's
/// sparkles. The same width on every row, so a run lines up.
struct ChatAuthorBadge: View {
    let name: String?
    /// Who they are — "admin" or the employee id — which their colour is kept under.
    var key: String?
    var isAgent = false

    @Environment(\.chatRoomPalette) private var palette

    static let size: CGFloat = 28

    var body: some View {
        Group {
            if isAgent {
                IconTile("sparkles", hue: .purple, size: Self.size, style: .filled)
                    .clipShape(Circle())
            } else if let name {
                // Their face where they have one (the room's palette has
                // looked it up), else their initials on their colour.
                ChatAvatar(url: palette.photo(key: key, name: name), name: name, size: Self.size, color: palette.color(key: key, name: name))
            } else {
                Color.clear
            }
        }
        .frame(width: Self.size, height: Self.size)
    }
}

/// A file in a bubble: its kind on a tile, its name, and what it is.
struct ChatFileAttachment: View {
    let message: ChatMessage
    let mine: Bool

    @Environment(\.openURL) private var openURL

    var body: some View {
        let label = HStack(spacing: 10) {
            IconTile(kind.symbol, hue: kind.hue, size: 40, style: mine ? .glass : .soft)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: message.attachmentName ?? L("File"))
                    .font(.system(.subheadline, weight: .semibold))
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                Text(detail)
                    .font(.system(.caption2))
                    .opacity(0.75)
            }
            .foregroundStyle(mine ? Color.white : Color.neonInk)
            Spacer(minLength: 0)
        }
        .padding(8)
        .frame(minWidth: 200, maxWidth: 250, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: NeonRadius.sm, style: .continuous)
                .fill(mine ? Color.white.opacity(0.16) : Color.neonSurfaceSunken)
        )

        if let url = message.attachmentURL {
            Button {
                Haptic.tap()
                openURL(url)
            } label: { label }
            .buttonStyle(PressableStyle(scale: 0.97))
            .accessibilityHint(L("Tap to open"))
        } else {
            label
        }
    }

    private var detail: String {
        var parts: [String] = []
        if let type = message.attachmentType, !type.isEmpty { parts.append(type.uppercased()) }
        if let size = message.attachmentSize { parts.append(byteCount(size)) }
        if message.attachmentURL != nil { parts.append(L("Tap to open")) }
        return parts.joined(separator: " · ")
    }

    private var kind: (symbol: String, hue: NeonHue) {
        switch message.attachmentType?.lowercased() ?? "" {
        case "pdf": return ("doc.richtext.fill", .red)
        case "zip", "rar", "7z": return ("doc.zipper", .amber)
        case "xls", "xlsx", "csv", "numbers": return ("tablecells.fill", .green)
        case "doc", "docx", "pages", "txt", "rtf": return ("doc.text.fill", .blue)
        case "ppt", "pptx", "key": return ("rectangle.on.rectangle.angled", .orange)
        case "dwg", "dxf", "skp", "rvt", "3dm", "max": return ("square.3.layers.3d", .cyan)
        case "png", "jpg", "jpeg", "gif", "webp", "heic": return ("photo.fill", .pink)
        case "mp4", "mov", "m4v": return ("film.fill", .purple)
        default: return ("doc.fill", .indigo)
        }
    }
}

/// A voice note: play, the bars of its own sound filling as it plays, and
/// how long it is (or how far in, while it plays).
struct ChatVoiceNoteView: View {
    let message: ChatMessage
    var outgoing: ChatOutgoing?
    let mine: Bool

    @ObservedObject private var player = ChatVoicePlayer.shared
    @State private var levels: [CGFloat]?
    /// How long the recording is, read from the file itself when the server
    /// did not say.
    @State private var fileSeconds: Double?

    private var url: URL? { message.attachmentURL }
    private var playing: Bool { url != nil && player.playingURL == url }
    private var loading: Bool { url != nil && player.loadingURL == url }

    var body: some View {
        HStack(spacing: 10) {
            Button {
                guard let url else { return }
                Haptic.tap()
                player.toggle(url: url)
            } label: {
                ZStack {
                    Circle().fill(mine ? AnyShapeStyle(Color.white) : AnyShapeStyle(LinearGradient.neonAction))
                    if loading {
                        ProgressView()
                            .controlSize(.small)
                            .tint(mine ? .neonIndigo : .white)
                    } else {
                        Image(systemName: playing ? "pause.fill" : "play.fill")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(mine ? Color.neonIndigo : Color.white)
                            // The play triangle sits a touch right of centre to look centred.
                            .offset(x: playing ? 0 : 1.5)
                            .environment(\.layoutDirection, .leftToRight)
                    }
                }
                .frame(width: 38, height: 38)
                .shadow(color: (mine ? Color.black : Color.neonIndigo).opacity(0.15), radius: 4, x: 0, y: 2)
            }
            .buttonStyle(PressableStyle(scale: 0.88))
            .disabled(url == nil)
            .accessibilityLabel(playing ? L("Pause") : L("Play voice message"))

            VStack(alignment: .leading, spacing: 4) {
                ChatWaveform(
                    levels: levels,
                    progress: playing ? player.progress : 0,
                    tint: mine ? .white : .neonIndigo,
                    track: mine ? Color.white.opacity(0.38) : Color.neonIndigo.opacity(0.2)
                )
                .frame(width: 150)
                // "0:12" — nothing until the length is known, never a guess.
                Text(timeText ?? "0:00")
                    .font(.neonMeta)
                    .monospacedDigit()
                    .foregroundStyle(mine ? Color.white.opacity(0.85) : Color.neonTextSecondary)
                    .opacity(timeText == nil ? 0 : 1)
            }
        }
        .task(id: message.attachmentUrl ?? outgoing?.id) { await loadShape() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(L("Voice message"))
        .accessibilityValue(timeText ?? "")
    }

    private var seconds: Double? { message.durationSeconds ?? fileSeconds }

    private var timeText: String? {
        guard let seconds, seconds > 0 else { return nil }
        if playing { return chatDuration(seconds * player.progress) }
        return chatDuration(seconds)
    }

    private func loadShape() async {
        if let url {
            let key = url.absoluteString
            if let cached = ChatVoiceNotes.shared.cachedShape(key) {
                levels = cached
                fileSeconds = ChatVoiceNotes.shared.cachedDuration(key)
                return
            }
            let shape = await ChatVoiceNotes.shared.shape(for: url)
            withAnimation(NeonMotion.resolved(NeonMotion.smooth)) {
                levels = shape
                fileSeconds = ChatVoiceNotes.shared.cachedDuration(key)
            }
        } else if let outgoing, case .voice(let file, _) = outgoing.payload {
            levels = await ChatVoiceNotes.shared.shape(of: file.data, key: outgoing.id)
            fileSeconds = ChatVoiceNotes.shared.cachedDuration(outgoing.id)
        }
    }
}

/// A call's line across the conversation: what happened, who, when — said
/// from the viewer's side. The server's `body` is its English summary for
/// everybody at once ("Missed call"), so the words are built here from how
/// the call ended: a call I made that nobody picked up is "No answer" from
/// me, in grey; only a call I missed is red.
struct ChatCallLine: View {
    let message: ChatMessage
    /// I made the call (its message is written as the caller's).
    var mine = false

    var body: some View {
        let look = self.look
        HStack(spacing: 8) {
            IconTile(look.symbol, hue: look.hue, size: 24)
            Text(verbatim: [look.words, who, chatClock(message.createdAt)].filter { !$0.isEmpty }.joined(separator: " · "))
                .font(.system(.footnote, weight: .medium))
                .foregroundStyle(look.hue == .red ? Color.neonDangerStrong : Color.neonTextSecondary)
                .lineLimit(2)
        }
        .padding(.leading, 5)
        .padding(.trailing, 12)
        .padding(.vertical, 5)
        .background(Capsule().fill(Color.white.opacity(0.94)))
        .overlay(Capsule().strokeBorder(Color.neonLine, lineWidth: 0.75))
        .neonShadow(.low)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }

    private var video: Bool { message.call?.kind == "VIDEO" }

    /// Who called: me, the manager (in the app's language), or their name.
    private var who: String {
        if mine { return L("You") }
        if message.authorType == "ADMIN" { return L("Manager") }
        return message.authorName ?? ""
    }

    private var look: (words: String, symbol: String, hue: NeonHue) {
        switch message.call?.endReason {
        case "missed":
            if mine {
                return (L("No answer"), video ? "video.fill" : "phone.arrow.up.right.fill", .grey)
            }
            return (video ? L("Missed video call") : L("Missed call"), video ? "video.slash.fill" : "phone.down.fill", .red)
        case "declined":
            return (video ? L("Declined video call") : L("Declined call"), video ? "video.slash.fill" : "phone.down.fill", .grey)
        case "completed":
            let kind = video ? L("Video call ended") : L("Call ended")
            let words = message.durationSeconds.map { "\(kind) · \(chatCallLength($0))" } ?? kind
            return (words, video ? "video.fill" : "phone.fill", .green)
        default:
            // A line from before calls said how they ended: the server's own words.
            return (message.body ?? L("Call"), video ? "video.fill" : "phone.fill", .green)
        }
    }
}

/// "0:45", "4:32", "1:02:05" — callDuration in lib/calls.ts.
func chatCallLength(_ seconds: Double) -> String {
    let total = max(0, Int(seconds.rounded()))
    let hours = total / 3600
    let minutes = (total % 3600) / 60
    let rest = total % 60
    return hours > 0 ? String(format: "%d:%02d:%02d", hours, minutes, rest) : String(format: "%d:%02d", minutes, rest)
}

// MARK: - A grid of photos

/// Four or more photos in a row from one person: the first four in a square,
/// the fourth saying how many more there are. Each tile opens the viewer at
/// its own photo and has its own menu, so reacting to, pinning or deleting
/// one photo works as it does for a photo on its own (and takes it out of
/// the grid, since a grid carries no reactions).
struct ChatAlbumRow: View {
    let photos: [ChatMessage]
    let mine: Bool
    let showAuthor: Bool
    var inGroup = false
    let delivery: ChatDelivery?
    let open: (ChatMessage) -> Void
    let onReact: (ChatMessage, String) -> Void
    let onPin: (ChatMessage) -> Void
    let canDelete: (ChatMessage) -> Bool
    let onDelete: (ChatMessage) -> Void

    @Environment(\.chatRoomPalette) private var palette

    private let gap: CGFloat = 3
    private var side: CGFloat { (ChatPhotoLayout.width - gap) / 2 }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous)
        HStack(alignment: .top, spacing: 6) {
            if inGroup && !mine {
                ChatAuthorBadge(name: photos.first?.authorName, key: photos.first?.authorKey)
                    .opacity(showAuthor ? 1 : 0)
                    .accessibilityHidden(true)
            }
            VStack(alignment: mine ? .trailing : .leading, spacing: 3) {
                if showAuthor && !mine, let name = photos.first?.authorName {
                    Text(verbatim: name)
                        .font(.system(.caption, weight: .semibold))
                        .foregroundStyle(palette.nameColor(key: photos.first?.authorKey, name: name))
                        .padding(.leading, ChatBubbleShape.tailWidth + 4)
                }
                VStack(spacing: gap) {
                    HStack(spacing: gap) {
                        tile(0)
                        tile(1)
                    }
                    HStack(spacing: gap) {
                        tile(2)
                        tile(3)
                    }
                }
                .overlay { ChatPhotoShade().allowsHitTesting(false) }
                .overlay(alignment: .bottomTrailing) {
                    if let last = photos.last {
                        ChatPhotoMeta(time: chatClock(last.createdAt), delivery: delivery).allowsHitTesting(false)
                    }
                }
                .clipShape(shape)
                .overlay(shape.strokeBorder(Color.white.opacity(0.7), lineWidth: 1).allowsHitTesting(false))
                .neonShadow(.low)
                .padding(mine ? .trailing : .leading, ChatBubbleShape.tailWidth)
                .accessibilityElement(children: .contain)
                .accessibilityLabel(L("%d photos", photos.count))
            }
        }
        .frame(maxWidth: .infinity, alignment: mine ? .trailing : .leading)
        .padding(mine ? .leading : .trailing, 44)
        .padding(.top, 6)
    }

    @ViewBuilder
    private func tile(_ index: Int) -> some View {
        if index < photos.count {
            let photo = photos[index]
            let more = photos.count - 4
            Button { open(photo) } label: {
                ChatPhotoImage(url: photo.attachmentURL)
                    .frame(width: side, height: side)
                    .overlay {
                        if index == 3, more > 0 {
                            ZStack {
                                Color.black.opacity(0.45)
                                Text(verbatim: "+\(NeonFormat.integer(more))")
                                    .font(.system(.title, weight: .bold))
                                    .foregroundStyle(.white)
                            }
                        }
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
                    .contentShape(Rectangle())
            }
            .buttonStyle(PressableStyle(scale: 0.97))
            .contextMenu {
                ForEach(chatReactionSet, id: \.self) { emoji in
                    Button { onReact(photo, emoji) } label: { Text(emoji) }
                }
                Button { onPin(photo) } label: { Label(L("Pin"), systemImage: "pin") }
                if canDelete(photo) {
                    Button(role: .destructive) { onDelete(photo) } label: { Label(L("Delete"), systemImage: "trash") }
                }
            }
            .accessibilityLabel(L("Photo"))
        }
    }
}
