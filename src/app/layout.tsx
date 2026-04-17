import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Maverick Ambitions",
  description:
    "A generational business simulation. Build an empire. Raise heirs. Outlast your rivals.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "Maverick",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#0f1320",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-ink-950 text-ink-50 font-sans">
        {children}
      </body>
    </html>
  );
}
