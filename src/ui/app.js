// App shell: layout, top bar, tabs, view toolbar, design-check tray, and a
// render scheduler that re-renders panels without losing input focus.
import * as THREE from 'three';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { h, icon, iconBtn, toast, modal, confirmDialog, textExport, download, dataUrlToBlob, pickFile, setChildren } from './dom.js';
import { selectField, numField, checkField, row, section, kv } from './fields.js';
import { renderChassis, TOOL_HINTS } from './panels/chassis.js';
import { renderDynamics } from './panels/dynamics.js';
import { renderErgonomics } from './panels/ergonomics.js';
import { renderPowertrain } from './panels/powertrain.js';
import { renderLibrary, hideSpecTip } from './library.js';
import { renderInspector } from './inspector.js';
import { newProject, migrate } from '../core/defaults.js';
import { cutListCSV, bomCSV, nodesTXT, membersCSV, hardpointsCSV } from '../core/commands.js';
import { setUnitPrefs, fmtWeight, fmtLen, fmtNum } from '../core/units.js';
import { gateLocked, stressStatus, fosColor } from '../systems/stresstest.js';
import { startImport } from './panels/cadImport.js';
import { appearancePicker, crossfade } from './theme.js';
import { ACCEPT } from '../systems/cadImport.js';

const GATED = new Set(['dynamics', 'ergonomics', 'powertrain']);

/** Shown in place of Dynamics / Ergonomics / Powertrain until a new frame passes its stress tests. */
function renderGate(ctx, tab) {
  const { store } = ctx;
  const status = stressStatus(store.state);
  const last = store.state.stress.last;
  const fails = last ? last.cases.filter((c) => !c.pass) : [];
  const label = { dynamics: 'Suspension and steering', ergonomics: 'Seat, pedals and driver fit', powertrain: 'Engine, CVT and drivetrain' }[tab];
  return h('div', { class: 'panel-inner' },
    h('div', { class: 'gate-card' },
      h('div', { class: 'gate-icon' }, icon('lock', 26)),
      h('h3', {}, 'Finish the frame first'),
      h('p', {}, `${label} can be added once this project's frame passes its stress tests, so every system is built around a frame that can take Baja impacts.`),
      h('p', { class: `gate-status ${status}` },
        status === 'none' ? 'The frame has not been tested yet.'
          : status === 'stale' ? 'The frame changed since it was last tested.'
            : status === 'fail' ? `Last test: ${fails.length} case${fails.length === 1 ? '' : 's'} failed (${fails.map((c) => c.name.toLowerCase()).join(', ')}).`
              : 'The frame passes — reload if this stays locked.'),
      h('div', { class: 'btn-row wrap' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => store.setUI({ tab: 'chassis', chassisMode: 'stress' }) }, icon('target', 14), 'Go to stress tests'),
        h('button', { class: 'btn', type: 'button', onclick: () => store.setUI({ tab: 'chassis', chassisMode: 'build' }) }, 'Keep building the frame')),
      h('p', { class: 'muted small' }, 'Team leads can turn this requirement off in Settings.')));
}

export const TABS = [
  { key: 'chassis', label: 'Chassis', cats: ['chassis'] },
  { key: 'dynamics', label: 'Dynamics', cats: ['dynamics'] },
  { key: 'ergonomics', label: 'Ergonomics', cats: ['ergonomics'] },
  { key: 'powertrain', label: 'Powertrain', cats: ['powertrain'] },
  { key: 'library', label: 'Library', cats: ['hardware', 'general'] },
];

/** Re-render `el` from `fn()` on the next frame, keeping focus, caret and scroll. */
export function mount(el, fn) {
  let queued = false;
  const render = () => {
    queued = false;
    const active = document.activeElement;
    const focusId = active && el.contains(active) ? active.id : null;
    const sel = focusId && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
    const scroll = el.scrollTop;
    el.replaceChildren(fn());
    el.scrollTop = scroll;
    if (focusId) {
      const next = document.getElementById(focusId);
      if (next) {
        next.focus({ preventScroll: true });
        if (sel && 'setSelectionRange' in next) { try { next.setSelectionRange(...sel); } catch { /* not a text input */ } }
      }
    }
  };
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(render); } };
  render();
  return schedule;
}

function menu(label, items) {
  const pop = h('div', { class: 'menu-pop', role: 'menu', hidden: true });
  const btn = h('button', { class: 'menu-btn', type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false' }, label, icon('chevron', 12));
  const close = () => { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('mousedown', outside); };
  const outside = (e) => { if (!wrap.contains(e.target)) close(); };
  btn.addEventListener('click', () => {
    const open = pop.hidden;
    pop.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (open) setTimeout(() => document.addEventListener('mousedown', outside), 0);
  });
  pop.append(...items.map((it) => it === '-' ? h('div', { class: 'menu-sep' }) : h('button', { class: 'menu-item', type: 'button', role: 'menuitem', onclick: () => { close(); it.run(); } }, it.icon ? icon(it.icon, 16) : h('span', { class: 'ico-pad' }), h('span', {}, it.label), it.hint ? h('span', { class: 'menu-hint' }, it.hint) : null)));
  const wrap = h('div', { class: 'menu' }, btn, pop);
  return wrap;
}

export function createApp(ctx) {
  const { store, vp, builder, overlays, interaction, analysis, issues } = ctx;
  const root = document.getElementById('app');

  // ------------------------------------------------------------ top bar
  const nameInput = h('input', { class: 'project-name', id: 'project-name', 'aria-label': 'Project name', value: store.state.meta.name });
  nameInput.addEventListener('change', () => store.commit('Rename project', (s) => { s.meta.name = nameInput.value || 'Untitled'; }));
  const undoBtn = iconBtn('undo', 'Undo (Ctrl+Z)', () => store.undo());
  const redoBtn = iconBtn('redo', 'Redo (Ctrl+Y)', () => store.redo());
  const chips = h('div', { class: 'top-chips' });

  const saveJSON = () => download(`${(store.state.meta.name || 'baja').replace(/[^\w-]+/g, '_')}.baja.json`, JSON.stringify(store.state, null, 1), 'application/json');
  const openJSON = async () => {
    const f = await pickFile('.json,application/json');
    if (!f) return;
    try {
      const s = migrate(JSON.parse(await f.text()));
      store.load(s, 'Open project');
      toast(`Opened ${s.meta.name}`, 'ok');
    } catch (e) { toast(`Could not open that file: ${e.message}`, 'bad', 5000); }
  };
  const exportMesh = (kind) => {
    const g = new THREE.Group();
    for (const k of ['chassis', 'dynamics', 'powertrain', 'ergonomics', 'hardware', 'routing']) if (vp.groups[k].visible) g.add(vp.groups[k].clone());
    g.updateMatrixWorld(true);
    if (kind === 'stl') download(`${store.state.meta.name || 'baja'}.stl`, new STLExporter().parse(g, { binary: true }), 'model/stl');
    else new GLTFExporter().parse(g, (res) => download(`${store.state.meta.name || 'baja'}.glb`, res, 'model/gltf-binary'), (e) => toast(`Export failed: ${e.message}`, 'bad'), { binary: true });
    toast(`Exporting ${kind.toUpperCase()} in inches (1 unit = 1 in)`, 'info');
  };
  const fileMenu = menu('File', [
    { label: 'New from starter car', icon: 'file', run: async () => { if (await confirmDialog('Start a new project from the starter Baja layout? Unsaved changes stay in undo history only until you reload.', { ok: 'New project' })) { store.load(newProject({ template: 'starter' }), 'New project'); vp.view('iso', analysis().dims?.box); } } },
    { label: 'New frame from scratch', icon: 'file', hint: 'stress test unlocks the rest', run: async () => { if (await confirmDialog('Start an empty project? You will build (or import) the frame first; suspension, ergonomics and powertrain unlock when it passes the stress tests.', { ok: 'New project' })) { ctx.cadView.clear(); store.load(newProject({ template: 'blank', name: 'New Baja concept' }), 'New project'); store.setUI({ tab: 'chassis', chassisMode: 'build' }); } } },
    { label: 'Import chassis from CAD…', icon: 'upload', hint: 'SolidWorks STEP, STL', run: async () => { const f = await pickFile(ACCEPT); if (f) startImport(panelCtx, f); } },
    '-',
    { label: 'Open project…', icon: 'upload', run: openJSON },
    { label: 'Save project (.json)', icon: 'save', hint: 'share with the team', run: saveJSON },
    { label: 'Copy project JSON', icon: 'copy', run: () => textExport('Project file', JSON.stringify(store.state, null, 1), 'project.baja.json', 'application/json') },
  ]);
  const exportMenu = menu('Export', [
    { label: 'Cut list (CSV)', icon: 'download', hint: 'lengths + coping angles', run: () => textExport('Cut list', cutListCSV(store.state), 'cut-list.csv', 'text/csv') },
    { label: 'Bill of materials (CSV)', icon: 'download', run: () => textExport('Bill of materials', bomCSV(store.state, analysis()), 'bom.csv', 'text/csv') },
    { label: 'Suspension hardpoints (CSV)', icon: 'download', run: () => textExport('Suspension hardpoints', hardpointsCSV(store.state), 'hardpoints.csv', 'text/csv') },
    { label: 'Chassis joints for CAD (XYZ)', icon: 'download', hint: 'SolidWorks curve file', run: () => textExport('Chassis joints (X Y Z, inches)', nodesTXT(store.state), 'chassis-nodes.txt') },
    { label: 'Tube endpoints (CSV)', icon: 'download', run: () => textExport('Tube endpoints', membersCSV(store.state), 'tubes.csv', 'text/csv') },
    '-',
    { label: '3D model (STL)', icon: 'cube', run: () => exportMesh('stl') },
    { label: '3D model (GLB)', icon: 'cube', run: () => exportMesh('glb') },
    { label: 'Screenshot (PNG)', icon: 'camera', run: () => download(`${store.state.meta.name || 'baja'}.png`, dataUrlToBlob(vp.screenshot()), 'image/png') },
  ]);

  const settingsBtn = iconBtn('sliders', 'Settings', () => openSettings(ctx));
  const helpBtn = iconBtn('help', 'Help & shortcuts (?)', () => openHelp());
  const topbar = h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, h('span', { class: 'mark', 'aria-hidden': 'true' }, icon('cube', 22)), h('div', { class: 'brand-text' }, h('span', { class: 'brand-name' }, 'Baja Designer'), nameInput)),
    h('nav', { class: 'menus' }, fileMenu, exportMenu, h('span', { class: 'divider' }), undoBtn, redoBtn),
    chips,
    h('div', { class: 'top-right' }, settingsBtn, helpBtn));

  // ------------------------------------------------------------ left: tabs + panel
  const tabBar = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Subsystems' });
  const panel = h('div', { class: 'panel', id: 'panel', role: 'tabpanel' });
  const left = h('aside', { class: 'left' }, tabBar, panel);

  // ------------------------------------------------------------ stage
  const stageEl = document.getElementById('viewport');
  const tip = h('div', { class: 'hover-tip', hidden: true, role: 'tooltip' });
  const readout = h('div', { class: 'readout mono', hidden: true });
  const hint = h('div', { class: 'tool-hint' });
  const viewbar = h('div', { class: 'viewbar' });
  const legend = h('div', { class: 'legend' });
  stageEl.append(tip, readout, hint, viewbar, legend);
  interaction.tooltip = tip;
  interaction.readout = readout;

  // ------------------------------------------------------------ right + tray
  const inspector = h('div', { class: 'inspector', id: 'inspector' });
  const right = h('aside', { class: 'right', 'aria-label': 'Inspector' }, inspector);
  const tray = h('section', { class: 'tray', 'aria-label': 'Design checks' });

  root.append(topbar, left, h('main', { class: 'stage', 'aria-label': '3D view' }, stageEl), right, tray);

  const panelCtx = {
    ...ctx,
    rerender: () => schedulePanel(),
    setSim: (patch) => { store.ui.sim = { ...store.ui.sim, ...patch }; builder.rebuildSuspension(); builder.applyVisual(); },
    toggleAnimate: () => toggleAnimate(),
    driverView: () => {
      const e = analysis().ergo;
      if (e?.pose) vp.view('driver', null, { pos: e.pose.eye, dir: e.pose.fwd.clone().addScaledVector(e.pose.up, -0.05).normalize() });
    },
    refreshStress: () => ctx.refreshStress(),
  };

  const renderPanel = () => {
    hideSpecTip();
    const t = store.ui.tab;
    if (GATED.has(t) && gateLocked(store.state)) return renderGate(panelCtx, t);
    if (t === 'chassis') return renderChassis(panelCtx);
    if (t === 'dynamics') return renderDynamics(panelCtx);
    if (t === 'ergonomics') return renderErgonomics(panelCtx);
    if (t === 'powertrain') return renderPowertrain(panelCtx);
    return renderLibrary(panelCtx);
  };
  const schedulePanel = mount(panel, renderPanel);
  const scheduleInspector = mount(inspector, () => renderInspector(panelCtx));

  const renderTabs = () => {
    const list = issues();
    tabBar.replaceChildren(...TABS.map((t) => {
      const mine = list.filter((i) => t.cats.includes(i.category));
      const err = mine.filter((i) => i.severity === 'error').length, warn = mine.filter((i) => i.severity === 'warning').length;
      const active = store.ui.tab === t.key;
      const locked = GATED.has(t.key) && gateLocked(store.state);
      return h('button', { class: `tab ${active ? 'active' : ''} ${locked ? 'locked' : ''}`, role: 'tab', 'aria-selected': String(active), type: 'button', title: locked ? 'Unlocks when the frame passes its stress tests' : undefined, onclick: () => store.setUI({ tab: t.key }) },
        locked ? icon('lock', 12) : null,
        h('span', {}, t.label),
        locked ? null : err ? h('span', { class: 'badge error', title: `${err} errors` }, err) : warn ? h('span', { class: 'badge warning', title: `${warn} warnings` }, warn) : null);
    }));
  };

  const renderChips = () => {
    const A = analysis();
    const list = issues();
    const err = list.filter((i) => i.severity === 'error').length, warn = list.filter((i) => i.severity === 'warning').length;
    setChildren(chips,
      A.mass ? h('span', { class: 'chip-stat', title: 'Estimated vehicle weight without driver' }, h('b', {}, fmtWeight(A.mass.dryWeight, 0)), ' car') : null,
      A.mass?.includeDriver ? h('span', { class: 'chip-stat' }, h('b', {}, fmtWeight(A.mass.total, 0)), ' w/ driver') : null,
      A.mass ? h('span', { class: 'chip-stat' }, 'CG ', h('b', {}, fmtLen(A.mass.cg.z, { precision: 1 }))) : null,
      h('button', { class: `chip-issues ${err ? 'error' : warn ? 'warning' : 'ok'}`, type: 'button', onclick: () => store.setUI({ issuesOpen: true }) }, icon('warn', 14), err || warn ? `${err} errors · ${warn} warnings` : 'All checks pass'));
    undoBtn.disabled = !store.canUndo;
    redoBtn.disabled = !store.canRedo;
    undoBtn.title = store.canUndo ? `Undo ${store.undoLabel} (Ctrl+Z)` : 'Nothing to undo';
    redoBtn.title = store.canRedo ? `Redo ${store.redoLabel} (Ctrl+Y)` : 'Nothing to redo';
    if (document.activeElement !== nameInput) nameInput.value = store.state.meta.name;
  };

  // ------------------------------------------------------------ view toolbar
  const layerPop = h('div', { class: 'pop', hidden: true });
  const sectionPop = h('div', { class: 'pop', hidden: true });
  const togglePop = (pop) => { const open = pop.hidden; layerPop.hidden = true; sectionPop.hidden = true; pop.hidden = !open; if (open) renderViewbar(); };
  const renderViewbar = () => {
    const ui = store.ui;
    const views = [['iso', 'Iso'], ['front', 'Front'], ['side', 'Side'], ['top', 'Top'], ['rear', 'Rear']];
    const L = ui.layers;
    const lay = (k, label) => checkField({ id: `layer-${k}`, checked: L[k], label, onChange: (v) => store.setUI({ layers: { ...store.ui.layers, [k]: v } }) });
    setChildren(layerPop, h('div', { class: 'pop-title' }, 'Show'),
      lay('chassis', 'Chassis tubes'), lay('nodes', 'Joints (Chassis tab)'), lay('dynamics', 'Suspension & wheels'), lay('hardpoints', 'Hardpoints (Dynamics tab)'),
      lay('powertrain', 'Powertrain'), lay('ergonomics', 'Ergonomics parts'), lay('driver', 'Driver model'), lay('hardware', 'Hardware'),
      lay('routing', 'Brake lines & cable'), lay('dims', 'Dimensions'), lay('cg', 'Center of gravity'), lay('grid', 'Ground grid'),
      ctx.cadView.hasReference ? h('div', { class: 'stack' }, checkField({ id: 'layer-cad', checked: L.cad !== false, label: 'CAD reference (imported)', onChange: (v) => store.setUI({ layers: { ...store.ui.layers, cad: v } }) }),
        h('button', { class: 'btn tiny', type: 'button', onclick: () => { ctx.cadView.clear(); renderViewbar(); } }, 'Remove CAD reference')) : null,
      h('div', { class: 'pop-title' }, 'Frame colors'),
      selectField({ id: 'color-by', value: ui.colorBy, options: [{ value: 'subsystem', label: 'By member role' }, { value: 'profile', label: 'By tube profile' }, { value: 'uniform', label: 'Single color' }], onChange: (v) => { store.setUI({ colorBy: v }); builder.rebuild(); builder.applyVisual(); } }));
    const sec = ui.section;
    const secSlider = h('input', { type: 'range', class: 'range', id: 'sec-off', min: sec.axis === 'x' ? -30 : sec.axis === 'y' ? -35 : 0, max: sec.axis === 'x' ? 90 : sec.axis === 'y' ? 35 : 65, step: 0.25, value: sec.offset });
    secSlider.addEventListener('input', () => { store.ui.section = { ...store.ui.section, offset: Number(secSlider.value) }; vp.setSection(store.ui.section); secOut.textContent = fmtLen(Number(secSlider.value)); });
    const secOut = h('output', { class: 'mono' }, fmtLen(sec.offset));
    sectionPop.replaceChildren(h('div', { class: 'pop-title' }, 'Section cut'),
      checkField({ id: 'sec-on', checked: sec.enabled, label: 'Cut the model', onChange: (v) => { store.ui.section = { ...store.ui.section, enabled: v }; vp.setSection(store.ui.section); renderViewbar(); } }),
      row('Cut plane', selectField({ id: 'sec-axis', value: sec.axis, options: [{ value: 'y', label: 'Lengthwise (keep right of Y)' }, { value: 'x', label: 'Crosswise (keep behind X)' }, { value: 'z', label: 'Horizontal (keep below Z)' }], onChange: (v) => { store.ui.section = { ...store.ui.section, axis: v, offset: v === 'z' ? 30 : v === 'x' ? 30 : 0 }; vp.setSection(store.ui.section); renderViewbar(); } })),
      row('Position', h('div', { class: 'range-row' }, secSlider, secOut)));
    viewbar.replaceChildren(
      h('div', { class: 'vb-group', role: 'group', 'aria-label': 'Camera views' },
        ...views.map(([k, l]) => h('button', { class: 'vb-btn', type: 'button', onclick: () => vp.view(k, analysis().dims?.box) }, l)),
        h('button', { class: 'vb-btn', type: 'button', title: "Driver's eye view", disabled: !analysis().ergo?.pose, onclick: () => panelCtx.driverView() }, 'Driver')),
      h('div', { class: 'vb-group' },
        h('button', { class: `vb-btn icon ${ui.xray ? 'active' : ''}`, type: 'button', title: 'X-ray (X)', 'aria-pressed': String(ui.xray), onclick: () => store.setUI({ xray: !ui.xray }) }, icon('xray', 16), 'X-ray'),
        h('button', { class: `vb-btn icon ${ui.focusMode ? 'active' : ''}`, type: 'button', title: 'Fade other subsystems while working in a tab', 'aria-pressed': String(ui.focusMode), onclick: () => store.setUI({ focusMode: !ui.focusMode }) }, icon('target', 16), 'Focus'),
        h('button', { class: `vb-btn icon ${ui.labels ? 'active' : ''}`, type: 'button', title: 'Hover labels', 'aria-pressed': String(ui.labels), onclick: () => store.setUI({ labels: !ui.labels }) }, icon('tag', 16), 'Labels'),
        h('div', { class: 'pop-wrap' }, h('button', { class: `vb-btn icon ${ui.section.enabled ? 'active' : ''}`, type: 'button', onclick: () => togglePop(sectionPop) }, icon('section', 16), 'Section'), sectionPop),
        h('div', { class: 'pop-wrap' }, h('button', { class: 'vb-btn icon', type: 'button', onclick: () => togglePop(layerPop) }, icon('layers', 16), 'Layers'), layerPop)));
  };

  const renderLegend = () => {
    const ui = store.ui;
    if (ctx.stressView.refreshActive()) {
      const target = store.state.stress.settings.fosYield;
      const stops = [0.75, 1, target, Math.max(target + 0.75, 2.5), Math.max(target + 1.5, 3.5)];
      const swatch = (v) => { const [r, g, b] = fosColor(v, target); return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`; };
      legend.replaceChildren(h('span', { class: 'lg-title' }, 'Factor of safety'),
        ...stops.map((v, i) => h('span', { class: 'lg' }, h('i', { style: { background: swatch(v) } }), i === 0 ? `< 1` : i === stops.length - 1 ? `${fmtNum(v, 1)}+` : fmtNum(v, 1))),
        h('span', { class: 'lg' }, h('i', { class: 'c-load' }), 'Load'), h('span', { class: 'lg' }, h('i', { class: 'c-hold' }), 'Held'));
      hint.hidden = true;
      return;
    }
    const items = ui.tab === 'dynamics'
      ? [['hp chassis', 'Frame mount'], ['hp upright', 'Upright point'], ['hp lca', 'Arm point']]
      : ui.colorBy === 'subsystem' ? [['c-primary', 'Primary tube'], ['c-secondary', 'Secondary tube'], ['c-susp', 'Suspension mount']] : [];
    const routes = ui.layers.routing ? [['c-brake', 'Brake line'], ['c-flex', 'Flex hose'], ['c-throttle', 'Throttle cable']] : [];
    legend.replaceChildren(...[...items, ...routes].map(([c, l]) => h('span', { class: 'lg' }, h('i', { class: c }), l)));
    hint.textContent = ui.tool !== 'select' ? TOOL_HINTS[ui.tool] : '';
    hint.hidden = ui.tool === 'select';
  };

  // ------------------------------------------------------------ design checks tray
  const renderTray = () => {
    const ui = store.ui;
    const list = issues();
    const filter = ui.issueFilter;
    const shown = list.filter((i) => filter === 'all' || (filter === 'hardware' ? ['hardware', 'general'].includes(i.category) : i.category === filter));
    const count = (sev) => list.filter((i) => i.severity === sev).length;
    const filters = [['all', 'All'], ['chassis', 'Chassis'], ['dynamics', 'Dynamics'], ['ergonomics', 'Ergonomics'], ['powertrain', 'Powertrain'], ['hardware', 'Hardware & vehicle']];
    tray.classList.toggle('closed', !ui.issuesOpen);
    setChildren(tray,
      h('div', { class: 'tray-head' },
        h('button', { class: 'tray-toggle', type: 'button', 'aria-expanded': String(ui.issuesOpen), onclick: () => store.setUI({ issuesOpen: !ui.issuesOpen }) }, icon('chevron', 14), h('span', { class: 'tray-title' }, 'Design checks')),
        h('span', { class: 'sev error' }, `${count('error')} errors`), h('span', { class: 'sev warning' }, `${count('warning')} warnings`), h('span', { class: 'sev info' }, `${count('info')} notes`),
        ui.issuesOpen ? h('div', { class: 'chips' }, filters.map(([k, l]) => h('button', { class: `chip ${filter === k ? 'active' : ''}`, type: 'button', onclick: () => store.setUI({ issueFilter: k }) }, l))) : null),
      ui.issuesOpen ? h('ul', { class: 'issues' }, shown.length ? shown.map((i) => issueItem(i)) : h('li', { class: 'issue none' }, 'Nothing flagged here.')) : null);
  };
  const issueItem = (i) => {
    const t = i.targets?.[0];
    const selectTarget = () => {
      if (!t) return;
      if (t.kind === 'axle') { store.setUI({ tab: 'dynamics', selection: { kind: 'axle', id: t.id, side: 'L' } }); return; }
      const sel = { kind: t.kind, id: t.id, side: t.kind === 'hardpoint' ? 'L' : undefined };
      if (t.kind === 'member' && i.targets.length > 1 && i.targets.every((x) => x.kind === 'member')) sel.ids = i.targets.map((x) => x.id);
      store.select(sel);
      interaction.syncGizmo();
      interaction.focusSelection();
    };
    return h('li', {
      class: `issue ${i.severity}`,
      onmouseenter: () => builder.applyVisual(i.targets || []),
      onmouseleave: () => builder.applyVisual(),
    },
    h('span', { class: `sev-dot ${i.severity}`, 'aria-label': i.severity }),
    h('div', { class: 'issue-body' }, h('div', { class: 'issue-title' }, i.title), i.detail ? h('div', { class: 'issue-detail' }, i.detail) : null),
    h('span', { class: `pill tiny cat-${i.category}` }, i.category),
    h('div', { class: 'issue-actions' },
      i.fix ? h('button', { class: 'btn tiny primary', type: 'button', onclick: () => { store.commit(i.fix.label, (s) => i.fix.apply(s)); toast(i.fix.label, 'ok'); } }, i.fix.label) : null,
      t ? h('button', { class: 'btn tiny', type: 'button', onclick: selectTarget }, 'Show') : null));
  };

  // ------------------------------------------------------------ animation of travel preview
  let animT = null;
  const toggleAnimate = () => {
    const ui = store.ui;
    if (ui.sim.animate) { ui.sim.animate = false; cancelAnimationFrame(animT); panelCtx.setSim({ heave: 0 }); schedulePanel(); return; }
    ui.sim.animate = true;
    const f = store.state.suspension.front, r = store.state.suspension.rear;
    const lo = -Math.max(f.droop, r.droop), hi = Math.max(f.bump, r.bump);
    const t0 = performance.now();
    const step = (now) => {
      if (!store.ui.sim.animate) return;
      const s = (Math.sin(((now - t0) / 2400) * Math.PI * 2) + 1) / 2;
      panelCtx.setSim({ heave: lo + (hi - lo) * s });
      animT = requestAnimationFrame(step);
    };
    animT = requestAnimationFrame(step);
    schedulePanel();
  };

  return {
    startImport: (file) => startImport(panelCtx, file),
    schedulePanel, scheduleInspector, renderTabs, renderChips, renderViewbar, renderLegend, renderTray,
    renderAll() { schedulePanel(); scheduleInspector(); renderTabs(); renderChips(); renderViewbar(); renderLegend(); renderTray(); },
  };

  // ------------------------------------------------------------ dialogs
  function openSettings(c) {
    const ui = c.store.ui;
    const set = (patch) => { c.store.setUI({ prefs: { ...c.store.ui.prefs, ...patch } }); setUnitPrefs(c.store.ui.prefs); c.applyTheme(); c.refreshAll(); };
    modal({
      title: 'Settings',
      body: h('div', { class: 'stack' },
        h('div', { class: 'row-label' }, 'Appearance'),
        appearancePicker(ui.prefs.theme, (v) => crossfade(() => set({ theme: v }))),
        row('Length display', selectField({ id: 'set-fmt', value: ui.prefs.lengthFormat, options: [{ value: 'decimal', label: 'Decimal inches (24.500 in)' }, { value: 'fraction', label: 'Fractional inches (24 1/2 in)' }, { value: 'ftin', label: 'Feet-inches (2′ 1/2″)' }], onChange: (v) => set({ lengthFormat: v }) })),
        row('Decimal places', selectField({ id: 'set-prec', value: ui.prefs.precision, options: [1, 2, 3, 4].map((v) => ({ value: v, label: String(v) })), onChange: (v) => set({ precision: v }) })),
        h('p', { class: 'muted small' }, 'All values are stored in inches, pounds and degrees. Inputs also accept fractions (24 1/2), feet-inches (2\' 6") and metric (600mm), converted to inches.'),
        checkField({ id: 'set-gate', checked: c.store.state.workflow?.requireStressTest !== false, label: 'Require a passing frame stress test before adding suspension, ergonomics and powertrain (this project)', onChange: (v) => { c.store.commit(v ? 'Require stress test' : 'Stop requiring stress test', (s) => { s.workflow = { ...(s.workflow || {}), requireStressTest: v }; }); c.refreshAll(); } }),
        section('Design checks', h('div', { class: 'stack' }, c.listChecks().map((r) => checkField({ id: `chk-${r.id}`, checked: !c.store.state.checks?.disabled?.[r.id], label: `${r.label} (${r.category})`, onChange: (v) => c.store.commit('Toggle check', (s) => { s.checks ??= { disabled: {} }; s.checks.disabled[r.id] = !v; }) }))), { id: 'set-checks', open: false })),
    });
  }

  function openHelp() {
    const keys = [['V / N / T / S / M', 'Select · Node · Tube · Split · Measure'], ['Shift (while drawing)', 'Snap tube angle to the angle step'], ['Esc / right-click', 'End tube chain · cancel tool · clear selection'], ['W / E', 'Move / rotate gizmo for parts'], ['R', 'Rotate selected part 90° about Z'], ['F', 'Focus camera on selection'], ['Del', 'Delete selection'], ['Ctrl+Z / Ctrl+Y', 'Undo / redo'], ['Ctrl+D', 'Duplicate part'], ['G', 'Toggle grid snap'], ['X', 'Toggle X-ray'], ['1 – 5', 'Switch tabs'], ['Double-click', 'Zoom to the clicked point']];
    modal({
      title: 'Help & shortcuts', wide: true,
      body: h('div', { class: 'help' },
        h('p', {}, 'Coordinates: ', h('b', {}, '+X forward, +Y to the driver\'s left, +Z up'), '. Origin is on the ground, on the centerline, at the rear-axle line. Everything is in inches, pounds and degrees.'),
        h('ul', { class: 'help-list' },
          h('li', {}, h('b', {}, 'Chassis: '), 'pick the Tube tool, click joints or grid points to chain tubes. Type exact lengths and angles in the panel. Mirror builds both sides. Select a joint to read and set the angles between tubes; select a tube to set its exact length, angles, profile and role.'),
          h('li', {}, h('b', {}, 'Stress test: '), 'a new frame must pass Baja impact cases (front, rear, sides, rollover, landing, torsion, plus your own impact points) before the other systems unlock. Tubes are colored by factor of safety.'),
          h('li', {}, h('b', {}, 'Import CAD: '), 'export the frame from SolidWorks as STEP AP214 (File ▸ Save As) and drop it on the 3D view; tubes and joints are rebuilt as an editable frame, and bent tubes are split at each bend\'s virtual sharp.'),
          h('li', {}, h('b', {}, 'Dynamics: '), 'type hardpoints or drag the colored points. The suspension is solved through bump, droop and steering — KPI, caster, scrub, roll centers, bump steer, Ackermann and shock stroke are checked.'),
          h('li', {}, h('b', {}, 'Ergonomics: '), 'add your drivers by name, height, weight and gender (or their measured body lengths), choose a seat and material, and place it and the pedals; the selected driver poses itself, the checks cover every driver, and brake lines/throttle cable route automatically.'),
          h('li', {}, h('b', {}, 'Powertrain: '), 'place the gearbox on the rear axle; the CVT and engine attach in a chain and CV half-shafts are generated.'),
          h('li', {}, h('b', {}, 'Parts Library: '), 'all five categories. Drag a card onto the car or click Add. Hover a card for its specs.')),
        h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' }, h('tbody', {}, keys.map(([k, d]) => h('tr', {}, h('td', {}, h('kbd', {}, k)), h('td', {}, d)))))),
        h('p', { class: 'muted small' }, 'Rule checks paraphrase common Baja SAE requirements and are approximate. Always confirm against the current rulebook. Catalog values are typical starting points; verify with supplier data.')),
    });
  }
}

export { kv, numField };
