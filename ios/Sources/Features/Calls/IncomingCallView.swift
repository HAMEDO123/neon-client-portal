import SwiftUI

// A call ringing, over whatever screen is open — the Swift counterpart of
// components/calls/incoming-call.tsx.

struct IncomingCallView: View {
    let call: CallView
    let inCall: Bool
    let answering: Bool
    let onAccept: (Bool) -> Void
    let onDecline: () -> Void

    private var video: Bool { call.isVideo }
    private var caller: CallParticipant? { call.participants.first { $0.memberKey == call.startedByKey } }
    private var title: String { call.isGroup ? call.title : call.startedByName }
    private var line: String {
        if call.isGroup { return L("%@ started a %@", call.startedByName, video ? L("video call") : L("call")) }
        return video ? L("Incoming video call…") : L("Incoming call…")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: NeonSpace.md) {
            HStack(spacing: NeonSpace.md) {
                ZStack {
                    Circle().fill(Color.neonSuccess.opacity(0.35)).frame(width: 56, height: 56).neonPulse(true)
                    AvatarView(url: nil, name: caller?.name ?? call.startedByName, size: 48)
                }
                VStack(alignment: .leading, spacing: 2) {
                    DirText(title, font: .system(size: 16, weight: .semibold))
                    Text(line).font(.neonFootnote).foregroundStyle(.white.opacity(0.65))
                }
                Spacer(minLength: 0)
            }

            if inCall {
                Text(L("Answering ends the call you are in."))
                    .font(.neonCaption)
                    .foregroundStyle(.white.opacity(0.8))
                    .padding(.horizontal, NeonSpace.sm)
                    .padding(.vertical, 6)
                    .background(Color.white.opacity(0.12), in: RoundedRectangle(cornerRadius: NeonRadius.sm, style: .continuous))
            }

            HStack(spacing: NeonSpace.sm) {
                Button {
                    Haptic.tap()
                    onDecline()
                } label: {
                    Label(L("Decline"), systemImage: "phone.down.fill")
                        .font(.system(size: 15, weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .frame(height: 48)
                }
                .buttonStyle(.neon(.destructive, size: .medium, fullWidth: true))
                .disabled(answering)

                if video {
                    IconButton("phone.fill", label: L("Answer with sound only"), look: .glass, tint: .white, size: 48) {
                        onAccept(false)
                    }
                    .disabled(answering)
                }

                Button {
                    Haptic.success()
                    onAccept(video)
                } label: {
                    if answering {
                        ProgressView().tint(.white).frame(maxWidth: .infinity).frame(height: 48)
                    } else {
                        Label(L("Answer"), systemImage: video ? "video.fill" : "phone.fill")
                            .font(.system(size: 15, weight: .semibold))
                            .frame(maxWidth: .infinity)
                            .frame(height: 48)
                    }
                }
                .buttonStyle(.neon(.tinted(.neonSuccessStrong), size: .medium, fullWidth: true))
                .disabled(answering)
            }
        }
        .padding(NeonSpace.lg)
        .background(
            RoundedRectangle(cornerRadius: NeonRadius.xxl, style: .continuous)
                .fill(Color.neonInk.opacity(0.94))
                .overlay(RoundedRectangle(cornerRadius: NeonRadius.xxl, style: .continuous).strokeBorder(Color.white.opacity(0.1)))
                .neonShadow(.floating)
        )
        .padding(.horizontal, NeonSpace.gutter)
        .transition(.neonDrop)
    }
}
