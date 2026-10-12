import * as THREE from 'three';
import type { TrackTheme } from '../tracks/Track';

/** Sun + sky lighting for a track, with a shadow frustum that follows a target. */
export class Lighting {
  readonly group = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  private sunOffset = new THREE.Vector3(-60, 90, -120);

  constructor(theme: TrackTheme, shadowSize: number) {
    this.hemi = new THREE.HemisphereLight(theme.ambient, theme.ground, theme.ambientIntensity);
    this.sun = new THREE.DirectionalLight(theme.sun, theme.sunIntensity);
    this.sun.castShadow = shadowSize > 0;
    if (shadowSize > 0) {
      this.sun.shadow.mapSize.set(shadowSize, shadowSize);
      const cam = this.sun.shadow.camera;
      cam.left = -60; cam.right = 60; cam.top = 60; cam.bottom = -60;
      cam.near = 10; cam.far = 320;
      this.sun.shadow.bias = -0.0005;
      this.sun.shadow.normalBias = 0.04;
    }
    this.group.add(this.hemi, this.sun, this.sun.target);
  }

  follow(target: THREE.Vector3): void {
    this.sun.position.copy(target).add(this.sunOffset);
    this.sun.target.position.copy(target);
  }

  dispose(): void {
    this.sun.shadow.map?.dispose();
    this.sun.dispose();
    this.hemi.dispose();
    this.group.removeFromParent();
  }
}
