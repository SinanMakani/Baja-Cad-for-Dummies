// Editing commands shared by panels, the inspector, shortcuts and drag-and-drop.
import * as THREE from 'three';
import { nextId } from './store.js';
import { getDef, paramsOf, localBounds, partMatrix, weightOf, specsOf, CATEGORIES } from '../catalog/index.js';
import { SLOT_LABELS } from '../catalog/dynamics.js';
import { deleteMember, deleteNode, pruneOrphans, cutList, chassisStats } from '../systems/chassis.js';
import { setTire } from '../systems/suspension.js';
import { gateLocked } from '../systems/stresstest.js';
import { V, mirrorY } from './geom.js';
import { fmtLen } from './units.js';

export function partName(part, state) { return part.name || getDef(part.def, state)?.name || part.def; }

/** Add a catalog part. Singleton roles (engine, CVT, seat…) swap the existing part instead. */
export function addPart(store, defKey, pos, { rot = [0, 0, 0], params = {}, name } = {}) {
  const def = getDef(defKey, store.state);
  if (!def) return null;
  if (def.slot) return null;
  if (gateLocked(store.state) && def.category !== 'chassis') return { id: null, locked: true };
  let result = { id: null, swapped: false };
  store.commit(`Add ${def.name}`, (st) => {
    if (def.singleton && def.role) {
      const existing = Object.values(st.parts).find((p) => getDef(p.def, st)?.role === def.role);
      if (existing) {
        existing.def = defKey;
        existing.params = { ...params };
        existing.name = name || def.name;
        result = { id: existing.id, swapped: true };
        return;
      }
    }
    const id = nextId(st, 'P');
    st.parts[id] = { id, def: defKey, name: name || def.name, pos: pos.map((v) => +v.toFixed(3)), rot, params: { ...params }, notes: '' };
    result = { id, swapped: false };
  });
  return result;
}

/** Assign a slot part (tire, shock, …) to the front or rear axle. */
export function assignSlot(store, defKey, axleKey) {
  const def = getDef(defKey, store.state);
  if (!def?.slot || gateLocked(store.state)) return false;
  const label = SLOT_LABELS[def.slot];
  store.commit(`${axleKey === 'front' ? 'Front' : 'Rear'} ${label}: ${def.name}`, (st) => {
    if (def.slot === 'rack') st.suspension.steering.rack = defKey;
    else if (def.slot === 'tire') setTire(st, axleKey, defKey);
    else if (def.slot === 'shock') { st.suspension[axleKey].shock = defKey; st.suspension[axleKey].shockSpec = null; }
    else st.suspension[axleKey][def.slot] = defKey;
  });
  return true;
}

export function deleteSelection(store) {
  const sel = store.ui.selection;
  if (!sel) return false;
  const mirror = store.ui.mirror;
  if (sel.kind === 'part') {
    const p = store.state.parts[sel.id];
    if (!p) return false;
    store.commit(`Delete ${partName(p, store.state)}`, (st) => { delete st.parts[sel.id]; });
  } else if (sel.kind === 'member') {
    const ids = sel.ids || [sel.id];
    store.commit(`Delete ${ids.length > 1 ? `${ids.length} tubes` : `tube ${sel.id}`}`, (st) => {
      for (const id of ids) deleteMember(st, id, { mirror });
      pruneOrphans(st);
    });
  } else if (sel.kind === 'node') {
    store.commit(`Delete node ${sel.id}`, (st) => { deleteNode(st, sel.id, { mirror }); });
  } else return false;
  store.select(null);
  return true;
}

export function duplicatePart(store, id) {
  const p = store.state.parts[id];
  if (!p) return;
  const def = getDef(p.def, store.state);
  if (def?.singleton) return addPart(store, p.def, p.pos, { rot: p.rot, params: p.params, name: p.name });
  let nid;
  store.commit(`Duplicate ${partName(p, store.state)}`, (st) => {
    nid = nextId(st, 'P');
    st.parts[nid] = { ...structuredClone(p), id: nid, name: `${p.name || def.name} copy`, pos: [p.pos[0] + 4, p.pos[1] + 4, p.pos[2]], linked: undefined };
  });
  store.select({ kind: 'part', id: nid });
}

export function mirrorPart(store, id) {
  const p = store.state.parts[id];
  if (!p) return;
  let nid;
  store.commit(`Mirror ${partName(p, store.state)}`, (st) => {
    nid = nextId(st, 'P');
    st.parts[nid] = { ...structuredClone(p), id: nid, name: `${p.name || getDef(p.def, st).name} (mirrored)`, pos: mirrorY(p.pos), rot: [-p.rot[0], p.rot[1], -p.rot[2]], linked: undefined };
  });
  store.select({ kind: 'part', id: nid });
}

/** Drop a part straight down until it rests on the nearest frame tube below it. */
export function snapPartToFloor(store, id, segs) {
  const p = store.state.parts[id];
  const def = getDef(p.def, store.state);
  const box = localBounds(p, def);
  const m = partMatrix(p);
  const corners = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z).applyMatrix4(m));
  const wb = new THREE.Box3().setFromPoints(corners);
  let best = 0;
  for (const s of segs) {
    const n = Math.max(2, Math.ceil(s.a.distanceTo(s.b) / 0.5));
    for (let i = 0; i <= n; i++) {
      const q = s.a.clone().lerp(s.b, i / n);
      if (q.x < wb.min.x || q.x > wb.max.x || q.y < wb.min.y || q.y > wb.max.y) continue;
      const top = q.z + s.r;
      if (top <= wb.min.z + 0.6 && top > best) best = top;
    }
  }
  const dz = best - wb.min.z;
  store.commit(`Rest ${partName(p, store.state)} on frame`, (st) => { st.parts[id].pos[2] = +(st.parts[id].pos[2] + dz).toFixed(3); });
  return { dz, floor: best };
}

// ---------------------------------------------------------------- exports

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCSV = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\n');

export function cutListCSV(state) {
  const rows = [['Tube', 'Role', 'Profile', 'Material', 'OD (in)', 'Wall (in)', 'Length (in)', 'Length (ft-in)', 'Weight (lb)', 'Node A', 'Joints at A (tube@angle)', 'Node B', 'Joints at B (tube@angle)']];
  for (const r of cutList(state)) {
    const ft = Math.floor(r.length / 12);
    rows.push([r.id, r.role, r.profile, r.material, r.od.toFixed(3), r.wall.toFixed(3), r.length.toFixed(3), `${ft}' ${(r.length - ft * 12).toFixed(3)}"`, r.weight.toFixed(2), r.nodeA, r.anglesA, r.nodeB, r.anglesB]);
  }
  const s = chassisStats(state);
  rows.push([]);
  rows.push(['Totals', '', '', '', '', '', s.totalLength.toFixed(2), `${(s.totalLength / 12).toFixed(2)} ft`, s.weight.toFixed(2)]);
  for (const [, v] of Object.entries(s.byProfile)) rows.push(['', 'Stock', v.profile.name, v.profile.material, v.profile.od, v.profile.wall, v.length.toFixed(2), `${(v.length / 12).toFixed(2)} ft (${v.count} pcs)`, v.weight.toFixed(2)]);
  return toCSV(rows);
}

export function bomCSV(state, A) {
  const rows = [['ID', 'Category', 'Part', 'Catalog item', 'Qty', 'Weight each (lb)', 'X (in)', 'Y (in)', 'Z (in)', 'Specs', 'Notes']];
  for (const p of Object.values(state.parts)) {
    const def = getDef(p.def, state);
    if (!def) continue;
    const specs = specsOf(p, def).map(([k, v]) => `${k}: ${v}`).join('; ');
    rows.push([p.id, CATEGORIES.find((c) => c.key === def.category)?.label, partName(p, state), def.name, 1, weightOf(p, def).toFixed(2), ...p.pos.map((v) => v.toFixed(3)), specs, p.notes || '']);
  }
  const s = state.suspension;
  const slot = (k, qty, where) => { const d = getDef(k, state); if (d) rows.push(['—', 'Dynamics', where, d.name, qty, (d.weight?.() || 0).toFixed(2), '', '', '', specsOf({}, d).map(([a, b]) => `${a}: ${b}`).join('; '), '']); };
  slot(s.front.tire, 2, 'Front tires'); slot(s.rear.tire, 2, 'Rear tires');
  slot(s.front.shock, 2, 'Front shocks'); slot(s.rear.shock, 2, 'Rear shocks');
  slot(s.front.caliper, 2, 'Front calipers'); slot(s.rear.caliper, s.rear.brakeMode === 'inboard' ? 1 : 2, 'Rear calipers');
  slot(s.front.rotor, 2, 'Front rotors'); slot(s.rear.rotor, s.rear.brakeMode === 'inboard' ? 1 : 2, 'Rear rotors');
  slot(s.front.upright, 2, 'Front uprights'); slot(s.rear.upright, 2, 'Rear uprights'); slot(s.steering.rack, 1, 'Steering rack');
  for (const r of A.routes?.routes || []) {
    if (!r.ok) continue;
    if (r.kind === 'brake') rows.push(['—', 'Ergonomics', r.label, '3/16 in hard line + braided flex hose', 1, '', '', '', '', `Hard line ≈ ${r.hard.toFixed(1)} in; flex hose ≈ ${r.flex.toFixed(1)} in; tees: ${r.tees}`, 'Auto-routed']);
    else rows.push(['—', 'Ergonomics', r.label, 'Bowden throttle cable', 1, '', '', '', '', `Length ≈ ${r.cable.toFixed(1)} in; bends: ${r.bends.count} (${r.bends.total.toFixed(0)}° total)`, 'Auto-routed']);
  }
  if (A.chassis) rows.push(['—', 'Chassis', 'Frame tubing', `${A.chassis.members} tubes`, 1, A.chassis.weight.toFixed(2), '', '', '', `${(A.chassis.totalLength / 12).toFixed(1)} ft of tube`, 'See cut list']);
  return toCSV(rows);
}

/** One XYZ point per line: loads into SolidWorks "Curve Through XYZ Points" / 3D sketch tools. */
export function nodesTXT(state) {
  const lines = Object.entries(state.chassis.nodes).map(([id, n]) => `${n.p[0].toFixed(4)}\t${n.p[1].toFixed(4)}\t${n.p[2].toFixed(4)}\t; ${id}`);
  return `; Baja Designer chassis nodes (inches). X fwd, Y left, Z up. Origin: ground, centerline, rear axle.\n${lines.join('\n')}\n`;
}

export function membersCSV(state) {
  const rows = [['Tube', 'X1', 'Y1', 'Z1', 'X2', 'Y2', 'Z2', 'OD', 'Wall', 'Role']];
  for (const [id, m] of Object.entries(state.chassis.members)) {
    const a = state.chassis.nodes[m.a].p, b = state.chassis.nodes[m.b].p, pr = state.chassis.profiles[m.profile];
    rows.push([id, ...a.map((v) => v.toFixed(4)), ...b.map((v) => v.toFixed(4)), pr?.od, pr?.wall, m.role]);
  }
  return toCSV(rows);
}

export function hardpointsCSV(state) {
  const rows = [['Axle', 'Point', 'X (in)', 'Y left (in)', 'Z (in)']];
  for (const k of ['front', 'rear']) for (const [pk, p] of Object.entries(state.suspension[k].points)) rows.push([k, pk, ...p.map((v) => v.toFixed(4))]);
  return toCSV(rows);
}

export { V, fmtLen, paramsOf };
