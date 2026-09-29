import SwiftUI
import UIKit

// How a conversation's messages are laid out: the rows (a day's heading,
// one message, a grid of photos, a message still on its way), and how each
// message is drawn — a bubble with its time and ticks inside it, WhatsApp's
// way; a photo with no bubble at all, its time and ticks over the picture;
// the task and meeting cards; a call's line across the conversation.

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

struct ChatDaySeparator: View {
    let iso: String

    var body: some View {
        Text(label)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(Color.neonInk.opacity(0.5))
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(Color.white.opacity(0.75), in: Capsule())
            .overlay(Capsule().strokeBorder(Color.neonInk.opacity(0.05)))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
    }

    private var label: String {
        guard let date = parseISODate(iso) else { return "" }
        if Calendar.current.isDateInToday(date) { return L("Today") }
        if Calendar.current.isDateInYesterday(date) { return L("Yesterday") }
        return date.formatted(Date.FormatStyle(date: .abbreviated, time: .omitted, locale: AppLanguage.current.locale))
    }
}

/// A message's time as the conversation shows it.
func chatClock(_ iso: String) -> String {
    guard let time = parseISODate(iso) else { return "" }
    return time.formatted(Date.FormatStyle(date: .omitted, time: .shortened, locale: AppLanguage.current.locale))
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
            if pinned { Image(systemName: "pin.fill").font(.system(size: 9)) }
            if managerOnly {
                Image(systemName: "eye.slash").font(.system(size: 9))
                Text(L("Only you"))
            }
            Text(time).monospacedDigit()
            if let delivery {
                ChatTicks(
                    delivery: delivery,
                    tint: onDark ? .white.opacity(0.75) : Color.neonInk.opacity(0.42),
                    readTint: onDark ? ChatTickPalette.read : ChatTickPalette.readOnLight
                )
                .padding(.leading, 1)
            }
        }
        .font(.system(size: 11))
        .foregroundStyle(onDark ? Color.white.opacity(0.72) : Color.neonInk.opacity(0.45))
        .lineLimit(1)
        .fixedSize()
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

    @Environment(\.openURL) private var openURL
    @ObservedObject private var voicePlayer = ChatVoicePlayer.shared

    var body: some View {
        switch message.kind {
        case "CALL":
            callLine
        case "TASK":
            if let card = message.task {
                aligned(metaBelow: true) {
                    ChatTaskCardView(card: card, message: message, viewer: viewerIdentity, sendProof: sendProof, onChanged: onCardChanged)
                        .contextMenu { pinMenu }
                }
            } else {
                aligned { bubble.contextMenu { menu } }
            }
        case "MEETING":
            if let meeting = message.meeting {
                aligned(metaBelow: true) {
                    ChatMeetingCardView(meeting: meeting, callSlug: callSlug, callTitle: message.body ?? "", viewer: viewerIdentity, onChanged: onCardChanged)
                        .contextMenu { pinMenu }
                }
            } else {
                aligned { bubble.contextMenu { menu } }
            }
        default:
            if message.isPicture && (message.attachmentURL != nil || outgoing?.localImage != nil) {
                aligned { photo }
            } else {
                aligned { bubble.contextMenu { menu } }
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
    private func aligned<Content: View>(metaBelow: Bool = false, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: mine ? .trailing : .leading, spacing: 3) {
            if showAuthor && !mine, let name = message.authorName {
                Text(name)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(ChatTint.pair(name: name).1)
                    .padding(.horizontal, 6)
            }
            content()
            // Sized to its chips, so it sits under the message's own side
            // rather than spreading across the row from the leading edge.
            ChatReactionRow(tallies: tallies, onToggle: onReact)
                .fixedSize(horizontal: true, vertical: false)
                .padding(.horizontal, 6)
            if metaBelow {
                ChatBubbleMeta(time: chatClock(message.createdAt), delivery: delivery, onDark: false, pinned: isPinned, managerOnly: message.managerOnly == true)
                    .padding(.horizontal, 6)
            }
            if let failure = outgoing?.failure {
                Button { onRetry?() } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "arrow.clockwise")
                        Text(L("Not sent. Tap to retry."))
                    }
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color.neonDangerStrong)
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 6)
                .accessibilityHint(failure)
            }
        }
        .frame(maxWidth: .infinity, alignment: mine ? .trailing : .leading)
        .padding(mine ? .leading : .trailing, 44)
        .padding(.top, tail ? 4 : 0)
    }

    private var bubbleFill: Color { mine ? .neonPurpleStrong : .white }
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

    @ViewBuilder
    private var bubble: some View {
        VStack(alignment: .leading, spacing: 5) {
            if let project = message.project {
                Label(project.name, systemImage: "folder")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(mine ? Color.white.opacity(0.8) : Color.neonCyanStrong)
            }

            if let body = message.body, !body.isEmpty {
                attachment
                // WhatsApp's layout: a short message keeps its time on the
                // same line; a longer one wraps and puts it under the last line.
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .bottom, spacing: 8) {
                        DirText(body, font: .system(size: 16), color: bubbleText, fill: false)
                            .fixedSize(horizontal: true, vertical: false)
                        meta.offset(y: 2)
                    }
                    VStack(alignment: .trailing, spacing: 1) {
                        DirText(body, font: .system(size: 16), color: bubbleText, fill: true)
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
        .padding(.horizontal, 12)
        .padding(.top, 8)
        .padding(.bottom, 6)
        .background(bubbleFill, in: ChatBubbleShape(mine: mine, tail: tail))
        .overlay(ChatBubbleShape(mine: mine, tail: tail).stroke(mine ? Color.clear : Color.neonInk.opacity(0.07)))
        .fixedSize(horizontal: false, vertical: true)
        .opacity(outgoing?.failure != nil ? 0.75 : 1)
    }

    @ViewBuilder
    private var attachment: some View {
        switch message.kind {
        case "VOICE": voiceBubble
        case "FILE", "IMAGE": fileBubble
        default: EmptyView()
        }
    }

    @ViewBuilder
    private var fileBubble: some View {
        let label = HStack(spacing: 10) {
            Image(systemName: "doc.fill").font(.system(size: 26))
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: message.attachmentName ?? L("File"))
                    .font(.system(size: 14, weight: .semibold))
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                Text(fileDetail)
                    .font(.system(size: 11))
                    .opacity(0.7)
            }
        }
        .foregroundStyle(bubbleText)

        if let url = message.attachmentURL {
            Button { openURL(url) } label: { label }.buttonStyle(.plain)
        } else {
            label
        }
    }

    private var fileDetail: String {
        var parts: [String] = []
        if let type = message.attachmentType, !type.isEmpty { parts.append(type.uppercased()) }
        if let size = message.attachmentSize { parts.append(byteCount(size)) }
        if message.attachmentURL != nil { parts.append(L("Tap to open")) }
        return parts.joined(separator: " · ")
    }

    @ViewBuilder
    private var voiceBubble: some View {
        let seconds = message.durationSeconds.map { String(format: "%d:%02d", Int($0) / 60, Int($0) % 60) } ?? L("Voice message")
        if let url = message.attachmentURL {
            let playing = voicePlayer.playingURL == url
            Button { voicePlayer.toggle(url: url) } label: {
                HStack(spacing: 10) {
                    Image(systemName: playing ? "pause.circle.fill" : "play.circle.fill").font(.system(size: 30))
                    VStack(alignment: .leading, spacing: 4) {
                        ProgressBar(progress: playing ? voicePlayer.progress : 0, tint: mine ? .white : .neonPurpleStrong, height: 4)
                            .frame(width: 130)
                        Text(seconds).font(.system(size: 11)).monospacedDigit()
                    }
                }
                .foregroundStyle(bubbleText)
            }
            .buttonStyle(.plain)
        } else {
            HStack(spacing: 10) {
                Image(systemName: "waveform.circle.fill").font(.system(size: 30))
                VStack(alignment: .leading, spacing: 4) {
                    Capsule().fill(bubbleText.opacity(0.35)).frame(width: 130, height: 4)
                    Text(seconds).font(.system(size: 11)).monospacedDigit()
                }
            }
            .foregroundStyle(bubbleText.opacity(0.85))
        }
    }

    // MARK: A photo, WhatsApp's way

    @ViewBuilder
    private var photo: some View {
        VStack(alignment: mine ? .trailing : .leading, spacing: 3) {
            if let project = message.project {
                Label(project.name, systemImage: "folder")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color.neonCyanStrong)
                    .padding(.horizontal, 6)
            }
            Button(action: openImage) {
                ChatPhotoFrame(url: message.attachmentURL, local: outgoing?.localImage, onResize: onMediaResize)
                    .overlay { ChatPhotoShade() }
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
                    .clipShape(RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous).strokeBorder(Color.neonInk.opacity(0.06)))
                    .contentShape(RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous))
            }
            .buttonStyle(PressableStyle(scale: 0.98))
            .disabled(message.attachmentURL == nil)
            .contextMenu { menu }
            .accessibilityLabel(L("Photo"))

            if let caption = message.body, !caption.isEmpty {
                DirText(caption, font: .system(size: 15), color: bubbleText, fill: true)
                    .padding(.horizontal, 11)
                    .padding(.vertical, 7)
                    .frame(width: ChatPhotoLayout.width)
                    .background(bubbleFill, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(mine ? Color.clear : Color.neonInk.opacity(0.07)))
                    .contextMenu { menu }
            }
        }
    }

    private var callLine: some View {
        HStack(spacing: 6) {
            Image(systemName: message.call?.kind == "VIDEO" ? "video.fill" : "phone.fill")
            Text(verbatim: [message.body ?? L("Call"), message.authorName, chatClock(message.createdAt)].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
        }
        .font(.system(size: 12, weight: .medium))
        .foregroundStyle(message.call?.endReason == "missed" ? Color.red.opacity(0.8) : Color.neonInk.opacity(0.5))
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Color.white.opacity(0.7), in: Capsule())
        .frame(maxWidth: .infinity)
        .padding(.vertical, 4)
    }
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
    let delivery: ChatDelivery?
    let open: (ChatMessage) -> Void
    let onReact: (ChatMessage, String) -> Void
    let onPin: (ChatMessage) -> Void
    let canDelete: (ChatMessage) -> Bool
    let onDelete: (ChatMessage) -> Void

    private let gap: CGFloat = 3
    private var side: CGFloat { (ChatPhotoLayout.width - gap) / 2 }

    var body: some View {
        VStack(alignment: mine ? .trailing : .leading, spacing: 3) {
            if showAuthor && !mine, let name = photos.first?.authorName {
                Text(name)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(ChatTint.pair(name: name).1)
                    .padding(.horizontal, 6)
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
            .padding(3)
            .background(mine ? Color.neonPurpleStrong : Color.white, in: RoundedRectangle(cornerRadius: NeonRadius.md + 3, style: .continuous))
            .clipShape(RoundedRectangle(cornerRadius: NeonRadius.md + 3, style: .continuous))
            .accessibilityElement(children: .contain)
            .accessibilityLabel(L("%d photos", photos.count))
        }
        .frame(maxWidth: .infinity, alignment: mine ? .trailing : .leading)
        .padding(mine ? .leading : .trailing, 44)
        .padding(.top, 4)
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
                                Text(verbatim: "+\(more)")
                                    .font(.system(size: 26, weight: .semibold, design: .rounded))
                                    .foregroundStyle(.white)
                            }
                        }
                    }
                    .clipShape(RoundedRectangle(cornerRadius: NeonRadius.md - 2, style: .continuous))
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
