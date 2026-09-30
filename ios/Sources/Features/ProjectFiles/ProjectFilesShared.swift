import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

// Small pieces every project-files sheet reuses: picking a file of any kind
// (drawings, documents — the web's "PDF, images, DWG…"), and picking a
// reference photo (BOQ, materials, furniture). `UploadMaker` (ios/Sources/UI)
// does the reading; these just give it a labelled control and rename the
// field to match what each server action's `formData.get(...)` expects.

func refield(_ file: UploadFile, _ field: String) -> UploadFile {
    UploadFile(field: field, filename: file.filename, mimeType: file.mimeType, data: file.data)
}

/// "File" with a Choose button; shows the picked name once there is one.
struct FilePickerField: View {
    let label: String
    @Binding var file: UploadFile?
    var isRequired = true
    @State private var showPicker = false
    @State private var error: String?

    var body: some View {
        FormField(label, isRequired: isRequired, error: error) {
            Button {
                Haptic.tap()
                showPicker = true
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: file == nil ? "doc.badge.plus" : "doc.fill")
                        .foregroundStyle(file == nil ? Color.neonInk.opacity(0.35) : Color.neonPurpleStrong)
                        .frame(width: 20)
                    if let file {
                        DirText(file.filename, font: .system(size: 15), color: .neonInk, fill: false, lineLimit: 1)
                    } else {
                        Text(L("Choose a file"))
                            .font(.system(size: 15))
                            .foregroundStyle(Color.neonTextFaint)
                    }
                    Spacer(minLength: 0)
                    if file != nil {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(Color.neonTextFaint)
                            .onTapGesture { file = nil }
                    }
                }
                .fieldChrome()
            }
            .buttonStyle(.plain)
        }
        .fileImporter(isPresented: $showPicker, allowedContentTypes: UploadMaker.documentTypes) { result in
            switch result {
            case .success(let url):
                if let made = UploadMaker.file(url, field: "file") {
                    file = made
                    error = nil
                } else {
                    error = L("That file could not be read.")
                }
            case .failure:
                break
            }
        }
    }
}

/// A square reference photo, with a picker and a clear button. Wrapped in
/// `FormField` so its label matches every other field in the sheet (it used
/// to draw its own 13pt medium label, one weight off from `FormField`'s).
struct ImagePickerField: View {
    let label: String
    @Binding var file: UploadFile?
    @Binding var previewData: Data?
    @State private var item: PhotosPickerItem?

    var body: some View {
        FormField(label) {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(Color.neonSurfaceSunken)
                    if let previewData, let image = UIImage(data: previewData) {
                        Image(uiImage: image).resizable().aspectRatio(contentMode: .fill)
                    } else {
                        Image(systemName: "photo").foregroundStyle(Color.neonTextFaint)
                    }
                }
                .frame(width: 64, height: 64)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

                PhotosPicker(selection: $item, matching: .images) {
                    Text(previewData == nil ? L("Choose a photo") : L("Change photo"))
                }
                .buttonStyle(.neon(.secondary, size: .medium))

                if previewData != nil {
                    Button(role: .destructive) {
                        previewData = nil
                        file = nil
                        item = nil
                    } label: {
                        Image(systemName: "trash").foregroundStyle(Color.neonDangerStrong)
                    }
                }
            }
        }
        .onChange(of: item) { newItem in
            guard let newItem else { return }
            Task {
                guard let made = await UploadMaker.photo(newItem) else { return }
                file = refield(made, "image")
                previewData = made.data
            }
        }
    }
}

/// One hue and one symbol per tab, defined once and reused everywhere this
/// area draws that tab — the section's own header tile, its `EmptyState`,
/// a row's leading icon and a sheet's icon — so a section never shows a
/// different glyph or colour from one place to the next. The symbols match
/// the ones already fixed on the chip a project page draws for this tab
/// (`ProjectDetailView.DetailSection.symbol`, in the Projects area, out of
/// this area's files) rather than changing to agree with them: this area
/// converges on that immutable spelling instead of drifting from it.
/// BOQ moved off `.orange` — the kit's own example reserves that hue for
/// approvals — to `.amber`; a money total still reads in `.green` wherever
/// one appears (BOQ's subtotal, Pricing's total), because the kit's rule of
/// thumb is "money green" regardless of which section it's totting up.
enum PFSection {
    case drawings, documents, boq, pricing, materials, furniture, approvals, comments

    var symbol: String {
        switch self {
        case .drawings: return "pencil.and.ruler"
        case .documents: return "doc.text"
        case .boq: return "list.number"
        case .pricing: return "banknote"
        case .materials: return "square.stack.3d.up"
        case .furniture: return "sofa"
        case .approvals: return "checkmark.seal"
        case .comments: return "bubble.left.and.bubble.right"
        }
    }

    var hue: NeonHue {
        switch self {
        case .drawings: return .cyan
        case .documents: return .purple
        case .boq: return .amber
        case .pricing: return .green
        case .materials: return .pink
        case .furniture: return .indigo
        case .approvals: return .orange
        case .comments: return .blue
        }
    }
}

/// The next revision label after the one on file: "R00" → "R01", "R07" →
/// "R08". Falls back to appending "-2" when a label isn't in the studio's
/// own R-number shape, so a sheet never guesses at a number it might
/// collide with or skip.
func nextRevisionLabel(after current: String) -> String {
    let trimmed = current.trimmingCharacters(in: .whitespaces)
    guard let digitsStart = trimmed.firstIndex(where: { $0.isNumber }) else {
        return trimmed.isEmpty ? "R01" : "\(trimmed)-2"
    }
    let prefix = trimmed[trimmed.startIndex..<digitsStart]
    let digits = trimmed[digitsStart...]
    guard let number = Int(digits) else { return "\(trimmed)-2" }
    let nextDigits = String(format: "%0\(digits.count)d", number + 1)
    return "\(prefix)\(nextDigits)"
}

/// The same "card with its own heading" every section opens with — an icon
/// tile in the section's hue, the title, a subtitle built from real counts,
/// and, once there is at least one row, an "Add" capsule in place of the
/// round "+" the header used to carry (which duplicated the empty state's
/// own action while the list was empty, and now hides with it).
@ViewBuilder
func pfSectionHeader(
    _ title: String,
    subtitle: String,
    section: PFSection,
    addTitle: String,
    showAdd: Bool,
    onAdd: @escaping () -> Void
) -> some View {
    if showAdd {
        SectionCard(title, subtitle: subtitle, symbol: section.symbol, hue: section.hue, actionTitle: addTitle, actionChevron: false, action: onAdd) {
            EmptyView()
        }
    } else {
        SectionCard(title, subtitle: subtitle, symbol: section.symbol, hue: section.hue) {
            EmptyView()
        }
    }
}
