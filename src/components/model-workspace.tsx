"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Box, Camera, ChevronLeft, ChevronRight, Eye, EyeOff, FileUp, Focus, Footprints, Gauge, Layers3, Maximize, Minimize, Pause, PersonStanding, Play, RotateCcw, RotateCw, Ruler, ShieldCheck, SlidersHorizontal, X } from "lucide-react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { USDLoader } from "three/addons/loaders/USDLoader.js";
import type { IfcReply } from "@/lib/ifc-transfer";
import { normalizeModelAssetPath, resolveModelAsset } from "@/lib/model-assets";
import { createCenteredStageMatrix, createFollowProjection, createScanPoseMatrix, decomposeScanPose, displayPixelToSource, exifOrientationRotation, preferredScanModel, resolveScanAssetPath, rotateRgbaImage, type QuarterTurn, type ScanProjectFrame, type ScanProjectIndex } from "@/lib/scan-project";
import { ScanProjectReader, type ScanOpenResult, type ScanPreview } from "@/lib/scan-project-reader";
import { useI18n } from "@/lib/use-i18n";

type ViewMode = "orbit" | "first" | "third";
type MovementMode = "walk" | "fly";
type MeasureMode = "measure" | "calibrate" | null;
type ImmersiveMode = "native" | "fallback" | null;
type IfcComponent = { id: number; name: string; type: string; floor: string; props: Record<string, string>; object: THREE.Group };
type LoadedAsset = { name: string; buffer: ArrayBuffer; files: Array<{ name: string; file: File }>; kind: string };
type ModelCandidate = { name: string; kind: string };
type ParsedIfc = { group: THREE.Group; components: IfcComponent[]; floors: string[]; cleanup: () => void };
const UNIT_METERS: Record<string, number> = { m: 1, cm: 0.01, mm: 0.001, ft: 0.3048, in: 0.0254 };

async function unpackFiles(files: File[]): Promise<LoadedAsset[]> {
  const expanded: Array<{ name: string; file: File }> = [];
  for (const file of files) {
    if (file.name.toLowerCase().endsWith(".zip")) throw new Error("ZIP files must be opened through the scan reader.");
    expanded.push({ name: file.name, file });
  }
  const candidates = expanded.filter(({ name }) => /\.(glb|gltf|fbx|ifc|obj|usdz)$/i.test(name));
  return Promise.all(candidates.map(async (candidate) => ({
    name: candidate.name,
    buffer: await candidate.file.arrayBuffer(),
    files: expanded,
    kind: candidate.name.split(".").pop()?.toLowerCase() ?? "",
  })));
}

async function referencedAssetNames(assetName: string, assetBuffer: ArrayBuffer, availableNames: Iterable<string>, readAsset: (name: string) => Promise<Uint8Array>) {
  const names = [...availableNames];
  const dependencies = new Set<string>();
  const assetText = new TextDecoder().decode(assetBuffer);
  let references: string[] = [];
  const kind = assetName.split(".").pop()?.toLowerCase();
  if (kind === "gltf") {
    try {
      const json = JSON.parse(assetText) as { buffers?: Array<{ uri?: string }>; images?: Array<{ uri?: string }> };
      references = [...(json.buffers ?? []), ...(json.images ?? [])].flatMap((item) => item.uri ? [item.uri] : []);
    } catch { /* The loader reports malformed model JSON with the existing model error. */ }
  } else if (kind === "obj") {
    references = [...assetText.matchAll(/^\s*mtllib\s+(.+)$/gim)].map((match) => match[1].trim());
  }
  for (const reference of references) {
    const resolved = resolveScanAssetPath(reference, assetName, names);
    if (!resolved) continue;
    dependencies.add(resolved);
    if (/\.mtl$/i.test(resolved)) {
      const material = new TextDecoder().decode(await readAsset(resolved));
      for (const line of material.split(/\r?\n/)) {
        if (!/^\s*(?:map_[\w]+|bump|disp|decal|norm|refl)\s+/i.test(line)) continue;
        const texture = line.trim().split(/\s+/).at(-1);
        if (!texture) continue;
        const texturePath = resolveScanAssetPath(texture, resolved, names);
        if (texturePath) dependencies.add(texturePath);
      }
    }
  }
  if (kind === "fbx") {
    const directory = assetName.slice(0, assetName.lastIndexOf("/") + 1);
    names.filter((name) => name.startsWith(directory) && /\.(?:jpe?g|png|webp)$/i.test(name)).forEach((name) => dependencies.add(name));
  }
  return [...dependencies];
}

async function parseIfc(file: LoadedAsset, onProgress: (progress: number) => void, signal: AbortSignal): Promise<ParsedIfc> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workers/ifc.worker.ts", import.meta.url), { type: "module" });
    const group = new THREE.Group();
    const components: IfcComponent[] = [];
    let queue = Promise.resolve();
    let finished = false;
    const dispose = () => group.traverse((object) => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => material.dispose()); } });
    const cleanup = () => { worker.terminate(); signal.removeEventListener("abort", abort); };
    const abort = () => { if (finished) return; finished = true; cleanup(); dispose(); reject(new DOMException("Cancelled", "AbortError")); };
    signal.addEventListener("abort", abort, { once: true });
    worker.onerror = () => { if (!finished) { finished = true; cleanup(); dispose(); reject(new Error("IFC parsing failed")); } };
    worker.onmessage = (event: MessageEvent<IfcReply>) => {
      const message = event.data;
      if (message.type === "ready") { if (!finished && !signal.aborted) worker.postMessage(file.buffer, [file.buffer]); return; }
      queue = queue.then(async () => {
        if (finished || signal.aborted) return;
        if (message.type === "error") { finished = true; cleanup(); dispose(); reject(new Error("IFC parsing failed")); return; }
        if (message.type === "done") { finished = true; cleanup(); onProgress(100); resolve({ group, components, floors: message.floors, cleanup: () => {} }); return; }
        const data = message.component;
        const object = new THREE.Group(); object.name = data.name; object.userData = { ifcId: data.id };
        for (const dataGeometry of data.geometries) {
          const interleaved = new THREE.InterleavedBuffer(dataGeometry.vertices, 6);
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute("position", new THREE.InterleavedBufferAttribute(interleaved, 3, 0));
          geometry.setAttribute("normal", new THREE.InterleavedBufferAttribute(interleaved, 3, 3));
          geometry.setIndex(new THREE.BufferAttribute(dataGeometry.indices, 1));
          const { x, y, z, w } = dataGeometry.color;
          const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(x, y, z), opacity: w, transparent: w < 1, roughness: .85, side: THREE.DoubleSide });
          const mesh = new THREE.Mesh(geometry, material); mesh.matrixAutoUpdate = false; mesh.matrix.fromArray(dataGeometry.transform); mesh.userData = { ifcId: data.id }; object.add(mesh);
        }
        group.add(object); components.push({ id: data.id, name: data.name, type: data.type, floor: data.floor, props: data.props, object }); onProgress(message.progress);
        // Yield during scene assembly as well as WASM parsing, keeping cancellation responsive.
        if (components.length % 30 === 0) await new Promise((done) => setTimeout(done, 0));
      }).catch(() => { if (!finished) { finished = true; cleanup(); dispose(); reject(new Error("IFC scene assembly failed")); } });
    };
    if (signal.aborted) { abort(); return; }
  });
}

function scanPoseMatrix(frame: ScanProjectFrame, project: ScanProjectIndex, model: THREE.Group) {
  if (!project.worldTransform) return null;
  model.updateMatrixWorld(true);
  return createScanPoseMatrix(frame, project.worldTransform, model.matrixWorld);
}

async function yieldToBrowser() {
  const schedulerApi = (window as Window & { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (schedulerApi?.yield) await schedulerApi.yield();
  else await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function getModelRoot(object: THREE.Object3D) {
  const root = new THREE.Group(); root.name = "Imported model"; root.add(object); return root;
}

export function ModelWorkspace() {
  const { t } = useI18n();
  const translateRef = useRef(t);
  const mountRef = useRef<HTMLDivElement>(null);
  const loadAbort = useRef<AbortController | null>(null);
  const loadVersion = useRef(0);
  const invalidateLoad = useCallback(() => { loadVersion.current++; }, []);
  const fileRef = useRef<HTMLInputElement>(null);
  const assetUrls = useRef<string[]>([]);
  const ifcCleanup = useRef<(() => void) | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const orbitRef = useRef<OrbitControls | null>(null);
  const modelRef = useRef<THREE.Group | null>(null);
  const stageRootRef = useRef<THREE.Group | null>(null);
  const stageCenterRef = useRef(new THREE.Vector3());
  const humanRef = useRef<THREE.Group | null>(null);
  const humanAnchorRef = useRef<THREE.Vector3 | null>(null);
  const baseModelDimensionsRef = useRef(new THREE.Vector3());
  const calibrationScaleRef = useRef(1);
  const verticalVelocityRef = useRef(0);
  const playerRef = useRef(new THREE.Vector3());
  const keysRef = useRef(new Set<string>());
  const pointerRef = useRef({ down: false, x: 0, y: 0, yaw: 0, pitch: 0 });
  const activeMeasureRef = useRef<MeasureMode>(null);
  const measurePointsRef = useRef<THREE.Vector3[]>([]);
  const highlightedComponentRef = useRef<THREE.Object3D | null>(null);
  const clickRaycaster = useRef(new THREE.Raycaster());
  const stageRef = useRef<HTMLDivElement>(null);
  const fullscreenButtonRef = useRef<HTMLButtonElement>(null);
  const immersiveSettingsRef = useRef<HTMLDivElement>(null);
  const frameTimeRef = useRef(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [assets, setAssets] = useState<ModelCandidate[]>([]);
  const [modelName, setModelName] = useState("");
  const [components, setComponents] = useState<IfcComponent[]>([]);
  const [floors, setFloors] = useState<string[]>([]);
  const [selectedFloor, setSelectedFloor] = useState("");
  const [selectedComponent, setSelectedComponent] = useState<IfcComponent | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("orbit");
  const [movement, setMovement] = useState<MovementMode>("walk");
  const [unit, setUnit] = useState("m");
  const [unitScale, setUnitScale] = useState(1);
  const [humanHeight, setHumanHeight] = useState(1.7);
  const [eyeHeight, setEyeHeight] = useState(1.6);
  const [personPlaced, setPersonPlaced] = useState(false);
  const [placementMode, setPlacementMode] = useState(false);
  const [immersiveMode, setImmersiveMode] = useState<ImmersiveMode>(null);
  const [immersiveSettingsOpen, setImmersiveSettingsOpen] = useState(false);
  const [scanFrameRotations, setScanFrameRotations] = useState<Record<number, QuarterTurn>>({});
  const [measureMode, setMeasureMode] = useState<MeasureMode>(null);
  const [measurePoints, setMeasurePoints] = useState<THREE.Vector3[]>([]);
  const [knownDistance, setKnownDistance] = useState("1");
  const [modelDimensions, setModelDimensions] = useState<THREE.Vector3 | null>(null);
  const [notice, setNotice] = useState("");
  const [dropActive, setDropActive] = useState(false);
  const [touchMove, setTouchMove] = useState("");
  const [scanProject, setScanProject] = useState<ScanProjectIndex | null>(null);
  const [scanModels, setScanModels] = useState<string[]>([]);
  const [scanEntryNames, setScanEntryNames] = useState<string[]>([]);
  const [scanModelName, setScanModelName] = useState("");
  const [scanFrameIndex, setScanFrameIndex] = useState(0);
  const [scanPlaying, setScanPlaying] = useState(false);
  const [scanSpeed, setScanSpeed] = useState(1);
  const [scanFollowCamera, setScanFollowCamera] = useState(false);
  const [scanFollowIssue, setScanFollowIssue] = useState("");
  const [scanShowTrajectory, setScanShowTrajectory] = useState(true);
  const [scanPreviewMode, setScanPreviewMode] = useState<"photo" | "depth" | "confidence">("photo");
  const [scanPreview, setScanPreview] = useState<ScanPreview | null>(null);
  const [scanPreviewBusy, setScanPreviewBusy] = useState(false);
  const [scanRawReadout, setScanRawReadout] = useState("");
  const [scanLoadingText, setScanLoadingText] = useState("");
  const depthCanvasRef = useRef<HTMLCanvasElement>(null);
  const confidenceCanvasRef = useRef<HTMLCanvasElement>(null);
  const photoCanvasRef = useRef<HTMLCanvasElement>(null);
  const photoDimensionsRef = useRef<{ width: number; height: number } | null>(null);
  const scanViewRef = useRef<{ project: ScanProjectIndex | null; frame: ScanProjectFrame | null; follow: boolean; rotation: QuarterTurn; orientation: number }>({ project: null, frame: null, follow: false, rotation: 0, orientation: 1 });
  const scanReaderRef = useRef<ScanProjectReader | null>(null);
  const activeScanProjectRef = useRef(false);
  const pendingAssetsRef = useRef(new Map<string, LoadedAsset>());
  const scanPreviewVersion = useRef(0);
  const scanPlaybackTimer = useRef<number | null>(null);
  const scanTrajectoryRef = useRef<THREE.Line | null>(null);
  const scanMarkerRef = useRef<THREE.Mesh | null>(null);
  const scanPositionsRef = useRef(new Map<number, THREE.Vector3>());
  const scanCameraRestoreRef = useRef<{ position: THREE.Vector3; quaternion: THREE.Quaternion; target: THREE.Vector3 } | null>(null);
  const lastFollowIssueFrameRef = useRef<number | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const previousBodyOverflowRef = useRef("");
  const controlsState = useRef({ viewMode, movement, touchMove, humanHeight, eyeHeight, selectedComponent, personPlaced });

  useEffect(() => { translateRef.current = t; }, [t]);

  const currentScanFrame = useMemo(() => scanProject?.frames[scanFrameIndex] ?? null, [scanProject, scanFrameIndex]);
  const scanPhotoRotation = currentScanFrame ? scanFrameRotations[currentScanFrame.index] ?? 0 : 0;
  const scanPreviewRotation = ((scanPhotoRotation + exifOrientationRotation(scanPreview?.photo?.orientation ?? currentScanFrame?.captureOrientation ?? 1)) % 360) as QuarterTurn;

  useEffect(() => {
    scanViewRef.current = { project: scanProject, frame: currentScanFrame, follow: scanFollowCamera, rotation: scanPhotoRotation, orientation: scanPreview?.photo?.orientation ?? currentScanFrame?.captureOrientation ?? 1 };
  }, [scanProject, currentScanFrame, scanFollowCamera, scanPhotoRotation, scanPreview]);

  useEffect(() => {
    const person = humanRef.current;
    if (!person) return;
    person.scale.y = humanHeight / 1.7;
    person.visible = personPlaced && viewMode !== "first";
  }, [humanHeight, personPlaced, viewMode, scanFollowCamera]);

  useEffect(() => {
    const reader = scanReaderRef.current;
    const frame = currentScanFrame;
    if (!scanProject || !frame || !reader) { setScanPreview(null); setScanPreviewBusy(false); photoDimensionsRef.current = null; return; }
    const version = ++scanPreviewVersion.current;
    let cancelled = false;
    setScanPreviewBusy(true); setScanRawReadout("");
    void reader.loadPreview(frame).then((preview) => {
      if (cancelled || version !== scanPreviewVersion.current) return;
      photoDimensionsRef.current = null;
      setScanPreview(preview); setScanPreviewBusy(false);
    }).catch((error: unknown) => {
      if (cancelled || version !== scanPreviewVersion.current) return;
      photoDimensionsRef.current = null; setScanPreview(null); setScanPreviewBusy(false);
      if (!(error instanceof DOMException && error.name === "AbortError")) setScanRawReadout(translateRef.current("threeScanPreviewError"));
    });
    return () => { cancelled = true; };
  }, [currentScanFrame, scanProject]);

  useEffect(() => {
    const canvas = photoCanvasRef.current;
    const photo = scanPreview?.photo;
    if (!canvas || scanPreviewMode !== "photo" || !photo) return;
    let cancelled = false;
    void createImageBitmap(new Blob([photo.bytes], { type: "image/jpeg" }), { imageOrientation: "from-image" }).then((bitmap) => {
      if (cancelled) { bitmap.close(); return; }
      photoDimensionsRef.current = { width: bitmap.width, height: bitmap.height };
      const rotated = scanPhotoRotation === 90 || scanPhotoRotation === 270;
      canvas.width = rotated ? bitmap.height : bitmap.width;
      canvas.height = rotated ? bitmap.width : bitmap.height;
      const context = canvas.getContext("2d");
      if (context) {
        context.save();
        if (scanPhotoRotation === 90) { context.translate(canvas.width, 0); context.rotate(Math.PI / 2); }
        else if (scanPhotoRotation === 180) { context.translate(canvas.width, canvas.height); context.rotate(Math.PI); }
        else if (scanPhotoRotation === 270) { context.translate(0, canvas.height); context.rotate(-Math.PI / 2); }
        context.drawImage(bitmap, 0, 0);
        context.restore();
      }
      bitmap.close();
    }).catch(() => { photoDimensionsRef.current = null; });
    return () => { cancelled = true; };
  }, [scanPreview, scanPreviewMode, scanPhotoRotation]);

  useEffect(() => {
    const canvas = depthCanvasRef.current;
    const depth = scanPreview?.depth;
    if (!canvas || !depth || "error" in depth) return;
    const rotated = rotateRgbaImage(depth.width, depth.height, depth.rgba, scanPreviewRotation);
    canvas.width = rotated.width; canvas.height = rotated.height;
    canvas.getContext("2d")?.putImageData(new ImageData(rotated.pixels, rotated.width, rotated.height), 0, 0);
  }, [scanPreview, scanPreviewMode, scanPreviewRotation]);

  useEffect(() => {
    const canvas = confidenceCanvasRef.current;
    const confidence = scanPreview?.confidence;
    if (!canvas || !confidence || "error" in confidence) return;
    const rotated = rotateRgbaImage(confidence.width, confidence.height, confidence.rgba, scanPreviewRotation);
    canvas.width = rotated.width; canvas.height = rotated.height;
    canvas.getContext("2d")?.putImageData(new ImageData(rotated.pixels, rotated.width, rotated.height), 0, 0);
  }, [scanPreview, scanPreviewMode, scanPreviewRotation]);

  useEffect(() => {
    if (!scanPlaying || !scanProject || scanProject.frames.length < 2) return;
    const nextIndex = scanFrameIndex + 1;
    if (nextIndex >= scanProject.frames.length) return;
    const current = scanProject.frames[scanFrameIndex];
    const next = scanProject.frames[nextIndex];
    const delay = Math.max(40, Math.min(1000, (next.time - current.time) * 1000 / scanSpeed));
    scanPlaybackTimer.current = window.setTimeout(() => {
      if (nextIndex === scanProject.frames.length - 1) setScanPlaying(false);
      setScanFrameIndex(nextIndex);
    }, delay);
    return () => { if (scanPlaybackTimer.current !== null) window.clearTimeout(scanPlaybackTimer.current); };
  }, [scanPlaying, scanProject, scanFrameIndex, scanSpeed]);

  useEffect(() => {
    const scene = sceneRef.current;
    const stage = stageRootRef.current;
    const oldLine = scanTrajectoryRef.current;
    if (oldLine) { oldLine.parent?.remove(oldLine); oldLine.geometry.dispose(); (oldLine.material as THREE.Material).dispose(); scanTrajectoryRef.current = null; }
    const oldMarker = scanMarkerRef.current;
    if (oldMarker) { scene?.remove(oldMarker); oldMarker.geometry.dispose(); (oldMarker.material as THREE.Material).dispose(); scanMarkerRef.current = null; }
    scanPositionsRef.current.clear();
    const project = scanProject;
    if (!project || !stage || !scene || !scanShowTrajectory) return;
    let cancelled = false;
    const points: THREE.Vector3[] = [];
    void (async () => {
      for (let offset = 0; offset < project.frames.length; offset += 100) {
        for (const frame of project.frames.slice(offset, offset + 100)) {
          if (!project.worldTransform) continue;
          const matrix = createScanPoseMatrix(frame, project.worldTransform, new THREE.Matrix4());
          if (!matrix) continue;
          const position = new THREE.Vector3().setFromMatrixPosition(matrix);
          points.push(position); scanPositionsRef.current.set(frame.index, position);
        }
        if (offset + 100 < project.frames.length) await yieldToBrowser();
        if (cancelled) return;
      }
      if (cancelled || points.length < 2) return;
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0x49d1aa, transparent: true, opacity: 0.88, depthTest: false }));
      line.renderOrder = 3; stage.add(line); scanTrajectoryRef.current = line;
      const marker = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffd166, depthTest: false }));
      marker.renderOrder = 4; scene.add(marker); scanMarkerRef.current = marker;
    })();
    return () => { cancelled = true; };
  }, [scanProject, scanModelName, scanShowTrajectory]);

  function clearScanProject() {
    scanPreviewVersion.current++;
    if (scanPlaybackTimer.current !== null) window.clearTimeout(scanPlaybackTimer.current);
    scanPlaybackTimer.current = null;
    scanReaderRef.current?.close(); scanReaderRef.current = null;
    activeScanProjectRef.current = false;
    const scene = sceneRef.current;
    if (scanTrajectoryRef.current) { scanTrajectoryRef.current.parent?.remove(scanTrajectoryRef.current); scanTrajectoryRef.current.geometry.dispose(); (scanTrajectoryRef.current.material as THREE.Material).dispose(); scanTrajectoryRef.current = null; }
    if (scanMarkerRef.current) { scene?.remove(scanMarkerRef.current); scanMarkerRef.current.geometry.dispose(); (scanMarkerRef.current.material as THREE.Material).dispose(); scanMarkerRef.current = null; }
    scanPositionsRef.current.clear();
    if (scanFollowCamera) restoreScanCamera();
    scanViewRef.current = { ...scanViewRef.current, project: null, frame: null, follow: false };
    setScanProject(null); setScanModels([]); setScanEntryNames([]); setScanModelName(""); setScanFrameIndex(0); setScanPlaying(false); setScanFollowCamera(false); setScanFollowIssue(""); setScanPreview(null); setScanPreviewBusy(false); setScanRawReadout(""); setScanFrameRotations({});
  }

  useEffect(() => () => {
    scanReaderRef.current?.close();
    if (scanPlaybackTimer.current !== null) window.clearTimeout(scanPlaybackTimer.current);
  }, []);

  useEffect(() => {
    controlsState.current = { viewMode, movement, touchMove, humanHeight, eyeHeight: Math.min(eyeHeight, humanHeight), selectedComponent, personPlaced };
  }, [viewMode, movement, touchMove, humanHeight, eyeHeight, selectedComponent, personPlaced]);
  useEffect(() => {
    const previous = highlightedComponentRef.current;
    previous?.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => {
        if (material instanceof THREE.MeshStandardMaterial && typeof material.userData.yoyoEmissive === "number") {
          material.emissive.setHex(material.userData.yoyoEmissive);
          delete material.userData.yoyoEmissive;
        }
      });
    });
    const current = selectedComponent?.object ?? null;
    current?.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => {
        if (material instanceof THREE.MeshStandardMaterial) {
          material.userData.yoyoEmissive = material.emissive.getHex();
          material.emissive.setHex(0x38b59b);
        }
      });
    });
    highlightedComponentRef.current = current;
  }, [selectedComponent]);

  function updateStageRootScale(scale: number) {
    const stage = stageRootRef.current;
    if (!stage) return;
    stage.matrix.copy(createCenteredStageMatrix(stageCenterRef.current, scale));
    stage.matrixWorldNeedsUpdate = true;
    stage.updateMatrixWorld(true);
    if (humanAnchorRef.current && humanRef.current) {
      const position = stage.localToWorld(humanAnchorRef.current.clone());
      playerRef.current.copy(position);
      humanRef.current.position.copy(position);
    }
  }

  function restoreScanCamera() {
    const camera = cameraRef.current;
    const orbit = orbitRef.current;
    const previous = scanCameraRestoreRef.current;
    if (camera && orbit && previous) {
      camera.position.copy(previous.position);
      camera.quaternion.copy(previous.quaternion);
      orbit.target.copy(previous.target);
      const width = mountRef.current?.clientWidth ?? 0;
      const height = mountRef.current?.clientHeight ?? 0;
      if (width && height) camera.aspect = width / height;
      camera.near = Math.max((modelDimensions?.length() ?? 1) / 10000, .001);
      camera.far = Math.max((modelDimensions?.length() ?? 1) * 100, 1000);
      camera.updateProjectionMatrix();
      orbit.enabled = viewMode === "orbit";
      orbit.update();
    }
    scanCameraRestoreRef.current = null;
    lastFollowIssueFrameRef.current = null;
    setScanFollowIssue("");
  }

  function changeViewMode(mode: ViewMode) {
    if (mode !== "orbit" && !personPlaced) { setNotice(t("threePlacePersonFirst")); return; }
    if (humanRef.current) humanRef.current.visible = personPlaced && mode !== "first";
    if (scanFollowCamera) {
      scanViewRef.current = { ...scanViewRef.current, follow: false };
      restoreScanCamera();
      setScanFollowCamera(false);
    }
    setNotice("");
    setViewMode(mode);
  }

  function enterImmersive() {
    const element = stageRef.current;
    if (!modelName || !element) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    previousBodyOverflowRef.current = document.body.style.overflow;
    setImmersiveSettingsOpen(false);
    const request = element.requestFullscreen;
    if (!request) { setImmersiveMode("fallback"); return; }
    try {
      void request.call(element).then(() => setImmersiveMode("native")).catch(() => setImmersiveMode("fallback"));
    } catch {
      setImmersiveMode("fallback");
    }
  }

  function exitImmersive() {
    if (document.fullscreenElement && document.exitFullscreen) {
      try { void document.exitFullscreen().catch(() => {}); } catch { /* The fallback layout still exits below. */ }
    }
    if (immersiveMode === "fallback") setImmersiveMode(null);
  }

  function rotateCurrentPhoto(delta: -90 | 90) {
    if (!currentScanFrame || !scanProject) return;
    const next = ((scanPhotoRotation + delta + 360) % 360) as QuarterTurn;
    setScanFrameRotations((rotations) => ({ ...rotations, [currentScanFrame.index]: next }));
  }

  function applyPhotoRotationToScan() {
    if (!scanProject || !currentScanFrame) return;
    setScanFrameRotations(Object.fromEntries(scanProject.frames.map((frame) => [frame.index, scanPhotoRotation])));
  }

  useEffect(() => {
    if (!immersiveMode) {
      document.body.style.overflow = previousBodyOverflowRef.current;
      const previousFocus = previousFocusRef.current;
      previousFocusRef.current = null;
      if (previousFocus?.isConnected) requestAnimationFrame(() => previousFocus.focus());
      return;
    }

    if (!previousFocusRef.current) previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!previousBodyOverflowRef.current) previousBodyOverflowRef.current = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => stageRef.current?.querySelector<HTMLElement>(".model-toolbar button")?.focus());

    const onFullscreenChange = () => {
      if (document.fullscreenElement === stageRef.current) setImmersiveMode("native");
      else if (immersiveMode === "native") setImmersiveMode(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && immersiveMode === "fallback") { event.preventDefault(); setImmersiveMode(null); return; }
      if (event.key !== "Tab") return;
      const stage = stageRef.current;
      if (!stage) return;
      const focusable = [...stage.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter((item) => item.getClientRects().length > 0);
      if (!focusable.length) { event.preventDefault(); stage.focus(); return; }
      const first = focusable[0]; const last = focusable.at(-1)!;
      if (event.shiftKey && (document.activeElement === first || !stage.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !stage.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("fullscreenchange", onFullscreenChange); document.removeEventListener("keydown", onKeyDown); };
  }, [immersiveMode]);

  const disposeModel = useCallback((preserveScanPerson = false) => {
    loadAbort.current?.abort(); loadAbort.current = null;
    const model = modelRef.current;
    if (model) {
      model.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => { material.map?.dispose(); material.dispose(); });
        }
      });
    }
    const stage = stageRootRef.current;
    if (stage) sceneRef.current?.remove(stage);
    else if (model) sceneRef.current?.remove(model);
    modelRef.current = null;
    stageRootRef.current = null;
    stageCenterRef.current.set(0, 0, 0);
    baseModelDimensionsRef.current.set(0, 0, 0);
    if (!preserveScanPerson) {
      humanAnchorRef.current = null;
      humanRef.current && (humanRef.current.visible = false);
      setPersonPlaced(false); setPlacementMode(false);
    }
    ifcCleanup.current?.(); ifcCleanup.current = null;
    assetUrls.current.forEach(URL.revokeObjectURL); assetUrls.current = [];
    setComponents([]); setFloors([]); setSelectedComponent(null); setModelDimensions(null); setModelName(""); setAssets([]); setMeasurePoints([]); measurePointsRef.current = [];
  }, []);

  useEffect(() => {
    if (!mountRef.current) return;
    const mount = mountRef.current;
    let frame = 0;
    const scene = new THREE.Scene(); scene.background = new THREE.Color("#101a20");
    scene.add(new THREE.HemisphereLight(0xddece8, 0x25352f, 2.1));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.3); keyLight.position.set(-5, 10, 7); scene.add(keyLight);
    const camera = new THREE.PerspectiveCamera(52, 1, 0.01, 100000); camera.position.set(4, 3, 5);
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" }); }
    catch { setError(translateRef.current("threeWebglUnavailable")); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8)); renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute("aria-label", translateRef.current("threeViewerTitle"));
    mount.appendChild(renderer.domElement); rendererRef.current = renderer; sceneRef.current = scene; cameraRef.current = camera;
    const orbit = new OrbitControls(camera, renderer.domElement); orbit.enableDamping = true; orbit.target.set(0, 1, 0); orbitRef.current = orbit;
    const grid = new THREE.GridHelper(20, 20, 0x516d67, 0x263c3b); scene.add(grid);
    const axes = new THREE.AxesHelper(1.5); scene.add(axes);
    const person = new THREE.Group();
    const personMaterial = new THREE.MeshStandardMaterial({ color: 0x45c9a2, roughness: .72, emissive: 0x073d30 });
    const limbMaterial = new THREE.MeshStandardMaterial({ color: 0x287d68, roughness: .76, emissive: 0x06271f });
    const headMaterial = new THREE.MeshStandardMaterial({ color: 0xf2c7a5, roughness: .78 });
    const addHumanCapsule = (radius: number, length: number, x: number, y: number, z: number, material: THREE.Material, rotationZ = 0) => {
      const part = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 4, 8), material);
      part.position.set(x, y, z); part.rotation.z = rotationZ; part.castShadow = false; person.add(part);
      return part;
    };
    addHumanCapsule(.18, .52, 0, 1.16, 0, personMaterial);
    const pelvis = new THREE.Mesh(new THREE.SphereGeometry(.19, 16, 12), limbMaterial);
    pelvis.position.set(0, .78, 0); pelvis.scale.set(1.08, .72, .8); person.add(pelvis);
    addHumanCapsule(.065, .42, -.28, 1.08, 0, limbMaterial, -.1);
    addHumanCapsule(.065, .42, .28, 1.08, 0, limbMaterial, .1);
    addHumanCapsule(.075, .62, -.105, .42, 0, limbMaterial);
    addHumanCapsule(.075, .62, .105, .42, 0, limbMaterial);
    for (const x of [-.105, .105]) {
      const foot = new THREE.Mesh(new THREE.BoxGeometry(.14, .08, .25), limbMaterial);
      foot.position.set(x, .045, -.055); foot.castShadow = false; person.add(foot);
    }
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(.065, .075, .12, 12), headMaterial);
    neck.position.y = 1.53; person.add(neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(.13, 16, 12), headMaterial);
    head.position.y = 1.57; person.add(head);
    person.visible = false; person.name = "Human scale reference"; person.userData.referenceHeight = 1.7;
    scene.add(person); humanRef.current = person;
    const resize = () => {
      const width = mount.clientWidth; const height = mount.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      if (!scanViewRef.current.follow) { camera.aspect = width / height; camera.updateProjectionMatrix(); }
    };
    const observer = new ResizeObserver(resize); observer.observe(mount); resize();

    const animate = (time: number) => {
      frame = requestAnimationFrame(animate);
      const delta = frameTimeRef.current ? Math.min(.05, Math.max(0, (time - frameTimeRef.current) / 1000)) : 0;
      frameTimeRef.current = time;
      const currentControls = controlsState.current;
      if (humanRef.current) humanRef.current.visible = currentControls.personPlaced && currentControls.viewMode !== "first";
      const scanView = scanViewRef.current;
      if (!scanView.follow && currentControls.viewMode !== "orbit" && currentControls.personPlaced && modelRef.current) {
        const direction = new THREE.Vector3();
        const yaw = pointerRef.current.yaw;
        const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
        const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
        const keys = keysRef.current;
        const forwardOn = keys.has("w") || keys.has("arrowup") || currentControls.touchMove === "up";
        const backOn = keys.has("s") || keys.has("arrowdown") || currentControls.touchMove === "down";
        const leftOn = keys.has("a") || keys.has("arrowleft") || currentControls.touchMove === "left";
        const rightOn = keys.has("d") || keys.has("arrowright") || currentControls.touchMove === "right";
        if (forwardOn) direction.add(forward); if (backOn) direction.sub(forward); if (leftOn) direction.sub(right); if (rightOn) direction.add(right);
        if (direction.lengthSq() > 0) direction.normalize().multiplyScalar(3 * delta);
        const current = playerRef.current;
        const next = current.clone().add(direction);
        if (currentControls.movement === "fly") {
          if (keys.has(" ") || keys.has("e")) next.y += 3 * delta;
          if (keys.has("shift") || keys.has("q")) next.y -= 3 * delta;
        } else if (direction.lengthSq() > 0) {
          const horizontal = new THREE.Vector3(direction.x, 0, direction.z);
          const obstacleRay = new THREE.Raycaster(current.clone().add(new THREE.Vector3(0, 0.8, 0)), horizontal.clone().normalize(), 0, 0.7);
          const obstacles = modelRef.current.children.filter((child) => child !== currentControls.selectedComponent?.object);
          if (horizontal.lengthSq() && obstacleRay.intersectObjects(obstacles, true).length > 0) { next.x = current.x; next.z = current.z; }
          const floorRay = new THREE.Raycaster(new THREE.Vector3(next.x, current.y + .35, next.z), new THREE.Vector3(0, -1, 0), 0, 4.35);
          const floorsHit = floorRay.intersectObjects(modelRef.current.children, true).find((hit) => hit.face?.normal && hit.face.normal.clone().transformDirection(hit.object.matrixWorld).y > .55);
          if (floorsHit && current.y >= floorsHit.point.y - .2 && verticalVelocityRef.current <= 0) { next.y = floorsHit.point.y; verticalVelocityRef.current = 0; }
          else { verticalVelocityRef.current = Math.max(-12, verticalVelocityRef.current - 9.8 * delta); next.y = current.y + verticalVelocityRef.current * delta; }
        }
        current.copy(next);
        if (stageRootRef.current && humanAnchorRef.current) humanAnchorRef.current.copy(stageRootRef.current.worldToLocal(current.clone()));
        if (humanRef.current && currentControls.viewMode !== "first") humanRef.current.position.copy(current);
        const cameraDirection = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pointerRef.current.pitch), Math.sin(pointerRef.current.pitch), -Math.cos(yaw) * Math.cos(pointerRef.current.pitch));
        if (currentControls.viewMode === "first") {
          camera.position.set(current.x, current.y + currentControls.eyeHeight, current.z); camera.lookAt(camera.position.clone().add(cameraDirection));
        } else {
          const target = current.clone().add(new THREE.Vector3(0, currentControls.humanHeight * 0.6, 0));
          camera.position.copy(target).addScaledVector(cameraDirection, -3.2); camera.lookAt(target);
        }
      }
      if (!scanView.follow && currentControls.viewMode === "orbit") orbit.update();
      if (scanView.follow && scanView.project && scanView.frame && stageRootRef.current) {
        const pose = scanPoseMatrix(scanView.frame, scanView.project, stageRootRef.current);
        if (pose) {
          const decomposed = decomposeScanPose(pose);
          camera.position.copy(decomposed.position);
          camera.quaternion.copy(decomposed.rotation);
          const orientationTurn = exifOrientationRotation(scanView.orientation);
          const rotation = ((orientationTurn + scanView.rotation) % 360) as QuarterTurn;
          if (scanView.frame.projection?.length === 16) {
            camera.projectionMatrix.copy(createFollowProjection(scanView.frame.projection, rotation));
            camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
          }
          camera.updateMatrixWorld();
          if (lastFollowIssueFrameRef.current !== null) { lastFollowIssueFrameRef.current = null; setScanFollowIssue(""); }
        } else if (lastFollowIssueFrameRef.current !== scanView.frame.index) {
          lastFollowIssueFrameRef.current = scanView.frame.index;
          setScanFollowIssue(translateRef.current("threeScanInvalidPose"));
        }
      }
      if (scanMarkerRef.current && scanView.frame) {
        const markerPosition = scanPositionsRef.current.get(scanView.frame.index);
        if (markerPosition && stageRootRef.current) scanMarkerRef.current.position.copy(stageRootRef.current.localToWorld(markerPosition.clone()));
      }
      renderer.setScissorTest(false); renderer.setViewport(0, 0, mount.clientWidth, mount.clientHeight); renderer.clear(true, true, true);
      if (scanView.follow && scanView.frame?.projection?.length === 16) {
        const frame = scanView.frame;
        const orientationTurn = exifOrientationRotation(scanView.orientation);
        const rotation = ((orientationTurn + scanView.rotation) % 360) as QuarterTurn;
        const intrinsics = frame.intrinsics;
        const projection = frame.projection!;
        const rawAspect = frame.captureWidth && frame.captureHeight
          ? frame.captureWidth / frame.captureHeight
          : projection[5] / projection[0] * (intrinsics?.[0] && intrinsics[4] ? intrinsics[0] / intrinsics[4] : 1);
        const photo = photoDimensionsRef.current;
        let aspect = photo ? photo.width / photo.height : rawAspect;
        if (scanView.rotation === 90 || scanView.rotation === 270) aspect = 1 / aspect;
        if (!photo && (orientationTurn === 90 || orientationTurn === 270)) aspect = 1 / aspect;
        const width = mount.clientWidth; const height = mount.clientHeight;
        let viewportWidth = width; let viewportHeight = height;
        if (width / height > aspect) viewportWidth = height * aspect;
        else viewportHeight = width / aspect;
        const x = (width - viewportWidth) / 2; const y = (height - viewportHeight) / 2;
        renderer.setViewport(x, y, viewportWidth, viewportHeight); renderer.setScissor(x, y, viewportWidth, viewportHeight); renderer.setScissorTest(true);
      }
      renderer.render(scene, camera);
      renderer.setScissorTest(false);
    };
    frame = requestAnimationFrame(animate);

    const clearKeys = () => { keysRef.current.clear(); pointerRef.current.down = false; };
    const onKeyDown = (event: KeyboardEvent) => { const key = event.key.toLowerCase(); if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift", " ", "e", "q"].includes(key)) { keysRef.current.add(key); if (controlsState.current.viewMode !== "orbit") event.preventDefault(); } };
    const onKeyUp = (event: KeyboardEvent) => keysRef.current.delete(event.key.toLowerCase());
    renderer.domElement.addEventListener("keydown", onKeyDown); renderer.domElement.addEventListener("keyup", onKeyUp); window.addEventListener("blur", clearKeys); document.addEventListener("visibilitychange", clearKeys);
    const onContextMenu = (event: Event) => event.preventDefault(); renderer.domElement.addEventListener("contextmenu", onContextMenu);
    return () => {
      invalidateLoad(); disposeModel();
      cancelAnimationFrame(frame); observer.disconnect(); renderer.domElement.removeEventListener("keydown", onKeyDown); renderer.domElement.removeEventListener("keyup", onKeyUp); window.removeEventListener("blur", clearKeys); document.removeEventListener("visibilitychange", clearKeys); renderer.domElement.removeEventListener("contextmenu", onContextMenu);
      orbit.dispose(); renderer.dispose(); person.traverse((object) => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => material.dispose()); } }); if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
      rendererRef.current = null; orbitRef.current = null; sceneRef.current = null; cameraRef.current = null;
      humanRef.current = null;
    };
  }, [disposeModel, invalidateLoad]);

  useEffect(() => {
    if (orbitRef.current) orbitRef.current.enabled = viewMode === "orbit" && !scanFollowCamera;
  }, [viewMode, scanFollowCamera]);

  async function importFiles(files: File[]) {
    clearScanProject(); pendingAssetsRef.current.clear();
    calibrationScaleRef.current = 1;
    setAssets([]); setScanLoadingText(""); setError(""); setNotice(""); setBusy(true); setProgress(0);
    const version = ++loadVersion.current;
    loadAbort.current?.abort();
    try {
      const zipFile = files.find((file) => file.name.toLowerCase().endsWith(".zip"));
      if (zipFile) {
        const reader = new ScanProjectReader(); scanReaderRef.current = reader;
        const archive = await reader.open(zipFile, (status) => { setScanLoadingText(status.message); setProgress(status.progress); });
        if (version !== loadVersion.current) { reader.close(); return; }
        activeScanProjectRef.current = Boolean(archive.project);
        setBusy(false); setScanLoadingText(""); setScanModels(archive.models); setScanEntryNames(archive.entryNames);
        if (!archive.models.length) throw new Error(t("threeNoModelInZip"));
        if (archive.project) {
          setScanProject(archive.project); setScanFrameIndex(0); setScanPreviewMode("photo");
          const defaultModel = preferredScanModel(archive.project);
          if (defaultModel) await loadArchiveCandidate(defaultModel, archive.entryNames);
          else setNotice(t("threeScanProjectNoModel"));
          return;
        }
        if (archive.models.length === 1) { await loadArchiveCandidate(archive.models[0], archive.entryNames); return; }
        setAssets(archive.models.map((name) => ({ name, kind: name.split(".").pop()?.toLowerCase() ?? "" })));
        setNotice(t("threeChooseZipModel")); return;
      }
      const candidates = await unpackFiles(files);
      if (version !== loadVersion.current) return;
      if (!candidates.length) throw new Error(t("threeNoModelInZip"));
      for (const candidate of candidates) pendingAssetsRef.current.set(candidate.name, candidate);
      if (candidates.length > 1) { setAssets(candidates.map(({ name, kind }) => ({ name, kind }))); setBusy(false); setNotice(t("threeChooseZipModel")); return; }
      await loadAsset(candidates[0]);
    } catch (cause) { if (version === loadVersion.current) { setError(cause instanceof Error ? cause.message : t("threeLoadFailed")); setBusy(false); } }
  }

  async function loadCandidate(name: string) {
    const candidate = pendingAssetsRef.current.get(name);
    if (candidate) { await loadAsset(candidate); return; }
    await loadArchiveCandidate(name, scanEntryNames);
  }

  async function loadArchiveCandidate(name: string, entryNames: string[]) {
    const reader = scanReaderRef.current;
    if (!reader) throw new Error(t("threeScanReaderClosed"));
    setBusy(true); setProgress(0); setNotice(""); setError(""); setScanLoadingText(t("threeReadingModel"));
    const requestVersion = ++loadVersion.current;
    try {
      const cache = new Map<string, Uint8Array>();
      const readAsset = async (assetName: string) => {
        const cached = cache.get(assetName);
        if (cached) return cached;
        const result = (await reader.read([assetName]))[0];
        if (!result) throw new Error(t("threeMissingAsset"));
        cache.set(assetName, result.bytes);
        return result.bytes;
      };
      const modelBytes = await readAsset(name);
      const dependencies = await referencedAssetNames(name, modelBytes.buffer.slice(modelBytes.byteOffset, modelBytes.byteOffset + modelBytes.byteLength), entryNames, readAsset);
      if (requestVersion !== loadVersion.current) return;
      const files = await Promise.all(dependencies.map(async (assetName) => {
        const bytes = await readAsset(assetName);
        const extension = assetName.split(".").pop()?.toLowerCase();
        const mime = extension === "jpg" || extension === "jpeg" ? "image/jpeg" : extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : extension === "mtl" ? "text/plain" : "application/octet-stream";
        return { name: assetName, file: new File([bytes], assetName, { type: mime }) };
      }));
      const buffer = modelBytes.buffer.slice(modelBytes.byteOffset, modelBytes.byteOffset + modelBytes.byteLength);
      const asset: LoadedAsset = { name, buffer, files, kind: name.split(".").pop()?.toLowerCase() ?? "" };
      setScanLoadingText(""); await loadAsset(asset);
      if (modelRef.current) setScanModelName(name);
    } catch (cause) {
      if (requestVersion === loadVersion.current) { setError(cause instanceof Error ? cause.message : t("threeLoadFailed")); setBusy(false); setScanLoadingText(""); }
    }
  }

  function setScanFollow(enabled: boolean) {
    const camera = cameraRef.current;
    const orbit = orbitRef.current;
    if (enabled && camera && orbit) {
      scanCameraRestoreRef.current = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), target: orbit.target.clone() };
      lastFollowIssueFrameRef.current = null;
      setScanFollowIssue("");
      orbit.enabled = false;
    } else if (!enabled && camera && orbit) {
      scanViewRef.current = { ...scanViewRef.current, follow: false };
      restoreScanCamera();
    }
    setScanFollowCamera(enabled);
  }

  function togglePlacementMode() {
    if (!modelName) return;
    if (placementMode) { setPlacementMode(false); setNotice(""); return; }
    if (scanFollowCamera) setScanFollow(false);
    setMeasureMode(null); activeMeasureRef.current = null; setMeasurePoints([]); measurePointsRef.current = [];
    setViewMode("orbit");
    setNotice(t("threePlacePersonHint"));
    setPlacementMode(true);
  }

  function removeHuman() {
    if (scanFollowCamera) setScanFollow(false);
    humanAnchorRef.current = null;
    if (humanRef.current) { humanRef.current.position.set(0, 0, 0); humanRef.current.visible = false; }
    playerRef.current.set(0, 0, 0); verticalVelocityRef.current = 0;
    keysRef.current.clear(); setPersonPlaced(false); setPlacementMode(false); setViewMode("orbit"); setTouchMove("");
    setNotice(t("threePersonRemoved"));
  }

  function readScanPixel(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (scanPreviewMode !== "depth" || !scanPreview?.depth || "error" in scanPreview.depth) return;
    const depth = scanPreview.depth;
    const bounds = event.currentTarget.getBoundingClientRect();
    const displayWidth = scanPreviewRotation === 90 || scanPreviewRotation === 270 ? depth.height : depth.width;
    const displayHeight = scanPreviewRotation === 90 || scanPreviewRotation === 270 ? depth.width : depth.height;
    const displayX = Math.min(displayWidth - 1, Math.max(0, Math.floor((event.clientX - bounds.left) * displayWidth / bounds.width)));
    const displayY = Math.min(displayHeight - 1, Math.max(0, Math.floor((event.clientY - bounds.top) * displayHeight / bounds.height)));
    const { x, y } = displayPixelToSource(displayX, displayY, depth.width, depth.height, scanPreviewRotation);
    const value = depth.raw[y * depth.width + x];
    setScanRawReadout(t("threeScanDepthValue", { value, x, y }));
  }

  function toggleScanPlayback() {
    if (scanPlaying) { setScanPlaying(false); return; }
    if (scanProject && scanFrameIndex >= scanProject.frames.length - 1) setScanFrameIndex(0);
    setScanPlaying(true);
  }

  async function loadAsset(asset: LoadedAsset) {
    const version = ++loadVersion.current;
    const preserveScanPerson = activeScanProjectRef.current;
    if (!preserveScanPerson) calibrationScaleRef.current = 1;
    disposeModel(preserveScanPerson);
    const controller = new AbortController(); loadAbort.current = controller;
    const timeout = window.setTimeout(() => { if (version === loadVersion.current) { controller.abort(); setError(t("threeLoadTimeout")); setBusy(false); } }, 120000);
    setBusy(true); setProgress(0); setError(""); setNotice("");
    try {
      const scene = sceneRef.current; if (!scene) throw new Error(t("threeWebglUnavailable"));
      let parsedGroup: THREE.Group; let parsedComponents: IfcComponent[] = []; let parsedFloors: string[] = [];
      if (asset.kind === "ifc") {
        const parsed = await parseIfc(asset, setProgress, controller.signal);
        parsedGroup = parsed.group; parsedComponents = parsed.components; parsedFloors = parsed.floors; ifcCleanup.current = parsed.cleanup;
      } else {
        const manager = new THREE.LoadingManager();
        let textureTotal = 0;
        let textureLoaded = 0;
        manager.onStart = (_url, _loaded, total) => { textureTotal = total; };
        manager.onProgress = (_url, loaded, total) => { textureLoaded = loaded; textureTotal = total; };
        const urlByName = new Map<string, string>();
        for (const item of asset.files) { const url = URL.createObjectURL(item.file); assetUrls.current.push(url); urlByName.set(normalizeModelAssetPath(item.name), url); }
        manager.setURLModifier((url) => {
          const exact = resolveModelAsset(url, urlByName);
          if (exact) return exact;
          throw new Error(t("threeMissingAsset"));
        });
        const path = asset.name.includes("/") ? asset.name.slice(0, asset.name.lastIndexOf("/") + 1) : "";
        if (asset.kind === "glb" || asset.kind === "gltf") {
          const loader = new GLTFLoader(manager);
          const gltf = await new Promise<Awaited<ReturnType<typeof loader.parseAsync>>>((resolve, reject) => loader.parse(asset.buffer, path, resolve, reject));
          parsedGroup = getModelRoot(gltf.scene);
        } else if (asset.kind === "obj") {
          const objText = new TextDecoder().decode(asset.buffer);
          const materialReference = [...objText.matchAll(/^\s*mtllib\s+(.+)$/gim)].map((match) => match[1].trim())[0];
          const materialName = materialReference ? resolveScanAssetPath(materialReference, asset.name, asset.files.map((item) => normalizeModelAssetPath(item.name))) : undefined;
          const materialFile = materialName ? asset.files.find((item) => normalizeModelAssetPath(item.name) === materialName) : undefined;
          if (materialReference && !materialFile) throw new Error(t("threeMissingAsset"));
          const waitForTextures = new Promise<void>((resolve) => { manager.onLoad = () => resolve(); });
          const loader = new OBJLoader(manager);
          if (materialFile) {
            const materialDirectory = materialName!.slice(0, materialName!.lastIndexOf("/") + 1);
            const materialLoader = new MTLLoader(manager);
            const materials = materialLoader.parse(await materialFile.file.text(), materialDirectory || path);
            materials.preload(); loader.setMaterials(materials);
          }
          const object = loader.parse(objText);
          if (textureLoaded < textureTotal) await waitForTextures;
          parsedGroup = getModelRoot(object);
        } else if (asset.kind === "usdz") {
          const loader = new USDLoader(manager);
          parsedGroup = getModelRoot(await new Promise<THREE.Group>((resolve, reject) => { loader.parse(asset.buffer, path, resolve, reject); }));
        } else {
          const loader = new FBXLoader(manager);
          const object = loader.parse(asset.buffer, path);
          if (textureLoaded < textureTotal) await new Promise<void>((resolve) => { manager.onLoad = () => resolve(); });
          parsedGroup = getModelRoot(object);
        }
      }
      if (controller.signal.aborted || version !== loadVersion.current) { parsedGroup.traverse((object) => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => material.dispose()); } }); return; }
      const bounds = new THREE.Box3().setFromObject(parsedGroup);
      if (bounds.isEmpty()) throw new Error(t("threeLoadFailed"));
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      const scale = UNIT_METERS[unit] * (preserveScanPerson ? calibrationScaleRef.current : 1);
      const stage = new THREE.Group(); stage.name = "Centered model and scan coordinates"; stage.matrixAutoUpdate = false;
      stageCenterRef.current.copy(center); baseModelDimensionsRef.current.copy(size);
      stage.matrix.copy(createCenteredStageMatrix(center, scale));
      stage.add(parsedGroup); scene.add(stage); stageRootRef.current = stage; modelRef.current = parsedGroup;
      stage.updateMatrixWorld(true);
      const scaledBounds = new THREE.Box3().setFromObject(stage);
      const orbit = orbitRef.current;
      const camera = cameraRef.current;
      const modelRadius = Math.max(scaledBounds.getSize(new THREE.Vector3()).length() * 0.65, 1);
      if (camera && orbit) {
        camera.position.set(modelRadius * 1.2, modelRadius * 0.85, modelRadius * 1.4);
        camera.near = Math.max(modelRadius / 10000, 0.001);
        camera.far = modelRadius * 100;
        camera.updateProjectionMatrix();
        orbit.maxDistance = modelRadius * 30;
        orbit.target.set(0, 0, 0);
        orbit.update();
      }
      setUnitScale(scale);
      setModelDimensions(size.clone().multiplyScalar(scale)); setModelName(asset.name); setComponents(parsedComponents); setFloors(parsedFloors); setSelectedFloor(parsedFloors[0] ?? ""); setProgress(100);
      if (!preserveScanPerson) { playerRef.current.set(0, scaledBounds.min.y, 0); humanAnchorRef.current = null; }
      else if (humanAnchorRef.current && humanRef.current) { const placed = stage.localToWorld(humanAnchorRef.current.clone()); playerRef.current.copy(placed); humanRef.current.position.copy(placed); }
      pointerRef.current.yaw = 0; pointerRef.current.pitch = 0;
      orbitRef.current?.target.set(0, 0, 0); orbitRef.current?.update();
      setViewMode("orbit"); setBusy(false); setAssets([]); setScanLoadingText("");
    } catch (cause) { if (version === loadVersion.current && !controller.signal.aborted) { disposeModel(); setError(cause instanceof Error && cause.message.includes(t("threeMissingAsset")) ? t("threeMissingAsset") : t("threeLoadFailed")); setBusy(false); } }
    finally { window.clearTimeout(timeout); }
  }

  function beginPointer(event: ReactPointerEvent<HTMLDivElement>) {
    if (placementMode && modelRef.current && cameraRef.current && rendererRef.current && stageRootRef.current) {
      const rect = rendererRef.current.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      clickRaycaster.current.setFromCamera(mouse, cameraRef.current);
      const hit = clickRaycaster.current.intersectObjects(modelRef.current.children, true).find((item) => item.face?.normal && item.face.normal.clone().transformDirection(item.object.matrixWorld).y > .55);
      if (!hit) { setNotice(t("threePlacePersonNoSurface")); return; }
      const position = hit.point.clone();
      humanAnchorRef.current = stageRootRef.current.worldToLocal(position.clone());
      playerRef.current.copy(position); verticalVelocityRef.current = 0;
      if (humanRef.current) humanRef.current.position.copy(position);
      pointerRef.current.yaw = 0; pointerRef.current.pitch = 0;
      setPersonPlaced(true); setPlacementMode(false); setNotice(""); setViewMode("orbit");
      return;
    }
    if (measureMode && modelRef.current && cameraRef.current && rendererRef.current) {
      const rect = rendererRef.current.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      clickRaycaster.current.setFromCamera(mouse, cameraRef.current);
      const hit = clickRaycaster.current.intersectObject(modelRef.current, true)[0];
      if (hit) {
        const points = [...measurePointsRef.current, hit.point.clone()];
        if (points.length >= 2) { points.splice(0, points.length - 2); if (activeMeasureRef.current !== "calibrate") { activeMeasureRef.current = null; setMeasureMode(null); } }
        measurePointsRef.current = points; setMeasurePoints(points);
      }
      return;
    }
    if (viewMode === "orbit") return;
    pointerRef.current.down = true; pointerRef.current.x = event.clientX; pointerRef.current.y = event.clientY;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function movePointer(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointerRef.current.down || viewMode === "orbit") return;
    const dx = event.clientX - pointerRef.current.x; const dy = event.clientY - pointerRef.current.y;
    pointerRef.current.x = event.clientX; pointerRef.current.y = event.clientY;
    pointerRef.current.yaw -= dx * 0.004; pointerRef.current.pitch = THREE.MathUtils.clamp(pointerRef.current.pitch - dy * 0.004, -1.35, 1.35);
  }

  function applyCalibration() {
    if (measurePoints.length < 2) return;
    const known = Number(knownDistance);
    const distance = measurePoints[0].distanceTo(measurePoints[1]);
    if (!Number.isFinite(known) || known <= 0 || !distance) { setError(t("threeLoadFailed")); return; }
    const factor = known * UNIT_METERS[unit] / distance;
    calibrationScaleRef.current *= factor;
    const nextScale = unitScale * factor;
    updateStageRootScale(nextScale);
    setUnitScale(nextScale);
    setModelDimensions((current) => current?.clone().multiplyScalar(factor) ?? null);
    setMeasurePoints([]); measurePointsRef.current = []; setMeasureMode(null); activeMeasureRef.current = null;
  }

  function toggleComponent(component: IfcComponent, only: boolean) {
    if (!modelRef.current) return;
    modelRef.current.children.forEach((child) => { child.visible = !only || child === component.object; });
    if (!only) component.object.visible = false;
  }

  function focusComponent(component: IfcComponent) {
    const bounds = new THREE.Box3().setFromObject(component.object);
    const center = bounds.isEmpty() ? component.object.position : bounds.getCenter(new THREE.Vector3());
    if (orbitRef.current) { orbitRef.current.target.copy(center); orbitRef.current.update(); }
    cameraRef.current?.lookAt(center);
  }

  const floorComponents = components.filter((item) => item.floor === selectedFloor).slice(0, 2000);
  const currentDistance = measurePoints.length === 2 ? measurePoints[0].distanceTo(measurePoints[1]) : null;
  const scanElapsed = currentScanFrame && scanProject?.startTime !== null && scanProject?.startTime !== undefined ? Math.max(0, currentScanFrame.time - scanProject.startTime) : 0;
  const scanClock = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;

  return <main id="content" tabIndex={-1} className="main-shell model-page">
    <header className="model-heading"><div><h1>{t("threeViewerTitle")}</h1><p>{t("threeViewerDescription")}</p></div><span className="model-privacy"><ShieldCheck size={16} />{t("threeNoUpload")}</span></header>
    <section className="model-import" onDragEnter={(event: DragEvent) => { event.preventDefault(); setDropActive(true); }} onDragOver={(event: DragEvent) => event.preventDefault()} onDragLeave={() => setDropActive(false)} onDrop={(event: DragEvent) => { event.preventDefault(); setDropActive(false); void importFiles(Array.from(event.dataTransfer.files)); }} data-active={dropActive || undefined}>
      <input ref={fileRef} className="sr-only" type="file" multiple accept=".glb,.gltf,.fbx,.ifc,.obj,.usdz,.mtl,.zip,model/gltf-binary,model/gltf+json,model/vnd.usdz+zip" onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void importFiles(files); }} />
      <div className="model-import-icon"><FileUp size={23} /></div><div><strong>{t("threeDropFiles")}</strong><p>{t("threeSupportedFormats")}</p></div>
      <button type="button" className="button-primary" onClick={() => fileRef.current?.click()}><FileUp size={17} />{t("threeChooseModel")}</button>
    </section>
    {assets.length > 1 && <div className="model-candidate-list" role="dialog" aria-label={t("threeChooseZipModel")}><strong>{t("threeChooseZipModel")}</strong>{assets.map((asset) => <button type="button" key={asset.name} onClick={() => void loadCandidate(asset.name)}><Box size={16} />{asset.name}</button>)}</div>}
    {notice && <p className="model-notice" role="status">{notice}</p>}
    {error && <p className="model-error" role="alert">{error}</p>}
    {busy && <div className="model-progress" role="status"><span>{scanLoadingText || t("threeLoading")}</span><progress value={progress} max={100} aria-label={t("threeLoading")} /><span>{t("threeLoadingProgress", { progress })}</span><button type="button" onClick={() => { loadVersion.current++; loadAbort.current?.abort(); clearScanProject(); pendingAssetsRef.current.clear(); setBusy(false); setNotice(t("threeLoadCancelled")); }}>{t("threeCancelLoad")}</button></div>}
    <section ref={stageRef} className="model-workbench" data-immersive={immersiveMode ?? undefined} data-settings-open={immersiveSettingsOpen ? "true" : "false"} aria-label={t("threeViewerTitle")} role={immersiveMode ? "dialog" : undefined} aria-modal={immersiveMode ? true : undefined} tabIndex={-1}>
      <div className="model-stage-wrap">
        <div className="model-toolbar">
          <div className="model-mode-tabs" role="group" aria-label={t("threeCameraMode")}>
            {([["orbit", t("threeOrbit")], ["first", t("threeFirstPerson")], ["third", t("threeThirdPerson")]] as const).map(([mode, label]) => <button key={mode} type="button" aria-pressed={viewMode === mode} disabled={mode !== "orbit" && !personPlaced} onClick={() => changeViewMode(mode)}>{label}</button>)}
          </div>
          {viewMode !== "orbit" && <label className="model-movement-select">{t("threeMovementMode")}<select value={movement} onChange={(event) => setMovement(event.target.value as MovementMode)}><option value="walk">{t("threeWalk")}</option><option value="fly">{t("threeFly")}</option></select></label>}
          <button type="button" className="icon-button model-place-person" aria-pressed={placementMode} disabled={!modelName || scanFollowCamera} onClick={togglePlacementMode} aria-label={placementMode ? t("threeCancelPlacement") : t("threePlacePerson")} title={placementMode ? t("threeCancelPlacement") : t("threePlacePerson")}><PersonStanding size={18} />{placementMode && <span>{t("threePlacePersonActive")}</span>}</button>
          {immersiveMode && <button type="button" className="icon-button" aria-expanded={immersiveSettingsOpen} aria-controls="model-settings-panel" onClick={() => setImmersiveSettingsOpen((open) => !open)} aria-label={t("threeImmersiveSettings")} title={t("threeImmersiveSettings")}><SlidersHorizontal size={18} /></button>}
          <button type="button" className="icon-button" onClick={() => { if (scanFollowCamera) setScanFollow(false); if (cameraRef.current && orbitRef.current) { cameraRef.current.position.set(4, 3, 5); orbitRef.current.target.set(0, 0, 0); orbitRef.current.update(); } }} aria-label={t("threeResetView")} title={t("threeResetView")}><Focus size={17} /></button>
          <button ref={fullscreenButtonRef} type="button" className="icon-button" disabled={!modelName} onClick={immersiveMode ? exitImmersive : enterImmersive} aria-label={immersiveMode ? t("threeExitImmersive") : t("threeEnterImmersive")} title={immersiveMode ? t("threeExitImmersive") : t("threeEnterImmersive")}>{immersiveMode ? <Minimize size={18} /> : <Maximize size={18} />}</button>
          {modelName && <button type="button" className="icon-button" onClick={() => { clearScanProject(); disposeModel(); }} aria-label={t("threeClearModel")} title={t("threeClearModel")}><X size={17} /></button>}
        </div>
        <div className="model-canvas" ref={mountRef} onPointerDown={beginPointer} onPointerMove={movePointer} onPointerUp={() => { pointerRef.current.down = false; }} onPointerCancel={() => { pointerRef.current.down = false; }} role="img" aria-label={modelName ? `${t("threeModelInfo")}: ${modelName}` : t("threeViewerTitle")} tabIndex={0}>
          {!modelName && !error && <div className="model-canvas-empty"><Box size={38} /><strong>{t("threeChooseModel")}</strong><span>{t("threeSupportedFormats")}</span></div>}
          {modelName && viewMode !== "orbit" && <p className="model-controls-hint">{t("threeWalkInstructions")}</p>}
          {placementMode && <div className="model-placement-overlay" role="status">{t("threePlacePersonHint")}</div>}
          {measurePoints.length === 1 && <div className="model-measure-hint">{t("threePickPoints")}</div>}
        </div>
        {viewMode !== "orbit" && <div className="model-touch-pad" role="group" aria-label={t("threeTouchMove")}>
          <button type="button" onPointerDown={() => setTouchMove("up")} onPointerUp={() => setTouchMove("")} onPointerLeave={() => setTouchMove("")} onPointerCancel={() => setTouchMove("")} aria-label={t("threeForward")}>↑</button>
          <button type="button" onPointerDown={() => setTouchMove("left")} onPointerUp={() => setTouchMove("")} onPointerLeave={() => setTouchMove("")} onPointerCancel={() => setTouchMove("")} aria-label={t("threeLeft")}>←</button>
          <button type="button" onPointerDown={() => setTouchMove("down")} onPointerUp={() => setTouchMove("")} onPointerLeave={() => setTouchMove("")} onPointerCancel={() => setTouchMove("")} aria-label={t("threeBack")}>↓</button>
          <button type="button" onPointerDown={() => setTouchMove("right")} onPointerUp={() => setTouchMove("")} onPointerLeave={() => setTouchMove("")} onPointerCancel={() => setTouchMove("")} aria-label={t("threeRight")}>→</button>
        </div>}
        {modelName && <div className="model-stage-footer"><span><Box size={14} />{modelName}</span>{modelDimensions && <span>{t("threeBounds")}: {(modelDimensions.x / UNIT_METERS[unit]).toFixed(2)} × {(modelDimensions.y / UNIT_METERS[unit]).toFixed(2)} × {(modelDimensions.z / UNIT_METERS[unit]).toFixed(2)} {unit}</span>}</div>}
        {scanProject && immersiveMode && <div className="scan-immersive-dock" aria-label={t("threeScanProject")}>
          <div className="scan-playback-controls">
            <button type="button" className="button-secondary" disabled={!scanProject.frames.length || scanFrameIndex === 0} aria-label={t("threeScanPreviousFrame")} onClick={() => { setScanPlaying(false); setScanFrameIndex((index) => Math.max(0, index - 1)); }}><ChevronLeft size={16} /></button>
            <button type="button" className="button-secondary" disabled={scanProject.frames.length < 2} aria-label={scanPlaying ? t("threeScanPause") : t("threeScanPlay")} onClick={toggleScanPlayback}>{scanPlaying ? <Pause size={16} /> : <Play size={16} />}</button>
            <button type="button" className="button-secondary" disabled={!scanProject.frames.length || scanFrameIndex >= scanProject.frames.length - 1} aria-label={t("threeScanNextFrame")} onClick={() => { setScanPlaying(false); setScanFrameIndex((index) => Math.min(scanProject.frames.length - 1, index + 1)); }}><ChevronRight size={16} /></button>
            <span>{currentScanFrame ? t("threeScanCurrentFrame", { current: scanFrameIndex + 1, total: scanProject.frames.length, time: scanClock(scanElapsed) }) : t("threeScanNoFrames")}</span>
          </div>
          <label className="scan-timeline-label"><span className="sr-only">{t("threeScanTimeline")}</span><input type="range" min="0" max={Math.max(0, scanProject.frames.length - 1)} value={scanFrameIndex} disabled={!scanProject.frames.length} onChange={(event) => { setScanPlaying(false); setScanFrameIndex(Number(event.target.value)); }} aria-label={t("threeScanTimeline")} /></label>
        </div>}
      </div>
      <aside id="model-settings-panel" className="model-sidebar" aria-label={immersiveMode ? t("threeImmersiveSettings") : undefined}>
        {scanProject && <section className="model-side-section scan-project-panel" aria-label={t("threeScanProject")}>
          <h2><Camera size={17} />{scanProject.title}</h2>
          <p>{t("threeScanSummary", { frames: scanProject.frames.length, photos: scanProject.imageCount, duration: scanClock(scanProject.duration) })}</p>
          {scanProject.worldMapName && <p className="scan-project-map">{t("threeScanWorldMapAvailable")}: {scanProject.worldMapName.split("/").pop()}</p>}
          {scanFollowIssue && <p className="scan-follow-issue" role="status">{scanFollowIssue}</p>}
          {scanProject.models.length > 1 && <label>{t("threeScanModel")}<select value={scanModelName || preferredScanModel(scanProject) || ""} onChange={(event) => void loadCandidate(event.target.value)}>{scanProject.models.map((name) => <option key={name} value={name}>{name.split("/").pop()}</option>)}</select></label>}
          <div className="scan-playback-controls">
            <button type="button" className="button-secondary" disabled={!scanProject.frames.length || scanFrameIndex === 0} aria-label={t("threeScanPreviousFrame")} onClick={() => { setScanPlaying(false); setScanFrameIndex((index) => Math.max(0, index - 1)); }}><ChevronLeft size={16} /></button>
            <button type="button" className="button-secondary" disabled={scanProject.frames.length < 2} aria-label={scanPlaying ? t("threeScanPause") : t("threeScanPlay")} onClick={toggleScanPlayback}>{scanPlaying ? <Pause size={16} /> : <Play size={16} />}</button>
            <button type="button" className="button-secondary" disabled={!scanProject.frames.length || scanFrameIndex >= scanProject.frames.length - 1} aria-label={t("threeScanNextFrame")} onClick={() => { setScanPlaying(false); setScanFrameIndex((index) => Math.min(scanProject.frames.length - 1, index + 1)); }}><ChevronRight size={16} /></button>
            <span>{currentScanFrame ? t("threeScanCurrentFrame", { current: scanFrameIndex + 1, total: scanProject.frames.length, time: scanClock(scanElapsed) }) : t("threeScanNoFrames")}</span>
          </div>
          <label className="scan-timeline-label">{t("threeScanTimeline")}<input type="range" min="0" max={Math.max(0, scanProject.frames.length - 1)} value={scanFrameIndex} disabled={!scanProject.frames.length} onChange={(event) => { setScanPlaying(false); setScanFrameIndex(Number(event.target.value)); }} aria-label={t("threeScanTimeline")} /></label>
          <label>{t("threeScanPlaybackSpeed")}<select value={scanSpeed} onChange={(event) => setScanSpeed(Number(event.target.value))}><option value="0.5">0.5×</option><option value="1">1×</option><option value="2">2×</option></select></label>
          <label className="scan-toggle"><input type="checkbox" checked={scanShowTrajectory} disabled={!scanProject.worldTransform} onChange={(event) => setScanShowTrajectory(event.target.checked)} />{t("threeScanShowTrajectory")}</label>
          <label className="scan-toggle"><input type="checkbox" checked={scanFollowCamera} disabled={!currentScanFrame?.cameraPose || !scanProject.worldTransform || !modelName} onChange={(event) => setScanFollow(event.target.checked)} />{t("threeScanFollowCamera")}</label>
          <div className="scan-preview-tabs" role="group" aria-label={t("threeScanPreview")}>
            {([["photo", t("threeScanPhoto")], ["depth", t("threeScanDepth")], ["confidence", t("threeScanConfidence")]] as const).map(([mode, label]) => <button type="button" key={mode} aria-pressed={scanPreviewMode === mode} onClick={() => setScanPreviewMode(mode)}>{label}</button>)}
          </div>
          <div className="scan-photo-orientation" role="group" aria-label={t("threePhotoOrientation")}>
            <button type="button" className="button-secondary" onClick={() => rotateCurrentPhoto(-90)} title={t("threeRotatePhotoCounterClockwise")} aria-label={t("threeRotatePhotoCounterClockwise")}><RotateCcw size={16} /></button>
            <span>{scanPhotoRotation}°</span>
            <button type="button" className="button-secondary" onClick={() => rotateCurrentPhoto(90)} title={t("threeRotatePhotoClockwise")} aria-label={t("threeRotatePhotoClockwise")}><RotateCw size={16} /></button>
            <button type="button" className="button-secondary" onClick={applyPhotoRotationToScan}>{t("threeApplyRotationToScan")}</button>
          </div>
          <div className="scan-preview" aria-live="polite">
            {scanPreviewBusy && <p>{t("threeScanLoadingFrame")}</p>}
            {!scanPreviewBusy && scanPreviewMode === "photo" && (scanPreview?.photo ? (
              <canvas ref={photoCanvasRef} className="scan-photo-canvas" role="img" aria-label={t("threeScanPhotoAlt", { index: currentScanFrame?.index ?? 0 })} />
            ) : <p>{t("threeScanNoPhoto")}</p>)}
            {!scanPreviewBusy && scanPreviewMode === "depth" && (scanPreview?.depth && "error" in scanPreview.depth ? <p role="alert">{t("threeScanPreviewError")}</p> : scanPreview?.depth ? <canvas ref={depthCanvasRef} onPointerMove={readScanPixel} aria-label={t("threeScanDepthAlt")} /> : <p>{t("threeScanDepthUnavailable")}</p>)}
            {!scanPreviewBusy && scanPreviewMode === "confidence" && (scanPreview?.confidence && "error" in scanPreview.confidence ? <p role="alert">{t("threeScanPreviewError")}</p> : scanPreview?.confidence ? <canvas ref={confidenceCanvasRef} aria-label={t("threeScanConfidenceAlt")} /> : <p>{t("threeScanConfidenceUnavailable")}</p>)}
          </div>
          {scanPreviewMode === "depth" && scanPreview?.depth && !("error" in scanPreview.depth) && <p className="scan-depth-range">{t("threeScanDepthRange", { minimum: scanPreview.depth.minimum, maximum: scanPreview.depth.maximum })}</p>}
          {scanPreviewMode === "depth" && scanRawReadout && <p className="scan-depth-readout" role="status">{scanRawReadout}</p>}
        </section>}
        <section className="model-side-section"><h2><Gauge size={17} />{t("threeHumanScale")}</h2><label>{t("threeUnit")}<select value={unit} onChange={(event) => { const next = event.target.value; const factor = UNIT_METERS[next] / UNIT_METERS[unit]; const nextScale = unitScale * factor; updateStageRootScale(nextScale); setModelDimensions((current) => current?.clone().multiplyScalar(factor) ?? null); setUnitScale(nextScale); setUnit(next); }}><option value="m">{t("threeMeters")}</option><option value="cm">{t("threeCentimeters")}</option><option value="mm">{t("threeMillimeters")}</option><option value="ft">{t("threeFeet")}</option><option value="in">{t("threeInches")}</option></select></label>
          <label>{t("threeHeight")} <output>{humanHeight.toFixed(2)} m</output><input type="range" min="1.2" max="2.2" step="0.01" value={humanHeight} onChange={(event) => { const height = Number(event.target.value); const scale = height / humanHeight; setHumanHeight(height); setEyeHeight((current) => Math.min(height, Math.max(1, current * scale))); }} /></label>
          <label>{t("threeEyeHeight")} <output>{eyeHeight.toFixed(2)} m</output><input type="range" min="1.0" max={humanHeight} step="0.01" value={Math.min(eyeHeight, humanHeight)} onChange={(event) => setEyeHeight(Number(event.target.value))} /></label>
          {personPlaced && <button type="button" className="button-secondary model-remove-person" onClick={removeHuman}><PersonStanding size={15} /><X size={14} />{t("threeRemovePerson")}</button>}
          {!personPlaced && <p className="model-placement-hint">{t("threePlacePersonFirst")}</p>}
        </section>
        <section className="model-side-section"><h2><Ruler size={17} />{t("threeMeasure")}</h2><p>{t("threeCalibratePrompt")}</p><div className="model-measure-actions"><button type="button" className="button-secondary" disabled={!modelName} onClick={() => { setMeasureMode("measure"); activeMeasureRef.current = "measure"; setMeasurePoints([]); measurePointsRef.current = []; }}>{t("threeMeasure")}</button><button type="button" className="button-secondary" disabled={!modelName} onClick={() => { setMeasureMode("calibrate"); activeMeasureRef.current = "calibrate"; setMeasurePoints([]); measurePointsRef.current = []; }}>{t("threeCalibration")}</button></div>
          {measureMode === "calibrate" && <div className="model-calibration"><label>{t("threeKnownDistance")}<input type="number" min="0.001" step="any" value={knownDistance} onChange={(event) => setKnownDistance(event.target.value)} /></label><button type="button" className="button-primary" disabled={measurePoints.length < 2} onClick={applyCalibration}>{t("threeCalibration")}</button></div>}
          {currentDistance !== null && <p className="model-distance-result"><strong>{t("threeMeasuredDistance")}</strong><span>{(currentDistance / UNIT_METERS[unit]).toFixed(3)} {unit}</span></p>}
          {measureMode && <button type="button" className="model-cancel-measure" onClick={() => { setMeasureMode(null); activeMeasureRef.current = null; setMeasurePoints([]); measurePointsRef.current = []; }}>{t("threeCancelMeasure")}</button>}
        </section>
        {floors.length > 0 && <section className="model-side-section"><h2><Layers3 size={17} />{t("threeFloors")} / {t("threeComponents")}</h2><label>{t("threeFloors")}<select value={selectedFloor} onChange={(event) => setSelectedFloor(event.target.value)}>{floors.map((floor) => <option key={floor} value={floor}>{floor || t("threeUnassigned")}</option>)}</select></label><div className="model-component-list">{floorComponents.map((component) => <button type="button" key={component.id} aria-pressed={selectedComponent?.id === component.id} onClick={() => { setSelectedComponent(component); focusComponent(component); }}><span>{component.name}</span><small>{component.type.replace(/^IFC/i, "")}</small></button>)}</div>{floorComponents.length === 0 && <p>{t("threeSelectComponent")}</p>}
          {selectedComponent && <div className="model-property-actions"><h3>{t("threeProperties")}</h3>{Object.entries(selectedComponent.props).map(([key, value]) => <p key={key}><span>{key}</span><span>{value}</span></p>)}<button type="button" onClick={() => toggleComponent(selectedComponent, false)}><EyeOff size={14} />{t("threeHideComponent")}</button><button type="button" onClick={() => toggleComponent(selectedComponent, true)}><Eye size={14} />{t("threeShowOnlyComponent")}</button><button type="button" onClick={() => { if (modelRef.current) modelRef.current.children.forEach((child) => child.visible = true); }}><Eye size={14} />{t("threeShowAllComponents")}</button></div>}
        </section>}
        <p className="model-large-hint"><Footprints size={15} />{t("threeLargeModelHint")}</p>
      </aside>
    </section>
  </main>;
}
