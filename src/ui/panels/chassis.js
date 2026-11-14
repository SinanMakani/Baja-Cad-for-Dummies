import { h, icon, toast, confirmDialog, textExport, modal } from '../dom.js';
import { numField, selectField, checkField, row, section, kv, pill, textField } from '../fields.js';
import { MEMBER_ROLES, MATERIALS, profileProps, primaryEquivalency, secondaryOk, roleInfo } from '../../catalog/materials.js';
import { memberInfo, chassisStats } from '../../systems/chassis.js';
import { buildStarterFrame } from '../../core/defaults.js';
import { cutListCSV } from '../../core/commands.js';
import { categoryCards } from '../library.js';
import { fmtLen, fmtWeight, fmtFt, fmtNum } from '../../core/units.js';
import { V, fromAzEl, arr } from '../../core/geom.js';
import { nextId } from '../../core/store.js';
import { renderStress } from './stress.js';
import { renderCadImport, session as cadSession } from './cadImport.js';
import { gateLocked, stressStatus } from '../../systems/stresstest.js';

const TOOLS = [
  { key: 'select', icon: 'select', label: 'Select', kbd: 'V' },
  { key: 'node', icon: 'node', label: 'Node', kbd: 'N' },
  { key: 'tube', icon: 'tube', label: 'Tube', kbd: 'T' },
  { key: 'split', icon: 'split', label: 'Split', kbd: 'S' },
  { key: 'measure', icon: 'measure', label: 'Measure', kbd: 'M' },
];

export const TOOL_HINTS = {
  select: 'Click a tube, joint or part to inspect it. Drag the gizmo to move. Shift+click tubes to multi-select.',
  node: 'Click the work plane to drop a joint. Grid and mirror snapping apply.',
  tube: 'Click joints or grid points to chain tubes point by point. Shift = angle snap. Type exact lengths/angles in the panel. Esc or right-click ends the chain.',
  split: 'Click a tube to add a joint on it (snaps along the tube to the grid step).',
  measure: 'Click two points (joints, hardpoints, surfaces). Esc clears.',
};

function exactInput(ctx) {
  const { store, interaction } = ctx;
  const st = store.state, ui = store.ui;
  const from = ui.drawing?.from && st.chassis.nodes[ui.drawing.from];
  const mode = ui.exactMode || 'polar';
  const draft = (ui.exactDraft ??= { len: 12, el: 0, az: 0, dx: 12, dy: 0, dz: 0, x: 0, y: 0, z: 10 });
  const set = (k) => (v) => { draft[k] = v; };
  const place = () => {
    let p;
    if (!from || mode === 'abs') p = [draft.x, draft.y, draft.z];
    else if (mode === 'polar') p = arr(V(from.p).addScaledVector(fromAzEl(draft.az, draft.el), draft.len));
    else p = [from.p[0] + draft.dx, from.p[1] + draft.dy, from.p[2] + draft.dz];
    const id = interaction.drawTo(p.map((v) => +v.toFixed(4)));
    toast(from ? `Tube to ${id}` : `Chain starts at ${id}`, 'ok', 1400);
  };
  const modes = h('div', { class: 'seg' }, [['polar', 'Length + angles'], ['delta', 'ΔX ΔY ΔZ'], ['abs', 'X Y Z']].map(([k, l]) =>
    h('button', { type: 'button', class: `seg-btn ${mode === k ? 'active' : ''}`, disabled: !from && k !== 'abs', onclick: () => store.setUI({ exactMode: k }) }, l)));
  const eff = from ? mode : 'abs';
  const fields = eff === 'polar'
    ? [row('Length', numField({ id: 'ex-len', value: draft.len, onCommit: set('len'), step: 0.25 })),
      row('Elevation', numField({ id: 'ex-el', value: draft.el, kind: 'ang', onCommit: set('el'), step: 5 }), { hint: 'Up from horizontal (+) or down (−)' }),
      row('Plan angle', numField({ id: 'ex-az', value: draft.az, kind: 'ang', onCommit: set('az'), step: 5 }), { hint: '0° = forward (+X), 90° = left (+Y), 180° = rearward' })]
    : eff === 'delta'
      ? [row('ΔX (fwd)', numField({ id: 'ex-dx', value: draft.dx, onCommit: set('dx'), step: 0.25 })), row('ΔY (left)', numField({ id: 'ex-dy', value: draft.dy, onCommit: set('dy'), step: 0.25 })), row('ΔZ (up)', numField({ id: 'ex-dz', value: draft.dz, onCommit: set('dz'), step: 0.25 }))]
      : [row('X', numField({ id: 'ex-x', value: draft.x, onCommit: set('x'), step: 0.25 })), row('Y', numField({ id: 'ex-y', value: draft.y, onCommit: set('y'), step: 0.25 })), row('Z', numField({ id: 'ex-z', value: draft.z, onCommit: set('z'), step: 0.25 }))];
  const form = h('form', { class: 'stack', onsubmit: (e) => { e.preventDefault(); document.activeElement?.blur?.(); setTimeout(place, 0); } },
    h('div', { class: 'from-line' }, from ? [h('span', { class: 'muted' }, 'From '), h('b', {}, ui.drawing.from), h('span', { class: 'mono muted' }, ` (${from.p.map((v) => v.toFixed(2)).join(', ')})`)] : h('span', { class: 'muted' }, 'Click a joint to start from it, or type a start point.')),
    modes, fields,
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn primary', type: 'submit' }, from ? 'Place next point' : 'Start chain here'),
      from ? h('button', { class: 'btn', type: 'button', onclick: () => interaction.finishChain() }, 'End chain') : null));
  return section('Exact input', form, { id: 'ch-exact' });
}

function profilesSection(ctx) {
  const { store } = ctx;
  const st = store.state;
  const rows = Object.entries(st.chassis.profiles).map(([id, p]) => {
    const pr = profileProps(p);
    const eq = primaryEquivalency(p);
    return h('tr', {},
      h('td', {}, p.name),
      h('td', { class: 'num' }, `${fmtNum(pr.linearWeight * 12, 3)}`),
      h('td', {}, eq.ok ? pill('Primary OK', 'ok') : secondaryOk(p) ? pill('Secondary', 'info') : pill('Below min', 'warn')),
      h('td', {}, h('button', { class: 'btn tiny', type: 'button', onclick: () => editProfile(ctx, id) }, 'Edit')));
  });
  return section('Tube profiles', h('div', { class: 'stack' },
    h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', {}, 'Profile'), h('th', {}, 'lb/ft'), h('th', {}, 'Baja check'), h('th', {}))), h('tbody', {}, rows))),
    h('button', { class: 'btn', type: 'button', onclick: () => editProfile(ctx, null) }, icon('plus', 14), 'New profile')), { id: 'ch-profiles', open: false });
}

function editProfile(ctx, id) {
  const { store } = ctx;
  const cur = id ? { ...store.state.chassis.profiles[id] } : { name: '1.125 × 0.065 4130', material: '4130', od: 1.125, wall: 0.065 };
  const preview = h('div', {});
  const update = () => {
    const pr = profileProps(cur), eq = primaryEquivalency(cur);
    preview.replaceChildren(kv([
      ['ID', fmtLen(pr.id)], ['Area', `${fmtNum(pr.A, 4)} in²`], ['I', `${fmtNum(pr.I, 5)} in⁴`], ['Weight', `${fmtNum(pr.linearWeight * 12, 3)} lb/ft`],
      ['Bending stiffness vs 1.0×0.120 1018', `${(eq.stiffRatio * 100).toFixed(0)}%`, eq.stiffOk ? 'ok' : 'bad'],
      ['Bending strength vs 1.0×0.120 1018', `${(eq.strengthRatio * 100).toFixed(0)}%`, eq.strengthOk ? 'ok' : 'bad'],
      ['Primary member', eq.ok ? 'Meets equivalency' : 'Does not meet', eq.ok ? 'ok' : 'bad'],
    ]));
  };
  update();
  const body = h('div', { class: 'stack' },
    row('Name', textField({ id: 'pf-name', value: cur.name, onCommit: (v) => { cur.name = v; } })),
    row('Material', selectField({ id: 'pf-mat', value: cur.material, options: Object.entries(MATERIALS).map(([value, m]) => ({ value, label: m.name })), onChange: (v) => { cur.material = v; update(); } })),
    row('Outside Ø', numField({ id: 'pf-od', value: cur.od, step: 0.0625, onCommit: (v) => { cur.od = v; update(); } })),
    row('Wall', numField({ id: 'pf-wall', value: cur.wall, step: 0.001, onCommit: (v) => { cur.wall = v; update(); } })),
    preview);
  modal({
    title: id ? `Edit profile` : 'New tube profile', body,
    actions: [
      ...(id ? [{ label: 'Delete', danger: true, onClick: () => {
        const used = Object.values(store.state.chassis.members).some((m) => m.profile === id);
        if (used) { toast('That profile is used by tubes — reassign them first', 'warn'); return true; }
        store.commit('Delete profile', (st) => { delete st.chassis.profiles[id]; });
      } }] : []),
      { label: 'Cancel' },
      { label: 'Save', primary: true, onClick: () => {
        document.activeElement?.blur?.();
        if (!(cur.od > 0 && cur.wall > 0 && cur.wall < cur.od / 2)) { toast('Wall must be positive and less than half the OD', 'warn'); return true; }
        store.commit(id ? 'Edit profile' : 'Add profile', (st) => { st.chassis.profiles[id || nextId(st, 'PF')] = { ...cur }; });
      } },
    ],
  });
}

const MODES = [
  { key: 'build', label: 'Build frame', icon: 'tube' },
  { key: 'stress', label: 'Stress test', icon: 'target' },
  { key: 'import', label: 'Import CAD', icon: 'upload' },
];

function gateBanner(ctx) {
  const { store } = ctx;
  if (!gateLocked(store.state)) return null;
  const status = stressStatus(store.state);
  const steps = [
    ['Build or import the frame', Object.keys(store.state.chassis.members).length > 0],
    ['Pass the stress tests', status === 'pass'],
    ['Add suspension, ergonomics, powertrain', false],
  ];
  return h('div', { class: 'gate-banner' },
    h('div', { class: 'gb-title' }, icon('lock', 14), 'New frame — stress test before integrating'),
    h('ol', { class: 'gb-steps' }, steps.map(([t, done], i) => h('li', { class: done ? 'done' : i === steps.findIndex((s) => !s[1]) ? 'now' : '' }, t))),
    store.ui.chassisMode !== 'stress' ? h('button', { class: 'btn tiny', type: 'button', onclick: () => store.setUI({ chassisMode: 'stress' }) }, 'Go to stress tests') : null);
}

export function renderChassis(ctx) {
  const { store } = ctx;
  const mode = store.ui.chassisMode || 'build';
  const tabs = h('div', { class: 'mode-tabs', role: 'tablist', 'aria-label': 'Chassis mode' },
    MODES.map((m) => h('button', {
      class: `mode-tab ${mode === m.key ? 'active' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(mode === m.key),
      onclick: () => { if (m.key !== 'build' && store.ui.tool !== 'select') ctx.interaction.setTool('select'); store.setUI({ chassisMode: m.key }); },
    }, icon(m.icon, 15), m.label, m.key === 'import' && cadSession.raw ? h('i', { class: 'dot' }) : null)));
  const body = mode === 'stress' ? renderStress(ctx) : mode === 'import' ? renderCadImport(ctx) : renderBuild(ctx);
  return h('div', { class: 'panel-inner' }, tabs, gateBanner(ctx), body);
}

function renderBuild(ctx) {
  const { store, interaction, analysis } = ctx;
  const st = store.state, ui = store.ui;
  const A = analysis();
  const stats = A.chassis || chassisStats(st);

  const tools = h('div', { class: 'toolstrip', role: 'toolbar', 'aria-label': 'Chassis tools' },
    TOOLS.map((t) => h('button', {
      class: `tool ${ui.tool === t.key ? 'active' : ''}`, type: 'button', title: `${t.label} (${t.kbd})`, 'aria-pressed': String(ui.tool === t.key),
      onclick: () => interaction.setTool(t.key),
    }, icon(t.icon, 20), h('span', {}, t.label), h('kbd', {}, t.kbd))));

  const wp = ui.workPlane;
  const setWP = (patch) => { store.setUI({ workPlane: { ...wp, ...patch } }); interaction.overlays.setWorkPlane(store.ui.workPlane, ['tube', 'node'].includes(store.ui.tool)); };
  const drawing = section('Drawing setup', h('div', { class: 'stack' },
    row('Work plane', h('div', { class: 'seg' }, [['XZ', 'Side'], ['XY', 'Top'], ['YZ', 'Front']].map(([k, l]) =>
      h('button', { type: 'button', class: `seg-btn ${wp.axis === k ? 'active' : ''}`, title: `${l} plane (${k})`, onclick: () => setWP({ axis: k }) }, `${l} ${k}`)))),
    row(`Plane at ${wp.axis === 'XZ' ? 'Y' : wp.axis === 'XY' ? 'Z' : 'X'} =`, numField({ id: 'wp-off', value: wp.offset, step: 0.5, onCommit: (v) => setWP({ offset: v }) })),
    checkField({ id: 'wp-follow', checked: wp.follow, label: 'Plane follows the joint you draw from', onChange: (v) => setWP({ follow: v }) }),
    h('div', { class: 'grid2' },
      checkField({ id: 'snap-grid', checked: ui.snap.grid, label: 'Grid snap', onChange: (v) => store.setUI({ snap: { ...ui.snap, grid: v } }) }),
      checkField({ id: 'snap-nodes', checked: ui.snap.nodes, label: 'Snap to joints', onChange: (v) => store.setUI({ snap: { ...ui.snap, nodes: v } }) })),
    h('div', { class: 'grid2' },
      row('Grid step', numField({ id: 'snap-step', value: ui.snap.step, step: 0.125, onCommit: (v) => v > 0 && store.setUI({ snap: { ...ui.snap, step: v } }) })),
      row('Angle step', numField({ id: 'snap-ang', value: ui.snap.angle, kind: 'ang', step: 1, onCommit: (v) => v > 0 && store.setUI({ snap: { ...ui.snap, angle: v } }) }))),
    checkField({ id: 'mirror', checked: ui.mirror, label: 'Mirror across the centerline (edits both sides)', onChange: (v) => store.setUI({ mirror: v }) }),
    row('New tube profile', selectField({ id: 'act-prof', value: ui.activeProfile, options: Object.entries(st.chassis.profiles).map(([value, p]) => ({ value, label: p.name })), onChange: (v) => store.setUI({ activeProfile: v }) })),
    row('New tube role', selectField({ id: 'act-role', value: ui.activeRole, options: MEMBER_ROLES.map((r) => ({ value: r.key, label: `${r.label}${r.primary ? ' (primary)' : ''}` })), onChange: (v) => store.setUI({ activeRole: v }) })),
  ), { id: 'ch-draw' });

  const byProf = Object.values(stats.byProfile).map((v) => h('tr', {}, h('td', {}, v.profile.name), h('td', { class: 'num' }, v.count), h('td', { class: 'num' }, fmtFt(v.length)), h('td', { class: 'num' }, fmtWeight(v.weight))));
  const summary = section('Frame summary', h('div', { class: 'stack' },
    kv([['Tubes / joints', `${stats.members} / ${stats.nodes}`], ['Total tube length', `${fmtLen(stats.totalLength, { precision: 1 })} (${fmtFt(stats.totalLength)})`], ['Frame weight (bare tube)', fmtWeight(stats.weight)]]),
    byProf.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', {}, 'Stock'), h('th', {}, 'Pcs'), h('th', {}, 'Length'), h('th', {}, 'Weight'))), h('tbody', {}, byProf))) : null,
    h('div', { class: 'btn-row wrap' },
      h('button', { class: 'btn', type: 'button', onclick: () => textExport('Cut list', cutListCSV(st), 'cut-list.csv', 'text/csv') }, icon('download', 14), 'Cut list (CSV)'),
      h('button', { class: 'btn', type: 'button', onclick: async () => { if (await confirmDialog('Replace the current frame with the starter Baja frame? Parts and suspension stay as they are.', { ok: 'Load starter frame' })) store.commit('Load starter frame', (s) => buildStarterFrame(s)); } }, 'Load starter frame'),
      h('button', { class: 'btn danger-ghost', type: 'button', onclick: async () => {
        if (!(await confirmDialog('Delete every tube and joint and start a new frame from scratch? Suspension, ergonomics and powertrain will be locked until the new frame passes its stress tests. You can undo this.', { ok: 'Clear frame', danger: true }))) return;
        store.commit('Clear frame', (s) => {
          s.chassis.nodes = {}; s.chassis.members = {}; s.chassis.nodeLabels = {};
          s.workflow = { ...(s.workflow || {}), requireStressTest: s.workflow?.requireStressTest !== false, unlocked: false };
          s.stress.last = null;
        });
      } }, 'Clear frame')),
  ), { id: 'ch-sum' });

  const memberRows = Object.keys(st.chassis.members).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).map((id) => {
    const i = memberInfo(st, id);
    const sel = ui.selection?.kind === 'member' && (ui.selection.id === id || ui.selection.ids?.includes(id));
    return h('tr', { class: `click ${sel ? 'sel' : ''}`, onclick: (e) => { store.select({ kind: 'member', id }); if (e.detail > 1) interaction.focusSelection(); } },
      h('td', { class: 'mono' }, id), h('td', {}, i.m.role), h('td', { class: 'num' }, fmtLen(i.length)), h('td', {}, i.profile.name.split(' ').slice(0, 3).join(' ')));
  });
  const members = section('Tubes', h('div', { class: 'table-wrap tall' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', {}, 'Tube'), h('th', {}, 'Role'), h('th', {}, 'Length'), h('th', {}, 'Profile'))), h('tbody', {}, memberRows))), { id: 'ch-members', open: false, count: memberRows.length });

  return h('div', { class: 'stack' },
    tools,
    h('p', { class: 'tool-hint-inline' }, TOOL_HINTS[ui.tool]),
    ui.tool === 'tube' ? exactInput(ctx) : null,
    drawing, summary, profilesSection(ctx), members,
    section('Chassis parts', categoryCards('chassis', ctx), { id: 'ch-lib', open: false }));
}

export { roleInfo };
