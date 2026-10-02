import Foundation

// Times and distances as the team map says them, in the app's language.

/// "11:00 AM" today, "Sun 11:00 AM" another day.
func locationClock(_ date: Date) -> String {
    let locale = AppLanguage.current.locale
    if Calendar.current.isDateInToday(date) {
        return date.formatted(Date.FormatStyle(date: .omitted, time: .shortened, locale: locale))
    }
    return date.formatted(Date.FormatStyle(locale: locale).weekday(.abbreviated).hour().minute())
}

/// "Just now", "4 min. ago" — how old a position is.
func locationAgo(_ date: Date, now: Date = Date()) -> String {
    if now.timeIntervalSince(date) < 60 { return L("Just now") }
    let formatter = RelativeDateTimeFormatter()
    formatter.locale = AppLanguage.current.locale
    formatter.unitsStyle = .short
    return formatter.localizedString(for: date, relativeTo: now)
}

/// "120 m", "1.4 km" — rounded the way a person says it.
func locationDistance(_ metres: Double) -> String {
    if metres < 1000 {
        let rounded = max(10, Int((metres / 10).rounded()) * 10)
        return L("%d m", rounded)
    }
    let km = metres / 1000
    let text = km < 10
        ? km.formatted(.number.precision(.fractionLength(1)).locale(AppLanguage.current.locale))
        : Int(km.rounded()).formatted(.number.locale(AppLanguage.current.locale))
    return L("%@ km", text)
}
