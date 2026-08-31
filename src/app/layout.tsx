import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Geist, Bricolage_Grotesque } from "next/font/google";
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
    <html lang="en" className={`${geistSans.variable} ${displayFont.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background">{children}</body>
    </html>
  );
}
