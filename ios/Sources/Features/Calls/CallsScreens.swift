#if DEBUG
import SwiftUI
import WebRTC

/// This area's screens for the debug router (App/DebugScreens.swift):
/// `-neonScreen <id>` opens one straight from launch, for screenshots.
///
/// A call cannot be opened without ringing real people, so these are
/// fixtures: the real call views, drawn from fixed values with no network,
/// no microphone and no camera (there is no picture in them — every tile
/// shows its avatar, as a camera that is off does). Debug builds only.
///
/// `callkit-incoming` (and `-video`) ring CallKit's own incoming screen for a
/// made-up call — the simulator shows it, though PushKit never reaches it —
/// through CallKitCenter's fixture, which touches no stream and no server.
enum CallsScreens {
    static let ids: [String] = [
        "call-prejoin-voice", "call-prejoin-video", "call-prejoin-blocked",
        "call-incoming-voice", "call-incoming-video", "call-incoming-group", "call-incoming-busy",
        "call-ringing", "call-connecting", "call-voice", "call-video-1to1", "call-group-grid", "call-group-speaker",
        "call-reconnecting", "call-notice", "call-people", "call-people-empty",
        "call-mini-voice", "call-mini-video", "call-mini-pip", "call-buttons",
        "callkit-incoming", "callkit-incoming-video",
    ]

    @MainActor static func view(_ id: String) -> AnyView? {
        switch id {
        case "call-prejoin-voice":
            return AnyView(CallPreJoinStage(model: prejoin(video: false), actions: CallPreJoinActions()))
        case "call-prejoin-video":
            return AnyView(CallPreJoinStage(model: prejoin(video: true), actions: CallPreJoinActions()))
        case "call-prejoin-blocked":
            var model = prejoin(video: true)
            model.micAvailable = false
            model.micOn = false
            model.micBlocked = true
            model.cameraOn = false
            model.cameraBlocked = true
            model.cameraUnavailable = false
            model.problem = .denied
            return AnyView(CallPreJoinStage(model: model, actions: CallPreJoinActions()))

        case "call-incoming-voice":
            return AnyView(incoming(call(kind: "AUDIO", group: false)))
        case "call-incoming-video":
            return AnyView(incoming(call(kind: "VIDEO", group: false)))
        case "call-incoming-group":
            return AnyView(incoming(call(kind: "VIDEO", group: true)))
        case "call-incoming-busy":
            return AnyView(incoming(call(kind: "AUDIO", group: false), inCall: true))

        case "call-ringing":
            return AnyView(CallStage(model: stage(others: [], ringing: true, phase: .joining, status: L("Calling…")), actions: CallStageActions()))
        case "call-connecting":
            return AnyView(CallStage(model: stage(others: [person("Sally", connection: .connecting, stalled: true)], phase: .joining, status: L("Connecting…")), actions: CallStageActions()))
        case "call-voice":
            return AnyView(CallStage(model: stage(others: [person("Sally", speaking: true, quality: .good)]), actions: CallStageActions()))
        case "call-video-1to1":
            var model = stage(others: [person("Salem", muted: true, quality: .fair)], video: true)
            model.cameraOn = false
            return AnyView(CallStage(model: model, actions: CallStageActions()))
        case "call-group-grid":
            return AnyView(CallStage(model: groupStage(), actions: CallStageActions()))
        case "call-group-speaker":
            return AnyView(CallStageSpeakerFixture(model: groupStage()))
        case "call-reconnecting":
            return AnyView(CallStage(model: stage(others: [person("Amro", quality: .poor, connection: .reconnecting)], phase: .reconnecting, status: L("Reconnecting…")), actions: CallStageActions()))
        case "call-notice":
            // The microphone refused in Settings: this phone has no
            // microphone track, so it is muted and the button says so.
            var model = stage(others: [person("Wael", quality: .good)])
            model.notice = CallMediaProblem.micDenied.text
            model.audioMuted = true
            model.micAvailable = false
            return AnyView(CallStage(model: model, actions: CallStageActions()))

        case "call-people":
            // Wael said no; Amro was never asked, so he is the one to ring.
            return AnyView(Color.clear.sheet(isPresented: .constant(true)) {
                CallPeopleSheet(
                    participants: [
                        participant("admin", "Manager", "JOINED"),
                        participant("e-sally", "Sally", "JOINED"),
                        participant("e-salem", "Salem", "JOINED"),
                        participant("e-wael", "Wael", "DECLINED"),
                    ],
                    me: "admin", mutedKeys: ["e-salem"],
                    addable: .loaded([APIClient.CallMember(key: "e-amro", name: "Amro", color: colour("Amro"))]),
                    ringing: [], onRing: { _ in }, onRetry: {}, onClose: {}
                )
            })
        case "call-people-empty":
            // Everybody on the team has been asked, whatever they answered,
            // which is when the server has nobody left to offer.
            return AnyView(Color.clear.sheet(isPresented: .constant(true)) {
                CallPeopleSheet(
                    participants: groupParticipants, me: "admin", mutedKeys: [],
                    addable: .loaded([]), ringing: [], onRing: { _ in }, onRetry: {}, onClose: {}
                )
            })

        case "call-mini-voice":
            return AnyView(miniOverApp(CallMiniModel(title: "Sally", status: callDurationText(272), phase: .live, focus: person("Sally", speaking: true), audioMuted: true)))
        case "call-mini-video":
            return AnyView(miniOverApp(CallMiniModel(title: "NEON Team", status: callDurationText(727), phase: .live, isGroup: true, focus: person("Salem", speaking: true), audioMuted: false)))
        case "call-mini-pip":
            // The video window. The simulator has no camera, so the track
            // carries no frames: what this shows is the window itself — its
            // size, the time, the name and the hang-up — over a dark picture.
            var focus = person("Sally")
            focus.video = RTCEnvironment.factory.videoTrack(with: RTCEnvironment.factory.videoSource(), trackId: "fixture-pip")
            return AnyView(miniOverApp(CallMiniModel(title: "Sally", status: callDurationText(272), phase: .live, focus: focus, audioMuted: false)))
        case "call-buttons":
            return AnyView(buttonsFixture)
        case "callkit-incoming":
            return AnyView(CallKitRingFixture(title: "Sally", video: false))
        case "callkit-incoming-video":
            return AnyView(CallKitRingFixture(title: "Sally", video: true))
        default:
            return nil
        }
    }

    // MARK: Fixed values

    /// The colours the studio's server gives these people — the ones the
    /// chat list draws them in.
    private static func colour(_ name: String) -> String? {
        ["Manager": "ink", "Sally": "purple", "Salem": "pink", "Amro": "cyan", "Wael": "cyan"][name]
    }

    private static func prejoin(video: Bool) -> CallPreJoinModel {
        CallPreJoinModel(
            title: video ? "NEON Team" : "Sally",
            face: video ? CallFace(name: "NEON Team", kind: .team) : .person("Sally", color: colour("Sally")),
            isVideo: video, isJoin: false, loading: false,
            micOn: true, micAvailable: true, cameraOn: false, cameraUnavailable: video, camera: nil, mirror: true,
            problem: video ? .noCamera : nil
        )
    }

    private static func participant(_ key: String, _ name: String, _ state: String) -> CallParticipant {
        CallParticipant(memberKey: key, name: name, color: colour(name), state: state, joinedAt: state == "JOINED" ? "2026-09-30T09:00:00.000Z" : nil)
    }

    private static var groupParticipants: [CallParticipant] {
        [
            participant("admin", "Manager", "JOINED"),
            participant("e-sally", "Sally", "JOINED"),
            participant("e-salem", "Salem", "JOINED"),
            participant("e-amro", "Amro", "INVITED"),
            participant("e-wael", "Wael", "DECLINED"),
        ]
    }

    private static func call(kind: String, group: Bool) -> CallView {
        CallView(
            id: "fixture", kind: kind, status: "RINGING", createdAt: "2026-09-30T09:00:00.000Z", answeredAt: nil,
            startedByKey: "e-sally", startedByName: "Sally", conversationSlug: group ? "team" : "sally",
            title: group ? "NEON Team" : "Sally", isGroup: group,
            participants: group
                ? [participant("e-sally", "Sally", "JOINED"), participant("e-salem", "Salem", "JOINED"), participant("admin", "Manager", "INVITED")]
                : [participant("e-sally", "Sally", "JOINED"), participant("admin", "Manager", "INVITED")]
        )
    }

    private static func incoming(_ call: CallView, inCall: Bool = false) -> some View {
        IncomingCallView(call: call, inCall: inCall, answering: false, onAccept: { _ in }, onDecline: {})
    }

    private static func person(
        _ name: String, muted: Bool = false, speaking: Bool = false, quality: CallQuality = .unknown,
        connection: CallPeerConnState = .connected, stalled: Bool = false
    ) -> CallTileModel {
        CallTileModel(
            id: "e-\(name.lowercased())", name: name, color: colour(name), video: nil, audioMuted: muted, speaking: speaking,
            quality: quality, connection: connection, stalled: stalled
        )
    }

    private static func stage(
        others: [CallTileModel], video: Bool = false, ringing: Bool = false,
        phase: CallSessionPhase = .live, status: String = callDurationText(272)
    ) -> CallStageModel {
        let title = others.first?.name ?? "Sally"
        return CallStageModel(
            title: title, titleFace: .person(title, color: colour(title)), isVideo: video, isGroup: false, status: status,
            waiting: ringing ? L("Calling…") : status, phase: phase, ringing: ringing,
            me: CallTileModel(id: "admin", name: "Manager", color: colour("Manager"), video: nil, isSelf: true),
            others: others, audioMuted: false, cameraOn: false, onSpeaker: video,
            inCall: others.count + 1, notice: nil
        )
    }

    private static func groupStage() -> CallStageModel {
        CallStageModel(
            title: "NEON Team", titleFace: CallFace(name: "NEON Team", kind: .team), isVideo: true, isGroup: true,
            status: callDurationText(727), waiting: callDurationText(727), phase: .live, ringing: false,
            me: CallTileModel(id: "admin", name: "Manager", color: colour("Manager"), video: nil, audioMuted: true, isSelf: true),
            others: [
                person("Sally", speaking: true, quality: .good),
                person("Salem", muted: true, quality: .fair),
                person("Amro", quality: .good, connection: .connecting),
            ],
            audioMuted: true, cameraOn: false, onSpeaker: true, inCall: 4, notice: nil
        )
    }

    private static func miniOverApp(_ model: CallMiniModel) -> some View {
        ZStack {
            DesignKitGallery()
            CallMiniWindow(model: model, onExpand: {}, onHangUp: {})
        }
    }

    /// The header's buttons as the chat room header draws them — in its white
    /// capsule (ChatRoomView.headerButtons) — and the two live pills.
    private static var buttonsFixture: some View {
        NeonScroll(spacing: NeonSpace.stack) {
            SectionCard(L("Call"), subtitle: L("Call buttons in a chat header"), symbol: "phone.fill", hue: .green) {
                VStack(alignment: .leading, spacing: NeonSpace.lg) {
                    CallButtons(slug: "fixture-none", title: "Sally")
                        .padding(.horizontal, 1)
                        .frame(minHeight: 36)
                        .background(Capsule().fill(Color.white.opacity(0.96)))
                        .overlay(Capsule().strokeBorder(Color.white, lineWidth: 1))
                        .neonShadow(.low)
                    CallLivePill(title: L("Join call"), symbol: "video.fill") {}
                    CallLivePill(title: L("Back to call"), symbol: "phone.fill") {}
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, NeonSpace.xs)
            }
        }
    }
}

/// A page that rings CallKit's incoming screen a moment after it opens: in
/// the simulator it arrives as the banner over this page (full screen on a
/// locked one).
private struct CallKitRingFixture: View {
    let title: String
    let video: Bool

    var body: some View {
        NeonScroll(spacing: NeonSpace.stack) {
            SectionCard(
                L("The phone's own call screen"), subtitle: L("How a NEON call rings on a closed or locked phone"),
                symbol: "phone.arrow.down.left", hue: .green
            ) {
                VStack(alignment: .leading, spacing: NeonSpace.md) {
                    Text(L("A made-up call from %@ rings on the phone's own call screen. Nothing is sent to the studio.", title))
                        .font(.neonCallout)
                        .foregroundStyle(Color.neonTextSecondary)
                    NeonButton(L("Ring again"), symbol: "phone.fill", kind: .secondary) {
                        CallKitCenter.shared.ringFixture(title: title, video: video)
                    }
                }
            }
        }
        .task {
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            CallKitCenter.shared.ringFixture(title: title, video: video)
        }
    }
}

/// The group stage, opened in speaker view.
private struct CallStageSpeakerFixture: View {
    let model: CallStageModel

    var body: some View {
        CallStage(model: model, actions: CallStageActions(), initialLayout: .speaker)
    }
}
#endif
