import PhotosUI
import SwiftUI

// Starting a conversation and looking after groups. The manager makes groups
// of employees (the manager is always in one); anybody can open a private
// chat with someone from `get/chat/people`.

// MARK: - New chat

struct ChatNewConversationSheet: View {
    let isManager: Bool
    /// Opens the conversation once the sheet has gone.
    let onOpen: (ChatRoute) -> Void

    @EnvironmentObject private var api: APIClient
    @Environment(\.dismiss) private var dismiss
    @State private var people: [ChatPerson]?
    @State private var problem: String?
    @State private var query = ""

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if isManager {
                        NavigationLink {
                            ChatGroupForm(people: (people ?? []).filter { $0.id != "manager" }) { route in
                                open(route)
                            }
                        } label: {
                            newGroupTile
                        }
                        .buttonStyle(.pressableCard)
                        .neonAppear()
                    }

                    SearchField(text: $query, prompt: L("Search people"))
                    SectionLabel(L("Message someone"))

                    if let people {
                        let shown = people.filter { matchesSearch(query, $0.name, $0.role) }
                        if shown.isEmpty {
                            EmptyState(symbol: query.isEmpty ? "person.2" : "magnifyingglass",
                                       title: query.isEmpty ? L("No one to message yet") : L("No matches"))
                        }
                        ForEach(Array(shown.enumerated()), id: \.element.id) { index, person in
                            Button {
                                Haptic.tap()
                                open(ChatRoute(slug: person.id, title: person.name, subtitle: person.role, avatar: person.avatar, isGroup: false))
                            } label: {
                                ChatPersonRow(person: person)
                            }
                            .buttonStyle(.pressableCard)
                            .staggered(index)
                        }
                    } else if let problem {
                        ErrorState(message: problem) { await load() }
                    } else {
                        SkeletonRows(count: 4)
                    }
                }
                .padding(NeonSpace.gutter)
            }
            .background(NeonAmbient().ignoresSafeArea())
            .navigationTitle(L("New chat"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L("Cancel")) { dismiss() }
                }
            }
        }
        .task { await load() }
        .neonSheet([.large])
    }

    private var newGroupTile: some View {
        HStack(spacing: 14) {
            Image(systemName: "person.3.fill")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 54, height: 54)
                .background(Circle().fill(ChatTint.accent))
                .neonShadow(.glow(.neonPurple))
            VStack(alignment: .leading, spacing: 3) {
                Text(L("New group"))
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Color.neonInk)
                Text(L("Name it, add a photo, pick who is in"))
                    .font(.system(size: 13))
                    .foregroundStyle(Color.neonTextSecondary)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.forward")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.neonTextFaint)
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(LinearGradient(colors: [Color.white, Color.neonPurple.opacity(0.08)], startPoint: .topLeading, endPoint: .bottomTrailing))
        )
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(Color.neonPurple.opacity(0.18), lineWidth: 1))
        .neonShadow(.low)
    }

    private func open(_ route: ChatRoute) {
        dismiss()
        // Let the sheet finish leaving before the push, or the push is lost.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { onOpen(route) }
    }

    private func load() async {
        do {
            people = try await api.fetchChatPeople()
            problem = nil
        } catch {
            if people == nil { problem = error.localizedDescription }
        }
    }
}

/// A person, with the colour the studio gave them and what they do.
struct ChatPersonRow<Trailing: View>: View {
    let person: ChatPerson
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(spacing: 12) {
            ChatAvatar(url: person.avatarURL, name: person.name, size: 46, color: person.color)
            VStack(alignment: .leading, spacing: 2) {
                DirText(person.name, font: .system(size: 16, weight: .semibold), lineLimit: 1)
                if let role = person.role, !role.isEmpty {
                    DirText(role, font: .system(size: 13), color: .neonTextSecondary, lineLimit: 1)
                }
            }
            trailing()
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.white.opacity(0.9)))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Color.white, lineWidth: 1))
        .neonShadow(.low)
        .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}

extension ChatPersonRow where Trailing == AnyView {
    init(person: ChatPerson) {
        self.person = person
        self.trailing = {
            AnyView(
                Image(systemName: "bubble.left.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color.neonPurple)
                    .frame(width: 34, height: 34)
                    .background(Circle().fill(Color.neonPurple.opacity(0.12)))
            )
        }
    }
}

// MARK: - A group's photo

/// The round photo a group is shown with, and the picker that changes it.
private struct ChatGroupPhotoPicker: View {
    let image: UIImage?
    let currentURL: URL?
    let name: String
    let onPick: (UIImage) -> Void

    @State private var item: PhotosPickerItem?

    var body: some View {
        PhotosPicker(selection: $item, matching: .images) {
            ZStack(alignment: .bottomTrailing) {
                Group {
                    if let image {
                        Image(uiImage: image).resizable().scaledToFill()
                            .frame(width: 104, height: 104)
                            .clipShape(Circle())
                    } else {
                        ChatAvatar(url: currentURL, name: name.isEmpty ? "?" : name, size: 104, isGroup: true)
                    }
                }
                .overlay(Circle().strokeBorder(Color.white, lineWidth: 3))
                .neonShadow(.card)
                Image(systemName: "camera.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 34, height: 34)
                    .background(Circle().fill(ChatTint.accent))
                    .overlay(Circle().strokeBorder(Color.white, lineWidth: 2.5))
            }
        }
        .buttonStyle(PressableStyle(scale: 0.95))
        .accessibilityLabel(L("Change photo"))
        .onChange(of: item) { picked in
            guard let picked else { return }
            item = nil
            Task {
                if let data = try? await picked.loadTransferable(type: Data.self), let loaded = UIImage(data: data) {
                    onPick(loaded)
                } else {
                    Toast.error(L("That photo could not be read."))
                }
            }
        }
    }
}

// MARK: - Making a group

struct ChatGroupForm: View {
    let people: [ChatPerson]
    let onCreated: (ChatRoute) -> Void

    @EnvironmentObject private var api: APIClient
    @State private var name = ""
    @State private var photo: UIImage?
    @State private var selected: Set<String> = []
    @State private var query = ""
    @State private var attempts = 0

    private var isValid: Bool { !name.trimmingCharacters(in: .whitespaces).isEmpty && !selected.isEmpty }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ChatGroupPhotoPicker(image: photo, currentURL: nil, name: name) { photo = $0 }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 6)

                NeonTextField(L("Group name"), text: $name, prompt: L("e.g. Villa project"), symbol: "person.3", isRequired: true)

                HStack {
                    SectionLabel(L("Members"))
                    if !selected.isEmpty {
                        Text(L("%d chosen", selected.count))
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Color.neonPurpleStrong)
                            .transition(.neonPop)
                    }
                }
                SearchField(text: $query, prompt: L("Search people"))

                let shown = people.filter { matchesSearch(query, $0.name, $0.role) }
                if people.isEmpty {
                    EmptyState(symbol: "person.2", title: L("No one to add yet"))
                }
                ForEach(shown) { person in
                    let on = selected.contains(person.id)
                    Button {
                        Haptic.selection()
                        withNeonAnimation(NeonMotion.snappy) {
                            if on { selected.remove(person.id) } else { selected.insert(person.id) }
                        }
                    } label: {
                        ChatPersonRow(person: person) {
                            Image(systemName: on ? "checkmark.circle.fill" : "circle")
                                .font(.system(size: 24, weight: .semibold))
                                .foregroundStyle(on ? AnyShapeStyle(ChatTint.accent) : AnyShapeStyle(Color.neonInk.opacity(0.2)))
                        }
                    }
                    .buttonStyle(.pressableCard)
                }
            }
            .padding(NeonSpace.gutter)
            .shake(attempts)
        }
        .safeAreaInset(edge: .bottom) {
            NeonButton(L("Create group"), symbol: "sparkles", kind: .brand) { await create() }
                .disabled(!isValid)
                .padding(.horizontal, NeonSpace.gutter)
                .padding(.vertical, 10)
                .background(Rectangle().fill(.ultraThinMaterial).ignoresSafeArea())
        }
        .background(NeonAmbient().ignoresSafeArea())
        .navigationTitle(L("New group"))
        .navigationBarTitleDisplayMode(.inline)
    }

    private func create() async {
        let upload = photo.flatMap { UploadMaker.photo($0, name: "group.jpg") }
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            let created = try await api.createChatGroup(name: trimmed, members: Array(selected), photo: upload)
            Haptic.success()
            Toast.success(L("Group created"))
            let slug = created?.slug ?? created.map { "g-\($0.groupId)" }
            guard let slug else { return }
            onCreated(ChatRoute(slug: slug, title: trimmed, subtitle: nil, avatar: nil, isGroup: true))
        } catch {
            Haptic.error()
            attempts += 1
            Toast.error(error)
        }
    }
}

// MARK: - A group's info

struct ChatGroupInfoSheet: View {
    let slug: String
    /// The group's new name and picture, for the conversation's header.
    var onChanged: (String, String?) -> Void = { _, _ in }
    var onDeleted: () -> Void = {}

    @EnvironmentObject private var api: APIClient
    @Environment(\.dismiss) private var dismiss
    @State private var detail: ChatGroupDetail?
    @State private var cachedAt: Date?
    @State private var problem: String?
    @State private var name = ""
    @State private var removing: ChatPerson?
    @State private var showAdd = false
    @State private var uploading = false

    private var canManage: Bool { detail?.canManage == true && cachedAt == nil }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let detail {
                        header(detail)
                        if canManage { renameCard(detail) }
                        members(detail)
                        if canManage {
                            NeonButton(L("Delete group"), symbol: "trash", kind: .destructive,
                                       confirm: L("Delete this group?"),
                                       confirmMessage: L("Its messages are deleted for everyone.")) { await deleteGroup(detail) }
                                .padding(.top, 8)
                        }
                    } else if let problem {
                        ErrorState(message: problem) { await load() }
                    } else {
                        SkeletonRows(count: 4)
                    }
                }
                .padding(NeonSpace.gutter)
            }
            .refreshable { await load() }
            .background(NeonAmbient().ignoresSafeArea())
            .navigationTitle(L("Group info"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Done")) { dismiss() }
                }
            }
        }
        .task { await load() }
        .confirmDestructive(item: $removing, title: { L("Remove %@ from the group?", $0.name) }, actionTitle: L("Remove")) { person in
            Task { await remove(person) }
        }
        .sheet(isPresented: $showAdd) {
            ChatMemberPickerSheet(excluding: Set(detail?.members.map(\.id) ?? [])) { ids in
                await add(ids)
            }
        }
        .neonSheet([.large])
    }

    private func header(_ detail: ChatGroupDetail) -> some View {
        VStack(spacing: 10) {
            if canManage {
                ChatGroupPhotoPicker(image: nil, currentURL: detail.avatarURL, name: detail.name) { image in
                    Task { await changePhoto(image) }
                }
                .overlay { if uploading { ProgressView().tint(.white) } }
            } else {
                ChatAvatar(url: detail.avatarURL, name: detail.name, size: 104, isGroup: true)
                    .overlay(Circle().strokeBorder(Color.white, lineWidth: 3))
                    .neonShadow(.card)
            }
            DirText(detail.name, font: .neonTitle2, fill: false, lineLimit: 2)
            Text(L("%d members", detail.members.count))
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Color.neonTextSecondary)
            if let cachedAt { OfflineBanner(savedAt: cachedAt) }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .neonAppear()
    }

    private func renameCard(_ detail: ChatGroupDetail) -> some View {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return VStack(alignment: .leading, spacing: 10) {
            NeonTextField(L("Group name"), text: $name, symbol: "pencil")
            if !trimmed.isEmpty && trimmed != detail.name {
                NeonButton(L("Save name"), symbol: "checkmark", kind: .tinted(.neonPurpleStrong), size: .medium) {
                    await rename(to: trimmed)
                }
                .transition(.neonPop)
            }
        }
        .animation(NeonMotion.snappy, value: trimmed == detail.name)
    }

    private func members(_ detail: ChatGroupDetail) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                SectionLabel(L("Members"))
                if canManage {
                    Button {
                        Haptic.tap()
                        showAdd = true
                    } label: {
                        Label(L("Add"), systemImage: "person.badge.plus")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 14)
                            .frame(height: 34)
                            .background(Capsule().fill(ChatTint.accent))
                    }
                    .buttonStyle(PressableStyle(scale: 0.95))
                }
            }
            ForEach(Array(detail.members.enumerated()), id: \.element.id) { index, person in
                ChatPersonRow(person: person) {
                    if canManage {
                        Button {
                            Haptic.warning()
                            removing = person
                        } label: {
                            Image(systemName: "minus.circle.fill")
                                .font(.system(size: 22))
                                .foregroundStyle(Color.neonDanger)
                        }
                        .buttonStyle(PressableStyle(scale: 0.9))
                        .accessibilityLabel(L("Remove"))
                    }
                }
                .staggered(index)
            }
        }
    }

    // MARK: - Actions

    private func load() async {
        do {
            let loaded = try await api.fetchChatGroup(slug: slug)
            detail = loaded.value
            cachedAt = loaded.cachedAt
            if name.isEmpty || name == detail?.name { name = loaded.value.name }
            problem = nil
        } catch {
            if detail == nil { problem = error.localizedDescription }
        }
    }

    private func rename(to newName: String) async {
        guard let detail else { return }
        do {
            try await api.updateChatGroup(id: detail.id, name: newName)
            Haptic.success()
            Toast.success(L("Group renamed"))
            await load()
            onChanged(newName, self.detail?.avatar)
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }

    private func changePhoto(_ image: UIImage) async {
        guard let detail, let upload = UploadMaker.photo(image, name: "group.jpg") else { return }
        uploading = true
        defer { uploading = false }
        do {
            try await api.updateChatGroup(id: detail.id, photo: upload)
            Haptic.success()
            Toast.success(L("Photo updated"))
            await load()
            onChanged(self.detail?.name ?? detail.name, self.detail?.avatar)
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }

    private func add(_ ids: [String]) async {
        guard let detail, !ids.isEmpty else { return }
        do {
            try await api.setChatGroupMembers(id: detail.id, add: ids)
            Haptic.success()
            await load()
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }

    private func remove(_ person: ChatPerson) async {
        guard let detail else { return }
        do {
            try await api.setChatGroupMembers(id: detail.id, remove: [person.id])
            Haptic.success()
            await load()
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }

    private func deleteGroup(_ detail: ChatGroupDetail) async {
        do {
            try await api.deleteChatGroup(id: detail.id)
            Haptic.success()
            Toast.success(L("Group deleted"))
            dismiss()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { onDeleted() }
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }
}

/// Picks people to add to a group: everyone `get/chat/people` offers who is not in it yet.
struct ChatMemberPickerSheet: View {
    let excluding: Set<String>
    let onAdd: ([String]) async -> Void

    @EnvironmentObject private var api: APIClient
    @Environment(\.dismiss) private var dismiss
    @State private var people: [ChatPerson]?
    @State private var problem: String?
    @State private var selected: Set<String> = []
    @State private var query = ""

    var body: some View {
        SheetScaffold(
            L("Add members"),
            symbol: "person.badge.plus",
            primaryTitle: selected.isEmpty ? L("Add") : L("Add %d", selected.count),
            primaryKind: .brand,
            isPrimaryEnabled: !selected.isEmpty
        ) {
            await onAdd(Array(selected))
            dismiss()
        } content: {
            SearchField(text: $query, prompt: L("Search people"))
            if let people {
                let shown = people.filter { !excluding.contains($0.id) && $0.id != "manager" && matchesSearch(query, $0.name, $0.role) }
                if shown.isEmpty {
                    EmptyState(symbol: "person.crop.circle.badge.checkmark", title: L("Everyone is already in"))
                }
                ForEach(shown) { person in
                    let on = selected.contains(person.id)
                    Button {
                        Haptic.selection()
                        withNeonAnimation(NeonMotion.snappy) {
                            if on { selected.remove(person.id) } else { selected.insert(person.id) }
                        }
                    } label: {
                        ChatPersonRow(person: person) {
                            Image(systemName: on ? "checkmark.circle.fill" : "circle")
                                .font(.system(size: 24, weight: .semibold))
                                .foregroundStyle(on ? AnyShapeStyle(ChatTint.accent) : AnyShapeStyle(Color.neonInk.opacity(0.2)))
                        }
                    }
                    .buttonStyle(.pressableCard)
                }
            } else if let problem {
                ErrorState(message: problem) { await load() }
            } else {
                SkeletonRows(count: 4)
            }
        }
        .task { await load() }
        .neonSheet([.large])
    }

    private func load() async {
        do {
            people = try await api.fetchChatPeople()
            problem = nil
        } catch {
            if people == nil { problem = error.localizedDescription }
        }
    }
}
