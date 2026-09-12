import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TravelSpace — Event floor plans",
  description:
    "Arrange event spaces, explore visitor flow, and plan exhibitions and large events.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
