import Foundation

struct DashboardStats: Codable {
    let total: Int
    let published: Int
    let pendingApprovals: Int
    let recentlyUpdated: Int
}

struct ProjectSummary: Codable, Identifiable {
    let id: String
    let name: String
    let clientName: String
    let location: String?
    let publishState: String
    let pipelineStatus: String
    let coverImageUrl: String?
    let updatedAt: String
    let approvalsCount: Int
    let commentsCount: Int
}

struct DashboardResponse: Codable {
    let stats: DashboardStats
    let projects: [ProjectSummary]
}

#if DEBUG
// CI screenshot fixture only — lets the simulator screenshot the Dashboard's
// real layout without ever putting the production admin password into a
// public repo's automation. Compiled out entirely in Release, so it never
// ships in the build used for real installs.
extension DashboardResponse {
    static let preview = DashboardResponse(
        stats: DashboardStats(total: 3, published: 3, pendingApprovals: 1, recentlyUpdated: 3),
        projects: [
            ProjectSummary(
                id: "1", name: "Villa Al-Fulan", clientName: "Ahmad Al-Fulan", location: "Amman, Jordan",
                publishState: "PUBLISHED", pipelineStatus: "EXECUTION", coverImageUrl: nil, updatedAt: "",
                approvalsCount: 3, commentsCount: 2
            ),
            ProjectSummary(
                id: "2", name: "Bond Cafe", clientName: "Mr. Ahmad", location: "Amman",
                publishState: "PUBLISHED", pipelineStatus: "COMPLETED", coverImageUrl: nil, updatedAt: "",
                approvalsCount: 0, commentsCount: 0
            ),
            ProjectSummary(
                id: "3", name: "Skills", clientName: "Mr. Omair", location: "Amman",
                publishState: "DRAFT", pipelineStatus: "DESIGN", coverImageUrl: nil, updatedAt: "",
                approvalsCount: 0, commentsCount: 0
            ),
        ]
    )
}
#endif
