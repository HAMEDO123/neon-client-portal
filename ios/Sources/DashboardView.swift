import SwiftUI

struct DashboardView: View {
    @EnvironmentObject var api: APIClient
    @State private var data: DashboardResponse?
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                if let data {
                    VStack(alignment: .leading, spacing: 20) {
                        Text("An overview of every client project delivery.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)

                        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                            StatCard(label: "Total Projects", value: data.stats.total)
                            StatCard(label: "Published", value: data.stats.published)
                            StatCard(label: "Pending Approvals", value: data.stats.pendingApprovals)
                            StatCard(label: "Updated This Week", value: data.stats.recentlyUpdated)
                        }

                        Text("ALL PROJECTS")
                            .font(.caption)
                            .fontWeight(.medium)
                            .foregroundStyle(.secondary)
                            .padding(.top, 8)

                        if data.projects.isEmpty {
                            Text("No projects yet.")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .padding(.top, 12)
                        } else {
                            VStack(spacing: 10) {
                                ForEach(data.projects) { project in
                                    ProjectRow(project: project)
                                }
                            }
                        }
                    }
                    .padding()
                } else if let errorMessage {
                    VStack(spacing: 12) {
                        Text(errorMessage).foregroundStyle(.secondary)
                        Button("Retry") { Task { await load() } }
                    }
                    .padding(.top, 80)
                } else {
                    ProgressView().padding(.top, 80)
                }
            }
            .refreshable { await load() }
            .navigationTitle("Dashboard")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Sign Out") { api.logout() }
                }
            }
        }
        .task { await load() }
    }

    private func load() async {
        do {
            data = try await api.fetchDashboard()
            errorMessage = nil
        } catch {
            errorMessage = "Couldn't load — pull to retry."
        }
    }
}

private struct StatCard: View {
    let label: String
    let value: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("\(value)").font(.system(size: 26, weight: .semibold))
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16))
    }
}

private struct ProjectRow: View {
    let project: ProjectSummary

    var body: some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 10)
                .fill(.gray.opacity(0.15))
                .frame(width: 56, height: 44)

            VStack(alignment: .leading, spacing: 3) {
                Text(project.name).font(.subheadline).fontWeight(.medium)
                Text(project.clientName).font(.caption).foregroundStyle(.secondary)
            }

            Spacer()

            Text(project.publishState.capitalized)
                .font(.caption2)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(.green.opacity(0.15), in: Capsule())
                .foregroundStyle(.green)
        }
        .padding()
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16))
    }
}
