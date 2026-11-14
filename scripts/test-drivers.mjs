// Driver model and roster checks: body estimates from height / weight / gender,
// measured overrides, migration of old fixed design drivers, and design checks
// that cover every driver on the roster.
// Run: node scripts/test-drivers.mjs
import '../src/catalog/powertrain.js';
import '../src/catalog/dynamics.js';
import '../src/catalog/ergonomics.js';
import '../src/catalog/hardware.js';
import { applyDefaultMounts } from '../src/catalog/mounts.js';
import { newProject, migrate } from '../src/core/defaults.js';
import { driverBody, makeDriver, SEXES } from '../src/systems/drivers.js';
import { analyze } from '../src/systems/analysis.js';
import { runChecks } from '../src/checks/index.js';
import '../src/checks/chassis.js';
import '../src/checks/ergonomics.js';

applyDefaultMounts();
let failures = 0;
const report = (label, ok, detail) => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`); };
let rev = 0;
const run = (state) => { const store = { state, rev: ++rev }; const A = analyze(store); return { A, issues: runChecks(state, A).filter((i) => i.category === 'ergonomics') }; };

// 1. Estimates line up with standard anthropometric sizes (the old fixed drivers)
const OLD = {
  '5th % female (5\' 0", 110 lb)': [{ sex: 'female', height: 60, weight: 110 }, { sitHeight: 31.7, shoulderH: 20.4, thigh: 15.6, shank: 15.4, upperArm: 11.5, forearm: 12.6 }],
  '50th % male (5\' 9", 172 lb)': [{ sex: 'male', height: 69.1, weight: 172 }, { sitHeight: 35.7, shoulderH: 23.3, thigh: 17.3, shank: 17.4, upperArm: 13.2, forearm: 14.2 }],
  '95th % male (6\' 2", 216 lb)': [{ sex: 'male', height: 74, weight: 216 }, { sitHeight: 38.0, shoulderH: 25.0, thigh: 18.8, shank: 19.0, upperArm: 14.3, forearm: 15.3 }],
};
for (const [label, [spec, ref]] of Object.entries(OLD)) {
  const b = driverBody(makeDriver('D1', spec));
  const worst = Math.max(...Object.entries(ref).map(([k, v]) => Math.abs(b[k] - v)));
  report(`estimate matches ${label}`, worst < 0.5, `worst difference ${worst.toFixed(2)} in`);
}
{
  const light = driverBody(makeDriver('D1', { height: 70, weight: 140 })), heavy = driverBody(makeDriver('D1', { height: 70, weight: 260 }));
  report('weight thickens the body and widens the hips', heavy.girth > light.girth && heavy.hipWidth > light.hipWidth + 2, `girth ${light.girth.toFixed(2)} → ${heavy.girth.toFixed(2)}, hips ${light.hipWidth.toFixed(1)} → ${heavy.hipWidth.toFixed(1)} in`);
  report('weight does not change limb lengths', light.thigh === heavy.thigh && light.sitHeight === heavy.sitHeight);
  const m = driverBody({ ...makeDriver('D1', { height: 70 }), measure: { sitHeight: 39.5, forearm: 15 } });
  report('measured values replace the estimates', m.sitHeight === 39.5 && m.forearm === 15 && m.measured.length === 2 && m.estimates.sitHeight !== 39.5, `measured: ${m.measured.join(', ')}`);
  const u = driverBody(makeDriver('D1', { sex: 'unspecified', height: 66, weight: 150 }));
  const f = driverBody(makeDriver('D1', { sex: 'female', height: 66, weight: 150 })), mm = driverBody(makeDriver('D1', { sex: 'male', height: 66, weight: 150 }));
  report('"Not specified" uses average proportions', u.sitHeight > Math.min(f.sitHeight, mm.sitHeight) && u.sitHeight < Math.max(f.sitHeight, mm.sitHeight), SEXES.map((s) => s.label).join(' / '));
}

// 2. Old projects with a fixed design driver become an editable roster
{
  const st = newProject({ template: 'starter' });
  st.ergonomics = { driver: '5F', showDriver: true, includeDriverInCG: true };
  delete st.seq.D;
  migrate(st);
  const d = st.ergonomics.drivers;
  report('old design driver migrates to the roster', d.length === 1 && d[0].sex === 'female' && d[0].height === 60 && d[0].weight === 110 && st.ergonomics.driverId === d[0].id && !('driver' in st.ergonomics) && st.seq.D === 1, JSON.stringify(d[0]));
}

// 3. The starter car fits its default driver
const st = newProject({ template: 'starter' });
{
  const { A, issues } = run(st);
  report('default driver is posed', !!A.ergo.pose && A.ergoAll.length === 1, A.ergo.driver.summary);
  report('starter car has no ergonomics errors or warnings', !issues.some((i) => i.severity !== 'info'), issues.map((i) => i.title).join(' | ') || 'clean');
}

// 4. Every driver on the roster is checked, by name
{
  st.ergonomics.drivers.push(
    makeDriver('D2', { name: 'Tall Tom', sex: 'male', height: 79, weight: 265 }),
    makeDriver('D3', { name: 'Short Sam', sex: 'female', height: 56, weight: 98 }),
  );
  st.seq.D = 3;
  const { A, issues } = run(st);
  report('all three drivers are posed', A.ergoAll.length === 3 && A.ergoAll.every((e) => e.pose));
  const tom = issues.filter((i) => i.title.includes('Tall Tom')), sam = issues.filter((i) => i.title.includes('Short Sam'));
  report('a 6\' 7", 265 lb driver is flagged by name', tom.length > 0, tom.map((i) => i.title).join(' | '));
  report('a 4\' 8" driver is flagged by name', sam.length > 0, sam.map((i) => i.title).join(' | '));
  report('issues about other drivers offer to pose them', [...tom, ...sam].every((i) => i.fix?.label?.startsWith('Pose ')));
  const tomFit = A.ergoAll.find((e) => e.driver.id === 'D2'), base = A.ergoAll.find((e) => e.driver.id === 'D1');
  report('the taller driver sits closer to the roof', tomFit.clearances.find((c) => c.name === 'helmet').dist < base.clearances.find((c) => c.name === 'helmet').dist);
  st.ergonomics.checkAll = false;
  const only = run(st).issues;
  report('"check every driver" off → only the posed driver', !only.some((i) => /Tall Tom|Short Sam/.test(i.title)));
  st.ergonomics.checkAll = true;
  st.ergonomics.driverId = 'D2';
  const posed = run(st);
  report('switching the posed driver moves mass and CG', posed.A.ergo.driver.label === 'Tall Tom' && Math.abs(posed.A.mass.total - run({ ...st, ergonomics: { ...st.ergonomics, driverId: 'D1' } }).A.mass.total - 90) < 0.01, `with driver ${posed.A.mass.total.toFixed(1)} lb`);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll driver checks passed');
process.exit(failures ? 1 : 0);
