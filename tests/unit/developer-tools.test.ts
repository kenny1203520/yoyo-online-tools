import { test } from "node:test";
import assert from "node:assert/strict";
import { compareJson, decodeBase64, encodeBase64, formatJson, parseIsoDate, parseTimestamp, transformUrl, validateJson } from "../../src/lib/developer-processing";
import { executeDeveloperJob, type DeveloperJob } from "../../src/lib/developer-job";

test("lossless JSON formatting preserves large numeric literals and rejects duplicate keys", () => {
  const formatted = formatJson('{"id":900719925474099312345,"value":1.0}');
  assert.match(formatted, /900719925474099312345/);
  assert.match(formatted, /1\.0/);
  assert.throws(() => formatJson('{"id":1,"id":2}'), /duplicate/i);
  assert.equal(formatJson('{"ok":true}', 2, true), '{"ok":true}');
  assert.equal(formatJson('{ "10":1.00, "2":"\\u4e2d" }', 2, true), '{"10":1.00,"2":"\\u4e2d"}');
});

test("JSON comparison ignores object order but reports array positions and missing values", () => {
  assert.equal(compareJson('{"a":1,"b":[2]}', '{"b":[2.0],"a":1.0}').equal, true);
  const result = compareJson('{"a":[1,2]}', '{"a":[1,3,4]}');
  assert.equal(result.equal, false);
  assert.deepEqual(result.differences.map((item) => item.path), ["$.a[1]", "$.a[2]"]);
  assert.equal(result.differences[1].left, "<missing>");
});

test("Base64 encodes UTF-8 and Base64url round-trips without padding", () => {
  const original = "YOYO 工具 🚀";
  const encoded = encodeBase64(original, true);
  assert.ok(!encoded.includes("+") && !encoded.includes("/") && !encoded.includes("="));
  assert.equal(decodeBase64(encoded, true), original);
  assert.throws(() => decodeBase64("//4="), /UTF-8/);
  assert.throws(() => decodeBase64("bad%%%"), /Base64/);
});

test("URL conversion is one layer and preserves plus in parameter values", () => {
  assert.equal(transformUrl("a+b c", "encode", "component"), "a%2Bb%20c");
  assert.equal(transformUrl("a+b%20c", "decode", "component"), "a+b c");
  assert.throws(() => transformUrl("%Q1", "decode", "component"), /percent encoding/i);
});

test("timestamp conversion requires explicit timezone and supports negative Unix time", () => {
  assert.equal(parseTimestamp("-1", "seconds").toISOString(), "1969-12-31T23:59:59.000Z");
  assert.throws(() => parseTimestamp("nope", "seconds"), /finite/);
  assert.throws(() => parseIsoDate("2026-10-21T12:00:00"), /timezone/i);
  assert.equal(parseIsoDate("2026-10-21T12:00:00+08:00").toISOString(), "2026-10-21T04:00:00.000Z");
});

test("JSON structural comparison distinguishes array/object, null/missing and special keys", () => {
  assert.equal(compareJson('[1]', '{"0":1}').equal, false);
  assert.equal(compareJson('[]', '{}').equal, false);
  assert.equal(compareJson('{"x":null}', '{}').equal, false);
  assert.equal(compareJson('{"__proto__":1}', '{}').equal, false);
  assert.deepEqual(compareJson('{"a.b":1}', '{"a.b":2}').differences.map((item) => item.path), ['$["a.b"]']);
  assert.equal(compareJson('900719925474099312345', '900719925474099312346').equal, false);
  assert.equal(compareJson('1e100', '10e99').equal, true);
  assert.throws(() => compareJson(JSON.stringify(Array(2001).fill(1)), JSON.stringify(Array(2001).fill(2))), /2,000/);
});

test("JSON validates depth before recursive parsing and locates malformed input", () => {
  assert.throws(() => validateJson('['.repeat(201) + '0' + ']'.repeat(201)), /depth/);
  assert.equal(validateJson('['.repeat(200) + '0' + ']'.repeat(200)).depth, 200);
  assert.doesNotThrow(() => validateJson('{"quoted":"[[[["}'));
  assert.throws(() => validateJson('{\n "x": }'), (error: unknown) => error instanceof Error && 'position' in error && typeof error.position === 'number');
});

test("dates reject rollover, bad offsets and silent sub-millisecond truncation", () => {
  for (const value of ['2026-02-30T12:00:00Z', '2025-02-29T12:00:00Z', '2026-04-31T12:00:00Z', '2026-01-01T24:00:00Z', '2026-01-01T12:00:00+08:99', '2026-01-01T12:00:00.0001Z']) assert.throws(() => parseIsoDate(value));
  assert.equal(parseIsoDate('2024-02-29T12:00:00Z').toISOString(), '2024-02-29T12:00:00.000Z');
  assert.equal(parseTimestamp('-0.001', 'seconds').getTime(), -1);
  assert.equal(parseTimestamp('1.001', 'seconds').getTime(), 1001);
  assert.throws(() => parseTimestamp('1.0001', 'seconds'), /precision/);
  assert.throws(() => parseTimestamp('1.1', 'milliseconds'), /precision/);
  for (const input of ['1e3', '0x10', 'Infinity', '8640000000000001']) assert.throws(() => parseTimestamp(input, 'milliseconds'));
});

test("Base64 rejects the other alphabet, whitespace, incorrect padding and padding bits", () => {
  for (const input of ['Zg', 'Zg=', 'Zh==', 'Z g==', '_w==']) assert.throws(() => decodeBase64(input));
  assert.throws(() => decodeBase64('/w==', true));
  assert.equal(decodeBase64('Zg=='), 'f');
  assert.equal(decodeBase64('Zg', true), 'f');
});

const job: DeveloperJob = {
  requestId: 42, version: 8, mode: 'json', source: '{}', other: '', indent: '2', minify: false, diffMode: 'text', ignoreTrailingWhitespace: false,
  base64Mode: 'standard', urlMode: 'component', direction: 'encode', timestampUnit: 'seconds', timestampDirection: 'toDate', iso: '', pattern: '', flags: 'g', replacement: '', locale: 'en',
  labels: { same: 'same', different: 'different', left: 'left', right: 'right', utc: 'UTC', taipei: 'Taipei', local: 'local' },
};
test("worker contract preserves identity and enforces each-side and output resource limits", () => {
  assert.deepEqual(executeDeveloperJob(job), { requestId: 42, version: 8, status: 'success', output: '{}', groups: [] });
  const tooLarge = executeDeveloperJob({ ...job, mode: 'diff', other: 'x'.repeat(1024 * 1024 + 1) });
  assert.equal(tooLarge.status === 'error' && tooLarge.code, 'developerInputTooLarge');
  const tooManyLines = executeDeveloperJob({ ...job, mode: 'diff', other: '\n'.repeat(10000) });
  assert.equal(tooManyLines.status === 'error' && tooManyLines.code, 'developerLineLimit');
  const expansion = executeDeveloperJob({ ...job, mode: 'url', source: ' '.repeat(1024 * 1024) });
  assert.equal(expansion.status, 'success');
  const regexExpansion = executeDeveloperJob({ ...job, mode: 'regex', source: 'x'.repeat(100), pattern: 'x', replacement: 'a'.repeat(50000) });
  assert.equal(regexExpansion.status === 'error' && regexExpansion.code, 'developerOutputTooLarge');
  const rightError = executeDeveloperJob({ ...job, mode: 'diff', diffMode: 'json', other: '{bad}' });
  assert.equal(rightError.status === 'error' && rightError.side, 'other');
});

test("Regex handles zero-length Unicode matches, named groups and bounded replacement", () => {
  const matched = executeDeveloperJob({ ...job, mode: 'regex', source: '😀a', pattern: '(?=.)', flags: 'gu', replacement: '-' });
  assert.equal(matched.status === 'success' && matched.output, '-😀-a');
  const named = executeDeveloperJob({ ...job, mode: 'regex', source: 'hello', pattern: '(?<word>\\w+)', replacement: '[$<word>]' });
  assert.equal(named.status === 'success' && named.groups[0].named.word, 'hello');
  assert.equal(named.status === 'success' && named.output, '[hello]');
  const limit = executeDeveloperJob({ ...job, mode: 'regex', source: 'x'.repeat(1001), pattern: 'x' });
  assert.equal(limit.status === 'error' && limit.code, 'developerRegexLimit');
});
