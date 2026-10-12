import * as THREE from 'three';
import { COMBAT } from '../config/GameConfig';
import type { PowerUpType } from '../combat/PowerUp';
import type { RaceProgress } from '../tracks/CheckpointSystem';
import { buildCarModel, type CarModel } from './CarModel';
import type { VehicleConfig } from './VehicleConfig';
import { NO_INPUT, VehiclePhysics, type DriveInput } from './VehiclePhysics';

/** A racer: physics body + visual model + race and combat state. */
export class Vehicle {
  readonly physics: VehiclePhysics;
  readonly model: CarModel;
  input: DriveInput = { ...NO_INPUT };
  progress!: RaceProgress;
  position = 1;

  health: number = COMBAT.maxHealth;
  powerUp: PowerUpType | null = null;
  activationCooldown = 0;
  shieldTime = 0;
  nitroSurgeTime = 0;
  /** Seconds until respawn after being wrecked; 0 = active. */
  wreckedTime = 0;
  invulnerableTime = 0;
  /** Slowdown factor applied while inside a gravity snare (1 = none). */
  snareFactor = 1;
  hitsLanded = 0;
  stuckTime = 0;
  offTrackTime = 0;
  bestLap: number | null = null;
  private wheelSpin = 0;

  constructor(
    readonly id: number,
    readonly name: string,
    readonly config: VehicleConfig,
    readonly isPlayer: boolean,
    withLights: boolean,
  ) {
    this.physics = new VehiclePhysics(config);
    this.model = buildCarModel(config, { lights: withLights });
  }

  get wrecked(): boolean {
    return this.wreckedTime > 0;
  }

  get shielded(): boolean {
    return this.shieldTime > 0 || this.invulnerableTime > 0;
  }

  get speedKmh(): number {
    return this.physics.speed * 3.6;
  }

  resetCombat(): void {
    this.health = COMBAT.maxHealth;
    this.powerUp = null;
    this.activationCooldown = 0;
    this.shieldTime = 0;
    this.nitroSurgeTime = 0;
    this.wreckedTime = 0;
    this.invulnerableTime = 0;
    this.snareFactor = 1;
    this.hitsLanded = 0;
    this.stuckTime = 0;
    this.offTrackTime = 0;
    this.bestLap = null;
    this.physics.nitro = 1;
    this.physics.speedMultiplier = 1;
    this.model.root.visible = true;
  }

  /** Per-frame timers and the speed multiplier from active effects. */
  updateEffects(dt: number): void {
    this.activationCooldown = Math.max(0, this.activationCooldown - dt);
    this.shieldTime = Math.max(0, this.shieldTime - dt);
    this.nitroSurgeTime = Math.max(0, this.nitroSurgeTime - dt);
    this.invulnerableTime = Math.max(0, this.invulnerableTime - dt);
    const surge = this.nitroSurgeTime > 0 ? 1.45 : 1;
    this.physics.speedMultiplier = surge * this.snareFactor;
    // Surge also forces acceleration
    if (this.nitroSurgeTime > 0) this.input.throttle = 1;
    this.snareFactor = 1; // re-applied each frame by the combat system
  }

  /** Sync the visual model with the physics state. */
  syncVisual(dt: number, time: number): void {
    const p = this.physics;
    const root = this.model.root;
    root.position.set(p.x, p.y, p.z);
    root.rotation.set(0, p.heading, 0);
    // Body lean and pitch for game feel
    const body = this.model.body;
    const lean = THREE.MathUtils.clamp(-p.yawRate * p.speed * 0.004, -0.09, 0.09);
    body.rotation.z += (lean - body.rotation.z) * Math.min(1, 8 * dt);
    const pitch = p.grounded ? THREE.MathUtils.clamp(-this.input.throttle * 0.02 + this.input.brake * 0.03, -0.04, 0.04) : -p.vy * 0.006;
    body.rotation.x += (pitch - body.rotation.x) * Math.min(1, 6 * dt);

    this.wheelSpin += p.forwardSpeed * dt / this.config.shape.wheelRadius;
    for (const w of this.model.wheels) w.rotation.x = this.wheelSpin;
    for (const w of this.model.frontWheels) w.rotation.y = -this.input.steer * 0.4;

    this.model.brakeMaterial.emissiveIntensity = this.input.brake > 0 ? 4 : 1.2;
    const boosting = p.boosting || this.nitroSurgeTime > 0;
    for (const f of this.model.flames) {
      f.visible = boosting;
      if (boosting) f.scale.set(1, 1, 0.8 + Math.random() * 0.6 + (this.nitroSurgeTime > 0 ? 0.6 : 0));
    }
    this.model.flameMaterial.color.setHex(this.nitroSurgeTime > 0 ? 0xffd23f : 0x54e8ff);
    const sh = this.model.shield;
    sh.visible = this.shieldTime > 0 || (this.invulnerableTime > 0 && Math.sin(time * 30) > 0);
    if (sh.visible) {
      this.model.shieldMaterial.opacity = 0.16 + Math.sin(time * 12) * 0.06;
      sh.rotation.y = time * 2;
    }
    root.visible = !this.wrecked;
  }

  dispose(): void {
    this.model.root.removeFromParent();
    this.model.dispose();
  }
}
