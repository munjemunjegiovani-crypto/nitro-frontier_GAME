/**
 * Tracks race progress for one racer along a closed track that is sampled
 * into `sampleCount` points. Progress is "unwrapped" so that crossing the
 * start line keeps counting up instead of jumping back to zero, and
 * checkpoints must be passed strictly in order: driving backwards lowers
 * progress, so the same checkpoint can never be collected twice.
 */
export class RaceProgress {
  /** Unwrapped progress in sample units. Negative before the start line. */
  progress: number;
  /** Highest progress reached (used for checkpoint validation). */
  best: number;
  /** Number of checkpoints passed, including the start line at race start. */
  checkpointsPassed = 0;
  finished = false;
  finishTime = 0;
  lapTimes: number[] = [];
  private lapStart = 0;
  private lastIndex: number;

  constructor(
    readonly sampleCount: number,
    readonly checkpointsPerLap: number,
    readonly totalLaps: number,
    startIndex: number,
  ) {
    this.lastIndex = startIndex;
    // Grid slots sit behind the line, so start with negative progress.
    this.progress = startIndex > sampleCount / 2 ? startIndex - sampleCount : startIndex;
    this.best = this.progress;
  }

  /** Progress value at which checkpoint number `n` (0-based, global) sits. */
  checkpointProgress(n: number): number {
    return (n * this.sampleCount) / this.checkpointsPerLap;
  }

  /** Current lap, 1-based, clamped to the race length. */
  get lap(): number {
    if (this.checkpointsPassed === 0) return 1;
    return Math.min(this.totalLaps, Math.floor((this.checkpointsPassed - 1) / this.checkpointsPerLap) + 1);
  }

  /** Index of the next checkpoint within the current lap (0 = finish line). */
  get nextCheckpointInLap(): number {
    return this.checkpointsPassed % this.checkpointsPerLap;
  }

  /** Fraction of the whole race completed, 0..1. */
  get raceFraction(): number {
    return Math.max(0, Math.min(1, this.best / (this.sampleCount * this.totalLaps)));
  }

  /**
   * Feed the racer's nearest sample index for this frame.
   * @returns 'lap' when a lap was completed, 'finish' on race completion, or null.
   */
  update(index: number, raceTime: number): 'lap' | 'finish' | null {
    const n = this.sampleCount;
    let delta = index - this.lastIndex;
    if (delta > n / 2) delta -= n;
    else if (delta < -n / 2) delta += n;
    this.lastIndex = index;
    this.progress += delta;
    if (this.progress > this.best) this.best = this.progress;
    if (this.finished) return null;

    let event: 'lap' | 'finish' | null = null;
    while (this.progress >= this.checkpointProgress(this.checkpointsPassed)) {
      this.checkpointsPassed++;
      const passed = this.checkpointsPassed - 1; // global index of checkpoint just passed
      if (passed === 0) {
        this.lapStart = raceTime;
        continue;
      }
      if (passed % this.checkpointsPerLap === 0) {
        this.lapTimes.push(raceTime - this.lapStart);
        this.lapStart = raceTime;
        if (passed / this.checkpointsPerLap >= this.totalLaps) {
          this.finished = true;
          this.finishTime = raceTime;
          return 'finish';
        }
        event = 'lap';
      }
    }
    return event;
  }

  /** Used for infinite practice sessions: never finish. */
  static practice(sampleCount: number, checkpointsPerLap: number, startIndex: number): RaceProgress {
    return new RaceProgress(sampleCount, checkpointsPerLap, Number.MAX_SAFE_INTEGER, startIndex);
  }
}

export interface RankEntry {
  id: number;
  finished: boolean;
  finishTime: number;
  progress: number;
}

/** Sorts racers: finishers by time, then everyone else by distance covered. */
export function rankRacers<T extends RankEntry>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => {
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.progress - a.progress;
  });
}
