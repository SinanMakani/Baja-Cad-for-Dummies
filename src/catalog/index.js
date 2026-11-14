// Part catalog registry. Each category file registers plain definition objects;
// see docs/EXTENDING.md for the full definition format.
//
// Two kinds of definitions exist:
//   • placeable parts — have build(); dropped into the scene as part instances
//   • slot parts      — have `slot` ('tire' | 'shock' | 'caliper' | 'rotor' | 'rack' | 'upright');
//                       dropping one assigns it to the suspension instead of placing geometry.
import * as THREE from 'three';
import { matrixFrom, V } from '../core/geom.js';

export const CATEGORIES = [
  { key: 'chassis', label: 'Chassis', blurb: 'Tube stock, gussets, tabs, skid plates' },
  { key: 'dynamics', label: 'Dynamics', blurb: 'Tires, shocks, brakes, steering, uprights' },
  { key: 'ergonomics', label: 'Ergonomics', blurb: 'Seats, pedals, steering wheel, restraints' },
  { key: 'powertrain', label: 'Powertrain', blurb: 'Engine, CVT, gearbox, fuel, 4WD' },
  { key: 'hardware', label: 'Hardware & Electrical', blurb: 'Kill switches, lights, safety, custom' },
];

const REGISTRY = new Map();

export function register(defs) {
  for (const d of defs) {
    if (REGISTRY.has(d.key)) console.warn(`Catalog: duplicate key ${d.key}`);
    REGISTRY.set(d.key, { params: [], specs: () => [], weight: () => 0, ports: () => ({}), ...d });
  }
}

export const allDefs = () => [...REGISTRY.values()];
export const defsIn = (category) => allDefs().filter((d) => d.category === category);
export const slotDefs = (slot) => allDefs().filter((d) => d.slot === slot);

/** Look up a definition; custom presets saved in the project resolve onto their base. */
export function getDef(key, state) {
  if (REGISTRY.has(key)) return REGISTRY.get(key);
  const preset = state?.customDefs?.[key];
  if (preset && REGISTRY.has(preset.base)) {
    const base = REGISTRY.get(preset.base);
    return {
      ...base,
      key,
      name: preset.name,
      summary: preset.summary || base.summary,
      custom: true,
      params: base.params.map((p) => (p.key in (preset.params || {}) ? { ...p, default: preset.params[p.key] } : p)),
    };
  }
  return null;
}

export function paramsOf(part, def) {
  const out = {};
  for (const p of def.params) out[p.key] = p.default;
  return Object.assign(out, part?.params || {});
}

export const specsOf = (part, def) => def.specs(paramsOf(part, def), part) || [];
export const weightOf = (part, def) => Number(def.weight(paramsOf(part, def), part)) || 0;

export function buildPart(part, def) {
  const obj = def.build(paramsOf(part, def), part);
  obj.traverse((o) => { if (o.isMesh) o.userData.category = def.category; });
  return obj;
}

const boundsCache = new Map();
/** Local-space bounding box of a part's geometry (cached per definition + params). */
export function localBounds(part, def) {
  const key = def.key + JSON.stringify(paramsOf(part, def));
  let b = boundsCache.get(key);
  if (!b) {
    const obj = buildPart(part, def);
    obj.updateMatrixWorld(true);
    b = new THREE.Box3().setFromObject(obj);
    if (b.isEmpty()) b.set(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5));
    boundsCache.set(key, b);
    if (boundsCache.size > 500) boundsCache.delete(boundsCache.keys().next().value);
  }
  return b;
}

const piecesCache = new Map();
/** Local-space boxes of each mesh in a part — a tighter shape than one overall box (e.g. an L-shaped seat). */
export function localPieces(part, def) {
  const key = def.key + JSON.stringify(paramsOf(part, def));
  let list = piecesCache.get(key);
  if (!list) {
    const obj = buildPart(part, def);
    obj.updateMatrixWorld(true);
    list = [];
    obj.traverse((o) => { if (o.isMesh) { const b = new THREE.Box3().setFromObject(o); if (!b.isEmpty()) list.push(b); } });
    piecesCache.set(key, list);
    if (piecesCache.size > 500) piecesCache.delete(piecesCache.keys().next().value);
  }
  return list;
}

export const partMatrix = (part) => matrixFrom(part.pos, part.rot);

export function portsWorld(part, def) {
  const m = partMatrix(part);
  const out = {};
  const ports = def.ports(paramsOf(part, def), part) || {};
  for (const [k, p] of Object.entries(ports)) out[k] = V(p).applyMatrix4(m);
  return out;
}

export function envelopeOf(part, def) {
  const s = localBounds(part, def).getSize(new THREE.Vector3());
  return { L: s.x, W: s.y, H: s.z };
}

export function partsByRole(state, role) {
  return Object.values(state.parts).filter((p) => getDef(p.def, state)?.role === role);
}
