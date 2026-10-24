import * as THREE from "three";
import { decode } from "fast-png";

export type ScanProjectFrame = {
  index: number;
  time: number;
  metadataName: string;
  cameraPose: number[] | null;
  projection: number[] | null;
  intrinsics: number[] | null;
  captureWidth: number | null;
  captureHeight: number | null;
  captureOrientation: number | null;
  photoName?: string;
  depthName?: string;
  confidenceName?: string;
};

export type ScanProjectIndex = {
  root: string;
  infoName: string;
  title: string;
  frames: ScanProjectFrame[];
  models: string[];
  worldMapName?: string;
  imageCount: number;
  startTime: number | null;
  duration: number;
  worldTransform?: number[];
};

const ARKIT_MATRIX_FIELDS = [
  "m11", "m12", "m13", "m14", "m21", "m22", "m23", "m24",
  "m31", "m32", "m33", "m34", "m41", "m42", "m43", "m44",
] as const;

/** ARKit frame arrays serialize row-major matrices; Three.js consumes column-major elements. */
export function normalizeArkitMatrixArray(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length !== 16) return null;
  const values = value.map(Number);
  if (!values.every(Number.isFinite)) return null;
  return [0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15].map((index) => values[index]);
}

/** ARKit camera intrinsics are a row-major 3x3 matrix, not a 4x4 pose. */
export function normalizeArkitIntrinsics(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length !== 9) return null;
  const values = value.map(Number);
  return values.every(Number.isFinite) ? values : null;
}

export function normalizeCaptureDimensions(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return null;
  const value = metadata as Record<string, unknown>;
  const pair = value.captureDimensions ?? value.cameraImageResolution ?? value.imageResolution ?? value.imageSize;
  let width: number | undefined;
  let height: number | undefined;
  if (Array.isArray(pair) && pair.length >= 2) { width = Number(pair[0]); height = Number(pair[1]); }
  else if (pair && typeof pair === "object") {
    const dimensions = pair as Record<string, unknown>;
    width = Number(dimensions.width ?? dimensions.x); height = Number(dimensions.height ?? dimensions.y);
  }
  width ??= Number(value.captureWidth ?? value.cameraImageWidth ?? value.imageWidth);
  height ??= Number(value.captureHeight ?? value.cameraImageHeight ?? value.imageHeight);
  return Number.isFinite(width) && Number.isFinite(height) && width! > 0 && height! > 0 ? { width: width!, height: height! } : null;
}

/** ARKit info.json matrix fields are already grouped in Three.js column-major element order. */
export function normalizeArkitWorldTransform(value: unknown): number[] | null {
  if (!value || typeof value !== "object") return null;
  const fields = value as Record<string, unknown>;
  const values = ARKIT_MATRIX_FIELDS.map((key) => Number(fields[key]));
  return values.every(Number.isFinite) ? values : null;
}

const FRAME_FILE = /^(frame|depth|conf)_(\d+)\.(json|jpg|png)$/i;
const MODEL_FILE = /\.(obj|usdz|glb|gltf|fbx|ifc)$/i;

export function buildScanProjectIndex(names: string[], title = "3D Scan"): ScanProjectIndex | null {
  const cleanNames = names.filter((name) => name && !name.endsWith("/") && !name.split("/").some((part) => part.startsWith("__MACOSX")));
  const infoName = cleanNames.filter((name) => /(?:^|\/)info\.json$/i.test(name)).sort((a, b) => a.length - b.length)[0];
  if (!infoName) return null;

  const root = infoName.slice(0, infoName.lastIndexOf("/") + 1);
  const relativeNames = cleanNames.filter((name) => name.startsWith(root)).map((name) => name.slice(root.length));
  const byKindAndIndex = new Map<string, string>();
  const frameIndices = new Set<number>();
  for (const name of relativeNames) {
    const match = FRAME_FILE.exec(name);
    if (!match || name.includes("/")) continue;
    const [, kind, rawIndex, extension] = match;
    const index = Number(rawIndex);
    const key = `${kind.toLowerCase()}_${index}.${extension.toLowerCase()}`;
    byKindAndIndex.set(key, `${root}${kind.toLowerCase()}_${rawIndex}.${extension.toLowerCase()}`);
    if (kind.toLowerCase() === "frame" && extension.toLowerCase() === "json") frameIndices.add(index);
  }

  const frames: ScanProjectFrame[] = [...frameIndices].sort((a, b) => a - b).map((index) => {
    return {
      index,
      time: index,
      metadataName: byKindAndIndex.get(`frame_${index}.json`)!,
      cameraPose: null,
      projection: null,
      intrinsics: null,
      captureWidth: null,
      captureHeight: null,
      captureOrientation: null,
      photoName: byKindAndIndex.get(`frame_${index}.jpg`),
      depthName: byKindAndIndex.get(`depth_${index}.png`),
      confidenceName: byKindAndIndex.get(`conf_${index}.png`),
    };
  });

  const models = relativeNames.filter((name) => !name.includes("/") && MODEL_FILE.test(name)).map((name) => `${root}${name}`);
  const infoEntry = relativeNames.find((name) => name.toLowerCase() === "info.json");
  const worldMapName = relativeNames.find((name) => name.toLowerCase() === "world_map.arkit");
  return {
    root,
    infoName,
    title,
    frames,
    models,
    worldMapName: worldMapName ? `${root}${worldMapName}` : undefined,
    imageCount: frames.filter((frame) => frame.photoName).length,
    startTime: null,
    duration: 0,
    ...(infoEntry ? { infoName: `${root}${infoEntry}` } : {}),
  };
}

export function preferredScanModel(index: ScanProjectIndex) {
  return index.models.find((name) => /(?:^|\/)textured_output\.obj$/i.test(name))
    ?? index.models.find((name) => /\.obj$/i.test(name))
    ?? index.models.find((name) => /\.usdz$/i.test(name))
    ?? index.models[0];
}

export function resolveScanAssetPath(reference: string, modelName: string, knownNames: Iterable<string>) {
  if (!reference || /^(?:data|blob|https?):/i.test(reference)) return undefined;
  const names = new Set(knownNames);
  let decoded = reference;
  try { decoded = decodeURIComponent(reference); } catch { /* Preserve malformed percent sequences for exact lookup. */ }
  const normalized = decoded.replace(/\\/g, "/").split("/").reduce<string[]>((parts, piece) => {
    if (piece === "..") parts.pop();
    else if (piece && piece !== ".") parts.push(piece);
    return parts;
  }, []).join("/");
  const directory = modelName.slice(0, modelName.lastIndexOf("/") + 1);
  const basePath = `${directory}${normalized}`;
  if (names.has(basePath)) return basePath;
  if (names.has(normalized)) return normalized;
  const suffixMatches = [...names].filter((name) => name.endsWith(`/${normalized}`));
  return suffixMatches.length === 1 ? suffixMatches[0] : undefined;
}

export function finalizeScanProject(index: ScanProjectIndex, records: Array<{ index: number; time?: number; cameraPose?: number[]; projection?: number[]; intrinsics?: number[]; captureWidth?: number; captureHeight?: number; captureOrientation?: number }>): ScanProjectIndex {
  const byIndex = new Map(records.map((record) => [record.index, record]));
  const frames = index.frames.map((frame) => {
    const record = byIndex.get(frame.index);
    return {
      ...frame,
      time: Number.isFinite(record?.time) ? record!.time! : frame.index,
      cameraPose: record?.cameraPose?.length === 16 ? record.cameraPose : null,
      projection: record?.projection?.length === 16 ? record.projection : null,
      intrinsics: record?.intrinsics?.length === 9 ? record.intrinsics : null,
      captureWidth: Number.isFinite(record?.captureWidth) && record!.captureWidth! > 0 ? record!.captureWidth! : null,
      captureHeight: Number.isFinite(record?.captureHeight) && record!.captureHeight! > 0 ? record!.captureHeight! : null,
      captureOrientation: Number.isInteger(record?.captureOrientation) && record!.captureOrientation! >= 1 && record!.captureOrientation! <= 8 ? record!.captureOrientation! : null,
    };
  }).sort((a, b) => a.time - b.time || a.index - b.index);
  return {
    ...index,
    title: index.title,
    frames,
    startTime: frames.length ? frames[0].time : null,
    duration: frames.length > 1 ? Math.max(0, frames.at(-1)!.time - frames[0].time) : 0,
  };
}
export function createScanPoseMatrix(frame: ScanProjectFrame, worldTransform: number[], modelMatrixWorld: THREE.Matrix4) {
  if (!frame.cameraPose || frame.cameraPose.length !== 16 || worldTransform.length !== 16) return null;
  const cameraToWorld = new THREE.Matrix4().fromArray(frame.cameraPose);
  const scanToWorld = new THREE.Matrix4().fromArray(worldTransform);
  return modelMatrixWorld.clone().multiply(scanToWorld.invert()).multiply(cameraToWorld);
}

export function decomposeScanPose(matrix: THREE.Matrix4) {
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, rotation, scale);
  return { position, rotation, scale };
}

export function createCenteredStageMatrix(center: THREE.Vector3, scale: number) {
  const position = center.clone().multiplyScalar(-scale);
  return new THREE.Matrix4().compose(position, new THREE.Quaternion(), new THREE.Vector3(scale, scale, scale));
}

export type QuarterTurn = 0 | 90 | 180 | 270;

export function jpegExifOrientation(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
  let offset = 2;
  while (offset + 4 < bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const length = view.getUint16(offset + 2, false);
    const payload = offset + 4;
    if (marker === 0xe1 && length >= 10 && bytes[payload] === 0x45 && bytes[payload + 1] === 0x78 && bytes[payload + 2] === 0x69 && bytes[payload + 3] === 0x66) {
      const tiff = payload + 6;
      const littleEndian = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
      if (!littleEndian && !(bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d)) return 1;
      const read16 = (at: number) => view.getUint16(at, littleEndian);
      const read32 = (at: number) => view.getUint32(at, littleEndian);
      const directory = tiff + read32(tiff + 4);
      if (directory + 2 > bytes.length) return 1;
      const count = read16(directory);
      for (let index = 0; index < count; index++) {
        const entry = directory + 2 + index * 12;
        if (entry + 12 > bytes.length) return 1;
        if (read16(entry) === 0x0112 && read16(entry + 2) === 3 && read32(entry + 4) >= 1) {
          const orientation = read16(entry + 8);
          return orientation >= 1 && orientation <= 8 ? orientation : 1;
        }
      }
      return 1;
    }
    offset += length + 2;
  }
  return 1;
}

export function jpegDimensions(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 < bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const length = view.getUint16(offset + 2, false);
    const payload = offset + 4;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && payload + 5 <= bytes.length) {
      const height = view.getUint16(payload + 1, false);
      const width = view.getUint16(payload + 3, false);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (length < 2) break;
    offset += length + 2;
  }
  return null;
}

export function exifOrientationRotation(orientation: number): QuarterTurn {
  if (orientation === 3 || orientation === 4) return 180;
  if (orientation === 6 || orientation === 7) return 90;
  if (orientation === 8 || orientation === 5) return 270;
  return 0;
}

export function rotateRgbaImage(width: number, height: number, pixels: Uint8ClampedArray, rotation: QuarterTurn) {
  if (rotation === 0) return { width, height, pixels };
  const rotatedWidth = rotation === 180 ? width : height;
  const rotatedHeight = rotation === 180 ? height : width;
  const rotated = new Uint8ClampedArray(rotatedWidth * rotatedHeight * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const target = rotation === 90
        ? { x: height - y - 1, y: x }
        : rotation === 180
          ? { x: width - x - 1, y: height - y - 1 }
          : { x: y, y: width - x - 1 };
      const sourceOffset = (y * width + x) * 4;
      const targetOffset = (target.y * rotatedWidth + target.x) * 4;
      rotated.set(pixels.subarray(sourceOffset, sourceOffset + 4), targetOffset);
    }
  }
  return { width: rotatedWidth, height: rotatedHeight, pixels: rotated };
}

export function displayPixelToSource(x: number, y: number, width: number, height: number, rotation: QuarterTurn) {
  if (rotation === 90) return { x: y, y: height - x - 1 };
  if (rotation === 180) return { x: width - x - 1, y: height - y - 1 };
  if (rotation === 270) return { x: width - y - 1, y: x };
  return { x, y };
}

export function createFollowProjection(projection: number[], rotation: QuarterTurn) {
  const matrix = new THREE.Matrix4().fromArray(projection);
  // ARKit depth spans [0, 1], while WebGL clips in [-1, 1].
  const elements = matrix.elements;
  for (let column = 0; column < 4; column++) {
    elements[column * 4 + 2] = 2 * elements[column * 4 + 2] - elements[column * 4 + 3];
  }
  if (rotation === 0) return matrix;
  const screenRotation = new THREE.Matrix4().makeRotationZ(-THREE.MathUtils.degToRad(rotation));
  return screenRotation.multiply(matrix);
}

export function decodeScanDepth(bytes: Uint8Array) {
  const image = decode(bytes);
  if (image.depth !== 16 || image.channels !== 1 || !(image.data instanceof Uint16Array)) throw new Error("Unsupported depth PNG format.");
  let minimum = Infinity;
  let maximum = 0;
  for (const value of image.data) if (value > 0) { minimum = Math.min(minimum, value); maximum = Math.max(maximum, value); }
  if (!Number.isFinite(minimum)) minimum = 0;
  const rgba = new Uint8ClampedArray(image.data.length * 4);
  const range = Math.max(1, maximum - minimum);
  for (let index = 0; index < image.data.length; index++) {
    const offset = index * 4;
    const value = image.data[index];
    if (value === 0) continue;
    const near = 1 - (value - minimum) / range;
    rgba[offset] = Math.round(48 + near * 207);
    rgba[offset + 1] = Math.round(164 + (1 - Math.abs(near - 0.5) * 2) * 74 - near * 90);
    rgba[offset + 2] = Math.round(235 - near * 187);
    rgba[offset + 3] = 255;
  }
  return { width: image.width, height: image.height, raw: image.data, rgba, minimum, maximum };
}
