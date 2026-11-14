// Chassis ▸ Stress tests: run Baja impact cases on the frame, view results,
// add custom impact points, and unlock integration when the frame passes.
import { h, icon, toast } from '../dom.js';
import { numField, selectField, checkField, row, section, kv, pill } from '../fields.js';
import { CASES, DIRECTIONS, allCases, runStressTests, summarize, lastResults, stressStatus, chassisHash, gateLocked } from '../../systems/stresstest.js';
import { roleInfo } from '../../catalog/materials.js';
import { fmtLen, fmtNum, fmtWeight } from '../../core/units.js';
import { nextId } from '../../core/store.js';

const ksi = (psi) => `${fmtNum(psi / 1000, 1)} ksi`;
const fosText = (v) => (Number.isFinite(v) ? fmtNum(v, 2) : '∞');

export function runAndRecord(ctx, { quiet = false } = {}) {
  const { store } = ctx;
  const wasLocked = gateLocked(store.state);
  const run = runStressTests(store.state);
  const summary = summarize(run);
  store.apply('Stress test', (st) => {
    st.stress.last = summary;
    if (run.pass) st.workflow = { ...(st.workflow || {}), unlocked: true };
  });
  const worst = run.cases.filter((c) => c.ok).sort((a, b) => a.minFos - b.minFos)[0];
  const firstFail = run.cases.find((c) => !c.pass);
  store.setUI({ stressView: { ...store.ui.stressView, on: true, caseKey: (firstFail || worst || run.cases[0])?.key ?? null } });
  if (!quiet) {
    const fails = run.cases.filter((c) => !c.pass).length;
    if (!run.cases.length) toast('Turn on at least one load case', 'warn');
    else if (run.pass) toast(wasLocked ? `All ${run.cases.length} cases pass — suspension, ergonomics and powertrain are unlocked` : `All ${run.cases.length} cases pass`, 'ok', 4200);
    else toast(`${fails} of ${run.cases.length} cases fail — the red tubes need attention`, 'bad', 4200);
  }
  return run;
}

function statusCard(ctx) {
  const { store } = ctx;
  const st = store.state;
  const status = stressStatus(st);
  const last = st.stress.last;
  const locked = gateLocked(st);
  const fails = last ? last.cases.filter((c) => !c.pass) : [];
  const worst = last ? last.cases.filter((c) => c.ok).sort((a, b) => a.minFos - b.minFos)[0] : null;
  const text = {
    none: ['Not tested yet', 'Run the stress tests to check this frame against Baja impacts.'],
    stale: ['Frame changed since the last test', 'Re-run the stress tests to check the current frame.'],
    pass: [`Passes all ${last?.cases.length} cases`, worst ? `Lowest factor of safety ${fmtNum(worst.minFos, 2)} in ${worst.name.toLowerCase()} (${worst.minFosMember}).` : ''],
    fail: [`Fails ${fails.length} of ${last?.cases.length} cases`, fails.map((c) => `${c.name}${c.ok ? ` (FoS ${fmtNum(c.minFos, 2)})` : ''}`).join(' · ')],
  }[status];
  return h('div', { class: `stress-status ${status}` },
    h('div', { class: 'ss-title' }, icon(status === 'pass' ? 'target' : 'warn', 16), text[0]),
    h('div', { class: 'ss-detail' }, text[1]),
    locked ? h('div', { class: 'ss-gate' }, icon('lock', 14), 'Suspension, ergonomics and powertrain unlock once this frame passes.') : null,
    status !== 'stale' && last?.left?.length ? h('div', { class: 'ss-gate' }, icon('warn', 14), `${last.left.length === 1 ? '1 tube isn\'t' : `${last.left.length} tubes aren't`} connected to the main frame and ${last.left.length === 1 ? 'was' : 'were'} left out: ${last.left.slice(0, 6).join(', ')}${last.left.length > 6 ? '…' : ''}.`) : null,
    h('div', { class: 'btn-row wrap' },
      h('button', { class: 'btn primary', type: 'button', disabled: !Object.keys(st.chassis.members).length, onclick: () => runAndRecord(ctx) }, icon('play', 14), status === 'none' ? 'Run stress tests' : 'Re-run stress tests'),
      last ? h('span', { class: 'muted small' }, `Last run ${new Date(last.ranAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })} · ${fmtWeight(last.mass, 0)} design mass`) : null));
}

function casesSection(ctx) {
  const { store } = ctx;
  const st = store.state;
  const run = lastResults(chassisHash(st));
  const view = store.ui.stressView;
  const setCase = (key, patch) => store.commit('Load case', (s) => { s.stress.cases[key] = { ...s.stress.cases[key], ...patch }; });
  const setCustom = (id, patch) => store.commit('Custom impact', (s) => { const c = s.stress.custom.find((x) => x.id === id); Object.assign(c, patch); });
  const rows = allCases(st).map(({ def, cfg, enabled }) => {
    const res = run?.cases.find((c) => c.key === def.key);
    const sel = view.caseKey === def.key;
    const loadField = def.kind === 'torsion'
      ? numField({ id: `case-${def.key}-t`, value: cfg.torque ?? def.torque, kind: 'num', unit: 'lb·ft', step: 100, onCommit: (v) => setCase(def.key, { torque: v }) })
      : numField({ id: `case-${def.key}-g`, value: cfg.g ?? def.g, kind: 'num', unit: 'g', step: 0.5, onCommit: (v) => (def.custom ? setCustom(def.key, { g: v }) : setCase(def.key, { g: v })) });
    return h('tr', { class: `${sel ? 'sel' : ''} ${res ? 'click' : ''}`, onclick: (e) => { if (res && !e.target.closest('input,button,label')) store.setUI({ stressView: { ...view, on: true, caseKey: def.key } }); } },
      h('td', {}, h('input', { type: 'checkbox', id: `case-${def.key}-on`, checked: enabled, 'aria-label': `Run ${def.name}`, onchange: (e) => (def.custom ? setCustom(def.key, { enabled: e.target.checked }) : setCase(def.key, { enabled: e.target.checked })) })),
      h('td', { title: def.blurb }, h('div', { class: 'case-name' }, def.name), h('div', { class: 'case-blurb' }, def.blurb)),
      h('td', { class: 'case-load' }, loadField),
      h('td', { class: 'case-res' }, !res ? h('span', { class: 'muted' }, '—')
        : !res.ok ? pill('error', 'bad')
          : pill(`FoS ${fosText(res.minFos)}`, res.pass ? 'ok' : 'bad')),
      h('td', {}, def.custom ? h('button', { class: 'icon-btn small', type: 'button', title: 'Remove this impact', onclick: () => store.commit('Remove custom impact', (s) => { s.stress.custom = s.stress.custom.filter((c) => c.id !== def.key); }) }, icon('trash', 14)) : null));
  });

  // custom impact at the current selection
  const sel = store.ui.selection;
  const target = sel?.kind === 'node' && st.chassis.nodes[sel.id] ? { kind: 'node', id: sel.id }
    : sel?.kind === 'member' && st.chassis.members[sel.id] && !sel.ids ? { kind: 'member', id: sel.id } : null;
  const draft = (store.ui.impactDraft ??= { dir: 'front', g: 4 });
  const addCustom = h('div', { class: 'custom-impact' },
    h('div', { class: 'sub-head' }, 'Add an impact point'),
    h('p', { class: 'muted small' }, target ? `At ${target.kind === 'node' ? 'joint' : 'the middle of tube'} ${target.id}.` : 'Select a joint or tube in the 3D view, then choose where the hit comes from.'),
    h('div', { class: 'grid2' },
      row('Direction', selectField({ id: 'imp-dir', value: draft.dir, options: DIRECTIONS.map((d) => ({ value: d.key, label: d.label })), onChange: (v) => { draft.dir = v; } })),
      row('Load', numField({ id: 'imp-g', value: draft.g, kind: 'num', unit: 'g', step: 0.5, onCommit: (v) => { draft.g = v; } }))),
    h('button', { class: 'btn', type: 'button', disabled: !target, onclick: () => {
      const d = DIRECTIONS.find((x) => x.key === draft.dir);
      store.commit('Add custom impact', (s) => {
        s.stress.custom.push({ id: nextId(s, 'IMP'), name: `Impact at ${target.id} · ${d.label.replace(/ \(.*\)/, '').toLowerCase()}`, target, dir: d.dir, g: draft.g, enabled: true });
      });
      toast('Impact added — run the tests to see it', 'ok');
    } }, icon('plus', 14), 'Add impact here'));

  return section('Load cases', h('div', { class: 'stack' },
    h('div', { class: 'table-wrap' }, h('table', { class: 'tbl cases' }, h('thead', {}, h('tr', {}, h('th', {}), h('th', {}, 'Case'), h('th', {}, 'Load'), h('th', {}, 'Result'), h('th', {}))), h('tbody', {}, rows))),
    addCustom), { id: 'st-cases' });
}

function resultsSection(ctx) {
  const { store, interaction } = ctx;
  const st = store.state;
  const run = lastResults(chassisHash(st));
  if (!run) return null;
  const view = store.ui.stressView;
  const c = run.cases.find((x) => x.key === view.caseKey) || run.cases[0];
  if (!c) return null;
  const select = (id) => { store.select({ kind: 'member', id }); interaction.focusSelection(); };
  const link = (id) => (id ? h('button', { class: 'link mono', type: 'button', onclick: () => select(id) }, id) : '—');
  if (!c.ok) return section(`Results · ${c.name}`, h('p', { class: 'note bad' }, c.error), { id: 'st-results' });
  const worst = Object.entries(c.res.members).sort((a, b) => a[1].fos - b[1].fos).slice(0, 6);
  const settings = run.settings;
  const scale = view.scale ?? 1;
  const slider = h('input', { type: 'range', class: 'range', id: 'st-scale', min: 0, max: 3, step: 0.1, value: scale, 'aria-label': 'Deformation exaggeration' });
  slider.addEventListener('input', () => { store.ui.stressView = { ...store.ui.stressView, scale: Number(slider.value) }; ctx.refreshStress(); });
  return section(`Results · ${c.name}`, h('div', { class: 'stack' },
    h('p', { class: 'muted small' }, c.setup.note),
    kv([
      c.key !== 'torsion' ? ['Applied load', `${fmtNum(c.totalForce, 0)} lbf over ${c.setup.points.length} point${c.setup.points.length === 1 ? '' : 's'}`] : ['Applied torque', `${fmtNum(c.setup.torqueInLb / 12, 0)} lb·ft`],
      ['Held joints', String(c.setup.supports.length)],
      ['Lowest FoS · yield', h('span', {}, `${fosText(c.minFos)} at `, link(c.minFosMember)), c.minFos >= settings.fosYield ? 'ok' : 'bad'],
      ['Lowest FoS · buckling', h('span', {}, `${fosText(c.minBuck)} at `, link(c.minBuckMember)), c.minBuck >= settings.fosBuckling ? 'ok' : 'bad'],
      ['Peak von Mises stress', ksi(c.maxVm)],
      ['Largest deflection', `${fmtLen(c.maxDisp)} at ${c.maxDispNode}`],
      c.torsionK ? ['Torsional stiffness', `${fmtNum(c.torsionK, 0)} lb·ft/deg`] : null,
    ]),
    h('div', { class: 'sub-head' }, 'Most-stressed tubes'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Tube'), h('th', {}, 'Role'), h('th', {}, 'FoS'), h('th', {}, 'σ vm'), h('th', {}, 'Axial'))),
      h('tbody', {}, worst.map(([id, r]) => h('tr', { class: 'click', onclick: () => select(id) },
        h('td', { class: 'mono' }, id),
        h('td', {}, roleInfo(st.chassis.members[id]?.role).key),
        h('td', { class: `num ${r.fos < settings.fosYield ? 'bad' : ''}` }, fosText(r.fos)),
        h('td', { class: 'num' }, ksi(r.vm)),
        h('td', { class: 'num' }, `${fmtNum(Math.abs(r.N), 0)} ${r.N < 0 ? 'C' : 'T'}`)))))),
    checkField({ id: 'st-colors', checked: view.on, label: 'Color tubes by factor of safety', onChange: (v) => store.setUI({ stressView: { ...view, on: v } }) }),
    row('Exaggerate deflection', slider, { hint: 'Shows the deflected shape, scaled up so it is visible' }),
  ), { id: 'st-results' });
}

function settingsSection(ctx) {
  const { store, analysis } = ctx;
  const s = store.state.stress.settings;
  const set = (k, label) => (v) => store.commit(label, (st) => { st.stress.settings[k] = v; });
  const A = analysis();
  const est = A.mass?.total && !gateLocked(store.state) ? A.mass.total : null;
  return section('Test settings', h('div', { class: 'stack' },
    row('Design mass', numField({ id: 'st-mass', value: s.mass, kind: 'num', unit: 'lb', step: 10, onCommit: set('mass', 'Design mass') }), { hint: 'Vehicle + driver. Impact loads are g × this mass.' }),
    est ? h('button', { class: 'btn tiny', type: 'button', onclick: () => set('mass', 'Design mass')(Math.round(est)) }, `Use current estimate (${fmtWeight(est, 0)})`) : null,
    h('div', { class: 'grid2' },
      row('Target FoS · yield', numField({ id: 'st-fy', value: s.fosYield, kind: 'num', unit: '', step: 0.1, onCommit: set('fosYield', 'Target FoS') })),
      row('Target FoS · buckling', numField({ id: 'st-fb', value: s.fosBuckling, kind: 'num', unit: '', step: 0.1, onCommit: set('fosBuckling', 'Buckling target') }))),
    row('Buckling end condition', selectField({ id: 'st-k', value: s.K, options: [{ value: 1.0, label: 'Pinned (K = 1.0, conservative)' }, { value: 0.8, label: 'Partly fixed (K = 0.8)' }, { value: 0.65, label: 'Welded both ends (K = 0.65)' }], onChange: set('K', 'Buckling end condition') })),
  ), { id: 'st-settings', open: false });
}

function methodSection() {
  return section('How the test works', h('div', { class: 'stack small' },
    h('p', {}, 'Each tube is modeled as a beam with its real tube section and material, joints are rigid welds, and the frame is solved as a linear static 3D structure.'),
    h('p', {}, 'Impacts apply g × design mass to the impact face (side impacts: a 15 in bumper patch at mid-cockpit). The far 20 % of the frame is held, standing in for the car\'s own inertia. Landing and torsion load the front suspension mounts and hold the rear ones.'),
    h('p', {}, 'Factor of safety = yield strength ÷ von Mises stress (axial + bending + torsion + shear). Buckling uses Euler\'s formula on the full tube length.'),
    h('p', { class: 'muted' }, 'Real impacts are dynamic and joints concentrate stress. Use this to compare designs and find weak tubes early, then confirm the final frame with full FEA (ANSYS, SolidWorks Simulation).')), { id: 'st-method', open: false });
}

export function renderStress(ctx) {
  return h('div', { class: 'stack' }, statusCard(ctx), resultsSection(ctx), casesSection(ctx), settingsSection(ctx), methodSection());
}

export { CASES };
