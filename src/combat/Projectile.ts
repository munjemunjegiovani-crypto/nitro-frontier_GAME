import * as THREE from 'three';
import type { Vehicle } from '../vehicles/Vehicle';

export type ProjectileKind = 'arc' | 'seeker';

export interface Projectile {
  active: boolean;
  kind: ProjectileKind;
  mesh: THREE.Object3D;
  x: number; y: number; z: number;
  heading: number;
  speed: number;
  life: number;
  owner: Vehicle | null;
  target: Vehicle | null;
  trackIndex: number;
  /** Lateral lane the projectile holds while following the road. */
  lateral: number;
}

/** Fixed-size pool of projectile meshes (no allocation during play). */
export class ProjectilePool {
  readonly items: Projectile[] = [];
  readonly group = new THREE.Group();
  private disposables: { dispose(): void }[] = [];

  constructor(capacity: number) {
    const arcGeo = new THREE.CapsuleGeometry(0.35, 2.6, 4, 8);
    arcGeo.rotateX(Math.PI / 2);
    const arcMat = new THREE.MeshBasicMaterial({ color: 0x9ff6ff });
    const arcGlowMat = new THREE.MeshBasicMaterial({ color: 0x20e3ff, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false });
    const seekerGeo = new THREE.OctahedronGeometry(0.75, 0);
    const seekerMat = new THREE.MeshStandardMaterial({ color: 0x1b1e26, emissive: 0xff7a1a, emissiveIntensity: 2.5, metalness: 0.6, roughness: 0.3 });
    const finGeo = new THREE.BoxGeometry(2.2, 0.08, 0.4);
    this.disposables.push(arcGeo, arcMat, arcGlowMat, seekerGeo, seekerMat, finGeo);

    for (let i = 0; i < capacity; i++) {
      const kind: ProjectileKind = i % 2 === 0 ? 'arc' : 'seeker';
      const mesh = new THREE.Group();
      if (kind === 'arc') {
        mesh.add(new THREE.Mesh(arcGeo, arcMat));
        const glow = new THREE.Mesh(arcGeo, arcGlowMat);
        glow.scale.setScalar(2.1);
        mesh.add(glow);
      } else {
        mesh.add(new THREE.Mesh(seekerGeo, seekerMat));
        mesh.add(new THREE.Mesh(finGeo, seekerMat));
      }
      mesh.visible = false;
      this.group.add(mesh);
      this.items.push({ active: false, kind, mesh, x: 0, y: 0, z: 0, heading: 0, speed: 0, life: 0, owner: null, target: null, trackIndex: -1, lateral: 0 });
    }
  }

  acquire(kind: ProjectileKind): Projectile | null {
    const p = this.items.find((q) => !q.active && q.kind === kind);
    if (!p) return null;
    p.active = true;
    p.mesh.visible = true;
    return p;
  }

  release(p: Projectile): void {
    p.active = false;
    p.mesh.visible = false;
    p.owner = null;
    p.target = null;
  }

  clear(): void {
    for (const p of this.items) this.release(p);
  }

  get activeCount(): number {
    return this.items.reduce((n, p) => n + (p.active ? 1 : 0), 0);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.group.removeFromParent();
  }
}
