import SwiftUI

// A call ringing, full screen over whatever was open, as a phone call rings —
// the Swift counterpart of components/calls/incoming-call.tsx. Decline,
// answer, and for a video call answer with sound only.

struct IncomingCallView: View {
    let call: CallView
    let inCall: Bool
    let answering: Bool
    let onAccept: (Bool) -> Void
    let onDecline: () -> Void

    private var video: Bool { call.isVideo }
    private var callerName: String {
        call.participants.first { $0.memberKey == call.startedByKey }?.name ?? call.startedByName
    }
    /// A group call is the group's; a private one is the caller's.
    private var title: String { call.isGroup ? call.title : callerName }
    private var line: String {
        if call.isGroup { return L("%@ started a %@", callerName, video ? L("video call") : L("call")) }
        return video ? L("Incoming video call…") : L("Incoming call…")
    }
    private var inTheCall: [CallParticipant] { call.participants.filter { $0.state == "JOINED" } }

    var body: some View {
        ZStack {
            CallBackdrop(hue: NeonPalette.hue(for: title), animated: true)

            VStack(spacing: 0) {
                Label(video ? L("NEON video call") : L("NEON voice call"), systemImage: video ? "video.fill" : "phone.fill")
                    .font(.system(.caption, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.9))
                    .padding(.horizontal, NeonSpace.md)
                    .padding(.vertical, 7)
                    .background(CallGlass(shape: Capsule(), strength: 0.2))
                    .padding(.top, NeonSpace.lg)
                    .neonAppear()

                Spacer(minLength: NeonSpace.xl)

                CallHalo(name: title, size: 140, ringing: !answering)
                    .neonAppear(delay: 0.05, distance: 20)

                VStack(spacing: NeonSpace.sm) {
                    CallCenteredName(title, font: .neonLargeTitle)
                    Text(answering ? L("Connecting…") : line)
                        .font(.neonCallout)
                        .foregroundStyle(.white.opacity(0.8))
                        .multilineTextAlignment(.center)
                    if call.isGroup, !inTheCall.isEmpty {
                        HStack(spacing: NeonSpace.sm) {
                            AvatarStack(inTheCall.map { AvatarItem(id: $0.memberKey, name: $0.name) }, size: 26, limit: 4)
                            Text(L("%@ in the call", NeonFormat.integer(inTheCall.count)))
                                .font(.system(.footnote, weight: .semibold))
                                .foregroundStyle(.white.opacity(0.9))
                        }
                        .padding(.leading, 6)
                        .padding(.trailing, NeonSpace.md)
                        .padding(.vertical, 5)
                        .background(CallGlass(shape: Capsule(), strength: 0.25))
                        .padding(.top, NeonSpace.xs)
                    }
                }
                .padding(.horizontal, NeonSpace.xxl)
                .padding(.top, NeonSpace.lg)
                .neonAppear(delay: 0.1)

                Spacer(minLength: NeonSpace.xl)
                Spacer(minLength: 0)

                if inCall {
                    Label(L("Answering ends the call you are in."), systemImage: "exclamationmark.circle.fill")
                        .font(.system(.footnote, weight: .semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, NeonSpace.lg)
                        .padding(.vertical, 10)
                        .background(CallGlass(shape: Capsule(), strength: 0.35))
                        .padding(.bottom, NeonSpace.xl)
                        .transition(.neonRise)
                }

                answerRow
                    .padding(.horizontal, NeonSpace.xl)
                    .padding(.bottom, NeonSpace.xxl)
                    .neonAppear(delay: 0.15, distance: 24)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isModal)
    }

    private var answerRow: some View {
        HStack(alignment: .top, spacing: 0) {
            CallRoundButton(symbol: "phone.down.fill", title: L("Decline"), look: .danger, size: 72) {
                Haptic.tap()
                onDecline()
            }
            .frame(maxWidth: .infinity)
            .disabled(answering)

            if video {
                CallRoundButton(symbol: "phone.fill", title: L("Voice only"), look: .glass, size: 72) {
                    Haptic.success()
                    onAccept(false)
                }
                .accessibilityLabel(L("Answer with sound only"))
                .frame(maxWidth: .infinity)
                .disabled(answering)
            }

            ZStack(alignment: .top) {
                if !answering {
                    Circle()
                        .fill(Color.neonSuccess.opacity(0.35))
                        .frame(width: 72, height: 72)
                        .neonPulse()
                        .accessibilityHidden(true)
                }
                CallRoundButton(symbol: video ? "video.fill" : "phone.fill", title: L("Answer"), look: .accept, size: 72) {
                    Haptic.success()
                    onAccept(video)
                }
                .overlay(alignment: .top) {
                    if answering {
                        ProgressView()
                            .tint(.white)
                            .controlSize(.large)
                            .frame(width: 72, height: 72)
                            .background(Circle().fill(NeonHue.green.fill))
                    }
                }
            }
            .frame(maxWidth: .infinity)
            .disabled(answering)
        }
    }
}
