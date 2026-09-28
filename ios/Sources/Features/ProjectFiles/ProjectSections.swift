import SwiftUI

// The project tabs the projectfiles area builds. ProjectDetailView (projects
// area) shows each of these for the project it has open; the names and the
// `projectId` initialiser are the contract between the two areas.

struct ProjectDrawingsSection: View {
    let projectId: String
    var body: some View { FeaturePending(title: L("Drawings"), inline: true) }
}

struct ProjectDocumentsSection: View {
    let projectId: String
    var body: some View { FeaturePending(title: L("Documents"), inline: true) }
}

struct ProjectBoqSection: View {
    let projectId: String
    var body: some View { FeaturePending(title: L("BOQ"), inline: true) }
}

struct ProjectPricingSection: View {
    let projectId: String
    var body: some View { FeaturePending(title: L("Pricing"), inline: true) }
}

struct ProjectMaterialsSection: View {
    let projectId: String
    var body: some View { FeaturePending(title: L("Materials"), inline: true) }
}

struct ProjectFurnitureSection: View {
    let projectId: String
    var body: some View { FeaturePending(title: L("Furniture"), inline: true) }
}

struct ProjectApprovalsSection: View {
    let projectId: String
    var body: some View { FeaturePending(title: L("Approvals"), inline: true) }
}

struct ProjectCommentsSection: View {
    let projectId: String
    var body: some View { FeaturePending(title: L("Comments"), inline: true) }
}
