#if DEBUG
import SwiftUI

/// This area's screens for the debug router (App/DebugScreens.swift):
/// `-neonScreen <id>` opens one straight from launch, for screenshots.
///
/// A call cannot be opened without ringing real people, so these are
/// fixtures: the real call views, drawn from fixed values with no network,
/// no microphone and no camera (there is no picture in them — every tile
/// shows its avatar, as a camera that is off does). Debug builds only.
enum CallsScreens {
    static let ids: [String] = [
        "call-prejoin-voice", "call-prejoin-video", "call-prejoin-blocked",
        "call-incoming-voice", "call-incoming-video", "call-incoming-group", "call-incoming-busy",
        "call-ringing", "call-connecting", "call-voice", "call-video-1to1", "call-group-grid", "call-group-speaker",
        "call-reconnecting", "call-notice", "call-people", "call-people-empty",
        "call-mini-voice", "call-mini-video", "call-buttons",
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
            model.cameraOn = false
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
            var model = stage(others: [person("Wael", quality: .good)])
            model.notice = CallMediaProblem.micDenied.text
            return AnyView(CallStage(model: model, actions: CallStageActions()))

        case "call-people":
            return AnyView(Color.clear.sheet(isPresented: .constant(true)) {
                CallPeopleSheet(
                    participants: groupParticipants, me: "admin", mutedKeys: ["e-salem"],
                    addable: .loaded([APIClient.CallMember(key: "e-wael", name: "Wael", color: nil)]),
                    ringing: [], onRing: { _ in }, onRetry: {}, onClose: {}
                )
            })
        case "call-people-empty":
            return AnyView(Color.clear.sheet(isPresented: .constant(true)) {
                CallPeopleSheet(
                    participants: Array(groupParticipants.prefix(2)), me: "admin", mutedKeys: [],
                    addable: .loaded([]), ringing: [], onRing: { _ in }, onRetry: {}, onClose: {}
                )
            })

        case "call-mini-voice":
            return AnyView(miniOverApp(CallMiniModel(title: "Sally", status: "4:32", phase: .live, focus: person("Sally", speaking: true), audioMuted: true)))
        case "call-mini-video":
            return AnyView(miniOverApp(CallMiniModel(title: "NEON Team", status: "12:07", phase: .live, focus: person("Salem"), audioMuted: false)))
        case "call-buttons":
            return AnyView(buttonsFixture)
        default:
            return nil
        }
    }

    // MARK: Fixed values

    private static func prejoin(video: Bool) -> CallPreJoinModel {
        CallPreJoinModel(
            title: video ? "NEON Team" : "Sally", isVideo: video, isJoin: false, loading: false,
            micOn: true, micAvailable: true, cameraOn: false, camera: nil, mirror: true, problem: video ? .noCamera : nil
        )
    }

    private static func participant(_ key: String, _ name: String, _ state: String) -> CallParticipant {
        CallParticipant(memberKey: key, name: name, color: nil, state: state, joinedAt: state == "JOINED" ? "2026-09-30T09:00:00.000Z" : nil)
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
            id: "e-\(name.lowercased())", name: name, video: nil, audioMuted: muted, speaking: speaking,
            quality: quality, connection: connection, stalled: stalled
        )
    }

    private static func stage(
        others: [CallTileModel], video: Bool = false, ringing: Bool = false,
        phase: CallSessionPhase = .live, status: String = "4:32"
    ) -> CallStageModel {
        let title = others.first?.name ?? "Sally"
        return CallStageModel(
            title: title, isVideo: video, isGroup: false, status: status,
            waiting: ringing ? L("Calling…") : status, phase: phase, ringing: ringing,
            me: CallTileModel(id: "admin", name: "Manager", video: nil, isSelf: true),
            others: others, audioMuted: false, cameraOn: false, onSpeaker: video,
            inCall: others.count + 1, notice: nil
        )
    }

    private static func groupStage() -> CallStageModel {
        CallStageModel(
            title: "NEON Team", isVideo: true, isGroup: true, status: "12:07", waiting: "12:07", phase: .live, ringing: false,
            me: CallTileModel(id: "admin", name: "Manager", video: nil, audioMuted: true, isSelf: true),
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

    private static var buttonsFixture: some View {
        NeonScroll(spacing: NeonSpace.stack) {
            SectionCard(L("Call"), subtitle: "CallButtons", symbol: "phone.fill", hue: .green) {
                HStack(spacing: NeonSpace.lg) {
                    CallButtons(slug: "fixture-none", title: "Sally")
                    CallLivePill(title: L("Join call"), symbol: "video.fill") {}
                    CallLivePill(title: L("Back to call"), symbol: "phone.fill") {}
                }
            }
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
