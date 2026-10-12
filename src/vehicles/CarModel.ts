import * as THREE from 'three';
import type { VehicleConfig } from './VehicleConfig';

/** Handles to the animated parts of a procedurally built car. */
export interface CarModel {
  root: THREE.Group;
  body: THREE.Group;
  wheels: THREE.Object3D[];
  frontWheels: THREE.Object3D[];
  brakeMaterial: THREE.MeshStandardMaterial;
  flames: THREE.Mesh[];
  flameMaterial: THREE.MeshBasicMaterial;
  underglow: THREE.Mesh;
  shield: THREE.Mesh;
  shieldMaterial: THREE.MeshBasicMaterial;
  dispose(): void;
}

const shared = {
  tire: new THREE.MeshStandardMaterial({ color: 0x111215, roughness: 0.9 }),
  glass: new THREE.MeshPhysicalMaterial({ color: 0x0a0f18, metalness: 0.2, roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0.92 }),
  carbon: new THREE.MeshStandardMaterial({ color: 0x15171c, metalness: 0.4, roughness: 0.55 }),
  headlight: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xe8f6ff, emissiveIntensity: 3 }),
};

function sideProfile(len: number, h: number, taper: number): THREE.Shape {
  // Profile in (x = along length, y = up), nose at +x.
  const l = len / 2;
  const s = new THREE.Shape();
  s.moveTo(-l, 0.15);
  s.lineTo(-l, h * 0.95);
  s.quadraticCurveTo(-l + 0.2, h * 1.05, -l + 0.6, h);
  s.lineTo(l * 0.35, h * 0.92);
  s.quadraticCurveTo(l * 0.8, h * (0.9 - taper * 0.4), l, h * (0.45 - taper * 0.15));
  s.lineTo(l + 0.05, 0.22);
  s.quadraticCurveTo(l, 0.05, l - 0.3, 0.05);
  s.lineTo(-l + 0.3, 0.05);
  s.quadraticCurveTo(-l, 0.05, -l, 0.15);
  return s;
}

function cabinProfile(len: number, h: number): THREE.Shape {
  const l = len / 2;
  const s = new THREE.Shape();
  s.moveTo(-l, 0);
  s.quadraticCurveTo(-l * 0.6, h, -l * 0.1, h);
  s.lineTo(l * 0.2, h);
  s.quadraticCurveTo(l * 0.7, h * 0.9, l * 1.15, 0);
  s.lineTo(-l, 0);
  return s;
}

function extrude(shape: THREE.Shape, width: number, bevel: number): THREE.ExtrudeGeometry {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 10,
  });
  // Shape is in XY; extrusion along Z. Rotate so length runs along +Z (forward).
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.rotateY(-Math.PI / 2);
  return g;
}

export function buildCarModel(cfg: VehicleConfig, opts: { lights?: boolean } = {}): CarModel {
  const sh = cfg.shape;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const disposables: { dispose(): void }[] = [];

  const paint = new THREE.MeshPhysicalMaterial({
    color: cfg.paint, metalness: 0.65, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08,
  });
  const accent = new THREE.MeshStandardMaterial({ color: cfg.accent, emissive: cfg.accent, emissiveIntensity: 1.6, metalness: 0.3, roughness: 0.4 });
  const brakeMaterial = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff1030, emissiveIntensity: 1.2 });
  disposables.push(paint, accent, brakeMaterial);

  const rideHeight = sh.wheelRadius * 0.55;

  const bodyGeo = extrude(sideProfile(sh.length, sh.bodyHeight, sh.noseTaper), sh.width, 0.12);
  disposables.push(bodyGeo);
  const bodyMesh = new THREE.Mesh(bodyGeo, paint);
  bodyMesh.position.y = rideHeight;
  bodyMesh.castShadow = true;
  body.add(bodyMesh);

  const cabinGeo = extrude(cabinProfile(sh.cabinLength, sh.cabinHeight), sh.width * 0.74, 0.1);
  disposables.push(cabinGeo);
  const cabin = new THREE.Mesh(cabinGeo, shared.glass);
  cabin.position.set(0, rideHeight + sh.bodyHeight * 0.92, sh.cabinOffset * sh.length * 0.5);
  cabin.castShadow = true;
  body.add(cabin);

  // Accent stripe along the flanks
  const stripeGeo = new THREE.BoxGeometry(0.04, 0.06, sh.length * 0.82);
  disposables.push(stripeGeo);
  for (const side of [-1, 1]) {
    const stripe = new THREE.Mesh(stripeGeo, accent);
    stripe.position.set(side * (sh.width / 2 + 0.01), rideHeight + sh.bodyHeight * 0.55, 0);
    body.add(stripe);
  }

  // Splitter + diffuser
  const splitGeo = new THREE.BoxGeometry(sh.width * 0.95, 0.06, 0.5);
  disposables.push(splitGeo);
  const splitter = new THREE.Mesh(splitGeo, shared.carbon);
  splitter.position.set(0, rideHeight + 0.04, sh.length / 2 - 0.1);
  body.add(splitter);
  const diffuser = splitter.clone();
  diffuser.position.z = -sh.length / 2 + 0.1;
  body.add(diffuser);

  // Spoiler
  if (sh.spoiler !== 'none') {
    const wingGeo = new THREE.BoxGeometry(sh.width * (sh.spoiler === 'lip' ? 0.9 : 1.05), 0.06, sh.spoiler === 'lip' ? 0.25 : 0.55);
    disposables.push(wingGeo);
    const wing = new THREE.Mesh(wingGeo, sh.spoiler === 'twin' ? accent : shared.carbon);
    const wingY = rideHeight + sh.bodyHeight * (sh.spoiler === 'lip' ? 1.0 : 1.45);
    wing.position.set(0, wingY, -sh.length / 2 + 0.35);
    wing.castShadow = true;
    body.add(wing);
    if (sh.spoiler !== 'lip') {
      const postGeo = new THREE.BoxGeometry(0.08, wingY - rideHeight - sh.bodyHeight * 0.9, 0.2);
      disposables.push(postGeo);
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(postGeo, shared.carbon);
        post.position.set(side * sh.width * 0.3, (wingY + rideHeight + sh.bodyHeight * 0.9) / 2, -sh.length / 2 + 0.35);
        body.add(post);
      }
    }
    if (sh.spoiler === 'twin') {
      const w2 = wing.clone();
      w2.material = shared.carbon;
      w2.position.y -= 0.22;
      w2.position.z += 0.15;
      body.add(w2);
    }
  }

  // Fins
  if (sh.fins) {
    const finShape = new THREE.Shape();
    finShape.moveTo(0, 0); finShape.lineTo(-0.9, 0); finShape.lineTo(-0.9, 0.35); finShape.lineTo(0, 0);
    const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.05, bevelEnabled: false });
    finGeo.rotateY(-Math.PI / 2);
    disposables.push(finGeo);
    for (const side of [-0.32, 0.32]) {
      const fin = new THREE.Mesh(finGeo, accent);
      fin.position.set(side * sh.width, rideHeight + sh.bodyHeight * 0.95, -sh.length * 0.18);
      body.add(fin);
    }
  }

  // Lights
  const hlGeo = new THREE.BoxGeometry(sh.width * 0.22, 0.08, 0.06);
  const tlGeo = new THREE.BoxGeometry(sh.width * 0.8, 0.07, 0.05);
  disposables.push(hlGeo, tlGeo);
  for (const side of [-1, 1]) {
    const hl = new THREE.Mesh(hlGeo, shared.headlight);
    hl.position.set(side * sh.width * 0.32, rideHeight + sh.bodyHeight * (0.45 - sh.noseTaper * 0.1), sh.length / 2 + 0.02);
    body.add(hl);
  }
  const tl = new THREE.Mesh(tlGeo, brakeMaterial);
  tl.position.set(0, rideHeight + sh.bodyHeight * 0.8, -sh.length / 2 - 0.02);
  body.add(tl);

  if (opts.lights) {
    const spot = new THREE.SpotLight(0xdff4ff, 40, 60, 0.5, 0.6, 1.5);
    spot.position.set(0, rideHeight + 0.6, sh.length / 2);
    spot.target.position.set(0, 0, sh.length / 2 + 20);
    body.add(spot, spot.target);
  }

  // Wheels
  const wheelGeo = new THREE.CylinderGeometry(sh.wheelRadius, sh.wheelRadius, 0.36, 20);
  wheelGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.TorusGeometry(sh.wheelRadius * 0.62, 0.05, 6, 18);
  rimGeo.rotateY(Math.PI / 2);
  disposables.push(wheelGeo, rimGeo);
  const wheels: THREE.Object3D[] = [];
  const frontWheels: THREE.Object3D[] = [];
  const wx = sh.width / 2 - 0.12;
  const wz = sh.length * 0.33;
  for (const [x, z] of [[-wx, wz], [wx, wz], [-wx, -wz], [wx, -wz]] as const) {
    const pivot = new THREE.Group();
    pivot.position.set(x, sh.wheelRadius, z);
    const spinner = new THREE.Group();
    const tire = new THREE.Mesh(wheelGeo, shared.tire);
    tire.castShadow = true;
    const rim = new THREE.Mesh(rimGeo, accent);
    rim.position.x = x > 0 ? 0.19 : -0.19;
    spinner.add(tire, rim);
    pivot.add(spinner);
    root.add(pivot);
    wheels.push(spinner);
    if (z > 0) frontWheels.push(pivot);
  }

  // Underglow
  const glowGeo = new THREE.PlaneGeometry(sh.width * 1.25, sh.length * 1.05);
  glowGeo.rotateX(-Math.PI / 2);
  const glowMat = new THREE.MeshBasicMaterial({ color: cfg.accent, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false });
  disposables.push(glowGeo, glowMat);
  const underglow = new THREE.Mesh(glowGeo, glowMat);
  underglow.position.y = 0.06;
  root.add(underglow);

  // Exhaust flames (scaled when boosting)
  const flameGeo = new THREE.ConeGeometry(0.16, 1.4, 10, 1, true);
  flameGeo.rotateX(-Math.PI / 2);
  flameGeo.translate(0, 0, -0.7);
  const flameMaterial = new THREE.MeshBasicMaterial({ color: 0x54e8ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  disposables.push(flameGeo, flameMaterial);
  const flames: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const f = new THREE.Mesh(flameGeo, flameMaterial);
    f.position.set(side * sh.width * 0.22, rideHeight + 0.28, -sh.length / 2 - 0.05);
    f.visible = false;
    body.add(f);
    flames.push(f);
  }

  // Phase shield bubble
  const shieldGeo = new THREE.SphereGeometry(1, 24, 16);
  const shieldMaterial = new THREE.MeshBasicMaterial({ color: 0x7cf7ff, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, wireframe: false });
  disposables.push(shieldGeo, shieldMaterial);
  const shield = new THREE.Mesh(shieldGeo, shieldMaterial);
  shield.scale.set(sh.width * 0.85, sh.bodyHeight + 1.1, sh.length * 0.62);
  shield.position.y = 0.8;
  shield.visible = false;
  root.add(shield);

  return {
    root, body, wheels, frontWheels, brakeMaterial, flames, flameMaterial, underglow, shield, shieldMaterial,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
