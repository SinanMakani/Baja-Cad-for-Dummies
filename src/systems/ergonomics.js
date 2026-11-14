// Seated driver model. Pose is solved from the seat (H-point + back angle),
// the pedals (feet) and the steering wheel (hands) with two-bone IK. The body
// comes from the team's own drivers (height, weight, gender and any measured
// lengths, see drivers.js); every driver on the roster can be checked.
import * as THREE from 'three';
import { DEG, V, clamp, perpendicular, segPoint } from '../core/geom.js';
import { getDef, paramsOf, portsWorld, partMatrix } from '../catalog/index.js';
import { quatFromDeg } from '../core/geom.js';
import { driverBody, activeDriver } from './drivers.js';

export const HELMET_SHELL = 1.2;
// Seat padding and soft tissue give a little: hips up to this much wider than
// the seat still fit.
export const SEAT_SQUEEZE = 0.5;
export const HIP_ABOVE_SEAT = 3.5;

function byRole(state, role) {
  return Object.values(state.parts).find((p) => getDef(p.def, state)?.role === role) || null;
}

/** Two-bone IK: returns mid joint, reached end point, interior joint angle and reach ratio. */
export function ik2(root, target, a, b, pole) {
  const d = target.clone().sub(root);
  const L = d.length();
  const Lc = clamp(L, Math.abs(a - b) + 1e-3, a + b - 1e-3);
  const dir = L > 1e-6 ? d.clone().normalize() : new THREE.Vector3(1, 0, 0);
  const cosA = clamp((a * a + Lc * Lc - b * b) / (2 * a * Lc), -1, 1);
  const A = Math.acos(cosA);
  let n = pole.clone().addScaledVector(dir, -pole.dot(dir));
  if (n.lengthSq() < 1e-8) n = perpendicular(dir);
  n.normalize();
  const joint = root.clone().addScaledVector(dir, a * Math.cos(A)).addScaledVector(n, a * Math.sin(A));
  const end = root.clone().addScaledVector(dir, Lc);
  const angle = Math.acos(clamp((a * a + b * b - Lc * Lc) / (2 * a * b), -1, 1)) / DEG;
  return { joint, end, angle, reach: L / (a + b), reachable: L <= a + b };
}

function circleDist(p, center, normal, radius) {
  const v = p.clone().sub(center);
  const inPlane = v.clone().addScaledVector(normal, -v.dot(normal));
  if (inPlane.lengthSq() < 1e-9) return Math.hypot(radius, v.dot(normal));
  const closest = center.clone().addScaledVector(inPlane.normalize(), radius);
  return p.distanceTo(closest);
}

/** Pose one driver (a roster entry; the active driver by default) in the car. */
export function analyzeErgonomics(state, segs, hull, spec = activeDriver(state)) {
  const seat = byRole(state, 'seat');
  const drv = driverBody(spec);
  const out = { driver: drv, seat, has: { seat: !!seat } };
  if (!seat) return out;

  const seatDef = getDef(seat.def, state);
  const sp = paramsOf(seat, seatDef);
  const Q = quatFromDeg(seat.rot);
  const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(Q);
  const lat = new THREE.Vector3(0, 1, 0).applyQuaternion(Q);
  const up = new THREE.Vector3(0, 0, 1).applyQuaternion(Q);
  const torso = new THREE.Vector3(-Math.sin(sp.recline * DEG), 0, Math.cos(sp.recline * DEG)).applyQuaternion(Q);
  const H = portsWorld(seat, seatDef).hpoint;

  const hips = { L: H.clone().addScaledVector(lat, drv.hipHalf), R: H.clone().addScaledVector(lat, -drv.hipHalf) };
  const upTorso = drv.shoulderH - HIP_ABOVE_SEAT;
  const shoulderC = H.clone().addScaledVector(torso, upTorso);
  const shoulders = { L: shoulderC.clone().addScaledVector(lat, drv.shoulderHalf), R: shoulderC.clone().addScaledVector(lat, -drv.shoulderHalf) };
  const neck = H.clone().addScaledVector(torso, upTorso + 1.5);
  const head = H.clone().addScaledVector(torso, drv.sitHeight - HIP_ABOVE_SEAT - drv.headR);
  const helmetR = drv.headR + HELMET_SHELL;
  const helmetTop = head.clone().addScaledVector(torso, helmetR);
  const eye = head.clone().addScaledVector(fwd, 3.2).addScaledVector(up, 0.4);

  // Feet → pedals
  const brake = byRole(state, 'brakePedal');
  const throttle = byRole(state, 'throttlePedal');
  const pedalPads = [];
  for (const p of [brake, throttle]) if (p) pedalPads.push({ part: p, role: getDef(p.def, state).role, pad: portsWorld(p, getDef(p.def, state)).pad });
  const footTarget = {};
  if (pedalPads.length === 2) {
    const [a, b] = pedalPads.sort((x, y) => y.pad.y - x.pad.y);
    footTarget.L = a; footTarget.R = b;
  } else if (pedalPads.length === 1) {
    const only = pedalPads[0];
    if (only.pad.y >= H.y) footTarget.L = only; else footTarget.R = only;
  }
  const legs = {};
  for (const side of ['L', 'R']) {
    const hip = hips[side];
    const tgt = footTarget[side];
    const ankleTarget = tgt
      ? tgt.pad.clone().addScaledVector(fwd, -3.8).addScaledVector(up, 2.2)
      : hip.clone().addScaledVector(fwd, (drv.thigh + drv.shank) * 0.78).addScaledVector(up, -3);
    const ik = ik2(hip, ankleTarget, drv.thigh, drv.shank, up);
    legs[side] = { hip, knee: ik.joint, ankle: ik.end, target: ankleTarget, angle: ik.angle, reach: ik.reach, reachable: ik.reachable, pedal: tgt?.role || null,
      toe: ik.end.clone().addScaledVector(fwd, 4.0).addScaledVector(up, -1.8) };
  }

  // Hands → steering wheel rim at 9 and 3 o'clock
  const wheel = byRole(state, 'steeringWheel');
  const arms = {};
  let wheelInfo = null;
  if (wheel) {
    const wd = getDef(wheel.def, state), wp = paramsOf(wheel, wd);
    const WQ = quatFromDeg(wheel.rot);
    const wAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(WQ);
    const wLat = new THREE.Vector3(0, 1, 0).applyQuaternion(WQ);
    const C = V(wheel.pos);
    wheelInfo = { center: C, axis: wAxis, radius: wp.diameter / 2, grip: wp.grip };
    for (const side of ['L', 'R']) {
      const s = side === 'L' ? 1 : -1;
      const hand = C.clone().addScaledVector(wLat, s * wp.diameter / 2);
      const pole = new THREE.Vector3(0, 0, -1).addScaledVector(lat, s * 0.15).addScaledVector(fwd, -0.35);
      const ik = ik2(shoulders[side], hand, drv.upperArm, drv.forearm, pole);
      arms[side] = { shoulder: shoulders[side], elbow: ik.joint, hand: ik.end, target: hand, angle: ik.angle, reach: ik.reach, reachable: ik.reachable };
    }
  } else {
    for (const side of ['L', 'R']) {
      const knee = legs[side].knee;
      const hand = H.clone().lerp(knee, 0.6).addScaledVector(up, 2.5);
      const ik = ik2(shoulders[side], hand, drv.upperArm, drv.forearm, new THREE.Vector3(0, 0, -1));
      arms[side] = { shoulder: shoulders[side], elbow: ik.joint, hand: ik.end, target: hand, angle: ik.angle, reach: ik.reach, reachable: true };
    }
  }

  // Clearances to frame members (surface to surface). The helmet is measured
  // to the cage around and above it; tubes below the head (harness bar,
  // seat mounts) are covered by the body-point checks instead. Shoulders,
  // elbows and knees get thicker with body weight; hands (gloves) and feet
  // (shoes) don't.
  const g = drv.girth;
  const bodyPoints = [
    { name: 'helmet', p: head, r: helmetR, above: head.z - 2 },
    { name: 'left shoulder', p: shoulders.L, r: 2.6 * g }, { name: 'right shoulder', p: shoulders.R, r: 2.6 * g },
    { name: 'left elbow', p: arms.L.elbow, r: 1.8 * g }, { name: 'right elbow', p: arms.R.elbow, r: 1.8 * g },
    { name: 'left hand', p: arms.L.hand, r: 1.6 }, { name: 'right hand', p: arms.R.hand, r: 1.6 },
    { name: 'left knee', p: legs.L.knee, r: 2.4 * g }, { name: 'right knee', p: legs.R.knee, r: 2.4 * g },
    { name: 'left foot', p: legs.L.toe, r: 1.8 }, { name: 'right foot', p: legs.R.toe, r: 1.8 },
  ];
  const clearances = bodyPoints.map((b) => {
    let best = { dist: Infinity, member: null };
    for (const s of segs) {
      const r = segPoint(b.p, s.a, s.b);
      if (b.above != null && r.point.z < b.above) continue;
      const d = r.dist - s.r - b.r;
      if (d < best.dist) best = { dist: d, member: s.id };
    }
    return { ...b, ...best };
  });

  let outside = [];
  if (hull) {
    const pts = [
      ['helmet top', helmetTop], ['left shoulder', shoulders.L], ['right shoulder', shoulders.R],
      ['left elbow', arms.L.elbow], ['right elbow', arms.R.elbow], ['left knee', legs.L.knee], ['right knee', legs.R.knee],
      ['left foot', legs.L.toe], ['right foot', legs.R.toe], ['left hand', arms.L.hand], ['right hand', arms.R.hand],
    ];
    outside = pts.filter(([, p]) => !hull.containsPoint(p)).map(([n]) => n);
  }

  let kneeWheel = null;
  if (wheelInfo) {
    kneeWheel = Math.min(...['L', 'R'].map((s) => circleDist(legs[s].knee, wheelInfo.center, wheelInfo.axis, wheelInfo.radius) - wheelInfo.grip / 2 - 2.4));
  }

  // Seat width against the driver's seated hip width.
  const margin = sp.width - drv.hipWidth;
  const seatFit = { seatWidth: sp.width, hipWidth: drv.hipWidth, margin, tight: margin < -SEAT_SQUEEZE, measured: drv.measured.includes('hipWidth') };

  const cg = H.clone().addScaledVector(torso, 6.5).addScaledVector(fwd, 3);
  return {
    ...out,
    pose: { H, hips, shoulderC, shoulders, neck, head, helmetR, helmetTop, eye, legs, arms, torso, fwd, lat, up, girth: g },
    wheel: wheelInfo, clearances, outside, kneeWheel, cg, seatFit,
    has: { seat: true, brake: !!brake, throttle: !!throttle, wheel: !!wheel },
  };
}

export { partMatrix };
