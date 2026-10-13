import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { VehicleShape } from './VehicleConfig';

/**
 * Optional imported car bodies (GLB files, e.g. generated with an
 * image-to-3D tool). They are listed in `public/models/manifest.json`:
 *
 * {
 *   "cars": {
 *     "vortex": { "file": "vortex.glb", "flip": false, "yawDegrees": 0, "hideWheels": true }
 *   }
 * }
 *
 * Any car without an entry keeps its procedural body, so the game always
 * runs even with no models present.
 */
export interface CarAssetEntry {
  file: string;
  /** Turn the model 180° if it ends up facing backwards. */
  flip?: boolean;
  /** Extra rotation around the vertical axis, applied after auto-alignment. */
  yawDegrees?: number;
  /** Hide the procedural wheels when the model already has its own. */
  hideWheels?: boolean;
  /** Disable automatic alignment of the longest axis with the driving direction. */
  autoAlign?: boolean;
  /** Length multiplier relative to the car's physical length (default 1). */
  scale?: number;
  /** Paint tint multiplied over the model's own textures (hex string, e.g. "#ffffff"). */
  tint?: string;
}

interface Manifest {
  cars?: Record<string, CarAssetEntry>;
}

const loaded = new Map<string, { scene: THREE.Group; entry: CarAssetEntry }>();

export function hasCarAsset(id: string): boolean {
  return loaded.has(id);
}

/** Loads every model listed in the manifest. Never throws: failures fall back to procedural cars. */
export async function preloadCarModels(onProgress?: (done: number, total: number) => void): Promise<string[]> {
  let manifest: Manifest;
  try {
    const res = await fetch('./models/manifest.json', { cache: 'no-cache' });
    if (!res.ok) return [];
    manifest = (await res.json()) as Manifest;
  } catch {
    return [];
  }
  const entries = Object.entries(manifest.cars ?? {}).filter(([, e]) => e && typeof e.file === 'string');
  const loader = new GLTFLoader();
  let done = 0;
  const ok: string[] = [];
  await Promise.all(entries.map(async ([id, entry]) => {
    try {
      const gltf = await loader.loadAsync(`./models/${entry.file}`);
      loaded.set(id, { scene: gltf.scene, entry });
      ok.push(id);
    } catch (err) {
      console.warn(`[models] could not load ${entry.file}; using the procedural ${id}`, err);
    } finally {
      onProgress?.(++done, entries.length);
    }
  }));
  return ok;
}

/** Collects every vertex of a scene in its own root space. */
function collectPoints(root: THREE.Object3D): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const v = new THREE.Vector3();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const pos = mesh.geometry.attributes.position as THREE.BufferAttribute | undefined;
    if (!pos) return;
    const m = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
    const step = Math.max(1, Math.floor(pos.count / 4000));
    for (let i = 0; i < pos.count; i += step) pts.push(v.fromBufferAttribute(pos, i).applyMatrix4(m).clone());
  });
  return pts;
}

/**
 * Direction of the longest horizontal axis (principal component of the
 * vertices on the ground plane), as a yaw angle.
 */
export function principalYaw(points: { x: number; z: number }[]): number {
  let mx = 0, mz = 0;
  for (const p of points) { mx += p.x; mz += p.z; }
  mx /= points.length || 1; mz /= points.length || 1;
  let sxx = 0, szz = 0, sxz = 0;
  for (const p of points) {
    const dx = p.x - mx, dz = p.z - mz;
    sxx += dx * dx; szz += dz * dz; sxz += dx * dz;
  }
  // Angle of the major eigenvector measured from +x, then convert to yaw from +z.
  const theta = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  return Math.PI / 2 - theta;
}

/**
 * Returns a ready-to-use copy of an imported car, rotated so it drives along
 * +z, scaled to the car's physical length and resting on y = 0.
 */
export function instantiateCarAsset(id: string, shape: VehicleShape): { object: THREE.Group; entry: CarAssetEntry } | null {
  const asset = loaded.get(id);
  if (!asset) return null;
  const { entry } = asset;
  const model = asset.scene.clone(true);
  // Give clones their own materials so tints/env settings don't leak between cars.
  const tint = entry.tint ? new THREE.Color(entry.tint) : null;
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((m) => {
      const c = m.clone() as THREE.MeshStandardMaterial;
      if ('envMapIntensity' in c) c.envMapIntensity = 1.2;
      // Generated models often come out fully rough; give the paint some gloss.
      if ('roughness' in c && c.roughness > 0.6 && !c.roughnessMap) c.roughness = 0.45;
      if (tint && c.color) c.color.multiply(tint);
      return c;
    });
    mesh.material = Array.isArray(mesh.material) ? mats : mats[0];
  });

  const pivot = new THREE.Group();
  pivot.add(model);
  if (entry.autoAlign !== false) {
    const yaw = principalYaw(collectPoints(model));
    model.rotation.y = -yaw;
  }
  model.rotation.y += (entry.flip ? Math.PI : 0) + THREE.MathUtils.degToRad(entry.yawDegrees ?? 0);
  model.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const length = Math.max(size.z, 1e-3);
  const s = (shape.length * (entry.scale ?? 1)) / length;
  model.scale.multiplyScalar(s);
  model.updateMatrixWorld(true);
  box.setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= box.min.y;
  return { object: pivot, entry };
}
