// Automatic integration between parts. Runs after every design change.
//
// Powertrain chain (when Powertrain ▸ Auto-link is on):
//   gearbox (placed by you) → CVT secondary rides on the gearbox input shaft,
//   rotated to its center-line angle → engine PTO shaft sits in the CVT primary.
// Move or re-rate the gearbox/CVT and the rest of the chain follows.
import * as THREE from 'three';
import { DEG, quatFromDeg, V } from '../core/geom.js';
import { getDef, paramsOf, portsWorld } from '../catalog/index.js';

const eulerDeg = (q) => {
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  return [e.x / DEG, e.y / DEG, e.z / DEG].map((v) => +v.toFixed(4));
};

function firstByRole(state, role) {
  return Object.values(state.parts).find((p) => getDef(p.def, state)?.role === role);
}

export function integratePowertrain(state) {
  if (!state.powertrain?.autoLink) return;
  const gb = firstByRole(state, 'gearbox');
  const cvt = firstByRole(state, 'cvt');
  const eng = firstByRole(state, 'engine');
  if (!gb) return;
  const gbDef = getDef(gb.def, state);
  const gbQ = quatFromDeg(gb.rot);

  if (cvt && cvt.linked !== false) {
    const cvtDef = getDef(cvt.def, state);
    const cp = paramsOf(cvt, cvtDef);
    const input = portsWorld(gb, gbDef).input;
    const pitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -cp.angle * DEG);
    const q = gbQ.clone().multiply(pitch);
    cvt.pos = [input.x, input.y, input.z].map((v) => +v.toFixed(4));
    cvt.rot = eulerDeg(q);
    cvt.linked = true;

    if (eng && eng.linked !== false) {
      const ep = paramsOf(eng, getDef(eng.def, state));
      const primary = portsWorld(cvt, cvtDef).primary;
      const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -(ep.tilt || 0) * DEG);
      eng.pos = [primary.x, primary.y, primary.z].map((v) => +v.toFixed(4));
      eng.rot = eulerDeg(gbQ.clone().multiply(tilt));
      eng.linked = true;
    }
  }
}

/** Keep the steering rack's inner tie-rod points and the rack model consistent. */
export function integrateSteering(state) {
  const s = state.suspension.steering;
  if (!s) return;
  s.travel ??= 1.75;
}

export function integrate(state) {
  integratePowertrain(state);
  integrateSteering(state);
}

export const isChainLinked = (part) => part.linked === true;

/** Gearbox output shaft axis (world) — used for CV joint angles. */
export function gearboxAxis(gb) {
  return new THREE.Vector3(0, 1, 0).applyQuaternion(quatFromDeg(gb.rot));
}

export { V };
