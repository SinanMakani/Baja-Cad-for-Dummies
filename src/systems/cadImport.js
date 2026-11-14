// Chassis import from CAD.
//
// SolidWorks part/assembly files are a closed, encrypted format, so they are
// exported first (STEP AP214 keeps every weldment member as its own solid).
// Pipeline:  read file → bodies (triangle meshes) → units/axes/placement →
//            fit a straight tube to each body (axis, OD, wall), or split a bent
//            tube into straight runs meeting at its virtual sharps (bentTube.js) →
//            rebuild joints where tube centerlines meet → nodes + members.
// Bodies that are not round tubes (plates, gussets, brackets) stay as
// reference geometry so nothing in the file is silently dropped.
import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { nextId } from '../core/store.js';
import { findNodeAt } from './chassis.js';
import { fitBentTube, twoRadii } from './bentTube.js';

export const NATIVE_EXT = ['sldprt', 'sldasm', 'slddrw', 'prt', 'asm', 'ipt', 'iam', 'catpart', 'catproduct', 'x_t', 'x_b', 'f3d', 'par', 'psm', '3dm'];
export const ACCEPT = '.step,.stp,.iges,.igs,.stl,.obj,.csv,.txt,.sldprt,.sldasm';
const UNIT_SCALE = { in: 1, mm: 1 / 25.4, cm: 1 / 2.54, m: 39.3701, ft: 12 };

// Standard tube wall gauges (in). Measured sizes within a few thousandths of a
// standard OD (1/16 in steps) or wall snap to it, so tessellation noise doesn't
// split one tube size into two profiles.
const GAUGES = [0.028, 0.035, 0.049, 0.058, 0.065, 0.072, 0.083, 0.095, 0.109, 0.12, 0.125, 0.134, 0.156, 0.188, 0.25];
export function snapTubeSize(R, r) {
  let od = 2 * R;
  const o16 = Math.round(od * 16) / 16;
  if (Math.abs(od - o16) < 0.004) od = o16;
  let wall = r ? R - r : null;
  if (wall != null) {
    const g = GAUGES.reduce((best, v) => (Math.abs(v - wall) < Math.abs(best - wall) ? v : best));
    if (Math.abs(g - wall) < 0.0035) wall = g;
  }
  return { R: od / 2, r: wall != null ? od / 2 - wall : null };
}

export class CadImportError extends Error {
  constructor(message, kind = 'error') { super(message); this.kind = kind; }
}

// ------------------------------------------------------------------ readers

/** STEP/IGES tessellation: inches, chord error 0.15 % of the model size, ≤ 20° between facets. */
export const OCCT_PARAMS = { linearUnit: 'inch', linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.0015, angularDeflection: 0.35 };

let occtPromise = null;
function loadOcct() {
  occtPromise ??= (async () => {
    let factory, wasmUrl;
    try {
      [{ default: factory }, { default: wasmUrl }] = await Promise.all([
        import('occt-import-js'),
        import('occt-import-js/dist/occt-import-js.wasm?url'),
      ]);
    } catch (e) {
      // The reader is a separate download. It fails when the page is offline,
      // or (running locally) when the dev server stopped or restarted after
      // the page loaded, which leaves the page asking for an outdated copy.
      throw new CadImportError(`The STEP/IGES reader couldn't be downloaded (${e?.message || e}). Reload the page and try again. If you run the designer locally, check that \`npm run dev\` is still running.`, 'reader');
    }
    try {
      return await factory({ locateFile: (p) => (p.endsWith('.wasm') ? wasmUrl : p) });
    } catch (e) {
      throw new CadImportError(`The STEP/IGES reader couldn't start (${e?.message || e}). Reload the page and try again; if it keeps failing, export STL from SolidWorks instead.`, 'reader');
    }
  })();
  occtPromise.catch(() => { occtPromise = null; });
  return occtPromise;
}

/** An occt-import-js result → raw bodies (shared with scripts/inspect-cad.mjs). */
export function rawFromOcct(res, name, ext) {
  if (!res?.success) throw new CadImportError('The file could not be read as STEP/IGES. Re-export it from SolidWorks as STEP AP214.');
  const bodies = (res.meshes || []).map((m, i) => ({
    name: m.name || `Body ${i + 1}`,
    positions: expandIndexed(m.attributes.position.array, m.index?.array),
  })).filter((b) => b.positions.length >= 9);
  if (!bodies.length) throw new CadImportError('The file has no solid bodies. Export the frame part (or an assembly containing it) rather than a drawing or sketch.');
  return { name, ext, format: ['iges', 'igs'].includes(ext) ? 'IGES' : 'STEP', units: 'in', unitsFixed: true, bodies };
}

/** Read a CAD file into raw bodies (CAD units and axes) or direct tube centerlines. */
export async function readCadFile(file, onStatus = () => {}) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (NATIVE_EXT.includes(ext)) {
    throw new CadImportError(`${ext.toUpperCase()} is a native CAD file that only its own program can open.`, 'native');
  }
  if (['step', 'stp', 'iges', 'igs'].includes(ext)) {
    onStatus('Loading the CAD reader (about 8 MB, first time only)…');
    const occt = await loadOcct();
    onStatus(`Reading ${file.name}…`);
    await new Promise((r) => setTimeout(r, 30));
    const buf = new Uint8Array(await file.arrayBuffer());
    const res = ['step', 'stp'].includes(ext) ? occt.ReadStepFile(buf, OCCT_PARAMS) : occt.ReadIgesFile(buf, OCCT_PARAMS);
    return rawFromOcct(res, file.name, ext);
  }
  if (ext === 'stl') {
    onStatus(`Reading ${file.name}…`);
    const geo = new STLLoader().parse(await file.arrayBuffer());
    const pos = geo.getAttribute('position').array;
    onStatus('Separating bodies…');
    await new Promise((r) => setTimeout(r, 20));
    const bodies = splitComponents(pos).map((positions, i) => ({ name: `Shell ${i + 1}`, positions }));
    return { name: file.name, ext, format: 'STL', units: null, bodies };
  }
  if (ext === 'obj') {
    const group = new OBJLoader().parse(await file.text());
    const bodies = [];
    group.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
      splitComponents(g.getAttribute('position').array).forEach((positions, i) => bodies.push({ name: `${o.name || 'Object'} ${i + 1}`, positions }));
    });
    return { name: file.name, ext, format: 'OBJ', units: null, bodies };
  }
  if (ext === 'csv' || ext === 'txt') {
    const { tubes, units } = parseTubeTable(await file.text());
    return { name: file.name, ext, format: 'Tube list', units, bodies: [], tubes };
  }
  throw new CadImportError(`.${ext} files are not supported. Use STEP, IGES, STL, OBJ or a tube-endpoint CSV.`);
}

function expandIndexed(pos, index) {
  if (!index) return Float32Array.from(pos);
  const out = new Float32Array(index.length * 3);
  for (let i = 0; i < index.length; i++) {
    const k = index[i] * 3;
    out[i * 3] = pos[k]; out[i * 3 + 1] = pos[k + 1]; out[i * 3 + 2] = pos[k + 2];
  }
  return out;
}

/** Split a triangle soup into connected shells (one per tube in a typical export). */
export function splitComponents(pos) {
  const n = pos.length / 3;
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], pos[i * 3 + k]); max[k] = Math.max(max[k], pos[i * 3 + k]); }
  const eps = Math.max(1e-6, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) * 1e-6);
  const ids = new Map();
  const vid = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const key = `${Math.round(pos[i * 3] / eps)},${Math.round(pos[i * 3 + 1] / eps)},${Math.round(pos[i * 3 + 2] / eps)}`;
    let id = ids.get(key);
    if (id === undefined) { id = ids.size; ids.set(key, id); }
    vid[i] = id;
  }
  const parent = new Int32Array(ids.size).map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let t = 0; t < n; t += 3) {
    const a = find(vid[t]), b = find(vid[t + 1]), c = find(vid[t + 2]);
    parent[b] = a; parent[find(c)] = a;
  }
  const groups = new Map();
  for (let t = 0; t < n; t += 3) {
    const r = find(vid[t]);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(t);
  }
  return [...groups.values()].map((tris) => {
    const out = new Float32Array(tris.length * 9);
    tris.forEach((t, i) => out.set(pos.subarray ? pos.subarray(t * 3, t * 3 + 9) : pos.slice(t * 3, t * 3 + 9), i * 9));
    return out;
  });
}

/** Tube centerlines from a CSV/TXT table: x1 y1 z1 x2 y2 z2 [od wall role]. */
export function parseTubeTable(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith(';') && !l.startsWith('#'));
  const split = (l) => l.split(/[,\t;]/).map((c) => c.trim().replace(/^"|"$/g, ''));
  let header = null, start = 0;
  if (lines.length && /[a-df-z]/i.test(lines[0].replace(/e[-+]?\d/gi, ''))) { header = split(lines[0]).map((h) => h.toLowerCase()); start = 1; }
  const norm = (h) => h.replace(/\(.*?\)/g, '').replace(/[^a-z0-9]/g, '');
  const col = (names) => header ? header.findIndex((h) => names.includes(norm(h))) : -1;
  let idx = header ? ['x1', 'y1', 'z1', 'x2', 'y2', 'z2'].map((k) => col([k, k.replace('1', 'start').replace('2', 'end')])) : null;
  const odCol = col(['od', 'diameter', 'outsidediameter']), wallCol = col(['wall', 'wallthickness', 't']), roleCol = col(['role', 'type']);
  const units = header && header.some((h) => /mm/.test(h)) ? 'mm' : 'in';
  const tubes = [];
  for (const line of lines.slice(start)) {
    const cells = split(line);
    let coords;
    if (idx && idx.every((i) => i >= 0)) coords = idx.map((i) => parseFloat(cells[i]));
    else {
      const nums = cells.map(parseFloat).filter((v) => Number.isFinite(v));
      if (nums.length < 6) continue;
      coords = nums.slice(0, 6);
    }
    if (coords.some((v) => !Number.isFinite(v))) continue;
    tubes.push({
      a: coords.slice(0, 3), b: coords.slice(3, 6),
      od: odCol >= 0 ? parseFloat(cells[odCol]) : null,
      wall: wallCol >= 0 ? parseFloat(cells[wallCol]) : null,
      role: roleCol >= 0 ? cells[roleCol] : null,
    });
  }
  if (!tubes.length) throw new CadImportError('No tube rows found. Each row needs X1, Y1, Z1, X2, Y2, Z2 (and optionally OD, wall, role).');
  return { tubes, units };
}

// ------------------------------------------------------------------ orientation

const AXES = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const axisVec = (s) => AXES[s[1]].map((v) => v * (s[0] === '-' ? -1 : 1));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function rawPoints(raw) {
  if (raw.tubes) return raw.tubes.flatMap((t) => [t.a, t.b]);
  const pts = [];
  for (const b of raw.bodies) {
    const step = Math.max(1, Math.floor(b.positions.length / 3 / 400));
    for (let i = 0; i < b.positions.length / 3; i += step) pts.push([b.positions[i * 3], b.positions[i * 3 + 1], b.positions[i * 3 + 2]]);
  }
  return pts;
}

/** Sensible starting options: units, up axis, which way is forward. */
export function suggestOptions(raw) {
  const pts = rawPoints(raw);
  const min = [0, 1, 2].map((k) => Math.min(...pts.map((p) => p[k])));
  const max = [0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k])));
  const diag = Math.hypot(...max.map((v, k) => v - min[k]));
  const units = raw.units || (diag > 400 ? 'mm' : diag < 6 ? 'm' : 'in');
  const up = raw.tubes ? '+z' : '+y'; // tube tables use this app's axes; SolidWorks is Y-up
  const U = axisVec(up);
  const horiz = ['x', 'y', 'z'].filter((a) => AXES[a][0] * U[0] + AXES[a][1] * U[1] + AXES[a][2] * U[2] === 0);
  const ext = horiz.map((a) => max['xyz'.indexOf(a)] - min['xyz'.indexOf(a)]);
  const lenAxis = horiz[ext[0] >= ext[1] ? 0 : 1];
  let forward = `+${lenAxis}`;
  if (!raw.tubes) {
    // The roll cage roof usually sits behind the middle of the car: front is the other way.
    const k = 'xyz'.indexOf(lenAxis), uk = 'xyz'.indexOf(up[1]);
    const zTop = max[uk] - 0.15 * (max[uk] - min[uk]);
    const top = pts.filter((p) => p[uk] >= zTop);
    const mid = (min[k] + max[k]) / 2;
    const roof = top.reduce((s, p) => s + p[k], 0) / Math.max(1, top.length);
    forward = `${roof <= mid ? '+' : '-'}${lenAxis}`;
  }
  return { units, up, forward, placement: 'auto', rearX: -14, ground: 9.4, jointTol: 0.5, defaultWall: 0.065, mode: 'replace' };
}

export function forwardChoices(up) {
  return ['x', 'y', 'z'].filter((a) => a !== up[1]).flatMap((a) => [`+${a}`, `-${a}`]);
}

function makeMapper(raw, opts) {
  const s = UNIT_SCALE[opts.units] ?? 1;
  const U = axisVec(opts.up);
  let F = axisVec(opts.forward);
  if (Math.abs(dot3(F, U)) > 0.5) F = axisVec(forwardChoices(opts.up)[0]);
  const L = cross(U, F);
  const map = (p) => [dot3(p, F) * s, dot3(p, L) * s, dot3(p, U) * s];
  // placement offset
  let off = [0, 0, 0];
  if (opts.placement === 'auto') {
    const pts = rawPoints(raw).map(map);
    const min = [0, 1, 2].map((k) => Math.min(...pts.map((p) => p[k])));
    const max = [0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k])));
    let zMin = min[2];
    if (raw.tubes) {
      const odMax = Math.max(0, ...raw.tubes.map((t) => (t.od ? t.od * s : 1)));
      zMin -= odMax / 2;
    }
    off = [opts.rearX - min[0], -(min[1] + max[1]) / 2, opts.ground - zMin];
  }
  return (p) => { const q = map(p); return [q[0] + off[0], q[1] + off[1], q[2] + off[2]]; };
}

// ------------------------------------------------------------------ tube fitting

function principalAxis(P, c) {
  const C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of P) {
    const d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i * 3 + j] += d[i] * d[j];
  }
  let v = [C[0], C[4], C[8]].indexOf(Math.max(C[0], C[4], C[8]));
  v = AXES['xyz'[v]].slice();
  for (let it = 0; it < 40; it++) {
    const w = [0, 1, 2].map((i) => C[i * 3] * v[0] + C[i * 3 + 1] * v[1] + C[i * 3 + 2] * v[2]);
    const n = Math.hypot(...w);
    if (n < 1e-12) break;
    v = w.map((x) => x / n);
  }
  return v;
}

function basis(d) {
  const a = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let e1 = cross(d, a);
  const n = Math.hypot(...e1);
  e1 = e1.map((x) => x / n);
  return [e1, cross(d, e1)];
}

/** Algebraic (Kåsa) circle fit → center [cx, cy]. */
function circleFit(xy) {
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
  const n = xy.length;
  for (const [x, y] of xy) {
    const z = x * x + y * y;
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z;
  }
  // Solve [sxx sxy sx; sxy syy sy; sx sy n] [D E F] = -[sxz syz sz]
  const A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]], b = [-sxz, -syz, -sz];
  const det = (M) => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  const D0 = det(A);
  if (Math.abs(D0) < 1e-12) return null;
  const col = (k) => A.map((row, i) => row.map((v, j) => (j === k ? b[i] : v)));
  const D = det(col(0)) / D0, E = det(col(1)) / D0;
  return [-D / 2, -E / 2];
}

/** Two-cluster split of radial distances → [outer, inner|null]. */
function radii(rho) {
  let hi = Math.max(...rho), lo = Math.min(...rho);
  if (hi - lo < hi * 0.02) return { R: median(rho), r: null };
  for (let it = 0; it < 12; it++) {
    const mid = (hi + lo) / 2;
    const A = rho.filter((v) => v >= mid), B = rho.filter((v) => v < mid);
    hi = A.length ? mean(A) : hi; lo = B.length ? mean(B) : lo;
  }
  const mid = (hi + lo) / 2;
  const outer = rho.filter((v) => v >= mid), inner = rho.filter((v) => v < mid);
  const R = median(outer);
  if (inner.length < rho.length * 0.08) return { R, r: null };
  const r = median(inner);
  const spread = std(inner) / Math.max(r, 1e-6);
  return { R, r: r > 0.3 * R && spread < 0.08 ? r : null };
}
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))); };

/** Fit a straight round tube to a body's vertices (app coordinates, inches). */
export function fitTube(P) {
  if (P.length < 12) return null;
  let c = [0, 1, 2].map((k) => mean(P.map((p) => p[k])));
  let d = principalAxis(P, c);
  for (let it = 0; it < 4; it++) {
    const [e1, e2] = basis(d);
    const loc = P.map((p) => { const w = [p[0] - c[0], p[1] - c[1], p[2] - c[2]]; return [dot3(w, d), dot3(w, e1), dot3(w, e2)]; });
    const tm = median(loc.map((q) => q[0]));
    const ends = [loc.filter((q) => q[0] < tm), loc.filter((q) => q[0] >= tm)];
    const centers = ends.map((g) => {
      if (g.length < 6) return null;
      const f = circleFit(g.map((q) => [q[1], q[2]]));
      if (!f) return null;
      const t = mean(g.map((q) => q[0]));
      return [0, 1, 2].map((k) => c[k] + d[k] * t + e1[k] * f[0] + e2[k] * f[1]);
    });
    if (!centers[0] || !centers[1]) break;
    const nd = centers[1].map((v, k) => v - centers[0][k]);
    const nl = Math.hypot(...nd);
    if (nl < 1e-6) break;
    d = nd.map((v) => v / nl);
    c = centers[0].map((v, k) => (v + centers[1][k]) / 2);
  }
  const [e1, e2] = basis(d);
  const ts = [], rho = [];
  for (const p of P) {
    const w = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
    ts.push(dot3(w, d));
    rho.push(Math.hypot(dot3(w, e1), dot3(w, e2)));
  }
  // wall radii from the two peaks of the distance histogram, and roundness
  // from the 90th-percentile deviation, so a few stray points at coped or cut
  // ends can't reject a tube or shift its size
  let { R, r } = twoRadii(rho);
  if (!Number.isFinite(R)) ({ R, r } = radii(rho));
  const outer = rho.filter((v) => v > (r ? (R + r) / 2 : R * 0.5));
  const devs = outer.map((v) => Math.abs(v - R)).sort((x, y) => x - y);
  const residual = (devs[Math.floor(devs.length * 0.9)] ?? Infinity) / Math.max(R, 1e-6);
  // the tube's extent from points on its outer wall (cope tips included), so a
  // stray facet beyond an end can't stretch it
  const wall = ts.filter((_, i) => Math.abs(rho[i] - R) < 0.08 * R);
  const span = wall.length >= 6 ? wall : ts;
  let t0 = Infinity, t1 = -Infinity;
  for (const t of span) { if (t < t0) t0 = t; if (t > t1) t1 = t; }
  const length = t1 - t0;
  return {
    a: c.map((v, k) => v + d[k] * t0), b: c.map((v, k) => v + d[k] * t1), dir: d,
    R, r, length, residual,
    ok: residual < 0.07 && R > 0.12 && R < 2.6 && length > 1.6 * R,
  };
}

// ------------------------------------------------------------------ joints

/** Closest points between two infinite lines p+su and q+tv (u, v unit). */
function lineLine(p, u, q, v) {
  const w = [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
  const b = dot3(u, v), d = dot3(u, w), e = dot3(v, w);
  const den = 1 - b * b;
  if (den < 1e-8) return null;
  const s = (b * e - d) / den, t = (e - b * d) / den;
  const X = [0, 1, 2].map((k) => p[k] + u[k] * s), Y = [0, 1, 2].map((k) => q[k] + v[k] * t);
  return { s, t, X, Y, gap: Math.hypot(X[0] - Y[0], X[1] - Y[1], X[2] - Y[2]) };
}

/** Closest approach between the line p+su and a polyline (s along the line). */
function rayToPolyline(p, u, pts) {
  let best = null;
  for (let k = 0; k + 1 < pts.length; k++) {
    const A = pts[k], d = [0, 1, 2].map((i) => pts[k + 1][i] - A[i]);
    const L = Math.hypot(...d);
    if (L < 1e-9) continue;
    const v = d.map((x) => x / L);
    const hit = lineLine(p, u, A, v);
    const t = hit ? Math.max(0, Math.min(L, hit.t)) : 0;
    const Q = [0, 1, 2].map((i) => A[i] + v[i] * t);
    const s = dot3([0, 1, 2].map((i) => Q[i] - p[i]), u);
    const X = [0, 1, 2].map((i) => p[i] + u[i] * s);
    const gap = Math.hypot(X[0] - Q[0], X[1] - Q[1], X[2] - Q[2]);
    if (!best || gap < best.gap) best = { s, gap };
  }
  return best;
}

/** Is X inside a bend: on its arc, or on a straight's centerline between the tangent point and the sharp? */
function inBend(X, bd, jointTol) {
  const tol = 0.6 * bd.R + 0.5 * jointTol;
  const near = (A, B) => {
    const d = [0, 1, 2].map((i) => B[i] - A[i]);
    const L2 = dot3(d, d);
    const t = L2 > 1e-12 ? Math.max(0, Math.min(1, dot3([0, 1, 2].map((i) => X[i] - A[i]), d) / L2)) : 0;
    return Math.hypot(...[0, 1, 2].map((i) => A[i] + d[i] * t - X[i])) <= tol;
  };
  if (near(bd.arc[0], bd.V) || near(bd.V, bd.arc.at(-1))) return true;
  for (let k = 0; k + 1 < bd.arc.length; k++) if (near(bd.arc[k], bd.arc[k + 1])) return true;
  return false;
}

/**
 * Tie in tube ends that ended up alone at a joint but touch another tube:
 * offset or side-by-side welds (centerlines that pass each other instead of
 * meeting), and ends that land on a tube whose own end moved to a different
 * joint. The end moves onto the other tube's centerline (a T-joint, split
 * later) or merges into that tube's nearby end joint. Mutates ends/pos and
 * returns how many ends were tied in.
 */
function healJoints(segs, ends, pos, jointTol) {
  const count = new Map();
  for (const e of ends) count.set(e.node, (count.get(e.node) || 0) + 1);
  let healed = 0;
  ends.forEach((e) => {
    if (count.get(e.node) !== 1) return;
    const s = segs[e.seg];
    const X = pos[e.node];
    let best = null;
    segs.forEach((o, j) => {
      if (j === e.seg || (s.bent && o.body === s.body)) return;
      const na = ends[j * 2].node, nb = ends[j * 2 + 1].node;
      if (na === e.node || nb === e.node || na === nb) return;
      // the tube as rebuilt, and as it was in the file (an end snapped to a
      // bend's virtual sharp can swing the rebuilt line off a T-joint)
      const near = (A, B) => {
        const d = [0, 1, 2].map((k) => B[k] - A[k]);
        const L2 = dot3(d, d);
        const t = Math.max(0, Math.min(1, dot3([0, 1, 2].map((k) => X[k] - A[k]), d) / L2));
        const Q = [0, 1, 2].map((k) => A[k] + d[k] * t);
        return { t, Q, L: Math.sqrt(L2), dist: Math.hypot(Q[0] - X[0], Q[1] - X[1], Q[2] - X[2]) };
      };
      const built = near(pos[na], pos[nb]), file = near(o.a, o.b);
      const dist = Math.min(built.dist, file.dist);
      if (dist > s.R + o.R + jointTol) return;
      if (!best || dist < best.dist) best = { dist, builtDist: built.dist, t: built.t, Q: built.Q, na, nb, L: built.L, R: o.R };
    });
    if (!best) return;
    const nearEnd = Math.min(best.t, 1 - best.t) * best.L;
    if (nearEnd > best.R + s.R) {
      // already on the rebuilt tube's centerline: an ordinary T-joint, split later
      if (best.builtDist < 0.25 * s.R) return;
      pos[e.node] = best.Q; // T-joint on the other tube
    } else {
      const target = best.t < 0.5 ? best.na : best.nb;
      const old = e.node;
      for (const x of ends) if (x.node === old) x.node = target;
      count.set(target, (count.get(target) || 0) + 1);
      count.set(old, 0);
    }
    e.free = false;
    healed++;
  });
  return healed;
}

/**
 * Rebuild the frame graph from tube centerlines. Coped tubes stop short of
 * the tube they weld to, so each end is extended to where its centerline
 * meets a neighbor's; nearby joint estimates merge into one node, and a
 * joint that lands mid-span on another tube splits that tube.
 */
export function buildFrame(tubes, { jointTol = 0.5, bends = [] } = {}) {
  const segs = tubes.map((t) => {
    const d = [0, 1, 2].map((k) => t.b[k] - t.a[k]);
    const L = Math.hypot(...d);
    return { ...t, L, u: d.map((v) => v / L) };
  });
  const ends = [];
  segs.forEach((s, i) => {
    for (const e of [0, 1]) {
      const P = e ? s.b : s.a;
      // the runs of one bent tube already meet exactly at its virtual sharps
      if (e ? s.fixB : s.fixA) { ends.push({ seg: i, end: e, X: P, free: false }); continue; }
      const out = e ? s.u : s.u.map((v) => -v);
      const cands = [];
      segs.forEach((o, j) => {
        if (i === j || (s.bent && o.body === s.body)) return;
        const hit = lineLine(P, out, o.a, o.u);
        if (hit) {
          if (hit.gap > Math.max(jointTol, 0.6 * (s.R + o.R))) return;
          if (hit.s < -(o.R + jointTol) || hit.s > o.R + s.R + jointTol + 0.75) return;
          if (hit.t < -(s.R + jointTol + 0.75) || hit.t > o.L + s.R + jointTol + 0.75) return;
          cands.push({ X: hit.X.map((v, k) => (v + hit.Y[k]) / 2), s: hit.s });
        } else {
          // Collinear neighbors (one straight tube exported as two bodies).
          for (const Q of [o.a, o.b]) {
            const gap = Math.hypot(...[0, 1, 2].map((k) => Q[k] - P[k]));
            if (gap < s.R + o.R + jointTol) cands.push({ X: P.map((v, k) => (v + Q[k]) / 2), s: gap });
          }
        }
      });
      // a tube that runs into another tube's bend joins at that bend's virtual sharp
      for (const bd of bends) {
        if (bd.body === s.body) continue;
        const hit = rayToPolyline(P, out, bd.arc);
        if (!hit || hit.gap > Math.max(jointTol, 0.6 * (s.R + bd.R))) continue;
        if (hit.s < -(bd.R + jointTol) || hit.s > bd.R + s.R + jointTol + 0.75) continue;
        cands.push({ X: bd.V, s: hit.s, bend: true });
      }
      let X = P;
      if (cands.length) {
        const best = Math.min(...cands.map((c) => Math.abs(c.s)));
        let near = cands.filter((c) => Math.abs(c.s) <= best + 1.0);
        if (near.some((c) => c.bend)) near = near.filter((c) => c.bend);
        X = [0, 1, 2].map((k) => mean(near.map((c) => c.X[k])));
        // landed on a bent tube's centerline inside the bend: use the sharp
        const bd = bends.find((b) => b.body !== s.body && inBend(X, b, jointTol));
        if (bd) X = bd.V;
      }
      ends.push({ seg: i, end: e, X, free: !cands.length });
    }
  });
  // cluster joint estimates
  const tol = Math.max(0.5, jointTol);
  const parent = ends.map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) x = parent[x] = parent[parent[x]]; return x; };
  for (let i = 0; i < ends.length; i++) {
    for (let j = i + 1; j < ends.length; j++) {
      const a = ends[i].X, b = ends[j].X;
      if (Math.abs(a[0] - b[0]) < tol && Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < tol) parent[find(j)] = find(i);
    }
  }
  const nodeOf = new Map(), nodes = [];
  ends.forEach((e, i) => {
    const r = find(i);
    if (!nodeOf.has(r)) { nodeOf.set(r, nodes.length); nodes.push({ sum: [0, 0, 0], n: 0 }); }
    const nd = nodes[nodeOf.get(r)];
    e.X.forEach((v, k) => { nd.sum[k] += v; });
    nd.n++;
    e.node = nodeOf.get(r);
  });
  const pos = nodes.map((n) => n.sum.map((v) => v / n.n));
  const healed = healJoints(segs, ends, pos, jointTol);
  for (const p of pos) if (Math.abs(p[1]) < 0.05) p[1] = 0;
  // members, with mid-span joints splitting the tube they land on
  const members = [];
  const seen = new Set();
  let splits = 0;
  segs.forEach((s, i) => {
    const na = ends[i * 2].node, nb = ends[i * 2 + 1].node;
    if (na === nb) return;
    const A = pos[na], B = pos[nb];
    const d = [0, 1, 2].map((k) => B[k] - A[k]);
    const L2 = dot3(d, d);
    const along = [];
    pos.forEach((p, ni) => {
      if (ni === na || ni === nb) return;
      const t = dot3([0, 1, 2].map((k) => p[k] - A[k]), d) / L2;
      if (t <= 0.02 || t >= 0.98) return;
      const q = [0, 1, 2].map((k) => A[k] + d[k] * t);
      if (Math.hypot(...q.map((v, k) => v - p[k])) < s.R * 0.75 + jointTol * 0.5) along.push({ t, ni });
    });
    along.sort((x, y) => x.t - y.t);
    splits += along.length;
    const chain = [na, ...along.map((x) => x.ni), nb];
    for (let k = 0; k < chain.length - 1; k++) {
      const a = chain[k], b = chain[k + 1];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (a === b || seen.has(key)) continue;
      seen.add(key);
      members.push({ a, b, od: 2 * s.R, wall: s.r ? s.R - s.r : null, role: s.role || null, body: s.body });
    }
  });
  // drop joints nothing uses any more (merged away by healJoints)
  const used = new Set(members.flatMap((m) => [m.a, m.b]));
  const remap = new Map();
  const live = [];
  pos.forEach((p, i) => { if (used.has(i)) { remap.set(i, live.length); live.push(p); } });
  for (const m of members) { m.a = remap.get(m.a); m.b = remap.get(m.b); }
  const deg = new Map();
  for (const m of members) for (const n of [m.a, m.b]) deg.set(n, (deg.get(n) || 0) + 1);
  return { nodes: live, members, report: { joints: live.length, freeEnds: [...deg.values()].filter((d) => d === 1).length, splits, healed } };
}

// ------------------------------------------------------------------ full pipeline

/**
 * A short tube with coped ends can measure a few percent off (e.g. 1.280 in
 * for 1.250 in). Sizes within 3 % (OD) or 0.006 in (wall) of a size that at
 * least three other tubes share snap to it, so one odd fit doesn't become its
 * own tube profile.
 */
function snapToCommonSizes(tubes) {
  const tally = (vals) => {
    const m = new Map();
    for (const v of vals) if (v != null) { const k = +v.toFixed(3); m.set(k, (m.get(k) || 0) + 1); }
    return m;
  };
  const common = (m, v, near) => {
    let best = null;
    for (const [k, n] of m) if (n >= 3 && k !== +v.toFixed(3) && near(k) && (!best || n > best.n)) best = { k, n };
    return best && best.n >= 2 * (m.get(+v.toFixed(3)) || 0) ? best.k : null;
  };
  const ods = tally(tubes.map((t) => 2 * t.R));
  for (const t of tubes) {
    const od = 2 * t.R, wall = t.r ? t.R - t.r : null;
    const k = common(ods, od, (c) => Math.abs(c - od) <= 0.03 * c);
    if (k) { t.R = k / 2; if (wall != null) t.r = t.R - wall; }
  }
  const walls = tally(tubes.map((t) => (t.r ? t.R - t.r : null)));
  for (const t of tubes) {
    if (!t.r) continue;
    const wall = t.R - t.r;
    const k = common(walls, wall, (c) => Math.abs(c - wall) <= 0.006);
    if (k) t.r = t.R - k;
  }
}

/**
 * A body's bent-tube fit, mapped into app coordinates. The fit itself doesn't
 * depend on the import options, so it runs once per body in the file's own
 * units and axes and is cached on the raw body.
 */
function bentTubeOf(b, map, scale, body) {
  if (b.bentFit === undefined) b.bentFit = fitBentTube(b.positions);
  const f = b.bentFit;
  if (!f?.ok || f.nodes.length < 2) return null;
  const { R, r } = snapTubeSize(f.R * scale, f.r ? f.r * scale : null);
  if (!(R > 0.12 && R < 2.6) || f.length * scale < 3 * R) return null;
  const nodes = f.nodes.map(map);
  const segs = [];
  for (let k = 0; k + 1 < nodes.length; k++) {
    segs.push({ a: nodes[k], b: nodes[k + 1], R, r, body, bent: true, fixA: k > 0, fixB: k + 2 < nodes.length });
  }
  const bends = f.bends.map((bd) => ({ V: nodes[bd.at], arc: bd.arc.map(map), angle: bd.angle, clr: bd.clr ? bd.clr * scale : null, R, body }));
  return { segs, bends, R, r, length: f.length * scale };
}

/** Run the whole conversion for the current options (fast; re-run on every option change). */
export function analyzeImport(raw, opts) {
  const map = makeMapper(raw, opts);
  const s = UNIT_SCALE[opts.units] ?? 1;
  let tubes = [], other = [], bodies = [];
  const bends = [];
  let straight = 0, bent = 0, bentRuns = 0;
  if (raw.tubes) {
    tubes = raw.tubes.map((t, i) => ({
      a: map(t.a), b: map(t.b), body: i,
      R: (t.od ? t.od * s : 1.0) / 2,
      r: t.od && t.wall ? (t.od * s) / 2 - t.wall * s : null,
      role: t.role,
    }));
  } else {
    bodies = raw.bodies.map((b, i) => {
      const n = b.positions.length / 3;
      const out = new Float32Array(b.positions.length);
      const P = [];
      const step = Math.max(1, Math.floor(n / 6000));
      for (let k = 0; k < n; k++) {
        const q = map([b.positions[k * 3], b.positions[k * 3 + 1], b.positions[k * 3 + 2]]);
        out[k * 3] = q[0]; out[k * 3 + 1] = q[1]; out[k * 3 + 2] = q[2];
        if (k % step === 0) P.push(q);
      }
      const fit = fitTube(P);
      if (fit?.ok) {
        tubes.push({ ...fit, ...snapTubeSize(fit.R, fit.r), body: i });
        straight++;
        return { name: b.name, positions: out, tube: true, kind: 'straight', fit };
      }
      const bt = bentTubeOf(b, map, s, i);
      if (bt) {
        tubes.push(...bt.segs);
        bends.push(...bt.bends);
        // a straight tube whose odd ends defeated the simple fit still counts as straight
        if (!bt.bends.length) { straight++; return { name: b.name, positions: out, tube: true, kind: 'straight', bent: bt }; }
        bent++; bentRuns += bt.segs.length;
        return { name: b.name, positions: out, tube: true, kind: 'bent', bent: bt };
      }
      other.push(i);
      return { name: b.name, positions: out, tube: false, kind: 'other', fit };
    });
  }
  snapToCommonSizes(tubes);
  const frame = buildFrame(tubes, { jointTol: opts.jointTol, bends });
  const sizes = {};
  for (const m of frame.members) {
    const wall = m.wall ?? opts.defaultWall;
    const k = `${m.od.toFixed(3)} × ${wall.toFixed(3)}${m.wall == null ? ' (wall assumed)' : ''}`;
    sizes[k] = (sizes[k] || 0) + 1;
  }
  return {
    bodies, tubes, other, frame, sizes, bends,
    report: {
      bodies: raw.tubes ? raw.tubes.length : raw.bodies.length,
      tubes: raw.tubes ? tubes.length : straight + bent, other: other.length,
      bent, bentRuns, bends: bends.length,
      joints: frame.nodes.length, members: frame.members.length,
      freeEnds: frame.report.freeEnds, splits: frame.report.splits,
      wallAssumed: frame.members.filter((m) => m.wall == null).length,
      healed: frame.report.healed || 0,
    },
  };
}

/** Write the converted frame into the project (replacing or adding to the current frame). */
export function applyImport(state, result, opts, fileName) {
  const ch = state.chassis;
  if (opts.mode === 'replace') {
    ch.nodes = {}; ch.members = {}; ch.nodeLabels = {};
    state.seq.N = 0; state.seq.T = 0;
  }
  const profileFor = (od, wall) => {
    for (const [id, p] of Object.entries(ch.profiles)) if (Math.abs(p.od - od) < 0.006 && Math.abs(p.wall - wall) < 0.005) return id;
    const id = nextId(state, 'PF');
    ch.profiles[id] = { name: `${od.toFixed(3)} × ${wall.toFixed(3)} 4130 (imported)`, material: '4130', od: +od.toFixed(4), wall: +wall.toFixed(4) };
    return id;
  };
  const nodeIds = result.frame.nodes.map((p) => {
    const q = p.map((v) => +v.toFixed(4));
    const existing = opts.mode === 'replace' ? null : findNodeAt(state, q, 0.05);
    if (existing) return existing;
    const id = nextId(state, 'N');
    ch.nodes[id] = { p: q };
    return id;
  });
  const ROLES = new Set(['RRH', 'RHO', 'FBM', 'LFS', 'SIM', 'LC', 'USM', 'FAB', 'LDB', 'SUSP', 'SEC']);
  for (const m of result.frame.members) {
    const id = nextId(state, 'T');
    const role = m.role && ROLES.has(String(m.role).toUpperCase()) ? String(m.role).toUpperCase() : 'SEC';
    ch.members[id] = { a: nodeIds[m.a], b: nodeIds[m.b], profile: profileFor(m.od, m.wall ?? opts.defaultWall), role };
  }
  pairMirrors(state);
  state.workflow = { ...(state.workflow || {}), requireStressTest: true, unlocked: false };
  if (state.stress) state.stress.last = null;
  state.meta.importedFrom = fileName;
}

/** Link left/right twins so mirror editing works on imported frames. */
export function pairMirrors(state) {
  const nodes = Object.entries(state.chassis.nodes);
  for (const [id, n] of nodes) {
    if (Math.abs(n.p[1]) < 0.05 || n.pair) continue;
    const twin = nodes.find(([oid, o]) => oid !== id && Math.abs(o.p[0] - n.p[0]) < 0.12 && Math.abs(o.p[1] + n.p[1]) < 0.12 && Math.abs(o.p[2] - n.p[2]) < 0.12);
    if (twin) { n.pair = twin[0]; twin[1].pair = id; }
  }
  const mirrorOf = (nid) => state.chassis.nodes[nid]?.pair || nid;
  const members = Object.entries(state.chassis.members);
  for (const [id, m] of members) {
    if (m.pair) continue;
    const ma = mirrorOf(m.a), mb = mirrorOf(m.b);
    if ((ma === m.a && mb === m.b) || (ma === m.b && mb === m.a)) continue;
    const twin = members.find(([oid, o]) => oid !== id && ((o.a === ma && o.b === mb) || (o.a === mb && o.b === ma)));
    if (twin) { m.pair = twin[0]; twin[1].pair = id; }
  }
}

export { THREE };
