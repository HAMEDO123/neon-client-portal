#if DEBUG
import SwiftUI

/// This area's screens for the debug router (App/DebugScreens.swift):
/// `-neonScreen <id>` opens one straight from launch, for screenshots.
/// Every section is opened on the first real project (`DebugAsync`), wrapped
/// in a `NeonScroll` the way `ProjectDetailView` (Projects area) hosts it —
/// the section itself carries no page chrome of its own. An "Add" sheet is
/// pushed as its own screen too, since a sheet can be shown as a screen.
///
/// The `projectfiles-*-fixture` screens are the exception: the BOQ and
/// Pricing tabs with their files, drawn from the fixed answers in
/// `ProjectFilesFixtures` and reading nothing, so they can be shot with
/// `-uiTestMode` and no sign-in. The `-file-add` sheets need no data at all.
enum ProjectFilesScreens {
    static let ids: [String] = [
        "pf-drawings", "pf-drawings-add", "pf-drawings-revision",
        "pf-documents", "pf-documents-add",
        "pf-boq", "pf-boq-add",
        "pf-pricing", "pf-pricing-add",
        "pf-materials", "pf-materials-add",
        "pf-furniture", "pf-furniture-add",
        "pf-approvals", "pf-approvals-add",
        "pf-comments",
        "projectfiles-pricing-files-fixture", "projectfiles-pricing-files-only-fixture",
        "projectfiles-boq-files-fixture", "projectfiles-boq-files-only-fixture",
        "projectfiles-pricing-file-add", "projectfiles-pricing-file-add-hidden", "projectfiles-boq-file-add",
    ]

    private static func firstProjectId() async throws -> String? {
        try await APIClient.shared.fetchProjectsList().value.projects.first?.id
    }

    @MainActor static func view(_ id: String) -> AnyView? {
        switch id {
        // Files and line items, pricing shown to the client.
        case "projectfiles-pricing-files-fixture":
            return debugPushed(NeonScroll { ProjectPricingSection(projectId: "fx-project", preview: ProjectFilesFixtures.pricing) })
        // Priced by a file alone, with pricing hidden: no "No pricing yet",
        // and the hidden note still shows, because the file is hidden too.
        case "projectfiles-pricing-files-only-fixture":
            return debugPushed(NeonScroll { ProjectPricingSection(projectId: "fx-project", preview: ProjectFilesFixtures.pricingFileOnly) })
        case "projectfiles-boq-files-fixture":
            return debugPushed(NeonScroll { ProjectBoqSection(projectId: "fx-project", preview: ProjectFilesFixtures.boq) })
        case "projectfiles-boq-files-only-fixture":
            return debugPushed(NeonScroll { ProjectBoqSection(projectId: "fx-project", preview: ProjectFilesFixtures.boqFileOnly) })
        case "projectfiles-pricing-file-add":
            return debugPushed(AddTabFileSheet(projectId: "fx-project", kind: .pricing, pricingShown: true) {})
        case "projectfiles-pricing-file-add-hidden":
            return debugPushed(AddTabFileSheet(projectId: "fx-project", kind: .pricing, pricingShown: false) {})
        case "projectfiles-boq-file-add":
            return debugPushed(AddTabFileSheet(projectId: "fx-project", kind: .boq) {})
        case "pf-drawings":
            return debugPushed(DebugAsync(load: firstProjectId) { id in
                NeonScroll { ProjectDrawingsSection(projectId: id) }
            })
        case "pf-drawings-add":
            return debugPushed(DebugAsync(load: firstProjectId) { id in
                AddDrawingSheet(projectId: id) {}
            })
        case "pf-drawings-revision":
            return debugPushed(DebugAsync(load: { () async throws -> (String, PFDrawing)? in
                guard let projectId = try await firstProjectId() else { return nil }
                guard let drawing = try await APIClient.shared.fetchDrawings(projectId: projectId).value.drawings.first else { return nil }
                return (projectId, drawing)
            }) { pair in
                AddRevisionSheet(projectId: pair.0, drawing: pair.1) {}
            })
        case "pf-documents":
            return debugPushed(DebugAsync(load: firstProjectId) { id in
                NeonScroll { ProjectDocumentsSection(projectId: id) }
            })
        case "pf-documents-add":
            return debugPushed(DebugAsync(load: firstProjectId) { id in
                AddDocumentSheet(projectId: id) {}
            })
        case "pf-boq":
            return debugPushed(DebugAsync(load: firstProjectId) { id in
                NeonScroll { ProjectBoqSection(projectId: id) }
            })
        case "pf-boq-add":
            return debugPushed(DebugAsync(load: firstProjectId) { id in
                AddBoqSheet(projectId: id) {}
            })
        case "pf-pricing":
            return debugPushed(DebugAsync(load: firstProjectId) { id in
                NeonScroll { ProjectPricingSection(projectId: id) }
            })
        case "pf-pricing-add":
            return debugPushed(DebugAsync(load: firstProjectId) { id in
                AddPricingSheet(projectId: id) {}
            })
        case "pf-materials":
            return debugPushed(DebugAsync(load: firstProjectId) { id in
                NeonScroll { ProjectMaterialsSection(projectId: id) }
            })
        case "pf-materials-add":
            return debugPushed(DebugAsync(load: firstProjectId) { id in
                AddMaterialSheet(projectId: id) {}
            })
        case "pf-furniture":
            return debugPushed(DebugAsync(load: firstProjectId) { id in
                NeonScroll { ProjectFurnitureSection(projectId: id) }
            })
        case "pf-furniture-add":
            return debugPushed(DebugAsync(load: firstProjectId) { id in
                AddFurnitureSheet(projectId: id) {}
            })
        case "pf-approvals":
            return debugPushed(DebugAsync(load: firstProjectId) { id in
                NeonScroll { ProjectApprovalsSection(projectId: id) }
            })
        case "pf-approvals-add":
            return debugPushed(DebugAsync(load: firstProjectId) { id in
                AddApprovalSheet(projectId: id) {}
            })
        case "pf-comments":
            return debugPushed(DebugAsync(load: firstProjectId) { id in
                NeonScroll { ProjectCommentsSection(projectId: id) }
            })
        default: return nil
        }
    }
}

/// Fixed answers for the fixture screens, decoded from JSON the way the
/// server sends it — so a field the decoder does not expect, or one it needs
/// and the JSON leaves out, fails here exactly as it would on a real read.
enum ProjectFilesFixtures {
    /// A PDF quotation and an Arabic-named spreadsheet beside three lines,
    /// one of them optional.
    static let pricing: PFPricingResponse? = decode("""
    {"showPricing":true,"total":18450,"files":[
      {"id":"fx-pf1","title":"Quotation — Villa Al Fulan","fileUrl":"/uploads/fx/quotation.pdf","fileType":"pdf",
       "fileSize":482113,"version":"v2","createdAt":"2026-10-20T09:15:00.000Z"},
      {"id":"fx-pf2","title":"عرض سعر الأثاث والإضاءة","fileUrl":"/uploads/fx/furniture-offer.xlsx","fileType":"xlsx",
       "fileSize":91234,"version":null,"createdAt":"2026-10-22T13:40:00.000Z"}
    ],"items":[
      {"id":"fx-pi1","category":"Interior Works","label":"Gypsum ceilings","description":"Ground and first floor","amount":9800,"isOptional":false},
      {"id":"fx-pi2","category":"Joinery","label":"خزائن المطبخ","description":null,"amount":8650,"isOptional":false},
      {"id":"fx-pi3","category":"Furniture","label":"Outdoor lounge set","description":null,"amount":2300,"isOptional":true}
    ]}
    """)

    /// The whole price is one PDF, and the client is not shown pricing yet.
    static let pricingFileOnly: PFPricingResponse? = decode("""
    {"showPricing":false,"total":0,"files":[
      {"id":"fx-pf1","title":"Quotation — Villa Al Fulan","fileUrl":"/uploads/fx/quotation.pdf","fileType":"pdf",
       "fileSize":482113,"version":"v2","createdAt":"2026-10-20T09:15:00.000Z"}
    ],"items":[]}
    """)

    static let boq: PFBoqResponse? = decode("""
    {"files":[
      {"id":"fx-bf1","title":"BOQ — full project","fileUrl":"/uploads/fx/boq.xlsx","fileType":"xlsx",
       "fileSize":256400,"version":"R03","createdAt":"2026-10-18T08:05:00.000Z"},
      {"id":"fx-bf2","title":"جدول كميات الكهرباء","fileUrl":"/uploads/fx/electrical-boq.pdf","fileType":"pdf",
       "fileSize":1384220,"version":"v1","createdAt":"2026-10-21T16:30:00.000Z"}
    ],"items":[
      {"id":"fx-bi1","category":"Flooring","name":"Porcelain flooring","description":null,"specification":"60×120 matt","unit":"m²",
       "quantity":184,"unitPrice":22,"imageUrl":null,"relatedDrawing":"A-102","relatedSpace":"Living room","notes":null},
      {"id":"fx-bi2","category":"Paint","name":"دهان جدران","description":null,"specification":null,"unit":"m²",
       "quantity":420.5,"unitPrice":null,"imageUrl":null,"relatedDrawing":null,"relatedSpace":"Bedrooms","notes":null}
    ]}
    """)

    /// The whole BOQ is one spreadsheet, with no items at all.
    static let boqFileOnly: PFBoqResponse? = decode("""
    {"files":[
      {"id":"fx-bf1","title":"BOQ — full project","fileUrl":"/uploads/fx/boq.xlsx","fileType":"xlsx",
       "fileSize":256400,"version":"R03","createdAt":"2026-10-18T08:05:00.000Z"}
    ],"items":[]}
    """)

    private static func decode<T: Decodable>(_ json: String) -> T? {
        try? JSONDecoder().decode(T.self, from: Data(json.utf8))
    }
}
#endif
