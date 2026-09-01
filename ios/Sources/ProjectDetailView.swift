import SwiftUI
import PhotosUI

struct ProjectDetailView: View {
    let project: ProjectSummary

    @EnvironmentObject var api: APIClient
    @State private var detail: ProjectDetail?
    @State private var errorMessage: String?
    @State private var section: DetailSection = .overview
    @State private var showEdit = false
    @State private var coverPickerActive = false
    @State private var coverSelection: PhotosPickerItem?
    @State private var uploadingCover = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                cover

                VStack(alignment: .leading, spacing: 8) {
                    Text(project.name)
                        .font(.system(size: 26, weight: .bold, design: .rounded))
                        .foregroundStyle(Color.neonInk)

                    HStack(spacing: 8) {
                        BadgeView(text: project.publishState, tone: publishTone(project.publishState))
                        BadgeView(text: (detail?.pipelineStatus ?? project.pipelineStatus).replacingOccurrences(of: "_", with: " "), tone: .purple)
                    }
                }

                if let detail {
                    if detail.completionPercent > 0 {
                        completionBar(detail.completionPercent)
                    }
                    sectionPicker(for: detail)
                    sectionContent(for: detail)
                } else if let errorMessage {
                    VStack(spacing: 12) {
                        Text(errorMessage).foregroundStyle(Color.neonInk.opacity(0.5))
                        Button("Retry") { Task { await load() } }
                            .buttonStyle(.borderedProminent)
                            .tint(.neonInk)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 40)
                } else {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .padding(.top, 60)
                }
            }
            .padding(16)
        }
        .neonAmbientBackground()
        .navigationTitle(project.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if detail != nil {
                    Button("Edit") { showEdit = true }
                        .foregroundStyle(Color.neonInk)
                }
            }
        }
        .sheet(isPresented: $showEdit) {
            if let detail {
                EditProjectSheet(detail: detail) { Task { await load() } }
            }
        }
        .photosPicker(isPresented: $coverPickerActive, selection: $coverSelection, matching: .images)
        .onChange(of: coverSelection) { item in
            guard let item else { return }
            Task { await uploadCover(item) }
        }
        .task { await load() }
    }

    private func load() async {
        do {
            detail = try await api.fetchProject(id: project.id)
            errorMessage = nil
        } catch {
            errorMessage = "Couldn't load project."
        }
    }

    private func uploadCover(_ item: PhotosPickerItem) async {
        uploadingCover = true
        defer { uploadingCover = false; coverSelection = nil }
        guard let data = try? await item.loadTransferable(type: Data.self),
              let jpeg = UIImage(data: data)?.jpegData(compressionQuality: 0.9) else {
            Haptic.error()
            return
        }
        do {
            try await api.uploadCover(projectId: project.id, image: jpeg)
            Haptic.success()
            await load()
        } catch {
            Haptic.error()
        }
    }

    private var cover: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(LinearGradient.neonAmbient)
            if let url = resolvedMediaURL(detail?.coverImageUrl ?? project.coverImageUrl) {
                AsyncImage(url: url) { phase in
                    if let image = phase.image {
                        image.resizable().aspectRatio(contentMode: .fill)
                    }
                }
            } else {
                Image(systemName: "photo.on.rectangle.angled")
                    .font(.system(size: 34))
                    .foregroundStyle(Color.neonInk.opacity(0.25))
            }
        }
        .frame(height: 190)
        .frame(maxWidth: .infinity)
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .strokeBorder(Color.neonInk.opacity(0.08), lineWidth: 1)
        )
        .overlay(alignment: .bottomTrailing) {
            Button {
                coverPickerActive = true
            } label: {
                Image(systemName: uploadingCover ? "hourglass" : "camera.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 34, height: 34)
                    .background(Color.neonInk.opacity(0.75), in: Circle())
            }
            .buttonStyle(.plain)
            .disabled(uploadingCover)
            .padding(10)
        }
        .shadow(color: Color.neonInk.opacity(0.10), radius: 20, x: 0, y: 10)
    }

    private func completionBar(_ percent: Int) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Completion")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.neonInk.opacity(0.5))
                Spacer()
                Text("\(percent)%")
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .foregroundStyle(Color.neonPurpleStrong)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.neonInk.opacity(0.08))
                    Capsule()
                        .fill(LinearGradient.neonWordmark)
                        .frame(width: geo.size.width * CGFloat(percent) / 100)
                }
            }
            .frame(height: 8)
        }
        .padding(14)
        .glassCard(radius: 16)
    }

    private func sectionPicker(for detail: ProjectDetail) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(DetailSection.allCases.filter { $0.isAvailable(in: detail) }, id: \.self) { s in
                    Button {
                        Haptic.tap()
                        withAnimation(.easeOut(duration: 0.2)) { section = s }
                    } label: {
                        Text(s.title)
                            .font(.system(size: 13, weight: .semibold))
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                            .background(
                                section == s ? Color.neonInk : Color.neonInk.opacity(0.05),
                                in: Capsule()
                            )
                            .foregroundStyle(section == s ? .white : Color.neonInk.opacity(0.65))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.vertical, 2)
        }
    }

    @ViewBuilder
    private func sectionContent(for detail: ProjectDetail) -> some View {
        switch section {
        case .overview: OverviewSection(detail: detail)
        case .gallery: GallerySection(projectId: detail.id, spaces: detail.spaces) { Task { await load() } }
        case .drawings: DrawingsSection(drawings: detail.drawings)
        case .documents: DocumentsSection(documents: detail.documents)
        case .boq: BoqSection(items: detail.boqItems)
        case .pricing: PricingSection(items: detail.pricingItems)
        case .materials: MaterialsSection(items: detail.materials)
        case .furniture: FurnitureSection(items: detail.furniture)
        case .approvals: ApprovalsSection(items: detail.approvals)
        case .comments: CommentsSection(projectId: detail.id, comments: detail.comments)
        }
    }
}

enum DetailSection: CaseIterable {
    case overview, gallery, drawings, documents, boq, pricing, materials, furniture, approvals, comments

    var title: String {
        switch self {
        case .overview: return "Overview"
        case .gallery: return "Gallery"
        case .drawings: return "Drawings"
        case .documents: return "Documents"
        case .boq: return "BOQ"
        case .pricing: return "Pricing"
        case .materials: return "Materials"
        case .furniture: return "Furniture"
        case .approvals: return "Approvals"
        case .comments: return "Comments"
        }
    }

    func isAvailable(in detail: ProjectDetail) -> Bool {
        switch self {
        // Gallery stays visible even when empty — it's where employees upload.
        case .overview, .comments, .gallery: return true
        case .drawings: return !detail.drawings.isEmpty
        case .documents: return !detail.documents.isEmpty
        case .boq: return !detail.boqItems.isEmpty
        case .pricing: return !detail.pricingItems.isEmpty
        case .materials: return !detail.materials.isEmpty
        case .furniture: return !detail.furniture.isEmpty
        case .approvals: return !detail.approvals.isEmpty
        }
    }
}

// MARK: - Overview

private struct OverviewSection: View {
    let detail: ProjectDetail

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(spacing: 0) {
                InfoRow(symbol: "person.fill", label: "Client", value: detail.clientName)
                if let email = detail.clientEmail { divided(InfoRow(symbol: "envelope.fill", label: "Email", value: email)) }
                if let phone = detail.clientPhone { divided(InfoRow(symbol: "phone.fill", label: "Phone", value: phone)) }
                if let location = detail.location { divided(InfoRow(symbol: "mappin.and.ellipse", label: "Location", value: location)) }
                if let area = detail.area { divided(InfoRow(symbol: "ruler.fill", label: "Area", value: area)) }
                if let type = detail.projectType { divided(InfoRow(symbol: "building.2.fill", label: "Type", value: type)) }
                if let delivery = formattedISODate(detail.deliveryDate) { divided(InfoRow(symbol: "calendar", label: "Delivery", value: delivery)) }
                divided(InfoRow(symbol: "flag.fill", label: "Stage", value: detail.currentStage.replacingOccurrences(of: "_", with: " ").capitalized))
                if let updated = formattedISODate(detail.updatedAt) { divided(InfoRow(symbol: "clock.fill", label: "Last Updated", value: updated)) }
            }
            .glassCard(radius: 18)

            if let description = detail.description, !description.isEmpty {
                Text(description)
                    .font(.system(size: 14))
                    .foregroundStyle(Color.neonInk.opacity(0.7))
                    .lineSpacing(4)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .glassCard(radius: 18)
            }
        }
    }

    private func divided(_ row: InfoRow) -> some View {
        VStack(spacing: 0) {
            Divider().padding(.leading, 46)
            row
        }
    }
}

private struct InfoRow: View {
    let symbol: String
    let label: String
    let value: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Color.neonPurpleStrong)
                .frame(width: 32, height: 32)
                .background(Color.neonPurple.opacity(0.12), in: Circle())

            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.system(size: 11, weight: .semibold))
                    .tracking(0.4)
                    .foregroundStyle(Color.neonInk.opacity(0.4))
                Text(value)
                    .font(.system(size: 14))
                    .foregroundStyle(Color.neonInk)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }
}

// MARK: - Gallery

private struct GallerySection: View {
    let projectId: String
    let spaces: [ProjectDetail.GallerySpace]
    let onUploaded: () -> Void

    private let columns = [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            GalleryUploader(projectId: projectId, spaces: spaces, onUploaded: onUploaded)

            if spaces.isEmpty {
                Text("No photos yet — upload the first ones.")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.neonInk.opacity(0.5))
            }

            ForEach(spaces) { space in
                VStack(alignment: .leading, spacing: 10) {
                    Text(space.name.uppercased())
                        .font(.system(size: 12, weight: .semibold))
                        .tracking(0.6)
                        .foregroundStyle(Color.neonInk.opacity(0.4))
                    LazyVGrid(columns: columns, spacing: 10) {
                        ForEach(space.images) { image in
                            GalleryTile(image: image)
                        }
                    }
                }
            }
        }
    }
}

private struct GalleryUploader: View {
    let projectId: String
    let spaces: [ProjectDetail.GallerySpace]
    let onUploaded: () -> Void

    @EnvironmentObject var api: APIClient
    @State private var selection: [PhotosPickerItem] = []
    @State private var pickerActive = false
    @State private var targetSpaceId: String?
    @State private var newSpaceName = ""
    @State private var promptNewSpace = false
    @State private var uploading = false

    var body: some View {
        Menu {
            ForEach(spaces) { space in
                Button(space.name) {
                    targetSpaceId = space.id
                    newSpaceName = ""
                    pickerActive = true
                }
            }
            Button {
                promptNewSpace = true
            } label: {
                Label("New Space…", systemImage: "plus")
            }
        } label: {
            HStack(spacing: 10) {
                Image(systemName: uploading ? "hourglass" : "photo.badge.plus")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color.neonPurpleStrong)
                Text(uploading ? "Uploading…" : "Add Photos")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color.neonInk)
                Spacer()
                Image(systemName: "chevron.down")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.neonInk.opacity(0.3))
            }
            .padding(14)
            .glassCard(radius: 16)
        }
        .buttonStyle(.plain)
        .disabled(uploading)
        .alert("New Space", isPresented: $promptNewSpace) {
            TextField("Space name (e.g. Bedroom)", text: $newSpaceName)
            Button("Choose Photos") {
                guard !newSpaceName.trimmingCharacters(in: .whitespaces).isEmpty else { return }
                targetSpaceId = nil
                pickerActive = true
            }
            Button("Cancel", role: .cancel) {}
        }
        .photosPicker(isPresented: $pickerActive, selection: $selection, maxSelectionCount: 10, matching: .images)
        .onChange(of: selection) { items in
            guard !items.isEmpty else { return }
            Task { await upload(items) }
        }
    }

    private func upload(_ items: [PhotosPickerItem]) async {
        uploading = true
        defer { uploading = false; selection = [] }

        var images: [Data] = []
        for item in items {
            if let data = try? await item.loadTransferable(type: Data.self),
               let jpeg = UIImage(data: data)?.jpegData(compressionQuality: 0.9) {
                images.append(jpeg)
            }
        }
        guard !images.isEmpty else { Haptic.error(); return }

        do {
            try await api.uploadGalleryImages(
                projectId: projectId,
                spaceId: targetSpaceId,
                spaceName: targetSpaceId == nil ? newSpaceName.trimmingCharacters(in: .whitespaces) : nil,
                caption: nil,
                images: images
            )
            Haptic.success()
            onUploaded()
        } catch {
            Haptic.error()
        }
    }
}

private struct GalleryTile: View {
    let image: ProjectDetail.GalleryImage

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ZStack {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(Color.neonInk.opacity(0.06))
                AsyncImage(url: resolvedMediaURL(image.imageUrl)) { phase in
                    if let img = phase.image {
                        img.resizable().aspectRatio(contentMode: .fill)
                    }
                }
            }
            .frame(height: 120)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

            if let caption = image.caption, !caption.isEmpty {
                Text(caption)
                    .font(.system(size: 11))
                    .foregroundStyle(Color.neonInk.opacity(0.5))
                    .lineLimit(1)
            }
        }
    }
}

// MARK: - Drawings & Documents

private struct DrawingsSection: View {
    let drawings: [ProjectDetail.Drawing]

    var body: some View {
        GroupedList(items: drawings, category: \.category) { drawing in
            FileRow(
                symbol: "pencil.and.ruler.fill",
                thumbnailUrl: drawing.thumbnailUrl,
                title: drawing.name,
                subtitle: [drawing.drawingNumber, drawing.subCategory].compactMap { $0 }.joined(separator: " · "),
                badge: drawing.revision,
                fileUrl: drawing.fileUrl
            )
        }
    }
}

private struct DocumentsSection: View {
    let documents: [ProjectDetail.ProjectDocument]

    var body: some View {
        GroupedList(items: documents, category: \.category) { doc in
            FileRow(
                symbol: "doc.fill",
                thumbnailUrl: nil,
                title: doc.title,
                subtitle: doc.fileType.uppercased(),
                badge: doc.version,
                fileUrl: doc.fileUrl
            )
        }
    }
}

private struct FileRow: View {
    let symbol: String
    let thumbnailUrl: String?
    let title: String
    let subtitle: String
    let badge: String?
    let fileUrl: String

    var body: some View {
        Group {
            if let url = resolvedMediaURL(fileUrl) {
                Link(destination: url) { content }
            } else {
                content
            }
        }
        .buttonStyle(.plain)
    }

    private var content: some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Color.neonCyan.opacity(0.12))
                if let thumbnailUrl, let url = resolvedMediaURL(thumbnailUrl) {
                    AsyncImage(url: url) { phase in
                        if let image = phase.image {
                            image.resizable().aspectRatio(contentMode: .fill)
                        }
                    }
                } else {
                    Image(systemName: symbol)
                        .font(.system(size: 15))
                        .foregroundStyle(Color.neonCyanStrong)
                }
            }
            .frame(width: 44, height: 44)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Color.neonInk)
                    .lineLimit(1)
                if !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.system(size: 11))
                        .foregroundStyle(Color.neonInk.opacity(0.5))
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            if let badge, !badge.isEmpty {
                BadgeView(text: badge, tone: .cyan)
            }
            Image(systemName: "arrow.up.right.square")
                .font(.system(size: 13))
                .foregroundStyle(Color.neonInk.opacity(0.3))
        }
        .padding(12)
        .glassCard(radius: 14)
    }
}

// MARK: - BOQ & Pricing

private struct BoqSection: View {
    let items: [ProjectDetail.BoqItem]

    var body: some View {
        GroupedList(items: items, category: \.category) { item in
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(item.name)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(Color.neonInk)
                    if let description = item.description, !description.isEmpty {
                        Text(description)
                            .font(.system(size: 11))
                            .foregroundStyle(Color.neonInk.opacity(0.5))
                            .lineLimit(2)
                    }
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 3) {
                    Text("\(item.quantity.cleanQty) \(item.unit)")
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .foregroundStyle(Color.neonInk)
                    if let price = item.unitPrice {
                        Text(price.currency)
                            .font(.system(size: 11))
                            .foregroundStyle(Color.neonInk.opacity(0.5))
                    }
                }
            }
            .padding(12)
            .glassCard(radius: 14)
        }
    }
}

private struct PricingSection: View {
    let items: [ProjectDetail.PricingItem]

    private var total: Double { items.filter { !$0.isOptional }.reduce(0) { $0 + $1.amount } }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            GroupedList(items: items, category: \.category) { item in
                HStack(alignment: .top, spacing: 12) {
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 6) {
                            Text(item.label)
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(Color.neonInk)
                            if item.isOptional {
                                BadgeView(text: "Optional", tone: .neutral)
                            }
                        }
                        if let description = item.description, !description.isEmpty {
                            Text(description)
                                .font(.system(size: 11))
                                .foregroundStyle(Color.neonInk.opacity(0.5))
                                .lineLimit(2)
                        }
                    }
                    Spacer(minLength: 8)
                    Text(item.amount.currency)
                        .font(.system(size: 14, weight: .semibold, design: .rounded))
                        .foregroundStyle(Color.neonInk)
                }
                .padding(12)
                .glassCard(radius: 14)
            }

            HStack {
                Text("Total")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color.neonInk)
                Spacer()
                Text(total.currency)
                    .font(.system(size: 18, weight: .bold, design: .rounded))
                    .foregroundStyle(Color.neonPurpleStrong)
            }
            .padding(14)
            .glassCard(radius: 16)
        }
    }
}

// MARK: - Materials & Furniture

private struct MaterialsSection: View {
    let items: [ProjectDetail.MaterialItem]

    var body: some View {
        GroupedList(items: items, category: \.category) { item in
            ItemRow(
                imageUrl: item.imageUrl,
                title: item.name,
                subtitle: [item.brand, item.color, item.finish].compactMap { $0 }.joined(separator: " · "),
                trailing: item.price?.currency
            )
        }
    }
}

private struct FurnitureSection: View {
    let items: [ProjectDetail.FurnitureItem]

    var body: some View {
        VStack(spacing: 10) {
            ForEach(items) { item in
                ItemRow(
                    imageUrl: item.imageUrl,
                    title: item.quantity > 1 ? "\(item.name) ×\(item.quantity)" : item.name,
                    subtitle: [item.brand, item.dimensions, item.space].compactMap { $0 }.joined(separator: " · "),
                    trailing: item.price?.currency
                )
            }
        }
    }
}

private struct ItemRow: View {
    let imageUrl: String?
    let title: String
    let subtitle: String
    let trailing: String?

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Color.neonInk.opacity(0.06))
                if let url = resolvedMediaURL(imageUrl) {
                    AsyncImage(url: url) { phase in
                        if let image = phase.image {
                            image.resizable().aspectRatio(contentMode: .fill)
                        }
                    }
                } else {
                    Image(systemName: "cube.fill")
                        .font(.system(size: 15))
                        .foregroundStyle(Color.neonInk.opacity(0.25))
                }
            }
            .frame(width: 44, height: 44)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Color.neonInk)
                    .lineLimit(1)
                if !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.system(size: 11))
                        .foregroundStyle(Color.neonInk.opacity(0.5))
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            if let trailing {
                Text(trailing)
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(Color.neonInk.opacity(0.7))
            }
        }
        .padding(12)
        .glassCard(radius: 14)
    }
}

// MARK: - Approvals

private struct ApprovalsSection: View {
    let items: [ProjectDetail.ApprovalItem]

    var body: some View {
        VStack(spacing: 10) {
            ForEach(items) { item in
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text(item.itemLabel)
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(Color.neonInk)
                        Spacer()
                        BadgeView(text: item.status.replacingOccurrences(of: "_", with: " "), tone: approvalTone(item.status))
                    }
                    if let note = item.note, !note.isEmpty {
                        Text(note)
                            .font(.system(size: 12))
                            .foregroundStyle(Color.neonInk.opacity(0.6))
                    }
                    HStack(spacing: 6) {
                        if let client = item.clientName {
                            Text(client)
                        }
                        if let responded = formattedISODate(item.respondedAt) {
                            Text("· \(responded)")
                        }
                    }
                    .font(.system(size: 11))
                    .foregroundStyle(Color.neonInk.opacity(0.4))
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .glassCard(radius: 14)
            }
        }
    }

    private func approvalTone(_ status: String) -> BadgeTone {
        switch status {
        case "APPROVED": return .success
        case "CHANGES_REQUESTED": return .warning
        default: return .orange
        }
    }
}

// MARK: - Comments

private struct CommentsSection: View {
    let projectId: String
    @State var comments: [ProjectDetail.CommentItem]

    @EnvironmentObject var api: APIClient
    @State private var draft = ""
    @State private var sending = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                TextField("Reply to client…", text: $draft, axis: .vertical)
                    .font(.system(size: 14))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .glassCard(radius: 14)
                Button {
                    Task { await send() }
                } label: {
                    Image(systemName: sending ? "hourglass" : "paperplane.fill")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 40, height: 40)
                        .background(Color.neonInk, in: Circle())
                }
                .buttonStyle(.plain)
                .disabled(sending || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }

            if comments.isEmpty {
                Text("No comments yet.")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.neonInk.opacity(0.5))
                    .padding(.top, 12)
            }

            ForEach(comments) { comment in
                CommentBubble(comment: comment) {
                    Task { await toggleStatus(comment) }
                }
            }
        }
    }

    private func toggleStatus(_ comment: ProjectDetail.CommentItem) async {
        let newStatus = comment.status == "RESOLVED" ? "OPEN" : "RESOLVED"
        do {
            try await api.setCommentStatus(projectId: projectId, commentId: comment.id, status: newStatus)
            if let index = comments.firstIndex(where: { $0.id == comment.id }) {
                comments[index] = ProjectDetail.CommentItem(
                    id: comment.id, authorName: comment.authorName, authorType: comment.authorType,
                    message: comment.message, refLabel: comment.refLabel, status: newStatus,
                    createdAt: comment.createdAt
                )
            }
            Haptic.success()
        } catch {
            Haptic.error()
        }
    }

    private func send() async {
        let message = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty else { return }
        sending = true
        defer { sending = false }
        do {
            let created = try await api.postComment(projectId: projectId, message: message)
            comments.insert(created, at: 0)
            draft = ""
            Haptic.success()
        } catch {
            Haptic.error()
        }
    }
}

private struct CommentBubble: View {
    let comment: ProjectDetail.CommentItem
    let onToggleStatus: () -> Void

    private var isAdmin: Bool { comment.authorType == "ADMIN" }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text(comment.authorName)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(isAdmin ? Color.neonPurpleStrong : Color.neonInk.opacity(0.7))
                if let ref = comment.refLabel, !ref.isEmpty {
                    BadgeView(text: ref, tone: .cyan)
                }
                Spacer()
                Button {
                    onToggleStatus()
                } label: {
                    BadgeView(
                        text: comment.status == "RESOLVED" ? "Resolved" : "Resolve",
                        tone: comment.status == "RESOLVED" ? .success : .neutral
                    )
                }
                .buttonStyle(.plain)
            }
            Text(comment.message)
                .font(.system(size: 14))
                .foregroundStyle(Color.neonInk)
                .lineSpacing(3)
            if let created = formattedISODate(comment.createdAt) {
                Text(created)
                    .font(.system(size: 11))
                    .foregroundStyle(Color.neonInk.opacity(0.4))
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            isAdmin ? Color.neonPurple.opacity(0.06) : Color.clear,
            in: RoundedRectangle(cornerRadius: 14, style: .continuous)
        )
        .glassCard(radius: 14)
    }
}

// MARK: - Edit sheet

private struct EditProjectSheet: View {
    let detail: ProjectDetail
    let onSaved: () -> Void

    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss
    @State private var pipeline: String
    @State private var completion: Double
    @State private var publish: String
    @State private var saving = false

    private static let pipelineStatuses = [
        "DRAFT", "INTERNAL_REVIEW", "SENT_TO_CLIENT", "CLIENT_REVIEWING",
        "CHANGES_REQUESTED", "APPROVED", "EXECUTION", "COMPLETED", "ARCHIVED",
    ]
    private static let publishStates = ["DRAFT", "PUBLISHED", "ARCHIVED"]

    init(detail: ProjectDetail, onSaved: @escaping () -> Void) {
        self.detail = detail
        self.onSaved = onSaved
        _pipeline = State(initialValue: detail.pipelineStatus)
        _completion = State(initialValue: Double(detail.completionPercent))
        _publish = State(initialValue: detail.publishState)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Pipeline Status") {
                    Picker("Status", selection: $pipeline) {
                        ForEach(Self.pipelineStatuses, id: \.self) {
                            Text($0.replacingOccurrences(of: "_", with: " ").capitalized).tag($0)
                        }
                    }
                    .pickerStyle(.menu)
                }
                Section("Completion — \(Int(completion))%") {
                    Slider(value: $completion, in: 0...100, step: 1)
                        .tint(.neonPurple)
                }
                Section("Visibility") {
                    Picker("Publish State", selection: $publish) {
                        ForEach(Self.publishStates, id: \.self) {
                            Text($0.capitalized).tag($0)
                        }
                    }
                    .pickerStyle(.segmented)
                }
            }
            .navigationTitle("Edit Project")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(saving ? "Saving…" : "Save") { Task { await save() } }
                        .fontWeight(.semibold)
                        .disabled(saving)
                }
            }
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        do {
            try await api.updateProject(
                id: detail.id,
                pipelineStatus: pipeline,
                completionPercent: Int(completion),
                publishState: publish
            )
            Haptic.success()
            onSaved()
            dismiss()
        } catch {
            Haptic.error()
        }
    }
}

// MARK: - Shared helpers

private struct GroupedList<Item: Identifiable, Row: View>: View {
    let items: [Item]
    let category: KeyPath<Item, String>
    @ViewBuilder let row: (Item) -> Row

    private var groups: [(name: String, items: [Item])] {
        var order: [String] = []
        var buckets: [String: [Item]] = [:]
        for item in items {
            let key = item[keyPath: category]
            if buckets[key] == nil { order.append(key) }
            buckets[key, default: []].append(item)
        }
        return order.map { ($0, buckets[$0] ?? []) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ForEach(groups, id: \.name) { group in
                VStack(alignment: .leading, spacing: 8) {
                    Text(group.name.uppercased())
                        .font(.system(size: 12, weight: .semibold))
                        .tracking(0.6)
                        .foregroundStyle(Color.neonInk.opacity(0.4))
                    VStack(spacing: 8) {
                        ForEach(group.items) { row($0) }
                    }
                }
            }
        }
    }
}

private extension Double {
    var cleanQty: String {
        truncatingRemainder(dividingBy: 1) == 0
            ? String(format: "%.0f", self)
            : String(format: "%.2f", self)
    }

    var currency: String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 0
        let value = formatter.string(from: NSNumber(value: self)) ?? "\(self)"
        return "JOD \(value)"
    }
}
