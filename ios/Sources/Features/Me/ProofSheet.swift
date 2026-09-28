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
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 4) {
                        DirText(title, font: .system(size: 20, weight: .bold, design: .rounded))
                        if let subtitle { DirText(subtitle, font: .system(size: 13), color: .neonInk.opacity(0.55)) }
                    }

                    if !evidence.isEmpty {
                        DetailCard(title: L("Proof to send"), symbol: "camera") { BulletList(lines: evidence) }
                    }
                    if !acceptance.isEmpty {
                        DetailCard(title: L("It will be checked against"), symbol: "checkmark.circle") { BulletList(lines: acceptance) }
                    }

                    picked

                    HStack(spacing: 10) {
                        if CameraPicker.isAvailable {
                            sourceButton(L("Camera"), symbol: "camera.fill") { showCamera = true }
                        }
                        PhotosPicker(selection: $photoItem, matching: .images) {
                            sourceLabel(L("Photos"), symbol: "photo.on.rectangle")
                        }
                        .buttonStyle(.pressable)
                        sourceButton(L("File"), symbol: "doc.fill") { showFiles = true }
                    }

                    VStack(alignment: .leading, spacing: 6) {
                        Text(L("Note for the manager (optional)"))
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(Color.neonInk.opacity(0.6))
                        TextField(L("What should the manager know?"), text: $note, axis: .vertical)
                            .lineLimit(3...6)
                            .padding(12)
                            .background(Color.white.opacity(0.8), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Color.neonInk.opacity(0.1)))
                            .environment(\.layoutDirection, naturalDirection(note) ?? AppLanguage.current.layoutDirection)
                    }

                    if let errorMessage {
                        Text(errorMessage)
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }

                    Text(L("Sending puts this in the manager's review. It is marked done only when they approve it."))
                        .font(.system(size: 12))
                        .foregroundStyle(Color.neonInk.opacity(0.5))
                }
                .padding(16)
            }
            .neonAmbientBackground()
            .navigationTitle(L("Send proof"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L("Cancel")) { dismiss() }.disabled(sending)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await send() }
                    } label: {
                        if sending { ProgressView() } else { Text(L("Send")).bold() }
                    }
                    .disabled(file == nil || sending)
                }
            }
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
                Image(systemName: "doc.fill").font(.system(size: 26)).foregroundStyle(Color.neonPurpleStrong)
                VStack(alignment: .leading, spacing: 2) {
                    Text(file.filename).font(.system(size: 14, weight: .semibold)).lineLimit(2)
                    Text(byteCount(file.data.count)).font(.system(size: 12)).foregroundStyle(Color.neonInk.opacity(0.5))
                }
                Spacer()
            }
            .padding(14)
            .glassCard(radius: 16)
        } else {
            VStack(spacing: 6) {
                Image(systemName: "photo.badge.plus").font(.system(size: 30))
                Text(L("Add a photo or a file of the finished work"))
                    .font(.system(size: 14, weight: .medium))
                    .multilineTextAlignment(.center)
            }
            .foregroundStyle(Color.neonInk.opacity(0.4))
            .frame(maxWidth: .infinity)
            .frame(height: 150)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(style: StrokeStyle(lineWidth: 1.5, dash: [6, 5]))
                    .foregroundStyle(Color.neonInk.opacity(0.18))
            )
        }
    }

    private func set(_ made: UploadFile) {
        errorMessage = nil
        file = made
        preview = made.mimeType.hasPrefix("image/") ? UIImage(data: made.data) : nil
    }

    private func sourceButton(_ title: String, symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { sourceLabel(title, symbol: symbol) }
            .buttonStyle(.pressable)
    }

    private func sourceLabel(_ title: String, symbol: String) -> some View {
        VStack(spacing: 5) {
            Image(systemName: symbol).font(.system(size: 18))
            Text(title).font(.system(size: 12, weight: .semibold))
        }
        .foregroundStyle(Color.neonInk)
        .frame(maxWidth: .infinity)
        .frame(height: 62)
        .background(Color.white.opacity(0.75), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Color.neonInk.opacity(0.1)))
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
