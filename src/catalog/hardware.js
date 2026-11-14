// Hardware & electrical catalog, plus chassis accessories (plates, gussets,
// tabs) and fully custom placeholder parts.
import { register } from './index.js';
import { box, cyl, group, COLORS, mat, plate } from './shapes.js';
import { fmtLen, fmtWeight, fmtNum } from '../core/units.js';
import * as THREE from 'three';
import { DEG } from '../core/geom.js';

const SHEET = {
  al5052: { label: 'Aluminum 5052', density: 0.097, color: 0xc3c8ce, metal: 0.7 },
  al6061: { label: 'Aluminum 6061-T6', density: 0.0975, color: 0xc9ced3, metal: 0.7 },
  steel: { label: 'Mild steel', density: 0.284, color: 0x8a939c, metal: 0.7 },
  '4130': { label: '4130 steel', density: 0.284, color: 0x7f8891, metal: 0.7 },
  hdpe: { label: 'HDPE / UHMW', density: 0.034, color: 0x2e3440, metal: 0 },
  carbon: { label: 'Carbon fiber', density: 0.056, color: 0x25282c, metal: 0.2 },
  lexan: { label: 'Polycarbonate', density: 0.043, color: 0xa9c7dd, metal: 0 },
};
const sheetOptions = (keys) => keys.map((value) => ({ value, label: SHEET[value].label }));

const sheetPart = ({ key, name, category, group: grp, role, summary, notes, L, W, t, material, materials, axis = 'z' }) => ({
  key, name, category, group: grp, role, summary, notes,
  params: [
    { key: 'length', label: axis === 'x' ? 'Height' : 'Length', type: 'length', default: L, step: 0.25 },
    { key: 'width', label: 'Width', type: 'length', default: W, step: 0.25 },
    { key: 'thickness', label: 'Thickness', type: 'length', default: t, step: 0.005 },
    { key: 'material', label: 'Material', type: 'select', default: material, options: sheetOptions(materials) },
  ],
  specs: (p) => [
    ['Size', `${fmtLen(p.length)} × ${fmtLen(p.width)} × ${fmtLen(p.thickness)}`],
    ['Material', SHEET[p.material]?.label],
    ['Area', `${fmtNum(p.length * p.width, 1)} in²`],
    ['Weight', fmtWeight(p.length * p.width * p.thickness * (SHEET[p.material]?.density || 0.1))],
  ],
  weight: (p) => p.length * p.width * p.thickness * (SHEET[p.material]?.density || 0.1),
  build: (p) => {
    const m = SHEET[p.material] || SHEET.al5052;
    const o = { metal: m.metal, rough: 0.5, opacity: p.material === 'lexan' ? 0.45 : 1 };
    return axis === 'x'
      ? group(box(p.thickness, p.width, p.length, m.color, [0, 0, p.length / 2], o))
      : group(box(p.length, p.width, p.thickness, m.color, [0, 0, -p.thickness / 2], o));
  },
});

const redBox = (color) => mat(color, { metal: 0.1, rough: 0.5 });

register([
  // ---------- Chassis accessories ----------
  sheetPart({ key: 'ch.skidplate', name: 'Skid plate / belly pan', category: 'chassis', group: 'Plates & panels', role: 'skidPlate',
    summary: 'Floor pan under the driver and drivetrain', notes: 'Local origin is the top-center of the plate (drop it on the lower frame rails).',
    L: 40, W: 24, t: 0.125, material: 'hdpe', materials: ['hdpe', 'al5052', 'al6061', 'steel'] }),
  sheetPart({ key: 'ch.engineplate', name: 'Engine mount plate', category: 'chassis', group: 'Plates & panels', role: 'enginePlate',
    summary: 'Bolted plate bridging the engine rails', notes: 'Local origin is the top-center of the plate.',
    L: 12, W: 14, t: 0.25, material: 'al6061', materials: ['al6061', 'steel', '4130'] }),
  sheetPart({ key: 'ch.bodypanel', name: 'Body panel', category: 'chassis', group: 'Plates & panels', role: 'bodyPanel',
    summary: 'Side / nose panel, stands vertical', notes: 'Local origin is the bottom-center. Panel stands in the local YZ plane.',
    L: 14, W: 30, t: 0.06, material: 'hdpe', materials: ['hdpe', 'carbon', 'al5052', 'lexan'], axis: 'x' }),
  {
    key: 'ch.gusset', name: 'Triangular gusset', category: 'chassis', group: 'Gussets & tabs', role: 'gusset',
    summary: 'Weld-in plate gusset for tube joints',
    params: [
      { key: 'leg', label: 'Leg length', type: 'length', default: 2.5, step: 0.125 },
      { key: 'thickness', label: 'Thickness', type: 'length', default: 0.083, step: 0.005 },
    ],
    specs: (p) => [['Legs', `${fmtLen(p.leg)} × ${fmtLen(p.leg)}`], ['Thickness', fmtLen(p.thickness)], ['Material', '4130 sheet'], ['Weight', fmtWeight(0.5 * p.leg * p.leg * p.thickness * 0.284)]],
    weight: (p) => 0.5 * p.leg * p.leg * p.thickness * 0.284,
    build: (p) => group(plate([[0, 0], [p.leg, 0], [0, p.leg]], p.thickness, 0x7f8891)),
  },
  {
    key: 'ch.tab', name: 'Double-shear mounting tab', category: 'chassis', group: 'Gussets & tabs', role: 'tab',
    summary: 'Pair of tabs for rod ends / spherical bearings',
    params: [
      { key: 'gap', label: 'Gap between tabs', type: 'length', default: 0.75, step: 0.0625 },
      { key: 'height', label: 'Tab height', type: 'length', default: 1.5, step: 0.125 },
      { key: 'thickness', label: 'Tab thickness', type: 'length', default: 0.125, step: 0.0625 },
      { key: 'bolt', label: 'Bolt Ø', type: 'length', default: 0.375, step: 0.0625 },
    ],
    specs: (p) => [['Gap', fmtLen(p.gap)], ['Tab height', fmtLen(p.height)], ['Thickness', fmtLen(p.thickness)], ['Bolt', `Ø ${fmtLen(p.bolt)} grade 8`], ['Weight', fmtWeight(0.12)]],
    weight: () => 0.12,
    build: (p) => group(
      box(1.25, p.thickness, p.height, 0x7f8891, [0, p.gap / 2 + p.thickness / 2, p.height / 2]),
      box(1.25, p.thickness, p.height, 0x7f8891, [0, -p.gap / 2 - p.thickness / 2, p.height / 2]),
      cyl(p.bolt / 2, p.gap + 2 * p.thickness + 0.6, 'y', 0x55595e, [0, 0, p.height * 0.62]),
    ),
  },
  {
    key: 'ch.towpoint', name: 'Tow point', category: 'chassis', group: 'Gussets & tabs', role: 'towPoint',
    summary: 'Front and rear tow points are required on the frame',
    params: [{ key: 'hole', label: 'Opening Ø', type: 'length', default: 2.0, step: 0.125 }],
    specs: (p) => [['Opening', `Ø ${fmtLen(p.hole)} min (verify)`], ['Material', '0.188 in steel plate'], ['Weight', fmtWeight(0.4)]],
    weight: () => 0.4,
    build: (p) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(p.hole / 2 + 0.35, 0.3, 10, 28), mat(COLORS.yellow, { metal: 0.3, rough: 0.5 }));
      ring.rotation.x = 90 * DEG;
      ring.position.set(p.hole / 2 + 0.6, 0, 0);
      return group(box(1.2, 0.19, 1.4, COLORS.yellow, [0.4, 0, 0]), ring);
    },
  },

  // ---------- Hardware & electrical ----------
  {
    key: 'hw.killswitch.cockpit', name: 'Kill switch · cockpit', category: 'hardware', group: 'Electrical', role: 'killSwitch',
    summary: 'Driver-reachable ignition kill', params: [{ key: 'location', label: 'Location', type: 'hidden', default: 'cockpit' }],
    specs: () => [['Type', 'Push-pull / e-stop mushroom'], ['Location', 'Cockpit, reachable by belted driver'], ['Weight', fmtWeight(0.3)]],
    weight: () => 0.3,
    build: () => group(box(2, 2, 1.4, 0xd4b21e, [0, 0, 0.7]), cyl(0.75, 0.6, 'z', redBox(0xcc2222), [0, 0, 1.7])),
  },
  {
    key: 'hw.killswitch.external', name: 'Kill switch · external', category: 'hardware', group: 'Electrical', role: 'killSwitch',
    summary: 'Outside-reachable ignition kill', params: [{ key: 'location', label: 'Location', type: 'hidden', default: 'external' }],
    specs: () => [['Type', 'Push-pull / e-stop mushroom'], ['Location', 'Outside the vehicle (verify rule location)'], ['Weight', fmtWeight(0.3)]],
    weight: () => 0.3,
    build: () => group(box(2, 2, 1.4, 0xd4b21e, [0, 0, 0.7]), cyl(0.75, 0.6, 'z', redBox(0xcc2222), [0, 0, 1.7])),
  },
  {
    key: 'hw.brakelight', name: 'Brake light (LED)', category: 'hardware', group: 'Electrical', role: 'brakeLight',
    summary: 'Rear-facing red LED, pressure-switch triggered',
    specs: () => [['Lamp', 'Red LED, rear facing'], ['Trigger', 'Hydraulic pressure switch'], ['Weight', fmtWeight(0.4)]],
    weight: () => 0.4,
    build: () => {
      const lens = new THREE.MeshStandardMaterial({ color: 0xff3322, emissive: 0x991100, roughness: 0.3, metalness: 0 });
      return group(box(1.0, 4.5, 2.2, COLORS.black, [0, 0, 0]), box(0.25, 3.8, 1.6, lens, [-0.6, 0, 0]));
    },
  },
  {
    key: 'hw.battery', name: 'Battery 12 V', category: 'hardware', group: 'Electrical', role: 'battery',
    summary: 'Small sealed battery for lights / DAQ',
    params: [{ key: 'chem', label: 'Chemistry', type: 'select', default: 'lifepo4', options: [{ value: 'lifepo4', label: 'LiFePO₄ (≈2.2 lb)' }, { value: 'agm', label: 'Sealed AGM (≈5.5 lb)' }] }],
    specs: (p) => [['Chemistry', p.chem === 'agm' ? 'Sealed AGM' : 'LiFePO₄'], ['Voltage', '12 V'], ['Weight', fmtWeight(p.chem === 'agm' ? 5.5 : 2.2)], ['Mounting', 'Positively secured, terminals covered']],
    weight: (p) => (p.chem === 'agm' ? 5.5 : 2.2),
    build: () => group(box(5.5, 3.5, 4, 0x2a2f36, [0, 0, 2]), cyl(0.35, 0.5, 'z', COLORS.red, [1.8, 1, 4.25]), cyl(0.35, 0.5, 'z', COLORS.black, [-1.8, 1, 4.25])),
  },
  {
    key: 'hw.extinguisher', name: 'Fire extinguisher', category: 'hardware', group: 'Safety', role: 'extinguisher',
    summary: 'Hand-held, quick-release bracket (check rule count & rating)',
    params: [{ key: 'size', label: 'Size', type: 'select', default: '2.5', options: [{ value: '1', label: '1 lb' }, { value: '2.5', label: '2.5 lb' }] }],
    specs: (p) => [['Agent', 'Dry chemical, 5-B:C or better (verify)'], ['Size', `${p.size} lb`], ['Mounting', 'Metal quick-release bracket'], ['Weight (full)', fmtWeight(Number(p.size) * 1.6)]],
    weight: (p) => Number(p.size) * 1.6,
    build: (p) => {
      const s = p.size === '1' ? 0.8 : 1;
      return group(cyl(1.5 * s, 9 * s, 'z', 0xc62828, [0, 0, 4.5 * s], { metal: 0.4, rough: 0.4 }), cyl(0.5, 1.4, 'z', COLORS.black, [0, 0, 9.6 * s]), box(0.3, 3.5, 6, COLORS.steel, [-1.6 * s, 0, 4.5 * s]));
    },
  },
  sheetPart({ key: 'hw.firewall', name: 'Firewall panel', category: 'hardware', group: 'Safety', role: 'firewall',
    summary: 'Separates the cockpit from engine and fuel', notes: 'Local origin is the bottom-center. The panel stands in the local YZ plane — set it just behind the seat.',
    L: 36, W: 28, t: 0.04, material: 'al5052', materials: ['al5052', 'steel'], axis: 'x' }),
  {
    key: 'hw.transponder', name: 'Timing transponder', category: 'hardware', group: 'Electrical', role: 'transponder',
    summary: 'Race timing transponder (mount per event rules)',
    specs: () => [['Mount', 'Vertical, clear view of the ground (verify)'], ['Weight', fmtWeight(0.3)]],
    weight: () => 0.3,
    build: () => group(box(1.2, 3.5, 2.2, 0x1e5aa8, [0, 0, 1.1])),
  },

  // ---------- Fully custom placeholders ----------
  {
    key: 'hw.custom.block', name: 'Custom block', category: 'hardware', group: 'Custom parts', role: 'custom',
    summary: 'Any part as a sized box: name, size, weight, specs',
    params: [
      { key: 'length', label: 'Length (X)', type: 'length', default: 6, step: 0.25 },
      { key: 'width', label: 'Width (Y)', type: 'length', default: 4, step: 0.25 },
      { key: 'height', label: 'Height (Z)', type: 'length', default: 3, step: 0.25 },
      { key: 'mass', label: 'Weight', type: 'number', unit: 'lb', default: 2, step: 0.1 },
      { key: 'color', label: 'Color', type: 'color', default: '#6c7a89' },
      { key: 'specText', label: 'Specs (one "Label: value" per line)', type: 'textarea', default: 'Supplier: TBD\nPart #: —' },
    ],
    specs: (p) => [['Size', `${fmtLen(p.length)} × ${fmtLen(p.width)} × ${fmtLen(p.height)}`], ['Weight', fmtWeight(p.mass)], ...parseSpecText(p.specText)],
    weight: (p) => p.mass,
    build: (p) => group(box(p.length, p.width, p.height, new THREE.Color(p.color).getHex(), [0, 0, p.height / 2], { metal: 0.2, rough: 0.6 })),
  },
  {
    key: 'hw.custom.cylinder', name: 'Custom cylinder', category: 'hardware', group: 'Custom parts', role: 'custom',
    summary: 'Any round part: sized cylinder with specs',
    params: [
      { key: 'dia', label: 'Diameter', type: 'length', default: 4, step: 0.25 },
      { key: 'length', label: 'Length', type: 'length', default: 6, step: 0.25 },
      { key: 'axis', label: 'Axis', type: 'select', default: 'z', options: [{ value: 'x', label: 'X (fore-aft)' }, { value: 'y', label: 'Y (lateral)' }, { value: 'z', label: 'Z (vertical)' }] },
      { key: 'mass', label: 'Weight', type: 'number', unit: 'lb', default: 2, step: 0.1 },
      { key: 'color', label: 'Color', type: 'color', default: '#8a6c4c' },
      { key: 'specText', label: 'Specs (one "Label: value" per line)', type: 'textarea', default: 'Supplier: TBD' },
    ],
    specs: (p) => [['Size', `Ø ${fmtLen(p.dia)} × ${fmtLen(p.length)}`], ['Weight', fmtWeight(p.mass)], ...parseSpecText(p.specText)],
    weight: (p) => p.mass,
    build: (p) => group(cyl(p.dia / 2, p.length, p.axis, new THREE.Color(p.color).getHex(), p.axis === 'z' ? [0, 0, p.length / 2] : [0, 0, p.dia / 2], { metal: 0.2, rough: 0.6 })),
  },
]);

function parseSpecText(text) {
  return String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const i = l.indexOf(':');
    return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : ['Note', l];
  });
}
