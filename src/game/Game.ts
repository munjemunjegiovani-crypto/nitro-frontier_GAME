import { AudioManager } from '../audio/AudioManager';
import { CameraController } from '../rendering/CameraController';
import { Renderer } from '../rendering/Renderer';
import { ReflectionProbe } from '../rendering/ReflectionProbe';
import * as THREE from 'three';
import { SaveManager, type Settings } from '../storage/SaveManager';
import { TRACKS, getTrack } from '../tracks/TrackRegistry';
import { HUD } from '../ui/HUD';
import { MainMenu, ModeSelect } from '../ui/MainMenu';
import { PauseMenu } from '../ui/PauseMenu';
import { ResultsScreen } from '../ui/ResultsScreen';
import type { Screen, UiSounds } from '../ui/Screen';
import { SettingsMenu } from '../ui/SettingsMenu';
import { TrackSelect } from '../ui/TrackSelect';
import { VehicleSelect } from '../ui/VehicleSelect';
import { PlayerController, type KeyAction } from '../vehicles/PlayerController';
import { NO_INPUT, type DriveInput } from '../vehicles/VehiclePhysics';
import { GameLoop } from './GameLoop';
import { GameStateMachine, type GameStateName } from './GameState';
import { RaceManager, defaultRivals, type GameMode, type RaceSetup } from './RaceManager';
import { Championship, type RacerResult } from './RaceResults';
import { Showroom } from './Showroom';
import { RACE } from '../config/GameConfig';

/** Top-level controller: owns every system and drives the state machine. */
export class Game {
  readonly fsm = new GameStateMachine();
  readonly renderer: Renderer;
  readonly audio = new AudioManager();
  readonly save = new SaveManager();
  readonly input = new PlayerController();
  readonly cameraCtl: CameraController;
  private loop: GameLoop;
  private showroom: Showroom;
  private race: RaceManager | null = null;
  private championship: Championship | null = null;
  private rivals: NonNullable<RaceSetup['rivals']> | null = null;
  private mode: GameMode = 'quick';
  private vehicleId: string;
  private trackId: string;
  private laps: number = RACE.defaultLaps;
  private settingsReturn: GameStateName = 'mainMenu';
  private playerInput: DriveInput = { ...NO_INPUT };
  private probe: ReflectionProbe;
  private probePos = new THREE.Vector3();

  // UI
  private hud = new HUD();
  private mainMenu: MainMenu;
  private modeSelect: ModeSelect;
  private vehicleSelect: VehicleSelect;
  private trackSelect: TrackSelect;
  private settingsMenu: SettingsMenu;
  private pauseMenu: PauseMenu;
  private results: ResultsScreen;
  private screens: Screen[];

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.renderer = new Renderer(canvas);
    this.cameraCtl = new CameraController(this.renderer.camera);
    this.showroom = new Showroom(this.renderer.scene);
    this.probe = new ReflectionProbe(this.renderer.renderer, 128);
    this.vehicleId = this.save.data.lastVehicle;
    this.trackId = getTrack(this.save.data.lastTrack).id;

    const sounds: UiSounds = { click: () => this.audio.play('click'), hover: () => this.audio.play('hover') };
    this.mainMenu = new MainMenu(sounds, {
      play: () => this.go('modeSelect'),
      settings: () => this.openSettings('mainMenu'),
    });
    this.modeSelect = new ModeSelect(sounds, {
      choose: (m) => { this.mode = m; this.go('vehicleSelect'); },
      back: () => this.go('mainMenu'),
    });
    this.vehicleSelect = new VehicleSelect(sounds, {
      change: (id) => { this.vehicleId = id; this.showroom.setVehicle(id); },
      next: (id) => {
        this.vehicleId = id;
        if (this.mode === 'championship') this.startChampionship();
        else this.go('trackSelect');
      },
      back: () => this.go('modeSelect'),
    });
    this.trackSelect = new TrackSelect(sounds, {
      change: (id) => { this.trackId = id; this.showroom.setTrack(id, this.renderer.qualityLevel); this.renderer.setEnvironment(getTrack(id).theme); this.probe.reset(); },
      start: (id, laps) => { this.trackId = id; this.laps = laps; this.startRace(); },
      back: () => this.go('vehicleSelect'),
    });
    this.settingsMenu = new SettingsMenu(sounds, {
      change: (s) => this.applySettings(s, true),
      back: () => this.go(this.settingsReturn),
    });
    this.pauseMenu = new PauseMenu(sounds, {
      resume: () => this.resume(),
      restart: () => this.restartRace(),
      settings: () => this.openSettings('paused'),
      quit: () => this.quitToMenu(),
    });
    this.results = new ResultsScreen(sounds);
    this.screens = [this.mainMenu, this.modeSelect, this.vehicleSelect, this.trackSelect, this.settingsMenu, this.pauseMenu, this.results];
    uiRoot.append(this.hud.el, ...this.screens.map((s) => s.el));

    this.applySettings(this.save.data.settings, false);
    this.input.onAction((a) => this.onAction(a));
    this.fsm.onChange((to, from) => this.onStateChange(to, from));

    // Audio can only start after a user gesture.
    const unlock = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Enter' && this.fsm.state === 'mainMenu' && document.activeElement === document.body) this.go('modeSelect');
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && (this.fsm.state === 'racing' || this.fsm.state === 'countdown')) this.pause();
    });

    this.loop = new GameLoop((dt, t) => this.tick(dt, t));
  }

  /** Builds the first scene and enters the main menu. */
  start(): void {
    this.renderer.setEnvironment(getTrack(this.trackId).theme);
    this.renderer.setGradeTint(getTrack(this.trackId).theme.night);
    this.showroom.setTrack(this.trackId, this.renderer.qualityLevel);
    this.showroom.setVehicle(this.vehicleId);
    this.showroom.attach();
    this.renderer.renderer.compile(this.renderer.scene, this.renderer.camera);
    this.fsm.transition('mainMenu');
    this.loop.start();
  }

  private go(state: GameStateName): void {
    if (!this.fsm.transition(state)) console.warn(`[state] rejected ${this.fsm.state} → ${state}`);
  }

  private onStateChange(to: GameStateName, from: GameStateName): void {
    for (const s of this.screens) s.hide();
    const racingStates: GameStateName[] = ['countdown', 'racing'];
    this.input.capture = racingStates.includes(to);
    if (!this.input.capture) this.input.clear();
    document.body.dataset.state = to;
    const inMenu = ['mainMenu', 'modeSelect', 'vehicleSelect', 'trackSelect'].includes(to) || (to === 'settings' && from === 'mainMenu');
    if (inMenu) {
      this.audio.setMusicMood('menu');
      this.audio.silenceEngine();
      this.hud.hide();
    }
    switch (to) {
      case 'mainMenu':
        this.mainMenu.setStats(this.save.data.racesWon, this.save.data.championshipsWon);
        this.mainMenu.hideControls();
        this.mainMenu.show();
        break;
      case 'modeSelect':
        this.modeSelect.show();
        break;
      case 'vehicleSelect':
        this.vehicleSelect.selectById(this.vehicleId);
        this.vehicleSelect.show();
        break;
      case 'trackSelect':
        this.trackSelect.prepare(this.mode, this.save.data.bestTimes, this.trackId);
        this.trackSelect.show();
        break;
      case 'settings':
        this.settingsMenu.open(this.save.data.settings);
        break;
      case 'paused':
        this.pauseMenu.show();
        this.audio.silenceEngine();
        break;
      case 'countdown':
      case 'racing':
        this.audio.setMusicMood('race');
        break;
      default:
        break;
    }
  }

  private applySettings(s: Settings, persist: boolean): void {
    const prevQuality = this.save.data.settings.quality;
    this.save.data.settings = { ...s };
    if (persist) this.save.save();
    if (!persist || prevQuality !== s.quality) this.renderer.setQuality(s.quality);
    if (this.renderer.renderScale !== s.renderScale) {
      this.renderer.renderScale = s.renderScale;
      this.renderer.resize();
    }
    this.audio.setVolumes({ master: s.master, music: s.music, sfx: s.sfx, engine: s.engine });
    this.cameraCtl.shakeScale = s.cameraShake;
    this.cameraCtl.speedEffects = s.speedEffects;
    if (this.race) this.race.speedEffects = s.speedEffects;
    this.hud.showFps = s.showFps;
  }

  private openSettings(ret: GameStateName): void {
    this.settingsReturn = ret;
    this.go('settings');
  }

  /* --------------------------- Races --------------------------- */

  private buildSetup(): RaceSetup {
    const opponents = this.mode === 'timeTrial' ? 0 : this.mode === 'practice' ? 3 : RACE.opponentCount;
    return {
      mode: this.mode,
      trackId: this.trackId,
      vehicleId: this.vehicleId,
      laps: this.mode === 'practice' ? 0 : this.laps,
      opponents,
      rivals: this.rivals ?? undefined,
    };
  }

  private startChampionship(): void {
    this.championship = new Championship(TRACKS.map((t) => t.id));
    this.rivals = defaultRivals(this.vehicleId, RACE.opponentCount);
    this.trackId = this.championship.currentTrackId;
    this.laps = RACE.defaultLaps;
    this.startRace();
  }

  private startRace(): void {
    if (this.mode !== 'championship') { this.championship = null; this.rivals = null; }
    this.save.data.lastVehicle = this.vehicleId;
    this.save.data.lastTrack = this.trackId;
    this.save.save();
    this.disposeRace();
    this.showroom.unload();
    const setup = this.buildSetup();
    this.renderer.setEnvironment(getTrack(setup.trackId).theme);
    this.renderer.setGradeTint(getTrack(setup.trackId).theme.night);
    this.probe.reset();
    this.race = new RaceManager(setup, this.renderer.scene, this.renderer.qualityLevel, {
      notify: (text, color, big) => (big ? this.hud.bigBanner(text, color) : this.hud.notify(text, color)),
      sound: (name, intensity) => this.audio.play(name, intensity),
      shake: (a) => this.cameraCtl.shake(a),
      countdown: (n) => this.hud.showCountdown(n),
      finished: (results, time) => this.onRaceFinished(results, time),
    });
    this.race.speedEffects = this.save.data.settings.speedEffects;
    this.race.effects.attachSpeedLines(this.renderer.camera);
    this.race.effects.setViewportHeight(this.renderer.viewportHeight);
    // Start from a high crane shot; the chase camera eases down onto the car.
    const p = this.race.player.physics;
    this.cameraCtl.snap(p);
    this.renderer.camera.position.y += 14;
    this.hud.show(this.race);
    this.renderer.renderer.compile(this.renderer.scene, this.renderer.camera);
    this.go('countdown');
  }

  private restartRace(): void {
    if (!this.race) return;
    if (this.championship) {
      // Restarting a championship round keeps earlier rounds' points.
      this.trackId = this.championship.currentTrackId;
    }
    this.startRace();
  }

  private disposeRace(): void {
    if (!this.race) return;
    this.race.dispose();
    this.race = null;
    this.audio.silenceEngine();
  }

  private pause(): void {
    if (this.fsm.state === 'racing' || this.fsm.state === 'countdown') this.go('paused');
  }

  private resume(): void {
    if (!this.race) return;
    this.input.clear();
    this.go(this.race.started ? 'racing' : 'countdown');
    this.hud.show(this.race);
  }

  private quitToMenu(): void {
    this.disposeRace();
    this.championship = null;
    this.rivals = null;
    this.hud.hide();
    this.reloadShowroom();
    this.go('mainMenu');
  }

  private onRaceFinished(results: RacerResult[], playerTime: number | null): void {
    const race = this.race;
    if (!race) return;
    const me = results.find((r) => r.isPlayer)!;
    const trackName = race.track.def.name;
    let newBest = false;
    if (this.mode === 'timeTrial' && playerTime !== null) newBest = this.save.submitBestTime(this.trackId, playerTime);
    if (me.bestLap !== null) this.save.submitBestLap(this.trackId, me.bestLap);
    if (this.mode !== 'timeTrial' && me.position === 1) {
      this.save.data.racesWon++;
      this.save.save();
    }
    this.go('raceComplete');
    this.hud.hide();
    const toMenu: [string, () => void] = ['MAIN MENU', () => this.quitToMenu()];

    if (this.championship) {
      const champ = this.championship;
      champ.recordRace(results);
      this.results.showRace({
        results, trackName, championship: true, timeTrial: false, newBest: false,
        actions: [toMenu, ['STANDINGS', () => this.showStandings(), true]],
      });
      return;
    }
    this.results.showRace({
      results, trackName, championship: false, timeTrial: this.mode === 'timeTrial', newBest,
      actions: [toMenu, ['CHANGE CIRCUIT', () => { this.disposeRace(); this.reloadShowroom(); this.go('mainMenu'); this.go('modeSelect'); this.go('vehicleSelect'); this.go('trackSelect'); }], ['RACE AGAIN', () => this.startRace(), true]],
    });
  }

  private reloadShowroom(): void {
    this.renderer.setEnvironment(getTrack(this.trackId).theme);
    this.probe.reset();
    this.showroom.setTrack(this.trackId, this.renderer.qualityLevel);
    this.showroom.setVehicle(this.vehicleId);
    this.showroom.attach();
  }

  private showStandings(): void {
    const champ = this.championship;
    if (!champ) return;
    this.go('championshipResults');
    const complete = champ.isComplete;
    if (complete && champ.sorted()[0]?.isPlayer) {
      this.save.data.championshipsWon++;
      this.save.save();
    }
    this.results.showStandings({
      rows: champ.sorted(),
      raceNumber: champ.raceIndex,
      totalRaces: champ.trackIds.length,
      complete,
      actions: complete
        ? [['MAIN MENU', () => this.quitToMenu(), true]]
        : [['QUIT', () => this.quitToMenu()], [`NEXT: ${getTrack(champ.currentTrackId).name}`, () => { this.trackId = champ.currentTrackId; this.startRace(); }, true]],
    });
  }

  /** Keeps the reflection probe near the player (or the showroom car). */
  private updateReflections(race: RaceManager | null): void {
    const q = this.renderer.qualityLevel;
    if (race) {
      const p = race.player.physics;
      this.probePos.set(p.x, p.y + 1.6, p.z);
      const interval = q === 'high' ? 10 : q === 'medium' ? 40 : 0;
      this.probe.tick(this.renderer.scene, this.probePos, interval, [race.player.model.root, race.effects.group]);
      const P = race.player;
      const sp = Math.max(0, p.speed / P.config.maxSpeed - 0.8) * 2 + (p.boosting || P.nitroSurgeTime > 0 ? 0.6 : 0);
      this.renderer.setSpeedFx(this.save.data.settings.speedEffects ? Math.min(1.6, sp) : 0);
    } else {
      this.probePos.copy(this.showroom.focus).add(new THREE.Vector3(0, 1.4, 0));
      this.probe.tick(this.renderer.scene, this.probePos, 0, [this.showroom.carObject]);
      this.renderer.setSpeedFx(0);
    }
  }

  /* --------------------------- Input --------------------------- */

  private onAction(a: KeyAction): void {
    const st = this.fsm.state;
    switch (a) {
      case 'pause':
        if (st === 'racing' || st === 'countdown') this.pause();
        else if (st === 'paused') this.resume();
        else if (st === 'settings') this.go(this.settingsReturn);
        else if (st === 'modeSelect') this.go('mainMenu');
        else if (st === 'vehicleSelect') this.go('modeSelect');
        else if (st === 'trackSelect') this.go('vehicleSelect');
        break;
      case 'mute':
        this.audio.unlock();
        this.hud.notify(this.audio.toggleMute() ? 'AUDIO MUTED' : 'AUDIO ON', '#9aa3b5');
        break;
      case 'fire':
        if (st === 'racing') this.race?.playerFire();
        break;
      case 'reset':
        if (st === 'racing') this.race?.playerReset();
        break;
      case 'camera':
        this.cameraCtl.cycleMode();
        break;
      default:
        if (a.startsWith('grant') && st === 'racing') this.race?.grant(Number(a.slice(5)));
    }
  }

  /* ---------------------------- Tick ---------------------------- */

  private tick(dt: number, time: number): void {
    const st = this.fsm.state;
    const race = this.race;
    if (race && (st === 'countdown' || st === 'racing' || st === 'raceComplete')) {
      this.input.read(dt, this.playerInput);
      race.update(dt, st === 'raceComplete' ? NO_INPUT : this.playerInput, time);
      if (st === 'countdown' && race.started) this.go('racing');
      const P = race.player;
      const p = P.physics;
      this.cameraCtl.update(p, dt, p.boosting || P.nitroSurgeTime > 0);
      if (st !== 'raceComplete') this.hud.update(race, dt);
      this.audio.updateEngine(Math.min(1.2, p.speed / P.config.maxSpeed), P.input.throttle, p.drifting ? 14 : p.slip, p.boosting || P.nitroSurgeTime > 0, !P.wrecked);
    } else if (race && st === 'paused') {
      // Frozen: render only.
    } else if (!race) {
      this.showroom.update(dt, time);
      const f = this.showroom.focus;
      this.cameraCtl.orbit(f, dt, st === 'vehicleSelect' ? 9 : 13, st === 'vehicleSelect' ? 2.6 : 4);
    } else if (st === 'settings' || st === 'championshipResults') {
      // Settings opened from pause, or standings over the last race scene: keep scene static.
    }
    if (race) race.effects.setViewportHeight(this.renderer.viewportHeight);
    this.renderer.render();
    // Captured after the frame so shadow maps already exist; the probe
    // reuses them for its six faces. Reflections lag one frame (invisible).
    this.updateReflections(race);
    this.renderer.trackFrame(dt);
  }
}
