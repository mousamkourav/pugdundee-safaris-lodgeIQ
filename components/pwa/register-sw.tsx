"use client";

// Registers public/sw.js so LodgeIQ can be installed as an app (Add to Home screen) and shows an
// offline page instead of the browser's error. Production only, so local development is unaffected.
import { useEffect } from "react";

export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      /* not installable in this browser: the site works as before */
    });
  }, []);
  return null;
}
