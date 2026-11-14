import type { Metadata, Viewport } from "next";
import { Lexend } from "next/font/google";
import "./globals.css";

const lexend = Lexend({
  variable: "--font-lexend",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://www.viralowner.com"),
  applicationName: "viralowner",
  title: { default: "viralowner: edit your clips like viral TikToks & Reels", template: "%s | viralowner" },
  description:
    "send a video that went viral and your own clips. we edit yours the same way, with captions and text in your words, ready to post.",
  openGraph: { type: "website", siteName: "viralowner", locale: "en_US" },
  twitter: { card: "summary_large_image" },
  formatDetection: { telephone: false, email: false, address: false },
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
