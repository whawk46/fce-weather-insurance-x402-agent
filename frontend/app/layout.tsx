import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono } from "next/font/google";

import { Web3Provider } from "@/components/Web3Provider";
import "./globals.css";

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Weather Insurance · Flare FCC",
  description:
    "Parametric rainfall insurance settled by a Flare Confidential Compute TEE extension on Coston2.",
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#e62058",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${ibmPlexMono.variable} min-h-dvh antialiased`}
    >
      <body className="flex min-h-dvh flex-col" suppressHydrationWarning>
        <Web3Provider>{children}</Web3Provider>
      </body>
    </html>
  );
}
