import { describe, expect, it } from 'vitest';
import { principalYaw } from '../src/vehicles/CarAssets';

/** Points of a long thin rectangle rotated so its long axis points along `yaw` (atan2(x, z) convention). */
function rect(yaw: number, length = 4, width = 1.8) {
  const pts: { x: number; z: number }[] = [];
  for (let i = -10; i <= 10; i++) {
    for (let j = -4; j <= 4; j++) {
      const a = (i / 10) * length / 2, b = (j / 4) * width / 2; // a along the car, b across
      pts.push({ x: a * Math.sin(yaw) + b * Math.cos(yaw), z: a * Math.cos(yaw) - b * Math.sin(yaw) });
    }
  }
  return pts;
}

const sameAxis = (a: number, b: number) => {
  // Axis direction is defined modulo 180°.
  let d = (a - b) % Math.PI;
  if (d < 0) d += Math.PI;
  return Math.min(d, Math.PI - d);
};

describe('principalYaw (auto-alignment of imported car models)', () => {
  it.each([0, 0.3, 0.61, 1.2, Math.PI / 2, 2.4, -0.8])('finds the long axis of a car rotated by %f rad', (yaw) => {
    expect(sameAxis(principalYaw(rect(yaw)), yaw)).toBeLessThan(0.01);
  });

  it('ignores the position of the model', () => {
    const shifted = rect(0.7).map((p) => ({ x: p.x + 50, z: p.z - 12 }));
    expect(sameAxis(principalYaw(shifted), 0.7)).toBeLessThan(0.01);
  });
});
