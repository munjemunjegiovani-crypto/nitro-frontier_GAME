import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { VehicleConfig, VehicleShape } from './VehicleConfig';

/** Handles to the animated parts of a procedurally built car. */
export interface CarModel {
  root: THREE.Group;
  body: THREE.Group;
  wheels: THREE.Object3D[];
  frontWheels: THREE.Object3D[];
  brakeMaterial: THREE.MeshStandardMaterial;
  flames: THREE.Mesh[];
  flameMaterial: THREE.MeshBasicMaterial;
  underglow: THREE.Mesh;
  shield: THREE.Mesh;
  shieldMaterial: THREE.MeshBasicMaterial;
  dispose(): void;
}

/* ------------------------------------------------------------------ */
/* Shared materials (identical on every car)                           */
/* ------------------------------------------------------------------ */

const shared = {
  tire: new THREE.MeshStandardMaterial({ color: 0x18191c, roughness: 0.92, metalness: 0 }),
  glass: new THREE.MeshPhysicalMaterial({
    color: 0x05070c, metalness: 0.1, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02,
    envMapIntensity: 1.6, transparent: true, opacity: 0.9,
  }),
  carbon: new THREE.MeshStandardMaterial({ color: 0x111317, metalness: 0.5, roughness: 0.42 }),
  plastic: new THREE.MeshStandardMaterial({ color: 0x0b0c0f, metalness: 0.1, roughness: 0.7 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xc8ccd4, metalness: 1, roughness: 0.18 }),
  darkMetal: new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.9, roughness: 0.35 }),
  disc: new THREE.MeshStandardMaterial({ color: 0x55585e, metalness: 0.9, roughness: 0.45 }),
  headlight: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xeaf6ff, emissiveIntensity: 2 }),
  lens: new THREE.MeshPhysicalMaterial({ color: 0x8090a0, metalness: 0, roughness: 0.02, transmission: 0, transparent: true, opacity: 0.35, clearcoat: 1 }),
};

/* ------------------------------------------------------------------ */
/* Body surface                                                         */
/* ------------------------------------------------------------------ */

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const bump = (x: number, c: number, w: number) => Math.exp(-(((x - c) / w) ** 2));
const spow = (v: number, p: number) => Math.sign(v) * Math.abs(v) ** p;

/** Wheel stations along the body (0 = rear bumper, 1 = front bumper). */
const REAR_AXLE = 0.19;
const FRONT_AXLE = 0.79;

/**
 * Describes the lower body as a set of cross-sections along the car.
 * Each section is a super-ellipse: flat floor, rounded flanks, gently
 * domed top. Fenders swell over the wheels; the nose is a low wedge.
 */
class BodyProfile {
  readonly clearance: number;
  readonly shoulder: number;
  readonly halfWidth: number;

  constructor(readonly sh: VehicleShape) {
    this.clearance = sh.wheelRadius * 0.42;
    this.shoulder = this.clearance + sh.bodyHeight + 0.18;
    this.halfWidth = sh.width / 2;
  }

  /** Half width at station s. */
  width(s: number): number {
    const w = this.halfWidth;
    const nose = 1 - 0.2 * smooth(0.82, 1, s) - 0.06 * smooth(0.6, 0.85, s);
    const tail = 1 - 0.07 * (1 - smooth(0, 0.16, s));
    const coke = 1 - 0.045 * bump(s, 0.5, 0.13);
    const fenders = 1 + 0.035 * (bump(s, FRONT_AXLE, 0.08) + bump(s, REAR_AXLE, 0.09) * 1.3);
    return w * nose * tail * coke * fenders;
  }

  /** Height of the top surface at station s. */
  top(s: number): number {
    const taper = this.sh.noseTaper;
    const noseH = this.clearance + (this.shoulder - this.clearance) * (0.42 - taper * 0.12);
    const hood = noseH + (this.shoulder - noseH) * smooth(1, 0.62, s);
    const deck = this.shoulder * (1 - 0.04 * (1 - smooth(0, 0.3, s)));
    const front = s > 0.62 ? hood : deck;
    const fenders = 0.05 * (bump(s, FRONT_AXLE, 0.06) + bump(s, REAR_AXLE, 0.07));
    return front + fenders;
  }

  bottom(s: number): number {
    const c = this.clearance;
    // Front splitter sits a little lower; the rear diffuser kicks up.
    return c - 0.04 * smooth(0.9, 1, s) + 0.08 * (1 - smooth(0, 0.08, s));
  }

  /** Rounds off the ends so the mesh closes like a real bumper. */
  endScale(s: number): number {
    const front = Math.sqrt(Math.max(0, 1 - ((s - 0.965) / 0.035) ** 2 * (s > 0.965 ? 1 : 0)));
    const rear = Math.sqrt(Math.max(0, 1 - ((0.03 - s) / 0.03) ** 2 * (s < 0.03 ? 1 : 0)));
    return Math.min(front, rear);
  }

  /**
   * Point on the body surface. `t` runs around the section: 0 = bottom
   * centre, 0.25 = right flank, 0.5 = top centre, 0.75 = left flank.
   */
  point(s: number, t: number, out: THREE.Vector3): THREE.Vector3 {
    const e = this.endScale(s);
    const w = this.width(s) * (0.25 + 0.75 * e);
    const top = this.top(s);
    const bot = this.bottom(s);
    const mid = bot + (top - bot) * 0.42;
    const a = t * Math.PI * 2 - Math.PI / 2; // -90° at bottom
    const c = Math.cos(a), sn = Math.sin(a);
    // Car right is -x (heading = atan2(x, z)), so flip x for the right flank at t = 0.25.
    const x = -spow(c, 2 / 3.4) * w;
    const upper = sn > 0;
    const yr = upper ? (top - mid) : (mid - bot);
    const y = mid + spow(sn, upper ? 2 / 2.6 : 2 / 7) * yr * (upper ? 0.35 + 0.65 * e : 1);
    const z = (s - 0.5) * this.sh.length;
    return out.set(x, y, z);
  }
}

/** Builds an indexed grid mesh from a parametric surface (u along, v around, closed in v). */
function loft(
  uSeg: number,
  vSeg: number,
  fn: (u: number, v: number, out: THREE.Vector3) => void,
  closedV = true,
  uRange: [number, number] = [0, 1],
  vRange: [number, number] = [0, 1],
): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const p = new THREE.Vector3();
  const cols = closedV ? vSeg : vSeg + 1;
  for (let i = 0; i <= uSeg; i++) {
    const u = uRange[0] + (uRange[1] - uRange[0]) * (i / uSeg);
    for (let j = 0; j < cols; j++) {
      const v = vRange[0] + (vRange[1] - vRange[0]) * (j / vSeg);
      fn(u, v, p);
      pos.push(p.x, p.y, p.z);
      uv.push(u, v);
    }
  }
  for (let i = 0; i < uSeg; i++) {
    for (let j = 0; j < vSeg; j++) {
      const j1 = closedV ? (j + 1) % vSeg : j + 1;
      const a = i * cols + j, b = i * cols + j1, c = (i + 1) * cols + j, d = (i + 1) * cols + j1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ------------------------------------------------------------------ */
/* Livery                                                               */
/* ------------------------------------------------------------------ */

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** Paints the car's livery onto a texture laid out in body UV space (u = length, v = around). */
function liveryTexture(cfg: VehicleConfig): THREE.CanvasTexture {
  const W = 1024, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const paint = new THREE.Color(cfg.paint);
  const dark = paint.getHSL({ h: 0, s: 0, l: 0 }).l < 0.25;
  const accent = hex(cfg.accent);
  const base = hex(cfg.paint);
  const contrast = dark ? '#e9eef7' : '#0d0f14';
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);
  // v (canvas y): 0 = bottom, 0.25 = right flank, 0.5 = top, 0.75 = left flank.
  const yRight = H * 0.25, yTop = H * 0.5, yLeft = H * 0.75;
  // Darker sills
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.fillRect(0, 0, W, H * 0.16);
  g.fillRect(0, H * 0.84, W, H * 0.16);
  const sh = cfg.shape;
  // The texture spans the body length horizontally and its circumference
  // vertically; squash horizontally so roundels and lettering keep their shape.
  const circumference = 2 * sh.width + 2 * (sh.bodyHeight + 0.35);
  const aspect = (W / sh.length) / (H / circumference);
  switch (sh.livery) {
    case 'stripes':
      g.fillStyle = contrast;
      g.fillRect(0, yTop - 34, W, 18);
      g.fillRect(0, yTop + 16, W, 18);
      g.fillStyle = accent;
      g.fillRect(0, yTop - 12, W, 6);
      g.fillRect(0, yTop + 6, W, 6);
      break;
    case 'split': {
      // Two-tone: accent lower flanks with a slanted break.
      g.fillStyle = accent;
      for (const yc of [yRight, yLeft]) {
        const dir = yc < yTop ? -1 : 1;
        g.beginPath();
        g.moveTo(0, yc + dir * 6);
        g.lineTo(W, yc - dir * 30);
        g.lineTo(W, yc - dir * 40 + dir * 140);
        g.lineTo(0, yc + dir * 140);
        g.closePath();
        g.fill();
      }
      g.fillStyle = contrast;
      g.fillRect(0, yTop - 4, W, 8);
      break;
    }
    case 'arrow': {
      g.fillStyle = accent;
      for (const yc of [yRight, yLeft]) {
        g.beginPath();
        g.moveTo(W * 0.08, yc - 28);
        g.lineTo(W * 0.62, yc - 28);
        g.lineTo(W * 0.78, yc);
        g.lineTo(W * 0.62, yc + 28);
        g.lineTo(W * 0.08, yc + 28);
        g.lineTo(W * 0.2, yc);
        g.closePath();
        g.fill();
      }
      g.fillStyle = contrast;
      g.fillRect(W * 0.55, yTop - 60, W * 0.45, 120);
      g.fillStyle = accent;
      g.fillRect(W * 0.55, yTop - 8, W * 0.45, 16);
      break;
    }
    case 'band': {
      g.fillStyle = accent;
      g.fillRect(W * 0.36, 0, 90, H);
      g.fillStyle = contrast;
      g.fillRect(W * 0.36 + 96, 0, 18, H);
      g.fillStyle = 'rgba(255,255,255,0.08)';
      for (let x = 0; x < W; x += 40) g.fillRect(x, yTop - 90, 3, 180);
      break;
    }
  }
  // Pinstripe along each flank
  g.fillStyle = accent;
  g.fillRect(0, yRight - 70, W, 4);
  g.fillRect(0, yLeft + 66, W, 4);

  // Race number roundels on the doors and hood. Text must read correctly
  // from outside: the left flank is mirrored relative to the right one.
  const roundel = (cx: number, cy: number, flip: boolean, rot = 0) => {
    g.save();
    g.translate(cx, cy);
    g.rotate(rot);
    g.scale(flip ? -aspect : aspect, flip ? 1 : -1);
    g.fillStyle = '#f4f6fa';
    g.beginPath();
    g.ellipse(0, 0, 27, 27, 0, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = accent;
    g.stroke();
    g.fillStyle = '#0d0f14';
    g.font = 'italic 900 32px "Arial Black", Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(sh.raceNumber), 0, 2);
    g.restore();
  };
  roundel(W * 0.47, yRight, false);
  roundel(W * 0.47, yLeft, true);
  // Sponsor-style wordmarks (fictional)
  const word = (text: string, x: number, y: number, size: number, flip: boolean, color: string) => {
    g.save();
    g.translate(x, y);
    g.scale(flip ? -aspect : aspect, flip ? 1 : -1);
    g.font = `italic 800 ${size}px Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = color;
    g.fillText(text, 0, 0);
    g.restore();
  };
  word('NITRO', W * 0.31, yRight - 2, 16, false, contrast);
  word('NITRO', W * 0.31, yLeft + 2, 16, true, contrast);
  word('FRONTIER', W * 0.66, yRight - 30, 13, false, accent);
  word('FRONTIER', W * 0.66, yLeft + 30, 13, true, accent);
  // Panel lines (subtle)
  g.strokeStyle = 'rgba(0,0,0,0.22)';
  g.lineWidth = 1.5;
  for (const x of [W * 0.34, W * 0.6]) {
    g.beginPath(); g.moveTo(x, H * 0.12); g.lineTo(x, H * 0.4); g.stroke();
    g.beginPath(); g.moveTo(x, H * 0.6); g.lineTo(x, H * 0.88); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.flipY = false; // canvas row = v, so the layout above maps 1:1 onto the body
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/* ------------------------------------------------------------------ */
/* Wheels                                                               */
/* ------------------------------------------------------------------ */

interface WheelParts {
  tire: THREE.BufferGeometry;
  rim: THREE.BufferGeometry;
  disc: THREE.BufferGeometry;
  caliper: THREE.BufferGeometry;
  hub: THREE.BufferGeometry;
}

function wheelGeometry(radius: number, width: number, spokes: number): WheelParts {
  // Tyre: lathe a rounded profile, then turn the axis to X.
  const r = radius, hw = width / 2, rimR = r * 0.68;
  const prof: THREE.Vector2[] = [];
  prof.push(new THREE.Vector2(rimR, -hw * 0.9));
  for (let i = 0; i <= 12; i++) {
    const a = -Math.PI / 2 + (i / 12) * Math.PI;
    prof.push(new THREE.Vector2(r - 0.06 + Math.cos(a) * 0.06 + (Math.abs(Math.sin(a)) < 0.9 ? 0 : 0), Math.sin(a) * hw));
  }
  prof.push(new THREE.Vector2(rimR, hw * 0.9));
  const tire = new THREE.LatheGeometry(prof, 36);
  tire.rotateZ(Math.PI / 2);

  // Rim face: a disc with spoke cut-outs.
  const outer = new THREE.Shape();
  outer.absarc(0, 0, rimR, 0, Math.PI * 2, false);
  const inner = rimR * 0.82, hubR = rimR * 0.24;
  for (let k = 0; k < spokes; k++) {
    const a0 = (k / spokes) * Math.PI * 2;
    const gap = (Math.PI * 2) / spokes;
    const spokeHalf = Math.min(0.32, 1.1 / spokes);
    const h = new THREE.Path();
    const s0 = a0 + spokeHalf, s1 = a0 + gap - spokeHalf;
    h.moveTo(Math.cos(s0) * hubR * 1.5, Math.sin(s0) * hubR * 1.5);
    h.lineTo(Math.cos(s0 + 0.04) * inner, Math.sin(s0 + 0.04) * inner);
    h.absarc(0, 0, inner, s0 + 0.04, s1 - 0.04, false);
    h.lineTo(Math.cos(s1) * hubR * 1.5, Math.sin(s1) * hubR * 1.5);
    h.absarc(0, 0, hubR * 1.5, s1, s0, true);
    outer.holes.push(h);
  }
  const rim = new THREE.ExtrudeGeometry(outer, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.02, bevelSegments: 2, curveSegments: 24 });
  rim.rotateY(Math.PI / 2);

  const disc = new THREE.CylinderGeometry(rimR * 0.78, rimR * 0.78, 0.05, 28);
  disc.rotateZ(Math.PI / 2);
  const caliper = new THREE.BoxGeometry(0.1, rimR * 0.5, rimR * 0.32);
  const hub = new THREE.CylinderGeometry(hubR, hubR * 1.1, 0.08, 16);
  hub.rotateZ(Math.PI / 2);
  return { tire, rim, disc, caliper, hub };
}

/* ------------------------------------------------------------------ */
/* Builder                                                              */
/* ------------------------------------------------------------------ */

export function buildCarModel(cfg: VehicleConfig, opts: { lights?: boolean } = {}): CarModel {
  const sh = cfg.shape;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T): T => { disposables.push(x); return x; };

  const prof = new BodyProfile(sh);
  const L = sh.length;
  const zAt = (s: number) => (s - 0.5) * L;
  const tmp = new THREE.Vector3();

  /* ---------- Paint ---------- */
  const livery = keep(liveryTexture(cfg));
  const paint = keep(new THREE.MeshPhysicalMaterial({
    map: livery, metalness: 0.55, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.25,
  }));
  const accentMat = keep(new THREE.MeshStandardMaterial({ color: cfg.accent, metalness: 0.4, roughness: 0.35, emissive: cfg.accent, emissiveIntensity: 0.25 }));
  const accentGlow = keep(new THREE.MeshStandardMaterial({ color: cfg.accent, emissive: cfg.accent, emissiveIntensity: 2.6 }));
  const brakeMaterial = keep(new THREE.MeshStandardMaterial({ color: 0x400008, emissive: 0xff1030, emissiveIntensity: 1.4 }));

  /* ---------- Lower body ---------- */
  const bodyGeo = keep(loft(72, 48, (u, v, out) => prof.point(u, v, out)));
  const bodyMesh = new THREE.Mesh(bodyGeo, paint);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  body.add(bodyMesh);

  /* ---------- Wheel wells: dark inner arches so the tyres sit "in" the body ---------- */
  const archGeo = keep(new THREE.CylinderGeometry(sh.wheelRadius * 1.12, sh.wheelRadius * 1.12, 0.36, 24, 1, true, Math.PI * 0.5, Math.PI));
  archGeo.rotateZ(Math.PI / 2);
  const wellMat = keep(new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 1, side: THREE.DoubleSide }));
  const trackHalf = prof.halfWidth - 0.16;
  for (const sAx of [REAR_AXLE, FRONT_AXLE]) {
    for (const side of [-1, 1]) {
      const arch = new THREE.Mesh(archGeo, wellMat);
      arch.position.set(side * (trackHalf - 0.02), sh.wheelRadius, zAt(sAx));
      body.add(arch);
    }
  }

  /* ---------- Floor pan / side skirts ---------- */
  const panGeo = keep(new THREE.BoxGeometry(sh.width * 0.78, 0.12, L * 0.86));
  const pan = new THREE.Mesh(panGeo, shared.carbon);
  pan.position.set(0, prof.clearance + 0.02, 0);
  body.add(pan);

  /* ---------- Cabin (greenhouse) ---------- */
  const cabCenter = 0.5 + sh.cabinOffset * 0.5 - 0.02;
  const cabHalf = sh.cabinLength / L / 2 + 0.06;
  const c0 = Math.max(0.12, cabCenter - cabHalf), c1 = Math.min(0.86, cabCenter + cabHalf * 1.15);
  const cabinPoint = (u: number, v: number, out: THREE.Vector3) => {
    // u: along cabin 0..1, v: 0 = right sill, 0.5 = roof centre, 1 = left sill
    const s = c0 + (c1 - c0) * u;
    const base = prof.top(s) - 0.06;
    // Raked windscreen at the front, fastback slope at the rear.
    const rise = smooth(1, 0.55, u) * smooth(0, 0.42, u);
    const h = sh.cabinHeight * (0.08 + 0.92 * rise ** 0.8);
    const wBase = prof.width(s) * 0.84;
    const wTop = wBase * 0.68;
    const a = v * Math.PI; // 0..π across the roof
    const cx = Math.cos(a), cy = Math.sin(a);
    const y = base + spow(cy, 0.55) * h;
    const wAtY = wBase + (wTop - wBase) * spow(cy, 0.55);
    out.set(-spow(cx, 0.45) * wAtY, y, zAt(s));
  };
  const glassGeo = keep(loft(36, 24, cabinPoint, false));
  const glass = new THREE.Mesh(glassGeo, shared.glass);
  glass.castShadow = true;
  body.add(glass);
  // Painted roof panel and A/C pillars layered just outside the glass.
  const roofGeo = keep(loft(24, 12, (u, v, out) => {
    cabinPoint(u, v, out);
    out.y += 0.012;
    out.x *= 1.012;
  }, false, [0.3, 0.86], [0.22, 0.78]));
  const roof = new THREE.Mesh(roofGeo, paint);
  roof.castShadow = true;
  body.add(roof);
  for (const v of [0.13, 0.87]) {
    const pillarGeo = keep(loft(30, 2, (u, vv, out) => {
      cabinPoint(u, v + (vv - 0.5) * 0.07, out);
      out.x *= 1.015;
      out.y += 0.006;
    }, false, [0.04, 0.9], [0, 1]));
    body.add(new THREE.Mesh(pillarGeo, shared.carbon));
  }

  /* ---------- Front: grille, splitter, headlights ---------- */
  const frontZ = zAt(1);
  const grilleGeo = keep(new THREE.BoxGeometry(sh.width * 0.55, 0.16, 0.08));
  const grille = new THREE.Mesh(grilleGeo, shared.plastic);
  grille.position.set(0, prof.clearance + 0.14, frontZ - 0.1);
  body.add(grille);
  const splitGeo = keep(new THREE.BoxGeometry(sh.width * 0.9, 0.04, 0.35));
  const splitter = new THREE.Mesh(splitGeo, shared.carbon);
  splitter.position.set(0, prof.clearance - 0.02, frontZ - 0.2);
  body.add(splitter);

  // Headlights sit on the body surface at the front corners.
  const hlGeo = keep(new THREE.BoxGeometry(0.42, 0.07, 0.3));
  const drlGeo = keep(new THREE.BoxGeometry(0.46, 0.025, 0.04));
  for (const side of [-1, 1]) {
    const s = 0.93;
    const t = side < 0 ? 0.36 : 0.64; // upper front corners
    prof.point(s, t, tmp);
    const yaw = side * 0.22;
    const hl = new THREE.Mesh(hlGeo, shared.headlight);
    hl.position.set(tmp.x * 0.98, tmp.y + 0.005, tmp.z + 0.06);
    hl.rotation.set(-0.35, yaw, 0);
    body.add(hl);
    const lens = new THREE.Mesh(hlGeo, shared.lens);
    lens.position.copy(hl.position).add(new THREE.Vector3(0, 0.02, 0));
    lens.rotation.copy(hl.rotation);
    lens.scale.set(1.08, 1.6, 1.05);
    body.add(lens);
    const drl = new THREE.Mesh(drlGeo, accentGlow);
    drl.position.set(tmp.x * 0.98, tmp.y - 0.05, tmp.z + 0.12);
    drl.rotation.set(-0.35, yaw, 0);
    body.add(drl);
  }

  /* ---------- Rear: light bar, diffuser, exhausts ---------- */
  const rearZ = zAt(0);
  prof.point(0.02, 0.5, tmp);
  const tailY = prof.top(0.02) - 0.1;
  const barGeo = keep(new THREE.BoxGeometry(sh.width * 0.82, 0.05, 0.05));
  const bar = new THREE.Mesh(barGeo, brakeMaterial);
  bar.position.set(0, tailY, rearZ + 0.05);
  body.add(bar);
  const clusterGeo = keep(new THREE.BoxGeometry(0.34, 0.12, 0.06));
  for (const side of [-1, 1]) {
    const cl = new THREE.Mesh(clusterGeo, brakeMaterial);
    cl.position.set(side * sh.width * 0.36, tailY - 0.03, rearZ + 0.08);
    body.add(cl);
  }
  const diffGeo = keep(new THREE.BoxGeometry(sh.width * 0.7, 0.16, 0.3));
  const diff = new THREE.Mesh(diffGeo, shared.carbon);
  diff.position.set(0, prof.clearance + 0.06, rearZ + 0.2);
  body.add(diff);
  const finGeo = keep(new THREE.BoxGeometry(0.03, 0.18, 0.32));
  for (let k = -2; k <= 2; k++) {
    const f = new THREE.Mesh(finGeo, shared.carbon);
    f.position.set(k * sh.width * 0.12, prof.clearance + 0.05, rearZ + 0.18);
    body.add(f);
  }
  const exGeo = keep(new THREE.CylinderGeometry(0.07, 0.08, 0.3, 14, 1, true));
  exGeo.rotateX(Math.PI / 2);
  const exhaustY = prof.clearance + 0.16;
  for (const side of [-1, 1]) {
    const ex = new THREE.Mesh(exGeo, shared.chrome);
    ex.position.set(side * sh.width * 0.22, exhaustY, rearZ + 0.1);
    body.add(ex);
  }

  /* ---------- Mirrors ---------- */
  const mirrorGeo = keep(new THREE.BoxGeometry(0.16, 0.08, 0.1));
  for (const side of [-1, 1]) {
    const s = c0 + (c1 - c0) * 0.82;
    const m = new THREE.Mesh(mirrorGeo, paint);
    m.position.set(side * (prof.width(s) * 0.84 + 0.04), prof.top(s) + 0.03, zAt(s));
    m.castShadow = true;
    body.add(m);
  }

  /* ---------- Spoiler ---------- */
  if (sh.spoiler !== 'none') {
    const chord = sh.spoiler === 'lip' ? 0.22 : 0.42;
    const foil = new THREE.Shape();
    foil.moveTo(0, 0);
    foil.quadraticCurveTo(chord * 0.35, 0.07, chord, 0.015);
    foil.lineTo(chord, -0.005);
    foil.quadraticCurveTo(chord * 0.4, 0.015, 0, -0.012);
    const span = sh.width * (sh.spoiler === 'lip' ? 0.86 : 1.02);
    const wingGeo = keep(new THREE.ExtrudeGeometry(foil, { depth: span, bevelEnabled: false, curveSegments: 8 }));
    wingGeo.translate(0, 0, -span / 2);
    wingGeo.rotateY(Math.PI / 2); // span along x, chord along z (leading edge at +z)
    const rearTop = prof.top(0.06);
    const wingY = sh.spoiler === 'lip' ? rearTop + 0.02 : rearTop + 0.3;
    const wingMat = sh.spoiler === 'twin' ? accentMat : shared.carbon;
    const wing = new THREE.Mesh(wingGeo, wingMat);
    wing.position.set(0, wingY, rearZ + 0.32);
    wing.rotation.x = -0.1;
    wing.castShadow = true;
    body.add(wing);
    if (sh.spoiler !== 'lip') {
      const plateGeo = keep(new THREE.BoxGeometry(0.03, 0.2, chord + 0.08));
      const strutGeo = keep(new THREE.BoxGeometry(0.05, wingY - rearTop + 0.04, 0.1));
      for (const side of [-1, 1]) {
        const plate = new THREE.Mesh(plateGeo, shared.carbon);
        plate.position.set(side * span / 2, wingY, rearZ + 0.32 - chord / 2);
        body.add(plate);
        const strut = new THREE.Mesh(strutGeo, shared.darkMetal);
        strut.position.set(side * span * 0.28, (wingY + rearTop) / 2, rearZ + 0.28);
        body.add(strut);
      }
      if (sh.spoiler === 'twin') {
        const w2 = new THREE.Mesh(wingGeo, shared.carbon);
        w2.position.set(0, wingY + 0.11, rearZ + 0.18);
        w2.scale.set(1, 1, 0.7);
        w2.rotation.x = -0.18;
        body.add(w2);
      }
    }
  }

  /* ---------- Fins / hood vents ---------- */
  if (sh.fins) {
    const ventGeo = keep(new THREE.BoxGeometry(0.06, 0.05, 0.55));
    for (const x of [-0.18, -0.06, 0.06, 0.18]) {
      const s = 0.74;
      const v = new THREE.Mesh(ventGeo, shared.carbon);
      v.position.set(x * sh.width, prof.top(s) + 0.012, zAt(s));
      v.rotation.x = -0.12;
      body.add(v);
    }
    // Shark fin on the engine cover
    const finShape = new THREE.Shape();
    finShape.moveTo(0, 0); finShape.lineTo(-0.9, 0); finShape.quadraticCurveTo(-0.5, 0.05, 0, 0.18); finShape.lineTo(0, 0);
    const sharkGeo = keep(new THREE.ExtrudeGeometry(finShape, { depth: 0.03, bevelEnabled: false }));
    sharkGeo.rotateY(-Math.PI / 2);
    const shark = new THREE.Mesh(sharkGeo, accentMat);
    const s = c0 - 0.01;
    shark.position.set(0.015, prof.top(s) - 0.02, zAt(s));
    body.add(shark);
  }

  /* ---------- Night headlight beams ---------- */
  if (opts.lights) {
    const spot = new THREE.SpotLight(0xdff4ff, 60, 70, 0.45, 0.55, 1.3);
    spot.position.set(0, prof.clearance + 0.5, frontZ);
    spot.target.position.set(0, 0, frontZ + 22);
    body.add(spot, spot.target);
  }

  /* ---------- Wheels ---------- */
  const wp = wheelGeometry(sh.wheelRadius, 0.34 + sh.width * 0.04, sh.spokes);
  Object.values(wp).forEach((g) => keep(g));
  const rimMat = keep(new THREE.MeshStandardMaterial({
    color: cfg.id === 'kestrel' || cfg.id === 'titan' ? 0x2a2d33 : 0xb8bcc4, metalness: 1, roughness: 0.22,
  }));
  const caliperMat = keep(new THREE.MeshStandardMaterial({ color: cfg.accent, metalness: 0.3, roughness: 0.4, emissive: cfg.accent, emissiveIntensity: 0.3 }));
  const wheels: THREE.Object3D[] = [];
  const frontWheels: THREE.Object3D[] = [];
  for (const sAx of [REAR_AXLE, FRONT_AXLE]) {
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * trackHalf, sh.wheelRadius, zAt(sAx));
      const spinner = new THREE.Group();
      const tire = new THREE.Mesh(wp.tire, shared.tire);
      tire.castShadow = true;
      const rim = new THREE.Mesh(wp.rim, rimMat);
      rim.position.x = side * 0.1;
      if (side < 0) rim.rotation.y = Math.PI; // face outward on both sides
      const disc = new THREE.Mesh(wp.disc, shared.disc);
      disc.position.x = -side * 0.02;
      const hub = new THREE.Mesh(wp.hub, shared.chrome);
      hub.position.x = side * 0.14;
      spinner.add(tire, rim, disc, hub);
      // Caliper is fixed to the upright, not the spinning wheel.
      const cal = new THREE.Mesh(wp.caliper, caliperMat);
      cal.position.set(side * 0.03, sh.wheelRadius * 0.38, sAx > 0.5 ? -0.12 : 0.12);
      pivot.add(spinner, cal);
      root.add(pivot);
      wheels.push(spinner);
      if (sAx > 0.5) frontWheels.push(pivot);
    }
  }

  /* ---------- Underglow ---------- */
  const glowGeo = keep(new THREE.PlaneGeometry(sh.width * 1.3, L * 1.05));
  glowGeo.rotateX(-Math.PI / 2);
  const glowMat = keep(new THREE.MeshBasicMaterial({ color: cfg.accent, map: keep(softGlowTexture()), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
  const underglow = new THREE.Mesh(glowGeo, glowMat);
  underglow.position.y = 0.05;
  root.add(underglow);
  // Soft contact shadow so the car always looks grounded, even without shadow maps.
  const aoGeo = keep(new THREE.PlaneGeometry(sh.width * 1.25, L * 1.12));
  aoGeo.rotateX(-Math.PI / 2);
  const aoMat = keep(new THREE.MeshBasicMaterial({ map: keep(contactShadowTexture()), transparent: true, depthWrite: false, opacity: 0.85 }));
  const ao = new THREE.Mesh(aoGeo, aoMat);
  ao.position.y = 0.04;
  ao.renderOrder = 1;
  root.add(ao);

  /* ---------- Exhaust flames ---------- */
  const flameGeo = keep(new THREE.ConeGeometry(0.1, 0.75, 12, 1, true));
  flameGeo.rotateX(-Math.PI / 2);
  flameGeo.translate(0, 0, -0.37);
  const flameMaterial = keep(new THREE.MeshBasicMaterial({ color: 0x54e8ff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
  const flames: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const f = new THREE.Mesh(flameGeo, flameMaterial);
    f.position.set(side * sh.width * 0.22, exhaustY, rearZ - 0.05);
    f.visible = false;
    body.add(f);
    flames.push(f);
  }

  /* ---------- Phase shield bubble ---------- */
  const shieldGeo = keep(new THREE.SphereGeometry(1, 28, 18));
  const shieldMaterial = keep(new THREE.MeshBasicMaterial({ color: 0x7cf7ff, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }));
  const shield = new THREE.Mesh(shieldGeo, shieldMaterial);
  shield.scale.set(sh.width * 0.85, prof.shoulder + sh.cabinHeight + 0.4, L * 0.62);
  shield.position.y = 0.7;
  shield.visible = false;
  root.add(shield);

  mergeStatic(body, new Set<THREE.Object3D>(flames), keep);

  return {
    root, body, wheels, frontWheels, brakeMaterial, flames, flameMaterial, underglow, shield, shieldMaterial,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

/** Radial dark blob used as a fake ambient-occlusion contact shadow. */
function contactShadowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 64, 4, 32, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,0.9)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.55)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 128);
  return new THREE.CanvasTexture(c);
}

/** Soft-edged radial gradient for the neon underglow pool. */
function softGlowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 64, 2, 32, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 128);
  return new THREE.CanvasTexture(c);
}

/**
 * Merges every static mesh in `group` that shares a material into a single
 * mesh. A car drops from ~50 draw calls to ~15 without changing its look.
 */
function mergeStatic(group: THREE.Group, skip: Set<THREE.Object3D>, keep: <T extends { dispose(): void }>(x: T) => T): void {
  const buckets = new Map<THREE.Material, THREE.Mesh[]>();
  for (const child of [...group.children]) {
    if (skip.has(child) || !(child instanceof THREE.Mesh) || Array.isArray(child.material)) continue;
    const list = buckets.get(child.material) ?? [];
    list.push(child);
    buckets.set(child.material, list);
  }
  for (const [mat, meshes] of buckets) {
    if (meshes.length < 2) continue;
    const geos = meshes.map((m) => {
      m.updateMatrix();
      let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((g.attributes.position.count) * 2), 2));
      g = g.applyMatrix4(m.matrix);
      return g;
    });
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    keep(merged);
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = meshes.some((m) => m.castShadow);
    mesh.receiveShadow = meshes.some((m) => m.receiveShadow);
    for (const m of meshes) group.remove(m);
    group.add(mesh);
  }
}
