// The starter frame as CAD-style tube bodies (inches, app axes), for the import
// tests and samples/. With `bent`, the rear roll hoop, each roll-hoop overhead
// + front bracing member and each lower frame rail is one bent tube, the way
// most Baja frames are built; every other member is a straight tube.
import { filletPath, sweepTube, straightTube } from './meshes.mjs';

export const BENT_CHAINS = [
  ['A', 'W', 'B', 'R', 'C', 'D', 'DM', "D'", "C'", "R'", "B'", "W'", "A'"],
  ['D', 'E', 'F', 'H'], ["D'", "E'", "F'", "H'"],
  ['A', 'TP', 'V', 'G', 'P', 'I'], ["A'", "TP'", "V'", "G'", "P'", "I'"],
];

/**
 * @returns {{ bodies: { name, positions, bends? }[], bends: number }} bends = how many bends were made
 */
export function frameBodies(st, { bent = false, seg = 18, trim = 0.6, clr = 4.5, bendStep = 12 } = {}) {
  const { nodes, members, profiles, nodeLabels } = st.chassis;
  const tube = (m) => { const p = profiles[m.profile]; return { R: p.od / 2, r: p.od / 2 - p.wall, seg, trimA: trim, trimB: trim }; };
  const label = {};
  // centerline nodes carry both names (DM and DM')
  for (const [id, l] of Object.entries(nodeLabels || {})) { label[l] = id; label[l.replace(/'$/, '')] ??= id; }
  const used = new Set();
  const bodies = [];
  let bends = 0;
  if (bent) {
    BENT_CHAINS.forEach((chain, ci) => {
      const ids = chain.map((l) => label[l]);
      let first = null;
      for (let k = 0; k + 1 < ids.length; k++) {
        const m = Object.entries(members).find(([, mm]) => (mm.a === ids[k] && mm.b === ids[k + 1]) || (mm.a === ids[k + 1] && mm.b === ids[k]));
        if (!m) throw new Error(`starter frame has no tube ${chain[k]}–${chain[k + 1]}`);
        used.add(m[0]);
        first ??= m[1];
      }
      const path = filletPath(ids.map((id) => nodes[id].p), { clr, bendStep });
      bends += path.bends.length;
      bodies.push({ name: `Bent tube ${ci + 1}`, positions: sweepTube(path.samples, tube(first)), bends: path.bends });
    });
  }
  Object.entries(members).filter(([id]) => !used.has(id)).forEach(([, m], i) => {
    bodies.push({ name: `Tube ${i + 1}`, positions: straightTube(nodes[m.a].p, nodes[m.b].p, tube(m)) });
  });
  return { bodies, bends };
}
