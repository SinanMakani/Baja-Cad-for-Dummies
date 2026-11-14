// Builds scene geometry from the design state and its analysis snapshot.
import * as THREE from 'three';
import { clearGroup, label } from './viewport.js';
import { mat, cylBetween, sphere, cyl, box, lathe, helix, group } from '../catalog/shapes.js';
import { getDef, buildPart, partMatrix, portsWorld } from '../catalog/index.js';
import { typeOf, tireData, shockData, rotorData, rackData, cornerPoses, mirrorPose } from '../systems/suspension.js';
import { roleInfo } from '../catalog/materials.js';
import { HUB_CV_OFFSET } from '../systems/powertrain.js';
import { V, quatFromDeg } from '../core/geom.js';
import { fmtLen } from '../core/units.js';

const PROFILE_PALETTE = [0x4f6d8f, 0xb86b2e, 0x3f8f6f, 0x8a5bb5, 0xa33b4b, 0x5f7f2a, 0x2f7fa8, 0x9a7b25];

function tag(obj, pick, category) {
  obj.userData.pick = pick;
  obj.userData.category = category;
  return obj;
}

function capsule(a, b, r, material) {
  const A = V(a.toArray ? a.toArray() : a), B = V(b.toArray ? b.toArray() : b);
  const d = B.clone().sub(A);
  const len = Math.max(d.length() - 0, 0.01);
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 12), material);
  m.position.copy(A).addScaledVector(d, 0.5);
  if (d.lengthSq() > 1e-9) m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  m.castShadow = true;
  return m;
}

export class Builder {
  constructor(vp, store, analysis) {
    this.vp = vp;
    this.store = store;
    this.analysis = analysis;
    this.theme = {};
    this.roots = []; // pickable roots for highlight
  }

  setTheme(t) { this.theme = t; }

  rebuild() {
    const A = this.analysis();
    this.roots = [];
    this.buildChassis(A);
    this.buildSuspension(A);
    this.buildParts(A);
    this.buildDerived(A);
    this.buildRoutes(A);
    this.buildDriver(A);
    this.buildCG(A);
    this.buildDims(A);
    this.vp.requestRender();
  }

  /** Rebuild just the suspension (used while scrubbing the travel / steer sliders). */
  rebuildSuspension() {
    const A = this.analysis();
    this.buildSuspension(A);
    this.roots = this.roots.filter((r) => r.parent); // drop roots removed by clearGroup
    this.vp.requestRender();
  }

  _root(obj) { this.roots.push(obj); return obj; }

  memberColor(m, prof, profIndex) {
    const t = this.theme;
    const mode = this.store.ui.colorBy;
    if (mode === 'profile') return PROFILE_PALETTE[profIndex % PROFILE_PALETTE.length];
    if (mode === 'uniform') return t.chassis;
    if (m.role === 'SUSP') return t.chassisSusp;
    return roleInfo(m.role).primary ? t.chassis : t.chassisSecondary;
  }

  buildChassis() {
    const g = this.vp.groups.chassis;
    clearGroup(g);
    const st = this.store.state, ui = this.store.ui;
    const profIdx = Object.fromEntries(Object.keys(st.chassis.profiles).map((k, i) => [k, i]));
    const maxOd = {};
    for (const [id, m] of Object.entries(st.chassis.members)) {
      const na = st.chassis.nodes[m.a], nb = st.chassis.nodes[m.b];
      if (!na || !nb) continue;
      const prof = st.chassis.profiles[m.profile] || { od: 1 };
      for (const n of [m.a, m.b]) maxOd[n] = Math.max(maxOd[n] || 0, prof.od);
      const color = this.memberOverride?.(id) ?? this.memberColor(m, prof, profIdx[m.profile] ?? 0);
      const mesh = cylBetween(na.p, nb.p, prof.od / 2, mat(color, { metal: 0.55, rough: 0.42 }));
      g.add(this._root(tag(mesh, { kind: 'member', id }, 'chassis')));
    }
    const showNodes = ui.layers.nodes && ui.tab === 'chassis' && !this.stressActive;
    for (const [id, n] of Object.entries(st.chassis.nodes)) {
      const s = sphere(Math.max(0.45, (maxOd[id] || 1) * 0.6), mat(this.theme.node, { metal: 0.2, rough: 0.5 }), n.p);
      s.visible = showNodes || (ui.selection?.kind === 'node' && ui.selection.id === id);
      s.castShadow = false;
      g.add(this._root(tag(s, { kind: 'node', id }, 'chassis')));
    }
  }

  buildSuspension(A) {
    const g = this.vp.groups.dynamics;
    clearGroup(g);
    const st = this.store.state, ui = this.store.ui;
    if (!A.susp) return;
    const sim = ui.sim;
    const live = sim.heave || sim.rack;
    for (const axleKey of ['front', 'rear']) {
      const axle = st.suspension[axleKey];
      const base = A.susp[axleKey].pose0;
      if (!base) continue;
      const poses = live ? cornerPoses(axle, { heave: sim.heave, rack: axleKey === 'front' ? sim.rack : 0 }) : { L: base, R: mirrorPose(base) };
      for (const side of ['L', 'R']) this.buildCorner(g, axleKey, axle, poses[side], side);
      if (axleKey === 'front' && typeOf(axle).steer) this.buildRack(g, poses);
    }
    const inb = A.routes?.calipers?.rearInboard;
    if (inb && st.suspension.rear.brakeMode === 'inboard') {
      const rot = rotorData(st.suspension.rear, st);
      const disc = cyl(rot.diameter / 2, rot.thickness, 'y', mat(0xa7adb3, { metal: 0.8, rough: 0.35 }), [inb.rotor.x, inb.rotor.y - 0.3, inb.rotor.z]);
      const cal = box(1.6, 1.3, 2.4, mat(0xb8322b, { metal: 0.4, rough: 0.5 }), [inb.caliper.x, inb.caliper.y - 0.3, inb.caliper.z]);
      g.add(this._root(tag(group(disc, cal), { kind: 'axle', id: 'rear' }, 'dynamics')));
    }
    this.buildHardpoints(g, A);
  }

  buildCorner(g, axleKey, axle, pose, side) {
    const st = this.store.state;
    const P = pose.pts;
    const t = this.theme;
    const armMat = () => mat(t.dynamics, { metal: 0.5, rough: 0.45 });
    const linkMat = () => mat(t.dynamicsLink, { metal: 0.6, rough: 0.35 });
    const pick = { kind: 'axle', id: axleKey, side };
    const parts = [];
    if (axle.type === 'double-wishbone') {
      parts.push(cylBetween(P.UCA_F, P.UBJ, 0.44, armMat()), cylBetween(P.UCA_R, P.UBJ, 0.44, armMat()));
      parts.push(cylBetween(P.LCA_F, P.LBJ, 0.5, armMat()), cylBetween(P.LCA_R, P.LBJ, 0.5, armMat()));
      parts.push(cylBetween(P.TR_I, P.TR_O, 0.3, linkMat()));
      const up = mat(0x9aa3ab, { metal: 0.7, rough: 0.35 });
      parts.push(cylBetween(P.UBJ, P.LBJ, 0.6, up));
      const kp = P.LBJ.clone().lerp(P.UBJ, (P.WC.z - P.LBJ.z) / Math.max(0.1, P.UBJ.z - P.LBJ.z));
      parts.push(cylBetween(kp, P.WC.clone().addScaledVector(pose.axis, -1.2), 0.9, up));
      const armRoot = P.LBJ.clone().lerp(P.UBJ, 0.45);
      parts.push(cylBetween(armRoot, P.TR_O, 0.45, up));
    } else {
      parts.push(cylBetween(P.TA_P, P.TA_H, 0.62, armMat()));
      const brace = P.TA_P.clone().lerp(P.TA_H, 0.55);
      parts.push(cylBetween(brace, P.CLL_O ?? P.TA_H, 0.35, armMat()));
      parts.push(cylBetween(P.CLU_I, P.CLU_O, 0.34, linkMat()), cylBetween(P.CLL_I, P.CLL_O, 0.34, linkMat()));
      const up = mat(0x9aa3ab, { metal: 0.7, rough: 0.35 });
      parts.push(cylBetween(P.CLU_O, P.CLL_O, 0.55, up), cylBetween(P.TA_H, P.WC.clone().addScaledVector(pose.axis, -1.2), 0.9, up));
      parts.push(cylBetween(P.TA_H, P.CLU_O, 0.4, up), cylBetween(P.TA_H, P.CLL_O, 0.4, up));
    }
    // shock
    if (P.SH_U && P.SH_L) {
      const sh = shockData(axle, st);
      const d = P.SH_L.clone().sub(P.SH_U);
      const L = d.length();
      const dir = d.clone().normalize();
      const bodyLen = Math.min(L * 0.62, (sh.extended - sh.stroke) * 0.8);
      const bodyEnd = P.SH_U.clone().addScaledVector(dir, bodyLen);
      parts.push(cylBetween(P.SH_U, bodyEnd, sh.bodyDia / 2, mat(0x2c3137, { metal: 0.5, rough: 0.4 })));
      parts.push(cylBetween(bodyEnd, P.SH_L, 0.32, mat(0xd8dde2, { metal: 0.9, rough: 0.2 })));
      if (sh.kind !== 'air') {
        const spring = helix(sh.bodyDia / 2 + 0.55, L * 0.72, 7, 0.2, t.spring);
        spring.position.copy(P.SH_U).addScaledVector(dir, L * 0.5);
        spring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        parts.push(spring);
      }
    }
    // wheel
    const tire = tireData(axle, st);
    const R = tire.diameter / 2, w = tire.width / 2, rr = tire.rim / 2 + 0.25;
    const tireMesh = lathe([[rr, -w * 0.82], [R - 1.3, -w], [R - 0.35, -w * 0.9], [R, -w * 0.55], [R, w * 0.55], [R - 0.35, w * 0.9], [R - 1.3, w], [rr, w * 0.82]], mat(0x202326, { metal: 0, rough: 0.92 }), 'y', [0, 0, 0], undefined, 48);
    const rimW = (tire.rimWidth || 5) / 2;
    const rim = lathe([[1.2, rimW], [rr - 0.1, rimW], [rr, rimW - 0.4], [rr - 0.25, -rimW + 0.4], [rr - 0.1, -rimW], [1.2, -rimW]], mat(0xb9bec4, { metal: 0.85, rough: 0.3 }), 'y', [0, 0, 0], undefined, 36);
    const hub = cyl(1.6, 1.0, 'y', mat(0x6c737a, { metal: 0.7, rough: 0.35 }), [0, -rimW + 1.5, 0]);
    const wheel = group(tireMesh, rim, hub);
    wheel.position.copy(P.WC);
    wheel.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pose.axis);
    parts.push(wheel);
    // outboard brake
    const inboardRear = axleKey === 'rear' && axle.brakeMode === 'inboard';
    if (!inboardRear) {
      const rot = rotorData(axle, st);
      const c = P.WC.clone().addScaledVector(pose.axis, -(HUB_CV_OFFSET - 0.8));
      const disc = cyl(rot.diameter / 2, rot.thickness, 'y', mat(0xa7adb3, { metal: 0.8, rough: 0.35 }));
      disc.position.copy(c);
      disc.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pose.axis);
      const dir = new THREE.Vector3(axleKey === 'front' ? -0.7 : 0.7, 0, 0.7).normalize();
      const cal = box(1.6, 1.3, 2.4, mat(0xb8322b, { metal: 0.4, rough: 0.5 }));
      cal.position.copy(c).addScaledVector(dir, rot.diameter / 2 - 0.7);
      parts.push(disc, cal);
    }
    const root = group(parts);
    g.add(this._root(tag(root, pick, 'dynamics')));
  }

  buildRack(g, poses) {
    const st = this.store.state;
    const rk = rackData(st);
    const L = poses.L.pts.TR_I, R = poses.R.pts.TR_I;
    const c = L.clone().lerp(R, 0.5);
    const housing = cylBetween(new THREE.Vector3(c.x, -rk.housing / 2, c.z), new THREE.Vector3(c.x, rk.housing / 2, c.z), 0.8, mat(0x70777f, { metal: 0.6, rough: 0.4 }));
    const shaftL = cylBetween(new THREE.Vector3(c.x, rk.housing / 2, c.z), L, 0.32, mat(0xd0d5da, { metal: 0.9, rough: 0.25 }));
    const shaftR = cylBetween(new THREE.Vector3(c.x, -rk.housing / 2, c.z), R, 0.32, mat(0xd0d5da, { metal: 0.9, rough: 0.25 }));
    const pinion = cyl(0.7, 2.2, 'z', mat(0x5b6168, { metal: 0.6, rough: 0.4 }), [c.x, c.y, c.z + 1.4]);
    const root = group(housing, shaftL, shaftR, pinion);
    g.add(this._root(tag(root, { kind: 'rack', id: 'rack' }, 'dynamics')));
    // steering column to the wheel (auto-connected)
    const wheel = Object.values(st.parts).find((p) => getDef(p.def, st)?.role === 'steeringWheel');
    if (wheel) {
      const col = portsWorld(wheel, getDef(wheel.def, st)).column;
      const pin = new THREE.Vector3(c.x, c.y, c.z + 2.5);
      const m = mat(0x8d949b, { metal: 0.7, rough: 0.35 });
      const column = group(cylBetween(col, pin, 0.42, m), sphere(0.75, mat(0x3f454b), [col.x, col.y, col.z]), sphere(0.75, mat(0x3f454b), [pin.x, pin.y, pin.z]));
      g.add(this._root(tag(column, { kind: 'rack', id: 'column' }, 'dynamics')));
    }
  }

  buildHardpoints(g, A) {
    const st = this.store.state, ui = this.store.ui;
    const show = ui.layers.hardpoints && ui.tab === 'dynamics';
    const sel = ui.selection?.kind === 'hardpoint' ? ui.selection : null;
    if (!show && !sel) return;
    const colors = { chassis: this.theme.hpChassis, upright: this.theme.hpUpright, lca: this.theme.hpArm, uca: this.theme.hpArm };
    for (const axleKey of ['front', 'rear']) {
      const axle = st.suspension[axleKey];
      const T = typeOf(axle);
      for (const [k, d] of Object.entries(T.points)) {
        if (!axle.points[k]) continue;
        for (const side of ['L', 'R']) {
          const id = `${axleKey}.${k}`;
          if (!show && !(sel.id === id && sel.side === side)) continue;
          const p = axle.points[k].slice();
          if (side === 'R') p[1] = -p[1];
          const s = sphere(0.55, mat(colors[d.body] || 0xffffff, { metal: 0.1, rough: 0.4 }), p);
          s.castShadow = false;
          s.renderOrder = 2;
          g.add(this._root(tag(s, { kind: 'hardpoint', id, side }, 'dynamics')));
        }
      }
    }
  }

  buildParts(A) {
    const st = this.store.state;
    for (const k of ['hardware', 'powertrain', 'ergonomics']) clearGroup(this.vp.groups[k]);
    // Chassis-category parts share the chassis group (already cleared in buildChassis).
    for (const part of Object.values(st.parts)) {
      if (part.hidden) continue;
      const def = getDef(part.def, st);
      if (!def?.build) continue;
      const obj = buildPart(part, def);
      obj.position.fromArray(part.pos);
      obj.quaternion.copy(quatFromDeg(part.rot));
      if (part.color) obj.traverse((o) => { if (o.isMesh && o.material?.color) o.material.color.set(part.color); });
      const groupKey = def.category === 'dynamics' ? 'dynamics' : def.category;
      this.vp.groups[groupKey].add(this._root(tag(obj, { kind: 'part', id: part.id }, def.category)));
    }
  }

  buildDerived(A) {
    const g = this.vp.groups.powertrain;
    const pt = A.pt;
    if (!pt) return;
    const m = () => mat(this.theme.shaft, { metal: 0.8, rough: 0.3 });
    const boot = () => mat(0x1d1f22, { metal: 0, rough: 0.9 });
    for (const cv of [...pt.cv, ...pt.frontCv]) {
      const root = group(cylBetween(cv.inboard, cv.outboard, 0.55, m()), sphere(1.25, boot(), cv.inboard.toArray()), sphere(1.35, boot(), cv.outboard.toArray()));
      g.add(this._root(tag(root, { kind: 'cv', id: cv.side, front: pt.frontCv.includes(cv) }, 'powertrain')));
    }
    if (pt.driveshaft) {
      const d = pt.driveshaft;
      const root = group(cylBetween(d.a, d.b, 0.62, m()), sphere(0.9, boot(), d.a.toArray()), sphere(0.9, boot(), d.b.toArray()));
      g.add(this._root(tag(root, { kind: 'driveshaft', id: 'driveshaft' }, 'powertrain')));
    }
  }

  buildRoutes(A) {
    const g = this.vp.groups.routing;
    clearGroup(g);
    const t = this.theme;
    for (const r of A.routes?.routes || []) {
      if (!r.ok) continue;
      const root = new THREE.Group();
      for (const seg of r.segments) {
        if (seg.pts.length < 2) continue;
        const path = new THREE.CurvePath();
        for (let i = 1; i < seg.pts.length; i++) path.add(new THREE.LineCurve3(seg.pts[i - 1], seg.pts[i]));
        const radius = seg.type === 'flex' ? 0.24 : seg.type === 'cable' ? 0.18 : 0.16;
        const color = r.kind === 'throttle' ? t.throttle : seg.type === 'flex' ? t.brakeFlex : t.brake;
        const geo = new THREE.TubeGeometry(path, Math.max(8, seg.pts.length * 6), radius, 6, false);
        const mesh = new THREE.Mesh(geo, mat(color, { metal: seg.type === 'flex' ? 0 : 0.5, rough: 0.45 }));
        root.add(mesh);
      }
      if (r.tee) root.add(box(0.8, 0.8, 0.8, mat(0xd8dde2, { metal: 0.8, rough: 0.3 }), r.tee.toArray()));
      g.add(this._root(tag(root, { kind: 'route', id: r.id }, 'routing')));
    }
  }

  buildDriver(A) {
    const g = this.vp.groups.driver;
    clearGroup(g);
    const e = A.ergo;
    if (!e?.pose || !this.store.state.ergonomics?.showDriver) return;
    const p = e.pose, t = this.theme;
    const k = p.girth || 1; // torso and limbs thicken with body weight
    const skin = () => mat(t.driver, { metal: 0, rough: 0.8, opacity: 0.92 });
    const suit = () => mat(t.driverSuit, { metal: 0, rough: 0.85, opacity: 0.92 });
    const parts = [
      sphere(4.3 * k, suit(), p.H.toArray()),
      capsule(p.H.clone().addScaledVector(p.torso, 3), p.shoulderC, 4.4 * k, suit()),
      capsule(p.shoulders.L, p.shoulders.R, 2.4 * k, suit()),
      capsule(p.shoulderC, p.neck, 1.6, skin()),
      sphere(p.helmetR, mat(t.helmet, { metal: 0.3, rough: 0.35 }), p.head.toArray()),
    ];
    for (const s of ['L', 'R']) {
      const leg = p.legs[s], arm = p.arms[s];
      parts.push(capsule(leg.hip, leg.knee, 3.0 * k, suit()), capsule(leg.knee, leg.ankle, 2.2 * k, suit()), capsule(leg.ankle, leg.toe, 1.5, mat(0x2a2d31, { metal: 0, rough: 0.9 })));
      parts.push(capsule(arm.shoulder, arm.elbow, 1.8 * k, suit()), capsule(arm.elbow, arm.hand, 1.5 * k, suit()), sphere(1.4, skin(), arm.hand.toArray()));
    }
    const root = group(parts);
    g.add(this._root(tag(root, { kind: 'driver', id: 'driver' }, 'ergonomics')));
  }

  buildCG(A) {
    const g = this.vp.groups.cg;
    clearGroup(g);
    const c = A.mass?.cg;
    if (!c || !A.mass.total) return;
    const a = mat(0xf2c230, { metal: 0.1, rough: 0.4 }), b = mat(0x1b1d20, { metal: 0.1, rough: 0.4 });
    const s = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const q = new THREE.Mesh(new THREE.SphereGeometry(1.6, 16, 10, (i * Math.PI) / 2, Math.PI / 2), i % 2 ? a : b);
      s.add(q);
    }
    s.position.copy(c);
    const pole = cylBetween(new THREE.Vector3(c.x, c.y, 0), c, 0.08, mat(0xf2c230, { metal: 0, rough: 0.5 }));
    const l = label(`CG · ${fmtLen(c.z)} high`, 'lbl lbl-cg');
    l.position.copy(c).add(new THREE.Vector3(0, 0, 3.2));
    g.add(tag(group(s, pole), { kind: 'cg', id: 'cg' }, 'general'), l);
  }

  buildDims(A) {
    const g = this.vp.groups.dims;
    clearGroup(g);
    if (!A.susp) return;
    const lineMat = new THREE.LineBasicMaterial({ color: this.theme.dim, transparent: true, opacity: 0.9 });
    const seg = (a, b) => {
      const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
      return new THREE.Line(geo, lineMat.clone());
    };
    const dim = (a, b, text, tickDir) => {
      const grp = new THREE.Group();
      grp.add(seg(a, b));
      for (const p of [a, b]) grp.add(seg(p.clone().addScaledVector(tickDir, -1.5), p.clone().addScaledVector(tickDir, 1.5)));
      const l = label(text, 'lbl lbl-dim');
      l.position.copy(a).lerp(b, 0.5).addScaledVector(tickDir, 2.2);
      grp.add(l);
      g.add(grp);
    };
    // Wheelbase along the right side, tracks ahead of / behind the axles. Overall
    // length × width × height is listed in the inspector summary instead.
    const s = A.susp, z = 0.05;
    const yOut = -(Math.max(s.trackF, s.trackR) / 2 + 10);
    dim(new THREE.Vector3(s.rearX, yOut, z), new THREE.Vector3(s.frontX, yOut, z), `Wheelbase ${fmtLen(s.wheelbase)}`, new THREE.Vector3(0, -1, 0));
    const fx = (A.dims?.box.max.x ?? s.frontX + 12) + 8, rx = (A.dims?.box.min.x ?? s.rearX - 12) - 8;
    dim(new THREE.Vector3(fx, -s.trackF / 2, z), new THREE.Vector3(fx, s.trackF / 2, z), `Front track ${fmtLen(s.trackF)}`, new THREE.Vector3(1, 0, 0));
    dim(new THREE.Vector3(rx, -s.trackR / 2, z), new THREE.Vector3(rx, s.trackR / 2, z), `Rear track ${fmtLen(s.trackR)}`, new THREE.Vector3(-1, 0, 0));
  }

  // ------------------------------------------------------------ visual state
  applyVisual(highlight = []) {
    const ui = this.store.ui;
    const sel = ui.selection, hov = ui.hover;
    const focus = ui.focusMode && ['chassis', 'dynamics', 'ergonomics', 'powertrain'].includes(ui.tab) ? ui.tab : null;
    const L = ui.layers;
    // Until a new frame passes its stress tests (or while viewing results),
    // only the frame is shown: the other systems aren't integrated yet.
    const frameOnly = this.locked || this.stressActive;
    const vis = {
      chassis: L.chassis, dynamics: L.dynamics, ergonomics: L.ergonomics, powertrain: L.powertrain,
      hardware: L.hardware, routing: L.routing, driver: L.driver && L.ergonomics, dims: L.dims, cg: L.cg,
    };
    for (const [k, v] of Object.entries(vis)) this.vp.groups[k].visible = v && (k === 'chassis' || !frameOnly);
    this.vp.groups.cad.visible = L.cad !== false;
    this.vp.groups.stress.visible = !!this.stressActive;
    this.vp.setGridVisible(L.grid);

    const matches = (pick, s) => {
      if (!s || !pick) return false;
      if (s.kind !== pick.kind) return false;
      if (s.ids && s.ids.includes(pick.id)) return true;
      if (s.id !== pick.id) return false;
      if (pick.kind === 'hardpoint') return s.side === pick.side;
      return true;
    };
    const hi = new Set(highlight.map((h) => `${h.kind}:${h.id}`));
    for (const root of this.roots) {
      if (!root.parent) continue;
      const pick = root.userData.pick;
      const cat = root.userData.category;
      const selected = matches(pick, sel);
      const hovered = matches(pick, hov);
      const flagged = hi.has(`${pick.kind}:${pick.id}`) || (pick.kind === 'hardpoint' && hi.has(`hardpoint:${pick.id}`));
      let f = 1;
      if (focus && cat !== focus && cat !== 'routing' && cat !== 'general' && !this.stressActive) f = cat === 'chassis' ? 0.5 : 0.34;
      if (ui.xray && !selected) f = Math.min(f, cat === 'chassis' ? 0.3 : 0.42);
      if (selected || flagged) f = 1;
      const emissive = flagged ? this.theme.flag : selected ? this.theme.select : hovered ? this.theme.hover : null;
      const intensity = flagged ? 0.7 : selected ? 0.55 : hovered ? 0.35 : 0;
      root.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        const m = o.material;
        const base = m.userData.baseOpacity ?? 1;
        const op = base * f;
        m.opacity = op;
        m.transparent = op < 0.999;
        m.depthWrite = op > 0.6;
        if (m.emissive) {
          if (emissive != null) { m.emissive.setHex(emissive); m.emissiveIntensity = intensity; }
          else m.emissive.setHex(0x000000);
        }
      });
    }
    this.vp.requestRender();
  }
}

export { partMatrix };
