import type { DriveInput } from './VehiclePhysics';

const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'ShiftLeft', 'ShiftRight', 'KeyE', 'KeyR', 'KeyM', 'KeyC', 'Escape',
  'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6',
]);

export type KeyAction = 'pause' | 'fire' | 'reset' | 'mute' | 'camera' | `grant${1 | 2 | 3 | 4 | 5 | 6}`;

/**
 * Keyboard input. Holds key state, produces smoothed analogue steering, and
 * emits one-shot actions. Clears everything on blur so keys never stick.
 */
export class PlayerController {
  private down = new Set<string>();
  private steer = 0;
  /** When false, game keys are not intercepted (menus can scroll/type). */
  capture = false;
  private actionHandler: (a: KeyAction) => void = () => {};

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.capture && GAME_KEYS.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.down.add(e.code);
    const action = this.mapAction(e.code);
    if (action) this.actionHandler(action);
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.down.delete(e.code);
  };
  private onBlur = () => this.clear();
  private onVisibility = () => {
    if (document.hidden) this.clear();
  };

  constructor() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  onAction(handler: (a: KeyAction) => void): void {
    this.actionHandler = handler;
  }

  private mapAction(code: string): KeyAction | null {
    switch (code) {
      case 'Escape': case 'KeyP': return 'pause';
      case 'KeyE': case 'Enter': return this.capture ? 'fire' : null;
      case 'KeyR': return this.capture ? 'reset' : null;
      case 'KeyM': return 'mute';
      case 'KeyC': return this.capture ? 'camera' : null;
    }
    const m = /^Digit([1-6])$/.exec(code);
    if (m && this.capture) return `grant${Number(m[1]) as 1 | 2 | 3 | 4 | 5 | 6}`;
    return null;
  }

  clear(): void {
    this.down.clear();
    this.steer = 0;
  }

  private has(...codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  read(dt: number, out: DriveInput): DriveInput {
    const left = this.has('KeyA', 'ArrowLeft');
    const right = this.has('KeyD', 'ArrowRight');
    const target = (right ? 1 : 0) - (left ? 1 : 0);
    // Smooth digital steering into an analogue value; snap back faster.
    const rate = target === 0 || Math.sign(target) !== Math.sign(this.steer) ? 9 : 5;
    this.steer += (target - this.steer) * Math.min(1, rate * dt);
    if (Math.abs(this.steer) < 0.01) this.steer = 0;
    out.steer = this.steer;
    out.throttle = this.has('KeyW', 'ArrowUp') ? 1 : 0;
    out.brake = this.has('KeyS', 'ArrowDown') ? 1 : 0;
    out.handbrake = this.has('Space');
    out.boost = this.has('ShiftLeft', 'ShiftRight');
    return out;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }
}
