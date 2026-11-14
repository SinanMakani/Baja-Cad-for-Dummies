// Sanity checks for the frame solver against closed-form beam results.
// Run: node scripts/test-fea.mjs
import { buildModel, solveFrame } from '../src/systems/fea.js';
import { profileProps, DEFAULT_PROFILES } from '../src/catalog/materials.js';

const prof = DEFAULT_PROFILES.P100x065;
const pr = profileProps(prof);
const E = pr.mat.E;
let failures = 0;
const check = (label, got, want, rel = 0.01) => {
  const ok = Math.abs(got - want) <= Math.abs(want) * rel;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: got ${got.toPrecision(6)}, expected ${want.toPrecision(6)}`);
};
const frame = (nodes, members) => ({
  chassis: {
    nodes: Object.fromEntries(Object.entries(nodes).map(([k, p]) => [k, { p }])),
    members: Object.fromEntries(members.map(([a, b], i) => [`T${i + 1}`, { a, b, profile: 'P100x065', role: 'SEC' }])),
    profiles: { P100x065: prof },
  },
});

// 1. Cantilever, tip load P transverse: δ = PL³/3EI, σ = PLc/I (+ small shear term)
{
  const L = 20, P = 100;
  const st = frame({ A: [0, 0, 0], B: [L, 0, 0] }, [['A', 'B']]);
  const m = buildModel(st);
  const r = solveFrame(m, { fixed: new Set([m.keyIndex.get('A')]), loads: new Map([[m.keyIndex.get('B'), [0, 0, -P]]]) });
  const b = m.keyIndex.get('B');
  check('cantilever tip deflection', -r.u[b * 6 + 2], (P * L ** 3) / (3 * E * pr.I));
  check('cantilever root moment', r.members.T1.M, P * L);
  check('cantilever bending stress', r.members.T1.sigmaBend, (P * L * (prof.od / 2)) / pr.I);
}

// 2. Same cantilever split into 3 elements along its length (results must match)
{
  const L = 20, P = 100;
  const st = frame({ A: [0, 0, 0], B: [0, L, 0] }, [['A', 'B']]);
  const m = buildModel(st, [{ key: 's1', member: 'T1', t: 0.3 }, { key: 's2', member: 'T1', t: 0.7 }]);
  const r = solveFrame(m, { fixed: new Set([m.keyIndex.get('A')]), loads: new Map([[m.keyIndex.get('B'), [P, 0, 0]]]) });
  const b = m.keyIndex.get('B');
  check('split cantilever tip deflection', r.u[b * 6], (P * L ** 3) / (3 * E * pr.I));
}

// 3. Axial bar: δ = PL/EA, Euler buckling FoS = π²EI/(KL)² / P
{
  const L = 30, P = 500;
  const st = frame({ A: [0, 0, 0], B: [0, 0, L] }, [['A', 'B']]);
  const m = buildModel(st);
  const r = solveFrame(m, { fixed: new Set([m.keyIndex.get('A')]), loads: new Map([[m.keyIndex.get('B'), [0, 0, -P]]]) });
  const b = m.keyIndex.get('B');
  check('axial shortening', -r.u[b * 6 + 2], (P * L) / (E * pr.A));
  check('axial force (compression)', r.members.T1.N, -P);
  check('buckling FoS', r.members.T1.fosBuckling, ((Math.PI ** 2) * E * pr.I) / L ** 2 / P);
}

// 4. Portal frame with a lateral load: symmetric columns share the horizontal reaction
{
  const H = 24, W = 30, P = 200;
  const st = frame({ A: [0, 0, 0], B: [0, 0, H], C: [W, 0, H], D: [W, 0, 0] }, [['A', 'B'], ['B', 'C'], ['C', 'D']]);
  const m = buildModel(st);
  const r = solveFrame(m, { fixed: new Set([m.keyIndex.get('A'), m.keyIndex.get('D')]), loads: new Map([[m.keyIndex.get('B'), [P, 0, 0]]]) });
  // Fixed-base portal with equal members: each column takes ~P/2 shear.
  check('portal column shear (left)', Math.abs(r.members.T1.V), P / 2, 0.08);
  check('portal column shear (right)', Math.abs(r.members.T3.V), P / 2, 0.08);
}

// 5. Disconnected frame must be reported, not solved
{
  const st = frame({ A: [0, 0, 0], B: [10, 0, 0], C: [0, 10, 0], D: [10, 10, 0] }, [['A', 'B'], ['C', 'D']]);
  const m = buildModel(st);
  const r = solveFrame(m, { fixed: new Set([m.keyIndex.get('A')]), loads: new Map([[m.keyIndex.get('B'), [0, 0, -10]]]) });
  console.log(`${r.ok ? 'FAIL' : 'PASS'}  disconnected frame detected: ${r.error}`);
  if (r.ok) failures++;
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll solver checks passed');
process.exit(failures ? 1 : 0);
