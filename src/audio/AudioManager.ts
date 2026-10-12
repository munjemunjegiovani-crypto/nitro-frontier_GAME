/**
 * All game audio is synthesised at runtime with the Web Audio API: no audio
 * files, no licensing questions. The context is created only after the
 * first user interaction to respect browser autoplay rules.
 */
export interface VolumeSettings {
  master: number;
  music: number;
  sfx: number;
  engine: number;
}

type MusicMood = 'menu' | 'race';

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private engineBus!: GainNode;
  private noiseBuffer!: AudioBuffer;
  private muted = false;
  private volumes: VolumeSettings = { master: 0.8, music: 0.55, sfx: 0.8, engine: 0.6 };

  // Engine voice
  private engOsc1: OscillatorNode | null = null;
  private engOsc2: OscillatorNode | null = null;
  private engFilter!: BiquadFilterNode;
  private engGain!: GainNode;
  private tireGain!: GainNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private boostGain!: GainNode;

  // Music sequencer
  private musicTimer: number | null = null;
  private nextNoteTime = 0;
  private step = 0;
  private mood: MusicMood = 'menu';
  private musicGain!: GainNode;

  get ready(): boolean {
    return this.ctx !== null;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Call from a user gesture (click / keydown). Safe to call repeatedly. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.musicBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.engineBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.engineBus.connect(this.master);
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0.9;
    this.musicGain.connect(this.musicBus);

    const len = ctx.sampleRate * 2;
    this.noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this.buildEngine();
    this.applyVolumes();
    this.startMusic();
  }

  setVolumes(v: VolumeSettings): void {
    this.volumes = { ...v };
    this.applyVolumes();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    this.applyVolumes();
    return this.muted;
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volumes.master, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.volumes.music * 0.5, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.volumes.sfx, t, 0.05);
    this.engineBus.gain.setTargetAtTime(this.volumes.engine * 0.6, t, 0.05);
  }

  private noiseSource(loop = false): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = loop;
    return src;
  }

  private buildEngine(): void {
    const ctx = this.ctx!;
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 600;
    this.engFilter.Q.value = 4;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 2.5); }
    shaper.curve = curve;
    this.engOsc1 = ctx.createOscillator();
    this.engOsc1.type = 'sawtooth';
    this.engOsc2 = ctx.createOscillator();
    this.engOsc2.type = 'square';
    const g2 = ctx.createGain();
    g2.gain.value = 0.5;
    this.engOsc1.connect(shaper);
    this.engOsc2.connect(g2).connect(shaper);
    shaper.connect(this.engFilter).connect(this.engGain).connect(this.engineBus);
    this.engOsc1.start();
    this.engOsc2.start();

    // Tyre squeal: band-passed noise
    const tire = this.noiseSource(true);
    const tireBp = ctx.createBiquadFilter();
    tireBp.type = 'bandpass';
    tireBp.frequency.value = 2100;
    tireBp.Q.value = 6;
    this.tireGain = ctx.createGain();
    this.tireGain.gain.value = 0;
    tire.connect(tireBp).connect(this.tireGain).connect(this.sfxBus);
    tire.start();

    // Wind: low-passed noise scaled by speed
    const wind = this.noiseSource(true);
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 400;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.sfxBus);
    wind.start(0, 0.5);

    // Boost roar
    const boost = this.noiseSource(true);
    const boostBp = ctx.createBiquadFilter();
    boostBp.type = 'bandpass';
    boostBp.frequency.value = 220;
    boostBp.Q.value = 1.2;
    this.boostGain = ctx.createGain();
    this.boostGain.gain.value = 0;
    boost.connect(boostBp).connect(this.boostGain).connect(this.engineBus);
    boost.start(0, 1);
  }

  /** Per-frame engine/tyre/wind update for the player car. */
  updateEngine(speedFrac: number, throttle: number, slip: number, boosting: boolean, active: boolean): void {
    if (!this.ctx || !this.engOsc1 || !this.engOsc2) return;
    const t = this.ctx.currentTime;
    // Fake gearbox: rpm climbs inside 5 gear bands.
    const gears = 5;
    const g = Math.min(gears - 1, Math.floor(speedFrac * gears));
    const inGear = speedFrac * gears - g;
    const rpm = 0.25 + inGear * 0.6 + g * 0.04 + throttle * 0.08;
    const base = 38 + rpm * 120;
    this.engOsc1.frequency.setTargetAtTime(base, t, 0.04);
    this.engOsc2.frequency.setTargetAtTime(base * 0.5 + 1.5, t, 0.04);
    this.engFilter.frequency.setTargetAtTime(350 + rpm * 1600 + throttle * 500, t, 0.05);
    this.engGain.gain.setTargetAtTime(active ? 0.18 + throttle * 0.14 : 0, t, 0.08);
    this.tireGain.gain.setTargetAtTime(active ? Math.min(0.22, Math.max(0, slip - 4) * 0.02) : 0, t, 0.05);
    this.windGain.gain.setTargetAtTime(active ? speedFrac * speedFrac * 0.35 : 0, t, 0.1);
    this.windFilter.frequency.setTargetAtTime(300 + speedFrac * 1400, t, 0.1);
    this.boostGain.gain.setTargetAtTime(active && boosting ? 0.5 : 0, t, 0.06);
  }

  silenceEngine(): void {
    this.updateEngine(0, 0, 0, false, false);
  }

  /* ----------------------------- SFX ----------------------------- */

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, endFreq?: number, when = 0): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(dur: number, gain: number, filterFreq: number, type: BiquadFilterType = 'lowpass', endFilter?: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.noiseSource();
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(filterFreq, t);
    if (endFilter) f.frequency.exponentialRampToValueAtTime(endFilter, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  play(name: 'click' | 'hover' | 'countdown' | 'go' | 'pickup' | 'arc' | 'seeker' | 'pulse' | 'shield' | 'nitro' | 'snare' | 'hit' | 'blocked' | 'explosion' | 'wall' | 'lap' | 'finish' | 'boostpad' | 'land', intensity = 1): void {
    if (!this.ctx) return;
    switch (name) {
      case 'click': this.tone(880, 0.06, 'square', 0.12, 1320); break;
      case 'hover': this.tone(1400, 0.03, 'sine', 0.05); break;
      case 'countdown': this.tone(660, 0.25, 'square', 0.2); break;
      case 'go': this.tone(1320, 0.6, 'square', 0.22); this.tone(660, 0.6, 'sawtooth', 0.12); break;
      case 'pickup': this.tone(700, 0.08, 'triangle', 0.2, 1400); this.tone(1400, 0.12, 'triangle', 0.15, 2100, 0.07); break;
      case 'arc': this.tone(1800, 0.25, 'sawtooth', 0.18, 300); this.noise(0.15, 0.2, 4000, 'highpass'); break;
      case 'seeker': this.tone(300, 0.5, 'square', 0.12, 900); this.noise(0.4, 0.15, 800, 'bandpass'); break;
      case 'pulse': this.tone(120, 0.6, 'sine', 0.5, 40); this.noise(0.5, 0.3, 3000, 'lowpass', 200); break;
      case 'shield': this.tone(400, 0.5, 'sine', 0.2, 1200); this.tone(600, 0.5, 'triangle', 0.1, 1800); break;
      case 'nitro': this.noise(0.9, 0.4, 300, 'bandpass', 2000); this.tone(90, 0.8, 'sawtooth', 0.15, 260); break;
      case 'snare': this.tone(200, 0.7, 'sine', 0.3, 60); this.tone(800, 0.5, 'triangle', 0.08, 100); break;
      case 'hit': this.noise(0.3, 0.45 * intensity, 1800, 'lowpass', 200); this.tone(160, 0.25, 'square', 0.18, 50); break;
      case 'blocked': this.tone(1200, 0.2, 'triangle', 0.2, 2400); break;
      case 'explosion': this.noise(1.2, 0.7, 2400, 'lowpass', 60); this.tone(80, 0.9, 'sine', 0.5, 25); break;
      case 'wall': this.noise(0.15, Math.min(0.5, 0.12 * intensity), 900, 'lowpass'); break;
      case 'lap': this.tone(880, 0.12, 'square', 0.15); this.tone(1320, 0.2, 'square', 0.15, undefined, 0.12); break;
      case 'finish': [0, 0.15, 0.3, 0.45].forEach((w, i) => this.tone([660, 880, 1100, 1320][i], 0.35, 'square', 0.15, undefined, w)); break;
      case 'boostpad': this.tone(500, 0.3, 'sawtooth', 0.12, 1500); break;
      case 'land': this.noise(0.2, 0.35, 400, 'lowpass'); break;
    }
  }

  /* ---------------------------- Music ---------------------------- */

  setMusicMood(mood: MusicMood): void {
    this.mood = mood;
  }

  private startMusic(): void {
    if (!this.ctx || this.musicTimer !== null) return;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 25);
  }

  private scheduleMusic(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const bpm = this.mood === 'race' ? 132 : 104;
    const stepDur = 60 / bpm / 4;
    while (this.nextNoteTime < ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextNoteTime, stepDur);
      this.nextNoteTime += stepDur;
      this.step = (this.step + 1) % 64;
    }
  }

  private playStep(step: number, t: number, dur: number): void {
    const ctx = this.ctx!;
    const bar = Math.floor(step / 16);
    const s = step % 16;
    // Chord roots (in semitones from A1) — an original i–VI–III–VII progression.
    const roots = [0, -4, 3, -2];
    const root = roots[bar];
    const race = this.mood === 'race';
    const hz = (semi: number, base = 55) => base * Math.pow(2, semi / 12);

    // Kick
    if (race ? s % 4 === 0 : s === 0 || s === 10) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.setValueAtTime(140, t);
      o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
      g.gain.setValueAtTime(race ? 0.7 : 0.45, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      o.connect(g).connect(this.musicGain);
      o.start(t);
      o.stop(t + 0.3);
    }
    // Hats
    if (race ? s % 2 === 1 : s % 4 === 2) {
      const src = this.noiseSource();
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 7000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      src.connect(f).connect(g).connect(this.musicGain);
      src.start(t, Math.random());
      src.stop(t + 0.06);
    }
    // Snare/clap
    if (race && (s === 4 || s === 12)) {
      const src = this.noiseSource();
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1800;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.28, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      src.connect(f).connect(g).connect(this.musicGain);
      src.start(t, Math.random());
      src.stop(t + 0.18);
    }
    // Bass: driving 16ths in race mode, offbeat 8ths in menu
    const bassPattern = race ? [0, 0, 12, 0, 0, 12, 0, 7, 0, 0, 12, 0, 10, 0, 7, 12] : [0, -1, -1, 12, -1, -1, 0, -1, -1, 7, -1, -1, 0, -1, 10, -1];
    const bn = bassPattern[s];
    if (bn >= 0) {
      const o = ctx.createOscillator();
      const f = ctx.createBiquadFilter();
      const g = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.value = hz(root + bn);
      f.type = 'lowpass';
      f.frequency.setValueAtTime(race ? 900 : 500, t);
      f.frequency.exponentialRampToValueAtTime(150, t + dur * 0.9);
      f.Q.value = 6;
      g.gain.setValueAtTime(0.22, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.95);
      o.connect(f).connect(g).connect(this.musicGain);
      o.start(t);
      o.stop(t + dur);
    }
    // Arpeggio lead
    const arp = [0, 7, 12, 15, 19, 15, 12, 7];
    if (race ? s % 2 === 0 : s % 4 === 0) {
      const note = root + arp[(s / (race ? 2 : 4) + bar) % arp.length | 0] + 24;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square';
      o.frequency.value = hz(note);
      g.gain.setValueAtTime(0.045, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur * 1.8);
      o.connect(g).connect(this.musicGain);
      o.start(t);
      o.stop(t + dur * 2);
    }
    // Pad on bar start
    if (s === 0) {
      for (const iv of [0, 3, 7]) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'triangle';
        o.frequency.value = hz(root + iv + 36);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.04, t + 0.3);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 16);
        o.connect(g).connect(this.musicGain);
        o.start(t);
        o.stop(t + dur * 16 + 0.05);
      }
    }
  }

  dispose(): void {
    if (this.musicTimer !== null) clearInterval(this.musicTimer);
    this.musicTimer = null;
    void this.ctx?.close();
    this.ctx = null;
  }
}
