import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";

function makeTriangleGlb() {
  const positions = Buffer.alloc(36);
  [-1, 0, 0, 1, 0, 0, 0, 1, 0].forEach((value, index) => positions.writeFloatLE(value, index * 4));
  const json = Buffer.from(JSON.stringify({
    asset: { version: "2.0" },
    buffers: [{ byteLength: positions.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.length }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [-1, 0, 0], max: [1, 1, 0] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  }), "utf8");
  const jsonLength = Math.ceil(json.length / 4) * 4;
  const binaryLength = Math.ceil(positions.length / 4) * 4;
  const glb = Buffer.alloc(12 + 8 + jsonLength + 8 + binaryLength);
  glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(jsonLength, 12); glb.writeUInt32LE(0x4e4f534a, 16); glb.fill(0x20, 20, 20 + jsonLength); json.copy(glb, 20);
  const binaryHeader = 20 + jsonLength;
  glb.writeUInt32LE(binaryLength, binaryHeader); glb.writeUInt32LE(0x004e4942, binaryHeader + 4); positions.copy(glb, binaryHeader + 8);
  return glb;
}

async function switchLanguage(page: Page, name: "English" | "繁體中文") {
  await page.getByRole("button", { name: /^(切換語言|Change language)/ }).click();
  await page.getByRole("dialog").getByRole("link", { name: new RegExp(`^${name}`) }).click();
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
  await expect(page.locator(".tool-card")).toHaveCount(13);
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
  expect((xml.match(/<loc>/g) || []).length).toBe(28);
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

test("language dialog supports multilingual search, keyboard, dismissal and URL preservation", async ({ page }) => {
  await page.goto("/zh-TW?source=language-test#guide");
  const trigger = page.getByRole("button", { name: "切換語言，目前語言：繁體中文", exact: true });
  const panel = page.getByRole("dialog", { name: "選擇語言", exact: true });
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(panel).toBeHidden();
  await expect(trigger).toBeEnabled();
  await trigger.focus();
  await trigger.press("Enter");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  const search = panel.getByRole("searchbox", { name: "搜尋語言", exact: true });
  await expect(search).toBeFocused();
  await expect(page.getByRole("link", { name: /^繁體中文/ })).toHaveAttribute("aria-current", "true");
  const english = panel.getByRole("link", { name: /^English/ });
  await expect(english).toHaveAttribute("href", "/en?source=language-test#guide");
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("hidden");
  await page.keyboard.press("Shift+Tab");
  await expect(panel.getByRole("button", { name: "關閉語言選擇" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(search).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(panel.getByRole("link", { name: /^繁體中文/ })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(english).toBeFocused();
  // Native modals can yield to browser chrome; background page controls stay inert.
  for (let index = 0; index < 6; index++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement === document.body || document.querySelector("dialog")!.contains(document.activeElement))).toBe(true);
  }
  await search.focus();
  for (const query of ["Traditional", "zh_TW", "正體中文"]) {
    await search.fill(query);
    await expect(panel.getByRole("link")).toHaveCount(1);
    await expect(panel.getByRole("link")).toContainText("繁體中文");
  }
  for (const query of ["英文", "ｅＮ"]) {
    await search.fill(query);
    await expect(panel.getByRole("link")).toHaveCount(1);
    await expect(english).toBeVisible();
  }
  await search.fill("nothing-matches");
  await expect(panel.getByRole("link")).toHaveCount(0);
  await expect(panel.getByRole("heading", { name: "找不到符合的語言" })).toBeVisible();
  await panel.locator(".language-no-results button").click();
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  await expect(panel.getByRole("link")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.documentElement.style.overflow)).toBe("");
  await trigger.press("Space");
  await expect(panel).toBeVisible();
  await page.getByRole("link", { name: /^繁體中文/ }).click();
  await expect(panel).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page).toHaveURL(/\/zh-TW\?source=language-test#guide$/);
  await trigger.click();
  await panel.getByRole("heading", { name: "選擇語言" }).click();
  await expect(panel).toBeVisible();
  await search.fill("English");
  await panel.getByRole("button", { name: "關閉語言選擇" }).click();
  await expect(panel).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(search).toHaveValue("");
  await page.mouse.click(2, 2);
  await expect(panel).toBeHidden();
  await expect(trigger).toBeFocused();
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
    const panel = page.getByRole("dialog", { name: "Choose a language", exact: true });
    const buttonBounds = await trigger.boundingBox();
    expect(buttonBounds!.width).toBeGreaterThanOrEqual(44);
    expect(buttonBounds!.height).toBeGreaterThanOrEqual(44);
    const bounds = await panel.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    const cards = panel.locator("li");
    const first = await cards.nth(0).boundingBox();
    const second = await cards.nth(1).boundingBox();
    if (width === 375) expect(second!.y).toBeGreaterThan(first!.y);
    else expect(second!.y).toBe(first!.y);
    if (testInfo.project.name === "chromium" && [375, 1440].includes(width)) {
      await page.screenshot({ path: `test-results/language-picker-${width}.png` });
    }
    // Exercise layout capacity without exposing unimplemented languages in the app.
    await panel.locator("ul").evaluate((list) => {
      for (let index = 0; index < 12; index++) {
        const row = list.firstElementChild!.cloneNode(true) as HTMLElement;
        row.querySelector(".language-native-name")!.textContent = "A future language with a much longer native name";
        list.appendChild(row);
      }
    });
    const results = panel.locator(".language-results");
    expect(await results.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    expect(await results.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
  }
  await page.setViewportSize({ width: 375, height: 420 });
  await page.goto("/en");
  await page.getByRole("button", { name: /^Change language/ }).click();
  const panel = page.getByRole("dialog", { name: "Choose a language", exact: true });
  expect((await panel.boundingBox())!.height).toBeLessThanOrEqual(388);
  await expect(panel.getByRole("searchbox")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Close language selection" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => document.documentElement.style.overflow)).toBe("");
});

test("developer workspace formats JSON and 3D workspace exposes local model controls", async ({ page }) => {
  await page.goto("/zh-TW/tools/json-formatter");
  await page.locator(".cm-content").fill('{"name":"YOYO","active":true}');
  await page.getByRole("button", { name: "執行" }).click();
  await expect(page.locator(".developer-result")).toContainText('"name": "YOYO"');
  await page.goto("/zh-TW/tools/3d-viewer");
  await expect(page.getByRole("heading", { name: "3D 模型與空間檢視" })).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveAttribute("accept", /\.ifc/);
  await expect(page.getByRole("group", { name: "檢視方式" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "人體尺度" })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({ name: "triangle.glb", mimeType: "model/gltf-binary", buffer: makeTriangleGlb() });
  await expect(page.locator(".model-stage-footer")).toContainText("triangle.glb", { timeout: 15000 });
});
