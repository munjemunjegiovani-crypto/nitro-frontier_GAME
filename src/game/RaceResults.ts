import { RACE } from '../config/GameConfig';

export interface RacerResult {
  racerId: number;
  name: string;
  vehicleId: string;
  isPlayer: boolean;
  position: number;
  /** Seconds, or null when the racer did not finish and was classified by distance. */
  time: number | null;
  bestLap: number | null;
  hits: number;
}

export function pointsForPosition(position: number): number {
  return RACE.championshipPoints[position - 1] ?? 0;
}

export interface StandingRow {
  racerId: number;
  name: string;
  vehicleId: string;
  isPlayer: boolean;
  points: number;
  wins: number;
  lastRacePoints: number;
}

/** Accumulates championship points across several races. */
export class Championship {
  readonly standings = new Map<number, StandingRow>();
  raceIndex = 0;

  constructor(readonly trackIds: readonly string[]) {}

  get currentTrackId(): string {
    return this.trackIds[Math.min(this.raceIndex, this.trackIds.length - 1)];
  }

  get isComplete(): boolean {
    return this.raceIndex >= this.trackIds.length;
  }

  recordRace(results: readonly RacerResult[]): void {
    for (const r of results) {
      const pts = pointsForPosition(r.position);
      const row = this.standings.get(r.racerId) ?? {
        racerId: r.racerId, name: r.name, vehicleId: r.vehicleId, isPlayer: r.isPlayer,
        points: 0, wins: 0, lastRacePoints: 0,
      };
      row.points += pts;
      row.lastRacePoints = pts;
      if (r.position === 1) row.wins++;
      this.standings.set(r.racerId, row);
    }
    this.raceIndex++;
  }

  sorted(): StandingRow[] {
    return [...this.standings.values()].sort((a, b) => b.points - a.points || b.wins - a.wins);
  }
}

export function formatTime(seconds: number | null): string {
  if (seconds === null || !isFinite(seconds)) return '--:--.---';
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
