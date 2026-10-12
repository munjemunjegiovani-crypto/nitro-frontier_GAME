import { formatTime, ordinal, pointsForPosition, type RacerResult, type StandingRow } from '../game/RaceResults';
import { getVehicle } from '../vehicles/VehicleConfig';
import { h } from './dom';
import { Screen, button, type UiSounds } from './Screen';

const col = (vehicleId: string) => `#${getVehicle(vehicleId).accent.toString(16).padStart(6, '0')}`;

export class ResultsScreen extends Screen {
  private title = h('h2', { class: 'screen-title' });
  private subtitle = h('div', { class: 'results-sub' });
  private table = h('div', { class: 'results-table panel' });
  private actionsEl = h('div', { class: 'screen-actions' });

  constructor(private sounds: UiSounds) {
    super('results-screen');
    this.el.append(this.title, this.subtitle, this.table, this.actionsEl);
  }

  private setActions(btns: [string, () => void, boolean?][]): void {
    this.actionsEl.innerHTML = '';
    for (const [label, fn, primary] of btns) this.actionsEl.append(button(label, fn, this.sounds, { primary }));
  }

  showRace(opts: {
    results: RacerResult[];
    trackName: string;
    championship: boolean;
    timeTrial: boolean;
    newBest: boolean;
    actions: [string, () => void, boolean?][];
  }): void {
    const me = opts.results.find((r) => r.isPlayer)!;
    if (opts.timeTrial) {
      this.title.textContent = opts.newBest ? 'NEW PERSONAL BEST!' : 'TIME TRIAL COMPLETE';
      this.subtitle.textContent = `${opts.trackName} · ${formatTime(me.time)}`;
    } else {
      this.title.textContent = me.position === 1 ? 'VICTORY!' : `FINISHED ${ordinal(me.position).toUpperCase()}`;
      this.subtitle.textContent = opts.trackName;
    }
    this.el.classList.toggle('win', me.position === 1 && !opts.timeTrial);
    const leader = opts.results[0].time;
    this.table.innerHTML = '';
    this.table.append(h('div', { class: 'rt-row head' },
      h('span', {}, 'POS'), h('span', {}, 'DRIVER'), h('span', {}, 'TIME'), h('span', {}, 'BEST LAP'), h('span', {}, 'HITS'),
      opts.championship ? h('span', {}, 'PTS') : h('span', {}, 'GAP'),
    ));
    opts.results.forEach((r, i) => {
      const row = h('div', { class: `rt-row${r.isPlayer ? ' me' : ''}` },
        h('span', { class: 'rt-pos' }, String(r.position)),
        h('span', { class: 'rt-name' }, h('i', { class: 'swatch' }), `${r.name}  `, h('small', {}, getVehicle(r.vehicleId).name)),
        h('span', {}, r.time === null ? 'DNF*' : formatTime(r.time)),
        h('span', {}, formatTime(r.bestLap)),
        h('span', {}, String(r.hits)),
        opts.championship
          ? h('span', { class: 'rt-pts' }, `+${pointsForPosition(r.position)}`)
          : h('span', {}, r.time !== null && leader !== null && i > 0 ? `+${(r.time - leader).toFixed(2)}` : '—'),
      );
      (row.querySelector('.swatch') as HTMLElement).style.background = col(r.vehicleId);
      row.style.animationDelay = `${i * 70}ms`;
      this.table.append(row);
    });
    if (opts.results.some((r) => r.time === null)) {
      this.table.append(h('div', { class: 'rt-note' }, '* Classified by distance when the race closed.'));
    }
    this.setActions(opts.actions);
    this.show();
  }

  showStandings(opts: { rows: StandingRow[]; raceNumber: number; totalRaces: number; complete: boolean; actions: [string, () => void, boolean?][] }): void {
    const meIndex = opts.rows.findIndex((r) => r.isPlayer);
    this.title.textContent = opts.complete
      ? meIndex === 0 ? 'CHAMPION!' : `CHAMPIONSHIP ${ordinal(meIndex + 1).toUpperCase()}`
      : 'CHAMPIONSHIP STANDINGS';
    this.subtitle.textContent = opts.complete ? 'FINAL STANDINGS' : `AFTER RACE ${opts.raceNumber} OF ${opts.totalRaces}`;
    this.el.classList.toggle('win', opts.complete && meIndex === 0);
    this.table.innerHTML = '';
    this.table.append(h('div', { class: 'rt-row head standings' },
      h('span', {}, 'POS'), h('span', {}, 'DRIVER'), h('span', {}, 'WINS'), h('span', {}, 'LAST'), h('span', {}, 'POINTS'),
    ));
    opts.rows.forEach((r, i) => {
      const row = h('div', { class: `rt-row standings${r.isPlayer ? ' me' : ''}` },
        h('span', { class: 'rt-pos' }, String(i + 1)),
        h('span', { class: 'rt-name' }, h('i', { class: 'swatch' }), `${r.name}  `, h('small', {}, getVehicle(r.vehicleId).name)),
        h('span', {}, String(r.wins)),
        h('span', {}, `+${r.lastRacePoints}`),
        h('span', { class: 'rt-pts big' }, String(r.points)),
      );
      (row.querySelector('.swatch') as HTMLElement).style.background = col(r.vehicleId);
      row.style.animationDelay = `${i * 70}ms`;
      this.table.append(row);
    });
    this.setActions(opts.actions);
    this.show();
  }
}
