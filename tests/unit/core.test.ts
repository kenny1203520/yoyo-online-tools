import { test } from "node:test";
import assert from "node:assert/strict";
import { createTranslator } from "next-intl";
import { messages } from "../../src/lib/messages";
import { searchTools, tools } from "../../src/lib/tools";
import { getSiteConfig } from "../../src/lib/site-config";
import { sitemapEntries, pageMetadata, structuredData } from "../../src/lib/seo";
import { ProcessingError, processingIssue } from "../../src/lib/processing-error";
import { localeDefinitions, searchLocales } from "../../src/lib/i18n";

test("language search covers native names, aliases, English names and normalized codes", () => {
  for (const query of ["中文", "繁中", "正體中文", "Traditional Chinese", "ｔＲＡＤＩＴＩＯＮＡＬ　ＣＨＩＮＥＳＥ", "zh_TW", " zh-tw "]) {
    assert.deepEqual(searchLocales(query).map(({ code }) => code), ["zh-TW"], query);
  }
  for (const query of ["English", "英文", "英語", "ｅＮ"]) {
    assert.deepEqual(searchLocales(query).map(({ code }) => code), ["en"], query);
  }
  assert.deepEqual(searchLocales("   "), [...localeDefinitions]);
  assert.deepEqual(searchLocales("not-a-language"), []);
  assert.deepEqual(searchLocales("繁中 English"), []);
});

test("both dictionaries have identical keys and ICU parameters", () => {
  assert.deepEqual(Object.keys(messages.en).sort(), Object.keys(messages["zh-TW"]).sort());
  const parameters = (s: string) => [...s.matchAll(/\{(\w+)(?:[,}])/g)].map((m) => m[1]).sort();
  for (const key of Object.keys(messages.en) as (keyof typeof messages.en)[]) {
    assert.deepEqual(parameters(messages.en[key]), parameters(messages["zh-TW"][key]), key);
    for (const locale of ["zh-TW", "en"] as const) {
      const t = createTranslator({ locale, messages: messages[locale], onError: (error) => { throw error; } });
      const values = Object.fromEntries(parameters(messages[locale][key]).map((param) => [param, 2]));
      assert.ok(t(key, values).length > 0, key);
    }
  }
});
test("cross-language search, normalization, ranking and categories", () => {
  for (const query of ["compress image", "照片太大", "ＣＯＭＰＲＥＳＳ　ＩＭＡＧＥ", "compress 圖片"]) {
    assert.equal(searchTools(query)[0]?.slug, "image-compress", query);
  }
  assert.equal(searchTools("Word and Character Counter")[0]?.slug, "word-count");
  assert.equal(searchTools("照片太大", "text").length, 0);
  assert.equal(searchTools("nothing-matches-123").length, 0);
  assert.equal(searchTools("").length, 6);
  assert.deepEqual(searchTools("image"), searchTools("image"));
});
test("deployment origin validation and index defaults", () => {
  for (const url of ["", "file:///tmp/test", "https://example.com/base", "https://user:secret@example.com", "https://example.com/?q=x"]) {
    assert.throws(() => getSiteConfig({ NODE_ENV: "production", SITE_URL: url }));
  }
  assert.equal(getSiteConfig({ NODE_ENV: "production", SITE_URL: "https://example.com/" }).indexable, false);
  assert.equal(sitemapEntries(getSiteConfig({ SITE_URL: "https://example.com", SITE_INDEXABLE: "false" })).length, 0);
});
test("same build uses runtime domains for all localized SEO", () => {
  const original = { SITE_URL: process.env.SITE_URL, SITE_INDEXABLE: process.env.SITE_INDEXABLE };
  try {
    for (const domain of ["https://one.example.test", "https://two.example.test"]) {
      process.env.SITE_URL = domain; process.env.SITE_INDEXABLE = "true";
      const entries = sitemapEntries();
      assert.equal(entries.length, 14);
      assert.equal(new Set(entries.map((entry) => entry.url)).size, 14);
      assert.ok(entries.every((entry) => entry.url.startsWith(domain)));
      for (const locale of ["zh-TW", "en"] as const) {
        const metadata = pageMetadata(locale, tools[0]);
        assert.equal(metadata.alternates?.canonical, `${domain}/${locale}/tools/image-compress`);
        assert.ok(JSON.stringify(metadata).includes(domain));
        assert.ok(JSON.stringify(structuredData(locale, tools[0])).includes(`${domain}/${locale}`));
      }
    }
  } finally {
    for (const [key,value] of Object.entries(original)) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
});
test("processing errors retain codes and interpolate in either language", () => {
  const issue = processingIssue(new ProcessingError("unsupportedOutput", { format: "WebP" }));
  for (const locale of ["zh-TW", "en"] as const) {
    const t = createTranslator({ locale, messages: messages[locale] });
    assert.ok(t(issue.key, issue.values).includes("WebP"));
  }
  assert.equal(processingIssue(new Error("decoder internals")).key, "processingFailed");
});
