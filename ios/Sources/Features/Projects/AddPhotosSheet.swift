import SwiftUI
import PhotosUI

/// Uploading into a space — camera or library, several at once. One request
/// per photo, exactly like the website's own uploader (image-upload-form.tsx):
/// the request body limit applies to the raw upload, before compression, so a
/// handful of camera photos sent together would be refused however small they
/// end up once compressed.
struct AddPhotosSheet: View {
    let projectId: String
    let space: GallerySpace
    let onDone: () -> Void

    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss

    @State private var isBeforeAfter = false
    @State private var caption = ""
    @State private var items: [PhotosPickerItem] = []
    @State private var beforeItem: PhotosPickerItem?
    @State private var afterItem: PhotosPickerItem?
    @State private var progress: (done: Int, total: Int)?
    @State private var errorMessage: String?

    var body: some View {
        SheetScaffold(
            L("Add Photos"),
            subtitle: space.name,
            symbol: "camera",
            primaryTitle: progress.map { L("Uploading %d/%d…", $0.done, $0.total) } ?? L("Upload"),
            isPrimaryEnabled: isValid && progress == nil
        ) {
            await upload()
        } content: {
            FormSection {
                ToggleRow(L("Before / After pair"), detail: L("One “after” photo, with an optional “before” to compare."), isOn: $isBeforeAfter.animation())
            }

            if isBeforeAfter {
                FormSection(L("Photos")) {
                    PhotosPicker(selection: $afterItem, matching: .images) {
                        pickerRow(title: L("After photo"), chosen: afterItem != nil)
                    }
                    PhotosPicker(selection: $beforeItem, matching: .images) {
                        pickerRow(title: L("Before photo (optional)"), chosen: beforeItem != nil)
                    }
                }
            } else {
                FormSection(L("Photos")) {
                    PhotosPicker(selection: $items, maxSelectionCount: 20, matching: .images) {
                        pickerRow(title: items.isEmpty ? L("Choose photos") : L("%d photo(s) chosen", items.count), chosen: !items.isEmpty)
                    }
                }
            }

            FormSection {
                NeonTextField(L("Caption (optional)"), text: $caption, symbol: "text.quote")
            }

            if let errorMessage {
                StatusNote(symbol: "exclamationmark.triangle.fill", tone: .danger, title: L("Some photos failed"), detail: errorMessage)
            }
        }
        .neonSheet([.medium, .large])
    }

    private var isValid: Bool {
        isBeforeAfter ? afterItem != nil : !items.isEmpty
    }

    @ViewBuilder
    private func pickerRow(title: String, chosen: Bool) -> some View {
        HStack {
            Image(systemName: chosen ? "checkmark.circle.fill" : "photo.badge.plus")
                .foregroundStyle(chosen ? Color.neonSuccessStrong : Color.neonInk)
            Text(title).font(.neonCallout).foregroundStyle(Color.neonText)
            Spacer()
        }
        .padding(12)
        .neonSurface(.sunken, radius: NeonRadius.sm)
    }

    private func upload() async {
        errorMessage = nil
        do {
            if isBeforeAfter {
                guard let afterItem, let after = await UploadMaker.photo(afterItem) else { return }
                var beforeUpload: UploadFile?
                if let beforeItem { beforeUpload = await UploadMaker.photo(beforeItem) }
                progress = (0, 1)
                try await api.addGalleryImage(
                    projectId: projectId, spaceId: space.id, image: after,
                    caption: caption, isBeforeAfter: true, beforeImage: beforeUpload
                )
                progress = (1, 1)
            } else {
                progress = (0, items.count)
                for (index, item) in items.enumerated() {
                    guard let made = await UploadMaker.photo(item) else { continue }
                    try await api.addGalleryImage(projectId: projectId, spaceId: space.id, image: made, caption: caption)
                    progress = (index + 1, items.count)
                }
            }
            Haptic.success()
            Toast.success(L("Photos added"))
            dismiss()
            onDone()
        } catch {
            Haptic.error()
            errorMessage = error.localizedDescription
            progress = nil
        }
    }
}
