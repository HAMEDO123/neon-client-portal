import Foundation

// The Home area's calls into `src/lib/mobile/registry/home.ts`. Reads return
// `Loaded<T>`; actions post `.neonDataChanged` on success, so open screens
// re-read on their own.
extension APIClient {
    func fetchHomeOverview() async throws -> Loaded<HomeOverview> {
        try await read("home/overview", as: HomeOverview.self)
    }

    func fetchHomeDay() async throws -> Loaded<HomeDay> {
        try await read("home/day", as: HomeDay.self)
    }

    func fetchHomeNow() async throws -> Loaded<HomeNow> {
        try await read("home/now", as: HomeNow.self)
    }

    func fetchHomeAlerts() async throws -> Loaded<HomeAlerts> {
        try await read("home/alerts", as: HomeAlerts.self)
    }

    func fetchHomeReviews() async throws -> Loaded<HomeReviews> {
        try await read("home/reviews", as: HomeReviews.self)
    }

    func fetchHomeAnalytics(period: String?, day: String?) async throws -> Loaded<HomeAnalytics> {
        try await read("home/analytics", ["period": period, "day": day], as: HomeAnalytics.self)
    }

    @discardableResult
    func clearHomeAlerts() async throws -> ActionOutcome {
        try await perform("home/clearAlerts")
    }

    @discardableResult
    func markHomeAlertRead(_ id: String) async throws -> ActionOutcome {
        try await perform("home/markAlertRead", args: [id])
    }

    @discardableResult
    func approveHomeSubmission(_ id: String, note: String) async throws -> ActionOutcome {
        try await perform("home/approveSubmission", args: [id], form: ["reviewNote": note])
    }

    @discardableResult
    func rejectHomeSubmission(_ id: String, note: String) async throws -> ActionOutcome {
        try await perform("home/rejectSubmission", args: [id], form: ["reviewNote": note])
    }

    @discardableResult
    func applyHomeDeductions(period: String) async throws -> ActionOutcome {
        try await perform("home/applyDeductions", args: [period])
    }
}
