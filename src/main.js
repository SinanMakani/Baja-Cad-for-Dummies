// Entry point: wires the store, analysis, design checks, 3D view and UI together.
import './styles.css';
import * as THREE from 'three';

// Catalog categories and check rules register themselves on import.
import './catalog/powertrain.js';
import './catalog/dynamics.js';
import './catalog/ergonomics.js';
import './catalog/hardware.js';
import { applyDefaultMounts } from './catalog/mounts.js';
import './checks/chassis.js';
import './checks/stress.js';
import './checks/dynamics.js';
import './checks/ergonomics.js';
import './checks/powertrain.js';
import './checks/general.js';

import { Store } from './core/store.js';
import { newProject, defaultUI, migrate } from './core/defaults.js';
import { setUnitPrefs } from './core/units.js';
import { integrate } from './systems/integration.js';
import { analyze } from './systems/analysis.js';
import { gateLocked, lastResults, chassisHash, runStressTests } from './systems/stresstest.js';
import { runChecks, listChecks } from './checks/index.js';
import { Viewport } from './view/viewport.js';
import { Builder } from './view/build3d.js';
import { Overlays } from './view/overlays.js';
import { Interaction } from './view/interaction.js';
import { CadView } from './view/cadView.js';
import { StressView } from './view/stressView.js';
import { createApp } from './ui/app.js';
import { setAppearance, watchAutoAppearance } from './ui/theme.js';

applyDefaultMounts();

// ------------------------------------------------------------------ state
let initial;
try { const saved = Store.loadAutosave(); initial = saved ? migrate(saved) : newProject(); } catch { initial = newProject(); }
const ui = defaultUI(Store.loadPrefs());
setUnitPrefs(ui.prefs);
const store = new Store(initial, ui);
store.normalizers.push(integrate);
integrate(store.state);

const analysis = () => analyze(store);
let issueCache = { rev: -1, list: [] };
const issues = () => {
  if (issueCache.rev !== store.rev) {
    let list = runChecks(store.state, analysis(), store.state.checks?.disabled);
    // While a new frame is still being stress-tested, only frame checks apply.
    if (gateLocked(store.state)) list = list.filter((i) => i.category === 'chassis');
    issueCache = { rev: store.rev, list };
  }
  return issueCache.list;
};

// ------------------------------------------------------------------ theme
const TOKENS = {
  sceneBg: '--scene-bg', gridMinor: '--scene-grid', gridMajor: '--scene-grid-major', gridAxis: '--scene-axis', hemiSky: '--scene-sky', hemiGround: '--scene-ground',
  chassis: '--c-chassis', chassisSecondary: '--c-chassis-2', chassisSusp: '--c-susp-mount', node: '--c-node',
  dynamics: '--c-dynamics', dynamicsLink: '--c-dyn-link', spring: '--c-spring', shaft: '--c-shaft',
  hpChassis: '--c-hp-chassis', hpUpright: '--c-hp-upright', hpArm: '--c-hp-arm',
  brake: '--c-brake', brakeFlex: '--c-flex', throttle: '--c-throttle',
  driver: '--c-driver', driverSuit: '--c-suit', helmet: '--c-helmet',
  select: '--c-select', hover: '--c-hover', flag: '--c-flag', dim: '--c-dim', arc: '--c-arc', measure: '--c-measure', plane: '--c-plane', preview: '--c-preview', snap: '--c-snap',
  deformed: '--fg',
};

function readTheme() {
  const cs = getComputedStyle(document.documentElement);
  const t = {};
  for (const [k, v] of Object.entries(TOKENS)) t[k] = new THREE.Color(cs.getPropertyValue(v).trim() || '#888').getHex();
  t.shadow = parseFloat(cs.getPropertyValue('--scene-shadow')) || 0.18;
  return t;
}

// ------------------------------------------------------------------ view
const vpEl = document.getElementById('viewport');
const vp = new Viewport(vpEl);
const builder = new Builder(vp, store, analysis);
const overlays = new Overlays(vp, store, {});
const interaction = new Interaction({ vp, store, builder, overlays, analysis, tooltip: document.createElement('div'), readout: document.createElement('div') });
const cadView = new CadView(vp);
const stressView = new StressView(vp, store);
builder.memberOverride = (id) => stressView.memberColor(id);

function applyTheme() {
  setAppearance(store.ui.prefs.theme);
  const t = readTheme();
  for (const v of [vp, builder, overlays, cadView, stressView]) v.setTheme(t);
}
applyTheme();
// Auto follows claude.ai's theme inside an Artifact, else the OS; the 3D scene re-reads its colors.
watchAutoAppearance(() => { if (store.ui.prefs.theme === 'system') { applyTheme(); refreshAll(); } });

/** Rebuild the scene: decide first whether stress results or the integration gate change what is shown. */
function rebuild() {
  builder.locked = gateLocked(store.state);
  builder.stressActive = !!stressView.refreshActive();
  builder.rebuild();
  stressView.update();
}

/** In-memory results are lost on reload; recompute them silently when the saved run still matches. */
function restoreStressResults() {
  const st = store.state;
  if (store.ui.chassisMode !== 'stress' || !st.stress?.last) return;
  const hash = chassisHash(st);
  if (!lastResults(hash) && st.stress.last.hash === hash) runStressTests(st);
}

function refreshAll() {
  rebuild();
  overlays.update();
  builder.applyVisual();
  interaction.syncGizmo();
  app.renderAll();
}

const app = createApp({
  store, vp, builder, overlays, interaction, analysis, issues, applyTheme, listChecks, cadView, stressView,
  refreshAll: () => refreshAll(),
  refreshStress: () => stressView.update(),
});

// Drop a CAD file anywhere on the 3D view to import it.
vpEl.addEventListener('dragover', (e) => { if (!interaction.dragDef && e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
vpEl.addEventListener('drop', (e) => {
  const f = e.dataTransfer?.files?.[0];
  if (!f || interaction.dragDef) return;
  e.preventDefault();
  e.stopPropagation();
  app.startImport(f);
}, true);

// ------------------------------------------------------------------ events
store.subscribe((evt) => {
  if (evt.type === 'state') {
    rebuild();
    overlays.update();
    builder.applyVisual();
    interaction.syncGizmo();
    app.scheduleInspector();
    if (!evt.transient) {
      app.schedulePanel();
      app.renderTabs();
      app.renderChips();
      app.renderTray();
      app.renderLegend();
    }
    return;
  }
  const p = evt.patch || {};
  const has = (...keys) => keys.some((k) => k in p);
  if (has('tab', 'chassisMode')) {
    if (['node', 'tube', 'split'].includes(store.ui.tool) && (store.ui.tab !== 'chassis' || store.ui.chassisMode !== 'build')) interaction.setTool('select');
    restoreStressResults();
  }
  if (has('tab', 'chassisMode', 'stressView', 'selection', 'layers', 'colorBy')) rebuild();
  if (has('selection', 'hover', 'labels', 'measure', 'tab', 'layers', 'xray', 'focusMode', 'chassisMode', 'stressView')) { overlays.update(); builder.applyVisual(); }
  if (has('selection', 'gizmoMode', 'snap', 'tool')) interaction.syncGizmo();
  if (has('selection', 'gizmoMode', 'lengthAnchor', 'tab', 'chassisMode', 'stressView')) app.scheduleInspector();
  if (has('tab', 'tool', 'drawing', 'exactMode', 'workPlane', 'snap', 'mirror', 'activeProfile', 'activeRole', 'libraryCat', 'layers', 'selection', 'chassisMode', 'stressView')) app.schedulePanel();
  if (has('tab', 'chassisMode')) app.renderTabs();
  if (has('layers', 'xray', 'focusMode', 'labels', 'colorBy')) app.renderViewbar();
  if (has('tab', 'tool', 'layers', 'colorBy', 'chassisMode', 'stressView')) app.renderLegend();
  if (has('issuesOpen', 'issueFilter')) app.renderTray();
  if (!Object.keys(p).length) app.renderAll();
});

// ------------------------------------------------------------------ first frame
restoreStressResults();
rebuild();
overlays.update();
builder.applyVisual();
app.renderAll();
vp.view('iso', analysis().dims?.box || cadView.bounds());

// Handy for debugging and for teammates extending the tool from the console.
window.baja = { store, analysis, issues, vp, builder, cadView, stressView, THREE, startImport: (file) => app.startImport(file) };
