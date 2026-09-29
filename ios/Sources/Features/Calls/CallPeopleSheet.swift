import SwiftUI

// Who was asked into the call and where each of them stands, and ringing
// somebody else in — the website's people panel and "add people". Only
// somebody in the call may ring anybody (the server's rule, inviteToCall);
// this sheet is only reachable from inside the call, so it never offers it
// to anybody else.

enum CallAddableState {
    case loading
    case failed(String)
    case loaded([APIClient.CallMember])
}

struct CallPeopleSheet: View {
    let participants: [CallParticipant]
    let me: String
    let mutedKeys: Set<String>
    let addable: CallAddableState
    let ringing: Set<String>
    let onRing: (APIClient.CallMember) async -> Void
    let onRetry: () -> Void
    let onClose: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            SheetHeader(L("People"), subtitle: summary, symbol: "person.2.fill", tint: .neonSuccessStrong, onClose: onClose)
            ScrollView {
                VStack(spacing: NeonSpace.stack) {
                    SectionCard(
                        L("Asked into this call"), subtitle: L("Who is in, who is still being rung, and who said no."),
                        symbol: "phone.fill", hue: .green
                    ) {
                        VStack(spacing: 0) {
                            ForEach(Array(ordered.enumerated()), id: \.element.memberKey) { index, part in
                                if index > 0 { NeonDivider().padding(.leading, 54) }
                                participantRow(part)
                                    .staggered(index)
                            }
                        }
                    }

                    SectionCard(
                        L("Ring someone in"), subtitle: L("Their phone rings the same way as any call."),
                        symbol: "phone.arrow.up.right.fill", hue: .purple
                    ) {
                        addableContent
                    }
                }
                .padding(.horizontal, NeonSpace.gutter)
                .padding(.top, NeonSpace.xs)
                .padding(.bottom, NeonSpace.xxl)
            }
        }
        .background(NeonAmbient().ignoresSafeArea())
        .neonSheet([.medium, .large])
    }

    private var summary: String {
        let inCall = participants.filter { $0.state == "JOINED" }.count
        let ringingNow = participants.filter { $0.state == "INVITED" }.count
        if ringingNow > 0 {
            return L("%@ in the call · %@ ringing", NeonFormat.integer(inCall), NeonFormat.integer(ringingNow))
        }
        return L("%@ in the call", NeonFormat.integer(inCall))
    }

    /// In the call first, then still ringing, then those who said no or left.
    private var ordered: [CallParticipant] {
        let rank = ["JOINED": 0, "INVITED": 1, "DECLINED": 2, "LEFT": 3]
        return participants.sorted { a, b in
            if a.memberKey == me { return true }
            if b.memberKey == me { return false }
            let ra = rank[a.state] ?? 4, rb = rank[b.state] ?? 4
            return ra != rb ? ra < rb : a.name < b.name
        }
    }

    private func participantRow(_ part: CallParticipant) -> some View {
        HStack(spacing: NeonSpace.md) {
            AvatarView(url: nil, name: part.name, size: 42, style: .solid)
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 6) {
                    DirText(part.name, font: .neonRowTitle, fill: false, lineLimit: 1)
                    if part.memberKey == me {
                        BadgeView(text: L("You"), tone: .neutral)
                    }
                }
                let state = Self.state(part.state)
                StateBadge(state.text, tone: state.tone, symbol: state.symbol, pulsing: part.state == "INVITED")
            }
            Spacer(minLength: 0)
            if part.state == "JOINED", mutedKeys.contains(part.memberKey) {
                Image(systemName: "mic.slash.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.neonDangerStrong)
                    .frame(width: 32, height: 32)
                    .background(Circle().fill(NeonHue.red.wash))
                    .accessibilityLabel(L("Muted"))
            }
        }
        .padding(.vertical, 10)
        .accessibilityElement(children: .combine)
    }

    static func state(_ raw: String) -> (text: String, tone: BadgeTone, symbol: String?) {
        switch raw {
        case "JOINED": return (L("In the call"), .success, "phone.fill")
        case "INVITED": return (L("Ringing"), .blue, nil)
        case "DECLINED": return (L("Declined"), .danger, "phone.down.fill")
        case "LEFT": return (L("Left"), .neutral, "arrow.uturn.backward")
        default: return (raw, .neutral, nil)
        }
    }

    @ViewBuilder
    private var addableContent: some View {
        switch addable {
        case .loading:
            VStack(spacing: NeonSpace.md) {
                ForEach(0..<2, id: \.self) { _ in
                    HStack(spacing: NeonSpace.md) {
                        SkeletonBlock(width: 42, height: 42, radius: 21)
                        SkeletonBlock(width: 140, height: 14)
                        Spacer(minLength: 0)
                        SkeletonBlock(width: 70, height: 30, radius: 15)
                    }
                }
            }
            .shimmer()
        case .failed(let message):
            VStack(alignment: .leading, spacing: NeonSpace.sm) {
                Text(L("Couldn't load who else can be rung."))
                    .font(.system(.subheadline, weight: .semibold))
                    .foregroundStyle(Color.neonInk)
                Text(message)
                    .font(.neonSubtitle)
                    .foregroundStyle(Color.neonTextSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                NeonButton(L("Try again"), symbol: "arrow.clockwise", kind: .secondary, size: .small) { onRetry() }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        case .loaded(let members):
            if members.isEmpty {
                Text(L("Nobody else can be rung in right now."))
                    .font(.neonSubtitle)
                    .foregroundStyle(Color.neonTextSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(members.enumerated()), id: \.element.key) { index, member in
                        if index > 0 { NeonDivider().padding(.leading, 54) }
                        addableRow(member)
                    }
                }
            }
        }
    }

    private func addableRow(_ member: APIClient.CallMember) -> some View {
        HStack(spacing: NeonSpace.md) {
            AvatarView(url: nil, name: member.name, size: 42, style: .soft)
            DirText(member.name, font: .neonRowTitle, fill: false, lineLimit: 1)
            Spacer(minLength: NeonSpace.sm)
            if ringing.contains(member.key) {
                StateBadge(L("Ringing"), tone: .blue, pulsing: true)
                    .transition(.neonPop)
            } else {
                NeonButton(L("Ring"), symbol: "phone.arrow.up.right.fill", kind: .tinted(.neonSuccessStrong), size: .small) {
                    await onRing(member)
                }
                .accessibilityLabel(L("Ring %@", member.name))
            }
        }
        .padding(.vertical, 10)
        .animation(NeonMotion.snappy, value: ringing.contains(member.key))
    }
}

/// The sheet, reading who can be rung in and ringing them.
struct CallPeopleLive: View {
    let callId: String
    let participants: [CallParticipant]
    let me: String
    let mutedKeys: Set<String>
    let onClose: () -> Void

    @State private var addable: CallAddableState = .loading
    @State private var ringing: Set<String> = []

    var body: some View {
        CallPeopleSheet(
            participants: participants, me: me, mutedKeys: mutedKeys, addable: addable, ringing: ringing,
            onRing: { await ring($0) },
            onRetry: { Task { await load() } },
            onClose: onClose
        )
        .task { await load() }
    }

    private func load() async {
        addable = .loading
        do {
            addable = .loaded(try await APIClient.shared.callAddable(callId: callId))
        } catch {
            addable = .failed((error as? LocalizedError)?.errorDescription ?? error.localizedDescription)
        }
    }

    private func ring(_ member: APIClient.CallMember) async {
        do {
            try await APIClient.shared.callInvite(callId: callId, members: [member.key])
            ringing.insert(member.key)
            Haptic.success()
        } catch {
            Toast.error(error)
        }
    }
}
