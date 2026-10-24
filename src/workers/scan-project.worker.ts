import { BlobReader, Uint8ArrayWriter, ZipReader, type FileEntry } from "@zip.js/zip.js";
import { decode } from "fast-png";
import { buildScanProjectIndex, decodeScanDepth, finalizeScanProject, jpegDimensions, jpegExifOrientation, normalizeArkitIntrinsics, normalizeArkitMatrixArray, normalizeArkitWorldTransform, normalizeCaptureDimensions, type ScanProjectFrame, type ScanProjectIndex } from "../lib/scan-project";

type Request = { id: number; type: "open"; file: Blob } | { id: number; type: "read"; names: string[] } | { id: number; type: "preview"; frame: ScanProjectFrame };
type OpenResult = { project: ScanProjectIndex | null; models: string[]; entryNames: string[]; imageCount: number; otherCount: number };
const scope = self as unknown as { onmessage: ((event: MessageEvent<Request>) => void) | null; postMessage: (reply: unknown, transfer?: Transferable[]) => void };
let archive: ZipReader<Blob> | null = null;
let entries = new Map<string, FileEntry>();
let knownNames = new Set<string>();
let scanTitle = "3D Scan";

function send(id: number, type: string, value?: unknown, transfer?: Transferable[]) {
  scope.postMessage({ id, type, value }, transfer);
}

async function readEntry(name: string) {
  const entry = entries.get(name);
  if (!entry || !knownNames.has(name)) throw new Error(`Missing archive entry: ${name}`);
  return entry.getData(new Uint8ArrayWriter(), { useWebWorkers: false });
}

async function openArchive(id: number, file: Blob): Promise<void> {
  await archive?.close();
  scanTitle = "3D Scan";
  archive = new ZipReader(new BlobReader(file));
  const allEntries = await archive.getEntries();
  entries = new Map(allEntries.filter((entry): entry is FileEntry => !entry.directory && !entry.filename.split("/").some((part) => part.startsWith("__MACOSX"))).map((entry) => [entry.filename, entry]));
  knownNames = new Set(entries.keys());
  send(id, "progress", { phase: "index", progress: 20, message: "Indexing archive" });
  let project = buildScanProjectIndex([...knownNames]);
  if (project) {
    try {
      const info = JSON.parse(new TextDecoder().decode(await readEntry(project.infoName))) as { title?: unknown; transformToWorldMap?: Record<string, unknown> };
      if (typeof info.title === "string" && info.title.trim()) scanTitle = info.title.trim();
      project = buildScanProjectIndex([...knownNames], scanTitle);
      if (project) {
        project.worldTransform = normalizeArkitWorldTransform(info.transformToWorldMap) ?? undefined;
        const records: Array<{ index: number; time?: number; cameraPose?: number[]; projection?: number[]; intrinsics?: number[]; captureWidth?: number; captureHeight?: number; captureOrientation?: number }> = [];
        const frames = project.frames;
        for (let offset = 0; offset < frames.length; offset += 24) {
          const batch = frames.slice(offset, offset + 24);
          const values = await Promise.all(batch.map(async (frame) => {
            try {
              const metadata = JSON.parse(new TextDecoder().decode(await readEntry(frame.metadataName))) as Record<string, unknown>;
              const dimensions = normalizeCaptureDimensions(metadata);
              return {
                index: frame.index,
                time: Number(metadata.time),
                cameraPose: normalizeArkitMatrixArray(metadata.cameraPoseARFrame) ?? undefined,
                projection: normalizeArkitMatrixArray(metadata.projectionMatrix) ?? undefined,
                intrinsics: normalizeArkitIntrinsics(metadata.intrinsics) ?? undefined,
                captureWidth: dimensions?.width,
                captureHeight: dimensions?.height,
                captureOrientation: Number(metadata.captureOrientation ?? metadata.imageOrientation ?? metadata.orientation),
              };
            } catch {
              return { index: frame.index };
            }
          }));
          records.push(...values);
          send(id, "progress", { phase: "frames", progress: 20 + Math.round(((offset + batch.length) / frames.length) * 70), message: `Reading frame data ${Math.min(offset + batch.length, frames.length)} / ${frames.length}` });
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        project = finalizeScanProject(project, records);
      }
    } catch (error) {
      await archive?.close(); archive = null; entries.clear(); knownNames.clear(); throw error;
    }
  }
  const models = project?.models ?? [...knownNames].filter((name) => /\.(glb|gltf|fbx|ifc|obj|usdz)$/i.test(name));
  const result: OpenResult = {
    project,
    models,
    entryNames: [...knownNames],
    imageCount: project?.imageCount ?? [...knownNames].filter((name) => /\.(png|jpe?g|webp)$/i.test(name)).length,
    otherCount: knownNames.size,
  };
  send(id, "result", result);
}

async function loadPreview(id: number, frame: ScanProjectFrame) {
  if (!frame.depthName && !frame.photoName && !frame.confidenceName) throw new Error("This frame contains no preview images.");
  const photoPromise = frame.photoName ? readEntry(frame.photoName).then((bytes) => ({ name: frame.photoName!, bytes, orientation: jpegExifOrientation(bytes), ...jpegDimensions(bytes) })) : Promise.resolve(undefined);
  const depthPromise = frame.depthName ? readEntry(frame.depthName).then((bytes) => {
    return decodeScanDepth(bytes);
  }).catch((error: unknown) => ({ error: error instanceof Error ? error.message : "Could not decode depth data." })) : Promise.resolve(undefined);
  const confidencePromise = frame.confidenceName ? readEntry(frame.confidenceName).then((bytes) => {
    const image = decode(bytes);
    if (image.depth !== 8 || image.channels !== 1 || !(image.data instanceof Uint8Array)) throw new Error("Unsupported confidence PNG format.");
    const rgba = new Uint8ClampedArray(image.width * image.height * 4);
    for (let index = 0; index < image.width * image.height; index++) {
      const confidence = Number(image.data[index] ?? 0);
      const offset = index * 4;
      rgba[offset] = confidence >= 2 ? 36 : confidence === 1 ? 228 : 65;
      rgba[offset + 1] = confidence >= 2 ? 166 : confidence === 1 ? 181 : 65;
      rgba[offset + 2] = confidence >= 2 ? 93 : confidence === 1 ? 63 : 65;
      rgba[offset + 3] = 255;
    }
    return { width: image.width, height: image.height, values: image.data, rgba };
  }).catch((error: unknown) => ({ error: error instanceof Error ? error.message : "Could not decode confidence data." })) : Promise.resolve(undefined);
  const [photo, depth, confidence] = await Promise.all([photoPromise, depthPromise, confidencePromise]);
  const value = { photo, depth, confidence };
  const transfer = [
    photo?.bytes.buffer,
    depth && !("error" in depth) ? depth.raw.buffer : undefined,
    depth && !("error" in depth) ? depth.rgba.buffer : undefined,
    confidence && !("error" in confidence) ? confidence.values.buffer : undefined,
    confidence && !("error" in confidence) ? confidence.rgba.buffer : undefined,
  ].filter((item): item is ArrayBuffer => item instanceof ArrayBuffer);
  send(id, "preview", value, transfer);
}

scope.onmessage = async (event) => {
  const request = event.data;
  try {
    if (request.type === "open") await openArchive(request.id, request.file);
    else if (!archive) throw new Error("No scan archive is open.");
    else if (request.type === "read") {
      const files = await Promise.all(request.names.map(async (name) => ({ name, bytes: await readEntry(name) })));
      send(request.id, "files", files, files.map((file) => file.bytes.buffer));
    } else await loadPreview(request.id, request.frame);
  } catch (error) {
    send(request.id, "error", error instanceof Error ? error.message : "The archive could not be read.");
  }
};
