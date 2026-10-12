import type { TrackDefinition } from './Track';

/** Figure-eight for Skyline Circuit: two lobes crossing at different heights. */
function skylinePoints(): [number, number, number][] {
  const pts: [number, number, number][] = [];
  const count = 22;
  for (let k = 0; k < count; k++) {
    const t = -0.45 + (k / count) * Math.PI * 2;
    const x = 175 * Math.sin(t) + 6 * Math.sin(3 * t);
    const z = 125 * Math.sin(2 * t);
    const y = 30 + 15 * Math.cos(t);
    pts.push([Math.round(x), Math.round(y * 10) / 10, Math.round(z)]);
  }
  return pts;
}

export const TRACKS: readonly TrackDefinition[] = [
  {
    id: 'neon-harbor',
    name: 'NEON HARBOR',
    subtitle: 'Coastal megacity · Night',
    description: 'Wet streets, glowing towers, a harbour bridge and a long tunnel under the docks.',
    laps: 3,
    width: 22,
    scale: 1.4,
    controlPoints: [
      [0, 0, 0], [0, 0, -110], [18, 1, -190], [80, 4, -235], [160, 7, -232], [215, 5, -180],
      [222, 1, -110], [190, 0, -60], [150, 0, -20], [140, 3, 50], [170, 9, 110], [160, 12, 175],
      [95, 11, 215], [20, 6, 210], [-45, 2, 175], [-80, 0, 110], [-55, 0, 55],
    ],
    tunnels: [[0.13, 0.24]],
    pickupRows: [0.08, 0.31, 0.52, 0.74, 0.9],
    boostPads: [0.04, 0.46, 0.66],
    jumps: [0.6],
    scenery: 'city',
    theme: {
      skyTop: 0x05060d, skyHorizon: 0x2a1450, fog: 0x120c26, fogDensity: 0.0042,
      ground: 0x12151e, road: 0x24283a, edge: 0x20e3ff, edgeAlt: 0xff2fb4,
      sun: 0x9fb4ff, sunIntensity: 1.1, ambient: 0x5a4a9a, ambientIntensity: 1.0, night: true,
    },
  },
  {
    id: 'redline-canyon',
    name: 'REDLINE CANYON',
    subtitle: 'Desert badlands · Dusk',
    description: 'Blistering straights, a hairpin at the refinery and a crest that sends you flying.',
    laps: 3,
    width: 24,
    scale: 1.45,
    controlPoints: [
      [0, 0, -40], [0, 0, -150], [15, 4, -250], [85, 12, -300], [170, 10, -285], [215, 5, -225],
      [195, 1, -160], [205, 0, -85], [262, 6, -25], [282, 17, 55], [262, 9, 120], [200, 14, 165],
      [120, 18, 165], [65, 6, 115], [-15, 3, 130], [-80, 0, 95], [-95, 0, 35], [-60, 0, -10],
    ],
    tunnels: [],
    pickupRows: [0.06, 0.28, 0.47, 0.68, 0.86],
    boostPads: [0.02, 0.38, 0.6],
    jumps: [0.53, 0.92],
    scenery: 'canyon',
    theme: {
      skyTop: 0x2b4f8f, skyHorizon: 0xff9a52, fog: 0xd98a5a, fogDensity: 0.0026,
      ground: 0xb5653a, road: 0x2a2624, edge: 0xff7a1a, edgeAlt: 0x20e3ff,
      sun: 0xffc48a, sunIntensity: 2.4, ambient: 0xffb38a, ambientIntensity: 0.9, night: false,
    },
  },
  {
    id: 'skyline-circuit',
    name: 'SKYLINE CIRCUIT',
    subtitle: 'Elevated megastructure · Twilight',
    description: 'A figure-eight hung in the sky. Cross over yourself at 300 km/h.',
    laps: 3,
    width: 21,
    scale: 1.45,
    controlPoints: skylinePoints(),
    tunnels: [],
    pickupRows: [0.1, 0.3, 0.5, 0.7, 0.88],
    boostPads: [0.2, 0.44, 0.7, 0.94],
    jumps: [],
    scenery: 'skyline',
    theme: {
      skyTop: 0x0b1a3a, skyHorizon: 0xff6aa8, fog: 0x3a3060, fogDensity: 0.0024,
      ground: 0x0d1020, road: 0x1d2130, edge: 0x20e3ff, edgeAlt: 0xff7a1a,
      sun: 0xffb0d0, sunIntensity: 1.7, ambient: 0x7a6ab8, ambientIntensity: 0.85, night: false,
    },
  },
];

export function getTrack(id: string): TrackDefinition {
  return TRACKS.find((t) => t.id === id) ?? TRACKS[0];
}
