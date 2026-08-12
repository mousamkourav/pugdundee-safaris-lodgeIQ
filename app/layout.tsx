import type { Metadata } from "next";
import { poppins, inter } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "LodgeIQ · Pugdundee Safaris",
  description: "Lodge operations, reporting & notifications",
  icons: { icon: "/pugdundee-logo-circle.jpeg" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${poppins.variable} ${inter.variable}`}>
      <body>{children}</body>
    </html>
  );
}
