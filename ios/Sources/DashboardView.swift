import SwiftUI

struct DashboardView: View {
    @EnvironmentObject var api: APIClient
    @State private var data: DashboardResponse?
    @State private var errorMessage: String?
    @State private var appeared = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    Text("An overview of every client project delivery.")
                        .font(.system(size: 14))
                        .foregroundStyle(Color.neonInk.opacity(0.5))
                        .padding(.top, 4)

                    if let data {
                        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                            StatCard(label: "Total Projects", value: data.stats.total, symbol: "folder.fill", tone: .cyan)
                            StatCard(label: "Published", value: data.stats.published, symbol: "checkmark.seal.fill", tone: .purple)
                            StatCard(label: "Pending Approvals", value: data.stats.pendingApprovals, symbol: "clock.fill", tone: .orange)
                            StatCard(label: "Updated This Week", value: data.stats.recentlyUpdated, symbol: "chart.line.uptrend.xyaxis", tone: .pink)
                        }

                        Text("ALL PROJECTS")
                            .font(.system(size: 12, weight: .semibold))
                            .tracking(0.6)
                            .foregroundStyle(Color.neonInk.opacity(0.4))
                            .padding(.top, 6)

                        if data.projects.isEmpty {
                            Text("No projects yet.")
                                .font(.subheadline)
                                .foregroundStyle(Color.neonInk.opacity(0.5))
                                .padding(.top, 12)
                        } else {
                            VStack(spacing: 10) {
                                ForEach(Array(data.projects.enumerated()), id: \.element.id) { index, project in
                                    ProjectRow(project: project)
                                        .opacity(appeared ? 1 : 0)
                                        .offset(y: appeared ? 0 : 12)
                                        .animation(
                                            .easeOut(duration: 0.35).delay(Double(index) * 0.05),
                                            value: appeared
                                        )
                                }
                            }
                        }
                    } else if let errorMessage {
                        VStack(spacing: 12) {
                            Text(errorMessage).foregroundStyle(Color.neonInk.opacity(0.5))
                            Button("Retry") { Task { await load() } }
                                .buttonStyle(.borderedProminent)
                                .tint(.neonInk)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.top, 60)
                    } else {
                        SkeletonDashboard()
                    }
                }
                .padding(16)
            }
            .refreshable {
                Haptic.tap()
                await load()
            }
            .navigationTitle("Dashboard")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Sign Out") { api.logout() }
                        .foregroundStyle(Color.neonInk.opacity(0.6))
                }
            }
        }
        .neonAmbientBackground()
        .task { await load() }
    }

    private func load() async {
        do {
            data = try await api.fetchDashboard()
            errorMessage = nil
            appeared = false
            withAnimation { appeared = true }
        } catch {
            errorMessage = "Couldn't load — pull to retry."
        }
    }
}

private struct StatCard: View {
    let label: String
    let value: Int
    let symbol: String
    let tone: BadgeTone

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ZStack {
                Circle().fill(tone.background).frame(width: 34, height: 34)
                Image(systemName: symbol)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(tone.foreground)
            }
            Text("\(value)")
                .font(.system(size: 26, weight: .bold, design: .rounded))
                .foregroundStyle(Color.neonInk)
            Text(label)
                .font(.system(size: 12))
                .foregroundStyle(Color.neonInk.opacity(0.5))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .glassCard(radius: 18)
    }
}

private struct ProjectRow: View {
    let project: ProjectSummary

    var body: some View {
        NavigationLink {
            ProjectDetailView(project: project)
        } label: {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(Color.neonInk.opacity(0.06))
                    if let url = project.resolvedCoverURL {
                        AsyncImage(url: url) { phase in
                            if let image = phase.image {
                                image.resizable().aspectRatio(contentMode: .fill)
                            }
                        }
                    }
                }
                .frame(width: 56, height: 48)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

                VStack(alignment: .leading, spacing: 3) {
                    Text(project.name)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(Color.neonInk)
                        .lineLimit(1)
                    Text(project.clientName + (project.location.map { " · \($0)" } ?? ""))
                        .font(.system(size: 12))
                        .foregroundStyle(Color.neonInk.opacity(0.5))
                        .lineLimit(1)
                }

                Spacer(minLength: 8)

                BadgeView(text: project.publishState, tone: publishTone(project.publishState))

                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.neonInk.opacity(0.3))
            }
            .padding(12)
            .glassCard(radius: 16)
        }
        .buttonStyle(.plain)
    }
}

private struct SkeletonDashboard: View {
    @State private var shimmer = false

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                ForEach(0..<4, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(Color.neonInk.opacity(shimmer ? 0.08 : 0.04))
                        .frame(height: 96)
                }
            }
            VStack(spacing: 10) {
                ForEach(0..<3, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(Color.neonInk.opacity(shimmer ? 0.08 : 0.04))
                        .frame(height: 72)
                }
            }
        }
        .onAppear {
            withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) {
                shimmer = true
            }
        }
    }
}
