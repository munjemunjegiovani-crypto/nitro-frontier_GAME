import type { Track } from '../tracks/Track';

/**
 * Pre-computed racing line: for every track sample an ideal lateral offset
 * (cutting toward the inside of corners) and a safe cornering speed.
 */
export class RacingLine {
  /** Ideal lateral offset per sample, in world units. */
  readonly offset: Float32Array;
  /** Absolute curvature per sample (smoothed). */
  readonly curvature: Float32Array;

  constructor(readonly track: Track) {
    const n = track.count;
    this.offset = new Float32Array(n);
    this.curvature = new Float32Array(n);
    const raw = new Float32Array(n);
    const w = 6;
    for (let i = 0; i < n; i++) {
      const a = track.sample(i - w).tangent;
      const b = track.sample(i + w).tangent;
      const r = track.sample(i).right;
      // Change in tangent points toward the inside of the bend.
      const dx = b.x - a.x, dz = b.z - a.z;
      const inside = dx * r.x + dz * r.z; // >0 = bend to the right
      raw[i] = inside;
      this.curvature[i] = Math.abs(track.sample(i).curvature);
    }
    // Smooth & look slightly ahead so the line apexes rather than reacts.
    for (let i = 0; i < n; i++) {
      let sum = 0;
      let wsum = 0;
      for (let k = -14; k <= 22; k++) {
        const wt = 1 - Math.abs(k - 4) / 24;
        sum += raw[(i + k + n) % n] * wt;
        wsum += wt;
      }
      const v = sum / wsum;
      const half = track.sample(i).halfWidth;
      this.offset[i] = Math.max(-0.62, Math.min(0.62, v * 2.6)) * half;
    }
  }

  /** Max comfortable speed through a sample given lateral acceleration capacity. */
  cornerSpeed(i: number, lateralAccel: number): number {
    const n = this.track.count;
    const c = Math.max(this.curvature[((i % n) + n) % n], 1e-4);
    return Math.sqrt(lateralAccel / c);
  }
}
