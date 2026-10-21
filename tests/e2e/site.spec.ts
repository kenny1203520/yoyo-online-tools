import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";

async function switchLanguage(page: Page, name: "English" | "繁體中文") {
  await page.getByRole("button", { name: /^(切換語言|Change language)/ }).click();
  await page.getByRole("link", { name, exact: true }).click();
}

test("localized HTML, canonical and genuine missing-page status", async ({ request }) => {
  const legacy = await request.get("/tools/word-count?example=1", { maxRedirects: 0 });
  expect(legacy.status()).toBe(308);
  expect(legacy.headers().location).toContain("/zh-TW/tools/word-count?example=1");
  for (const locale of ["zh-TW", "en"]) {
    const response = await request.get(`/${locale}/tools/word-count`);
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain(`<html lang="${locale}"`);
    expect(html).toContain(`https://tools.example.test/${locale}/tools/word-count`);
    expect(html).toMatch(/hreflang="x-default"/i);
    expect(html).toContain('application/ld+json');
    expect(html).toContain(locale === "en" ? "Original text" : "原始文字");
  }
  for (const path of ["/fr", "/fr/tools/word-count", "/en/tools/missing", "/en/missing"]) {
    expect((await request.get(path)).status(), path).toBe(404);
  }
});

test("search works across languages and survives locale changes", async ({ page }) => {
  await page.goto("/zh-TW");
  await page.getByRole("searchbox").fill("compress image");
  await expect(page.locator(".tool-card")).toHaveCount(1);
  await switchLanguage(page, "English");
  await expect(page.getByRole("searchbox")).toHaveValue("compress image");
  await expect(page.locator(".tool-card strong")).toHaveText("Image Compressor");
  await page.getByRole("searchbox").fill("照片太大");
  await expect(page.locator(".tool-card strong")).toHaveText("Image Compressor");
  await page.getByRole("searchbox").fill("nothing-matches-123");
  await expect(page.locator(".empty-search")).toBeVisible();
  await page.locator(".empty-search button").click();
  await expect(page.locator(".tool-card")).toHaveCount(6);
});

test("text, settings, results, errors and history survive locale navigation", async ({ page }) => {
  await page.goto("/zh-TW/tools/text-cleanup");
  await page.locator("#text-source").fill("hello  \n\n\n世界");
  await expect(page.locator("#text-result")).toHaveValue("hello\n\n世界");
  await switchLanguage(page, "English");
  await expect(page).toHaveTitle(/Clean Up Text/);
  await expect(page.locator("#text-source")).toHaveValue("hello  \n\n\n世界");
  await expect(page.locator("#text-result")).toHaveValue("hello\n\n世界");
  await expect(page.getByLabel("Remove trailing spaces and extra blank lines")).toBeChecked();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download TXT", exact: true }).click();
  expect((await download).suggestedFilename().endsWith(".txt")).toBe(true);
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator('input[type="file"]').setInputFiles({ name: "invalid.txt", mimeType: "text/plain", buffer: Buffer.from([0xff,0xff]) });
  await expect(page.locator(".text-workspace-notice")).toContainText("not valid UTF-8");
  await switchLanguage(page, "繁體中文");
  await expect(page.locator(".text-workspace-notice")).toContainText("無法以 UTF-8");
  await page.goBack();
  await expect(page.locator("#text-source")).toHaveValue("hello  \n\n\n世界");
});

test("images, overrides, results, ZIP and stale-result protection", async ({ page }) => {
  await page.goto("/zh-TW/tools/image-compress");
  const buffer = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 32; canvas.height = 24;
    const context = canvas.getContext("2d")!; context.fillStyle = "#0f766e"; context.fillRect(0,0,32,24);
    return canvas.toDataURL("image/png").split(",")[1];
  }), "base64");
  const requests: string[] = [];
  page.on("request", (request) => { if (!["GET", "HEAD"].includes(request.method())) requests.push(request.url()); });
  // setInputFiles bypasses normal input actionability, including disabled state.
  await expect(page.locator('input[type="file"]')).toBeEnabled();
  await page.locator('input[type="file"]').setInputFiles([
    { name: "same.png", mimeType: "image/png", buffer },
    { name: "same.png", mimeType: "image/png", buffer },
  ]);
  await expect(page.locator(".image-list-item")).toHaveCount(2);
  await switchLanguage(page, "English");
  await expect(page.locator(".image-list-item")).toHaveCount(2);
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.locator(".image-list-item").first().getByRole("button", { name: "Customize", exact: true }).click();
  await page.locator(".override-panel select").selectOption("image/jpeg");
  await page.locator("#image-format").selectOption("image/jpeg");
  await page.getByRole("button", { name: "Process images", exact: true }).click();
  await expect(page.locator(".download-single")).toBeVisible();
  const single = page.waitForEvent("download");
  await page.locator(".download-single").click();
  const singleDownload = await single;
  expect(singleDownload.suggestedFilename().endsWith(".jpg")).toBe(true);
  expect([...((await readFile((await singleDownload.path())!)).subarray(0,3))]).toEqual([0xff,0xd8,0xff]);
  const zip = page.waitForEvent("download");
  await page.locator(".zip-button").click();
  const zipDownload = await zip;
  expect(zipDownload.suggestedFilename()).toBe("yoyo-images.zip");
  const archive = await JSZip.loadAsync(await readFile((await zipDownload.path())!));
  expect(Object.keys(archive.files).sort()).toEqual(["same-yoyo-2.jpg", "same-yoyo.jpg"]);
  await switchLanguage(page, "繁體中文");
  await expect(page.locator(".download-single")).toBeVisible();
  await expect(page.locator(".override-panel select")).toHaveValue("image/jpeg");
  await page.locator("#image-format").selectOption("image/webp");
  // The custom first image stays current; the second follows the changed batch rule.
  await page.locator(".image-list-select").nth(1).click();
  await expect(page.locator(".download-single")).toHaveCount(0);
  expect(requests).toEqual([]);
  await page.getByRole("link", { name: "YOYO 工具站", exact: false }).first().click();
  await page.waitForURL("**/zh-TW");
  await page.goto("/en/tools/image-compress");
  await expect(page.locator(".image-list-item")).toHaveCount(0);
});

test("sitemap and robots list localized live tools", async ({ request }) => {
  const sitemap = await request.get("/sitemap.xml");
  const xml = await sitemap.text();
  expect((xml.match(/<loc>/g) || []).length).toBe(14);
  expect(xml).toContain('hreflang="en"');
  expect(xml).not.toContain("/api/");
  expect(await (await request.get("/robots.txt")).text()).toContain("https://tools.example.test/sitemap.xml");
});

test("English fits supported viewport widths", async ({ page }) => {
  for (const width of [375,768,1024,1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/en", "/en/tools/text-cleanup", "/en/tools/image-compress"]) {
      await page.goto(path);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${path}: ${width}`).toBe(true);
    }
  }
});

test("keyboard users can skip navigation and find a tool", async ({ page }) => {
  await page.goto("/en");
  await expect(page.getByRole("searchbox")).toBeEnabled();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#content")).toBeFocused();
  await page.getByRole("searchbox").focus();
  await page.keyboard.type("word count");
  await expect(page.locator(".tool-card")).toHaveCount(1);
});

test("language disclosure supports keyboard, dismissal and URL preservation", async ({ page }) => {
  await page.goto("/zh-TW?source=language-test#guide");
  const trigger = page.getByRole("button", { name: "切換語言，目前語言：繁體中文", exact: true });
  const panel = page.locator(".language-panel");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(panel).toBeHidden();
  await trigger.focus();
  await trigger.press("Enter");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("link", { name: "繁體中文", exact: true })).toHaveAttribute("aria-current", "true");
  const english = page.getByRole("link", { name: "English", exact: true });
  await expect(english).toHaveAttribute("href", "/en?source=language-test#guide");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "繁體中文", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(english).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.press("Space");
  await expect(panel).toBeVisible();
  await page.getByRole("link", { name: "繁體中文", exact: true }).click();
  await expect(panel).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page).toHaveURL(/\/zh-TW\?source=language-test#guide$/);
  await trigger.click();
  await page.locator(".language-panel a").last().focus();
  await page.keyboard.press("Tab");
  await expect(panel).toBeHidden();
  await trigger.click();
  await page.locator(".site-header").click({ position: { x: 2, y: 2 } });
  await expect(panel).toBeHidden();
  await switchLanguage(page, "English");
  await expect(page).toHaveURL(/\/en\?source=language-test#guide$/);
  await expect(page.getByRole("button", { name: "Change language, current language: English", exact: true })).toHaveAttribute("aria-expanded", "false");
});

test("language list fits every viewport and accommodates future language names", async ({ page }, testInfo) => {
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/en");
    const trigger = page.getByRole("button", { name: /^Change language/ });
    await trigger.click();
    const panel = page.locator(".language-panel");
    const buttonBounds = await trigger.boundingBox();
    expect(buttonBounds!.width).toBeGreaterThanOrEqual(44);
    expect(buttonBounds!.height).toBeGreaterThanOrEqual(44);
    const bounds = await panel.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    if (testInfo.project.name === "chromium" && [375, 1440].includes(width)) {
      await page.screenshot({ path: `test-results/language-switcher-${width}.png` });
    }
    // Exercise layout capacity without exposing unimplemented languages in the app.
    await panel.locator("ul").evaluate((list) => {
      for (let index = 0; index < 12; index++) {
        const row = list.firstElementChild!.cloneNode(true) as HTMLElement;
        row.querySelector("span")!.textContent = "A future language with a much longer native name";
        list.appendChild(row);
      }
    });
    expect(await panel.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
  }
});
