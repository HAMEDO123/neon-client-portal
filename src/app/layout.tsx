import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Geist, Bricolage_Grotesque, Fraunces, Inter, Noto_Kufi_Arabic } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const displayFont = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

// The studio's type, worn by the team's portal (globals.css, `.employee-shell`):
// a serif for headings, Inter for reading, and an Arabic face drawn to sit
// beside them — names, rooms and reports here are Arabic as often as not, and
// the system's fallback Arabic beside Inter looked like a different app.
// Loaded as variables only, so nothing outside the portal changes.
const studioSerif = Fraunces({
  variable: "--font-studio-serif",
  subsets: ["latin"],
  axes: ["opsz"],
});

const studioSans = Inter({
  variable: "--font-studio-sans",
  subsets: ["latin"],
});

const studioArabic = Noto_Kufi_Arabic({
  variable: "--font-studio-arabic",
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
  themeColor: "#f7f6fb",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${displayFont.variable} ${studioSerif.variable} ${studioSans.variable} ${studioArabic.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background">{children}</body>
    </html>
  );
}
