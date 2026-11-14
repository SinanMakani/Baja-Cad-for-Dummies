// Chassis ▸ Import CAD: bring a SolidWorks (or other CAD) frame in as an
// editable tube frame, with the original geometry kept as a reference overlay.
import { h, icon, toast, modal, pickFile } from '../dom.js';
import { numField, selectField, row, section, kv, pill } from '../fields.js';
import { readCadFile, suggestOptions, analyzeImport, applyImport, forwardChoices, CadImportError, ACCEPT } from '../../systems/cadImport.js';
import { fmtLen } from '../../core/units.js';

/** One import at a time; raw meshes stay in memory, never in the saved project. */
export const session = { raw: null, opts: null, result: null, status: '', busy: false, error: null, errorKind: null };

const AXIS_LABEL = { '+x': '+X', '-x': '−X', '+y': '+Y', '-y': '−Y', '+z': '+Z', '-z': '−Z' };

export function showNativeHelp(ext) {
  modal({
    title: `Export the ${ext.toUpperCase()} from SolidWorks first`,
    body: h('div', { class: 'stack' },
      h('p', {}, 'SolidWorks part and assembly files use a closed, proprietary format that only SolidWorks can read. Export a neutral copy — it takes a few seconds:'),
      h('ol', { class: 'help-list' },
        h('li', {}, 'In SolidWorks, open the frame part (or assembly) and choose ', h('b', {}, 'File ▸ Save As…')),
        h('li', {}, 'Set ', h('b', {}, 'Save as type'), ' to ', h('b', {}, 'STEP AP214 (*.step; *.stp)'), ' and save.'),
        h('li', {}, 'Choose that .step file here (or drop it onto the 3D view).')),
      h('p', { class: 'muted small' }, 'Weldment frames work best: SolidWorks exports each structural member as its own solid, so every tube converts with its exact length, OD and wall. Bent members (filleted sketches or swept tubes) are split into their straight runs, with a joint at each bend\'s virtual sharp. STL also works (File ▸ Save As ▸ STL, units in inches or millimeters). A CSV of tube end points (X1, Y1, Z1, X2, Y2, Z2, OD, wall) is converted exactly.')),
    actions: [{ label: 'Got it', primary: true }],
  });
}

function recompute(ctx) {
  try {
    session.result = analyzeImport(session.raw, session.opts);
    session.error = null;
  } catch (e) {
    console.error(e);
    session.result = null;
    session.error = e.message;
  }
  ctx.cadView.showSession(session.result);
  ctx.rerender();
}

export async function startImport(ctx, file) {
  if (!file) return;
  const { store } = ctx;
  if (store.ui.tab !== 'chassis' || store.ui.chassisMode !== 'import') store.setUI({ tab: 'chassis', chassisMode: 'import' });
  session.busy = true; session.error = null; session.errorKind = null; session.raw = null; session.result = null;
  ctx.cadView.showSession(null);
  ctx.rerender();
  try {
    const raw = await readCadFile(file, (s) => { session.status = s; ctx.rerender(); });
    session.raw = raw;
    session.opts = suggestOptions(raw);
    session.busy = false;
    recompute(ctx);
    const r = session.result?.report;
    if (r) toast(`Read ${r.bodies} bod${r.bodies === 1 ? 'y' : 'ies'} — ${r.tubes} recognized as tubes${r.bent ? ` (${r.bent} bent)` : ''}. Check the preview, then import.`, 'ok', 4200);
    fitPreview(ctx);
  } catch (e) {
    session.busy = false;
    if (e instanceof CadImportError && e.kind === 'native') { showNativeHelp(file.name.split('.').pop()); session.error = null; }
    else { console.error(e); session.error = e.message || String(e); session.errorKind = e.kind || null; }
    ctx.rerender();
  }
}

function fitPreview(ctx) {
  const box = ctx.cadView.bounds();
  if (box) ctx.vp.view('iso', box);
}

function commit(ctx) {
  const { store } = ctx;
  const res = session.result;
  if (!res?.frame.members.length) return;
  const name = session.raw.name;
  store.commit(`Import chassis from ${name}`, (st) => applyImport(st, res, session.opts, name));
  ctx.cadView.keepReference();
  const n = res.frame.members.length;
  session.raw = null; session.result = null;
  store.setUI({ chassisMode: 'stress', selection: null });
  toast(`Imported ${n} tubes. Tag the side-impact members (SIM) and roll hoop (RRH), then run the stress tests.`, 'ok', 6000);
}

function cancel(ctx) {
  session.raw = null; session.result = null; session.error = null;
  ctx.cadView.showSession(null);
  ctx.rerender();
}

function intro(ctx) {
  const drop = h('div', { class: 'dropzone', tabindex: '0', role: 'button', 'aria-label': 'Choose a CAD file' },
    icon('upload', 22),
    h('div', { class: 'dz-title' }, 'Choose or drop a CAD file'),
    h('div', { class: 'muted small' }, 'STEP / STP (recommended) · IGES · STL · OBJ · tube-endpoint CSV'));
  const choose = async () => startImport(ctx, await pickFile(ACCEPT));
  drop.addEventListener('click', choose);
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); startImport(ctx, e.dataTransfer.files?.[0]); });
  return h('div', { class: 'stack' },
    h('p', { class: 'panel-intro' }, 'Bring in a frame designed in SolidWorks. Each tube body becomes an editable tube with its real length, OD and wall, bent tubes are split into their straight runs, and joints are rebuilt where the tubes meet. The original geometry stays on screen as a reference.'),
    drop,
    session.busy ? h('p', { class: 'note' }, session.status || 'Reading…') : null,
    session.error ? h('div', { class: 'note bad' }, h('p', {}, session.error),
      session.errorKind === 'reader' ? h('button', { class: 'btn tiny', type: 'button', onclick: () => location.reload() }, 'Reload page') : null) : null,
    section('From SolidWorks', h('ol', { class: 'help-list small' },
      h('li', {}, h('b', {}, 'File ▸ Save As ▸ STEP AP214'), ' — keeps every weldment member as its own solid (best).'),
      h('li', {}, 'Native .SLDPRT / .SLDASM files can\'t be read outside SolidWorks; export them as STEP first.'),
      h('li', {}, 'SolidWorks is Y-up. The importer detects units, up axis and which end is the front — you can correct them before importing.')), { id: 'cad-sw', open: true }));
}

function options(ctx) {
  const o = session.opts, raw = session.raw, res = session.result;
  const set = (patch) => { Object.assign(session.opts, patch); recompute(ctx); };
  const r = res?.report;
  const sizes = res ? Object.entries(res.sizes).sort((a, b) => b[1] - a[1]) : [];
  const clr = res ? res.bends.map((b) => b.clr).filter((c) => c > 0) : [];
  const clrText = clr.length ? ` · bend radius ${fmtLen(Math.min(...clr))}${Math.max(...clr) - Math.min(...clr) > 0.06 ? `–${fmtLen(Math.max(...clr))}` : ''}` : '';
  return h('div', { class: 'stack' },
    h('div', { class: 'import-head' }, icon('file', 18), h('div', {}, h('b', {}, raw.name), h('div', { class: 'muted small' }, `${raw.format}${raw.unitsFixed ? ' · units from file' : ''}`))),
    session.error ? h('p', { class: 'note bad' }, session.error) : null,
    r ? kv([
      [raw.tubes ? 'Rows' : 'Bodies in file', String(r.bodies)],
      ['Recognized as tubes', `${r.tubes}`, r.tubes ? 'ok' : 'bad'],
      r.bent ? ['Bent tubes', `${r.bent} → ${r.bentRuns} straight runs, ${r.bends} bend${r.bends === 1 ? '' : 's'}${clrText}`] : null,
      r.other ? ['Other bodies (reference only)', `${r.other} — plates, tabs or brackets`, 'warn'] : null,
      ['Joints rebuilt', String(r.joints)],
      ['Tubes after joining', `${r.members}${r.splits ? ` (${r.splits} split at T-joints)` : ''}`],
      r.healed ? ['Ends joined to a touching tube', `${r.healed} (offset welds, or tubes meeting a bent tube)`] : null,
      r.freeEnds ? ['Open tube ends', String(r.freeEnds), r.freeEnds > 4 ? 'warn' : ''] : null,
      r.wallAssumed ? ['Wall not found in file', `${r.wallAssumed} tubes use ${fmtLen(o.defaultWall)}`, 'warn'] : null,
    ]) : null,
    sizes.length ? h('div', { class: 'sizes' }, sizes.map(([k, n]) => pill(`${k} · ${n}`, k.includes('assumed') ? 'warn' : 'info'))) : null,
    section('Orientation & placement', h('div', { class: 'stack' },
      raw.unitsFixed ? null : row('File units', selectField({ id: 'cad-units', value: o.units, options: [{ value: 'in', label: 'Inches' }, { value: 'mm', label: 'Millimeters' }, { value: 'cm', label: 'Centimeters' }, { value: 'm', label: 'Meters' }], onChange: (v) => set({ units: v }) })),
      h('div', { class: 'grid2' },
        row('Up axis in file', selectField({ id: 'cad-up', value: o.up, options: ['+y', '+z', '-y', '-z', '+x'].map((v) => ({ value: v, label: `${AXIS_LABEL[v]}${v === '+y' ? ' (SolidWorks)' : ''}` })), onChange: (v) => set({ up: v, forward: forwardChoices(v)[0] }) })),
        row('Front of car', selectField({ id: 'cad-fwd', value: o.forward, options: forwardChoices(o.up).map((v) => ({ value: v, label: `toward ${AXIS_LABEL[v]}` })), onChange: (v) => set({ forward: v }) }))),
      h('div', { class: 'btn-row wrap' },
        h('button', { class: 'btn tiny', type: 'button', onclick: () => set({ forward: o.forward[0] === '+' ? `-${o.forward[1]}` : `+${o.forward[1]}` }) }, 'Flip front ↔ back'),
        h('button', { class: 'btn tiny', type: 'button', onclick: () => { const ch = forwardChoices(o.up); set({ forward: ch[(ch.indexOf(o.forward) + 2) % ch.length] }); } }, 'Turn 90°')),
      row('Placement', selectField({ id: 'cad-place', value: o.placement, options: [{ value: 'auto', label: 'Center on the car axes' }, { value: 'keep', label: 'Keep CAD origin' }], onChange: (v) => set({ placement: v }) })),
      o.placement === 'auto' ? h('div', { class: 'grid2' },
        row('Rear of frame at X', numField({ id: 'cad-rear', value: o.rearX, step: 1, onCommit: (v) => set({ rearX: v }) })),
        row('Lowest tube bottom', numField({ id: 'cad-ground', value: o.ground, step: 0.25, onCommit: (v) => set({ ground: v }) }))) : null,
    ), { id: 'cad-orient' }),
    section('Conversion', h('div', { class: 'stack' },
      row('Joint tolerance', numField({ id: 'cad-tol', value: o.jointTol, step: 0.125, onCommit: (v) => set({ jointTol: Math.max(0.05, v) }) }), { hint: 'How far apart tube ends can be and still count as one joint' }),
      row('Wall if not in file', numField({ id: 'cad-wall', value: o.defaultWall, step: 0.005, onCommit: (v) => set({ defaultWall: v }) })),
      row('Into this project', selectField({ id: 'cad-mode', value: o.mode, options: [{ value: 'replace', label: 'Replace the current frame' }, { value: 'add', label: 'Add to the current frame' }], onChange: (v) => set({ mode: v }) })),
    ), { id: 'cad-conv', open: false }),
    h('p', { class: 'muted small' }, r?.bent
      ? 'Blue = recognized tube, orange = kept as reference only. The orange-outlined frame is what will be imported; each bend becomes a joint at its virtual sharp, where the straight centerlines meet.'
      : 'Blue = recognized tube, orange = kept as reference only. The orange-outlined frame is what will be imported.'),
    h('div', { class: 'btn-row wrap' },
      h('button', { class: 'btn primary', type: 'button', disabled: !r?.members, onclick: () => commit(ctx) }, icon('upload', 14), `Import ${r?.members || 0} tubes as the chassis`),
      h('button', { class: 'btn', type: 'button', onclick: () => cancel(ctx) }, 'Cancel')),
    h('p', { class: 'muted small' }, 'After importing, the frame has to pass the stress tests before suspension, ergonomics and powertrain can be added.'));
}

export function renderCadImport(ctx) {
  return session.raw ? options(ctx) : intro(ctx);
}
