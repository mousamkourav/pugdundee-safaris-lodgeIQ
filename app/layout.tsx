import type { Metadata } from "next";
import { epilogue, workSans } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "LodgeIQ - Pugdundee Safaris",
  description: "Lodge operations, reporting & notifications",
  icons: { icon: "/pugdundee-logo-circle.jpeg" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${epilogue.variable} ${workSans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
