import { describe, expect, it } from 'vitest';
import { RaceProgress, rankRacers } from '../src/tracks/CheckpointSystem';

const N = 400;
const CP = 8;

/** Drive forward from `from` (wrapped index) by `samples`, one sample at a time. */
function drive(p: RaceProgress, from: number, samples: number, t = 0, dir = 1): { index: number; events: string[] } {
  const events: string[] = [];
  let i = from;
  for (let k = 0; k < samples; k++) {
    i = (i + dir + N) % N;
    const e = p.update(i, t + k * 0.01);
    if (e) events.push(e);
  }
  return { index: i, events };
}

describe('RaceProgress', () => {
  it('starts on lap 1 with negative progress behind the line', () => {
    const p = new RaceProgress(N, CP, 3, N - 10);
    expect(p.lap).toBe(1);
    expect(p.progress).toBe(-10);
    expect(p.checkpointsPassed).toBe(0);
  });

  it('counts laps only after passing every checkpoint in order', () => {
    const p = new RaceProgress(N, CP, 3, N - 10);
    const r1 = drive(p, N - 10, 10 + N); // cross the start, then one full lap
    expect(r1.events).toEqual(['lap']);
    expect(p.lap).toBe(2);
    expect(p.lapTimes).toHaveLength(1);
  });

  it('finishes after the configured number of laps', () => {
    const p = new RaceProgress(N, CP, 2, N - 10);
    const r = drive(p, N - 10, 10 + 2 * N);
    expect(r.events).toEqual(['lap', 'finish']);
    expect(p.finished).toBe(true);
    expect(p.lap).toBe(2);
    // Further driving does nothing once finished.
    expect(drive(p, r.index, N).events).toEqual([]);
  });

  it('does not award laps for driving backwards over the line', () => {
    const p = new RaceProgress(N, CP, 3, 5);
    const r = drive(p, 5, 50, 0, -1); // reverse across the start/finish line
    expect(r.events).toEqual([]);
    expect(p.lap).toBe(1);
    expect(p.progress).toBe(-45);
  });

  it('cannot farm a checkpoint by reversing and re-crossing it', () => {
    const p = new RaceProgress(N, CP, 3, N - 2);
    let r = drive(p, N - 2, 60); // passes start (cp0) and cp1 (index 50)
    const passed = p.checkpointsPassed;
    r = drive(p, r.index, 20, 0, -1); // back over cp1
    r = drive(p, r.index, 20); // forward over it again
    expect(p.checkpointsPassed).toBe(passed);
    void r;
  });

  it('handles index wrap-around without jumps', () => {
    const p = new RaceProgress(N, CP, 3, N - 1);
    p.update(0, 0);
    p.update(1, 0);
    expect(p.progress).toBe(1);
  });

  it('reports race fraction between 0 and 1', () => {
    const p = new RaceProgress(N, CP, 2, 0);
    drive(p, 0, N);
    expect(p.raceFraction).toBeCloseTo(0.5, 2);
  });
});

describe('rankRacers', () => {
  it('ranks finishers by time ahead of non-finishers by distance', () => {
    const ranked = rankRacers([
      { id: 1, finished: false, finishTime: 0, progress: 900 },
      { id: 2, finished: true, finishTime: 95, progress: 1200 },
      { id: 3, finished: true, finishTime: 90, progress: 1200 },
      { id: 4, finished: false, finishTime: 0, progress: 1100 },
    ]);
    expect(ranked.map((r) => r.id)).toEqual([3, 2, 4, 1]);
  });
});
