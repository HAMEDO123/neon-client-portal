import SwiftUI

/// Narrows the project list by pipeline status and journey stage, alongside
/// the publish-state filter the list already offers. Applied live — there is
/// nothing to save — from the same nine pipeline values and eight stages the
/// Overview edit sheet offers, each with how many projects it holds now.
struct ProjectFilterSheet: View {
    @Binding var pipelineFilter: String?
    @Binding var stageFilter: String?
    /// The list as loaded, for the counts beside each choice.
    var projects: [ProjectSummary] = []

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        SheetScaffold(
            L("Filter Projects"),
            subtitle: projects.isEmpty ? nil : projectPlural(
                projects.count, one: "%d of %d project shown", other: "%d of %d projects shown",
                arguments: [matching, projects.count]
            ),
            symbol: "line.3.horizontal.decrease.circle",
            primaryTitle: L("Show Results"),
            onPrimary: { dismiss() }
        ) {
            // Colour here means pipeline status only — the same dot as on
            // the list's bar and the cards. Archived is set apart by its
            // symbol, not by a grey it would share with Draft.
            FormSection(L("Pipeline Status")) {
                FlowRow(spacing: NeonSpace.sm) {
                    Chip(L("All"), isSelected: pipelineFilter == nil) {
                        withNeonAnimation(NeonMotion.snappy) { pipelineFilter = nil }
                    }
                    ForEach(ProjectConstants.pipelineStatuses, id: \.self) { status in
                        ProjectFilterChoice(
                            title: ProjectPipelineStyle.label(status),
                            hue: ProjectPipelineStyle.hue(status),
                            symbol: status == "ARCHIVED" ? "archivebox" : nil,
                            count: projects.isEmpty ? nil : projects.filter { $0.pipelineStatus == status }.count,
                            isSelected: pipelineFilter == status
                        ) {
                            withNeonAnimation(NeonMotion.snappy) { pipelineFilter = pipelineFilter == status ? nil : status }
                        }
                    }
                }
            }

            // The journey's stages carry no colour of their own (they have
            // none anywhere else): numbered, in order.
            FormSection(L("Journey Stage")) {
                FlowRow(spacing: NeonSpace.sm) {
                    Chip(L("All"), isSelected: stageFilter == nil) {
                        withNeonAnimation(NeonMotion.snappy) { stageFilter = nil }
                    }
                    ForEach(Array(ProjectConstants.projectStages.enumerated()), id: \.element) { index, stage in
                        Chip(
                            projectStageLabel(stage),
                            symbol: "\(index + 1).circle",
                            isSelected: stageFilter == stage,
                            count: projects.isEmpty ? nil : projects.filter { $0.currentStage == stage }.count
                        ) {
                            withNeonAnimation(NeonMotion.snappy) { stageFilter = stageFilter == stage ? nil : stage }
                        }
                    }
                }
            }

            if pipelineFilter != nil || stageFilter != nil {
                NeonButton(L("Clear Filters"), symbol: "xmark.circle", kind: .secondary, size: .medium) {
                    Haptic.tap()
                    withNeonAnimation(NeonMotion.snappy) {
                        pipelineFilter = nil
                        stageFilter = nil
                    }
                }
                .frame(maxWidth: .infinity)
                .transition(.neonPop)
            }
        }
        .neonSheet([.medium, .large])
    }

    /// How many projects the two choices here leave (the publish state and
    /// search on the list narrow it further).
    private var matching: Int {
        projects.filter { project in
            (pipelineFilter == nil || project.pipelineStatus == pipelineFilter)
                && (stageFilter == nil || project.currentStage == stageFilter)
        }.count
    }
}

/// A choice with a colour dot (or a symbol) and a count; chosen, it fills
/// with its colour.
private struct ProjectFilterChoice: View {
    let title: String
    let hue: NeonHue
    var symbol: String?
    let count: Int?
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button {
            Haptic.selection()
            action()
        } label: {
            HStack(spacing: 6) {
                if let symbol {
                    Image(systemName: symbol)
                        .font(.system(size: 12, weight: .semibold))
                } else {
                    Circle()
                        .fill(isSelected ? Color.white : hue.color)
                        .frame(width: 8, height: 8)
                }
                Text(title)
                    .lineLimit(1)
                if let count {
                    Text(NeonFormat.integer(count))
                        .font(.system(.caption2, weight: .bold))
                        .monospacedDigit()
                        .padding(.horizontal, 6)
                        .frame(minWidth: 18, minHeight: 18)
                        .background(Capsule().fill(isSelected ? Color.white.opacity(0.25) : Color.neonInk.opacity(0.07)))
                }
            }
            .font(.system(.subheadline, weight: isSelected ? .semibold : .medium))
            .foregroundStyle(isSelected ? Color.white : Color.neonInk.opacity(count == 0 ? 0.45 : 0.8))
            .padding(.horizontal, 12)
            .frame(minHeight: 36)
            .background {
                if isSelected {
                    // Grey is too pale to carry white text; it selects in the accent.
                    Capsule().fill(hue == .grey ? LinearGradient.neonAccent : hue.fill)
                        .shadow(color: (hue == .grey ? Color.neonAccent : hue.color).opacity(0.3), radius: 4, x: 0, y: 2)
                } else {
                    Capsule().fill(Color.white)
                        .overlay(Capsule().strokeBorder(Color.neonLine, lineWidth: 1))
                }
            }
            .contentShape(Capsule())
        }
        .buttonStyle(PressableStyle(scale: 0.95))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}
