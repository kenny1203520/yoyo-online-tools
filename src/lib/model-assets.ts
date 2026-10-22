export function normalizeModelAssetPath(path: string) {
  return decodeURIComponent(new URL(path.replace(/\\/g, "/"), "https://local-model.invalid/").pathname).replace(/^\//, "");
}
export function resolveModelAsset(url: string, files: Map<string, string>) {
  if (url.startsWith("data:") || url.startsWith("blob:")) return url;
  const path = normalizeModelAssetPath(url);
  const exact = files.get(path);
  if (exact) return exact;
  const suffix = [...files.entries()].filter(([name]) => name.endsWith(`/${path}`));
  return suffix.length === 1 ? suffix[0][1] : undefined;
}
