// Default project and editor session. The starter frame is a generic Baja
// layout meant as a starting sketch; it passes the default stress tests
// (scripts/test-stress.mjs) but is not a validated design.
import { SCHEMA_VERSION } from './store.js';
import { DEFAULT_PROFILES } from '../catalog/materials.js';
import { addNode, addMember } from '../systems/chassis.js';
import { defaultStress } from '../systems/stresstest.js';
import { defaultErgonomics, migrateErgonomics } from '../systems/drivers.js';

// Left-side nodes (+Y); every node off the centerline is mirrored automatically.
// TP sits under the trailing-arm pivot; SX is where the side brace meets the SIM.
const FRAME_NODES = {
  J: [-14, 11.0, 11.0], K: [-12, 11.0, 25.0],
  S: [-3, 11.79, 10.61], T: [-3, 12.13, 17.0], U: [-3, 12.56, 25.0],
  A: [14, 13.0, 10.0], W: [14, 14.33, 18.0], B: [14, 15.5, 25.0], R: [13.34, 15.06, 36.0], RM: [13.34, 0, 36.0],
  C: [12.5, 14.5, 50.0], D: [11, 11.0, 58.0], DM: [11, 0, 58.0], E: [40, 11.0, 58.0],
  TP: [26, 12.2125, 10.0], SX: [26, 14.7105, 25.6316],
  V: [30, 11.95, 10.0], F: [52, 13.0, 27.0], G: [52, 10.5, 10.0], M: [52, 10.5, 19.0],
  P: [64, 10.5, 10.0], Q: [64, 10.5, 19.0], I: [74, 8.0, 11.0], H: [74, 8.0, 23.0],
};

// [from, to, role, profile?]. A trailing ' means the mirrored (right-side) node.
// The side-impact members and rear roll hoop use 0.083 in wall: with 0.065 in
// they fall just short of FoS 1.5 in the side-impact and roof-corner tests.
const FRAME_MEMBERS = [
  ['A', 'W', 'RRH'], ['W', 'B', 'RRH'], ['B', 'R', 'RRH'], ['R', 'C', 'RRH'], ['C', 'D', 'RRH'], ['D', 'DM', 'RRH'],
  ['C', 'DM', 'LDB', 'P100x065'], // V-brace from the shoulders to the middle of the hoop top, clear of the helmet
  ['B', 'RM', 'LDB', 'P100x065'], // V-brace up to the middle of the shoulder-harness bar, behind the seat
  ['D', 'E', 'RHO'], ['E', "E'", 'LC'],
  ['E', 'F', 'FBM'], ['F', 'H', 'FBM'],
  ['B', 'SX', 'SIM'], ['SX', 'F', 'SIM'],
  ['A', 'TP', 'LFS'], ['TP', 'V', 'LFS'], ['V', 'G', 'LFS'], ['G', 'P', 'LFS'], ['P', 'I', 'LFS'],
  ['TP', 'SX', 'SEC', 'P100x065'],
  ['G', 'M', 'SUSP'], ['M', 'F', 'SEC'], ['P', 'Q', 'SUSP'], ['M', 'Q', 'SUSP'], ['Q', 'H', 'SUSP'], ['I', 'H', 'SEC'],
  ['A', "A'", 'LC'], ['B', "B'", 'LC'], ['R', 'RM', 'LC'], ['F', "F'", 'LC'], ['G', "G'", 'LC'], ['P', "P'", 'LC'],
  ['I', "I'", 'LC'], ['H', "H'", 'LC'], ['V', "V'", 'USM'],
  ['A', 'S', 'SEC'], ['S', 'J', 'SEC'], ['B', 'U', 'SEC'], ['U', 'K', 'SEC'], ['J', 'K', 'SEC'],
  ['S', 'T', 'SUSP'], ['T', 'U', 'SUSP'], ['W', 'T', 'SEC'],
  ['J', "J'", 'SEC'], ['K', "K'", 'SEC'], ['U', "U'", 'SEC'],
  ['C', 'K', 'FAB'],
];

// Lateral diagonal across the lower rear roll hoop (not mirrored). The upper
// hoop is braced by the shoulder V instead: a diagonal there would pass
// behind the driver's helmet.
const DIAGONALS = [["A'", 'B']];

const PRIMARY = new Set(['RRH', 'RHO', 'FBM', 'LFS', 'SIM', 'LC', 'USM']);
const HEAVY = new Set(['RRH', 'SIM']);

export function buildStarterFrame(state) {
  state.chassis.nodes = {};
  state.chassis.members = {};
  state.chassis.profiles = { ...DEFAULT_PROFILES, ...(state.chassis.profiles || {}) };
  state.seq = { ...(state.seq || {}), N: 0, T: 0 };
  const ids = {};
  for (const [k, p] of Object.entries(FRAME_NODES)) {
    ids[k] = addNode(state, p, { mirror: true });
    ids[`${k}'`] = state.chassis.nodes[ids[k]].pair || ids[k];
  }
  for (const [a, b, role, profile] of FRAME_MEMBERS) {
    const prof = profile || (HEAVY.has(role) ? 'P125x083' : PRIMARY.has(role) ? 'P125x065' : 'P100x049');
    addMember(state, ids[a], ids[b], { role, profile: prof, mirror: true });
  }
  // Lateral diagonal bracing across the rear roll hoop.
  for (const [a, b] of DIAGONALS) addMember(state, ids[a], ids[b], { role: 'LDB', profile: 'P100x065' });
  state.chassis.nodeLabels = Object.fromEntries(Object.entries(ids).map(([k, id]) => [id, k]));
}

export function defaultSuspension() {
  return {
    front: {
      type: 'double-wishbone',
      points: {
        UCA_F: [64, 10.5, 19.0], UCA_R: [52, 10.5, 19.0],
        LCA_F: [64, 10.5, 10.5], LCA_R: [52, 10.5, 10.5],
        UBJ: [57.4, 22.8, 15.5], LBJ: [58.2, 23.5, 7.5],
        TR_I: [53.5, 10.5, 14.065], TR_O: [54.5, 22.6, 11.0],
        WC: [58, 27, 11.5],
        SH_U: [58.5, 11.5, 25.8], SH_L: [58.14, 19.6, 8.4],
      },
      tire: 'dyn.tire.23x7-10', shock: 'dyn.shock.co21', shockSpec: null,
      caliper: 'dyn.caliper.single', rotor: 'dyn.rotor.8', upright: 'dyn.upright.7075',
      camber: -1.0, toe: 0.0, bump: 5.0, droop: 2.75,
    },
    rear: {
      type: 'trailing-arm',
      points: {
        TA_P: [26, 12.2, 10.5], TA_H: [2.5, 21.2, 11.0],
        CLU_I: [-3, 12.13, 15.4], CLU_O: [-2.5, 21.2, 14.6],
        CLL_I: [-3, 11.8, 9.4], CLL_O: [-2.5, 21.2, 8.6],
        WC: [0, 25, 11],
        SH_U: [1, 13.25, 25.5], SH_L: [3, 19.0, 11.5],
      },
      tire: 'dyn.tire.22x10-10', shock: 'dyn.shock.co17', shockSpec: null,
      caliper: 'dyn.caliper.dual', rotor: 'dyn.rotor.8', upright: 'dyn.upright.rear6061',
      camber: 0.0, toe: 0.0, bump: 3.75, droop: 2.25, brakeMode: 'inboard',
    },
    steering: { rack: 'dyn.rack.12', travel: 1.75 },
  };
}

function starterParts() {
  const list = [
    ['pt.gearbox.2stage', [0, 0, 11], [0, 0, 0], {}, 'Gearbox'],
    ['pt.cvt.gx9', [0, 0, 0], [0, 0, 0], { angle: 70 }, 'CVT'],
    ['pt.engine.vanguard10', [0, 0, 0], [0, 0, 0], {}, 'Engine'],
    ['pt.fueltank', [8, -11.3, 19.25], [0, 0, 0], {}, 'Fuel tank'],
    ['erg.seat.al', [24, 0, 10.75], [0, 0, 0], {}, 'Driver seat'],
    ['erg.harness5', [29.6, 0, 15.3], [0, 0, 0], {}, '5-point harness'],
    ['erg.pedal.brake', [67, 3.0, 10.25], [0, 0, 0], {}, 'Brake pedal'],
    ['erg.pedal.throttle', [67, -3.5, 10.25], [0, 0, 0], {}, 'Throttle pedal'],
    ['erg.steeringwheel', [42, 0, 38], [0, 20, 0], {}, 'Steering wheel'],
    ['hw.firewall', [13.2, 0, 10.5], [0, 0, 0], {}, 'Firewall'],
    ['hw.killswitch.cockpit', [52, 5, 27.6], [0, 0, 0], {}, 'Kill switch (cockpit)'],
    ['hw.killswitch.external', [-12, 6, 25.6], [0, 0, 0], {}, 'Kill switch (external)'],
    ['hw.brakelight', [-12.6, 0, 26.4], [0, 0, 0], {}, 'Brake light'],
    ['hw.extinguisher', [17, -12, 26], [0, 0, 0], {}, 'Fire extinguisher'],
    ['hw.battery', [-11, -5, 25.625], [0, 0, 0], {}, 'Battery'],
    ['ch.towpoint', [74.7, 0, 11], [0, 0, 0], {}, 'Tow point (front)'],
    ['ch.towpoint', [-14.7, 0, 11], [0, 0, 180], {}, 'Tow point (rear)'],
    ['ch.skidplate', [44, 0, 9.375], [0, 0, 0], { length: 60, width: 20 }, 'Skid plate'],
  ];
  const parts = {};
  list.forEach(([def, pos, rot, params, name], i) => {
    const id = `P${i + 1}`;
    parts[id] = { id, def, name, pos, rot, params, notes: '' };
  });
  return parts;
}

export function newProject({ template = 'starter', name = 'Longhorn Baja concept' } = {}) {
  const now = new Date().toISOString();
  const state = {
    schema: SCHEMA_VERSION,
    meta: { name, notes: '', created: now, modified: now },
    seq: { N: 0, T: 0, P: 0, D: 1 },
    chassis: { nodes: {}, members: {}, profiles: structuredClone(DEFAULT_PROFILES), defaultProfile: 'P125x065', nodeLabels: {} },
    suspension: defaultSuspension(),
    parts: {},
    powertrain: { autoLink: true },
    ergonomics: defaultErgonomics(),
    routing: { avoidHeat: true },
    customDefs: {},
    checks: { disabled: {} },
    stress: defaultStress(),
    // A frame started from scratch (or imported from CAD) must pass the stress
    // tests before suspension, ergonomics and powertrain can be integrated.
    workflow: { requireStressTest: true, unlocked: template === 'starter' },
  };
  if (template === 'starter') {
    buildStarterFrame(state);
    state.parts = starterParts();
    state.seq.P = Object.keys(state.parts).length;
  }
  return state;
}

export function defaultUI(saved) {
  const ui = {
    tab: 'chassis',
    tool: 'select',
    selection: null,
    hover: null,
    workPlane: { axis: 'XZ', offset: 0, follow: true },
    snap: { grid: true, step: 0.5, angle: 5, nodes: true },
    mirror: true,
    activeProfile: 'P125x065',
    activeRole: 'SEC',
    layers: { chassis: true, dynamics: true, ergonomics: true, powertrain: true, hardware: true, routing: true, driver: true, hardpoints: true, grid: true, dims: true, cg: false, nodes: true },
    xray: false,
    focusMode: true,
    colorBy: 'subsystem',
    labels: true,
    section: { enabled: false, axis: 'y', offset: 0 },
    sim: { heave: 0, rack: 0, animate: false },
    prefs: { lengthFormat: 'decimal', precision: 3, theme: 'system' },
    gizmoMode: 'translate',
    issuesOpen: true,
    issueFilter: 'all',
    drawing: null,
    measure: null,
    chassisMode: 'build',
    stressView: { on: true, caseKey: null, scale: null },
  };
  if (saved) {
    if (saved.prefs) Object.assign(ui.prefs, saved.prefs);
    if (saved.layers) Object.assign(ui.layers, saved.layers);
    if (saved.snap) Object.assign(ui.snap, saved.snap);
    if (typeof saved.mirror === 'boolean') ui.mirror = saved.mirror;
    if (typeof saved.focusMode === 'boolean') ui.focusMode = saved.focusMode;
    if (['chassis', 'dynamics', 'ergonomics', 'powertrain', 'library'].includes(saved.tab)) ui.tab = saved.tab;
  }
  return ui;
}

/** Upgrade older saved projects to the current schema (extend as the schema grows). */
export function migrate(state) {
  if (!state || typeof state !== 'object') throw new Error('Not a Baja Designer project file.');
  if (!state.chassis || !state.suspension || !state.parts) throw new Error('Project file is missing chassis, suspension or parts data.');
  state.schema = SCHEMA_VERSION;
  state.meta ??= { name: 'Imported project' };
  state.powertrain ??= { autoLink: true };
  migrateErgonomics(state); // fixed design drivers → the team's own driver roster
  state.routing ??= { avoidHeat: true };
  state.customDefs ??= {};
  state.checks ??= { disabled: {} };
  state.chassis.profiles ??= structuredClone(DEFAULT_PROFILES);
  state.chassis.nodeLabels ??= {};
  for (const [k, p] of Object.entries(DEFAULT_PROFILES)) state.chassis.profiles[k] ??= structuredClone(p);
  state.suspension.steering ??= { rack: 'dyn.rack.12', travel: 1.75 };
  const stress = defaultStress();
  state.stress ??= stress;
  state.stress.settings = { ...stress.settings, ...(state.stress.settings || {}) };
  state.stress.cases = { ...stress.cases, ...(state.stress.cases || {}) };
  state.stress.custom ??= [];
  // Projects saved before the stress-test gate existed keep working unlocked.
  state.workflow ??= { requireStressTest: true, unlocked: true };
  return state;
}
