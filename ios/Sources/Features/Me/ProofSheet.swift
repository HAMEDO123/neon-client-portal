import PhotosUI
import SwiftUI

// Contract with the chat and tasks areas: `ProofSheet(targetId:title:subtitle:
// evidence:acceptance:onSent:)` and `ProofTarget` keep these shapes — a task
// card in chat and the team's own task screens both hand work in through it.

/// What proof is being sent for: a board cell's id, or a chat job's assignment id.
struct ProofTarget: Identifiable {
    let id: String
    let title: String
    let detail: String?
}

// MARK: - Sending proof

/// Hands finished work in: a photo (or a PDF, drawing, spreadsheet or ZIP) and
/// a note, as multipart to `/tasks/[id]/proof`. The server answers SUBMITTED —
/// the start of the manager's check, never the end of one.
///
/// What to photograph sits above the camera, because telling somebody what to
/// photograph after they have photographed something is advice too late.
///
/// Built on `SheetScaffold`, ending in `.neonSheet` here rather than at every
/// call site — a sheet doesn't inherit the app's language direction, so
/// without it this is the one sheet in the app that stayed left-to-right in
/// Arabic, whichever of its four presentation sites opened it.
struct ProofSheet: View {
    /// A board cell's id, or a chat job's assignment id — the server finds which.
    let targetId: String
    let title: String
    var subtitle: String?
    var evidence: [String] = []
    var acceptance: [String] = []
    let onSent: () -> Void

    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss
    @State private var file: UploadFile?
    @State private var preview: UIImage?
    @State private var note = ""
    @State private var photoItem: PhotosPickerItem?
    @State private var showCamera = false
    @State private var showFiles = false
    @State private var sending = false
    @State private var errorMessage: String?

    var body: some View {
        SheetScaffold(
            L("Send proof"),
            subtitle: subtitle,
            symbol: "camera.fill",
            primaryTitle: L("Send"),
            isPrimaryEnabled: file != nil && !sending
        ) {
            await send()
        } content: {
            DirText(title, font: .neonCardTitle)

            if !evidence.isEmpty {
                DetailCard(title: L("Proof to send"), symbol: "camera") { BulletList(lines: evidence) }
            }
            if !acceptance.isEmpty {
                DetailCard(title: L("It will be checked against"), symbol: "checkmark.circle") { BulletList(lines: acceptance) }
            }

            picked

            HStack(spacing: 10) {
                if CameraPicker.isAvailable {
                    sourceButton(L("Camera"), symbol: "camera.fill", hue: .purple) { showCamera = true }
                }
                PhotosPicker(selection: $photoItem, matching: .images) {
                    sourceLabel(L("Photos"), symbol: "photo.on.rectangle", hue: .blue)
                }
                .buttonStyle(.pressable)
                sourceButton(L("File"), symbol: "doc.fill", hue: .orange) { showFiles = true }
            }

            NeonTextEditor(L("Note for the manager"), text: $note, minLines: 3, maxLines: 6)

            if let errorMessage {
                ValidationMessage(errorMessage)
            }

            Text(L("Sending puts this in the manager's review. It is marked done only when they approve it."))
                .font(.neonFootnote)
                .foregroundStyle(Color.neonTextTertiary)
        }
        .neonSheet([.large])
        .interactiveDismissDisabled(sending)
        .onChange(of: photoItem) { item in
            guard let item else { return }
            Task {
                if let made = await UploadMaker.photo(item) {
                    set(made)
                } else {
                    errorMessage = L("That photo could not be read.")
                }
            }
        }
        .fullScreenCover(isPresented: $showCamera) {
            CameraPicker { image in
                if let made = UploadMaker.photo(image) { set(made) }
            }
            .ignoresSafeArea()
            .neonLanguage()
        }
        .fileImporter(isPresented: $showFiles, allowedContentTypes: UploadMaker.documentTypes) { result in
            guard case .success(let url) = result else { return }
            if let made = UploadMaker.file(url, field: "photo") {
                set(made)
            } else {
                errorMessage = L("That file could not be read.")
            }
        }
    }

    @ViewBuilder
    private var picked: some View {
        if let preview {
            Image(uiImage: preview)
                .resizable()
                .scaledToFit()
                .frame(maxWidth: .infinity, maxHeight: 280)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        } else if let file {
            HStack(spacing: 12) {
                IconTile("doc.fill", hue: .purple, size: 40)
                VStack(alignment: .leading, spacing: 2) {
                    Text(file.filename).font(.system(size: 14, weight: .semibold)).lineLimit(2)
                    Text(byteCount(file.data.count)).font(.neonCaption).foregroundStyle(Color.neonTextSecondary)
                }
                Spacer()
            }
            .padding(14)
            .neonSurface(.glass, radius: NeonRadius.lg)
        } else {
            VStack(spacing: 8) {
                IconTile("photo.badge.plus", hue: .indigo, size: 52).neonFloat()
                Text(L("Add a photo or a file of the finished work"))
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Color.neonTextSecondary)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 150)
            .background(
                RoundedRectangle(cornerRadius: NeonRadius.lg, style: .continuous)
                    .strokeBorder(style: StrokeStyle(lineWidth: 1.5, dash: [6, 5]))
                    .foregroundStyle(Color.neonLine)
            )
        }
    }

    private func set(_ made: UploadFile) {
        errorMessage = nil
        file = made
        preview = made.mimeType.hasPrefix("image/") ? UIImage(data: made.data) : nil
    }

    private func sourceButton(_ title: String, symbol: String, hue: NeonHue, action: @escaping () -> Void) -> some View {
        Button(action: action) { sourceLabel(title, symbol: symbol, hue: hue) }
            .buttonStyle(.pressable)
    }

    private func sourceLabel(_ title: String, symbol: String, hue: NeonHue) -> some View {
        VStack(spacing: 6) {
            IconTile(symbol, hue: hue, size: 32)
            Text(title).font(.system(size: 12, weight: .semibold)).foregroundStyle(Color.neonInk)
        }
        .frame(maxWidth: .infinity)
        .frame(height: 78)
        .neonSurface(.glass, radius: NeonRadius.md)
    }

    private func send() async {
        guard let file else { return }
        sending = true
        errorMessage = nil
        defer { sending = false }
        do {
            try await api.submitProof(taskId: targetId, file: file, note: note)
            Haptic.success()
            onSent()
            dismiss()
        } catch APIError.unauthorized {
            dismiss()
        } catch {
            Haptic.error()
            errorMessage = error.localizedDescription
        }
    }
}
