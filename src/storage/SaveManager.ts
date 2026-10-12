import type { Quality } from '../tracks/TrackFactory';

export interface Settings {
  quality: Quality;
  renderScale: number;
  master: number;
  music: number;
  sfx: number;
  engine: number;
  cameraShake: number;
  speedEffects: boolean;
  showFps: boolean;
}

export interface SaveData {
  version: 1;
  settings: Settings;
  /** Best valid Time Trial times in seconds, keyed by track id. */
  bestTimes: Record<string, number>;
  /** Best single lap per track (any mode). */
  bestLaps: Record<string, number>;
  championshipsWon: number;
  racesWon: number;
  lastVehicle: string;
  lastTrack: string;
}

export const DEFAULT_SETTINGS: Settings = {
  quality: 'high',
  renderScale: 1,
  master: 0.8,
  music: 0.55,
  sfx: 0.8,
  engine: 0.6,
  cameraShake: 1,
  speedEffects: true,
  showFps: false,
};

const KEY = 'nitro-frontier-save-v1';

export function defaultSave(): SaveData {
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    bestTimes: {},
    bestLaps: {},
    championshipsWon: 0,
    racesWon: 0,
    lastVehicle: 'vortex',
    lastTrack: 'neon-harbor',
  };
}

const num = (v: unknown, lo: number, hi: number, d: number): number =>
  typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d;

const times = (v: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (v && typeof v === 'object') {
    for (const [k, t] of Object.entries(v as Record<string, unknown>)) {
      if (typeof t === 'number' && isFinite(t) && t > 0) out[k] = t;
    }
  }
  return out;
};

/** Validates arbitrary (possibly corrupted) data into a well-formed save. */
export function sanitizeSave(raw: unknown): SaveData {
  const d = defaultSave();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<SaveData> & { settings?: Partial<Settings> };
  const s: Partial<Settings> = r.settings ?? {};
  d.settings = {
    quality: s.quality === 'low' || s.quality === 'medium' || s.quality === 'high' ? s.quality : DEFAULT_SETTINGS.quality,
    renderScale: num(s.renderScale, 0.5, 1, 1),
    master: num(s.master, 0, 1, DEFAULT_SETTINGS.master),
    music: num(s.music, 0, 1, DEFAULT_SETTINGS.music),
    sfx: num(s.sfx, 0, 1, DEFAULT_SETTINGS.sfx),
    engine: num(s.engine, 0, 1, DEFAULT_SETTINGS.engine),
    cameraShake: num(s.cameraShake, 0, 1, 1),
    speedEffects: typeof s.speedEffects === 'boolean' ? s.speedEffects : true,
    showFps: typeof s.showFps === 'boolean' ? s.showFps : false,
  };
  d.bestTimes = times(r.bestTimes);
  d.bestLaps = times(r.bestLaps);
  d.championshipsWon = Math.floor(num(r.championshipsWon, 0, 1e6, 0));
  d.racesWon = Math.floor(num(r.racesWon, 0, 1e6, 0));
  if (typeof r.lastVehicle === 'string') d.lastVehicle = r.lastVehicle;
  if (typeof r.lastTrack === 'string') d.lastTrack = r.lastTrack;
  return d;
}

/** localStorage-backed persistence that degrades to memory if storage is unavailable. */
export class SaveManager {
  data: SaveData;
  private available: boolean;

  constructor(private storage: Pick<Storage, 'getItem' | 'setItem'> | null = SaveManager.detect()) {
    this.available = storage !== null;
    let raw: unknown = null;
    try {
      const text = storage?.getItem(KEY);
      raw = text ? JSON.parse(text) : null;
    } catch {
      raw = null; // corrupted JSON → defaults
    }
    this.data = sanitizeSave(raw);
  }

  private static detect(): Storage | null {
    try {
      const s = window.localStorage;
      const k = '__nf_test__';
      s.setItem(k, '1');
      s.removeItem(k);
      return s;
    } catch {
      return null;
    }
  }

  save(): void {
    if (!this.available) return;
    try {
      this.storage!.setItem(KEY, JSON.stringify(this.data));
    } catch {
      this.available = false; // quota or privacy mode
    }
  }

  /** Record a time trial; returns true for a new personal best. */
  submitBestTime(trackId: string, seconds: number): boolean {
    const prev = this.data.bestTimes[trackId];
    if (prev === undefined || seconds < prev) {
      this.data.bestTimes[trackId] = seconds;
      this.save();
      return true;
    }
    return false;
  }

  submitBestLap(trackId: string, seconds: number): boolean {
    const prev = this.data.bestLaps[trackId];
    if (prev === undefined || seconds < prev) {
      this.data.bestLaps[trackId] = seconds;
      this.save();
      return true;
    }
    return false;
  }
}
