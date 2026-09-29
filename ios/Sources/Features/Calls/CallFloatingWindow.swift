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
    /// The person the window shows: whoever is talking, else the first one in.
    var focus: CallTileModel?
    var audioMuted: Bool
}

struct CallMiniWindow: View {
    let model: CallMiniModel
    var onExpand: () -> Void
    var onHangUp: () -> Void
    var onFrame: ((CGRect) -> Void)?

    var body: some View {
        CallDraggable(topInset: NeonSpace.sm, bottomInset: 96, horizontalInset: NeonSpace.md, startsAtBottom: true, onFrame: onFrame) {
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
                .overlay(alignment: .bottomTrailing) { hangUpButton(size: 30).padding(6) }
                .neonShadow(.floating)
        }
        .buttonStyle(PressableStyle(scale: 0.96))
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
                        AvatarView(url: nil, name: model.focus?.name ?? model.title, size: 38, style: .solid)
                    }
                    .frame(width: 46, height: 46)
                    VStack(alignment: .leading, spacing: 2) {
                        DirText(model.focus?.name ?? model.title, font: .system(.subheadline, weight: .semibold), color: .white, fill: false, lineLimit: 1)
                        HStack(spacing: 5) {
                            CallLiveDot(phase: model.phase)
                            Text(model.status)
                                .font(.system(.caption, weight: .medium).monospacedDigit())
                                .foregroundStyle(.white.opacity(0.75))
                                .lineLimit(1)
                            if model.audioMuted {
                                Image(systemName: "mic.slash.fill")
                                    .font(.system(size: 10, weight: .bold))
                                    .foregroundStyle(Color.neonDanger)
                                    .accessibilityLabel(L("Muted"))
                            }
                        }
                    }
                    .frame(maxWidth: 120, alignment: .leading)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(PressableStyle(scale: 0.97))
            .accessibilityLabel(L("Back to call"))
            .accessibilityValue(Text(verbatim: "\(model.focus?.name ?? model.title), \(model.status)"))

            hangUpButton(size: 38)
        }
        .padding(.leading, 5)
        .padding(.trailing, 6)
        .padding(.vertical, 5)
        .background(CallGlass(shape: Capsule(), strength: 0.55))
        .neonShadow(.floating)
        .dynamicTypeSize(...DynamicTypeSize.xLarge)
        .animation(NeonMotion.snappy, value: model.focus?.speaking == true)
    }

    private func hangUpButton(size: CGFloat) -> some View {
        Button {
            Haptic.warning()
            onHangUp()
        } label: {
            Image(systemName: "phone.down.fill")
                .font(.system(size: size * 0.4, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: size, height: size)
                .background(Circle().fill(NeonHue.red.fill))
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
            model: CallMiniModel(title: call?.title ?? L("Call"), status: status, phase: session.phase, focus: focus, audioMuted: session.audioMuted),
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
            id: person.key, name: person.name, video: video, audioMuted: person.audioMuted,
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
