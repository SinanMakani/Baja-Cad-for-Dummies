import { registerCheck } from './index.js';
import { fmtLen, fmtAngle } from '../core/units.js';
import { getDef, paramsOf } from '../catalog/index.js';

const E = 'ergonomics';
const byRole = (st, role) => Object.values(st.parts).find((p) => getDef(p.def, st)?.role === role);

registerCheck({
  id: 'erg.present', category: E, label: 'Seat, pedals, wheel present',
  run(st) {
    const out = [];
    const need = [
      ['seat', 'warning', 'No seat', 'Add a seat (Ergonomics ▸ Seats). The driver model and all ergonomics checks start from the seat.'],
      ['brakePedal', 'error', 'No brake pedal', 'Add the brake pedal — brake lines route from its master cylinders.'],
      ['throttlePedal', 'warning', 'No throttle pedal', 'Add the throttle pedal — the throttle cable routes from it to the engine.'],
      ['steeringWheel', 'warning', 'No steering wheel', 'Add a steering wheel; the column connects to the rack automatically.'],
    ];
    for (const [role, sev, title, detail] of need) if (!byRole(st, role)) out.push({ severity: sev, title, detail });
    const bp = byRole(st, 'brakePedal');
    if (bp && paramsOf(bp, getDef(bp.def, st)).mcCount < 2) {
      out.push({ severity: 'error', title: 'Brakes use a single hydraulic circuit', detail: 'Baja SAE requires at least two independent hydraulic circuits so one leak cannot take out all braking. Set the pedal to 2 master cylinders.', targets: [{ kind: 'part', id: bp.id }], fix: { label: 'Use 2 master cylinders', apply: (s) => { s.parts[bp.id].params = { ...s.parts[bp.id].params, mcCount: 2 }; } } });
    }
    if (!byRole(st, 'harness') && byRole(st, 'seat')) out.push({ severity: 'info', title: 'No harness modeled', detail: 'Add the 5-point harness to check belt mounting angles against the frame.' });
    return out;
  },
});

/** Drivers the checks cover: the whole roster, or only the posed driver. */
function checkedDrivers(st, A) {
  const list = st.ergonomics?.checkAll !== false && A.ergoAll?.length ? A.ergoAll : [A.ergo];
  return list.filter((e) => e?.pose);
}
// An issue about a driver who isn't posed offers to pose them.
function poseFix(st, e) {
  if ((st.ergonomics?.drivers?.length || 0) < 2 || e.driver.id === st.ergonomics.driverId) return undefined;
  return { label: `Pose ${e.driver.label}`, apply: (s) => { s.ergonomics.driverId = e.driver.id; } };
}

registerCheck({
  id: 'erg.clearance', category: E, label: 'Driver clearance to frame',
  run(st, A) {
    if (!A.segs.length) return [];
    const out = [];
    for (const e of checkedDrivers(st, A)) {
      const who = e.driver.label, fix = poseFix(st, e);
      const helmet = e.clearances.find((c) => c.name === 'helmet');
      if (helmet && helmet.dist < 6) {
        out.push({ severity: 'error', title: `${who}'s helmet is ${fmtLen(Math.max(0, helmet.dist))} from tube ${helmet.member}`, detail: `Helmets need about 6 in of clearance to the roll cage (verify the current rule). ${who}: ${e.driver.summary}. Raise the roof, lower or recline the seat, or move the tube.`, targets: [{ kind: 'member', id: helmet.member }], fix });
      }
      const body = e.clearances.filter((c) => c.name !== 'helmet' && c.dist < 3).sort((a, b) => a.dist - b.dist);
      if (body.length) {
        const w = body[0];
        out.push({ severity: w.dist < 0 ? 'error' : 'warning', title: `${who}'s ${w.name} ${w.dist < 0 ? 'intersects' : 'is ' + fmtLen(w.dist) + ' from'} tube ${w.member}`, detail: `${body.length > 1 ? `Also tight: ${body.slice(1, 5).map((b) => `${b.name} ${fmtLen(b.dist)}`).join(', ')}. ` : ''}Keep about 3 in between the driver and the frame (verify the current rule).`, targets: [...new Set(body.map((b) => b.member))].map((id) => ({ kind: 'member', id })), fix });
      }
      if (e.outside?.length) out.push({ severity: 'error', title: `${who} extends outside the frame: ${e.outside.join(', ')}`, detail: 'Every part of the seated driver must stay inside the roll cage envelope.', fix });
    }
    return out;
  },
});

registerCheck({
  id: 'erg.reach', category: E, label: 'Pedal and wheel reach',
  run(st, A) {
    const out = [];
    const wheel = byRole(st, 'steeringWheel');
    for (const e of checkedDrivers(st, A)) {
      const who = e.driver.label, fix = poseFix(st, e);
      for (const side of ['L', 'R']) {
        const leg = e.pose.legs[side];
        if (!leg.pedal) continue;
        const pedal = byRole(st, leg.pedal);
        const t = pedal ? [{ kind: 'part', id: pedal.id }] : [];
        const name = leg.pedal === 'brakePedal' ? 'brake pedal' : 'throttle';
        if (leg.reach > 0.98) out.push({ severity: 'error', title: `${who} can't reach the ${name}`, detail: `Needs ${(leg.reach * 100).toFixed(0)}% of ${who}'s leg length (${e.driver.summary}). Move the pedal back or the seat forward, or design for adjustable pedals.`, targets: t, fix });
        else if (leg.reach > 0.95) out.push({ severity: 'warning', title: `${who}'s ${side === 'L' ? 'left' : 'right'} leg is nearly straight on the ${name} (${(leg.reach * 100).toFixed(0)}% of leg length)`, detail: 'A driver needs some knee bend left to push the pedal through its travel and brake hard. Move the pedal back or the seat forward, or design for adjustable pedals.', targets: t, fix });
        else if (leg.angle < 95) out.push({ severity: 'warning', title: `${who}'s ${side === 'L' ? 'left' : 'right'} knee is cramped (${fmtAngle(leg.angle, 0)}) on the ${name}`, detail: 'Knee angles under about 95° are tiring and slow to react. Move the pedal forward or the seat back.', targets: t, fix });
      }
      if (wheel && e.pose.arms) {
        const worst = ['L', 'R'].map((s) => e.pose.arms[s]).sort((a, b) => b.reach - a.reach)[0];
        if (worst.reach > 0.97) out.push({ severity: 'warning', title: `The steering wheel is at ${who}'s arm's length`, detail: 'Arms are fully straight, so the driver cannot apply torque. Move the wheel toward the driver.', targets: [{ kind: 'part', id: wheel.id }], fix });
        const bent = Math.min(e.pose.arms.L.angle, e.pose.arms.R.angle);
        if (bent < 70) out.push({ severity: 'warning', title: `${who}'s elbows are tight (${fmtAngle(bent, 0)})`, detail: 'Move the wheel away from the driver so elbows sit around 90–120°.', targets: [{ kind: 'part', id: wheel.id }], fix });
        if (e.kneeWheel != null && e.kneeWheel < 1) out.push({ severity: 'warning', title: `${who}'s knees are ${fmtLen(Math.max(0, e.kneeWheel))} from the steering wheel`, detail: 'Knees hitting the wheel slow down getting out. Raise the wheel or move it forward, or lower the pedals.', targets: [{ kind: 'part', id: wheel.id }], fix });
      }
    }
    return out;
  },
});

registerCheck({
  id: 'erg.seatfit', category: E, label: 'Seat width fits the driver',
  run(st, A) {
    const out = [];
    for (const e of checkedDrivers(st, A)) {
      const f = e.seatFit;
      if (!f?.tight) continue;
      out.push({
        severity: 'warning',
        title: `${e.driver.label}'s hips (${fmtLen(f.hipWidth)}) are wider than the seat (${fmtLen(f.seatWidth)})`,
        detail: `${f.measured ? 'Measured' : 'Estimated from height and weight:'} seated hip width. Use a wider seat (Ergonomics ▸ Seat ▸ Width), or enter the driver's measured hip width under Body measurements.`,
        targets: e.seat ? [{ kind: 'part', id: e.seat.id }] : [],
        fix: poseFix(st, e),
      });
    }
    return out;
  },
});

registerCheck({
  id: 'erg.pedals', category: E, label: 'Pedal layout',
  run(st, A) {
    const out = [];
    const bp = byRole(st, 'brakePedal'), tp = byRole(st, 'throttlePedal');
    if (bp && tp) {
      const a = A.parts[bp.id]?.ports?.pad, b = A.parts[tp.id]?.ports?.pad;
      if (a && b && Math.abs(a.y - b.y) < 3) out.push({ severity: 'warning', title: `Brake and throttle pads are ${fmtLen(Math.abs(a.y - b.y))} apart`, detail: 'Leave room for a boot between pedals (about 3 in or more).', targets: [{ kind: 'part', id: bp.id }, { kind: 'part', id: tp.id }] });
    }
    if (A.hull) {
      for (const p of [bp, tp]) {
        if (!p) continue;
        const pad = A.parts[p.id]?.ports?.pad;
        if (pad && !A.hull.containsPoint(pad)) out.push({ severity: 'error', title: `${getDef(p.def, st).name} is outside the frame`, detail: "The driver's feet must stay inside the frame envelope.", targets: [{ kind: 'part', id: p.id }] });
      }
    }
    return out;
  },
});

registerCheck({
  id: 'erg.routing', category: E, label: 'Brake line and throttle cable routing',
  run(st, A) {
    const out = [];
    for (const r of A.routes?.routes || []) {
      if (!r.ok) { out.push({ severity: 'warning', title: `${r.label} could not be routed`, detail: 'Connect the frame so the start and end points share a path along the tubes.', targets: [{ kind: 'route', id: r.id }] }); continue; }
      if (r.kind === 'throttle' && r.bends?.total > 360) out.push({
        severity: r.bends.total > 540 ? 'warning' : 'info',
        title: `Throttle cable bends a total of ${fmtAngle(r.bends.total, 0)}`,
        detail: 'Cable friction grows with total bend angle, which can make the throttle slow to return. Use large-radius bends, or move the pedal or governor linkage so the cable runs straighter.',
        targets: [{ kind: 'route', id: r.id }],
      });
      if (r.kind === 'throttle' && r.cable > 120) out.push({ severity: 'info', title: `Throttle cable is ${fmtLen(r.cable)} long`, detail: 'Long cables stretch and add friction; check the governor return spring.', targets: [{ kind: 'route', id: r.id }] });
    }
    return out;
  },
});
