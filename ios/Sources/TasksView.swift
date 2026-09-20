import SwiftUI

/// The day's work: what is on this person's plate, and the one move they are
/// allowed to make on it.
struct TasksView: View {
    @EnvironmentObject private var api: APIClient

    @State private var tasks: [EmployeeTask] = []
    @State private var day = "today"
    @State private var loading = true
    @State private var message: String?

    private let days = ["today", "tomorrow", "open"]

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                picker
                content
            }
            .neonAmbientBackground()
            .navigationTitle(L("My Work"))
            .navigationBarTitleDisplayMode(.large)
            .task { await load() }
            .refreshable { await load() }
        }
    }

    private var picker: some View {
        Picker("", selection: $day) {
            ForEach(days, id: \.self) { key in
                Text(L(key == "today" ? "Today" : key == "tomorrow" ? "Tomorrow" : "All open")).tag(key)
            }
        }
        .pickerStyle(.segmented)
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
        .onChange(of: day) { _ in Task { await load() } }
    }

    @ViewBuilder
    private var content: some View {
        if loading && tasks.isEmpty {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let message, tasks.isEmpty {
            VStack(spacing: 12) {
                Text(message)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(Color.neonInk.opacity(0.65))
                    .padding(.horizontal, 32)
                Button(L("Retry")) { Task { await load() } }.buttonStyle(.pressable)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if tasks.isEmpty {
            // Never "you did nothing": an empty day is a day with nothing
            // planned on it, which is a different statement about a different
            // thing — the same refusal the manager's day board makes.
            Text(L("Nothing planned for today."))
                .foregroundStyle(Color.neonInk.opacity(0.6))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                LazyVStack(spacing: 10) {
                    ForEach(tasks) { task in
                        NavigationLink {
                            TaskDetailView(task: task, onChange: { await load() })
                        } label: {
                            TaskRow(task: task)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(16)
            }
        }
    }

    private func load() async {
        message = nil
        do {
            tasks = try await api.fetchTasks(day: day)
        } catch {
            tasks = []
            message = L("Couldn't load your work.")
        }
        loading = false
    }
}

private struct TaskRow: View {
    let task: EmployeeTask

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                Text(task.step.name)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color.neonInk)
                Spacer(minLength: 8)
                BadgeView(text: TaskStateLabel.text(task.state), tone: TaskStateLabel.tone(task.state))
            }

            Text(task.project.name)
                .font(.system(size: 13))
                .foregroundStyle(Color.neonInk.opacity(0.6))

            if task.isBlocked {
                // Said as the employee's own answer, never as a verdict on them.
                Label(task.blockedReason ?? "", systemImage: "exclamationmark.triangle.fill")
                    .font(.system(size: 12))
                    .foregroundStyle(Color.neonOrangeStrong)
                    .lineLimit(2)
            }

            if let due = task.dueDate {
                Label {
                    Text(due, style: .date)
                } icon: {
                    Image(systemName: "clock")
                }
                .font(.system(size: 12))
                .foregroundStyle(Color.neonInk.opacity(0.55))
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassCard()
    }
}

/// One task, and what finishing it means.
struct TaskDetailView: View {
    let task: EmployeeTask
    let onChange: () async -> Void

    @EnvironmentObject private var api: APIClient
    @State private var state: String
    @State private var working = false
    @State private var refusal: String?

    init(task: EmployeeTask, onChange: @escaping () async -> Void) {
        self.task = task
        self.onChange = onChange
        _state = State(initialValue: task.state)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header

                if let deliverable = task.effectiveDeliverable, !deliverable.isEmpty {
                    section(L("What to hand in"), body: deliverable)
                }

                // One line per item, because each is checked on its own when
                // the photo arrives.
                if !task.acceptanceLines.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(L("Counts as done when"))
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Color.neonInk.opacity(0.55))
                        ForEach(Array(task.acceptanceLines.enumerated()), id: \.offset) { _, line in
                            HStack(alignment: .top, spacing: 8) {
                                Circle().fill(Color.neonPurple).frame(width: 5, height: 5).padding(.top, 7)
                                Text(line).font(.system(size: 15)).foregroundStyle(Color.neonInk)
                            }
                        }
                    }
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .glassCard()
                }

                if let note = task.adminNote, !note.isEmpty {
                    section(L("From the manager"), body: note)
                }

                controls
            }
            .padding(16)
        }
        .neonAmbientBackground()
        .navigationTitle(task.step.name)
        .navigationBarTitleDisplayMode(.inline)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(task.project.name)
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(Color.neonInk)
            Text(task.project.clientName)
                .font(.system(size: 13))
                .foregroundStyle(Color.neonInk.opacity(0.6))
            BadgeView(text: TaskStateLabel.text(state), tone: TaskStateLabel.tone(state))
                .padding(.top, 4)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassCard()
    }

    private func section(_ title: String, body: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.neonInk.opacity(0.55))
            Text(body)
                .font(.system(size: 15))
                .foregroundStyle(Color.neonInk)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassCard()
    }

    @ViewBuilder
    private var controls: some View {
        // Only the two moves an employee has. Finishing is a photo and
        // approving is the manager's, so neither is offered here — a button
        // that always fails reads as a broken app rather than as a boundary.
        if state == "SUBMITTED" || state == "DONE" {
            Text(state == "DONE"
                 ? L("The manager has approved this.")
                 : L("This is with the manager for review."))
                .font(.system(size: 14))
                .foregroundStyle(Color.neonInk.opacity(0.6))
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14)
                .glassCard()
        } else {
            Button {
                Task { await move(state == "IN_PROGRESS" ? "TODO" : "IN_PROGRESS") }
            } label: {
                Text(state == "IN_PROGRESS" ? L("Stop working on this") : L("Start working on this"))
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .fill(state == "IN_PROGRESS" ? Color.neonInk.opacity(0.6) : Color.neonPurple)
                    )
            }
            .disabled(working)
        }

        if let refusal {
            Text(refusal)
                .font(.system(size: 13))
                .foregroundStyle(Color.neonOrangeStrong)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func move(_ next: String) async {
        working = true
        refusal = nil
        do {
            try await api.setTaskState(id: task.id, state: next)
            state = next
            Haptic.success()
            await onChange()
        } catch {
            refusal = L("That move wasn't allowed.")
            Haptic.error()
        }
        working = false
    }
}
