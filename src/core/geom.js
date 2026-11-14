// Small vector-math helpers on top of three.js. Coordinates follow ISO 8855:
// +X forward, +Y to the driver's left, +Z up. Origin: ground plane,
// vehicle centerline, rear-axle line.
import * as THREE from 'three';

export const DEG = Math.PI / 180;
export const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
export const arr = (v) => [v.x, v.y, v.z];
export const mirrorY = (a) => [a[0], -a[1], a[2]];
export const round = (v, p = 4) => Math.round(v * 10 ** p) / 10 ** p;
export const roundArr = (a, p = 4) => a.map((v) => round(v, p));
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function angleDeg(u, v) {
  const l = u.length() * v.length();
  if (l < 1e-12) return 0;
  return Math.acos(clamp(u.dot(v) / l, -1, 1)) / DEG;
}

/** Closest point on segment ab to p. */
export function segPoint(p, a, b) {
  const ab = new THREE.Vector3().subVectors(b, a);
  const len2 = ab.lengthSq();
  let t = len2 > 1e-12 ? new THREE.Vector3().subVectors(p, a).dot(ab) / len2 : 0;
  t = clamp(t, 0, 1);
  const point = a.clone().addScaledVector(ab, t);
  return { t, point, dist: point.distanceTo(p) };
}

/** Minimum distance between segments p1q1 and p2q2 (Ericson, RTCD 5.1.9). */
export function segSegDist(p1, q1, p2, q2) {
  const d1 = new THREE.Vector3().subVectors(q1, p1);
  const d2 = new THREE.Vector3().subVectors(q2, p2);
  const r = new THREE.Vector3().subVectors(p1, p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s, t;
  if (a <= 1e-12 && e <= 1e-12) return p1.distanceTo(p2);
  if (a <= 1e-12) { s = 0; t = clamp(f / e, 0, 1); }
  else {
    const c = d1.dot(r);
    if (e <= 1e-12) { t = 0; s = clamp(-c / a, 0, 1); }
    else {
      const b = d1.dot(d2);
      const denom = a * e - b * b;
      s = denom > 1e-12 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); }
      else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
    }
  }
  const c1 = p1.clone().addScaledVector(d1, s);
  const c2 = p2.clone().addScaledVector(d2, t);
  return c1.distanceTo(c2);
}

/** Intersect two 2D lines given as point+direction. Returns {x,y} or null. */
export function lineIntersect2(p1, d1, p2, d2) {
  const den = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / den;
  return { x: p1.x + d1.x * t, y: p1.y + d1.y * t };
}

/** Unit vector from azimuth (top view, from +X toward +Y) and elevation (from horizontal), degrees. */
export function fromAzEl(azDeg, elDeg) {
  const az = azDeg * DEG, el = elDeg * DEG;
  return new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el));
}

export function azEl(v) {
  const len = v.length();
  if (len < 1e-12) return { az: 0, el: 0 };
  return { az: Math.atan2(v.y, v.x) / DEG, el: Math.asin(clamp(v.z / len, -1, 1)) / DEG };
}

/** Signed rotation (deg) about `axis` that takes u to v, using components perpendicular to axis. */
export function signedAngleAbout(u, v, axis) {
  const a = axis.clone().normalize();
  const up = u.clone().addScaledVector(a, -u.dot(a));
  const vp = v.clone().addScaledVector(a, -v.dot(a));
  if (up.lengthSq() < 1e-12 || vp.lengthSq() < 1e-12) return 0;
  return Math.atan2(a.dot(new THREE.Vector3().crossVectors(up, vp)), up.dot(vp)) / DEG;
}

export function rotateAbout(p, origin, axis, deg) {
  const q = new THREE.Quaternion().setFromAxisAngle(axis.clone().normalize(), deg * DEG);
  return p.clone().sub(origin).applyQuaternion(q).add(origin);
}

/** Any unit vector perpendicular to v. */
export function perpendicular(v) {
  const a = Math.abs(v.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  return new THREE.Vector3().crossVectors(v, a).normalize();
}

/** Euler (degrees, XYZ order) → quaternion / matrix helpers used for parts. */
export function quatFromDeg(rot) {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG, 'XYZ'));
}

export function matrixFrom(pos, rot) {
  return new THREE.Matrix4().compose(V(pos), quatFromDeg(rot || [0, 0, 0]), new THREE.Vector3(1, 1, 1));
}

/** Oriented box from local Box3 and world matrix → {center, axes[3], half[3]} */
export function obbFrom(box, matrix) {
  const c = box.getCenter(new THREE.Vector3()).applyMatrix4(matrix);
  const size = box.getSize(new THREE.Vector3());
  const m = new THREE.Matrix3().setFromMatrix4(matrix);
  const e = m.elements;
  const axes = [
    new THREE.Vector3(e[0], e[1], e[2]).normalize(),
    new THREE.Vector3(e[3], e[4], e[5]).normalize(),
    new THREE.Vector3(e[6], e[7], e[8]).normalize(),
  ];
  return { center: c, axes, half: [size.x / 2, size.y / 2, size.z / 2] };
}

/** Separating-axis test for two OBBs; returns penetration depth estimate (>0 means overlap). */
export function obbOverlap(A, B) {
  const axes = [...A.axes, ...B.axes];
  for (const a of A.axes) for (const b of B.axes) {
    const c = new THREE.Vector3().crossVectors(a, b);
    if (c.lengthSq() > 1e-8) axes.push(c.normalize());
  }
  const T = new THREE.Vector3().subVectors(B.center, A.center);
  let minPen = Infinity;
  for (const L of axes) {
    const ra = A.half[0] * Math.abs(A.axes[0].dot(L)) + A.half[1] * Math.abs(A.axes[1].dot(L)) + A.half[2] * Math.abs(A.axes[2].dot(L));
    const rb = B.half[0] * Math.abs(B.axes[0].dot(L)) + B.half[1] * Math.abs(B.axes[1].dot(L)) + B.half[2] * Math.abs(B.axes[2].dot(L));
    const pen = ra + rb - Math.abs(T.dot(L));
    if (pen <= 0) return 0;
    minPen = Math.min(minPen, pen);
  }
  return minPen;
}

/** Distance from point to OBB surface (negative inside). */
export function pointObbDist(p, O) {
  const d = new THREE.Vector3().subVectors(p, O.center);
  let outside = 0, inside = -Infinity;
  for (let i = 0; i < 3; i++) {
    const t = d.dot(O.axes[i]);
    const ex = Math.abs(t) - O.half[i];
    if (ex > 0) outside += ex * ex;
    inside = Math.max(inside, ex);
  }
  return outside > 0 ? Math.sqrt(outside) : inside;
}

/** Solve n×n linear system (Gaussian elimination, partial pivot). Returns null if singular. */
export function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-14) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}
