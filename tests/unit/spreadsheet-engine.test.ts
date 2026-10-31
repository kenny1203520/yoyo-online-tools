import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { SpreadsheetEngine, SpreadsheetEngineError } from "../../src/lib/spreadsheet-engine";

const importOptions = { hasHeader: true, delimiter: "", encoding: "utf-8" as const };

async function makeXlsxFile(name: string, workbook: ExcelJS.Workbook): Promise<File> {
  const bytes = await workbook.xlsx.writeBuffer();
  return new File([bytes], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

test("XLSX import exposes sheet headers and export retains formulas, styles, and other sheets", async () => {
  const source = new ExcelJS.Workbook();
  const sheet = source.addWorksheet("Inventory");
  sheet.addRow(["code", "calculated"]);
  sheet.addRow(["00123", { formula: "1+1", result: 2 }]);
  sheet.getCell("A2").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFF0000" } };
  source.addWorksheet("Notes").addRow(["keep this sheet"]);
  const engine = new SpreadsheetEngine();
  const [document] = await engine.importFiles([await makeXlsxFile("inventory.xlsx", source)], importOptions, () => {});
  assert.ok(document);
  assert.deepEqual(document.sheets[0]?.headers, ["code", "calculated"]);
  assert.equal(document.formulaCount, 1);
  assert.equal(engine.getRows(document.id, document.activeSheetId, 0, 10, false)[0]?.column_0, "00123");
  assert.throws(() => engine.editCells(document.id, document.activeSheetId, [{ row: 0, column: 1, value: "replace formula" }]), (error: unknown) => error instanceof SpreadsheetEngineError && error.code === "formulaCellReadOnly");
  assert.throws(() => engine.editCells(document.id, document.activeSheetId, [
    { row: 0, column: 0, value: "must not be partially applied" },
    { row: 0, column: 1, value: "replace formula" },
  ]), (error: unknown) => error instanceof SpreadsheetEngineError && error.code === "formulaCellReadOnly");
  assert.throws(() => engine.renameColumn(document.id, document.activeSheetId, 0, "renamed"), (error: unknown) => error instanceof SpreadsheetEngineError && error.code === "xlsxStructureBlocked");
  assert.throws(() => engine.moveColumn(document.id, document.activeSheetId, 0, 1), (error: unknown) => error instanceof SpreadsheetEngineError && error.code === "xlsxStructureBlocked");
  assert.equal(engine.getRows(document.id, document.activeSheetId, 0, 10, false)[0]?.column_0, "00123");

  engine.editCells(document.id, document.activeSheetId, [{ row: 0, column: 0, value: "00077" }]);
  const exported = await engine.export(document.id, document.activeSheetId, "xlsx");
  const roundTrip = new ExcelJS.Workbook();
  await roundTrip.xlsx.load(exported.buffer);
  assert.equal(roundTrip.worksheets.length, 2);
  assert.equal(roundTrip.getWorksheet("Inventory")?.getCell("A2").value, "00077");
  assert.deepEqual(roundTrip.getWorksheet("Inventory")?.getCell("B2").value, { formula: "1+1", result: 2 });
  const outputPackage = await JSZip.loadAsync(exported.buffer);
  const outputWorkbookXml = await outputPackage.file("xl/workbook.xml")?.async("string");
  assert.match(outputWorkbookXml ?? "", /<calcPr[^>]*fullCalcOnLoad="1"/u);
  assert.equal(roundTrip.getWorksheet("Inventory")?.getCell("A2").fill && "fgColor" in (roundTrip.getWorksheet("Inventory")?.getCell("A2").fill ?? {}), true);
  const restoredFill = roundTrip.getWorksheet("Inventory")?.getCell("A2").fill;
  assert.ok(restoredFill && "pattern" in restoredFill && restoredFill.pattern === "solid");
  assert.equal(restoredFill && "fgColor" in restoredFill ? restoredFill.fgColor?.argb : undefined, "FFFF0000");
  assert.equal(roundTrip.getWorksheet("Notes")?.getCell("A1").value, "keep this sheet");
});

test("CSV column names and order are editable and undo/redo restores the exact table", async () => {
  const file = new File(["id,name,extra\n001,Alice,x\n002,Bob,y\n"], "people.csv", { type: "text/csv" });
  const engine = new SpreadsheetEngine();
  const [document] = await engine.importFiles([file], importOptions, () => {});
  assert.ok(document);
  const sheetId = document.activeSheetId;

  const renamed = engine.renameColumn(document.id, sheetId, 1, "full name");
  assert.deepEqual(renamed.sheets[0]?.headers, ["id", "full name", "extra"]);
  assert.equal(engine.undo(document.id).canRedo, true);
  assert.deepEqual(engine.listDocuments()[0]?.sheets[0]?.headers, ["id", "name", "extra"]);
  engine.redo(document.id);
  assert.deepEqual(engine.listDocuments()[0]?.sheets[0]?.headers, ["id", "full name", "extra"]);

  const moved = engine.moveColumn(document.id, sheetId, 0, 2);
  assert.deepEqual(moved.sheets[0]?.headers, ["full name", "extra", "id"]);
  assert.deepEqual(engine.getRows(document.id, sheetId, 0, 10, false).map((row) => [row.column_0, row.column_1, row.column_2]), [["Alice", "x", "001"], ["Bob", "y", "002"]]);
  engine.undo(document.id);
  assert.deepEqual(engine.listDocuments()[0]?.sheets[0]?.headers, ["id", "full name", "extra"]);
  assert.deepEqual(engine.getRows(document.id, sheetId, 0, 10, false).map((row) => [row.column_0, row.column_1, row.column_2]), [["001", "Alice", "x"], ["002", "Bob", "y"]]);
  engine.redo(document.id);
  assert.deepEqual(engine.listDocuments()[0]?.sheets[0]?.headers, ["full name", "extra", "id"]);
});

test("CSV column rename requires a header and valid non-empty names", async () => {
  const file = new File(["a,b\n1,2\n"], "data.csv", { type: "text/csv" });
  const engine = new SpreadsheetEngine();
  const [document] = await engine.importFiles([file], importOptions, () => {});
  assert.ok(document);
  engine.setHeader(document.id, false);
  assert.throws(() => engine.renameColumn(document.id, document.activeSheetId, 0, "value"), (error: unknown) => error instanceof SpreadsheetEngineError && error.code === "headerRequired");
  engine.setHeader(document.id, true);
  assert.throws(() => engine.renameColumn(document.id, document.activeSheetId, 0, "  "), (error: unknown) => error instanceof SpreadsheetEngineError && error.code === "columnNameInvalid");
  assert.throws(() => engine.moveColumn(document.id, document.activeSheetId, 0, 2), (error: unknown) => error instanceof SpreadsheetEngineError && error.code === "structurePositionInvalid");
});

test("CSV row and column structure changes are atomic and undo/redo restores exact rows", async () => {
  const file = new File(["id,name,extra\n001,Alice,x\n002,Bob,y\n"], "people.csv", { type: "text/csv" });
  const engine = new SpreadsheetEngine();
  const [document] = await engine.importFiles([file], importOptions, () => {});
  assert.ok(document);
  assert.equal(document.supportsStructure, true);
  assert.equal(document.canUndo, false);

  const original = engine.getRows(document.id, document.activeSheetId, 0, 10, false).map((row) => [row.column_0, row.column_1, row.column_2]);
  const afterDelete = engine.editStructure(document.id, document.activeSheetId, "row", "delete", 0);
  assert.equal(afterDelete.canUndo, true);
  assert.deepEqual(engine.getRows(document.id, document.activeSheetId, 0, 10, false).map((row) => row.column_0), ["002"]);
  const afterUndo = engine.undo(document.id);
  assert.equal(afterUndo.canRedo, true);
  assert.deepEqual(engine.getRows(document.id, document.activeSheetId, 0, 10, false).map((row) => [row.column_0, row.column_1, row.column_2]), original);
  engine.redo(document.id);
  assert.deepEqual(engine.getRows(document.id, document.activeSheetId, 0, 10, false).map((row) => row.column_0), ["002"]);
  engine.undo(document.id);

  engine.editStructure(document.id, document.activeSheetId, "column", "delete", 1);
  assert.equal(engine.getRows(document.id, document.activeSheetId, 0, 10, false)[0]?.column_1, "x");
  engine.undo(document.id);
  assert.deepEqual(engine.getRows(document.id, document.activeSheetId, 0, 10, false).map((row) => [row.column_0, row.column_1, row.column_2]), original);

  engine.editStructure(document.id, document.activeSheetId, "row", "insert", 2);
  assert.equal(engine.getRows(document.id, document.activeSheetId, 0, 10, false).length, 3);
  engine.undo(document.id);
  assert.deepEqual(engine.getRows(document.id, document.activeSheetId, 0, 10, false).map((row) => [row.column_0, row.column_1, row.column_2]), original);
  engine.editStructure(document.id, document.activeSheetId, "column", "insert", 1);
  assert.equal(engine.getRows(document.id, document.activeSheetId, 0, 10, false)[0]?.column_1, null);
  engine.undo(document.id);
  assert.deepEqual(engine.getRows(document.id, document.activeSheetId, 0, 10, false).map((row) => [row.column_0, row.column_1, row.column_2]), original);
});

test("deleting the last CSV row that used a column updates dimensions and undo restores it", async () => {
  const file = new File(["id,name\n001,Alice\n002,Bob,extra\n"], "ragged.csv", { type: "text/csv" });
  const engine = new SpreadsheetEngine();
  const [document] = await engine.importFiles([file], importOptions, () => {});
  assert.ok(document);
  assert.equal(document.sheets[0]?.columnCount, 3);
  const shrunk = engine.editStructure(document.id, document.activeSheetId, "row", "delete", 1);
  assert.equal(shrunk.sheets[0]?.columnCount, 2);
  const restored = engine.undo(document.id);
  assert.equal(restored.sheets[0]?.columnCount, 3);
  assert.deepEqual(engine.getRows(document.id, document.activeSheetId, 0, 10, false).map((row) => [row.column_0, row.column_1, row.column_2]), [["001", "Alice", null], ["002", "Bob", "extra"]]);
});

test("undo restores an XLSX date as a Date value rather than text", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Dates");
  sheet.addRow(["date"]);
  const date = new Date("2024-03-10T12:30:00.000Z");
  sheet.getCell("A2").value = date;
  sheet.getCell("A2").numFmt = "yyyy-mm-dd hh:mm";
  const engine = new SpreadsheetEngine();
  const [document] = await engine.importFiles([await makeXlsxFile("dates.xlsx", workbook)], importOptions, () => {});
  assert.ok(document);
  engine.editCells(document.id, document.activeSheetId, [{ row: 0, column: 0, value: "edited" }]);
  engine.undo(document.id);
  const output = await engine.export(document.id, document.activeSheetId, "xlsx");
  const roundTrip = new ExcelJS.Workbook();
  await roundTrip.xlsx.load(output.buffer);
  const restored = roundTrip.getWorksheet("Dates")?.getCell("A2").value;
  assert.ok(restored instanceof Date);
  assert.equal(restored.toISOString(), date.toISOString());
});

test("cleaning creates a separate review-gated result and rejects it after source changes", async () => {
  const source = new ExcelJS.Workbook();
  const sheet = source.addWorksheet("Data");
  sheet.addRows([
    ["id", "value"],
    ["1", "  keep  "],
    ["1", "duplicate"],
    [" ", "  "],
    ["3", ""],
  ]);
  const engine = new SpreadsheetEngine();
  const [document] = await engine.importFiles([await makeXlsxFile("clean.xlsx", source)], importOptions, () => {});
  assert.ok(document);
  const preview = engine.previewClean(document.id, document.activeSheetId, {
    trimCells: true,
    removeEmptyRows: true,
    deduplicate: true,
    keyColumns: [0],
    requiredColumns: [1],
  });
  assert.equal(preview.trimmedCells, 3);
  assert.equal(preview.removedEmptyRows, 1);
  assert.equal(preview.removedDuplicates, 1);
  assert.equal(preview.missingRequiredRows, 1);
  assert.deepEqual(preview.missingRequiredRowNumbers, [4]);

  const result = await engine.applyClean(preview.planId);
  assert.equal(result.isResult, true);
  assert.equal(result.resultConfirmed, false);
  assert.equal(engine.getRows(document.id, document.activeSheetId, 0, 10, false).length, 4);
  assert.deepEqual(engine.getRows(result.id, result.activeSheetId, 0, 10, false).map((row) => [row.column_0, row.column_1]), [["1", "keep"], ["3", ""]]);
  await assert.rejects(engine.export(result.id, result.activeSheetId, "xlsx"), (error: unknown) => error instanceof SpreadsheetEngineError && error.code === "resultNotConfirmed");

  engine.confirmResult(result.id);
  const output = await engine.export(result.id, result.activeSheetId, "xlsx");
  const cleaned = new ExcelJS.Workbook();
  await cleaned.xlsx.load(output.buffer);
  assert.equal(cleaned.getWorksheet("Data")?.rowCount, 3);
  assert.equal(cleaned.getWorksheet("Data")?.getCell("B2").value, "keep");

  engine.editCells(document.id, document.activeSheetId, [{ row: 0, column: 0, value: "changed" }]);
  await assert.rejects(engine.export(result.id, result.activeSheetId, "xlsx"), (error: unknown) => error instanceof SpreadsheetEngineError && error.code === "staleResult");
});

test("merged XLSX content is viewable but blocks editing and export", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Merged");
  sheet.addRow(["A", "B"]);
  sheet.mergeCells("A2:B2");
  sheet.getCell("A2").value = "joined";
  const engine = new SpreadsheetEngine();
  const [document] = await engine.importFiles([await makeXlsxFile("merged.xlsx", workbook)], importOptions, () => {});
  assert.ok(document);
  assert.ok(document.blockers.some((blocker) => blocker.includes("Merged cells")));
  assert.throws(() => engine.editCells(document.id, document.activeSheetId, [{ row: 0, column: 0, value: "unsafe" }]), (error: unknown) => error instanceof SpreadsheetEngineError && error.code === "unsafeWorkbookEdit");
  await assert.rejects(engine.export(document.id, document.activeSheetId, "xlsx"), (error: unknown) => error instanceof SpreadsheetEngineError && error.code === "unsafeWorkbookExport");
});
