import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Fraunces, Inter, Noto_Kufi_Arabic } from "next/font/google";
import "./globals.css";

// The Studio type, for every surface — the team's portal, the admin and the
// client's page (chosen 2026-11-18): a serif for headings, Inter for reading,
// and an Arabic face drawn to sit beside them, because names, rooms and reports
// here are Arabic as often as not and the system's fallback beside Inter looked
// like a different app. The variable names are the ones every component
// already reads (`font-display`, `font-sans`), so nothing else had to change.
const displayFont = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  axes: ["opsz"],
});

const sansFont = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const arabicFont = Noto_Kufi_Arabic({
  variable: "--font-arabic",
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: {
    default: "Client Portal · NEON",
    template: "%s · NEON",
  },
  description: "NEON Design & Programming — private client project delivery portal.",
  robots: {
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#f6f2ec",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${displayFont.variable} ${sansFont.variable} ${arabicFont.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background">{children}</body>
    </html>
  );
}
