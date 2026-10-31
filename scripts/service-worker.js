/* Generated with a unique Next build ID. Only application resources are cached. */
const CACHE = "yoyo-app-__BUILD_VERSION__";
const FALLBACK = "/offline.html";
const TOOL = /^(image-compress|image-resize|image-convert|text-cleanup|remove-duplicate-lines|word-count|json-formatter|text-diff|base64|url-encode-decode|unix-timestamp|regex-tester|spreadsheet-workbench)$/;
function eligiblePage(path) {
  const parts = path.split("/").filter(Boolean);
  return ["zh-TW", "en"].includes(parts[0]) && (parts.length === 1 || (parts.length === 3 && parts[1] === "tools" && TOOL.test(parts[2])));
}
function eligibleStatic(url) {
  return url.origin === self.location.origin && (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest");
}
async function store(cache, path, document = false) {
  const response = await fetch(path, document ? { headers: { Accept: "text/html" }, cache: "no-store" } : {});
  if (!response.ok || (document && !response.headers.get("content-type")?.includes("text/html"))) throw new Error("Preparation failed");
  await cache.put(path, response.clone());
  return response;
}
self.addEventListener("install", (event) => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  await cache.addAll([FALLBACK, "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/maskable-512.png"]);
  // Do not skip waiting: an open workspace must survive updates.
})()));
self.addEventListener("activate", (event) => event.waitUntil((async () => {
  for (const name of await caches.keys()) if (name.startsWith("yoyo-app-") && name !== CACHE) await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener("message", (event) => {
  if (event.origin !== self.location.origin) return;
  const source = event.source;
  if (!source || !("url" in source) || new URL(source.url).origin !== self.location.origin) return;
  if (event.data?.type === "ACTIVATE_UPDATE") { event.waitUntil(self.skipWaiting()); return; }
  if (event.data?.type !== "PREPARE_ROUTE") return;
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      const path = event.data.path;
      if (!eligiblePage(path)) throw new Error("Unsupported route");
      const alternate = path.startsWith("/en") ? path.replace(/^\/en/, "/zh-TW") : path.replace(/^\/zh-TW/, "/en");
      await Promise.all([...new Set([path, alternate, "/zh-TW", "/en"])].map((route) => store(cache, route, true)));
      const resources = Array.isArray(event.data.resources) ? event.data.resources : [];
      await Promise.all(resources.map(async (resource) => {
        const url = new URL(resource, self.location.origin);
        if (eligibleStatic(url) && !(await cache.match(url.href))) await store(cache, url.href);
      }));
      event.ports[0]?.postMessage({ ready: true });
    } catch { event.ports[0]?.postMessage({ ready: false }); }
  })());
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try { return await fetch(request); }
      catch {
        const cache = await caches.open(CACHE);
        // Never confuse an RSC payload with a document, or cache query strings.
        return (eligiblePage(url.pathname) && await cache.match(url.pathname)) || await cache.match(FALLBACK) || Response.error();
      }
    })());
  } else if (eligibleStatic(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      // Looking up a not-yet-initialized Worker client while responding to its
      // importScripts request can deadlock Firefox. These are immutable program
      // assets, so caching does not depend on which client requested them.
      if (response.ok) {
        try { await cache.put(request, response.clone()); } catch { /* Quota failure must not break online operation. */ }
      }
      return response;
    })());
  }
});
