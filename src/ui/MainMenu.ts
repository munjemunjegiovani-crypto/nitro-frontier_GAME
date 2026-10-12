import type { GameMode } from '../game/RaceManager';
import { POWERUPS, POWERUP_ORDER } from '../combat/PowerUp';
import { h, powerUpIcon } from './dom';
import { Screen, button, controlsTable, type UiSounds } from './Screen';

export class MainMenu extends Screen {
  private stats = h('div', { class: 'menu-stats' });
  private controls: HTMLElement;

  constructor(sounds: UiSounds, actions: { play(): void; settings(): void }) {
    super('main-menu');
    this.controls = h('div', { class: 'panel controls-panel hidden' },
      h('h3', {}, 'CONTROLS'),
      controlsTable(),
      h('h3', {}, 'POWER-UPS'),
      h('div', { class: 'pu-list' }, ...POWERUP_ORDER.map((p) => {
        const icon = h('div', { class: 'pu-icon', html: powerUpIcon(p) });
        icon.style.color = POWERUPS[p].css;
        return h('div', { class: 'pu-row' }, icon, h('div', {}, h('b', {}, POWERUPS[p].name), h('span', {}, POWERUPS[p].description)));
      })),
      button('CLOSE', () => this.controls.classList.add('hidden'), sounds, { small: true }),
    );
    this.el.append(
      h('div', { class: 'logo' },
        h('div', { class: 'logo-top' }, 'NITRO'),
        h('div', { class: 'logo-bottom' }, 'FRONTIER'),
        h('div', { class: 'logo-tag' }, 'ARCADE COMBAT RACING'),
      ),
      h('nav', { class: 'menu-buttons' },
        button('PLAY', actions.play, sounds, { primary: true }),
        button('SETTINGS', actions.settings, sounds),
        button('CONTROLS', () => this.controls.classList.toggle('hidden'), sounds),
      ),
      this.stats,
      this.controls,
      h('div', { class: 'menu-footer' }, 'v1.0 · An original game · Press ENTER to start'),
    );
  }

  setStats(racesWon: number, champs: number): void {
    this.stats.textContent = `RACES WON ${racesWon}  ·  CHAMPIONSHIPS ${champs}`;
  }

  hideControls(): void {
    this.controls.classList.add('hidden');
  }
}

const MODES: { mode: GameMode; name: string; desc: string; tag: string }[] = [
  { mode: 'quick', name: 'QUICK RACE', desc: 'Pick a car and a circuit. Six racers, full combat.', tag: '6 RACERS · COMBAT' },
  { mode: 'championship', name: 'CHAMPIONSHIP', desc: 'Three circuits back to back. Points decide the champion.', tag: '3 RACES · POINTS' },
  { mode: 'timeTrial', name: 'TIME TRIAL', desc: 'Just you and the clock. Beat your personal best.', tag: 'SOLO · NO WEAPONS' },
  { mode: 'practice', name: 'PRACTICE', desc: 'Free laps with training drones. Keys 1–6 equip any power-up.', tag: 'FREE ROAM · DRONES' },
];

export class ModeSelect extends Screen {
  constructor(sounds: UiSounds, actions: { choose(m: GameMode): void; back(): void }) {
    super('mode-select');
    this.el.append(
      h('h2', { class: 'screen-title' }, 'SELECT MODE'),
      h('div', { class: 'mode-grid' }, ...MODES.map((m, i) => {
        const card = h('button', {
          class: 'mode-card',
          onclick: () => { sounds.click(); actions.choose(m.mode); },
          onmouseenter: () => sounds.hover(),
          ...(i === 0 ? { 'data-autofocus': true } : {}),
        },
        h('div', { class: 'mode-index' }, `0${i + 1}`),
        h('div', { class: 'mode-name' }, m.name),
        h('div', { class: 'mode-desc' }, m.desc),
        h('div', { class: 'mode-tag' }, m.tag));
        return card;
      })),
      h('div', { class: 'screen-actions' }, button('BACK', actions.back, sounds, { small: true })),
    );
  }
}
