import { describe, expect, it } from 'vitest';
import { GameStateMachine } from '../src/game/GameState';
import { Championship, formatTime, ordinal, pointsForPosition, type RacerResult } from '../src/game/RaceResults';
import { canActivate } from '../src/combat/WeaponSystem';
import { POWERUPS, rollPowerUp } from '../src/combat/PowerUp';
import { SaveManager, sanitizeSave } from '../src/storage/SaveManager';

describe('GameStateMachine', () => {
  it('follows the menu → race flow', () => {
    const f = new GameStateMachine();
    for (const s of ['mainMenu', 'modeSelect', 'vehicleSelect', 'trackSelect', 'countdown', 'racing', 'paused', 'racing', 'raceComplete'] as const) {
      expect(f.transition(s)).toBe(true);
    }
    expect(f.state).toBe('raceComplete');
  });

  it('rejects invalid and duplicate transitions', () => {
    const f = new GameStateMachine();
    expect(f.transition('racing')).toBe(false); // loading → racing not allowed
    f.transition('mainMenu');
    expect(f.transition('mainMenu')).toBe(false); // duplicate
    expect(f.transition('raceComplete')).toBe(false);
    expect(f.state).toBe('mainMenu');
  });

  it('cannot start a second countdown while one is running', () => {
    const f = new GameStateMachine();
    ['mainMenu', 'modeSelect', 'vehicleSelect', 'trackSelect', 'countdown'].forEach((s) => f.transition(s as never));
    expect(f.transition('countdown')).toBe(false);
  });

  it('notifies listeners exactly once per change', () => {
    const f = new GameStateMachine();
    const seen: string[] = [];
    const off = f.onChange((to, from) => seen.push(`${from}>${to}`));
    f.transition('mainMenu');
    f.transition('mainMenu');
    off();
    f.transition('settings');
    expect(seen).toEqual(['loading>mainMenu']);
  });

  it('only simulates in race states', () => {
    const f = new GameStateMachine();
    f.transition('mainMenu');
    expect(f.simulating).toBe(false);
  });
});

const result = (id: number, position: number, isPlayer = false): RacerResult => ({
  racerId: id, name: `R${id}`, vehicleId: 'vortex', isPlayer, position, time: 60 + position, bestLap: 20, hits: 0,
});

describe('Championship scoring', () => {
  it('awards points by finishing position', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(pointsForPosition)).toEqual([10, 8, 6, 5, 4, 3, 0]);
  });

  it('accumulates standings across races and breaks ties on wins', () => {
    const c = new Championship(['a', 'b', 'c']);
    c.recordRace([result(0, 1, true), result(1, 2), result(2, 3)]);
    expect(c.currentTrackId).toBe('b');
    c.recordRace([result(1, 1), result(0, 2, true), result(2, 3)]);
    c.recordRace([result(2, 1), result(0, 3, true), result(1, 2)]);
    expect(c.isComplete).toBe(true);
    const s = c.sorted();
    // Player: 10 + 8 + 6 = 24, R1: 8 + 10 + 8 = 26, R2: 6 + 6 + 10 = 22
    expect(s.map((r) => [r.racerId, r.points])).toEqual([[1, 26], [0, 24], [2, 22]]);
    expect(s[0].wins).toBe(1);
  });
});

describe('Power-ups', () => {
  it('cannot activate without an item, while cooling down, or while wrecked', () => {
    expect(canActivate({ powerUp: null, activationCooldown: 0, wrecked: false })).toBe(false);
    expect(canActivate({ powerUp: 'arc', activationCooldown: 0.3, wrecked: false })).toBe(false);
    expect(canActivate({ powerUp: 'arc', activationCooldown: 0, wrecked: true })).toBe(false);
    expect(canActivate({ powerUp: 'arc', activationCooldown: 0, wrecked: false })).toBe(true);
  });

  it('never rolls offensive items when combat is disabled (Time Trial)', () => {
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 500; i++) {
      const p = rollPowerUp(1 + (i % 6), 6, rand, false);
      expect(POWERUPS[p].offensive).toBe(false);
    }
  });

  it('gives trailing racers more catch-up items than the leader', () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const count = (pos: number) => {
      let n = 0;
      for (let i = 0; i < 4000; i++) {
        const p = rollPowerUp(pos, 6, rand);
        if (p === 'seeker' || p === 'nitro') n++;
      }
      return n;
    };
    expect(count(6)).toBeGreaterThan(count(1) * 1.5);
  });
});

describe('Save data', () => {
  it('falls back to defaults for corrupted data', () => {
    const s = sanitizeSave({ settings: { quality: 'ultra', master: 'loud', cameraShake: 7 }, bestTimes: { a: -3, b: 61.2, c: 'x' } });
    expect(s.settings.quality).toBe('high');
    expect(s.settings.master).toBe(0.8);
    expect(s.settings.cameraShake).toBe(1);
    expect(s.bestTimes).toEqual({ b: 61.2 });
  });

  it('survives invalid JSON and missing storage', () => {
    const broken = { getItem: () => '{not json', setItem: () => { throw new Error('quota'); } };
    const m = new SaveManager(broken);
    expect(m.data.version).toBe(1);
    expect(() => m.save()).not.toThrow();
    const none = new SaveManager(null);
    expect(none.submitBestTime('t', 50)).toBe(true);
  });

  it('only stores improved best times', () => {
    const mem = new Map<string, string>();
    const m = new SaveManager({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) });
    expect(m.submitBestTime('neon', 90)).toBe(true);
    expect(m.submitBestTime('neon', 95)).toBe(false);
    expect(m.submitBestTime('neon', 88)).toBe(true);
    const reloaded = new SaveManager({ getItem: (k) => mem.get(k) ?? null, setItem: () => {} });
    expect(reloaded.data.bestTimes.neon).toBe(88);
  });
});

describe('Formatting', () => {
  it('formats times and ordinals', () => {
    expect(formatTime(83.456)).toBe('1:23.456');
    expect(formatTime(null)).toBe('--:--.---');
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']);
  });
});
