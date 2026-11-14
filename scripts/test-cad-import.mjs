// Round-trip test for CAD import: turn the starter frame into a synthetic
// SolidWorks-style export (hollow tubes, trimmed ends, Y-up, millimeters, one
// body per tube), then check the importer rebuilds the same frame. A second
// export bends the roll hoop, front bracing and lower frame rails from single
// tubes (4.5 in bend radius), the way most Baja frames are built.
// Run: node scripts/test-cad-import.mjs
import fs from 'node:fs';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { newProject } from '../src/core/defaults.js';
import { suggestOptions, analyzeImport, splitComponents, parseTubeTable } from '../src/systems/cadImport.js';
import { membersCSV } from '../src/core/commands.js';
import { createRequire } from 'node:module';
import { mapPositions, sweepTube, straightTube, miterPath } from './lib/meshes.mjs';
import { fitBentTube } from '../src/systems/bentTube.js';
import { rawFromOcct, OCCT_PARAMS } from '../src/systems/cadImport.js';
import { frameBodies, BENT_CHAINS } from './lib/sampleFrame.mjs';

const st = newProject({ template: 'starter' });
const nodes = st.chassis.nodes, members = st.chassis.members;
const toSW = (p) => [p[1] * 25.4, p[2] * 25.4, p[0] * 25.4]; // X_sw = left, Y_sw = up, Z_sw = forward, mm
const asCad = (list) => list.map((b) => ({ name: b.name, positions: mapPositions(b.positions, toSW) }));

const bodies = asCad(frameBodies(st).bodies);

let failures = 0;
const report = (label, ok, detail) => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`); };

function compare(label, result, nBodies = bodies.length, tol = 0.1) {
  const orig = Object.values(nodes).map((n) => n.p);
  let worst = 0;
  for (const q of result.frame.nodes) {
    const d = Math.min(...orig.map((p) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])));
    worst = Math.max(worst, d);
  }
  report(`${label}: tubes recognized`, result.report.tubes === nBodies || label.includes('CSV'), `${result.report.tubes}/${result.report.bodies}`);
  report(`${label}: joints rebuilt`, result.frame.nodes.length === Object.keys(nodes).length, `${result.frame.nodes.length} vs ${Object.keys(nodes).length}`);
  report(`${label}: tubes rebuilt`, result.frame.members.length === Object.keys(members).length, `${result.frame.members.length} vs ${Object.keys(members).length}`);
  report(`${label}: joint position error`, worst < tol, `${worst.toFixed(4)} in max`);
}

const merge = (list) => {
  const all = new Float32Array(list.reduce((s, b) => s + b.positions.length, 0));
  let o = 0;
  for (const b of list) { all.set(b.positions, o); o += b.positions.length; }
  return all;
};

// 1. One body per tube (as from a STEP weldment export)
{
  const raw = { name: 'frame.step', format: 'STEP', units: null, bodies };
  const opts = suggestOptions(raw);
  report('detected millimeters', opts.units === 'mm', opts.units);
  report('detected Y-up', opts.up === '+y', opts.up);
  report('detected forward = +Z', opts.forward === '+z', opts.forward);
  const t0 = performance.now();
  const res = analyzeImport(raw, { ...opts, placement: 'keep' });
  console.log(`      (${(performance.now() - t0).toFixed(0)} ms)`);
  compare('STEP-style bodies', res);
  const walls = res.frame.members.map((m) => m.wall);
  report('wall thickness measured', walls.every((w) => w != null && Math.abs(w - 0.049) < 0.004 || Math.abs(w - 0.065) < 0.004 || Math.abs(w - 0.083) < 0.004), [...new Set(walls.map((w) => w?.toFixed(3)))].join(', '));
}

// 2. Everything in one mesh (as from a single STL): shells must be separated first
{
  const shells = splitComponents(merge(bodies));
  report('STL shells separated', shells.length === bodies.length, `${shells.length} shells`);
  const raw = { name: 'frame.stl', format: 'STL', units: null, bodies: shells.map((positions, i) => ({ name: `Shell ${i}`, positions })) };
  compare('STL', analyzeImport(raw, { ...suggestOptions(raw), placement: 'keep' }));
}

// 3. Tube-endpoint CSV exported by this app round-trips exactly
{
  const { tubes, units } = parseTubeTable(membersCSV(st));
  const raw = { name: 'tubes.csv', format: 'Tube list', units, bodies: [], tubes };
  compare('CSV', analyzeImport(raw, { ...suggestOptions(raw), placement: 'keep' }));
}

// 4. Bent tubes: roll hoop, roll-hoop overhead + front bracing, lower frame rails
const bentFrame = frameBodies(st, { bent: true });
const mixed = asCad(bentFrame.bodies);
const expectBends = bentFrame.bends;
const CHAINS = BENT_CHAINS;
{
  const raw = { name: 'bent-frame.step', format: 'STEP', units: null, bodies: mixed };
  const opts = suggestOptions(raw);
  report('bent frame: detected mm / Y-up / front +Z', opts.units === 'mm' && opts.up === '+y' && opts.forward === '+z', `${opts.units} ${opts.up} ${opts.forward}`);
  const t0 = performance.now();
  const res = analyzeImport(raw, { ...opts, placement: 'keep' });
  console.log(`      (${(performance.now() - t0).toFixed(0)} ms)`);
  report('bent frame: bent tubes recognized', res.report.bent === CHAINS.length, `${res.report.bent} bent tubes → ${res.report.bentRuns} straight runs`);
  report('bent frame: bends found', res.report.bends === expectBends, `${res.report.bends} vs ${expectBends}`);
  compare('bent frame (STEP bodies)', res, mixed.length);
  const clr = res.bends.map((b) => b.clr).filter(Boolean);
  report('bent frame: bend radius measured', clr.every((c) => Math.abs(c - 4.5) < 0.35), `CLR ${Math.min(...clr).toFixed(2)}–${Math.max(...clr).toFixed(2)} in`);
  const bentWalls = res.frame.members.filter((m) => res.bodies[m.body].kind === 'bent').map((m) => m.wall);
  report('bent frame: bent tube wall measured', bentWalls.every((w) => w != null && (Math.abs(w - 0.065) < 0.004 || Math.abs(w - 0.083) < 0.004)), [...new Set(bentWalls.map((w) => w?.toFixed(3)))].join(', '));
}
{
  const shells = splitComponents(merge(mixed));
  const raw = { name: 'bent-frame.stl', format: 'STL', units: null, bodies: shells.map((positions, i) => ({ name: `Shell ${i}`, positions })) };
  compare('bent frame (single STL)', analyzeImport(raw, { ...suggestOptions(raw), placement: 'keep' }), mixed.length);
}

// 5. The sample file in samples/ (written by `npm run sample`) imports cleanly
{
  const file = new URL('../samples/starter-frame-solidworks-style.stl', import.meta.url);
  if (fs.existsSync(file)) {
    const buf = fs.readFileSync(file);
    const geo = new STLLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const shells = splitComponents(geo.getAttribute('position').array);
    const raw = { name: 'starter-frame-solidworks-style.stl', format: 'STL', units: null, bodies: shells.map((positions, i) => ({ name: `Shell ${i + 1}`, positions })) };
    const res = analyzeImport(raw, { ...suggestOptions(raw), placement: 'keep' });
    report('sample STL: bent tubes recognized', res.report.bent === CHAINS.length && res.report.other === 0, `${res.report.tubes} tubes, ${res.report.bent} bent, ${res.report.other} other`);
    compare('sample STL', res, shells.length);
  } else console.log('SKIP  sample STL — run npm run sample first');
}

// 6. Quirks of real SolidWorks exports (each one broke the import of a team frame)
{
  // STEP tessellates each face on its own: copies of a shared vertex differ by
  // rounding. Cut ends add a few facets with wild normals. Thin walls put the
  // inner and outer radius only 7 % apart.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  const noisy = (pos) => {
    const out = Float32Array.from(pos, (v) => v + rnd() * 2e-4);
    const extra = [];
    for (let i = 0; i < 6; i++) { const o = Math.floor(Math.abs(rnd()) * (pos.length / 9)) * 9; for (let k = 0; k < 9; k++) extra.push(pos[o + k] + rnd() * 0.3); }
    return Float32Array.from([...out, ...extra]);
  };
  const quirky = frameBodies(st, { bent: true }).bodies.map((b) => ({ name: b.name, positions: noisy(b.positions) }));
  const res = analyzeImport({ name: 'noisy.step', format: 'STEP', units: 'in', unitsFixed: true, bodies: quirky }, { ...suggestOptions({ bodies: quirky, units: 'in' }), up: '+z', forward: '+x', placement: 'keep' });
  report('vertex jitter + stray facets: bent tubes still recognized', res.report.bent === BENT_CHAINS.length, `${res.report.tubes}/${quirky.length} tubes, ${res.report.bent} bent`);
  // random junk facets up to 0.15 in off the walls stretch tube ends a little,
  // which can shift a joint where tubes meet end to end by ~0.3 in
  compare('vertex jitter + stray facets', res, quirky.length, 0.4);

  const thin = fitBentTube(noisy(sweepTube(miterPath([[0, 0, 0], [20, 0, 0]]), { R: 0.5, r: 0.465, seg: 20 })));
  report('1.0 × 0.035 wall measured through noise', thin?.ok && Math.abs(thin.R - 0.5) < 0.004 && Math.abs(thin.R - thin.r - 0.035) < 0.004, thin ? `OD ${(2 * thin.R).toFixed(3)} wall ${(thin.R - thin.r).toFixed(3)}` : 'not recognized');

  // An elbow with no straight section at all
  const arc = [];
  for (let j = 0; j <= 9; j++) { const a = (Math.PI / 2) * j / 9; arc.push({ p: [3.5 * Math.sin(a), 3.5 * (1 - Math.cos(a)), 0], t: [Math.cos(a), Math.sin(a), 0] }); }
  const elbow = fitBentTube(sweepTube(arc, { R: 0.625, r: 0.56, seg: 20 }));
  const endErr = elbow?.ok ? Math.max(Math.hypot(...elbow.nodes[0]), Math.hypot(elbow.nodes.at(-1)[0] - 3.5, elbow.nodes.at(-1)[1] - 3.5, elbow.nodes.at(-1)[2])) : Infinity;
  report('elbow without straights follows its arc', elbow?.ok && elbow.nodes.length >= 3 && endErr < 0.1, elbow?.ok ? `${elbow.nodes.length - 1} chords, ends within ${endErr.toFixed(3)} in` : elbow?.why);

  // Two straights welded with a shallow miter and merged into one body
  const mpts = [[0, 0, 0], [20, 0, 0], [38, 8.4, 0]];
  const miter = fitBentTube(sweepTube(miterPath(mpts), { R: 0.625, r: 0.56, seg: 20 }));
  const mErr = miter?.ok ? Math.max(...miter.nodes.map((p) => Math.min(...mpts.map((q) => Math.hypot(...p.map((v, i) => v - q[i])))))) : Infinity;
  report('mitered body: corner recovered', miter?.ok && mErr < 0.05, miter?.ok ? `corner within ${mErr.toFixed(3)} in` : miter?.why);

  // A tube welded beside another (centerlines pass 1 in apart instead of meeting)
  const side = [
    { name: 'rail', positions: straightTube([0, 0, 0], [20, 0, 0], { R: 0.5, r: 0.435, seg: 18 }) },
    { name: 'cross', positions: straightTube([10, 0, 1.0], [10, 15, 1.0], { R: 0.5, r: 0.435, seg: 18 }) },
  ];
  const off = analyzeImport({ name: 'offset.step', format: 'STEP', units: 'in', unitsFixed: true, bodies: side }, { ...suggestOptions({ bodies: side, units: 'in' }), up: '+z', forward: '+x', placement: 'keep' });
  report('offset (side-by-side) weld is tied into the rail', off.frame.members.length === 3 && off.report.healed >= 1, `${off.frame.members.length} tubes, ${off.report.healed} end tied in`);
}

// 7. Optional: a team frame dropped into the project folder (skipped if absent)
{
  const file = new URL('../Chassis Baja File.STEP', import.meta.url);
  if (fs.existsSync(file)) {
    const occt = await createRequire(import.meta.url)('occt-import-js')();
    const raw = rawFromOcct(occt.ReadStepFile(new Uint8Array(fs.readFileSync(file)), OCCT_PARAMS), 'Chassis Baja File.STEP', 'step');
    const res = analyzeImport(raw, suggestOptions(raw));
    const parent = res.frame.nodes.map((_, i) => i);
    const find = (x) => { while (parent[x] !== x) x = parent[x] = parent[parent[x]]; return x; };
    for (const m of res.frame.members) parent[find(m.a)] = find(m.b);
    const pieces = new Set(res.frame.nodes.map((_, i) => find(i))).size;
    report('team STEP frame: tubes recognized', res.report.tubes >= raw.bodies.length - 1, `${res.report.tubes}/${raw.bodies.length} (${res.report.bent} bent, ${res.report.bends} bends)`);
    report('team STEP frame: one connected frame, no open ends', pieces === 1 && res.report.freeEnds === 0, `${pieces} piece(s), ${res.report.freeEnds} open ends, ${res.report.joints} joints, ${res.report.members} tubes`);
  } else console.log('SKIP  team STEP frame — "Chassis Baja File.STEP" not in the project folder');
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll CAD import checks passed');
process.exit(failures ? 1 : 0);
