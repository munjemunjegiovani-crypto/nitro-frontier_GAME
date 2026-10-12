import * as THREE from 'three';
import { CAMERA } from '../config/GameConfig';
import type { VehiclePhysics } from '../vehicles/VehiclePhysics';

export type CameraMode = 'chase' | 'far' | 'hood';

/** Third-person chase camera with lag, look-ahead, FOV kick and shake. */
export class CameraController {
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private shakeAmount = 0;
  private fov: number = CAMERA.baseFov;
  private smoothedHeading = 0;
  mode: CameraMode = 'chase';
  shakeScale = 1;
  speedEffects = true;
  private orbitAngle = 0;

  constructor(private camera: THREE.PerspectiveCamera) {}

  cycleMode(): void {
    this.mode = this.mode === 'chase' ? 'far' : this.mode === 'far' ? 'hood' : 'chase';
  }

  shake(amount: number): void {
    this.shakeAmount = Math.min(1.2, this.shakeAmount + amount * this.shakeScale);
  }

  /** Snap behind the car (race start, respawn, recenter). */
  snap(car: VehiclePhysics): void {
    this.smoothedHeading = car.heading;
    this.computeTarget(car, this.pos, this.look);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }

  private computeTarget(car: VehiclePhysics, outPos: THREE.Vector3, outLook: THREE.Vector3): void {
    const fx = Math.sin(this.smoothedHeading);
    const fz = Math.cos(this.smoothedHeading);
    const speedF = Math.min(1, car.speed / 80);
    let dist: number = CAMERA.distance + speedF * 2.2;
    let height: number = CAMERA.height + speedF * 0.4;
    let ahead: number = CAMERA.lookAhead;
    if (this.mode === 'far') { dist *= 1.55; height *= 1.7; ahead *= 1.4; }
    if (this.mode === 'hood') { dist = -0.6; height = 1.25; ahead = 20; }
    outPos.set(car.x - fx * dist, car.y + height, car.z - fz * dist);
    // Look slightly toward where the car is turning.
    const turn = car.yawRate * 3.5;
    outLook.set(
      car.x + Math.sin(car.heading + turn * 0.2) * ahead,
      car.y + (this.mode === 'hood' ? 1.1 : 1.3),
      car.z + Math.cos(car.heading + turn * 0.2) * ahead,
    );
  }

  update(car: VehiclePhysics, dt: number, boosting: boolean): void {
    // Heading lags behind the car so drifts and turns read on screen.
    let dh = car.heading - this.smoothedHeading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    const headingRate = this.mode === 'hood' ? 20 : car.spin > 0 ? 1.2 : 4.2;
    this.smoothedHeading += dh * Math.min(1, headingRate * dt);

    const targetPos = this.pos;
    const prevY = this.camera.position.y;
    this.computeTarget(car, targetPos, this.look);
    const k = Math.min(1, CAMERA.followStiffness * dt);
    this.camera.position.lerp(targetPos, this.mode === 'hood' ? 1 : k * 1.6);
    // Vertical follow is softer so jumps feel big
    if (this.mode !== 'hood') this.camera.position.y = prevY + (targetPos.y - prevY) * Math.min(1, (car.grounded ? 5 : 2.2) * dt);

    if (this.shakeAmount > 0.001) {
      const s = this.shakeAmount;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s * 0.7;
      this.camera.position.z += (Math.random() - 0.5) * s;
      this.shakeAmount *= Math.max(0, 1 - 7 * dt);
    }
    this.camera.lookAt(this.look);

    const speedF = Math.min(1.3, car.speed / 75);
    const fxScale = this.speedEffects ? 1 : 0.35;
    const targetFov = CAMERA.baseFov + speedF * CAMERA.maxFovBoost * 0.6 * fxScale + (boosting ? 8 * fxScale : 0);
    this.fov += (targetFov - this.fov) * Math.min(1, 3 * dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Slow cinematic orbit used behind menus. */
  orbit(center: THREE.Vector3, dt: number, radius = 14, height = 4.5): void {
    this.orbitAngle += dt * 0.18;
    this.camera.position.set(
      center.x + Math.cos(this.orbitAngle) * radius,
      center.y + height,
      center.z + Math.sin(this.orbitAngle) * radius,
    );
    this.camera.lookAt(center.x, center.y + 0.9, center.z);
    if (this.camera.fov !== 45) {
      this.camera.fov = 45;
      this.camera.updateProjectionMatrix();
    }
    this.fov = CAMERA.baseFov;
  }
}
