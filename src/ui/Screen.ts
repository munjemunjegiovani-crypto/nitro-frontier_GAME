import { h } from './dom';

/** Base for full-screen menu overlays. */
export abstract class Screen {
  readonly el: HTMLElement;

  constructor(className: string) {
    this.el = h('div', { class: `screen ${className} hidden` });
  }

  show(): void {
    this.el.classList.remove('hidden');
    this.el.classList.remove('enter');
    void this.el.offsetWidth;
    this.el.classList.add('enter');
    const first = this.el.querySelector<HTMLElement>('[data-autofocus]') ?? this.el.querySelector<HTMLElement>('button:not([disabled])');
    first?.focus({ preventScroll: true });
    this.el.scrollTop = 0;
  }

  hide(): void {
    this.el.classList.add('hidden');
  }

  get visible(): boolean {
    return !this.el.classList.contains('hidden');
  }
}

export interface UiSounds {
  click(): void;
  hover(): void;
}

/** Standard menu button with sound hooks. */
export function button(label: string, onClick: () => void, sounds: UiSounds, opts: { primary?: boolean; small?: boolean; sub?: string } = {}): HTMLButtonElement {
  const b = h('button', {
    class: `btn${opts.primary ? ' primary' : ''}${opts.small ? ' small' : ''}`,
    onclick: () => { sounds.click(); onClick(); },
    onmouseenter: () => sounds.hover(),
  }, h('span', { class: 'btn-label' }, label), opts.sub ? h('span', { class: 'btn-sub' }, opts.sub) : null);
  return b;
}

export const CONTROLS: [string, string][] = [
  ['W / ↑', 'Accelerate'],
  ['S / ↓', 'Brake / reverse'],
  ['A D / ← →', 'Steer'],
  ['SPACE', 'Handbrake drift'],
  ['SHIFT', 'Nitro boost'],
  ['E', 'Fire power-up'],
  ['R', 'Recover car'],
  ['C', 'Change camera'],
  ['M', 'Mute'],
  ['ESC', 'Pause'],
];

export function controlsTable(): HTMLElement {
  return h('div', { class: 'controls-grid' },
    ...CONTROLS.flatMap(([k, a]) => [h('kbd', {}, k), h('span', {}, a)]),
  );
}
