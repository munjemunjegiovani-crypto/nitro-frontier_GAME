import * as THREE from 'three';

/**
 * Captures the real surroundings into a cube map and converts it into a
 * pre-filtered environment map. Cars, wet asphalt and glass then reflect
 * the actual city lights, canyon walls or sky around them.
 */
export class ReflectionProbe {
  private cubeTarget: THREE.WebGLCubeRenderTarget;
  private cubeCamera: THREE.CubeCamera;
  private pmrem: THREE.PMREMGenerator;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private frame = 0;

  constructor(private renderer: THREE.WebGLRenderer, size = 128) {
    this.cubeTarget = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
    this.cubeCamera = new THREE.CubeCamera(0.5, 3000, this.cubeTarget);
    this.pmrem = new THREE.PMREMGenerator(renderer);
  }

  /** Capture from `pos`, temporarily hiding objects that shouldn't reflect themselves. */
  capture(scene: THREE.Scene, pos: THREE.Vector3, hide: (THREE.Object3D | null | undefined)[] = []): void {
    const hidden: THREE.Object3D[] = [];
    for (const o of hide) {
      if (o && o.visible) { o.visible = false; hidden.push(o); }
    }
    const shadowAuto = this.renderer.shadowMap.autoUpdate;
    this.renderer.shadowMap.autoUpdate = false; // reuse this frame's shadows for all six faces
    const prevEnv = scene.environment;
    this.cubeCamera.position.copy(pos);
    this.cubeCamera.update(this.renderer, scene);
    this.renderer.shadowMap.autoUpdate = shadowAuto;
    for (const o of hidden) o.visible = true;
    this.envTarget = this.pmrem.fromCubemap(this.cubeTarget.texture, this.envTarget);
    scene.environment = this.envTarget.texture ?? prevEnv;
  }

  /** Re-capture every `interval` frames (0 = never after the first). */
  tick(scene: THREE.Scene, pos: THREE.Vector3, interval: number, hide: (THREE.Object3D | null | undefined)[]): void {
    if (this.frame === 0 || (interval > 0 && this.frame % interval === 0)) this.capture(scene, pos, hide);
    this.frame++;
  }

  reset(): void {
    this.frame = 0;
  }

  dispose(): void {
    this.cubeTarget.dispose();
    this.envTarget?.dispose();
    this.pmrem.dispose();
  }
}
