// Stress-test results in 3D: tubes colored by factor of safety (via the
// builder), load arrows, held joints, and the exaggerated deflected shape.
import * as THREE from 'three';
import { clearGroup, label } from './viewport.js';
import { fosColor, lastResults, chassisHash } from '../systems/stresstest.js';
import { fmtNum, fmtLen } from '../core/units.js';

export class StressView {
  constructor(vp, store) {
    this.vp = vp;
    this.store = store;
    this.group = vp.groups.stress;
    this.theme = {};
  }

  setTheme(t) { this.theme = t; }

  /** The case currently shown, or null when the results view is off or stale. */
  activeCase() {
    const ui = this.store.ui;
    if (ui.tab !== 'chassis' || ui.chassisMode !== 'stress' || !ui.stressView?.on) return null;
    const run = lastResults(chassisHash(this.store.state));
    if (!run) return null;
    const c = run.cases.find((x) => x.key === ui.stressView.caseKey) || run.cases[0];
    return c?.ok ? { run, c } : null;
  }

  /** Hex color for a tube, or null to use the normal color. */
  memberColor(id) {
    const a = this._active;
    if (!a) return null;
    const r = a.c.res.members[id];
    if (!r) return 0x8a939c;
    const [cr, cg, cb] = fosColor(Math.min(r.fos, r.fosBuckling), a.run.settings.fosYield);
    return new THREE.Color().setRGB(cr, cg, cb, THREE.SRGBColorSpace).getHex();
  }

  /** Recompute which case is shown (call before the builder rebuilds the frame). */
  refreshActive() { this._active = this.activeCase(); return this._active; }

  update() {
    clearGroup(this.group);
    const a = this._active;
    if (!a) { this.vp.requestRender(); return; }
    const { c, run } = a;
    const st = this.store.state;
    // held joints
    const holdMat = new THREE.MeshStandardMaterial({ color: 0x30363d, metalness: 0.2, roughness: 0.6 });
    const holdGeo = new THREE.OctahedronGeometry(1.1);
    for (const id of c.setup.supports) {
      const p = c.model.pos[c.model.keyIndex.get(id)] || st.chassis.nodes[id]?.p;
      if (!p) continue;
      const m = new THREE.Mesh(holdGeo, holdMat);
      m.position.set(...p);
      this.group.add(m);
    }
    // load arrows (tip at the load point)
    const maxF = Math.max(...c.setup.points.map((p) => Math.hypot(...p.F)));
    for (const pt of c.setup.points) {
      const f = new THREE.Vector3(...pt.F);
      const mag = f.length();
      if (mag < 1e-6) continue;
      const len = 5 + 6 * (mag / maxF);
      const dir = f.normalize();
      const origin = new THREE.Vector3(...pt.p).addScaledVector(dir, -(len + 0.7));
      const arrow = new THREE.ArrowHelper(dir, origin, len, 0xe23b2e, 2.0, 1.3);
      // ArrowHelper shares its geometry across instances: never dispose it.
      arrow.line.geometry.userData.shared = true;
      arrow.cone.geometry.userData.shared = true;
      this.group.add(arrow);
    }
    // deflected shape
    const s = (c.maxDisp > 1e-9 ? 5 / c.maxDisp : 1) * (this.store.ui.stressView.scale ?? 1);
    if (s > 0 && this.store.ui.stressView.scale !== 0) {
      const pts = [];
      for (const e of c.model.elems) {
        for (const n of [e.i, e.j]) {
          const p = c.model.pos[n];
          pts.push(p[0] + c.res.u[n * 6] * s, p[1] + c.res.u[n * 6 + 1] * s, p[2] + c.res.u[n * 6 + 2] * s);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: this.theme.deformed ?? 0xffffff, transparent: true, opacity: 0.85 }));
      line.renderOrder = 5;
      this.group.add(line);
    }
    // weakest tube callout
    const m = st.chassis.members[c.minFosMember];
    if (m) {
      const A = st.chassis.nodes[m.a].p, B = st.chassis.nodes[m.b].p;
      const l = label(`${c.minFosMember} · FoS ${fmtNum(c.minFos, 2)}`, `lbl lbl-stress ${c.minFos < run.settings.fosYield ? 'bad' : ''}`);
      l.position.set((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2 + 2.5);
      this.group.add(l);
    }
    const dn = c.model.keyIndex.get(c.maxDispNode);
    if (dn != null && c.maxDisp > 0.005) {
      const p = c.model.pos[dn];
      const l = label(`δ ${fmtLen(c.maxDisp, { precision: 3 })}`, 'lbl lbl-dim');
      l.position.set(p[0], p[1], p[2] - 2.5);
      this.group.add(l);
    }
    this.vp.requestRender();
  }
}
