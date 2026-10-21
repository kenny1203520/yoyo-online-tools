export const MAX_TEXT_BYTES = 1024 * 1024;

export type TextCleanupOptions = {
  cleanWhitespace: boolean;
  removeLeadingWhitespace: boolean;
  joinSingleLineBreaks: boolean;
  removeDuplicateLines: boolean;
  ignoreTrimmedWhitespace: boolean;
  ignoreCase: boolean;
};

export const DEFAULT_TEXT_OPTIONS: TextCleanupOptions = {
  cleanWhitespace: true,
  removeLeadingWhitespace: false,
  joinSingleLineBreaks: false,
  removeDuplicateLines: false,
  ignoreTrimmedWhitespace: false,
  ignoreCase: false,
};

export type TextStats = {
  characters: number;
  charactersWithoutWhitespace: number;
  chineseCharacters: number;
  englishWords: number;
  lines: number;
  utf8Bytes: number;
  preciseCharacterCount: boolean;
};

export type TextTransformResult = {
  value: string;
  removedDuplicateLines: number;
};

function lineEndingsToLf(value: string) {
  return value.replace(/\r\n?/g, "\n");
}

export function transformText(input: string, options: TextCleanupOptions): TextTransformResult {
  let value = lineEndingsToLf(input);

  if (options.cleanWhitespace) {
    value = value.split("\n").map((line) => {
      const withoutTrailingWhitespace = line.replace(/[\t ]+$/g, "");
      return options.removeLeadingWhitespace ? withoutTrailingWhitespace.replace(/^[\t ]+/g, "") : withoutTrailingWhitespace;
    }).join("\n");

    value = value.replace(/\n{3,}/g, "\n\n").replace(/^\n+|\n+$/g, "");

    if (options.joinSingleLineBreaks) {
      value = value.replace(/([^\n])\n(?=[^\n])/g, "$1 ");
    }
  }

  let removedDuplicateLines = 0;
  if (options.removeDuplicateLines) {
    const seen = new Set<string>();
    value = value.split("\n").filter((line) => {
      if (line.trim() === "") return true;
      let key = options.ignoreTrimmedWhitespace ? line.trim() : line;
      if (options.ignoreCase) key = key.toLocaleLowerCase("zh-TW");
      if (seen.has(key)) {
        removedDuplicateLines += 1;
        return false;
      }
      seen.add(key);
      return true;
    }).join("\n");
  }

  return { value, removedDuplicateLines };
}

export function getTextStats(value: string): TextStats {
  type SegmenterLike = {
    segment: (input: string) => Iterable<{ segment: string }>;
  };
  const segmenterConstructor = (Intl as unknown as { Segmenter?: new (locale: string, options: { granularity: "grapheme" }) => SegmenterLike }).Segmenter;
  const segments = segmenterConstructor ? Array.from(new segmenterConstructor("zh-TW", { granularity: "grapheme" }).segment(value), (part) => part.segment) : Array.from(value);

  return {
    characters: segments.length,
    charactersWithoutWhitespace: segments.filter((part) => !/^\s+$/u.test(part)).length,
    chineseCharacters: value.match(/\p{Script=Han}/gu)?.length ?? 0,
    englishWords: value.match(/[\p{Script=Latin}]+(?:['’\u2010-\u2015-][\p{Script=Latin}]+)*/gu)?.length ?? 0,
    lines: value === "" ? 0 : lineEndingsToLf(value).split("\n").length,
    utf8Bytes: new TextEncoder().encode(value).byteLength,
    preciseCharacterCount: Boolean(segmenterConstructor),
  };
}

export function decodeUtf8TextFile(bytes: ArrayBuffer) {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function safeTextFileStem(value: string) {
  return value.replace(/\.[^.]*$/, "").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").trim() || "yoyo-text";
}
