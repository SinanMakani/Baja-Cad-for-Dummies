// Ergonomics catalog: seats, pedals, steering wheel, restraints.
import { register } from './index.js';
import { box, cyl, cylBetween, group, COLORS, mat } from './shapes.js';
import { DEG } from '../core/geom.js';
import { fmtLen, fmtWeight, fmtNum, fmtAngle } from '../core/units.js';
import * as THREE from 'three';

export const SEAT_MATERIALS = {
  al5052: { label: 'Aluminum 5052 sheet', density: 0.097, t: 0.09, color: 0xb9c0c7, metal: 0.7 },
  fiberglass: { label: 'Fiberglass (E-glass / epoxy)', density: 0.065, t: 0.15, color: 0xd9d4c3, metal: 0 },
  carbon: { label: 'Carbon fiber', density: 0.056, t: 0.08, color: 0x2b2f35, metal: 0.2 },
  hdpe: { label: 'HDPE plastic', density: 0.034, t: 0.25, color: 0x34495e, metal: 0 },
  steel: { label: 'Mild steel sheet', density: 0.284, t: 0.048, color: 0x8a939c, metal: 0.7 },
};

const seatParams = (material, d = {}) => [
  { key: 'material', label: 'Shell material', type: 'select', default: material, options: Object.entries(SEAT_MATERIALS).map(([value, m]) => ({ value, label: m.label })) },
  { key: 'width', label: 'Seat width', type: 'length', default: d.width ?? 16, step: 0.25 },
  { key: 'depth', label: 'Pan depth', type: 'length', default: d.depth ?? 17, step: 0.25 },
  { key: 'backHeight', label: 'Back height', type: 'length', default: d.backHeight ?? 24, step: 0.25 },
  { key: 'recline', label: 'Back recline (from vertical)', type: 'angle', default: d.recline ?? 20, step: 1 },
  { key: 'panAngle', label: 'Pan tilt (front up)', type: 'angle', default: d.panAngle ?? 6, step: 1 },
  { key: 'cushion', label: 'Foam thickness', type: 'length', default: d.cushion ?? 1.0, step: 0.125 },
];

function seatGeom(p) {
  const m = SEAT_MATERIALS[p.material] || SEAT_MATERIALS.al5052;
  const t = m.t;
  const shell = { metal: m.metal, rough: 0.5 };
  const foam = mat(0x1f2328, { metal: 0, rough: 0.95 });
  const pan = group(
    box(p.depth, p.width, t, m.color, [p.depth / 2, 0, t / 2], shell),
    box(p.depth - 1, p.width - 1.5, p.cushion, foam, [p.depth / 2, 0, t + p.cushion / 2]),
    box(p.depth, t, 3, m.color, [p.depth / 2, p.width / 2, 1.5], shell),
    box(p.depth, t, 3, m.color, [p.depth / 2, -p.width / 2, 1.5], shell),
  );
  pan.rotation.y = -p.panAngle * DEG;
  const back = group(
    box(t, p.width, p.backHeight, m.color, [0, 0, p.backHeight / 2], shell),
    box(p.cushion, p.width - 1.5, p.backHeight - 2, foam, [t / 2 + p.cushion / 2, 0, p.backHeight / 2]),
    box(3, t, p.backHeight * 0.7, m.color, [1.5, p.width / 2, p.backHeight * 0.35], shell),
    box(3, t, p.backHeight * 0.7, m.color, [1.5, -p.width / 2, p.backHeight * 0.35], shell),
  );
  back.rotation.y = -p.recline * DEG;
  return group(pan, back);
}

function seatWeight(p) {
  const m = SEAT_MATERIALS[p.material] || SEAT_MATERIALS.al5052;
  const shellArea = p.depth * p.width + p.backHeight * p.width + 2 * p.depth * 3 + 2 * p.backHeight * 0.7 * 3;
  const foam = ((p.depth - 1) * (p.width - 1.5) + (p.backHeight - 2) * (p.width - 1.5)) * p.cushion * 0.0022;
  return shellArea * m.t * m.density + foam + 1.0; // +1 lb brackets & hardware
}

/** Seated hip-joint (H-point) location in seat-local coordinates. */
export function seatHPoint(p) {
  const m = SEAT_MATERIALS[p.material] || SEAT_MATERIALS.al5052;
  const local = new THREE.Vector3(5.5, 0, m.t + p.cushion + 3.5);
  return local.applyAxisAngle(new THREE.Vector3(0, 1, 0), -p.panAngle * DEG * 0.35);
}

const seat = (key, name, material, summary, d) => ({
  key, name, summary, category: 'ergonomics', group: 'Seats', role: 'seat', singleton: true,
  notes: 'Local origin is where the seat pan meets the seat back. The back reclines toward −X (rearward).',
  params: seatParams(material, d),
  specs: (p) => [
    ['Shell material', SEAT_MATERIALS[p.material]?.label || p.material],
    ['Shell thickness', fmtLen(SEAT_MATERIALS[p.material]?.t)],
    ['Width × depth', `${fmtLen(p.width)} × ${fmtLen(p.depth)}`],
    ['Back height', fmtLen(p.backHeight)],
    ['Recline', fmtAngle(p.recline)],
    ['Foam', fmtLen(p.cushion)],
    ['Est. weight', fmtWeight(seatWeight(p))],
  ],
  weight: seatWeight,
  build: seatGeom,
  ports: (p) => {
    const h = seatHPoint(p);
    return { hpoint: [h.x, h.y, h.z] };
  },
});

function pedalGeom(p, kind) {
  const L = p.pedalLength, a = p.pedalAngle * DEG;
  const pad = [-L * Math.cos(a), 0, 0.9 + L * Math.sin(a)];
  const g = group(
    box(6, 4.5, 0.25, COLORS.darkSteel, [1.0, 0, 0.125]),
    cyl(0.45, 2.2, 'y', COLORS.steel, [0, 0, 0.9]),
    cylBetween([0, 0, 0.9], pad, 0.35, COLORS.pedal, { metal: 0.7, rough: 0.35 }),
  );
  const padMesh = box(0.4, 3.2, 2.6, COLORS.darkSteel, [0, 0, 0]);
  padMesh.position.set(...pad);
  padMesh.rotation.y = (90 * DEG - a) * -1 + 0;
  g.add(padMesh);
  if (kind === 'brake') {
    const mcs = p.mcCount >= 2 ? [1.3, -1.3] : [0];
    const lever = [-(L / p.pedalRatio) * Math.cos(a), 0, 0.9 + (L / p.pedalRatio) * Math.sin(a)];
    g.add(cyl(0.3, 3.2, 'y', COLORS.steel, lever));
    for (const y of mcs) {
      g.add(cyl(0.55, 3.2, 'x', 0x5a6068, [3.4, y, 2.6], { metal: 0.6, rough: 0.4 }));
      g.add(cyl(0.5, 1.2, 'z', 0xdfe3e7, [3.4, y, 3.8], { metal: 0, rough: 0.3 }));
      g.add(cylBetween([lever[0], y, lever[2]], [1.8, y, 2.6], 0.12, COLORS.steel));
    }
  } else {
    g.add(cyl(0.18, 2.0, 'x', COLORS.steel, [1.4, 0, 1.4]));
  }
  return g;
}

const BRAKE_PEDAL = {
  key: 'erg.pedal.brake',
  category: 'ergonomics', group: 'Pedals', role: 'brakePedal', singleton: true,
  name: 'Brake pedal · dual master cylinder',
  summary: 'Balance bar + front/rear split circuits',
  notes: 'Local origin is the pedal pivot at floor level. The pad leans back toward the driver (−X). Master cylinders point forward (+X).',
  params: [
    { key: 'pedalRatio', label: 'Pedal ratio', type: 'number', unit: ':1', default: 5.0, step: 0.1 },
    { key: 'mcCount', label: 'Master cylinders', type: 'select', default: 2, options: [{ value: 2, label: '2 — front/rear split' }, { value: 1, label: '1 — single circuit' }] },
    { key: 'mcBore', label: 'Master cylinder bore', type: 'length', default: 0.625, step: 0.0625 },
    { key: 'pedalLength', label: 'Pivot → pad', type: 'length', default: 9, step: 0.25 },
    { key: 'pedalAngle', label: 'Pedal angle (from floor)', type: 'angle', default: 72, step: 1 },
    { key: 'pedalForce', label: 'Design pedal force', type: 'number', unit: 'lbf', default: 100, step: 5 },
  ],
  specs: (p) => {
    const A = (Math.PI / 4) * p.mcBore ** 2;
    const perMc = (p.pedalForce * p.pedalRatio) / (p.mcCount >= 2 ? 2 : 1);
    return [
      ['Pedal ratio', `${fmtNum(p.pedalRatio, 1)} : 1`],
      ['Circuits', p.mcCount >= 2 ? '2 (front + rear, balance bar)' : '1 (single circuit)'],
      ['MC bore', fmtLen(p.mcBore)],
      [`Line pressure @ ${p.pedalForce} lbf`, `${fmtNum(perMc / A, 0)} psi`],
      ['Pivot → pad', fmtLen(p.pedalLength)],
    ];
  },
  weight: (p) => 2.4 + 0.9 * p.mcCount,
  build: (p) => pedalGeom(p, 'brake'),
  ports: (p) => {
    const L = p.pedalLength, a = p.pedalAngle * DEG;
    const pad = [-L * Math.cos(a), 0, 0.9 + L * Math.sin(a)];
    return p.mcCount >= 2
      ? { pad, mcF: [5.0, 1.3, 2.6], mcR: [5.0, -1.3, 2.6] }
      : { pad, mcF: [5.0, 0, 2.6], mcR: [5.0, 0, 2.6] };
  },
};

const THROTTLE_PEDAL = {
  key: 'erg.pedal.throttle',
  category: 'ergonomics', group: 'Pedals', role: 'throttlePedal', singleton: true,
  name: 'Throttle pedal · cable',
  summary: 'Floor-hinged, pull cable to the governor linkage',
  notes: 'Local origin is the pivot. The cable exits forward near the pivot.',
  params: [
    { key: 'pedalLength', label: 'Pivot → pad', type: 'length', default: 8, step: 0.25 },
    { key: 'pedalAngle', label: 'Pedal angle (from floor)', type: 'angle', default: 66, step: 1 },
    { key: 'travel', label: 'Pedal travel', type: 'angle', default: 22, step: 1 },
  ],
  specs: (p) => [['Pivot → pad', fmtLen(p.pedalLength)], ['Pedal angle', fmtAngle(p.pedalAngle)], ['Travel', fmtAngle(p.travel)], ['Cable pull (approx.)', fmtLen(1.5 * p.travel * DEG)]],
  weight: () => 1.3,
  build: (p) => pedalGeom(p, 'throttle'),
  ports: (p) => {
    const L = p.pedalLength, a = p.pedalAngle * DEG;
    return { pad: [-L * Math.cos(a), 0, 0.9 + L * Math.sin(a)], cable: [2.4, 0, 1.4] };
  },
};

const STEERING_WHEEL = {
  key: 'erg.steeringwheel',
  category: 'ergonomics', group: 'Steering wheel', role: 'steeringWheel', singleton: true,
  name: 'Steering wheel · quick release',
  summary: 'Quick-release hub, column auto-connects to the rack',
  notes: 'Local origin is the wheel center. The column runs along +X (away from the driver). Tilt with rotation about Y.',
  params: [
    { key: 'diameter', label: 'Wheel Ø', type: 'length', default: 10, step: 0.25 },
    { key: 'grip', label: 'Grip Ø', type: 'length', default: 1.1, step: 0.05 },
    { key: 'quickRelease', label: 'Quick-release hub', type: 'bool', default: true },
  ],
  specs: (p) => [['Wheel Ø', fmtLen(p.diameter)], ['Grip Ø', fmtLen(p.grip)], ['Quick release', p.quickRelease ? 'Yes' : 'No'], ['Weight', fmtWeight(2.2)]],
  weight: () => 2.2,
  build: (p) => {
    const r = p.diameter / 2;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r, p.grip / 2, 12, 48), mat(COLORS.black, { metal: 0, rough: 0.8 }));
    rim.rotation.y = 90 * DEG;
    const g = group(rim, cyl(1.3, 0.8, 'x', COLORS.darkSteel, [0.2, 0, 0]));
    for (const ang of [90, 210, 330]) {
      const a = ang * DEG;
      g.add(cylBetween([0.2, 0, 0], [0, Math.cos(a) * r, Math.sin(a) * r], 0.28, COLORS.darkSteel));
    }
    if (p.quickRelease) g.add(cyl(1.0, 1.5, 'x', 0xc0a040, [1.4, 0, 0], { metal: 0.8, rough: 0.3 }));
    g.add(cyl(0.45, 3.5, 'x', COLORS.steel, [3.9, 0, 0]));
    return g;
  },
  ports: () => ({ column: [5.6, 0, 0], center: [0, 0, 0] }),
};

const HARNESS = {
  key: 'erg.harness5',
  category: 'ergonomics', group: 'Restraints', role: 'harness', singleton: true,
  name: '5-point harness (SFI 16.1)',
  summary: '3 in lap / shoulder belts, 2 in sub strap',
  notes: 'Place the origin at the seat H-point. Shoulder belts must mount to the frame behind the driver.',
  params: [{ key: 'shoulderAngle', label: 'Shoulder belt angle (below horizontal)', type: 'angle', default: 10, step: 1 }],
  specs: (p) => [['Rating', 'SFI 16.1 (verify date tag)'], ['Shoulder belt angle', fmtAngle(p.shoulderAngle)], ['Weight', fmtWeight(3.5)]],
  weight: () => 3.5,
  build: (p) => {
    const c = 0x2255aa;
    const g = group();
    const drop = Math.tan(p.shoulderAngle * DEG) * 9;
    for (const s of [1, -1]) {
      const anchor = [-16.3, s * 3.4, 20.7 + drop];
      const shoulder = [-7.4, s * 3.8, 22.2];
      const chest = [0.4, s * 2.6, 13];
      g.add(cylBetween(anchor, shoulder, 0.22, c), cylBetween(shoulder, chest, 0.22, c), cylBetween(chest, [3.8, 0, 4], 0.22, c));
      g.add(cylBetween([-1.2, s * 7.5, -1.2], [3.8, s * 0.8, 3.6], 0.22, c));
    }
    g.add(cylBetween([3.8, 0, 3.8], [3.2, 0, -3.5], 0.2, c), box(1.2, 2.6, 2.6, 0xc0c4c8, [4.0, 0, 3.9]));
    return g;
  },
};

register([
  seat('erg.seat.al', 'Aluminum road-race seat', 'al5052', '5052 aluminum shell · light, easy to mount'),
  seat('erg.seat.fg', 'Fiberglass composite shell', 'fiberglass', 'Molded composite · in-house layup', { recline: 18 }),
  seat('erg.seat.cf', 'Carbon fiber shell', 'carbon', 'Lightest option · higher cost', { recline: 22 }),
  seat('erg.seat.custom', 'Custom seat (choose material)', 'hdpe', 'Pick any shell material and size', {}),
  BRAKE_PEDAL,
  THROTTLE_PEDAL,
  STEERING_WHEEL,
  HARNESS,
]);
