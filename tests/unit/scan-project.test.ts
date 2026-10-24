import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { encode } from "fast-png";
import { buildScanProjectIndex, createCenteredStageMatrix, createFollowProjection, createScanPoseMatrix, decodeScanDepth, decomposeScanPose, displayPixelToSource, finalizeScanProject, jpegDimensions, normalizeArkitIntrinsics, normalizeArkitMatrixArray, normalizeArkitWorldTransform, normalizeCaptureDimensions, preferredScanModel, resolveScanAssetPath, rotateRgbaImage, type ScanProjectFrame } from "../../src/lib/scan-project";

test("scan project indexing pairs sparse images, depth and confidence by frame number", () => {
  const project = buildScanProjectIndex([
    "scan/info.json", "scan/frame_00002.json", "scan/frame_00002.jpg", "scan/depth_00002.png", "scan/conf_00002.png",
    "scan/frame_00010.json", "scan/depth_00010.png", "scan/conf_00010.png", "scan/textured_output.obj", "scan/textured_output.mtl",
    "scan/textured_output.jpg", "scan/export.obj", "scan/Untitled_Scan.usdz", "scan/__MACOSX/ignored.jpg",
  ], "Room scan");
  assert.ok(project);
  assert.equal(project.title, "Room scan");
  assert.equal(project.frames.length, 2);
  assert.equal(project.frames[0].photoName, "scan/frame_00002.jpg");
  assert.equal(project.frames[1].photoName, undefined);
  assert.equal(project.frames[1].depthName, "scan/depth_00010.png");
  assert.equal(project.frames[1].confidenceName, "scan/conf_00010.png");
  assert.equal(project.imageCount, 1);
  assert.equal(preferredScanModel(project), "scan/textured_output.obj");
  assert.equal(project.models.length, 3);
});

test("scan frames sort by capture time and retain the camera and projection matrices", () => {
  const project = buildScanProjectIndex(["info.json", "frame_00000.json", "frame_00001.json"]);
  assert.ok(project);
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const result = finalizeScanProject(project, [
    { index: 0, time: 5, cameraPose: identity, projection: identity },
    { index: 1, time: 3, cameraPose: identity, projection: identity },
  ]);
  assert.deepEqual(result.frames.map((frame) => frame.index), [1, 0]);
  assert.equal(result.duration, 2);
  assert.deepEqual(result.frames[0].cameraPose, identity);
  assert.deepEqual(result.frames[0].cameraPose, normalizeArkitMatrixArray(identity));
});

test("ARKit object and array matrices normalize to Three.js column-major affine transforms", () => {
  const fields = {
    m11: -.19080901, m12: 0, m13: -.98162717, m14: 0,
    m21: 0, m22: .99999994, m23: 0, m24: 0,
    m31: .98162717, m32: 0, m33: -.19080903, m34: 0,
    m41: -.7686484, m42: -.44999993, m43: -.38661367, m44: .99999994,
  };
  const world = normalizeArkitWorldTransform(fields);
  assert.ok(world);
  const matrix = new THREE.Matrix4().fromArray(world);
  assert.deepEqual([matrix.elements[3], matrix.elements[7], matrix.elements[11]], [0, 0, 0]);
  assert.ok(Math.abs(matrix.elements[15] - 1) < 1e-6);
  assert.ok(Math.abs(matrix.elements[12] + .7686484) < 1e-6);

  const rowMajor = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
  assert.deepEqual(normalizeArkitMatrixArray(rowMajor), [1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15, 4, 8, 12, 16]);
});

test("scan frame metadata preserves row-major intrinsics, capture size and image orientation", () => {
  const intrinsics = [1439.87, 0, 965.4, 0, 1439.87, 717.3, 0, 0, 1];
  assert.deepEqual(normalizeArkitIntrinsics(intrinsics), intrinsics);
  assert.deepEqual(normalizeCaptureDimensions({ captureDimensions: [1920, 1440] }), { width: 1920, height: 1440 });
  const project = buildScanProjectIndex(["info.json", "frame_00149.json"]);
  assert.ok(project);
  const result = finalizeScanProject(project, [{ index: 149, intrinsics: normalizeArkitIntrinsics(intrinsics) ?? undefined, captureWidth: 1920, captureHeight: 1440, captureOrientation: 6 }]);
  assert.deepEqual(result.frames[0].intrinsics, intrinsics);
  assert.deepEqual([result.frames[0].captureWidth, result.frames[0].captureHeight, result.frames[0].captureOrientation], [1920, 1440, 6]);

  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 5, 160, 7, 128, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0, 0xff, 0xd9]);
  assert.deepEqual(jpegDimensions(jpeg), { width: 1920, height: 1440 });
});

test("real scan camera pose stays affine and retains a unit rotation after model scaling", () => {
  const fields = {
    m11: -.19080901, m12: 0, m13: -.98162717, m14: 0,
    m21: 0, m22: .99999994, m23: 0, m24: 0,
    m31: .98162717, m32: 0, m33: -.19080903, m34: 0,
    m41: -.7686484, m42: -.44999993, m43: -.38661367, m44: .99999994,
  };
  const cameraRowMajor = [
    -.6298752427, .7032316327, .3297310769, .47271502,
    -.4912188649, -.0318400115, -.8704540133, .3344599307,
    -.601632059, -.710247576, .3654958308, -3.09952569,
    0, 0, 0, .9999995828,
  ];
  const project = buildScanProjectIndex(["scan/info.json", "scan/frame_00149.json"]);
  assert.ok(project);
  const frame = finalizeScanProject(project, [{ index: 149, cameraPose: normalizeArkitMatrixArray(cameraRowMajor) ?? undefined }]).frames[0];
  const world = normalizeArkitWorldTransform(fields);
  assert.ok(world);

  for (const scale of [1, 2]) {
    const pose = createScanPoseMatrix(frame, world, new THREE.Matrix4().makeScale(scale, scale, scale));
    assert.ok(pose);
    assert.ok([3, 7, 11].every((index) => Math.abs(pose.elements[index]) < 1e-5));
    assert.ok(Math.abs(pose.elements[15] - 1) < 1e-5);
    const decomposed = decomposeScanPose(pose);
    assert.ok(Math.abs(decomposed.rotation.length() - 1) < 1e-6);
    assert.ok(Math.abs(decomposed.position.x - 2.4262050278 * scale) < 1e-5);
  }
});

test("capture pose is transformed from AR world coordinates into the centered model", () => {
  const frame: ScanProjectFrame = {
    index: 1, time: 0, metadataName: "frame_00001.json", cameraPose: normalizeArkitMatrixArray([1, 0, 0, 11, 0, 1, 0, 2, 0, 0, 1, 3, 0, 0, 0, 1]),
    projection: null, intrinsics: null, captureWidth: null, captureHeight: null, captureOrientation: null,
  };
  const worldTransform = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1];
  const modelMatrix = new THREE.Matrix4().makeScale(2, 2, 2);
  const pose = createScanPoseMatrix(frame, worldTransform, modelMatrix);
  assert.ok(pose);
  assert.deepEqual(new THREE.Vector3().setFromMatrixPosition(pose).toArray(), [2, 4, 6]);
});

test("shared model stage centers and scales geometry without changing metric human height", () => {
  const center = new THREE.Vector3(2, 1, -3);
  const matrix = createCenteredStageMatrix(center, 2);
  assert.deepEqual(center.clone().applyMatrix4(matrix).toArray(), [0, 0, 0]);
  assert.deepEqual(new THREE.Vector3(3, 1, -3).applyMatrix4(matrix).toArray(), [2, 0, 0]);
});

test("portrait rotation preserves pixels and maps displayed depth coordinates to raw values", () => {
  const pixels = new Uint8ClampedArray(2 * 3 * 4);
  for (let index = 0; index < 6; index++) pixels[index * 4] = index + 1;
  const rotated = rotateRgbaImage(2, 3, pixels, 90);
  assert.deepEqual([rotated.width, rotated.height], [3, 2]);
  assert.deepEqual(Array.from({ length: 6 }, (_, index) => rotated.pixels[index * 4]), [5, 3, 1, 6, 4, 2]);
  const source = displayPixelToSource(0, 0, 2, 3, 90);
  assert.deepEqual(source, { x: 0, y: 2 });
  assert.equal(pixels[(source.y * 2 + source.x) * 4], 5);
});

test("follow projection converts ARKit clip depth and rotates landscape capture for portrait display", () => {
  const rowMajor = [1.5, 0, 0, 0, 0, 2, 0, 0, 0, 0, -1, -.001, 0, 0, -1, 0];
  const normalized = normalizeArkitMatrixArray(rowMajor);
  assert.ok(normalized);
  const projection = createFollowProjection(normalized, 90);
  assert.ok(Math.abs(projection.elements[10] + 1) < 1e-6);
  assert.ok(Math.abs(projection.elements[14] + .002) < 1e-6);
  assert.ok(Math.abs(projection.elements[0]) < 1e-6);
  assert.ok(Math.abs(projection.elements[1] + 1.5) < 1e-6);
  assert.equal(projection.elements[11], -1);
});

test("16-bit greyscale PNG depth retains its raw pixel values and makes a preview", () => {
  const png = encode({ width: 2, height: 2, depth: 16, channels: 1, data: new Uint16Array([0, 257, 1200, 65530]) });
  const decoded = decodeScanDepth(png);
  assert.deepEqual([...decoded.raw], [0, 257, 1200, 65530]);
  assert.equal(decoded.minimum, 257);
  assert.equal(decoded.maximum, 65530);
  assert.equal(decoded.rgba.length, 16);
  assert.equal(decoded.rgba[3], 0);
  assert.equal(decoded.rgba[7], 255);
});

test("scan asset links resolve relative names and reject ambiguous suffixes", () => {
  const names = ["scan/resources/texture.png", "scan/other/texture.png", "scan/model/data.bin"];
  assert.equal(resolveScanAssetPath("../resources/texture.png", "scan/model/model.obj", names), "scan/resources/texture.png");
  assert.equal(resolveScanAssetPath("texture.png", "scan/model/model.obj", names), undefined);
  assert.equal(resolveScanAssetPath("data.bin", "scan/model/model.obj", names), "scan/model/data.bin");
  assert.equal(resolveScanAssetPath("https://example.invalid/file.png", "scan/model/model.obj", names), undefined);
});
