// Mass roll-up and center of gravity (CG).
import * as THREE from 'three';
import { V } from '../core/geom.js';
import { getDef, weightOf, localBounds, partMatrix } from '../catalog/index.js';
import { memberInfo } from './chassis.js';
import { tireData, shockData, rotorData, caliperData, uprightData, rackData, typeOf } from './suspension.js';
import { profileProps, DEFAULT_PROFILES } from '../catalog/materials.js';
import { gateLocked } from './stresstest.js';

export function analyzeMass(state, A) {
  const items = [];
  // Before a new frame passes its stress tests only the frame is part of the car.
  const frameOnly = gateLocked(state);
  const add = (category, label, w, p) => {
    if (frameOnly && category !== 'chassis') return;
    if (w > 0 && p) items.push({ category, label, w, p: p.clone ? p.clone() : V(p) });
  };

  for (const id of Object.keys(state.chassis.members)) {
    const info = memberInfo(state, id);
    add('chassis', `Tube ${id}`, info.weight, info.A.clone().lerp(info.B, 0.5));
  }
  for (const part of Object.values(state.parts)) {
    const def = getDef(part.def, state);
    if (!def) continue;
    const c = localBounds(part, def).getCenter(new THREE.Vector3()).applyMatrix4(partMatrix(part));
    add(def.category, part.name || def.name, weightOf(part, def), c);
  }
  const armLw = profileProps(DEFAULT_PROFILES.P0875x058).linearWeight;
  const unsprung = {};
  for (const axleKey of ['front', 'rear']) {
    const axle = state.suspension[axleKey];
    const pose = A.susp?.[axleKey]?.pose0;
    if (!pose) continue;
    const T = typeOf(axle);
    const tire = tireData(axle, state), sh = shockData(axle, state);
    let corner = 0;
    for (const s of [1, -1]) {
      const P = (k) => { const v = pose.pts[k].clone(); v.y *= s; return v; };
      const wheelW = tire.weight + (tire.wheelWeight ?? 4.5);
      add('dynamics', `${axleKey} wheel`, wheelW, P('WC'));
      const hub = uprightData(axle, state).weight + rotorData(axle, state).weight + caliperData(axle, state).weight;
      add('dynamics', `${axleKey} upright + brake`, hub, P('WC').clone().lerp(P(Object.keys(pose.pts).includes('UBJ') ? 'UBJ' : 'TA_H'), 0.4));
      add('dynamics', `${axleKey} shock`, sh.weight, P('SH_U').clone().lerp(P('SH_L'), 0.5));
      let arms = 0;
      for (const [b, c] of [...T.links, ...(T.joints.length ? [['TA_H', T.joints[0]]] : [])]) {
        if (!pose.pts[b] || !pose.pts[c]) continue;
        const L = pose.pts[b].distanceTo(pose.pts[c]);
        const w = L * armLw * (T.joints.length && b === 'TA_H' ? 2.2 : 1) + 0.35;
        arms += w;
        add('dynamics', `${axleKey} link`, w, P(b).clone().lerp(P(c), 0.5));
      }
      if (s === 1) corner = wheelW + hub + arms / 2 + sh.weight / 2;
    }
    unsprung[axleKey] = corner;
  }
  if (typeOf(state.suspension.front).steer) {
    const tri = state.suspension.front.points.TR_I;
    add('dynamics', 'Steering rack', rackData(state).weight, new THREE.Vector3(tri[0], 0, tri[2]));
  }
  for (const cv of [...(A.pt?.cv || []), ...(A.pt?.frontCv || [])]) add('powertrain', `CV axle ${cv.side}`, 3.2, cv.inboard.clone().lerp(cv.outboard, 0.5));
  if (A.pt?.driveshaft) add('powertrain', 'Driveshaft', 0.14 * A.pt.driveshaft.length + 1, A.pt.driveshaft.a.clone().lerp(A.pt.driveshaft.b, 0.5));
  for (const r of A.routes?.routes || []) {
    if (!r.ok) continue;
    const w = (r.hard || 0) * 0.012 + (r.flex || 0) * 0.02 + (r.cable || 0) * 0.01;
    const mid = r.segments[0]?.pts?.[Math.floor((r.segments[0].pts.length - 1) / 2)];
    if (mid) add(r.kind === 'throttle' ? 'powertrain' : 'dynamics', r.label, w, mid);
  }

  const vehicle = items.slice();
  const includeDriver = state.ergonomics?.includeDriverInCG !== false;
  if (includeDriver && A.ergo?.cg) add('driver', `Driver (${A.ergo.driver.label})`, A.ergo.driver.weight, A.ergo.cg);

  const sum = (list) => {
    const W = list.reduce((s, i) => s + i.w, 0);
    const cg = list.reduce((acc, i) => acc.addScaledVector(i.p, i.w), new THREE.Vector3()).multiplyScalar(W > 0 ? 1 / W : 0);
    return { W, cg };
  };
  const total = sum(items), dry = sum(vehicle);
  const byCat = {};
  for (const i of items) byCat[i.category] = (byCat[i.category] || 0) + i.w;
  const wb = A.susp?.wheelbase, rearX = A.susp?.rearX;
  const frontPct = wb ? ((total.cg.x - rearX) / wb) * 100 : null;
  return { items, total: total.W, cg: total.cg, dryWeight: dry.W, dryCg: dry.cg, byCat, frontPct, unsprung, includeDriver };
}
