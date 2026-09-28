import Foundation

// Everything the Projects area asks the server, through the registry routes
// (src/lib/mobile/registry/projects.ts). See ios/ARCHITECTURE.md §1.

extension APIClient {
    // MARK: - Reads

    func fetchProjectsList() async throws -> Loaded<ProjectsListResponse> {
        #if DEBUG
        if Self.uiTestMode { return Loaded(value: .preview, cachedAt: nil) }
        #endif
        return try await read("projects/list", as: ProjectsListResponse.self)
    }

    func fetchProjectDetail(id: String) async throws -> Loaded<ProjectDetail> {
        try await read("projects/detail", ["id": id], as: ProjectDetail.self)
    }

    func fetchProjectAnalytics(id: String) async throws -> Loaded<ProjectAnalytics> {
        try await read("projects/analytics", ["id": id], as: ProjectAnalytics.self)
    }

    func fetchSellers() async throws -> Loaded<[ProjectSeller]> {
        try await read("projects/sellers", as: [ProjectSeller].self)
    }

    // MARK: - Overview, publishing, the client link

    /// The new-project form. Returns the redirect path ("/admin/projects/<id>")
    /// so the caller can navigate straight to the new project.
    @discardableResult
    func createProject(fields: [String: String]) async throws -> String? {
        let outcome = try await perform("projects/create", form: fields)
        return outcome.redirect
    }

    /// The full overview edit — every field, matching the website form's own
    /// semantics (an empty string clears an optional column). `coverImage`
    /// replaces the cover; `removeCover` clears it when no new image is given.
    func updateProject(id: String, fields: [String: String], coverImage: UploadFile?, removeCover: Bool) async throws {
        var form = fields
        if removeCover { form["removeCoverImage"] = "on" }
        try await performUpload(
            "projects/update",
            args: [id],
            fields: form,
            files: coverImage.map { [UploadFile(field: "coverImage", filename: $0.filename, mimeType: $0.mimeType, data: $0.data)] } ?? []
        )
    }

    func updateProjectSettings(id: String, fields: [String: Bool]) async throws {
        var form: [String: Any] = [:]
        for (key, on) in fields where on { form[key] = "on" }
        try await perform("projects/updateSettings", args: [id], form: form)
    }

    func setPublishState(id: String, state: String) async throws {
        try await perform("projects/publish", args: [id, state])
    }

    func regenerateProjectLink(id: String) async throws {
        try await perform("projects/regenerateLink", args: [id])
    }

    func notifyClientSent(id: String, kind: String) async throws {
        try await perform("projects/notifyClient", args: [id, kind])
    }

    struct WhatsAppOutcome: Decodable { let ok: Bool; let message: String }

    @discardableResult
    func sendProjectWhatsApp(id: String, kind: String) async throws -> WhatsAppOutcome? {
        let outcome = try await perform("projects/sendWhatsApp", args: [id, kind])
        return try outcome.result(WhatsAppOutcome.self)
    }

    func deleteProject(id: String) async throws {
        try await perform("projects/delete", args: [id])
    }

    // MARK: - Gallery

    func createGallerySpace(projectId: String, name: String) async throws {
        try await perform("projects/createSpace", args: [projectId], form: ["name": name])
    }

    func deleteGallerySpace(projectId: String, spaceId: String) async throws {
        try await perform("projects/deleteSpace", args: [projectId, spaceId])
    }

    /// One photo per call, as the website's own uploader does — the request
    /// body limit applies to the raw upload, before compression.
    func addGalleryImage(
        projectId: String,
        spaceId: String,
        image: UploadFile,
        caption: String?,
        isBeforeAfter: Bool = false,
        beforeImage: UploadFile? = nil,
        compress: Bool = true
    ) async throws {
        var fields: [String: String] = [:]
        if let caption, !caption.isEmpty { fields["caption"] = caption }
        if compress { fields["compress"] = "on" }
        if isBeforeAfter { fields["isBeforeAfter"] = "on" }
        var files = [UploadFile(field: "image", filename: image.filename, mimeType: image.mimeType, data: image.data)]
        if let beforeImage {
            files.append(UploadFile(field: "beforeImage", filename: beforeImage.filename, mimeType: beforeImage.mimeType, data: beforeImage.data))
        }
        try await performUpload("projects/addImage", args: [projectId, spaceId], fields: fields, files: files)
    }

    func deleteGalleryImage(projectId: String, imageId: String) async throws {
        try await perform("projects/deleteImage", args: [projectId, imageId])
    }

    func setProjectCover(projectId: String, imageUrl: String) async throws {
        try await perform("projects/setCover", args: [projectId, imageUrl])
    }

    // MARK: - Hotspots

    func createHotspot(
        projectId: String,
        imageId: String,
        xPercent: Double,
        yPercent: Double,
        label: String,
        category: String?,
        linkLabel: String?,
        description: String?
    ) async throws {
        var form: [String: Any] = ["label": label]
        if let category { form["category"] = category }
        if let linkLabel, !linkLabel.isEmpty { form["linkLabel"] = linkLabel }
        if let description, !description.isEmpty { form["description"] = description }
        try await perform("projects/createHotspot", args: [projectId, imageId, xPercent, yPercent], form: form)
    }

    func deleteHotspot(projectId: String, hotspotId: String) async throws {
        try await perform("projects/deleteHotspot", args: [projectId, hotspotId])
    }
}
