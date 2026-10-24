import { test, expect } from "@playwright/test";
import { readFile, access } from "node:fs/promises";
import JSZip from "jszip";
import { decode, encode } from "fast-png";
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

test("scan ZIP loads a textured OBJ and replays paired photo, depth, confidence and camera frames", async ({ page }) => {
  test.setTimeout(120000);
  await page.goto("/en/tools/3d-viewer");
  const photoDataUrl = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 9; canvas.height = 16;
    const context = canvas.getContext("2d")!; context.fillStyle = "#c56b40"; context.fillRect(0, 0, 9, 8);
    context.fillStyle = "#327b95"; context.fillRect(0, 8, 9, 8);
    return canvas.toDataURL("image/jpeg", .82);
  });
  const photo = Buffer.from(photoDataUrl.split(",")[1], "base64");
  const depth = encode({ width: 2, height: 2, depth: 16, channels: 1, data: new Uint16Array([0, 250, 900, 2200]) });
  const confidence = encode({ width: 2, height: 2, depth: 8, channels: 1, data: new Uint8Array([0, 1, 2, 2]) });
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const matrixKeys = ["m11", "m12", "m13", "m14", "m21", "m22", "m23", "m24", "m31", "m32", "m33", "m34", "m41", "m42", "m43", "m44"];
  const worldTransform = Object.fromEntries(matrixKeys.map((key, index) => [key, identity[index]]));
  const pose = (z: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, z, 0, 0, 0, 1];
  const projection = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1.002, -.2002, 0, 0, -1, 0];
  const zip = new JSZip();
  const root = "sample-scan";
  zip.file(`${root}/info.json`, JSON.stringify({ title: "Sample scan", numImages: 1, transformToWorldMap: worldTransform }));
  const intrinsics = [9, 0, 4.5, 0, 16, 8, 0, 0, 1];
  zip.file(`${root}/frame_00000.json`, JSON.stringify({ frame_index: 0, time: 10, cameraPoseARFrame: pose(2), projectionMatrix: projection, intrinsics, captureDimensions: [9, 16] }));
  zip.file(`${root}/frame_00000.jpg`, photo);
  zip.file(`${root}/depth_00000.png`, depth);
  zip.file(`${root}/conf_00000.png`, confidence);
  zip.file(`${root}/frame_00001.json`, JSON.stringify({ frame_index: 1, time: 10.15, cameraPoseARFrame: pose(1.8), projectionMatrix: projection, intrinsics, captureDimensions: [9, 16] }));
  zip.file(`${root}/depth_00001.png`, depth);
  zip.file(`${root}/conf_00001.png`, confidence);
  zip.file(`${root}/textured_output.obj`, "mtllib textured_output.mtl\nv -1 -1 0\nv 1 -1 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt .5 1\nvn 0 0 1\nusemtl scan\nf 1/1/1 2/2/1 3/3/1\n");
  zip.file(`${root}/textured_output.mtl`, "newmtl scan\nKd 1.0 1.0 1.0\nmap_Kd textured_output.jpg\n");
  zip.file(`${root}/textured_output.jpg`, photo);
  zip.file(`${root}/export.obj`, "v -1 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n");
  const usdz = new JSZip();
  usdz.file("textured_output.usda", `#usda 1.0\n(\n    defaultPrim = "Root"\n    metersPerUnit = 1\n    upAxis = "Y"\n)\ndef Xform "Root" {\n    def Mesh "Triangle" {\n        int[] faceVertexCounts = [3]\n        int[] faceVertexIndices = [0, 1, 2]\n        point3f[] points = [(-1, 0, 0), (1, 0, 0), (0, 1, 0)]\n        normal3f[] normals = [(0, 0, 1), (0, 0, 1), (0, 0, 1)]\n    }\n}\n`, { compression: "STORE" });
  zip.file(`${root}/Untitled_Scan.usdz`, await usdz.generateAsync({ type: "nodebuffer", compression: "STORE" }));
  const archive = await zip.generateAsync({ type: "nodebuffer" });
  const external: string[] = [];
  page.on("request", (request) => { if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== new URL(page.url()).origin) external.push(request.url()); });
  await page.locator('input[type="file"]').setInputFiles({ name: "sample-scan.zip", mimeType: "application/zip", buffer: archive });
  await expect(page.locator(".model-stage-footer")).toContainText("textured_output.obj", { timeout: 30000 });
  await expect(page.locator(".scan-project-panel")).toContainText("Sample scan");
  await expect(page.locator(".scan-project-panel")).toContainText("2 frames · 1 photos");
  const photoCanvas = page.locator(".scan-photo-canvas");
  await expect(photoCanvas).toBeVisible();
  await expect.poll(() => photoCanvas.evaluate((canvas: HTMLCanvasElement) => [canvas.width, canvas.height])).toEqual([9, 16]);
  await expect.poll(() => photoCanvas.evaluate((canvas: HTMLCanvasElement) => canvas.clientHeight / canvas.clientWidth)).toBeGreaterThan(1.6);
  const imagePixels = await photoCanvas.evaluate((canvas: HTMLCanvasElement) => { const context = canvas.getContext("2d")!; return [...context.getImageData(0, 0, canvas.width, canvas.height).data].filter((_value, index) => index % 4 === 3).length; });
  expect(imagePixels).toBeGreaterThan(100);
  await page.getByRole("button", { name: "Rotate this frame 90 degrees clockwise" }).click();
  await expect.poll(() => photoCanvas.evaluate((canvas: HTMLCanvasElement) => [canvas.width, canvas.height])).toEqual([16, 9]);
  await page.getByRole("button", { name: "Apply to entire scan" }).click();
  await page.getByRole("button", { name: "Depth", exact: true }).click();
  await expect(page.locator(".scan-preview canvas")).toBeVisible();
  await expect(page.locator(".scan-depth-range")).toContainText("250–2200");
  const depthPixels = await page.locator(".scan-preview canvas").evaluate((canvas: HTMLCanvasElement) => [...canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data].filter((_value, index) => index % 4 === 3).length);
  expect(depthPixels).toBeGreaterThan(0);
  await page.locator(".scan-preview canvas").hover({ position: { x: 1, y: 1 } });
  await expect(page.locator(".scan-depth-readout")).toContainText("Raw depth");
  await page.getByRole("button", { name: "Next frame" }).click();
  await expect(page.locator(".scan-project-panel")).toContainText("Frame 2/2");
  await expect(page.locator(".scan-photo-orientation span")).toHaveText("90°");
  await page.getByRole("button", { name: "Photo", exact: true }).click();
  await expect(page.locator(".scan-preview")).toContainText("This frame has no photo");
  await page.getByRole("button", { name: "Confidence", exact: true }).click();
  await expect(page.locator(".scan-preview canvas")).toBeVisible();
  const confidencePixels = await page.locator(".scan-preview canvas").evaluate((canvas: HTMLCanvasElement) => [...canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data].filter((_value, index) => index % 4 === 3).length);
  expect(confidencePixels).toBeGreaterThan(0);
  await page.getByRole("checkbox", { name: "Show capture path" }).uncheck();
  await page.getByRole("checkbox", { name: "Follow capture view" }).check();
  await expect(page.locator(".scan-follow-issue")).toHaveCount(0);
  const followedFrame = decode(await page.locator(".model-canvas canvas").screenshot());
  const followedColors = new Set<number>();
  for (let index = 0; index < followedFrame.data.length; index += followedFrame.channels) {
    const pixel = ((followedFrame.data[index] ?? 0) >> 4) << 8 | ((followedFrame.data[index + 1] ?? 0) >> 4) << 4 | ((followedFrame.data[index + 2] ?? 0) >> 4);
    followedColors.add(pixel);
  }
  expect(followedColors.size).toBeGreaterThan(8);
  await page.getByRole("checkbox", { name: "Follow capture view" }).uncheck();
  await page.locator(".scan-project-panel select").first().selectOption({ label: "export.obj" });
  await expect(page.locator(".model-stage-footer")).toContainText("export.obj");
  await page.locator(".scan-project-panel select").first().selectOption({ label: "Untitled_Scan.usdz" });
  await expect(page.locator(".model-stage-footer")).toContainText("Untitled_Scan.usdz");
  await page.evaluate(() => {
    const workbench = document.querySelector(".model-workbench")!;
    Object.defineProperty(workbench, "requestFullscreen", { configurable: true, value: () => Promise.reject(new Error("fullscreen denied")) });
  });
  await page.getByRole("button", { name: "Enter immersive fullscreen" }).click();
  const workbench = page.locator(".model-workbench");
  await expect(workbench).toHaveAttribute("data-immersive", "fallback");
  await expect(workbench).toHaveCSS("position", "fixed");
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  await page.getByRole("button", { name: "Viewer settings and frame preview" }).click();
  await expect(page.locator("#model-settings-panel")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(workbench).not.toHaveAttribute("data-immersive", "fallback");
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
  await expect(page.getByRole("button", { name: "Enter immersive fullscreen" })).toBeFocused();
  expect(external).toEqual([]);
});

test("human reference can be placed on a floor and first and third person use its scale", async ({ page }) => {
  await page.goto("/en/tools/3d-viewer");
  await page.locator('input[type="file"]').setInputFiles(join(fixtures, "box.glb"));
  await expect(page.locator(".model-stage-footer")).toContainText("box.glb");
  const firstPerson = page.getByRole("button", { name: "First person" });
  const thirdPerson = page.getByRole("button", { name: "Third person" });
  await expect(firstPerson).toBeDisabled();
  await page.getByRole("button", { name: "Place person" }).click();
  const canvas = page.locator(".model-canvas canvas");
  const bounds = await canvas.boundingBox();
  await page.mouse.click(bounds!.x + bounds!.width * .5, bounds!.y + bounds!.height * .42);
  await expect(firstPerson).toBeEnabled();
  await expect(thirdPerson).toBeEnabled();
  await page.getByRole("button", { name: "First person" }).click();
  await expect(firstPerson).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Third person" }).click();
  await expect(thirdPerson).toHaveAttribute("aria-pressed", "true");
  const height = page.locator('.model-side-section input[type="range"]').nth(0);
  await height.focus(); await height.press("ArrowRight");
  await expect(page.locator(".model-side-section output").first()).toHaveText("1.71 m");
  await expect(page.locator('.model-side-section input[type="range"]').nth(1)).toHaveAttribute("max", "1.71");
});

test("immersive view uses browser fullscreen where available and restores the trigger", async ({ page }) => {
  await page.goto("/en/tools/3d-viewer");
  await page.locator('input[type="file"]').setInputFiles(join(fixtures, "box.glb"));
  await expect(page.locator(".model-stage-footer")).toContainText("box.glb");
  const enter = page.getByRole("button", { name: "Enter immersive fullscreen" });
  await enter.click();
  const workbench = page.locator(".model-workbench");
  await expect(workbench).toHaveAttribute("data-immersive", /^(native|fallback)$/);
  const mode = await workbench.getAttribute("data-immersive");
  if (mode === "native") await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  else await expect(workbench).toHaveCSS("position", "fixed");
  await page.keyboard.press("Escape");
  await expect(workbench).not.toHaveAttribute("data-immersive", /^(native|fallback)$/);
  await expect(enter).toBeFocused();
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
