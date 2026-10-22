"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Box, Eye, EyeOff, FileUp, Focus, Footprints, Gauge, Layers3, Ruler, ShieldCheck, X } from "lucide-react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import JSZip from "jszip";
import type { IfcReply } from "@/lib/ifc-transfer";
import { normalizeModelAssetPath, resolveModelAsset } from "@/lib/model-assets";
import { useI18n } from "@/lib/use-i18n";

type ViewMode = "orbit" | "first" | "third";
type MovementMode = "walk" | "fly";
type MeasureMode = "measure" | "calibrate" | null;
type IfcComponent = { id: number; name: string; type: string; floor: string; props: Record<string, string>; object: THREE.Group };
type LoadedAsset = { name: string; buffer: ArrayBuffer; files: Array<{ name: string; file: File }>; kind: string };
type ParsedIfc = { group: THREE.Group; components: IfcComponent[]; floors: string[]; cleanup: () => void };
const UNIT_METERS: Record<string, number> = { m: 1, cm: 0.01, mm: 0.001, ft: 0.3048, in: 0.0254 };

async function unpackFiles(files: File[]): Promise<LoadedAsset[]> {
  const expanded: Array<{ name: string; file: File }> = [];
  for (const file of files) {
    if (file.name.toLowerCase().endsWith(".zip")) {
      const zip = await JSZip.loadAsync(file);
      const items = Object.values(zip.files).filter((entry) => !entry.dir && !entry.name.split("/").some((part) => part.startsWith("__MACOSX")));
      for (const entry of items) {
        const blob = await entry.async("blob");
        expanded.push({ name: entry.name, file: new File([blob], entry.name.split("/").pop() || entry.name, { type: blob.type }) });
      }
    } else expanded.push({ name: file.name, file });
  }
  const candidates = expanded.filter(({ name }) => /\.(glb|gltf|fbx|ifc)$/i.test(name));
  return Promise.all(candidates.map(async (candidate) => ({
    name: candidate.name,
    buffer: await candidate.file.arrayBuffer(),
    files: expanded,
    kind: candidate.name.split(".").pop()?.toLowerCase() ?? "",
  })));
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
  const playerRef = useRef(new THREE.Vector3());
  const keysRef = useRef(new Set<string>());
  const pointerRef = useRef({ down: false, x: 0, y: 0, yaw: 0, pitch: 0 });
  const activeMeasureRef = useRef<MeasureMode>(null);
  const measurePointsRef = useRef<THREE.Vector3[]>([]);
  const highlightedComponentRef = useRef<THREE.Object3D | null>(null);
  const clickRaycaster = useRef(new THREE.Raycaster());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [assets, setAssets] = useState<LoadedAsset[]>([]);
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
  const [measureMode, setMeasureMode] = useState<MeasureMode>(null);
  const [measurePoints, setMeasurePoints] = useState<THREE.Vector3[]>([]);
  const [knownDistance, setKnownDistance] = useState("1");
  const [modelDimensions, setModelDimensions] = useState<THREE.Vector3 | null>(null);
  const [notice, setNotice] = useState("");
  const [dropActive, setDropActive] = useState(false);
  const [touchMove, setTouchMove] = useState("");
  const controlsState = useRef({ viewMode, movement, touchMove, humanHeight, eyeHeight, selectedComponent });

  useEffect(() => { translateRef.current = t; }, [t]);
  useEffect(() => {
    controlsState.current = { viewMode, movement, touchMove, humanHeight, eyeHeight, selectedComponent };
  }, [viewMode, movement, touchMove, humanHeight, eyeHeight, selectedComponent]);
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

  const disposeModel = useCallback(() => {
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
      sceneRef.current?.remove(model);
    }
    modelRef.current = null;
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
    const resize = () => { const width = mount.clientWidth; const height = mount.clientHeight; if (!width || !height) return; renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); };
    const observer = new ResizeObserver(resize); observer.observe(mount); resize();

    const animate = () => {
      frame = requestAnimationFrame(animate);
      const delta = 0.016;
      const currentControls = controlsState.current;
      if (currentControls.viewMode !== "orbit" && modelRef.current) {
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
          const floorRay = new THREE.Raycaster(new THREE.Vector3(next.x, current.y + 0.35, next.z), new THREE.Vector3(0, -1, 0), 0, 4.35);
          const floorsHit = floorRay.intersectObjects(modelRef.current.children, true).find((hit) => hit.face?.normal && hit.face.normal.y > 0.55);
          next.y = current.y - 9.8 * delta * delta;
          if (floorsHit && current.y >= floorsHit.point.y - 0.2) next.y = Math.max(next.y, floorsHit.point.y);
        }
        current.copy(next);
        const cameraDirection = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pointerRef.current.pitch), Math.sin(pointerRef.current.pitch), -Math.cos(yaw) * Math.cos(pointerRef.current.pitch));
        if (currentControls.viewMode === "first") {
          camera.position.set(current.x, current.y + currentControls.eyeHeight, current.z); camera.lookAt(camera.position.clone().add(cameraDirection));
        } else {
          const target = current.clone().add(new THREE.Vector3(0, currentControls.humanHeight * 0.6, 0));
          camera.position.copy(target).addScaledVector(cameraDirection, -3.2); camera.lookAt(target);
        }
      }
      if (currentControls.viewMode === "orbit") orbit.update();
      renderer.render(scene, camera);
    };
    animate();

    const onKeyDown = (event: KeyboardEvent) => { const key = event.key.toLowerCase(); if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift", " ", "e", "q"].includes(key)) { keysRef.current.add(key); if (controlsState.current.viewMode !== "orbit") event.preventDefault(); } };
    const onKeyUp = (event: KeyboardEvent) => keysRef.current.delete(event.key.toLowerCase());
    renderer.domElement.addEventListener("keydown", onKeyDown); renderer.domElement.addEventListener("keyup", onKeyUp);
    const onContextMenu = (event: Event) => event.preventDefault(); renderer.domElement.addEventListener("contextmenu", onContextMenu);
    return () => {
      invalidateLoad(); disposeModel();
      cancelAnimationFrame(frame); observer.disconnect(); renderer.domElement.removeEventListener("keydown", onKeyDown); renderer.domElement.removeEventListener("keyup", onKeyUp); renderer.domElement.removeEventListener("contextmenu", onContextMenu);
      orbit.dispose(); renderer.dispose(); if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
      rendererRef.current = null; orbitRef.current = null; sceneRef.current = null; cameraRef.current = null;
    };
  }, [disposeModel, invalidateLoad]);

  useEffect(() => {
    if (orbitRef.current) orbitRef.current.enabled = viewMode === "orbit";
  }, [viewMode]);

  async function importFiles(files: File[]) {
    setError(""); setNotice(""); setBusy(true); setProgress(0);
    const version = ++loadVersion.current;
    loadAbort.current?.abort();
    try {
      const candidates = await unpackFiles(files);
      if (version !== loadVersion.current) return;
      if (!candidates.length) throw new Error(t("threeNoModelInZip"));
      if (candidates.length > 1) { setAssets(candidates); setBusy(false); setNotice(t("threeChooseZipModel")); return; }
      await loadAsset(candidates[0]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("threeLoadFailed")); setBusy(false); }
  }

  async function loadAsset(asset: LoadedAsset) {
    const version = ++loadVersion.current;
    disposeModel();
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
        } else {
          const loader = new FBXLoader(manager);
          const object = loader.parse(asset.buffer, path);
          parsedGroup = getModelRoot(object);
        }
      }
      if (controller.signal.aborted || version !== loadVersion.current) { parsedGroup.traverse((object) => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => material.dispose()); } }); return; }
      const bounds = new THREE.Box3().setFromObject(parsedGroup);
      if (bounds.isEmpty()) throw new Error(t("threeLoadFailed"));
      const center = bounds.getCenter(new THREE.Vector3());
      parsedGroup.position.sub(center);
      parsedGroup.scale.setScalar(UNIT_METERS[unit]);
      scene.add(parsedGroup); modelRef.current = parsedGroup;
      const scaledBounds = new THREE.Box3().setFromObject(parsedGroup);
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
      setModelDimensions(scaledBounds.getSize(new THREE.Vector3())); setModelName(asset.name); setComponents(parsedComponents); setFloors(parsedFloors); setSelectedFloor(parsedFloors[0] ?? ""); setProgress(100);
      playerRef.current.set(0, scaledBounds.min.y, 0); pointerRef.current.yaw = 0; pointerRef.current.pitch = 0;
      orbitRef.current?.target.set(0, 0, 0); orbitRef.current?.update();
      setViewMode("orbit"); setBusy(false); setAssets([]);
    } catch (cause) { if (version === loadVersion.current && !controller.signal.aborted) { disposeModel(); setError(cause instanceof Error && cause.message.includes(t("threeMissingAsset")) ? t("threeMissingAsset") : t("threeLoadFailed")); setBusy(false); } }
    finally { window.clearTimeout(timeout); }
  }

  function beginPointer(event: ReactPointerEvent<HTMLDivElement>) {
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
    if (modelRef.current) modelRef.current.scale.multiplyScalar(factor);
    setUnitScale((scale) => scale * factor);
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

  return <main id="content" tabIndex={-1} className="main-shell model-page">
    <header className="model-heading"><div><h1>{t("threeViewerTitle")}</h1><p>{t("threeViewerDescription")}</p></div><span className="model-privacy"><ShieldCheck size={16} />{t("threeNoUpload")}</span></header>
    <section className="model-import" onDragEnter={(event: DragEvent) => { event.preventDefault(); setDropActive(true); }} onDragOver={(event: DragEvent) => event.preventDefault()} onDragLeave={() => setDropActive(false)} onDrop={(event: DragEvent) => { event.preventDefault(); setDropActive(false); void importFiles(Array.from(event.dataTransfer.files)); }} data-active={dropActive || undefined}>
      <input ref={fileRef} className="sr-only" type="file" multiple accept=".glb,.gltf,.fbx,.ifc,.zip,model/gltf-binary,model/gltf+json" onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void importFiles(files); }} />
      <div className="model-import-icon"><FileUp size={23} /></div><div><strong>{t("threeDropFiles")}</strong><p>{t("threeSupportedFormats")}</p></div>
      <button type="button" className="button-primary" onClick={() => fileRef.current?.click()}><FileUp size={17} />{t("threeChooseModel")}</button>
    </section>
    {assets.length > 1 && <div className="model-candidate-list" role="dialog" aria-label={t("threeChooseZipModel")}><strong>{t("threeChooseZipModel")}</strong>{assets.map((asset) => <button type="button" key={asset.name} onClick={() => void loadAsset(asset)}><Box size={16} />{asset.name}</button>)}</div>}
    {notice && <p className="model-notice" role="status">{notice}</p>}
    {error && <p className="model-error" role="alert">{error}</p>}
    {busy && <div className="model-progress" role="status"><span>{t("threeLoading")}</span><progress value={progress} max={100} aria-label={t("threeLoading")} /><span>{t("threeLoadingProgress", { progress })}</span><button type="button" onClick={() => { loadVersion.current++; loadAbort.current?.abort(); setBusy(false); setNotice(t("threeLoadCancelled")); }}>{t("threeCancelLoad")}</button></div>}
    <section className="model-workbench" aria-label={t("threeViewerTitle")}>
      <div className="model-stage-wrap">
        <div className="model-toolbar">
          <div className="model-mode-tabs" role="group" aria-label={t("threeCameraMode")}>
            {([["orbit", t("threeOrbit")], ["first", t("threeFirstPerson")], ["third", t("threeThirdPerson")]] as const).map(([mode, label]) => <button key={mode} type="button" aria-pressed={viewMode === mode} onClick={() => setViewMode(mode)}>{label}</button>)}
          </div>
          {viewMode !== "orbit" && <label className="model-movement-select">{t("threeMovementMode")}<select value={movement} onChange={(event) => setMovement(event.target.value as MovementMode)}><option value="walk">{t("threeWalk")}</option><option value="fly">{t("threeFly")}</option></select></label>}
          <button type="button" className="icon-button" onClick={() => { if (cameraRef.current && orbitRef.current) { cameraRef.current.position.set(4, 3, 5); orbitRef.current.target.set(0, 0, 0); orbitRef.current.update(); } }} aria-label={t("threeResetView")} title={t("threeResetView")}><Focus size={17} /></button>
          {modelName && <button type="button" className="icon-button" onClick={disposeModel} aria-label={t("threeClearModel")} title={t("threeClearModel")}><X size={17} /></button>}
        </div>
        <div className="model-canvas" ref={mountRef} onPointerDown={beginPointer} onPointerMove={movePointer} onPointerUp={() => { pointerRef.current.down = false; }} onPointerCancel={() => { pointerRef.current.down = false; }} role="img" aria-label={modelName ? `${t("threeModelInfo")}: ${modelName}` : t("threeViewerTitle")} tabIndex={0}>
          {!modelName && !error && <div className="model-canvas-empty"><Box size={38} /><strong>{t("threeChooseModel")}</strong><span>{t("threeSupportedFormats")}</span></div>}
          {modelName && viewMode !== "orbit" && <p className="model-controls-hint">{t("threeWalkInstructions")}</p>}
          {measurePoints.length === 1 && <div className="model-measure-hint">{t("threePickPoints")}</div>}
        </div>
        {viewMode !== "orbit" && <div className="model-touch-pad" aria-label={t("threeTouchMove")}>
          <button type="button" onPointerDown={() => setTouchMove("up")} onPointerUp={() => setTouchMove("")} onPointerLeave={() => setTouchMove("")} aria-label={t("threeForward")}>↑</button>
          <button type="button" onPointerDown={() => setTouchMove("left")} onPointerUp={() => setTouchMove("")} onPointerLeave={() => setTouchMove("")} aria-label={t("threeLeft")}>←</button>
          <button type="button" onPointerDown={() => setTouchMove("down")} onPointerUp={() => setTouchMove("")} onPointerLeave={() => setTouchMove("")} aria-label={t("threeBack")}>↓</button>
          <button type="button" onPointerDown={() => setTouchMove("right")} onPointerUp={() => setTouchMove("")} onPointerLeave={() => setTouchMove("")} aria-label={t("threeRight")}>→</button>
        </div>}
        {modelName && <div className="model-stage-footer"><span><Box size={14} />{modelName}</span>{modelDimensions && <span>{t("threeBounds")}: {(modelDimensions.x / UNIT_METERS[unit]).toFixed(2)} × {(modelDimensions.y / UNIT_METERS[unit]).toFixed(2)} × {(modelDimensions.z / UNIT_METERS[unit]).toFixed(2)} {unit}</span>}</div>}
      </div>
      <aside className="model-sidebar">
        <section className="model-side-section"><h2><Gauge size={17} />{t("threeHumanScale")}</h2><label>{t("threeUnit")}<select value={unit} onChange={(event) => { const next = event.target.value; const factor = UNIT_METERS[next] / UNIT_METERS[unit]; modelRef.current?.scale.multiplyScalar(factor); setModelDimensions((current) => current?.clone().multiplyScalar(factor) ?? null); setUnitScale((scale) => scale * factor); setUnit(next); }}><option value="m">{t("threeMeters")}</option><option value="cm">{t("threeCentimeters")}</option><option value="mm">{t("threeMillimeters")}</option><option value="ft">{t("threeFeet")}</option><option value="in">{t("threeInches")}</option></select></label>
          <label>{t("threeHeight")} <output>{humanHeight.toFixed(2)} m</output><input type="range" min="1.2" max="2.2" step="0.01" value={humanHeight} onChange={(event) => setHumanHeight(Number(event.target.value))} /></label>
          <label>{t("threeEyeHeight")} <output>{eyeHeight.toFixed(2)} m</output><input type="range" min="1.0" max={humanHeight} step="0.01" value={Math.min(eyeHeight, humanHeight)} onChange={(event) => setEyeHeight(Number(event.target.value))} /></label>
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
