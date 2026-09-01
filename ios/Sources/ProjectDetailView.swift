import SwiftUI

struct ProjectDetailView: View {
    let project: ProjectSummary

    @EnvironmentObject var api: APIClient
    @State private var detail: ProjectDetail?
    @State private var errorMessage: String?
    @State private var section: DetailSection = .overview

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

    private var cover: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(LinearGradient.neonAmbient)
            if let url = project.resolvedCoverURL {
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
        case .gallery: GallerySection(spaces: detail.spaces)
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
        case .overview, .comments: return true
        case .gallery: return !detail.spaces.isEmpty
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
    let spaces: [ProjectDetail.GallerySpace]

    private let columns = [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
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
                CommentBubble(comment: comment)
            }
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
                if comment.status == "RESOLVED" {
                    BadgeView(text: "Resolved", tone: .success)
                }
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
