import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeModelAssetPath, resolveModelAsset } from "../../src/lib/model-assets";
test("ZIP asset paths resolve parent segments, percent escapes and Windows separators locally", () => {
  const files = new Map([["resources/貼圖.png", "blob:local-texture"], ["resources/mesh.bin", "blob:local-mesh"]]);
  assert.equal(normalizeModelAssetPath('model\\..\\resources\\mesh.bin'), 'resources/mesh.bin');
  assert.equal(resolveModelAsset('model/../resources/%E8%B2%BC%E5%9C%96.png', files), 'blob:local-texture');
  assert.equal(resolveModelAsset('https://example.invalid/not-provided.png', files), undefined);
  assert.equal(resolveModelAsset('data:image/svg+xml,%', files), 'data:image/svg+xml,%');
});
test("ambiguous asset suffixes do not silently select the last matching file", () => {
  const files = new Map([["a/texture.png", "blob:a"], ["b/texture.png", "blob:b"]]);
  assert.equal(resolveModelAsset('texture.png', files), undefined);
  assert.equal(resolveModelAsset('a/texture.png', files), 'blob:a');
});
