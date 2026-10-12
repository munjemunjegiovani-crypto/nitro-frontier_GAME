import type { Settings } from '../storage/SaveManager';
import { h } from './dom';
import { Screen, button, controlsTable, type UiSounds } from './Screen';

export class SettingsMenu extends Screen {
  private rows = h('div', { class: 'settings-rows' });
  private settings!: Settings;

  constructor(private sounds: UiSounds, private actions: { change(s: Settings): void; back(): void }) {
    super('settings-menu');
    this.el.append(
      h('h2', { class: 'screen-title' }, 'SETTINGS'),
      h('div', { class: 'settings-layout' },
        h('div', { class: 'panel' }, this.rows),
        h('div', { class: 'panel' }, h('h3', {}, 'KEYBOARD CONTROLS'), controlsTable()),
      ),
      h('div', { class: 'screen-actions' }, button('BACK', () => this.actions.back(), sounds, { primary: true })),
    );
  }

  open(s: Settings): void {
    this.settings = { ...s };
    this.render();
    this.show();
  }

  private emit(): void {
    this.actions.change({ ...this.settings });
  }

  private render(): void {
    const s = this.settings;
    this.rows.innerHTML = '';
    const choice = <K extends keyof Settings>(label: string, key: K, options: [Settings[K], string][]) => {
      const group = h('div', { class: 'seg' });
      for (const [val, text] of options) {
        const b = h('button', {
          class: `seg-btn${s[key] === val ? ' active' : ''}`,
          onclick: () => {
            this.sounds.click();
            s[key] = val;
            [...group.children].forEach((c) => c.classList.remove('active'));
            b.classList.add('active');
            this.emit();
          },
        }, text);
        group.append(b);
      }
      this.rows.append(h('div', { class: 'set-row' }, h('label', {}, label), group));
    };
    const slider = (label: string, key: 'master' | 'music' | 'sfx' | 'engine' | 'cameraShake' | 'renderScale', min = 0, max = 1) => {
      const out = h('span', { class: 'set-val' }, `${Math.round((s[key] as number) * 100)}%`);
      const input = h('input', { type: 'range', min, max, step: 0.05, value: s[key] as number }) as HTMLInputElement;
      input.addEventListener('input', () => {
        s[key] = Number(input.value);
        out.textContent = `${Math.round(s[key] * 100)}%`;
        this.emit();
      });
      this.rows.append(h('div', { class: 'set-row' }, h('label', {}, label), input, out));
    };
    choice('GRAPHICS QUALITY', 'quality', [['low', 'LOW'], ['medium', 'MEDIUM'], ['high', 'HIGH']]);
    slider('RENDER SCALE', 'renderScale', 0.5, 1);
    slider('MASTER VOLUME', 'master');
    slider('MUSIC', 'music');
    slider('EFFECTS', 'sfx');
    slider('ENGINE', 'engine');
    slider('CAMERA SHAKE', 'cameraShake');
    choice('SPEED EFFECTS', 'speedEffects', [[true, 'ON'], [false, 'OFF']]);
    choice('FPS COUNTER', 'showFps', [[true, 'ON'], [false, 'OFF']]);
  }
}
