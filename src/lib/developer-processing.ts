import { compareLosslessNumber, isLosslessNumber, parse, stringify, type LosslessNumber } from "lossless-json";
import { diffLines } from "diff";

export const MAX_ENGINEER_INPUT_BYTES = 1024 * 1024;
export const MAX_ENGINEER_OUTPUT_BYTES = 4 * 1024 * 1024;
export type DeveloperErrorCode = "developerInvalidJson" | "developerJsonDepth" | "developerDiffLimit" | "developerLineLimit" | "developerInputTooLarge" | "developerOutputTooLarge" | "developerInvalidBase64" | "developerInvalidUtf8" | "developerInvalidUrl" | "developerInvalidTimestamp" | "developerTimestampPrecision" | "developerInvalidDate" | "developerTimezoneRequired" | "developerRegexLimit" | "developerInvalidRegex";
export class DeveloperError extends Error {
  constructor(public code: DeveloperErrorCode, message: string, public position?: number, public side: "source" | "other" = "source") { super(message); }
}
function readJson(source: string) {
  let depth = 0, quoted = false, escaped = false;
  for (const char of source) {
    if (quoted) { if (escaped) escaped = false; else if (char === "\\") escaped = true; else if (char === '"') quoted = false; }
    else if (char === '"') quoted = true;
    else if (char === "{" || char === "[") { if (++depth > 200) throw new DeveloperError("developerJsonDepth", "JSON exceeds the maximum nesting depth of 200."); }
    else if (char === "}" || char === "]") depth--;
  }
  try { return parse(source); }
  catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON";
    throw new DeveloperError("developerInvalidJson", message, Number(message.match(/position (\d+)/)?.[1] ?? source.length));
  }
}

export function formatJson(source: string, indent: number | string = 2, minify = false) {
  validateJson(source);
  // Whitespace-only formatting retains numeric-looking property order, number
  // literals and string escapes; JS object enumeration would reorder "10", "2".
  const tokens = source.match(/"(?:\\.|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\]:,]/g) ?? [];
  if (minify) return tokens.join("");
  const space = typeof indent === "string" ? indent : " ".repeat(indent);
  let level = 0;
  return tokens.map((token, index) => {
    if (token === "{" || token === "[") { level++; return token + (["}", "]"].includes(tokens[index + 1]) ? "" : "\n" + space.repeat(level)); }
    if (token === "}" || token === "]") { level--; return (["{", "["].includes(tokens[index - 1]) ? "" : "\n" + space.repeat(level)) + token; }
    if (token === ",") return ",\n" + space.repeat(level);
    return token === ":" ? ": " : token;
  }).join("");
}

export function validateJson(source: string) {
  const value = readJson(source);
  let depth = 0;
  const visit = (node: unknown, level: number) => {
    if (!node || typeof node !== "object" || isLosslessNumber(node)) return;
    depth = Math.max(depth, level);
    if (level > 200) throw new DeveloperError("developerJsonDepth", "JSON exceeds the maximum nesting depth of 200.");
    if (Array.isArray(node)) node.forEach((child) => visit(child, level + 1));
    else if (node && typeof node === "object" && !isLosslessNumber(node)) Object.values(node).forEach((child) => visit(child, level + 1));
  };
  visit(value, 1);
  return { value, depth };
}

function equalJson(left: unknown, right: unknown): boolean {
  if (isLosslessNumber(left) && isLosslessNumber(right)) return compareLosslessNumber(left as LosslessNumber, right as LosslessNumber) === 0;
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => equalJson(value, right[index]));
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && equalJson((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
}

export function compareJson(left: string, right: string) {
  const a = validateJson(left).value;
  let b: unknown;
  try { b = validateJson(right).value; } catch (error) { if (error instanceof DeveloperError) error.side = "other"; throw error; }
  const differences: Array<{ path: string; left: string; right: string }> = [];
  const display = (value: unknown) => value === undefined ? "<missing>" : stringify(value, null, 0) ?? "undefined";
  const visit = (leftValue: unknown, rightValue: unknown, path: string) => {
    if (equalJson(leftValue, rightValue)) return;
    if (Array.isArray(leftValue) && Array.isArray(rightValue)) {
      for (let index = 0; index < Math.max(leftValue.length, rightValue.length); index++) visit(leftValue[index], rightValue[index], `${path}[${index}]`);
      return;
    }
    if (leftValue && rightValue && typeof leftValue === "object" && typeof rightValue === "object" && !Array.isArray(leftValue) && !Array.isArray(rightValue) && !isLosslessNumber(leftValue) && !isLosslessNumber(rightValue)) {
      for (const key of [...new Set([...Object.keys(leftValue), ...Object.keys(rightValue)])].sort()) visit(Object.hasOwn(leftValue, key) ? (leftValue as Record<string, unknown>)[key] : undefined, Object.hasOwn(rightValue, key) ? (rightValue as Record<string, unknown>)[key] : undefined, /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`);
      return;
    }
    differences.push({ path: path || "$", left: display(leftValue), right: display(rightValue) });
    if (differences.length > 2000) throw new DeveloperError("developerDiffLimit", "More than 2,000 differences. Reduce the input.");
  };
  visit(a, b, "$");
  return { equal: differences.length === 0, differences };
}

function encodeBase64Bytes(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + 0x8000, bytes.length)));
  return btoa(binary);
}

export function encodeBase64(value: string, urlSafe = false) {
  const encoded = encodeBase64Bytes(new TextEncoder().encode(value));
  return urlSafe ? encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "") : encoded;
}

export function decodeBase64(value: string, urlSafe = false) {
  const clean = value;
  const alphabet = urlSafe ? /^[A-Za-z0-9_-]*={0,2}$/ : /^[A-Za-z0-9+/]*={0,2}$/;
  if (!alphabet.test(clean) || clean.length % 4 === 1 || (clean.includes("=") && clean.length % 4 !== 0) || (!urlSafe && clean.length % 4 !== 0)) throw new DeveloperError("developerInvalidBase64", "Invalid Base64 characters or padding.");
  const normalized = urlSafe ? clean.replace(/-/g, "+").replace(/_/g, "/") : clean;
  const bytes = Uint8Array.from(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")), (char) => char.charCodeAt(0));
  if (encodeBase64Bytes(bytes).replace(/=+$/, "") !== normalized.replace(/=+$/, "")) throw new DeveloperError("developerInvalidBase64", "Invalid Base64 padding bits.");
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new DeveloperError("developerInvalidUtf8", "Decoded data is not valid UTF-8 text."); }
}

export function transformUrl(value: string, direction: "encode" | "decode", mode: "component" | "url") {
  if (direction === "encode") return mode === "url" ? encodeURI(value) : encodeURIComponent(value);
  try { return mode === "url" ? decodeURI(value) : decodeURIComponent(value); }
  catch { throw new DeveloperError("developerInvalidUrl", "Invalid percent encoding. Check every % escape and try again."); }
}

export function parseTimestamp(value: string, unit: "seconds" | "milliseconds") {
  const text = value.trim();
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(text)) throw new DeveloperError("developerInvalidTimestamp", "Enter a finite decimal Unix timestamp.");
  const [whole, fraction = ""] = text.replace(/^[+-]/, "").split(".");
  const precision = unit === "seconds" ? 3 : 0;
  if (fraction.length > precision) throw new DeveloperError("developerTimestampPrecision", "Timestamp precision exceeds milliseconds.");
  const milliseconds = (BigInt(whole) * BigInt(unit === "seconds" ? 1000 : 1) + BigInt(fraction.padEnd(precision, "0") || "0")) * BigInt(text.startsWith("-") ? -1 : 1);
  if (milliseconds < BigInt("-8640000000000000") || milliseconds > BigInt("8640000000000000")) throw new DeveloperError("developerInvalidTimestamp", "Timestamp is outside the supported date range.");
  const date = new Date(Number(milliseconds));
  return date;
}

export function parseIsoDate(value: string) {
  const text = value.trim();
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) throw new DeveloperError("developerTimezoneRequired", "Add an explicit timezone such as Z or +08:00.");
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:?\d{2})$/i.exec(text);
  if (!match) throw new DeveloperError("developerInvalidDate", "Enter a valid ISO 8601 date with millisecond precision.");
  const [, year, month, day, hour, minute, second, , zone] = match;
  const leap = Number(year) % 4 === 0 && (Number(year) % 100 !== 0 || Number(year) % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const offset = zone.replace(/^[+-]/, "").replace(":", "");
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > days[Number(month) - 1] || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 || (zone.toUpperCase() !== "Z" && (Number(offset.slice(0, 2)) > 23 || Number(offset.slice(2)) > 59))) throw new DeveloperError("developerInvalidDate", "Enter a valid ISO 8601 date.");
  const date = new Date(text);
  if (!Number.isFinite(date.getTime())) throw new DeveloperError("developerInvalidDate", "Enter a valid ISO 8601 date.");
  return date;
}

export function makeDiff(left: string, right: string, ignoreTrailingWhitespace = false) {
  const normalize = (value: string) => value.replace(/\r\n?/g, "\n").split("\n").map((line) => ignoreTrailingWhitespace ? line.trimEnd() : line).join("\n");
  const parts = diffLines(normalize(left), normalize(right));
  if (parts.filter((part) => part.added || part.removed).reduce((count, part) => count + (part.count ?? 0), 0) > 2000) throw new DeveloperError("developerDiffLimit", "More than 2,000 differences. Reduce the input.");
  return parts.map((part) => ({ value: part.value, added: Boolean(part.added), removed: Boolean(part.removed) }));
}

export function utf8Bytes(value: string) {
  return new TextEncoder().encode(value).byteLength;
}
