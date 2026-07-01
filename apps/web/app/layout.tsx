import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GhostBox",
  description: "A browser gateway for your EC2 terminal and desktop."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
