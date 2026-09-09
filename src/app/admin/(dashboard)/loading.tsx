// The admin equivalent: paint the frame immediately, fill in the data when it
// arrives, rather than leaving the previous page on screen.
export default function AdminLoading() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="h-7 w-56 rounded-lg bg-ink/8" />
      <div className="mt-2 h-4 w-80 rounded-lg bg-ink/5" />

      <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[0, 1, 2, 3].map((card) => (
          <div key={card} className="h-24 rounded-2xl border border-ink/8 bg-white/50" />
        ))}
      </div>

      <div className="mt-8 flex flex-col gap-3">
        {[0, 1, 2].map((row) => (
          <div key={row} className="h-20 rounded-2xl border border-ink/8 bg-white/50" />
        ))}
      </div>
    </div>
  );
}
