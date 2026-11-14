// Powertrain analysis: CV half-shafts, 4WD driveshaft, gearing, speed, torque.
import * as THREE from 'three';
import { DEG, angleDeg, quatFromDeg, V } from '../core/geom.js';
import { getDef, paramsOf, portsWorld } from '../catalog/index.js';
import { tireData } from './suspension.js';

export const HUB_CV_OFFSET = 2.75; // outboard CV center inboard of wheel center, in

function byRole(state, role) {
  return Object.values(state.parts).find((p) => getDef(p.def, state)?.role === role) || null;
}

function cvShaft(inboard, inAxis, sweepRows, side, hubOffset = HUB_CV_OFFSET) {
  // sweepRows are left-side poses; mirror for the right.
  const s = side === 'R' ? -1 : 1;
  const hub = (pose) => {
    // After mirroring, `a` points outboard on either side, so the CV sits at WC − a·offset.
    const wc = pose.pts.WC.clone(), a = pose.axis.clone();
    if (s < 0) { wc.y *= -1; a.y *= -1; }
    return { point: wc.clone().addScaledVector(a, -hubOffset), axis: a };
  };
  const rows = sweepRows.map((r) => {
    const h = hub(r.pose);
    const shaft = h.point.clone().sub(inboard);
    const inAng = angleDeg(shaft, inAxis.clone().multiplyScalar(s));
    const outAng = angleDeg(shaft, h.axis);
    return { z: r.z, length: shaft.length(), inAng, outAng, hub: h.point };
  });
  const r0 = rows.find((r) => r.z === 0) || rows[0];
  const lengths = rows.map((r) => r.length);
  return {
    side, inboard, outboard: r0.hub, length: r0.length,
    plunge: Math.max(...lengths) - Math.min(...lengths),
    staticIn: r0.inAng, staticOut: r0.outAng,
    maxIn: Math.max(...rows.map((r) => r.inAng)), maxOut: Math.max(...rows.map((r) => r.outAng)),
    rows,
  };
}

export function analyzePowertrain(state, susp) {
  const gb = byRole(state, 'gearbox');
  const cvt = byRole(state, 'cvt');
  const eng = byRole(state, 'engine');
  const fd = byRole(state, 'frontDiff');
  const tank = byRole(state, 'fuelTank');
  const out = { gb, cvt, eng, fd, tank, cv: [], frontCv: [], driveshaft: null };

  const gbp = gb ? paramsOf(gb, getDef(gb.def, state)) : null;
  const cvp = cvt ? paramsOf(cvt, getDef(cvt.def, state)) : null;
  const enp = eng ? paramsOf(eng, getDef(eng.def, state)) : null;

  if (gb && susp) {
    const ports = portsWorld(gb, getDef(gb.def, state));
    const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(quatFromDeg(gb.rot));
    out.gbPorts = ports;
    out.cv.push(cvShaft(ports.outL, axis, susp.rear.sweep, 'L'));
    out.cv.push(cvShaft(ports.outR, axis, susp.rear.sweep, 'R'));
    if (fd && gbp.frontOutput) {
      const fports = portsWorld(fd, getDef(fd.def, state));
      const d = fports.input.clone().sub(ports.front);
      const flat = new THREE.Vector3(d.x, d.y, 0);
      out.driveshaft = {
        a: ports.front, b: fports.input, length: d.length(),
        elevation: Math.atan2(d.z, flat.length()) / DEG,
        plan: Math.atan2(d.y, d.x) / DEG,
        angle: angleDeg(d, new THREE.Vector3(1, 0, 0)),
      };
      const faxis = new THREE.Vector3(0, 1, 0).applyQuaternion(quatFromDeg(fd.rot));
      out.frontCv.push(cvShaft(fports.outL, faxis, susp.front.sweep, 'L', 2.4));
      out.frontCv.push(cvShaft(fports.outR, faxis, susp.front.sweep, 'R', 2.4));
    } else if (fd && !gbp.frontOutput) {
      out.fdNoOutput = true;
    }
  }

  if (gbp && cvp) {
    const rearD = tireData(state.suspension.rear, state).diameter;
    const lo = cvp.lowRatio * gbp.ratio, hi = cvp.highRatio * gbp.ratio;
    const rpm = enp?.governedRpm ?? 3800, torque = enp?.torque ?? 14.5, eff = 0.85;
    out.gearing = {
      low: lo, high: hi,
      topSpeed: ((rpm / hi) * Math.PI * rearD * 60) / 63360,
      launchTorque: torque * lo * eff,
      tractive: (torque * lo * eff * 12) / (rearD / 2),
      eff,
    };
  }

  if (eng) out.enginePorts = portsWorld(eng, getDef(eng.def, state));
  return out;
}

export { V };
