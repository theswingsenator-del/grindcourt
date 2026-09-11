import type { Metadata, Viewport } from "next";
import { Oswald, Manrope, Geist_Mono } from "next/font/google";
import "./globals.css";
import SwRegister from "./sw-register";
import { PersonalModeProvider } from "@/lib/PersonalModeContext";
import ModeTransitionOverlay from "@/components/ModeTransitionOverlay";

const oswald = Oswald({
  variable: "--font-oswald",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GrindCourt",
  description: "The police for your 2026 goals. Log it, or pay for it.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "GrindCourt",
  },
  icons: {
    apple: "/icons/icon-180.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${oswald.variable} ${manrope.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-screen flex flex-col app-bg">
        <SwRegister />
        <PersonalModeProvider>
          {children}
          <ModeTransitionOverlay />
        </PersonalModeProvider>
      </body>
    </html>
  );
}
