"use client";

import { useEffect } from "react";

/** Registers the shell service worker after hydration, in production only. */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;
    const timer = window.setTimeout(() => {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, []);

  return null;
}
