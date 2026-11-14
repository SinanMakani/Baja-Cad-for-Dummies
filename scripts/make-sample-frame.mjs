// Writes samples/starter-frame-solidworks-style.stl: the starter frame as a
// SolidWorks-style weldment export — hollow tubes with trimmed ends, the roll
// hoop, front bracing and lower rails bent from single tubes (4.5 in bend
// radius), millimeters, Y up, front toward +Z. A handy file for trying
// Chassis ▸ Import CAD.
// Run: node scripts/make-sample-frame.mjs
import fs from 'node:fs';
import { newProject } from '../src/core/defaults.js';
import { frameBodies } from './lib/sampleFrame.mjs';

const st = newProject({ template: 'starter' });
const { bodies, bends } = frameBodies(st, { bent: true, seg: 20 });
const toSW = (p) => [p[1] * 25.4, p[2] * 25.4, p[0] * 25.4];

const nTris = bodies.reduce((s, b) => s + b.positions.length / 9, 0);
const buf = Buffer.alloc(84 + nTris * 50);
buf.write('Baja Designer sample frame - mm, Y up, front +Z', 0, 'ascii');
buf.writeUInt32LE(nTris, 80);
let o = 84;
for (const b of bodies) {
  const P = b.positions;
  for (let t = 0; t < P.length; t += 9) {
    const p = [0, 3, 6].map((k) => toSW([P[t + k], P[t + k + 1], P[t + k + 2]]));
    const u = p[1].map((v, i) => v - p[0][i]), w = p[2].map((v, i) => v - p[0][i]);
    let n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const l = Math.hypot(...n) || 1; n = n.map((v) => v / l);
    for (const v of [n, ...p]) for (const c of v) { buf.writeFloatLE(c, o); o += 4; }
    buf.writeUInt16LE(0, o); o += 2;
  }
}
fs.mkdirSync('samples', { recursive: true });
fs.writeFileSync('samples/starter-frame-solidworks-style.stl', buf);
const nBent = bodies.filter((b) => b.bends).length;
console.log(`Wrote samples/starter-frame-solidworks-style.stl (${bodies.length} tubes, ${nBent} of them bent with ${bends} bends; ${nTris} triangles, ${(buf.length / 1024).toFixed(0)} KB)`);
