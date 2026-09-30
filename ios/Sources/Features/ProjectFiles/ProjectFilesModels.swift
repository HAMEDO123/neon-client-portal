import Foundation

// What each "projectfiles/…" read answers (src/lib/mobile/registry/projectfiles.ts).
// Field names, nesting and optionality mirror the Prisma models exactly —
// see prisma/schema.prisma: Drawing, DrawingRevision, Document, BoqItem,
// PricingItem, Material, FurnitureItem, Approval, Comment.

struct PFDrawing: Codable, Identifiable, Equatable {
    let id: String
    let category: String
    let subCategory: String?
    let name: String
    let drawingNumber: String?
    let revision: String
    let fileUrl: String
    let fileType: String
    let fileSize: Int?
    let createdAt: String
    let revisions: [PFDrawingRevision]
}

struct PFDrawingRevision: Codable, Identifiable, Equatable {
    let id: String
    let revision: String
    let note: String?
    let fileUrl: String
    let createdAt: String
}

struct PFDocument: Codable, Identifiable, Equatable {
    let id: String
    let category: String
    let title: String
    let fileUrl: String
    let fileType: String
    let fileSize: Int?
    let version: String?
    let createdAt: String
}

struct PFBoqItem: Codable, Identifiable, Equatable {
    let id: String
    let category: String
    let name: String
    let description: String?
    let specification: String?
    let unit: String
    let quantity: Double
    let unitPrice: Double?
    let imageUrl: String?
    let relatedDrawing: String?
    let relatedSpace: String?
    let notes: String?
}

struct PFPricingItem: Codable, Identifiable, Equatable {
    let id: String
    let category: String
    let label: String
    let description: String?
    let amount: Double
    let isOptional: Bool
}

struct PFMaterial: Codable, Identifiable, Equatable {
    let id: String
    let category: String
    let name: String
    let brand: String?
    let model: String?
    let color: String?
    let finish: String?
    let specification: String?
    let supplier: String?
    let reference: String?
    let imageUrl: String?
    let estimatedQty: String?
    let price: Double?
    let relatedSpaces: String?
}

struct PFFurnitureItem: Codable, Identifiable, Equatable {
    let id: String
    let name: String
    let brand: String?
    let model: String?
    let dimensions: String?
    let quantity: Int
    let finish: String?
    let supplier: String?
    let reference: String?
    let imageUrl: String?
    let price: Double?
    let space: String?
}

struct PFApproval: Codable, Identifiable, Equatable {
    let id: String
    let itemLabel: String
    let status: String
    let clientName: String?
    let note: String?
    let respondedAt: String?
    let createdAt: String
}

struct PFComment: Codable, Identifiable, Equatable {
    let id: String
    let authorName: String
    let authorType: String
    let message: String
    let refLabel: String?
    let status: String
    let createdAt: String
}

// MARK: - Read envelopes

struct PFDrawingsResponse: Codable { let drawings: [PFDrawing] }
struct PFDocumentsResponse: Codable { let documents: [PFDocument] }
struct PFBoqResponse: Codable { let items: [PFBoqItem] }
struct PFPricingResponse: Codable { let showPricing: Bool; let total: Double; let items: [PFPricingItem] }
struct PFMaterialsResponse: Codable { let materials: [PFMaterial] }
struct PFFurnitureResponse: Codable { let furniture: [PFFurnitureItem] }
struct PFApprovalsResponse: Codable { let approvals: [PFApproval] }
struct PFCommentsResponse: Codable { let comments: [PFComment] }

// MARK: - The web's own category lists (src/lib/constants.ts)

enum PFCategories {
    static let drawing = ["Architectural", "Ceiling", "Electrical", "HVAC", "Plumbing", "Joinery"]
    static let document = ["Contracts", "Drawings", "BOQ", "Pricing", "Specifications", "Approvals", "Reports", "Other"]
    static let boq = [
        "Flooring", "Walls", "Ceiling", "Paint", "Gypsum", "Joinery", "Doors", "Windows",
        "Sanitary", "Lighting", "Electrical", "HVAC", "Furniture", "Accessories", "Other",
    ]
    static let material = ["Marble", "Wood", "Fabric", "Paint", "Metal", "Lighting", "Tiles", "Other"]
    static let pricing = ["Interior Works", "Electrical", "HVAC", "Joinery", "Furniture", "Other"]
}

// A milestone the client hasn't answered is asked, not yet answered — never
// a verdict, and never worded or coloured like one (the platform-wide rule:
// silence is never a verdict). It used to read "Pending Review" in warning
// amber, which sounds like somebody is reviewing it and makes the client's
// silence look like a problem.
func approvalStatusLabel(_ status: String) -> String {
    switch status {
    case "APPROVED": return L("Approved")
    case "CHANGES_REQUESTED": return L("Changes Requested")
    default: return L("Waiting for the client")
    }
}

func approvalStatusTone(_ status: String) -> BadgeTone {
    switch status {
    case "APPROVED": return .success
    case "CHANGES_REQUESTED": return .orange
    default: return .info
    }
}
