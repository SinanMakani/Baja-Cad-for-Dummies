// Suspension geometry + kinematics.
//
// Hardpoints are stored for the LEFT side (+Y); the right side is mirrored.
// The upright/hub is solved as a rigid body held by link-length constraints
// (ball joints to A-arm pivots, tie rod, camber links, spherical pivots),
// with wheel-center height as the driving input. Adding a new suspension type
// means adding an entry to SUSP_TYPES — the solver is generic.
import * as THREE from 'three';
import { V, DEG, clamp, solveLinear, signedAngleAbout, rotateAbout } from '../core/geom.js';
import { getDef } from '../catalog/index.js';

export const SUSP_TYPES = {
  'double-wishbone': {
    label: 'Double A-arm (wishbone)',
    points: {
      UCA_F: { label: 'Upper A-arm · front pivot', body: 'chassis', group: 'Upper A-arm' },
      UCA_R: { label: 'Upper A-arm · rear pivot', body: 'chassis', group: 'Upper A-arm' },
      UBJ: { label: 'Upper ball joint', body: 'upright', group: 'Upper A-arm' },
      LCA_F: { label: 'Lower A-arm · front pivot', body: 'chassis', group: 'Lower A-arm' },
      LCA_R: { label: 'Lower A-arm · rear pivot', body: 'chassis', group: 'Lower A-arm' },
      LBJ: { label: 'Lower ball joint', body: 'upright', group: 'Lower A-arm' },
      TR_I: { label: 'Tie rod · inner (rack end)', body: 'chassis', group: 'Steering' },
      TR_O: { label: 'Tie rod · outer (steering arm)', body: 'upright', group: 'Steering' },
      WC: { label: 'Wheel center', body: 'upright', group: 'Wheel' },
      SH_U: { label: 'Shock · upper mount', body: 'chassis', group: 'Shock' },
      SH_L: { label: 'Shock · lower mount', body: 'lca', group: 'Shock' },
    },
    links: [['UBJ', 'UCA_F'], ['UBJ', 'UCA_R'], ['LBJ', 'LCA_F'], ['LBJ', 'LCA_R'], ['TR_O', 'TR_I']],
    joints: [],
    arms: { uca: { pivots: ['UCA_F', 'UCA_R'], outer: 'UBJ' }, lca: { pivots: ['LCA_F', 'LCA_R'], outer: 'LBJ' } },
    steer: 'TR_I',
    hoseExit: ['LCA_F', 'LCA_R'],
    hoseVia: 'LBJ',
  },
  'trailing-arm': {
    label: 'Trailing arm + 2 camber links',
    points: {
      TA_P: { label: 'Trailing arm · front pivot', body: 'chassis', group: 'Trailing arm' },
      TA_H: { label: 'Trailing arm · hub end', body: 'upright', group: 'Trailing arm' },
      CLU_I: { label: 'Upper camber link · inner', body: 'chassis', group: 'Camber links' },
      CLU_O: { label: 'Upper camber link · outer', body: 'upright', group: 'Camber links' },
      CLL_I: { label: 'Lower camber link · inner', body: 'chassis', group: 'Camber links' },
      CLL_O: { label: 'Lower camber link · outer', body: 'upright', group: 'Camber links' },
      WC: { label: 'Wheel center', body: 'upright', group: 'Wheel' },
      SH_U: { label: 'Shock · upper mount', body: 'chassis', group: 'Shock' },
      SH_L: { label: 'Shock · lower mount (on arm)', body: 'upright', group: 'Shock' },
    },
    links: [['CLU_O', 'CLU_I'], ['CLL_O', 'CLL_I']],
    joints: ['TA_P'], // spherical: body copy of the pivot stays on the chassis point
    arms: {},
    steer: null,
    hoseExit: ['TA_P'],
    hoseVia: 'TA_H',
  },
};

export const typeOf = (axle) => SUSP_TYPES[axle.type] || SUSP_TYPES['double-wishbone'];

// ---------------------------------------------------------------- components

export function tireData(axle, state) { return getDef(axle.tire, state)?.data || { diameter: 22, width: 7, rim: 10, rimWidth: 5, weight: 10, wheelWeight: 4.5 }; }
export function shockData(axle, state) {
  const d = getDef(axle.shock, state)?.data || { extended: 16, stroke: 4.5, bodyDia: 2, weight: 6, kind: 'coil' };
  return { ...d, ...(axle.shockSpec || {}) };
}
export const rotorData = (axle, state) => getDef(axle.rotor, state)?.data || { diameter: 8, thickness: 0.19, weight: 1.3 };
export const caliperData = (axle, state) => getDef(axle.caliper, state)?.data || { weight: 1.1, pistons: 1, pistonDia: 1.25 };
export const uprightData = (axle, state) => getDef(axle.upright, state)?.data || { weight: 2.5, material: 'Aluminum' };
export const rackData = (state) => getDef(state.suspension.steering.rack, state)?.data || { housing: 12, travel: 1.75, cFactor: 2, weight: 4.5 };

/** Outboard spin-axis unit vector for the LEFT wheel from static camber (neg = top in) and toe (pos = toe-in). */
export function wheelAxis(camberDeg, toeDeg) {
  const g = camberDeg * DEG, t = toeDeg * DEG;
  return new THREE.Vector3(Math.sin(t) * Math.cos(g), Math.cos(t) * Math.cos(g), -Math.sin(g)).normalize();
}
export const camberOf = (a) => -Math.asin(clamp(a.z, -1, 1)) / DEG;
export const toeOf = (a) => Math.atan2(a.x, a.y) / DEG;
export const yawOf = (a) => Math.atan2(-a.x, a.y) / DEG;

export function contactPatch(wc, axis, radius) {
  const d = new THREE.Vector3(0, 0, -1).addScaledVector(axis, axis.z);
  if (d.lengthSq() < 1e-9) d.set(0, 0, -1);
  return wc.clone().addScaledVector(d.normalize(), radius);
}

// ---------------------------------------------------------------- solver

function makeQuat(q) {
  const th = Math.hypot(q[0], q[1], q[2]);
  if (th < 1e-14) return new THREE.Quaternion();
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(q[0] / th, q[1] / th, q[2] / th), th);
}

/**
 * Solve one (left) corner.
 *   heave: wheel-center Z offset from static (in, + = bump)
 *   rack:  steering rack displacement (in, + = toward +Y)
 */
export function solveCorner(axle, { heave = 0, rack = 0 } = {}, warm = null) {
  const T = typeOf(axle);
  const P = axle.points;
  const wc0 = V(P.WC);
  const body0 = {};
  for (const [k, d] of Object.entries(T.points)) if (d.body === 'upright' && P[k]) body0[k] = V(P[k]);
  for (const j of T.joints) body0[`@${j}`] = V(P[j]);
  body0.WA = wc0.clone().add(wheelAxis(axle.camber || 0, axle.toe || 0));

  const fixed = {};
  for (const [k, d] of Object.entries(T.points)) if (d.body === 'chassis' && P[k]) fixed[k] = V(P[k]);
  if (T.steer && rack && fixed[T.steer]) fixed[T.steer].y += rack;

  const L0 = T.links.map(([b, c]) => V(P[b]).distanceTo(V(P[c])));
  const targetZ = wc0.z + heave;
  const keys = Object.keys(body0);

  const transform = (q) => {
    const Q = makeQuat(q);
    const t = new THREE.Vector3(q[3], q[4], q[5]);
    const out = {};
    for (const k of keys) out[k] = body0[k].clone().sub(wc0).applyQuaternion(Q).add(wc0).add(t);
    return out;
  };
  const residual = (q) => {
    const b = transform(q);
    const r = T.links.map(([bk, ck], i) => b[bk].distanceTo(fixed[ck]) - L0[i]);
    for (const j of T.joints) { const d = b[`@${j}`].clone().sub(fixed[j]); r.push(d.x, d.y, d.z); }
    r.push(b.WC.z - targetZ);
    return r;
  };
  const norm = (r) => Math.sqrt(r.reduce((s, v) => s + v * v, 0));

  let q = warm ? [...warm] : [0, 0, 0, 0, 0, heave];
  let r = residual(q);
  let rn = norm(r);
  for (let it = 0; it < 60 && rn > 1e-10; it++) {
    const h = 1e-7;
    const J = r.map(() => new Array(6).fill(0));
    for (let c = 0; c < 6; c++) {
      const qh = [...q]; qh[c] += h;
      const rh = residual(qh);
      for (let i = 0; i < r.length; i++) J[i][c] = (rh[i] - r[i]) / h;
    }
    const JtJ = Array.from({ length: 6 }, (_, i) => Array.from({ length: 6 }, (_, j) => J.reduce((s, row) => s + row[i] * row[j], 0) + (i === j ? 1e-12 : 0)));
    const Jtr = Array.from({ length: 6 }, (_, i) => -J.reduce((s, row, k) => s + row[i] * r[k], 0));
    const dq = solveLinear(JtJ, Jtr);
    if (!dq) break;
    let step = 1, improved = false;
    for (let ls = 0; ls < 10; ls++) {
      const qn = q.map((v, i) => v + step * dq[i]);
      const rn2 = residual(qn);
      const n2 = norm(rn2);
      if (n2 < rn) { q = qn; r = rn2; rn = n2; improved = true; break; }
      step *= 0.5;
    }
    if (!improved) break;
  }

  const body = transform(q);
  const pts = {};
  for (const [k, v] of Object.entries(fixed)) pts[k] = v;
  for (const k of keys) if (!k.startsWith('@') && k !== 'WA') pts[k] = body[k];
  for (const [k, d] of Object.entries(T.points)) {
    if (d.body === 'lca' || d.body === 'uca') {
      const arm = T.arms[d.body];
      const A = V(P[arm.pivots[0]]), B = V(P[arm.pivots[1]]);
      const axis = B.clone().sub(A);
      const ang = signedAngleAbout(V(P[arm.outer]).sub(A), body[arm.outer].clone().sub(A), axis);
      pts[k] = rotateAbout(V(P[k]), A, axis, ang);
    }
  }
  const axis = body.WA.clone().sub(body.WC).normalize();
  const shock = pts.SH_U && pts.SH_L ? pts.SH_U.distanceTo(pts.SH_L) : null;
  return { ok: rn < 1e-5, residual: rn, q, pts, axis, camber: camberOf(axis), toe: toeOf(axis), yaw: yawOf(axis), shock };
}

/** Mirror a solved left corner to the right side. */
export function mirrorPose(pose) {
  const pts = {};
  for (const [k, v] of Object.entries(pose.pts)) pts[k] = new THREE.Vector3(v.x, -v.y, v.z);
  return { ...pose, pts, axis: new THREE.Vector3(pose.axis.x, -pose.axis.y, pose.axis.z) };
}

/** Right corner pose at a given rack displacement = mirror of left at −rack. */
export function cornerPoses(axle, { heave = 0, rack = 0, heaveR } = {}) {
  const L = solveCorner(axle, { heave, rack });
  const R = mirrorPose(solveCorner(axle, { heave: heaveR ?? heave, rack: -rack }));
  return { L, R };
}

// ---------------------------------------------------------------- sweeps

export function heaveSweep(axle, bump, droop, n = 12) {
  const rows = [];
  const add = (dir, max) => {
    let warm = null;
    for (let i = 1; i <= n; i++) {
      const z = dir * (max * i) / n;
      const s = solveCorner(axle, { heave: z }, warm);
      warm = s.q;
      rows.push({ z, ok: s.ok, camber: s.camber, toe: s.toe, track: s.pts.WC.y, x: s.pts.WC.x, shock: s.shock, pose: s });
    }
  };
  const s0 = solveCorner(axle, {});
  rows.push({ z: 0, ok: s0.ok, camber: s0.camber, toe: s0.toe, track: s0.pts.WC.y, x: s0.pts.WC.x, shock: s0.shock, pose: s0 });
  if (bump > 0) add(1, bump);
  if (droop > 0) add(-1, droop);
  rows.sort((a, b) => a.z - b.z);
  return rows;
}

function slopeAt0(rows, key) {
  const i = rows.findIndex((r) => r.z === 0);
  const a = rows[Math.max(0, i - 1)], b = rows[Math.min(rows.length - 1, i + 1)];
  if (!a || !b || a === b || a[key] == null || b[key] == null) return null;
  return (b[key] - a[key]) / (b.z - a.z);
}

export function steerSweep(axle, travel, wheelbase, track, n = 10) {
  if (!typeOf(axle).steer) return null;
  const s0 = solveCorner(axle, {});
  const at = new Map([[0, s0]]);
  for (const dir of [1, -1]) {
    let warm = null;
    for (let i = 1; i <= n; i++) {
      const s = (dir * travel * i) / n;
      const sol = solveCorner(axle, { rack: s }, warm);
      warm = sol.q;
      at.set(s, sol);
    }
  }
  const yaw0 = s0.yaw;
  const dL = (s) => at.get(s).yaw - yaw0;
  const rows = [...at.keys()].sort((a, b) => a - b).map((s) => ({ s, left: dL(s), right: -dL(-s), ok: at.get(s).ok }));
  // Left turn at the rack end that turns the left wheel positive.
  const sLeft = dL(travel) > 0 ? travel : -travel;
  const inner = dL(sLeft), outer = -dL(-sLeft);
  const ideal = (o) => {
    const c = 1 / Math.tan(o * DEG) - track / wheelbase;
    return c > 0 ? Math.atan(1 / c) / DEG : 90;
  };
  const ack = (i, o) => (Math.abs(ideal(o) - o) > 1e-6 ? ((i - o) / (ideal(o) - o)) * 100 : 0);
  return {
    rows,
    innerMax: inner,
    outerMax: outer,
    idealInner: ideal(outer),
    ackermann: ack(inner, outer),
    turningDia: outer > 0.5 ? (2 * wheelbase) / Math.sin(outer * DEG) + track : Infinity,
    ok: rows.every((r) => r.ok),
  };
}

// ---------------------------------------------------------------- static geometry

function piercePoint(A, B, x) {
  const d = B.clone().sub(A);
  if (Math.abs(d.x) < 1e-6) return A.clone().add(B).multiplyScalar(0.5);
  const t = (x - A.x) / d.x;
  return A.clone().addScaledVector(d, t);
}

function frontViewIC(lines) {
  // lines: [[inner, outer], [inner, outer]] as Vector3 — use YZ.
  const [l1, l2] = lines;
  const p1 = { x: l1[0].y, y: l1[0].z }, d1 = { x: l1[1].y - l1[0].y, y: l1[1].z - l1[0].z };
  const p2 = { x: l2[0].y, y: l2[0].z }, d2 = { x: l2[1].y - l2[0].y, y: l2[1].z - l2[0].z };
  const den = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(den) < 1e-9) return { parallel: true, slope: (d1.y / d1.x + d2.y / d2.x) / 2 };
  const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / den;
  return { y: p1.x + d1.x * t, z: p1.y + d1.y * t };
}

export function staticGeometry(axle, state) {
  const T = typeOf(axle);
  const P = axle.points;
  const tire = tireData(axle, state);
  const R = tire.diameter / 2;
  const wc = V(P.WC);
  const axis = wheelAxis(axle.camber || 0, axle.toe || 0);
  const cp = contactPatch(wc, axis, R);
  const g = { R, cp, wc, axis, tire };

  let icLines = null;
  if (axle.type === 'double-wishbone') {
    const U = V(P.UBJ), L = V(P.LBJ);
    const k = U.clone().sub(L);
    g.kpi = Math.atan2(-k.y, k.z) / DEG;
    g.caster = Math.atan2(-k.x, k.z) / DEG;
    const t = -L.z / k.z;
    const ground = L.clone().addScaledVector(k, t);
    g.kpGround = ground;
    g.scrub = cp.y - ground.y;
    g.trail = ground.x - cp.x;
    const kn = k.clone().normalize();
    const w = wc.clone().sub(L);
    g.spindle = w.clone().addScaledVector(kn, -w.dot(kn)).length();
    g.uprightHeight = k.length();
    const armLen = (a, b, o) => {
      const A = V(P[a]), B = V(P[b]), O = V(P[o]);
      const d = B.clone().sub(A).normalize();
      const v = O.clone().sub(A);
      return v.addScaledVector(d, -v.dot(d)).length();
    };
    g.ucaLength = armLen('UCA_F', 'UCA_R', 'UBJ');
    g.lcaLength = armLen('LCA_F', 'LCA_R', 'LBJ');
    g.tieRod = V(P.TR_O).distanceTo(V(P.TR_I));
    icLines = [
      [piercePoint(V(P.UCA_F), V(P.UCA_R), wc.x), U],
      [piercePoint(V(P.LCA_F), V(P.LCA_R), wc.x), L],
    ];
    // Ideal tie-rod inner height for zero bump steer: on the line from TR_O to the front-view IC.
  } else if (axle.type === 'trailing-arm') {
    g.armLength = Math.hypot(V(P.TA_P).x - wc.x, V(P.TA_P).z - wc.z);
    g.upperLink = V(P.CLU_O).distanceTo(V(P.CLU_I));
    g.lowerLink = V(P.CLL_O).distanceTo(V(P.CLL_I));
    g.armPlanAngle = Math.atan2(V(P.TA_H).y - V(P.TA_P).y, V(P.TA_P).x - V(P.TA_H).x) / DEG;
    icLines = [[V(P.CLU_I), V(P.CLU_O)], [V(P.CLL_I), V(P.CLL_O)]];
  }
  if (icLines) {
    const ic = frontViewIC(icLines);
    g.ic = ic;
    if (ic.parallel) g.rcHeight = ic.slope * (0 - cp.y);
    else g.rcHeight = Math.abs(ic.y - cp.y) < 1e-9 ? null : (ic.z * (0 - cp.y)) / (ic.y - cp.y);
  }
  return g;
}

// ---------------------------------------------------------------- full analysis

export function analyzeAxle(axle, state, { wheelbase, track, isFront }) {
  const stat = staticGeometry(axle, state);
  const sweep = heaveSweep(axle, axle.bump ?? 4, axle.droop ?? 3, 10);
  const shock = shockData(axle, state);
  const ok = sweep.every((r) => r.ok);
  const toes = sweep.map((r) => r.toe), cambers = sweep.map((r) => r.camber), shocks = sweep.map((r) => r.shock).filter((v) => v != null);
  const s0 = sweep.find((r) => r.z === 0);
  const out = {
    stat, sweep, ok, shock,
    camberGain: slopeAt0(sweep, 'camber'),
    bumpSteer: slopeAt0(sweep, 'toe'),
    toeRange: Math.max(...toes) - Math.min(...toes),
    camberRange: [Math.min(...cambers), Math.max(...cambers)],
    motionRatio: slopeAt0(sweep, 'shock') != null ? -slopeAt0(sweep, 'shock') : null,
    shockStatic: s0?.shock,
    shockMin: shocks.length ? Math.min(...shocks) : null,
    shockMax: shocks.length ? Math.max(...shocks) : null,
    trackChange: sweep.length ? (Math.max(...sweep.map((r) => r.track)) - Math.min(...sweep.map((r) => r.track))) * 2 : 0,
    pose0: s0?.pose,
  };
  if (isFront && typeOf(axle).steer) {
    const rk = rackData(state);
    out.steer = steerSweep(axle, state.suspension.steering.travel ?? rk.travel, wheelbase, track);
    out.rack = rk;
  }
  return out;
}

export function vehicleDims(state) {
  const F = state.suspension.front.points.WC, R = state.suspension.rear.points.WC;
  return { wheelbase: F[0] - R[0], trackF: 2 * F[1], trackR: 2 * R[1], frontX: F[0], rearX: R[0] };
}

export function analyzeSuspension(state) {
  const d = vehicleDims(state);
  return {
    ...d,
    front: analyzeAxle(state.suspension.front, state, { wheelbase: d.wheelbase, track: d.trackF, isFront: true }),
    rear: analyzeAxle(state.suspension.rear, state, { wheelbase: d.wheelbase, track: d.trackR, isFront: false }),
  };
}

// ---------------------------------------------------------------- edits

/** Shift points of an axle. `which`: 'all' | 'upright' (outboard group). */
export function shiftAxle(axle, delta, which = 'all') {
  const T = typeOf(axle);
  for (const [k, d] of Object.entries(T.points)) {
    if (!axle.points[k]) continue;
    if (which === 'upright' && d.body !== 'upright') continue;
    axle.points[k] = axle.points[k].map((v, i) => +(v + delta[i]).toFixed(4));
  }
}

export function setWheelbase(state, wb) {
  const d = vehicleDims(state);
  shiftAxle(state.suspension.front, [wb - d.wheelbase, 0, 0], 'all');
}

export function setTrack(state, which, track) {
  const axle = state.suspension[which];
  const cur = 2 * axle.points.WC[1];
  shiftAxle(axle, [0, (track - cur) / 2, 0], 'upright');
}

/** Tire change: move the upright group so the new tire still touches the ground. */
export function setTire(state, which, key) {
  const axle = state.suspension[which];
  const oldR = tireData(axle, state).diameter / 2;
  axle.tire = key;
  const newR = tireData(axle, state).diameter / 2;
  shiftAxle(axle, [0, 0, newR - oldR], 'upright');
}

/** Tie-rod inner Z that puts the tie rod on the line through TR_O and the front-view IC (≈ zero bump steer). */
export function idealTieRodZ(axle, state) {
  const g = staticGeometry(axle, state);
  if (!g.ic || g.ic.parallel) return null;
  const o = V(axle.points.TR_O), iy = axle.points.TR_I[1];
  const slope = (g.ic.z - o.z) / (g.ic.y - o.y);
  return o.z + slope * (iy - o.y);
}
