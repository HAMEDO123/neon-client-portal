#if DEBUG
import AVFoundation
import SwiftUI
import UIKit

/// The chat room and what opens from it, for the debug router
/// (App/DebugScreens.swift): `-neonScreen <id>` opens one straight from
/// launch, for screenshots. Add every screen and sheet of the room here.
///
/// - chat-room-team: the team's conversation (`-neonScroll top` for its oldest loaded messages)
/// - chat-room-direct: the first private chat in the list
/// - chat-room-group: the first group the manager made
/// - chat-room-search: the team's conversation with the search box open
/// - chat-room-cards: the newest real task and meeting cards, drawn as the room draws them
/// - chat-meetings: every meeting card (`-neonScroll coming-up`, `earlier`)
/// - chat-task-compose, chat-meeting-compose, chat-assistant: the room's sheets, as screens
///
/// With no data at all — files made on the phone, nothing fetched:
/// - chat-media: a group conversation of videos (a landscape one with a
///   caption, a portrait one of mine, one still going up, one that cannot be
///   read), voice notes with their speed pill, and a file (`-neonScroll voice`)
/// - chat-media-fast: the same, with voice notes set to 1.5×
/// - chat-video-player: a video full screen in the player
/// - chat-face-viewer: a person's photo full screen (the header's picture)
/// - chat-face-viewer-initials: a person with no photo — their initials on their colour
/// - chat-face-viewer-group: a group the manager made, with its Group info button
/// - chat-face-viewer-team: the team's conversation — the studio's mark
/// - chat-task-quote: questions about a task, each drawn with its quote
enum ChatRoomScreens {
    static let ids: [String] = [
        "chat-room-team", "chat-room-direct", "chat-room-group", "chat-room-search", "chat-room-cards",
        "chat-meetings", "chat-task-compose", "chat-meeting-compose", "chat-assistant",
        "chat-media", "chat-media-fast", "chat-video-player", "chat-face-viewer", "chat-face-viewer-initials",
        "chat-face-viewer-group", "chat-face-viewer-team", "chat-task-quote",
    ]

    private static let team = ChatRoute(slug: "team", title: "NEON Team", subtitle: nil, avatar: nil, isGroup: true)

    @MainActor static func view(_ id: String) -> AnyView? {
        switch id {
        case "chat-room-team":
            return debugPushed(ChatRoomView(route: team))
        case "chat-room-search":
            return debugPushed(ChatRoomView(route: team, startsSearching: true))
        case "chat-room-direct":
            return debugPushed(ChatRoomDebugLoad(missing: L("No private chat on the server to open")) {
                try await firstConversation { !$0.isGroup }
            })
        case "chat-room-group":
            return debugPushed(ChatRoomDebugLoad(missing: L("No group on the server to open")) {
                try await firstConversation { $0.isCustomGroup }
            })
        case "chat-room-cards":
            return debugPushed(ChatRoomCardsPreview())
        case "chat-meetings":
            return debugPushed(MeetingsView())
        case "chat-task-compose":
            return AnyView(ChatTaskComposeSheet(conversationSlug: "team"))
        case "chat-meeting-compose":
            return AnyView(ChatMeetingComposeSheet(conversationSlug: "team"))
        case "chat-assistant":
            return AnyView(ChatAssistantSheet())
        case "chat-task-quote":
            return AnyView(ChatTaskQuoteFixture())
        case "chat-media":
            return AnyView(ChatMediaFixtureRoom())
        case "chat-media-fast":
            return AnyView(ChatMediaFixtureRoom(voiceRate: 1.5))
        case "chat-video-player":
            return AnyView(ChatMediaFixtureLoad { files in
                ChatVideoPlayerScreen(payload: ChatVideoPayload(
                    id: "fixture-video",
                    url: files.landscapeVideo,
                    title: "Sally Haddad",
                    subtitle: formattedISODate(ChatMediaFixtures.iso(minutesAgo: 42)),
                    caption: "The living room walk-through, before the joinery goes in.",
                    fileName: "walkthrough.mp4"
                ))
            })
        case "chat-face-viewer":
            return AnyView(ChatMediaFixtureLoad { files in
                ChatFaceViewer(payload: ChatFacePayload(name: "Sally Haddad", subtitle: L("online now"), url: files.facePhoto))
            })
        case "chat-face-viewer-initials":
            return AnyView(ChatFaceViewer(payload: ChatFacePayload(
                name: "Omar Khalil",
                subtitle: chatLastSeen(ChatMediaFixtures.iso(minutesAgo: 5), now: Date()),
                url: URL(string: "/api/avatar?name=Omar%20Khalil&color=cyan", relativeTo: portalOrigin)
            )))
        case "chat-face-viewer-group":
            return AnyView(ChatFaceViewer(payload: ChatFacePayload(
                name: "Villa Al Fulan — site",
                subtitle: L("%d people · %d here", 5, 2),
                url: resolvedMediaURL(ChatFace.studioIconPath),
                isGroup: true,
                action: ChatFaceAction(title: L("Group info"), symbol: "info.circle") { Toast.info(L("Group info")) }
            )))
        case "chat-face-viewer-team":
            return AnyView(ChatFaceViewer(payload: ChatFacePayload(
                name: "NEON Team",
                subtitle: L("%d people", 9),
                url: nil,
                isGroup: true,
                studioMark: true
            )))
        default:
            return nil
        }
    }

    @MainActor private static func firstConversation(_ matching: (ConversationSummary) -> Bool) async throws -> ConversationSummary? {
        try await APIClient.shared.fetchConversations().value.conversations.first(where: matching)
    }
}

/// A conversation that has to be found on the server first. When there is
/// none (or the read fails), it says so on the app's own page with a warning
/// tile — so a missing fixture is plain in a screenshot and never passes for
/// one of the app's screens.
private struct ChatRoomDebugLoad: View {
    let missing: String
    let load: @MainActor () async throws -> ConversationSummary?

    @State private var found: ConversationSummary?
    @State private var failure: String?

    var body: some View {
        Group {
            if let found {
                ChatRoomView(route: ChatRoute(found))
            } else if let failure {
                NeonScroll {
                    EmptyState(symbol: "exclamationmark.triangle", title: missing, detail: failure, hue: .orange, card: true)
                        .padding(.top, 80)
                }
            } else {
                NeonScroll { ChatRoomSkeleton() }
            }
        }
        .task {
            do {
                if let conversation = try await load() {
                    found = conversation
                } else {
                    failure = L("Nothing on the server to open this with.")
                }
            } catch {
                failure = error.localizedDescription
            }
        }
    }
}

/// The newest real task and meeting cards from any conversation, each drawn
/// exactly as the room draws it, on the room's wallpaper — so the cards can be
/// looked at without scrolling a conversation to find one. Read only.
private struct ChatRoomCardsPreview: View {
    @EnvironmentObject private var api: APIClient
    @StateObject private var cards = ChatCardsLoader()

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 10) {
                if !cards.loaded {
                    ChatRoomSkeleton()
                } else if cards.tasks.isEmpty && cards.meetings.isEmpty {
                    EmptyState(symbol: "tray", title: L("No messages yet"), card: true)
                }
                ForEach(Array(cards.tasks.prefix(3)) + Array(cards.meetings.prefix(3))) { item in
                    let mine = item.message.isMine(api.identity)
                    ChatMessageRow(
                        message: item.message,
                        mine: mine,
                        showAuthor: item.conversation.isGroup && !mine,
                        tail: true,
                        delivery: mine ? .sent : nil,
                        viewerIdentity: api.identity,
                        tallies: [],
                        isPinned: false,
                        callSlug: item.conversation.slug,
                        inGroup: item.conversation.isGroup,
                        openImage: {},
                        sendProof: { _, _ in },
                        onReact: { _ in },
                        onPin: { _ in },
                        onDelete: nil,
                        onCardChanged: {}
                    )
                }
            }
            .padding(12)
        }
        .background { ChatRoomWallpaper().ignoresSafeArea() }
        .navigationTitle(L("Chat"))
        .navigationBarTitleDisplayMode(.inline)
        .chatRoomPalette()
        .task { await cards.load(api) }
    }
}

// MARK: - Media fixtures (no network)

/// Files made on the phone for the media fixtures: two short videos drawn
/// frame by frame, a file that is not a video at all, two voice notes
/// synthesised as AAC, and a portrait photo. Made once per launch, in the
/// temporary folder.
@MainActor
final class ChatMediaFixtures: ObservableObject {
    struct Files {
        let landscapeVideo: URL
        let portraitVideo: URL
        let brokenVideo: URL
        let portraitData: Data
        let voiceShort: URL
        let voiceLong: URL
        let facePhoto: URL
        let pdf: URL
    }

    static let shared = ChatMediaFixtures()

    @Published private(set) var files: Files?
    private var making: Task<Void, Never>?

    func make() {
        guard files == nil, making == nil else { return }
        making = Task {
            let made = await Task.detached(priority: .userInitiated) { await Self.makeAll() }.value
            files = made
            making = nil
        }
    }

    static func iso(minutesAgo: Double) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: Date().addingTimeInterval(-minutesAgo * 60))
    }

    nonisolated private static func makeAll() async -> Files? {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("neon-chat-fixtures-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let landscape = folder.appendingPathComponent("walkthrough.mp4")
        let portrait = folder.appendingPathComponent("kitchen.mp4")
        let broken = folder.appendingPathComponent("broken.mp4")
        let short = folder.appendingPathComponent("voice-short.m4a")
        let long = folder.appendingPathComponent("voice-long.m4a")
        let face = folder.appendingPathComponent("sally.png")
        let pdf = folder.appendingPathComponent("BOQ.pdf")
        guard await video(to: landscape, width: 640, height: 360, seconds: 7, palette: 0),
              await video(to: portrait, width: 360, height: 640, seconds: 4, palette: 1),
              voice(to: short, seconds: 6),
              voice(to: long, seconds: 23),
              let portraitData = try? Data(contentsOf: portrait)
        else { return nil }
        try? Data("not a video".utf8).write(to: broken)
        try? Data("%PDF-1.4\n%fixture".utf8).write(to: pdf)
        try? photo().pngData()?.write(to: face)
        return Files(
            landscapeVideo: landscape, portraitVideo: portrait, brokenVideo: broken, portraitData: portraitData,
            voiceShort: short, voiceLong: long, facePhoto: face, pdf: pdf
        )
    }

    /// A short H.264 video of a room in the studio's colours, its light moving.
    nonisolated private static func video(to url: URL, width: Int, height: Int, seconds: Double, palette: Int) async -> Bool {
        guard let writer = try? AVAssetWriter(outputURL: url, fileType: .mp4) else { return false }
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: width, AVVideoHeightKey: height,
        ])
        input.expectsMediaDataInRealTime = false
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
            kCVPixelBufferWidthKey as String: width,
            kCVPixelBufferHeightKey as String: height,
        ])
        guard writer.canAdd(input) else { return false }
        writer.add(input)
        guard writer.startWriting() else { return false }
        writer.startSession(atSourceTime: .zero)
        let fps = 30
        let frames = Int(seconds * Double(fps))
        let colours: [(CGFloat, CGFloat, CGFloat)] = palette == 0
            ? [(0.42, 0.55, 0.98), (0.55, 0.36, 0.96)]
            : [(0.98, 0.62, 0.32), (0.93, 0.33, 0.55)]
        for frame in 0..<frames {
            while !input.isReadyForMoreMediaData { try? await Task.sleep(nanoseconds: 2_000_000) }
            guard let pool = adaptor.pixelBufferPool else { return false }
            var made: CVPixelBuffer?
            CVPixelBufferPoolCreatePixelBuffer(nil, pool, &made)
            guard let buffer = made else { return false }
            CVPixelBufferLockBaseAddress(buffer, [])
            if let context = CGContext(
                data: CVPixelBufferGetBaseAddress(buffer), width: width, height: height, bitsPerComponent: 8,
                bytesPerRow: CVPixelBufferGetBytesPerRow(buffer), space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue
            ) {
                drawRoom(context, width: CGFloat(width), height: CGFloat(height), t: Double(frame) / Double(frames), colours: colours)
            }
            CVPixelBufferUnlockBaseAddress(buffer, [])
            adaptor.append(buffer, withPresentationTime: CMTime(value: CMTimeValue(frame), timescale: CMTimeScale(fps)))
        }
        input.markAsFinished()
        await writer.finishWriting()
        return writer.status == .completed
    }

    /// A wall, a floor, a window whose light sweeps across, a sofa and a lamp.
    nonisolated private static func drawRoom(_ c: CGContext, width w: CGFloat, height h: CGFloat, t: Double, colours: [(CGFloat, CGFloat, CGFloat)]) {
        let space = CGColorSpaceCreateDeviceRGB()
        let top = colours[0], bottom = colours[1]
        if let wall = CGGradient(colorsSpace: space, colors: [
            CGColor(red: top.0, green: top.1, blue: top.2, alpha: 1),
            CGColor(red: bottom.0, green: bottom.1, blue: bottom.2, alpha: 1),
        ] as CFArray, locations: [0, 1]) {
            c.drawLinearGradient(wall, start: CGPoint(x: 0, y: h), end: CGPoint(x: w, y: 0), options: [])
        }
        // The floor (CoreGraphics counts up from the bottom).
        c.setFillColor(CGColor(red: 0.93, green: 0.90, blue: 0.86, alpha: 1))
        c.fill(CGRect(x: 0, y: 0, width: w, height: h * 0.3))
        // A window, and its light moving across the floor.
        c.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 0.85))
        c.fill(CGRect(x: w * 0.6, y: h * 0.45, width: w * 0.28, height: h * 0.4))
        let sweep = CGFloat(t)
        c.setFillColor(CGColor(red: 1, green: 0.97, blue: 0.85, alpha: 0.55))
        c.fill(CGRect(x: w * (0.05 + 0.6 * sweep), y: h * 0.04, width: w * 0.26, height: h * 0.2))
        // A sofa.
        c.setFillColor(CGColor(red: 0.16, green: 0.18, blue: 0.3, alpha: 1))
        c.addPath(CGPath(roundedRect: CGRect(x: w * 0.08, y: h * 0.22, width: w * 0.42, height: h * 0.16), cornerWidth: 10, cornerHeight: 10, transform: nil))
        c.fillPath()
        c.addPath(CGPath(roundedRect: CGRect(x: w * 0.08, y: h * 0.34, width: w * 0.42, height: h * 0.12), cornerWidth: 10, cornerHeight: 10, transform: nil))
        c.fillPath()
        // A lamp that brightens and dims.
        let glow = 0.55 + 0.45 * sin(t * .pi * 4)
        c.setFillColor(CGColor(red: 1, green: 0.85, blue: 0.45, alpha: glow))
        c.fillEllipse(in: CGRect(x: w * 0.47, y: h * 0.62, width: min(w, h) * 0.12, height: min(w, h) * 0.12))
        c.setFillColor(CGColor(red: 0.16, green: 0.18, blue: 0.3, alpha: 1))
        c.fill(CGRect(x: w * 0.47 + min(w, h) * 0.055, y: h * 0.22, width: 3, height: h * 0.42))
    }

    /// A voice note: a hum broken into syllables, so its bars have a shape.
    nonisolated private static func voice(to url: URL, seconds: Double) -> Bool {
        let rate = 44_100.0
        let settings: [String: Any] = [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: rate, AVNumberOfChannelsKey: 1]
        guard let file = try? AVAudioFile(forWriting: url, settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false) else { return false }
        let frames = AVAudioFrameCount(seconds * rate)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: frames),
              let samples = buffer.floatChannelData?[0] else { return false }
        buffer.frameLength = frames
        for index in 0..<Int(frames) {
            let time = Double(index) / rate
            let syllable = max(0, sin(time * .pi * 3.1)) * (0.45 + 0.55 * abs(sin(time * 0.9)))
            let pause = sin(time * 0.7) > 0.85 ? 0.05 : 1.0
            let tone = sin(2 * .pi * 170 * time) + 0.35 * sin(2 * .pi * 340 * time)
            samples[index] = Float(0.3 * syllable * pause * tone)
        }
        do { try file.write(from: buffer) } catch { return false }
        return true
    }

    /// A portrait for the face viewer: a figure on a soft gradient.
    nonisolated private static func photo() -> UIImage {
        let size = CGSize(width: 900, height: 1100)
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).image { context in
            let c = context.cgContext
            let space = CGColorSpaceCreateDeviceRGB()
            if let gradient = CGGradient(colorsSpace: space, colors: [
                UIColor(red: 0.99, green: 0.80, blue: 0.86, alpha: 1).cgColor,
                UIColor(red: 0.62, green: 0.55, blue: 0.98, alpha: 1).cgColor,
            ] as CFArray, locations: [0, 1]) {
                c.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: size.width, y: size.height), options: [])
            }
            UIColor(red: 0.22, green: 0.16, blue: 0.32, alpha: 1).setFill()
            c.fillEllipse(in: CGRect(x: 300, y: 260, width: 300, height: 340))
            c.addPath(UIBezierPath(roundedRect: CGRect(x: 170, y: 640, width: 560, height: 520), cornerRadius: 260).cgPath)
            c.fillPath()
            UIColor(red: 0.98, green: 0.86, blue: 0.76, alpha: 1).setFill()
            c.fillEllipse(in: CGRect(x: 330, y: 310, width: 240, height: 280))
        }
    }
}

/// A fixture screen that needs the files first.
private struct ChatMediaFixtureLoad<Content: View>: View {
    @ViewBuilder let content: (ChatMediaFixtures.Files) -> Content
    @ObservedObject private var fixtures = ChatMediaFixtures.shared

    init(@ViewBuilder content: @escaping (ChatMediaFixtures.Files) -> Content) {
        self.content = content
    }

    var body: some View {
        Group {
            if let files = fixtures.files {
                content(files)
            } else {
                ZStack {
                    Color.black.ignoresSafeArea()
                    ProgressView().tint(.white)
                }
            }
        }
        .onAppear { fixtures.make() }
    }
}

/// A group conversation of nothing but media, drawn by the room's own rows.
private struct ChatMediaFixtureRoom: View {
    var voiceRate: Float = 1

    @ObservedObject private var fixtures = ChatMediaFixtures.shared
    @State private var video: ChatVideoPayload?
    @State private var face: ChatFacePayload?

    var body: some View {
        VStack(spacing: 0) {
            ChatRoomHeader(
                title: "Villa Al Fulan — site",
                avatarURL: nil,
                studioMark: false,
                isGroup: true,
                online: false,
                status: .line(L("%d people · %d here", 4, 2)),
                onOpenFace: {
                    face = ChatFacePayload(
                        name: "Villa Al Fulan — site",
                        subtitle: L("%d people · %d here", 4, 2),
                        url: nil,
                        isGroup: true,
                        action: ChatFaceAction(title: L("Group info"), symbol: "info.circle") { Toast.info(L("Group info")) }
                    )
                },
                onOpenInfo: { Toast.info(L("Group info")) },
                onBack: {}
            ) {
                IconButton("magnifyingglass", label: L("Search"), size: NeonSize.circleButton) {}
            }
            .padding(.bottom, 6)

            if let files = fixtures.files {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 2) {
                            ForEach(Array(rows(files).enumerated()), id: \.offset) { _, row in
                                row
                            }
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 12)
                        .debugScroll(proxy)
                    }
                }
            } else {
                ChatRoomSkeleton()
                Spacer(minLength: 0)
            }
        }
        .background { ChatRoomWallpaper().ignoresSafeArea() }
        .toolbar(.hidden, for: .navigationBar)
        .environment(\.chatRoomPalette, ChatRoomPalette(people: people))
        .fullScreenCover(item: $video) { ChatVideoPlayerScreen(payload: $0).neonLanguage() }
        .fullScreenCover(item: $face) { ChatFaceViewer(payload: $0).neonLanguage() }
        .onAppear {
            fixtures.make()
            while ChatVoicePlayer.shared.rate != voiceRate { ChatVoicePlayer.shared.cycleRate() }
        }
    }

    private var people: [ChatPerson] {
        [
            ChatPerson(id: "fx-sally", name: "Sally Haddad", role: nil, color: "pink", avatar: fixtures.files?.facePhoto.absoluteString),
            ChatPerson(id: "fx-omar", name: "Omar Khalil", role: nil, color: "cyan", avatar: nil),
        ]
    }

    private func rows(_ files: ChatMediaFixtures.Files) -> [AnyView] {
        let landscape = message("fx-1", from: "fx-sally", "Sally Haddad", minutesAgo: 50, kind: "FILE",
                                body: "The living room walk-through, before the joinery goes in.",
                                url: files.landscapeVideo, name: "walkthrough.mp4", type: "mp4")
        let mineVideo = message("fx-2", from: nil, nil, minutesAgo: 41, kind: "FILE", body: nil,
                                url: files.portraitVideo, name: "kitchen.mp4", type: "mp4")
        let broken = message("fx-3", from: "fx-omar", "Omar Khalil", minutesAgo: 30, kind: "FILE", body: nil,
                             url: files.brokenVideo, name: "site.mp4", type: "video/mp4")
        let voiceTheirs = message("fx-4", from: "fx-omar", "Omar Khalil", minutesAgo: 20, kind: "VOICE", body: nil,
                                  url: files.voiceLong, name: "Voice message", type: "m4a", seconds: 23)
        let voiceMine = message("fx-5", from: nil, nil, minutesAgo: 12, kind: "VOICE", body: nil,
                                url: files.voiceShort, name: "Voice message", type: "m4a", seconds: 6)
        let file = message("fx-6", from: "fx-sally", "Sally Haddad", minutesAgo: 8, kind: "FILE", body: nil,
                           url: files.pdf, name: "BOQ — kitchen.pdf", type: "pdf", size: 482_000)
        let sending = ChatOutgoing(
            payload: .file(UploadFile(field: "document", filename: "kitchen-close-up.mp4", mimeType: "video/mp4", data: files.portraitData), caption: ""),
            project: nil,
            author: nil,
            knownIds: []
        )
        return [
            AnyView(ChatDaySeparator(iso: landscape.createdAt)),
            AnyView(row(landscape, mine: false, showAuthor: true, tail: true).id("videos")),
            row(mineVideo, mine: true, showAuthor: false, tail: true, delivery: .read),
            row(broken, mine: false, showAuthor: true, tail: true),
            AnyView(row(voiceTheirs, mine: false, showAuthor: true, tail: true).id("voice")),
            row(voiceMine, mine: true, showAuthor: false, tail: true, delivery: .delivered),
            row(file, mine: false, showAuthor: true, tail: true),
            AnyView(ChatMessageRow(
                message: sending.message, mine: true, showAuthor: false, tail: true, delivery: sending.delivery,
                viewerIdentity: nil, tallies: [], isPinned: false, callSlug: "fixture", inGroup: true, outgoing: sending,
                openImage: {}, sendProof: { _, _ in }, onReact: { _ in }, onPin: { _ in }, onDelete: nil, onCardChanged: {}
            )),
        ]
    }

    private func row(_ message: ChatMessage, mine: Bool, showAuthor: Bool, tail: Bool, delivery: ChatDelivery? = nil) -> AnyView {
        AnyView(ChatMessageRow(
            message: message, mine: mine, showAuthor: showAuthor, tail: tail, delivery: mine ? (delivery ?? .sent) : nil,
            viewerIdentity: nil, tallies: [], isPinned: false, callSlug: "fixture", inGroup: true,
            openImage: {}, sendProof: { _, _ in }, onReact: { _ in }, onPin: { _ in }, onDelete: nil, onCardChanged: {},
            openVideo: {
                guard let url = message.attachmentURL else { return }
                video = ChatVideoPayload(id: message.id, url: url, title: mine ? L("You") : message.authorName,
                                         subtitle: formattedISODate(message.createdAt), caption: message.body,
                                         fileName: message.attachmentName)
            },
            openFace: { face = $0 }
        ))
    }

    private func message(
        _ id: String, from employee: String?, _ name: String?, minutesAgo: Double, kind: String, body: String?,
        url: URL, name fileName: String, type: String, seconds: Double? = nil, size: Int? = nil
    ) -> ChatMessage {
        ChatMessage(
            id: id,
            authorType: employee == nil ? "ADMIN" : "EMPLOYEE",
            authorId: employee,
            authorName: name ?? "Manager",
            kind: kind,
            body: body,
            attachmentUrl: url.absoluteString,
            attachmentName: fileName,
            attachmentType: type,
            attachmentSize: size,
            durationSeconds: seconds,
            managerOnly: nil,
            createdAt: ChatMediaFixtures.iso(minutesAgo: minutesAgo),
            project: nil,
            task: nil,
            call: nil,
            meeting: nil
        )
    }
}
/// Questions about a task as a conversation draws them: somebody's, with
/// the task quoted above what they asked; my own, whose quote opens the task;
/// and one that is the quote alone.
private struct ChatTaskQuoteFixture: View {
    var body: some View {
        ScrollView {
            VStack(spacing: 2) {
                ChatDaySeparator(iso: ChatMediaFixtures.iso(minutesAgo: 30))
                row(question("fx-q1", from: "fx-sally", "Sally Haddad", minutesAgo: 30, title: "تجهيز عينات الرخام للعميل",
                             text: "هل أرسل العينات اليوم أم أنتظر موافقة العميل؟"), mine: false, opens: false)
                row(question("fx-q2", from: nil, nil, minutesAgo: 22, title: "Working drawings · Villa Al Fulan",
                             text: "Which revision of the plan should the sections follow?"), mine: true, opens: true)
                row(question("fx-q3", from: "fx-omar", "Omar Khalil", minutesAgo: 9, title: "Order the kitchen handles", text: nil),
                    mine: false, opens: false)
            }
            .padding(.horizontal, 12)
            .padding(.top, 12)
        }
        .background { ChatRoomWallpaper().ignoresSafeArea() }
        .environment(\.chatRoomPalette, ChatRoomPalette(people: [
            ChatPerson(id: "fx-sally", name: "Sally Haddad", role: nil, color: "pink", avatar: nil),
            ChatPerson(id: "fx-omar", name: "Omar Khalil", role: nil, color: "cyan", avatar: nil),
        ]))
    }

    private func row(_ message: ChatMessage, mine: Bool, opens: Bool) -> some View {
        ChatMessageRow(
            message: message, mine: mine, showAuthor: true, tail: true, delivery: mine ? .read : nil,
            viewerIdentity: nil, tallies: [], isPinned: false, callSlug: "fixture", inGroup: true,
            openImage: {}, sendProof: { _, _ in }, onReact: { _ in }, onPin: { _ in }, onDelete: nil, onCardChanged: {},
            openAbout: opens ? {} : nil
        )
    }

    private func question(_ id: String, from employee: String?, _ name: String?, minutesAgo: Double, title: String, text: String?) -> ChatMessage {
        ChatMessage(
            id: id,
            authorType: employee == nil ? "ADMIN" : "EMPLOYEE",
            authorId: employee,
            authorName: name ?? "Manager",
            kind: "TEXT",
            body: text.map { "📋 \(title)\n\($0)" } ?? "📋 \(title)",
            attachmentUrl: nil,
            attachmentName: nil,
            attachmentType: nil,
            attachmentSize: nil,
            durationSeconds: nil,
            managerOnly: nil,
            createdAt: ChatMediaFixtures.iso(minutesAgo: minutesAgo),
            project: nil,
            task: nil,
            call: nil,
            meeting: nil,
            aboutAssignedTaskId: "fx-job",
            aboutEntryId: nil,
            aboutTitle: title
        )
    }
}
#endif
