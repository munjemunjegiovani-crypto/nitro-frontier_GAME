import { PHYSICS } from '../config/GameConfig';
import type { Track, TrackQuery } from '../tracks/Track';
import type { VehicleConfig } from './VehicleConfig';

/** Driver input for one frame, shared by the player controller and the AI. */
export interface DriveInput {
  throttle: number; // 0..1
  brake: number; // 0..1 (also reverse)
  steer: number; // -1 (left) .. 1 (right)
  handbrake: boolean;
  boost: boolean;
}

export const NO_INPUT: Readonly<DriveInput> = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false };

export interface WallHit {
  side: -1 | 1;
  impact: number;
}

/**
 * Arcade car physics. The model is intentionally simple and stable:
 * velocity is split into forward/lateral components, lateral velocity
 * decays according to grip (lower while drifting), and the road is a
 * height field derived from the track spline with side walls.
 */
export class VehiclePhysics {
  x = 0; y = 0; z = 0;
  vx = 0; vy = 0; vz = 0;
  heading = 0;
  yawRate = 0;
  grounded = true;
  airTime = 0;
  drifting = false;
  slip = 0;
  boosting = false;
  nitro = 1; // 0..1 meter
  /** External speed multiplier from power-ups (nitro surge, snare...). */
  speedMultiplier = 1;
  /** Seconds of spin-out remaining after being hit. */
  spin = 0;
  trackIndex = -1;
  lateral = 0;
  readonly query: TrackQuery = {} as TrackQuery;

  constructor(public config: VehicleConfig) {}

  get forwardX(): number { return Math.sin(this.heading); }
  get forwardZ(): number { return Math.cos(this.heading); }
  get speed(): number { return Math.hypot(this.vx, this.vz); }
  /** Signed forward speed. */
  get forwardSpeed(): number { return this.vx * this.forwardX + this.vz * this.forwardZ; }

  place(track: Track, index: number, lateral: number): void {
    const s = track.sample(index);
    this.x = s.pos.x + s.right.x * lateral;
    this.z = s.pos.z + s.right.z * lateral;
    this.y = s.pos.y;
    this.heading = Math.atan2(s.tangent.x, s.tangent.z);
    this.vx = this.vy = this.vz = 0;
    this.yawRate = 0;
    this.spin = 0;
    this.trackIndex = index;
    this.lateral = lateral;
    this.grounded = true;
  }

  /** Advance one fixed step. Returns a wall hit when the car scraped a barrier. */
  step(input: DriveInput, dt: number, track: Track, allowBoost = true): WallHit | null {
    const c = this.config;
    const fx = this.forwardX, fz = this.forwardZ;
    const rx = fz, rz = -fx; // right vector
    let vF = this.vx * fx + this.vz * fz;
    let vL = this.vx * rx + this.vz * rz;

    const spinning = this.spin > 0;
    const throttle = spinning ? 0 : input.throttle;
    const brake = spinning ? 0 : input.brake;
    const steer = spinning ? 0 : input.steer;

    // Nitro meter
    this.boosting = allowBoost && input.boost && this.nitro > 0.02 && !spinning && this.grounded;
    if (this.boosting) this.nitro = Math.max(0, this.nitro - c.boostDrain * dt);
    else this.nitro = Math.min(1, this.nitro + 0.045 * dt);

    const boostMul = this.boosting ? c.boostPower : 1;
    const maxSpeed = c.maxSpeed * boostMul * this.speedMultiplier;

    if (this.grounded) {
      // Longitudinal
      if (throttle > 0) {
        const headroom = Math.max(0, 1 - vF / maxSpeed);
        const accel = c.acceleration * (this.boosting ? 1.7 : 1) * (0.35 + 0.65 * headroom);
        if (vF < maxSpeed) vF += accel * throttle * dt;
      }
      if (brake > 0) {
        if (vF > 1) vF -= c.braking * brake * dt;
        else vF = Math.max(-c.maxSpeed * 0.3, vF - c.acceleration * 0.6 * brake * dt);
      }
      if (vF > maxSpeed) vF += (maxSpeed - vF) * Math.min(1, 1.6 * dt); // shed excess (end of boost)
      // Rolling resistance and drag
      // Light air drag under power (top speed is governed by the accel curve),
      // stronger engine braking when coasting.
      const drag = throttle > 0 ? 0.03 : brake > 0 ? 0.2 : 0.55;
      vF -= vF * drag * dt * (Math.abs(vF) > 1 ? 1 : 3);
      if (input.handbrake) vF -= vF * 0.5 * dt;

      // Steering: speed sensitive, reverses when reversing.
      const speedAbs = Math.abs(vF);
      const lowSpeed = Math.min(1, speedAbs / 10);
      const highSpeedDamp = 1 - 0.42 * Math.min(1, speedAbs / c.maxSpeed);
      const driftBonus = input.handbrake ? 1.45 : 1;
      // heading = atan2(x, z): increasing heading turns LEFT, so right steer is negative yaw.
      const targetYaw = -steer * c.steering * lowSpeed * highSpeedDamp * driftBonus * Math.sign(vF || 1);
      this.yawRate += (targetYaw - this.yawRate) * Math.min(1, 10 * dt);

      // Lateral grip
      this.drifting = input.handbrake && speedAbs > 18;
      const grip = c.grip * (this.drifting ? c.driftGrip : 1);
      // Drifting converts some lateral momentum into forward speed (arcade drift boost).
      const lost = vL * (1 - Math.exp(-grip * dt));
      vL -= lost;
      if (this.drifting) {
        vF += Math.abs(lost) * 0.25;
        this.nitro = Math.min(1, this.nitro + Math.abs(this.yawRate) * 0.05 * dt);
      }
    } else {
      this.yawRate *= 1 - Math.min(1, 1.5 * dt);
      this.drifting = false;
    }

    if (spinning) {
      this.spin -= dt;
      this.yawRate = 7 * Math.sign(this.yawRate || 1);
      vF *= 1 - Math.min(1, 1.4 * dt);
      vL *= 1 - Math.min(1, 2 * dt);
    }

    this.slip = Math.abs(vL);
    this.heading += this.yawRate * dt;
    const nfx = Math.sin(this.heading), nfz = Math.cos(this.heading);
    const nrx = nfz, nrz = -nfx;
    this.vx = nfx * vF + nrx * vL;
    this.vz = nfz * vF + nrz * vL;

    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // Vertical: follow road, become airborne when the road falls away fast enough.
    track.query(this.posVec(), this.trackIndex, 45, this.query);
    this.trackIndex = this.query.index;
    this.lateral = this.query.lateral;
    const ground = this.query.height;
    if (this.grounded) {
      const prevY = this.y;
      this.y = ground;
      const climb = (this.y - prevY) / Math.max(dt, 1e-4);
      // Launch off a crest: keep upward momentum when the road drops away.
      if (this.vy > 4 && climb < this.vy - 6) {
        this.grounded = false;
        this.y = prevY + this.vy * dt;
      } else {
        this.vy = climb;
      }
      this.airTime = 0;
    } else {
      this.vy -= PHYSICS.gravity * dt;
      this.y += this.vy * dt;
      this.airTime += dt;
      if (this.y <= ground) {
        this.y = ground;
        this.vy = 0;
        this.grounded = true;
      }
    }

    // Walls
    const half = this.query.sample.halfWidth - 1.1;
    if (Math.abs(this.lateral) > half) {
      const side = (Math.sign(this.lateral) as -1 | 1) || 1;
      const s = this.query.sample;
      const push = Math.abs(this.lateral) - half;
      this.x -= s.right.x * side * push;
      this.z -= s.right.z * side * push;
      this.lateral = side * half;
      // Remove velocity into the wall and bounce a little.
      const into = (this.vx * s.right.x + this.vz * s.right.z) * side;
      let impact = 0;
      if (into > 0) {
        impact = into;
        this.vx -= s.right.x * side * into * (1 + PHYSICS.wallBounce);
        this.vz -= s.right.z * side * into * (1 + PHYSICS.wallBounce);
        const keep = 1 - Math.min(0.6, PHYSICS.wallSpeedLoss * (into / 12));
        this.vx *= keep;
        this.vz *= keep;
        // Nudge heading to align with the wall so the car doesn't stay pinned.
        const trackHeading = Math.atan2(s.tangent.x, s.tangent.z);
        let dh = trackHeading - this.heading;
        while (dh > Math.PI) dh -= Math.PI * 2;
        while (dh < -Math.PI) dh += Math.PI * 2;
        if (Math.abs(dh) < Math.PI / 2) this.heading += dh * Math.min(1, 4 * dt);
      }
      return { side, impact };
    }
    return null;
  }

  private _pos = { x: 0, y: 0, z: 0 };
  /** Lightweight position object for track queries (avoids allocations). */
  posVec(): import('three').Vector3 {
    this._pos.x = this.x; this._pos.y = this.y; this._pos.z = this.z;
    return this._pos as unknown as import('three').Vector3;
  }

  /** Apply an instantaneous launch (jump ramp). */
  launch(vy: number): void {
    this.vy = vy;
    this.grounded = false;
    this.y += 0.05;
  }
}
