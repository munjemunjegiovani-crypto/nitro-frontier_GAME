export type PowerUpType = 'arc' | 'shield' | 'pulse' | 'seeker' | 'nitro' | 'snare';

export interface PowerUpDef {
  type: PowerUpType;
  name: string;
  short: string;
  description: string;
  color: number;
  /** CSS color for the HUD. */
  css: string;
  /** Whether this is an offensive weapon (excluded in Time Trial). */
  offensive: boolean;
}

export const POWERUPS: Record<PowerUpType, PowerUpDef> = {
  arc: { type: 'arc', name: 'ARC BOLT', short: 'ARC', description: 'Fires a fast forward energy bolt.', color: 0x20e3ff, css: '#20e3ff', offensive: true },
  shield: { type: 'shield', name: 'PHASE SHIELD', short: 'SHD', description: 'Blocks incoming attacks for 6 seconds.', color: 0x7cf7ff, css: '#7cf7ff', offensive: false },
  pulse: { type: 'pulse', name: 'PULSE WAVE', short: 'PLS', description: 'Short-range shockwave that shoves nearby rivals.', color: 0xff2fb4, css: '#ff2fb4', offensive: true },
  seeker: { type: 'seeker', name: 'SEEKER DRONE', short: 'SKR', description: 'Guided drone that hunts the rival ahead.', color: 0xff7a1a, css: '#ff7a1a', offensive: true },
  nitro: { type: 'nitro', name: 'NITRO SURGE', short: 'NTR', description: 'Massive burst of speed.', color: 0xffd23f, css: '#ffd23f', offensive: false },
  snare: { type: 'snare', name: 'GRAVITY SNARE', short: 'SNR', description: 'Drops a field that drags rivals behind you.', color: 0x9b5cff, css: '#9b5cff', offensive: true },
};

export const POWERUP_ORDER: PowerUpType[] = ['arc', 'shield', 'pulse', 'seeker', 'nitro', 'snare'];

/**
 * Picks a power-up. Racers further back get better catch-up items, which
 * keeps combat about positioning rather than pure luck.
 * @param position 1-based race position
 * @param total number of racers
 */
export function rollPowerUp(position: number, total: number, rand: () => number, allowOffensive = true): PowerUpType {
  const t = total > 1 ? (position - 1) / (total - 1) : 0; // 0 = leader, 1 = last
  const weights: Record<PowerUpType, number> = {
    arc: 3,
    shield: 2.4 - t * 1.2,
    pulse: 2,
    seeker: 0.6 + t * 2.6,
    nitro: 1 + t * 2.5,
    snare: 2.4 - t * 1.6,
  };
  const entries = POWERUP_ORDER
    .filter((p) => allowOffensive || !POWERUPS[p].offensive)
    .map((p) => [p, Math.max(0.05, weights[p])] as const);
  const sum = entries.reduce((s, [, w]) => s + w, 0);
  let r = rand() * sum;
  for (const [p, w] of entries) {
    r -= w;
    if (r <= 0) return p;
  }
  return entries[entries.length - 1][0];
}
