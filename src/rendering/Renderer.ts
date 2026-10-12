import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { Quality } from '../tracks/TrackFactory';
import type { TrackTheme } from '../tracks/Track';

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

/** Owns the WebGL renderer, post-processing and adaptive resolution. */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private quality: Quality = 'high';
  /** User render scale (0.5..1). */
  renderScale = 1;
  /** Automatic scale from the frame-time governor. */
  private autoScale = 1;
  private frameTimes: number[] = [];
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private onResize = () => this.resize();

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.camera = new THREE.PerspectiveCamera(68, 1, 0.3, 4000);
    this.scene.add(this.camera);
    window.addEventListener('resize', this.onResize);
    this.setQuality('high');
  }

  /**
   * Builds a reflection environment from the track's own palette: a sky
   * gradient plus a ring of neon panels. This gives cars and wet roads
   * believable reflections that match each world instead of a generic studio.
   */
  setEnvironment(theme: TrackTheme): void {
    const envScene = new THREE.Scene();
    const skyGeo = new THREE.SphereGeometry(50, 32, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        top: { value: new THREE.Color(theme.skyTop) },
        horizon: { value: new THREE.Color(theme.skyHorizon) },
        ground: { value: new THREE.Color(theme.ground).multiplyScalar(0.5) },
      },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.6)) : mix(horizon * 0.5, ground, min(1.0, -h * 4.0)); gl_FragColor = vec4(c, 1.0); }',
    });
    envScene.add(new THREE.Mesh(skyGeo, skyMat));
    const panelGeo = new THREE.PlaneGeometry(6, 1.2);
    const mats = [theme.edge, theme.edgeAlt, theme.sun].map((c) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(theme.night ? 3 : 1.5), side: THREE.DoubleSide }));
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const m = new THREE.Mesh(panelGeo, mats[i % 3]);
      m.position.set(Math.cos(a) * 30, 4 + (i % 3) * 5, Math.sin(a) * 30);
      m.lookAt(0, m.position.y, 0);
      envScene.add(m);
    }
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const target = pmrem.fromScene(envScene, 0.03);
    pmrem.dispose();
    skyGeo.dispose(); skyMat.dispose(); panelGeo.dispose(); mats.forEach((m) => m.dispose());
    this.envTarget?.dispose();
    this.envTarget = target;
    this.scene.environment = target.texture;
    this.scene.environmentIntensity = theme.night ? 0.9 : 0.75;
  }

  setQuality(q: Quality): void {
    this.quality = q;
    this.renderer.shadowMap.enabled = q !== 'low';
    this.composer?.dispose();
    this.composer = null;
    this.bloom = null;
    if (q !== 'low') {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), q === 'high' ? 0.85 : 0.6, 0.55, 0.62);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
    this.autoScale = 1;
    this.resize();
    // Materials must recompile when shadows toggle.
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m) (Array.isArray(m) ? m : [m]).forEach((mm) => (mm.needsUpdate = true));
    });
  }

  get qualityLevel(): Quality {
    return this.quality;
  }

  get pixelRatio(): number {
    const cap = this.quality === 'high' ? 1.75 : this.quality === 'medium' ? 1.25 : 1;
    return Math.min(window.devicePixelRatio || 1, cap) * this.renderScale * this.autoScale;
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.composer?.setPixelRatio(this.pixelRatio);
    this.composer?.setSize(w, h);
  }

  get viewportHeight(): number {
    return window.innerHeight * this.pixelRatio;
  }

  /**
   * Simple performance governor: if frames are consistently slow, drop the
   * internal resolution a notch; if they recover, raise it again.
   */
  trackFrame(dt: number): void {
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    const prev = this.autoScale;
    if (avg > 1 / 45 && this.autoScale > 0.6) this.autoScale = Math.max(0.6, this.autoScale - 0.1);
    else if (avg < 1 / 58 && this.autoScale < 1) this.autoScale = Math.min(1, this.autoScale + 0.05);
    if (prev !== this.autoScale) this.resize();
  }

  render(): void {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  setBloomStrength(s: number): void {
    if (this.bloom) this.bloom.strength = s;
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.composer?.dispose();
    this.envTarget?.dispose();
    this.renderer.dispose();
  }
}
