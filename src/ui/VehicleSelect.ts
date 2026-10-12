import { VEHICLES, vehicleStats } from '../vehicles/VehicleConfig';
import { h } from './dom';
import { Screen, button, type UiSounds } from './Screen';

export class VehicleSelect extends Screen {
  private index = 0;
  private name = h('div', { class: 'veh-name' });
  private tag = h('div', { class: 'veh-tag' });
  private statsEl = h('div', { class: 'veh-stats' });
  private list = h('div', { class: 'veh-list' });
  private counter = h('div', { class: 'veh-counter' });
  private continueBtn: HTMLButtonElement;
  private onKey = (e: KeyboardEvent) => {
    if (!this.visible) return;
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.step(-1);
    if (e.code === 'ArrowRight' || e.code === 'KeyD') this.step(1);
  };

  constructor(private sounds: UiSounds, private actions: { change(id: string): void; next(id: string): void; back(): void }) {
    super('vehicle-select');
    VEHICLES.forEach((v, i) => {
      const chip = h('button', {
        class: 'veh-chip',
        onclick: () => { sounds.click(); this.select(i); },
        onmouseenter: () => sounds.hover(),
      }, v.name);
      chip.style.setProperty('--c', `#${v.accent.toString(16).padStart(6, '0')}`);
      this.list.append(chip);
    });
    this.continueBtn = button('CONTINUE', () => this.actions.next(VEHICLES[this.index].id), sounds, { primary: true });
    this.el.append(
      h('h2', { class: 'screen-title' }, 'SELECT VEHICLE'),
      h('div', { class: 'veh-panel panel' },
        this.counter, this.name, this.tag, this.statsEl,
      ),
      h('div', { class: 'veh-arrows' },
        h('button', { class: 'arrow', 'aria-label': 'Previous', onclick: () => { sounds.click(); this.step(-1); } }, '‹'),
        h('button', { class: 'arrow', 'aria-label': 'Next', onclick: () => { sounds.click(); this.step(1); } }, '›'),
      ),
      this.list,
      h('div', { class: 'screen-actions' }, button('BACK', actions.back, sounds, { small: true }), this.continueBtn),
    );
    window.addEventListener('keydown', this.onKey);
  }

  private step(d: number): void {
    this.sounds.hover();
    this.select((this.index + d + VEHICLES.length) % VEHICLES.length);
  }

  select(i: number): void {
    this.index = i;
    const v = VEHICLES[i];
    this.name.textContent = v.name;
    this.tag.textContent = v.tagline;
    this.counter.textContent = `${String(i + 1).padStart(2, '0')} / ${String(VEHICLES.length).padStart(2, '0')}`;
    this.statsEl.innerHTML = '';
    for (const [label, val] of Object.entries(vehicleStats(v))) {
      const fill = h('div', { class: 'stat-fill' });
      fill.style.width = `${Math.round(val * 100)}%`;
      this.statsEl.append(h('div', { class: 'stat' }, h('span', {}, label.toUpperCase()), h('div', { class: 'stat-track' }, fill)));
    }
    [...this.list.children].forEach((c, k) => c.classList.toggle('active', k === i));
    this.el.style.setProperty('--veh', `#${v.accent.toString(16).padStart(6, '0')}`);
    this.actions.change(v.id);
  }

  selectById(id: string): void {
    const i = VEHICLES.findIndex((v) => v.id === id);
    this.select(i < 0 ? 0 : i);
  }

  override show(): void {
    super.show();
    this.continueBtn.focus({ preventScroll: true });
  }
}
