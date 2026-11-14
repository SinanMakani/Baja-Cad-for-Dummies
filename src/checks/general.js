// Hardware-presence checks and whole-vehicle checks (size, interference).
import { registerCheck } from './index.js';
import { fmtLen } from '../core/units.js';
import { getDef } from '../catalog/index.js';
import { obbOverlap, pointObbDist } from '../core/geom.js';

const rolesOf = (st, role) => Object.values(st.parts).filter((p) => getDef(p.def, st)?.role === role);

registerCheck({
  id: 'hw.required', category: 'hardware', label: 'Required safety hardware',
  run(st, A) {
    const out = [];
    const ks = rolesOf(st, 'killSwitch');
    const loc = new Set(ks.map((p) => p.params?.location || getDef(p.def, st).params.find((x) => x.key === 'location')?.default));
    if (!loc.has('cockpit')) out.push({ severity: 'warning', title: 'No cockpit kill switch', detail: 'Add a kill switch the belted driver can reach (Hardware ▸ Electrical).' });
    if (!loc.has('external')) out.push({ severity: 'warning', title: 'No external kill switch', detail: 'Add a kill switch reachable from outside the car (check the rulebook for its required location).' });
    if (!rolesOf(st, 'brakeLight').length) out.push({ severity: 'warning', title: 'No brake light', detail: 'Add a rear-facing brake light (Hardware ▸ Electrical).' });
    if (!rolesOf(st, 'extinguisher').length) out.push({ severity: 'warning', title: 'No fire extinguisher', detail: 'Add a fire extinguisher with a quick-release mount (check count and rating in the rulebook).' });
    const tows = rolesOf(st, 'towPoint');
    const mid = A.susp ? (A.susp.frontX + A.susp.rearX) / 2 : 30;
    if (!tows.some((p) => p.pos[0] > mid)) out.push({ severity: 'info', title: 'No front tow point', detail: 'Add a tow point at the front of the frame (Chassis ▸ Gussets & tabs).' });
    if (!tows.some((p) => p.pos[0] <= mid)) out.push({ severity: 'info', title: 'No rear tow point', detail: 'Add a tow point at the rear of the frame.' });
    return out;
  },
});

registerCheck({
  id: 'gen.size', category: 'general', label: 'Overall vehicle size',
  run(st, A) {
    const d = A.dims;
    if (!d) return [];
    const out = [];
    if (d.width > 64) out.push({ severity: 'error', title: `Vehicle is ${fmtLen(d.width)} wide`, detail: 'Baja SAE has historically limited width to 64 in with wheels straight at ride height — verify the current limit. Narrow the track or the tires.' });
    if (d.length > 108) out.push({ severity: 'error', title: `Vehicle is ${fmtLen(d.length)} long`, detail: 'Baja SAE has historically limited length to 108 in — verify the current limit.' });
    return out;
  },
});

const SKIP_PAIRS = [['cvt', 'engine'], ['cvt', 'gearbox'], ['harness', 'seat'], ['brakePedal', 'skidPlate'], ['throttlePedal', 'skidPlate'], ['seat', 'skidPlate']];
const MOUNTED_TO_FRAME = new Set(['tab', 'gusset', 'towPoint', 'skidPlate', 'enginePlate', 'bodyPanel', 'firewall', 'killSwitch', 'brakeLight', 'extinguisher', 'transponder', 'harness']);

registerCheck({
  id: 'gen.interference', category: 'general', label: 'Part interference',
  run(st, A) {
    const parts = Object.values(st.parts).filter((p) => !p.hidden && !p.ignoreInterference && A.parts[p.id]);
    const out = [];
    for (let i = 0; i < parts.length; i++) {
      for (let k = i + 1; k < parts.length; k++) {
        const a = parts[i], b = parts[k];
        const ra = A.parts[a.id].def.role, rb = A.parts[b.id].def.role;
        if (SKIP_PAIRS.some(([x, y]) => (x === ra && y === rb) || (x === rb && y === ra))) continue;
        if (obbOverlap(A.parts[a.id].obb, A.parts[b.id].obb) <= 0.15) continue;
        // Coarse boxes overlap — confirm with per-mesh boxes before flagging.
        const pa = A.parts[a.id].pieces(), pb = A.parts[b.id].pieces();
        let pen = 0;
        for (const x of pa) for (const y of pb) pen = Math.max(pen, obbOverlap(x, y));
        if (pen > 0.15) out.push({ severity: 'warning', title: `${a.name || A.parts[a.id].def.name} overlaps ${b.name || A.parts[b.id].def.name}`, detail: `Bounding boxes overlap by about ${fmtLen(pen)}. Move one of them, or mark "Ignore interference" if they are meant to nest.`, targets: [{ kind: 'part', id: a.id }, { kind: 'part', id: b.id }] });
      }
    }
    for (const p of parts) {
      const info = A.parts[p.id];
      if (MOUNTED_TO_FRAME.has(info.def.role)) continue;
      let pieces = null;
      for (const s of A.segs) {
        const n = Math.max(2, Math.ceil(s.a.distanceTo(s.b) / 0.75));
        let hit = false;
        for (let i = 0; i <= n && !hit; i++) {
          const q = s.a.clone().lerp(s.b, i / n);
          if (pointObbDist(q, info.obb) >= s.r - 0.1) continue;
          pieces ??= info.pieces();
          if (pieces.some((o) => pointObbDist(q, o) < s.r - 0.1)) hit = true;
        }
        if (hit) { out.push({ severity: 'warning', title: `${p.name || info.def.name} hits tube ${s.id}`, detail: 'The part’s envelope intersects a frame tube. Move the part or the tube.', targets: [{ kind: 'part', id: p.id }, { kind: 'member', id: s.id }] }); break; }
      }
    }
    return out.slice(0, 25);
  },
});
