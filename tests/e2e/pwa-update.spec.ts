import { test, expect } from "@playwright/test";
import { createServer, request as httpRequest } from "node:http";
import { readFile } from "node:fs/promises";

test("a real waiting service worker preserves input until confirmed and cleans old caches", async ({ page }) => {
  test.setTimeout(60000);
  const source = await readFile("scripts/service-worker.js", "utf8");
  let version = "audit-update-v1";
  const upstream = new URL(process.env.E2E_BASE_URL || "http://127.0.0.1:3100");
  // Proxy the actual production app, changing only the build-versioned SW script.
  const server = createServer((req, res) => {
    if (req.url === "/sw.js") { res.writeHead(200, { "Content-Type": "application/javascript", "Cache-Control": "no-store" }); res.end(source.replaceAll("__BUILD_VERSION__", version)); return; }
    const forwarded = httpRequest(new URL(req.url || "/", upstream), { method: req.method, headers: { ...req.headers, host: upstream.host } }, (response) => { res.writeHead(response.statusCode || 500, response.headers); response.pipe(res); });
    forwarded.on("error", () => { res.writeHead(502); res.end(); }); req.pipe(forwarded);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test proxy address");
  try {
    await page.goto(`http://127.0.0.1:${address.port}/en/tools/json-formatter`);
    await expect(page.locator('[data-offline-ready="true"]')).toBeVisible({ timeout: 20000 });
    await page.locator(".cm-content").fill('{"keep":"until confirmed"}');
    version = "audit-update-v2";
    await page.evaluate(async () => { const registration = await navigator.serviceWorker.getRegistration(); await registration?.update(); });
    const update = page.getByRole("button", { name: "Update and reload", exact: true });
    await expect(update).toBeVisible({ timeout: 15000 });
    await expect(page.locator(".cm-content")).toContainText("until confirmed");
    page.once("dialog", (dialog) => dialog.dismiss()); await update.click();
    await expect(page.locator(".cm-content")).toContainText("until confirmed");
    page.once("dialog", (dialog) => dialog.accept());
    await Promise.all([page.waitForEvent("load"), update.click()]);
    await expect(page.locator(".cm-content")).toHaveText("");
    await expect.poll(() => page.evaluate(() => caches.keys())).not.toContain("yoyo-app-audit-update-v1");
    expect(await page.evaluate(() => caches.keys())).toContain("yoyo-app-audit-update-v2");
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});
