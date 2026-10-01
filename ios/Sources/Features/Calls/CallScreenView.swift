import SwiftUI
import WebRTC

// The call itself, full screen — the Swift counterpart of
// components/calls/call-screen.tsx. One other person fills the screen (their
// picture, or their avatar large) with this phone's own picture in a corner
// that can be dragged to any other; three or more share a grid, or a
// speaker view (one large, the rest in a strip) like the web's. The in-call
// chat panel and sending a screen are left out — see FEATURES.md.
//
// CallStage draws from plain values, so the debug router can show every
// state of it without a call (CallsScreens.swift); CallScreenView reads
// those values off the running session.

// MARK: - What the stage draws

/// One person's square on the call screen.
struct CallTileModel: Identifiable {
    let id: String
    let name: String
    /// The colour the studio gave them (the server's `color`), so their face
    /// is the one the chat shows.
    var color: String?
    /// A photo of them, when the server has one.
    var avatarURL: URL?
    /// Their picture when there is one to show (camera on, or a shared screen).
    var video: RTCVideoTrack?
    var mirror = false
    var audioMuted = false
    var sharing = false
    var speaking = false
    var quality: CallQuality = .unknown
    var isSelf = false
    var connection: CallPeerConnState = .connected
    /// Still not connected after a while — said as such, not as a failure.
    var stalled = false

    var face: CallFace { CallFace(name: name, color: color, url: avatarURL, kind: .person) }
}

struct CallStageModel {
    var title: String
    /// The call's face: the other person, the group, or the studio's team.
    var titleFace: CallFace
    var isVideo: Bool
    var isGroup: Bool
    /// The line under the title: the duration, or where the call stands.
    var status: String
    /// What the big avatar says while nobody else is in: calling, connecting,
    /// or that nobody else is in right now.
    var waiting: String
    var phase: CallSessionPhase
    var ringing: Bool
    var me: CallTileModel
    var others: [CallTileModel]
    var audioMuted: Bool
    /// False when the microphone was refused: there is nothing to unmute.
    var micAvailable = true
    var cameraOn: Bool
    var onSpeaker: Bool
    /// Everybody in the call now, this phone included.
    var inCall: Int
    var notice: String?
}

struct CallStageActions {
    var minimize: () -> Void = {}
    var toggleMute: () -> Void = {}
    var toggleCamera: () -> Void = {}
    var flipCamera: () -> Void = {}
    var toggleSpeaker: () -> Void = {}
    var hangUp: () -> Void = {}
    var showPeople: () -> Void = {}
    var dismissNotice: () -> Void = {}
}

enum CallLayout { case grid, speaker }

// MARK: - The stage

struct CallStage: View {
    let model: CallStageModel
    var actions: CallStageActions

    @State private var layout: CallLayout
    @State private var pinned: String?
    @State private var chromeHidden = false
    /// How tall the notice is, so the big avatar moves down under it rather
    /// than being covered on a smaller phone.
    @State private var noticeHeight: CGFloat = 0

    init(model: CallStageModel, actions: CallStageActions, initialLayout: CallLayout = .grid) {
        self.model = model
        self.actions = actions
        _layout = State(initialValue: initialLayout)
    }

    private var single: CallTileModel? { model.others.count == 1 ? model.others[0] : nil }
    /// One person's picture fills the screen, so the controls can step aside.
    private var fullBleedVideo: Bool { single?.video != nil }
    private var tiled: Bool { model.others.count >= 2 }

    var body: some View {
        ZStack {
            CallBackdrop(hue: backdropHue, animated: model.others.isEmpty)

            if model.others.isEmpty {
                waitingStage
            } else if let single {
                oneToOne(single)
            }

            VStack(spacing: 0) {
                topBar
                    .opacity(chromeHidden ? 0 : 1)
                if let notice = model.notice {
                    CallNoticeBanner(
                        text: notice,
                        actionTitle: callNoticeOpensSettings(notice) ? L("Open Settings") : nil,
                        action: callNoticeOpensSettings(notice) ? { openCallSettings() } : nil,
                        onDismiss: actions.dismissNotice
                    )
                    .padding(.horizontal, NeonSpace.gutter)
                    .padding(.top, NeonSpace.sm)
                    .background(
                        GeometryReader { proxy in
                            Color.clear
                                .onAppear { noticeHeight = proxy.size.height }
                                .onChange(of: proxy.size.height) { noticeHeight = $0 }
                        }
                    )
                    .onDisappear { noticeHeight = 0 }
                    .transition(.neonDrop)
                }
                if tiled {
                    tiles
                        .padding(.horizontal, NeonSpace.sm)
                        .padding(.vertical, NeonSpace.sm)
                        .frame(maxHeight: .infinity)
                        .transition(.opacity)
                } else {
                    Spacer(minLength: 0)
                }
                controls
                    .opacity(chromeHidden ? 0 : 1)
                    .offset(y: chromeHidden ? 60 : 0)
            }
        }
        .animation(NeonMotion.smooth, value: model.others.count)
        .animation(NeonMotion.snappy, value: chromeHidden)
        .animation(NeonMotion.smooth, value: layout)
        .animation(NeonMotion.bouncy, value: model.notice)
        .onChange(of: fullBleedVideo) { if !$0 { chromeHidden = false } }
    }

    private var backdropHue: NeonHue? {
        if let single { return single.face.hue }
        return model.others.isEmpty && !model.isGroup ? model.titleFace.hue : nil
    }

    /// Room for the notice above the big avatar.
    private var belowNotice: CGFloat { noticeHeight > 0 ? noticeHeight : 0 }

    // MARK: Nobody else in yet

    private var waitingStage: some View {
        ZStack {
            if let video = model.me.video {
                CallVideoView(track: video, mirror: model.me.mirror)
                    .ignoresSafeArea()
                CallScrim()
            }
            VStack(spacing: NeonSpace.xl) {
                Spacer()
                CallHalo(face: model.titleFace, size: 132, ringing: model.ringing)
                VStack(spacing: NeonSpace.sm) {
                    CallCenteredName(model.title, font: .neonDisplay)
                    Text(model.waiting)
                        .font(.neonCallout)
                        .foregroundStyle(.white.opacity(0.78))
                        .multilineTextAlignment(.center)
                }
                .padding(.horizontal, NeonSpace.xxl)
                Spacer()
                Spacer()
            }
            .padding(.top, belowNotice)
        }
    }

    // MARK: One other person

    private func oneToOne(_ person: CallTileModel) -> some View {
        ZStack {
            if let video = person.video {
                CallVideoView(track: video, contentMode: person.sharing ? .scaleAspectFit : .scaleAspectFill)
                    .ignoresSafeArea()
                    .transition(.opacity)
                CallScrim()
                    .opacity(chromeHidden ? 0 : 1)
                if person.audioMuted {
                    VStack {
                        Spacer()
                        CallNameTag(name: person.name, muted: true, quality: person.quality)
                            .padding(.bottom, chromeHidden ? NeonSpace.xxl : 170)
                    }
                    .transition(.opacity)
                }
            } else {
                VStack(spacing: NeonSpace.lg) {
                    Spacer()
                    CallHalo(face: person.face, size: 136, speaking: person.speaking)
                    VStack(spacing: NeonSpace.sm) {
                        CallCenteredName(person.name, font: .neonDisplay)
                        HStack(spacing: NeonSpace.sm) {
                            if person.connection == .connected {
                                CallLiveDot(phase: model.phase)
                            } else {
                                ProgressView().tint(.white).controlSize(.small)
                            }
                            Text(person.connection == .connected ? model.status : CallConnectionNote.text(person.connection, stalled: person.stalled))
                                .font(.neonCallout.monospacedDigit())
                                .foregroundStyle(.white.opacity(0.8))
                            if person.connection == .connected, person.quality != .unknown {
                                CallQualityBars(quality: person.quality)
                            }
                        }
                        if person.stalled, person.connection != .connected {
                            CallStalledHint()
                                .transition(.opacity)
                        }
                        if person.audioMuted {
                            Label(L("Muted"), systemImage: "mic.slash.fill")
                                .font(.system(.footnote, weight: .semibold))
                                .foregroundStyle(.white)
                                .padding(.horizontal, NeonSpace.md)
                                .padding(.vertical, 6)
                                .background(CallGlass(shape: Capsule(), strength: 0.3))
                                .transition(.neonPop)
                        }
                    }
                    .padding(.horizontal, NeonSpace.xxl)
                    Spacer()
                    Spacer()
                }
                .padding(.top, belowNotice)
                .transition(.opacity)
            }

            // Over a picture there is no status line to carry it.
            if person.video != nil, person.connection != .connected {
                VStack(spacing: NeonSpace.sm) {
                    CallConnectionNote(connection: person.connection, stalled: person.stalled)
                    if person.stalled { CallStalledHint() }
                }
                .padding(.horizontal, NeonSpace.xxl)
                .transition(.neonPop)
            }

            if model.cameraOn || model.isVideo {
                CallDraggable(topInset: 76, bottomInset: 150) {
                    CallTileView(tile: model.me, style: .pip)
                        .frame(width: 100, height: 142)
                        .neonShadow(.floating)
                }
            }
        }
        .contentShape(Rectangle())
        .onTapGesture {
            guard person.video != nil else { return }
            withNeonAnimation(.snappy) { chromeHidden.toggle() }
        }
    }

    // MARK: Three or more

    @ViewBuilder
    private var tiles: some View {
        let everyone = model.others + [model.me]
        if layout == .speaker, let focus = speakerFocus {
            let rest = everyone.filter { $0.id != focus.id }
            VStack(spacing: NeonSpace.sm) {
                CallTileView(tile: focus, style: .large)
                    .id(focus.id)
                    .transition(.opacity)
                CallSpeakerStrip(tiles: rest) { tile in
                    Haptic.selection()
                    withNeonAnimation(.smooth) { pinned = tile.id }
                }
            }
        } else {
            CallGrid(tiles: everyone)
        }
    }

    /// Who the speaker view shows large: somebody chosen, else a shared
    /// screen, else whoever is talking, else the first person.
    private var speakerFocus: CallTileModel? {
        if let pinned, let chosen = (model.others + [model.me]).first(where: { $0.id == pinned }) { return chosen }
        return model.others.first(where: \.sharing) ?? model.others.first(where: \.speaking) ?? model.others.first
    }

    // MARK: Top and bottom

    private var topBar: some View {
        HStack(spacing: NeonSpace.sm) {
            CallGlassIconButton(symbol: "chevron.down", label: L("Minimise"), action: actions.minimize)
            topCenter
                .frame(maxWidth: .infinity)
            if tiled {
                CallGlassIconButton(
                    symbol: layout == .grid ? "rectangle.inset.filled.and.person.filled" : "square.grid.2x2.fill",
                    label: layout == .grid ? L("Speaker view") : L("Grid view")
                ) {
                    layout = layout == .grid ? .speaker : .grid
                    pinned = nil
                }
            }
            Button(action: actions.showPeople) {
                HStack(spacing: 6) {
                    Image(systemName: "person.2.fill")
                        .font(.system(size: 14, weight: .semibold))
                    Text(NeonFormat.integer(model.inCall))
                        .font(.system(.subheadline, weight: .bold).monospacedDigit())
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 14)
                .frame(height: NeonSize.circleButton)
                .background(CallGlass(shape: Capsule(), strength: 0.22))
            }
            .buttonStyle(PressableStyle(scale: 0.92))
            .accessibilityLabel(L("People"))
            .accessibilityValue(L("%@ in the call", NeonFormat.integer(model.inCall)))
        }
        .padding(.horizontal, NeonSpace.gutter)
        .padding(.top, NeonSpace.xs)
        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
    }

    /// Over a picture or a grid, the name and the time; over the big avatar
    /// (which already says both), only what kind of call this is.
    @ViewBuilder
    private var topCenter: some View {
        if tiled || fullBleedVideo {
            VStack(spacing: 2) {
                CallCenteredName(single?.name ?? model.title, font: .system(.headline, weight: .bold), lines: 1)
                HStack(spacing: 6) {
                    CallLiveDot(phase: model.phase)
                    Text(model.status)
                        .font(.neonCaption.monospacedDigit())
                        .foregroundStyle(.white.opacity(0.8))
                        .lineLimit(1)
                }
            }
        } else {
            Label(model.isVideo ? L("NEON video call") : L("NEON voice call"), systemImage: model.isVideo ? "video.fill" : "phone.fill")
                .font(.system(.caption, weight: .semibold))
                .foregroundStyle(.white.opacity(0.9))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .padding(.horizontal, NeonSpace.md)
                .padding(.vertical, 7)
                .background(CallGlass(shape: Capsule(), strength: 0.2))
        }
    }

    /// White discs mean one thing on every call screen: "you are not sending
    /// this" — muted, no microphone, camera off. The speaker is a sound
    /// setting, not something sent, so it keeps the glass and shows its state
    /// with its glyph and an indigo dot.
    private var controls: some View {
        HStack(alignment: .top, spacing: 0) {
            CallRoundButton(
                symbol: model.onSpeaker ? "speaker.wave.2.fill" : "speaker.fill", title: L("Speaker"),
                look: .glass, value: model.onSpeaker ? L("Turned on") : L("Turned off"),
                mark: model.onSpeaker ? .on : nil,
                action: actions.toggleSpeaker
            )
            .frame(maxWidth: .infinity)
            CallRoundButton(
                symbol: model.cameraOn ? "video.fill" : "video.slash.fill", title: model.cameraOn ? L("Camera") : L("Camera off"),
                look: model.cameraOn ? .glass : .active, value: model.cameraOn ? L("Turned on") : L("Turned off"),
                action: actions.toggleCamera
            )
            .frame(maxWidth: .infinity)
            if model.cameraOn {
                CallRoundButton(symbol: "arrow.triangle.2.circlepath.camera.fill", title: L("Flip"), action: actions.flipCamera)
                    .frame(maxWidth: .infinity)
                    .transition(.neonPop)
            }
            if model.micAvailable {
                CallRoundButton(
                    symbol: model.audioMuted ? "mic.slash.fill" : "mic.fill", title: model.audioMuted ? L("Unmute") : L("Mute"),
                    look: model.audioMuted ? .active : .glass, value: model.audioMuted ? L("Muted") : L("Microphone on"),
                    action: actions.toggleMute
                )
                .frame(maxWidth: .infinity)
            } else {
                // Refused in Settings: there is no microphone to switch, so
                // the button goes where it can be allowed again.
                CallRoundButton(symbol: "mic.slash.fill", title: L("No mic"), look: .active, value: L("Microphone blocked"), mark: .warning) {
                    openCallSettings()
                }
                .accessibilityHint(Text(L("Opens Settings")))
                .frame(maxWidth: .infinity)
            }
            CallRoundButton(symbol: "phone.down.fill", title: L("End"), look: .danger, action: actions.hangUp)
                .frame(maxWidth: .infinity)
        }
        .padding(.horizontal, NeonSpace.sm)
        .padding(.top, NeonSpace.lg)
        .padding(.bottom, NeonSpace.md)
        .background(CallGlass(shape: RoundedRectangle(cornerRadius: NeonRadius.xxl, style: .continuous), strength: 0.32))
        .padding(.horizontal, NeonSpace.md)
        .padding(.bottom, NeonSpace.xs)
        .animation(NeonMotion.snappy, value: model.cameraOn)
    }
}

// MARK: - Tiles

enum CallTileStyle { case grid, large, strip, pip }

/// One person: their picture, or their avatar on their colour; their name,
/// whether they are muted and how their connection is; the brand's ring
/// while they speak.
struct CallTileView: View {
    let tile: CallTileModel
    var style: CallTileStyle = .grid

    /// The small tiles mark a speaker with a ring round the face; the large
    /// ones with the tile's own border. One cue each, never both.
    private var ringsFace: Bool { style == .strip || style == .pip }

    var body: some View {
        let hue = tile.face.hue
        let radius: CGFloat = style == .strip ? NeonRadius.md : style == .pip ? 20 : NeonRadius.lg
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        GeometryReader { geo in
            let side = min(geo.size.width, geo.size.height)
            ZStack {
                // Every tile ends in the brand's violet, whatever the person's
                // own colour: warm colours over grey turned brown and olive.
                Color.neonInk
                LinearGradient(
                    colors: [(hue?.color ?? .neonPurple).opacity(CallBackdrop.glow(hue) < 0.5 ? 0.4 : 0.55), Color.neonIndigoStrong.opacity(0.85)],
                    startPoint: .topLeading, endPoint: .bottomTrailing
                )
                if let video = tile.video {
                    CallVideoView(track: video, mirror: tile.mirror, contentMode: tile.sharing ? .scaleAspectFit : .scaleAspectFill)
                } else {
                    let size = min(max(side * 0.44, 34), 112)
                    ZStack {
                        if tile.speaking, ringsFace {
                            Circle()
                                .strokeBorder(AngularGradient.neonStory, lineWidth: 3)
                                .frame(width: size + 12, height: size + 12)
                                .transition(.neonPop)
                        }
                        CallFaceView(face: tile.face, size: size)
                            .overlay(Circle().strokeBorder(Color.white.opacity(0.7), lineWidth: max(1.5, size * 0.025)))
                    }
                }
                if !tile.isSelf, tile.connection != .connected {
                    Color.black.opacity(0.4)
                    if style == .strip || style == .pip {
                        ProgressView().tint(.white)
                    } else {
                        VStack {
                            CallConnectionNote(connection: tile.connection, stalled: tile.stalled)
                                .scaleEffect(0.9)
                                .padding(.top, NeonSpace.md)
                            Spacer(minLength: 0)
                        }
                    }
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .clipShape(shape)
        .overlay(alignment: .bottomLeading) { tag.padding(style == .strip || style == .pip ? 6 : NeonSpace.sm) }
        .overlay {
            if tile.speaking, !ringsFace {
                shape.strokeBorder(AngularGradient.neonStory, lineWidth: 3)
                    .shadow(color: .neonPurple.opacity(0.55), radius: 10)
            } else {
                shape.strokeBorder(Color.white.opacity(0.1), lineWidth: 1)
            }
        }
        .animation(NeonMotion.snappy, value: tile.speaking)
        .animation(NeonMotion.smooth, value: tile.video != nil)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(accessibilityText))
    }

    @ViewBuilder
    private var tag: some View {
        switch style {
        case .pip:
            // This phone's own corner says nothing unless muted; anybody
            // else in a small window (the minimised call) keeps their name.
            if tile.isSelf {
                if tile.audioMuted { CallNameTag(name: L("You"), muted: true) }
            } else {
                CallNameTag(name: tile.name, muted: tile.audioMuted, compact: true)
            }
        case .strip:
            CallNameTag(name: tile.isSelf ? L("You") : tile.name, muted: tile.audioMuted, compact: true)
        case .grid, .large:
            // No bars for somebody not connected yet: there is no connection
            // to measure, whatever the last numbers said.
            CallNameTag(
                name: tile.isSelf ? L("You") : tile.name, muted: tile.audioMuted,
                quality: tile.isSelf || tile.connection != .connected ? nil : tile.quality
            )
        }
    }

    private var accessibilityText: String {
        var parts = [tile.isSelf ? L("You") : tile.name]
        if tile.audioMuted { parts.append(L("Muted")) }
        if tile.speaking { parts.append(L("Speaking")) }
        if tile.video == nil { parts.append(L("Camera off")) }
        if !tile.isSelf, tile.connection != .connected { parts.append(CallConnectionNote.text(tile.connection, stalled: tile.stalled)) }
        return parts.joined(separator: ", ")
    }
}

/// Everybody at once, as the web's `gridFor` lays them out: the tiles share
/// the space evenly, and scroll only when there are too many to stay legible.
struct CallGrid: View {
    let tiles: [CallTileModel]

    var body: some View {
        GeometryReader { geo in
            let shape = callGridFor(count: tiles.count, narrow: geo.size.width < geo.size.height)
            let columns = max(1, shape.columns)
            let rows = max(1, shape.rows)
            let spacing = NeonSpace.sm
            let width = (geo.size.width - spacing * CGFloat(columns - 1)) / CGFloat(columns)
            let height = (geo.size.height - spacing * CGFloat(rows - 1)) / CGFloat(rows)
            if height >= 120 {
                VStack(spacing: spacing) {
                    ForEach(0..<rows, id: \.self) { row in
                        HStack(spacing: spacing) {
                            ForEach(Array(tiles.dropFirst(row * columns).prefix(columns))) { tile in
                                CallTileView(tile: tile)
                                    .frame(width: width, height: height)
                                    .transition(.neonPop)
                            }
                        }
                        .frame(maxWidth: .infinity)
                    }
                }
            } else {
                ScrollView {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: spacing), count: columns), spacing: spacing) {
                        ForEach(tiles) { tile in
                            CallTileView(tile: tile)
                                .aspectRatio(3.0 / 4.0, contentMode: .fit)
                        }
                    }
                }
            }
        }
    }
}

/// "Connecting…", "Reconnecting…", or — after a while without connecting —
/// "Still connecting…": a fact about the connection, never a verdict on
/// anybody.
struct CallConnectionNote: View {
    let connection: CallPeerConnState
    var stalled = false

    static func text(_ connection: CallPeerConnState, stalled: Bool) -> String {
        switch connection {
        case .reconnecting: return L("Reconnecting…")
        case .connecting, .connected: return stalled ? L("Still connecting…") : L("Connecting…")
        }
    }

    var body: some View {
        HStack(spacing: NeonSpace.sm) {
            ProgressView().tint(.white).controlSize(.small)
            Text(Self.text(connection, stalled: stalled))
                .font(.system(.footnote, weight: .semibold))
                .foregroundStyle(.white)
        }
        .padding(.horizontal, NeonSpace.lg)
        .padding(.vertical, 10)
        .background(CallGlass(shape: Capsule(), strength: 0.4))
        .accessibilityElement(children: .combine)
    }
}

/// Under "Still connecting…": what that usually means and what can be done.
/// A fact about networks — some refuse direct connections — never a
/// verdict on the other person.
struct CallStalledHint: View {
    var body: some View {
        Text(L("Some networks block calls. You can hang up and try again."))
            .font(.neonFootnote)
            .foregroundStyle(.white.opacity(0.7))
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// The speaker view's strip: everybody but the one shown large. When they fit,
/// the tiles share the width (up to 118 pt each, 3:4) and sit centred; when
/// they do not, the strip scrolls, still centred while it is short.
struct CallSpeakerStrip: View {
    let tiles: [CallTileModel]
    let onSelect: (CallTileModel) -> Void

    @State private var available: CGFloat = 0

    private static let minWidth: CGFloat = 88
    private static let maxWidth: CGFloat = 118

    private var fitted: CGFloat {
        let count = CGFloat(max(tiles.count, 1))
        return (available - NeonSpace.sm * (count - 1)) / count
    }
    private var fits: Bool { fitted >= Self.minWidth }
    private var tileWidth: CGFloat { fits ? min(Self.maxWidth, fitted) : Self.minWidth }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: NeonSpace.sm) {
                ForEach(tiles) { tile in
                    Button { onSelect(tile) } label: {
                        CallTileView(tile: tile, style: .strip)
                            .frame(width: tileWidth, height: tileWidth * 4 / 3)
                    }
                    .buttonStyle(PressableStyle(scale: 0.95))
                    .accessibilityLabel(Text(tile.isSelf ? L("You") : tile.name))
                    .accessibilityHint(Text(L("Show large")))
                }
            }
            .frame(minWidth: available)
        }
        .scrollDisabled(fits)
        .frame(maxWidth: .infinity)
        .frame(height: tileWidth * 4 / 3)
        .background(
            GeometryReader { proxy in
                Color.clear
                    .onAppear { available = proxy.size.width }
                    .onChange(of: proxy.size.width) { available = $0 }
            }
        )
    }
}

/// A darker top and bottom over a picture, so the controls and the name
/// stay readable on anything.
struct CallScrim: View {
    var body: some View {
        LinearGradient(
            stops: [
                .init(color: .black.opacity(0.55), location: 0),
                .init(color: .black.opacity(0), location: 0.22),
                .init(color: .black.opacity(0), location: 0.6),
                .init(color: .black.opacity(0.6), location: 1),
            ],
            startPoint: .top, endPoint: .bottom
        )
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }
}

/// A name, centred, in its own writing direction.
struct CallCenteredName: View {
    let name: String
    var font: Font
    var lines: Int

    init(_ name: String, font: Font, lines: Int = 2) {
        self.name = name
        self.font = font
        self.lines = lines
    }

    var body: some View {
        Text(verbatim: name)
            .font(font)
            .foregroundStyle(.white)
            .multilineTextAlignment(.center)
            .lineLimit(lines)
            .minimumScaleFactor(0.7)
            .environment(\.layoutDirection, naturalDirection(name) ?? AppLanguage.current.layoutDirection)
    }
}

/// Something small that floats over the stage and can be dragged to any
/// corner, where it settles — this phone's own picture, the minimised call.
/// Laid out in screen terms (left is left), so the corners stay corners in
/// Arabic too; the content inside keeps the app's direction.
struct CallDraggable<Content: View>: View {
    var topInset: CGFloat
    var bottomInset: CGFloat
    var horizontalInset: CGFloat
    var onFrame: ((CGRect) -> Void)?
    /// Told when a drag starts and when it ends, so a button inside can
    /// refuse the tap a drag ends on (the minimised call's hang-up).
    var onDragging: ((Bool) -> Void)?
    let content: Content

    @State private var corner: Alignment
    @State private var size: CGSize = .zero
    @State private var dragging = false
    @GestureState private var drag: CGSize = .zero

    /// Starts in the trailing corner (the right in English, the left in
    /// Arabic), at the top or the bottom.
    init(
        topInset: CGFloat, bottomInset: CGFloat, horizontalInset: CGFloat = NeonSpace.gutter, startsAtBottom: Bool = false,
        onFrame: ((CGRect) -> Void)? = nil, onDragging: ((Bool) -> Void)? = nil, @ViewBuilder content: () -> Content
    ) {
        self.topInset = topInset
        self.bottomInset = bottomInset
        self.horizontalInset = horizontalInset
        self.onFrame = onFrame
        self.onDragging = onDragging
        self.content = content()
        let horizontal: HorizontalAlignment = AppLanguage.current == .arabic ? .leading : .trailing
        _corner = State(initialValue: Alignment(horizontal: horizontal, vertical: startsAtBottom ? .bottom : .top))
    }

    var body: some View {
        GeometryReader { geo in
            content
                .environment(\.layoutDirection, AppLanguage.current.layoutDirection)
                .background(
                    GeometryReader { inner in
                        Color.clear
                            .onAppear { report(inner) }
                            .onChange(of: inner.frame(in: .global)) { _ in report(inner) }
                    }
                )
                .offset(drag)
                .gesture(
                    DragGesture(minimumDistance: 6)
                        .updating($drag) { value, state, _ in state = value.translation }
                        .onChanged { _ in
                            if !dragging {
                                dragging = true
                                onDragging?(true)
                            }
                        }
                        .onEnded { value in
                            dragging = false
                            onDragging?(false)
                            let area = CGSize(
                                width: geo.size.width - horizontalInset * 2,
                                height: geo.size.height - topInset - bottomInset
                            )
                            let start = origin(of: corner, in: area)
                            let endX = start.x + value.predictedEndTranslation.width + size.width / 2
                            let endY = start.y + value.predictedEndTranslation.height + size.height / 2
                            let horizontal: HorizontalAlignment = endX < area.width / 2 ? .leading : .trailing
                            let vertical: VerticalAlignment = endY < area.height / 2 ? .top : .bottom
                            Haptic.soft()
                            withNeonAnimation(.bouncy) { corner = Alignment(horizontal: horizontal, vertical: vertical) }
                        }
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: corner)
                .padding(.top, topInset)
                .padding(.bottom, bottomInset)
                .padding(.horizontal, horizontalInset)
        }
        .environment(\.layoutDirection, .leftToRight)
    }

    private func report(_ proxy: GeometryProxy) {
        size = proxy.size
        onFrame?(proxy.frame(in: .global))
    }

    private func origin(of corner: Alignment, in area: CGSize) -> CGPoint {
        CGPoint(
            x: corner.horizontal == .leading ? 0 : area.width - size.width,
            y: corner.vertical == .top ? 0 : area.height - size.height
        )
    }
}

/// Whether a notice is one that Settings can fix (a refused microphone or
/// camera), so the banner offers the way there.
func callNoticeOpensSettings(_ text: String) -> Bool {
    [CallMediaProblem.denied, .micDenied, .cameraDenied].contains { $0.text == text }
}

// MARK: - The running call

/// The stage, fed by the session: who is in, their pictures, the time.
struct CallScreenView: View {
    @ObservedObject var center: CallCenter
    @ObservedObject var session: CallSession
    let call: CallView?
    let me: String

    @ObservedObject private var faces = CallFaceDirectory.shared
    @State private var showPeople = false
    @State private var now = Date()
    private let ticker = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        CallStage(model: model, actions: actions)
            .onReceive(ticker) { now = $0 }
            .onAppear { faces.refresh() }
            .sheet(isPresented: $showPeople) {
                CallPeopleLive(
                    callId: session.callId, participants: call?.participants ?? [], me: me,
                    mutedKeys: mutedKeys, onClose: { showPeople = false }
                )
            }
    }

    private var mutedKeys: Set<String> {
        var keys = Set(session.people.filter(\.audioMuted).map(\.key))
        if session.audioMuted { keys.insert(me) }
        return keys
    }

    private var ringing: Bool { session.people.isEmpty && call?.status == "RINGING" }

    /// Somebody's face on the stage, as the call read it — the server looks
    /// it up for every participant (lib/faces.ts) — or nil for initials.
    private func photo(for key: String) -> URL? {
        call?.participants.first { $0.memberKey == key }?.photoURL
    }

    private var model: CallStageModel {
        let others = session.people.map { person in
            let video = person.sharing ? person.screenTrack : (person.videoOff ? nil : person.cameraTrack)
            return CallTileModel(
                id: person.key, name: person.name, color: person.color, avatarURL: photo(for: person.key), video: video,
                audioMuted: person.audioMuted, sharing: person.sharing && person.screenTrack != nil,
                speaking: person.speaking, quality: person.quality, connection: person.connection,
                stalled: person.connectingSince.map { now.timeIntervalSince($0) > 20 } ?? false
            )
        }
        let mine = CallTileModel(
            id: me, name: center.ready?.name ?? L("You"), color: call?.participants.first { $0.memberKey == me }?.color,
            avatarURL: photo(for: me),
            video: session.cameraTrack, mirror: session.mirrorSelf,
            audioMuted: session.audioMuted || session.micTrack == nil, isSelf: true
        )
        let joined = call?.participants.filter { $0.state == "JOINED" && $0.memberKey != me }.count ?? others.count
        let title = call?.title ?? L("Call")
        return CallStageModel(
            title: title,
            titleFace: call.map { faces.face(for: $0, me: me) } ?? .person(title, color: nil),
            isVideo: call?.isVideo ?? (session.cameraTrack != nil),
            isGroup: call?.isGroup ?? false,
            status: status,
            waiting: waiting,
            phase: session.phase,
            ringing: ringing,
            me: mine,
            others: others,
            audioMuted: session.audioMuted || session.micTrack == nil,
            micAvailable: session.micTrack != nil,
            cameraOn: session.cameraTrack != nil,
            onSpeaker: session.onSpeaker,
            inCall: joined + 1,
            notice: session.problem ?? center.notice
        )
    }

    private var status: String {
        switch session.phase {
        case .joining: return ringing ? (call?.isGroup == true ? L("Ringing the team…") : L("Calling…")) : L("Connecting…")
        case .reconnecting: return L("Reconnecting…")
        case .ended: return L("Call ended")
        case .live:
            if let date = parseISODate(call?.answeredAt) {
                return callDurationText(Int(max(0, now.timeIntervalSince(date))))
            }
            return L("Connected")
        }
    }

    private var waiting: String {
        if ringing { return call?.isGroup == true ? L("Ringing the team…") : L("Calling…") }
        if session.phase == .joining || session.phase == .reconnecting { return status }
        return L("Nobody else is in the call right now.")
    }

    private var actions: CallStageActions {
        CallStageActions(
            minimize: { center.minimize() },
            toggleMute: {
                Haptic.selection()
                session.setMuted(!session.audioMuted)
            },
            toggleCamera: {
                Haptic.selection()
                Task { await session.setCameraEnabled(session.videoOff) }
            },
            flipCamera: {
                Haptic.selection()
                Task { await session.flipCamera() }
            },
            toggleSpeaker: {
                Haptic.selection()
                session.toggleSpeaker()
            },
            hangUp: {
                Haptic.warning()
                Task { await session.leave() }
            },
            showPeople: {
                Haptic.tap()
                showPeople = true
            },
            dismissNotice: {
                if session.problem != nil { session.problem = nil } else { center.dismissNotice() }
            }
        )
    }
}
