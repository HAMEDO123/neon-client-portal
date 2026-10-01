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

    @ObservedObject private var faces = CallFaceDirectory.shared

    private var video: Bool { call.isVideo }
    private var caller: CallParticipant? { call.participants.first { $0.memberKey == call.startedByKey } }
    private var callerName: String { caller?.name ?? call.startedByName }
    /// A group call is the group's; a private one is the caller's.
    private var title: String { call.isGroup ? call.title : callerName }
    /// The caller's own face in their own colour; the group's, or the
    /// studio's mark for the team.
    private var face: CallFace {
        call.isGroup ? faces.face(for: call, me: nil) : .person(callerName, color: caller?.color, photo: caller?.photoURL)
    }
    /// Whole sentences, so a translation can say it the way its language
    /// does — Arabic puts the call first and the name after, with no verb to
    /// agree with the caller.
    private var line: String {
        if call.isGroup { return video ? L("%@ started a video call", callerName) : L("%@ started a call", callerName) }
        return video ? L("Incoming video call…") : L("Incoming call…")
    }
    private var inTheCall: [CallParticipant] { call.participants.filter { $0.state == "JOINED" } }

    var body: some View {
        ZStack {
            CallBackdrop(hue: face.hue, animated: true)

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

                CallHalo(face: face, size: 140, ringing: !answering)
                    .neonAppear(delay: 0.05, distance: 20)

                VStack(spacing: NeonSpace.sm) {
                    CallCenteredName(title, font: .neonLargeTitle)
                    Text(answering ? L("Connecting…") : line)
                        .font(.neonCallout)
                        .foregroundStyle(.white.opacity(0.8))
                        .multilineTextAlignment(.center)
                    if inCall, !answering {
                        // What the answer button now says in full: answering
                        // hangs up the call this phone is in.
                        Label(L("You are in another call"), systemImage: "phone.fill")
                            .font(.system(.footnote, weight: .semibold))
                            .foregroundStyle(.white.opacity(0.7))
                            .transition(.opacity)
                    }
                    if call.isGroup, !inTheCall.isEmpty {
                        HStack(spacing: NeonSpace.sm) {
                            CallFaceStack(faces: inTheCall.map { .person($0.name, color: $0.color, photo: $0.photoURL) }, size: 28, limit: 4)
                            Text(L("%@ in the call", NeonFormat.integer(inTheCall.count)))
                                .font(.system(.footnote, weight: .semibold))
                                .foregroundStyle(.white.opacity(0.9))
                        }
                        .padding(.leading, 5)
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
                .accessibilityLabel(inCall ? L("End your call and answer with sound only") : L("Answer with sound only"))
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
                // Busy, the button says what the tap does — the iPhone's own
                // "End & Accept" — rather than leaving it to a note above.
                CallRoundButton(
                    symbol: video ? "video.fill" : (inCall ? "phone.arrow.down.left" : "phone.fill"),
                    title: inCall ? L("End & answer") : L("Answer"), look: .accept, size: 72
                ) {
                    Haptic.success()
                    onAccept(video)
                }
                .accessibilityLabel(inCall ? L("End your call and answer") : L("Answer"))
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
