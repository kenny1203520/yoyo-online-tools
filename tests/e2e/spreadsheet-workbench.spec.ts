import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const spreadsheetEnabled = process.env.NEXT_PUBLIC_ENABLE_SPREADSHEET_WORKBENCH === "true";

test("spreadsheet CSV editing, row history, clean review and responsive layout", async ({ page }) => {
  test.skip(!spreadsheetEnabled, "The spreadsheet workbench remains feature-flagged outside validation builds.");

  await page.goto("/en/tools/spreadsheet-workbench");
  await expect(page.getByRole("heading", { level: 1, name: "CSV and Excel Workbench" })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({
    name: "people.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("id,name\n001, Alice  \n002,Bob\n"),
  });
  await expect(page.getByTestId("spreadsheet-grid")).toBeVisible();
  await expect(page.locator(".spreadsheet-stats")).toContainText("Rows: 2");
  await expect(page.locator(".spreadsheet-grid")).toContainText("001");

  await page.getByRole("button", { name: "Delete row", exact: true }).click();
  await expect(page.locator(".spreadsheet-stats")).toContainText("Rows: 1");
  await expect(page.locator(".spreadsheet-grid")).toContainText("002");
  await page.getByRole("button", { name: "Undo last change", exact: true }).click();
  await expect(page.locator(".spreadsheet-stats")).toContainText("Rows: 2");
  await expect(page.locator(".spreadsheet-grid")).toContainText("001");

  await page.getByRole("button", { name: "Preview changes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Preview summary" })).toBeVisible();
  await page.getByRole("button", { name: "Create cleaned result", exact: true }).click();
  await expect(page.locator(".spreadsheet-review-box")).toBeVisible();
  await page.getByRole("checkbox", { name: "I reviewed the result and want to allow its download" }).check();
  await page.getByRole("button", { name: "Confirm result", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV copy", exact: true }).click();
  const download = await downloadPromise;
  const content = await readFile((await download.path())!);
  expect(content.toString("utf8")).toContain('"001","Alice"');

  for (const width of [320, 375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `document overflow at ${width}px`).toBe(true);
  }
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "document overflow at 200% text size").toBe(true);
});

test("spreadsheet CSV column rename and reorder stay aligned with row values", async ({ page }) => {
  test.skip(!spreadsheetEnabled, "The spreadsheet workbench remains feature-flagged outside validation builds.");

  await page.goto("/en/tools/spreadsheet-workbench");
  await page.locator('input[type="file"]').setInputFiles({
    name: "columns.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("id,name\n001,Alice\n"),
  });
  await expect(page.getByRole("columnheader", { name: "id" })).toBeVisible();
  await page.getByLabel("New column name").fill("Full name");
  await page.getByRole("button", { name: "Rename column", exact: true }).click();
  await expect(page.getByRole("columnheader", { name: "Full name" })).toBeVisible();

  await page.getByLabel("Column position").fill("1");
  await page.getByLabel("Move column to position").fill("2");
  await page.getByRole("button", { name: "Move column", exact: true }).click();
  const headers = page.locator(".rdg-header-row .rdg-cell");
  await expect(headers.nth(1)).toHaveText("Full name");
  await expect(headers.nth(2)).toHaveText("id");
  await expect(page.locator(".spreadsheet-grid")).toContainText("Alice");
  await expect(page.locator(".spreadsheet-grid")).toContainText("001");

  await page.getByRole("button", { name: "Undo last change", exact: true }).click();
  await expect(headers.nth(1)).toHaveText("id");
  await expect(headers.nth(2)).toHaveText("Full name");
});

test("spreadsheet workbench can process CSV after offline route preparation", async ({ page, context, browserName }) => {
  test.skip(!spreadsheetEnabled || browserName !== "chromium", "Offline service-worker behavior is checked in Chromium validation builds.");
  test.setTimeout(60000);

  await page.goto("/zh-TW/tools/spreadsheet-workbench");
  await expect(page.locator('[data-offline-ready="true"]')).toBeVisible({ timeout: 30000 });
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("h1")).toContainText("表格工作台");
  await page.locator('input[type="file"]').setInputFiles({
    name: "offline.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("編號,名稱\n0007,離線資料\n"),
  });
  await expect(page.getByTestId("spreadsheet-grid")).toBeVisible();
  await expect(page.locator(".spreadsheet-grid")).toContainText("0007");
  await context.setOffline(false);
});
