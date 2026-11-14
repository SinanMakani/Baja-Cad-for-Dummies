// Chassis stress tests: Baja-style impact and load cases run through the
// frame solver, plus the workflow gate that keeps suspension, ergonomics and
// powertrain locked until a new frame passes.
//
// Loads are equivalent static forces, F = g × design mass (vehicle + driver).
// Impact forces push the impact face of the frame toward the far side, which
// is held fixed (the "wall" the car is pushed against). This is a comparison
// and weak-spot tool, not a replacement for a full dynamic FEA.
import { buildModel, solveFrame } from './fea.js';
import { typeOf } from './suspension.js';
import { roleInfo } from '../catalog/materials.js';

export const CASES = [
  { key: 'front', name: 'Front impact', dir: [-1, 0, 0], g: 6, blurb: 'Nose into a barrier: ≈25 mph stopped over 0.2 s' },
  { key: 'rear', name: 'Rear impact', dir: [1, 0, 0], g: 4, blurb: 'Hit from behind by another car' },
  { key: 'sideL', name: 'Side impact · left', dir: [0, -1, 0], g: 3.5, side: true, blurb: 'T-bone into the left side: ≈20 mph over 0.25 s' },
  { key: 'sideR', name: 'Side impact · right', dir: [0, 1, 0], g: 3.5, side: true, blurb: 'T-bone into the right side' },
  { key: 'roll', name: 'Rollover · roof', dir: [0, 0, -1], g: 3, blurb: 'Landing upside down on the roof from about 3 ft' },
  { key: 'roll45', name: 'Rollover · roof corner', dir: [0, -0.7071, -0.7071], g: 3, blurb: 'Landing on the top-left corner at 45°' },
  { key: 'bump', name: 'Landing · front suspension', kind: 'bump', g: 3, blurb: 'Hard jump landing through the front suspension mounts' },
  { key: 'torsion', name: 'Torsion (one wheel up)', kind: 'torsion', torque: 1000, blurb: 'Twist between front and rear suspension mounts; reports stiffness' },
];

export const DIRECTIONS = [
  { key: 'front', label: 'From the front (−X)', dir: [-1, 0, 0] },
  { key: 'rear', label: 'From the rear (+X)', dir: [1, 0, 0] },
  { key: 'left', label: 'From the left (−Y)', dir: [0, -1, 0] },
  { key: 'right', label: 'From the right (+Y)', dir: [0, 1, 0] },
  { key: 'top', label: 'From above (−Z)', dir: [0, 0, -1] },
  { key: 'bottom', label: 'From below (+Z)', dir: [0, 0, 1] },
  { key: 'frontTop', label: 'Front-top corner (45°)', dir: [-0.7071, 0, -0.7071] },
  { key: 'leftTop', label: 'Left-top corner (45°)', dir: [0, -0.7071, -0.7071] },
];

export function defaultStress() {
  return {
    settings: { mass: 500, fosYield: 1.5, fosBuckling: 2.0, K: 1.0 },
    cases: Object.fromEntries(CASES.map((c) => [c.key, { enabled: true, ...(c.torque ? { torque: c.torque } : { g: c.g }) }])),
    custom: [],
    last: null,
  };
}

// ------------------------------------------------------------------ gate

export function gateLocked(state) {
  const w = state.workflow;
  return !!w && w.requireStressTest !== false && w.unlocked === false;
}

/** Fingerprint of everything that changes the stress results. */
export function chassisHash(state) {
  const parts = [];
  for (const id of Object.keys(state.chassis.nodes).sort()) parts.push(id, state.chassis.nodes[id].p.map((v) => v.toFixed(3)).join(','));
  for (const id of Object.keys(state.chassis.members).sort()) {
    const m = state.chassis.members[id];
    const p = state.chassis.profiles[m.profile] || {};
    parts.push(id, m.a, m.b, m.role, p.od, p.wall, p.material);
  }
  parts.push(JSON.stringify(state.stress?.settings), JSON.stringify(state.stress?.cases), JSON.stringify(state.stress?.custom));
  const s = parts.join('|');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

export function stressStatus(state) {
  const last = state.stress?.last;
  if (!last) return 'none';
  if (last.hash !== chassisHash(state)) return 'stale';
  return last.pass ? 'pass' : 'fail';
}

// ------------------------------------------------------------------ load selection

function nodePositions(state) {
  const used = new Set();
  for (const m of Object.values(state.chassis.members)) { used.add(m.a); used.add(m.b); }
  return [...used].filter((id) => state.chassis.nodes[id]).map((id) => ({ id, p: state.chassis.nodes[id].p }));
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };

/** Joints within `tolFrac` of the frame's extent from its extreme along `dir`. */
function extremeFace(nodes, dir, tolFrac = 0.02) {
  const vals = nodes.map((n) => dot(n.p, dir));
  const max = Math.max(...vals), min = Math.min(...vals);
  const tol = Math.max(1.5, (max - min) * tolFrac);
  return nodes.filter((n, i) => vals[i] >= max - tol);
}

// The far 20 % of the frame is held: a stand-in for the inertia of the car
// (engine, driver, frame) that resists an impact. Holding only the last
// joint or two would turn the whole frame into an unrealistic cantilever.
const SUPPORT_BAND = 0.2;
// A Baja bumper is roughly 15 in wide: side impacts load three points 7.5 in
// apart around the middle of the side-impact line rather than a single point.
const SIDE_CONTACT = [-7.5, 0, 7.5];

/**
 * Where each chassis-side suspension pivot of an axle attaches to the frame:
 * the nearest joint within 3 in, or else a point on the nearest tube within
 * 1.5 in (that tube is split there for the analysis, like a welded tab).
 */
function mountPoints(state, axleKey, nodes, splits, positions) {
  const axle = state.suspension?.[axleKey];
  if (!axle) return { L: [], R: [] };
  const T = typeOf(axle);
  const out = { L: new Set(), R: new Set() };
  for (const [k, d] of Object.entries(T.points)) {
    if (d.body !== 'chassis' || !axle.points[k] || k.startsWith('SH_')) continue;
    for (const [side, s] of [['L', 1], ['R', -1]]) {
      const hp = [axle.points[k][0], s * axle.points[k][1], axle.points[k][2]];
      let best = null;
      for (const n of nodes) {
        const dd = Math.hypot(n.p[0] - hp[0], n.p[1] - hp[1], n.p[2] - hp[2]);
        if (dd < 3.0 && (!best || dd < best.d)) best = { id: n.id, d: dd };
      }
      if (best) { out[side].add(best.id); continue; }
      let onTube = null;
      for (const [id, m] of Object.entries(state.chassis.members)) {
        const a = state.chassis.nodes[m.a]?.p, b = state.chassis.nodes[m.b]?.p;
        if (!a || !b) continue;
        const ab = b.map((v, i) => v - a[i]);
        const len2 = dot(ab, ab);
        const t = Math.min(0.95, Math.max(0.05, dot(hp.map((v, i) => v - a[i]), ab) / len2));
        const q = a.map((v, i) => v + ab[i] * t);
        const dd = Math.hypot(q[0] - hp[0], q[1] - hp[1], q[2] - hp[2]);
        if (dd < 1.5 && (!onTube || dd < onTube.d)) onTube = { id, t, q, d: dd };
      }
      if (onTube) {
        const key = `@${onTube.id}:${onTube.t.toFixed(3)}`;
        if (!positions.has(key)) { splits.push({ key, member: onTube.id, t: onTube.t }); positions.set(key, onTube.q); }
        out[side].add(key);
      }
    }
  }
  return { L: [...out.L], R: [...out.R] };
}

/** Geometric fallback when the frame doesn't line up with the suspension yet. */
function lowNodes(nodes, end) {
  const xs = nodes.map((n) => n.p[0]), zs = nodes.map((n) => n.p[2]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  const L = x1 - x0, H = z1 - z0;
  const pick = nodes.filter((n) => (end === 'front' ? n.p[0] >= x1 - 0.3 * L : n.p[0] <= x0 + 0.3 * L) && n.p[2] <= z0 + 0.35 * H);
  return { L: pick.filter((n) => n.p[1] > 0.5).map((n) => n.id), R: pick.filter((n) => n.p[1] < -0.5).map((n) => n.id), all: pick.map((n) => n.id) };
}

/**
 * Describe the loads and supports of one case without solving it.
 * Returns { points: [{key, p, F}], supports: [nodeId], splits, note }.
 */
export function setupCase(state, def, cfg, mass) {
  const nodes = nodePositions(state);
  if (nodes.length < 2) return { error: 'Draw a frame first.' };
  const splits = [];
  const points = [];
  let supports = [];
  let note = '';

  if (def.kind === 'bump' || def.kind === 'torsion') {
    const positions = new Map(nodes.map((n) => [n.id, n.p]));
    let front = mountPoints(state, 'front', nodes, splits, positions), rear = mountPoints(state, 'rear', nodes, splits, positions);
    const usingMounts = front.L.length + front.R.length >= 2 && rear.L.length + rear.R.length >= 2;
    if (!usingMounts) {
      splits.length = 0;
      front = lowNodes(nodes, 'front'); rear = lowNodes(nodes, 'rear');
      note = 'Suspension hardpoints are not on this frame yet, so the lower front and rear corners stand in for the mounts.';
    } else note = 'Loads go in at the front suspension pivots; the rear suspension pivots are held.';
    supports = [...rear.L, ...rear.R, ...(rear.all || [])];
    const at = (key) => positions.get(key);
    if (def.kind === 'bump') {
      const ids = [...new Set([...front.L, ...front.R])];
      const F = ((cfg.g ?? def.g) * mass * 0.45) / Math.max(1, ids.length);
      for (const id of ids) points.push({ key: id, p: at(id), F: [0, 0, F] });
    } else {
      if (!front.L.length || !front.R.length) return { error: 'Torsion needs mounts on both sides of the front of the frame.' };
      const yl = front.L.reduce((s, id) => s + at(id)[1], 0) / front.L.length;
      const yr = front.R.reduce((s, id) => s + at(id)[1], 0) / front.R.length;
      const spacing = Math.max(1, yl - yr);
      const torqueInLb = (cfg.torque ?? def.torque) * 12;
      const Fside = torqueInLb / spacing;
      for (const id of front.L) points.push({ key: id, p: at(id), F: [0, 0, Fside / front.L.length], side: 'L' });
      for (const id of front.R) points.push({ key: id, p: at(id), F: [0, 0, -Fside / front.R.length], side: 'R' });
      return { points, supports: [...new Set(supports)], splits, note, spacing, torqueInLb };
    }
    return { points, supports: [...new Set(supports)], splits, note };
  }

  const dir = norm(def.dir || cfg.dir);
  const Ftotal = (cfg.g ?? def.g) * mass;
  supports = extremeFace(nodes, dir, SUPPORT_BAND).map((n) => n.id);

  if (def.target) {
    // Custom impact at a chosen joint or the middle of a chosen tube.
    if (def.target.kind === 'node' && state.chassis.nodes[def.target.id]) {
      points.push({ key: def.target.id, p: state.chassis.nodes[def.target.id].p, F: dir.map((v) => v * Ftotal) });
    } else if (def.target.kind === 'member' && state.chassis.members[def.target.id]) {
      const m = state.chassis.members[def.target.id];
      const a = state.chassis.nodes[m.a].p, b = state.chassis.nodes[m.b].p;
      const key = `@${def.target.id}`;
      splits.push({ key, member: def.target.id, t: 0.5 });
      points.push({ key, p: a.map((v, i) => (v + b[i]) / 2), F: dir.map((v) => v * Ftotal) });
    } else return { error: 'The impact point no longer exists.' };
    supports = supports.filter((id) => id !== def.target.id);
    note = 'Custom impact; the far side of the frame is held.';
    return { points, supports, splits, note };
  }

  if (def.side) {
    // Side impacts hit the middle of the side-impact members on that side.
    const sign = -Math.sign(dir[1]);
    const onSide = (role) => Object.entries(state.chassis.members).filter(([, m]) => roleInfo(m.role).key === role
      && state.chassis.nodes[m.a]?.p[1] * sign > 0.5 && state.chassis.nodes[m.b]?.p[1] * sign > 0.5);
    // Untagged frames (e.g. fresh CAD imports): use the fore-aft side rails at
    // mid height as SIM and the lowest ones as LFS.
    const zs = nodes.map((n) => n.p[2]);
    const z0 = Math.min(...zs), H = Math.max(...zs) - z0;
    const rails = (zLo, zHi) => Object.entries(state.chassis.members).filter(([, m]) => {
      const a = state.chassis.nodes[m.a]?.p, b = state.chassis.nodes[m.b]?.p;
      if (!a || !b || a[1] * sign <= 0.5 || b[1] * sign <= 0.5) return false;
      const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const zm = (a[2] + b[2]) / 2;
      return Math.abs(b[0] - a[0]) / L > 0.75 && zm >= z0 + zLo * H && zm <= z0 + zHi * H;
    });
    let sims = onSide('SIM');
    let lfs = onSide('LFS');
    const guessed = !sims.length;
    if (guessed) { sims = rails(0.2, 0.6); if (!lfs.length) lfs = rails(-0.01, 0.12); }
    if (sims.length) {
      // Bumper-width contact centered on the side-impact line (SIM may be split
      // into segments). The bumper spans the side panel, so the lower frame
      // side (LFS) at the same spot shares the load with the SIM when present.
      const xs = sims.flatMap(([, m]) => [state.chassis.nodes[m.a].p[0], state.chassis.nodes[m.b].p[0]]);
      const xc = (Math.min(...xs) + Math.max(...xs)) / 2;
      const hitAt = (list, x) => {
        for (const [id, m] of list) {
          const a = state.chassis.nodes[m.a].p, b = state.chassis.nodes[m.b].p;
          if ((x - a[0]) * (x - b[0]) > 0 || Math.abs(b[0] - a[0]) < 1e-6) continue;
          return { id, m, a, b, t: (x - a[0]) / (b[0] - a[0]) };
        }
        return null;
      };
      const loadAt = (hit, F) => {
        const L = Math.hypot(...hit.b.map((v, i) => v - hit.a[i]));
        if (hit.t * L < 1) { points.push({ key: hit.m.a, p: hit.a, F }); return; }
        if ((1 - hit.t) * L < 1) { points.push({ key: hit.m.b, p: hit.b, F }); return; }
        const key = `@${hit.id}:${hit.t.toFixed(3)}`;
        splits.push({ key, member: hit.id, t: hit.t });
        points.push({ key, p: hit.a.map((v, i) => v + (hit.b[i] - v) * hit.t), F });
      };
      const share = Ftotal / SIDE_CONTACT.length;
      let sharedWithLfs = false;
      for (const off of SIDE_CONTACT) {
        const sim = hitAt(sims, xc + off);
        if (!sim) continue;
        const low = hitAt(lfs, xc + off);
        if (low) { sharedWithLfs = true; loadAt(sim, dir.map((v) => (v * share) / 2)); loadAt(low, dir.map((v) => (v * share) / 2)); }
        else loadAt(sim, dir.map((v) => v * share));
      }
      if (points.length) {
        note = `A 15 in bumper-width patch at mid-cockpit loads the side-impact ${guessed ? 'rail (no tubes are tagged SIM, so the mid-height side rails stand in — tag them for an exact test)' : 'member'}${sharedWithLfs ? ' and the lower frame side' : ''} on this side; the far side of the frame is held.`;
        return { points, supports, splits, note };
      }
    }
    note = 'No side-impact members found, so the outermost joints on this side take the load. Tag your side-impact members (SIM) for a realistic test.';
  }
  const face = extremeFace(nodes, dir.map((v) => -v)).filter((n) => !supports.includes(n.id));
  if (!face.length) return { error: 'Could not find an impact face for this direction.' };
  for (const n of face) points.push({ key: n.id, p: n.p, F: dir.map((v) => (v * Ftotal) / face.length) });
  if (!note) note = `Load spread over the ${face.length} outermost joint${face.length === 1 ? '' : 's'} on the impact side; the far side is held.`;
  return { points, supports, splits, note };
}

// ------------------------------------------------------------------ runner

let lastRun = null;
export const lastResults = (hash) => (lastRun && (!hash || lastRun.hash === hash) ? lastRun : null);

export function allCases(state) {
  const cfg = state.stress || defaultStress();
  const list = CASES.map((def) => ({ def, cfg: cfg.cases[def.key] || {}, enabled: cfg.cases[def.key]?.enabled !== false }));
  for (const c of cfg.custom || []) list.push({ def: { key: c.id, name: c.name, target: c.target, dir: c.dir, g: c.g, custom: true, blurb: 'Custom impact point' }, cfg: c, enabled: c.enabled !== false });
  return list;
}

/**
 * The frame's main connected piece (the one with the most tubes). Tubes not
 * connected to it would leave the stiffness matrix singular, so the stress
 * tests run on this piece and list the rest as left out.
 */
export function mainFrame(state) {
  const { nodes, members } = state.chassis;
  const up = new Map(Object.keys(nodes).map((id) => [id, id]));
  const find = (x) => { while (up.get(x) !== x) { up.set(x, up.get(up.get(x))); x = up.get(x); } return x; };
  const live = Object.entries(members).filter(([, m]) => nodes[m.a] && nodes[m.b] && m.a !== m.b);
  for (const [, m] of live) up.set(find(m.a), find(m.b));
  const count = new Map();
  for (const [, m] of live) { const r = find(m.a); count.set(r, (count.get(r) || 0) + 1); }
  let root = null;
  for (const [r, n] of count) if (root == null || n > count.get(root)) root = r;
  const keep = {}, left = [];
  for (const [id, m] of live) (find(m.a) === root ? (keep[id] = m) : left.push(id));
  if (!left.length) return { state, left };
  const used = new Set(Object.values(keep).flatMap((m) => [m.a, m.b]));
  const keptNodes = Object.fromEntries(Object.entries(nodes).filter(([id]) => used.has(id)));
  return { state: { ...state, chassis: { ...state.chassis, nodes: keptNodes, members: keep } }, left };
}

export function runStressTests(state) {
  const cfg = state.stress || defaultStress();
  const { mass, fosYield, fosBuckling, K } = cfg.settings;
  const hash = chassisHash(state);
  const main = mainFrame(state);
  const full = state;
  state = main.state;
  const cases = [];
  for (const { def, cfg: c, enabled } of allCases(full)) {
    if (!enabled) continue;
    const setup = setupCase(state, def, c, mass);
    if (setup.error) { cases.push({ key: def.key, name: def.name, ok: false, error: setup.error, pass: false }); continue; }
    const model = buildModel(state, setup.splits);
    const fixed = new Set(setup.supports.map((id) => model.keyIndex.get(id)).filter((i) => i != null));
    const loads = new Map();
    for (const pt of setup.points) {
      const i = model.keyIndex.get(pt.key);
      if (i == null) continue;
      const prev = loads.get(i) || [0, 0, 0];
      loads.set(i, prev.map((v, k) => v + pt.F[k]));
    }
    const res = solveFrame(model, { fixed, loads }, { K });
    if (!res.ok) { cases.push({ key: def.key, name: def.name, ok: false, error: res.error, pass: false, setup }); continue; }
    let minFos = Infinity, minFosMember = null, minBuck = Infinity, minBuckMember = null, maxVm = 0;
    for (const [id, r] of Object.entries(res.members)) {
      if (r.fos < minFos) { minFos = r.fos; minFosMember = id; }
      if (r.fosBuckling < minBuck) { minBuck = r.fosBuckling; minBuckMember = id; }
      maxVm = Math.max(maxVm, r.vm);
    }
    let maxDisp = 0, maxDispNode = null;
    for (let i = 0; i < model.pos.length; i++) {
      const d = Math.hypot(res.u[i * 6], res.u[i * 6 + 1], res.u[i * 6 + 2]);
      if (d > maxDisp) { maxDisp = d; maxDispNode = model.keys[i]; }
    }
    let torsionK = null;
    if (def.kind === 'torsion') {
      const avg = (side) => {
        const pts = setup.points.filter((p) => p.side === side);
        return pts.reduce((s, p) => s + res.u[model.keyIndex.get(p.key) * 6 + 2], 0) / pts.length;
      };
      const theta = (avg('L') - avg('R')) / setup.spacing;
      torsionK = theta > 0 ? (setup.torqueInLb / 12) / ((theta * 180) / Math.PI) : null;
    }
    const totalForce = Math.hypot(...setup.points.reduce((s, p) => s.map((v, k) => v + Math.abs(p.F[k]) * (k === 2 && def.kind === 'torsion' ? 0.5 : 1)), [0, 0, 0]));
    const pass = minFos >= fosYield && minBuck >= fosBuckling;
    cases.push({ key: def.key, name: def.name, ok: true, pass, minFos, minFosMember, minBuck, minBuckMember, maxVm, maxDisp, maxDispNode, torsionK, totalForce, setup, model, res });
  }
  const ran = cases.length > 0;
  const pass = ran && cases.every((c) => c.pass);
  lastRun = { hash, cases, pass, left: main.left, ranAt: new Date().toISOString(), settings: { ...cfg.settings } };
  return lastRun;
}

/** Small, saveable summary of a run (the full results stay in memory). */
export function summarize(run) {
  const r3 = (v) => (Number.isFinite(v) ? +v.toFixed(3) : null);
  return {
    hash: run.hash, ranAt: run.ranAt, pass: run.pass, mass: run.settings.mass, left: run.left?.length ? run.left : undefined,
    cases: run.cases.map((c) => ({
      key: c.key, name: c.name, ok: c.ok, pass: c.pass, error: c.error || null,
      minFos: r3(c.minFos), minFosMember: c.minFosMember || null, minBuck: r3(c.minBuck), minBuckMember: c.minBuckMember || null,
      maxDisp: r3(c.maxDisp), maxVm: r3(c.maxVm), torsionK: r3(c.torsionK),
    })),
  };
}

/** Color for a factor of safety: red below 1, through orange/yellow to green at 3+. */
export function fosColor(fos, target = 1.5) {
  if (!Number.isFinite(fos)) return [0.18, 0.62, 0.36];
  const stops = [[0, [0.85, 0.12, 0.12]], [1, [0.92, 0.3, 0.12]], [target, [0.96, 0.72, 0.15]], [Math.max(target + 0.75, 2.5), [0.55, 0.78, 0.25]], [Math.max(target + 1.5, 3.5), [0.18, 0.62, 0.36]]];
  if (fos <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (fos <= stops[i][0]) {
      const [x0, c0] = stops[i - 1], [x1, c1] = stops[i];
      const t = (fos - x0) / (x1 - x0);
      return c0.map((v, k) => v + (c1[k] - v) * t);
    }
  }
  return stops.at(-1)[1];
}
