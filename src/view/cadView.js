// CAD import visuals: the original bodies as a translucent reference
// (blue = recognized tube, orange = reference only) and, before committing,
// a preview of the tube frame the importer rebuilt.
import * as THREE from 'three';
import { clearGroup } from './viewport.js';
import { cylBetween, sphere, mat } from '../catalog/shapes.js';

export class CadView {
  constructor(vp) {
    this.vp = vp;
    this.reference = new THREE.Group();
    this.preview = new THREE.Group();
    vp.groups.cad.add(this.reference, this.preview);
    this.theme = {};
    this.box = null;
  }

  setTheme(t) { this.theme = t; }

  get hasReference() { return this.reference.children.length > 0; }

  /** Show (or clear, with null) the bodies and rebuilt frame of an import in progress. */
  showSession(result) {
    clearGroup(this.reference);
    clearGroup(this.preview);
    this.box = null;
    if (!result) { this.vp.requestRender(); return; }
    const box = new THREE.Box3();
    const tubeMat = new THREE.MeshStandardMaterial({ color: 0x5b8fd1, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide, metalness: 0.1, roughness: 0.6 });
    const otherMat = new THREE.MeshStandardMaterial({ color: 0xe8862c, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide, metalness: 0.1, roughness: 0.6 });
    for (const b of result.bodies) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(b.positions, 3));
      geo.computeVertexNormals();
      geo.computeBoundingBox();
      box.union(geo.boundingBox);
      const m = new THREE.Mesh(geo, b.tube ? tubeMat : otherMat);
      m.renderOrder = 1;
      this.reference.add(m);
    }
    const edge = mat(this.theme.select ?? 0xff7a18, { metal: 0.2, rough: 0.5 });
    const joint = mat(0xffffff, { metal: 0, rough: 0.6 });
    const nodes = result.frame.nodes;
    for (const m of result.frame.members) {
      const a = nodes[m.a], b = nodes[m.b];
      this.preview.add(cylBetween(a, b, Math.max(0.12, m.od * 0.16), edge));
      box.expandByPoint(new THREE.Vector3(...a)).expandByPoint(new THREE.Vector3(...b));
    }
    for (const p of nodes) {
      const s = sphere(0.45, joint, p);
      s.castShadow = false;
      this.preview.add(s);
    }
    this.box = box.isEmpty() ? null : box;
    this.vp.requestRender();
  }

  /** After import: drop the preview, keep the bodies faintly as reference geometry. */
  keepReference() {
    clearGroup(this.preview);
    this.reference.traverse((o) => {
      if (o.isMesh) { o.material.opacity = o.material.color.getHex() === 0x5b8fd1 ? 0.14 : 0.4; }
    });
    this.vp.requestRender();
  }

  clear() {
    clearGroup(this.reference);
    clearGroup(this.preview);
    this.box = null;
    this.vp.requestRender();
  }

  bounds() { return this.box; }
}
