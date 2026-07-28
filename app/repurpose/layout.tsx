import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Repurpose",
  description: "Watermark and speed up vertical clips, on-device.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Repurpose",
    statusBarStyle: "black-translucent",
  },
  icons: {
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RepurposeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
