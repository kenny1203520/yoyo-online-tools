import { test, expect } from "@playwright/test";
import { startProductionProxy } from "../helpers/production-proxy";
import { readFile } from "node:fs/promises";
import en from "../../src/messages/en.json";
import zh from "../../src/messages/zh-TW.json";

test("developer edits invalidate results, sessions are isolated, and locale preserves content", async ({ page }) => {
  await page.goto("/en/tools/json-formatter");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true }));
  });
  await page.locator(".cm-content").fill('{"large":900719925474099312345}');
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.locator(".developer-result")).toContainText("900719925474099312345");
  await page.getByLabel("Indentation").selectOption("4");
  await expect(page.locator(".developer-result")).toHaveCount(0);
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.locator(".developer-result")).toBeVisible();
  await page.getByRole("button", { name: /^Change language/ }).click();
  await page.getByRole("dialog").getByRole("link", { name: /^繁體中文/ }).click();
  await expect(page.locator(".cm-content")).toContainText("900719925474099312345");
  await page.locator(".workspace-tool-nav a").filter({ hasText: "Base64" }).click();
  await expect(page.locator(".cm-content")).toHaveText("");
  await expect(page.locator(".developer-result")).toHaveCount(0);
});

test("developer file errors remain translatable after switching locale", async ({ page }) => {
  await page.goto("/en/tools/json-formatter");
  const input = page.locator('input[type="file"]');
  await expect(input).toBeEnabled();
  await input.setInputFiles({ name: "unsupported.bin", mimeType: "application/octet-stream", buffer: Buffer.from("example") });
  await expect(page.locator(".developer-error")).toHaveText(en.developerOnlyTextJsonFiles);
  await page.getByRole("button", { name: /^Change language/ }).click();
  await page.getByRole("dialog").getByRole("link", { name: /^繁體中文/ }).click();
  await expect(page.locator(".developer-error")).toHaveText(zh.developerOnlyTextJsonFiles);
});

test("timestamp supports editing and rejects nonexistent dates and precision loss", async ({ page }) => {
  await page.goto("/en/tools/unix-timestamp");
  await page.locator("#timestamp-source").fill("1.0001");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.locator(".developer-error")).toContainText("precision");
  await page.locator("#timestamp-source").fill("1.001");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.locator(".developer-result")).toContainText("1970-01-01T00:00:01.001Z");
  await page.locator(".developer-panel .developer-options select").first().selectOption("toTimestamp");
  await expect(page.locator(".developer-result")).toHaveCount(0);
  await page.locator(".developer-iso-field input").fill("2026-02-30T12:00:00Z");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.locator(".developer-error")).toContainText("Date does not exist");
});

test("developer inputs wait for hydration and downloaded JSON preserves UTF-8 and numeric order", async ({ page }) => {
  await page.route("**/_next/static/chunks/*.js", async (route) => { await new Promise((resolve) => setTimeout(resolve, 300)); await route.continue(); });
  await page.goto("/en/tools/unix-timestamp", { waitUntil: "domcontentloaded" });
  await page.locator("#timestamp-source").fill("1.001");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.locator(".developer-result")).toContainText("1970-01-01T00:00:01.001Z");
  await page.goto("/en/tools/json-formatter");
  await page.locator(".cm-content").fill('{"10":900719925474099312345,"2":"中文"}');
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.locator(".developer-result")).toContainText("中文");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("yoyo-result.json");
  const content = await readFile((await file.path())!, "utf8");
  expect(content).toContain("900719925474099312345"); expect(content).toContain("中文");
  expect(content.indexOf('"10"')).toBeLessThan(content.indexOf('"2"'));
});

test("clear can be undone, examples require confirmation, and JSON errors locate the caret", async ({ page }) => {
  await page.goto("/en/tools/json-formatter");
  await page.locator(".cm-content").fill('{\n"bad": }');
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.locator(".developer-error")).toContainText("Line 2");
  await expect(page.locator(".cm-content")).toBeFocused();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Load example", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText('"bad": }');
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.locator(".cm-content")).toHaveText("");
  await page.getByRole("button", { name: "Undo clear", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText('"bad": }');
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Tab");
  await expect(page.locator(".cm-content")).not.toBeFocused();
});

test("late Worker messages and settings edits cannot restore an outdated export", async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    class DelayedWorker extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", (event: MessageEvent) => {
          if (event.data?.status) { event.stopImmediatePropagation(); const callback = this.onmessage; setTimeout(() => callback?.call(this, event), 400); }
        });
      }
    }
    window.Worker = DelayedWorker;
  });
  await page.goto("/en/tools/json-formatter");
  await page.locator(".cm-content").fill('{"old":true}');
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await page.locator(".cm-content").fill('{"new":true}');
  await page.waitForTimeout(700);
  await expect(page.locator(".developer-result")).toHaveCount(0);
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.locator(".developer-result")).toContainText('"new": true');
});

test("expensive Regex finishes or is stopped within the deadline and the tool can retry", async ({ page }) => {
  await page.goto("/en/tools/regex-tester");
  await page.locator(".regex-config > label input").first().fill("(a+)+$");
  await page.locator(".cm-content").fill("a".repeat(50) + "!");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByRole("button", { name: "Run", exact: true })).toBeEnabled({ timeout: 18000 });
  // Engines may have their own early bailout. Both completion and our 2s
  // termination are valid; an indefinitely running operation is not.
  if (await page.locator(".developer-error").count()) await expect(page.locator(".developer-error")).toContainText(/2 seconds|2-second/);
  await page.locator(".regex-config > label input").first().fill("a");
  await page.locator(".cm-content").fill("aa");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.locator(".regex-highlight mark")).toHaveCount(2);
});

test("JSON computation deadline terminates a nonresponding worker without enabling export", async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker { postMessage() { /* Simulate a job that never completes after ready. */ } };
  });
  await page.goto("/en/tools/json-formatter");
  await page.locator(".cm-content").fill("{}");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.locator(".developer-error")).toContainText("5 seconds", { timeout: 22000 });
  await expect(page.locator(".developer-result")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Run", exact: true })).toBeEnabled();
});

test("both languages reflow across workspaces and enlarged text", async ({ page }, testInfo) => {
  test.setTimeout(120000);
  for (const locale of ["en", "zh-TW"]) {
    for (const width of [320, 375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const slug of ["", "/tools/image-compress", "/tools/text-cleanup", "/tools/json-formatter", "/tools/3d-viewer"]) {
        await page.goto(`/${locale}${slug}`);
        await expect(page.locator("main")).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${locale}${slug} @ ${width}`).toBe(true);
        if (width === 320) {
          await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${locale}${slug} at 200%`).toBe(true);
        }
        if (testInfo.project.name === "chromium" && [375, 1440].includes(width)) await page.screenshot({ path: `test-results/audit-${locale}-${slug.split("/").pop() || "home"}-${width}.png`, fullPage: true });
      }
    }
  }
});

test("primary text fields are readable and secondary text has normal-text contrast", async ({ page }) => {
  for (const path of ["/en", "/zh-TW/tools/text-cleanup", "/en/tools/json-formatter"]) {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
    const failures = await page.evaluate(() => {
      const rgb = (color: string) => (color.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      const luminance = (values: number[]) => values.reduce((sum, value, index) => { const c = value / 255; return sum + (c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][index]; }, 0);
      const failures: string[] = [];
      document.querySelectorAll(".hero-description, .tool-card-number, .tool-local-tag, .workspace-intro p, .developer-local, .cm-gutters").forEach((element) => {
        if (!element.getBoundingClientRect().height) return;
        let background: Element | null = element;
        while (background && ["rgba(0, 0, 0, 0)", "transparent"].includes(getComputedStyle(background).backgroundColor)) background = background.parentElement;
        const back = background ? rgb(getComputedStyle(background).backgroundColor) : [255, 255, 255];
        const front = rgb(getComputedStyle(element).color);
        const a = luminance(front), b = luminance(back);
        if ((Math.max(a, b) + .05) / (Math.min(a, b) + .05) < 4.5) failures.push(`${element.className}: insufficient contrast`);
      });
      document.querySelectorAll(".text-editor-area, .search-box input").forEach((element) => { if (parseFloat(getComputedStyle(element).fontSize) < 16) failures.push(`${element.className}: field text below 16px`); });
      return failures;
    });
    expect(failures, path).toEqual([]);
  }
});

test("PWA prepares both languages and offline restarts can use text, image ZIP and developer Workers", async ({ page, context }) => {
  test.setTimeout(90000);
  const proxy = await startProductionProxy();
  const goto = (path: string) => page.goto(proxy.origin + path);
  let closed = false;
  try {
  for (const slug of ["text-cleanup", "image-compress", "json-formatter"]) {
    await goto(`/en/tools/${slug}`);
    await expect(page.locator('[data-offline-ready="true"]')).toBeVisible({ timeout: 20000 });
  }
  // Shut down the origin as well: this tests actual network loss, including
  // browser engines whose offline emulation does not cover Service Worker fetch.
  await proxy.close(); closed = true;
  await context.setOffline(true);
  await goto("/en/tools/json-formatter");
  await page.locator(".cm-content").fill('{"offline":true}');
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.locator(".developer-result")).toContainText('"offline": true');
  await page.reload();
  await expect(page.locator(".cm-content")).toHaveText("");
  await goto("/zh-TW/tools/text-cleanup");
  await page.locator("#text-source").fill("offline  \n\n\n可用");
  await expect(page.locator("#text-result")).toHaveValue("offline\n\n可用");
  await goto("/en/tools/image-compress");
  const png = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 32; canvas.height = 24;
    const context = canvas.getContext("2d")!; context.fillStyle = "#0f766e"; context.fillRect(0, 0, 32, 24);
    return canvas.toDataURL("image/png").split(",")[1];
  }), "base64");
  await expect(page.locator('input[type="file"]')).toBeEnabled();
  await page.locator('input[type="file"]').setInputFiles([{ name: "offline.png", mimeType: "image/png", buffer: png }, { name: "second.png", mimeType: "image/png", buffer: png }]);
  await page.getByRole("button", { name: "Process images", exact: true }).click();
  await expect(page.locator(".download-single")).toBeVisible();
  const download = page.waitForEvent("download"); await page.locator(".zip-button").click();
  expect((await download).suggestedFilename()).toBe("yoyo-images.zip");
  await goto("/en/tools/base64");
  await expect(page.getByRole("heading", { name: /You are offline/ })).toBeVisible();
  await context.setOffline(false);
  } finally { if (!closed) await proxy.close(); }
});

test("PWA caches contain only application resources and manifest has install icons", async ({ page, request }) => {
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons.some((icon: { purpose: string }) => icon.purpose === "maskable")).toBe(true);
  const sw = await request.get("/sw.js");
  expect(sw.headers()["cache-control"]).toContain("no-store");
  await page.goto("/en/tools/json-formatter?private-input=should-not-cache");
  await expect(page.locator('[data-offline-ready="true"]')).toBeVisible({ timeout: 20000 });
  await page.locator(".cm-content").fill('{"secret":"DO_NOT_PERSIST"}');
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.locator(".developer-result")).toBeVisible();
  const cached = await page.evaluate(async () => {
    const entries: string[] = [];
    for (const name of await caches.keys()) for (const key of await (await caches.open(name)).keys()) entries.push(key.url);
    return { entries, local: Object.keys(localStorage), session: Object.keys(sessionStorage) };
  });
  expect(cached.entries.some((url) => /private-input|DO_NOT_PERSIST|\/wasm\/|3d-viewer|_rsc=/.test(url))).toBe(false);
  expect(cached.local).toEqual([]); expect(cached.session).toEqual([]);
});
