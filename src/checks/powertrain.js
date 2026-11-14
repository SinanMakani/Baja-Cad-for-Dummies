import * as THREE from 'three';
import { registerCheck } from './index.js';
import { fmtLen, fmtAngle } from '../core/units.js';
import { getDef, paramsOf } from '../catalog/index.js';
import { pointObbDist } from '../core/geom.js';

const P = 'powertrain';
const byRole = (st, role) => Object.values(st.parts).find((p) => getDef(p.def, st)?.role === role);

registerCheck({
  id: 'pt.present', category: P, label: 'Powertrain components present',
  run(st) {
    const out = [];
    if (!byRole(st, 'engine')) out.push({ severity: 'warning', title: 'No engine placed', detail: 'Add the engine from Powertrain ▸ Engine. With Auto-link on it mounts to the CVT primary.' });
    if (!byRole(st, 'cvt')) out.push({ severity: 'warning', title: 'No CVT placed', detail: 'Add a CVT; it rides on the gearbox input shaft at its center-line angle.' });
    if (!byRole(st, 'gearbox')) out.push({ severity: 'warning', title: 'No gearbox placed', detail: 'Add a gearbox and put its output on the rear-axle line; CV axles connect automatically.' });
    const cvt = byRole(st, 'cvt');
    if (cvt && !paramsOf(cvt, getDef(cvt.def, st)).showGuard) out.push({ severity: 'info', title: 'CVT guard hidden', detail: 'A CVT guard is required on the car; keep it modeled so packaging checks see it.', targets: [{ kind: 'part', id: cvt.id }] });
    if (!st.powertrain?.autoLink && byRole(st, 'engine') && byRole(st, 'cvt')) out.push({ severity: 'info', title: 'Powertrain auto-link is off', detail: 'Engine, CVT and gearbox are placed independently — check shaft alignment yourself.' });
    return out;
  },
});

registerCheck({
  id: 'pt.cv', category: P, label: 'CV axle angles and plunge',
  run(st, A) {
    const out = [];
    for (const [list, name] of [[A.pt?.cv || [], 'Rear'], [A.pt?.frontCv || [], 'Front']]) {
      const cv = list[0];
      if (!cv) continue;
      const worst = Math.max(cv.maxIn, cv.maxOut);
      if (worst > 30) out.push({ severity: 'warning', title: `${name} CV joints reach ${fmtAngle(worst)} through travel`, detail: 'Most Baja-size CV joints are rated for roughly 25–30° of working angle (check yours). Align the gearbox output with the wheel center or reduce travel.', targets: [{ kind: 'axle', id: name === 'Rear' ? 'rear' : 'front' }] });
      else if (Math.max(cv.staticIn, cv.staticOut) > 15) out.push({ severity: 'info', title: `${name} CV static angle is ${fmtAngle(Math.max(cv.staticIn, cv.staticOut))}`, detail: 'Joints last longest near 0° at ride height. Put the gearbox output closer to the wheel-center height.', targets: [{ kind: 'axle', id: name === 'Rear' ? 'rear' : 'front' }] });
      if (cv.plunge > 2.0) out.push({ severity: 'warning', title: `${name} half-shaft plunges ${fmtLen(cv.plunge)} through travel`, detail: 'Check that your plunging CV joint allows this much length change.', targets: [{ kind: 'axle', id: name === 'Rear' ? 'rear' : 'front' }] });
    }
    if (A.pt?.fdNoOutput) out.push({ severity: 'warning', title: 'Front differential has no drive', detail: 'Turn on "Front output (4WD)" on the gearbox to generate the driveshaft.', fix: { label: 'Enable gearbox front output', apply: (s) => { const gb = byRole(s, 'gearbox'); if (gb) gb.params = { ...gb.params, frontOutput: true }; } } });
    if (A.pt?.driveshaft && A.pt.driveshaft.angle > 15) out.push({ severity: 'warning', title: `Driveshaft runs at ${fmtAngle(A.pt.driveshaft.angle)} to the car's axis`, detail: 'Large U-joint angles cause vibration and wear. Align the front differential input with the gearbox front output.' });
    return out;
  },
});

registerCheck({
  id: 'pt.fuel', category: P, label: 'Fuel tank location',
  run(st, A) {
    const tank = byRole(st, 'fuelTank');
    if (!tank) return [{ severity: 'info', title: 'No fuel tank placed', detail: 'Add the fuel tank to check its location against the cockpit and exhaust.' }];
    const out = [];
    const t = [{ kind: 'part', id: tank.id }];
    const obb = A.parts[tank.id]?.obb;
    const ex = A.pt?.enginePorts?.exhaust;
    if (obb && ex) {
      const d = pointObbDist(ex, obb);
      if (d < 6) out.push({ severity: 'warning', title: `Fuel tank is ${fmtLen(Math.max(0, d))} from the exhaust`, detail: 'Keep fuel well away from the muffler and add a heat shield (about 6 in or more is a reasonable target).', targets: t });
    }
    const seat = byRole(st, 'seat');
    const bp = byRole(st, 'brakePedal');
    if (seat && obb) {
      const back = A.ergo?.pose?.shoulderC?.x ?? seat.pos[0];
      const front = bp ? bp.pos[0] : back + 40;
      const c = obb.center;
      if (c.x > Math.min(back, front) && c.x < Math.max(back, front) && Math.abs(c.y) < 16) {
        out.push({ severity: 'error', title: 'Fuel tank is inside the cockpit', detail: 'Mount the tank behind the firewall, outside the driver compartment.', targets: t });
      }
    }
    if (A.hull && obb && !A.hull.containsPoint(obb.center)) out.push({ severity: 'warning', title: 'Fuel tank is outside the frame', detail: 'Keep the tank inside the frame envelope so the frame protects it in a rollover.', targets: t });
    return out;
  },
});

registerCheck({
  id: 'pt.envelope', category: P, label: 'Engine inside the frame',
  run(st, A) {
    const eng = byRole(st, 'engine');
    if (!eng || !A.hull) return [];
    const obb = A.parts[eng.id]?.obb;
    if (!obb) return [];
    if (!A.hull.containsPoint(obb.center)) return [{ severity: 'error', title: 'Engine sits outside the frame', detail: 'Move the gearbox/CVT (the engine follows when auto-linked) so the engine is inside the frame envelope.', targets: [{ kind: 'part', id: eng.id }] }];
    const corners = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const p = obb.center.clone();
      obb.axes.forEach((ax, i) => p.addScaledVector(ax, [sx, sy, sz][i] * obb.half[i]));
      corners.push(p);
    }
    const outside = corners.filter((p) => !A.hull.containsPoint(p)).length;
    return outside ? [{ severity: 'info', title: `Engine envelope pokes outside the frame (${outside} of 8 corners)`, detail: 'Fine if only covers or the recoil stick out, but check rollover protection.', targets: [{ kind: 'part', id: eng.id }] }] : [];
  },
});

registerCheck({
  id: 'pt.firewall', category: P, label: 'Firewall between driver and engine/fuel',
  run(st, A) {
    const seat = byRole(st, 'seat'), eng = byRole(st, 'engine');
    if (!seat || !eng) return [];
    const fw = Object.values(st.parts).filter((p) => getDef(p.def, st)?.role === 'firewall');
    if (!fw.length) return [{ severity: 'warning', title: 'No firewall', detail: 'Add a firewall panel between the driver and the engine and fuel tank (Hardware ▸ Safety).' }];
    const hx = A.ergo?.pose?.H?.x ?? seat.pos[0];
    const ex = A.parts[eng.id]?.center?.x ?? eng.pos[0];
    const between = fw.some((p) => {
      const x = A.parts[p.id]?.center?.x ?? p.pos[0];
      return (x - hx) * (x - ex) < 0;
    });
    return between ? [] : [{ severity: 'warning', title: 'Firewall is not between the driver and the engine', detail: 'Move the firewall so it separates the cockpit from the engine bay.', targets: fw.map((p) => ({ kind: 'part', id: p.id })) }];
  },
});

export { THREE };
