#if targetEnvironment(macCatalyst)
import SwiftUI

// MARK: - Brain queue (/api/brain) — every AI request is answered by Claude in the chat session

struct BrainRequest: Codable, Hashable, Identifiable {
    var id: String; var kind: String; var title: String; var created: String; var status: String
    var answer: String?; var answered_at: String?
    var statusLabel: String { status == "done" ? "جاوب ✓" : status == "working" ? "عم يشتغل عليه…" : "بالطابور" }
}
struct BrainSummary: Codable { var online: Bool; var pending: Int; var items: [BrainRequest] }

extension Store {
    /// Queue an AI request for Claude. Returns true when queued.
    @discardableResult
    func askBrain(_ kind: String, _ title: String, _ payload: [String: String] = [:]) async -> Bool {
        struct Body: Encodable { var kind: String; var title: String; var payload: [String: String] }
        do {
            try await API.post("/api/brain/ask", json: Body(kind: kind, title: title, payload: payload))
            toast = "انبعت لـ Claude ✓ — الجواب بيطلع بـ «مكتبي»"
            await refreshBrain()
            return true
        } catch { toast = error.localizedDescription; return false }
    }
    func refreshBrain() async { brain = try? await API.get("/api/brain", timeout: 10) }
}

struct BrainPanel: View {
    @ObservedObject var store = Store.shared
    @State private var question = ""
    @State private var expanded: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: "brain.head.profile").font(.title2).foregroundStyle(Brand.accent)
                VStack(alignment: .leading, spacing: 1) {
                    Text("اسأل مسؤول التسويق").font(.title3.bold())
                    HStack(spacing: 5) {
                        Circle().fill(store.brain?.online == true ? Brand.ok : Brand.gray).frame(width: 7, height: 7)
                        Text(store.brain?.online == true ? "Claude متصل — بيجاوب هلأ" : "Claude مش فاتح هلأ — طلبك بيستنى لما يرجع")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                Spacer()
                Button { Task { await store.askBrain("new_brief", "اقترح فيديو إعلان جديد مع التعليمات") } } label: {
                    Label("اقترح فيديو جديد", systemImage: "wand.and.stars")
                }.glassButton()
            }
            HStack(alignment: .bottom, spacing: 8) {
                TextField("مثلاً: شو أحسن عرض لشهر 12؟ ليش المحادثات قلّت اليوم؟", text: $question, axis: .vertical)
                    .lineLimit(1...4).textFieldStyle(.roundedBorder)
                    .onSubmit(send)
                Button(action: send) { Label("ابعت", systemImage: "paperplane.fill") }
                    .buttonStyle(.borderedProminent).controlSize(.large)
                    .disabled(question.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            ForEach((store.brain?.items ?? []).prefix(6)) { r in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Image(systemName: r.status == "done" ? "checkmark.bubble.fill" : "ellipsis.bubble.fill")
                            .foregroundStyle(r.status == "done" ? Brand.ok : Brand.warn)
                        Text(r.title).font(.callout.bold()).lineLimit(1)
                        Spacer()
                        Pill(text: r.statusLabel, color: r.status == "done" ? Brand.ok : Brand.warn)
                    }
                    if let a = r.answer {
                        Text(.init(a))
                            .font(.callout)
                            .lineLimit(expanded == r.id ? nil : 4)
                            .fixedSize(horizontal: false, vertical: expanded == r.id)
                            .textSelection(.enabled)
                        Button(expanded == r.id ? "أقل" : "اقرأ الجواب كامل") { expanded = expanded == r.id ? nil : r.id }
                            .buttonStyle(.borderless).font(.caption)
                    }
                }
                .padding(10)
                .background(RoundedRectangle(cornerRadius: 12).fill(Color.primary.opacity(0.04)))
            }
        }
        .padding(16)
        .glassCard(18)
        .task {
            await store.refreshBrain()
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: ((store.brain?.pending ?? 0) > 0 ? 6 : 30) * 1_000_000_000)
                await store.refreshBrain()
            }
        }
    }

    func send() {
        let q = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return }
        question = ""
        Task { await store.askBrain("ask", String(q.prefix(80)), ["question": q]) }
    }
}

#endif
