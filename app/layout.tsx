import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { DevConsoleFilter } from "./_components/DevConsoleFilter";

// Vernavle is Zinolt's brand face — used across the whole UI (headlines,
// nav, buttons, labels, body). Assigned to BOTH --font-ui and --font-display
// so every existing design-system token that references either variable
// resolves to Vernavle without further changes.
const vernavle = localFont({
  src: "../public/brand/vernavle-font.woff2",
  display: "swap",
  variable: "--font-ui",
});

export const metadata: Metadata = {
  title: "Zinolt",
  description: "Turn a single piece of artwork into a branded 9:16 MP4 reel.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${vernavle.variable} h-full antialiased`}
      style={{ ["--font-display" as string]: "var(--font-ui)" }}
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <DevConsoleFilter />
        {children}
      </body>
    </html>
  );
}
