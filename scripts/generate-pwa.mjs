import { readFile, writeFile } from "node:fs/promises";
const version = (await readFile(".next/BUILD_ID", "utf8")).trim();
const source = await readFile("scripts/service-worker.js", "utf8");
await writeFile("public/sw.js", source.replaceAll("__BUILD_VERSION__", version));
