// Powertrain catalog. Values are representative starting points — verify
// against supplier datasheets and the current Baja SAE rulebook.
import { register } from './index.js';
import { box, cyl, cylBetween, group, COLORS, mat } from './shapes.js';
import { DEG } from '../core/geom.js';
import { fmtLen, fmtWeight, fmtNum, fmtAngle } from '../core/units.js';
import * as THREE from 'three';

const ENGINE = {
  key: 'pt.engine.vanguard10',
  category: 'powertrain',
  group: 'Engine',
  role: 'engine',
  singleton: true,
  name: 'Briggs & Stratton 10 HP Vanguard',
  summary: '305 cc single · 10 hp gross · Baja SAE spec engine',
  notes: 'Local origin is the tip of the PTO (crank) shaft. +Y points out the PTO side toward the CVT.',
  params: [
    { key: 'governedRpm', label: 'Governed speed', type: 'number', unit: 'rpm', default: 3800, step: 50 },
    { key: 'torque', label: 'Peak torque (gross)', type: 'number', unit: 'ft·lb', default: 14.5, step: 0.1 },
    { key: 'tilt', label: 'Engine tilt about crank', type: 'angle', default: 0, step: 1 },
  ],
  specs: (p) => [
    ['Displacement', '305 cc (18.6 in³)'],
    ['Power (gross)', '10 hp @ 3600 rpm'],
    ['Governed speed', `${p.governedRpm} rpm`],
    ['Peak torque (gross)', `${fmtNum(p.torque, 1)} ft·lb`],
    ['PTO shaft', 'Ø 1.000 in, 1/4 in key'],
    ['Dry weight', '≈ 52 lb'],
    ['Oil capacity', '≈ 1.4 qt (verify)'],
  ],
  weight: () => 52,
  build: () => {
    const g = group(
      box(11, 9, 0.6, COLORS.darkSteel, [0, -5.5, -5.2]),
      box(10, 8, 6.5, COLORS.engine, [0, -5.5, -1.7]),
      cyl(1.7, 1.0, 'y', COLORS.darkSteel, [0, -1.9, 0]),
      cyl(0.5, 1.6, 'y', COLORS.steel, [0, -0.8, 0], { metal: 0.8, rough: 0.3 }),
      cyl(5.2, 2.6, 'y', COLORS.black, [0, -11.0, 0.5]),
      cyl(2.0, 0.6, 'y', COLORS.red, [0, -12.6, 0.5]),
      box(4.2, 5.5, 4.5, COLORS.black, [-4.4, -6.2, 5.8]),
      cyl(1.8, 5.5, 'x', COLORS.darkSteel, [-4.6, -2.8, 7.3], { metal: 0.7, rough: 0.4 }),
    );
    const barrel = group(cyl(2.6, 6.2, 'z', COLORS.engine, [0, 0, 3.1]));
    for (let i = 0; i < 7; i++) barrel.add(cyl(3.4, 0.2, 'z', COLORS.engine, [0, 0, 0.9 + i * 0.75]));
    barrel.add(box(5.4, 6.2, 2.2, COLORS.engine, [0, 0, 6.7]));
    barrel.add(box(4.2, 4.8, 1.0, COLORS.engineAccent, [0, 0, 8.3], { metal: 0.2, rough: 0.5 }));
    barrel.position.set(1.8, -5.5, 1.2);
    barrel.rotation.y = 12 * DEG;
    g.add(barrel);
    return g;
  },
  ports: () => ({
    output: [0, 0, 0],
    throttle: [-3.0, -8.4, 4.0],
    fuel: [-2.0, -9.2, 2.8],
    exhaust: [-4.6, -2.8, 7.3],
    mount: [0, -5.5, -5.5],
  }),
};

function cvtBuild(p) {
  const C = p.centerDistance, rp = p.primaryDia / 2, rs = p.secondaryDia / 2;
  const sheave = (r, x) => group(
    cyl(r, 1.35, 'y', COLORS.cvt, [x, 0.9, 0], { metal: 0.7, rough: 0.35 }),
    cyl(r * 0.96, 1.35, 'y', COLORS.cvt, [x, 2.65, 0], { metal: 0.7, rough: 0.35 }),
    cyl(r * 0.35, 0.5, 'y', COLORS.darkSteel, [x, 1.8, 0]),
  );
  const pr = rp * 0.72, sr = rs * 0.62; // belt pitch radii at a mid ratio
  const beltTorus = (r, x) => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(r, 0.32, 8, 40), mat(COLORS.belt, { metal: 0, rough: 0.9 }));
    m.rotation.x = 90 * DEG;
    m.position.set(x, 1.8, 0);
    return m;
  };
  const g = group(
    sheave(rs, 0), sheave(rp, C),
    cyl(2.3, 1.6, 'y', COLORS.darkSteel, [C, 4.1, 0]),
    cyl(2.6, 1.2, 'y', COLORS.darkSteel, [0, 3.9, 0]),
    beltTorus(sr, 0), beltTorus(pr, C),
    cylBetween([0, 1.8, sr], [C, 1.8, pr], 0.32, mat(COLORS.belt, { metal: 0, rough: 0.9 })),
    cylBetween([0, 1.8, -sr], [C, 1.8, -pr], 0.32, mat(COLORS.belt, { metal: 0, rough: 0.9 })),
  );
  if (p.showGuard) {
    const R = Math.max(rp, rs) + 0.8;
    const L = C + rp + rs + 1.6;
    g.add(box(L, 5.6, 2 * R, mat(0x7da0c0, { opacity: 0.16, metal: 0, rough: 0.2, side: THREE.DoubleSide }), [(C + rp - rs) / 2, 2.5, 0]));
  }
  return g;
}

const cvtParams = (d) => [
  { key: 'angle', label: 'Center-line angle (from horizontal)', type: 'angle', default: 55, step: 1 },
  { key: 'centerDistance', label: 'Center distance', type: 'length', default: d.C, step: 0.125 },
  { key: 'primaryDia', label: 'Primary sheave Ø', type: 'length', default: d.Dp, step: 0.125 },
  { key: 'secondaryDia', label: 'Secondary sheave Ø', type: 'length', default: d.Ds, step: 0.125 },
  { key: 'lowRatio', label: 'Low ratio', type: 'number', unit: ':1', default: d.lo, step: 0.01 },
  { key: 'highRatio', label: 'High (overdrive) ratio', type: 'number', unit: ':1', default: d.hi, step: 0.01 },
  { key: 'mass', label: 'Weight', type: 'number', unit: 'lb', default: d.w, step: 0.1 },
  { key: 'showGuard', label: 'Show CVT guard', type: 'bool', default: true },
];

const cvtSpecs = (p) => [
  ['Ratio range', `${fmtNum(p.lowRatio, 2)} : 1 → ${fmtNum(p.highRatio, 2)} : 1`],
  ['Center distance', fmtLen(p.centerDistance)],
  ['Primary Ø / Secondary Ø', `${fmtLen(p.primaryDia)} / ${fmtLen(p.secondaryDia)}`],
  ['Center-line angle', fmtAngle(p.angle)],
  ['Weight', fmtWeight(p.mass)],
  ['Guard', p.showGuard ? 'Shown (rule-required CVT guard)' : 'Hidden'],
];

const cvt = (key, name, summary, d) => ({
  key, name, summary, category: 'powertrain', group: 'CVT', role: 'cvt', singleton: true,
  notes: 'Local origin is the secondary (driven) sheave center. Primary sits at +X by the center distance. Linked CVTs mount to the gearbox input shaft; the engine then mounts to the CVT primary.',
  params: cvtParams(d), specs: cvtSpecs, weight: (p) => p.mass, build: cvtBuild,
  ports: (p) => ({ secondary: [0, 0, 0], primary: [p.centerDistance, 0, 0] }),
});

function gearboxBuild(p) {
  const D = p.inputDistance, a = p.inputAngle * DEG, w = p.caseWidth;
  const ix = D * Math.cos(a), iz = D * Math.sin(a);
  const web = box(D, w, 4.6, p.chain ? COLORS.darkSteel : COLORS.gearbox, [0, 0, 0], { metal: 0.6, rough: 0.45 });
  web.position.set(ix / 2, 0, iz / 2);
  web.rotation.y = -a;
  const g = group(
    cyl(3.3, w, 'y', p.chain ? COLORS.darkSteel : COLORS.gearbox, [0, 0, 0], { metal: 0.6, rough: 0.45 }),
    cyl(2.4, w, 'y', p.chain ? COLORS.darkSteel : COLORS.gearbox, [ix, 0, iz], { metal: 0.6, rough: 0.45 }),
    web,
    cyl(0.62, 1.2, 'y', COLORS.steel, [0, w / 2 + 0.6, 0], { metal: 0.8, rough: 0.3 }),
    cyl(0.62, 1.2, 'y', COLORS.steel, [0, -w / 2 - 0.6, 0], { metal: 0.8, rough: 0.3 }),
    cyl(0.5, 1.5, 'y', COLORS.steel, [ix, w / 2 + 0.75, iz], { metal: 0.8, rough: 0.3 }),
  );
  if (p.frontOutput) g.add(cyl(0.6, 1.2, 'x', COLORS.steel, [3.9, 0, 0], { metal: 0.8, rough: 0.3 }));
  return g;
}

const gearbox = (key, name, summary, d) => ({
  key, name, summary, category: 'powertrain', group: 'Gearbox / reduction', role: 'gearbox', singleton: true,
  notes: 'Local origin is the output shaft center. Place the output on the rear-axle line to keep CV angles low.',
  params: [
    { key: 'ratio', label: 'Reduction ratio', type: 'number', unit: ':1', default: d.ratio, step: 0.1 },
    { key: 'inputDistance', label: 'Input ↔ output center distance', type: 'length', default: d.D, step: 0.125 },
    { key: 'inputAngle', label: 'Input shaft angle (from horizontal)', type: 'angle', default: d.angle, step: 1 },
    { key: 'caseWidth', label: 'Case width', type: 'length', default: d.w, step: 0.125 },
    { key: 'frontOutput', label: 'Front output (4WD)', type: 'bool', default: false },
    { key: 'mass', label: 'Weight', type: 'number', unit: 'lb', default: d.mass, step: 0.1 },
    { key: 'chain', label: 'chain', type: 'hidden', default: !!d.chain },
  ],
  specs: (p) => [
    ['Reduction', `${fmtNum(p.ratio, 2)} : 1`],
    ['Input ↔ output', `${fmtLen(p.inputDistance)} @ ${fmtAngle(p.inputAngle)}`],
    ['Case width', fmtLen(p.caseWidth)],
    ['4WD front output', p.frontOutput ? 'Yes' : 'No'],
    ['Weight', fmtWeight(p.mass)],
  ],
  weight: (p) => p.mass,
  build: gearboxBuild,
  ports: (p) => {
    const D = p.inputDistance, a = p.inputAngle * DEG, w = p.caseWidth;
    return {
      input: [D * Math.cos(a), w / 2 + 1.5, D * Math.sin(a)],
      outL: [0, w / 2 + 1.2, 0],
      outR: [0, -w / 2 - 1.2, 0],
      front: [4.5, 0, 0],
      brake: [0, -w / 2 - 0.5, 0],
    };
  },
});

const FUEL_MATERIALS = {
  aluminum: { label: 'Aluminum 5052 (0.063 in)', density: 0.097, t: 0.063, color: 0xd5dade },
  hdpe: { label: 'HDPE plastic (0.19 in)', density: 0.034, t: 0.19, color: 0xe9e4d4 },
};

function tankDims(p) {
  const V = p.capacity * 231; // in³ per US gal
  const a = Math.cbrt(V / (p.aspect * 0.9));
  return { L: p.aspect * a, W: a, H: 0.9 * a };
}

const FUEL_TANK = {
  key: 'pt.fueltank',
  category: 'powertrain', group: 'Fuel', role: 'fuelTank', singleton: true,
  name: 'Fuel tank',
  summary: 'Parametric capacity · aluminum or HDPE',
  notes: 'Local origin is the bottom center of the tank. Keep the tank out of the cockpit and away from the exhaust.',
  params: [
    { key: 'capacity', label: 'Capacity', type: 'number', unit: 'gal', default: 1.0, step: 0.05, min: 0.1 },
    { key: 'aspect', label: 'Length ÷ width', type: 'number', default: 1.5, step: 0.1, min: 0.5 },
    { key: 'material', label: 'Material', type: 'select', default: 'aluminum', options: Object.entries(FUEL_MATERIALS).map(([value, m]) => ({ value, label: m.label })) },
    { key: 'full', label: 'Include fuel in weight', type: 'bool', default: true },
  ],
  specs: (p) => {
    const d = tankDims(p);
    return [
      ['Capacity', `${fmtNum(p.capacity, 2)} gal (${fmtNum(p.capacity * 231, 0)} in³)`],
      ['Size (L × W × H)', `${fmtLen(d.L)} × ${fmtLen(d.W)} × ${fmtLen(d.H)}`],
      ['Material', FUEL_MATERIALS[p.material]?.label || p.material],
      ['Fuel weight (full)', fmtWeight(p.capacity * 6.1)],
    ];
  },
  weight: (p) => {
    const d = tankDims(p), m = FUEL_MATERIALS[p.material] || FUEL_MATERIALS.aluminum;
    const area = 2 * (d.L * d.W + d.L * d.H + d.W * d.H);
    return area * m.t * m.density + (p.full ? p.capacity * 6.1 : 0);
  },
  build: (p) => {
    const d = tankDims(p), m = FUEL_MATERIALS[p.material] || FUEL_MATERIALS.aluminum;
    return group(
      box(d.L, d.W, d.H, m.color, [0, 0, d.H / 2], { metal: p.material === 'aluminum' ? 0.6 : 0, rough: 0.5 }),
      cyl(0.9, 0.8, 'z', COLORS.red, [d.L * 0.25, 0, d.H + 0.4]),
      cyl(0.25, 1.0, 'x', COLORS.steel, [d.L / 2 + 0.5, 0, 0.4]),
    );
  },
  ports: (p) => {
    const d = tankDims(p);
    return { outlet: [d.L / 2 + 1.0, 0, 0.4], cap: [d.L * 0.25, 0, d.H + 0.8] };
  },
};

const FRONT_DIFF = {
  key: 'pt.frontdiff',
  category: 'powertrain', group: '4WD', role: 'frontDiff', singleton: true,
  name: 'Front differential (4WD)',
  summary: 'Enables auto driveshaft + front CV axles',
  notes: 'Local origin is the output (half-shaft) centerline. Input faces −X toward the gearbox.',
  params: [
    { key: 'ratio', label: 'Final ratio', type: 'number', unit: ':1', default: 1.0, step: 0.05 },
    { key: 'type', label: 'Type', type: 'select', default: 'open', options: [{ value: 'open', label: 'Open' }, { value: 'locking', label: 'Selectable locker' }, { value: 'limited', label: 'Limited slip' }] },
    { key: 'mass', label: 'Weight', type: 'number', unit: 'lb', default: 9, step: 0.1 },
  ],
  specs: (p) => [['Ratio', `${fmtNum(p.ratio, 2)} : 1`], ['Type', p.type], ['Weight', fmtWeight(p.mass)]],
  weight: (p) => p.mass,
  build: () => group(
    box(5.5, 6.5, 6, COLORS.gearbox, [0, 0, 0], { metal: 0.6, rough: 0.45 }),
    cyl(1.4, 2.5, 'x', COLORS.gearbox, [-3.8, 0, 0]),
    cyl(0.6, 1.2, 'y', COLORS.steel, [0, 3.85, 0]),
    cyl(0.6, 1.2, 'y', COLORS.steel, [0, -3.85, 0]),
  ),
  ports: () => ({ input: [-5.2, 0, 0], outL: [0, 4.4, 0], outR: [0, -4.4, 0] }),
};

const AIR_FILTER = {
  key: 'pt.airfilter',
  category: 'powertrain', group: 'Intake', role: 'airFilter',
  name: 'Remote air filter + intake',
  summary: 'Relocated intake away from dust',
  params: [{ key: 'dia', label: 'Filter Ø', type: 'length', default: 4, step: 0.25 }, { key: 'len', label: 'Filter length', type: 'length', default: 5, step: 0.25 }],
  specs: (p) => [['Filter', `Ø ${fmtLen(p.dia)} × ${fmtLen(p.len)}`], ['Weight', '≈ 0.8 lb']],
  weight: () => 0.8,
  build: (p) => group(cyl(p.dia / 2, p.len, 'x', COLORS.black, [0, 0, 0], { rough: 0.9, metal: 0 }), cyl(0.9, 2, 'x', COLORS.darkSteel, [p.len / 2 + 1, 0, 0])),
  ports: (p) => ({ outlet: [p.len / 2 + 2, 0, 0] }),
};

register([
  ENGINE,
  cvt('pt.cvt.gx9', 'Gaged GX9 CVT', 'Popular Baja CVT · ≈3.9 → 0.9 : 1 (approx.)', { C: 8.5, Dp: 7.25, Ds: 8.75, lo: 3.9, hi: 0.9, w: 13 }),
  cvt('pt.cvt.cvtech', 'CVTech-IBC CVT', 'Baja CVT · ≈3.9 → 0.9 : 1 (approx.)', { C: 8.25, Dp: 7.0, Ds: 8.5, lo: 3.9, hi: 0.9, w: 12 }),
  cvt('pt.cvt.custom', 'In-house CVT (parametric)', 'Enter your own sheave sizes and ratios', { C: 9, Dp: 7.5, Ds: 9, lo: 3.5, hi: 0.8, w: 11 }),
  gearbox('pt.gearbox.2stage', 'Two-stage reduction gearbox', 'Spur/helical · parametric ratio and layout', { ratio: 8.5, D: 6, angle: 70, w: 6, mass: 18 }),
  gearbox('pt.gearbox.chain', 'Chain + sprocket reduction', '#40/#428 chain jackshaft layout', { ratio: 7.5, D: 9, angle: 60, w: 5, mass: 14, chain: true }),
  FUEL_TANK,
  FRONT_DIFF,
  AIR_FILTER,
]);
