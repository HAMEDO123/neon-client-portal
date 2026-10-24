import SwiftUI

// The BOQ or the price as a file — a spreadsheet, a PDF the studio already
// has — on the BOQ and Pricing tabs, above their items. On the server both
// are a `Document` (category "BOQ" or "Pricing"), so a file added here also
// shows under Documents; it is drawn here because this is where somebody
// looks for "the BOQ" or "the price", and adding it one line at a time is
// useless when it already exists as one file.
//
// The two tabs differ in exactly one thing, and it is what the client sees:
// a pricing file obeys `showPricing` like the line items do, while a BOQ file
// is the client's as it is — the quantity and price switches leave columns
// out of the items table, and nothing can leave a column out of somebody's
// spreadsheet. So each says its own rule where the file is added.

enum PFTabFileKind {
    case boq, pricing

    var section: PFSection { self == .boq ? .boq : .pricing }

    var sheetTitle: String { self == .boq ? L("Add BOQ File") : L("Add Pricing File") }

    var titlePrompt: String { self == .boq ? L("e.g. Full BOQ") : L("e.g. Quotation") }

    /// The one line under "Files", so the rule is on the tab and not only
    /// in the sheet somebody has already decided to open.
    var headerSubtitle: String {
        self == .boq
            ? L("The client sees each file exactly as it is.")
            : L("The client sees these only while pricing is shown.")
    }
}

/// "Files", its add capsule, and one row per file. With no files it is the
/// heading and the capsule alone — an empty card here, above the tab's own
/// empty state, read as two cards saying there was nothing.
struct PFTabFilesBlock: View {
    let kind: PFTabFileKind
    let files: [PFTabFile]
    let onAdd: () -> Void
    let onDelete: (PFTabFile) -> Void

    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(alignment: .leading, spacing: NeonSpace.sm) {
            SectionHeader(L("Files"), subtitle: kind.headerSubtitle, count: files.isEmpty ? nil : files.count) {
                ViewAllButton(L("Add a file"), hue: kind.section.hue, chevron: false, action: onAdd)
            }

            if !files.isEmpty {
                CardList(files) { file in
                    row(file)
                }
                .neonAppear()
            }
        }
    }

    private func row(_ file: PFTabFile) -> some View {
        let url = resolvedMediaURL(file.fileUrl)
        return ListRow(
            file.title,
            subtitle: [file.version, file.fileType.uppercased()].compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: " · "),
            meta: [file.fileSize.map { byteCount($0) }, pfFileDay(file.createdAt)].compactMap { $0 }.joined(separator: " · "),
            leading: .icon(pfFileSymbol(file.fileType), tint: kind.section.hue.deep)
        ) {
            HStack(spacing: 4) {
                // The same open the Documents tab uses: the file's own URL,
                // handed to the system, which shows a PDF or offers to save
                // a spreadsheet — no viewer of our own to keep in step.
                if let url {
                    IconButton("arrow.up.forward.square", label: L("Open file"), look: .plain, tint: .neonTextSecondary, size: NeonSize.touch) {
                        openURL(url)
                    }
                }
                IconButton("trash", label: L("Delete"), look: .plain, tint: .neonDangerStrong, size: NeonSize.touch) {
                    onDelete(file)
                }
            }
        }
        // The whole row opens the file too: it is what a file in a list is
        // tapped for, and the small icon alone is an easy target to miss.
        .contentShape(Rectangle())
        .onTapGesture { if let url { Haptic.tap(); openURL(url) } }
    }
}

/// A glyph for what the file is, so a PDF and a spreadsheet are told apart
/// at a glance. `fileType` is the stored extension ("pdf", "xlsx").
func pfFileSymbol(_ fileType: String) -> String {
    switch fileType.lowercased() {
    case "pdf": return "doc.richtext"
    case "xls", "xlsx", "csv", "numbers": return "tablecells"
    case "jpg", "jpeg", "png", "heic", "webp": return "photo"
    case "zip": return "doc.zipper"
    default: return "doc"
    }
}

/// The day a file was added, without the time: a row's meta line has the
/// size beside it and no room for both.
func pfFileDay(_ iso: String) -> String? {
    let parser = ISO8601DateFormatter()
    parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let date = parser.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else { return nil }
    return date.formatted(Date.FormatStyle(date: .abbreviated, time: .omitted, locale: AppLanguage.current.locale))
}

/// Adding a BOQ or pricing file: the file, and an optional title and
/// version. The title may be left empty because the server names the file
/// after itself then — a BOQ file is usually already called what it is.
struct AddTabFileSheet: View {
    let projectId: String
    let kind: PFTabFileKind
    /// Whether the client is shown pricing right now; only the pricing
    /// sheet reads it, to say what adding this file does today.
    var pricingShown = true
    let onSaved: () -> Void

    @EnvironmentObject private var api: APIClient
    @Environment(\.dismiss) private var dismiss

    @State private var title = ""
    @State private var version = ""
    @State private var file: UploadFile?
    @State private var error: String?

    var body: some View {
        SheetScaffold(kind.sheetTitle, symbol: kind.section.symbol, primaryTitle: L("Add File"), isPrimaryEnabled: file != nil) {
            await save()
        } content: {
            FormSection {
                FilePickerField(label: L("File"), file: $file)
                NeonTextField(L("Title"), text: $title, prompt: kind.titlePrompt, hint: L("Leave it empty to use the file's own name."))
                NeonTextField(L("Version"), text: $version, prompt: L("v1"))
                // Said here, before the file goes up, because this is the
                // only moment it can still change what somebody does.
                clientNote
                if let error { ValidationMessage(error) }
            }
        }
        .neonSheet([.medium, .large])
    }

    @ViewBuilder
    private var clientNote: some View {
        switch kind {
        case .boq:
            StatusNote(
                symbol: "eye",
                tone: .warning,
                title: L("The client sees this file exactly as it is"),
                detail: L("The quantity and price switches hide columns of the items list only. Nothing can hide a column inside a spreadsheet or a PDF.")
            )
        case .pricing:
            StatusNote(
                symbol: pricingShown ? "eye" : "eye.slash",
                tone: pricingShown ? .info : .warning,
                title: L("The client sees this only while pricing is shown"),
                detail: pricingShown
                    ? L("Pricing is shown to the client now, so they can open this file as soon as it is added.")
                    : L("Pricing is hidden from the client now, so only your team sees this file until it is shown.")
            )
        }
    }

    private func save() async {
        guard let file else { return }
        do {
            switch kind {
            case .boq: try await api.addBoqFile(projectId: projectId, title: title, version: version, file: file)
            case .pricing: try await api.addPricingFile(projectId: projectId, title: title, version: version, file: file)
            }
            dismiss()
            onSaved()
        } catch {
            self.error = error.localizedDescription
            Toast.error(error)
        }
    }
}
