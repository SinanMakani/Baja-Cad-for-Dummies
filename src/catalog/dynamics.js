// Dynamics catalog: "slot" parts. Dropping one on the car assigns it to the
// nearest suspension corner (front/rear) instead of placing loose geometry.
// Dimensions are representative — match them to your supplier's spec sheet
// (every value is editable per axle in the Dynamics tab).
import { register } from './index.js';
import { fmtLen, fmtWeight, fmtNum } from '../core/units.js';

const tire = (key, name, d, w, rim, rimW, weight, note) => ({
  key, name, category: 'dynamics', group: 'Tires & wheels', slot: 'tire',
  summary: `${d}×${w}-${rim} · ${note}`,
  data: { diameter: d, width: w, rim, rimWidth: rimW, weight, wheelWeight: 4.5 },
  specs: () => [
    ['Size', `${d} × ${w} – ${rim}`],
    ['Overall Ø', fmtLen(d)],
    ['Section width', fmtLen(w)],
    ['Rim', `${rim} × ${rimW} in`],
    ['Tire + wheel weight', fmtWeight(weight + 4.5)],
    ['Rolling circumference', fmtLen(Math.PI * d)],
  ],
  weight: () => weight + 4.5,
});

const shock = (key, name, ext, stroke, bodyDia, weight, kind) => ({
  key, name, category: 'dynamics', group: 'Shocks', slot: 'shock',
  summary: `${ext.toFixed(1)} in eye-to-eye · ${stroke.toFixed(1)} in stroke · ${kind}`,
  data: { extended: ext, stroke, bodyDia, weight, kind },
  specs: () => [
    ['Eye-to-eye (extended)', fmtLen(ext)],
    ['Eye-to-eye (compressed)', fmtLen(ext - stroke)],
    ['Stroke', fmtLen(stroke)],
    ['Body Ø', fmtLen(bodyDia)],
    ['Type', kind === 'air' ? 'Air spring' : 'Coil-over'],
    ['Weight (each)', fmtWeight(weight)],
  ],
  weight: () => weight,
});

const caliper = (key, name, pistons, pistonDia, weight) => ({
  key, name, category: 'dynamics', group: 'Brakes', slot: 'caliper',
  summary: `${pistons}× Ø${pistonDia.toFixed(2)} in piston${pistons > 1 ? 's' : ''} · ${weight} lb`,
  data: { pistons, pistonDia, weight },
  specs: () => [
    ['Pistons', `${pistons} × Ø ${fmtLen(pistonDia)}`],
    ['Piston area (per side)', `${fmtNum((pistons * Math.PI * pistonDia ** 2) / 4 / (pistons > 1 ? 2 : 1), 3)} in²`],
    ['Weight', fmtWeight(weight)],
  ],
  weight: () => weight,
});

const rotor = (key, name, dia, t, weight) => ({
  key, name, category: 'dynamics', group: 'Brakes', slot: 'rotor',
  summary: `Ø${dia} × ${t} in · ${weight} lb`,
  data: { diameter: dia, thickness: t, weight },
  specs: () => [['Diameter', fmtLen(dia)], ['Thickness', fmtLen(t)], ['Effective radius', fmtLen(dia / 2 - 0.6)], ['Weight', fmtWeight(weight)]],
  weight: () => weight,
});

const rack = (key, name, housing, travel, cFactor, weight) => ({
  key, name, category: 'dynamics', group: 'Steering', slot: 'rack',
  summary: `${housing} in housing · ±${travel} in travel · ${cFactor} in/rev`,
  data: { housing, travel, cFactor, weight },
  specs: () => [
    ['Housing length', fmtLen(housing)],
    ['Rack travel', `± ${fmtLen(travel)}`],
    ['C-factor', `${fmtNum(cFactor, 2)} in per steering-wheel rev`],
    ['Lock-to-lock', `${fmtNum((2 * travel) / cFactor, 2)} turns`],
    ['Weight', fmtWeight(weight)],
  ],
  weight: () => weight,
});

const upright = (key, name, material, weight, note) => ({
  key, name, category: 'dynamics', group: 'Uprights & hubs', slot: 'upright',
  summary: `${material} · ${weight} lb · ${note}`,
  data: { material, weight },
  specs: () => [['Material', material], ['Weight (upright + hub)', fmtWeight(weight)], ['Notes', note]],
  weight: () => weight,
});

register([
  tire('dyn.tire.23x7-10', '23×7-10 front knobby', 23, 7, 10, 5, 10.5, 'front, e.g. MX-style knobby'),
  tire('dyn.tire.21x7-10', '21×7-10 front knobby', 21, 7, 10, 5, 8.5, 'lighter, lower front'),
  tire('dyn.tire.22x7-10', '22×7-10 knobby', 22, 7, 10, 5, 9.5, 'all-round'),
  tire('dyn.tire.22x10-10', '22×10-10 rear knobby', 22, 10, 10, 8, 12.5, 'wide rear traction'),
  tire('dyn.tire.23x8-10', '23×8-10 rear knobby', 23, 8, 10, 7, 12, 'rear'),
  shock('dyn.shock.co21', 'Long-travel coil-over 21.0 / 6.0', 21, 6, 2.0, 7.5, 'coil'),
  shock('dyn.shock.co17', 'Coil-over 17.0 / 5.0', 17, 5, 2.0, 6.5, 'coil'),
  shock('dyn.shock.co155', 'Coil-over 15.5 / 4.0', 15.5, 4, 1.9, 5.5, 'coil'),
  shock('dyn.shock.air14', 'Air shock 14.0 / 4.5', 14, 4.5, 1.75, 2.5, 'air'),
  caliper('dyn.caliper.single', 'Single-piston floating caliper', 1, 1.25, 1.1),
  caliper('dyn.caliper.dual', 'Opposed 2-piston caliper', 2, 1.12, 1.4),
  rotor('dyn.rotor.7', 'Brake rotor 7.0 in', 7, 0.19, 1.0),
  rotor('dyn.rotor.8', 'Brake rotor 8.0 in', 8, 0.19, 1.3),
  rotor('dyn.rotor.9', 'Brake rotor 9.0 in', 9, 0.2, 1.7),
  rack('dyn.rack.12', 'Rack & pinion · 12 in', 12, 1.75, 2.0, 4.5),
  rack('dyn.rack.14q', 'Quick rack & pinion · 14 in', 14, 2.0, 2.6, 5.0),
  upright('dyn.upright.7075', 'Machined 7075-T6 upright', '7075-T6 aluminum', 2.4, 'front, integrated steering arm'),
  upright('dyn.upright.4130', 'Welded 4130 upright', '4130 sheet + tube', 3.1, 'robust, easy to repair'),
  upright('dyn.upright.rear6061', 'Rear hub carrier 6061', '6061-T6 aluminum', 2.6, 'rear, bolts to trailing arm'),
]);

export const SLOT_LABELS = {
  tire: 'Tire', shock: 'Shock', caliper: 'Caliper', rotor: 'Rotor', rack: 'Steering rack', upright: 'Upright',
};
