import Foundation

// What src/lib/mobile/registry/projects.ts answers. The projects area owns
// overview, gallery, hotspots and analytics — not drawings, documents, BOQ,
// pricing, materials, furniture, approvals or comments, which the
// projectfiles area reads on its own behind the section stubs this screen
// embeds (see ProjectSections.swift).

struct DashboardStats: Codable {
    let total: Int
    let published: Int
    let pendingApprovals: Int
    let recentlyUpdated: Int
}

struct ProjectSummary: Codable, Identifiable, Equatable {
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

    var resolvedCoverURL: URL? { resolvedMediaURL(coverImageUrl) }
}

struct ProjectsListResponse: Codable {
    let stats: DashboardStats
    let projects: [ProjectSummary]
}

struct ProjectHotspot: Codable, Identifiable, Equatable {
    let id: String
    let xPercent: Double
    let yPercent: Double
    let label: String
    let description: String?
    let category: String?
    let linkLabel: String?
    let order: Int
}

struct GalleryImage: Codable, Identifiable, Equatable {
    let id: String
    let imageUrl: String
    let caption: String?
    let isBeforeAfter: Bool
    let beforeImageUrl: String?
    let order: Int
    let hotspots: [ProjectHotspot]

    var resolvedURL: URL? { resolvedMediaURL(imageUrl) }
    var resolvedBeforeURL: URL? { resolvedMediaURL(beforeImageUrl) }

    static func == (lhs: GalleryImage, rhs: GalleryImage) -> Bool { lhs.id == rhs.id }
}

struct GallerySpace: Codable, Identifiable, Equatable {
    let id: String
    let name: String
    let order: Int
    let images: [GalleryImage]

    static func == (lhs: GallerySpace, rhs: GallerySpace) -> Bool { lhs.id == rhs.id }
}

struct ProjectDetail: Codable, Identifiable {
    let id: String
    // Share token for the public client page (/p/<token>).
    let token: String?
    let name: String
    let clientName: String
    let clientEmail: String?
    let clientPhone: String?
    let location: String?
    let area: String?
    let projectType: String?
    let description: String?
    let coverImageUrl: String?
    let deliveryDate: String?
    let publishState: String
    let pipelineStatus: String
    let currentStage: String
    let completionPercent: Int
    let updatedAt: String
    let soldById: String?
    let soldOn: String?
    let showPricing: Bool
    let showDetailedPricing: Bool
    let showBoqQuantities: Bool
    let showBoqPrices: Bool
    let allowDownloads: Bool
    let watermarkEnabled: Bool
    let spaces: [GallerySpace]
    let count: Count

    struct Count: Codable {
        let approvals: Int
        let comments: Int
    }

    enum CodingKeys: String, CodingKey {
        case id, token, name, clientName, clientEmail, clientPhone, location, area, projectType, description
        case coverImageUrl, deliveryDate, publishState, pipelineStatus, currentStage, completionPercent, updatedAt
        case soldById, soldOn, showPricing, showDetailedPricing, showBoqQuantities, showBoqPrices
        case allowDownloads, watermarkEnabled, spaces
        case count = "_count"
    }

    var resolvedCoverURL: URL? { resolvedMediaURL(coverImageUrl) }

    // The link the client opens — what "Send to Client" shares.
    var clientLink: URL? {
        guard let token, !token.isEmpty else { return nil }
        return portalOrigin.appendingPathComponent("p/\(token)")
    }

    var allImages: [GalleryImage] { spaces.flatMap(\.images) }

    // Core/APIClient.swift (off limits to this area) still declares postComment
    // and setCommentStatus against the old /api/mobile/projects/<id>/comments
    // route, which this area no longer calls — the projectfiles area owns
    // comments now (ProjectCommentsSection). Kept only so that file still
    // compiles; nothing in this area constructs or reads one.
    struct CommentItem: Codable, Identifiable {
        let id: String
        let authorName: String
        let authorType: String
        let message: String
        let refLabel: String?
        let status: String
        let createdAt: String
    }
}

// Core/APIClient.swift's fetchDashboard() (unused by this area's own
// ProjectsAPI.swift, which reads "projects/list" instead) still names this type.
typealias DashboardResponse = ProjectsListResponse

struct ProjectActivityItem: Codable, Identifiable {
    let id: String
    let type: String
    let detail: String?
    let createdAt: String
}

struct ProjectActivityCount: Codable {
    let type: String
    let count: Count

    struct Count: Codable { let type: Int }

    enum CodingKeys: String, CodingKey {
        case type
        case count = "_count"
    }
}

struct ProjectAnalytics: Codable {
    let totalEvents: Int
    let views: Int
    let renderViews: Int
    let downloads: Int
    let approvals: Int
    let comments: Int
    let byType: [ProjectActivityCount]
    let recent: [ProjectActivityItem]
}

struct ProjectSeller: Codable, Identifiable {
    let id: String
    let name: String
}

#if DEBUG
// CI screenshot fixture only — lets the simulator screenshot the Projects
// tab's real layout without ever putting the production admin password into a
// public repo's automation. Compiled out entirely in Release, so it never
// ships in the build used for real installs.
extension ProjectsListResponse {
    static let preview = ProjectsListResponse(
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
