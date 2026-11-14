// Synthetic CAD-style tube meshes for the import tests and the sample file.
// Coordinates are in inches (app axes); callers convert to the CAD's axes/units.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const addS = (a, d, s) => [a[0] + d[0] * s, a[1] + d[1] * s, a[2] + d[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const l = len(a); return [a[0] / l, a[1] / l, a[2] / l]; };

/** Rotate v about unit axis k by angle th (Rodrigues). */
function rotate(v, k, th) {
  const c = Math.cos(th), s = Math.sin(th), kv = cross(k, v), kd = dot(k, v);
  return [0, 1, 2].map((i) => v[i] * c + kv[i] * s + k[i] * kd * (1 - c));
}

/**
 * Centerline samples of a polyline with every corner filleted at radius `clr`
 * (reduced where the legs are short). Straight runs get only their end samples,
 * as CAD tessellators do, unless `straightStep` subdivides them.
 */
export function filletPath(points, { clr = 4.5, bendStep = 12, straightStep = 0, minAngle = 0.5 } = {}) {
  const P = points;
  const n = P.length;
  const legs = [];
  for (let i = 0; i < n - 1; i++) legs.push(len(sub(P[i + 1], P[i])));
  const out = [{ p: P[0], t: unit(sub(P[1], P[0])) }];
  const pushStraight = (to, t) => {
    const from = out.at(-1).p;
    const L = len(sub(to, from));
    const k = straightStep > 0 ? Math.max(1, Math.round(L / straightStep)) : 1;
    for (let j = 1; j <= k; j++) out.push({ p: addS(from, sub(to, from), j / k), t });
  };
  const bends = [];
  for (let i = 1; i < n - 1; i++) {
    const u0 = unit(sub(P[i], P[i - 1])), u1 = unit(sub(P[i + 1], P[i]));
    const phi = Math.acos(Math.max(-1, Math.min(1, dot(u0, u1))));
    if (phi < minAngle * Math.PI / 180) continue;
    const rr = Math.min(clr, (0.42 * Math.min(legs[i - 1], legs[i])) / Math.tan(phi / 2));
    const tl = rr * Math.tan(phi / 2);
    const T0 = addS(P[i], u0, -tl);
    pushStraight(T0, u0);
    const m = unit(addS(u1, u0, -dot(u1, u0)));
    const C = addS(T0, m, rr);
    const steps = Math.max(1, Math.ceil(phi / (bendStep * Math.PI / 180)));
    for (let j = 1; j <= steps; j++) {
      const al = (phi * j) / steps;
      const p = [0, 1, 2].map((k) => C[k] + rr * (-m[k] * Math.cos(al) + u0[k] * Math.sin(al)));
      const t = [0, 1, 2].map((k) => u0[k] * Math.cos(al) + m[k] * Math.sin(al));
      out.push({ p, t });
    }
    bends.push({ at: P[i], clr: rr, angle: (phi * 180) / Math.PI });
  }
  pushStraight(P[n - 1], unit(sub(P[n - 1], P[n - 2])));
  return { samples: out, bends };
}

/**
 * Hollow round tube swept along centerline samples: outer and inner walls plus
 * annular end caps, `seg` facets around. Ends are trimmed by trimA / trimB
 * (like a weldment member stopping at the tube it meets).
 */
export function sweepTube(samples, { R, r, seg = 18, trimA = 0, trimB = 0 }) {
  const S = samples.map((s) => ({ ...s }));
  if (trimA) S[0] = { p: addS(S[0].p, S[0].t, trimA), t: S[0].t };
  if (trimB) S[S.length - 1] = { p: addS(S.at(-1).p, S.at(-1).t, -trimB), t: S.at(-1).t };
  // rotation-minimizing frames
  const t0 = S[0].t;
  const ref = Math.abs(t0[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  let e1 = unit(cross(ref, t0));
  const frames = [];
  const turn = (a, b) => {
    const ax = cross(a, b), s = len(ax);
    if (s > 1e-12) e1 = rotate(e1, [ax[0] / s, ax[1] / s, ax[2] / s], Math.atan2(s, dot(a, b)));
    e1 = unit(addS(e1, b, -dot(e1, b)));
  };
  for (let k = 0; k < S.length; k++) {
    const tin = S[k].tIn || S[k].t; // a miter corner arrives along tIn and leaves along t
    if (k > 0) turn(S[k - 1].t, tin);
    frames.push([e1, cross(tin, e1)]);
    if (S[k].tIn) turn(S[k].tIn, S[k].t);
  }
  const ring = (k, rad, j) => {
    const th = (j / seg) * Math.PI * 2, [a, b] = frames[k];
    const p = [0, 1, 2].map((i) => S[k].p[i] + rad * (Math.cos(th) * a[i] + Math.sin(th) * b[i]));
    if (!S[k].tIn) return p;
    // miter: slide the ring along the incoming tube onto the plane bisecting the corner
    const n = unit(addS(S[k].tIn, S[k].t, 1));
    return addS(p, S[k].tIn, -dot(sub(p, S[k].p), n) / dot(S[k].tIn, n));
  };
  const tris = [];
  for (let k = 0; k + 1 < S.length; k++) {
    for (let j = 0; j < seg; j++) {
      const o1 = ring(k, R, j), o2 = ring(k, R, j + 1), o3 = ring(k + 1, R, j + 1), o4 = ring(k + 1, R, j);
      tris.push(o1, o2, o3, o1, o3, o4);
      if (r) {
        const i1 = ring(k, r, j), i2 = ring(k, r, j + 1), i3 = ring(k + 1, r, j + 1), i4 = ring(k + 1, r, j);
        tris.push(i1, i3, i2, i1, i4, i3);
      }
    }
  }
  const last = S.length - 1;
  for (let j = 0; j < seg; j++) {
    if (r) {
      tris.push(ring(0, R, j), ring(0, r, j + 1), ring(0, R, j + 1), ring(0, R, j), ring(0, r, j), ring(0, r, j + 1));
      tris.push(ring(last, R, j), ring(last, R, j + 1), ring(last, r, j + 1), ring(last, R, j), ring(last, r, j + 1), ring(last, r, j));
    } else {
      tris.push(S[0].p, ring(0, R, j + 1), ring(0, R, j), S[last].p, ring(last, R, j), ring(last, R, j + 1));
    }
  }
  return Float32Array.from(tris.flat());
}

/** Centerline samples of a polyline with mitered corners (two straight cuts welded, merged into one body). */
export function miterPath(points) {
  const P = points;
  const u = [];
  for (let i = 0; i + 1 < P.length; i++) u.push(unit(sub(P[i + 1], P[i])));
  return P.map((p, i) => (i === 0 ? { p, t: u[0] } : i === P.length - 1 ? { p, t: u[i - 1] } : { p, tIn: u[i - 1], t: u[i] }));
}

/** Straight tube between two points (end samples only), trimmed at both ends. */
export function straightTube(A, B, opts) {
  const t = unit(sub(B, A));
  return sweepTube([{ p: A, t }, { p: B, t }], opts);
}

/** Apply a point map (e.g. inches/app axes → millimeters/SolidWorks axes) to a triangle soup. */
export function mapPositions(pos, fn) {
  const out = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    const q = fn([pos[i], pos[i + 1], pos[i + 2]]);
    out[i] = q[0]; out[i + 1] = q[1]; out[i + 2] = q[2];
  }
  return out;
}
