import { describe, expect, it } from 'vitest';
import { RacingLine } from '../src/ai/RacingLine';
import { Track } from '../src/tracks/Track';
import { TRACKS } from '../src/tracks/TrackRegistry';
import { VEHICLES } from '../src/vehicles/VehicleConfig';
import { VehiclePhysics, type DriveInput } from '../src/vehicles/VehiclePhysics';

const tracks = TRACKS.map((d) => new Track(d));
const full = (steer = 0): DriveInput => ({ throttle: 1, brake: 0, steer, handbrake: false, boost: false });

describe('Tracks', () => {
  it.each(tracks.map((t) => [t.def.id, t] as const))('%s is a sane closed circuit', (_id, t) => {
    expect(t.count).toBeGreaterThan(500);
    // Neighbouring samples are evenly spaced (no gaps the car could fall through).
    for (let i = 0; i < t.count; i++) {
      const d = t.sample(i).pos.distanceTo(t.sample(i + 1).pos);
      expect(d).toBeGreaterThan(1.5);
      expect(d).toBeLessThan(3.5);
    }
    // Where the road passes over itself the decks are well separated vertically.
    for (let i = 0; i < t.count; i += 3) {
      for (let j = i + 40; j < t.count - 40 + i && j < t.count; j += 3) {
        const a = t.sample(i).pos, b = t.sample(j).pos;
        if (Math.hypot(a.x - b.x, a.z - b.z) < t.def.width + 4) expect(Math.abs(a.y - b.y)).toBeGreaterThan(9);
      }
    }
  });

  it('nearest-sample query returns the right lateral offset', () => {
    const t = tracks[0];
    const p = t.pointAt(100, 4.5);
    const q = t.query(p, 98);
    expect(Math.abs(q.index - 100)).toBeLessThanOrEqual(1);
    expect(q.lateral).toBeCloseTo(4.5, 0);
  });
});

describe('VehiclePhysics', () => {
  it('accelerates toward (and not beyond) top speed', () => {
    const t = tracks[1];
    const car = new VehiclePhysics(VEHICLES[0]);
    car.place(t, 0, 0);
    let max = 0;
    for (let i = 0; i < 60 * 12; i++) {
      // Simple lane-keeping so the car isn't scrubbing speed on the walls.
      const ahead = t.pointAt(car.trackIndex + 12, 0);
      let dh = Math.atan2(ahead.x - car.x, ahead.z - car.z) - car.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      car.step(full(Math.max(-1, Math.min(1, -dh * 3))), 1 / 60, t);
      max = Math.max(max, car.speed);
    }
    expect(max).toBeGreaterThan(VEHICLES[0].maxSpeed * 0.93);
    expect(max).toBeLessThan(VEHICLES[0].maxSpeed * 1.05);
  });

  it('right steer turns the car to the right', () => {
    const t = tracks[0];
    const car = new VehiclePhysics(VEHICLES[0]);
    car.place(t, 0, 0);
    for (let i = 0; i < 60; i++) car.step(full(), 1 / 60, t);
    const lat0 = car.lateral;
    for (let i = 0; i < 20; i++) car.step(full(1), 1 / 60, t);
    expect(car.lateral).toBeGreaterThan(lat0);
  });

  it.each(VEHICLES.map((v) => [v.id, v] as const))('%s can never leave the road through a wall', (_id, cfg) => {
    for (const t of tracks) {
      const car = new VehiclePhysics(cfg);
      car.place(t, 10, 0);
      for (let i = 0; i < 60 * 20; i++) {
        // Full throttle with hard steering that flips every 3 seconds → constant wall abuse.
        const steer = Math.floor(i / 180) % 2 ? 1 : -1;
        car.step({ throttle: 1, brake: 0, steer, handbrake: i % 240 < 60, boost: true }, 1 / 60, t);
        expect(Math.abs(car.lateral)).toBeLessThanOrEqual(t.def.width / 2);
        expect(Number.isFinite(car.x + car.z + car.y)).toBe(true);
      }
    }
  });

  it('brakes to a stop and reverses', () => {
    const t = tracks[1];
    const car = new VehiclePhysics(VEHICLES[2]);
    car.place(t, 0, 0);
    for (let i = 0; i < 180; i++) car.step(full(), 1 / 60, t);
    for (let i = 0; i < 300; i++) car.step({ throttle: 0, brake: 1, steer: 0, handbrake: false, boost: false }, 1 / 60, t);
    expect(car.forwardSpeed).toBeLessThan(0);
  });

  it('nitro drains the meter and raises speed', () => {
    const t = tracks[1];
    const a = new VehiclePhysics(VEHICLES[0]);
    const b = new VehiclePhysics(VEHICLES[0]);
    a.place(t, 0, -3);
    b.place(t, 0, 3);
    for (let i = 0; i < 180; i++) {
      a.step(full(), 1 / 60, t);
      b.step({ ...full(), boost: true }, 1 / 60, t);
    }
    expect(b.speed).toBeGreaterThan(a.speed);
    expect(b.nitro).toBeLessThan(a.nitro);
  });
});

describe('RacingLine', () => {
  it('keeps the line inside the road and corner speeds positive', () => {
    for (const t of tracks) {
      const line = new RacingLine(t);
      for (let i = 0; i < t.count; i++) {
        expect(Math.abs(line.offset[i])).toBeLessThan(t.def.width / 2);
        expect(line.cornerSpeed(i, 50)).toBeGreaterThan(20);
      }
    }
  });
});
