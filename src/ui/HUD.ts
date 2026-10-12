import { POWERUPS } from '../combat/PowerUp';
import type { RaceManager } from '../game/RaceManager';
import { formatTime, ordinal } from '../game/RaceResults';
import { h, drawTrackMap, powerUpIcon } from './dom';

/** In-race heads-up display. All DOM writes are diffed to avoid layout churn. */
export class HUD {
  readonly el: HTMLElement;
  private pos = h('div', { class: 'hud-pos-num' });
  private posTotal = h('div', { class: 'hud-pos-total' });
  private lap = h('div', { class: 'hud-lap' });
  private timer = h('div', { class: 'hud-timer' });
  private lapInfo = h('div', { class: 'hud-lapinfo' });
  private speed = h('div', { class: 'hud-speed-num' });
  private nitroFill = h('div', { class: 'hud-bar-fill nitro' });
  private healthFill = h('div', { class: 'hud-bar-fill health' });
  private item = h('div', { class: 'hud-item' });
  private itemName = h('div', { class: 'hud-item-name' });
  private board = h('ol', { class: 'hud-board' });
  private feed = h('div', { class: 'hud-feed' });
  private banner = h('div', { class: 'hud-banner' });
  private countdown = h('div', { class: 'hud-countdown' });
  private fps = h('div', { class: 'hud-fps' });
  private mapCanvas = h('canvas', { class: 'hud-map', width: 220, height: 220 });
  private mapBg = document.createElement('canvas');
  private mapProj: ((x: number, z: number) => [number, number]) | null = null;
  private cache = new Map<string, string>();
  private bannerTimer = 0;
  private boardTimer = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  showFps = false;

  constructor() {
    this.el = h('div', { class: 'hud hidden' },
      h('div', { class: 'hud-tl' },
        h('div', { class: 'hud-pos' }, this.pos, this.posTotal),
        h('div', { class: 'hud-lapbox' }, this.lap, this.timer, this.lapInfo),
        this.board,
      ),
      h('div', { class: 'hud-tr' }, this.mapCanvas),
      h('div', { class: 'hud-bl' },
        h('div', { class: 'hud-speed' }, this.speed, h('span', { class: 'hud-speed-unit' }, 'KM/H')),
        h('div', { class: 'hud-bars' },
          h('div', { class: 'hud-bar' }, h('span', {}, 'NITRO'), h('div', { class: 'hud-bar-track' }, this.nitroFill)),
          h('div', { class: 'hud-bar' }, h('span', {}, 'HULL'), h('div', { class: 'hud-bar-track' }, this.healthFill)),
        ),
      ),
      h('div', { class: 'hud-bc' }, this.item, this.itemName, h('div', { class: 'hud-key' }, h('kbd', {}, 'E'), ' FIRE  ', h('kbd', {}, 'SHIFT'), ' NITRO')),
      this.feed,
      this.banner,
      this.countdown,
      this.fps,
    );
  }

  private set(el: HTMLElement, key: string, value: string, html = false): void {
    if (this.cache.get(key) === value) return;
    this.cache.set(key, value);
    if (html) el.innerHTML = value;
    else el.textContent = value;
  }

  show(race: RaceManager): void {
    this.el.classList.remove('hidden');
    this.cache.clear();
    this.feed.innerHTML = '';
    this.banner.className = 'hud-banner';
    this.countdown.className = 'hud-countdown';
    // Pre-render the static track outline once.
    this.mapBg.width = 220;
    this.mapBg.height = 220;
    const ctx = this.mapBg.getContext('2d')!;
    this.mapProj = drawTrackMap(ctx, race.track, 220, 220, 18, 'rgba(32,227,255,0.55)', 5);
    this.el.classList.toggle('practice', race.setup.mode === 'practice');
    this.el.classList.toggle('no-board', race.setup.opponents === 0);
  }

  hide(): void {
    this.el.classList.add('hidden');
  }

  notify(text: string, color = '#f2f6ff'): void {
    const item = h('div', { class: 'hud-note' }, text);
    item.style.setProperty('--c', color);
    this.feed.prepend(item);
    while (this.feed.children.length > 4) this.feed.lastElementChild?.remove();
    setTimeout(() => item.classList.add('out'), 1800);
    setTimeout(() => item.remove(), 2300);
  }

  bigBanner(text: string, color = '#ffd23f'): void {
    this.banner.textContent = text;
    this.banner.style.setProperty('--c', color);
    this.banner.className = 'hud-banner';
    void this.banner.offsetWidth; // restart animation
    this.banner.className = 'hud-banner show';
    this.bannerTimer = 1.6;
  }

  showCountdown(n: number): void {
    this.countdown.textContent = n > 0 ? String(n) : 'GO!';
    this.countdown.className = 'hud-countdown';
    void this.countdown.offsetWidth;
    this.countdown.className = `hud-countdown show ${n > 0 ? '' : 'go'}`;
  }

  update(race: RaceManager, dt: number): void {
    const P = race.player;
    const total = race.vehicles.length;
    const practice = race.setup.mode === 'practice';
    this.set(this.pos, 'pos', total > 1 ? ordinal(P.position).replace(/\D+$/, '') : '—');
    this.set(this.posTotal, 'post', total > 1 ? `${ordinal(P.position).replace(/^\d+/, '').toUpperCase()} / ${total}` : 'SOLO');
    const lapText = practice ? `LAP ${P.progress.lap}` : `LAP ${Math.min(P.progress.lap, race.setup.laps)} / ${race.setup.laps}`;
    this.set(this.lap, 'lap', lapText);
    this.set(this.timer, 'timer', formatTime(race.started ? race.raceTime : 0));
    const last = race.playerLastLap;
    this.set(this.lapInfo, 'lapinfo', `LAST ${formatTime(last)}  ·  BEST ${formatTime(P.bestLap)}`);
    this.set(this.speed, 'spd', String(Math.round(P.speedKmh)));
    const nitroW = `${Math.round(P.physics.nitro * 100)}%`;
    if (this.cache.get('nitro') !== nitroW) { this.cache.set('nitro', nitroW); this.nitroFill.style.width = nitroW; }
    const hp = Math.max(0, P.health) / 100;
    const hpW = `${Math.round(hp * 100)}%`;
    if (this.cache.get('hp') !== hpW) {
      this.cache.set('hp', hpW);
      this.healthFill.style.width = hpW;
      this.healthFill.classList.toggle('low', hp < 0.35);
    }
    const pu = P.powerUp;
    const key = pu ?? 'none';
    if (this.cache.get('item') !== key) {
      this.cache.set('item', key);
      this.item.innerHTML = powerUpIcon(pu);
      this.item.style.color = pu ? POWERUPS[pu].css : '#5b6170';
      this.item.classList.toggle('has', !!pu);
      this.itemName.textContent = pu ? POWERUPS[pu].name : practice ? 'PRESS 1–6 TO EQUIP' : 'NO ITEM';
      this.itemName.style.color = pu ? POWERUPS[pu].css : '';
    }
    this.el.classList.toggle('shielded', P.shieldTime > 0);
    this.el.classList.toggle('boosting', P.physics.boosting || P.nitroSurgeTime > 0);

    // Leaderboard (throttled)
    this.boardTimer -= dt;
    if (this.boardTimer <= 0 && total > 1) {
      this.boardTimer = 0.25;
      const html = race.ranked.map((v) =>
        `<li class="${v.isPlayer ? 'me' : ''}${v.wrecked ? ' wrecked' : ''}${v.progress.finished ? ' done' : ''}"><b>${v.position}</b><span class="dot" style="background:#${v.config.accent.toString(16).padStart(6, '0')}"></span>${v.name}</li>`,
      ).join('');
      this.set(this.board, 'board', html, true);
    }

    // Minimap
    if (this.mapProj) {
      const ctx = this.mapCanvas.getContext('2d')!;
      ctx.clearRect(0, 0, 220, 220);
      ctx.drawImage(this.mapBg, 0, 0);
      for (const v of race.vehicles) {
        if (v.wrecked) continue;
        const [x, y] = this.mapProj(v.physics.x, v.physics.z);
        ctx.fillStyle = v.isPlayer ? '#ffffff' : `#${v.config.accent.toString(16).padStart(6, '0')}`;
        ctx.beginPath();
        ctx.arc(x, y, v.isPlayer ? 6 : 4.5, 0, Math.PI * 2);
        ctx.fill();
        if (v.isPlayer) {
          ctx.strokeStyle = '#20e3ff';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
    }

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.className = 'hud-banner';
    }
    if (this.showFps) {
      this.fpsAcc += dt;
      this.fpsFrames++;
      if (this.fpsAcc > 0.5) {
        this.fps.textContent = `${Math.round(this.fpsFrames / this.fpsAcc)} FPS`;
        this.fpsAcc = 0;
        this.fpsFrames = 0;
      }
    } else if (this.fps.textContent) this.fps.textContent = '';
  }
}
