import Foundation

// The projectfiles area's calls into the registry routes
// (src/lib/mobile/registry/projectfiles.ts). One read and a handful of
// actions per tab, all scoped to a project by its id.

extension APIClient {
    // MARK: Reads

    func fetchDrawings(projectId: String) async throws -> Loaded<PFDrawingsResponse> {
        try await read("projectfiles/drawings", ["projectId": projectId])
    }

    func fetchDocuments(projectId: String) async throws -> Loaded<PFDocumentsResponse> {
        try await read("projectfiles/documents", ["projectId": projectId])
    }

    func fetchBoq(projectId: String) async throws -> Loaded<PFBoqResponse> {
        try await read("projectfiles/boq", ["projectId": projectId])
    }

    func fetchPricing(projectId: String) async throws -> Loaded<PFPricingResponse> {
        try await read("projectfiles/pricing", ["projectId": projectId])
    }

    func fetchMaterials(projectId: String) async throws -> Loaded<PFMaterialsResponse> {
        try await read("projectfiles/materials", ["projectId": projectId])
    }

    func fetchFurniture(projectId: String) async throws -> Loaded<PFFurnitureResponse> {
        try await read("projectfiles/furniture", ["projectId": projectId])
    }

    func fetchApprovals(projectId: String) async throws -> Loaded<PFApprovalsResponse> {
        try await read("projectfiles/approvals", ["projectId": projectId])
    }

    func fetchProjectComments(projectId: String) async throws -> Loaded<PFCommentsResponse> {
        try await read("projectfiles/comments", ["projectId": projectId])
    }

    // MARK: Drawings

    func createDrawing(
        projectId: String, category: String, subCategory: String, name: String,
        drawingNumber: String, revision: String, file: UploadFile
    ) async throws {
        try await performUpload(
            "projectfiles/createDrawing", args: [projectId],
            fields: [
                "category": category, "subCategory": subCategory, "name": name,
                "drawingNumber": drawingNumber, "revision": revision,
            ],
            files: [file]
        )
    }

    func addDrawingRevision(projectId: String, drawingId: String, revision: String, note: String, file: UploadFile) async throws {
        try await performUpload(
            "projectfiles/addDrawingRevision", args: [projectId, drawingId],
            fields: ["revision": revision, "note": note], files: [file]
        )
    }

    func deleteRevision(projectId: String, id: String) async throws {
        try await perform("projectfiles/deleteRevision", args: [projectId, id])
    }

    func deleteDrawing(projectId: String, id: String) async throws {
        try await perform("projectfiles/deleteDrawing", args: [projectId, id])
    }

    // MARK: Documents

    func createDocument(projectId: String, category: String, title: String, version: String, file: UploadFile) async throws {
        try await performUpload(
            "projectfiles/createDocument", args: [projectId],
            fields: ["category": category, "title": title, "version": version], files: [file]
        )
    }

    func deleteDocument(projectId: String, id: String) async throws {
        try await perform("projectfiles/deleteDocument", args: [projectId, id])
    }

    // MARK: BOQ

    func createBoqItem(
        projectId: String, category: String, name: String, description: String, specification: String,
        unit: String, quantity: Double, unitPrice: Double?, relatedDrawing: String, relatedSpace: String,
        notes: String, image: UploadFile?
    ) async throws {
        var fields: [String: String] = [
            "category": category, "name": name, "description": description, "specification": specification,
            "unit": unit, "quantity": String(quantity), "relatedDrawing": relatedDrawing,
            "relatedSpace": relatedSpace, "notes": notes,
        ]
        if let unitPrice { fields["unitPrice"] = String(unitPrice) }
        try await performUpload("projectfiles/createBoqItem", args: [projectId], fields: fields, files: image.map { [$0] } ?? [])
    }

    func deleteBoqItem(projectId: String, id: String) async throws {
        try await perform("projectfiles/deleteBoqItem", args: [projectId, id])
    }

    // MARK: Pricing

    func createPricingItem(projectId: String, category: String, label: String, description: String, amount: Double, isOptional: Bool) async throws {
        var fields: [String: Any] = ["category": category, "label": label, "description": description, "amount": String(amount)]
        if isOptional { fields["isOptional"] = "on" }
        try await perform("projectfiles/createPricingItem", args: [projectId], form: fields)
    }

    func deletePricingItem(projectId: String, id: String) async throws {
        try await perform("projectfiles/deletePricingItem", args: [projectId, id])
    }

    // MARK: Materials

    func createMaterial(
        projectId: String, category: String, name: String, brand: String, model: String, color: String,
        finish: String, supplier: String, estimatedQty: String, price: Double?, relatedSpaces: String, image: UploadFile?
    ) async throws {
        var fields: [String: String] = [
            "category": category, "name": name, "brand": brand, "model": model, "color": color,
            "finish": finish, "supplier": supplier, "estimatedQty": estimatedQty, "relatedSpaces": relatedSpaces,
        ]
        if let price { fields["price"] = String(price) }
        try await performUpload("projectfiles/createMaterial", args: [projectId], fields: fields, files: image.map { [$0] } ?? [])
    }

    func deleteMaterial(projectId: String, id: String) async throws {
        try await perform("projectfiles/deleteMaterial", args: [projectId, id])
    }

    // MARK: Furniture

    func createFurnitureItem(
        projectId: String, name: String, space: String, quantity: Int, brand: String, model: String,
        dimensions: String, finish: String, supplier: String, price: Double?, image: UploadFile?
    ) async throws {
        var fields: [String: String] = [
            "name": name, "space": space, "quantity": String(quantity), "brand": brand, "model": model,
            "dimensions": dimensions, "finish": finish, "supplier": supplier,
        ]
        if let price { fields["price"] = String(price) }
        try await performUpload("projectfiles/createFurnitureItem", args: [projectId], fields: fields, files: image.map { [$0] } ?? [])
    }

    func deleteFurnitureItem(projectId: String, id: String) async throws {
        try await perform("projectfiles/deleteFurnitureItem", args: [projectId, id])
    }

    // MARK: Approvals

    func createApproval(projectId: String, itemLabel: String) async throws {
        try await perform("projectfiles/createApproval", args: [projectId], form: ["itemLabel": itemLabel])
    }

    func deleteApproval(projectId: String, id: String) async throws {
        try await perform("projectfiles/deleteApproval", args: [projectId, id])
    }

    // MARK: Comments

    func resolveComment(projectId: String, id: String, status: String) async throws {
        try await perform("projectfiles/resolveComment", args: [projectId, id, status])
    }

    func deleteComment(projectId: String, id: String) async throws {
        try await perform("projectfiles/deleteComment", args: [projectId, id])
    }

    func replyToComment(projectId: String, message: String, refLabel: String?) async throws {
        try await perform("projectfiles/replyToComment", args: [projectId, message, refLabel ?? NSNull()])
    }
}
