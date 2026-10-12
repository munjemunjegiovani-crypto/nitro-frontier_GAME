import * as THREE from 'three';

export interface TrackSample {
  pos: THREE.Vector3;
  /** Unit tangent (direction of travel). */
  tangent: THREE.Vector3;
  /** Unit vector pointing to the right of the direction of travel, horizontal. */
  right: THREE.Vector3;
  /** Half the drivable width. */
  halfWidth: number;
  /** Signed horizontal curvature (positive = turning right). */
  curvature: number;
  /** Covered by a tunnel / roof. */
  covered: boolean;
}

export interface TrackQuery {
  index: number;
  /** Signed lateral offset from centre line (positive = right). */
  lateral: number;
  /** Interpolated road surface height at the query point. */
  height: number;
  sample: TrackSample;
  /** Interpolation 0..1 between index and index+1. */
  t: number;
}

export interface TrackTheme {
  skyTop: number;
  skyHorizon: number;
  fog: number;
  fogDensity: number;
  ground: number;
  road: number;
  edge: number;
  edgeAlt: number;
  sun: number;
  sunIntensity: number;
  ambient: number;
  ambientIntensity: number;
  night: boolean;
}

export type SceneryKind = 'city' | 'canyon' | 'skyline';

export interface TrackDefinition {
  id: string;
  name: string;
  subtitle: string;
  description: string;
  laps: number;
  width: number;
  /** Uniform horizontal scale applied to control points. */
  scale: number;
  controlPoints: [number, number, number][];
  /** Ranges of normalised track distance (0..1) that are covered by tunnels. */
  tunnels: [number, number][];
  /** Normalised distances of power-up pickup rows. */
  pickupRows: number[];
  /** Normalised distances of boost pads. */
  boostPads: number[];
  /** Normalised distances of jump ramps (the launch lip). */
  jumps: number[];
  scenery: SceneryKind;
  theme: TrackTheme;
}

/** Runtime track: dense samples plus fast spatial queries. */
export class Track {
  readonly samples: TrackSample[] = [];
  readonly length: number;
  readonly curve: THREE.CatmullRomCurve3;
  /** Sample indices of jump-ramp lips. */
  readonly jumpIndices: number[];

  constructor(readonly def: TrackDefinition) {
    const pts = def.controlPoints.map(([x, y, z]) => new THREE.Vector3(x * def.scale, y, z * def.scale));
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);
    this.length = this.curve.getLength();
    const n = Math.max(200, Math.round(this.length / 2.5));
    const spaced = this.curve.getSpacedPoints(n).slice(0, n);
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < n; i++) {
      const p = spaced[i];
      const next = spaced[(i + 1) % n];
      const prev = spaced[(i - 1 + n) % n];
      const tangent = next.clone().sub(prev).normalize();
      const flat = new THREE.Vector3(tangent.x, 0, tangent.z).normalize();
      const right = new THREE.Vector3().crossVectors(flat, up).normalize();
      const u = i / n;
      const covered = def.tunnels.some(([a, b]) => u >= a && u <= b);
      this.samples.push({ pos: p.clone(), tangent, right, halfWidth: def.width / 2, curvature: 0, covered });
    }
    // Jump ramps: a short rise in the road that ends in a lip.
    this.jumpIndices = def.jumps.map((u) => Math.round(u * n) % n);
    for (const lip of this.jumpIndices) {
      const rampLen = 7;
      for (let k = 0; k <= rampLen; k++) {
        const s = this.samples[(lip - rampLen + k + n) % n];
        s.pos.y += 1.6 * (k / rampLen) ** 1.4;
      }
    }
    // Signed curvature from heading change over a small window.
    const w = 3;
    for (let i = 0; i < n; i++) {
      const a = this.samples[(i - w + n) % n].tangent;
      const b = this.samples[(i + w) % n].tangent;
      const ha = Math.atan2(a.x, a.z);
      const hb = Math.atan2(b.x, b.z);
      let d = hb - ha;
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      this.samples[i].curvature = -d / (w * 2 * 2.5);
    }
  }

  get count(): number {
    return this.samples.length;
  }

  sample(i: number): TrackSample {
    const n = this.samples.length;
    return this.samples[((i % n) + n) % n];
  }

  /** Index of the sample nearest to normalised distance u (0..1). */
  indexAt(u: number): number {
    const n = this.samples.length;
    return ((Math.round(u * n) % n) + n) % n;
  }

  /**
   * Nearest-sample query. A `hint` index restricts the search to a local
   * window, which is both fast and correct where the track crosses itself
   * at different heights.
   */
  query(pos: THREE.Vector3, hint = -1, window = 45, out?: TrackQuery): TrackQuery {
    const n = this.samples.length;
    let best = 0;
    let bestD = Infinity;
    if (hint < 0) {
      for (let i = 0; i < n; i++) {
        const s = this.samples[i].pos;
        const dy = (s.y - pos.y) * 2;
        const d = (s.x - pos.x) ** 2 + (s.z - pos.z) ** 2 + dy * dy;
        if (d < bestD) { bestD = d; best = i; }
      }
    } else {
      for (let k = -window; k <= window; k++) {
        const i = (((hint + k) % n) + n) % n;
        const s = this.samples[i].pos;
        const d = (s.x - pos.x) ** 2 + (s.z - pos.z) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    // Decide which segment we are on (best..best+1 or best-1..best).
    const s = this.samples[best];
    const dx = pos.x - s.pos.x;
    const dz = pos.z - s.pos.z;
    const along = dx * s.tangent.x + dz * s.tangent.z;
    const i0 = along >= 0 ? best : (best - 1 + n) % n;
    const a = this.samples[i0];
    const b = this.samples[(i0 + 1) % n];
    const segX = b.pos.x - a.pos.x;
    const segZ = b.pos.z - a.pos.z;
    const segLen2 = segX * segX + segZ * segZ || 1;
    const t = Math.max(0, Math.min(1, ((pos.x - a.pos.x) * segX + (pos.z - a.pos.z) * segZ) / segLen2));
    const cx = a.pos.x + segX * t;
    const cz = a.pos.z + segZ * t;
    const rx = a.right.x + (b.right.x - a.right.x) * t;
    const rz = a.right.z + (b.right.z - a.right.z) * t;
    const lateral = (pos.x - cx) * rx + (pos.z - cz) * rz;
    const height = a.pos.y + (b.pos.y - a.pos.y) * t;
    const q = out ?? ({} as TrackQuery);
    q.index = best;
    q.lateral = lateral;
    q.height = height;
    q.sample = s;
    q.t = t;
    return q;
  }

  /** World position at a sample index with a lateral offset. */
  pointAt(index: number, lateral: number, target = new THREE.Vector3()): THREE.Vector3 {
    const s = this.sample(index);
    return target.copy(s.pos).addScaledVector(s.right, lateral);
  }

  /** Heading (yaw, radians) of the track at a sample. */
  headingAt(index: number): number {
    const t = this.sample(index).tangent;
    return Math.atan2(t.x, t.z);
  }

  /** Grid slot for a starting position (0 = pole). Two columns, staggered. */
  gridSlot(slot: number): { index: number; lateral: number } {
    const row = Math.floor(slot / 2);
    const col = slot % 2;
    const back = 6 + row * 4; // samples behind the line (2.5 units each)
    return { index: this.count - back, lateral: (col === 0 ? -1 : 1) * this.def.width * 0.2 };
  }

  /** Horizontal distance from a point to the nearest point of the road edge. */
  distanceFromRoad(x: number, z: number, step = 3): number {
    let best = Infinity;
    for (let i = 0; i < this.samples.length; i += step) {
      const s = this.samples[i];
      const d = Math.hypot(s.pos.x - x, s.pos.z - z) - s.halfWidth;
      if (d < best) best = d;
    }
    return best;
  }

  /** Axis-aligned bounds of the centre line (xz). */
  bounds(): { minX: number; maxX: number; minZ: number; maxZ: number } {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const s of this.samples) {
      minX = Math.min(minX, s.pos.x); maxX = Math.max(maxX, s.pos.x);
      minZ = Math.min(minZ, s.pos.z); maxZ = Math.max(maxZ, s.pos.z);
    }
    return { minX, maxX, minZ, maxZ };
  }
}
