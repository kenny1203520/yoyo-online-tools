import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendTables,
  cleanTableRows,
  compareTables,
  findMissingRequiredCells,
  joinTables,
  parseCsvText,
  stringifyCsv,
  stringifyTsv,
  tableKey,
  type TableCell,
} from "../../src/lib/spreadsheet-processing";

test("CSV parsing preserves quoted delimiters, line breaks, Unicode and text-like numbers", () => {
  const parsed = parseCsvText('id,name,note\r\n001,\"王,小明\",\"第一行\r\n第二行\"\r\n002,\"a\"\"b\",=1+1');
  assert.equal(parsed.delimiter, ",");
  assert.deepEqual(parsed.rows, [
    ["id", "name", "note"],
    ["001", "王,小明", "第一行\r\n第二行"],
    ["002", 'a"b', "=1+1"],
  ]);
  assert.deepEqual(parseCsvText(stringifyCsv(parsed.rows)).rows, parsed.rows);
});

test("CSV delimiter detection handles tabular exports without coercing cell values", () => {
  assert.deepEqual(parseCsvText("id\tamount\n0007\t0\n").rows, [["id", "amount"], ["0007", "0"]]);
  assert.deepEqual(parseCsvText("").rows, []);
});

test("TSV clipboard serialization round-trips quotes, tabs, newlines and Unicode", () => {
  const cells = [["001", "hello\tworld"], ["line\nbreak", 'quoted "word"'], ["\u7e41\u9ad4\u4e2d\u6587", null]] as const;
  assert.deepEqual(parseCsvText(stringifyTsv(cells), "\t").rows, [["001", "hello\tworld"], ["line\nbreak", 'quoted "word"'], ["\u7e41\u9ad4\u4e2d\u6587", ""]]);
});

test("cleaning keeps headers, removes blank data rows, trims cells and skips empty duplicate keys", () => {
  const result = cleanTableRows([
    [" id ", "name"],
    [" 001 ", " Alice "],
    ["", "  "],
    ["001", "Alice"],
    ["", "Bob"],
    ["", "Bob"],
  ], { hasHeader: true, trimCells: true, removeEmptyRows: true, deduplicate: true, keyColumns: [0] });
  assert.deepEqual(result.rows, [["id", "name"], ["001", "Alice"], ["", "Bob"], ["", "Bob"]]);
  assert.equal(result.removedEmptyRows, 1);
  assert.equal(result.removedDuplicates, 1);
});

test("required-field validation reports original data row numbers and field indexes", () => {
  assert.deepEqual(findMissingRequiredCells([["id", "name"], ["1", "A"], ["2", ""], ["", "B"]], [0, 1], true), [
    { row: 2, columns: [1] },
    { row: 3, columns: [0] },
  ]);
});

test("append unions header columns and keeps duplicate header names distinct", () => {
  assert.deepEqual(appendTables(
    [["id", "tag", "tag"], ["1", "a", "b"]],
    [["tag", "id", "extra"], ["c", "2", "x"]],
    true,
  ), [
    ["id", "tag", "tag", "extra"],
    ["1", "a", "b", null],
    ["2", "c", null, "x"],
  ]);
});

test("key comparison is type exact and empty keys never match", () => {
  assert.notEqual(tableKey([1], [0]), tableKey(["1"], [0]));
  assert.equal(tableKey([null], [0]), null);
  assert.equal(tableKey(["  "], [0]), null);
});

test("join blocks duplicate keys, labels conflicting columns, and leaves blank keys unmatched", () => {
  const joined = joinTables(
    [["id", "name"], ["1", "A"], ["", "B"]],
    [["id", "name", "team"], ["1", "Other", "red"]],
    [0], [0], true,
  );
  assert.deepEqual(joined, {
    ok: true,
    rows: [["id", "name", "name (2)", "team"], ["1", "A", "Other", "red"], ["", "B", null, null]],
    matchedRows: 1,
    unmatchedRows: 1,
    addedColumns: ["name (2)", "team"],
  });
  const conflict = joinTables([["id"], ["1"], ["1"]], [["id"], ["1"]], [0], [0], true);
  assert.equal(conflict.ok, false);
  if (!conflict.ok) assert.deepEqual(conflict.conflicts[0]?.rows, [1, 2]);
});

test("table comparison classifies added, removed and changed rows by exact key", () => {
  const diff = compareTables(
    [["id", "name"], ["1", "A"], ["2", "B"]],
    [["id", "name"], ["1", "A2"], ["3", "C"]],
    [0], [0], true,
  );
  assert.equal(diff.addedRows, 1);
  assert.equal(diff.removedRows, 1);
  assert.equal(diff.changedRows, 1);
  assert.deepEqual(diff.samples.map(({ kind }) => kind).sort(), ["added", "changed", "removed"]);
  assert.equal(compareTables([["id"], ["1"], ["1"]], [["id"], ["1"]], [0], [0], true).conflicts.length, 1);
});

test("table comparison treats every blank key as an independent added or removed row", () => {
  const diff = compareTables(
    [["id", "name"], ["", "old"], ["", "blank"], ["1", "same"]],
    [["id", "name"], ["", "new"], ["1", "same"]],
    [0], [0], true,
  );
  assert.equal(diff.addedRows, 1);
  assert.equal(diff.removedRows, 2);
  assert.equal(diff.changedRows, 0);
  assert.deepEqual(diff.samples.map(({ kind }) => kind).sort(), ["added", "removed", "removed"]);
});

test("CSV formulas and leading-zero values stay strings through round trip", () => {
  const source: TableCell[][] = [["code", "value"], ["00001", "=1+1"]];
  assert.deepEqual(parseCsvText(stringifyCsv(source)).rows, source);
});
