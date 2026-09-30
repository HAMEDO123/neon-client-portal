import SwiftUI

// The calls area's contract with the rest of the app (ios/ARCHITECTURE.md §3):
// - `CallButtons(slug:title:)` sits in a conversation's header (the chat area
//   places it) and starts, joins, or returns to a voice or video call in
//   that conversation — the Swift counterpart of components/calls/call-buttons.tsx.
// - `CallOverlay()` is mounted once at the app's root (App/NeonAdminApp.swift)
//   and shows a ringing or running call above everything, full screen or as
//   a small floating window, in a window of its own — the counterpart of
//   call-provider.tsx.
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
                CallLivePill(title: L("Back to call"), symbol: "phone.fill") {
                    Haptic.tap()
                    center.expand()
                }
            } else if ongoing.participants.contains(where: { $0.state == "JOINED" }) {
                CallLivePill(title: L("Join call"), symbol: ongoing.isVideo ? "video.fill" : "phone.fill") {
                    Haptic.tap()
                    center.prepare(.join(callId: ongoing.id, kind: ongoing.kind, title: title))
                }
            }
        } else {
            HStack(spacing: 0) {
                CallHeaderGlyph(symbol: "phone.fill", label: L("Call %@", title)) {
                    center.prepare(.start(conversation: slug, kind: "AUDIO", title: title))
                }
                CallHeaderGlyph(symbol: "video.fill", label: L("Video call %@", title)) {
                    center.prepare(.start(conversation: slug, kind: "VIDEO", title: title))
                }
            }
        }
    }
}

/// One of the header's call glyphs: drawn at 36 pt, the size of the header's
/// other buttons (the chat area lays them out and draws the white capsule
/// round them), but touched across a full 44 pt. The extra reaches past the
/// drawn edge without taking any layout room.
struct CallHeaderGlyph: View {
    let symbol: String
    let label: String
    let action: () -> Void

    var body: some View {
        Button {
            Haptic.tap()
            action()
        } label: {
            IconButtonLabel(symbol, look: .plain, tint: .neonPurpleStrong, size: 36)
                .frame(width: NeonSize.touch, height: NeonSize.touch)
                .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle(scale: 0.88))
        .padding(-(NeonSize.touch - 36) / 2)
        .accessibilityLabel(Text(label))
    }
}

/// The green capsule a conversation's header shows while a call is going in
/// it: a breathing dot, and what tapping does.
struct CallLivePill: View {
    let title: String
    let symbol: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                ZStack {
                    Circle().fill(Color.white.opacity(0.45)).frame(width: 8, height: 8).neonPulse()
                    Circle().fill(Color.white).frame(width: 6, height: 6)
                }
                Image(systemName: symbol).font(.system(size: 11, weight: .bold))
                Text(title)
                    .font(.system(.footnote, weight: .semibold))
                    .lineLimit(1)
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 12)
            .frame(height: 32)
            .background(Capsule().fill(NeonHue.green.fill))
            .shadow(color: .neonSuccess.opacity(0.35), radius: 8, x: 0, y: 3)
            .fixedSize()
            // Drawn 32 pt tall to sit in a header, touched across 44.
            .padding(.vertical, (NeonSize.touch - 32) / 2)
            .contentShape(Capsule())
        }
        .buttonStyle(.pressable)
        .padding(.vertical, -(NeonSize.touch - 32) / 2)
        .dynamicTypeSize(...DynamicTypeSize.xLarge)
    }
}

/// Mounted once at the app's root while somebody is signed in: it starts the
/// calls stream and hands everything calls draw to their own window
/// (CallWindow.swift), above every sheet the app can open.
struct CallOverlay: View {
    var body: some View {
        Color.clear
            .frame(width: 0, height: 0)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
            .onAppear {
                CallCenter.shared.start()
                CallWindow.shared.attach()
            }
            .onDisappear {
                CallWindow.shared.detach()
                CallCenter.shared.stop()
            }
    }
}
