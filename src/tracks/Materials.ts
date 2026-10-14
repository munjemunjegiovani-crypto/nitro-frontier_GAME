import * as THREE from 'three';
import type { TrackTheme } from './Track';
import { drawPhotoTiles, hasPhoto } from './AssetPack';

/* ------------------------------------------------------------------ */
/* Tileable noise                                                       */
/* ------------------------------------------------------------------ */

function rng(seed: number): () => number {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

/** Multi-octave tileable value noise in [0,1], w×h. */
export function noiseField(w: number, h: number, seed: number, octaves = 5, base = 4): Float32Array {
  const out = new Float32Array(w * h);
  const rand = rng(seed);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const gx = base << o, gy = Math.max(1, Math.round((base << o) * (h / w)));
    const grid = new Float32Array(gx * gy).map(() => rand());
    for (let y = 0; y < h; y++) {
      const fy = (y / h) * gy, y0 = Math.floor(fy), ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < w; x++) {
        const fx = (x / w) * gx, x0 = Math.floor(fx), tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const a = grid[(y0 % gy) * gx + (x0 % gx)], b = grid[(y0 % gy) * gx + ((x0 + 1) % gx)];
        const c = grid[((y0 + 1) % gy) * gx + (x0 % gx)], d = grid[((y0 + 1) % gy) * gx + ((x0 + 1) % gx)];
        out[y * w + x] += amp * ((a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy);
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function toCanvas(w: number, h: number, fill: (i: number, x: number, y: number) => [number, number, number]): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const [r, gg, b] = fill(i, x, y);
      img.data[i * 4] = r; img.data[i * 4 + 1] = gg; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Tangent-space normal map from a height field. */
function normalCanvas(hgt: Float32Array, w: number, h: number, strength: number): HTMLCanvasElement {
  return toCanvas(w, h, (_i, x, y) => {
    const l = hgt[y * w + ((x - 1 + w) % w)], r = hgt[y * w + ((x + 1) % w)];
    const u = hgt[((y - 1 + h) % h) * w + x], d = hgt[((y + 1) % h) * w + x];
    let nx = (l - r) * strength, ny = (u - d) * strength;
    const nz = 1;
    const len = Math.hypot(nx, ny, nz);
    nx /= len; ny /= len;
    return [(nx * 0.5 + 0.5) * 255, (ny * 0.5 + 0.5) * 255, (nz / len * 0.5 + 0.5) * 255];
  });
}


/** A seamless photo tile (1024²) as a colour or normal canvas, or null. */
function photoCanvas(name: string, kind: 'diff' | 'nor'): HTMLCanvasElement | null {
  if (!hasPhoto(name, kind)) return null;
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  drawPhotoTiles(c.getContext('2d')!, name, kind, 1024, 1024, 1024);
  return c;
}

function tex(c: HTMLCanvasElement, srgb: boolean, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const css = (c: number, a = 1) => {
  const col = new THREE.Color(c);
  return `rgba(${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)},${a})`;
};

/* ------------------------------------------------------------------ */
/* Asphalt                                                              */
/* ------------------------------------------------------------------ */

export interface TextureSet {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
}

/**
 * Racing asphalt: aggregate grain, a darker rubbered racing line, tar
 * seams, skid marks and (at night) wet patches that turn glossy.
 */
export function asphalt(theme: TrackTheme): TextureSet {
  const W = 256, H = 1024;
  const fine = noiseField(W, H, 11, 3, 64);
  const blotch = noiseField(W, H, 23, 4, 2);
  const wet = noiseField(W, H, 37, 3, 2);
  const base = new THREE.Color(theme.road);
  const color = toCanvas(W, H, (i, x) => {
    const u = x / W;
    const lane = Math.exp(-(((u - 0.38) / 0.09) ** 2)) + Math.exp(-(((u - 0.62) / 0.09) ** 2));
    let k = 0.82 + fine[i] * 0.35 + (blotch[i] - 0.5) * 0.25 - lane * 0.16;
    if (theme.night) k *= 1.7; // night asphalt is lit by street lamps and neon
    if (theme.night && wet[i] > 0.6) k *= 0.8;
    return [base.r * 255 * k, base.g * 255 * k, base.b * 255 * k];
  });
  const paint = document.createElement('canvas');
  paint.width = W; paint.height = H;
  const g = paint.getContext('2d')!;
  // Skid marks
  const r = rng(5);
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  for (let n = 0; n < 6; n++) {
    const x = 60 + r() * 136, y = r() * H, len = 80 + r() * 200, bend = (r() - 0.5) * 50;
    g.lineWidth = 5 + r() * 3;
    for (const off of [0, 22]) {
      g.beginPath();
      g.moveTo(x + off, y);
      g.quadraticCurveTo(x + off + bend, y + len / 2, x + off + bend * 0.3, y + len);
      g.stroke();
    }
  }
  // Tar seams
  g.strokeStyle = 'rgba(0,0,0,0.5)';
  g.lineWidth = 2;
  for (const y of [180, 610]) {
    g.beginPath(); g.moveTo(0, y); g.lineTo(W, y + 24); g.stroke();
  }
  // Painted lines: white edges, accent centre dashes
  g.fillStyle = 'rgba(236,240,250,0.92)';
  g.fillRect(6, 0, 7, H);
  g.fillRect(W - 13, 0, 7, H);
  g.fillStyle = css(theme.edge, 0.8);
  for (let y = 0; y < H; y += 256) g.fillRect(W / 2 - 3, y, 6, 140);

  const photoDiff = hasPhoto('asphalt', 'diff');
  let finalColor = color;
  if (photoDiff) {
    // Real asphalt scan tiled across the road, with the markings painted on top.
    const k = 4;
    finalColor = document.createElement('canvas');
    finalColor.width = W * k; finalColor.height = H * k;
    const fg = finalColor.getContext('2d')!;
    drawPhotoTiles(fg, 'asphalt', 'diff', W * k, H * k, 256);
    fg.globalAlpha = 0.35; // keep a hint of the procedural lane wear
    fg.globalCompositeOperation = 'multiply';
    fg.drawImage(color, 0, 0, W * k, H * k);
    fg.globalAlpha = 1; fg.globalCompositeOperation = 'source-over';
    fg.drawImage(paint, 0, 0, W * k, H * k);
  } else {
    color.getContext('2d')!.drawImage(paint, 0, 0);
  }
  const hgt = new Float32Array(W * H);
  for (let i = 0; i < hgt.length; i++) hgt[i] = fine[i] * 0.8 + blotch[i] * 0.2;
  let normal = normalCanvas(hgt, W, H, 3.2);
  if (hasPhoto('asphalt', 'nor')) {
    const k = 4;
    const nc = document.createElement('canvas');
    nc.width = W * k; nc.height = H * k;
    drawPhotoTiles(nc.getContext('2d')!, 'asphalt', 'nor', W * k, H * k, 256);
    normal = nc;
  }
  const roughBase = theme.night ? 0.55 : 0.78;
  const rough = toCanvas(W, H, (i) => {
    let v = roughBase + (fine[i] - 0.5) * 0.25;
    if (theme.night && wet[i] > 0.58) v = 0.16 + (0.62 - Math.min(0.62, wet[i])) * 2;
    v = Math.max(0.04, Math.min(1, v));
    return [v * 255, v * 255, v * 255];
  });
  const map = tex(finalColor, true), normalMap = tex(normal, false), roughnessMap = tex(rough, false);
  for (const t of [map, normalMap, roughnessMap]) t.wrapS = THREE.ClampToEdgeWrapping;
  return { map, normalMap, roughnessMap };
}

/* ------------------------------------------------------------------ */
/* Kerbs & barriers                                                     */
/* ------------------------------------------------------------------ */

/** Red/white rumble-strip kerb (u across, v along). */
export function kerbTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e8ecf2';
  g.fillRect(0, 0, 64, 128);
  g.fillStyle = '#d4202c';
  g.fillRect(0, 0, 64, 64);
  // painted ridges
  g.fillStyle = 'rgba(0,0,0,0.18)';
  for (let y = 0; y < 128; y += 16) g.fillRect(0, y, 64, 3);
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.fillRect(56, 0, 8, 128);
  return tex(c, true);
}

/** Concrete safety wall with a painted band and panel joints (u = height, v = along). */
export function barrierTexture(band: number): THREE.CanvasTexture {
  const W = 128, H = 512;
  const n = noiseField(W, H, 71, 4, 8);
  const c = toCanvas(W, H, (i) => {
    const k = 150 + n[i] * 70;
    return [k * 0.82, k * 0.84, k * 0.88];
  });
  const g = c.getContext('2d')!;
  // Painted band in the track colour with diagonal stripes
  g.fillStyle = css(band, 0.95);
  g.fillRect(W * 0.52, 0, W * 0.3, H);
  g.fillStyle = 'rgba(15,16,20,0.85)';
  for (let y = -64; y < H; y += 64) {
    g.beginPath();
    g.moveTo(W * 0.52, y); g.lineTo(W * 0.82, y + 32); g.lineTo(W * 0.82, y + 52); g.lineTo(W * 0.52, y + 20);
    g.closePath(); g.fill();
  }
  // Grime at the base, joints every panel
  const grad = g.createLinearGradient(0, 0, W * 0.4, 0);
  grad.addColorStop(0, 'rgba(10,8,6,0.65)');
  grad.addColorStop(1, 'rgba(10,8,6,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, W * 0.4, H);
  g.fillStyle = 'rgba(0,0,0,0.6)';
  for (let y = 0; y < H; y += 256) g.fillRect(0, y, W, 4);
  return tex(c, true);
}

/* ------------------------------------------------------------------ */
/* Buildings: world-space windows                                        */
/* ------------------------------------------------------------------ */

/** Window grid texture: each tile = 4 bays × 4 floors. */
export function facadeTexture(lit: number[], seed: number): THREE.CanvasTexture {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d')!;
  const r = rng(seed);
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  const bays = 16, floors = 24;
  const bw = S / bays, fh = S / floors;
  const whites = [0xffe3b0, 0xfff1d4, 0xd6e8ff, 0xffd08a];
  for (let f = 0; f < floors; f++) {
    // Whole floors tend to be on or off (offices), with a few stragglers.
    const floorOn = r() < 0.55;
    for (let b = 0; b < bays; b++) {
      if (r() < (floorOn ? 0.85 : 0.1)) {
        const accent = r() < 0.12;
        const col = new THREE.Color(accent ? lit[Math.floor(r() * lit.length)] : whites[Math.floor(r() * whites.length)]);
        const k = 0.45 + r() * 0.55;
        const x = b * bw + 2, y = f * fh + 2, w = bw - 4, h = fh - 5;
        const grad = g.createLinearGradient(0, y, 0, y + h);
        grad.addColorStop(0, `rgba(${col.r * 255 * k},${col.g * 255 * k},${col.b * 255 * k},1)`);
        grad.addColorStop(1, `rgba(${col.r * 255 * k * 0.55},${col.g * 255 * k * 0.55},${col.b * 255 * k * 0.55},1)`);
        g.fillStyle = grad;
        g.fillRect(x, y, w, h);
        if (r() < 0.25) { g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(x + w * 0.6, y, w * 0.4, h); } // blinds
      }
    }
  }
  return tex(c, true);
}

/**
 * Patches a MeshStandardMaterial so its emissive (window) map is sampled in
 * world space: windows keep a constant real-world size on every building,
 * vary per instance, and roofs stay dark.
 */
export function worldSpaceWindows(mat: THREE.MeshStandardMaterial, metresPerTile = 24): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTile = { value: 1 / metresPerTile };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;\nvarying float vSeed;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 sc = vec3(1.0);
        #ifdef USE_INSTANCING
          sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          vSeed = fract(sin(float(gl_InstanceID) * 12.9898) * 43758.5453);
        #else
          vSeed = 0.0;
        #endif
        // Scaled local position: windows keep real-world size and follow each facade.
        vWPos = transformed * sc;
        vWNormal = objectNormal;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTile;\nvarying vec3 vWPos;\nvarying vec3 vWNormal;\nvarying float vSeed;')
      .replace('#include <emissivemap_fragment>', `
        {
          vec3 an = abs(vWNormal);
          vec2 wuv = an.x > an.z ? vWPos.zy : vWPos.xy;
          wuv = wuv * uTile + vec2(vSeed * 7.0, vSeed * 3.0);
          vec3 win = texture2D(emissiveMap, wuv).rgb;
          float side = 1.0 - step(0.6, an.y);
          totalEmissiveRadiance *= win * side;
          // Window glass is darker and glossier than the frame.
          float glass = step(0.02, dot(win, vec3(1.0)));
          diffuseColor.rgb *= (0.85 + 0.3 * vSeed) * mix(1.0, 0.7, side * glass);
        }`);
  };
  mat.customProgramCacheKey = () => `ws-windows-${metresPerTile}`;
}

/* ------------------------------------------------------------------ */
/* Rock strata                                                          */
/* ------------------------------------------------------------------ */

/** Layered sedimentary banding on canyon rock, computed in world space. */
export function rockStrata(mat: THREE.MeshStandardMaterial): void {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRockPos;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vRockPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vRockPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRockPos;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float wob = sin(vRockPos.x * 0.07) * 1.6 + sin(vRockPos.z * 0.05) * 1.3;
        float band = sin((vRockPos.y + wob) * 0.9) * 0.5 + 0.5;
        float band2 = sin((vRockPos.y + wob) * 3.1) * 0.5 + 0.5;
        diffuseColor.rgb *= 0.72 + band * 0.22 + band2 * 0.1;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.15, 0.95, 0.8), smoothstep(0.6, 1.0, band));`);
  };
  mat.customProgramCacheKey = () => 'rock-strata';
}

/** Desert sand with ripples. */
export function sandTexture(color: number): TextureSet {
  const W = 256, H = 256;
  const n = noiseField(W, H, 91, 5, 4);
  const base = new THREE.Color(color);
  const map = tex(toCanvas(W, H, (i, x, y) => {
    const ripple = Math.sin((x * 0.18 + y * 0.05) + n[i] * 9) * 0.04;
    const k = 0.85 + n[i] * 0.3 + ripple;
    return [base.r * 255 * k, base.g * 255 * k, base.b * 255 * k];
  }), true);
  const hgt = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) hgt[y * W + x] = Math.sin(x * 0.18 + y * 0.05 + n[y * W + x] * 9) * 0.5 + n[y * W + x];
  const photoMap = photoCanvas('sand', 'diff'), photoNor = photoCanvas('sand', 'nor');
  const normalMap = tex(photoNor ?? normalCanvas(hgt, W, H, 2), false);
  const roughnessMap = tex(toCanvas(W, H, () => [240, 240, 240]), false);
  return { map: photoMap ? tex(photoMap, true) : map, normalMap, roughnessMap };
}

/** Wet city ground: dark tiles with puddles. */
export function pavementTexture(color: number): TextureSet {
  const W = 256, H = 256;
  const n = noiseField(W, H, 13, 4, 4);
  const base = new THREE.Color(color);
  const map = tex(toCanvas(W, H, (i, x, y) => {
    const joint = x % 64 < 2 || y % 64 < 2 ? 0.6 : 1;
    const k = (0.8 + n[i] * 0.4) * joint;
    return [base.r * 255 * k * 1.4, base.g * 255 * k * 1.4, base.b * 255 * k * 1.6];
  }), true);
  const photoMap = photoCanvas('pavement', 'diff'), photoNor = photoCanvas('pavement', 'nor');
  const normalMap = tex(photoNor ?? normalCanvas(n, W, H, 1.5), false);
  const roughnessMap = tex(toCanvas(W, H, (i) => {
    const v = n[i] > 0.55 ? 0.1 : 0.6;
    return [v * 255, v * 255, v * 255];
  }), false);
  return { map: photoMap ? tex(photoMap, true) : map, normalMap, roughnessMap };
}
