import { PHYSICS } from '../config/GameConfig';
import type { WeaponSystem } from '../combat/WeaponSystem';
import type { Track } from '../tracks/Track';
import type { Vehicle } from '../vehicles/Vehicle';
import type { RacingLine } from './RacingLine';

export type AIStyle = 'aggressive' | 'defensive' | 'balanced' | 'speed';

interface StyleParams {
  /** Fraction of max speed the driver is willing to use. */
  pace: number;
  /** Lateral acceleration budget for corners. */
  cornerGrip: number;
  /** How readily it fires (0..1). */
  trigger: number;
  /** Max seconds it will hold an item before using it anyway. */
  holdLimit: number;
  nitroEagerness: number;
}

export const AI_STYLES: Record<AIStyle, StyleParams> = {
  aggressive: { pace: 0.95, cornerGrip: 50, trigger: 1, holdLimit: 6, nitroEagerness: 0.7 },
  defensive: { pace: 0.94, cornerGrip: 47, trigger: 0.55, holdLimit: 14, nitroEagerness: 0.5 },
  balanced: { pace: 0.95, cornerGrip: 49, trigger: 0.75, holdLimit: 9, nitroEagerness: 0.6 },
  speed: { pace: 0.98, cornerGrip: 53, trigger: 0.5, holdLimit: 10, nitroEagerness: 1 },
};

/**
 * Computer driver. Follows the racing line with look-ahead steering, plans
 * braking for upcoming corners, avoids nearby cars, collects pickups and
 * uses weapons tactically. It never moves the car directly: it only
 * produces a DriveInput, exactly like the player.
 */
export class AIDriver {
  private params: StyleParams;
  private holdTime = 0;
  private reverseTime = 0;
  private laneBias: number;
  private thinkTimer = 0;
  private avoidOffset = 0;
  private pickupOffset = 0;
  /** Difficulty multiplier 0.85..1.05. */
  skill = 1;
  /** External catch-up factor set by the race manager. */
  catchUp = 1;

  constructor(
    readonly vehicle: Vehicle,
    readonly style: AIStyle,
    private track: Track,
    private line: RacingLine,
    private rand: () => number = Math.random,
  ) {
    this.params = AI_STYLES[style];
    this.laneBias = (rand() - 0.5) * 4;
  }

  update(dt: number, vehicles: readonly Vehicle[], weapons: WeaponSystem | null, racing: boolean): void {
    const v = this.vehicle;
    const p = v.physics;
    const input = v.input;
    if (!racing || v.wrecked) {
      input.throttle = 0; input.brake = 0; input.steer = 0; input.boost = false; input.handbrake = false;
      return;
    }
    const n = this.track.count;
    const idx = p.trackIndex;
    const speed = Math.max(0, p.forwardSpeed);

    this.thinkTimer -= dt;
    if (this.thinkTimer <= 0) {
      this.thinkTimer = 0.15;
      this.computeAvoidance(vehicles);
      this.computePickupSeeking(weapons);
    }

    // ---- Steering toward a look-ahead point on the racing line
    const ahead = Math.round(5 + speed * 0.18);
    const ti = (idx + ahead) % n;
    const s = this.track.sample(ti);
    const half = s.halfWidth - 2.2;
    let lateral = this.line.offset[ti] + this.laneBias + this.avoidOffset + this.pickupOffset;
    lateral = Math.max(-half, Math.min(half, lateral));
    const tx = s.pos.x + s.right.x * lateral;
    const tz = s.pos.z + s.right.z * lateral;
    const desired = Math.atan2(tx - p.x, tz - p.z);
    let dh = desired - p.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    // Positive dh = target is to the left; steer is +1 for right.
    input.steer = Math.max(-1, Math.min(1, -dh * 2.6));

    // ---- Speed planning: look ahead for the tightest corner we must slow for
    const grip = this.params.cornerGrip * (v.config.grip / 7.5) ** 0.5;
    const maxV = v.config.maxSpeed * this.params.pace * this.skill * this.catchUp;
    let target = maxV;
    const brakeDecel = v.config.braking * 0.75;
    const horizon = Math.round(18 + speed * 0.7);
    for (let k = 2; k < horizon; k += 2) {
      const cs = this.line.cornerSpeed(idx + k, grip);
      const dist = k * 2.5;
      const allowed = Math.sqrt(cs * cs + 2 * brakeDecel * dist);
      if (allowed < target) target = allowed;
    }
    target = Math.max(22, target);

    if (this.reverseTime > 0) {
      this.reverseTime -= dt;
      input.throttle = 0;
      input.brake = 1;
      input.steer = -input.steer;
    } else if (speed < target - 1) {
      input.throttle = 1;
      input.brake = 0;
    } else if (speed > target + 5) {
      input.throttle = 0;
      input.brake = Math.min(1, (speed - target) / 12);
    } else {
      input.throttle = 0.35;
      input.brake = 0;
    }
    // Handbrake on very sharp turns at speed
    input.handbrake = Math.abs(dh) > 0.5 && speed > 35;

    // ---- Nitro on straights
    let straight = true;
    for (let k = 4; k < 50; k += 4) {
      if (this.line.curvature[(idx + k) % n] > 0.006) { straight = false; break; }
    }
    input.boost = straight && p.nitro > 0.25 && speed > 30 && this.rand() < this.params.nitroEagerness + 0.4;

    // ---- Stuck recovery
    if (speed < PHYSICS.stuckSpeedThreshold && this.reverseTime <= 0) {
      v.stuckTime += dt;
      if (v.stuckTime > 1.0 && v.stuckTime < 1.1) this.reverseTime = 0.8;
    } else if (speed > 8) {
      v.stuckTime = 0;
    }

    // ---- Weapons
    if (weapons && v.powerUp) {
      this.holdTime += dt;
      if (this.shouldFire(vehicles, weapons)) {
        weapons.activate(v, vehicles);
        this.holdTime = 0;
      }
    } else {
      this.holdTime = 0;
    }
  }

  private computeAvoidance(vehicles: readonly Vehicle[]): void {
    const me = this.vehicle.physics;
    let push = 0;
    for (const o of vehicles) {
      if (o === this.vehicle || o.wrecked) continue;
      const dx = o.physics.x - me.x, dz = o.physics.z - me.z;
      const along = dx * me.forwardX + dz * me.forwardZ;
      if (along < 0 || along > 22) continue;
      const side = dx * me.forwardZ - dz * me.forwardX; // + = other car is to my right
      if (Math.abs(side) > 4.5) continue;
      const rel = me.forwardSpeed - o.physics.forwardSpeed;
      if (rel < -2) continue; // they're pulling away
      push += (side >= 0 ? -1 : 1) * (4.5 - Math.abs(side)) * (1 - along / 26) * 1.6;
    }
    this.avoidOffset += (Math.max(-7, Math.min(7, push)) - this.avoidOffset) * 0.5;
  }

  private computePickupSeeking(weapons: WeaponSystem | null): void {
    this.pickupOffset *= 0.6;
    if (!weapons || this.vehicle.powerUp) return;
    const p = this.vehicle.physics;
    const n = this.track.count;
    let best = Infinity;
    for (const pk of weapons.pickupList) {
      if (!pk.available) continue;
      const gap = (pk.index - p.trackIndex + n) % n;
      if (gap < 4 || gap > 30) continue;
      const s = this.track.sample(pk.index);
      const lat = (pk.x - s.pos.x) * s.right.x + (pk.z - s.pos.z) * s.right.z;
      const desired = lat - this.line.offset[pk.index] - this.laneBias;
      if (Math.abs(desired) < Math.abs(best)) best = desired;
    }
    if (best !== Infinity) this.pickupOffset = best;
  }

  private shouldFire(vehicles: readonly Vehicle[], weapons: WeaponSystem): boolean {
    const v = this.vehicle;
    const p = v.physics;
    const trig = this.params.trigger;
    const forced = this.holdTime > this.params.holdLimit;
    switch (v.powerUp) {
      case 'shield':
        return weapons.threatTo(v) || this.holdTime > this.params.holdLimit * 1.6;
      case 'nitro': {
        const n = this.track.count;
        for (let k = 4; k < 30; k += 4) if (this.line.curvature[(p.trackIndex + k) % n] > 0.008) return forced;
        return true;
      }
      case 'arc': {
        for (const o of vehicles) {
          if (o === v || o.wrecked) continue;
          const dx = o.physics.x - p.x, dz = o.physics.z - p.z;
          const along = dx * p.forwardX + dz * p.forwardZ;
          const side = Math.abs(dx * p.forwardZ - dz * p.forwardX);
          // Fire when the rival sits in a narrow corridor straight ahead.
          if (along > 8 && along < 75 && side < 2.6 && this.rand() < trig * 0.5) return true;
        }
        return forced;
      }
      case 'seeker':
        return (weapons.findTargetAhead(v, vehicles) !== null && this.rand() < trig * 0.08) || forced;
      case 'pulse':
        for (const o of vehicles) {
          if (o === v || o.wrecked) continue;
          if (Math.hypot(o.physics.x - p.x, o.physics.z - p.z) < 11 && this.rand() < trig * 0.4) return true;
        }
        return forced;
      case 'snare':
        for (const o of vehicles) {
          if (o === v || o.wrecked) continue;
          const gap = v.progress.progress - o.progress.progress;
          if (gap > 2 && gap < 14 && this.rand() < trig * 0.3) return true;
        }
        return forced;
      default:
        return false;
    }
  }
}
