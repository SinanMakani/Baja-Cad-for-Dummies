// Pointer / keyboard interaction with the 3D view: hover + selection,
// transform gizmo, chassis drawing tools, measuring, library drag-and-drop.
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { V, arr, DEG, azEl, segPoint } from '../core/geom.js';
import { fmtLen, fmtAngle, fmtWeight } from '../core/units.js';
import { addNode, addMember, splitMember, moveNode, memberInfo, jointInfo, findNodeAt } from '../systems/chassis.js';
import { typeOf } from '../systems/suspension.js';
import { getDef, specsOf, weightOf, envelopeOf } from '../catalog/index.js';
import { addPart, assignSlot, deleteSelection, duplicatePart, partName } from '../core/commands.js';
import { quatFromDeg } from '../core/geom.js';
import { toast } from '../ui/dom.js';
import { SLOT_LABELS } from '../catalog/dynamics.js';

const PICK_GROUPS = ['chassis', 'dynamics', 'powertrain', 'ergonomics', 'hardware', 'routing', 'driver', 'cg'];

export class Interaction {
  constructor({ vp, store, builder, overlays, analysis, tooltip, readout }) {
    Object.assign(this, { vp, store, builder, overlays, analysis, tooltip, readout });
    this.canvas = vp.renderer.domElement;
    this.dragDef = null;
    this.down = null;
    this._hoverQueued = null;

    const t = (this.transform = new TransformControls(vp.camera, this.canvas));
    t.setSize(0.8);
    t.addEventListener('dragging-changed', (e) => {
      vp.controls.enabled = !e.value;
      if (e.value) this.gizmoStart(); else this.gizmoEnd();
    });
    t.addEventListener('objectChange', () => this.gizmoChange());
    t.addEventListener('change', () => vp.requestRender());
    this.proxy = new THREE.Object3D();
    vp.scene.add(this.proxy);
    vp.scene.add(t.getHelper());

    const c = this.canvas;
    c.addEventListener('pointermove', (e) => this.onMove(e));
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    c.addEventListener('pointerup', (e) => this.onUp(e));
    c.addEventListener('pointerleave', () => { this.setHover(null); this.tooltip.hidden = true; });
    c.addEventListener('dblclick', (e) => this.onDbl(e));
    c.addEventListener('contextmenu', (e) => { if (this.store.ui.tool !== 'select') { e.preventDefault(); this.cancel(); } });
    const stage = vp.container;
    stage.addEventListener('dragover', (e) => this.onDragOver(e));
    stage.addEventListener('dragleave', (e) => { if (e.target === this.canvas) this.overlays.setGhost(null); });
    stage.addEventListener('drop', (e) => this.onDrop(e));
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  get ui() { return this.store.ui; }
  get st() { return this.store.state; }

  // ------------------------------------------------------------ hover + tooltip
  onMove(e) {
    this.lastEvent = e;
    if (this._hoverQueued) return;
    this._hoverQueued = requestAnimationFrame(() => {
      this._hoverQueued = null;
      const ev = this.lastEvent;
      const tool = this.ui.tool;
      if (tool === 'tube' || tool === 'node') return this.drawHover(ev);
      if (tool === 'split') return this.splitHover(ev);
      if (tool === 'measure') return this.measureHover(ev);
      if (ev.buttons) return;
      if (this.transform.dragging) return;
      const hit = this.vp.pick(ev.clientX, ev.clientY, PICK_GROUPS.map((k) => this.vp.groups[k]));
      this.setHover(hit ? { kind: hit.kind, id: hit.id, side: hit.side } : null);
      this.showTooltip(hit, ev);
    });
  }

  setHover(h) {
    const cur = this.ui.hover;
    const same = (a, b) => (!a && !b) || (a && b && a.kind === b.kind && a.id === b.id && a.side === b.side);
    if (!same(cur, h)) this.store.setUI({ hover: h });
  }

  showTooltip(hit, ev) {
    const tip = this.tooltip;
    if (!hit) { tip.hidden = true; return; }
    const lines = this.describe(hit);
    if (!lines) { tip.hidden = true; return; }
    tip.replaceChildren(...lines.map((l, i) => {
      const d = document.createElement('div');
      d.className = i === 0 ? 'tip-title' : 'tip-line';
      d.textContent = l;
      return d;
    }));
    tip.hidden = false;
    const rect = this.vp.container.getBoundingClientRect();
    const x = ev.clientX - rect.left + 16, y = ev.clientY - rect.top + 16;
    tip.style.left = `${Math.min(x, rect.width - tip.offsetWidth - 8)}px`;
    tip.style.top = `${Math.min(y, rect.height - tip.offsetHeight - 8)}px`;
  }

  describe(hit) {
    const st = this.st, A = this.analysis();
    switch (hit.kind) {
      case 'member': {
        const i = memberInfo(st, hit.id);
        if (!i) return null;
        return [`Tube ${hit.id} · ${i.role.label}`, `Length ${fmtLen(i.length)}`, `${i.profile.name} · ${fmtWeight(i.weight, 2)}`, `Elevation ${fmtAngle(i.el)} · Plan ${fmtAngle(i.az)}`];
      }
      case 'node': {
        const j = jointInfo(st, hit.id);
        if (!j) return null;
        const lbl = st.chassis.nodeLabels?.[hit.id];
        return [`Joint ${hit.id}${lbl ? ` (${lbl})` : ''} · ${j.members.length} tube${j.members.length === 1 ? '' : 's'}`, `X ${fmtLen(j.p[0])}  Y ${fmtLen(j.p[1])}  Z ${fmtLen(j.p[2])}`,
          ...j.pairs.slice(0, 6).map((p) => `${p.m1} ↔ ${p.m2}: ${fmtAngle(p.angle)}`), j.pairs.length > 6 ? `+${j.pairs.length - 6} more (select to see all)` : null].filter(Boolean);
      }
      case 'part': {
        const p = st.parts[hit.id];
        const def = p && getDef(p.def, st);
        if (!def) return null;
        const env = envelopeOf(p, def);
        return [partName(p, st), `${def.name}`, `Envelope ${fmtLen(env.L)} × ${fmtLen(env.W)} × ${fmtLen(env.H)}`, `Weight ${fmtWeight(weightOf(p, def))}`, ...specsOf(p, def).slice(0, 3).map(([k, v]) => `${k}: ${v}`)];
      }
      case 'hardpoint': {
        const [ax, key] = hit.id.split('.');
        const d = typeOf(st.suspension[ax]).points[key];
        const p = st.suspension[ax].points[key];
        return [`${ax === 'front' ? 'Front' : 'Rear'} ${d.label}`, `X ${fmtLen(p[0])}  Y ${fmtLen(hit.side === 'R' ? -p[1] : p[1])}  Z ${fmtLen(p[2])}`, d.body === 'chassis' ? 'Frame-mounted point' : 'Moves with the suspension'];
      }
      case 'axle': {
        const ax = st.suspension[hit.id];
        const s = A.susp?.[hit.id];
        const tire = getDef(ax.tire, st);
        return [`${hit.id === 'front' ? 'Front' : 'Rear'} ${hit.side === 'R' ? 'right' : 'left'} corner`, `${typeOf(ax).label}`, `Tire ${tire?.name || ax.tire}`, s ? `Camber ${fmtAngle(s.pose0.camber, 2)} · Toe ${fmtAngle(s.pose0.toe, 2)}` : null].filter(Boolean);
      }
      case 'route': {
        const r = A.routes?.routes.find((x) => x.id === hit.id);
        if (!r) return null;
        return r.kind === 'throttle'
          ? [r.label, `Cable ${fmtLen(r.cable)}`, `${r.bends.count} bends · ${fmtAngle(r.bends.total, 0)} total`]
          : [r.label, `Hard line ${fmtLen(r.hard)} · Flex hose ${fmtLen(r.flex)}`, `${r.tees} tee fitting${r.tees === 1 ? '' : 's'}`];
      }
      case 'cv': {
        const list = hit.front ? A.pt.frontCv : A.pt.cv;
        const cv = list.find((c) => c.side === hit.id);
        return cv ? [`${hit.front ? 'Front' : 'Rear'} CV half-shaft (${cv.side === 'L' ? 'left' : 'right'})`, `Length ${fmtLen(cv.length)} · plunge ${fmtLen(cv.plunge)}`, `Static ${fmtAngle(Math.max(cv.staticIn, cv.staticOut))} · max ${fmtAngle(Math.max(cv.maxIn, cv.maxOut))}`] : null;
      }
      case 'driveshaft': return ['Driveshaft (4WD)', `Length ${fmtLen(A.pt.driveshaft.length)}`, `Angle ${fmtAngle(A.pt.driveshaft.angle)}`];
      case 'driver': return A.ergo ? [`Driver · ${A.ergo.driver.label}`, `${A.ergo.driver.summary} · sitting height ${fmtLen(A.ergo.driver.sitHeight)}`, 'Click for clearances and reach'] : null;
      case 'rack': return hit.id === 'column' ? ['Steering column', 'Auto-connects the wheel to the rack pinion'] : [getDef(st.suspension.steering.rack, st)?.name || 'Steering rack', `Travel ±${fmtLen(st.suspension.steering.travel)}`];
      case 'cg': return A.mass ? ['Center of gravity', `X ${fmtLen(A.mass.cg.x)}  Y ${fmtLen(A.mass.cg.y)}  Z ${fmtLen(A.mass.cg.z)}`, `Total ${fmtWeight(A.mass.total)}`] : null;
      default: return null;
    }
  }

  // ------------------------------------------------------------ click / select
  onDown(e) {
    this.down = { x: e.clientX, y: e.clientY, onGizmo: this.transform.axis != null && this.transform.object != null, button: e.button };
  }

  onUp(e) {
    const d = this.down;
    this.down = null;
    if (!d || d.onGizmo || d.button !== 0) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return;
    const tool = this.ui.tool;
    if (tool === 'tube') return this.drawClick(e);
    if (tool === 'node') return this.nodeClick(e);
    if (tool === 'split') return this.splitClick(e);
    if (tool === 'measure') return this.measureClick(e);
    const hit = this.vp.pick(e.clientX, e.clientY, PICK_GROUPS.map((k) => this.vp.groups[k]));
    if (!hit) { this.store.select(null); return; }
    const sel = this.ui.selection;
    if (e.shiftKey && hit.kind === 'member' && sel?.kind === 'member') {
      const ids = new Set(sel.ids || [sel.id]);
      if (ids.has(hit.id)) ids.delete(hit.id); else ids.add(hit.id);
      const list = [...ids];
      this.store.select(list.length ? { kind: 'member', id: list[0], ids: list.length > 1 ? list : undefined } : null);
      return;
    }
    this.store.select({ kind: hit.kind, id: hit.id, side: hit.side, front: hit.front });
  }

  onDbl(e) {
    if (this.ui.tool === 'tube') { this.finishChain(); return; }
    const hit = this.vp.pick(e.clientX, e.clientY, PICK_GROUPS.map((k) => this.vp.groups[k]));
    if (hit) this.vp.focusOn(hit.point, 14);
  }

  cancel() {
    const ui = this.ui;
    if (ui.tool === 'tube' && ui.drawing?.from) { this.finishChain(); return; }
    if (ui.tool === 'measure' && ui.measure) { this.store.setUI({ measure: null }); return; }
    if (ui.tool !== 'select') { this.setTool('select'); return; }
    this.store.select(null);
  }

  setTool(tool) {
    this.store.setUI({ tool, drawing: tool === 'tube' ? { from: null } : null, measure: tool === 'measure' ? this.ui.measure : null });
    this.overlays.setPreview(null);
    this.overlays.setWorkPlane(this.ui.workPlane, tool === 'tube' || tool === 'node');
    this.readout.hidden = !['tube', 'node', 'measure', 'split'].includes(tool);
    this.canvas.style.cursor = tool === 'select' ? '' : 'crosshair';
    this.syncGizmo();
  }

  // ------------------------------------------------------------ drawing tools
  workPlane() {
    const wp = this.ui.workPlane;
    const from = this.ui.drawing?.from && this.st.chassis.nodes[this.ui.drawing.from];
    const idx = { XZ: 1, XY: 2, YZ: 0 }[wp.axis];
    const offset = wp.follow && from ? from.p[idx] : wp.offset;
    const normal = { XZ: new THREE.Vector3(0, 1, 0), XY: new THREE.Vector3(0, 0, 1), YZ: new THREE.Vector3(1, 0, 0) }[wp.axis];
    return { plane: new THREE.Plane(normal, -offset), idx, offset, axis: wp.axis };
  }

  nearestNodeOnScreen(ev, px = 13) {
    let best = null;
    for (const [id, n] of Object.entries(this.st.chassis.nodes)) {
      const s = this.vp.project(V(n.p));
      if (s.behind) continue;
      const d = Math.hypot(s.x - ev.clientX, s.y - ev.clientY);
      if (d < px && (!best || d < best.d)) best = { id, d };
    }
    return best?.id || null;
  }

  cursorPoint(ev) {
    const ui = this.ui;
    if (ui.snap.nodes) {
      const id = this.nearestNodeOnScreen(ev);
      if (id) return { p: V(this.st.chassis.nodes[id].p), node: id };
    }
    const wp = this.workPlane();
    const p = this.vp.intersectPlane(ev.clientX, ev.clientY, wp.plane);
    if (!p) return null;
    const from = ui.drawing?.from && V(this.st.chassis.nodes[ui.drawing.from].p);
    if (from && ev.shiftKey) {
      // Angle snap within the work plane, length snapped to grid.
      const d = p.clone().sub(from);
      const [i, j] = { XZ: [0, 2], XY: [0, 1], YZ: [1, 2] }[wp.axis];
      const comps = [d.x, d.y, d.z];
      const ang = Math.atan2(comps[j], comps[i]);
      const stepA = (ui.snap.angle || 5) * DEG;
      const a = Math.round(ang / stepA) * stepA;
      let L = Math.hypot(comps[i], comps[j]);
      if (ui.snap.grid) L = Math.max(ui.snap.step, Math.round(L / ui.snap.step) * ui.snap.step);
      const out = [0, 0, 0];
      out[i] = Math.cos(a) * L; out[j] = Math.sin(a) * L;
      return { p: from.clone().add(new THREE.Vector3(...out)), node: null };
    }
    if (ui.snap.grid) {
      const s = ui.snap.step;
      const c = [p.x, p.y, p.z].map((v, k) => (k === wp.idx ? wp.offset : Math.round(v / s) * s));
      p.set(c[0], c[1], c[2]);
    }
    return { p, node: null };
  }

  previewText(from, to) {
    const d = to.clone().sub(from);
    const { el, az } = azEl(d);
    return `${fmtLen(d.length())} · elev ${fmtAngle(el)} · plan ${fmtAngle(az)}`;
  }

  drawHover(ev) {
    const cp = this.cursorPoint(ev);
    this.cursor = cp;
    if (!cp) { this.overlays.setPreview(null); return; }
    const from = this.ui.tool === 'tube' && this.ui.drawing?.from ? V(this.st.chassis.nodes[this.ui.drawing.from].p) : null;
    this.overlays.setPreview(from, cp.p, from ? this.previewText(from, cp.p) : null, !!cp.node);
    this.readout.textContent = `X ${fmtLen(cp.p.x)}   Y ${fmtLen(cp.p.y)}   Z ${fmtLen(cp.p.z)}${cp.node ? `   · snap ${cp.node}` : ''}`;
  }

  nodeClick(ev) {
    const cp = this.cursorPoint(ev);
    if (!cp || cp.node) return;
    let id;
    this.store.commit('Add node', (st) => { id = addNode(st, arr(cp.p), { mirror: this.ui.mirror }); });
    toast(`Node ${id} at (${cp.p.toArray().map((v) => v.toFixed(2)).join(', ')}) in`, 'ok', 1600);
  }

  drawClick(ev) {
    const cp = this.cursorPoint(ev);
    if (!cp) return;
    this.drawTo(arr(cp.p), cp.node);
  }

  /** Add the next point of the tube chain (used by clicks and by exact input). */
  drawTo(p, nodeId = null) {
    const ui = this.ui;
    const from = ui.drawing?.from || null;
    nodeId ??= findNodeAt(this.st, p);
    if (!from && nodeId) { this.store.setUI({ drawing: { from: nodeId } }); return nodeId; }
    if (from && nodeId === from) { this.finishChain(); return from; }
    let target;
    this.store.commit(from ? 'Draw tube' : 'Start tube', (st) => {
      target = nodeId || addNode(st, p, { mirror: ui.mirror });
      if (from && target !== from) addMember(st, from, target, { profile: ui.activeProfile, role: ui.activeRole, mirror: ui.mirror });
    });
    this.store.setUI({ drawing: { from: target } });
    this.overlays.setWorkPlane(this.ui.workPlane, true);
    return target;
  }

  finishChain() {
    this.store.setUI({ drawing: { from: null } });
    this.overlays.setPreview(null);
  }

  splitHover(ev) {
    const hit = this.vp.pick(ev.clientX, ev.clientY, [this.vp.groups.chassis]);
    if (hit?.kind !== 'member') { this.overlays.setPreview(null); this.splitTarget = null; return; }
    const info = memberInfo(this.st, hit.id);
    const r = segPoint(hit.point, info.A, info.B);
    let dA = r.t * info.length;
    if (this.ui.snap.grid) dA = Math.round(dA / this.ui.snap.step) * this.ui.snap.step;
    const t = Math.min(0.98, Math.max(0.02, dA / info.length));
    const p = info.A.clone().lerp(info.B, t);
    this.splitTarget = { id: hit.id, t };
    this.overlays.setPreview(info.A, p, `${fmtLen(t * info.length)} from ${info.m.a}  ·  ${fmtLen((1 - t) * info.length)} from ${info.m.b}`, true);
    this.readout.textContent = `Split ${hit.id} at X ${fmtLen(p.x)}  Y ${fmtLen(p.y)}  Z ${fmtLen(p.z)}`;
  }

  splitClick() {
    const s = this.splitTarget;
    if (!s) return;
    let nid;
    this.store.commit(`Split tube ${s.id}`, (st) => { nid = splitMember(st, s.id, s.t, { mirror: this.ui.mirror }); });
    this.splitTarget = null;
    this.store.select({ kind: 'node', id: nid });
    toast(`Split ${s.id} — new joint ${nid}`, 'ok', 1600);
  }

  measurePoint(ev) {
    const id = this.nearestNodeOnScreen(ev);
    if (id) return V(this.st.chassis.nodes[id].p);
    const hit = this.vp.pick(ev.clientX, ev.clientY, PICK_GROUPS.map((k) => this.vp.groups[k]));
    if (hit?.kind === 'hardpoint') {
      const [ax, key] = hit.id.split('.');
      const p = this.st.suspension[ax].points[key].slice();
      if (hit.side === 'R') p[1] = -p[1];
      return V(p);
    }
    if (hit) return hit.point.clone();
    return this.vp.intersectPlane(ev.clientX, ev.clientY, new THREE.Plane(new THREE.Vector3(0, 0, 1), 0));
  }

  measureHover(ev) {
    const m = this.ui.measure;
    const p = this.measurePoint(ev);
    if (!p) return;
    this.readout.textContent = `X ${fmtLen(p.x)}   Y ${fmtLen(p.y)}   Z ${fmtLen(p.z)}`;
    if (m?.a && !m.b) this.store.setUI({ measure: { ...m, cursor: arr(p) } });
  }

  measureClick(ev) {
    const p = this.measurePoint(ev);
    if (!p) return;
    const m = this.ui.measure;
    if (!m?.a || m.b) this.store.setUI({ measure: { a: arr(p) } });
    else this.store.setUI({ measure: { a: m.a, b: arr(p) } });
  }

  // ------------------------------------------------------------ gizmo
  selectionAnchor() {
    const sel = this.ui.selection, st = this.st;
    if (!sel) return null;
    if (sel.kind === 'node' && st.chassis.nodes[sel.id]) return { pos: V(st.chassis.nodes[sel.id].p), rot: null };
    if (sel.kind === 'hardpoint') {
      const [ax, key] = sel.id.split('.');
      const p = st.suspension[ax]?.points[key]?.slice();
      if (!p) return null;
      if (sel.side === 'R') p[1] = -p[1];
      return { pos: V(p), rot: null };
    }
    if (sel.kind === 'part' && st.parts[sel.id]) {
      const p = st.parts[sel.id];
      return { pos: V(p.pos), rot: quatFromDeg(p.rot), locked: p.linked || p.locked };
    }
    return null;
  }

  syncGizmo() {
    if (this.transform.dragging) return;
    const a = this.ui.tool === 'select' ? this.selectionAnchor() : null;
    if (!a || a.locked || (this.ui.selection.ids && this.ui.selection.ids.length > 1)) { this.transform.detach(); this.vp.requestRender(); return; }
    this.proxy.position.copy(a.pos);
    this.proxy.quaternion.copy(a.rot || new THREE.Quaternion());
    const isPart = this.ui.selection.kind === 'part';
    this.transform.setMode(isPart ? this.ui.gizmoMode : 'translate');
    this.transform.setSpace(isPart && this.ui.gizmoMode === 'rotate' ? 'local' : 'world');
    this.transform.setTranslationSnap(this.ui.snap.grid ? this.ui.snap.step : null);
    this.transform.setRotationSnap(this.ui.snap.grid ? 5 * DEG : null);
    if (this.transform.object !== this.proxy) this.transform.attach(this.proxy);
    this.vp.requestRender();
  }

  gizmoStart() {
    const sel = this.ui.selection;
    this.store.beginGesture(sel.kind === 'part' ? `Move ${partName(this.st.parts[sel.id], this.st)}` : sel.kind === 'node' ? `Move node ${sel.id}` : `Move ${sel.id}`);
  }

  gizmoChange() {
    const sel = this.ui.selection;
    if (!sel || !this.transform.dragging) return;
    const p = this.proxy.position;
    const r4 = (v) => +v.toFixed(4);
    this.store.updateGesture((st) => {
      if (sel.kind === 'node') moveNode(st, sel.id, [r4(p.x), r4(p.y), r4(p.z)], { mirror: this.ui.mirror });
      else if (sel.kind === 'hardpoint') {
        const [ax, key] = sel.id.split('.');
        st.suspension[ax].points[key] = [r4(p.x), r4(sel.side === 'R' ? -p.y : p.y), r4(p.z)];
      } else if (sel.kind === 'part') {
        const part = st.parts[sel.id];
        part.pos = [r4(p.x), r4(p.y), r4(p.z)];
        const e = new THREE.Euler().setFromQuaternion(this.proxy.quaternion, 'XYZ');
        part.rot = [e.x, e.y, e.z].map((v) => +(v / DEG).toFixed(3));
      }
    });
  }

  gizmoEnd() { this.store.endGesture(); }

  // ------------------------------------------------------------ drag & drop
  dropPoint(ev) {
    const hit = this.vp.pick(ev.clientX, ev.clientY, ['chassis', 'powertrain', 'ergonomics', 'hardware'].map((k) => this.vp.groups[k]));
    let p = hit?.point?.clone();
    if (!p) {
      const zs = Object.values(this.st.chassis.nodes).map((n) => n.p[2]);
      const floor = zs.length ? Math.min(...zs) : 0;
      p = this.vp.intersectPlane(ev.clientX, ev.clientY, new THREE.Plane(new THREE.Vector3(0, 0, 1), -floor));
    }
    if (p && this.ui.snap.grid) { const s = this.ui.snap.step; p.set(Math.round(p.x / s) * s, Math.round(p.y / s) * s, +p.z.toFixed(3)); }
    return p;
  }

  nearestAxle(p) {
    const A = this.analysis();
    if (!A.susp) return 'front';
    return Math.abs(p.x - A.susp.frontX) < Math.abs(p.x - A.susp.rearX) ? 'front' : 'rear';
  }

  onDragOver(e) {
    if (!this.dragDef) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const p = this.dropPoint(e);
    const def = getDef(this.dragDef, this.st);
    if (!p || !def) return;
    if (def.slot) {
      const ax = def.slot === 'rack' ? 'front' : this.nearestAxle(p);
      const wc = this.st.suspension[ax].points.WC;
      this.overlays.setGhost(this.dragDef, new THREE.Vector3(wc[0], wc[1], wc[2]), this.st);
      this.readout.hidden = false;
      this.readout.textContent = `Drop to use as ${ax} ${SLOT_LABELS[def.slot].toLowerCase()}`;
    } else {
      this.overlays.setGhost(this.dragDef, p, this.st);
      this.readout.hidden = false;
      this.readout.textContent = `Place at X ${fmtLen(p.x)}  Y ${fmtLen(p.y)}  Z ${fmtLen(p.z)}`;
    }
  }

  onDrop(e) {
    const key = this.dragDef || e.dataTransfer.getData('text/plain');
    this.dragDef = null;
    this.overlays.setGhost(null);
    this.readout.hidden = !['tube', 'node', 'measure', 'split'].includes(this.ui.tool);
    if (!key) return;
    e.preventDefault();
    const def = getDef(key, this.st);
    const p = this.dropPoint(e);
    if (!def || !p) return;
    const lockedMsg = 'Only chassis parts can be added until the frame passes its stress tests (Chassis ▸ Stress test).';
    if (def.slot) {
      const ax = def.slot === 'rack' ? 'front' : this.nearestAxle(p);
      if (assignSlot(this.store, key, ax)) toast(`${def.name} → ${ax} ${SLOT_LABELS[def.slot].toLowerCase()}`, 'ok');
      else toast(lockedMsg, 'warn', 4000);
      return;
    }
    const res = addPart(this.store, key, arr(p));
    if (res?.locked) { toast(lockedMsg, 'warn', 4000); return; }
    if (res?.id) {
      this.store.select({ kind: 'part', id: res.id });
      toast(res.swapped ? `Swapped in ${def.name} (only one ${def.group.toLowerCase()} per car)` : `Placed ${def.name}`, 'ok');
    }
  }

  // ------------------------------------------------------------ keyboard
  onKey(e) {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
    if (document.querySelector('.modal-overlay')) return;
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); this.store.undo(); return; }
    if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); this.store.redo(); return; }
    if (mod && k === 'd') { e.preventDefault(); const s = this.ui.selection; if (s?.kind === 'part') duplicatePart(this.store, s.id); return; }
    if (mod) return;
    if (k === 'escape') { this.cancel(); return; }
    if (k === 'delete' || k === 'backspace') { if (deleteSelection(this.store)) e.preventDefault(); return; }
    const chassisTool = { v: 'select', n: 'node', t: 'tube', s: 'split', m: 'measure' }[k];
    if (chassisTool) {
      if (chassisTool !== 'select' && chassisTool !== 'measure' && this.ui.tab !== 'chassis') this.store.setUI({ tab: 'chassis' });
      this.setTool(chassisTool);
      return;
    }
    if (k === 'w') { this.store.setUI({ gizmoMode: 'translate' }); this.syncGizmo(); return; }
    if (k === 'e') { this.store.setUI({ gizmoMode: 'rotate' }); this.syncGizmo(); return; }
    if (k === 'r') {
      const s = this.ui.selection;
      if (s?.kind === 'part' && !this.st.parts[s.id].linked) this.store.commit('Rotate 90°', (st) => { st.parts[s.id].rot[2] = ((st.parts[s.id].rot[2] + 90 + 180) % 360) - 180; });
      return;
    }
    if (k === 'f') { this.focusSelection(); return; }
    if (k === 'g') { this.store.setUI({ snap: { ...this.ui.snap, grid: !this.ui.snap.grid } }); toast(`Grid snap ${this.ui.snap.grid ? 'on' : 'off'}`, 'info', 1200); return; }
    if (k === 'x') { this.store.setUI({ xray: !this.ui.xray }); return; }
    const tabs = { 1: 'chassis', 2: 'dynamics', 3: 'ergonomics', 4: 'powertrain', 5: 'library' };
    if (tabs[k]) this.store.setUI({ tab: tabs[k] });
  }

  focusSelection() {
    const sel = this.ui.selection, st = this.st, A = this.analysis();
    if (!sel) { this.vp.view('iso', A.dims?.box); return; }
    let p = null, r = 12;
    if (sel.kind === 'member' && st.chassis.members[sel.id]) { const i = memberInfo(st, sel.id); p = i.A.clone().lerp(i.B, 0.5); r = i.length / 2 + 4; }
    else if (sel.kind === 'part' && A.parts[sel.id]) { p = A.parts[sel.id].center; const e = A.parts[sel.id].env; r = Math.max(e.L, e.W, e.H); }
    else if (sel.kind === 'driver' && A.ergo?.pose) { p = A.ergo.pose.shoulderC; r = 25; }
    else { const a = this.selectionAnchor(); if (a) p = a.pos; }
    if (p) this.vp.focusOn(p, r);
  }
}
