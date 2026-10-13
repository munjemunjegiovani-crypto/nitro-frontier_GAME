import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Track } from './Track';

type Keep = <T extends { dispose(): void }>(x: T) => T;

/** Where a prop can safely stand: the road must be close to the ground plane. */
function nearGround(y: number, groundY: number, tol = 1.6): boolean {
  return Math.abs(y - groundY) < tol;
}

function colorize(geo: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(color);
  const arr = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < arr.length; i += 3) { arr[i] = c.r; arr[i + 1] = c.g; arr[i + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
}

/** Lumpy foliage blob. */
function blob(radius: number, seed: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(radius, 1);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i);
    const k = 0.82 + 0.28 * Math.abs(Math.sin(v.x * 3.1 + v.y * 2.3 + v.z * 3.7 + seed));
    p.setXYZ(i, v.x * k, v.y * k * 0.9, v.z * k);
  }
  g.computeVertexNormals();
  return g;
}

/* ------------------------------------------------------------------ */
/* Roadside trees (city)                                               */
/* ------------------------------------------------------------------ */

export function buildStreetTrees(track: Track, group: THREE.Group, keep: Keep, rand: () => number, groundY: number, detail: number): void {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.16, 0.26, 3.4, 6);
  trunk.translate(0, 1.7, 0);
  parts.push(colorize(trunk, 0x3b2a1e));
  const crowns: [number, number, number, number, number][] = [
    [0, 4.6, 0, 1.9, 0x2f6b3a], [0.9, 3.9, 0.3, 1.3, 0x2a5e34], [-0.8, 4.0, -0.4, 1.4, 0x357a42], [0.1, 5.7, 0.2, 1.2, 0x3d8a4a],
  ];
  crowns.forEach(([x, y, z, r, col], i) => {
    const b = blob(r, i * 1.7);
    b.translate(x, y, z);
    parts.push(colorize(b, col));
  });
  const geo = keep(mergeGeometries(parts, false)!);
  const mat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }));
  const spots: { pos: THREE.Vector3; s: number }[] = [];
  for (let i = 4; i < track.count; i += 6) {
    const s = track.sample(i);
    if (s.covered || !nearGround(s.pos.y, groundY)) continue;
    for (const side of [-1, 1]) {
      if (rand() < 0.35) continue;
      const off = s.halfWidth + 6.5 + rand() * 2.5;
      const p = s.pos.clone().addScaledVector(s.right, side * off);
      if (track.distanceFromRoad(p.x, p.z, 4) < s.halfWidth + 4) continue;
      p.y = groundY;
      spots.push({ pos: p, s: 0.85 + rand() * 0.6 });
    }
  }
  const count = Math.floor(spots.length * Math.min(1, detail + 0.2));
  if (!count) return;
  const inst = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (let k = 0; k < count; k++) {
    const sp = spots[k];
    q.setFromAxisAngle(up, rand() * 6.28);
    m.compose(sp.pos, q, new THREE.Vector3(sp.s, sp.s * (0.9 + rand() * 0.3), sp.s));
    inst.setMatrixAt(k, m);
  }
  inst.castShadow = true;
  inst.receiveShadow = true;
  group.add(inst);

  // Ground-level planters / bollards give the kerb line some life.
  const bollard = keep(new THREE.CylinderGeometry(0.18, 0.18, 0.9, 8));
  bollard.translate(0, 0.45, 0);
  const bollMat = keep(new THREE.MeshStandardMaterial({ color: 0x2c3140, roughness: 0.5, metalness: 0.6, emissive: 0x20e3ff, emissiveIntensity: 0.25 }));
  const idx: number[] = [];
  for (let i = 0; i < track.count; i += 3) {
    const s = track.sample(i);
    if (!s.covered && nearGround(s.pos.y, groundY, 3)) idx.push(i);
  }
  const bol = new THREE.InstancedMesh(bollard, bollMat, idx.length * 2);
  idx.forEach((i, k) => {
    const s = track.sample(i);
    [-1, 1].forEach((side, j) => {
      const p = s.pos.clone().addScaledVector(s.right, side * (s.halfWidth + 3.4));
      m.makeTranslation(p.x, s.pos.y, p.z);
      bol.setMatrixAt(k * 2 + j, m);
    });
  });
  group.add(bol);
}

/* ------------------------------------------------------------------ */
/* Volumetric-looking lamp light (shafts + glow)                       */
/* ------------------------------------------------------------------ */

export interface Lamp { pos: THREE.Vector3; dir: THREE.Vector3 }

export function buildLampLight(group: THREE.Group, keep: Keep, lamps: Lamp[], color: number, strength: number): void {
  if (!lamps.length) return;
  // Soft cone: bright at the lamp, fades towards the road and at the silhouette edges.
  const coneGeo = keep(new THREE.ConeGeometry(4.6, 9.5, 20, 1, true));
  coneGeo.translate(0, -4.75, 0); // apex at origin, opens downwards
  const mat = keep(new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(color) }, uStrength: { value: strength } },
    vertexShader: `
      varying float vH; varying vec3 vN; varying vec3 vV;
      void main() {
        vH = clamp(-position.y / 9.5, 0.0, 1.0);
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uStrength;
      varying float vH; varying vec3 vN; varying vec3 vV;
      void main() {
        float facing = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
        float a = (1.0 - vH) * (1.0 - vH) * facing * uStrength;
        gl_FragColor = vec4(uColor * a, a);
      }`,
  }));
  const cones = new THREE.InstancedMesh(coneGeo, mat, lamps.length);
  const m = new THREE.Matrix4();
  lamps.forEach((l, k) => {
    m.makeTranslation(l.pos.x, l.pos.y, l.pos.z);
    cones.setMatrixAt(k, m);
  });
  cones.frustumCulled = false;
  cones.renderOrder = 5;
  group.add(cones);

  // Glow halo
  const [c, g] = (() => { const cv = document.createElement('canvas'); cv.width = cv.height = 64; return [cv, cv.getContext('2d')!] as const; })();
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = keep(new THREE.CanvasTexture(c));
  const pos = new Float32Array(lamps.length * 3);
  lamps.forEach((l, k) => { pos[k * 3] = l.pos.x; pos[k * 3 + 1] = l.pos.y; pos[k * 3 + 2] = l.pos.z; });
  const geo = keep(new THREE.BufferGeometry());
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, keep(new THREE.PointsMaterial({
    map: tex, color, size: 5.5, sizeAttenuation: true, transparent: true, opacity: 0.7,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  })));
  pts.frustumCulled = false;
  group.add(pts);
}

/* ------------------------------------------------------------------ */
/* Building detail                                                     */
/* ------------------------------------------------------------------ */

export interface Roof { x: number; y: number; z: number; w: number; d: number; rot: number }

/** Air-conditioning units, water tanks and parapets so roofs aren't flat lids. */
export function buildRoofClutter(group: THREE.Group, keep: Keep, rand: () => number, roofs: Roof[]): void {
  if (!roofs.length) return;
  const box = keep(new THREE.BoxGeometry(1, 1, 1));
  box.translate(0, 0.5, 0);
  const unitMat = keep(new THREE.MeshStandardMaterial({ color: 0x5a6070, roughness: 0.6, metalness: 0.5 }));
  const parapetMat = keep(new THREE.MeshStandardMaterial({ color: 0x232833, roughness: 0.7, metalness: 0.3 }));
  const tankGeo = keep(new THREE.CylinderGeometry(1.6, 1.6, 3.2, 12));
  tankGeo.translate(0, 1.6, 0);
  const tankMat = keep(new THREE.MeshStandardMaterial({ color: 0x6a5648, roughness: 0.8 }));
  const units: THREE.Matrix4[] = [];
  const parapets: THREE.Matrix4[] = [];
  const tanks: THREE.Matrix4[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  const off = new THREE.Vector3();
  for (const r of roofs) {
    q.setFromAxisAngle(up, r.rot);
    // Parapet: four thin walls
    const t = 0.8, h = 1.2;
    for (const [ox, oz, sx, sz] of [
      [0, r.d / 2 - t / 2, r.w, t], [0, -r.d / 2 + t / 2, r.w, t],
      [r.w / 2 - t / 2, 0, t, r.d], [-r.w / 2 + t / 2, 0, t, r.d],
    ] as const) {
      off.set(ox, 0, oz).applyQuaternion(q);
      parapets.push(new THREE.Matrix4().compose(new THREE.Vector3(r.x + off.x, r.y, r.z + off.z), q, new THREE.Vector3(sx, h, sz)));
    }
    const n = 1 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      off.set((rand() - 0.5) * r.w * 0.6, 0, (rand() - 0.5) * r.d * 0.6).applyQuaternion(q);
      const p = new THREE.Vector3(r.x + off.x, r.y, r.z + off.z);
      if (rand() < 0.25) tanks.push(new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1)));
      else units.push(new THREE.Matrix4().compose(p, q, new THREE.Vector3(2 + rand() * 3, 1.2 + rand() * 1.6, 2 + rand() * 3)));
    }
  }
  const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, list: THREE.Matrix4[], shadow = false): void => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((mm, i) => im.setMatrixAt(i, mm));
    im.castShadow = shadow;
    group.add(im);
  };
  mk(box, unitMat, units);
  mk(box, parapetMat, parapets);
  mk(tankGeo, tankMat, tanks);
}

/** Vertical neon trim running up the corner of selected towers. */
export function buildNeonTrim(group: THREE.Group, keep: Keep, rand: () => number, towers: { x: number; z: number; w: number; d: number; h: number; rot: number; y: number }[], colors: number[]): void {
  const sel = towers.filter((t) => t.h > 55 && rand() < 0.45);
  if (!sel.length) return;
  const geo = keep(new THREE.BoxGeometry(0.5, 1, 0.5));
  geo.translate(0, 0.5, 0);
  const up = new THREE.Vector3(0, 1, 0);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const off = new THREE.Vector3();
  colors.forEach((col, ci) => {
    const list = sel.filter((_, i) => i % colors.length === ci);
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, keep(new THREE.MeshBasicMaterial({ color: col })), list.length * 2);
    list.forEach((t, k) => {
      q.setFromAxisAngle(up, t.rot);
      [1, -1].forEach((s, j) => {
        off.set((t.w / 2 + 0.15) * s, 0, (t.d / 2 + 0.15) * s).applyQuaternion(q);
        m.compose(new THREE.Vector3(t.x + off.x, t.y, t.z + off.z), q, new THREE.Vector3(1, t.h, 1));
        im.setMatrixAt(k * 2 + j, m);
      });
    });
    group.add(im);
  });
}

/* ------------------------------------------------------------------ */
/* Desert vegetation and debris (canyon)                               */
/* ------------------------------------------------------------------ */

export function buildDesertLife(track: Track, group: THREE.Group, keep: Keep, rand: () => number, groundY: number, detail: number, scatter: (n: number, minD: number, maxD: number) => THREE.Vector3[]): void {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);

  // Saguaro cactus: trunk + two upturned arms, merged into one mesh.
  const parts: THREE.BufferGeometry[] = [];
  const green = 0x4d7a3c;
  const trunk = new THREE.CapsuleGeometry(0.42, 4.6, 4, 10);
  trunk.translate(0, 2.7, 0);
  parts.push(colorize(trunk, green));
  for (const [side, y, len] of [[1, 2.6, 1.5], [-1, 3.4, 1.1]] as const) {
    const out = new THREE.CapsuleGeometry(0.26, 0.9, 3, 8);
    out.rotateZ(Math.PI / 2);
    out.translate(side * 0.95, y, 0);
    parts.push(colorize(out, green));
    const upArm = new THREE.CapsuleGeometry(0.26, len, 3, 8);
    upArm.translate(side * 1.4, y + len / 2 + 0.3, 0);
    parts.push(colorize(upArm, green));
  }
  const cactusGeo = keep(mergeGeometries(parts, false)!);
  const cactusMat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
  const cSpots = scatter(Math.floor(90 * detail), 9, 90);
  const cactus = new THREE.InstancedMesh(cactusGeo, cactusMat, cSpots.length);
  cSpots.forEach((s, k) => {
    const sc = 1.3 + rand() * 1.5;
    q.setFromAxisAngle(up, rand() * 6.28);
    m.compose(new THREE.Vector3(s.x, groundY - 0.1, s.z), q, new THREE.Vector3(sc, sc * (0.8 + rand() * 0.5), sc));
    cactus.setMatrixAt(k, m);
  });
  cactus.castShadow = true;
  group.add(cactus);

  // Dry shrubs / tumbleweed clumps
  const shrubGeo = keep(blob(1, 3.3));
  const shrubMat = keep(new THREE.MeshStandardMaterial({ color: 0x8a7a45, roughness: 1, flatShading: true }));
  const shSpots = scatter(Math.floor(240 * detail), 5, 70);
  const shrubs = new THREE.InstancedMesh(shrubGeo, shrubMat, shSpots.length);
  shSpots.forEach((s, k) => {
    const sc = 0.5 + rand() * 1.1;
    q.setFromAxisAngle(up, rand() * 6.28);
    m.compose(new THREE.Vector3(s.x, groundY + sc * 0.25, s.z), q, new THREE.Vector3(sc * 1.3, sc * 0.8, sc * 1.3));
    shrubs.setMatrixAt(k, m);
  });
  group.add(shrubs);

  // Gravel and small rocks along the shoulders
  const pebbleGeo = keep(blob(1, 7.9));
  const pebbleMat = keep(new THREE.MeshStandardMaterial({ color: 0x7a5a45, roughness: 1, flatShading: true }));
  const pSpots = scatter(Math.floor(420 * detail), 3, 40);
  const pebbles = new THREE.InstancedMesh(pebbleGeo, pebbleMat, pSpots.length);
  pSpots.forEach((s, k) => {
    const sc = 0.2 + rand() * 0.7;
    q.setFromEuler(new THREE.Euler(rand() * 3, rand() * 6, rand() * 3));
    m.compose(new THREE.Vector3(s.x, groundY + sc * 0.2, s.z), q, new THREE.Vector3(sc * 1.4, sc, sc * 1.1));
    pebbles.setMatrixAt(k, m);
  });
  pebbles.receiveShadow = true;
  group.add(pebbles);

  // Reflective roadside markers (delineators) on both edges of the straights.
  const postGeo = keep(new THREE.BoxGeometry(0.14, 1.1, 0.14));
  postGeo.translate(0, 0.55, 0);
  const postMat = keep(new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5, emissive: 0xff7a1a, emissiveIntensity: 0.35 }));
  const list: { p: THREE.Vector3 }[] = [];
  for (let i = 0; i < track.count; i += 4) {
    const s = track.sample(i);
    for (const side of [-1, 1]) {
      const p = s.pos.clone().addScaledVector(s.right, side * (s.halfWidth + 2.3));
      list.push({ p });
    }
  }
  const posts = new THREE.InstancedMesh(postGeo, postMat, list.length);
  list.forEach((l, k) => { m.makeTranslation(l.p.x, l.p.y - 0.1, l.p.z); posts.setMatrixAt(k, m); });
  group.add(posts);
}
