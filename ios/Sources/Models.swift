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
