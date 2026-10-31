import Papa from "papaparse";

export type TableCell = string | number | boolean | null;
export type TableRows = TableCell[][];

export type CleanTableOptions = {
  hasHeader: boolean;
  trimCells: boolean;
  removeEmptyRows: boolean;
  deduplicate: boolean;
  keyColumns: number[];
};

export type CleanTableResult = {
  rows: TableRows;
  removedEmptyRows: number;
  removedDuplicates: number;
};

export type KeyConflict = { key: string; rows: number[] };

export type JoinTableResult =
  | { ok: true; rows: TableRows; matchedRows: number; unmatchedRows: number; addedColumns: string[] }
  | { ok: false; conflicts: KeyConflict[] };

export type TableDiff = {
  addedRows: number;
  removedRows: number;
  changedRows: number;
  conflicts: KeyConflict[];
  samples: Array<{ kind: "added" | "removed" | "changed"; key: string; row: number }>;
};

export function detectCsvDelimiter(text: string): string {
  const candidates = [",", "\t", ";", "|"];
  const counts = new Map(candidates.map((delimiter) => [delimiter, [] as number[]]));
  let quoted = false;
  let lineCounts = new Map(candidates.map((delimiter) => [delimiter, 0]));
  let lines = 0;
  for (let index = 0; index < text.length && lines < 20; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') index++;
      else quoted = !quoted;
    } else if (!quoted && candidates.includes(char ?? "")) {
      lineCounts.set(char!, (lineCounts.get(char!) ?? 0) + 1);
    } else if (!quoted && (char === "\n" || char === "\r")) {
      for (const delimiter of candidates) counts.get(delimiter)!.push(lineCounts.get(delimiter) ?? 0);
      lineCounts = new Map(candidates.map((delimiter) => [delimiter, 0]));
      lines++;
      if (char === "\r" && text[index + 1] === "\n") index++;
    }
  }
  if ([...lineCounts.values()].some((count) => count > 0)) {
    for (const delimiter of candidates) counts.get(delimiter)!.push(lineCounts.get(delimiter) ?? 0);
  }
  const score = (delimiter: string) => {
    const values = counts.get(delimiter) ?? [];
    const nonZero = values.filter((count) => count > 0);
    const mostCommon = new Map<number, number>();
    for (const count of nonZero) mostCommon.set(count, (mostCommon.get(count) ?? 0) + 1);
    return { consistentLines: Math.max(0, ...mostCommon.values()), columns: Math.max(0, ...mostCommon.keys()), total: nonZero.length };
  };
  return candidates
    .map((delimiter) => ({ delimiter, ...score(delimiter) }))
    .filter((result) => result.columns > 0)
    .sort((left, right) => right.consistentLines - left.consistentLines || right.columns - left.columns || right.total - left.total)[0]?.delimiter ?? ",";
}

export function parseCsvText(text: string, delimiter = ""): { rows: TableRows; delimiter: string } {
  if (text.length === 0) return { rows: [], delimiter: delimiter || "," };
  const selectedDelimiter = delimiter || detectCsvDelimiter(text.slice(0, 1_000_000));
  const parsed = Papa.parse<string[]>(text, {
    delimiter: selectedDelimiter,
    dynamicTyping: false,
    skipEmptyLines: false,
    quoteChar: '"',
    escapeChar: '"',
  });
  const fatal = parsed.errors.find((error) => error.type === "Quotes" && error.code === "MissingQuotes");
  if (fatal) throw new Error(`CSV row ${fatal.row ?? 0}: ${fatal.message}`);
  const rows = parsed.data.map((row) => row.map((cell) => cell));
  if (/[\r\n]$/u.test(text) && rows.at(-1)?.every((cell) => cell === "")) rows.pop();
  return { rows, delimiter: parsed.meta.delimiter || selectedDelimiter };
}

export function stringifyCsv(rows: readonly (readonly (TableCell | undefined)[])[], delimiter = ","): string {
  return Papa.unparse(rows.map((row) => row.map((cell) => cell === null || cell === undefined ? "" : String(cell))), {
    delimiter,
    newline: "\r\n",
    quotes: true,
    escapeChar: '"',
  });
}

export function stringifyTsv(rows: readonly (readonly (TableCell | undefined)[])[]): string {
  return Papa.unparse(rows.map((row) => row.map((cell) => cell === null || cell === undefined ? "" : String(cell))), {
    delimiter: "\t",
    newline: "\n",
    quotes: true,
    escapeChar: '"',
  });
}

export function isEmptyCell(value: TableCell | undefined): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

function keyPart(value: TableCell | undefined): string {
  if (value === null || value === undefined) return "null:";
  return `${typeof value}:${JSON.stringify(value)}`;
}

export function tableKey(row: readonly TableCell[], columns: readonly number[]): string | null {
  if (columns.length === 0) return null;
  const values = columns.map((index) => row[index]);
  if (values.some(isEmptyCell)) return null;
  return JSON.stringify(values.map(keyPart));
}

export function cleanTableRows(rows: readonly (readonly TableCell[])[], options: CleanTableOptions): CleanTableResult {
  const start = options.hasHeader ? 1 : 0;
  const output: TableRows = [];
  let removedEmptyRows = 0;
  let removedDuplicates = 0;
  const seen = new Set<string>();

  for (let index = 0; index < rows.length; index++) {
    const original = rows[index] ?? [];
    const row = options.trimCells ? original.map((cell) => typeof cell === "string" ? cell.trim() : cell) : [...original];
    const isHeader = options.hasHeader && index === 0;
    if (!isHeader && index >= start && options.removeEmptyRows && row.every(isEmptyCell)) {
      removedEmptyRows++;
      continue;
    }
    if (!isHeader && index >= start && options.deduplicate) {
      const keyColumns = options.keyColumns.length > 0 ? options.keyColumns : row.map((_, column) => column);
      const key = tableKey(row, keyColumns);
      if (key !== null && seen.has(key)) {
        removedDuplicates++;
        continue;
      }
      if (key !== null) seen.add(key);
    }
    output.push(row);
  }
  return { rows: output, removedEmptyRows, removedDuplicates };
}

export function findMissingRequiredCells(
  rows: readonly (readonly TableCell[])[],
  requiredColumns: readonly number[],
  hasHeader: boolean,
): Array<{ row: number; columns: number[] }> {
  const start = hasHeader ? 1 : 0;
  const missing: Array<{ row: number; columns: number[] }> = [];
  for (let index = start; index < rows.length; index++) {
    const columns = requiredColumns.filter((column) => isEmptyCell(rows[index]?.[column]));
    if (columns.length > 0) missing.push({ row: index - start + 1, columns });
  }
  return missing;
}

function columnIdentity(headers: readonly TableCell[], index: number): string {
  const label = headers[index] === null || headers[index] === undefined || headers[index] === ""
    ? `Column ${index + 1}`
    : String(headers[index]);
  let occurrence = 0;
  for (let prior = 0; prior < index; prior++) {
    const priorLabel = headers[prior] === null || headers[prior] === undefined || headers[prior] === ""
      ? `Column ${prior + 1}`
      : String(headers[prior]);
    if (priorLabel === label) occurrence++;
  }
  return `${label}\u0000${occurrence}`;
}

function buildHeaderMap(headers: readonly TableCell[]): Map<string, number> {
  return new Map(headers.map((_, index) => [columnIdentity(headers, index), index]));
}

function dataRows(rows: readonly (readonly TableCell[])[], hasHeader: boolean): readonly (readonly TableCell[])[] {
  return rows.slice(hasHeader ? 1 : 0);
}

function maxRowWidth(rows: readonly (readonly TableCell[])[]): number {
  let max = 0;
  for (const row of rows) max = Math.max(max, row.length);
  return max;
}

export function appendTables(
  leftRows: readonly (readonly TableCell[])[],
  rightRows: readonly (readonly TableCell[])[],
  hasHeader: boolean,
): TableRows {
  const leftHeader = hasHeader ? [...(leftRows[0] ?? [])] : [];
  const rightHeader = hasHeader ? [...(rightRows[0] ?? [])] : [];
  const leftColumns = Math.max(leftHeader.length, maxRowWidth(dataRows(leftRows, hasHeader)));
  const rightColumns = Math.max(rightHeader.length, maxRowWidth(dataRows(rightRows, hasHeader)));
  const outputHeader = hasHeader ? [...leftHeader] : [];
  const outputIds = hasHeader ? leftHeader.map((_, index) => columnIdentity(leftHeader, index)) : [];
  const outputMap = new Map(outputIds.map((identity, index) => [identity, index]));

  if (hasHeader) {
    for (let index = 0; index < rightColumns; index++) {
      const identity = index < rightHeader.length ? columnIdentity(rightHeader, index) : `Column ${index + 1}\u00000`;
      if (!outputMap.has(identity)) {
        outputMap.set(identity, outputHeader.length);
        outputHeader.push(rightHeader[index] ?? `Column ${index + 1}`);
      }
    }
  }

  const width = hasHeader ? outputHeader.length : Math.max(leftColumns, rightColumns);
  const output: TableRows = hasHeader ? [outputHeader] : [];
  const addRows = (source: readonly (readonly TableCell[])[], sourceHeader: readonly TableCell[]) => {
    for (const sourceRow of dataRows(source, hasHeader)) {
      const row: TableCell[] = Array(width).fill(null);
      for (let index = 0; index < sourceRow.length; index++) {
        const targetIndex = hasHeader
          ? outputMap.get(columnIdentity(sourceHeader, index)) ?? outputMap.get(`Column ${index + 1}\u00000`)
          : index;
        if (targetIndex !== undefined) row[targetIndex] = sourceRow[index] ?? null;
      }
      output.push(row);
    }
  };
  addRows(leftRows, leftHeader);
  addRows(rightRows, rightHeader);
  return output;
}

function collectKeyConflicts(rows: readonly (readonly TableCell[])[], keyColumns: readonly number[], hasHeader: boolean): KeyConflict[] {
  const positions = new Map<string, { rows: number[]; display: string }>();
  const sourceRows = dataRows(rows, hasHeader);
  sourceRows.forEach((row, index) => {
    const key = tableKey(row, keyColumns);
    if (key === null) return;
    const matches = positions.get(key);
    if (matches) matches.rows.push(index + 1);
    else positions.set(key, { rows: [index + 1], display: keyColumns.map((column) => String(row[column] ?? "")).join(" / ") });
  });
  return [...positions].filter(([, value]) => value.rows.length > 1).map(([, value]) => ({ key: value.display, rows: value.rows }));
}

export function joinTables(
  leftRows: readonly (readonly TableCell[])[],
  rightRows: readonly (readonly TableCell[])[],
  leftKeyColumns: readonly number[],
  rightKeyColumns: readonly number[],
  hasHeader: boolean,
): JoinTableResult {
  const conflicts = [
    ...collectKeyConflicts(leftRows, leftKeyColumns, hasHeader),
    ...collectKeyConflicts(rightRows, rightKeyColumns, hasHeader),
  ];
  if (conflicts.length > 0) return { ok: false, conflicts };

  const leftHeader = hasHeader ? [...(leftRows[0] ?? [])] : [];
  const rightHeader = hasHeader ? [...(rightRows[0] ?? [])] : [];
  const rightKeySet = new Set(rightKeyColumns);
  const rightWidth = hasHeader
    ? rightHeader.length
    : maxRowWidth(dataRows(rightRows, false));
  const rightAdditions = Array.from({ length: rightWidth }, (_, index) => ({
    name: rightHeader[index] ?? `Column ${index + 1}`,
    index,
  })).filter(({ index }) => !rightKeySet.has(index));
  const outputHeader = [...leftHeader];
  const usedLabels = new Set(outputHeader.map((value) => String(value ?? "")));
  const addedColumns = rightAdditions.map(({ name }, index) => {
    const base = String(name ?? `Column ${rightHeader.length + index + 1}`);
    let label = base;
    let suffix = 2;
    while (usedLabels.has(label)) label = `${base} (${suffix++})`;
    usedLabels.add(label);
    outputHeader.push(label);
    return label;
  });

  const rightByKey = new Map<string, readonly TableCell[]>();
  for (const row of dataRows(rightRows, hasHeader)) {
    const key = tableKey(row, rightKeyColumns);
    if (key !== null) rightByKey.set(key, row);
  }
  const output: TableRows = hasHeader ? [outputHeader] : [];
  let matchedRows = 0;
  let unmatchedRows = 0;
  for (const leftRow of dataRows(leftRows, hasHeader)) {
    const key = tableKey(leftRow, leftKeyColumns);
    const rightRow = key === null ? undefined : rightByKey.get(key);
    if (rightRow) matchedRows++;
    else unmatchedRows++;
    output.push([...leftRow, ...rightAdditions.map(({ index }) => rightRow?.[index] ?? null)]);
  }
  return { ok: true, rows: output, matchedRows, unmatchedRows, addedColumns };
}

export function compareTables(
  beforeRows: readonly (readonly TableCell[])[],
  afterRows: readonly (readonly TableCell[])[],
  beforeKeyColumns: readonly number[],
  afterKeyColumns: readonly number[],
  hasHeader: boolean,
  sampleLimit = 20,
): TableDiff {
  const conflicts = [
    ...collectKeyConflicts(beforeRows, beforeKeyColumns, hasHeader),
    ...collectKeyConflicts(afterRows, afterKeyColumns, hasHeader),
  ];
  if (conflicts.length > 0) return { addedRows: 0, removedRows: 0, changedRows: 0, conflicts, samples: [] };

  const beforeHeader = hasHeader ? [...(beforeRows[0] ?? [])] : [];
  const afterHeader = hasHeader ? [...(afterRows[0] ?? [])] : [];
  const beforeMap = buildHeaderMap(beforeHeader);
  const afterMap = buildHeaderMap(afterHeader);
  const comparable = hasHeader
    ? [...beforeMap.keys()].filter((identity) => afterMap.has(identity)).map((identity) => [beforeMap.get(identity)!, afterMap.get(identity)!] as const)
    : Array.from({ length: Math.min(maxRowWidth(dataRows(beforeRows, false)), maxRowWidth(dataRows(afterRows, false))) }, (_, index) => [index, index] as const)
      .filter(([beforeIndex, afterIndex]) => !beforeKeyColumns.includes(beforeIndex) && !afterKeyColumns.includes(afterIndex));
  const beforeByKey = new Map<string, { row: readonly TableCell[]; index: number }>();
  const afterByKey = new Map<string, { row: readonly TableCell[]; index: number }>();
  const beforeEmptyKeys: number[] = [];
  const afterEmptyKeys: number[] = [];
  for (const [index, row] of dataRows(beforeRows, hasHeader).entries()) {
    const key = tableKey(row, beforeKeyColumns);
    if (key !== null) beforeByKey.set(key, { row, index: index + 1 });
    else beforeEmptyKeys.push(index + 1);
  }
  for (const [index, row] of dataRows(afterRows, hasHeader).entries()) {
    const key = tableKey(row, afterKeyColumns);
    if (key !== null) afterByKey.set(key, { row, index: index + 1 });
    else afterEmptyKeys.push(index + 1);
  }

  const samples: TableDiff["samples"] = [];
  let addedRows = 0;
  let removedRows = 0;
  let changedRows = 0;
  for (const row of beforeEmptyKeys) {
    removedRows++;
    if (samples.length < sampleLimit) samples.push({ kind: "removed", key: "(blank key)", row });
  }
  for (const row of afterEmptyKeys) {
    addedRows++;
    if (samples.length < sampleLimit) samples.push({ kind: "added", key: "(blank key)", row });
  }
  const keys = new Set([...beforeByKey.keys(), ...afterByKey.keys()]);
  for (const key of keys) {
    const before = beforeByKey.get(key);
    const after = afterByKey.get(key);
    let kind: "added" | "removed" | "changed" | undefined;
    if (!before) { addedRows++; kind = "added"; }
    else if (!after) { removedRows++; kind = "removed"; }
    else if (comparable.some(([beforeIndex, afterIndex]) => !Object.is(before.row[beforeIndex], after.row[afterIndex]))) {
      changedRows++; kind = "changed";
    }
    const row = after?.index
      ?? before?.index
      ?? 0;
    if (kind && samples.length < sampleLimit) samples.push({ kind, key, row });
  }
  return { addedRows, removedRows, changedRows, conflicts: [], samples };
}
