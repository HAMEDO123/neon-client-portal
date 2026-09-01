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

    var resolvedCoverURL: URL? { resolvedMediaURL(coverImageUrl) }
}

let portalOrigin = URL(string: "https://neon-client-portal.onrender.com")!

// The API returns some file/image paths as web-relative (e.g. "/seed-images/…"),
// which URL(string:) alone can't load — resolve those against the portal origin.
func resolvedMediaURL(_ raw: String?) -> URL? {
    guard let raw, !raw.isEmpty else { return nil }
    return URL(string: raw, relativeTo: portalOrigin)
}

struct ProjectDetail: Codable {
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
    let spaces: [GallerySpace]
    let drawings: [Drawing]
    let documents: [ProjectDocument]
    let boqItems: [BoqItem]
    let pricingItems: [PricingItem]
    let materials: [MaterialItem]
    let furniture: [FurnitureItem]
    let approvals: [ApprovalItem]
    let comments: [CommentItem]

    struct GallerySpace: Codable, Identifiable {
        let id: String
        let name: String
        let images: [GalleryImage]
    }

    struct GalleryImage: Codable, Identifiable {
        let id: String
        let imageUrl: String
        let caption: String?
        let isBeforeAfter: Bool
        let beforeImageUrl: String?
    }

    struct Drawing: Codable, Identifiable {
        let id: String
        let category: String
        let subCategory: String?
        let name: String
        let drawingNumber: String?
        let revision: String
        let fileUrl: String
        let thumbnailUrl: String?
        let fileType: String
    }

    struct ProjectDocument: Codable, Identifiable {
        let id: String
        let category: String
        let title: String
        let fileUrl: String
        let fileType: String
        let version: String?
    }

    struct BoqItem: Codable, Identifiable {
        let id: String
        let category: String
        let name: String
        let description: String?
        let unit: String
        let quantity: Double
        let unitPrice: Double?
    }

    struct PricingItem: Codable, Identifiable {
        let id: String
        let category: String
        let label: String
        let description: String?
        let amount: Double
        let isOptional: Bool
    }

    struct MaterialItem: Codable, Identifiable {
        let id: String
        let category: String
        let name: String
        let brand: String?
        let color: String?
        let finish: String?
        let supplier: String?
        let imageUrl: String?
        let price: Double?
    }

    struct FurnitureItem: Codable, Identifiable {
        let id: String
        let name: String
        let brand: String?
        let dimensions: String?
        let quantity: Int
        let supplier: String?
        let imageUrl: String?
        let price: Double?
        let space: String?
    }

    struct ApprovalItem: Codable, Identifiable {
        let id: String
        let itemLabel: String
        let status: String
        let clientName: String?
        let note: String?
        let respondedAt: String?
    }

    struct CommentItem: Codable, Identifiable {
        let id: String
        let authorName: String
        let authorType: String
        let message: String
        let refLabel: String?
        let status: String
        let createdAt: String
    }

    // The link the client opens — what "Send to Client" shares.
    var clientLink: URL? {
        guard let token, !token.isEmpty else { return nil }
        return portalOrigin.appendingPathComponent("p/\(token)")
    }
}

// Visual journey stages shown on the client page timeline (ProjectStage enum).
let projectStages = [
    "CONCEPT", "DESIGN", "VISUALIZATION", "TECHNICAL_DRAWINGS",
    "BOQ", "PRICING", "APPROVAL", "HANDOVER",
]

func formattedISODate(_ iso: String?) -> String? {
    guard let iso else { return nil }
    let parser = ISO8601DateFormatter()
    parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let date = parser.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else { return nil }
    // Follows the in-app language, not the phone's, so the toggle covers dates too.
    return date.formatted(
        Date.FormatStyle(date: .abbreviated, time: .shortened, locale: AppLanguage.current.locale)
    )
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
