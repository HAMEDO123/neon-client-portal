import SwiftUI

// The calls area's contract with the rest of the app (ios/ARCHITECTURE.md §3):
// - `CallButtons(slug:title:)` sits in a conversation's header (the chat area
//   places it) and starts, joins, or returns to a voice or video call in
//   that conversation — the Swift counterpart of components/calls/call-buttons.tsx.
// - `CallOverlay()` is mounted once at the app's root (App/NeonAdminApp.swift)
//   and shows a ringing or running call above everything, full screen or as
//   a small floating pill — the counterpart of call-provider.tsx.
//
// Every conversation slug the chat area hands here is one calls may be made
// in: the server's mayCallIn (src/lib/calls.ts) already covers every kind of
// conversation the chat area creates, so there is nothing further to check.

struct CallButtons: View {
    let slug: String
    let title: String
    @ObservedObject private var center = CallCenter.shared

    var body: some View {
        if let ongoing = center.ongoingCall(conversationSlug: slug) {
            if center.session?.callId == ongoing.id {
                pill(L("Back to call"), symbol: "phone.fill") {
                    Haptic.tap()
                    center.expand()
                }
            } else if ongoing.participants.contains(where: { $0.state == "JOINED" }) {
                pill(L("Join call"), symbol: "phone.arrow.down.left.fill") {
                    center.prepare(.join(callId: ongoing.id, kind: ongoing.kind, title: title))
                }
            }
        } else {
            HStack(spacing: 0) {
                IconButton("phone.fill", label: L("Call %@", title), look: .plain, tint: .neonPurpleStrong, size: 36) {
                    center.prepare(.start(conversation: slug, kind: "AUDIO", title: title))
                }
                IconButton("video.fill", label: L("Video call %@", title), look: .plain, tint: .neonPurpleStrong, size: 36) {
                    center.prepare(.start(conversation: slug, kind: "VIDEO", title: title))
                }
            }
        }
    }

    private func pill(_ title: String, symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: symbol).font(.system(size: 12, weight: .semibold))
                Text(title).font(.system(size: 13, weight: .semibold))
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 12)
            .frame(height: 32)
            .background(Capsule().fill(Color.neonSuccessStrong))
        }
        .buttonStyle(.pressable)
    }
}

struct CallOverlay: View {
    @ObservedObject private var center = CallCenter.shared

    var body: some View {
        ZStack {
            if let session = center.session {
                let activeCall = center.calls.first { $0.id == session.callId }
                if center.viewMode == .full {
                    CallScreenView(center: center, session: session, call: activeCall, me: center.me ?? session.me)
                        .transition(.opacity)
                        .zIndex(2)
                } else {
                    VStack {
                        Spacer()
                        HStack {
                            Spacer()
                            MinimizedCallPill(center: center, session: session, call: activeCall)
                        }
                        .padding(.trailing, NeonSpace.gutter)
                        .padding(.bottom, 92)
                    }
                    .transition(.neonPop)
                    .zIndex(2)
                    .allowsHitTesting(true)
                }
            }

            if let ringing = center.ringingCall, ringing.id != center.session?.callId {
                VStack {
                    IncomingCallView(
                        call: ringing, inCall: center.session != nil, answering: center.answering,
                        onAccept: { video in Task { await center.accept(ringing, video: video) } },
                        onDecline: { center.decline(ringing) }
                    )
                    Spacer(minLength: 0)
                }
                .padding(.top, 4)
                .zIndex(3)
            }

            if center.session == nil, let notice = center.notice {
                VStack {
                    Spacer()
                    HStack(alignment: .top, spacing: NeonSpace.sm) {
                        Text(notice).font(.neonFootnote).foregroundStyle(.white)
                        Spacer(minLength: 0)
                        Button { center.dismissNotice() } label: {
                            Image(systemName: "xmark").font(.system(size: 11, weight: .bold)).foregroundStyle(.white.opacity(0.7))
                        }
                    }
                    .padding(NeonSpace.sm)
                    .background(Color.neonInk.opacity(0.94), in: RoundedRectangle(cornerRadius: NeonRadius.lg, style: .continuous))
                    .padding(.horizontal, NeonSpace.gutter)
                    .padding(.bottom, 92)
                }
                .transition(.neonRise)
                .zIndex(2)
            }
        }
        .animation(NeonMotion.smooth, value: center.session != nil)
        .animation(NeonMotion.smooth, value: center.viewMode)
        .sheet(item: $center.prejoinRequest) { request in
            PreJoinView(
                request: request,
                onCancel: { center.cancelPreJoin() },
                onConfirm: { mic, camera, muted, problem in
                    await center.confirmPreJoin(mic: mic, camera: camera, audioMuted: muted, problem: problem)
                }
            )
        }
        .onAppear { center.start() }
        .onDisappear { center.stop() }
    }
}
