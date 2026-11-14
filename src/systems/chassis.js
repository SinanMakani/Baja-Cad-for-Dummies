// Chassis model: nodes (tube intersections) and members (straight tube
// segments between two nodes). Bent tubes are chains of members that share a
// profile; the bend angle at each shared node is reported for fabrication.
import * as THREE from 'three';
import { nextId } from '../core/store.js';
import { V, arr, angleDeg, azEl, fromAzEl, mirrorY, roundArr, rotateAbout, perpendicular, segPoint } from '../core/geom.js';
import { profileProps, roleInfo } from '../catalog/materials.js';

const CENTER_TOL = 0.01;
const SAME_TOL = 0.02;

export const onCenterline = (p) => Math.abs(p[1]) < CENTER_TOL;

export function findNodeAt(st, p, tol = SAME_TOL) {
  for (const [id, n] of Object.entries(st.chassis.nodes)) {
    if (Math.abs(n.p[0] - p[0]) < tol && Math.abs(n.p[1] - p[1]) < tol && Math.abs(n.p[2] - p[2]) < tol) return id;
  }
  return null;
}

function linkPair(st, a, b) {
  st.chassis.nodes[a].pair = b;
  st.chassis.nodes[b].pair = a;
}

/** Mirror partner of a node, creating one if needed (only in mirror mode). */
export function ensureMirrorNode(st, id) {
  const n = st.chassis.nodes[id];
  if (!n || onCenterline(n.p)) return id;
  if (n.pair && st.chassis.nodes[n.pair]) return n.pair;
  const mp = mirrorY(n.p);
  let mid = findNodeAt(st, mp);
  if (!mid) {
    mid = nextId(st, 'N');
    st.chassis.nodes[mid] = { p: roundArr(mp) };
  }
  linkPair(st, id, mid);
  return mid;
}

export function addNode(st, p, { mirror = false } = {}) {
  const existing = findNodeAt(st, p);
  const id = existing || nextId(st, 'N');
  if (!existing) st.chassis.nodes[id] = { p: roundArr(p) };
  if (mirror) ensureMirrorNode(st, id);
  return id;
}

export function findMember(st, a, b) {
  for (const [id, m] of Object.entries(st.chassis.members)) {
    if ((m.a === a && m.b === b) || (m.a === b && m.b === a)) return id;
  }
  return null;
}

export function addMember(st, a, b, { profile, role = 'SEC', mirror = false } = {}) {
  if (a === b) return null;
  let id = findMember(st, a, b);
  if (!id) {
    id = nextId(st, 'T');
    st.chassis.members[id] = { a, b, profile: profile || st.chassis.defaultProfile, role };
  }
  if (mirror) {
    const ma = ensureMirrorNode(st, a);
    const mb = ensureMirrorNode(st, b);
    const same = (ma === a && mb === b) || (ma === b && mb === a);
    if (!same) {
      let mid = findMember(st, ma, mb);
      if (!mid) {
        mid = nextId(st, 'T');
        st.chassis.members[mid] = { a: ma, b: mb, profile: st.chassis.members[id].profile, role: st.chassis.members[id].role };
      }
      st.chassis.members[id].pair = mid;
      st.chassis.members[mid].pair = id;
    }
  }
  return id;
}

export function membersAt(st, nodeId) {
  return Object.entries(st.chassis.members).filter(([, m]) => m.a === nodeId || m.b === nodeId).map(([id]) => id);
}

export function deleteMember(st, id, { mirror = false } = {}) {
  const m = st.chassis.members[id];
  if (!m) return;
  delete st.chassis.members[id];
  if (m.pair && st.chassis.members[m.pair]) {
    if (mirror) delete st.chassis.members[m.pair];
    else delete st.chassis.members[m.pair].pair;
  }
}

export function deleteNode(st, id, { mirror = false } = {}) {
  const n = st.chassis.nodes[id];
  if (!n) return;
  for (const mid of membersAt(st, id)) deleteMember(st, mid, { mirror });
  delete st.chassis.nodes[id];
  if (n.pair && st.chassis.nodes[n.pair]) {
    if (mirror) deleteNode(st, n.pair, { mirror: false });
    else delete st.chassis.nodes[n.pair].pair;
  }
}

/** Remove nodes with no members attached. */
export function pruneOrphans(st) {
  const used = new Set();
  for (const m of Object.values(st.chassis.members)) { used.add(m.a); used.add(m.b); }
  for (const id of Object.keys(st.chassis.nodes)) if (!used.has(id)) deleteNode(st, id);
}

export function moveNode(st, id, p, { mirror = false } = {}) {
  const n = st.chassis.nodes[id];
  if (!n) return;
  n.p = roundArr(p);
  if (mirror && n.pair && st.chassis.nodes[n.pair]) st.chassis.nodes[n.pair].p = roundArr(mirrorY(p));
}

export function splitMember(st, id, t, { mirror = false } = {}) {
  const m = st.chassis.members[id];
  if (!m) return null;
  const A = V(st.chassis.nodes[m.a].p), B = V(st.chassis.nodes[m.b].p);
  const p = arr(A.clone().lerp(B, t));
  const nid = addNode(st, p);
  const { a, b, profile, role, pair } = m;
  delete st.chassis.members[id];
  addMember(st, a, nid, { profile, role });
  addMember(st, nid, b, { profile, role });
  if (mirror && pair && st.chassis.members[pair]) {
    const pm = st.chassis.members[pair];
    const pa = st.chassis.nodes[pm.a].p;
    const tt = Math.abs(pa[0] - A.x) < 1e-6 && Math.abs(pa[2] - A.z) < 1e-6 ? t : 1 - t;
    delete st.chassis.members[pair].pair;
    const mnid = splitMember(st, pair, tt, { mirror: false });
    if (mnid) linkPair(st, nid, mnid);
    // re-link member pairs (a centerline node is its own mirror)
    const mirrorOf = (x) => st.chassis.nodes[x]?.pair || x;
    for (const x of [a, b]) {
      const m1 = findMember(st, x, nid), m2 = mnid && findMember(st, mirrorOf(x), mnid);
      if (m1 && m2 && m1 !== m2) { st.chassis.members[m1].pair = m2; st.chassis.members[m2].pair = m1; }
    }
  }
  return nid;
}

export function memberVec(st, id) {
  const m = st.chassis.members[id];
  return V(st.chassis.nodes[m.b].p).sub(V(st.chassis.nodes[m.a].p));
}

export function memberInfo(st, id) {
  const m = st.chassis.members[id];
  if (!m) return null;
  const A = V(st.chassis.nodes[m.a].p), B = V(st.chassis.nodes[m.b].p);
  const d = B.clone().sub(A);
  const length = d.length();
  const profile = st.chassis.profiles[m.profile] || Object.values(st.chassis.profiles)[0];
  const props = profileProps(profile);
  const { az, el } = azEl(d);
  const proj = (u, v) => Math.atan2(v, u) * 180 / Math.PI;
  return {
    id, m, A, B, dir: d.clone().normalize(), length, az, el,
    sideAngle: proj(d.x, d.z), // side view (XZ), from +X toward +Z
    topAngle: proj(d.x, d.y), // top view (XY), from +X toward +Y
    frontAngle: proj(d.y, d.z), // front view (YZ), from +Y toward +Z
    profile, props, role: roleInfo(m.role),
    weight: props.linearWeight * length,
  };
}

/** Directions of all members leaving a node and the included angles between each pair. */
export function jointInfo(st, nodeId) {
  const n = st.chassis.nodes[nodeId];
  if (!n) return null;
  const P = V(n.p);
  const members = membersAt(st, nodeId).map((id) => {
    const m = st.chassis.members[id];
    const other = m.a === nodeId ? m.b : m.a;
    const dir = V(st.chassis.nodes[other].p).sub(P);
    return { id, other, dir: dir.clone().normalize(), length: dir.length(), profile: m.profile, role: m.role };
  });
  const pairs = [];
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const angle = angleDeg(members[i].dir, members[j].dir);
      pairs.push({ m1: members[i].id, m2: members[j].id, angle, bend: 180 - angle });
    }
  }
  return { id: nodeId, p: n.p, members, pairs, pair: n.pair };
}

/** Change a member's length by moving its free end along the tube axis. */
export function setMemberLength(st, id, L, anchor = 'a', opts = {}) {
  const m = st.chassis.members[id];
  const fixed = anchor === 'a' ? m.a : m.b, free = anchor === 'a' ? m.b : m.a;
  const F = V(st.chassis.nodes[fixed].p);
  const d = V(st.chassis.nodes[free].p).sub(F).normalize();
  moveNode(st, free, arr(F.addScaledVector(d, L)), opts);
}

/** Point a member in an exact direction (azimuth/elevation) from its anchor end. */
export function setMemberDirection(st, id, az, el, anchor = 'a', opts = {}) {
  const m = st.chassis.members[id];
  const fixed = anchor === 'a' ? m.a : m.b, free = anchor === 'a' ? m.b : m.a;
  const F = V(st.chassis.nodes[fixed].p);
  const L = V(st.chassis.nodes[free].p).distanceTo(F);
  moveNode(st, free, arr(F.addScaledVector(fromAzEl(az, el), L)), opts);
}

/** Rotate `movingId` about the joint so the included angle with `fixedId` equals `target` degrees. */
export function setJointAngle(st, nodeId, fixedId, movingId, target, opts = {}) {
  const P = V(st.chassis.nodes[nodeId].p);
  const other = (mid) => { const m = st.chassis.members[mid]; return m.a === nodeId ? m.b : m.a; };
  const fo = other(fixedId), mo = other(movingId);
  const u = V(st.chassis.nodes[fo].p).sub(P).normalize();
  const vEnd = V(st.chassis.nodes[mo].p);
  const v = vEnd.clone().sub(P).normalize();
  let axis = new THREE.Vector3().crossVectors(u, v);
  if (axis.lengthSq() < 1e-10) axis = perpendicular(u);
  axis.normalize();
  const current = angleDeg(u, v);
  const np = rotateAbout(vEnd, P, axis, target - current);
  moveNode(st, mo, arr(np), opts);
}

export function chassisSegments(st) {
  const out = [];
  for (const [id, m] of Object.entries(st.chassis.members)) {
    const na = st.chassis.nodes[m.a], nb = st.chassis.nodes[m.b];
    if (!na || !nb) continue;
    const prof = st.chassis.profiles[m.profile];
    out.push({ id, a: V(na.p), b: V(nb.p), r: (prof?.od || 1) / 2, role: m.role });
  }
  return out;
}

/** Nearest chassis member to point p → {id, dist (to surface), point, t}. */
export function nearestMember(segs, p) {
  let best = null;
  for (const s of segs) {
    const r = segPoint(p, s.a, s.b);
    const d = r.dist - s.r;
    if (!best || d < best.dist) best = { id: s.id, dist: d, point: r.point, t: r.t, seg: s };
  }
  return best;
}

export function components(st) {
  const adj = new Map(Object.keys(st.chassis.nodes).map((id) => [id, []]));
  for (const m of Object.values(st.chassis.members)) {
    adj.get(m.a)?.push(m.b);
    adj.get(m.b)?.push(m.a);
  }
  const seen = new Set(), comps = [];
  for (const id of adj.keys()) {
    if (seen.has(id) || adj.get(id).length === 0) continue;
    const comp = [], stack = [id];
    seen.add(id);
    while (stack.length) {
      const n = stack.pop();
      comp.push(n);
      for (const k of adj.get(n)) if (!seen.has(k)) { seen.add(k); stack.push(k); }
    }
    comps.push(comp);
  }
  return comps.sort((a, b) => b.length - a.length);
}

export function chassisStats(st) {
  const byProfile = {};
  let totalLength = 0, weight = 0;
  for (const id of Object.keys(st.chassis.members)) {
    const info = memberInfo(st, id);
    totalLength += info.length;
    weight += info.weight;
    const k = info.m.profile;
    byProfile[k] ??= { count: 0, length: 0, weight: 0, profile: info.profile };
    byProfile[k].count++;
    byProfile[k].length += info.length;
    byProfile[k].weight += info.weight;
  }
  return { members: Object.keys(st.chassis.members).length, nodes: Object.keys(st.chassis.nodes).length, totalLength, weight, byProfile };
}

/** Cut list rows with coping angles at each end (angle to every tube joined there). */
export function cutList(st) {
  return Object.keys(st.chassis.members).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).map((id) => {
    const info = memberInfo(st, id);
    const endAngles = (nodeId) => {
      const j = jointInfo(st, nodeId);
      return j.pairs.filter((p) => p.m1 === id || p.m2 === id).map((p) => {
        const other = p.m1 === id ? p.m2 : p.m1;
        return `${other}@${p.angle.toFixed(1)}°`;
      }).join(' ');
    };
    return {
      id, role: info.m.role, profile: info.profile.name, material: info.profile.material,
      od: info.profile.od, wall: info.profile.wall, length: info.length, weight: info.weight,
      nodeA: info.m.a, nodeB: info.m.b, anglesA: endAngles(info.m.a), anglesB: endAngles(info.m.b),
    };
  });
}
