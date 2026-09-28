import SwiftUI

/// The manager's home tab — the admin dashboard: the studio's four figures,
/// the team's day (who needs the manager, most pressing first — silence is
/// shown as silence, never as a verdict), and every project.
struct AdminHomeView: View {
    @EnvironmentObject var api: APIClient
    @State private var overview: HomeOverview?
    @State private var overviewCachedAt: Date?
    @State private var overviewError: String?
    @State private var day: HomeDay?
    @State private var dayCachedAt: Date?
    @State private var dayError: String?

    var body: some View {
        NavigationStack {
            NeonScroll {
                Text(L("An overview of every client project delivery."))
                    .font(.neonSubheadline)
                    .foregroundStyle(Color.neonTextSecondary)

                LoadStateView(value: overview, error: overviewError, cachedAt: overviewCachedAt, retry: loadOverview) {
                    StatGrid {
                        ForEach(0..<4, id: \.self) { _ in SkeletonStatTile() }
                    }
                } content: { overview in
                    StatGrid {
                        StatTile(L("Total Projects"), value: Double(overview.stats.total), symbol: "folder.fill", tint: .neonCyanStrong)
                        StatTile(L("Published"), value: Double(overview.stats.published), symbol: "checkmark.seal.fill", tint: .neonPurpleStrong)
                        StatTile(L("Pending Approvals"), value: Double(overview.stats.pendingApprovals), symbol: "clock.fill", tint: .neonOrangeStrong)
                        StatTile(L("Updated This Week"), value: Double(overview.stats.recentlyUpdated), symbol: "chart.line.uptrend.xyaxis", tint: .neonPinkStrong)
                    }
                }

                if let day {
                    SectionHeader(L("The day"), subtitle: longDayLabel(day.dayKey))
                    DayBoardSummary(summary: day.summary)
                    DayBoardPressing(days: day.pressing, dayLabel: longDayLabel(day.dayKey))
                    Text(L("An unanswered question is a question, not a verdict: nobody here is marked as having done nothing."))
                        .font(.neonCaption)
                        .foregroundStyle(Color.neonTextFaint)
                } else if let dayError {
                    ErrorState(message: dayError, retry: loadDay)
                } else {
                    SectionHeader(L("The day"))
                    SkeletonRows(count: 3)
                }

                if let overview {
                    SectionHeader(L("All Projects"), count: overview.projects.count)
                    if overview.projects.isEmpty {
                        EmptyState(symbol: "folder", title: L("No projects yet"), detail: L("Create your first client project to start building its delivery portal."))
                    } else {
                        VStack(spacing: NeonSpace.sm) {
                            ForEach(overview.projects) { project in
                                HomeProjectRow(project: project)
                            }
                        }
                    }
                }
            }
            .refreshable {
                Haptic.tap()
                await load()
            }
            .navigationTitle(L("Home"))
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { AccountMenu() }
            }
        }
        .task { await load() }
    }

    private func load() async {
        async let overviewTask: Void = loadOverview()
        async let dayTask: Void = loadDay()
        _ = await (overviewTask, dayTask)
    }

    private func loadOverview() async {
        do {
            let loaded = try await api.fetchHomeOverview()
            overview = loaded.value
            overviewCachedAt = loaded.cachedAt
            overviewError = nil
        } catch {
            overviewError = error.localizedDescription
        }
    }

    private func loadDay() async {
        do {
            let loaded = try await api.fetchHomeDay()
            day = loaded.value
            dayCachedAt = loaded.cachedAt
            dayError = nil
        } catch {
            dayError = error.localizedDescription
        }
    }
}

// MARK: - The day

private struct DayBoardSummary: View {
    let summary: DaySummary

    var body: some View {
        let tiles: [(String, Int, Color?)] = [
            (L("On the day"), summary.planned, nil),
            (L("No plan yet"), summary.unplanned, summary.unplanned > 0 ? .neonWarningStrong : nil),
            (L("Blocked"), summary.blocked, summary.blocked > 0 ? .neonDangerStrong : nil),
            (L("Said started"), summary.contradictions, summary.contradictions > 0 ? .neonDangerStrong : nil),
            (L("Overloaded"), summary.overloaded, summary.overloaded > 0 ? .neonWarningStrong : nil),
            (L("Unanswered"), summary.unanswered, nil),
        ]
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: NeonSpace.sm), count: 3), spacing: NeonSpace.sm) {
            ForEach(Array(tiles.enumerated()), id: \.offset) { _, tile in
                VStack(spacing: 2) {
                    Text(NeonFormat.integer(tile.1))
                        .font(.neonTitle3)
                        .foregroundStyle(tile.2 ?? Color.neonInk)
                    Text(tile.0)
                        .font(.neonOverline)
                        .foregroundStyle(Color.neonTextTertiary)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, NeonSpace.sm)
                .neonSurface(.glass, radius: NeonRadius.md)
            }
        }
    }
}

private struct DayBoardPressing: View {
    let days: [HomePersonDay]
    let dayLabel: String

    var body: some View {
        if days.isEmpty {
            Text(L("Nothing on %@ needs you right now.", dayLabel))
                .font(.neonSubheadline)
                .foregroundStyle(Color.neonTextSecondary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, NeonSpace.xl)
                .neonSurface(.glass, radius: NeonRadius.lg)
        } else {
            VStack(spacing: NeonSpace.sm) {
                ForEach(days) { person in
                    PressingPersonCard(person: person)
                }
            }
        }
    }
}

private struct PressingPersonCard: View {
    let person: HomePersonDay

    var body: some View {
        NeonCard {
            HStack(alignment: .firstTextBaseline) {
                HStack(spacing: 8) {
                    Circle().fill(employeeFill(person.color)).frame(width: 8, height: 8)
                    DirText(person.name, font: .neonHeadline, fill: false)
                }
                Spacer(minLength: 8)
                Text(describeDayKind(
                    person.describeKind,
                    blocked: person.blocked.count,
                    contradictions: person.contradictions.count,
                    waiting: person.needsManager.count,
                    unanswered: person.unanswered
                ))
                .font(.neonFootnote)
                .foregroundStyle(Color.neonTextTertiary)
            }

            if person.overloaded {
                Label(
                    L("%@ more than the day holds (%@ planned, %@ available)",
                      describeMinutes(Double(person.overBy)),
                      describeMinutes(Double(person.plannedMinutes)),
                      describeMinutes(Double(person.capacityMinutes))),
                    systemImage: "clock.fill"
                )
                .font(.neonCaption)
                .foregroundStyle(Color.neonWarningStrong)
            }

            ForEach(person.blocked) { row in
                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: "pause.circle.fill").font(.neonFootnote)
                    VStack(alignment: .leading, spacing: 2) {
                        DirText(row.taskName, font: .neonFootnote.weight(.semibold), color: .neonDangerStrong)
                        DirText(
                            row.who != nil ? "\(row.reason) — \(L("%@ can clear it", row.who!))" : row.reason,
                            font: .neonCaption, color: .neonTextSecondary
                        )
                    }
                }
                .foregroundStyle(Color.neonDangerStrong)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(NeonSpace.sm)
                .neonSurface(.tinted(.neonDanger), radius: NeonRadius.sm)
            }

            ForEach(person.contradictions) { row in
                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: "exclamationmark.triangle.fill").font(.neonFootnote)
                    DirText(L("%@: said started, the board still says pending", row.taskName), font: .neonFootnote, color: .neonTextSecondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(NeonSpace.sm)
                .neonSurface(.outline, radius: NeonRadius.sm)
            }

            ForEach(person.needsManager) { row in
                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: "exclamationmark.circle.fill").font(.neonFootnote)
                    VStack(alignment: .leading, spacing: 2) {
                        DirText("\(row.taskName ?? L("Their day")) — \(describeManagerAnswer(row.answer))", font: .neonFootnote.weight(.semibold), color: .neonWarningStrong)
                        if let note = row.note {
                            DirText(note, font: .neonCaption, color: .neonTextSecondary)
                        }
                    }
                }
                .foregroundStyle(Color.neonWarningStrong)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(NeonSpace.sm)
                .neonSurface(.tinted(.neonWarning), radius: NeonRadius.sm)
            }
        }
    }
}

// MARK: - Projects

private struct HomeProjectRow: View {
    let project: HomeProject

    var body: some View {
        HStack(spacing: NeonSpace.md) {
            RemoteImage(url: resolvedMediaURL(project.coverImageUrl), contentMode: .fill)
                .frame(width: 64, height: 56)
                .clipShape(RoundedRectangle(cornerRadius: NeonRadius.sm, style: .continuous))

            VStack(alignment: .leading, spacing: 4) {
                DirText(project.name, font: .neonHeadline, fill: false, lineLimit: 1)
                HStack(spacing: 6) {
                    BadgeView(text: localizedEnum("publishState", project.publishState), tone: publishTone(project.publishState))
                    BadgeView(text: localizedEnum("pipelineStatus", project.pipelineStatus), tone: .neutral)
                }
                DirText(
                    project.location != nil ? "\(project.clientName) · \(project.location!)" : project.clientName,
                    font: .system(size: 13)
                )
                .foregroundStyle(Color.neonTextTertiary)
                .lineLimit(1)
            }

            Spacer(minLength: 4)

            VStack(alignment: .trailing, spacing: 2) {
                Text(L("%d approvals", project.approvals)).font(.neonCaption2Ish)
                Text(L("%d comments", project.comments)).font(.neonCaption2Ish)
            }
            .foregroundStyle(Color.neonTextFaint)
        }
        .padding(NeonSpace.sm)
        .neonSurface(.glass, radius: NeonRadius.lg)
    }
}

private extension Font {
    /// A touch smaller than `.neonCaption`, for two stacked figures.
    static var neonCaption2Ish: Font { .system(size: 10) }
}

private struct SkeletonStatTile: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            IconTile("circle", tint: .neonTextFaint, size: 34)
            Text("00").font(.neonNumber).hidden()
        }
        .padding(NeonSpace.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .neonSurface(.glass, radius: NeonRadius.lg)
        .skeleton(true)
    }
}
