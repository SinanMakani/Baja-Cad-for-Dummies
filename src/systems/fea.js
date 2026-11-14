// Linear static analysis of a welded tube frame.
//
// Each tube is a 3D Euler–Bernoulli beam element (6 DOF per node: 3
// translations + 3 rotations), joints are rigid (welded), sections are round
// tubes from the member's profile. Units: inches, lbf, psi.
//
// The global stiffness matrix is assembled in a reverse Cuthill–McKee node
// order and factored with an envelope (skyline) Cholesky, so frames with a
// few hundred joints still solve in a fraction of a second.
import { profileProps } from '../catalog/materials.js';

const POISSON = 0.29;

/**
 * Build the analysis model from the chassis. `splits` adds extra nodes inside
 * members (e.g. the middle of a side-impact tube): [{ key, member, t }].
 */
export function buildModel(state, splits = []) {
  const keyIndex = new Map();
  const pos = [];
  const keys = [];
  const addNode = (key, p) => {
    if (!keyIndex.has(key)) { keyIndex.set(key, pos.length); pos.push(p); keys.push(key); }
    return keyIndex.get(key);
  };
  const byMember = new Map();
  for (const s of splits) {
    if (!byMember.has(s.member)) byMember.set(s.member, []);
    byMember.get(s.member).push(s);
  }
  const fallbackProfile = Object.values(state.chassis.profiles)[0];
  const elems = [];
  const memberLength = {};
  for (const [id, m] of Object.entries(state.chassis.members)) {
    const na = state.chassis.nodes[m.a], nb = state.chassis.nodes[m.b];
    if (!na || !nb) continue;
    const L = Math.hypot(nb.p[0] - na.p[0], nb.p[1] - na.p[1], nb.p[2] - na.p[2]);
    if (L < 1e-3) continue;
    memberLength[id] = L;
    const prof = state.chassis.profiles[m.profile] || fallbackProfile;
    const pr = profileProps(prof);
    const sec = {
      A: pr.A, I: pr.I, J: pr.J, S: pr.S, c: prof.od / 2,
      E: pr.mat.E, G: pr.mat.E / (2 * (1 + POISSON)), Sy: pr.mat.Sy,
    };
    const lerp = (t) => [0, 1, 2].map((k) => na.p[k] + (nb.p[k] - na.p[k]) * t);
    const pts = [
      { t: 0, key: m.a, p: na.p },
      ...(byMember.get(id) || []).filter((s) => s.t > 1e-3 && s.t < 1 - 1e-3).sort((x, y) => x.t - y.t).map((s) => ({ t: s.t, key: s.key, p: lerp(s.t) })),
      { t: 1, key: m.b, p: nb.p },
    ];
    for (let k = 0; k < pts.length - 1; k++) {
      elems.push({ member: id, i: addNode(pts[k].key, pts[k].p), j: addNode(pts[k + 1].key, pts[k + 1].p), ...sec });
    }
  }
  for (const e of elems) prepareElement(e, pos);
  return { pos, keys, keyIndex, elems, memberLength };
}

function prepareElement(e, pos) {
  const a = pos[e.i], b = pos[e.j];
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const L = Math.hypot(d[0], d[1], d[2]);
  const ex = d.map((v) => v / L);
  // Any perpendicular pair works for a round tube (Iy = Iz).
  const ref = Math.abs(ex[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  let ey = [ref[1] * ex[2] - ref[2] * ex[1], ref[2] * ex[0] - ref[0] * ex[2], ref[0] * ex[1] - ref[1] * ex[0]];
  const n = Math.hypot(...ey);
  ey = ey.map((v) => v / n);
  const ez = [ex[1] * ey[2] - ex[2] * ey[1], ex[2] * ey[0] - ex[0] * ey[2], ex[0] * ey[1] - ex[1] * ey[0]];
  e.L = L;
  e.R = [ex, ey, ez];
  e.kl = localStiffness(e.E, e.G, e.A, e.I, e.J, L);
  e.kg = globalStiffness(e.kl, e.R);
}

function localStiffness(E, G, A, I, J, L) {
  const k = new Float64Array(144);
  const s = (r, c, v) => { k[r * 12 + c] = v; k[c * 12 + r] = v; };
  const EA = (E * A) / L, GJ = (G * J) / L;
  const a = (12 * E * I) / L ** 3, b = (6 * E * I) / L ** 2, c = (4 * E * I) / L, d = (2 * E * I) / L;
  s(0, 0, EA); s(0, 6, -EA); s(6, 6, EA);
  s(3, 3, GJ); s(3, 9, -GJ); s(9, 9, GJ);
  // bending in the local x-y plane (uy, θz)
  s(1, 1, a); s(1, 5, b); s(1, 7, -a); s(1, 11, b);
  s(5, 5, c); s(5, 7, -b); s(5, 11, d);
  s(7, 7, a); s(7, 11, -b); s(11, 11, c);
  // bending in the local x-z plane (uz, θy)
  s(2, 2, a); s(2, 4, -b); s(2, 8, -a); s(2, 10, -b);
  s(4, 4, c); s(4, 8, b); s(4, 10, d);
  s(8, 8, a); s(8, 10, b); s(10, 10, c);
  return k;
}

/** k_global = Tᵀ k_local T with T = blockdiag(R, R, R, R). */
function globalStiffness(kl, R) {
  const kg = new Float64Array(144);
  for (let bi = 0; bi < 4; bi++) {
    for (let bj = 0; bj < 4; bj++) {
      for (let p = 0; p < 3; p++) {
        for (let q = 0; q < 3; q++) {
          let sum = 0;
          for (let r = 0; r < 3; r++) {
            const Rrp = R[r][p];
            if (Rrp === 0) continue;
            for (let s = 0; s < 3; s++) sum += Rrp * kl[(bi * 3 + r) * 12 + bj * 3 + s] * R[s][q];
          }
          kg[(bi * 3 + p) * 12 + bj * 3 + q] = sum;
        }
      }
    }
  }
  return kg;
}

/** Reverse Cuthill–McKee ordering of the model's nodes (keeps the matrix banded). */
function rcmOrder(nNodes, elems) {
  const adj = Array.from({ length: nNodes }, () => new Set());
  for (const e of elems) { adj[e.i].add(e.j); adj[e.j].add(e.i); }
  const deg = adj.map((s) => s.size);
  const order = [];
  const seen = new Uint8Array(nNodes);
  const starts = [...Array(nNodes).keys()].sort((a, b) => deg[a] - deg[b]);
  for (const s of starts) {
    if (seen[s]) continue;
    seen[s] = 1;
    const queue = [s];
    while (queue.length) {
      const v = queue.shift();
      order.push(v);
      for (const w of [...adj[v]].sort((a, b) => deg[a] - deg[b])) if (!seen[w]) { seen[w] = 1; queue.push(w); }
    }
  }
  order.reverse();
  const rank = new Int32Array(nNodes);
  order.forEach((node, i) => { rank[node] = i; });
  return rank;
}

/**
 * Solve one load case.
 *   fixed: Set of node indices clamped in all 6 DOF
 *   loads: Map node index → [Fx, Fy, Fz] (lbf)
 */
export function solveFrame(model, { fixed, loads }, { K = 1.0 } = {}) {
  const nNodes = model.pos.length;
  if (!nNodes || !model.elems.length) return { ok: false, error: 'The frame has no tubes to analyze.' };
  if (!fixed.size) return { ok: false, error: 'No supports were found for this load case.' };
  const rank = rcmOrder(nNodes, model.elems);
  // free DOF numbering (fixed nodes removed)
  const dofIndex = new Int32Array(nNodes * 6).fill(-1);
  const byRank = [...Array(nNodes).keys()].sort((a, b) => rank[a] - rank[b]);
  let n = 0;
  for (const node of byRank) {
    if (fixed.has(node)) continue;
    for (let d = 0; d < 6; d++) dofIndex[node * 6 + d] = n++;
  }
  if (n === 0) return { ok: false, error: 'Every joint is fixed — nothing to solve.' };
  if (n > 3600) return { ok: false, error: `Frame too large to analyze here (${n} unknowns).` };

  const Kmat = new Float64Array(n * n);
  for (const e of model.elems) {
    const map = new Int32Array(12);
    for (let d = 0; d < 6; d++) { map[d] = dofIndex[e.i * 6 + d]; map[6 + d] = dofIndex[e.j * 6 + d]; }
    for (let r = 0; r < 12; r++) {
      const gr = map[r];
      if (gr < 0) continue;
      for (let c = 0; c < 12; c++) {
        const gc = map[c];
        if (gc < 0 || gc > gr) continue; // lower triangle only
        Kmat[gr * n + gc] += e.kg[r * 12 + c];
      }
    }
  }
  const first = new Int32Array(n);
  let maxDiag = 0;
  for (let i = 0; i < n; i++) {
    let f = i;
    for (let j = 0; j < i; j++) if (Kmat[i * n + j] !== 0) { f = j; break; }
    first[i] = f;
    maxDiag = Math.max(maxDiag, Kmat[i * n + i]);
  }
  // Envelope Cholesky (lower triangle, in place).
  const tol = maxDiag * 1e-13;
  for (let i = 0; i < n; i++) {
    const fi = first[i];
    for (let j = fi; j <= i; j++) {
      let s = Kmat[i * n + j];
      const k0 = Math.max(fi, first[j]);
      for (let k = k0; k < j; k++) s -= Kmat[i * n + k] * Kmat[j * n + k];
      if (j === i) {
        if (!(s > tol)) {
          const node = Math.floor([...dofIndex].indexOf(i) / 6);
          return { ok: false, error: 'The frame is not held together for this case — part of it can move freely (a disconnected section or a joint with no stiffness).', badNode: node };
        }
        Kmat[i * n + i] = Math.sqrt(s);
      } else {
        Kmat[i * n + j] = s / Kmat[j * n + j];
      }
    }
  }
  // Load vector, forward/back substitution.
  const x = new Float64Array(n);
  for (const [node, F] of loads) {
    for (let d = 0; d < 3; d++) {
      const g = dofIndex[node * 6 + d];
      if (g >= 0) x[g] += F[d];
    }
  }
  for (let i = 0; i < n; i++) {
    let s = x[i];
    for (let k = first[i]; k < i; k++) s -= Kmat[i * n + k] * x[k];
    x[i] = s / Kmat[i * n + i];
  }
  for (let i = n - 1; i >= 0; i--) {
    x[i] /= Kmat[i * n + i];
    const xi = x[i];
    for (let k = first[i]; k < i; k++) x[k] -= Kmat[i * n + k] * xi;
  }
  const u = new Float64Array(nNodes * 6);
  for (let g = 0; g < nNodes * 6; g++) if (dofIndex[g] >= 0) u[g] = x[dofIndex[g]];

  return { ok: true, u, members: memberResults(model, u, K) };
}

/** Internal forces, stresses and factors of safety for every member. */
function memberResults(model, u, K) {
  const out = {};
  const ue = new Float64Array(12), ul = new Float64Array(12);
  for (const e of model.elems) {
    for (let d = 0; d < 6; d++) { ue[d] = u[e.i * 6 + d]; ue[6 + d] = u[e.j * 6 + d]; }
    for (let b = 0; b < 4; b++) {
      for (let r = 0; r < 3; r++) {
        ul[b * 3 + r] = e.R[r][0] * ue[b * 3] + e.R[r][1] * ue[b * 3 + 1] + e.R[r][2] * ue[b * 3 + 2];
      }
    }
    const f = new Float64Array(12);
    for (let r = 0; r < 12; r++) {
      let s = 0;
      for (let c = 0; c < 12; c++) s += e.kl[r * 12 + c] * ul[c];
      f[r] = s;
    }
    const N = f[6]; // + tension
    const Mi = Math.hypot(f[4], f[5]), Mj = Math.hypot(f[10], f[11]);
    const M = Math.max(Mi, Mj);
    const T = Math.abs(f[3]);
    const V = Math.max(Math.hypot(f[1], f[2]), Math.hypot(f[7], f[8]));
    const sigma = Math.abs(N) / e.A + M / e.S;
    const tau = (T * e.c) / e.J + (2 * V) / e.A;
    const vm = Math.sqrt(sigma * sigma + 3 * tau * tau);
    const fos = vm > 1e-9 ? e.Sy / vm : Infinity;
    const Lm = model.memberLength[e.member] || e.L;
    const Pcr = (Math.PI ** 2 * e.E * e.I) / (K * Lm) ** 2;
    const fosBuckling = N < -1e-6 ? Pcr / -N : Infinity;
    const prev = out[e.member];
    if (!prev || vm > prev.vm) {
      out[e.member] = {
        N, M, T, V, sigma, tau, vm, fos,
        sigmaAxial: N / e.A, sigmaBend: M / e.S, Sy: e.Sy, Pcr,
        fosBuckling: prev ? Math.min(prev.fosBuckling, fosBuckling) : fosBuckling,
      };
    } else {
      prev.fosBuckling = Math.min(prev.fosBuckling, fosBuckling);
    }
  }
  return out;
}

export function displacementAt(result, node) {
  const u = result.u;
  return [u[node * 6], u[node * 6 + 1], u[node * 6 + 2]];
}
