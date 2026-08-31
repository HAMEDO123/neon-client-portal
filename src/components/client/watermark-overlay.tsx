export function WatermarkOverlay({ label = "NEON DESIGN · CONFIDENTIAL" }: { label?: string }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-[1] flex flex-wrap content-around justify-around overflow-hidden opacity-[0.16]"
    >
      {Array.from({ length: 12 }).map((_, i) => (
        <span key={i} className="rotate-[-24deg] whitespace-nowrap text-xs font-semibold tracking-widest text-white mix-blend-difference">
          {label}
        </span>
      ))}
    </div>
  );
}
