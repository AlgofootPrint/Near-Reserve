import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Lilita_One, Space_Grotesk } from "next/font/google";
import "./globals.css";

const display = Space_Grotesk({ variable: "--font-display", subsets: ["latin"] });
const code = JetBrains_Mono({ variable: "--font-code", subsets: ["latin"] });
const game = Lilita_One({ variable: "--font-lilita", subsets: ["latin"], weight: "400" });

export const metadata: Metadata = {
  title: "Guess the Client · NEAR Reserve",
  description: "Four suspects, one real client, one AI teller who can be fooled. Bet on who's real. The vault contract settles it on-chain.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Draw edge to edge on notched phones; the layout pads itself with env(safe-area-inset-*).
  viewportFit: "cover",
  themeColor: "#3a060d",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${code.variable} ${game.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
