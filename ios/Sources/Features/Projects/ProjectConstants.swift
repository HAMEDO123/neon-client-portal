import Foundation

// Mirrors src/lib/constants.ts — the enum values the website's Overview form
// offers. Labels come from localizedEnum("pipeline"/"stage", raw), which
// already carries every one of these in Localizable.strings.

enum ProjectConstants {
    static let publishStates = ["DRAFT", "PUBLISHED", "ARCHIVED"]
    static let pipelineStatuses = [
        "DRAFT", "INTERNAL_REVIEW", "SENT_TO_CLIENT", "CLIENT_REVIEWING",
        "CHANGES_REQUESTED", "APPROVED", "EXECUTION", "COMPLETED", "ARCHIVED",
    ]
    static let projectStages = [
        "CONCEPT", "DESIGN", "VISUALIZATION", "TECHNICAL_DRAWINGS",
        "BOQ", "PRICING", "APPROVAL", "HANDOVER",
    ]
    static let hotspotCategories = ["Material", "Furniture", "Lighting", "Drawing", "Note"]
}
