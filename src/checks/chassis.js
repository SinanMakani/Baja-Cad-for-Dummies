import { registerCheck, plural } from './index.js';
import { primaryEquivalency, secondaryOk, roleInfo, MIN_PRIMARY_WALL } from '../catalog/materials.js';
import { jointInfo, membersAt, components, memberInfo } from '../systems/chassis.js';
import { V, segPoint, segSegDist } from '../core/geom.js';
import { fmtLen, fmtAngle } from '../core/units.js';

const C = 'chassis';

registerCheck({
  id: 'chassis.primary', category: C, label: 'Primary member equivalency',
  run(st) {
    const byProfile = {};
    for (const [id, m] of Object.entries(st.chassis.members)) {
      if (!roleInfo(m.role).primary) continue;
      (byProfile[m.profile] ??= []).push(id);
    }
    const out = [];
    for (const [pid, ids] of Object.entries(byProfile)) {
      const prof = st.chassis.profiles[pid];
      if (!prof) continue;
      const eq = primaryEquivalency(prof);
      if (eq.ok) continue;
      const why = [];
      if (!eq.steel) why.push('material is not steel');
      if (!eq.stiffOk) why.push(`bending stiffness is ${(eq.stiffRatio * 100).toFixed(0)}% of the baseline`);
      if (!eq.strengthOk) why.push(`bending strength is ${(eq.strengthRatio * 100).toFixed(0)}% of the baseline`);
      if (!eq.wallOk) why.push(`wall is under ${MIN_PRIMARY_WALL} in`);
      const roles = [...new Set(ids.map((i) => st.chassis.members[i].role))].join(', ');
      out.push({
        severity: 'error',
        title: `${prof.name} is too light for primary members`,
        detail: `${plural(ids.length, 'primary member')} (${roles}) use this tube, but its ${why.join(' and ')}. Primary members must match a 1.000 × 0.120 in 1018 steel tube in bending stiffness and strength (check the current rulebook).`,
        targets: ids.map((id) => ({ kind: 'member', id })),
      });
    }
    return out;
  },
});

registerCheck({
  id: 'chassis.secondary', category: C, label: 'Secondary member minimums',
  run(st) {
    const byProfile = {};
    for (const [id, m] of Object.entries(st.chassis.members)) {
      if (roleInfo(m.role).primary) continue;
      const prof = st.chassis.profiles[m.profile];
      if (prof && !secondaryOk(prof)) (byProfile[m.profile] ??= []).push(id);
    }
    return Object.entries(byProfile).map(([pid, ids]) => ({
      severity: 'warning',
      title: `${st.chassis.profiles[pid].name} is below secondary-member minimums`,
      detail: `${plural(ids.length, 'member')} use it. Structural secondary members are typically at least 1.000 in OD × 0.035 in wall steel — confirm in the current rulebook, or tag non-structural tubes accordingly.`,
      targets: ids.map((id) => ({ kind: 'member', id })),
    }));
  },
});

registerCheck({
  id: 'chassis.dangling', category: C, label: 'Dangling / loose nodes',
  run(st) {
    const dangling = [], isolated = [];
    for (const id of Object.keys(st.chassis.nodes)) {
      const n = membersAt(st, id).length;
      if (n === 1) dangling.push(id);
      if (n === 0) isolated.push(id);
    }
    const out = [];
    if (dangling.length) out.push({
      severity: 'warning', title: `${plural(dangling.length, 'tube end')} not tied into the frame`,
      detail: `Nodes ${dangling.slice(0, 8).join(', ')}${dangling.length > 8 ? '…' : ''} have only one tube. Connect them or they carry no load.`,
      targets: dangling.map((id) => ({ kind: 'node', id })),
    });
    if (isolated.length) out.push({
      severity: 'info', title: `${plural(isolated.length, 'loose node')} with no tubes`,
      detail: 'Delete them or draw tubes to them.', targets: isolated.map((id) => ({ kind: 'node', id })),
      fix: { label: 'Delete loose nodes', apply: (s) => { for (const id of isolated) delete s.chassis.nodes[id]; } },
    });
    return out;
  },
});

registerCheck({
  id: 'chassis.short', category: C, label: 'Very short tubes',
  run(st) {
    const out = [];
    for (const id of Object.keys(st.chassis.members)) {
      const info = memberInfo(st, id);
      if (info.length < 1.0) out.push({ severity: 'warning', title: `Tube ${id} is only ${fmtLen(info.length)} long`, detail: 'Tubes this short are hard to cope and weld. Merge the nodes or use a plate/gusset.', targets: [{ kind: 'member', id }] });
    }
    return out;
  },
});

registerCheck({
  id: 'chassis.sharpjoint', category: C, label: 'Sharp joint angles',
  run(st) {
    const out = [];
    for (const id of Object.keys(st.chassis.nodes)) {
      const j = jointInfo(st, id);
      const sharp = j.pairs.filter((p) => p.angle < 20);
      if (sharp.length) out.push({
        severity: 'warning', title: `Sharp joint at ${id}`,
        detail: `${sharp.map((p) => `${p.m1}–${p.m2} ${fmtAngle(p.angle)}`).join(', ')}. Joints under ~20° are hard to cope and weld fully.`,
        targets: [{ kind: 'node', id }],
      });
    }
    return out;
  },
});

registerCheck({
  id: 'chassis.nearmiss', category: C, label: 'Missed connections and crossing tubes',
  run(st, A) {
    const out = [];
    const segs = A.segs;
    for (const [nid, n] of Object.entries(st.chassis.nodes)) {
      const p = V(n.p);
      for (const s of segs) {
        const m = st.chassis.members[s.id];
        if (m.a === nid || m.b === nid) continue;
        const r = segPoint(p, s.a, s.b);
        if (r.t > 0.02 && r.t < 0.98 && r.dist < s.r + 0.4) {
          out.push({ severity: 'warning', title: `Node ${nid} touches tube ${s.id} without a joint`, detail: `It is ${fmtLen(r.dist)} from the tube axis. Split ${s.id} at the node (Chassis ▸ Split) or move the node so the joint is intentional.`, targets: [{ kind: 'node', id: nid }, { kind: 'member', id: s.id }] });
        }
      }
    }
    for (let i = 0; i < segs.length; i++) {
      for (let k = i + 1; k < segs.length; k++) {
        const a = st.chassis.members[segs[i].id], b = st.chassis.members[segs[k].id];
        if (a.a === b.a || a.a === b.b || a.b === b.a || a.b === b.b) continue;
        const d = segSegDist(segs[i].a, segs[i].b, segs[k].a, segs[k].b);
        if (d < (segs[i].r + segs[k].r) * 0.9) {
          out.push({ severity: 'warning', title: `Tubes ${segs[i].id} and ${segs[k].id} cross without a joint`, detail: `Their centerlines pass ${fmtLen(d)} apart. Add a shared node or re-route one tube.`, targets: [{ kind: 'member', id: segs[i].id }, { kind: 'member', id: segs[k].id }] });
        }
      }
    }
    return out.slice(0, 30);
  },
});

registerCheck({
  id: 'chassis.connected', category: C, label: 'Frame is one piece',
  run(st) {
    const comps = components(st);
    if (comps.length <= 1) return [];
    const loose = comps.slice(1).flat();
    return [{ severity: 'warning', title: `Frame has ${comps.length} disconnected sections`, detail: `${plural(loose.length, 'node')} are not connected to the main frame.`, targets: loose.map((id) => ({ kind: 'node', id })) }];
  },
});

registerCheck({
  id: 'chassis.roles', category: C, label: 'Required frame members tagged',
  run(st) {
    if (!Object.keys(st.chassis.members).length) return [{ severity: 'info', title: 'No frame yet', detail: 'Use the Chassis tab: load the starter frame or draw tubes node by node.' }];
    const present = new Set(Object.values(st.chassis.members).map((m) => m.role));
    const need = ['RRH', 'RHO', 'FBM', 'LFS', 'SIM', 'LC'];
    const missing = need.filter((r) => !present.has(r));
    if (!missing.length) return [];
    return [{ severity: 'warning', title: `No members tagged ${missing.join(', ')}`, detail: `Tag frame members with their role (${missing.map((r) => roleInfo(r).label).join(', ')}) so primary-member checks apply. Select a tube and set its role in the inspector.` }];
  },
});

registerCheck({
  id: 'chassis.symmetry', category: C, label: 'Symmetry',
  run(st) {
    const lone = Object.entries(st.chassis.members).filter(([, m]) => {
      if (m.pair) return false;
      const a = st.chassis.nodes[m.a].p, b = st.chassis.nodes[m.b].p;
      const centered = Math.abs(a[1]) < 0.01 && Math.abs(b[1]) < 0.01;
      const lateral = Math.abs(a[1] + b[1]) < 0.02 && Math.abs(a[0] - b[0]) < 0.02 && Math.abs(a[2] - b[2]) < 0.02;
      return !centered && !lateral;
    }).map(([id]) => id);
    if (!lone.length) return [];
    return [{ severity: 'info', title: `${plural(lone.length, 'tube')} without a mirror twin`, detail: 'Fine for diagonals and deliberate asymmetry. Turn on Mirror in the Chassis tab to draw both sides at once.', targets: lone.map((id) => ({ kind: 'member', id })) }];
  },
});
