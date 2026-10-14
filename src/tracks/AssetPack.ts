import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

/**
 * Optional photographic assets (CC0 HDRI skies and PBR surface scans).
 * They are listed in `public/assets-pack/manifest.json`, written by
 * `npm run assets`. Everything is optional: any missing entry keeps the
 * procedural look, so the game always runs without them.
 *
 * {
 *   "hdri": { "neon-harbor": "neon-harbor.hdr" },
 *   "textures": { "asphalt": { "diff": "asphalt_diff.jpg", "nor": "asphalt_nor.jpg" } }
 * }
 */
export interface PackManifest {
  hdri?: Record<string, string>;
  textures?: Record<string, { diff?: string; nor?: string; rough?: string }>;
}

export interface HdriAsset {
  texture: THREE.DataTexture;
  /** Yaw (radians) that turns the sky's sun towards +direction `targetAzimuth`; 0 when there is no distinct sun. */
  sunAzimuth: number | null;
}

const MAX_RADIANCE = 12;
const hdris = new Map<string, HdriAsset>();
const images = new Map<string, HTMLImageElement>();

export function getHdri(trackId: string): HdriAsset | null {
  return hdris.get(trackId) ?? null;
}

export function hasPhoto(name: string, kind: 'diff' | 'nor' | 'rough'): boolean {
  return images.has(`${name}/${kind}`);
}

/** Brightest direction in an equirectangular HDR, if it is a clear sun (much brighter than the average sky). */
export function findSunAzimuth(data: ArrayLike<number>, width: number, height: number, channels = 4): number | null {
  let best = 0, bx = 0, by = 0, sum = 0, n = 0;
  const stepX = Math.max(1, Math.floor(width / 256)), stepY = Math.max(1, Math.floor(height / 128));
  for (let y = 0; y < height / 2; y += stepY) { // upper hemisphere only
    for (let x = 0; x < width; x += stepX) {
      const i = (y * width + x) * channels;
      const l = data[i] + data[i + 1] + data[i + 2];
      sum += l; n++;
      if (l > best) { best = l; bx = x; by = y; }
    }
  }
  const mean = sum / Math.max(1, n);
  if (!(best > mean * 40)) return null;
  void by;
  // Direction convention of three's equirect lookup: u = atan(z, x) / 2π + 0.5
  return (bx / width - 0.5) * Math.PI * 2;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${url}`));
    img.src = url;
  });
}

/** Loads whatever the manifest lists. Never throws. */
export async function preloadAssetPack(onProgress?: (done: number, total: number) => void): Promise<void> {
  let manifest: PackManifest;
  try {
    const res = await fetch('./assets-pack/manifest.json', { cache: 'no-cache' });
    if (!res.ok) return;
    manifest = (await res.json()) as PackManifest;
  } catch {
    return;
  }
  const jobs: (() => Promise<void>)[] = [];
  for (const [track, file] of Object.entries(manifest.hdri ?? {})) {
    jobs.push(async () => {
      const tex = await new RGBELoader().setDataType(THREE.FloatType).loadAsync(`./assets-pack/${file}`);
      tex.mapping = THREE.EquirectangularReflectionMapping;
      const img = tex.image as { data: Float32Array; width: number; height: number };
      const sunAzimuth = img?.data ? findSunAzimuth(img.data, img.width, img.height) : null;
      if (img?.data) {
        // Real HDRIs contain a sun thousands of times brighter than the sky, which would wash the whole
        // scene out in reflections and bloom. Clamp it to a strong but sane level and store as half floats.
        const half = new Uint16Array(img.data.length);
        for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(Math.min(img.data[i], MAX_RADIANCE));
        tex.image = { data: half, width: img.width, height: img.height } as unknown as typeof tex.image;
        tex.type = THREE.HalfFloatType;
        tex.needsUpdate = true;
      }
      hdris.set(track, { texture: tex, sunAzimuth });
    });
  }
  for (const [name, set] of Object.entries(manifest.textures ?? {})) {
    for (const kind of ['diff', 'nor', 'rough'] as const) {
      const file = set[kind];
      if (!file) continue;
      jobs.push(async () => { images.set(`${name}/${kind}`, await loadImage(`./assets-pack/${file}`)); });
    }
  }
  let done = 0;
  await Promise.all(jobs.map(async (job) => {
    try { await job(); } catch (err) { console.warn('[assets] skipped one asset', err); } finally { onProgress?.(++done, jobs.length); }
  }));
  if (hdris.size || images.size) console.info(`[assets] photographic pack: ${hdris.size} sky(ies), ${images.size} texture map(s)`);
}

/** Tiles a photo across a canvas; returns false when that photo is not available. */
export function drawPhotoTiles(g: CanvasRenderingContext2D, name: string, kind: 'diff' | 'nor' | 'rough', width: number, height: number, tilePx: number): boolean {
  const img = images.get(`${name}/${kind}`);
  if (!img) return false;
  for (let y = 0; y < height; y += tilePx) for (let x = 0; x < width; x += tilePx) g.drawImage(img, x, y, tilePx, tilePx);
  return true;
}
