import { formatTime } from '../game/RaceResults';
import type { GameMode } from '../game/RaceManager';
import { Track } from '../tracks/Track';
import { TRACKS } from '../tracks/TrackRegistry';
import { h, drawTrackMap } from './dom';
import { Screen, button, type UiSounds } from './Screen';

export class TrackSelect extends Screen {
  private index = 0;
  private laps = 3;
  private cards: HTMLElement[] = [];
  private bests: HTMLElement[] = [];
  private lapsValue = h('span', { class: 'laps-value' });
  private lapsRow: HTMLElement;
  private startBtn: HTMLButtonElement;

  constructor(sounds: UiSounds, private actions: { start(trackId: string, laps: number): void; back(): void; change(trackId: string): void }) {
    super('track-select');
    const grid = h('div', { class: 'track-grid' });
    TRACKS.forEach((def, i) => {
      const c = h('canvas', { class: 'track-map', width: 260, height: 180 });
      const track = new Track(def);
      const colors = ['#20e3ff', '#ff7a1a', '#ff2fb4'];
      drawTrackMap(c.getContext('2d')!, track, 260, 180, 16, colors[i % 3], 5);
      const best = h('div', { class: 'track-best' });
      this.bests.push(best);
      const card = h('button', {
        class: 'track-card',
        onclick: () => { sounds.click(); this.select(i); },
        ondblclick: () => this.actions.start(TRACKS[this.index].id, this.laps),
        onmouseenter: () => sounds.hover(),
      },
      c,
      h('div', { class: 'track-name' }, def.name),
      h('div', { class: 'track-sub' }, def.subtitle),
      h('div', { class: 'track-desc' }, def.description),
      h('div', { class: 'track-len' }, `${(track.length / 1000).toFixed(2)} KM`),
      best);
      card.style.setProperty('--c', colors[i % 3]);
      this.cards.push(card);
      grid.append(card);
    });
    this.lapsRow = h('div', { class: 'laps-row' },
      h('span', {}, 'LAPS'),
      h('button', { class: 'arrow small', onclick: () => { sounds.click(); this.setLaps(this.laps - 1); } }, '−'),
      this.lapsValue,
      h('button', { class: 'arrow small', onclick: () => { sounds.click(); this.setLaps(this.laps + 1); } }, '+'),
    );
    this.startBtn = button('START RACE', () => this.actions.start(TRACKS[this.index].id, this.laps), sounds, { primary: true });
    this.el.append(
      h('h2', { class: 'screen-title' }, 'SELECT CIRCUIT'),
      grid,
      h('div', { class: 'screen-actions' }, button('BACK', actions.back, sounds, { small: true }), this.lapsRow, this.startBtn),
    );
    this.setLaps(3);
  }

  private setLaps(n: number): void {
    this.laps = Math.max(1, Math.min(5, n));
    this.lapsValue.textContent = String(this.laps);
  }

  select(i: number): void {
    this.index = i;
    this.cards.forEach((c, k) => c.classList.toggle('active', k === i));
    this.actions.change(TRACKS[i].id);
  }

  prepare(mode: GameMode, bestTimes: Record<string, number>, lastTrack: string): void {
    TRACKS.forEach((t, i) => {
      const bt = bestTimes[t.id];
      this.bests[i].textContent = mode === 'timeTrial' ? `BEST ${bt ? formatTime(bt) : '—'}` : '';
    });
    this.lapsRow.style.display = mode === 'practice' ? 'none' : '';
    this.startBtn.querySelector('.btn-label')!.textContent = mode === 'practice' ? 'START PRACTICE' : 'START RACE';
    const i = TRACKS.findIndex((t) => t.id === lastTrack);
    this.select(i < 0 ? 0 : i);
  }
}
