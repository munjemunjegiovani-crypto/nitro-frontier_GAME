/**
 * Centralised tunable gameplay values. Everything a designer is likely to
 * tweak lives here so balancing never requires digging through systems code.
 */
export const RACE = {
  defaultLaps: 3,
  opponentCount: 5,
  countdownSeconds: 3,
  /** Points awarded per finishing position in Championship mode (1st..6th). */
  championshipPoints: [10, 8, 6, 5, 4, 3] as readonly number[],
  /** Number of checkpoints each track is divided into. */
  checkpointsPerLap: 8,
  /** Seconds after the player finishes before remaining racers are auto-classified. */
  finishGraceSeconds: 12,
} as const;

export const PHYSICS = {
  gravity: 38,
  /** Units per second is displayed as km/h using this factor. */
  speedToKmh: 3.6,
  wallBounce: 0.35,
  wallSpeedLoss: 0.18,
  carRadius: 2.2,
  carCollisionRestitution: 0.6,
  offTrackResetSeconds: 2.5,
  stuckSpeedThreshold: 3,
  stuckSeconds: 2.2,
} as const;

export const COMBAT = {
  maxHealth: 100,
  wreckRespawnSeconds: 1.6,
  postRespawnInvulnerable: 2.0,
  pickupRespawnSeconds: 7,
  maxProjectiles: 48,
  maxSnares: 12,
  /** Seconds a racer must wait between two power-up activations. */
  activationCooldown: 0.6,
} as const;

export const CAMERA = {
  distance: 7.2,
  height: 2.35,
  lookAhead: 5,
  baseFov: 64,
  maxFovBoost: 16,
  followStiffness: 7,
} as const;

export const PALETTE = {
  graphite: 0x14161c,
  graphiteLight: 0x262a33,
  cyan: 0x20e3ff,
  orange: 0xff7a1a,
  magenta: 0xff2fb4,
  white: 0xf2f6ff,
} as const;
