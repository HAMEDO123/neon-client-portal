import { NeonLoader } from "@/components/ui/neon-loader";
// Shown the instant a tab is tapped, while the server fetches.
//
// Without it the browser sits on the old page until the response arrives, so
// a slow query reads as a frozen app. With it the new screen paints straight
// away and fills in — the tap always feels answered.
export default function EmployeeLoading() {
  // The NEON mark, animated (components/ui/neon-loader.tsx) — it replaced the
  // grey placeholder blocks on 2026-11-18.
  return <NeonLoader />;
}
