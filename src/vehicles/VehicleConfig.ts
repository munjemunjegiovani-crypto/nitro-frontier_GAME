/** Body shape parameters used by the procedural car model builder. */
export interface VehicleShape {
  length: number;
  width: number;
  bodyHeight: number;
  cabinLength: number;
  cabinHeight: number;
  /** -1..1, where the cabin sits along the body (negative = towards rear). */
  cabinOffset: number;
  noseTaper: number;
  spoiler: 'none' | 'lip' | 'wing' | 'twin';
  wheelRadius: number;
  fins: boolean;
}

export interface VehicleConfig {
  id: string;
  name: string;
  tagline: string;
  /** Top speed in world units per second. */
  maxSpeed: number;
  acceleration: number;
  braking: number;
  /** Max yaw rate in radians per second. */
  steering: number;
  /** Lateral grip; higher = less sliding. */
  grip: number;
  /** Grip multiplier while handbrake drifting (lower = looser). */
  driftGrip: number;
  mass: number;
  /** Speed multiplier during nitro. */
  boostPower: number;
  /** Nitro meter consumption per second (lower = more efficient). */
  boostDrain: number;
  /** Incoming damage multiplier (lower = tougher). */
  durability: number;
  paint: number;
  accent: number;
  shape: VehicleShape;
}

export const VEHICLES: readonly VehicleConfig[] = [
  {
    id: 'vortex', name: 'VORTEX', tagline: 'Balanced all-rounder',
    maxSpeed: 74, acceleration: 30, braking: 60, steering: 2.1, grip: 7.5, driftGrip: 0.32,
    mass: 1.0, boostPower: 1.35, boostDrain: 0.28, durability: 1.0,
    paint: 0x1fb6ff, accent: 0xff7a1a,
    shape: { length: 4.4, width: 2.0, bodyHeight: 0.62, cabinLength: 1.8, cabinHeight: 0.5, cabinOffset: -0.05, noseTaper: 0.55, spoiler: 'lip', wheelRadius: 0.4, fins: false },
  },
  {
    id: 'ember', name: 'EMBER GT', tagline: 'Explosive acceleration',
    maxSpeed: 71, acceleration: 38, braking: 58, steering: 2.05, grip: 7.0, driftGrip: 0.3,
    mass: 0.9, boostPower: 1.38, boostDrain: 0.3, durability: 1.1,
    paint: 0xff5a14, accent: 0x20e3ff,
    shape: { length: 4.2, width: 2.05, bodyHeight: 0.58, cabinLength: 1.5, cabinHeight: 0.46, cabinOffset: -0.2, noseTaper: 0.45, spoiler: 'wing', wheelRadius: 0.42, fins: false },
  },
  {
    id: 'titan', name: 'TITAN RX', tagline: 'Heavy, armoured, unstoppable',
    maxSpeed: 70, acceleration: 27, braking: 64, steering: 1.85, grip: 8.0, driftGrip: 0.36,
    mass: 1.6, boostPower: 1.3, boostDrain: 0.27, durability: 0.62,
    paint: 0x58616f, accent: 0xff7a1a,
    shape: { length: 4.8, width: 2.3, bodyHeight: 0.85, cabinLength: 2.1, cabinHeight: 0.62, cabinOffset: -0.05, noseTaper: 0.8, spoiler: 'twin', wheelRadius: 0.5, fins: true },
  },
  {
    id: 'phantom', name: 'PHANTOM S', tagline: 'Untouchable top speed',
    maxSpeed: 81, acceleration: 27, braking: 55, steering: 1.85, grip: 6.6, driftGrip: 0.3,
    mass: 0.95, boostPower: 1.34, boostDrain: 0.3, durability: 1.15,
    paint: 0x1a1d24, accent: 0xff2fb4,
    shape: { length: 4.9, width: 1.95, bodyHeight: 0.5, cabinLength: 1.6, cabinHeight: 0.42, cabinOffset: -0.15, noseTaper: 0.35, spoiler: 'wing', wheelRadius: 0.4, fins: true },
  },
  {
    id: 'kestrel', name: 'KESTREL', tagline: 'Razor-sharp cornering',
    maxSpeed: 72, acceleration: 31, braking: 66, steering: 2.45, grip: 9.0, driftGrip: 0.34,
    mass: 0.8, boostPower: 1.33, boostDrain: 0.29, durability: 1.2,
    paint: 0xf2f6ff, accent: 0x20e3ff,
    shape: { length: 4.0, width: 1.9, bodyHeight: 0.55, cabinLength: 1.4, cabinHeight: 0.45, cabinOffset: 0.0, noseTaper: 0.5, spoiler: 'lip', wheelRadius: 0.38, fins: false },
  },
  {
    id: 'tempest', name: 'TEMPEST', tagline: 'Precise handling, efficient boost',
    maxSpeed: 75, acceleration: 31, braking: 60, steering: 2.25, grip: 8.2, driftGrip: 0.28,
    mass: 1.0, boostPower: 1.4, boostDrain: 0.2, durability: 0.95,
    paint: 0xb21cff, accent: 0xff7a1a,
    shape: { length: 4.5, width: 2.05, bodyHeight: 0.6, cabinLength: 1.7, cabinHeight: 0.48, cabinOffset: -0.1, noseTaper: 0.5, spoiler: 'twin', wheelRadius: 0.42, fins: true },
  },
];

export function getVehicle(id: string): VehicleConfig {
  return VEHICLES.find((v) => v.id === id) ?? VEHICLES[0];
}

/** Normalised 0..1 stat values for the vehicle-select bars. */
export function vehicleStats(v: VehicleConfig): Record<string, number> {
  const norm = (x: number, lo: number, hi: number) => Math.max(0.05, Math.min(1, (x - lo) / (hi - lo)));
  return {
    'Top speed': norm(v.maxSpeed, 64, 82),
    Acceleration: norm(v.acceleration, 22, 40),
    Handling: norm(v.steering * v.grip, 11, 23),
    Boost: norm(v.boostPower / v.boostDrain, 3.8, 7.2),
    Durability: norm(1 / v.durability, 0.75, 1.65),
  };
}
