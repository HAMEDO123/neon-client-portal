import SwiftUI

/// "Where the team is" on the manager's Home, during working hours: a small
/// map with everybody's face where their phone last was, and one line of
/// how many are where. Tap it for the whole map. Home draws it only while
/// the day is open — outside working hours there is nothing to show, and the
/// map stays a tap away under More.
///
/// It reads every 30 seconds while Home is in front, and never asks the
/// phones for anything: that is the full map's to do, when somebody is
/// actually looking at it.
struct HomeTeamMapCard: View {
    @ObservedObject var model: TeamMapModel
    let onOpen: () -> Void

    @Environment(\.scenePhase) private var scenePhase
    @State private var visible = false

    private var people: [TeamLocationPerson] { model.data?.people ?? [] }

    var body: some View {
        SectionCard(L("Where the team is"), subtitle: subtitle, symbol: "map.fill", hue: .green, actionTitle: L("Open map"), action: onOpen) {
            Button {
                Haptic.tap()
                onOpen()
            } label: {
                VStack(alignment: .leading, spacing: NeonSpace.md) {
                    TeamMapCanvas(
                        people: model.data?.onMap ?? [],
                        office: model.data?.office,
                        selection: .constant(nil),
                        interactive: false,
                        compact: true
                    )
                    .frame(height: 196)
                    .clipShape(RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous)
                            .strokeBorder(Color.neonLine, lineWidth: 1)
                    )
                    .overlay(alignment: .topTrailing) {
                        if TeamMapCounts(people).onMap > 0 {
                            HStack(spacing: 5) {
                                LocationLiveDot().padding(-4)
                                Text(L("Live"))
                                    .font(.system(size: 10, weight: .bold))
                                    .textCase(.uppercase)
                                    .foregroundStyle(Color.neonSuccessStrong)
                            }
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(Capsule().fill(Color.white.opacity(0.92)))
                            .padding(8)
                        }
                    }
                    faces
                }
            }
            .buttonStyle(.pressableCard)
        }
        .onAppear { visible = true }
        .onDisappear { visible = false }
        .task(id: visible && scenePhase == .active) {
            guard visible, scenePhase == .active else { return }
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 30 * 1_000_000_000)
                guard !Task.isCancelled else { return }
                await model.load()
            }
        }
    }

    private var subtitle: String {
        let counts = TeamMapCounts(people)
        var parts = [L("%d on the map", counts.onMap)]
        if model.data?.office != nil, counts.atOffice > 0 { parts.append(L("%d at the office", counts.atOffice)) }
        if counts.off > 0 { parts.append(L("%d location off", counts.off)) }
        return parts.joined(separator: " · ")
    }

    /// Everybody, a face each, the ones with a position first.
    private var faces: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(people) { person in
                    VStack(spacing: 4) {
                        TeamMapFace(person: person, size: 42)
                        Text(person.name.split(separator: " ").first.map(String.init) ?? person.name)
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(Color.neonTextSecondary)
                            .lineLimit(1)
                    }
                    .frame(width: 56)
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel(Text("\(person.name), \(teamMapStatus(person, place: nil))"))
                }
            }
        }
    }
}
