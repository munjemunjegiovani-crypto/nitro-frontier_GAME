import * as THREE from 'three';
import { Lighting } from '../rendering/Lighting';
import { Track } from '../tracks/Track';
import { buildTrack, type BuiltTrack, type Quality } from '../tracks/TrackFactory';
import { getTrack } from '../tracks/TrackRegistry';
import { buildCarModel, type CarModel } from '../vehicles/CarModel';
import { getVehicle } from '../vehicles/VehicleConfig';

/** The 3D backdrop behind the menus: a track environment and a car on a turntable. */
export class Showroom {
  readonly root = new THREE.Group();
  private built: BuiltTrack | null = null;
  private lighting: Lighting | null = null;
  private car: CarModel | null = null;
  private turntable = new THREE.Group();
  private platform: THREE.Mesh;
  private platformMat: THREE.MeshStandardMaterial;
  private ringMat: THREE.MeshBasicMaterial;
  private ring: THREE.Mesh;
  readonly focus = new THREE.Vector3();
  trackId = '';
  vehicleId = '';
  private spot: THREE.SpotLight;

  constructor(private scene: THREE.Scene) {
    this.platformMat = new THREE.MeshStandardMaterial({ color: 0x1a1d24, metalness: 0.9, roughness: 0.25 });
    this.platform = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 4.7, 0.35, 48), this.platformMat);
    this.platform.position.y = 0.17;
    this.platform.receiveShadow = true;
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0x20e3ff });
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(4.6, 0.06, 6, 64), this.ringMat);
    this.ring.rotation.x = Math.PI / 2;
    this.ring.position.y = 0.36;
    this.turntable.add(this.platform, this.ring);
    this.spot = new THREE.SpotLight(0xffffff, 120, 30, 0.6, 0.5, 1.4);
    this.spot.position.set(3, 10, 4);
    this.spot.castShadow = true;
    this.root.add(this.turntable, this.spot, this.spot.target);
  }

  setTrack(trackId: string, quality: Quality): void {
    if (trackId === this.trackId && this.built) return;
    this.trackId = trackId;
    this.built?.dispose();
    this.lighting?.dispose();
    const def = getTrack(trackId);
    const track = new Track(def);
    this.built = buildTrack(track, quality === 'high' ? 'medium' : quality);
    this.lighting = new Lighting(def.theme, quality === 'low' ? 0 : 1024);
    this.root.add(this.built.group, this.lighting.group);
    // Park the turntable just past the start gantry.
    const idx = Math.round(track.count * 0.02);
    const s = track.sample(idx);
    this.turntable.position.copy(s.pos);
    this.focus.copy(s.pos);
    this.spot.position.copy(s.pos).add(new THREE.Vector3(3, 10, 4));
    this.spot.target.position.copy(s.pos);
    this.lighting.follow(this.focus);
    this.ringMat.color.setHex(def.theme.edge);
    this.scene.fog = new THREE.FogExp2(def.theme.fog, def.theme.fogDensity * 0.8);
  }

  setVehicle(vehicleId: string): void {
    if (vehicleId === this.vehicleId && this.car) return;
    this.vehicleId = vehicleId;
    if (this.car) {
      this.car.root.removeFromParent();
      this.car.dispose();
    }
    this.car = buildCarModel(getVehicle(vehicleId));
    this.car.root.position.y = 0.35;
    this.car.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    this.turntable.add(this.car.root);
  }

  get carObject(): THREE.Object3D | null {
    return this.car?.root ?? null;
  }

  attach(): void {
    if (!this.root.parent) this.scene.add(this.root);
    if (this.built) {
      const def = getTrack(this.trackId);
      this.scene.fog = new THREE.FogExp2(def.theme.fog, def.theme.fogDensity * 0.8);
    }
  }

  detach(): void {
    this.root.removeFromParent();
  }

  /** Free the heavy track meshes while racing. */
  unload(): void {
    this.detach();
    this.built?.dispose();
    this.lighting?.dispose();
    this.built = null;
    this.lighting = null;
    this.trackId = '';
  }

  update(dt: number, time: number): void {
    this.turntable.rotation.y += dt * 0.35;
    this.ringMat.opacity = 0.7 + Math.sin(time * 3) * 0.3;
    if (this.built) this.built.boostTexture.offset.y -= dt * 1.2;
    if (this.car) {
      for (const w of this.car.wheels) w.rotation.x = 0;
    }
  }
}
