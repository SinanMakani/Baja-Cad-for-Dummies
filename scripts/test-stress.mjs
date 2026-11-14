// Runs the Baja stress-test cases on the starter frame and prints a summary.
// Run: node scripts/test-stress.mjs
import { newProject } from '../src/core/defaults.js';
import { runStressTests, defaultStress } from '../src/systems/stresstest.js';

const st = newProject({ template: 'starter' });
st.stress ??= defaultStress();
const t0 = performance.now();
const run = runStressTests(st);
const ms = performance.now() - t0;
const f = (v, p = 2) => (Number.isFinite(v) ? v.toFixed(p) : '∞');
console.log(`Starter frame: ${Object.keys(st.chassis.members).length} tubes, ${Object.keys(st.chassis.nodes).length} joints — ${ms.toFixed(0)} ms for ${run.cases.length} cases`);
for (const c of run.cases) {
  if (!c.ok) { console.log(`  ${c.name.padEnd(28)} ERROR ${c.error}`); continue; }
  console.log(`  ${c.name.padEnd(28)} ${c.pass ? 'PASS' : 'FAIL'}  FoS ${f(c.minFos)} (${c.minFosMember})  buckling ${f(c.minBuck)} (${c.minBuckMember})  σvm ${f(c.maxVm / 1000, 1)} ksi  δmax ${f(c.maxDisp, 3)} in${c.torsionK ? `  K ${f(c.torsionK, 0)} lb·ft/deg` : ''}  [${c.setup.points.length} load pts, ${c.setup.supports.length} supports]`);
}
console.log(run.pass ? 'Overall: PASS' : 'Overall: FAIL');

// A loose tube (not connected to the frame) is left out instead of breaking every case.
{
  const { addNode, addMember } = await import('../src/systems/chassis.js');
  const loose = newProject({ template: 'starter' });
  addMember(loose, addNode(loose, [30, 0, 70], {}), addNode(loose, [40, 0, 70], {}), { role: 'SEC' });
  const r = runStressTests(loose);
  const ok = r.left.length === 1 && r.cases.every((c) => c.ok) && r.pass === run.pass;
  console.log(`${ok ? 'PASS' : 'FAIL'}  loose tube left out of the stress tests — ${r.left.length} left out, ${r.cases.filter((c) => c.ok).length}/${r.cases.length} cases ran`);
  if (!ok || !run.pass) process.exitCode = 1;
}
