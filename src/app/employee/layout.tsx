import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

// The employee portal installs as its own home-screen app, separate from the
// admin one: employees mostly live on a phone, and push arrives there.
export const metadata: Metadata = {
  title: { absolute: "NEON Tasks" },
  manifest: "/employee-manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "NEON Tasks",
    statusBarStyle: "black-translucent",
  },
  icons: {
    apple: "/admin-icon-180.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#15131f",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
  // Employees tap checkboxes and status chips one-handed; a stray double-tap
  // should not zoom the page.
  maximumScale: 1,
  viewportFit: "cover",
};

export default function EmployeeLayout({ children }: { children: ReactNode }) {
  return children;
}
