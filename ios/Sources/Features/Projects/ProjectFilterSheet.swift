import SwiftUI

/// Narrows the project list by pipeline status and journey stage, alongside
/// the publish-state chips the list already offers. Applied live — there is
/// nothing to save, so the sheet is just a place to pick from the same nine
/// pipeline values and eight stages the Overview edit sheet offers.
struct ProjectFilterSheet: View {
    @Binding var pipelineFilter: String?
    @Binding var stageFilter: String?

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        SheetScaffold(
            L("Filter Projects"),
            symbol: "line.3.horizontal.decrease.circle",
            primaryTitle: L("Show Results"),
            onPrimary: { dismiss() }
        ) {
            FormSection(L("Pipeline")) {
                MenuField(
                    L("Pipeline Status"), selection: $pipelineFilter, options: ProjectConstants.pipelineStatuses,
                    title: { localizedEnum("pipeline", $0) }, noneTitle: L("All")
                )
                MenuField(
                    L("Journey Stage"), selection: $stageFilter, options: ProjectConstants.projectStages,
                    title: { localizedEnum("stage", $0) }, noneTitle: L("All")
                )
            }

            if pipelineFilter != nil || stageFilter != nil {
                NeonButton(L("Clear Filters"), kind: .ghost, size: .medium) {
                    Haptic.tap()
                    withNeonAnimation(NeonMotion.snappy) {
                        pipelineFilter = nil
                        stageFilter = nil
                    }
                }
            }
        }
        .neonSheet([.medium, .large])
    }
}
