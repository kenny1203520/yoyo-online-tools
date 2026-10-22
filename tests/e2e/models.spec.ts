import { test, expect } from "@playwright/test";
import { readFile, access } from "node:fs/promises";
import JSZip from "jszip";
import { join } from "node:path";
const fixtures = join(process.cwd(), "tests/fixtures/models");
test.beforeAll(async () => { await access(join(fixtures, "sources.json")); });

test("official GLB, textured glTF ZIP, FBX and IFC load without outbound asset requests", async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await page.goto("/en/tools/3d-viewer");
  const external: string[] = [];
  page.on("request", (request) => { if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== new URL(page.url()).origin) external.push(request.url()); });
  const zip = new JSZip();
  const gltf = JSON.parse(await readFile(join(fixtures, "BoxTextured.gltf"), "utf8"));
  gltf.buffers[0].uri = "../resources/BoxTextured0.bin"; gltf.images[0].uri = "../resources/CesiumLogoFlat.png";
  zip.file("model/BoxTextured.gltf", JSON.stringify(gltf));
  for (const name of ["BoxTextured0.bin", "CesiumLogoFlat.png"]) zip.file(`resources/${name}`, await readFile(join(fixtures, name)));
  const records: Array<{ name: string; milliseconds: number }> = [];
  for (const name of ["box.glb", "textured.zip", "monkey.fbx", "example.ifc"]) {
    const start = Date.now();
    await page.locator('input[type="file"]').setInputFiles(name === "textured.zip" ? { name, mimeType: "application/zip", buffer: await zip.generateAsync({ type: "nodebuffer" }) } : join(fixtures, name));
    await expect(page.locator(".model-stage-footer, .model-error").first()).toBeVisible({ timeout: 60000 });
    await expect(page.locator(".model-stage-footer")).toContainText(name === "textured.zip" ? "BoxTextured.gltf" : name, { timeout: 60000 });
    records.push({ name, milliseconds: Date.now() - start });
    if (name === "example.ifc") {
      await expect(page.locator(".model-component-list button").first()).toBeVisible();
      await page.locator(".model-component-list button").first().click();
      await expect(page.locator(".model-property-actions")).toBeVisible();
      await page.locator(".model-property-actions button").nth(0).click();
      await page.locator(".model-property-actions button").nth(2).click();
    }
  }
  expect(external).toEqual([]);
  await testInfo.attach("model-timings", { body: JSON.stringify({ project: testInfo.project.name, records }), contentType: "application/json" });
});

test("ZIP multiple model selection, missing assets and calibration controls", async ({ page }) => {
  await page.goto("/en/tools/3d-viewer");
  const zip = new JSZip(); zip.file("first.glb", await readFile(join(fixtures, "box.glb"))); zip.file("second.glb", await readFile(join(fixtures, "box.glb")));
  await page.locator('input[type="file"]').setInputFiles({ name: "multiple.zip", mimeType: "application/zip", buffer: await zip.generateAsync({ type: "nodebuffer" }) });
  await expect(page.locator(".model-candidate-list button")).toHaveCount(2);
  await page.locator(".model-candidate-list button").first().click();
  await expect(page.locator(".model-stage-footer")).toContainText("first.glb");
  await page.locator(".model-measure-actions button").nth(1).click();
  await expect(page.locator(".model-calibration input")).toBeVisible();
  await page.locator(".model-calibration input").fill("2");
  // Intersect the box from two distinct positions near its screen center.
  const canvas = page.locator(".model-canvas canvas"); await canvas.scrollIntoViewIfNeeded(); const box = await canvas.boundingBox();
  await page.mouse.click(box!.x + box!.width * .48, box!.y + box!.height * .5);
  await page.mouse.click(box!.x + box!.width * .52, box!.y + box!.height * .5);
  await expect(page.locator(".model-calibration button")).toBeEnabled();
  await page.locator(".model-calibration button").click();
  await expect(page.locator(".model-calibration")).toHaveCount(0);
  await page.locator('input[type="file"]').setInputFiles(join(fixtures, "BoxTextured.gltf"));
  await expect(page.locator(".model-error")).toContainText("referenced asset is missing");
});

test("49 MB IFC cancellation stays interactive and complete loading exposes storeys", async ({ page }, testInfo) => {
  test.setTimeout(180000);
  await page.goto("/en/tools/3d-viewer");
  await page.locator('input[type="file"]').setInputFiles(join(fixtures, "large.ifc"));
  await expect(page.getByRole("button", { name: "Cancel loading", exact: true })).toBeVisible();
  const cancelStart = Date.now();
  await page.getByRole("button", { name: "Cancel loading", exact: true }).click();
  await expect(page.locator(".model-notice")).toContainText("cancelled");
  const cancellationMs = Date.now() - cancelStart;
  expect(cancellationMs).toBeLessThan(1500);
  const start = Date.now();
  await page.locator('input[type="file"]').setInputFiles(join(fixtures, "large.ifc"));
  await expect(page.locator(".model-stage-footer, .model-error").first()).toBeVisible({ timeout: 125000 });
  await expect(page.locator(".model-stage-footer")).toContainText("large.ifc", { timeout: 125000 });
  await expect(page.locator(".model-component-list button").first()).toBeVisible();
  await testInfo.attach("large-ifc-timings", { body: JSON.stringify({ project: testInfo.project.name, bytes: 49286967, loadMs: Date.now() - start, cancellationMs, source: "tests/fixtures/models/sources.json" }), contentType: "application/json" });
});
