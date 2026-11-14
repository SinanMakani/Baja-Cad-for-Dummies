import { h, icon, toast } from '../dom.js';
import { numField, selectField, checkField, textField, row, section, kv, pill } from '../fields.js';
import { SEXES, MEASURES, HEIGHT_RANGE, WEIGHT_RANGE, makeDriver, activeDriver, driverBody, driverSummary, fmtHeight, measuredOf } from '../../systems/drivers.js';
import { nextId } from '../../core/store.js';
import { getDef, defsIn, paramsOf, weightOf } from '../../catalog/index.js';
import { addPart, snapPartToFloor, partName } from '../../core/commands.js';
import { categoryCards, defaultDropPoint } from '../library.js';
import { fmtLen, fmtAngle, fmtPct, fmtWeight, inputLen } from '../../core/units.js';
import { SEAT_MATERIALS } from '../../catalog/ergonomics.js';

const byRole = (st, role) => Object.values(st.parts).find((p) => getDef(p.def, st)?.role === role);

export function componentRow(ctx, role, label, { swap = true, extra } = {}) {
  const { store, analysis, interaction } = ctx;
  const st = store.state;
  const part = byRole(st, role);
  const options = defsIn(getDefCategory(role)).filter((d) => d.role === role);
  if (!part) {
    return h('div', { class: 'comp missing' },
      h('div', { class: 'comp-name' }, label, pill('missing', 'warn')),
      h('div', { class: 'btn-row wrap' }, options.map((d) => h('button', {
        class: 'btn tiny', type: 'button',
        onclick: () => { const r = addPart(store, d.key, defaultDropPoint(st, analysis, d), { rot: d.defaultRot || [0, 0, 0] }); if (r?.id) { store.select({ kind: 'part', id: r.id }); toast(`Added ${d.name}`, 'ok'); } },
      }, icon('plus', 12), d.name))));
  }
  const def = getDef(part.def, st);
  const selected = store.ui.selection?.kind === 'part' && store.ui.selection.id === part.id;
  return h('div', { class: `comp ${selected ? 'sel' : ''}` },
    h('div', { class: 'comp-head' },
      h('button', { class: 'comp-name link', type: 'button', title: 'Select', onclick: () => { store.select({ kind: 'part', id: part.id }); interaction.syncGizmo(); } }, partName(part, st)),
      part.linked ? pill('auto-linked', 'info') : null,
      h('span', { class: 'muted small' }, fmtWeight(weightOf(part, def)))),
    swap && options.length > 1 ? row('Model', selectField({ id: `swap-${role}`, value: part.def, options: options.map((d) => ({ value: d.key, label: d.name })), onChange: (v) => { addPart(store, v, part.pos, { rot: part.rot }); } })) : null,
    h('div', { class: 'comp-pos mono small muted' }, `X ${fmtLen(part.pos[0])}  Y ${fmtLen(part.pos[1])}  Z ${fmtLen(part.pos[2])}`),
    extra ? extra(part, paramsOf(part, def)) : null);
}

function getDefCategory(role) {
  return ['seat', 'brakePedal', 'throttlePedal', 'steeringWheel', 'harness'].includes(role) ? 'ergonomics'
    : ['engine', 'cvt', 'gearbox', 'fuelTank', 'frontDiff', 'airFilter'].includes(role) ? 'powertrain' : 'hardware';
}

/** How well one posed driver fits: the worst level plus the numbers behind it. */
export function fitOf(e) {
  if (!e?.pose) return null;
  const helmet = e.clearances.find((c) => c.name === 'helmet');
  const body = e.clearances.filter((c) => c.name !== 'helmet').sort((a, b) => a.dist - b.dist)[0];
  const legs = ['L', 'R'].map((s) => e.pose.legs[s]).filter((l) => l.pedal);
  const reach = legs.length ? Math.max(...legs.map((l) => l.reach)) : null;
  const knee = legs.length ? Math.min(...legs.map((l) => l.angle)) : null;
  const lv = {
    helmet: helmet && helmet.dist < 6 ? 'bad' : 'ok',
    body: body?.dist < 0 || e.outside?.length ? 'bad' : body?.dist < 3 ? 'warn' : 'ok',
    reach: reach > 0.98 ? 'bad' : reach > 0.95 || (knee != null && knee < 95) ? 'warn' : 'ok',
    seat: e.seatFit?.tight ? 'warn' : 'ok',
  };
  const all = Object.values(lv);
  return { level: all.includes('bad') ? 'bad' : all.includes('warn') ? 'warn' : 'ok', lv, helmet, body, reach, knee, seat: e.seatFit };
}
const FIT_TEXT = { ok: 'fits', warn: 'tight', bad: "doesn't fit" };
const wide = (el) => { el.classList.add('wide'); return el; };

/** Team drivers: the roster, the selected driver's details and their body measurements. */
function driverSection(ctx, A) {
  const { store } = ctx;
  const st = store.state, ergo = st.ergonomics;
  const act = activeDriver(st);
  const body = A.ergo?.driver?.id === act.id ? A.ergo.driver : driverBody(act);
  const fits = new Map((A.ergoAll || []).map((e) => [e.driver.id, fitOf(e)]));
  const name = act.name || 'Driver';
  const edit = (label, fn) => store.commit(label, (s) => { const d = s.ergonomics.drivers.find((x) => x.id === act.id); if (d) fn(d); });
  const pose = (d) => { if (d.id !== act.id) store.commit(`Pose ${d.name || 'driver'}`, (s) => { s.ergonomics.driverId = d.id; }); };
  const add = () => store.commit('Add driver', (s) => {
    let id;
    do { id = nextId(s, 'D'); } while (s.ergonomics.drivers.some((d) => d.id === id));
    const src = activeDriver(s);
    s.ergonomics.drivers.push(makeDriver(id, { sex: src.sex, height: src.height, weight: src.weight }));
    s.ergonomics.driverId = id;
  });
  const remove = () => store.commit(`Remove ${name}`, (s) => {
    s.ergonomics.drivers = s.ergonomics.drivers.filter((d) => d.id !== act.id);
    s.ergonomics.driverId = s.ergonomics.drivers[0].id;
  });
  const inRange = (v, [lo, hi], what, fmt) => {
    if (v >= lo && v <= hi) return true;
    toast(`${what} must be between ${fmt(lo)} and ${fmt(hi)}`, 'warn');
    ctx.rerender?.();
    return false;
  };

  const roster = h('div', { class: 'drivers', role: 'group', 'aria-label': 'Drivers' }, ergo.drivers.map((d) => {
    const on = d.id === act.id, f = fits.get(d.id);
    return h('button', { class: `driver ${on ? 'on' : ''}`, type: 'button', 'aria-pressed': String(on), title: on ? 'Posed in the car' : `Pose ${d.name || 'this driver'} in the car`, onclick: () => pose(d) },
      h('span', { class: 'driver-dot', 'aria-hidden': 'true' }),
      h('span', { class: 'driver-text' }, h('span', { class: 'driver-name' }, d.name || 'Driver'), h('span', { class: 'driver-meta' }, driverSummary(d))),
      f ? pill(FIT_TEXT[f.level], `${f.level} tiny`) : null);
  }));

  const sexSeg = h('div', { class: 'seg fill', role: 'group', 'aria-label': 'Gender' }, SEXES.map((o) => h('button', {
    class: `seg-btn ${act.sex === o.value ? 'active' : ''}`, type: 'button', 'aria-pressed': String(act.sex === o.value),
    onclick: () => { if (act.sex !== o.value) edit('Driver gender', (d) => { d.sex = o.value; }); },
  }, o.label)));

  const measured = measuredOf(act);
  const nMeasured = Object.keys(measured).length;
  const measures = section('Body measurements', h('div', { class: 'stack' },
    h('p', { class: 'muted small' }, `Estimated from ${name}'s height, weight and gender. Type a value measured on the driver to use it instead.`),
    MEASURES.map((m) => {
      const est = body.estimates[m.key];
      const isM = m.key in measured;
      const useEst = h('button', { class: 'link small', type: 'button', onclick: () => edit(`${m.label}: use estimate`, (d) => { d.measure = { ...(d.measure || {}) }; delete d.measure[m.key]; }) }, `Use estimate (${fmtLen(est)})`);
      return row(h('span', { class: 'm-label' }, m.label, isM ? pill('measured', 'accent tiny') : null),
        numField({
          id: `drv-m-${m.key}`, value: isM ? measured[m.key] : est, step: 0.25, placeholder: inputLen(est),
          onCommit: (v) => edit(m.label, (d) => {
            d.measure = { ...(d.measure || {}) };
            if (!(v > 0) || Math.abs(v - est) < 0.0005) delete d.measure[m.key];
            else d.measure[m.key] = +v.toFixed(3);
          }),
        }),
        { hint: isM ? h('span', {}, m.hint ? `${m.hint}. ` : '', useEst) : m.hint });
    }),
    nMeasured > 1 ? h('div', { class: 'btn-row' }, h('button', { class: 'btn tiny', type: 'button', onclick: () => edit('Use estimated measurements', (d) => { d.measure = {}; }) }, 'Use all estimates')) : null,
  ), { id: 'erg-measure', open: false, count: nMeasured || undefined });

  return section('Drivers', h('div', { class: 'stack' },
    h('p', { class: 'muted small' }, 'Add each driver on your team. The selected driver is posed in the car, and the design checks cover everyone, so include your tallest, heaviest and shortest drivers.'),
    roster,
    h('div', { class: 'btn-row' }, h('button', { class: 'btn tiny', type: 'button', onclick: add }, icon('plus', 12), 'Add driver')),
    h('div', { class: 'driver-editor' },
      h('div', { class: 'sub-title' }, `Selected driver`),
      row('Name', textField({ id: 'drv-name', value: act.name, placeholder: 'Driver name', onCommit: (v) => { const n = v.trim(); if (n && n !== act.name) edit('Rename driver', (d) => { d.name = n; }); } })),
      wide(row('Gender', sexSeg, { hint: 'Sets the body proportions used for the estimates.' })),
      h('div', { class: 'grid2' },
        row('Height', numField({
          id: 'drv-height', value: act.height, kind: 'len', unit: '', format: fmtHeight, step: 0.5,
          title: 'Height, e.g. 5\' 10", 70 (inches) or 178 cm',
          onCommit: (v) => { if (inRange(v, HEIGHT_RANGE, 'Height', fmtHeight)) edit('Driver height', (d) => { d.height = +v.toFixed(2); }); },
        })),
        row('Weight', numField({
          id: 'drv-weight', value: act.weight, kind: 'mass', step: 1,
          onCommit: (v) => { if (inRange(v, WEIGHT_RANGE, 'Weight', (x) => `${x} lb`)) edit('Driver weight', (d) => { d.weight = +v.toFixed(1); }); },
        }))),
      kv([
        ['Sitting height', fmtLen(body.sitHeight)],
        ['Leg, hip to ankle', fmtLen(body.thigh + body.shank)],
        ['Arm, shoulder to grip', fmtLen(body.upperArm + body.forearm)],
        ['Seated hip width', fmtLen(body.hipWidth)],
        ['Body-mass index', body.bmi.toFixed(1)],
      ]),
      measures,
      ergo.drivers.length > 1 ? h('div', { class: 'btn-row' }, h('button', { class: 'btn tiny', type: 'button', onclick: remove }, icon('trash', 12), `Remove ${name}`)) : null),
    h('div', { class: 'grid2' },
      checkField({ id: 'erg-show', checked: ergo.showDriver, label: 'Show driver', onChange: (v) => store.commit('Show driver', (s) => { s.ergonomics.showDriver = v; }) }),
      checkField({ id: 'erg-cg', checked: ergo.includeDriverInCG !== false, label: 'Include in CG', onChange: (v) => store.commit('Driver in CG', (s) => { s.ergonomics.includeDriverInCG = v; }) })),
    checkField({ id: 'erg-all', checked: ergo.checkAll !== false, label: 'Design checks cover every driver', onChange: (v) => store.commit('Check every driver', (s) => { s.ergonomics.checkAll = v; }) }),
    h('button', { class: 'btn', type: 'button', disabled: !A.ergo?.pose, onclick: () => ctx.driverView() }, icon('eye', 14), "Driver's-eye view"),
  ), { id: 'erg-driver', count: ergo.drivers.length });
}

export function renderErgonomics(ctx) {
  const { store, analysis } = ctx;
  const st = store.state, ui = store.ui;
  const A = analysis();
  const e = A.ergo;
  const setParam = (part, key, label) => (v) => store.commit(label, (s) => { s.parts[part.id].params = { ...s.parts[part.id].params, [key]: v }; });
  const rest = (part) => h('button', { class: 'btn tiny', type: 'button', title: 'Drop onto the frame tubes below', onclick: () => { const r = snapPartToFloor(store, part.id, A.segs); toast(r.floor ? `Resting on frame (moved ${fmtLen(r.dz)})` : 'No frame tube below the part', r.floor ? 'ok' : 'warn'); } }, icon('floor', 12), 'Rest on frame');

  const driver = driverSection(ctx, A);

  const seat = section('Seat', h('div', { class: 'stack' },
    componentRow(ctx, 'seat', 'Seat', {
      extra: (part, p) => h('div', { class: 'stack' },
        row('Material', selectField({ id: 'seat-mat', value: p.material, options: Object.entries(SEAT_MATERIALS).map(([value, m]) => ({ value, label: m.label })), onChange: setParam(part, 'material', 'Seat material') })),
        h('div', { class: 'grid2' },
          row('Recline', numField({ id: 'seat-rec', value: p.recline, kind: 'ang', step: 1, onCommit: setParam(part, 'recline', 'Seat recline') })),
          row('Width', numField({ id: 'seat-w', value: p.width, step: 0.25, onCommit: setParam(part, 'width', 'Seat width') }))),
        h('div', { class: 'grid2' },
          row('Seat X', numField({ id: 'seat-x', value: part.pos[0], step: 0.25, onCommit: (v) => store.commit('Seat position', (s) => { s.parts[part.id].pos[0] = v; }) })),
          row('Seat Z', numField({ id: 'seat-z', value: part.pos[2], step: 0.25, onCommit: (v) => store.commit('Seat height', (s) => { s.parts[part.id].pos[2] = v; }) }))),
        h('div', { class: 'btn-row' }, rest(part))),
    })), { id: 'erg-seat' });

  const pedals = section('Pedals & controls', h('div', { class: 'stack' },
    componentRow(ctx, 'brakePedal', 'Brake pedal', {
      extra: (part, p) => h('div', { class: 'stack' },
        h('div', { class: 'grid2' },
          row('Pedal ratio', numField({ id: 'bp-ratio', value: p.pedalRatio, kind: 'num', unit: ':1', step: 0.1, onCommit: setParam(part, 'pedalRatio', 'Pedal ratio') })),
          row('Master cyl.', selectField({ id: 'bp-mc', value: p.mcCount, options: [{ value: 2, label: '2 (split)' }, { value: 1, label: '1' }], onChange: setParam(part, 'mcCount', 'Master cylinders') }))),
        h('div', { class: 'grid2' },
          row('Pedal X', numField({ id: 'bp-x', value: part.pos[0], step: 0.25, onCommit: (v) => store.commit('Brake pedal position', (s) => { s.parts[part.id].pos[0] = v; }) })),
          row('Pedal Y', numField({ id: 'bp-y', value: part.pos[1], step: 0.25, onCommit: (v) => store.commit('Brake pedal position', (s) => { s.parts[part.id].pos[1] = v; }) }))),
        h('div', { class: 'btn-row' }, rest(part))),
    }),
    componentRow(ctx, 'throttlePedal', 'Throttle pedal', {
      extra: (part) => h('div', { class: 'grid2' },
        row('Pedal X', numField({ id: 'tp-x', value: part.pos[0], step: 0.25, onCommit: (v) => store.commit('Throttle pedal position', (s) => { s.parts[part.id].pos[0] = v; }) })),
        row('Pedal Y', numField({ id: 'tp-y', value: part.pos[1], step: 0.25, onCommit: (v) => store.commit('Throttle pedal position', (s) => { s.parts[part.id].pos[1] = v; }) }))),
    }),
    componentRow(ctx, 'steeringWheel', 'Steering wheel', {
      extra: (part) => h('div', { class: 'grid2' },
        row('Wheel Z', numField({ id: 'sw-z', value: part.pos[2], step: 0.25, onCommit: (v) => store.commit('Steering wheel height', (s) => { s.parts[part.id].pos[2] = v; }) })),
        row('Column tilt', numField({ id: 'sw-tilt', value: part.rot[1], kind: 'ang', step: 1, onCommit: (v) => store.commit('Steering column tilt', (s) => { s.parts[part.id].rot[1] = v; }) }))),
    }),
    componentRow(ctx, 'harness', '5-point harness', { swap: false }),
  ), { id: 'erg-pedals' });

  let results = null;
  if (e?.pose) {
    const helmet = e.clearances.find((c) => c.name === 'helmet');
    const worst = e.clearances.filter((c) => c.name !== 'helmet').sort((a, b) => a.dist - b.dist)[0];
    const legs = e.pose.legs, arms = e.pose.arms;
    const cls = (bad, warn) => (bad ? 'bad' : warn ? 'warn' : 'ok');
    results = section(`Fit & reach · ${e.driver.label}`, kv([
      ['Helmet → cage', `${fmtLen(helmet?.dist)} (${helmet?.member})`, cls(helmet?.dist < 6)],
      ['Tightest body clearance', `${worst?.name} ${fmtLen(worst?.dist)} (${worst?.member})`, cls(worst?.dist < 0, worst?.dist < 3)],
      ['Knee angle L / R', `${fmtAngle(legs.L.angle, 0)} / ${fmtAngle(legs.R.angle, 0)}`, cls(false, Math.min(legs.L.angle, legs.R.angle) < 95)],
      ['Leg reach L / R', `${fmtPct(legs.L.reach * 100)} / ${fmtPct(legs.R.reach * 100)}`, cls(Math.max(legs.L.reach, legs.R.reach) > 0.98, Math.max(legs.L.reach, legs.R.reach) > 0.95)],
      ['Elbow angle L / R', `${fmtAngle(arms.L.angle, 0)} / ${fmtAngle(arms.R.angle, 0)}`, cls(false, Math.min(arms.L.angle, arms.R.angle) < 70)],
      e.kneeWheel != null ? ['Knee → steering wheel', fmtLen(e.kneeWheel), cls(false, e.kneeWheel < 1)] : null,
      e.seatFit ? ['Seat width vs hips', `${fmtLen(e.seatFit.seatWidth)} seat · ${fmtLen(e.seatFit.hipWidth)} hips${e.seatFit.measured ? '' : ' (est.)'}`, cls(false, e.seatFit.tight)] : null,
      ['Eye height', fmtLen(e.pose.eye.z)],
      ['Outside frame', e.outside.length ? e.outside.join(', ') : 'None', cls(e.outside.length > 0)],
    ]), { id: 'erg-fit' });
  }

  // How every driver on the roster fits, side by side.
  const posed = (A.ergoAll || []).filter((x) => x.pose);
  const everyone = posed.length > 1 ? section('Every driver', h('div', { class: 'stack' },
    h('div', { class: 'table-wrap' }, h('table', { class: 'tbl fit' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Driver'), h('th', {}, 'Helmet'), h('th', {}, 'Body'), h('th', {}, 'Legs'), h('th', {}, 'Seat'))),
      h('tbody', {}, posed.map((x) => {
        const f = fitOf(x);
        const on = x.driver.id === st.ergonomics.driverId;
        return h('tr', { class: `click ${on ? 'sel' : ''}`, title: on ? 'Posed in the car' : `Pose ${x.driver.label}`, onclick: () => { if (!on) store.commit(`Pose ${x.driver.label}`, (s) => { s.ergonomics.driverId = x.driver.id; }); } },
          h('td', {}, x.driver.label),
          h('td', { class: `num ${f.lv.helmet}` }, fmtLen(f.helmet?.dist, { precision: 1 })),
          h('td', { class: `num ${f.lv.body}` }, fmtLen(f.body?.dist, { precision: 1 })),
          h('td', { class: `num ${f.lv.reach}` }, f.reach != null ? fmtPct(f.reach * 100) : '—'),
          h('td', { class: `num ${f.lv.seat}` }, fmtLen(f.seat?.margin, { precision: 1 })));
      })))),
    h('p', { class: 'muted small' }, 'Helmet and body: clearance to the nearest tube (6 in and 3 in needed). Legs: share of leg length the pedals need. Seat: seat width minus hip width (padding allows about −0.5 in). Click a driver to pose them.'),
  ), { id: 'erg-every' }) : null;

  const routes = A.routes?.routes || [];
  const routing = section('Brake lines & throttle cable', h('div', { class: 'stack' },
    h('p', { class: 'muted small' }, 'Routed automatically along the frame from the pedals to the calipers and the engine governor. The router takes the shortest path, prefers low tubes, keeps clear of the exhaust, and places the brake tee where total line length is smallest. Flex hose covers the moving suspension.'),
    checkField({ id: 'route-heat', checked: st.routing.avoidHeat !== false, label: 'Keep lines away from the exhaust', onChange: (v) => store.commit('Routing heat avoidance', (s) => { s.routing.avoidHeat = v; }) }),
    checkField({ id: 'route-show', checked: ui.layers.routing, label: 'Show routes', onChange: (v) => store.setUI({ layers: { ...ui.layers, routing: v } }) }),
    routes.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Line'), h('th', {}, 'Hard / cable'), h('th', {}, 'Flex'), h('th', {}, 'Notes'))),
      h('tbody', {}, routes.map((r) => h('tr', { class: 'click', onclick: () => store.select({ kind: 'route', id: r.id }) },
        h('td', {}, h('i', { class: `swatch ${r.kind}` }), r.label),
        h('td', { class: 'num' }, r.ok ? fmtLen(r.kind === 'throttle' ? r.cable : r.hard, { precision: 1 }) : '—'),
        h('td', { class: 'num' }, r.ok && r.flex ? fmtLen(r.flex, { precision: 1 }) : '—'),
        h('td', {}, !r.ok ? pill('no path', 'bad') : r.kind === 'throttle' ? `${r.bends.count} bends` : `${r.tees} tee`)))))) : h('p', { class: 'muted' }, 'Add the brake pedal, throttle pedal and engine to route lines.'),
  ), { id: 'erg-routing' });

  return h('div', { class: 'panel-inner' },
    h('p', { class: 'panel-intro' }, 'Enter your team\'s drivers, pick the seat and its material, and place it and the pedals. The seated driver model updates with reach, clearance and routing. Select anything to fine-tune it in the inspector.'),
    driver, seat, pedals, results, everyone, routing,
    section('Ergonomics parts', categoryCards('ergonomics', ctx), { id: 'erg-lib', open: false }));
}
