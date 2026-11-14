// Procedural geometry helpers for catalog parts. All dimensions in inches.
import * as THREE from 'three';
import { DEG } from '../core/geom.js';

// Shared unit geometries are scaled per mesh and never disposed.
export const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 20, 1);
export const unitSphere = new THREE.SphereGeometry(1, 20, 14);
export const unitBox = new THREE.BoxGeometry(1, 1, 1);
for (const g of [unitCyl, unitSphere, unitBox]) g.userData.shared = true;

export function mat(color, { metal = 0.35, rough = 0.55, opacity = 1, side } = {}) {
  const m = new THREE.MeshStandardMaterial({
    color, metalness: metal, roughness: rough,
    transparent: opacity < 1, opacity, side: side ?? THREE.FrontSide,
  });
  m.userData.baseOpacity = opacity;
  return m;
}

function mesh(geo, color, opts) {
  const m = new THREE.Mesh(geo, color?.isMaterial ? color : mat(color, opts));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Box sized x (length) × y (width) × z (height), centered at (cx,cy,cz). */
export function box(x, y, z, color, c = [0, 0, 0], opts) {
  const m = mesh(unitBox, color, opts);
  m.scale.set(x, y, z);
  m.position.set(...c);
  return m;
}

/** Cylinder with its axis along a principal direction ('x' | 'y' | 'z'). */
export function cyl(r, h, axis, color, c = [0, 0, 0], opts) {
  const m = mesh(unitCyl, color, opts);
  m.scale.set(r, h, r);
  if (axis === 'x') m.rotation.z = -90 * DEG;
  if (axis === 'z') m.rotation.x = 90 * DEG;
  m.position.set(...c);
  return m;
}

/** Cylinder between two points. */
export function cylBetween(a, b, r, color, opts) {
  const A = a.isVector3 ? a : new THREE.Vector3(...a);
  const B = b.isVector3 ? b : new THREE.Vector3(...b);
  const d = new THREE.Vector3().subVectors(B, A);
  const len = d.length();
  const m = mesh(unitCyl, color, opts);
  m.scale.set(r, Math.max(len, 1e-4), r);
  m.position.copy(A).addScaledVector(d, 0.5);
  if (len > 1e-6) m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}

export function sphere(r, color, c = [0, 0, 0], opts) {
  const m = mesh(unitSphere, color, opts);
  m.scale.setScalar(r);
  m.position.set(...c);
  return m;
}

/** Revolve a 2D profile [[r, y], …] about the local Y axis, then align axis to `axis`. */
export function lathe(profile, color, axis = 'y', c = [0, 0, 0], opts, segs = 40) {
  const geo = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segs);
  const m = mesh(geo, color, { side: THREE.DoubleSide, ...opts });
  if (axis === 'x') m.rotation.z = -90 * DEG;
  if (axis === 'z') m.rotation.x = 90 * DEG;
  m.position.set(...c);
  return m;
}

/** Extruded 2D shape (points in XZ plane) with thickness along Y. */
export function plate(pointsXZ, thickness, color, yCenter = 0, opts) {
  const shape = new THREE.Shape(pointsXZ.map(([x, z]) => new THREE.Vector2(x, z)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  const m = mesh(geo, color, { side: THREE.DoubleSide, ...opts });
  // Extrude runs along +Z of the shape plane; map shape (x,y)->(x,z), depth->y.
  m.rotation.x = 90 * DEG;
  m.position.y = yCenter + thickness / 2;
  return m;
}

export function helix(radius, length, turns, wire, color) {
  class Helix extends THREE.Curve {
    getPoint(t, target = new THREE.Vector3()) {
      const a = t * turns * Math.PI * 2;
      return target.set(Math.cos(a) * radius, t * length - length / 2, Math.sin(a) * radius);
    }
  }
  return mesh(new THREE.TubeGeometry(new Helix(), Math.ceil(turns * 24), wire, 6, false), color, { metal: 0.6, rough: 0.35 });
}

export function group(...children) {
  const g = new THREE.Group();
  for (const c of children.flat()) if (c) g.add(c);
  return g;
}

export function at(obj, x, y, z) { obj.position.set(x, y, z); return obj; }
export function rotDeg(obj, rx = 0, ry = 0, rz = 0) { obj.rotation.set(rx * DEG, ry * DEG, rz * DEG); return obj; }

export const COLORS = {
  steel: 0x8a939c,
  darkSteel: 0x4a5058,
  aluminum: 0xc3c8ce,
  black: 0x24272b,
  rubber: 0x1d1f22,
  red: 0xb8322b,
  engine: 0x2f3338,
  engineAccent: 0xc9a227,
  cvt: 0x9aa4ad,
  belt: 0x2a2a2a,
  gearbox: 0x7c858e,
  tank: 0xd9dde1,
  seat: 0x2e3440,
  pedal: 0x9ba3ab,
  wheel: 0x9da3a9,
  orange: 0xbf5700,
  yellow: 0xe0b020,
  green: 0x3b7d4f,
  panel: 0xb0b7be,
};
