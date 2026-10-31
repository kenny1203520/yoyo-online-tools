// One construction site per Worker keeps webpack's generated URL identical for
// offline preparation and actual processing (separate sites can emit distinct IDs).
export function createDeveloperWorker() { return new Worker(new URL("../workers/developer.worker.ts", import.meta.url), { type: "module" }); }
export function createTextWorker() { return new Worker(new URL("../workers/text.worker.ts", import.meta.url), { type: "module" }); }
export function createSpreadsheetWorker() { return new Worker(new URL("../workers/spreadsheet.worker.ts", import.meta.url), { type: "module" }); }
