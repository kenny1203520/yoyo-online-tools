import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destination = resolve(root, "public/wasm/web-ifc.wasm");
await mkdir(dirname(destination), { recursive: true });
await copyFile(resolve(root, "node_modules/web-ifc/web-ifc.wasm"), destination);
console.log("Copied web-ifc WebAssembly runtime to public/wasm.");
