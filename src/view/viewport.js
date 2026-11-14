// Renderer, camera, controls, lights, grid and view presets. Z is up.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

export const LAYER_KEYS = ['chassis', 'dynamics', 'ergonomics', 'powertrain', 'hardware', 'routing', 'driver', 'helpers', 'labels', 'dims', 'cg', 'cad', 'stress'];

export function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    if (o.isCSS2DObject && o.element?.parentNode) o.element.parentNode.removeChild(o.element);
  });
}

export function clearGroup(g) {
  for (const c of [...g.children]) { disposeTree(c); g.remove(c); }
}

export function label(text, cls = 'lbl') {
  const el = document.createElement('div');
  el.className = cls;
  el.textContent = text;
  const o = new CSS2DObject(el);
  o.center.set(0.5, 0.5);
  return o;
}

export class Viewport {
  constructor(container) {
    this.container = container;
    this.dirty = true;
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }));
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.domElement.className = 'gl';
    container.appendChild(r.domElement);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = 'labels';
    container.appendChild(this.labelRenderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.5, 5000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(150, 120, 90);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.target.set(30, 0, 22);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.addEventListener('change', () => this.requestRender());

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.4);
    this.scene.add(this.hemi);
    const sun = (this.sun = new THREE.DirectionalLight(0xffffff, 2.1));
    sun.position.set(90, 70, 160);
    sun.target.position.set(30, 0, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -110, right: 110, top: 110, bottom: -110, near: 10, far: 400 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.3;
    this.scene.add(sun, sun.target);
    const fill = new THREE.DirectionalLight(0xffffff, 0.6);
    fill.position.set(-80, -120, 60);
    this.scene.add(fill);

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.ShadowMaterial({ opacity: 0.18 }));
    this.ground.receiveShadow = true;
    this.ground.position.set(30, 0, -0.01);
    this.scene.add(this.ground);

    this.groups = {};
    for (const k of LAYER_KEYS) {
      const g = new THREE.Group();
      g.name = k;
      this.groups[k] = g;
      this.scene.add(g);
    }
    this.gridGroup = new THREE.Group();
    this.scene.add(this.gridGroup);
    this.buildGrid({ minor: 0xb9c0c8, major: 0x97a0aa, axis: 0x6f7984 });
    this.buildAxes();

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.sectionPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(container);
    this.resize();
    this._tween = null;
    const loop = () => {
      requestAnimationFrame(loop);
      const moving = this.controls.update();
      if (this._tween) this._stepTween();
      if (this.dirty || moving || this._tween) { this.render(); this.dirty = false; }
    };
    loop();
  }

  requestRender() { this.dirty = true; }

  render() {
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
    this.onRender?.();
  }

  resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.labelRenderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  buildGrid(c) {
    clearGroup(this.gridGroup);
    const minor = [], major = [];
    const X0 = -48, X1 = 120, Y0 = -60, Y1 = 60;
    for (let x = X0; x <= X1; x += 6) (x % 12 === 0 ? major : minor).push(x, Y0, 0, x, Y1, 0);
    for (let y = Y0; y <= Y1; y += 6) (y % 12 === 0 ? major : minor).push(X0, y, 0, X1, y, 0);
    const mk = (arr, color, opacity) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
    };
    this.gridGroup.add(mk(minor, c.minor, 0.55), mk(major, c.major, 0.8));
    const axisLines = mk([X0, 0, 0.01, X1, 0, 0.01], c.axis, 0.9);
    this.gridGroup.add(axisLines);
    this.requestRender();
  }

  buildAxes() {
    const g = new THREE.Group();
    const mk = (dir, color, text) => {
      const a = new THREE.ArrowHelper(dir, new THREE.Vector3(0, 0, 0), 9, color, 1.6, 0.9);
      g.add(a);
      const l = label(text, 'lbl lbl-axis');
      l.position.copy(dir.clone().multiplyScalar(11));
      g.add(l);
    };
    mk(new THREE.Vector3(1, 0, 0), 0xd0453b, 'X');
    mk(new THREE.Vector3(0, 1, 0), 0x3aa55d, 'Y');
    mk(new THREE.Vector3(0, 0, 1), 0x3b7dd8, 'Z');
    this.axes = g;
    this.scene.add(g);
  }

  setTheme(t) {
    this.scene.background = new THREE.Color(t.sceneBg);
    this.hemi.color.set(t.hemiSky);
    this.hemi.groundColor.set(t.hemiGround);
    this.buildGrid({ minor: t.gridMinor, major: t.gridMajor, axis: t.gridAxis });
    this.ground.material.opacity = t.shadow;
    this.requestRender();
  }

  setGridVisible(v) { this.gridGroup.visible = v; this.axes.visible = v; this.requestRender(); }

  setSection(sec) {
    if (!sec?.enabled) { this.renderer.clippingPlanes = []; this.requestRender(); return; }
    const n = { x: new THREE.Vector3(-1, 0, 0), y: new THREE.Vector3(0, -1, 0), z: new THREE.Vector3(0, 0, -1) }[sec.axis];
    this.sectionPlane.normal.copy(n);
    this.sectionPlane.constant = sec.offset;
    this.renderer.clippingPlanes = [this.sectionPlane];
    this.requestRender();
  }

  // ---------------------------------------------------------- picking
  setPointer(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster;
  }

  static visibleChain(o) {
    for (let p = o; p; p = p.parent) if (p.visible === false) return false;
    return true;
  }

  static pickInfo(o) {
    for (let p = o; p; p = p.parent) if (p.userData?.pick) return p.userData.pick;
    return null;
  }

  pick(clientX, clientY, groups) {
    this.setPointer(clientX, clientY);
    const hits = this.raycaster.intersectObjects(groups, true);
    const clip = this.renderer.clippingPlanes[0];
    for (const h of hits) {
      if (!Viewport.visibleChain(h.object)) continue;
      if (h.object.material?.opacity < 0.2) continue;
      if (clip && clip.distanceToPoint(h.point) < 0) continue;
      const info = Viewport.pickInfo(h.object);
      if (info) return { ...info, point: h.point, object: h.object };
    }
    return null;
  }

  intersectPlane(clientX, clientY, plane) {
    this.setPointer(clientX, clientY);
    const out = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(plane, out) ? out : null;
  }

  project(p) {
    const v = p.clone().project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height, behind: v.z > 1 };
  }

  // ---------------------------------------------------------- camera
  animateTo(position, target, ms = 380) {
    this._tween = { t0: performance.now(), ms, p0: this.camera.position.clone(), p1: position.clone(), q0: this.controls.target.clone(), q1: target.clone() };
    this.requestRender();
  }

  _stepTween() {
    const tw = this._tween;
    let t = (performance.now() - tw.t0) / tw.ms;
    if (t >= 1) { t = 1; this._tween = null; }
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    this.camera.position.lerpVectors(tw.p0, tw.p1, e);
    this.controls.target.lerpVectors(tw.q0, tw.q1, e);
    this.camera.lookAt(this.controls.target);
  }

  view(name, box, eye) {
    // A human-like wide lens from the driver's eye; a flatter lens for everything else.
    const fov = name === 'driver' ? 72 : 35;
    if (this.camera.fov !== fov) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    const center = box && !box.isEmpty() ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3(30, 0, 22);
    const size = box && !box.isEmpty() ? box.getSize(new THREE.Vector3()).length() : 120;
    const d = size / (2 * Math.tan((this.camera.fov * Math.PI) / 360)) * 1.02;
    const dirs = {
      iso: new THREE.Vector3(0.82, 0.68, 0.52),
      front: new THREE.Vector3(1, 0, 0.0001),
      rear: new THREE.Vector3(-1, 0, 0.0001),
      side: new THREE.Vector3(0, 1, 0.0001),
      right: new THREE.Vector3(0, -1, 0.0001),
      top: new THREE.Vector3(0.0001, 0, 1),
    };
    if (name === 'driver' && eye) {
      this.animateTo(eye.pos, eye.pos.clone().addScaledVector(eye.dir, 40));
      return;
    }
    const dir = (dirs[name] || dirs.iso).clone().normalize();
    this.animateTo(center.clone().addScaledVector(dir, d), center);
  }

  focusOn(point, radius = 20) {
    if (this.camera.fov !== 35) { this.camera.fov = 35; this.camera.updateProjectionMatrix(); }
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const d = Math.max(radius * 3.2, 25);
    this.animateTo(point.clone().addScaledVector(dir, d), point.clone());
  }

  screenshot() {
    this.render();
    return this.renderer.domElement.toDataURL('image/png');
  }
}
