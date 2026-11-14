// Automatic brake-line and throttle-cable routing.
//
// Lines follow the frame (they clip to tubes), so routing is a shortest-path
// problem on the chassis graph. Edge cost = tube length × penalties:
//   • heat: tubes within 6 in of the exhaust cost 6× (keeps lines off the muffler)
//   • height: high tubes cost more (keeps lines low and short to service)
// Split brake circuits pick the tee location that minimizes total line length
// (a 3-terminal Steiner point on the graph). Across the moving suspension the
// line becomes a flex hose that follows the control arm to the caliper.
import * as THREE from 'three';
import { V, segPoint, segSegDist, angleDeg } from '../core/geom.js';
import { getDef, paramsOf, portsWorld } from '../catalog/index.js';
import { typeOf, rotorData } from './suspension.js';
import { HUB_CV_OFFSET } from './powertrain.js';

class Graph {
  constructor() { this.pos = new Map(); this.adj = new Map(); }
  addNode(id, p) { this.pos.set(id, p); if (!this.adj.has(id)) this.adj.set(id, []); }
  addEdge(a, b, w) { this.adj.get(a).push({ to: b, w }); this.adj.get(b).push({ to: a, w }); }
  clone() {
    const g = new Graph();
    for (const [k, v] of this.pos) g.pos.set(k, v);
    for (const [k, v] of this.adj) g.adj.set(k, v.slice());
    return g;
  }
}

function dijkstra(g, src) {
  const dist = new Map([[src, 0]]), prev = new Map(), done = new Set();
  const queue = [src];
  while (queue.length) {
    let bi = 0;
    for (let i = 1; i < queue.length; i++) if (dist.get(queue[i]) < dist.get(queue[bi])) bi = i;
    const u = queue.splice(bi, 1)[0];
    if (done.has(u)) continue;
    done.add(u);
    for (const { to, w } of g.adj.get(u) || []) {
      const nd = dist.get(u) + w;
      if (nd < (dist.get(to) ?? Infinity)) { dist.set(to, nd); prev.set(to, u); queue.push(to); }
    }
  }
  return { dist, prev };
}

function pathTo(prev, src, dst) {
  const out = [dst];
  let c = dst;
  while (c !== src) { c = prev.get(c); if (c == null) return null; out.push(c); }
  return out.reverse();
}

function buildGraph(state, segs, exhaust) {
  const g = new Graph();
  const cost = new Map();
  for (const [id, n] of Object.entries(state.chassis.nodes)) g.addNode(id, V(n.p));
  for (const s of segs) {
    const m = state.chassis.members[s.id];
    const len = s.a.distanceTo(s.b);
    let k = 1 + Math.max(0, (s.a.z + s.b.z) / 2 - 28) / 12;
    if (exhaust && segPoint(exhaust, s.a, s.b).dist < 6) k *= 6;
    cost.set(s.id, k);
    g.addEdge(m.a, m.b, len * k);
  }
  return { g, cost };
}

/** Connect an off-graph point to the nearest tube with a virtual node. */
function attach(G, segs, cost, state, p, tag) {
  let best = null;
  for (const s of segs) {
    const r = segPoint(p, s.a, s.b);
    if (!best || r.dist < best.r.dist) best = { s, r };
  }
  if (!best) return null;
  const m = state.chassis.members[best.s.id];
  const k = cost.get(best.s.id) || 1;
  const vid = `@${tag}`;
  G.addNode(vid, best.r.point);
  const la = best.r.point.distanceTo(best.s.a), lb = best.r.point.distanceTo(best.s.b);
  G.addEdge(vid, m.a, la * k);
  G.addEdge(vid, m.b, lb * k);
  return { vid, point: best.r.point, stub: best.r.dist, member: best.s.id };
}

function polyLength(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += pts[i].distanceTo(pts[i - 1]); return L; }

function bends(pts) {
  let count = 0, total = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i].clone().sub(pts[i - 1]), b = pts[i + 1].clone().sub(pts[i]);
    if (a.lengthSq() < 1e-6 || b.lengthSq() < 1e-6) continue;
    const t = angleDeg(a, b);
    if (t > 15) { count++; total += t; }
  }
  return { count, total };
}

/** Offset path points off the tube surface so lines are visible beside the frame. */
function offsetPath(pts, amount) {
  return pts.map((p) => {
    const dir = Math.abs(p.y) > 1 ? new THREE.Vector3(0, -Math.sign(p.y) * 0.75, 0.66) : new THREE.Vector3(0, 0, 1);
    return p.clone().addScaledVector(dir.normalize(), amount);
  });
}

/** Cables are clamped along the frame but cut across corners between clamps:
 * drop a vertex when the shortcut stays within `tol` of the frame path. */
function stringPull(pts, tol) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    for (; j > i + 1; j--) {
      let ok = true;
      for (let k = i + 1; k < j && ok; k++) if (segPoint(pts[k], pts[i], pts[j]).dist > tol) ok = false;
      if (ok) break;
    }
    out.push(pts[j]);
    i = j;
  }
  return out;
}

function dedupe(pts) {
  const out = [];
  for (const p of pts) if (!out.length || out.at(-1).distanceTo(p) > 0.05) out.push(p);
  return out;
}

/** Caliper locations (world) for each corner, given the static suspension poses. */
export function caliperPoints(state, susp, ptAnalysis) {
  const out = {};
  for (const [axleKey, A] of [['front', susp.front], ['rear', susp.rear]]) {
    const axle = state.suspension[axleKey];
    const rot = rotorData(axle, state);
    const r = rot.diameter / 2 - 0.7;
    const pose = A.pose0;
    if (!pose) continue;
    for (const side of ['L', 'R']) {
      const s = side === 'L' ? 1 : -1;
      const wc = pose.pts.WC.clone(); wc.y *= s;
      const a = pose.axis.clone(); a.y *= s;
      const center = wc.clone().addScaledVector(a, -(HUB_CV_OFFSET - 0.8));
      const dir = new THREE.Vector3(axleKey === 'front' ? -0.7 : 0.7, 0, 0.7).normalize();
      out[`${axleKey}${side}`] = { rotor: center, caliper: center.clone().addScaledVector(dir, r), axis: a };
    }
    if (axleKey === 'rear' && axle.brakeMode === 'inboard' && ptAnalysis?.gbPorts?.brake) {
      const c = ptAnalysis.gbPorts.brake;
      const inb = { rotor: c.clone(), caliper: c.clone().add(new THREE.Vector3(0.7, 0, 0.7).normalize().multiplyScalar(r)), axis: new THREE.Vector3(0, -1, 0) };
      out.rearInboard = inb;
    }
  }
  return out;
}

function hoseExit(state, axleKey, side, susp) {
  const axle = state.suspension[axleKey];
  const T = typeOf(axle);
  const s = side === 'L' ? 1 : -1;
  const P = axle.points;
  const pts = T.hoseExit.map((k) => V(P[k]));
  const exit = pts.reduce((acc, p) => acc.add(p), new THREE.Vector3()).multiplyScalar(1 / pts.length);
  const via = susp[axleKey].pose0?.pts?.[T.hoseVia]?.clone() || V(P[T.hoseVia]);
  exit.y *= s; via.y *= s;
  return { exit, via };
}

export function analyzeRouting(state, segs, susp, pt) {
  const res = { routes: [], calipers: {} };
  if (!susp) return res;
  const exhaust = pt?.enginePorts?.exhaust || null;
  const { g: base, cost } = buildGraph(state, segs, state.routing?.avoidHeat !== false ? exhaust : null);
  const brake = Object.values(state.parts).find((p) => getDef(p.def, state)?.role === 'brakePedal');
  const throttle = Object.values(state.parts).find((p) => getDef(p.def, state)?.role === 'throttlePedal');
  const cal = caliperPoints(state, susp, pt);
  res.calipers = cal;
  const hasFrame = segs.length > 0;

  const splitCircuit = (id, label, src, axleKey) => {
    const G = base.clone();
    const S = attach(G, segs, cost, state, src, 'S');
    const legs = ['L', 'R'].map((side) => ({ side, ...hoseExit(state, axleKey, side, susp), cal: cal[`${axleKey}${side}`] }));
    const ends = legs.map((l) => attach(G, segs, cost, state, l.exit, `E${l.side}`));
    if (!S || ends.some((e) => !e)) return null;
    const dS = dijkstra(G, S.vid), dL = dijkstra(G, ends[0].vid), dR = dijkstra(G, ends[1].vid);
    let tee = null, best = Infinity;
    for (const n of G.pos.keys()) {
      const c = (dS.dist.get(n) ?? Infinity) + (dL.dist.get(n) ?? Infinity) + (dR.dist.get(n) ?? Infinity);
      if (c < best) { best = c; tee = n; }
    }
    if (!tee || !Number.isFinite(best)) return null;
    const trunkIds = pathTo(dS.prev, S.vid, tee);
    const trunk = dedupe([src, ...trunkIds.map((n) => G.pos.get(n))]);
    const segments = [{ type: 'hard', pts: offsetPath(trunk, 0.95) }];
    let hard = polyLength(trunk), flex = 0;
    for (let i = 0; i < 2; i++) {
      const ids = pathTo(i === 0 ? dL.prev : dR.prev, ends[i].vid, tee).reverse();
      const branch = dedupe([...ids.map((n) => G.pos.get(n)), legs[i].exit]);
      segments.push({ type: 'hard', pts: offsetPath(branch, 0.95) });
      hard += polyLength(branch);
      const hose = dedupe([legs[i].exit, legs[i].exit.clone().lerp(legs[i].via, 0.7), legs[i].cal.caliper]);
      segments.push({ type: 'flex', pts: hose });
      flex += polyLength(hose) * 1.2;
    }
    return { id, label, kind: 'brake', segments, hard, flex, total: hard + flex, tees: 1, tee: G.pos.get(tee), ok: true };
  };

  const singleRoute = (id, label, kind, src, dst, flexPts) => {
    const G = base.clone();
    const S = attach(G, segs, cost, state, src, 'S');
    const E = attach(G, segs, cost, state, dst, 'E');
    if (!S || !E) return null;
    const d = dijkstra(G, S.vid);
    const ids = pathTo(d.prev, S.vid, E.vid);
    if (!ids) return null;
    let path = dedupe([src, ...ids.map((n) => G.pos.get(n)), dst]);
    if (kind === 'throttle') path = stringPull(path, 3.0);
    const segments = [{ type: kind === 'throttle' ? 'cable' : 'hard', pts: offsetPath(path, kind === 'throttle' ? 1.35 : 1.15) }];
    let flex = 0;
    if (flexPts) { segments.push({ type: 'flex', pts: flexPts }); flex = polyLength(flexPts) * 1.2; }
    const len = polyLength(path);
    return { id, label, kind, segments, hard: kind === 'throttle' ? 0 : len, flex, cable: kind === 'throttle' ? len : 0, total: len + flex, bends: bends(path), tees: 0, ok: true };
  };

  if (brake && hasFrame) {
    const ports = portsWorld(brake, getDef(brake.def, state));
    const front = splitCircuit('brakeF', 'Front brake circuit', ports.mcF, 'front');
    if (front) res.routes.push(front);
    else res.routes.push({ id: 'brakeF', label: 'Front brake circuit', kind: 'brake', ok: false, segments: [] });
    const rear = state.suspension.rear;
    if (rear.brakeMode === 'inboard' && cal.rearInboard) {
      const c = cal.rearInboard.caliper;
      const r = singleRoute('brakeR', 'Rear brake circuit (inboard)', 'brake', ports.mcR, c.clone().add(new THREE.Vector3(0, 0, 1.5)), null);
      if (r) res.routes.push(r);
    } else {
      const r = splitCircuit('brakeR', 'Rear brake circuit', ports.mcR, 'rear');
      if (r) res.routes.push(r);
      else res.routes.push({ id: 'brakeR', label: 'Rear brake circuit', kind: 'brake', ok: false, segments: [] });
    }
  }
  if (throttle && pt?.enginePorts?.throttle && hasFrame) {
    const src = portsWorld(throttle, getDef(throttle.def, state)).cable;
    const r = singleRoute('throttle', 'Throttle cable', 'throttle', src, pt.enginePorts.throttle, null);
    if (r) res.routes.push(r);
    else res.routes.push({ id: 'throttle', label: 'Throttle cable', kind: 'throttle', ok: false, segments: [] });
  }
  return res;
}

export { segSegDist, paramsOf };
