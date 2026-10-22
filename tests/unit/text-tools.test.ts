import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TEXT_OPTIONS, decodeUtf8TextFile, getTextStats, transformText } from "../../src/lib/text-processing";
test("light cleanup preserves indentation and paragraph boundaries without cumulative changes", () => {
  const input = '\n\n  縮排  \r\n下一行\t\r\n\r\n\r\n end \n\n';
  assert.equal(transformText(input, DEFAULT_TEXT_OPTIONS).value, '  縮排\n下一行\n\n end');
  assert.equal(transformText(input, { ...DEFAULT_TEXT_OPTIONS, joinSingleLineBreaks: true }).value, '  縮排 下一行\n\n end');
  assert.equal(transformText(input, { ...DEFAULT_TEXT_OPTIONS, cleanWhitespace: false }).value, input.replace(/\r\n/g, '\n'));
});
test("deduplication preserves first spelling, order and blank lines", () => {
  const result = transformText('  Hello\nhello  \n\n\nWORLD\nworld', { ...DEFAULT_TEXT_OPTIONS, cleanWhitespace: false, removeDuplicateLines: true, ignoreTrimmedWhitespace: true, ignoreCase: true });
  assert.equal(result.value, '  Hello\n\n\nWORLD');
  assert.equal(result.removedDuplicateLines, 2);
});
test("statistics count graphemes, Han, Latin words and trailing lines", () => {
  assert.equal(getTextStats('👨‍👩‍👧‍👦e\u0301中文').characters, 4);
  assert.equal(getTextStats('中文').chineseCharacters, 2);
  assert.equal(getTextStats("hello-world don't 中文").englishWords, 2);
  assert.equal(getTextStats('').lines, 0);
  assert.equal(getTextStats('a\r\n').lines, 2);
  assert.equal(getTextStats('中文').utf8Bytes, 6);
});
test("UTF-8 import accepts BOM and rejects corruption", () => {
  assert.equal(decodeUtf8TextFile(Uint8Array.from([239,187,191,65]).buffer), 'A');
  assert.throws(() => decodeUtf8TextFile(Uint8Array.from([255]).buffer));
});
