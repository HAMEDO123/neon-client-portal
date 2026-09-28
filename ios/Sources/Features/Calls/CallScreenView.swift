import SwiftUI
import WebRTC

// The call itself, full screen: a grid of everyone in it, the controls, and
// the ringing/connecting states before anybody else has joined. The Swift
// counterpart of components/calls/call-screen.tsx (its speaker view, screen
// share layout and in-call chat panel are left for a later pass — see
// FEATURES.md).

struct CallScreenView: View {
    @ObservedObject var center: CallCenter
    @ObservedObject var session: CallSession
    let call: CallView?
    let me: String

    @State private var showPeople = false
    @State private var now = Date()
    private let ticker = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        ZStack {
            LinearGradient.neonInkHero.ignoresSafeArea()

            VStack(spacing: 0) {
                header
                Group {
                    let tiles = buildTiles()
                    if tiles.count <= 1, call?.status == "RINGING" {
                        waitingView
                    } else {
                        grid(tiles)
                    }
                }
                .frame(maxHeight: .infinity)
                controls
            }
        }
        .neonLanguage()
        .onReceive(ticker) { now = $0 }
        .overlay(alignment: .top) {
            if let problem = session.problem {
                noticeBanner(problem) { session.problem = nil }
            } else if let notice = center.notice {
                noticeBanner(notice) { center.dismissNotice() }
            }
        }
        .sheet(isPresented: $showPeople) { peopleSheet }
        .statusBarHidden()
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: NeonSpace.sm) {
            IconButton("chevron.down", label: L("Minimise"), look: .glass, tint: .white, size: 36) {
                Haptic.tap()
                center.minimize()
            }
            Spacer(minLength: 0)
            VStack(spacing: 2) {
                DirText(call?.title ?? L("Call"), font: .system(size: 15, weight: .semibold, design: .rounded), color: .white)
                Text(statusLine).font(.neonCaption).foregroundStyle(.white.opacity(0.65))
            }
            Spacer(minLength: 0)
            IconButton("person.2.fill", label: L("People"), look: .glass, tint: .white, size: 36, badge: call?.participants.count) {
                showPeople = true
            }
        }
        .padding(.horizontal, NeonSpace.gutter)
        .padding(.top, NeonSpace.sm)
    }

    private var statusLine: String {
        switch session.phase {
        case .joining: return L("Connecting…")
        case .reconnecting: return L("Reconnecting…")
        case .ended: return L("Call ended")
        case .live:
            if let iso = call?.answeredAt, let date = parseISODate(iso) {
                return callDurationText(Int(max(0, now.timeIntervalSince(date))))
            }
            return L("Connected")
        }
    }

    // MARK: - Grid

    private struct Tile: Identifiable {
        let id: String
        let name: String
        let videoTrack: RTCVideoTrack?
        let mirror: Bool
        let audioMuted: Bool
        let videoOff: Bool
        let speaking: Bool
        let quality: CallQuality
        let isSelf: Bool
        let connection: CallPeerConnState
    }

    private func buildTiles() -> [Tile] {
        var list = [
            Tile(
                id: me, name: L("You"), videoTrack: session.cameraTrack, mirror: session.cameraPosition == "front",
                audioMuted: session.audioMuted, videoOff: session.videoOff, speaking: false, quality: .unknown,
                isSelf: true, connection: .connected
            )
        ]
        for person in session.people {
            list.append(
                Tile(
                    id: person.key, name: person.name,
                    videoTrack: person.sharing ? person.screenTrack : person.cameraTrack, mirror: false,
                    audioMuted: person.audioMuted, videoOff: person.videoOff && !person.sharing,
                    speaking: person.speaking, quality: person.quality, isSelf: false, connection: person.connection
                )
            )
        }
        return list
    }

    private func grid(_ tiles: [Tile]) -> some View {
        GeometryReader { geo in
            let narrow = geo.size.width < geo.size.height
            let shape = callGridFor(count: tiles.count, narrow: narrow)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: max(1, shape.columns)), spacing: 6) {
                ForEach(tiles) { tile in tileView(tile) }
            }
            .padding(6)
        }
    }

    private func tileView(_ tile: Tile) -> some View {
        ZStack(alignment: .bottomLeading) {
            RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous).fill(Color.white.opacity(0.08))

            if let track = tile.videoTrack, !tile.videoOff {
                CallVideoView(track: track, mirror: tile.mirror)
                    .clipShape(RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous))
            } else {
                AvatarView(url: nil, name: tile.name, size: 64)
            }

            if tile.connection == .reconnecting {
                ProgressView().tint(.white).frame(maxWidth: .infinity, maxHeight: .infinity)
            }

            HStack(spacing: 4) {
                if tile.audioMuted {
                    Image(systemName: "mic.slash.fill").font(.system(size: 11)).foregroundStyle(.red.opacity(0.95))
                }
                DirText(tile.name, font: .system(size: 12), color: .white)
                Spacer(minLength: 0)
                if !tile.isSelf { qualityGlyph(tile.quality) }
            }
            .padding(6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(LinearGradient(colors: [.black.opacity(0.55), .clear], startPoint: .bottom, endPoint: .top))
        }
        .overlay(
            RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous)
                .strokeBorder(tile.speaking ? Color.neonSuccessStrong : .clear, lineWidth: 2)
        )
        .aspectRatio(3.0 / 4.0, contentMode: .fit)
        .animation(NeonMotion.snappy, value: tile.speaking)
    }

    private func qualityGlyph(_ quality: CallQuality) -> some View {
        Image(systemName: quality == .poor ? "wifi.exclamationmark" : "wifi")
            .font(.system(size: 10))
            .foregroundStyle(quality == .poor ? .red : quality == .fair ? .yellow : .white.opacity(0.55))
    }

    private var waitingView: some View {
        VStack(spacing: NeonSpace.md) {
            AvatarView(url: nil, name: call?.title ?? "", size: 96).neonFloat()
            Text(call?.isGroup == true ? L("Ringing the team…") : L("Calling %@…", call?.title ?? ""))
                .font(.neonCallout)
                .foregroundStyle(.white.opacity(0.85))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Controls

    private var controls: some View {
        HStack(spacing: NeonSpace.lg) {
            IconButton(
                session.audioMuted ? "mic.slash.fill" : "mic.fill", label: L("Mute"),
                look: session.audioMuted ? .filled : .glass,
                tint: session.audioMuted ? .white : .white, size: 52
            ) {
                Haptic.selection()
                session.setMuted(!session.audioMuted)
            }

            if call?.isVideo == true {
                IconButton(
                    session.videoOff ? "video.slash.fill" : "video.fill", label: L("Camera"),
                    look: session.videoOff ? .filled : .glass, tint: .white, size: 52
                ) {
                    Haptic.selection()
                    Task { await session.setCameraEnabled(session.videoOff) }
                }
                if !session.videoOff {
                    IconButton("arrow.triangle.2.circlepath.camera", label: L("Flip camera"), look: .glass, tint: .white, size: 52) {
                        Haptic.selection()
                        Task { await session.flipCamera() }
                    }
                }
            }

            IconButton(
                session.onSpeaker ? "speaker.wave.2.fill" : "speaker.fill", label: L("Speaker"),
                look: session.onSpeaker ? .filled : .glass, tint: .white, size: 52
            ) {
                Haptic.selection()
                session.toggleSpeaker()
            }

            Button {
                Haptic.warning()
                Task { await session.leave() }
            } label: {
                Image(systemName: "phone.down.fill")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 52, height: 52)
                    .background(Circle().fill(Color.neonDangerStrong))
            }
        }
        .padding(.vertical, NeonSpace.lg)
        .frame(maxWidth: .infinity)
    }

    // MARK: - People sheet

    private var peopleSheet: some View {
        NavigationStack {
            List {
                ForEach(call?.participants ?? [], id: \.memberKey) { part in
                    HStack(spacing: NeonSpace.sm) {
                        AvatarView(url: nil, name: part.name, size: 36)
                        VStack(alignment: .leading, spacing: 1) {
                            DirText(part.name)
                            Text(stateLabel(part.state)).font(.neonCaption).foregroundStyle(Color.neonTextSecondary)
                        }
                        Spacer(minLength: 0)
                        if part.memberKey != me, session.people.first(where: { $0.key == part.memberKey })?.audioMuted == true {
                            Image(systemName: "mic.slash.fill").foregroundStyle(Color.neonDangerStrong)
                        }
                    }
                    .neonSurface(.solid, radius: NeonRadius.md)
                    .neonListRow()
                }
            }
            .neonListStyle()
            .navigationTitle(L("People"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Close")) { showPeople = false } } }
        }
        .neonSheet([.medium, .large])
    }

    private func stateLabel(_ state: String) -> String {
        switch state {
        case "JOINED": return L("In the call")
        case "INVITED": return L("Ringing")
        case "DECLINED": return L("Declined")
        case "LEFT": return L("Left")
        default: return state
        }
    }

    private func noticeBanner(_ text: String, dismiss: @escaping () -> Void) -> some View {
        HStack(alignment: .top, spacing: NeonSpace.sm) {
            Text(text).font(.neonFootnote).foregroundStyle(.white)
            Spacer(minLength: 0)
            Button { dismiss() } label: {
                Image(systemName: "xmark").font(.system(size: 11, weight: .bold)).foregroundStyle(.white.opacity(0.7))
            }
        }
        .padding(NeonSpace.sm)
        .background(Color.neonInk.opacity(0.92), in: RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous))
        .padding(.horizontal, NeonSpace.gutter)
        .padding(.top, NeonSpace.sm)
        .transition(.neonRise)
    }
}

/// The call, minimised to a small floating pill while the person looks at
/// something else — tap to bring it back.
struct MinimizedCallPill: View {
    @ObservedObject var center: CallCenter
    @ObservedObject var session: CallSession
    let call: CallView?

    var body: some View {
        Button {
            Haptic.tap()
            center.expand()
        } label: {
            HStack(spacing: NeonSpace.sm) {
                if let track = session.cameraTrack, !session.videoOff {
                    CallVideoView(track: track, mirror: session.cameraPosition == "front")
                        .frame(width: 40, height: 40)
                        .clipShape(RoundedRectangle(cornerRadius: NeonRadius.sm, style: .continuous))
                } else {
                    AvatarView(url: nil, name: call?.title ?? "", size: 40)
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text(call?.title ?? L("Call")).font(.system(size: 13, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
                    Text(statusText).font(.system(size: 11)).foregroundStyle(.white.opacity(0.65))
                }
                Spacer(minLength: 4)
                Button {
                    Task { await session.leave() }
                } label: {
                    Image(systemName: "phone.down.fill")
                        .font(.system(size: 13))
                        .foregroundStyle(.white)
                        .frame(width: 30, height: 30)
                        .background(Circle().fill(Color.neonDangerStrong))
                }
            }
            .padding(6)
            .frame(width: 210)
            .background(Color.neonInk.opacity(0.94), in: Capsule())
            .neonShadow(.floating)
        }
        .buttonStyle(.pressable)
    }

    private var statusText: String {
        switch session.phase {
        case .live: return L("In call")
        case .reconnecting: return L("Reconnecting…")
        default: return L("Connecting…")
        }
    }
}
