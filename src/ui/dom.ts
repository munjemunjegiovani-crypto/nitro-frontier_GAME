import type { PowerUpType } from '../combat/PowerUp';
import type { Track } from '../tracks/Track';

type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined>;

/** Tiny hyperscript helper for building UI without a framework. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'class') {
      el.className = String(v);
    } else if (k === 'html') {
      el.innerHTML = String(v);
    } else {
      el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

/** Original line-art icons for the six power-ups. */
export function powerUpIcon(type: PowerUpType | null): string {
  const s = (body: string) => `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  switch (type) {
    case 'arc': return s('<path d="M8 30 L22 24 L18 18 L40 12 L26 22 L30 28 Z" fill="currentColor" fill-opacity=".25"/>');
    case 'shield': return s('<path d="M24 6 L38 12 V24 C38 33 31 39 24 42 C17 39 10 33 10 24 V12 Z"/><path d="M18 24 L22 28 L30 19"/>');
    case 'pulse': return s('<circle cx="24" cy="24" r="4" fill="currentColor"/><circle cx="24" cy="24" r="11" stroke-dasharray="4 4"/><circle cx="24" cy="24" r="18"/>');
    case 'seeker': return s('<path d="M24 6 L30 20 L42 24 L30 28 L24 42 L18 28 L6 24 L18 20 Z" fill="currentColor" fill-opacity=".2"/><circle cx="24" cy="24" r="4"/>');
    case 'nitro': return s('<path d="M14 40 L20 26 H12 L26 6 L22 20 H32 Z" fill="currentColor" fill-opacity=".25"/><path d="M34 30 H42 M32 36 H40"/>');
    case 'snare': return s('<ellipse cx="24" cy="30" rx="16" ry="6"/><ellipse cx="24" cy="30" rx="8" ry="3"/><path d="M24 30 V10 M18 14 L24 10 L30 14"/>');
    default: return s('<rect x="12" y="12" width="24" height="24" rx="4" stroke-dasharray="3 5" opacity=".5"/>');
  }
}

/** Draws a track outline (top-down) into a canvas. Returns the projection. */
export function drawTrackMap(
  ctx: CanvasRenderingContext2D,
  track: Track,
  w: number,
  h: number,
  pad: number,
  color: string,
  lineWidth: number,
): (x: number, z: number) => [number, number] {
  const b = track.bounds();
  const sx = (w - pad * 2) / (b.maxX - b.minX || 1);
  const sz = (h - pad * 2) / (b.maxZ - b.minZ || 1);
  const sc = Math.min(sx, sz);
  const ox = (w - (b.maxX - b.minX) * sc) / 2;
  const oz = (h - (b.maxZ - b.minZ) * sc) / 2;
  // Flip x so the map matches the driver's left/right when heading "up".
  const proj = (x: number, z: number): [number, number] => [w - (ox + (x - b.minX) * sc), h - (oz + (z - b.minZ) * sc)];
  ctx.clearRect(0, 0, w, h);
  ctx.lineJoin = 'round';
  const path = () => {
    ctx.beginPath();
    track.samples.forEach((s, i) => {
      const [px, py] = proj(s.pos.x, s.pos.z);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
  };
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = lineWidth + 4;
  path();
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  path();
  ctx.stroke();
  // Start line
  const s0 = track.sample(0);
  const [a0, a1] = proj(s0.pos.x + s0.right.x * s0.halfWidth, s0.pos.z + s0.right.z * s0.halfWidth);
  const [b0, b1] = proj(s0.pos.x - s0.right.x * s0.halfWidth, s0.pos.z - s0.right.z * s0.halfWidth);
  ctx.strokeStyle = '#f2f6ff';
  ctx.lineWidth = Math.max(2, lineWidth * 0.6);
  ctx.beginPath();
  ctx.moveTo(a0, a1);
  ctx.lineTo(b0, b1);
  ctx.stroke();
  return proj;
}
