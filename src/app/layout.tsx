import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorkerRegistrar } from "@/components/service-worker";

export const metadata: Metadata = {
  title: {
    default: "Katalis POS",
    template: "%s · Katalis POS",
  },
  description:
    "Terminal kasir ritel offline-first dengan rekonsiliasi laci kasir tertutup, harga grosir otomatis, dan sistem pendukung keputusan.",
  applicationName: "Katalis POS",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Katalis POS", statusBarStyle: "default" },
  icons: { icon: "/icons/icon.svg", apple: "/icons/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#121110",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&family=Sora:wght@500;600;700&display=swap"
        />
      </head>
      <body>
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
