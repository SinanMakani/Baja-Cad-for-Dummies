// Bent-tube recognition for CAD import (used by cadImport.js).
//
// SolidWorks exports a bent tube (a weldment member drawn along a filleted
// sketch, or a swept tube) as one solid: straight runs joined by torus-shaped
// bends. This app models a frame as straight tubes between joints, so a bent
// tube becomes its straight runs meeting at each bend's virtual sharp: the
// point where the two straight centerlines intersect, i.e. the corner of the
// sketch before it was filleted.
//
// It works on a bare triangle soup (tessellated STEP, STL or OBJ) in any
// units, so every tolerance below is relative to the tube radius:
//  1. On a tube (cylinder or torus) every facet's normal line passes through
//     the centerline, so the normal lines of neighboring facets meet there:
//     one centerline point and one radius per facet.
//  2. Facets at the outer radius form one connected surface. Shortest paths
//     over it order their centerline points from one end of the tube to the
//     other; points are grouped into stations along the tube.
//  3. Where the tube direction doesn't turn between stations is a straight
//     run, fitted with a line. Consecutive lines meet at the virtual sharps;
//     the tube's ends come from the extreme facets of the first and last runs.

const DEG = Math.PI / 180;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const addS = (a, d, s) => [a[0] + d[0] * s, a[1] + d[1] * s, a[2] + d[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const distTo = (p, c, d) => { const w = sub(p, c); const s = dot(w, d); return Math.hypot(w[0] - d[0] * s, w[1] - d[1] * s, w[2] - d[2] * s); };
const median = (a) => { const s = Float64Array.from(a).sort(); return s.length ? s[s.length >> 1] : NaN; };

/**
 * Outer and inner wall radius from per-facet radii → { R, r | null }.
 * The walls show up as the two tallest peaks of an area-weighted histogram:
 * real CAD tessellations add scattered values (facets on coped ends or end
 * faces, near-parallel normals) that would drag a mean-based split, and thin
 * walls put the peaks only a few percent apart (1.0 × 0.035 in: 7 %).
 */
export function twoRadii(vals, wts = new Float64Array(vals.length).fill(1)) {
  const n = vals.length;
  if (n < 12) return { R: NaN, r: null };
  const order = Float64Array.from(vals.keys()).sort((i, j) => vals[i] - vals[j]);
  let W = 0;
  for (let i = 0; i < n; i++) W += wts[i];
  let acc = 0, med = vals[order[n >> 1]];
  for (const i of order) { acc += wts[i]; if (acc >= W / 2) { med = vals[i]; break; } }
  const lo = 0.5 * med, hi = 1.5 * med, NB = 250, bw = (hi - lo) / NB;
  const hist = new Float64Array(NB);
  let inBand = 0;
  for (let i = 0; i < n; i++) {
    const b = Math.floor((vals[i] - lo) / bw);
    if (b >= 0 && b < NB) { hist[b] += wts[i]; inBand += wts[i]; }
  }
  if (inBand < 0.5 * W) return { R: NaN, r: null };
  const sm = hist.map((_, b) => {
    let s = 0;
    for (let k = -2; k <= 2; k++) if (b + k >= 0 && b + k < NB) s += hist[b + k] * (3 - Math.abs(k));
    return s;
  });
  const peak = (b0) => { // weighted mean of the values within ±1.2 % of a bin
    const c = lo + (b0 + 0.5) * bw;
    let sw = 0, sv = 0;
    for (let i = 0; i < n; i++) if (Math.abs(vals[i] - c) <= 0.012 * c) { sw += wts[i]; sv += vals[i] * wts[i]; }
    return { at: sw ? sv / sw : c, w: sw };
  };
  let b1 = 0;
  for (let b = 1; b < NB; b++) if (sm[b] > sm[b1]) b1 = b;
  // second peak: at least 2.5 % away, with a real dip between the two
  let b2 = -1;
  for (let b = 0; b < NB; b++) {
    if (Math.abs(b - b1) * bw < 0.025 * med || (b2 >= 0 && sm[b] <= sm[b2])) continue;
    let dip = Infinity;
    for (let k = Math.min(b, b1); k <= Math.max(b, b1); k++) dip = Math.min(dip, sm[k]);
    if (dip < 0.6 * sm[b]) b2 = b;
  }
  const p1 = peak(b1);
  const p2 = b2 >= 0 ? peak(b2) : null;
  if (!p2 || p2.w < 0.08 * inBand) return { R: p1.at, r: null };
  const R = Math.max(p1.at, p2.at), r = Math.min(p1.at, p2.at);
  return { R, r: r > 0.3 * R ? r : null };
}

/** Closest points between infinite lines p+su and q+tv (u, v unit). */
function lineLine(p, u, q, v) {
  const w = sub(p, q);
  const b = dot(u, v), d = dot(u, w), e = dot(v, w);
  const den = 1 - b * b;
  if (den < 1e-9) return null;
  const s = (b * e - d) / den, t = (e - b * d) / den;
  const X = addS(p, u, s), Y = addS(q, v, t);
  return { s, t, X, Y, gap: len(sub(X, Y)) };
}

/** Principal direction of weighted points (power iteration), oriented along `hint`. */
function principal(pts, wts, hint) {
  let W = 0; const c = [0, 0, 0];
  pts.forEach((p, i) => { const w = wts[i]; W += w; c[0] += p[0] * w; c[1] += p[1] * w; c[2] += p[2] * w; });
  c[0] /= W; c[1] /= W; c[2] /= W;
  const C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  pts.forEach((p, i) => {
    const d = sub(p, c), w = wts[i];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a * 3 + b] += d[a] * d[b] * w;
  });
  let v = unit(hint);
  for (let it = 0; it < 60; it++) {
    const nv = [0, 1, 2].map((a) => C[a * 3] * v[0] + C[a * 3 + 1] * v[1] + C[a * 3 + 2] * v[2]);
    const l = len(nv);
    if (l < 1e-18) break;
    v = [nv[0] / l, nv[1] / l, nv[2] / l];
  }
  if (dot(v, hint) < 0) v = [-v[0], -v[1], -v[2]];
  return { c, d: v };
}

/** Radius of the circle through three points (null if they are collinear). */
function circumradius(a, b, c) {
  const ab = len(sub(b, a)), bc = len(sub(c, b)), ca = len(sub(a, c));
  const u = sub(b, a), v = sub(c, a);
  const cr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const area2 = len(cr);
  return area2 > 1e-12 ? (ab * bc * ca) / (2 * area2) : null;
}

/** Tiny binary min-heap of (key, value) pairs. */
class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length; k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v;
    const top = [k[0], v[0]];
    const lk = k.pop(), lv = v.pop();
    if (k.length) {
      let i = 0;
      for (;;) {
        let c = i * 2 + 1;
        if (c >= k.length) break;
        if (c + 1 < k.length && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

/**
 * Merge vertices closer than `tol` → { vid (per corner), count }. Faces of a
 * STEP solid are tessellated one by one, so the copies of a shared edge's
 * points differ by rounding; a plain rounded-coordinate key splits about a
 * third of them across grid cells. This checks the neighboring cells too.
 */
export function weldVertices(pos, tol) {
  const n = Math.floor(pos.length / 3);
  const inv = 1 / tol;
  const cells = new Map();
  const vid = new Int32Array(n);
  const P = [];
  let count = 0;
  const key = (x, y, z) => ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) | 0;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const cx = Math.floor(x * inv), cy = Math.floor(y * inv), cz = Math.floor(z * inv);
    let found = -1;
    for (let dx = -1; dx <= 1 && found < 0; dx++) {
      for (let dy = -1; dy <= 1 && found < 0; dy++) {
        for (let dz = -1; dz <= 1 && found < 0; dz++) {
          const list = cells.get(key(cx + dx, cy + dy, cz + dz));
          if (!list) continue;
          for (const v of list) {
            if (Math.abs(P[v * 3] - x) <= tol && Math.abs(P[v * 3 + 1] - y) <= tol && Math.abs(P[v * 3 + 2] - z) <= tol) { found = v; break; }
          }
        }
      }
    }
    if (found < 0) {
      found = count++;
      P.push(x, y, z);
      const k = key(cx, cy, cz);
      const list = cells.get(k);
      if (list) list.push(found); else cells.set(k, [found]);
    }
    vid[i] = found;
  }
  return { vid, count };
}

/**
 * Recognize a bent round tube in one body's triangles (CAD units and axes).
 * Returns null when the body is not a tube, otherwise
 * { ok, R, r, residual, nodes: [[x,y,z]…], bends: [{ at, angle, clr, arc }], why? }
 * where nodes runs end → virtual sharps → end and bends[].at indexes nodes.
 */
export function fitBentTube(pos, { maxFacets = 400000 } = {}) {
  const nT = Math.floor(pos.length / 9);
  if (nT < 24 || nT > maxFacets) return null;

  // ---- weld coincident vertices (faces are tessellated separately in STEP)
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < nT * 3; i++) {
    for (let k = 0; k < 3; k++) { const v = pos[i * 3 + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
  }
  const diag = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  if (!(diag > 0)) return null;
  const { vid, count: nV } = weldVertices(pos, diag * 2e-5);
  // vertex → facets (CSR)
  const start = new Int32Array(nV + 1);
  for (let i = 0; i < nT * 3; i++) start[vid[i] + 1]++;
  for (let v = 0; v < nV; v++) start[v + 1] += start[v];
  const fill = start.slice(0, nV);
  const vt = new Int32Array(nT * 3);
  for (let i = 0; i < nT * 3; i++) vt[fill[vid[i]]++] = (i / 3) | 0;

  // ---- facet unit normals and areas
  const Nn = new Float64Array(nT * 3), area = new Float64Array(nT);
  let totalArea = 0;
  for (let t = 0; t < nT; t++) {
    const o = t * 9;
    const ux = pos[o + 3] - pos[o], uy = pos[o + 4] - pos[o + 1], uz = pos[o + 5] - pos[o + 2];
    const wx = pos[o + 6] - pos[o], wy = pos[o + 7] - pos[o + 1], wz = pos[o + 8] - pos[o + 2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const l = Math.hypot(nx, ny, nz);
    if (l > 0) { nx /= l; ny /= l; nz /= l; }
    area[t] = l / 2; totalArea += l / 2;
    Nn[t * 3] = nx; Nn[t * 3 + 1] = ny; Nn[t * 3 + 2] = nz;
  }
  const minArea = totalArea * 1e-9;
  // ---- 1. centerline point + radius per facet from its corners' normal lines.
  // Corner normals are angle-weighted averages of the facets around the vertex
  // that lie within a crease angle (so tube walls don't blend with end caps);
  // on a cylinder or torus they point exactly at the centerline, unlike facet
  // normals through the centroids of long, thin CAD facets.
  const ang = new Float64Array(nT * 3);
  for (let t = 0; t < nT; t++) {
    for (let c = 0; c < 3; c++) {
      const o0 = t * 9 + c * 3, o1 = t * 9 + ((c + 1) % 3) * 3, o2 = t * 9 + ((c + 2) % 3) * 3;
      const ex = pos[o1] - pos[o0], ey = pos[o1 + 1] - pos[o0 + 1], ez = pos[o1 + 2] - pos[o0 + 2];
      const fx = pos[o2] - pos[o0], fy = pos[o2 + 1] - pos[o0 + 1], fz = pos[o2 + 2] - pos[o0 + 2];
      ang[t * 3 + c] = Math.atan2(Math.hypot(ey * fz - ez * fy, ez * fx - ex * fz, ex * fy - ey * fx), ex * fx + ey * fy + ez * fz);
    }
  }
  const COS_CREASE = Math.cos(50 * DEG);
  const CN = new Float64Array(nT * 9);
  for (let t = 0; t < nT; t++) {
    if (area[t] <= minArea) continue;
    const nx = Nn[t * 3], ny = Nn[t * 3 + 1], nz = Nn[t * 3 + 2];
    for (let c = 0; c < 3; c++) {
      const v = vid[t * 3 + c];
      let sx = 0, sy = 0, sz = 0;
      for (let j = start[v]; j < start[v + 1]; j++) {
        const u = vt[j];
        if (area[u] <= minArea || nx * Nn[u * 3] + ny * Nn[u * 3 + 1] + nz * Nn[u * 3 + 2] < COS_CREASE) continue;
        const cu = vid[u * 3] === v ? 0 : vid[u * 3 + 1] === v ? 1 : 2;
        const w = ang[u * 3 + cu];
        sx += Nn[u * 3] * w; sy += Nn[u * 3 + 1] * w; sz += Nn[u * 3 + 2] * w;
      }
      const l = Math.hypot(sx, sy, sz) || 1;
      CN[t * 9 + c * 3] = sx / l; CN[t * 9 + c * 3 + 1] = sy / l; CN[t * 9 + c * 3 + 2] = sz / l;
    }
  }
  // A pair of corners sees the tube's cross-section circle. On a cylinder or a
  // torus both corner normals are square to the local tube direction (their
  // cross product), so inside that cross-section plane the two normal lines
  // meet on the centerline, for an edge around the tube or along an oblique
  // miter cut alike. Along a bend the lines meet on the bend's axis instead,
  // farther away, so the tightest circle wins.
  const COS_HI = Math.cos(1.5 * DEG), COS_LO = Math.cos(65 * DEG);
  const a = new Float64Array(nT).fill(NaN); // signed distance along the normal to the centerline
  const CL = new Float64Array(nT * 3); // centerline point
  const AX = new Float64Array(nT * 3); // local tube direction (sign arbitrary)
  const PAIRS = [[0, 1], [1, 2], [2, 0]];
  for (let t = 0; t < nT; t++) {
    if (area[t] <= minArea) continue;
    let bs = NaN, bx = 0, by = 0, bz = 0, tx = 0, ty = 0, tz = 0;
    for (const [i, j] of PAIRS) {
      const oi = t * 9 + i * 3, oj = t * 9 + j * 3;
      const nix = CN[oi], niy = CN[oi + 1], niz = CN[oi + 2], njx = CN[oj], njy = CN[oj + 1], njz = CN[oj + 2];
      const c = nix * njx + niy * njy + niz * njz;
      if (c > COS_HI || c < COS_LO) continue;
      let ax = niy * njz - niz * njy, ay = niz * njx - nix * njz, az = nix * njy - niy * njx;
      const al = Math.hypot(ax, ay, az);
      ax /= al; ay /= al; az /= al;
      // normals and edge projected into the cross-section plane
      const pi = nix * ax + niy * ay + niz * az, pj = njx * ax + njy * ay + njz * az;
      let uix = nix - ax * pi, uiy = niy - ay * pi, uiz = niz - az * pi;
      let ujx = njx - ax * pj, ujy = njy - ay * pj, ujz = njz - az * pj;
      const li = Math.hypot(uix, uiy, uiz), lj = Math.hypot(ujx, ujy, ujz);
      uix /= li; uiy /= li; uiz /= li; ujx /= lj; ujy /= lj; ujz /= lj;
      let wx = pos[oi] - pos[oj], wy = pos[oi + 1] - pos[oj + 1], wz = pos[oi + 2] - pos[oj + 2];
      const wa = wx * ax + wy * ay + wz * az;
      wx -= ax * wa; wy -= ay * wa; wz -= az * wa;
      // An edge running far along the tube for little way around it (a long
      // CAD facet's diagonal) is ill-conditioned: a fraction of a degree of
      // error in the tube direction swamps its short sideways chord. Edges
      // around the tube, and along a miter cut (≤ tan 60° for bends up to
      // 120°), stay well within this.
      if (Math.abs(wa) > 2.5 * Math.hypot(wx, wy, wz)) continue;
      const c2 = uix * ujx + uiy * ujy + uiz * ujz;
      const den = 1 - c2 * c2;
      if (den < 1e-6) continue;
      const d = uix * wx + uiy * wy + uiz * wz, e = ujx * wx + ujy * wy + ujz * wz;
      const s1 = (c2 * e - d) / den, s2 = (e - c2 * d) / den;
      if (Math.abs(s1 - s2) > 0.1 * Math.max(Math.abs(s1), Math.abs(s2)) || Math.abs(s1) > diag) continue;
      const sm = (s1 + s2) / 2;
      if (!Number.isNaN(bs) && Math.abs(sm) >= Math.abs(bs)) continue;
      bs = sm; tx = ax; ty = ay; tz = az;
      bx = (pos[oi] + uix * s1 + pos[oj] + ujx * s2) / 2;
      by = (pos[oi + 1] + uiy * s1 + pos[oj + 1] + ujy * s2) / 2;
      bz = (pos[oi + 2] + uiz * s1 + pos[oj + 2] + ujz * s2) / 2;
    }
    if (Number.isNaN(bs)) continue;
    a[t] = bs;
    CL[t * 3] = bx; CL[t * 3 + 1] = by; CL[t * 3 + 2] = bz;
    AX[t * 3] = tx; AX[t * 3 + 1] = ty; AX[t * 3 + 2] = tz;
  }
  const rhos = [], rw = [];
  for (let t = 0; t < nT; t++) if (!Number.isNaN(a[t])) { rhos.push(Math.abs(a[t])); rw.push(area[t]); }
  if (rhos.length < 12) return null;
  const { R: Rs, r: rs } = twoRadii(rhos, rw);
  if (!(Rs > diag * 1e-4)) return null;

  // classify: 1 = outer surface, 2 = inner surface
  const kind = new Uint8Array(nT);
  const split = rs ? (Rs + rs) / 2 : 0;
  let aOuter = 0, aInner = 0;
  for (let t = 0; t < nT; t++) {
    if (Number.isNaN(a[t])) continue;
    const p = Math.abs(a[t]);
    if (p >= Math.max(split, Rs * 0.88) && p <= Rs * 1.12) { kind[t] = 1; aOuter += area[t]; }
    else if (rs && p < split && p >= rs * 0.88) { kind[t] = 2; aInner += area[t]; }
  }
  if (aOuter < 0.3 * totalArea || aOuter + aInner < 0.7 * totalArea) return null;

  // ---- 2. stations: the outer wall's centerline points clustered in space
  // (single linkage, 0.3 radii), then ordered along the tube through the
  // stations' adjacency on the surface.
  const outer = [];
  for (let t = 0; t < nT; t++) if (kind[t] === 1) outer.push(t);
  const d0 = 0.3 * Rs, inv = 1 / d0;
  const up = new Int32Array(outer.length).map((_, i) => i);
  const find = (x) => { while (up[x] !== x) x = up[x] = up[up[x]]; return x; };
  const cells = new Map();
  const ckey = (x, y, z) => ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) | 0;
  outer.forEach((t, i) => {
    const x = CL[t * 3], y = CL[t * 3 + 1], z = CL[t * 3 + 2];
    const cx = Math.floor(x * inv), cy = Math.floor(y * inv), cz = Math.floor(z * inv);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const list = cells.get(ckey(cx + dx, cy + dy, cz + dz));
      if (!list) continue;
      for (const j of list) {
        const u = outer[j];
        if (Math.abs(CL[u * 3] - x) <= d0 && Math.abs(CL[u * 3 + 1] - y) <= d0 && Math.abs(CL[u * 3 + 2] - z) <= d0
          && Math.hypot(CL[u * 3] - x, CL[u * 3 + 1] - y, CL[u * 3 + 2] - z) <= d0) up[find(i)] = find(j);
      }
    }
    const k = ckey(cx, cy, cz);
    const list = cells.get(k);
    if (list) list.push(i); else cells.set(k, [i]);
  });
  const stOf = new Int32Array(nT).fill(-1);
  const groups = new Map();
  outer.forEach((t, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, groups.size);
    stOf[t] = groups.get(r);
  });
  const all = Array.from({ length: groups.size }, () => ({ tris: [], w: 0, p: [0, 0, 0] }));
  for (const t of outer) {
    const st = all[stOf[t]], w = area[t];
    st.tris.push(t); st.w += w;
    st.p[0] += CL[t * 3] * w; st.p[1] += CL[t * 3 + 1] * w; st.p[2] += CL[t * 3 + 2] * w;
  }
  for (const st of all) st.p = st.p.map((v) => v / st.w);
  // each cluster's tube direction (facet directions have arbitrary sign)
  for (const st of all) {
    const t0 = st.tris[0];
    const r0 = [AX[t0 * 3], AX[t0 * 3 + 1], AX[t0 * 3 + 2]];
    const acc = [0, 0, 0];
    for (const t of st.tris) {
      const w = area[t] * Math.sign(AX[t * 3] * r0[0] + AX[t * 3 + 1] * r0[1] + AX[t * 3 + 2] * r0[2] || 1);
      acc[0] += AX[t * 3] * w; acc[1] += AX[t * 3 + 1] * w; acc[2] += AX[t * 3 + 2] * w;
    }
    st.dir = unit(acc);
  }
  // Clusters of a facet or two (cut-end and cope noise) would let the path
  // end on them instead of on the tube's real end; leave them out.
  const ws = all.map((st) => st.w).sort((x, y) => x - y);
  const minW = 0.05 * ws[ws.length >> 1];
  all.forEach((st, k) => { if (st.w < minW) { st.stray = true; for (const t of st.tris) stOf[t] = -1; } });
  // Two stations are neighbors when facets of both share an edge. (Sharing a
  // single vertex is too loose with long CAD facets: a straight's facets all
  // meet at its end rings, which would link clusters two straights apart.) A
  // facet with no centerline estimate passes adjacency through to its own
  // edge neighbors, so walls it covers still link up.
  const edgeMap = new Map();
  const ekey = (u, v) => (u < v ? u * nV + v : v * nV + u);
  for (let t = 0; t < nT; t++) {
    for (let c = 0; c < 3; c++) {
      const k = ekey(vid[t * 3 + c], vid[t * 3 + ((c + 1) % 3)]);
      const list = edgeMap.get(k);
      if (list) list.push(t); else edgeMap.set(k, [t]);
    }
  }
  const nbr = all.map(() => new Set());
  const link = (x, y) => { if (x >= 0 && y >= 0 && x !== y) { nbr[x].add(y); nbr[y].add(x); } };
  for (const list of edgeMap.values()) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) link(stOf[list[i]], stOf[list[j]]);
  }
  const touch = new Set();
  for (let t = 0; t < nT; t++) {
    if (stOf[t] >= 0) continue;
    touch.clear();
    for (let c = 0; c < 3; c++) {
      for (const u of edgeMap.get(ekey(vid[t * 3 + c], vid[t * 3 + ((c + 1) % 3)]))) if (stOf[u] >= 0) touch.add(stOf[u]);
    }
    const arr = [...touch];
    for (let x = 0; x < arr.length; x++) for (let y = x + 1; y < arr.length; y++) link(arr[x], arr[y]);
  }
  // End-to-end path: double sweep over squared hop lengths, which keeps the
  // path on short hops between consecutive stations. A hop that doesn't follow
  // the tube direction at both ends (cutting across a mitered corner along a
  // long CAD facet) costs up to five times more.
  const sweep = (src) => {
    const dist = new Float64Array(all.length).fill(Infinity), prev = new Int32Array(all.length).fill(-1);
    dist[src] = 0;
    const heap = new Heap();
    heap.push(0, src);
    let far = src;
    while (heap.size) {
      const [dd, k] = heap.pop();
      if (dd > dist[k]) continue;
      if (dd > dist[far]) far = k;
      for (const m of nbr[k]) {
        const h = sub(all[m].p, all[k].p);
        const q2 = dot(h, h);
        const hl = Math.sqrt(q2) || 1;
        const align = Math.min(Math.abs(dot(h, all[k].dir)), Math.abs(dot(h, all[m].dir))) / hl;
        const cost = q2 * (1 + 4 * (1 - align));
        if (dd + cost < dist[m]) { dist[m] = dd + cost; prev[m] = k; heap.push(dd + cost, m); }
      }
    }
    return { far, prev, dist };
  };
  let heaviest = all.findIndex((st) => !st.stray);
  all.forEach((st, k) => { if (!st.stray && st.w > all[heaviest].w) heaviest = k; });
  const endA = sweep(heaviest).far;
  const { far: endB, prev } = sweep(endA);
  const path = [];
  for (let k = endB; k >= 0; k = prev[k]) path.push(k);
  path.reverse();
  // A closed ring, a branch or several tubes in one body leave much of the wall
  // off the path and far from it. (Clusters just beside the path are fine: at a
  // miter each straight's centerline points run on past the corner.)
  const onPath = new Set(path);
  let offW = 0, allW = 0;
  all.forEach((st, k) => {
    if (st.stray) return;
    allW += st.w;
    if (onPath.has(k)) return;
    const near = path.some((j) => len(sub(all[j].p, st.p)) <= 2.5 * Rs);
    if (!near) offW += st.w;
  });
  if (path.length < 2 || offW > 0.25 * allW) return { ok: false, why: 'not a single tube' };
  const stations = path.map((k) => all[k]);
  stations.forEach((st, k) => { st.tau = k ? stations[k - 1].tau + len(sub(st.p, stations[k - 1].p)) : 0; });
  const nS = stations.length;
  const S = stations.map((st) => st.p);

  // ---- 3. straight runs. Each station's tube direction comes from its facets'
  // corner normals; along a straight the direction doesn't change however far
  // apart two stations are, along a bend it turns by 1/CLR per unit length.
  const T = stations.map((st, k) => {
    const ref = sub(S[Math.min(nS - 1, k + 1)], S[Math.max(0, k - 1)]);
    let x = 0, y = 0, z = 0;
    for (const t of st.tris) {
      const w = area[t] * Math.sign(AX[t * 3] * ref[0] + AX[t * 3 + 1] * ref[1] + AX[t * 3 + 2] * ref[2] || 1);
      x += AX[t * 3] * w; y += AX[t * 3 + 1] * w; z += AX[t * 3 + 2] * w;
    }
    return unit([x, y, z]);
  });
  const kMax = 1 / (25 * Rs); // curvature below this counts as straight (CLR > 25 radii)
  const straightChord = [];
  for (let k = 0; k + 1 < nS; k++) {
    const l = len(sub(S[k + 1], S[k]));
    const turn = Math.acos(Math.min(1, Math.abs(dot(T[k], T[k + 1]))));
    straightChord.push(l > 1e-9 && turn / l < kMax);
  }
  let runs = [];
  for (let k = 0; k + 1 < nS;) {
    if (!straightChord[k]) { k++; continue; }
    let j = k;
    while (j + 1 < nS - 1 && straightChord[j + 1]) j++;
    runs.push([k, j + 1]);
    k = j + 1;
  }
  // a run must be one line; split runs that still kink (mitered corners, long sweeps)
  const eps = 0.06 * Rs;
  const rdp = (i0, i1, out) => {
    const d = unit(sub(S[i1], S[i0]));
    let worst = -1, wd = 0;
    for (let i = i0 + 1; i < i1; i++) { const dv = distTo(S[i], S[i0], d); if (dv > wd) { wd = dv; worst = i; } }
    if (wd > eps) { rdp(i0, worst, out); rdp(worst, i1, out); } else out.push([i0, i1]);
  };
  runs = runs.flatMap(([i0, i1]) => { const out = []; rdp(i0, i1, out); return out; })
    .filter(([i0, i1]) => len(sub(S[i1], S[i0])) >= Rs);
  if (!runs.length) return arcOnly();

  // An elbow with no straight at all: follow its centerline with chords, and
  // carry the end chords out to the tube's end faces.
  function arcOnly() {
    if (nS < 3) return { ok: false, why: 'no straight runs' };
    const keep = [0];
    const chord = (i0, i1) => {
      const d = unit(sub(S[i1], S[i0]));
      let worst = -1, wd = 0;
      for (let i = i0 + 1; i < i1; i++) { const dv = distTo(S[i], S[i0], d); if (dv > wd) { wd = dv; worst = i; } }
      if (wd > 0.25 * Rs) { chord(i0, worst); chord(worst, i1); } else keep.push(i1);
    };
    chord(0, nS - 1);
    const pts = keep.map((i) => S[i].slice());
    const reach = (k0, k1, from, dir) => {
      let ext = 0;
      for (let k = k0; k <= k1; k++) {
        for (const t of stations[k].tris) {
          for (let c = 0; c < 3; c++) { const o = t * 9 + c * 3; ext = Math.max(ext, dot(sub([pos[o], pos[o + 1], pos[o + 2]], from), dir)); }
        }
      }
      return addS(from, dir, ext);
    };
    pts[0] = reach(0, Math.min(1, nS - 1), S[0], unit(sub(S[0], S[Math.min(1, nS - 1)])));
    pts[pts.length - 1] = reach(Math.max(0, nS - 2), nS - 1, S[nS - 1], unit(sub(S[nS - 1], S[Math.max(0, nS - 2)])));
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += len(sub(pts[i], pts[i - 1]));
    const turn = Math.acos(Math.min(1, Math.max(-1, dot(unit(sub(S[1], S[0])), unit(sub(S[nS - 1], S[nS - 2]))))));
    return {
      ok: pts.length >= 2 && total > 2 * Rs, R: Rs, r: rs, residual: 0, nodes: pts, length: total, arcOnly: true,
      bends: [{ at: Math.max(1, pts.length >> 1), angle: turn / DEG, clr: circumradius(S[0], S[nS >> 1], S[nS - 1]), arc: S.slice(), chords: pts.length - 1 }],
    };
  }

  const lines = runs.map(([i0, i1]) => {
    const idx = []; for (let k = i0; k <= i1; k++) idx.push(k);
    const { c, d } = principal(idx.map((k) => S[k]), idx.map((k) => stations[k].w), sub(S[i1], S[i0]));
    return { i0, i1, c, d };
  });

  // facet vertices near a run's line: radius samples and the run's extent
  const corner = (t, k) => { const o = t * 9 + k * 3; return [pos[o], pos[o + 1], pos[o + 2]]; };
  const dOut = [];
  for (const L of lines) {
    L.lo = dot(sub(S[L.i0], L.c), L.d) - 0.02 * Rs;
    L.hi = dot(sub(S[L.i1], L.c), L.d) + 0.02 * Rs;
    for (let k = L.i0; k <= L.i1; k++) {
      for (const t of stations[k].tris) {
        // only facets running along this straight (not the next leg of a miter)
        if (Math.abs(AX[t * 3] * L.d[0] + AX[t * 3 + 1] * L.d[1] + AX[t * 3 + 2] * L.d[2]) < Math.cos(6 * DEG)) continue;
        for (let c = 0; c < 3; c++) {
          const P = corner(t, c), w = sub(P, L.c), s = dot(w, L.d);
          if (s < L.lo || s > L.hi) continue;
          const perp = Math.hypot(w[0] - L.d[0] * s, w[1] - L.d[1] * s, w[2] - L.d[2] * s);
          if (perp <= 1.4 * Rs) dOut.push(perp);
        }
      }
    }
  }
  const dIn = [];
  if (rs) {
    for (let t = 0; t < nT; t++) {
      if (kind[t] !== 2) continue;
      const cp = [CL[t * 3], CL[t * 3 + 1], CL[t * 3 + 2]];
      for (const L of lines) {
        const s = dot(sub(cp, L.c), L.d);
        if (s < L.lo || s > L.hi || distTo(cp, L.c, L.d) > 0.25 * Rs) continue;
        for (let c = 0; c < 3; c++) {
          const P = corner(t, c), sp = dot(sub(P, L.c), L.d);
          if (sp >= L.lo && sp <= L.hi) dIn.push(distTo(P, L.c, L.d));
        }
        break;
      }
    }
  }
  if (dOut.length < 6) return { ok: false, why: 'no straight runs' };
  const R = median(dOut);
  const r = dIn.length >= 6 ? median(dIn) : null;
  const devs = Float64Array.from(dOut, (v) => Math.abs(v - R)).sort();
  const residual = devs[Math.floor(devs.length * 0.9)] / R;

  // tube ends: extreme facet vertices of the first / last run, along its line
  const endPoint = (L, k0, k1, sign) => {
    let ext = sign < 0 ? Infinity : -Infinity;
    for (let k = k0; k <= k1; k++) {
      for (const t of stations[k].tris) {
        for (let c = 0; c < 3; c++) {
          const w = sub(corner(t, c), L.c), s = dot(w, L.d);
          if (Math.hypot(w[0] - L.d[0] * s, w[1] - L.d[1] * s, w[2] - L.d[2] * s) > 1.4 * Rs) continue;
          ext = sign < 0 ? Math.min(ext, s) : Math.max(ext, s);
        }
      }
    }
    return addS(L.c, L.d, Number.isFinite(ext) ? ext : 0);
  };

  // ---- nodes: start, virtual sharps (or chords for odd bends), end
  const nodes = [endPoint(lines[0], 0, lines[0].i1, -1)];
  const bends = [];
  const project = (P, L) => addS(L.c, L.d, dot(sub(P, L.c), L.d));
  const angleOf = (u, v) => Math.acos(Math.min(1, Math.max(-1, dot(u, v))));
  // virtual sharp of two lines, if they really meet past the end of A and before the start of B
  const sharp = (A, B, endA, startB, arcLen, mid) => {
    const hit = lineLine(A.c, A.d, B.c, B.d);
    if (!hit || hit.gap > Math.max(0.3 * Rs, 0.02 * arcLen)) return null;
    const X = hit.X.map((v, k) => (v + hit.Y[k]) / 2);
    if (dot(sub(X, endA), A.d) < -Rs || dot(sub(X, startB), B.d) > Rs) return null;
    return len(sub(X, mid)) <= 3 * arcLen + 4 * Rs ? { X, gap: hit.gap } : null;
  };
  for (let j = 0; j + 1 < lines.length; j++) {
    const A = lines[j], B = lines[j + 1];
    const angle = angleOf(A.d, B.d);
    if (angle < 0.5 * DEG && distTo(B.c, A.c, A.d) < 0.1 * Rs) continue; // one straight run
    const between = [];
    for (let k = A.i1 + 1; k < B.i0; k++) between.push(S[k]);
    const arcStart = project(S[A.i1], A), arcEnd = project(S[B.i0], B);
    const arc = [arcStart, ...between, arcEnd];
    const arcLen = Math.max(stations[B.i0].tau - stations[A.i1].tau, len(sub(arcEnd, arcStart)));
    const mid = arc[arc.length >> 1];
    const clr = between.length >= 1 ? circumradius(arcStart, mid, arcEnd) : null;
    const V = angle >= 0.5 * DEG ? sharp(A, B, S[A.i1], S[B.i0], arcLen, mid) : null;
    if (V) {
      nodes.push(V.X);
      bends.push({ at: nodes.length - 1, angle: angle / DEG, clr, arc });
      continue;
    }
    // Two bends close together (U-bends, jogs, bends in two planes): two sharps
    // joined by a middle line. Candidates are the short straight between the
    // bends (any chord of the bend region) and the tube direction halfway round
    // the turn; the middle line must meet both straights.
    if (B.i0 - A.i1 >= 2) {
      let acc = 0;
      const turns = [0];
      for (let k = A.i1; k < B.i0; k++) { acc += angleOf(T[k], dot(T[k], T[k + 1]) < 0 ? T[k + 1].map((v) => -v) : T[k + 1]); turns.push(acc); }
      const cands = [];
      for (let k = A.i1 + 1; k < B.i0 - 1; k++) {
        const l = Math.max(len(sub(S[k + 1], S[k])), 1e-12);
        cands.push({ c: S[k].map((v, i) => (v + S[k + 1][i]) / 2), d: unit(sub(S[k + 1], S[k])), rate: (turns[k + 1 - A.i1] - turns[k - A.i1]) / l });
      }
      let km = A.i1 + 1;
      for (let k = A.i1 + 1; k < B.i0; k++) if (Math.abs(turns[k - A.i1] - acc / 2) < Math.abs(turns[km - A.i1] - acc / 2)) km = k;
      const dir = sub(S[km + 1], S[km - 1]);
      cands.push({ c: S[km], d: dot(T[km], dir) < 0 ? T[km].map((v) => -v) : T[km], half: true });
      const fits = [];
      for (const M of cands) {
        const V1 = sharp(A, M, S[A.i1], M.c, arcLen, mid), V2 = V1 && sharp(M, B, M.c, S[B.i0], arcLen, mid);
        if (V1 && V2 && dot(sub(V2.X, V1.X), M.d) > 0) fits.push({ M, V1: V1.X, V2: V2.X, gap: V1.gap + V2.gap });
      }
      if (fits.length) {
        const g0 = Math.min(...fits.map((f) => f.gap));
        const tied = fits.filter((f) => f.gap <= g0 + 0.05 * Rs);
        // in a plane every line meets: take a clearly flat chord, else the halfway direction
        const flat = tied.filter((f) => !f.M.half).sort((x, y) => x.M.rate - y.M.rate)[0];
        const pick = tied.length === 1 ? tied[0]
          : flat && flat.M.rate < 0.5 * (acc / arcLen) ? flat
            : tied.find((f) => f.M.half) || tied[0];
        nodes.push(pick.V1);
        bends.push({ at: nodes.length - 1, angle: angleOf(A.d, pick.M.d) / DEG, clr, arc });
        nodes.push(pick.V2);
        bends.push({ at: nodes.length - 1, angle: angleOf(pick.M.d, B.d) / DEG, clr, arc });
        continue;
      }
    }
    // anything else (compound bends): follow the centerline with chords
    const keep = [0];
    const chord = (i0, i1) => {
      const d = unit(sub(arc[i1], arc[i0]));
      let worst = -1, wd = 0;
      for (let i = i0 + 1; i < i1; i++) { const dv = distTo(arc[i], arc[i0], d); if (dv > wd) { wd = dv; worst = i; } }
      if (wd > 0.25 * Rs) { chord(i0, worst); chord(worst, i1); } else keep.push(i1);
    };
    chord(0, arc.length - 1);
    for (const i of keep) nodes.push(arc[i]);
    bends.push({ at: nodes.length - 1, angle: angle / DEG, clr, arc, chords: keep.length - 1 });
  }
  const last = lines.at(-1);
  nodes.push(endPoint(last, last.i0, nS - 1, +1));

  // drop coincident nodes (chord ends that landed on a sharp)
  const clean = [nodes[0]];
  const remap = [0];
  for (let i = 1; i < nodes.length; i++) {
    if (len(sub(nodes[i], clean.at(-1))) < 0.05 * Rs) { remap.push(clean.length - 1); continue; }
    remap.push(clean.length);
    clean.push(nodes[i]);
  }
  for (const b of bends) b.at = remap[b.at];
  let total = 0;
  for (let i = 1; i < clean.length; i++) total += len(sub(clean[i], clean[i - 1]));
  return {
    ok: clean.length >= 2 && clean.length <= 30 && residual < 0.06 && total > 3 * R,
    R, r: r && r < R * 0.995 ? r : null, residual, nodes: clean, bends, length: total,
  };
}
