// LodgeIQ as an installed app (Add to Home screen). Only staff pages (dashboard, login, hub) carry
// the app manifest, so guests opening a quote link (/i/...) are never offered "install LodgeIQ".
import type { Metadata, Viewport } from "next";

export const appMetadata: Pick<Metadata, "manifest" | "appleWebApp" | "applicationName" | "formatDetection"> = {
  manifest: "/manifest.webmanifest",
  applicationName: "LodgeIQ",
  appleWebApp: { capable: true, title: "LodgeIQ", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const appViewport: Viewport = {
  themeColor: "#2A3212",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};
