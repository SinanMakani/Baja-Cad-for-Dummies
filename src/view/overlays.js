// Transient overlays: dimension labels on the selection, joint angle arcs,
// work plane, drawing preview, measurement, drag-and-drop ghost.
import * as THREE from 'three';
import { clearGroup, label } from './viewport.js';
import { memberInfo, jointInfo } from '../systems/chassis.js';
import { typeOf } from '../systems/suspension.js';
import { getDef, buildPart } from '../catalog/index.js';
import { fmtLen, fmtAngle } from '../core/units.js';
import { V } from '../core/geom.js';

function line(points, color, opts = {}) {
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const m = opts.dashed
    ? new THREE.LineDashedMaterial({ color, dashSize: 0.8, gapSize: 0.5, transparent: true, opacity: 0.95, depthTest: false })
    : new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: opts.depthTest ?? false });
  const l = new THREE.Line(geo, m);
  if (opts.dashed) l.computeLineDistances();
  l.renderOrder = 10;
  return l;
}

function arc(center, u, v, radius, color) {
  const pts = [];
  const axis = new THREE.Vector3().crossVectors(u, v);
  const ang = u.angleTo(v);
  if (axis.lengthSq() < 1e-10) return null;
  axis.normalize();
  for (let i = 0; i <= 24; i++) {
    const q = new THREE.Quaternion().setFromAxisAngle(axis, (ang * i) / 24);
    pts.push(center.clone().addScaledVector(u.clone().applyQuaternion(q), radius));
  }
  return line(pts, color);
}

export class Overlays {
  constructor(vp, store, theme) {
    this.vp = vp;
    this.store = store;
    this.theme = theme;
    this.labels = vp.groups.labels;
    this.helpers = vp.groups.helpers;
    this.ghost = null;
  }

  setTheme(t) { this.theme = t; }

  update() {
    clearGroup(this.labels);
    const ui = this.store.ui, st = this.store.state;
    const seen = new Set();
    const show = (s, strong) => {
      if (!s) return;
      const key = `${s.kind}:${s.id}:${s.side || ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (s.kind === 'member' && st.chassis.members[s.id]) this.memberLabel(s.id, strong);
      if (s.kind === 'node' && st.chassis.nodes[s.id]) this.jointArcs(s.id, strong);
      if (s.kind === 'hardpoint') this.hardpointLabel(s);
    };
    show(ui.selection, true);
    if (ui.selection?.ids) for (const id of ui.selection.ids.slice(0, 12)) show({ kind: ui.selection.kind, id }, false);
    if (ui.labels) show(ui.hover, false);
    this.measure();
    this.vp.requestRender();
  }

  memberLabel(id, strong) {
    const info = memberInfo(this.store.state, id);
    const l = label(`${id} · ${fmtLen(info.length)}${strong ? ` · ${info.profile.name}` : ''}`, `lbl lbl-member${strong ? ' strong' : ''}`);
    l.position.copy(info.A).lerp(info.B, 0.5);
    this.labels.add(l);
  }

  jointArcs(nodeId, strong) {
    const st = this.store.state;
    const j = jointInfo(st, nodeId);
    const P = V(j.p);
    const nl = label(`${st.chassis.nodeLabels?.[nodeId] ? st.chassis.nodeLabels[nodeId] + ' · ' : ''}${nodeId}`, 'lbl lbl-node');
    nl.position.copy(P).add(new THREE.Vector3(0, 0, 2.2));
    this.labels.add(nl);
    const pairs = j.pairs.slice().sort((a, b) => a.angle - b.angle).slice(0, strong ? 8 : 4);
    pairs.forEach((p, i) => {
      const u = j.members.find((m) => m.id === p.m1).dir, v = j.members.find((m) => m.id === p.m2).dir;
      const r = 3 + i * 0.9;
      const a = arc(P, u, v, r, this.theme.arc);
      if (a) this.labels.add(a);
      const mid = u.clone().add(v);
      if (mid.lengthSq() < 1e-6) mid.copy(new THREE.Vector3(0, 0, 1));
      const l = label(fmtAngle(p.angle), 'lbl lbl-angle');
      l.position.copy(P).addScaledVector(mid.normalize(), r + 1.1);
      this.labels.add(l);
    });
  }

  hardpointLabel(s) {
    const st = this.store.state;
    const [axleKey, key] = s.id.split('.');
    const axle = st.suspension[axleKey];
    const d = typeOf(axle).points[key];
    if (!d || !axle.points[key]) return;
    const p = axle.points[key].slice();
    if (s.side === 'R') p[1] = -p[1];
    const l = label(`${axleKey === 'front' ? 'Front' : 'Rear'} ${d.label}`, 'lbl lbl-hp');
    l.position.set(p[0], p[1], p[2] + 1.8);
    this.labels.add(l);
  }

  measure() {
    const m = this.store.ui.measure;
    if (!m?.a) return;
    const a = V(m.a), b = m.b ? V(m.b) : m.cursor ? V(m.cursor) : null;
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), new THREE.MeshBasicMaterial({ color: this.theme.measure, depthTest: false }));
    dot.position.copy(a);
    dot.renderOrder = 11;
    this.labels.add(dot);
    if (!b) return;
    this.labels.add(line([a, b], this.theme.measure, { dashed: !m.b }));
    const d = b.clone().sub(a);
    const l = label(`${fmtLen(d.length())}  (ΔX ${fmtLen(d.x)} · ΔY ${fmtLen(d.y)} · ΔZ ${fmtLen(d.z)})`, 'lbl lbl-measure');
    l.position.copy(a).lerp(b, 0.5);
    this.labels.add(l);
  }

  // --------------------------------------------------------- helpers group
  setWorkPlane(wp, visible) {
    if (this._plane) { this.helpers.remove(this._plane); this._plane.geometry.dispose(); this._plane.material.dispose(); this._plane = null; }
    if (this._planeGrid) { this.helpers.remove(this._planeGrid); this._planeGrid.geometry.dispose(); this._planeGrid.material.dispose(); this._planeGrid = null; }
    if (!visible) { this.vp.requestRender(); return; }
    const size = 220;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ color: this.theme.plane, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }));
    const grid = new THREE.GridHelper(size, size / 6, this.theme.plane, this.theme.plane);
    grid.material.transparent = true;
    grid.material.opacity = 0.22;
    grid.material.depthWrite = false;
    // GridHelper lies in XZ (normal Y); PlaneGeometry lies in XY (normal Z).
    const c = [30, 0, 25];
    if (wp.axis === 'XZ') { mesh.rotation.x = Math.PI / 2; mesh.position.set(c[0], wp.offset, c[2]); grid.position.set(c[0], wp.offset, c[2]); }
    if (wp.axis === 'XY') { mesh.position.set(c[0], 0, wp.offset); grid.rotation.x = Math.PI / 2; grid.position.set(c[0], 0, wp.offset); }
    if (wp.axis === 'YZ') { mesh.rotation.y = Math.PI / 2; mesh.position.set(wp.offset, 0, c[2]); grid.rotation.z = Math.PI / 2; grid.position.set(wp.offset, 0, c[2]); }
    this._plane = mesh;
    this._planeGrid = grid;
    this.helpers.add(mesh, grid);
    this.vp.requestRender();
  }

  setPreview(from, to, text, snapNode) {
    if (this._preview) { clearGroup(this._preview); this.helpers.remove(this._preview); this._preview = null; }
    if (!to) { this.vp.requestRender(); return; }
    const g = new THREE.Group();
    const cursor = new THREE.Mesh(new THREE.SphereGeometry(snapNode ? 0.9 : 0.55, 14, 10), new THREE.MeshBasicMaterial({ color: snapNode ? this.theme.snap : this.theme.preview, depthTest: false }));
    cursor.position.copy(to);
    cursor.renderOrder = 12;
    g.add(cursor);
    if (from) {
      g.add(line([from, to], this.theme.preview));
      if (text) {
        const l = label(text, 'lbl lbl-preview');
        l.position.copy(from).lerp(to, 0.5);
        g.add(l);
      }
    }
    this._preview = g;
    this.helpers.add(g);
    this.vp.requestRender();
  }

  setGhost(defKey, pos, state) {
    if (this.ghost) { clearGroup(this.ghost); this.helpers.remove(this.ghost); this.ghost = null; }
    if (!defKey || !pos) { this.vp.requestRender(); return; }
    const def = getDef(defKey, state);
    let obj;
    if (def?.build) obj = buildPart({ params: {} }, def);
    else obj = new THREE.Mesh(new THREE.TorusGeometry(4, 0.8, 8, 24), new THREE.MeshBasicMaterial({ color: this.theme.snap }));
    obj.traverse((o) => {
      if (o.isMesh) {
        o.material = new THREE.MeshBasicMaterial({ color: this.theme.snap, transparent: true, opacity: 0.35, depthWrite: false });
        o.castShadow = false;
      }
    });
    obj.position.copy(pos);
    const g = new THREE.Group();
    g.add(obj);
    this.ghost = g;
    this.helpers.add(g);
    this.vp.requestRender();
  }
}
