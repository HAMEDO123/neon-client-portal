import PhotosUI
import SwiftUI

// Starting a conversation and looking after groups. The manager makes groups
// of employees (the manager is always in one); anybody can open a private
// chat with someone from `get/chat/people`.

// MARK: - New chat

struct ChatNewConversationSheet: View {
    let isManager: Bool
    /// Who is here right now, by conversation slug (a person's id, or
    /// "manager") — the same green dots the list shows.
    var onlineIds: Set<String> = []
    /// Opens the conversation once the sheet has gone.
    let onOpen: (ChatRoute) -> Void

    @EnvironmentObject private var api: APIClient
    @Environment(\.dismiss) private var dismiss
    @State private var people: [ChatPerson]?
    @State private var problem: String?
    @State private var query = ""

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                SheetHeader(
                    L("New chat"),
                    subtitle: isManager ? L("Message someone, or make a group") : L("Message someone at the studio"),
                    symbol: "square.and.pencil"
                )
                ScrollView {
                    VStack(alignment: .leading, spacing: NeonSpace.stack) {
                        if isManager {
                            NavigationLink {
                                ChatGroupForm(people: (people ?? []).filter { $0.id != "manager" }, onlineIds: onlineIds) { route in
                                    open(route)
                                }
                            } label: {
                                ChatListActionTile(
                                    title: L("New group"),
                                    detail: L("Name it, add a photo, pick who is in"),
                                    symbol: "person.3.fill",
                                    hue: .purple
                                )
                            }
                            .buttonStyle(.pressableCard)
                            .neonAppear()
                        }

                        SearchField(text: $query, prompt: L("Search people"))
                            .padding(.top, 4)

                        if let people {
                            let shown = people.filter { matchesSearch(query, $0.name, $0.role) }
                            SectionHeader(L("Message someone"), count: shown.isEmpty ? nil : shown.count)
                                .padding(.top, 4)
                            if shown.isEmpty {
                                EmptyState(symbol: query.isEmpty ? "person.2" : "magnifyingglass",
                                           title: query.isEmpty ? L("No one to message yet") : L("No matches"),
                                           hue: .indigo, card: true)
                            } else {
                                CardList(shown, dividerInset: 72) { person in
                                    Button {
                                        Haptic.tap()
                                        open(ChatRoute(slug: person.id, title: person.name, subtitle: person.role, avatar: person.avatar, isGroup: false))
                                    } label: {
                                        ChatPersonRow(person: person, online: onlineIds.contains(person.id)) {
                                            IconTile("bubble.left.fill", hue: .indigo, size: 34)
                                        }
                                    }
                                    .buttonStyle(.pressable)
                                }
                                .neonAppear(delay: 0.05)
                            }
                        } else if let problem {
                            ErrorState(message: problem) { await load() }
                        } else {
                            SkeletonRows(count: 4)
                        }
                    }
                    .padding(.horizontal, NeonSpace.gutter)
                    .padding(.bottom, NeonSpace.xxl)
                    .animation(NeonMotion.smooth, value: people == nil)
                }
                .scrollDismissesKeyboard(.interactively)
            }
            .background(NeonAmbient().ignoresSafeArea())
            .toolbar(.hidden, for: .navigationBar)
        }
        .task { await load() }
        .neonSheet([.large])
    }

    private func open(_ route: ChatRoute) {
        dismiss()
        // Let the sheet finish leaving before the push, or the push is lost.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { onOpen(route) }
    }

    private func load() async {
        do {
            let loaded = try await api.fetchChatPeople()
            withNeonAnimation(NeonMotion.smooth) { people = loaded }
            problem = nil
        } catch {
            if people == nil { problem = error.localizedDescription }
        }
    }
}

/// A person inside a card of people: their face in the colour the studio
/// gave them, their name and what they do, and whatever goes on the trailing side.
struct ChatPersonRow<Trailing: View>: View {
    let person: ChatPerson
    var online = false
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(spacing: NeonSpace.md) {
            ChatAvatar(url: person.avatarURL, name: person.name, size: 44, color: person.color, online: online)
            VStack(alignment: .leading, spacing: 2) {
                DirText(person.name, font: .neonRowTitle, fill: false, lineLimit: 1)
                if let role = person.role, !role.isEmpty {
                    DirText(role, font: .neonSubtitle, color: .neonTextSecondary, fill: false, lineLimit: 1)
                }
            }
            Spacer(minLength: 8)
            trailing()
        }
        .padding(.horizontal, NeonSpace.card)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Choosing people

/// People to tick, in one card, with who is chosen so far as chips above it —
/// making a group and adding to one read the same.
private struct ChatPeoplePicker: View {
    let people: [ChatPerson]
    @Binding var selected: Set<String>
    var onlineIds: Set<String> = []
    var emptyTitle: String

    @State private var query = ""

    var body: some View {
        let chosen = people.filter { selected.contains($0.id) }
        let shown = people.filter { matchesSearch(query, $0.name, $0.role) }
        VStack(alignment: .leading, spacing: NeonSpace.stack) {
            if !chosen.isEmpty {
                FlowRow(spacing: 6) {
                    ForEach(chosen) { person in
                        PersonChip(name: person.name, url: person.avatarURL, isSelected: true) {
                            withNeonAnimation(NeonMotion.snappy) { _ = selected.remove(person.id) }
                        }
                        .transition(.neonPop)
                    }
                }
            }
            SearchField(text: $query, prompt: L("Search people"))
            if people.isEmpty {
                EmptyState(symbol: "person.2", title: emptyTitle, hue: .indigo, card: true)
            } else if shown.isEmpty {
                EmptyState(symbol: "magnifyingglass", title: L("No matches"), hue: .indigo, card: true)
            } else {
                CardList(shown, dividerInset: 72) { person in
                    let on = selected.contains(person.id)
                    Button {
                        Haptic.selection()
                        withNeonAnimation(NeonMotion.snappy) {
                            if on { selected.remove(person.id) } else { selected.insert(person.id) }
                        }
                    } label: {
                        ChatPersonRow(person: person, online: onlineIds.contains(person.id)) {
                            CheckCircle(on, hue: .indigo)
                        }
                        .background(on ? NeonHue.indigo.wash.opacity(0.7) : Color.clear)
                    }
                    .buttonStyle(.pressable)
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
            }
        }
        .animation(NeonMotion.snappy, value: selected)
    }
}

// MARK: - A group's photo

/// The round photo a group is shown with, and the picker that changes it.
private struct ChatGroupPhotoPicker: View {
    let image: UIImage?
    let currentURL: URL?
    let name: String
    var size: CGFloat = 104
    let onPick: (UIImage) -> Void

    @State private var item: PhotosPickerItem?

    var body: some View {
        PhotosPicker(selection: $item, matching: .images) {
            ZStack(alignment: .bottomTrailing) {
                Group {
                    if let image {
                        Image(uiImage: image).resizable().scaledToFill()
                            .frame(width: size, height: size)
                            .clipShape(Circle())
                            .transition(.neonPop)
                    } else {
                        ChatAvatar(url: ChatFace.isStudioIcon(currentURL) ? nil : currentURL,
                                   name: name.isEmpty ? "?" : name, size: size, isGroup: true)
                    }
                }
                .padding(4)
                .background(Circle().strokeBorder(AngularGradient.neonStory, lineWidth: 3))
                .neonShadow(.card)
                Image(systemName: "camera.fill")
                    .font(.system(.footnote, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 34, height: 34)
                    .background(Circle().fill(LinearGradient.neonAction))
                    .overlay(Circle().strokeBorder(Color.white, lineWidth: 2.5))
                    .neonShadow(.glow(.neonIndigo))
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
    var onlineIds: Set<String> = []
    let onCreated: (ChatRoute) -> Void

    @EnvironmentObject private var api: APIClient
    @State private var name = ""
    @State private var photo: UIImage?
    @State private var selected: Set<String> = []
    @State private var attempts = 0

    private var isValid: Bool { !name.trimmingCharacters(in: .whitespaces).isEmpty && !selected.isEmpty }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: NeonSpace.lg) {
                    VStack(spacing: 8) {
                        ChatGroupPhotoPicker(image: photo, currentURL: nil, name: name) { picked in
                            withNeonAnimation(NeonMotion.bouncy) { photo = picked }
                        }
                        Text(photo == nil ? L("Add a photo") : L("Change photo"))
                            .font(.system(.footnote, weight: .semibold))
                            .foregroundStyle(Color.neonAccent)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 8)
                    .neonAppear()

                    FormSection(L("Group")) {
                        NeonTextField(L("Group name"), text: $name, prompt: L("e.g. Villa project"), symbol: "person.3", isRequired: true)
                    }

                    SectionHeader(L("Members"), subtitle: selected.isEmpty ? L("Pick at least one person") : L("%d chosen", selected.count))
                        .id("members")
                    ChatPeoplePicker(people: people, selected: $selected, onlineIds: onlineIds, emptyTitle: L("No one to add yet"))
                }
                .padding(NeonSpace.gutter)
                .shake(attempts)
            }
            .scrollDismissesKeyboard(.interactively)
            #if DEBUG
            .debugScroll(proxy)
            #endif
        }
        .safeAreaInset(edge: .bottom) {
            NeonButton(selected.isEmpty ? L("Create group") : L("Create group with %d", selected.count), symbol: "sparkles", kind: .brand) {
                await create()
            }
            .disabled(!isValid)
            .padding(.horizontal, NeonSpace.gutter)
            .padding(.top, 10)
            .padding(.bottom, 8)
            .background(
                Rectangle()
                    .fill(.ultraThinMaterial)
                    .overlay(alignment: .top) { NeonDivider() }
                    .ignoresSafeArea()
            )
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
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: NeonSpace.stack) {
                        if let detail {
                            header(detail)
                            if let cachedAt { OfflineBanner(savedAt: cachedAt) }
                            if canManage { renameCard(detail) }
                            members(detail).id("members")
                            if canManage {
                                NeonButton(L("Delete group"), symbol: "trash", kind: .destructive,
                                           confirm: L("Delete this group?"),
                                           confirmMessage: L("Its messages are deleted for everyone.")) { await deleteGroup(detail) }
                                    .padding(.top, 8)
                                    .id("delete")
                            }
                        } else if let problem {
                            ErrorState(message: problem) { await load() }
                        } else {
                            SkeletonCard(lines: 2)
                            SkeletonRows(count: 4)
                        }
                    }
                    .padding(NeonSpace.gutter)
                    .animation(NeonMotion.smooth, value: detail == nil)
                }
                .refreshable { await load() }
                #if DEBUG
                .debugScroll(proxy)
                #endif
            }
            .background(NeonAmbient().ignoresSafeArea())
            .navigationTitle(L("Group info"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Done")) { dismiss() }
                        .fontWeight(.semibold)
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

    /// The group on the brand's gradient: its photo (which the manager can
    /// change), its name, and who is in it.
    private func header(_ detail: ChatGroupDetail) -> some View {
        VStack(spacing: NeonSpace.md) {
            Group {
                if canManage {
                    ChatGroupPhotoPicker(image: nil, currentURL: detail.avatarURL, name: detail.name, size: 96) { image in
                        Task { await changePhoto(image) }
                    }
                    .overlay { if uploading { ProgressView().tint(.white).controlSize(.large) } }
                } else {
                    ChatAvatar(url: ChatFace.isStudioIcon(detail.avatarURL) ? nil : detail.avatarURL, name: detail.name, size: 96, isGroup: true)
                        .padding(4)
                        .background(Circle().strokeBorder(Color.white.opacity(0.7), lineWidth: 3))
                }
            }
            .neonFloat(3)
            VStack(spacing: 4) {
                DirText(detail.name, font: .neonDisplay, color: .white, fill: false, lineLimit: 2)
                Text(L("%d members", detail.members.count))
                    .font(.system(.subheadline, weight: .medium))
                    .foregroundStyle(.white.opacity(0.85))
            }
            if !detail.members.isEmpty {
                AvatarStack(detail.members.map { AvatarItem(id: $0.id, name: $0.name, url: $0.avatarURL) }, size: 30, limit: 6)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, NeonSpace.xxl)
        .padding(.horizontal, NeonSpace.card)
        .neonSurface(.brand, radius: NeonRadius.xl)
        .neonAppear()
    }

    private func renameCard(_ detail: ChatGroupDetail) -> some View {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return FormSection(L("Name")) {
            NeonTextField(L("Group name"), text: $name, symbol: "pencil")
            if !trimmed.isEmpty && trimmed != detail.name {
                NeonButton(L("Save name"), symbol: "checkmark", kind: .tinted(.neonIndigoStrong), size: .medium) {
                    await rename(to: trimmed)
                }
                .transition(.neonPop)
            }
        }
        .animation(NeonMotion.snappy, value: trimmed == detail.name)
    }

    private func members(_ detail: ChatGroupDetail) -> some View {
        SectionCard(L("Members"), subtitle: L("The manager is in every group."), symbol: "person.2.fill", hue: .indigo) {
            if detail.members.isEmpty {
                Text(L("No one else is in it yet."))
                    .font(.neonLabel)
                    .foregroundStyle(Color.neonTextSecondary)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(detail.members.enumerated()), id: \.element.id) { index, person in
                        if index > 0 { NeonDivider().padding(.leading, 56) }
                        ChatPersonRow(person: person) {
                            if canManage {
                                Button {
                                    Haptic.warning()
                                    removing = person
                                } label: {
                                    Image(systemName: "minus.circle.fill")
                                        .font(.system(.title3))
                                        .foregroundStyle(Color.neonDanger)
                                        .frame(width: NeonSize.touch, height: NeonSize.touch)
                                        .contentShape(Rectangle())
                                }
                                .buttonStyle(PressableStyle(scale: 0.9))
                                .accessibilityLabel(L("Remove"))
                            }
                        }
                        .padding(.horizontal, -NeonSpace.card)
                        .staggered(index)
                    }
                }
            }
        } trailing: {
            if canManage {
                ViewAllButton(L("Add"), hue: .indigo, chevron: false) { showAdd = true }
            }
        }
    }

    // MARK: - Actions

    private func load() async {
        do {
            let loaded = try await api.fetchChatGroup(slug: slug)
            withNeonAnimation(NeonMotion.smooth) {
                detail = loaded.value
                cachedAt = loaded.cachedAt
            }
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

    var body: some View {
        SheetScaffold(
            L("Add members"),
            subtitle: L("Everyone at the studio who is not in it yet"),
            symbol: "person.badge.plus",
            primaryTitle: selected.isEmpty ? L("Add") : L("Add %d", selected.count),
            primaryKind: .brand,
            isPrimaryEnabled: !selected.isEmpty
        ) {
            await onAdd(Array(selected))
            dismiss()
        } content: {
            if let people {
                let offered = people.filter { !excluding.contains($0.id) && $0.id != "manager" }
                if offered.isEmpty {
                    EmptyState(symbol: "person.crop.circle.badge.checkmark", title: L("Everyone is already in"), hue: .green, card: true)
                } else {
                    ChatPeoplePicker(people: offered, selected: $selected, emptyTitle: L("Everyone is already in"))
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
            let loaded = try await api.fetchChatPeople()
            withNeonAnimation(NeonMotion.smooth) { people = loaded }
            problem = nil
        } catch {
            if people == nil { problem = error.localizedDescription }
        }
    }
}
