import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";

const mono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const SITE_URL = "https://gettrustloop.app";
const TITLE = "TrustLoop AI | Support Ops for Engineering Teams";
const DESCRIPTION =
  "TrustLoop AI reads your codebase, groups chat threads, and drafts technically accurate support responses.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  metadataBase: new URL(SITE_URL),
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: SITE_URL,
    siteName: "TrustLoop AI",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
    },
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="scroll-smooth">
      <body
        className={`${mono.className} antialiased min-h-screen flex flex-col bg-[#F4F1EE] text-[#1C1917] overflow-x-hidden bg-dot-grid`}
      >
        {children}
      </body>
    </html>
  );
}
