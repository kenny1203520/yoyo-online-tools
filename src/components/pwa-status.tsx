"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/use-i18n";
import { createDeveloperWorker, createTextWorker } from "@/lib/tool-workers";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
export function PwaStatus() {
  const { t } = useI18n();
  const pathname = usePathname();
  const [online, setOnline] = useState(true);
  const [readyPath, setReadyPath] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const registration = useRef<Promise<ServiceWorkerRegistration> | null>(null);
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    const connection = () => setOnline(navigator.onLine);
    queueMicrotask(connection); window.addEventListener("online", connection); window.addEventListener("offline", connection);
    const onInstall = (event: Event) => { event.preventDefault(); setInstall(event as InstallEvent); };
    window.addEventListener("beforeinstallprompt", onInstall);
    const navigateOffline = (event: MouseEvent) => {
      if (navigator.onLine || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      const link = (event.target as Element).closest("a[href]");
      if (!(link instanceof HTMLAnchorElement) || link.target || link.hasAttribute("download")) return;
      const url = new URL(link.href);
      if (url.origin === location.origin && url.pathname !== location.pathname) { event.preventDefault(); event.stopPropagation(); location.assign(url.href); }
    };
    document.addEventListener("click", navigateOffline, true);
    if (!("serviceWorker" in navigator)) queueMicrotask(() => setUnavailable(true));
    else {
      registration.current = navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      void registration.current.then((reg) => {
        if (reg.waiting) setWaiting(reg.waiting);
        reg.addEventListener("updatefound", () => {
          const worker = reg.installing;
          worker?.addEventListener("statechange", () => { if (worker.state === "installed" && navigator.serviceWorker.controller) setWaiting(reg.waiting); });
        });
      }).catch(() => setUnavailable(true));
    }
    return () => { window.removeEventListener("online", connection); window.removeEventListener("offline", connection); window.removeEventListener("beforeinstallprompt", onInstall); document.removeEventListener("click", navigateOffline, true); };
  }, []);
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !online || pathname.includes("/tools/3d-viewer")) return;
    let disposed = false;
    let channel: MessageChannel | undefined;
    let warmWorker: Worker | undefined;
    const timer = window.setTimeout(() => void (async () => {
      try {
        await registration.current;
        if (!("serviceWorker" in navigator)) return;
        const reg = await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller) await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true }));
        if (/\/image-(compress|resize|convert)$/.test(pathname)) await import("jszip");
        // Load the actual lazy worker module before promising offline processing.
        if (/\/(json-formatter|text-diff|regex-tester|text-cleanup|remove-duplicate-lines|word-count)$/.test(pathname)) {
          warmWorker = /\/(text-cleanup|remove-duplicate-lines|word-count)$/.test(pathname) ? createTextWorker() : createDeveloperWorker();
          await new Promise<void>((resolve, reject) => {
            const timeout = window.setTimeout(() => reject(new Error("Worker preparation timed out")), 15000);
            warmWorker!.onmessage = () => { window.clearTimeout(timeout); resolve(); };
            warmWorker!.onerror = () => { window.clearTimeout(timeout); reject(new Error("Worker unavailable")); };
          });
          warmWorker.terminate();
        }
        if (disposed) return;
        channel = new MessageChannel();
        channel.port1.onmessage = (event) => { if (!disposed) { if (event.data.ready) { setReadyPath(pathname); setUnavailable(false); } else setUnavailable(true); } channel?.port1.close(); };
        const resources = performance.getEntriesByType("resource").map((entry) => entry.name);
        reg.active?.postMessage({ type: "PREPARE_ROUTE", path: pathname, resources }, [channel.port2]);
      } catch { if (!disposed) setUnavailable(true); }
    })(), 1800);
    return () => { disposed = true; window.clearTimeout(timer); channel?.port1.close(); warmWorker?.terminate(); };
  }, [pathname, online]);

  if (process.env.NODE_ENV !== "production") return null;
  return <aside className="main-shell pwa-status" aria-label={t("pwaInstall")}>
    <p role="status" data-offline-ready={readyPath === pathname || undefined}>{!online ? t("pwaOffline") : unavailable ? t("pwaUnavailable") : readyPath === pathname ? t("pwaReady") : t("pwaOnline")}</p>
    <details><summary>{t("pwaInstall")}</summary><p>{t("pwaInstallHelp")}</p>{install && <button type="button" onClick={() => void (async () => { await install.prompt(); await install.userChoice; setInstall(null); })()}>{t("pwaInstallAction")}</button>}</details>
    {waiting && <div role="status"><p>{t("pwaUpdate")}</p><button type="button" onClick={() => {
      if (!window.confirm(t("pwaUpdateConfirm"))) return;
      navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
      waiting.postMessage({ type: "ACTIVATE_UPDATE" });
    }}>{t("pwaUpdateAction")}</button></div>}
  </aside>;
}
