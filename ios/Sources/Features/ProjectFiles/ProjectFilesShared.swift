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

/// A square reference photo, with a picker and a clear button.
struct ImagePickerField: View {
    let label: String
    @Binding var file: UploadFile?
    @Binding var previewData: Data?
    @State private var item: PhotosPickerItem?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Color.neonTextSecondary)
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
                        Image(systemName: "trash").foregroundStyle(.red)
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

/// The category / status colour used across the tabs' badges.
func pfCategoryTone(_ index: Int) -> BadgeTone {
    [.cyan, .purple, .pink, .orange][index % 4]
}
