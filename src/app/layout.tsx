import type { Metadata, Viewport } from "next";
import { Lexend } from "next/font/google";
import "./globals.css";

const lexend = Lexend({
  variable: "--font-lexend",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://www.viralowner.com"),
  title: "viralowner — skip the editing, keep the views",
  description: "send a video that went viral and your raw clips. we edit yours the same way, with your business in it.",
  openGraph: {
    siteName: "viralowner",
    type: "website",
    title: "viralowner — skip the editing, keep the views",
    description: "send a video that went viral and your raw clips. we edit yours the same way, with your business in it.",
  },
};

export const viewport: Viewport = {
  themeColor: "#0B0B0F",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${lexend.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
