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

/// One thing about to be sent. The preview is small: ten full photos decoded
/// at once is more memory than a phone has to spare.
private struct PickedProof: Identifiable {
    let id = UUID()
    let file: UploadFile
    let preview: UIImage?

    init(file: UploadFile) {
        self.file = file
        preview = file.mimeType.hasPrefix("image/") ? UIImage(data: file.data)?.scaledDown(maxDimension: 900) : nil
    }
}

// MARK: - Sending proof

/// Hands finished work in: one or several photos (or PDFs, drawings,
/// spreadsheets or ZIPs), up to ten together, and a note, as multipart to `/tasks/[id]/proof`. The server answers SUBMITTED —
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
    /// What a screenshot of the sheet starts with; empty everywhere else.
    var previewFiles: [UploadFile] = []
    let onSent: () -> Void

    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss
    @State private var files: [PickedProof] = []
    @State private var note = ""
    @State private var photoItems: [PhotosPickerItem] = []
    /// Photos chosen and still being read: sending waits for all of them, so a
    /// proof never goes without the one that had not finished loading.
    @State private var reading = 0
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
            isPrimaryEnabled: !files.isEmpty && reading == 0 && !sending
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

            if room > 0 {
                HStack(spacing: 10) {
                    if CameraPicker.isAvailable {
                        sourceButton(L("Camera"), symbol: "camera.fill", hue: .purple) { showCamera = true }
                    }
                    PhotosPicker(selection: $photoItems, maxSelectionCount: room, selectionBehavior: .ordered, matching: .images) {
                        sourceLabel(L("Photos"), symbol: "photo.on.rectangle", hue: .blue)
                    }
                    .buttonStyle(.pressable)
                    sourceButton(L("File"), symbol: "doc.fill", hue: .orange) { showFiles = true }
                }
                .disabled(sending || reading > 0)
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
        .task { if files.isEmpty { previewFiles.forEach(add) } }
        .interactiveDismissDisabled(sending)
        .onChange(of: photoItems) { items in
            guard !items.isEmpty else { return }
            // Emptied, so the next time the library opens it starts from nothing
            // and the same photo can be chosen again after being removed.
            photoItems = []
            errorMessage = nil
            reading += items.count
            Task {
                for item in items {
                    if let made = await UploadMaker.photo(item) {
                        add(made)
                    } else {
                        errorMessage = L("That photo could not be read.")
                    }
                    reading -= 1
                }
            }
        }
        .fullScreenCover(isPresented: $showCamera) {
            CameraPicker { image in
                if let made = UploadMaker.photo(image) {
                    errorMessage = nil
                    add(made)
                }
            }
            .ignoresSafeArea()
            .neonLanguage()
        }
        .fileImporter(isPresented: $showFiles, allowedContentTypes: UploadMaker.documentTypes, allowsMultipleSelection: true) { result in
            guard case .success(let urls) = result else { return }
            errorMessage = nil
            for url in urls {
                if let made = UploadMaker.file(url, field: "photo") {
                    add(made)
                } else {
                    errorMessage = L("That file could not be read.")
                }
            }
        }
    }

    /// How many more can be added.
    private var room: Int { max(0, Self.most - files.count - reading) }

    /// What the server takes as one proof: `MAX_PROOF_FILES` in
    /// src/lib/attachments.ts, and `MAX_UPLOAD_BYTES` in src/lib/upload-limits.ts.
    static let most = 10
    static let mostBytes = 80 * 1024 * 1024

    @ViewBuilder
    private var picked: some View {
        if files.isEmpty && reading == 0 {
            VStack(spacing: 8) {
                IconTile("photo.badge.plus", hue: .indigo, size: 52).neonFloat()
                Text(L("Add photos or files of the finished work"))
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
        } else {
            VStack(alignment: .leading, spacing: 8) {
                if files.count + reading == 1, let only = files.first {
                    tile(only, alone: true)
                } else {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 100), spacing: 10)], spacing: 10) {
                        ForEach(files) { tile($0, alone: false) }
                        ForEach(0..<reading, id: \.self) { _ in
                            ProgressView()
                                .frame(maxWidth: .infinity)
                                .frame(height: 100)
                                .neonSurface(.sunken, radius: NeonRadius.md)
                        }
                    }
                }
                if files.count > 1 {
                    Text(L("%d of %d", files.count, Self.most))
                        .font(.neonCaption)
                        .foregroundStyle(Color.neonTextTertiary)
                }
            }
        }
    }

    private func tile(_ item: PickedProof, alone: Bool) -> some View {
        Group {
            if let preview = item.preview {
                Color.clear
                    .frame(maxWidth: .infinity)
                    .frame(height: alone ? 260 : 100)
                    // A filled picture reaches past its tile: cut off on screen, but
                    // it would still take taps meant for the buttons beside it.
                    .overlay { Image(uiImage: preview).resizable().scaledToFill().allowsHitTesting(false) }
            } else {
                VStack(spacing: 4) {
                    IconTile("doc.fill", hue: .purple, size: alone ? 40 : 30)
                    Text(item.file.filename).font(.system(size: alone ? 14 : 11, weight: .semibold)).lineLimit(alone ? 2 : 1)
                    Text(byteCount(item.file.data.count)).font(.neonCaption).foregroundStyle(Color.neonTextSecondary)
                }
                .padding(8)
                .frame(maxWidth: .infinity)
                .frame(height: alone ? 130 : 100)
                .neonSurface(.sunken, radius: NeonRadius.md)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: alone ? 16 : NeonRadius.md, style: .continuous))
        .overlay(alignment: .topTrailing) {
            Button { remove(item) } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 28, height: 28)
                    .background(Circle().fill(.black.opacity(0.65)))
                    .padding(5)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(sending)
            .accessibilityLabel(L("Remove"))
        }
    }

    /// Held to what the server takes, and said here: refused after the upload
    /// is a minute of somebody's connection on a site.
    private func add(_ made: UploadFile) {
        guard files.count < Self.most else {
            errorMessage = L("Up to %d files can be sent together.", Self.most)
            return
        }
        guard files.reduce(made.data.count, { $0 + $1.file.data.count }) <= Self.mostBytes else {
            errorMessage = L("That is too much for one upload: %@ together is the most.", byteCount(Self.mostBytes))
            return
        }
        files.append(PickedProof(file: made))
    }

    private func remove(_ item: PickedProof) {
        errorMessage = nil
        files.removeAll { $0.id == item.id }
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
        guard !files.isEmpty, reading == 0, !sending else { return }
        sending = true
        errorMessage = nil
        defer { sending = false }
        do {
            try await api.submitProof(taskId: targetId, files: files.map(\.file), note: note)
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
