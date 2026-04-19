import { SDKProvider } from "@/components/sdk-provider";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "TrustLoop AI Demo App",
  description: "Test harness for @trustloop/sdk session replay",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SDKProvider>
          <main style={{ maxWidth: 640, margin: "0 auto", padding: "2rem" }}>{children}</main>
        </SDKProvider>
      </body>
    </html>
  );
}
