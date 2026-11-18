import { NeonLoader } from "@/components/ui/neon-loader";
// The admin equivalent: paint the frame immediately, fill in the data when it
// arrives, rather than leaving the previous page on screen.
export default function AdminLoading() {
  // The NEON mark, animated (components/ui/neon-loader.tsx) — it replaced the
  // grey placeholder blocks on 2026-11-18.
  return <NeonLoader />;
}
