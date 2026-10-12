import * as THREE from 'three';

const VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
uniform float uScale;
uniform float uMax;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = min(aSize * uScale / max(0.1, -mv.z), uMax);
  // Fade sprites that are almost touching the camera.
  vAlpha *= smoothstep(1.0, 4.0, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.0, d);
  gl_FragColor = vec4(vColor * (0.6 + a), a * vAlpha);
}`;

export interface EmitOptions {
  x: number; y: number; z: number;
  vx?: number; vy?: number; vz?: number;
  spread?: number;
  color: number;
  size: number;
  life: number;
  gravity?: number;
  drag?: number;
  count?: number;
  /** Additive particles glow; normal ones (smoke, dust) do not. */
}

/**
 * Pooled GPU point-sprite particles. A fixed capacity ring buffer means no
 * allocations during gameplay and a hard cap on cost.
 */
class ParticlePool {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private baseSize: Float32Array;
  private gravity: Float32Array;
  private drag: Float32Array;
  private cursor = 0;
  private geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;
  private tmpColor = new THREE.Color();
  active = 0;

  constructor(readonly capacity: number, additive: boolean) {
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.baseSize = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 300 }, uMax: { value: 64 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
  }

  setScale(viewportHeight: number): void {
    this.material.uniforms.uScale.value = viewportHeight * 0.5;
    this.material.uniforms.uMax.value = viewportHeight * 0.035;
  }

  emit(o: EmitOptions): void {
    const count = o.count ?? 1;
    const spread = o.spread ?? 0;
    this.tmpColor.setHex(o.color);
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;
      const i3 = i * 3;
      this.pos[i3] = o.x; this.pos[i3 + 1] = o.y; this.pos[i3 + 2] = o.z;
      this.vel[i3] = (o.vx ?? 0) + (Math.random() - 0.5) * spread;
      this.vel[i3 + 1] = (o.vy ?? 0) + (Math.random() - 0.5) * spread;
      this.vel[i3 + 2] = (o.vz ?? 0) + (Math.random() - 0.5) * spread;
      this.col[i3] = this.tmpColor.r; this.col[i3 + 1] = this.tmpColor.g; this.col[i3 + 2] = this.tmpColor.b;
      const l = o.life * (0.7 + Math.random() * 0.6);
      this.life[i] = l;
      this.maxLife[i] = l;
      this.baseSize[i] = o.size * (0.7 + Math.random() * 0.6);
      this.gravity[i] = o.gravity ?? 0;
      this.drag[i] = o.drag ?? 1;
    }
  }

  update(dt: number): void {
    let active = 0;
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) {
        if (this.alpha[i] !== 0) { this.alpha[i] = 0; this.size[i] = 0; }
        continue;
      }
      active++;
      this.life[i] -= dt;
      const i3 = i * 3;
      const damp = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i3] *= damp;
      this.vel[i3 + 1] = this.vel[i3 + 1] * damp - this.gravity[i] * dt;
      this.vel[i3 + 2] *= damp;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      this.alpha[i] = t;
      this.size[i] = this.baseSize[i] * (0.4 + (1 - t) * 0.9);
    }
    this.active = active;
    const g = this.geometry.attributes;
    g.position.needsUpdate = true;
    g.aColor.needsUpdate = true;
    g.aSize.needsUpdate = true;
    g.aAlpha.needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
    this.alpha.fill(0);
    this.size.fill(0);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

interface Ring {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  life: number;
  maxLife: number;
  maxScale: number;
}

/** All transient visual effects: glow particles, smoke/dust, shock rings, speed lines. */
export class Effects {
  readonly group = new THREE.Group();
  private glow: ParticlePool;
  private smoke: ParticlePool;
  private rings: Ring[] = [];
  private ringGeo = new THREE.RingGeometry(0.85, 1, 48);
  private speedLines: THREE.LineSegments;
  private speedLinePos: Float32Array;
  private speedLineMat: THREE.LineBasicMaterial;
  private readonly lineCount = 40;
  private lineSeeds: Float32Array;
  /** 0..1 multiplier from quality settings. */
  density = 1;

  constructor(capacity: number) {
    this.glow = new ParticlePool(capacity, true);
    this.smoke = new ParticlePool(Math.floor(capacity * 0.6), false);
    this.group.add(this.glow.points, this.smoke.points);
    this.ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 16; i++) {
      const material = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(this.ringGeo, material);
      mesh.visible = false;
      this.group.add(mesh);
      this.rings.push({ mesh, material, life: 0, maxLife: 1, maxScale: 1 });
    }
    // Speed lines live in camera space.
    this.speedLinePos = new Float32Array(this.lineCount * 6);
    this.lineSeeds = new Float32Array(this.lineCount * 3);
    for (let i = 0; i < this.lineCount; i++) this.seedLine(i, true);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.speedLinePos, 3).setUsage(THREE.DynamicDrawUsage));
    this.speedLineMat = new THREE.LineBasicMaterial({ color: 0xbff6ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.speedLines = new THREE.LineSegments(g, this.speedLineMat);
    this.speedLines.frustumCulled = false;
  }

  attachSpeedLines(camera: THREE.Camera): void {
    camera.add(this.speedLines);
  }

  private seedLine(i: number, randomDepth: boolean): void {
    const a = Math.random() * Math.PI * 2;
    const r = 2.2 + Math.random() * 4;
    this.lineSeeds[i * 3] = Math.cos(a) * r;
    this.lineSeeds[i * 3 + 1] = Math.sin(a) * r * 0.6;
    this.lineSeeds[i * 3 + 2] = randomDepth ? -Math.random() * 40 : -40;
  }

  setViewportHeight(h: number): void {
    this.glow.setScale(h);
    this.smoke.setScale(h);
  }

  spark(x: number, y: number, z: number, color: number, count = 6, speed = 10): void {
    this.glow.emit({ x, y, z, vy: speed * 0.4, spread: speed, color, size: 0.5, life: 0.45, gravity: 14, drag: 2, count: Math.ceil(count * this.density) });
  }

  glowBurst(x: number, y: number, z: number, color: number, count = 30, speed = 18, size = 1.4): void {
    this.glow.emit({ x, y, z, vy: 2, spread: speed, color, size, life: 0.7, gravity: 2, drag: 2.5, count: Math.ceil(count * this.density) });
  }

  trail(x: number, y: number, z: number, color: number, size = 0.7, life = 0.35): void {
    this.glow.emit({ x, y, z, spread: 0.6, color, size, life, drag: 3 });
  }

  smokePuff(x: number, y: number, z: number, color: number, size = 2, vy = 1.5, count = 1): void {
    if (Math.random() > this.density) return;
    this.smoke.emit({ x, y, z, vy, spread: 2, color, size, life: 1.1, drag: 1.5, count });
  }

  explosion(x: number, y: number, z: number, color: number): void {
    this.glowBurst(x, y + 0.8, z, color, 50, 26, 1.8);
    this.glowBurst(x, y + 0.8, z, 0xffffff, 16, 12, 2.4);
    this.smokePuff(x, y + 1, z, 0x2a2a30, 5, 3, 10);
    this.ring(x, y + 0.3, z, color, 14, 0.6);
  }

  ring(x: number, y: number, z: number, color: number, radius: number, life: number): void {
    const r = this.rings.find((q) => q.life <= 0) ?? this.rings[0];
    r.mesh.position.set(x, y, z);
    r.material.color.setHex(color);
    r.life = life;
    r.maxLife = life;
    r.maxScale = radius;
    r.mesh.visible = true;
  }

  update(dt: number, speedFraction: number, speedEffects: boolean): void {
    this.glow.update(dt);
    this.smoke.update(dt);
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      const t = 1 - Math.max(0, r.life) / r.maxLife;
      const s = 0.5 + t * r.maxScale;
      r.mesh.scale.set(s, 1, s);
      r.material.opacity = (1 - t) * 0.9;
      if (r.life <= 0) r.mesh.visible = false;
    }
    // Speed lines
    const intensity = speedEffects ? Math.max(0, (speedFraction - 0.55) / 0.45) : 0;
    this.speedLineMat.opacity = intensity * 0.22;
    this.speedLines.visible = intensity > 0.01;
    if (this.speedLines.visible) {
      const v = 60 + speedFraction * 90;
      for (let i = 0; i < this.lineCount; i++) {
        let z = this.lineSeeds[i * 3 + 2] + v * dt;
        if (z > -2) { this.seedLine(i, false); z = this.lineSeeds[i * 3 + 2]; }
        this.lineSeeds[i * 3 + 2] = z;
        const x = this.lineSeeds[i * 3], y = this.lineSeeds[i * 3 + 1];
        const len = 2 + speedFraction * 5;
        const o = i * 6;
        this.speedLinePos[o] = x; this.speedLinePos[o + 1] = y; this.speedLinePos[o + 2] = z;
        this.speedLinePos[o + 3] = x; this.speedLinePos[o + 4] = y; this.speedLinePos[o + 5] = z - len;
      }
      this.speedLines.geometry.attributes.position.needsUpdate = true;
    }
  }

  clear(): void {
    this.glow.clear();
    this.smoke.clear();
    for (const r of this.rings) { r.life = 0; r.mesh.visible = false; }
  }

  get activeParticles(): number {
    return this.glow.active + this.smoke.active;
  }

  dispose(): void {
    this.glow.dispose();
    this.smoke.dispose();
    this.ringGeo.dispose();
    for (const r of this.rings) r.material.dispose();
    this.speedLines.geometry.dispose();
    this.speedLineMat.dispose();
    this.speedLines.removeFromParent();
  }
}
