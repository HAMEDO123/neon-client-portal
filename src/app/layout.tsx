import type { Metadata, Viewport } from "next";
import { cache, type ReactNode } from "react";
import { getColourway } from "@/lib/settings";
import { COLOURWAYS } from "@/lib/colourway";
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

// The colourway the manager chose (lib/colourway.ts), read on every request and
// written as `data-theme` on <html>, where globals.css keys the colours.
//
// Load-bearing: without this line `/`, `/admin/login` and the 404 are
// prerendered at build — where there is no database — and would wear the
// default colourway after every deploy, whatever was chosen. `next dev` never
// prerenders, so nothing there would show it; a test pins the line instead.
// Every other document already renders per request.
export const dynamic = "force-dynamic";

// One read per request, shared by the viewport and the layout.
const colourway = cache(getColourway);

// The phone's status bar in the colourway's own page colour: <meta
// name="theme-color"> takes a literal, so it comes from lib/colourway.ts, which
// a test keeps equal to the stylesheet.
export async function generateViewport(): Promise<Viewport> {
  return {
    themeColor: COLOURWAYS[await colourway()].page,
    colorScheme: "light",
    width: "device-width",
    initialScale: 1,
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      data-theme={await colourway()}
      className={`${displayFont.variable} ${sansFont.variable} ${arabicFont.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background">{children}</body>
    </html>
  );
}
