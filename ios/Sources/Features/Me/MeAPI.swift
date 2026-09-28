import Foundation

// The rest of the team's own side, added to the server's registry
// (`src/lib/mobile/registry/me.ts`, keys "me/…") rather than the app's
// original handful of routes. See ios/ARCHITECTURE.md §1: an action posts
// checkbox-shaped fields as the literal string "on" or leaves them out,
// exactly as the website's own <form> would — the server actions this calls
// read them with `formData.get(name) === "on"`.
extension APIClient {
    // MARK: - Jobs handed out by hand (AssignedTask)

    func fetchJobs(filter: TaskFilter) async throws -> Loaded<[MyAssignedJob]> {
        let loaded = try await read("me/jobs", ["filter": filter.rawValue], as: AssignedJobsResponse.self)
        return Loaded(value: loaded.value.jobs, cachedAt: loaded.cachedAt)
    }

    func fetchJobDetail(id: String) async throws -> Loaded<JobDetailResponse> {
        try await read("me/jobs/detail", ["id": id], as: JobDetailResponse.self)
    }

    // MARK: - What the day asked (follow-up-reply.tsx)

    /// The one open question owed about a board task, if any.
    func fetchFollowUp(entryId: String) async throws -> Loaded<FollowUpQuestion?> {
        try await read("me/tasks/followup", ["entryId": entryId], as: FollowUpQuestion?.self)
    }

    /// One of the four choices `follow-up-reply.tsx` offers, and the note some
    /// of them ask for. Throws the server's sentence when the question is no
    /// longer open — answered already, or the task moved on.
    @discardableResult
    func answerFollowUp(id: String, answer: String, note: String?) async throws -> Bool {
        var args: [Any] = [id, answer]
        let trimmed = note?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !trimmed.isEmpty { args.append(trimmed) }
        let outcome = try await perform("me/tasks/followup/answer", args: args)
        let result = try outcome.result(FollowUpAnswerResult.self)
        if result?.ok == false {
            throw APIError.refused(result?.error ?? L("That didn't go through"))
        }
        return true
    }

    /// TODO or IN_PROGRESS only — the same rule `canMove` enforces server-side:
    /// finishing a job means sending proof, never a status the employee picks.
    @discardableResult
    func setJobStatus(id: String, state: String) async throws -> ActionOutcome {
        try await perform("me/jobs/status", args: [id, state])
    }

    // MARK: - Requests tab

    func fetchRequests() async throws -> Loaded<RequestsResponse> {
        try await read("me/requests", as: RequestsResponse.self)
    }

    @discardableResult
    func createSupplyRequest(item: String, quantity: String, estimatedCost: String, note: String, urgent: Bool) async throws -> ActionOutcome {
        var form: [String: Any] = ["item": item]
        if !quantity.isEmpty { form["quantity"] = quantity }
        if !estimatedCost.isEmpty { form["estimatedCost"] = estimatedCost }
        if !note.isEmpty { form["note"] = note }
        if urgent { form["urgent"] = "on" }
        return try await perform("me/requests/supply/create", form: form)
    }

    @discardableResult
    func cancelSupplyRequest(id: String) async throws -> ActionOutcome {
        try await perform("me/requests/supply/cancel", args: [id])
    }

    @discardableResult
    func submitReceipt(_ file: UploadFile) async throws -> ActionOutcome {
        try await performUpload("me/requests/receipt/submit", files: [file])
    }

    @discardableResult
    func deleteReceipt(id: String) async throws -> ActionOutcome {
        try await perform("me/requests/receipt/delete", args: [id])
    }

    @discardableResult
    func saveDailyReport(text: String) async throws -> ActionOutcome {
        try await perform("me/requests/report/save", form: ["text": text])
    }

    // MARK: - Profile tab

    func fetchProfile() async throws -> Loaded<ProfileResponse> {
        try await read("me/profile", as: ProfileResponse.self)
    }

    @discardableResult
    func savePreferences(_ preferences: ProfilePreferences) async throws -> ActionOutcome {
        var form: [String: Any] = ["deadlineLeadMinutes": preferences.deadlineLeadMinutes]
        if preferences.pushEnabled { form["pushEnabled"] = "on" }
        if preferences.chatMessages { form["chatMessages"] = "on" }
        if preferences.taskAssigned { form["taskAssigned"] = "on" }
        if preferences.taskUpdated { form["taskUpdated"] = "on" }
        if preferences.todaySchedule { form["todaySchedule"] = "on" }
        if preferences.tomorrowSchedule { form["tomorrowSchedule"] = "on" }
        if preferences.deadlineReminders { form["deadlineReminders"] = "on" }
        return try await perform("me/profile/preferences", form: form)
    }

    @discardableResult
    func setProfileDeviceActive(id: String, active: Bool) async throws -> ActionOutcome {
        try await perform("me/profile/device/active", args: [id, active])
    }

    @discardableResult
    func forgetProfileDevice(id: String) async throws -> ActionOutcome {
        try await perform("me/profile/device/forget", args: [id])
    }

    // MARK: - Assign (whoever the manager has trusted to hand work out)

    func fetchAssignTeam() async throws -> Loaded<[AssignTeamMember]> {
        let loaded = try await read("me/assign/team", as: AssignTeamResponse.self)
        return Loaded(value: loaded.value.team, cachedAt: loaded.cachedAt)
    }

    func fetchAssignWeek(week: String?) async throws -> Loaded<AssignWeekResponse> {
        try await read("me/assign/week", ["week": week], as: AssignWeekResponse.self)
    }

    @discardableResult
    func createAssignedJob(form: [String: Any]) async throws -> ActionOutcome {
        try await perform("me/assign/create", form: form)
    }

    @discardableResult
    func updateAssignedJob(id: String, form: [String: Any]) async throws -> ActionOutcome {
        try await perform("me/assign/update", args: [id], form: form)
    }

    @discardableResult
    func deleteAssignedJob(id: String) async throws -> ActionOutcome {
        try await perform("me/assign/delete", args: [id])
    }

    @discardableResult
    func setAssignedJobState(id: String, state: String) async throws -> ActionOutcome {
        try await perform("me/assign/state", args: [id, state])
    }
}
