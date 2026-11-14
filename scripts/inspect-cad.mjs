// See how a CAD file converts, without the browser: runs the same reader and
// importer as Chassis ▸ Import CAD and prints every body (straight tube, bent
// tube or reference), the rebuilt frame, and (with --stress) the stress tests.
//
//   node scripts/inspect-cad.mjs "Chassis Baja File.STEP"
//   node scripts/inspect-cad.mjs frame.stl --units mm --stress
//   node scripts/inspect-cad.mjs frame.step --json out.json
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { suggestOptions, analyzeImport, applyImport, splitComponents, parseTubeTable, rawFromOcct, OCCT_PARAMS, NATIVE_EXT } from '../src/systems/cadImport.js';
import { newProject } from '../src/core/defaults.js';
import { runStressTests } from '../src/systems/stresstest.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && !/^(in|mm|cm|m)$/.test(a));
const flag = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : null; };
if (!file) { console.log('Usage: node scripts/inspect-cad.mjs <file.step|stp|iges|igs|stl|obj|csv> [--units in|mm|cm|m] [--up +y] [--forward +z] [--tol 0.5] [--stress] [--json out.json]'); process.exit(1); }

const ext = path.extname(file).slice(1).toLowerCase();
if (NATIVE_EXT.includes(ext)) { console.log(`${ext.toUpperCase()} is a native CAD file; export STEP AP214 from SolidWorks first.`); process.exit(1); }
const buf = fs.readFileSync(file);
const t0 = performance.now();
let raw;
if (['step', 'stp', 'iges', 'igs'].includes(ext)) {
  const occt = await createRequire(import.meta.url)('occt-import-js')();
  const res = ['step', 'stp'].includes(ext) ? occt.ReadStepFile(new Uint8Array(buf), OCCT_PARAMS) : occt.ReadIgesFile(new Uint8Array(buf), OCCT_PARAMS);
  raw = rawFromOcct(res, path.basename(file), ext);
} else if (ext === 'stl') {
  const geo = new STLLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  raw = { name: path.basename(file), ext, format: 'STL', units: null, bodies: splitComponents(geo.getAttribute('position').array).map((positions, i) => ({ name: `Shell ${i + 1}`, positions })) };
} else if (ext === 'obj') {
  const bodies = [];
  new OBJLoader().parse(buf.toString('utf8')).traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
    splitComponents(g.getAttribute('position').array).forEach((positions, i) => bodies.push({ name: `${o.name || 'Object'} ${i + 1}`, positions }));
  });
  raw = { name: path.basename(file), ext, format: 'OBJ', units: null, bodies };
} else if (ext === 'csv' || ext === 'txt') {
  const { tubes, units } = parseTubeTable(buf.toString('utf8'));
  raw = { name: path.basename(file), ext, format: 'Tube list', units, bodies: [], tubes };
} else { console.log(`.${ext} isn't supported`); process.exit(1); }
const tRead = performance.now() - t0;

const opts = suggestOptions(raw);
for (const [k, key] of [['units', 'units'], ['up', 'up'], ['forward', 'forward']]) if (typeof flag(k) === 'string') opts[key] = flag(k);
if (typeof flag('tol') === 'string') opts.jointTol = parseFloat(flag('tol'));
const t1 = performance.now();
const res = analyzeImport(raw, opts);
const tAnalyze = performance.now() - t1;
const r = res.report;
const f = (v, p = 3) => (Number.isFinite(v) ? v.toFixed(p) : '—');
const tris = (b) => b.positions.length / 9;

console.log(`\n${raw.name} — ${raw.format}, ${raw.bodies?.length ?? raw.tubes.length} ${raw.tubes ? 'rows' : 'bodies'}; read ${tRead.toFixed(0)} ms, analyzed ${tAnalyze.toFixed(0)} ms`);
console.log(`Options: units ${opts.units}${raw.unitsFixed ? ' (from file)' : ''}, up ${opts.up}, front ${opts.forward}, joint tolerance ${opts.jointTol} in`);
console.log(`Tubes ${r.tubes} (${r.bent} bent → ${r.bentRuns} runs, ${r.bends} bends) · reference ${r.other} · joints ${r.joints} · members ${r.members} · T-splits ${r.splits} · open ends ${r.freeEnds} · wall assumed ${r.wallAssumed}`);
console.log('Sizes:', Object.entries(res.sizes).map(([k, n]) => `${k} ×${n}`).join(' | '));

if (!raw.tubes) {
  console.log('\nBodies:');
  res.bodies.forEach((b, i) => {
    const fit = b.bent || b.fit;
    let line = `  ${String(i + 1).padStart(3)} ${b.kind.padEnd(8)} ${String(tris(b)).padStart(6)} facets`;
    if (b.kind === 'straight' && b.fit) line += `  OD ${f(2 * b.fit.R)} wall ${b.fit.r ? f(b.fit.R - b.fit.r) : '—'}  L ${f(b.fit.length, 2)}  resid ${f(b.fit.residual, 4)}`;
    else if (b.kind === 'bent' || (b.kind === 'straight' && b.bent)) line += `  OD ${f(2 * b.bent.R)} wall ${b.bent.r ? f(b.bent.R - b.bent.r) : '—'}  runs ${b.bent.segs.length}  bends ${b.bent.bends.map((x) => `${x.angle.toFixed(0)}°${x.clr ? `/R${x.clr.toFixed(1)}` : ''}`).join(' ') || '—'}`;
    else {
      const bf = raw.bodies[i].bentFit;
      line += `  straight fit: ${fit?.ok ? 'ok' : `no (OD ${f(2 * (fit?.R ?? NaN))}, resid ${f(fit?.residual, 3)}, L ${f(fit?.length, 1)})`}; bent fit: ${bf ? (bf.ok ? 'ok but rejected by size' : `no (${bf.why || `resid ${f(bf.residual, 3)}`})`) : 'not a tube'}`;
    }
    console.log(line);
  });
}

const free = [];
{
  // which tube ends found nothing to join
  const deg = new Map();
  for (const m of res.frame.members) for (const n of [m.a, m.b]) deg.set(n, (deg.get(n) || 0) + 1);
  res.frame.nodes.forEach((p, i) => { if ((deg.get(i) || 0) === 1) free.push(p); });
}
if (free.length) console.log(`\nJoints with only one tube (open ends): ${free.length}\n${free.slice(0, 20).map((p) => `  (${p.map((v) => v.toFixed(2)).join(', ')})`).join('\n')}`);

// connectivity of the rebuilt frame
{
  const parent = res.frame.nodes.map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) x = parent[x] = parent[parent[x]]; return x; };
  for (const m of res.frame.members) parent[find(m.a)] = find(m.b);
  const groups = new Map();
  res.frame.nodes.forEach((_, i) => { const g = find(i); groups.set(g, (groups.get(g) || 0) + 1); });
  const sizes = [...groups.values()].sort((a, b) => b - a);
  console.log(`\nFrame pieces (connected groups of joints): ${sizes.length}${sizes.length > 1 ? ` — sizes ${sizes.join(', ')}` : ' (one connected frame)'}`);
}

if (flag('stress')) {
  const st = newProject({ template: 'blank', name: raw.name });
  applyImport(st, res, opts, raw.name);
  const run = runStressTests(st);
  console.log(`\nStress tests on the imported frame (${Object.keys(st.chassis.members).length} tubes, roles untagged):`);
  for (const c of run.cases) console.log(`  ${(c.name || c.key).padEnd(28)} ${c.error ? `ERROR ${c.error}` : `${c.pass ? 'PASS' : 'FAIL'}  FoS ${f(c.minFos, 2)} (${c.minFosMember})  buckling ${f(c.minBuck, 2)}`}`);
  console.log(`  Overall: ${run.pass ? 'PASS' : 'FAIL'}`);
}

if (typeof flag('json') === 'string') {
  fs.writeFileSync(flag('json'), JSON.stringify({ file: raw.name, options: opts, report: r, sizes: res.sizes, nodes: res.frame.nodes, members: res.frame.members, bends: res.bends.map((b) => ({ at: b.V, angle: b.angle, clr: b.clr })) }, null, 1));
  console.log(`\nWrote ${flag('json')}`);
}
