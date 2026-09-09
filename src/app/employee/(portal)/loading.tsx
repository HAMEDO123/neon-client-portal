// Shown the instant a tab is tapped, while the server fetches.
//
// Without it the browser sits on the old page until the response arrives, so
// a slow query reads as a frozen app. With it the new screen paints straight
// away and fills in — the tap always feels answered.
export default function EmployeeLoading() {
  return (
    <div className="flex animate-pulse flex-col gap-5" aria-busy="true" aria-label="Loading">
      <div>
        <div className="h-6 w-48 rounded-lg bg-ink/8" />
        <div className="mt-2 h-4 w-64 rounded-lg bg-ink/5" />
      </div>

      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((row) => (
          <div key={row} className="rounded-2xl border border-ink/8 bg-white/50 p-4">
            <div className="h-4 w-20 rounded-full bg-ink/8" />
            <div className="mt-3 h-5 w-2/3 rounded-lg bg-ink/8" />
            <div className="mt-2 h-3 w-1/3 rounded-lg bg-ink/5" />
            <div className="mt-4 h-5 w-24 rounded-full bg-ink/5" />
          </div>
        ))}
      </div>
    </div>
  );
}
