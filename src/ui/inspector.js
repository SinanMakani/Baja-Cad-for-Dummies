// Right-hand inspector: details, measurements, specs and exact editing for
// whatever is selected. With nothing selected it shows the vehicle summary.
import { h, icon, iconBtn, toast, promptDialog } from './dom.js';
import { numField, selectField, checkField, row, section, kv, pill, xyzRow, textField } from './fields.js';
import { memberInfo, jointInfo, setMemberLength, setMemberDirection, setJointAngle, moveNode, splitMember, ensureMirrorNode } from '../systems/chassis.js';
import { MEMBER_ROLES, primaryEquivalency, secondaryOk, roleInfo, profileProps } from '../catalog/materials.js';
import { getDef, paramsOf, specsOf, weightOf, envelopeOf, CATEGORIES } from '../catalog/index.js';
import { typeOf } from '../systems/suspension.js';
import { deleteSelection, duplicatePart, mirrorPart, snapPartToFloor, partName } from '../core/commands.js';
import { fmtLen, fmtAngle, fmtWeight, fmtNum, fmtPct } from '../core/units.js';
import { nextId } from '../core/store.js';

const catLabel = (k) => CATEGORIES.find((c) => c.key === k)?.label || k;

function header(title, sub, pills = [], actions = []) {
  return h('div', { class: 'insp-head' },
    h('div', { class: 'insp-title' }, h('h2', {}, title), sub ? h('div', { class: 'insp-sub' }, sub) : null, pills.length ? h('div', { class: 'pills' }, pills) : null),
    actions.length ? h('div', { class: 'insp-actions' }, actions) : null);
}

// ------------------------------------------------------------------ summary
function renderSummary(ctx) {
  const { store, analysis, issues } = ctx;
  const A = analysis();
  const st = store.state;
  const m = A.mass;
  const counts = { error: 0, warning: 0, info: 0 };
  for (const i of issues()) counts[i.severity]++;
  const cats = m ? Object.entries(m.byCat).sort((a, b) => b[1] - a[1]) : [];
  const maxCat = Math.max(1, ...cats.map((c) => c[1]));
  return h('div', { class: 'insp' },
    header(st.meta.name || 'Untitled', 'Vehicle summary · nothing selected'),
    h('div', { class: 'stat-grid' },
      stat('Weight (no driver)', m ? fmtWeight(m.dryWeight, 0) : '—'),
      stat('With driver', m && m.includeDriver ? fmtWeight(m.total, 0) : '—'),
      stat('CG height', m ? fmtLen(m.cg.z, { precision: 1 }) : '—'),
      stat('Front / rear', m?.frontPct != null ? `${m.frontPct.toFixed(0)} / ${(100 - m.frontPct).toFixed(0)}` : '—')),
    h('div', { class: 'issue-mini' },
      h('span', { class: `sev error ${counts.error ? '' : 'zero'}` }, `${counts.error} errors`),
      h('span', { class: `sev warning ${counts.warning ? '' : 'zero'}` }, `${counts.warning} warnings`),
      h('span', { class: 'sev info zero' }, `${counts.info} notes`)),
    section('Dimensions', kv([
      A.susp ? ['Wheelbase', fmtLen(A.susp.wheelbase)] : null,
      A.susp ? ['Track F / R', `${fmtLen(A.susp.trackF)} / ${fmtLen(A.susp.trackR)}`] : null,
      A.dims ? ['Overall L × W × H', `${fmtLen(A.dims.length, { precision: 1 })} × ${fmtLen(A.dims.width, { precision: 1 })} × ${fmtLen(A.dims.height, { precision: 1 })}`] : null,
      m ? ['CG (X, Y, Z)', `${fmtLen(m.cg.x, { precision: 1 })}, ${fmtLen(m.cg.y, { precision: 1 })}, ${fmtLen(m.cg.z, { precision: 1 })}`] : null,
    ]), { id: 'sum-dims' }),
    cats.length ? section('Weight breakdown', h('div', { class: 'bars' }, cats.map(([k, w]) => h('div', { class: 'bar-row' },
      h('span', { class: 'bar-label' }, k === 'driver' ? 'Driver' : catLabel(k)),
      h('span', { class: 'bar' }, h('i', { class: `c-${k}`, style: { width: `${(w / maxCat) * 100}%` } })),
      h('span', { class: 'bar-val num' }, fmtWeight(w, 1))))), { id: 'sum-weight' }) : null,
    h('p', { class: 'muted small' }, 'Click any tube, joint, hardpoint or part to see its measurements and specs here.'));
}

const stat = (label, value) => h('div', { class: 'stat' }, h('div', { class: 'stat-val' }, value), h('div', { class: 'stat-label' }, label));

// ------------------------------------------------------------------ member
function renderMember(ctx, sel) {
  const { store, interaction } = ctx;
  const st = store.state;
  const mirror = store.ui.mirror;
  if (sel.ids?.length > 1) return renderMembers(ctx, sel.ids);
  const i = memberInfo(st, sel.id);
  if (!i) return null;
  const anchor = store.ui.lengthAnchor || 'a';
  const eq = primaryEquivalency(i.profile);
  const role = roleInfo(i.m.role);
  const set = (label, fn) => store.commit(label, fn);
  const endRows = (nodeId) => {
    const j = jointInfo(st, nodeId);
    return j.pairs.filter((p) => p.m1 === sel.id || p.m2 === sel.id).map((p) => {
      const other = p.m1 === sel.id ? p.m2 : p.m1;
      return h('li', {}, h('button', { class: 'link mono', type: 'button', onclick: () => store.select({ kind: 'member', id: other }) }, other), ` ${fmtAngle(p.angle)}`, h('span', { class: 'muted' }, ` (bend ${fmtAngle(p.bend)})`));
    });
  };
  const pr = i.props;
  const active = ctx.stressView?.refreshActive();
  const sr = active?.c.res.members[sel.id];
  const stressSec = sr ? section(`Stress · ${active.c.name}`, kv([
    ['Factor of safety · yield', fmtNum(sr.fos, 2), sr.fos >= active.run.settings.fosYield ? 'ok' : 'bad'],
    ['Factor of safety · buckling', Number.isFinite(sr.fosBuckling) ? fmtNum(sr.fosBuckling, 2) : 'in tension', sr.fosBuckling >= active.run.settings.fosBuckling ? 'ok' : 'bad'],
    ['Von Mises stress', `${fmtNum(sr.vm / 1000, 1)} ksi of ${fmtNum(sr.Sy / 1000, 1)} ksi yield`],
    ['Axial force', `${fmtNum(Math.abs(sr.N), 0)} lbf ${sr.N < 0 ? 'compression' : 'tension'}`],
    ['Peak bending moment', `${fmtNum(sr.M, 0)} lb·in (${fmtNum(sr.sigmaBend / 1000, 1)} ksi)`],
    ['Torsion', `${fmtNum(sr.T, 0)} lb·in`],
    sr.N < 0 ? ['Euler buckling load', `${fmtNum(sr.Pcr, 0)} lbf`] : null,
  ]), { id: 'insp-m-stress' }) : null;
  return h('div', { class: 'insp' },
    header(`Tube ${sel.id}`, `${role.label}`, [role.primary ? pill('Primary', 'accent') : pill('Secondary'), role.primary ? pill(eq.ok ? 'Meets 1018 equivalency' : 'Below equivalency', eq.ok ? 'ok' : 'bad') : pill(secondaryOk(i.profile) ? 'Secondary OK' : 'Below secondary min', secondaryOk(i.profile) ? 'ok' : 'warn')],
      [iconBtn('target', 'Focus (F)', () => interaction.focusSelection()), iconBtn('trash', 'Delete tube (Del)', () => deleteSelection(store))]),
    h('div', { class: 'stat-grid' }, stat('Length', fmtLen(i.length)), stat('Weight', fmtWeight(i.weight, 2)), stat('Elevation', fmtAngle(i.el)), stat('Plan angle', fmtAngle(i.az))),
    stressSec,
    section('Edit', h('div', { class: 'stack' },
      row('Role', selectField({ id: 'm-role', value: i.m.role, options: MEMBER_ROLES.map((r) => ({ value: r.key, label: `${r.label}${r.primary ? ' (primary)' : ''}` })), onChange: (v) => set('Tube role', (s) => { s.chassis.members[sel.id].role = v; const p = s.chassis.members[sel.id].pair; if (mirror && p && s.chassis.members[p]) s.chassis.members[p].role = v; }) })),
      row('Profile', selectField({ id: 'm-prof', value: i.m.profile, options: Object.entries(st.chassis.profiles).map(([value, p]) => ({ value, label: p.name })), onChange: (v) => set('Tube profile', (s) => { s.chassis.members[sel.id].profile = v; const p = s.chassis.members[sel.id].pair; if (mirror && p && s.chassis.members[p]) s.chassis.members[p].profile = v; }) })),
      row('Keep fixed', h('div', { class: 'seg' }, ['a', 'b'].map((k) => h('button', { type: 'button', class: `seg-btn ${anchor === k ? 'active' : ''}`, onclick: () => store.setUI({ lengthAnchor: k }) }, `End ${k.toUpperCase()} (${k === 'a' ? i.m.a : i.m.b})`)))),
      row('Length', numField({ id: 'm-len', value: i.length, step: 0.125, onCommit: (v) => v > 0 && set('Tube length', (s) => setMemberLength(s, sel.id, v, anchor, { mirror })) }), { hint: 'Moves the other end along the tube axis' }),
      h('div', { class: 'grid2' },
        row('Elevation', numField({ id: 'm-el', value: i.el, kind: 'ang', step: 1, onCommit: (v) => set('Tube angle', (s) => setMemberDirection(s, sel.id, anchor === 'a' ? i.az : i.az + 180, anchor === 'a' ? v : -v, anchor, { mirror })) })),
        row('Plan angle', numField({ id: 'm-az', value: i.az, kind: 'ang', step: 1, onCommit: (v) => set('Tube angle', (s) => setMemberDirection(s, sel.id, anchor === 'a' ? v : v + 180, anchor === 'a' ? i.el : -i.el, anchor, { mirror })) }))),
      h('p', { class: 'muted small' }, 'Angles run from end A to end B: elevation up from horizontal, plan angle from +X (forward) toward +Y (left).'),
      h('div', { class: 'btn-row wrap' },
        h('button', { class: 'btn tiny', type: 'button', onclick: () => { let nid; set(`Split ${sel.id}`, (s) => { nid = splitMember(s, sel.id, 0.5, { mirror }); }); store.select({ kind: 'node', id: nid }); } }, 'Split at middle'),
        i.m.pair && st.chassis.members[i.m.pair] ? h('button', { class: 'btn tiny', type: 'button', onclick: () => store.select({ kind: 'member', id: i.m.pair }) }, `Mirror twin ${i.m.pair}`) : null),
    ), { id: 'insp-m-edit' }),
    section('Views', kv([['Side view (XZ) angle', fmtAngle(i.sideAngle)], ['Top view (XY) angle', fmtAngle(i.topAngle)], ['Front view (YZ) angle', fmtAngle(i.frontAngle)], ['ΔX · ΔY · ΔZ', `${fmtLen(i.B.x - i.A.x)} · ${fmtLen(i.B.y - i.A.y)} · ${fmtLen(i.B.z - i.A.z)}`]]), { id: 'insp-m-views', open: false }),
    section('Joints (coping angles)', h('div', { class: 'stack' },
      h('div', {}, h('b', {}, 'End A '), h('button', { class: 'link mono', type: 'button', onclick: () => store.select({ kind: 'node', id: i.m.a }) }, i.m.a), h('ul', { class: 'plain' }, endRows(i.m.a))),
      h('div', {}, h('b', {}, 'End B '), h('button', { class: 'link mono', type: 'button', onclick: () => store.select({ kind: 'node', id: i.m.b }) }, i.m.b), h('ul', { class: 'plain' }, endRows(i.m.b)))), { id: 'insp-m-joints' }),
    section('Tube & material', kv([
      ['Profile', i.profile.name], ['Material', pr.mat.name], ['OD × wall (ID)', `${fmtLen(i.profile.od)} × ${fmtLen(i.profile.wall)} (${fmtLen(pr.id)})`],
      ['Area', `${fmtNum(pr.A, 4)} in²`], ['Moment of inertia I', `${fmtNum(pr.I, 5)} in⁴`], ['Weight per foot', `${fmtNum(pr.linearWeight * 12, 3)} lb/ft`],
      ['Bending stiffness EI', `${fmtNum(pr.EI / 1e3, 0)} kip·in² (${fmtPct(eq.stiffRatio * 100)} of 1018 baseline)`, eq.stiffOk ? 'ok' : 'warn'],
      ['Yield moment', `${fmtNum(pr.Mb, 0)} lb·in (${fmtPct(eq.strengthRatio * 100)} of baseline)`, eq.strengthOk ? 'ok' : 'warn'],
    ]), { id: 'insp-m-mat' }));
}

function renderMembers(ctx, ids) {
  const { store } = ctx;
  const st = store.state;
  const infos = ids.map((id) => memberInfo(st, id)).filter(Boolean);
  const total = infos.reduce((s, i) => s + i.length, 0), w = infos.reduce((s, i) => s + i.weight, 0);
  return h('div', { class: 'insp' },
    header(`${ids.length} tubes selected`, 'Shift+click to add or remove tubes', [], [iconBtn('trash', 'Delete selected tubes', () => deleteSelection(store))]),
    h('div', { class: 'stat-grid' }, stat('Total length', fmtLen(total, { precision: 1 })), stat('Weight', fmtWeight(w, 1))),
    section('Set for all', h('div', { class: 'stack' },
      row('Role', selectField({ id: 'mm-role', value: '', options: [{ value: '', label: '—' }, ...MEMBER_ROLES.map((r) => ({ value: r.key, label: r.label }))], onChange: (v) => v && store.commit('Tube roles', (s) => ids.forEach((id) => { s.chassis.members[id].role = v; })) })),
      row('Profile', selectField({ id: 'mm-prof', value: '', options: [{ value: '', label: '—' }, ...Object.entries(st.chassis.profiles).map(([value, p]) => ({ value, label: p.name }))], onChange: (v) => v && store.commit('Tube profiles', (s) => ids.forEach((id) => { s.chassis.members[id].profile = v; })) })),
    ), { id: 'insp-mm' }),
    h('ul', { class: 'plain' }, infos.map((i) => h('li', {}, h('span', { class: 'mono' }, i.id), ` · ${i.m.role} · ${fmtLen(i.length)}`))));
}

// ------------------------------------------------------------------ node
function renderNode(ctx, sel) {
  const { store, interaction } = ctx;
  const st = store.state;
  const mirror = store.ui.mirror;
  const j = jointInfo(st, sel.id);
  if (!j) return null;
  const lbl = st.chassis.nodeLabels?.[sel.id];
  const angleRows = j.pairs.map((p, k) => h('tr', {},
    h('td', { class: 'mono' }, h('button', { class: 'link', type: 'button', onclick: () => store.select({ kind: 'member', id: p.m1 }) }, p.m1), ' ↔ ', h('button', { class: 'link', type: 'button', onclick: () => store.select({ kind: 'member', id: p.m2 }) }, p.m2)),
    h('td', {}, numField({ id: `ja-${k}`, value: p.angle, kind: 'ang', step: 1, onCommit: (v) => store.commit(`Joint angle at ${sel.id}`, (s) => setJointAngle(s, sel.id, p.m1, p.m2, v, { mirror })) })),
    h('td', { class: 'num muted' }, fmtAngle(p.bend))));
  return h('div', { class: 'insp' },
    header(`Joint ${sel.id}${lbl ? ` · ${lbl}` : ''}`, `${j.members.length} tube${j.members.length === 1 ? '' : 's'} meet here`, [j.pair ? pill(`Mirror: ${j.pair}`, 'info') : Math.abs(j.p[1]) < 0.01 ? pill('On centerline') : pill('No mirror twin', 'warn')],
      [iconBtn('target', 'Focus (F)', () => interaction.focusSelection()), iconBtn('tube', 'Start a tube from here', () => { interaction.setTool('tube'); store.setUI({ tab: 'chassis', drawing: { from: sel.id } }); }), iconBtn('trash', 'Delete joint and its tubes', () => deleteSelection(store))]),
    section('Position', h('div', { class: 'stack' },
      xyzRow('X · Y · Z', j.p, { idPrefix: 'node', onCommit: (p) => store.commit(`Move ${sel.id}`, (s) => moveNode(s, sel.id, p, { mirror })) }),
      !j.pair && Math.abs(j.p[1]) > 0.01 ? h('button', { class: 'btn tiny', type: 'button', onclick: () => store.commit('Create mirror joint', (s) => ensureMirrorNode(s, sel.id)) }, icon('mirror', 12), 'Create mirror twin') : null,
    ), { id: 'insp-n-pos' }),
    section('Angles between tubes', j.pairs.length ? h('div', { class: 'stack' },
      h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', {}, 'Tubes'), h('th', {}, 'Included angle'), h('th', {}, 'Bend'))), h('tbody', {}, angleRows))),
      h('p', { class: 'muted small' }, 'Type a new included angle to rotate the second tube about this joint (its far end moves). "Bend" is the bend angle if the two tubes are one bent piece.')) : h('p', { class: 'muted' }, 'Only one tube here.'), { id: 'insp-n-ang' }),
    section('Tubes at this joint', h('ul', { class: 'plain' }, j.members.map((m) => h('li', {}, h('button', { class: 'link mono', type: 'button', onclick: () => store.select({ kind: 'member', id: m.id }) }, m.id), ` · ${roleInfo(m.role).label} · ${fmtLen(m.length)} · ${st.chassis.profiles[m.profile]?.name || ''}`))), { id: 'insp-n-tubes' }),
    section('Label', textField({ id: 'node-label', value: lbl || '', placeholder: 'e.g. RRH-upper', onCommit: (v) => store.commit('Joint label', (s) => { s.chassis.nodeLabels ??= {}; s.chassis.nodeLabels[sel.id] = v; }) }), { id: 'insp-n-lbl', open: false }));
}

// ------------------------------------------------------------------ part
function paramField(ctx, part, p, def, value) {
  const { store } = ctx;
  const set = (v) => store.commit(`${partName(part, store.state)}: ${p.label}`, (s) => { s.parts[part.id].params = { ...s.parts[part.id].params, [p.key]: v }; });
  const id = `pp-${part.id}-${p.key}`;
  switch (p.type) {
    case 'hidden': return null;
    case 'length': return row(p.label, numField({ id, value, step: p.step ?? 0.125, onCommit: set }));
    case 'angle': return row(p.label, numField({ id, value, kind: 'ang', step: p.step ?? 1, onCommit: set }));
    case 'number': return row(p.label, numField({ id, value, kind: 'num', unit: p.unit || '', step: p.step ?? 0.1, onCommit: set }));
    case 'select': return row(p.label, selectField({ id, value, options: p.options, onChange: set }));
    case 'bool': return checkField({ id, checked: value, label: p.label, onChange: set });
    case 'color': return row(p.label, h('input', { type: 'color', id, class: 'color', value, onchange: (e) => set(e.target.value) }));
    case 'textarea': return row(p.label, textField({ id, value, multiline: true, rows: 4, onCommit: set }));
    default: return row(p.label, textField({ id, value, onCommit: set }));
  }
}

function renderPart(ctx, sel) {
  const { store, interaction, analysis } = ctx;
  const st = store.state;
  const part = st.parts[sel.id];
  const def = part && getDef(part.def, st);
  if (!def) return h('div', { class: 'insp' }, header('Unknown part', part?.def));
  const params = paramsOf(part, def);
  const env = envelopeOf(part, def);
  const A = analysis();
  const ports = A.parts[part.id]?.ports || {};
  const locked = part.linked;
  const commitPos = (label) => (p) => store.commit(label, (s) => { s.parts[part.id].pos = p.map((v) => +v.toFixed(4)); });
  const commitRot = (p) => store.commit('Rotate part', (s) => { s.parts[part.id].rot = p.map((v) => +v.toFixed(3)); });
  return h('div', { class: 'insp' },
    header(partName(part, st), def.name, [pill(catLabel(def.category), `cat-${def.category}`), locked ? pill('Auto-linked', 'info') : null, part.hidden ? pill('Hidden', 'warn') : null].filter(Boolean),
      [iconBtn('target', 'Focus (F)', () => interaction.focusSelection()), iconBtn(part.hidden ? 'eye' : 'eyeOff', part.hidden ? 'Show' : 'Hide', () => store.commit(part.hidden ? 'Show part' : 'Hide part', (s) => { s.parts[part.id].hidden = !part.hidden; })), iconBtn('trash', 'Delete (Del)', () => deleteSelection(store))]),
    h('div', { class: 'stat-grid' }, stat('Weight', fmtWeight(weightOf(part, def))), stat('Length', fmtLen(env.L, { precision: 2 })), stat('Width', fmtLen(env.W, { precision: 2 })), stat('Height', fmtLen(env.H, { precision: 2 }))),
    section('Placement', h('div', { class: 'stack' },
      locked ? h('div', { class: 'note' }, 'Positioned automatically by the powertrain chain. ', h('button', { class: 'link', type: 'button', onclick: () => store.commit('Unlink part', (s) => { s.parts[part.id].linked = false; }) }, 'Unlink to place it freely')) : null,
      part.linked === false && ['cvt', 'engine'].includes(def.role) && st.powertrain.autoLink ? h('div', { class: 'note' }, 'Placed freely. ', h('button', { class: 'link', type: 'button', onclick: () => store.commit('Relink part', (s) => { s.parts[part.id].linked = true; }) }, 'Re-link to the powertrain chain')) : null,
      xyzRow('Position', part.pos, { idPrefix: `pp-${part.id}-pos`, onCommit: commitPos('Move part'), disabled: locked }),
      h('div', { class: 'row xyz' }, h('span', { class: 'row-label' }, 'Rotation'), h('div', { class: 'xyz-ctl' }, [0, 1, 2].map((k) => numField({ id: `pp-${part.id}-rot-${k}`, value: part.rot[k], kind: 'ang', unit: ['RX', 'RY', 'RZ'][k], step: 5, disabled: locked, onCommit: (v) => { const r = part.rot.slice(); r[k] = v; commitRot(r); } })))),
      h('div', { class: 'btn-row wrap' },
        h('div', { class: 'seg' }, [['translate', 'move', 'Move (W)'], ['rotate', 'rotate', 'Rotate (E)']].map(([k, ic, t]) => h('button', { type: 'button', class: `seg-btn ${store.ui.gizmoMode === k ? 'active' : ''}`, title: t, disabled: locked, onclick: () => { store.setUI({ gizmoMode: k }); interaction.syncGizmo(); } }, icon(ic, 14), t.split(' ')[0]))),
        h('button', { class: 'btn tiny', type: 'button', disabled: locked, onclick: () => { const r = snapPartToFloor(store, part.id, A.segs); toast(r.floor ? `Resting on frame (moved ${fmtLen(r.dz)})` : 'No frame tube under this part', r.floor ? 'ok' : 'warn'); } }, icon('floor', 12), 'Rest on frame'),
        h('button', { class: 'btn tiny', type: 'button', onclick: () => mirrorPart(store, part.id) }, icon('mirror', 12), 'Mirror copy'),
        def.singleton ? null : h('button', { class: 'btn tiny', type: 'button', onclick: () => duplicatePart(store, part.id) }, icon('copy', 12), 'Duplicate')),
    ), { id: 'insp-p-place' }),
    def.params.some((p) => p.type !== 'hidden') ? section('Configuration', h('div', { class: 'stack' }, def.params.map((p) => paramField(ctx, part, p, def, params[p.key]))), { id: 'insp-p-cfg' }) : null,
    section('Specifications', kv(specsOf(part, def)), { id: 'insp-p-specs' }),
    Object.keys(ports).length ? section('Connection points', kv(Object.entries(ports).map(([k, v]) => [k, `${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)}`])), { id: 'insp-p-ports', open: false }) : null,
    section('Notes & options', h('div', { class: 'stack' },
      row('Name', textField({ id: `pp-${part.id}-name`, value: part.name || '', placeholder: def.name, onCommit: (v) => store.commit('Rename part', (s) => { s.parts[part.id].name = v; }) })),
      textField({ id: `pp-${part.id}-notes`, value: part.notes || '', multiline: true, placeholder: 'Supplier, part number, owner, status…', onCommit: (v) => store.commit('Part notes', (s) => { s.parts[part.id].notes = v; }) }),
      checkField({ id: `pp-${part.id}-ign`, checked: part.ignoreInterference, label: 'Ignore in interference checks', onChange: (v) => store.commit('Interference option', (s) => { s.parts[part.id].ignoreInterference = v; }) }),
      h('button', { class: 'btn tiny', type: 'button', onclick: async () => {
        const name = await promptDialog('Save to My Parts', `${partName(part, st)}`, { label: 'Saves this configuration to the library for this project.' });
        if (!name) return;
        store.commit('Save to My Parts', (s) => { const key = `my.${nextId(s, 'MY')}`; s.customDefs[key] = { key, base: def.custom ? s.customDefs[part.def]?.base : part.def, name, params: { ...params } }; });
        toast(`Saved "${name}" to My Parts`, 'ok');
      } }, icon('save', 12), 'Save to My Parts'),
      def.notes ? h('p', { class: 'muted small' }, def.notes) : null,
    ), { id: 'insp-p-notes', open: false }));
}

// ------------------------------------------------------------------ hardpoint
function renderHardpoint(ctx, sel) {
  const { store, interaction, analysis } = ctx;
  const st = store.state;
  const [ax, key] = sel.id.split('.');
  const axle = st.suspension[ax];
  const d = typeOf(axle).points[key];
  const p = axle.points[key];
  if (!d || !p) return null;
  const R = sel.side === 'R';
  const shown = [p[0], R ? -p[1] : p[1], p[2]];
  const T = typeOf(axle);
  const links = T.links.filter(([a, b]) => a === key || b === key).map(([a, b]) => {
    const o = a === key ? b : a;
    const q = axle.points[o];
    return [`Link to ${T.points[o].label.toLowerCase()}`, fmtLen(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]))];
  });
  const S = analysis().susp?.[ax];
  return h('div', { class: 'insp' },
    header(`${ax === 'front' ? 'Front' : 'Rear'} ${d.label}`, `${T.label} · ${R ? 'right' : 'left'} side`, [pill(d.body === 'chassis' ? 'Frame mount' : d.body === 'upright' ? 'On upright / hub' : 'On control arm', d.body === 'chassis' ? 'info' : 'accent')],
      [iconBtn('target', 'Focus (F)', () => interaction.focusSelection())]),
    section('Position', h('div', { class: 'stack' },
      xyzRow(R ? 'Right side' : 'Left side', shown, { idPrefix: `hp-${sel.id}`, onCommit: (v) => store.commit(`Move ${d.label}`, (s) => { s.suspension[ax].points[key] = [v[0], R ? -v[1] : v[1], v[2]].map((x) => +x.toFixed(4)); }) }),
      h('p', { class: 'muted small' }, `Mirror (${R ? 'left' : 'right'}): ${fmtLen(p[0])}, ${fmtLen(R ? p[1] : -p[1])}, ${fmtLen(p[2])}. Drag the gizmo to move it.`)), { id: 'insp-hp-pos' }),
    links.length ? section('Links', kv(links), { id: 'insp-hp-links' }) : null,
    S ? section('Axle geometry', kv([
      S.stat.kpi != null ? ['KPI / caster', `${fmtAngle(S.stat.kpi)} / ${fmtAngle(S.stat.caster)}`] : null,
      ['Roll center height', fmtLen(S.stat.rcHeight)],
      ['Camber gain', `${fmtNum(S.camberGain, 2)} °/in`],
      ['Toe change over travel', fmtAngle(S.toeRange, 2)],
      ['Motion ratio', fmtNum(S.motionRatio, 2)],
    ]), { id: 'insp-hp-geo' }) : null,
    h('button', { class: 'btn', type: 'button', onclick: () => store.setUI({ tab: 'dynamics' }) }, 'Open in Dynamics tab'));
}

// ------------------------------------------------------------------ others
function renderRoute(ctx, sel) {
  const A = ctx.analysis();
  const r = A.routes?.routes.find((x) => x.id === sel.id);
  if (!r) return null;
  return h('div', { class: 'insp' },
    header(r.label, r.kind === 'throttle' ? 'Bowden cable, pedal → governor linkage' : 'Hydraulic circuit, master cylinder → calipers', [pill('Auto-routed', 'info')]),
    kv(r.kind === 'throttle'
      ? [['Cable length', fmtLen(r.cable)], ['Bends', `${r.bends.count} (${fmtAngle(r.bends.total, 0)} total)`], ['Order', `${Math.ceil((r.cable + 6) / 6) * 6} in cable (rounded up to the next 6 in)`]]
      : [['Hard line (3/16 in)', fmtLen(r.hard)], ['Flex hose', fmtLen(r.flex)], ['Tee fittings', r.tees], ['Total', fmtLen(r.total)]]),
    h('p', { class: 'muted small' }, 'The route follows frame tubes (shortest path, low and away from the exhaust). Move pedals, calipers, the engine or tubes and it re-routes instantly.'));
}

function renderDriver(ctx) {
  const A = ctx.analysis();
  const e = A.ergo;
  if (!e?.pose) return null;
  return h('div', { class: 'insp' },
    header(`Driver · ${e.driver.label}`, `${e.driver.summary} · posed from the seat, pedals and wheel`),
    kv(e.clearances.map((c) => [`${c.name} → ${c.member}`, fmtLen(c.dist), c.dist < (c.name === 'helmet' ? 6 : 3) ? (c.dist < 0 ? 'bad' : 'warn') : 'ok'])),
    h('button', { class: 'btn', type: 'button', onclick: () => ctx.store.setUI({ tab: 'ergonomics' }) }, 'Open in Ergonomics tab'));
}

function renderAxle(ctx, sel) {
  const { store } = ctx;
  const ax = store.state.suspension[sel.id];
  const S = ctx.analysis().susp?.[sel.id];
  return h('div', { class: 'insp' },
    header(`${sel.id === 'front' ? 'Front' : 'Rear'} ${sel.side === 'R' ? 'right' : 'left'} corner`, typeOf(ax).label),
    kv([
      ['Tire', getDef(ax.tire, store.state)?.name], ['Shock', getDef(ax.shock, store.state)?.name], ['Upright', getDef(ax.upright, store.state)?.name],
      S ? ['Camber / toe at ride height', `${fmtAngle(S.pose0.camber, 2)} / ${fmtAngle(S.pose0.toe, 2)}`] : null,
      S ? ['Travel', `${fmtLen(ax.droop)} droop · ${fmtLen(ax.bump)} bump`] : null,
    ]),
    h('button', { class: 'btn', type: 'button', onclick: () => store.setUI({ tab: 'dynamics' }) }, 'Edit in Dynamics tab'));
}

function renderCV(ctx, sel) {
  const pt = ctx.analysis().pt;
  if (sel.kind === 'driveshaft') return h('div', { class: 'insp' }, header('Driveshaft (4WD)', 'Gearbox front output → front differential'), kv([['Length', fmtLen(pt.driveshaft.length)], ['Angle to car axis', fmtAngle(pt.driveshaft.angle)], ['Elevation', fmtAngle(pt.driveshaft.elevation)]]));
  const cv = (sel.front ? pt.frontCv : pt.cv).find((c) => c.side === sel.id);
  if (!cv) return null;
  return h('div', { class: 'insp' },
    header(`${sel.front ? 'Front' : 'Rear'} CV half-shaft (${cv.side === 'L' ? 'left' : 'right'})`, 'Auto-generated from the gearbox output to the hub'),
    kv([['Length at ride height', fmtLen(cv.length)], ['Plunge through travel', fmtLen(cv.plunge)], ['Inboard angle static / max', `${fmtAngle(cv.staticIn)} / ${fmtAngle(cv.maxIn)}`], ['Outboard angle static / max', `${fmtAngle(cv.staticOut)} / ${fmtAngle(cv.maxOut)}`]]));
}

export function renderInspector(ctx) {
  const sel = ctx.store.ui.selection;
  let out = null;
  try {
    if (sel?.kind === 'member') out = renderMember(ctx, sel);
    else if (sel?.kind === 'node') out = renderNode(ctx, sel);
    else if (sel?.kind === 'part') out = renderPart(ctx, sel);
    else if (sel?.kind === 'hardpoint') out = renderHardpoint(ctx, sel);
    else if (sel?.kind === 'route') out = renderRoute(ctx, sel);
    else if (sel?.kind === 'driver') out = renderDriver(ctx);
    else if (sel?.kind === 'axle') out = renderAxle(ctx, sel);
    else if (sel?.kind === 'cv' || sel?.kind === 'driveshaft') out = renderCV(ctx, sel);
  } catch (e) { console.error(e); }
  return out || renderSummary(ctx);
}

export { profileProps };
