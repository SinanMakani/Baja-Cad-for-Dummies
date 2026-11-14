// Derived engineering data, recomputed (and cached) whenever the design changes.
// Views, panels and design checks all read from this one snapshot.
import * as THREE from 'three';
import { ConvexHull } from 'three/addons/math/ConvexHull.js';
import { V, obbFrom } from '../core/geom.js';
import { getDef, localBounds, localPieces, partMatrix, portsWorld, envelopeOf } from '../catalog/index.js';
import { chassisSegments, chassisStats } from './chassis.js';
import { analyzeSuspension, tireData } from './suspension.js';
import { analyzePowertrain } from './powertrain.js';
import { analyzeErgonomics } from './ergonomics.js';
import { analyzeRouting } from './routing.js';
import { analyzeMass } from './mass.js';

let cache = { rev: -1, A: null };

function frameHull(state) {
  const pts = Object.values(state.chassis.nodes).map((n) => V(n.p));
  if (pts.length < 4) return null;
  try {
    const hull = new ConvexHull().setFromPoints(pts);
    return hull.faces.length ? hull : null;
  } catch { return null; }
}

function overallDims(state, susp) {
  const box = new THREE.Box3();
  for (const n of Object.values(state.chassis.nodes)) box.expandByPoint(V(n.p));
  if (susp) {
    for (const [k, A] of [['front', susp.front], ['rear', susp.rear]]) {
      const t = tireData(state.suspension[k], state);
      const wc = A.pose0?.pts.WC;
      if (!wc) continue;
      for (const s of [1, -1]) {
        box.expandByPoint(new THREE.Vector3(wc.x + t.diameter / 2, s * (wc.y + t.width / 2), wc.z + t.diameter / 2));
        box.expandByPoint(new THREE.Vector3(wc.x - t.diameter / 2, s * (wc.y + t.width / 2), 0));
      }
    }
  }
  if (box.isEmpty()) return null;
  const size = box.getSize(new THREE.Vector3());
  return { box, length: size.x, width: size.y, height: size.z };
}

export function analyze(store) {
  if (cache.rev === store.rev && cache.A) return cache.A;
  const state = store.state;
  const A = {};
  A.segs = chassisSegments(state);
  A.hull = frameHull(state);
  A.chassis = chassisStats(state);
  try { A.susp = analyzeSuspension(state); } catch (e) { console.error(e); A.susp = null; }
  A.parts = {};
  for (const part of Object.values(state.parts)) {
    const def = getDef(part.def, state);
    if (!def) continue;
    const m = partMatrix(part);
    const box = localBounds(part, def);
    A.parts[part.id] = {
      def, matrix: m, obb: obbFrom(box, m), ports: portsWorld(part, def), env: envelopeOf(part, def),
      center: box.getCenter(new THREE.Vector3()).applyMatrix4(m),
      pieces: () => localPieces(part, def).map((b) => obbFrom(b, m)),
    };
  }
  A.pt = analyzePowertrain(state, A.susp);
  A.ergo = analyzeErgonomics(state, A.segs, A.hull);
  // every driver on the roster, for the design checks and the fit table
  A.ergoAll = (state.ergonomics?.drivers || []).map((d) => (d.id === A.ergo.driver.id ? A.ergo : analyzeErgonomics(state, A.segs, A.hull, d)));
  if (!A.ergoAll.length) A.ergoAll = [A.ergo];
  A.routes = analyzeRouting(state, A.segs, A.susp, A.pt);
  A.mass = analyzeMass(state, A);
  A.dims = overallDims(state, A.susp);
  cache = { rev: store.rev, A };
  return A;
}
