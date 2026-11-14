import { h, icon, toast } from '../dom.js';
import { numField, selectField, checkField, row, section, kv, pill } from '../fields.js';
import { getDef, paramsOf } from '../../catalog/index.js';
import { componentRow } from './ergonomics.js';
import { categoryCards } from '../library.js';
import { fmtLen, fmtAngle, fmtNum } from '../../core/units.js';

const byRole = (st, role) => Object.values(st.parts).find((p) => getDef(p.def, st)?.role === role);

export function renderPowertrain(ctx) {
  const { store, analysis } = ctx;
  const st = store.state;
  const A = analysis();
  const pt = A.pt || {};
  const setParam = (part, key, label) => (v) => store.commit(label, (s) => { s.parts[part.id].params = { ...s.parts[part.id].params, [key]: v }; });

  const link = section('Integration', h('div', { class: 'stack' },
    checkField({ id: 'pt-link', checked: st.powertrain.autoLink, label: 'Auto-link gearbox → CVT → engine', onChange: (v) => store.commit('Powertrain auto-link', (s) => { s.powertrain.autoLink = v; for (const p of Object.values(s.parts)) if (!v && p.linked) p.linked = false; else if (v && p.linked === false && ['cvt', 'engine'].includes(getDef(p.def, s)?.role)) p.linked = true; }) }),
    h('p', { class: 'muted small' }, 'Place the gearbox; the CVT secondary rides on its input shaft at the center-line angle and the engine PTO sits in the CVT primary. CV half-shafts connect the gearbox outputs to the rear hubs automatically — add a front differential and enable the gearbox front output for a 4WD driveshaft.'),
  ), { id: 'pt-link' });

  const comps = section('Components', h('div', { class: 'stack' },
    componentRow(ctx, 'gearbox', 'Gearbox', {
      extra: (part, p) => h('div', { class: 'stack' },
        h('div', { class: 'grid2' },
          row('Ratio', numField({ id: 'gb-ratio', value: p.ratio, kind: 'num', unit: ':1', step: 0.1, onCommit: setParam(part, 'ratio', 'Gearbox ratio') })),
          row('Input angle', numField({ id: 'gb-ang', value: p.inputAngle, kind: 'ang', step: 1, onCommit: setParam(part, 'inputAngle', 'Gearbox input angle') }))),
        h('div', { class: 'grid2' },
          row('Output X', numField({ id: 'gb-x', value: part.pos[0], step: 0.25, onCommit: (v) => store.commit('Gearbox position', (s) => { s.parts[part.id].pos[0] = v; }) })),
          row('Output Z', numField({ id: 'gb-z', value: part.pos[2], step: 0.25, onCommit: (v) => store.commit('Gearbox position', (s) => { s.parts[part.id].pos[2] = v; }) }))),
        h('div', { class: 'btn-row wrap' },
          h('button', { class: 'btn tiny', type: 'button', onclick: () => { const wc = st.suspension.rear.points.WC; store.commit('Align gearbox to rear axle', (s) => { s.parts[part.id].pos = [wc[0], 0, wc[2]]; }); toast('Gearbox output on the rear-axle line', 'ok'); } }, 'Align output with rear axle'),
          checkField({ id: 'gb-front', checked: p.frontOutput, label: '4WD front output', onChange: setParam(part, 'frontOutput', 'Gearbox front output') }))),
    }),
    componentRow(ctx, 'cvt', 'CVT', {
      extra: (part, p) => h('div', { class: 'grid2' },
        row('Center-line angle', numField({ id: 'cvt-ang', value: p.angle, kind: 'ang', step: 1, onCommit: setParam(part, 'angle', 'CVT angle') })),
        row('Center distance', numField({ id: 'cvt-cd', value: p.centerDistance, step: 0.125, onCommit: setParam(part, 'centerDistance', 'CVT center distance') }))),
    }),
    componentRow(ctx, 'engine', 'Engine', {
      extra: (part, p) => h('div', { class: 'grid2' },
        row('Governed rpm', numField({ id: 'eng-rpm', value: p.governedRpm, kind: 'num', unit: 'rpm', step: 50, onCommit: setParam(part, 'governedRpm', 'Engine rpm') })),
        row('Torque', numField({ id: 'eng-tq', value: p.torque, kind: 'num', unit: 'ft·lb', step: 0.1, onCommit: setParam(part, 'torque', 'Engine torque') }))),
    }),
    componentRow(ctx, 'fuelTank', 'Fuel tank', {
      extra: (part, p) => h('div', { class: 'grid2' },
        row('Capacity', numField({ id: 'tank-cap', value: p.capacity, kind: 'num', unit: 'gal', step: 0.05, onCommit: setParam(part, 'capacity', 'Fuel capacity') })),
        row('Material', selectField({ id: 'tank-mat', value: p.material, options: [{ value: 'aluminum', label: 'Aluminum' }, { value: 'hdpe', label: 'HDPE' }], onChange: setParam(part, 'material', 'Fuel tank material') }))),
    }),
    componentRow(ctx, 'frontDiff', 'Front differential (optional, 4WD)', { swap: false }),
    componentRow(ctx, 'airFilter', 'Remote air filter (optional)', { swap: false }),
  ), { id: 'pt-comps' });

  const g = pt.gearing;
  const gearing = g ? section('Gearing & performance', kv([
    ['Overall ratio (low → high)', `${fmtNum(g.low, 1)} : 1 → ${fmtNum(g.high, 1)} : 1`],
    ['Theoretical top speed', `${fmtNum(g.topSpeed, 1)} mph`],
    ['Launch wheel torque (total)', `${fmtNum(g.launchTorque, 0)} ft·lb`],
    ['Launch tractive force', `${fmtNum(g.tractive, 0)} lbf`],
    A.mass?.total ? ['Tractive force ÷ weight', `${fmtNum(g.tractive / A.mass.total, 2)} g`] : null,
    ['Assumed driveline efficiency', `${Math.round(g.eff * 100)}%`],
  ]), { id: 'pt-gear' }) : null;

  const cvRow = (cv, name) => [`${name} ${cv.side === 'L' ? 'left' : 'right'}`, `${fmtLen(cv.length)} · plunge ${fmtLen(cv.plunge)} · ${fmtAngle(Math.max(cv.staticIn, cv.staticOut))} static / ${fmtAngle(Math.max(cv.maxIn, cv.maxOut))} max`, Math.max(cv.maxIn, cv.maxOut) > 30 ? 'warn' : ''];
  const shafts = (pt.cv?.length || pt.driveshaft) ? section('Half-shafts & driveshaft', kv([
    ...(pt.cv || []).map((cv) => cvRow(cv, 'Rear CV')),
    ...(pt.frontCv || []).map((cv) => cvRow(cv, 'Front CV')),
    pt.driveshaft ? ['Driveshaft', `${fmtLen(pt.driveshaft.length)} · ${fmtAngle(pt.driveshaft.angle)} to car axis`] : null,
  ]), { id: 'pt-cv' }) : null;

  return h('div', { class: 'panel-inner' },
    h('p', { class: 'panel-intro' }, 'Place the engine, CVT, gearbox, fuel tank and drivetrain. Linked parts snap together; checks flag CV angles, fuel-tank placement, firewall and envelope problems.'),
    link, comps, gearing, shafts,
    section('Powertrain parts', categoryCards('powertrain', ctx), { id: 'pt-lib', open: false }));
}

export { byRole, paramsOf, pill, icon };
