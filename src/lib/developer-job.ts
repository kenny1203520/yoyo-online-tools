import { compareJson, decodeBase64, DeveloperError, encodeBase64, formatJson, makeDiff, MAX_ENGINEER_INPUT_BYTES, MAX_ENGINEER_OUTPUT_BYTES, parseIsoDate, parseTimestamp, transformUrl, utf8Bytes, type DeveloperErrorCode } from "./developer-processing";

export type RegexMatch = { value: string; index: number; captures: string[]; named: Record<string, string> };
export type DeveloperJob = {
  requestId: number; version: number;
  mode: "json" | "diff" | "base64" | "url" | "timestamp" | "regex";
  source: string; other: string; indent: string; minify: boolean;
  diffMode: "text" | "json"; ignoreTrailingWhitespace: boolean;
  base64Mode: "standard" | "url"; urlMode: "component" | "url"; direction: "encode" | "decode";
  timestampUnit: "seconds" | "milliseconds"; timestampDirection: "toDate" | "toTimestamp"; iso: string;
  pattern: string; flags: string; replacement: string; locale: string;
  labels: { same: string; different: string; left: string; right: string; utc: string; taipei: string; local: string };
};
export type DeveloperReply = { requestId: number; version: number } & (
  { status: "success"; output: string; groups: RegexMatch[] } |
  { status: "error"; code: DeveloperErrorCode | "developerOperationFailed"; position?: number; side?: "source" | "other" }
);

export function executeDeveloperJob(job: DeveloperJob): DeveloperReply {
  try {
    if (utf8Bytes(job.source) > MAX_ENGINEER_INPUT_BYTES || (job.mode === "diff" && utf8Bytes(job.other) > MAX_ENGINEER_INPUT_BYTES)) throw new DeveloperError("developerInputTooLarge", "Input exceeds 1 MiB per field.");
    if (job.mode === "diff" && [job.source, job.other].some((value) => value.split(/\r\n?|\n/).length > 10000)) throw new DeveloperError("developerLineLimit", "Each input may contain at most 10,000 lines.");
    let output = "";
    let groups: RegexMatch[] = [];
    switch (job.mode) {
      case "json": output = formatJson(job.source, job.indent === "tab" ? "\t" : Number(job.indent), job.minify); break;
      case "diff": {
        if (job.diffMode === "json") {
          const compared = compareJson(job.source, job.other);
          output = compared.equal ? job.labels.same : `${job.labels.different}\n\n${compared.differences.map((item) => `${item.path}\n  ${job.labels.left}: ${item.left}\n  ${job.labels.right}: ${item.right}`).join("\n\n")}`;
        } else output = makeDiff(job.source, job.other, job.ignoreTrailingWhitespace).map((part) => part.value.split(/(?<=\n)/u).map((line) => `${part.added ? "+ " : part.removed ? "− " : "  "}${line}`).join("")).join("");
        break;
      }
      case "base64": output = job.direction === "encode" ? encodeBase64(job.source, job.base64Mode === "url") : decodeBase64(job.source, job.base64Mode === "url"); break;
      case "url": output = transformUrl(job.source, job.direction, job.urlMode); break;
      case "timestamp": {
        if (job.timestampDirection === "toDate") {
          const date = parseTimestamp(job.source, job.timestampUnit);
          output = `${job.labels.utc}: ${date.toISOString()}\n${job.labels.taipei}: ${date.toLocaleString(job.locale, { timeZone: "Asia/Taipei", hour12: false })}\n${job.labels.local}: ${date.toLocaleString(job.locale, { hour12: false })}`;
        } else {
          const date = parseIsoDate(job.iso);
          output = String(date.getTime() / (job.timestampUnit === "seconds" ? 1000 : 1));
        }
        break;
      }
      case "regex": {
        if (utf8Bytes(job.source) > 100 * 1024 || utf8Bytes(job.pattern) > 4 * 1024) throw new DeveloperError("developerRegexLimit", "Regex text limit 100 KiB; pattern limit 4 KiB.");
        let expression: RegExp;
        try { expression = new RegExp(job.pattern, job.flags); } catch { throw new DeveloperError("developerInvalidRegex", "Invalid JavaScript regular expression or flags."); }
        const matching = new RegExp(job.pattern, job.flags.includes("g") ? job.flags : `${job.flags}g`);
        // Iterate incrementally: never materialize an unbounded matchAll iterator.
        for (const match of job.source.matchAll(matching)) {
          if (groups.length >= 1000) throw new DeveloperError("developerRegexLimit", "More than 1,000 matches.");
          groups.push({ value: match[0], index: match.index ?? 0, captures: match.slice(1), named: match.groups ?? {} });
        }
        output = job.source.replace(expression, job.replacement);
        break;
      }
    }
    if (utf8Bytes(output) > MAX_ENGINEER_OUTPUT_BYTES) throw new DeveloperError("developerOutputTooLarge", "Output exceeds 4 MiB.");
    return { requestId: job.requestId, version: job.version, status: "success", output, groups };
  } catch (error) {
    return { requestId: job.requestId, version: job.version, status: "error", code: error instanceof DeveloperError ? error.code : "developerOperationFailed", ...(error instanceof DeveloperError ? { position: error.position, side: error.side } : {}) };
  }
}
