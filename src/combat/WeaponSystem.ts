import * as THREE from 'three';
import { COMBAT } from '../config/GameConfig';
import type { Effects } from '../rendering/Effects';
import type { Track } from '../tracks/Track';
import type { Vehicle } from '../vehicles/Vehicle';
import { POWERUPS, rollPowerUp, type PowerUpType } from './PowerUp';
import { ProjectilePool, type Projectile } from './Projectile';

export type CombatEvent =
  | { type: 'pickup'; vehicle: Vehicle; powerUp: PowerUpType }
  | { type: 'fire'; vehicle: Vehicle; powerUp: PowerUpType }
  | { type: 'hit'; attacker: Vehicle | null; victim: Vehicle; weapon: PowerUpType }
  | { type: 'blocked'; attacker: Vehicle | null; victim: Vehicle }
  | { type: 'wrecked'; attacker: Vehicle | null; victim: Vehicle }
  | { type: 'respawn'; vehicle: Vehicle };

/** True when a racer is allowed to activate its held power-up right now. */
export function canActivate(v: { powerUp: PowerUpType | null; activationCooldown: number; wrecked: boolean }): boolean {
  return v.powerUp !== null && v.activationCooldown <= 0 && !v.wrecked;
}

interface Pickup {
  mesh: THREE.Group;
  x: number; y: number; z: number;
  respawn: number;
  index: number;
}

interface Snare {
  active: boolean;
  mesh: THREE.Group;
  x: number; y: number; z: number;
  life: number;
  owner: Vehicle | null;
}

const WEAPON_STATS = {
  arc: { damage: 30, spin: 0.85, speed: 115, life: 2.2 },
  seeker: { damage: 36, spin: 1.1, speed: 92, life: 6 },
  pulse: { damage: 16, radius: 17, push: 24 },
  snare: { radius: 9, life: 8, slow: 0.5 },
  shield: { time: 6 },
  nitro: { time: 2.6 },
} as const;

export class WeaponSystem {
  readonly group = new THREE.Group();
  private projectiles: ProjectilePool;
  private pickups: Pickup[] = [];
  private snares: Snare[] = [];
  private disposables: { dispose(): void }[] = [];
  private listeners: ((e: CombatEvent) => void)[] = [];
  private time = 0;
  allowOffensive = true;
  /** Practice mode: pickups respawn quickly. */
  fastRespawn = false;
  rand: () => number = Math.random;
  private tmp = new THREE.Vector3();

  constructor(private track: Track, private effects: Effects) {
    this.projectiles = new ProjectilePool(COMBAT.maxProjectiles);
    this.group.add(this.projectiles.group);
    this.buildPickups();
    this.buildSnares();
  }

  onEvent(fn: (e: CombatEvent) => void): void {
    this.listeners.push(fn);
  }

  private emit(e: CombatEvent): void {
    for (const l of this.listeners) l(e);
  }

  private buildPickups(): void {
    const cubeGeo = new THREE.IcosahedronGeometry(1.1, 0);
    const coreGeo = new THREE.OctahedronGeometry(0.55, 0);
    const shellMat = new THREE.MeshStandardMaterial({ color: 0x14161c, emissive: 0x20e3ff, emissiveIntensity: 1.2, metalness: 0.7, roughness: 0.25, transparent: true, opacity: 0.85, wireframe: true });
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xff7a1a });
    const baseGeo = new THREE.RingGeometry(1.3, 1.7, 24);
    baseGeo.rotateX(-Math.PI / 2);
    const baseMat = new THREE.MeshBasicMaterial({ color: 0x20e3ff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.disposables.push(cubeGeo, coreGeo, shellMat, coreMat, baseGeo, baseMat);
    for (const u of this.track.def.pickupRows) {
      const index = this.track.indexAt(u);
      const s = this.track.sample(index);
      for (const lane of [-0.55, 0, 0.55]) {
        const g = new THREE.Group();
        const shell = new THREE.Mesh(cubeGeo, shellMat);
        const core = new THREE.Mesh(coreGeo, coreMat);
        const base = new THREE.Mesh(baseGeo, baseMat);
        base.position.y = -1.25;
        g.add(shell, core, base);
        const p = s.pos.clone().addScaledVector(s.right, lane * s.halfWidth * 0.8);
        g.position.set(p.x, p.y + 1.4, p.z);
        this.group.add(g);
        this.pickups.push({ mesh: g, x: p.x, y: p.y + 1.4, z: p.z, respawn: 0, index });
      }
    }
  }

  private buildSnares(): void {
    const discGeo = new THREE.CircleGeometry(WEAPON_STATS.snare.radius, 40);
    discGeo.rotateX(-Math.PI / 2);
    const discMat = new THREE.MeshBasicMaterial({ color: 0x9b5cff, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false });
    const ringGeo = new THREE.TorusGeometry(WEAPON_STATS.snare.radius, 0.18, 6, 48);
    ringGeo.rotateX(Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xc9a4ff });
    const coreGeo = new THREE.TorusKnotGeometry(0.9, 0.22, 48, 6);
    this.disposables.push(discGeo, discMat, ringGeo, ringMat, coreGeo);
    for (let i = 0; i < COMBAT.maxSnares; i++) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(discGeo, discMat));
      const r1 = new THREE.Mesh(ringGeo, ringMat);
      r1.position.y = 0.3;
      const r2 = r1.clone();
      r2.scale.setScalar(0.6);
      r2.position.y = 1.2;
      const core = new THREE.Mesh(coreGeo, ringMat);
      core.position.y = 2;
      g.add(r1, r2, core);
      g.visible = false;
      this.group.add(g);
      this.snares.push({ active: false, mesh: g, x: 0, y: 0, z: 0, life: 0, owner: null });
    }
  }

  reset(): void {
    this.projectiles.clear();
    for (const p of this.pickups) { p.respawn = 0; p.mesh.visible = true; }
    for (const s of this.snares) { s.active = false; s.mesh.visible = false; s.owner = null; }
  }

  /** Activate the vehicle's held power-up. Returns true when something fired. */
  activate(v: Vehicle, vehicles: readonly Vehicle[]): boolean {
    if (!canActivate(v)) return false;
    const type = v.powerUp!;
    v.powerUp = null;
    v.activationCooldown = COMBAT.activationCooldown;
    const p = v.physics;
    const fx = p.forwardX, fz = p.forwardZ;
    switch (type) {
      case 'arc':
      case 'seeker': {
        const proj = this.projectiles.acquire(type);
        if (!proj) return false;
        proj.owner = v;
        proj.x = p.x + fx * 3.5;
        proj.z = p.z + fz * 3.5;
        proj.y = p.y + 1;
        proj.heading = p.heading;
        proj.speed = WEAPON_STATS[type].speed + Math.max(0, p.forwardSpeed) * (type === 'arc' ? 1 : 0.55);
        proj.life = WEAPON_STATS[type].life;
        proj.trackIndex = p.trackIndex;
        proj.lateral = p.lateral;
        proj.target = type === 'seeker' ? this.findTargetAhead(v, vehicles) : null;
        this.effects.glowBurst(proj.x, proj.y, proj.z, POWERUPS[type].color, 12, 8, 1);
        break;
      }
      case 'shield':
        v.shieldTime = WEAPON_STATS.shield.time;
        this.effects.ring(p.x, p.y + 0.5, p.z, 0x7cf7ff, 5, 0.5);
        break;
      case 'nitro':
        v.nitroSurgeTime = WEAPON_STATS.nitro.time;
        p.nitro = Math.min(1, p.nitro + 0.3);
        this.effects.glowBurst(p.x - fx * 3, p.y + 0.6, p.z - fz * 3, 0xffd23f, 24, 10, 1.2);
        break;
      case 'pulse':
        this.firePulse(v, vehicles);
        break;
      case 'snare': {
        const s = this.snares.find((q) => !q.active) ?? this.snares.reduce((a, b) => (a.life < b.life ? a : b));
        s.active = true;
        s.owner = v;
        s.x = p.x - fx * 6;
        s.z = p.z - fz * 6;
        const q = this.track.query({ x: s.x, y: p.y, z: s.z } as THREE.Vector3, p.trackIndex);
        s.y = q.height + 0.08;
        s.life = WEAPON_STATS.snare.life;
        s.mesh.position.set(s.x, s.y, s.z);
        s.mesh.visible = true;
        break;
      }
    }
    this.emit({ type: 'fire', vehicle: v, powerUp: type });
    return true;
  }

  /** The nearest rival ahead in race order, within a sensible range. */
  findTargetAhead(v: Vehicle, vehicles: readonly Vehicle[]): Vehicle | null {
    let best: Vehicle | null = null;
    let bestGap = Infinity;
    for (const o of vehicles) {
      if (o === v || o.wrecked) continue;
      const gap = o.progress.progress - v.progress.progress;
      if (gap > 0.5 && gap < 140 && gap < bestGap) { bestGap = gap; best = o; }
    }
    if (best) return best;
    // Nobody ahead: target the closest rival in front of the car.
    let bestD = Infinity;
    for (const o of vehicles) {
      if (o === v || o.wrecked) continue;
      const dx = o.physics.x - v.physics.x, dz = o.physics.z - v.physics.z;
      const ahead = dx * v.physics.forwardX + dz * v.physics.forwardZ;
      const d = Math.hypot(dx, dz);
      if (ahead > 0 && d < 120 && d < bestD) { bestD = d; best = o; }
    }
    return best;
  }

  private firePulse(v: Vehicle, vehicles: readonly Vehicle[]): void {
    const p = v.physics;
    const R = WEAPON_STATS.pulse.radius;
    this.effects.ring(p.x, p.y + 0.6, p.z, 0xff2fb4, R, 0.55);
    this.effects.glowBurst(p.x, p.y + 1, p.z, 0xff2fb4, 30, 22, 1.2);
    for (const o of vehicles) {
      if (o === v || o.wrecked) continue;
      const dx = o.physics.x - p.x, dz = o.physics.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > R || Math.abs(o.physics.y - p.y) > 6) continue;
      if (o.shielded) { this.emit({ type: 'blocked', attacker: v, victim: o }); continue; }
      const f = (1 - d / R) * 0.6 + 0.4;
      const nx = dx / (d || 1), nz = dz / (d || 1);
      o.physics.vx = o.physics.vx * 0.62 + nx * WEAPON_STATS.pulse.push * f;
      o.physics.vz = o.physics.vz * 0.62 + nz * WEAPON_STATS.pulse.push * f;
      o.physics.spin = Math.max(o.physics.spin, 0.35);
      this.damage(o, WEAPON_STATS.pulse.damage * f, v, 'pulse');
    }
  }

  private damage(victim: Vehicle, amount: number, attacker: Vehicle | null, weapon: PowerUpType): void {
    victim.health -= amount * victim.config.durability;
    if (attacker) attacker.hitsLanded++;
    this.emit({ type: 'hit', attacker, victim, weapon });
    if (victim.health <= 0) this.wreck(victim, attacker);
  }

  /** Destroy a vehicle; it respawns on the track centre line shortly after. */
  wreck(victim: Vehicle, attacker: Vehicle | null): void {
    if (victim.wrecked) return;
    const p = victim.physics;
    this.effects.explosion(p.x, p.y, p.z, victim.config.accent);
    victim.wreckedTime = COMBAT.wreckRespawnSeconds;
    victim.health = 0;
    p.vx *= 0.2; p.vz *= 0.2;
    this.emit({ type: 'wrecked', attacker, victim });
  }

  private hitWithProjectile(proj: Projectile, victim: Vehicle): void {
    const kind = proj.kind;
    this.effects.glowBurst(proj.x, proj.y, proj.z, POWERUPS[kind].color, 36, 20, 1.5);
    this.effects.ring(proj.x, proj.y - 0.6, proj.z, POWERUPS[kind].color, 6, 0.4);
    if (victim.shielded) {
      this.emit({ type: 'blocked', attacker: proj.owner, victim });
      return;
    }
    const st = WEAPON_STATS[kind];
    victim.physics.spin = Math.max(victim.physics.spin, st.spin);
    victim.physics.vx *= 0.45;
    victim.physics.vz *= 0.45;
    victim.physics.vy = Math.max(victim.physics.vy, 6);
    victim.physics.grounded = false;
    this.damage(victim, st.damage, proj.owner, kind);
  }

  update(dt: number, vehicles: readonly Vehicle[], positionOf: (v: Vehicle) => number): void {
    this.time += dt;
    // Pickups
    for (const pk of this.pickups) {
      if (pk.respawn > 0) {
        pk.respawn -= dt;
        if (pk.respawn <= 0) {
          pk.mesh.visible = true;
          this.effects.glowBurst(pk.x, pk.y, pk.z, 0x20e3ff, 10, 6, 0.8);
        }
        continue;
      }
      pk.mesh.rotation.y = this.time * 1.8;
      pk.mesh.children[0].rotation.x = this.time * 1.1;
      pk.mesh.position.y = pk.y + Math.sin(this.time * 3 + pk.x) * 0.25;
      for (const v of vehicles) {
        if (v.powerUp || v.wrecked) continue;
        const dx = v.physics.x - pk.x, dz = v.physics.z - pk.z;
        if (dx * dx + dz * dz < 9 && Math.abs(v.physics.y + 1 - pk.y) < 4) {
          v.powerUp = rollPowerUp(positionOf(v), vehicles.length, this.rand, this.allowOffensive);
          pk.respawn = this.fastRespawn ? 1.5 : COMBAT.pickupRespawnSeconds;
          pk.mesh.visible = false;
          this.effects.glowBurst(pk.x, pk.y, pk.z, POWERUPS[v.powerUp].color, 20, 12, 1);
          this.emit({ type: 'pickup', vehicle: v, powerUp: v.powerUp });
          break;
        }
      }
    }

    // Projectiles
    for (const proj of this.projectiles.items) {
      if (!proj.active) continue;
      proj.life -= dt;
      if (proj.life <= 0) { this.projectiles.release(proj); continue; }
      // Projectiles ride the road: they steer toward a point further along
      // the track in their lane, so a well-aimed shot survives corners.
      let turnRate = 6;
      let lane = proj.lateral;
      let homeX: number | null = null;
      let homeZ = 0;
      if (proj.kind === 'seeker') {
        if (proj.target && proj.target.wrecked) proj.target = null;
        turnRate = 4.5;
        if (proj.target) {
          const t = proj.target.physics;
          const d = Math.hypot(t.x - proj.x, t.z - proj.z);
          if (d < 38) { homeX = t.x; homeZ = t.z; }
          else lane = proj.lateral += (t.lateral - proj.lateral) * Math.min(1, 2 * dt);
        }
        this.effects.trail(proj.x, proj.y, proj.z, 0xff7a1a, 0.9, 0.5);
      } else {
        this.effects.trail(proj.x, proj.y, proj.z, 0x20e3ff, 0.8, 0.25);
      }
      let desired: number;
      if (homeX !== null) {
        desired = Math.atan2(homeX - proj.x, homeZ - proj.z);
      } else {
        const ahead = this.track.pointAt(proj.trackIndex + 7, lane, this.tmp);
        desired = Math.atan2(ahead.x - proj.x, ahead.z - proj.z);
      }
      let dh = desired - proj.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      proj.heading += THREE.MathUtils.clamp(dh, -turnRate * dt, turnRate * dt);
      proj.x += Math.sin(proj.heading) * proj.speed * dt;
      proj.z += Math.cos(proj.heading) * proj.speed * dt;
      const q = this.track.query({ x: proj.x, y: proj.y, z: proj.z } as THREE.Vector3, proj.trackIndex);
      proj.trackIndex = q.index;
      proj.y += (q.height + 1 - proj.y) * Math.min(1, 10 * dt);
      proj.mesh.position.set(proj.x, proj.y, proj.z);
      proj.mesh.rotation.set(0, proj.heading, proj.kind === 'seeker' ? this.time * 8 : 0);
      if (Math.abs(q.lateral) > q.sample.halfWidth + 1) {
        this.effects.glowBurst(proj.x, proj.y, proj.z, POWERUPS[proj.kind].color, 16, 12, 1);
        this.projectiles.release(proj);
        continue;
      }
      for (const v of vehicles) {
        if (v === proj.owner || v.wrecked) continue;
        const dx = v.physics.x - proj.x, dz = v.physics.z - proj.z, dy = v.physics.y + 0.8 - proj.y;
        if (dx * dx + dz * dz + dy * dy < (proj.kind === 'arc' ? 11 : 9)) {
          this.hitWithProjectile(proj, v);
          this.projectiles.release(proj);
          break;
        }
      }
    }

    // Snares
    for (const s of this.snares) {
      if (!s.active) continue;
      s.life -= dt;
      const fade = Math.min(1, s.life);
      s.mesh.scale.setScalar(Math.max(0.01, fade));
      s.mesh.children[1].rotation.z = this.time * 2;
      s.mesh.children[3].rotation.y = this.time * 3;
      if (Math.random() < 0.5) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * WEAPON_STATS.snare.radius;
        this.effects.trail(s.x + Math.cos(a) * r, s.y + 0.2, s.z + Math.sin(a) * r, 0x9b5cff, 0.6, 0.8);
      }
      if (s.life <= 0) { s.active = false; s.mesh.visible = false; s.owner = null; continue; }
      const R2 = WEAPON_STATS.snare.radius ** 2;
      for (const v of vehicles) {
        if (v === s.owner || v.wrecked || v.shielded) continue;
        const dx = v.physics.x - s.x, dz = v.physics.z - s.z;
        if (dx * dx + dz * dz < R2 && Math.abs(v.physics.y - s.y) < 4) {
          v.snareFactor = Math.min(v.snareFactor, WEAPON_STATS.snare.slow);
          if (Math.random() < 0.3) this.effects.spark(v.physics.x, v.physics.y + 0.5, v.physics.z, 0x9b5cff, 2, 4);
        }
      }
    }
  }

  get activeProjectiles(): number {
    return this.projectiles.activeCount;
  }

  /** Pickup positions for AI targeting. */
  get pickupList(): readonly { x: number; z: number; index: number; available: boolean }[] {
    return this.pickups.map((p) => ({ x: p.x, z: p.z, index: p.index, available: p.respawn <= 0 }));
  }

  /** Incoming projectiles near a vehicle (AI uses this to raise a shield). */
  threatTo(v: Vehicle): boolean {
    for (const proj of this.projectiles.items) {
      if (!proj.active || proj.owner === v) continue;
      if (proj.target === v) return true;
      const dx = v.physics.x - proj.x, dz = v.physics.z - proj.z;
      if (dx * dx + dz * dz < 600) return true;
    }
    return false;
  }

  dispose(): void {
    this.projectiles.dispose();
    for (const d of this.disposables) d.dispose();
    this.group.removeFromParent();
  }
}
