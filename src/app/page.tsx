import Link from "next/link";
import { Lock } from "lucide-react";

export default function GatewayPage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-6">
      <div className="grid-overlay pointer-events-none absolute inset-0 opacity-60" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[560px] w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-cyan/20 via-purple/10 to-pink/10 blur-3xl" />

      <div className="glass-strong relative z-10 flex w-full max-w-md flex-col items-center rounded-3xl px-10 py-14 text-center">
        <span className="text-gradient-neon text-2xl font-bold tracking-tight">NEON</span>
        <h1 className="mt-4 text-xl font-semibold text-ink">Client Project Delivery Portal</h1>
        <p className="mt-3 flex items-center gap-2 text-sm leading-relaxed text-ink/55">
          <Lock size={14} strokeWidth={1.75} />
          This is a private portal. Open your project using the link shared with you by NEON.
        </p>

        <Link
          href="/admin/login"
          className="mt-8 text-xs font-medium uppercase tracking-[0.2em] text-ink/35 transition-colors hover:text-cyan-strong"
        >
          NEON Team Sign In
        </Link>
      </div>
    </main>
  );
}
