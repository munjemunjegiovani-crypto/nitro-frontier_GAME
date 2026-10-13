import * as THREE from 'three';
import type { Track } from './Track';
import { buildDesertLife, buildLampLight, buildNeonTrim, buildRoofClutter, buildStreetTrees, type Lamp, type Roof } from './Scenery';
import { asphalt, barrierTexture, facadeTexture, kerbTexture, pavementTexture, rockStrata, sandTexture, worldSpaceWindows } from './Materials';

export type Quality = 'low' | 'medium' | 'high';

export interface BuiltTrack {
  group: THREE.Group;
  /** Animated boost-pad texture (scrolls). */
  boostTexture: THREE.Texture;
  /** World Y of the ground plane (used for respawn safety). */
  groundY: number;
  dispose(): void;
}

/* ------------------------------------------------------------------ */
/* Procedural textures                                                  */
/* ------------------------------------------------------------------ */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function hex(c: number, a = 1): string {
  const col = new THREE.Color(c);
  return `rgba(${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)},${a})`;
}

function chevronTexture(color: number): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  g.clearRect(0, 0, 128, 128);
  g.strokeStyle = hex(color);
  g.lineWidth = 14;
  g.lineCap = 'round';
  for (const y of [40, 100]) {
    g.beginPath();
    g.moveTo(16, y);
    g.lineTo(64, y - 32);
    g.lineTo(112, y);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function bannerTexture(text: string, a: number, b: number): THREE.CanvasTexture {
  const [c, g] = canvas(1024, 128);
  g.fillStyle = '#0c0e13';
  g.fillRect(0, 0, 1024, 128);
  for (let x = 0; x < 1024; x += 32) {
    g.fillStyle = (x / 32) % 2 ? '#f2f6ff' : '#14161c';
    g.fillRect(x, 0, 32, 14);
    g.fillStyle = (x / 32) % 2 ? '#14161c' : '#f2f6ff';
    g.fillRect(x, 114, 32, 14);
  }
  g.font = 'italic 900 64px "Arial Black", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const grad = g.createLinearGradient(200, 0, 824, 0);
  grad.addColorStop(0, hex(a));
  grad.addColorStop(1, hex(b));
  g.fillStyle = grad;
  g.fillText(text, 512, 66);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function signTexture(text: string, color: number): THREE.CanvasTexture {
  const [c, g] = canvas(256, 512);
  g.fillStyle = '#05060a';
  g.fillRect(0, 0, 256, 512);
  g.strokeStyle = hex(color);
  g.lineWidth = 8;
  g.strokeRect(12, 12, 232, 488);
  g.fillStyle = hex(color);
  g.font = 'bold 54px Arial, sans-serif';
  g.textAlign = 'center';
  const letters = text.split('');
  letters.forEach((ch, i) => g.fillText(ch, 128, 90 + i * 62));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                     */
/* ------------------------------------------------------------------ */

/** Builds a closed strip from two point generators along the track samples. */
function strip(
  count: number,
  a: (i: number, out: THREE.Vector3) => void,
  b: (i: number, out: THREE.Vector3) => void,
  vScale: number,
  filter?: (i: number) => boolean,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const pa = new THREE.Vector3();
  const pb = new THREE.Vector3();
  let dist = 0;
  const prev = new THREE.Vector3();
  let vert = 0;
  let open = false;
  for (let k = 0; k <= count; k++) {
    const i = k % count;
    const include = !filter || filter(i);
    a(i, pa);
    b(i, pb);
    if (k > 0) dist += pa.distanceTo(prev);
    prev.copy(pa);
    if (!include) { open = false; continue; }
    positions.push(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z);
    uvs.push(0, dist * vScale, 1, dist * vScale);
    if (open) {
      const v = vert;
      indices.push(v - 2, v, v - 1, v - 1, v, v + 1);
    }
    vert += 2;
    open = true;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* Track builder                                                        */
/* ------------------------------------------------------------------ */

export function buildTrack(track: Track, quality: Quality): BuiltTrack {
  const def = track.def;
  const theme = def.theme;
  const n = track.count;
  const group = new THREE.Group();
  group.name = `track-${def.id}`;
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T): T => { disposables.push(x); return x; };
  const rand = mulberry32(def.id.length * 7919 + 13);

  let minY = Infinity;
  for (const s of track.samples) minY = Math.min(minY, s.pos.y);
  const groundY = def.scenery === 'skyline' ? -70 : minY - 0.6;

  /* ---------- Sky ---------- */
  const skyMat = keep(new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(theme.skyTop) },
      horizon: { value: new THREE.Color(theme.skyHorizon) },
      night: { value: theme.night ? 1 : 0 },
      sunDir: { value: new THREE.Vector3(-0.4, 0.25, -0.9).normalize() },
      sunColor: { value: new THREE.Color(theme.sun) },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 horizon; uniform float night; uniform vec3 sunDir; uniform vec3 sunColor;
      varying vec3 vDir;
      float hash(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(h2(i), h2(i+vec2(1,0)), f.x), mix(h2(i+vec2(0,1)), h2(i+vec2(1,1)), f.x), f.y); }
      void main(){
        float h = clamp(vDir.y, -0.2, 1.0);
        vec3 col = mix(horizon, top, pow(max(h,0.0), 0.55));
        col = mix(col, horizon*0.6, step(h, 0.0));
        float s = max(dot(normalize(vDir), sunDir), 0.0);
        col += sunColor * (pow(s, 48.0)*0.35 + pow(s, 900.0)*1.6) * (1.0 - night*0.7);
        // Procedural clouds projected on a sky dome.
        if (h > 0.0) {
          vec2 cp = vDir.xz / (vDir.y + 0.12) * 1.6;
          float cl = 0.0, amp = 0.55;
          for (int o = 0; o < 5; o++) { cl += amp * vnoise(cp); cp = cp * 2.07 + vec2(1.7, 9.2); amp *= 0.5; }
          float cover = smoothstep(0.52, 0.8, cl) * smoothstep(0.02, 0.25, h) * (1.0 - night * 0.6);
          vec3 cloudCol = mix(horizon * 1.25 + vec3(0.08), vec3(1.0, 0.97, 0.94), pow(max(h, 0.0), 0.4)) ;
          cloudCol += sunColor * pow(s, 8.0) * 0.3;
          if (night > 0.5) cloudCol = horizon * 0.7;
          col = mix(col, cloudCol, cover * 0.85);
        }
        if (night > 0.5) {
          vec3 p = floor(vDir*420.0);
          float st = step(0.9975, hash(p)) * smoothstep(0.05, 0.4, h);
          col += vec3(st);
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  }));
  const sky = new THREE.Mesh(keep(new THREE.SphereGeometry(1800, 32, 16)), skyMat);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  group.add(sky);

  /* ---------- Ground ---------- */
  const groundGeo = keep(new THREE.PlaneGeometry(4000, 4000, 80, 80));
  groundGeo.rotateX(-Math.PI / 2);
  if (def.scenery === 'canyon') {
    // Vertex-coloured dunes
    const pos = groundGeo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const base = new THREE.Color(theme.ground);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const nse = Math.sin(x * 0.013) * Math.cos(z * 0.017) + Math.sin((x + z) * 0.031) * 0.5;
      const far = Math.hypot(x, z) > 700 ? (Math.hypot(x, z) - 700) * 0.12 : 0;
      pos.setY(i, nse * 2.5 - 1 + Math.min(far, 140) * (0.5 + 0.5 * Math.sin(x * 0.01)));
      c.copy(base).offsetHSL(0, 0, nse * 0.05);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    groundGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    groundGeo.computeVertexNormals();
  }
  const groundSet = def.scenery === 'canyon' ? sandTexture(0xffffff) : pavementTexture(theme.ground);
  for (const t of [groundSet.map, groundSet.normalMap, groundSet.roughnessMap]) { keep(t); t.repeat.set(160, 160); }
  const groundMat = keep(new THREE.MeshStandardMaterial({
    color: def.scenery === 'canyon' ? 0xffffff : 0xffffff,
    map: groundSet.map,
    normalMap: groundSet.normalMap,
    roughnessMap: groundSet.roughnessMap,
    vertexColors: def.scenery === 'canyon',
    roughness: 1,
    metalness: def.scenery === 'city' ? 0.2 : 0,
  }));
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.position.y = groundY - (def.scenery === 'canyon' ? 0.5 : 0);
  ground.receiveShadow = true;
  group.add(ground);

  /* ---------- Road deck ---------- */
  const tmp = new THREE.Vector3();
  const edge = (side: number, lift: number, extra = 0) => (i: number, out: THREE.Vector3) => {
    const s = track.sample(i);
    out.copy(s.pos).addScaledVector(s.right, side * (s.halfWidth + extra));
    out.y += lift;
  };

  const roadSet = asphalt(theme);
  keep(roadSet.map); keep(roadSet.normalMap); keep(roadSet.roughnessMap);
  const roadMat = keep(new THREE.MeshStandardMaterial({
    map: roadSet.map,
    normalMap: roadSet.normalMap,
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughnessMap: roadSet.roughnessMap,
    roughness: 1,
    metalness: theme.night ? 0.1 : 0,
    envMapIntensity: theme.night ? 1.4 : 0.8,
  }));
  const roadGeo = keep(strip(n, edge(-1, 0.02, 0.6), edge(1, 0.02, 0.6), 1 / 26));
  const road = new THREE.Mesh(roadGeo, roadMat);
  road.receiveShadow = true;
  group.add(road);

  /* ---------- Kerbs on corners ---------- */
  {
    const corner = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      let c = 0;
      for (let k = -8; k <= 8; k += 2) c += Math.abs(track.sample(i + k).curvature);
      corner[i] = c / 9 > 0.0065 && !track.sample(i).covered ? 1 : 0;
    }
    const kerbTex = keep(kerbTexture());
    const kerbMat = keep(new THREE.MeshStandardMaterial({
      map: kerbTex, roughness: 0.55, metalness: 0, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    const isCorner = (i: number) => corner[i] === 1;
    group.add(new THREE.Mesh(keep(strip(n, edge(-1, 0.05, 0.55), edge(-1, 0.05, -0.9), 1 / 4, isCorner)), kerbMat));
    group.add(new THREE.Mesh(keep(strip(n, edge(1, 0.05, -0.9), edge(1, 0.05, 0.55), 1 / 4, isCorner)), kerbMat));
  }

  // Deck sides and underside (visible on elevated sections)
  const deckMat = keep(new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 0.7, metalness: 0.4, side: THREE.DoubleSide }));
  for (const side of [-1, 1]) {
    const g = keep(strip(n, edge(side, 0.02, 1.4), edge(side, -1.6, 1.4), 1 / 10));
    group.add(new THREE.Mesh(g, deckMat));
  }
  group.add(new THREE.Mesh(keep(strip(n, edge(-1, -1.6, 1.4), edge(1, -1.6, 1.4), 1 / 10)), deckMat));

  /* ---------- Barriers ---------- */
  const barrierMats = [theme.edge, theme.edgeAlt].map((c) => keep(new THREE.MeshStandardMaterial({
    map: keep(barrierTexture(c)), roughness: 0.85, metalness: 0, side: THREE.DoubleSide,
  })));
  const glowMats = [theme.edge, theme.edgeAlt].map((c) => keep(new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide })));
  const railMat = keep(new THREE.MeshStandardMaterial({ color: 0xb8bec8, metalness: 0.9, roughness: 0.3, side: THREE.DoubleSide }));
  for (const side of [-1, 1]) {
    const k = side < 0 ? 0 : 1;
    // Concrete wall (inner face) with a slight lean back
    group.add(new THREE.Mesh(keep(strip(n, edge(side, 0, 1.3), edge(side, 1.35, 1.45), 1 / 10)), barrierMats[k]));
    // Wall top cap
    group.add(new THREE.Mesh(keep(strip(n, edge(side, 1.35, 1.45), edge(side, 1.35, 1.85), 1 / 10)), railMat));
    // Glowing light strip on the wall top
    group.add(new THREE.Mesh(keep(strip(n, edge(side, 1.36, 1.5), edge(side, 1.36, 1.62), 1 / 10)), glowMats[k]));
    // Ground-level light strip
    group.add(new THREE.Mesh(keep(strip(n, edge(side, 0.04, 0.95), edge(side, 0.04, 1.2), 1 / 10)), glowMats[k]));
  }

  /* ---------- Support pillars ---------- */
  const pillarIdx: number[] = [];
  for (let i = 0; i < n; i += 10) {
    if (track.samples[i].pos.y - groundY > 3) pillarIdx.push(i);
  }
  if (pillarIdx.length) {
    const pillarGeo = keep(new THREE.BoxGeometry(2.4, 1, 2.4));
    pillarGeo.translate(0, 0.5, 0);
    const pillarMat = keep(new THREE.MeshStandardMaterial({ color: 0x30343f, roughness: 0.6, metalness: 0.5 }));
    const pillars = new THREE.InstancedMesh(pillarGeo, pillarMat, pillarIdx.length * 2);
    const m = new THREE.Matrix4();
    let k = 0;
    for (const i of pillarIdx) {
      const s = track.samples[i];
      const h = s.pos.y - 1.6 - groundY;
      for (const side of [-0.6, 0.6]) {
        tmp.copy(s.pos).addScaledVector(s.right, side * s.halfWidth);
        m.compose(new THREE.Vector3(tmp.x, groundY, tmp.z), new THREE.Quaternion(), new THREE.Vector3(1, h, 1));
        pillars.setMatrixAt(k++, m);
      }
    }
    pillars.castShadow = true;
    group.add(pillars);
  }

  /* ---------- Tunnels ---------- */
  const coveredCount = track.samples.filter((s) => s.covered).length;
  if (coveredCount) {
    const covered = (i: number) => track.sample(i).covered;
    const tunnelMat = keep(new THREE.MeshStandardMaterial({ color: 0x1a1c24, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide }));
    for (const side of [-1, 1]) {
      group.add(new THREE.Mesh(keep(strip(n, edge(side, 1.45, 1.4), edge(side, 8.5, 0.2), 1 / 10, covered)), tunnelMat));
    }
    group.add(new THREE.Mesh(keep(strip(n, edge(-1, 8.5, 0.2), edge(1, 8.5, 0.2), 1 / 10, covered)), tunnelMat));
    // Ceiling light bars
    const barGeo = keep(new THREE.BoxGeometry(def.width * 0.7, 0.15, 0.9));
    const barMat = keep(new THREE.MeshBasicMaterial({ color: 0xbff6ff }));
    const idx: number[] = [];
    for (let i = 0; i < n; i += 3) if (covered(i)) idx.push(i);
    const bars = new THREE.InstancedMesh(barGeo, barMat, idx.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    idx.forEach((i, k) => {
      const s = track.samples[i];
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(s.tangent.x, s.tangent.z));
      m.compose(new THREE.Vector3(s.pos.x, s.pos.y + 8.3, s.pos.z), q, new THREE.Vector3(1, 1, 1));
      bars.setMatrixAt(k, m);
    });
    group.add(bars);
  }

  /* ---------- Start / finish gantry ---------- */
  {
    const s = track.sample(0);
    const heading = Math.atan2(s.tangent.x, s.tangent.z);
    const gantry = new THREE.Group();
    gantry.position.copy(s.pos);
    gantry.rotation.y = heading;
    const postGeo = keep(new THREE.BoxGeometry(1.2, 10, 1.2));
    const postMat = keep(new THREE.MeshStandardMaterial({ color: 0x1b1e26, metalness: 0.8, roughness: 0.3 }));
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(side * (s.halfWidth + 2), 5, 0);
      post.castShadow = true;
      gantry.add(post);
    }
    const bannerTex = keep(bannerTexture('NITRO FRONTIER', theme.edge, theme.edgeAlt));
    const bannerMat = keep(new THREE.MeshBasicMaterial({ map: bannerTex, side: THREE.DoubleSide }));
    const banner = new THREE.Mesh(keep(new THREE.BoxGeometry(def.width + 5, 2.4, 0.6)), [postMat, postMat, postMat, postMat, bannerMat, bannerMat]);
    banner.position.y = 9;
    gantry.add(banner);
    // chequered line on the road
    const [cc, cg] = canvas(256, 32);
    for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) {
      cg.fillStyle = (x + y) % 2 ? '#f2f6ff' : '#111';
      cg.fillRect(x * 16, y * 16, 16, 16);
    }
    const lineTex = keep(new THREE.CanvasTexture(cc));
    lineTex.colorSpace = THREE.SRGBColorSpace;
    const line = new THREE.Mesh(keep(new THREE.PlaneGeometry(def.width, 2.2)), keep(new THREE.MeshBasicMaterial({ map: lineTex })));
    line.rotation.x = -Math.PI / 2;
    line.position.y = 0.06;
    gantry.add(line);
    group.add(gantry);
  }

  /* ---------- Checkpoint pylons ---------- */
  {
    const pylonGeo = keep(new THREE.CylinderGeometry(0.25, 0.4, 5, 8));
    pylonGeo.translate(0, 2.5, 0);
    const pylonMat = keep(new THREE.MeshBasicMaterial({ color: theme.edge }));
    const cps = 8;
    const pylons = new THREE.InstancedMesh(pylonGeo, pylonMat, (cps - 1) * 2);
    const m = new THREE.Matrix4();
    let k = 0;
    for (let c = 1; c < cps; c++) {
      const s = track.sample(Math.round((c * n) / cps));
      for (const side of [-1, 1]) {
        tmp.copy(s.pos).addScaledVector(s.right, side * (s.halfWidth + 1.6));
        m.makeTranslation(tmp.x, tmp.y + 1.4, tmp.z);
        pylons.setMatrixAt(k++, m);
      }
    }
    group.add(pylons);
  }

  /* ---------- Boost pads ---------- */
  const boostTexture = keep(chevronTexture(0xffd23f));
  boostTexture.repeat.set(1, 3);
  {
    const padMat = keep(new THREE.MeshBasicMaterial({ map: boostTexture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    for (const u of def.boostPads) {
      const i = track.indexAt(u);
      const pad = new THREE.Mesh(keep(strip(n, edge(-0.55, 0.08), edge(0.55, 0.08), 1 / 8, (j) => {
        const d = (j - i + n) % n;
        return d <= 5;
      })), padMat);
      group.add(pad);
    }
  }

  /* ---------- Jump ramp markings ---------- */
  if (track.jumpIndices.length) {
    const rampMat = keep(new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
    const signGeo = keep(new THREE.PlaneGeometry(2.4, 2.4));
    const signMat = keep(new THREE.MeshBasicMaterial({ map: keep(chevronTexture(0xff7a1a)), transparent: true, side: THREE.DoubleSide }));
    for (const lip of track.jumpIndices) {
      group.add(new THREE.Mesh(keep(strip(n, edge(-1, 0.07, -1), edge(1, 0.07, -1), 1, (j) => (j - lip + n) % n === 0 || (lip - j + n) % n === 1)), rampMat));
      // Side warning chevrons
      for (const side of [-1, 1]) {
        const sign = new THREE.Mesh(signGeo, signMat);
        const s = track.sample(lip - 12);
        sign.position.copy(s.pos).addScaledVector(s.right, side * (s.halfWidth + 2.2));
        sign.position.y += 2.8;
        sign.rotation.y = Math.atan2(s.tangent.x, s.tangent.z) + Math.PI;
        group.add(sign);
      }
    }
  }

  /* ---------- Scenery ---------- */
  const detail = quality === 'low' ? 0.5 : quality === 'medium' ? 0.8 : 1;
  if (def.scenery === 'city') buildCity(track, group, keep, rand, groundY, detail);
  else if (def.scenery === 'canyon') buildCanyon(track, group, keep, rand, groundY, detail);
  else buildSkyline(track, group, keep, rand, groundY, detail);

  return {
    group,
    boostTexture,
    groundY,
    dispose() {
      for (const d of disposables) d.dispose();
      group.traverse((o) => {
        if (o instanceof THREE.InstancedMesh) o.dispose();
      });
      group.removeFromParent();
    },
  };
}

type Keep = <T extends { dispose(): void }>(x: T) => T;

/** Scatter candidate positions around the track, outside the road. */
function scatter(track: Track, rand: () => number, count: number, minDist: number, maxDist: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const n = track.count;
  let tries = 0;
  while (out.length < count && tries < count * 12) {
    tries++;
    const s = track.sample(Math.floor(rand() * n));
    const side = rand() < 0.5 ? -1 : 1;
    const off = s.halfWidth + minDist + rand() * (maxDist - minDist);
    const x = s.pos.x + s.right.x * side * off + (rand() - 0.5) * 10;
    const z = s.pos.z + s.right.z * side * off + (rand() - 0.5) * 10;
    if (track.distanceFromRoad(x, z, 4) < minDist) continue;
    out.push(new THREE.Vector3(x, s.pos.y, z));
  }
  return out;
}

function buildCity(track: Track, group: THREE.Group, keep: Keep, rand: () => number, groundY: number, detail: number): void {
  const boxGeo = keep(new THREE.BoxGeometry(1, 1, 1));
  boxGeo.translate(0, 0.5, 0);
  const palettes = [[0x9fe9ff, 0xffffff], [0xffb070, 0xffe2b0], [0xff8ad8, 0x9fe9ff]];
  const spots = scatter(track, rand, Math.floor(260 * detail), 14, 170);
  const perMat = Math.ceil(spots.length / palettes.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const roofTops: THREE.Vector3[] = [];
  const roofs: Roof[] = [];
  const towers: { x: number; z: number; w: number; d: number; h: number; rot: number; y: number }[] = [];
  palettes.forEach((pal, pi) => {
    const tex = keep(facadeTexture(pal, 100 + pi));
    const mat = keep(new THREE.MeshStandardMaterial({
      color: 0x1a1f2b, roughness: 0.28, metalness: 0.75, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.5,
    }));
    worldSpaceWindows(mat, 56);
    const slice = spots.slice(pi * perMat, (pi + 1) * perMat);
    // Two instances per building: main block plus an optional set-back tier.
    const inst = new THREE.InstancedMesh(boxGeo, mat, slice.length * 2);
    slice.forEach((p, k) => {
      const w = 12 + rand() * 18;
      const d = 12 + rand() * 18;
      const h = 22 + rand() ** 1.6 * 140;
      const rot = rand() * Math.PI;
      q.setFromAxisAngle(up, rot);
      m.compose(new THREE.Vector3(p.x, groundY, p.z), q, new THREE.Vector3(w, h, d));
      inst.setMatrixAt(k * 2, m);
      towers.push({ x: p.x, z: p.z, w, d, h, rot, y: groundY });
      if (rand() < 0.55) {
        const th = 8 + rand() * h * 0.35;
        m.compose(new THREE.Vector3(p.x, groundY + h, p.z), q, new THREE.Vector3(w * 0.62, th, d * 0.62));
        roofTops.push(new THREE.Vector3(p.x, groundY + h + th, p.z));
        roofs.push({ x: p.x, y: groundY + h, z: p.z, w: w * 0.6, d: d * 0.6, rot });
      } else {
        m.makeScale(0, 0, 0);
        roofTops.push(new THREE.Vector3(p.x, groundY + h, p.z));
        roofs.push({ x: p.x, y: groundY + h, z: p.z, w, d, rot });
      }
      inst.setMatrixAt(k * 2 + 1, m);
    });
    inst.castShadow = true;
    group.add(inst);
  });
  // Rooftop antennas with red aviation beacons
  const tall = roofTops.filter((r) => r.y - groundY > 60);
  if (tall.length) {
    const antGeo = keep(new THREE.CylinderGeometry(0.25, 0.4, 14, 6));
    antGeo.translate(0, 7, 0);
    const beaconGeo = keep(new THREE.SphereGeometry(0.9, 8, 6));
    const ants = new THREE.InstancedMesh(antGeo, keep(new THREE.MeshStandardMaterial({ color: 0x30343c, metalness: 0.8, roughness: 0.4 })), tall.length);
    const beacons = new THREE.InstancedMesh(beaconGeo, keep(new THREE.MeshBasicMaterial({ color: 0xff2b2b })), tall.length);
    tall.forEach((r, k) => {
      ants.setMatrixAt(k, m.makeTranslation(r.x, r.y, r.z));
      beacons.setMatrixAt(k, m.makeTranslation(r.x, r.y + 14, r.z));
    });
    group.add(ants, beacons);
  }
  // Neon billboards on poles beside the road
  const signs = ['NOVA', 'KAIJU', 'VOLT', 'ORBIT', 'ZEN'];
  const colors = [0x20e3ff, 0xff2fb4, 0xff7a1a];
  const signGeo = keep(new THREE.PlaneGeometry(6, 12));
  for (let k = 0; k < Math.floor(14 * detail); k++) {
    const i = Math.floor(rand() * track.count);
    const s = track.sample(i);
    if (s.covered) continue;
    const side = rand() < 0.5 ? -1 : 1;
    const tex = keep(signTexture(signs[k % signs.length], colors[k % colors.length]));
    const mat = keep(new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
    const mesh = new THREE.Mesh(signGeo, mat);
    mesh.position.copy(s.pos).addScaledVector(s.right, side * (s.halfWidth + 7));
    mesh.position.y += 11;
    mesh.rotation.y = Math.atan2(s.tangent.x, s.tangent.z) + (side > 0 ? -Math.PI / 2.6 : Math.PI / 2.6) + Math.PI;
    group.add(mesh);
  }
  // Street lamps
  const lampIdx: number[] = [];
  for (let i = 0; i < track.count; i += 14) if (!track.sample(i).covered) lampIdx.push(i);
  const poleGeo = keep(new THREE.CylinderGeometry(0.15, 0.2, 9, 6));
  poleGeo.translate(0, 4.5, 0);
  const bulbGeo = keep(new THREE.BoxGeometry(0.5, 0.25, 3));
  const poleMat = keep(new THREE.MeshStandardMaterial({ color: 0x2a2e38, metalness: 0.8, roughness: 0.4 }));
  const bulbMat = keep(new THREE.MeshBasicMaterial({ color: 0xfff1cf }));
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, lampIdx.length);
  const bulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, lampIdx.length);
  lampIdx.forEach((i, k) => {
    const s = track.sample(i);
    const side = k % 2 ? 1 : -1;
    const p = s.pos.clone().addScaledVector(s.right, side * (s.halfWidth + 2));
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(s.right.x, s.right.z));
    m.compose(p, new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
    poles.setMatrixAt(k, m);
    m.compose(p.clone().addScaledVector(s.right, -side * 1.5).setY(p.y + 9), q, new THREE.Vector3(1, 1, 1));
    bulbs.setMatrixAt(k, m);
  });
  group.add(poles, bulbs);
  const lamps: Lamp[] = lampIdx.map((i, k) => {
    const sm = track.sample(i);
    const side = k % 2 ? 1 : -1;
    const lp = sm.pos.clone().addScaledVector(sm.right, side * (sm.halfWidth + 2)).addScaledVector(sm.right, -side * 1.5);
    lp.y = sm.pos.y + 8.9;
    return { pos: lp, dir: new THREE.Vector3(0, -1, 0) };
  });
  buildLampLight(group, keep, lamps, 0xffd9a0, 0.22);
  buildRoofClutter(group, keep, rand, roofs);
  buildNeonTrim(group, keep, rand, towers, [0x20e3ff, 0xff2fb4, 0xff7a1a]);
  buildStreetTrees(track, group, keep, rand, groundY, detail);
  // Harbour water beyond the city
  const waterMat = keep(new THREE.MeshStandardMaterial({ color: 0x07101e, metalness: 0.9, roughness: 0.12 }));
  const water = new THREE.Mesh(keep(new THREE.PlaneGeometry(3000, 900)), waterMat);
  water.rotation.x = -Math.PI / 2;
  const b = track.bounds();
  water.position.set((b.minX + b.maxX) / 2, groundY + 0.05, b.maxZ + 620);
  group.add(water);
}

function buildCanyon(track: Track, group: THREE.Group, keep: Keep, rand: () => number, groundY: number, detail: number): void {
  // Displaced rock geometry, instanced in two colours
  const rockGeo = keep(new THREE.IcosahedronGeometry(1, 1));
  const p = rockGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i);
    v.multiplyScalar(0.75 + Math.abs(Math.sin(v.x * 5 + v.z * 3)) * 0.4);
    p.setXYZ(i, v.x, v.y * 0.8, v.z);
  }
  rockGeo.computeVertexNormals();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (const [color, count, minD, maxD, scaleLo, scaleHi] of [
    [0x8f4a2c, 140, 6, 60, 2, 9],
    [0xb8693e, 70, 30, 220, 10, 30],
  ] as const) {
    const spots = scatter(track, rand, Math.floor(count * detail), minD, maxD);
    const mat = keep(new THREE.MeshStandardMaterial({ color, roughness: 0.95, flatShading: true }));
    rockStrata(mat);
    const inst = new THREE.InstancedMesh(rockGeo, mat, spots.length);
    spots.forEach((s, k) => {
      const sc = scaleLo + rand() * (scaleHi - scaleLo);
      q.setFromEuler(new THREE.Euler(rand() * 0.4, rand() * Math.PI * 2, rand() * 0.4));
      m.compose(new THREE.Vector3(s.x, groundY + sc * 0.3, s.z), q, new THREE.Vector3(sc, sc * (0.6 + rand() * 0.8), sc));
      inst.setMatrixAt(k, m);
    });
    inst.castShadow = true;
    inst.receiveShadow = true;
    group.add(inst);
  }
  // Mesas: layered tapered columns
  const mesaGeo = keep(new THREE.CylinderGeometry(0.75, 1, 1, 7, 4));
  mesaGeo.translate(0, 0.5, 0);
  const mesaMat = keep(new THREE.MeshStandardMaterial({ color: 0xb05c34, roughness: 1, flatShading: true }));
  rockStrata(mesaMat);
  const mesaSpots = scatter(track, rand, Math.floor(26 * detail), 60, 380);
  const mesas = new THREE.InstancedMesh(mesaGeo, mesaMat, mesaSpots.length);
  mesaSpots.forEach((s, k) => {
    const r = 25 + rand() * 45;
    m.compose(new THREE.Vector3(s.x, groundY - 2, s.z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 6), new THREE.Vector3(r, 40 + rand() * 90, r));
    mesas.setMatrixAt(k, m);
  });
  mesas.castShadow = true;
  group.add(mesas);
  // Refinery near the hairpin: tanks, flare stacks
  const hair = track.sample(Math.round(track.count * 0.3));
  const tankGeo = keep(new THREE.CylinderGeometry(6, 6, 9, 20));
  tankGeo.translate(0, 4.5, 0);
  const tankMat = keep(new THREE.MeshStandardMaterial({ color: 0xd8d2c8, metalness: 0.6, roughness: 0.35 }));
  const stackGeo = keep(new THREE.CylinderGeometry(0.8, 1.2, 40, 10));
  stackGeo.translate(0, 20, 0);
  const flameMat = keep(new THREE.MeshBasicMaterial({ color: 0xff7a1a }));
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const x = hair.pos.x + hair.right.x * 70 + Math.cos(a) * 22;
    const z = hair.pos.z + hair.right.z * 70 + Math.sin(a) * 22;
    if (track.distanceFromRoad(x, z) < 10) continue;
    const t = new THREE.Mesh(tankGeo, tankMat);
    t.position.set(x, groundY, z);
    t.castShadow = true;
    group.add(t);
    if (k % 2 === 0) {
      const st = new THREE.Mesh(stackGeo, tankMat);
      st.position.set(x + 9, groundY, z + 5);
      const fl = new THREE.Mesh(keep(new THREE.ConeGeometry(1.4, 5, 8)), flameMat);
      fl.position.y = 42;
      st.add(fl);
      group.add(st);
    }
  }
  buildDesertLife(track, group, keep, rand, groundY, detail, (n, a, b) => scatter(track, rand, n, a, b));
  // Power lines / pylons along the straights for speed reference
  const poleGeo = keep(new THREE.BoxGeometry(0.6, 12, 0.6));
  poleGeo.translate(0, 6, 0);
  const poleMat = keep(new THREE.MeshStandardMaterial({ color: 0x3a2a22, roughness: 0.9 }));
  const idx: number[] = [];
  for (let i = 0; i < track.count; i += 9) idx.push(i);
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, idx.length);
  idx.forEach((i, k) => {
    const s = track.sample(i);
    const pos = s.pos.clone().addScaledVector(s.right, (k % 2 ? 1 : -1) * (s.halfWidth + 6));
    m.compose(pos.setY(Math.min(pos.y, groundY + 30) - 1), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
    poles.setMatrixAt(k, m);
  });
  group.add(poles);
}

function buildSkyline(track: Track, group: THREE.Group, keep: Keep, rand: () => number, groundY: number, detail: number): void {
  const m = new THREE.Matrix4();
  // Megacity far below
  const boxGeo = keep(new THREE.BoxGeometry(1, 1, 1));
  boxGeo.translate(0, 0.5, 0);
  for (const [pal, count] of [[[0x9fe9ff, 0xffffff], 220], [[0xffc28a, 0xffe2b0], 160]] as const) {
    const tex = keep(facadeTexture([...pal], count));
    const mat = keep(new THREE.MeshStandardMaterial({ color: 0x1b2234, roughness: 0.3, metalness: 0.7, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.3 }));
    worldSpaceWindows(mat, 70);
    const c = Math.floor(count * detail);
    const inst = new THREE.InstancedMesh(boxGeo, mat, c);
    for (let k = 0; k < c; k++) {
      const a = rand() * Math.PI * 2;
      const r = 40 + rand() ** 0.7 * 750;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const near = track.distanceFromRoad(x, z, 6) < 20;
      const h = near ? 20 + rand() * 40 : 30 + rand() ** 1.5 * (r > 350 ? 220 : 120);
      const w = 12 + rand() * 22;
      m.compose(new THREE.Vector3(x, groundY, z), new THREE.Quaternion(), new THREE.Vector3(w, h, w * (0.7 + rand() * 0.6)));
      inst.setMatrixAt(k, m);
    }
    group.add(inst);
  }
  // Holo rings spanning the track
  const ringGeo = keep(new THREE.TorusGeometry(16, 0.5, 8, 48));
  const ringMats = [0x20e3ff, 0xff2fb4, 0xff7a1a].map((c) => keep(new THREE.MeshBasicMaterial({ color: c })));
  const ringCount = Math.floor(10 * detail) + 2;
  for (let k = 0; k < ringCount; k++) {
    const i = Math.floor((k / ringCount) * track.count + 15);
    const s = track.sample(i);
    const ring = new THREE.Mesh(ringGeo, ringMats[k % 3]);
    ring.position.copy(s.pos);
    ring.position.y += 3;
    ring.rotation.y = Math.atan2(s.tangent.x, s.tangent.z);
    group.add(ring);
  }
  // Floating platforms with beacons
  const platGeo = keep(new THREE.CylinderGeometry(12, 6, 4, 12));
  const platMat = keep(new THREE.MeshStandardMaterial({ color: 0x232838, metalness: 0.8, roughness: 0.3 }));
  const beaconGeo = keep(new THREE.SphereGeometry(1.4, 12, 8));
  const beaconMat = keep(new THREE.MeshBasicMaterial({ color: 0xff2fb4 }));
  const spots = scatter(track, rand, Math.floor(18 * detail), 40, 200);
  for (const s of spots) {
    const plat = new THREE.Mesh(platGeo, platMat);
    plat.position.set(s.x, s.y - 10 + rand() * 30, s.z);
    const b = new THREE.Mesh(beaconGeo, beaconMat);
    b.position.y = 4;
    plat.add(b);
    group.add(plat);
  }
}
