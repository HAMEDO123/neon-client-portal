import SwiftUI
import WebRTC

// The call, minimised: a small window that floats above the app while the
// person looks at something else, and can be dragged to any corner. A video
// call shows the other person's picture; a voice call is a compact card with
// who, how long and a way to hang up. Tap it to go back to the call.

struct CallMiniModel {
    var title: String
    var status: String
    var phase: CallSessionPhase
    /// A group call names the group first, so it never reads as a private
    /// call with whoever happens to be shown.
    var isGroup = false
    /// The person the window shows: whoever is talking, else the first one in.
    var focus: CallTileModel?
    var audioMuted: Bool
}

struct CallMiniWindow: View {
    let model: CallMiniModel
    var onExpand: () -> Void
    var onHangUp: () -> Void
    var onFrame: ((CGRect) -> Void)?

    /// A drag of the window that starts on the hang-up must not end the call
    /// when the finger lifts: the tap is refused while dragging and just after.
    @State private var dragging = false
    @State private var dragEndedAt: Date?

    var body: some View {
        CallDraggable(
            topInset: NeonSpace.sm, bottomInset: 96, horizontalInset: NeonSpace.gutter, startsAtBottom: true, onFrame: onFrame,
            onDragging: { now in
                dragging = now
                if !now { dragEndedAt = Date() }
            }
        ) {
            Group {
                if let focus = model.focus, focus.video != nil {
                    videoWindow(focus)
                } else {
                    voiceCard
                }
            }
            .transition(.neonPop)
        }
    }

    /// The window's own surface: the brand's ink, solid, so it reads as a
    /// deliberate object over the light app rather than a grey smudge.
    private func surface<S: InsettableShape>(_ shape: S) -> some View {
        shape.fill(LinearGradient.neonInkHero)
            .overlay(shape.strokeBorder(Color.white.opacity(0.16), lineWidth: 1))
    }

    private var headline: String {
        model.isGroup ? model.title : (model.focus?.name ?? model.title)
    }

    /// "12:07", or in a group "12:07 · Salem speaking".
    private var detail: String {
        if model.isGroup, let focus = model.focus, focus.speaking {
            return model.status + " · " + L("%@ speaking", focus.name)
        }
        return model.status
    }

    private func videoWindow(_ focus: CallTileModel) -> some View {
        Button(action: onExpand) {
            CallTileView(tile: focus, style: .pip)
                .frame(width: 118, height: 166)
                .overlay(alignment: .top) {
                    HStack(spacing: 5) {
                        CallLiveDot(phase: model.phase)
                        Text(model.status)
                            .font(.system(.caption2, weight: .semibold).monospacedDigit())
                            .foregroundStyle(.white)
                            .lineLimit(1)
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(CallGlass(shape: Capsule(), strength: 0.4))
                    .padding(.top, 8)
                }
                .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Color.white.opacity(0.16), lineWidth: 1))
                .neonShadow(.floating)
        }
        .buttonStyle(PressableStyle(scale: 0.96))
        .overlay(alignment: .bottomTrailing) { hangUpButton(size: 34).padding(2) }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(L("Back to call"))
        .accessibilityValue(Text(verbatim: "\(model.title), \(model.status)"))
    }

    private var voiceCard: some View {
        HStack(spacing: NeonSpace.sm) {
            Button(action: onExpand) {
                HStack(spacing: NeonSpace.sm) {
                    ZStack {
                        if model.focus?.speaking == true {
                            Circle()
                                .strokeBorder(AngularGradient.neonStory, lineWidth: 2.5)
                                .frame(width: 46, height: 46)
                                .transition(.neonPop)
                        }
                        CallFaceView(face: model.focus?.face ?? .person(model.title, color: nil), size: 38)
                    }
                    .frame(width: 46, height: 46)
                    VStack(alignment: .leading, spacing: 2) {
                        DirText(headline, font: .system(.subheadline, weight: .semibold), color: .white, fill: false, lineLimit: 1)
                        HStack(spacing: 5) {
                            CallLiveDot(phase: model.phase)
                            DirText(detail, font: .system(.caption, weight: .medium).monospacedDigit(), color: .white.opacity(0.75), fill: false, lineLimit: 1)
                            if model.audioMuted {
                                Image(systemName: "mic.slash.fill")
                                    .font(.system(size: 10, weight: .bold))
                                    .foregroundStyle(Color.neonDanger)
                                    .accessibilityLabel(L("Muted"))
                            }
                        }
                    }
                    .frame(maxWidth: 168, alignment: .leading)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(PressableStyle(scale: 0.97))
            .accessibilityLabel(L("Back to call"))
            .accessibilityValue(Text(verbatim: "\(headline), \(detail)"))

            hangUpButton(size: 44)
        }
        .padding(.leading, 5)
        .padding(.trailing, 6)
        .padding(.vertical, 5)
        .background(surface(Capsule()))
        .neonShadow(.floating)
        .dynamicTypeSize(...DynamicTypeSize.xLarge)
        .animation(NeonMotion.snappy, value: model.focus?.speaking == true)
    }

    /// At least 44 pt to touch whatever its drawn size.
    private func hangUpButton(size: CGFloat) -> some View {
        Button {
            guard !dragging, Date().timeIntervalSince(dragEndedAt ?? .distantPast) > 0.4 else { return }
            Haptic.warning()
            onHangUp()
        } label: {
            Image(systemName: "phone.down.fill")
                .font(.system(size: size * 0.4, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: size, height: size)
                .background(Circle().fill(NeonHue.red.fill))
                .frame(width: max(size, NeonSize.touch), height: max(size, NeonSize.touch))
                .contentShape(Circle())
        }
        .buttonStyle(PressableStyle(scale: 0.88))
        .accessibilityLabel(L("End"))
    }
}

/// The minimised window with the running call behind it.
struct CallFloatingWindow: View {
    @ObservedObject var center: CallCenter
    @ObservedObject var session: CallSession
    let call: CallView?
    var onFrame: ((CGRect) -> Void)?

    @State private var now = Date()
    private let ticker = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        CallMiniWindow(
            model: CallMiniModel(
                title: call?.title ?? L("Call"), status: status, phase: session.phase, isGroup: call?.isGroup ?? false,
                focus: focus, audioMuted: session.audioMuted || session.micTrack == nil
            ),
            onExpand: {
                Haptic.tap()
                center.expand()
            },
            onHangUp: { Task { await session.leave() } },
            onFrame: onFrame
        )
        .onReceive(ticker) { now = $0 }
    }

    private var focus: CallTileModel? {
        let person = session.people.first(where: \.sharing) ?? session.people.first(where: \.speaking)
            ?? session.people.first { !$0.videoOff } ?? session.people.first
        guard let person else { return nil }
        let video = person.sharing ? person.screenTrack : (person.videoOff ? nil : person.cameraTrack)
        return CallTileModel(
            id: person.key, name: person.name, color: person.color,
            avatarURL: call?.participants.first { $0.memberKey == person.key }?.photoURL,
            video: video, audioMuted: person.audioMuted,
            sharing: person.sharing, speaking: person.speaking, quality: person.quality, connection: person.connection
        )
    }

    private var status: String {
        switch session.phase {
        case .live:
            if let date = parseISODate(call?.answeredAt) { return callDurationText(Int(max(0, now.timeIntervalSince(date)))) }
            return L("In call")
        case .reconnecting: return L("Reconnecting…")
        case .ended: return L("Call ended")
        case .joining: return session.people.isEmpty && call?.status == "RINGING" ? L("Calling…") : L("Connecting…")
        }
    }
}
