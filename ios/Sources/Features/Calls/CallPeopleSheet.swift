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

    /// Tall enough to show the one action whenever there is somebody to ring.
    @State private var detent: PresentationDetent

    init(
        participants: [CallParticipant], me: String, mutedKeys: Set<String>, addable: CallAddableState,
        ringing: Set<String>, onRing: @escaping (APIClient.CallMember) async -> Void,
        onRetry: @escaping () -> Void, onClose: @escaping () -> Void
    ) {
        self.participants = participants
        self.me = me
        self.mutedKeys = mutedKeys
        self.addable = addable
        self.ringing = ringing
        self.onRing = onRing
        self.onRetry = onRetry
        self.onClose = onClose
        _detent = State(initialValue: Self.ringable(addable, participants).isEmpty ? .medium : .large)
    }

    var body: some View {
        VStack(spacing: 0) {
            // The header's line already says who is in and who is ringing, so
            // the list starts straight under it.
            SheetHeader(L("People"), subtitle: summary, symbol: "person.2.fill", tint: .neonSuccessStrong, onClose: onClose)
            ScrollView {
                VStack(alignment: .leading, spacing: NeonSpace.stack) {
                    CardList(ordered, id: \.memberKey, dividerInset: 66) { part in
                        participantRow(part)
                    }
                    SectionHeader(L("Ring someone in"))
                        .padding(.top, NeonSpace.sm)
                    addableContent
                }
                .padding(.horizontal, NeonSpace.gutter)
                .padding(.top, NeonSpace.xs)
                .padding(.bottom, NeonSpace.xxl)
            }
        }
        .background(NeonAmbient().ignoresSafeArea())
        .neonSheet([.medium, .large])
        .presentationDetents([.medium, .large], selection: $detent)
        .onChange(of: Self.ringable(addable, participants).isEmpty) { empty in
            if !empty, detent == .medium { withNeonAnimation(.smooth) { detent = .large } }
        }
    }

    private var summary: String {
        let inCall = participants.filter { $0.state == "JOINED" }.count
        let ringingNow = participants.filter { $0.state == "INVITED" }.count
        if ringingNow > 0 {
            return L("%@ in the call · %@ ringing", NeonFormat.integer(inCall), NeonFormat.integer(ringingNow))
        }
        return L("%@ in the call", NeonFormat.integer(inCall))
    }

    /// Who can still be rung: the server already leaves out everybody asked
    /// into the call, whatever they answered — checked again here so nobody
    /// can appear twice.
    static func ringable(_ addable: CallAddableState, _ participants: [CallParticipant]) -> [APIClient.CallMember] {
        guard case .loaded(let members) = addable else { return [] }
        let asked = Set(participants.map(\.memberKey))
        return members.filter { !asked.contains($0.key) }
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

    /// One line each, about 56 pt: the face in the colour the chat shows,
    /// the name, and where they stand as a badge on the trailing side.
    private func participantRow(_ part: CallParticipant) -> some View {
        let state = Self.state(part.state)
        return HStack(spacing: NeonSpace.md) {
            ChatAvatar(url: part.photoURL, name: part.name, size: 40, color: part.color)
            HStack(spacing: 6) {
                DirText(part.name, font: .system(.callout, weight: .semibold), color: .neonInk, fill: false, lineLimit: 1)
                if part.memberKey == me {
                    BadgeView(text: L("You"), tone: .neutral)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if part.state == "JOINED", mutedKeys.contains(part.memberKey) {
                Image(systemName: "mic.slash.fill")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.neonDangerStrong)
                    .frame(width: 28, height: 28)
                    .background(Circle().fill(NeonHue.red.wash))
                    .accessibilityLabel(L("Muted"))
            }
            StateBadge(state.text, tone: state.tone, symbol: state.symbol, pulsing: part.state == "INVITED")
                .fixedSize()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .frame(minHeight: 56)
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
                        SkeletonBlock(width: 40, height: 40, radius: 20)
                        SkeletonBlock(width: 140, height: 14)
                        Spacer(minLength: 0)
                        SkeletonBlock(width: 70, height: 34, radius: 17)
                    }
                }
            }
            .padding(14)
            .neonSurface(.glass, radius: NeonRadius.lg)
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
                NeonButton(L("Try again"), symbol: "arrow.clockwise", kind: .secondary, size: .medium) { onRetry() }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(NeonSpace.card)
            .neonSurface(.glass, radius: NeonRadius.lg)
        case .loaded:
            let members = Self.ringable(addable, participants)
            if members.isEmpty {
                // Why, in one line: the list is the whole team less everybody
                // already asked, so empty means everybody has been.
                Text(L("Everyone on the team has already been asked into this call."))
                    .font(.neonFootnote)
                    .foregroundStyle(Color.neonTextSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                CardList(members, dividerInset: 66) { member in
                    addableRow(member)
                }
            }
        }
    }

    private func addableRow(_ member: APIClient.CallMember) -> some View {
        HStack(spacing: NeonSpace.md) {
            ChatAvatar(url: facePhotoURL(member.photo), name: member.name, size: 40, color: member.color)
            DirText(member.name, font: .system(.callout, weight: .semibold), color: .neonInk, fill: false, lineLimit: 1)
                .frame(maxWidth: .infinity, alignment: .leading)
            if ringing.contains(member.key) {
                StateBadge(L("Ringing"), tone: .blue, pulsing: true)
                    .fixedSize()
                    .transition(.neonPop)
            } else {
                NeonButton(L("Ring"), symbol: "phone.arrow.up.right.fill", kind: .tinted(.neonSuccessStrong), size: .medium) {
                    await onRing(member)
                }
                .accessibilityLabel(L("Ring %@", member.name))
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 6)
        .frame(minHeight: 56)
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
