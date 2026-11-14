import { h, icon, toast } from '../dom.js';
import { numField, selectField, checkField, row, section, kv, pill } from '../fields.js';
import { lineChart } from '../charts.js';
import { SUSP_TYPES, typeOf, setWheelbase, setTrack, setTire, shockData, rackData, idealTieRodZ, vehicleDims } from '../../systems/suspension.js';
import { slotDefs, getDef } from '../../catalog/index.js';
import { categoryCards } from '../library.js';
import { fmtLen, fmtAngle, fmtNum, fmtPct, fmtWeight } from '../../core/units.js';
import { defaultSuspension } from '../../core/defaults.js';

const AX = { front: 'Front', rear: 'Rear' };

function slotSelect(ctx, axleKey, slot, label) {
  const { store } = ctx;
  const axle = store.state.suspension[axleKey];
  const cur = slot === 'rack' ? store.state.suspension.steering.rack : axle[slot];
  return row(label, selectField({
    id: `${axleKey}-${slot}`, value: cur, options: slotDefs(slot).map((d) => ({ value: d.key, label: d.name })),
    onChange: (v) => store.commit(`${AX[axleKey]} ${label.toLowerCase()}`, (st) => {
      if (slot === 'tire') setTire(st, axleKey, v);
      else if (slot === 'rack') st.suspension.steering.rack = v;
      else { st.suspension[axleKey][slot] = v; if (slot === 'shock') st.suspension[axleKey].shockSpec = null; }
    }),
  }));
}

function hardpointTable(ctx, axleKey) {
  const { store, interaction } = ctx;
  const axle = store.state.suspension[axleKey];
  const T = typeOf(axle);
  const sel = store.ui.selection;
  const groups = {};
  for (const [k, d] of Object.entries(T.points)) (groups[d.group] ??= []).push([k, d]);
  const body = [];
  for (const [g, list] of Object.entries(groups)) {
    body.push(h('tr', { class: 'grp' }, h('td', { colspan: 5 }, g)));
    for (const [k, d] of list) {
      const p = axle.points[k];
      if (!p) continue;
      const id = `${axleKey}.${k}`;
      const isSel = sel?.kind === 'hardpoint' && sel.id === id;
      const f = (i) => numField({ id: `hp-${axleKey}-${k}-${i}`, value: p[i], unit: '', step: 0.125, onCommit: (v) => store.commit(`${AX[axleKey]} ${d.label}`, (st) => { st.suspension[axleKey].points[k][i] = +v.toFixed(4); }) });
      body.push(h('tr', { class: isSel ? 'sel' : '' },
        h('td', {}, h('button', { class: `hp-dot ${d.body}`, type: 'button', title: `Select ${d.label} (drag it in 3D)`, onclick: () => { store.setUI({ selection: { kind: 'hardpoint', id, side: 'L' } }); interaction.syncGizmo(); } }), h('span', { class: 'hp-name', title: d.label }, d.label.replace(/^.*· /, ''))),
        h('td', {}, f(0)), h('td', {}, f(1)), h('td', {}, f(2))));
    }
  }
  return h('div', { class: 'table-wrap' }, h('table', { class: 'tbl hp' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Point (left side)'), h('th', {}, 'X'), h('th', {}, 'Y'), h('th', {}, 'Z'))), h('tbody', {}, body)));
}

function axleSection(ctx, axleKey) {
  const { store, analysis } = ctx;
  const st = store.state;
  const axle = st.suspension[axleKey];
  const A = analysis();
  const S = A.susp?.[axleKey];
  const sh = shockData(axle, st);
  const setAx = (label, fn) => store.commit(`${AX[axleKey]} ${label}`, (s) => fn(s.suspension[axleKey]));
  const typeSel = row('Layout', selectField({
    id: `${axleKey}-type`, value: axle.type, options: Object.entries(SUSP_TYPES).map(([value, t]) => ({ value, label: t.label })),
    onChange: (v) => {
      const def = defaultSuspension()[v === 'double-wishbone' ? 'front' : 'rear'];
      store.commit(`${AX[axleKey]} layout: ${SUSP_TYPES[v].label}`, (s) => {
        const ax = s.suspension[axleKey];
        const dx = ax.points.WC[0] - def.points.WC[0];
        const dz = ax.points.WC[2] - def.points.WC[2];
        ax.type = v;
        ax.points = Object.fromEntries(Object.entries(def.points).map(([k, p]) => [k, [p[0] + dx, p[1], p[2] + dz]]));
      });
      toast('Loaded template hardpoints for that layout — adjust them to fit your frame', 'info');
    },
  }));
  const shockUse = S?.shockStatic != null ? (sh.extended - S.shockStatic) / sh.stroke : null;
  return section(`${AX[axleKey]} suspension`, h('div', { class: 'stack' },
    typeSel,
    slotSelect(ctx, axleKey, 'tire', 'Tire'),
    slotSelect(ctx, axleKey, 'shock', 'Shock'),
    h('div', { class: 'grid2' },
      row('Eye-to-eye', numField({ id: `${axleKey}-sh-ext`, value: sh.extended, step: 0.25, onCommit: (v) => setAx('shock length', (ax) => { ax.shockSpec = { ...(ax.shockSpec || {}), extended: v }; }) })),
      row('Stroke', numField({ id: `${axleKey}-sh-str`, value: sh.stroke, step: 0.25, onCommit: (v) => setAx('shock stroke', (ax) => { ax.shockSpec = { ...(ax.shockSpec || {}), stroke: v }; }) }))),
    slotSelect(ctx, axleKey, 'upright', 'Upright'),
    slotSelect(ctx, axleKey, 'caliper', 'Caliper'),
    slotSelect(ctx, axleKey, 'rotor', 'Rotor'),
    axleKey === 'rear' ? row('Rear brake', selectField({ id: 'rear-brake-mode', value: axle.brakeMode || 'inboard', options: [{ value: 'inboard', label: 'Inboard (single rotor on gearbox)' }, { value: 'outboard', label: 'Outboard (at each wheel)' }], onChange: (v) => setAx('brake layout', (ax) => { ax.brakeMode = v; }) })) : null,
    h('div', { class: 'grid2' },
      row('Static camber', numField({ id: `${axleKey}-camber`, value: axle.camber, kind: 'ang', step: 0.25, onCommit: (v) => setAx('camber', (ax) => { ax.camber = v; }) })),
      row('Static toe-in', numField({ id: `${axleKey}-toe`, value: axle.toe, kind: 'ang', step: 0.1, onCommit: (v) => setAx('toe', (ax) => { ax.toe = v; }) }))),
    h('div', { class: 'grid2' },
      row('Bump travel', numField({ id: `${axleKey}-bump`, value: axle.bump, step: 0.25, onCommit: (v) => setAx('bump travel', (ax) => { ax.bump = Math.max(0, v); }) })),
      row('Droop travel', numField({ id: `${axleKey}-droop`, value: axle.droop, step: 0.25, onCommit: (v) => setAx('droop travel', (ax) => { ax.droop = Math.max(0, v); }) }))),
    S ? kv([
      ['Shock at ride height', `${fmtLen(S.shockStatic)} (${fmtPct((shockUse ?? 0) * 100)} of stroke used)`],
      ['Shock through travel', `${fmtLen(S.shockMin)} → ${fmtLen(S.shockMax)} (range ${fmtLen(sh.extended - sh.stroke)}–${fmtLen(sh.extended)})`],
      ['Motion ratio (shock ÷ wheel)', fmtNum(S.motionRatio, 2)],
    ]) : null,
    h('div', { class: 'sub-head' }, 'Hardpoints', h('span', { class: 'muted' }, ' · right side mirrors automatically')),
    hardpointTable(ctx, axleKey),
  ), { id: `dyn-${axleKey}` });
}

function simSection(ctx) {
  const { store } = ctx;
  const st = store.state, ui = store.ui;
  const f = st.suspension.front, r = st.suspension.rear;
  const minH = -Math.max(f.droop, r.droop), maxH = Math.max(f.bump, r.bump);
  const travel = st.suspension.steering.travel;
  const out = h('output', { class: 'mono' }, `${fmtLen(ui.sim.heave)} heave · ${fmtLen(ui.sim.rack)} rack`);
  const slider = (id, min, max, step, value, key) => {
    const s = h('input', { type: 'range', id, min, max, step, value, class: 'range' });
    s.addEventListener('input', () => { ctx.setSim({ [key]: Number(s.value) }); out.textContent = `${fmtLen(store.ui.sim.heave)} heave · ${fmtLen(store.ui.sim.rack)} rack`; });
    return s;
  };
  return section('Travel & steering preview', h('div', { class: 'stack' },
    row('Heave (bump +)', slider('sim-heave', minH, maxH, 0.05, ui.sim.heave, 'heave')),
    row('Rack (steer)', slider('sim-rack', -travel, travel, 0.02, ui.sim.rack, 'rack')),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn', type: 'button', onclick: () => ctx.toggleAnimate() }, icon(ui.sim.animate ? 'pause' : 'play', 14), ui.sim.animate ? 'Stop' : 'Animate travel'),
      h('button', { class: 'btn', type: 'button', onclick: () => { ctx.setSim({ heave: 0, rack: 0, animate: false }); ctx.rerender(); } }, 'Back to ride height')),
    out,
    h('p', { class: 'muted small' }, 'Preview only — sliders do not change the design. Front and rear move together; both sides get the same heave.'),
  ), { id: 'dyn-sim' });
}

function resultsSection(ctx) {
  const A = ctx.analysis();
  const S = A.susp;
  if (!S) return null;
  const F = S.front, R = S.rear, g = F.stat, gr = R.stat;
  const rows = [
    ['Wheelbase', fmtLen(S.wheelbase)],
    ['Track F / R', `${fmtLen(S.trackF)} / ${fmtLen(S.trackR)}`],
    g.kpi != null ? ['Kingpin inclination', fmtAngle(g.kpi)] : null,
    g.caster != null ? ['Caster', fmtAngle(g.caster)] : null,
    g.scrub != null ? ['Scrub radius', fmtLen(g.scrub)] : null,
    g.trail != null ? ['Mechanical trail', fmtLen(g.trail)] : null,
    g.spindle != null ? ['Spindle length', fmtLen(g.spindle)] : null,
    ['Roll center F / R', `${fmtLen(g.rcHeight)} / ${fmtLen(gr.rcHeight)}`],
    ['Camber gain F / R', `${fmtNum(F.camberGain, 2)} / ${fmtNum(R.camberGain, 2)} °/in`],
    ['Bump steer F / R', `${fmtAngle(F.toeRange, 2)} / ${fmtAngle(R.toeRange, 2)} over travel`, F.toeRange > 1 || R.toeRange > 1 ? 'warn' : ''],
    ['Track change F / R', `${fmtLen(F.trackChange)} / ${fmtLen(R.trackChange)}`],
    F.steer ? ['Max steer inner / outer', `${fmtAngle(F.steer.innerMax)} / ${fmtAngle(F.steer.outerMax)}`] : null,
    F.steer ? ['Ackermann', fmtPct(F.steer.ackermann)] : null,
    F.steer ? ['Turning circle (outer tire)', `${fmtNum(F.steer.turningDia / 12, 1)} ft`] : null,
    F.rack ? ['Lock-to-lock', `${fmtNum((2 * ctx.store.state.suspension.steering.travel) / F.rack.cFactor, 2)} turns`] : null,
    A.mass?.unsprung?.front ? ['Unsprung mass / corner F / R', `${fmtWeight(A.mass.unsprung.front)} / ${fmtWeight(A.mass.unsprung.rear)}`] : null,
  ];
  const curve = (key) => [
    { label: 'Front', color: '--c-dynamics', points: F.sweep.filter((r) => r.ok).map((r) => [r.z, r[key]]) },
    { label: 'Rear', color: '--c-powertrain', points: R.sweep.filter((r) => r.ok).map((r) => [r.z, r[key]]) },
  ];
  const heave = ctx.store.ui.sim.heave;
  const charts = h('div', { class: 'charts' },
    lineChart({ title: 'Camber vs wheel travel', series: curve('camber'), xLabel: 'travel, in', yLabel: 'camber °', marker: heave }),
    lineChart({ title: 'Toe (bump steer) vs wheel travel', series: curve('toe'), xLabel: 'travel, in', yLabel: 'toe-in °', marker: heave, yPad: 0.5 }),
    F.steer ? lineChart({ title: 'Wheel steer vs rack travel', series: [
      { label: 'Left wheel', color: '--c-dynamics', points: F.steer.rows.map((r) => [r.s, r.left]) },
      { label: 'Right wheel', color: '--c-ergonomics', points: F.steer.rows.map((r) => [r.s, r.right]) }], xLabel: 'rack, in', yLabel: 'steer °', marker: ctx.store.ui.sim.rack }) : null);
  return section('Geometry results', h('div', { class: 'stack' }, kv(rows), charts), { id: 'dyn-results' });
}

function vehicleSection(ctx) {
  const { store } = ctx;
  const d = vehicleDims(store.state);
  return section('Vehicle layout', h('div', { class: 'stack' },
    row('Wheelbase', numField({ id: 'veh-wb', value: d.wheelbase, step: 0.5, onCommit: (v) => store.commit('Wheelbase', (st) => setWheelbase(st, v)) }), { hint: 'Moves the whole front suspension fore/aft' }),
    row('Front track', numField({ id: 'veh-tf', value: d.trackF, step: 0.5, onCommit: (v) => store.commit('Front track', (st) => setTrack(st, 'front', v)) }), { hint: 'Moves front uprights in/out (arms get longer/shorter)' }),
    row('Rear track', numField({ id: 'veh-tr', value: d.trackR, step: 0.5, onCommit: (v) => store.commit('Rear track', (st) => setTrack(st, 'rear', v)) })),
  ), { id: 'dyn-veh' });
}

function steeringSection(ctx) {
  const { store, analysis } = ctx;
  const st = store.state;
  const rk = rackData(st);
  const z = idealTieRodZ(st.suspension.front, st);
  const F = analysis().susp?.front;
  return section('Steering', h('div', { class: 'stack' },
    slotSelect(ctx, 'front', 'rack', 'Rack'),
    row('Rack travel (each way)', numField({ id: 'rack-travel', value: st.suspension.steering.travel, step: 0.125, onCommit: (v) => store.commit('Rack travel', (s) => { s.suspension.steering.travel = Math.max(0.1, v); }) }), { hint: `Rack allows ±${fmtLen(rk.travel)} · ${fmtNum(rk.cFactor, 2)} in per steering-wheel turn` }),
    kv([
      ['Inner tie-rod spacing', fmtLen(2 * st.suspension.front.points.TR_I[1])],
      z != null ? ['Tie-rod inner Z for ~zero bump steer', fmtLen(z)] : null,
      F?.steer ? ['Ackermann at full lock', fmtPct(F.steer.ackermann)] : null,
    ]),
    z != null ? h('button', { class: 'btn', type: 'button', onclick: () => store.commit('Align tie rod for bump steer', (s) => { s.suspension.front.points.TR_I[2] = +z.toFixed(3); }) }, 'Move tie-rod inner to that height') : null,
  ), { id: 'dyn-steer' });
}

export function renderDynamics(ctx) {
  const { store } = ctx;
  return h('div', { class: 'panel-inner' },
    h('p', { class: 'panel-intro' }, 'Place trailing arms, A-arms, uprights, wheels and the steering rack by their hardpoints. Type exact coordinates or drag the colored points in 3D. Geometry is solved through full travel and flagged in Design checks.'),
    h('div', { class: 'legend-inline' }, h('span', {}, h('i', { class: 'hp-dot chassis' }), 'frame mount'), h('span', {}, h('i', { class: 'hp-dot upright' }), 'on upright'), h('span', {}, h('i', { class: 'hp-dot lca' }), 'on arm')),
    checkField({ id: 'show-hp', checked: store.ui.layers.hardpoints, label: 'Show hardpoints', onChange: (v) => store.setUI({ layers: { ...store.ui.layers, hardpoints: v } }) }),
    vehicleSection(ctx), simSection(ctx), resultsSection(ctx), axleSection(ctx, 'front'), steeringSection(ctx), axleSection(ctx, 'rear'),
    section('Dynamics parts', categoryCards('dynamics', ctx), { id: 'dyn-lib', open: false }));
}

export { getDef, pill };
