export type GameStateName =
  | 'loading'
  | 'mainMenu'
  | 'modeSelect'
  | 'vehicleSelect'
  | 'trackSelect'
  | 'settings'
  | 'countdown'
  | 'racing'
  | 'paused'
  | 'raceComplete'
  | 'championshipResults';

/** Allowed transitions. Anything not listed here is rejected. */
const TRANSITIONS: Record<GameStateName, readonly GameStateName[]> = {
  loading: ['mainMenu'],
  mainMenu: ['modeSelect', 'settings'],
  modeSelect: ['vehicleSelect', 'mainMenu'],
  vehicleSelect: ['trackSelect', 'countdown', 'modeSelect'],
  trackSelect: ['countdown', 'vehicleSelect'],
  settings: ['mainMenu', 'paused'],
  countdown: ['racing', 'paused', 'mainMenu'],
  racing: ['paused', 'raceComplete', 'countdown', 'mainMenu'],
  paused: ['racing', 'countdown', 'mainMenu', 'settings'],
  raceComplete: ['countdown', 'mainMenu', 'championshipResults'],
  championshipResults: ['countdown', 'mainMenu'],
};

export type StateListener = (to: GameStateName, from: GameStateName) => void;

/** Small explicit finite-state machine for the top-level game flow. */
export class GameStateMachine {
  private _state: GameStateName = 'loading';
  private listeners = new Set<StateListener>();

  get state(): GameStateName {
    return this._state;
  }

  canTransition(to: GameStateName): boolean {
    return TRANSITIONS[this._state].includes(to);
  }

  /** Returns false (and does nothing) for an invalid or duplicate transition. */
  transition(to: GameStateName): boolean {
    if (to === this._state || !this.canTransition(to)) return false;
    const from = this._state;
    this._state = to;
    for (const l of this.listeners) l(to, from);
    return true;
  }

  onChange(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** True when the simulation should advance (cars move, timers run). */
  get simulating(): boolean {
    return this._state === 'racing' || this._state === 'countdown' || this._state === 'raceComplete';
  }
}
