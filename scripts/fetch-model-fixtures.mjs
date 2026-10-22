import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const gltf = "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/15cd02d304e54cb42a4db4eefe719f76190f4b68/Models/BoxTextured";
const ifc = "https://raw.githubusercontent.com/ThatOpen/engine_web-ifc/6b8bf3fbbe1be8d0e1246a2f5f7eca99bd590117";
const assets = [
  ["box.glb", `${gltf}/glTF-Binary/BoxTextured.glb`],
  ["BoxTextured.gltf", `${gltf}/glTF/BoxTextured.gltf`],
  ["BoxTextured0.bin", `${gltf}/glTF/BoxTextured0.bin`],
  ["CesiumLogoFlat.png", `${gltf}/glTF/CesiumLogoFlat.png`],
  ["monkey.fbx", "https://raw.githubusercontent.com/mrdoob/three.js/6b608fca539c49cfa8348a48e250e7ae01c03aea/examples/models/fbx/monkey_embedded_texture.fbx"],
  ["example.ifc", `${ifc}/examples/example.ifc`],
  ["large.ifc", `${ifc}/tests/ifcfiles/public/schependomlaan.ifc`],
];
await mkdir("tests/fixtures/models", { recursive: true });
const manifest = [];
for (const [name, url] of assets) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(`tests/fixtures/models/${name}`, bytes);
  manifest.push({ name, url, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  console.log(`${name}: ${bytes.length} bytes`);
}
await writeFile("tests/fixtures/models/sources.json", JSON.stringify(manifest, null, 2) + "\n");
