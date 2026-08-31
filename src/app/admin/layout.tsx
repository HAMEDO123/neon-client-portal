import type { Metadata } from "next";
import type { ReactNode } from "react";

// iOS Safari doesn't reliably read display/theme info from manifest.json for
// "Add to Home Screen" — the apple-specific tags below are what actually make
// it launch full-screen instead of opening as a regular browser tab.
export const metadata: Metadata = {
  title: { absolute: "NEON Admin" },
  manifest: "/admin-manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "NEON Admin",
    statusBarStyle: "black-translucent",
  },
  icons: {
    apple: "/admin-icon-180.png",
  },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return children;
}
