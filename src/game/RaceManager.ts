import * as THREE from 'three';
import { AIDriver, type AIStyle } from '../ai/AIDriver';
import { RacingLine } from '../ai/RacingLine';
import { WeaponSystem, type CombatEvent } from '../combat/WeaponSystem';
import { POWERUP_ORDER, POWERUPS } from '../combat/PowerUp';
import { COMBAT, PHYSICS, RACE } from '../config/GameConfig';
import { Effects } from '../rendering/Effects';
import { Lighting } from '../rendering/Lighting';
import { RaceProgress, rankRacers } from '../tracks/CheckpointSystem';
import { Track } from '../tracks/Track';
import { buildTrack, type BuiltTrack, type Quality } from '../tracks/TrackFactory';
import { getTrack } from '../tracks/TrackRegistry';
import { Vehicle } from '../vehicles/Vehicle';
import { VEHICLES, getVehicle } from '../vehicles/VehicleConfig';
import type { DriveInput } from '../vehicles/VehiclePhysics';
import type { RacerResult } from './RaceResults';

export type GameMode = 'quick' | 'timeTrial' | 'championship' | 'practice';

export interface RaceSetup {
  mode: GameMode;
  trackId: string;
  vehicleId: string;
  laps: number;
  opponents: number;
  /** Stable ids/names for championship opponents across races. */
  rivals?: { id: number; name: string; vehicleId: string; style: AIStyle }[];
}

export type SoundName = Parameters<import('../audio/AudioManager').AudioManager['play']>[0];

export interface RaceHooks {
  notify(text: string, color?: string, big?: boolean): void;
  sound(name: SoundName, intensity?: number): void;
  shake(amount: number): void;
  countdown(n: number): void;
  finished(results: RacerResult[], playerTime: number | null): void;
}

const AI_NAMES = ['RAZE', 'NOVA', 'JINX', 'VEGA', 'KODA', 'ONYX', 'SABLE'];
const AI_STYLE_ORDER: AIStyle[] = ['aggressive', 'balanced', 'speed', 'defensive', 'balanced', 'aggressive'];

/** Seeded RNG so AI personalities are reproducible per race. */
function rng(seed: number): () => number {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

export function defaultRivals(playerVehicleId: string, count: number): NonNullable<RaceSetup['rivals']> {
  const pool = VEHICLES.filter((v) => v.id !== playerVehicleId);
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: AI_NAMES[i % AI_NAMES.length],
    vehicleId: pool[i % pool.length].id,
    style: AI_STYLE_ORDER[i % AI_STYLE_ORDER.length],
  }));
}

export class RaceManager {
  readonly track: Track;
  readonly built: BuiltTrack;
  readonly lighting: Lighting;
  readonly effects: Effects;
  readonly weapons: WeaponSystem;
  readonly line: RacingLine;
  readonly vehicles: Vehicle[] = [];
  readonly player: Vehicle;
  private drivers = new Map<Vehicle, AIDriver>();
  private autopilot: AIDriver;
  readonly root = new THREE.Group();

  raceTime = 0;
  countdown: number = RACE.countdownSeconds;
  private lastCountdownShown = -1;
  started = false;
  playerFinished = false;
  private finishWait = 0;
  private resultsSent = false;
  private resetCooldown = 0;
  private standings: Vehicle[] = [];
  private prevIndex = new Map<Vehicle, number>();
  private tmpV = new THREE.Vector3();
  playerLastLap: number | null = null;
  speedEffects = true;

  constructor(
    readonly setup: RaceSetup,
    readonly scene: THREE.Scene,
    quality: Quality,
    private hooks: RaceHooks,
  ) {
    const def = getTrack(setup.trackId);
    this.track = new Track(def);
    this.built = buildTrack(this.track, quality);
    this.lighting = new Lighting(def.theme, quality === 'high' ? 2048 : quality === 'medium' ? 1024 : 0);
    this.effects = new Effects(quality === 'low' ? 1200 : quality === 'medium' ? 2400 : 4000);
    this.effects.density = quality === 'low' ? 0.5 : quality === 'medium' ? 0.8 : 1;
    this.weapons = new WeaponSystem(this.track, this.effects);
    this.weapons.allowOffensive = setup.mode !== 'timeTrial';
    this.weapons.fastRespawn = setup.mode === 'practice';
    this.line = new RacingLine(this.track);
    scene.fog = new THREE.FogExp2(def.theme.fog, def.theme.fogDensity);
    this.root.add(this.built.group, this.lighting.group, this.effects.group, this.weapons.group);
    scene.add(this.root);

    const total = 1 + setup.opponents;
    const laps = setup.mode === 'practice' ? Number.MAX_SAFE_INTEGER : setup.laps;
    const night = def.theme.night;
    this.player = new Vehicle(0, 'YOU', getVehicle(setup.vehicleId), true, night || def.tunnels.length > 0);
    this.vehicles.push(this.player);
    const rivals = setup.rivals ?? defaultRivals(setup.vehicleId, setup.opponents);
    const rand = rng(def.id.length * 31 + setup.vehicleId.length * 7 + 1);
    for (const r of rivals.slice(0, setup.opponents)) {
      const v = new Vehicle(r.id, r.name, getVehicle(r.vehicleId), false, false);
      this.vehicles.push(v);
      const d = new AIDriver(v, r.style, this.track, this.line, rand);
      d.skill = 0.94 + rand() * 0.08;
      if (setup.mode === 'practice') d.skill = 0.72;
      this.drivers.set(v, d);
    }
    this.autopilot = new AIDriver(this.player, 'balanced', this.track, this.line, rand);
    // Grid: player starts mid-pack in races so there's someone to chase and someone to fend off.
    const playerSlot = setup.opponents > 0 ? Math.min(total - 1, 3) : 0;
    const order = this.vehicles.filter((v) => v !== this.player);
    order.splice(playerSlot, 0, this.player);
    order.forEach((v, slot) => {
      const g = this.track.gridSlot(slot);
      v.physics.place(this.track, g.index, g.lateral);
      v.progress = new RaceProgress(this.track.count, RACE.checkpointsPerLap, laps, g.index);
      v.resetCombat();
      this.root.add(v.model.root);
      this.prevIndex.set(v, g.index);
      v.syncVisual(0, 0);
    });
    this.standings = [...this.vehicles];
    this.updatePositions();

    this.weapons.onEvent((e) => this.onCombat(e));
  }

  private onCombat(e: CombatEvent): void {
    const P = this.player;
    switch (e.type) {
      case 'pickup':
        if (e.vehicle === P) {
          this.hooks.sound('pickup');
          this.hooks.notify(POWERUPS[e.powerUp].name, POWERUPS[e.powerUp].css);
        }
        break;
      case 'fire':
        if (e.vehicle === P || this.near(e.vehicle, 60)) this.hooks.sound(e.powerUp === 'arc' ? 'arc' : e.powerUp, e.vehicle === P ? 1 : 0.5);
        break;
      case 'hit':
        if (e.victim === P) {
          this.hooks.shake(0.9);
          this.hooks.sound('hit', 1);
          this.hooks.notify(`HIT BY ${e.attacker?.name ?? 'HAZARD'}`, '#ff4d6d');
        } else if (e.attacker === P) {
          this.hooks.sound('hit', 0.6);
          this.hooks.notify(`${POWERUPS[e.weapon].short} HIT · ${e.victim.name}`, '#20e3ff');
        } else if (this.near(e.victim, 50)) this.hooks.sound('hit', 0.4);
        break;
      case 'blocked':
        if (e.victim === P || e.attacker === P) {
          this.hooks.sound('blocked');
          this.hooks.notify(e.victim === P ? 'SHIELD BLOCKED' : `${e.victim.name} BLOCKED`, '#7cf7ff');
        }
        break;
      case 'wrecked':
        this.hooks.sound('explosion', this.near(e.victim, 80) ? 1 : 0.4);
        if (e.victim === P) { this.hooks.shake(1.4); this.hooks.notify('WRECKED!', '#ff4d6d', true); }
        else if (e.attacker === P) this.hooks.notify(`WRECKED ${e.victim.name}!`, '#ff7a1a', true);
        break;
      case 'respawn':
        break;
    }
  }

  private near(v: Vehicle, dist: number): boolean {
    const a = v.physics, b = this.player.physics;
    return Math.hypot(a.x - b.x, a.z - b.z) < dist;
  }

  /** Activate the player's power-up. */
  playerFire(): void {
    if (!this.started || this.player.wrecked || this.playerFinished) return;
    this.weapons.activate(this.player, this.vehicles);
  }

  /** Practice mode: grant a specific power-up. */
  grant(i: number): void {
    if (this.setup.mode !== 'practice') return;
    const p = POWERUP_ORDER[i - 1];
    if (p) {
      this.player.powerUp = p;
      this.hooks.notify(POWERUPS[p].name, POWERUPS[p].css);
    }
  }

  /** Manual recovery (R). Allowed when slow, off-line or stuck. */
  playerReset(): void {
    if (!this.started || this.resetCooldown > 0 || this.player.wrecked || this.playerFinished) return;
    this.respawn(this.player);
    this.resetCooldown = 1.5;
    this.hooks.notify('RECOVERED', '#ffd23f');
  }

  private respawn(v: Vehicle): void {
    const idx = v.physics.trackIndex >= 0 ? v.physics.trackIndex : 0;
    // Pick a free lane near the centre.
    let lateral = 0;
    for (const lane of [0, -5, 5, -9, 9]) {
      const pos = this.track.pointAt(idx, lane, this.tmpV);
      const blocked = this.vehicles.some((o) => o !== v && !o.wrecked && Math.hypot(o.physics.x - pos.x, o.physics.z - pos.z) < 5);
      if (!blocked) { lateral = lane; break; }
    }
    v.physics.place(this.track, idx, lateral);
    v.physics.vx = v.physics.forwardX * 18;
    v.physics.vz = v.physics.forwardZ * 18;
    v.invulnerableTime = COMBAT.postRespawnInvulnerable;
    v.stuckTime = 0;
    v.offTrackTime = 0;
    v.model.body.rotation.set(0, 0, 0);
    this.effects.glowBurst(v.physics.x, v.physics.y + 1, v.physics.z, 0x20e3ff, 20, 8, 1.2);
  }

  get playerPosition(): number {
    return this.player.position;
  }

  get ranked(): readonly Vehicle[] {
    return this.standings;
  }

  private updatePositions(): void {
    const ranked = rankRacers(this.vehicles.map((v) => ({
      id: v.id, finished: v.progress.finished, finishTime: v.progress.finishTime, progress: v.progress.progress, v,
    })));
    ranked.forEach((r, i) => (r.v.position = i + 1));
    this.standings = ranked.map((r) => r.v);
  }

  update(dt: number, playerInput: DriveInput, time: number): void {
    // ---- Countdown
    if (!this.started) {
      this.countdown -= dt;
      const shown = Math.ceil(this.countdown);
      if (shown !== this.lastCountdownShown && shown >= 0) {
        this.lastCountdownShown = shown;
        this.hooks.countdown(shown);
        this.hooks.sound(shown > 0 ? 'countdown' : 'go');
      }
      if (this.countdown <= 0) this.started = true;
    } else {
      this.raceTime += dt;
    }
    this.resetCooldown = Math.max(0, this.resetCooldown - dt);

    // ---- Combat (sets snare factors before vehicles step)
    if (this.started) this.weapons.update(dt, this.vehicles, (v) => v.position);

    // ---- Inputs
    for (const v of this.vehicles) {
      if (v === this.player) {
        if (this.playerFinished) this.autopilot.update(dt, this.vehicles, null, true);
        else Object.assign(v.input, playerInput);
      } else {
        const d = this.drivers.get(v)!;
        // Mild, invisible catch-up so races stay close (never teleports).
        const gap = (v.progress.progress - this.player.progress.progress) / this.track.count;
        d.catchUp = this.setup.mode === 'practice' ? 1 : THREE.MathUtils.clamp(1 - gap * 0.12, 0.95, 1.06);
        d.update(dt, this.vehicles, this.setup.mode === 'practice' ? null : this.weapons, this.started && !v.progress.finished);
        if (v.progress.finished) { v.input.throttle = 0.4; v.input.brake = 0; }
      }
      if (!this.started) {
        // Hold cars on the grid; allow revving.
        v.input.boost = false;
      }
    }

    // ---- Physics (fixed sub-steps for stability)
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (const v of this.vehicles) {
      v.updateEffects(dt);
      if (v.wrecked) {
        v.wreckedTime -= dt;
        if (v.wreckedTime <= 0) {
          v.wreckedTime = 0;
          v.health = COMBAT.maxHealth;
          this.respawn(v);
        }
        continue;
      }
      if (!this.started) {
        v.physics.vx = v.physics.vz = 0;
        continue;
      }
      let wallImpact = 0;
      let wallSide = 0;
      for (let s = 0; s < steps; s++) {
        const wasAir = !v.physics.grounded;
        const hit = v.physics.step(v.input, h, this.track, true);
        if (hit && hit.impact > wallImpact) { wallImpact = hit.impact; wallSide = hit.side; }
        if (wasAir && v.physics.grounded && v === this.player && v.physics.airTime > 0.35) {
          this.hooks.sound('land');
          this.hooks.shake(0.25);
        }
      }
      if (wallImpact > 0.5) this.onWall(v, wallImpact, wallSide);
      this.checkTrackFeatures(v);
      this.checkOffTrack(v, dt);
    }

    this.collideVehicles();

    // ---- Progress / laps
    if (this.started) {
      for (const v of this.vehicles) {
        const ev = v.progress.update(v.physics.trackIndex, this.raceTime);
        if (ev && v.progress.lapTimes.length) {
          const lt = v.progress.lapTimes[v.progress.lapTimes.length - 1];
          if (v.bestLap === null || lt < v.bestLap) v.bestLap = lt;
          if (v === this.player) this.playerLastLap = lt;
        }
        if (v === this.player && ev === 'lap') {
          this.hooks.sound('lap');
          const lap = v.progress.lap;
          this.hooks.notify(lap === this.setup.laps ? 'FINAL LAP' : `LAP ${lap}`, '#ffd23f', true);
        }
        if (v === this.player && ev === 'finish') {
          this.playerFinished = true;
          this.hooks.sound('finish');
        }
      }
      this.updatePositions();
    }

    // ---- Finish handling
    if (this.playerFinished && !this.resultsSent) {
      this.finishWait += dt;
      const allDone = this.vehicles.every((v) => v.progress.finished);
      if (allDone || this.finishWait > RACE.finishGraceSeconds || this.setup.opponents === 0) {
        this.resultsSent = true;
        this.hooks.finished(this.buildResults(), this.player.progress.finishTime);
      }
    }

    // ---- Visuals
    for (const v of this.vehicles) {
      v.syncVisual(dt, time);
      this.emitVehicleFx(v);
    }
    const pp = this.player.physics;
    this.lighting.follow(this.tmpV.set(pp.x, pp.y, pp.z));
    this.built.boostTexture.offset.y -= dt * 1.6;
    this.effects.update(dt, pp.speed / this.player.config.maxSpeed, this.speedEffects);
  }

  private onWall(v: Vehicle, impact: number, side: number): void {
    const p = v.physics;
    // Right vector for heading h is (-cos h, sin h) = (-forwardZ, forwardX).
    const sx = p.x - p.forwardZ * side * 1.1, sz = p.z + p.forwardX * side * 1.1;
    this.effects.spark(sx, p.y + 0.5, sz, 0xffc070, Math.min(14, 2 + impact), 9);
    if (v === this.player) {
      this.hooks.sound('wall', impact / 6);
      if (impact > 8) this.hooks.shake(Math.min(0.6, impact * 0.03));
    }
  }

  private checkTrackFeatures(v: Vehicle): void {
    const p = v.physics;
    const prev = this.prevIndex.get(v) ?? p.trackIndex;
    this.prevIndex.set(v, p.trackIndex);
    const n = this.track.count;
    const crossed = (i: number) => {
      const a = (i - prev + n) % n;
      const b = (p.trackIndex - prev + n) % n;
      return a > 0 && a <= b && b < 20;
    };
    // Jump ramps
    for (const lip of this.track.jumpIndices) {
      if (crossed(lip) && p.grounded && p.forwardSpeed > 25) {
        p.launch(Math.min(17, 6 + p.forwardSpeed * 0.13));
        if (v === this.player) this.hooks.notify('AIRTIME!', '#ff7a1a');
      }
    }
    // Boost pads
    for (const u of this.track.def.boostPads) {
      const i = this.track.indexAt(u);
      const d = (p.trackIndex - i + n) % n;
      if (d <= 5 && p.grounded && Math.abs(p.lateral) < this.track.sample(i).halfWidth * 0.55) {
        if (v.nitroSurgeTime < 0.9) {
          if (v === this.player && v.nitroSurgeTime <= 0) { this.hooks.sound('boostpad'); this.hooks.shake(0.15); }
          v.nitroSurgeTime = Math.max(v.nitroSurgeTime, 1.0);
          p.nitro = Math.min(1, p.nitro + 0.004);
        }
      }
    }
  }

  private checkOffTrack(v: Vehicle, dt: number): void {
    const p = v.physics;
    const fell = p.y < this.built.groundY - 4 || Math.abs(p.lateral) > this.track.sample(p.trackIndex).halfWidth + 6;
    if (fell) {
      v.offTrackTime += dt;
      if (v.offTrackTime > 0.3) this.respawn(v);
    } else v.offTrackTime = 0;
    // Player stuck detection → auto-recover after a while.
    if (v === this.player && !this.playerFinished) {
      if (p.speed < PHYSICS.stuckSpeedThreshold && (v.input.throttle > 0 || v.input.brake > 0)) {
        v.stuckTime += dt;
        if (v.stuckTime > PHYSICS.stuckSeconds * 2) { this.respawn(v); this.hooks.notify('RECOVERED', '#ffd23f'); }
      } else v.stuckTime = 0;
    } else if (v.stuckTime > PHYSICS.stuckSeconds + 1.2) {
      this.respawn(v);
    }
  }

  private collideVehicles(): void {
    const R = PHYSICS.carRadius;
    const vs = this.vehicles;
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i];
      if (a.wrecked) continue;
      for (let j = i + 1; j < vs.length; j++) {
        const b = vs[j];
        if (b.wrecked) continue;
        const pa = a.physics, pb = b.physics;
        if (Math.abs(pa.y - pb.y) > 3) continue;
        // Elongated cars: test two circles per car along its heading.
        let hit = false;
        for (const oa of [-1.1, 1.1]) {
          for (const ob of [-1.1, 1.1]) {
            const ax = pa.x + pa.forwardX * oa, az = pa.z + pa.forwardZ * oa;
            const bx = pb.x + pb.forwardX * ob, bz = pb.z + pb.forwardZ * ob;
            const dx = bx - ax, dz = bz - az;
            const d2 = dx * dx + dz * dz;
            if (d2 < (R * 1.9) ** 2 && d2 > 1e-6 && !hit) {
              hit = true;
              const d = Math.sqrt(d2);
              const nx = dx / d, nz = dz / d;
              const overlap = R * 1.9 - d;
              const ma = a.config.mass, mb = b.config.mass;
              const wa = mb / (ma + mb), wb = ma / (ma + mb);
              pa.x -= nx * overlap * wa; pa.z -= nz * overlap * wa;
              pb.x += nx * overlap * wb; pb.z += nz * overlap * wb;
              const rel = (pb.vx - pa.vx) * nx + (pb.vz - pa.vz) * nz;
              if (rel < 0) {
                const jimp = -(1 + PHYSICS.carCollisionRestitution) * rel / (1 / ma + 1 / mb);
                pa.vx -= (jimp / ma) * nx; pa.vz -= (jimp / ma) * nz;
                pb.vx += (jimp / mb) * nx; pb.vz += (jimp / mb) * nz;
                if (-rel > 4) {
                  this.effects.spark((pa.x + pb.x) / 2, pa.y + 0.7, (pa.z + pb.z) / 2, 0xffffff, Math.min(12, -rel), 8);
                  if (a === this.player || b === this.player) {
                    this.hooks.sound('wall', -rel / 5);
                    this.hooks.shake(Math.min(0.5, -rel * 0.03));
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  private emitVehicleFx(v: Vehicle): void {
    if (v.wrecked || !this.started) return;
    const p = v.physics;
    if (!this.near(v, 160)) return;
    const back = v.config.shape.length * 0.45;
    const bx = p.x - p.forwardX * back, bz = p.z - p.forwardZ * back;
    const scenery = this.track.def.scenery;
    if ((p.drifting || p.slip > 9) && p.grounded) {
      const c = scenery === 'canyon' ? 0xc58a5a : 0x8c8f99;
      this.effects.smokePuff(bx, p.y + 0.4, bz, c, 2.4, 1.2);
    }
    if (p.boosting || v.nitroSurgeTime > 0) {
      const col = v.nitroSurgeTime > 0 ? 0xffd23f : 0x54e8ff;
      if (Math.random() < 0.5) this.effects.trail(bx, p.y + 0.45, bz, col, 0.45, 0.22);
    }
    if (scenery === 'canyon' && p.grounded && p.speed > 30 && Math.abs(p.lateral) > this.track.sample(p.trackIndex).halfWidth - 3) {
      this.effects.smokePuff(bx, p.y + 0.3, bz, 0xd09a6a, 3, 2);
    }
    if (v.health < 35 && Math.random() < 0.3) this.effects.smokePuff(p.x, p.y + 1, p.z, 0x222226, 1.5, 3);
  }

  buildResults(): RacerResult[] {
    this.updatePositions();
    return this.standings.map((v) => ({
      racerId: v.id,
      name: v.name,
      vehicleId: v.config.id,
      isPlayer: v.isPlayer,
      position: v.position,
      time: v.progress.finished ? v.progress.finishTime : null,
      bestLap: v.bestLap,
      hits: v.hitsLanded,
    }));
  }

  dispose(): void {
    for (const v of this.vehicles) v.dispose();
    this.weapons.dispose();
    this.effects.dispose();
    this.lighting.dispose();
    this.built.dispose();
    this.root.removeFromParent();
    this.scene.fog = null;
  }
}
