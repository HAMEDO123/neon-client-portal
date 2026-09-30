import Foundation

// Mirrors src/lib/constants.ts — the enum values the website's Overview form
// offers. Pipeline labels come from ProjectPipelineStyle.label (Home's
// HomePipeline words), stages from projectStageLabel; both read the Arabic
// from Localizable.strings, which carries every one of these.

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
