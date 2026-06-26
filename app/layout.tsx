import type { Metadata } from "next";
import { Source_Serif_4, Inter } from "next/font/google";
import "./globals.css";
import { DevConsoleFilter } from "./_components/DevConsoleFilter";

// Display serif retained for marketing-stage editorial headlines.
const sourceSerif = Source_Serif_4({
  variable: "--font-display",
  subsets: ["latin"],
  display: "swap",
});

// Inter is the new UI workhorse — nav, buttons, labels, body copy.
const inter = Inter({
  variable: "--font-ui",
  subsets: ["latin"],
  display: "swap",
  axes: ["opsz"],
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
      className={`${sourceSerif.variable} ${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <DevConsoleFilter />
        {children}
      </body>
    </html>
  );
}
