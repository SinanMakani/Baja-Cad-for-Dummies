import * as THREE from 'three';
import { registerCheck } from './index.js';
import { V, segPoint } from '../core/geom.js';
import { fmtLen, fmtAngle, fmtNum } from '../core/units.js';
import { typeOf, tireData, shockData, shiftAxle, idealTieRodZ, contactPatch } from '../systems/suspension.js';
import { nearestMember } from '../systems/chassis.js';

const D = 'dynamics';
const AX = { front: 'Front', rear: 'Rear' };

function tireHits(pose, tire, segs, side) {
  const s = side === 'L' ? 1 : -1;
  const wc = pose.pts.WC.clone(); wc.y *= s;
  const a = pose.axis.clone(); a.y *= s;
  const R = tire.diameter / 2, hw = tire.width / 2;
  let worst = null;
  for (const seg of segs) {
    const n = Math.max(2, Math.ceil(seg.a.distanceTo(seg.b) / 0.5));
    for (let i = 0; i <= n; i++) {
      const p = seg.a.clone().lerp(seg.b, i / n);
      const v = p.clone().sub(wc);
      const ax = v.dot(a);
      const rad = v.addScaledVector(a, -ax).length();
      const pen = Math.min(hw + seg.r - Math.abs(ax), R + seg.r - rad);
      if (pen > 0.05 && (!worst || pen > worst.pen)) worst = { pen, member: seg.id };
    }
  }
  return worst;
}

registerCheck({
  id: 'dyn.solver', category: D, label: 'Suspension moves through travel',
  run(st, A) {
    if (!A.susp) return [{ severity: 'error', title: 'Suspension could not be analyzed', detail: 'Check hardpoints for missing or duplicate points.' }];
    const out = [];
    for (const k of ['front', 'rear']) {
      const s = A.susp[k];
      if (!s.ok) {
        const bad = s.sweep.filter((r) => !r.ok).map((r) => r.z);
        out.push({ severity: 'error', title: `${AX[k]} suspension binds at ${fmtLen(Math.max(...bad.map(Math.abs)))} of travel`, detail: 'The links cannot reach at that wheel position. Lengthen the short links, reduce travel, or move pivots so the arms stay clear of lock-up.', targets: [{ kind: 'axle', id: k }] });
      }
    }
    return out;
  },
});

registerCheck({
  id: 'dyn.ground', category: D, label: 'Tires on the ground',
  run(st, A) {
    const out = [];
    for (const k of ['front', 'rear']) {
      const g = A.susp?.[k]?.stat;
      if (!g) continue;
      const z = g.cp.z;
      if (Math.abs(z) > 0.25) {
        out.push({
          severity: 'warning', title: `${AX[k]} tires ${z > 0 ? 'float' : 'sink'} ${fmtLen(Math.abs(z))} ${z > 0 ? 'above' : 'below'} the ground`,
          detail: 'Ground is Z = 0. Move the wheel center (and upright points) down/up by that amount or change the tire size.',
          targets: [{ kind: 'hardpoint', id: `${k}.WC` }],
          fix: { label: 'Set tires on the ground', apply: (s) => shiftAxle(s.suspension[k], [0, 0, -z], 'upright') },
        });
      }
    }
    return out;
  },
});

registerCheck({
  id: 'dyn.tireframe', category: D, label: 'Tire clearance to frame',
  run(st, A) {
    const out = [];
    for (const k of ['front', 'rear']) {
      const s = A.susp?.[k];
      if (!s) continue;
      const tire = tireData(st.suspension[k], st);
      const bumpRow = s.sweep.at(-1);
      for (const [label, pose] of [['static', s.pose0], ['full bump', bumpRow?.pose]]) {
        if (!pose) continue;
        const hit = tireHits(pose, tire, A.segs, 'L');
        if (hit) {
          out.push({ severity: 'error', title: `${AX[k]} tire hits tube ${hit.member} at ${label}`, detail: `Overlap ≈ ${fmtLen(hit.pen)}. Move the tube, narrow the frame, widen the track, or reduce travel.`, targets: [{ kind: 'member', id: hit.member }, { kind: 'axle', id: k }] });
          break;
        }
      }
    }
    return out;
  },
});

registerCheck({
  id: 'dyn.mounts', category: D, label: 'Pivots have frame to mount to',
  run(st, A) {
    if (!A.segs.length) return [];
    const out = [];
    for (const k of ['front', 'rear']) {
      const axle = st.suspension[k];
      const T = typeOf(axle);
      for (const [pk, d] of Object.entries(T.points)) {
        if (d.body !== 'chassis' || !axle.points[pk]) continue;
        const near = nearestMember(A.segs, V(axle.points[pk]));
        if (near && near.dist > 2.0) {
          out.push({ severity: 'warning', title: `${AX[k]} ${d.label.toLowerCase()} floats ${fmtLen(near.dist)} from the frame`, detail: `Nearest tube is ${near.id}. Add a mount tube, tab or bracket there — or move the pivot onto the frame.`, targets: [{ kind: 'hardpoint', id: `${k}.${pk}` }, { kind: 'member', id: near.id }] });
        }
      }
    }
    return out;
  },
});

registerCheck({
  id: 'dyn.frontgeom', category: D, label: 'Front geometry ranges',
  run(st, A) {
    const g = A.susp?.front?.stat;
    if (!g || g.kpi == null) return [];
    const out = [];
    const t = [{ kind: 'axle', id: 'front' }];
    if (g.kpi > 12) out.push({ severity: 'warning', title: `High kingpin inclination (${fmtAngle(g.kpi)})`, detail: 'Above ~12° steering gets heavy and camber changes a lot with steer. Move the upper ball joint outboard or the lower inboard.', targets: t });
    if (g.caster < 0) out.push({ severity: 'warning', title: `Negative caster (${fmtAngle(g.caster)})`, detail: 'The steering will not self-center. Move the upper ball joint rearward relative to the lower.', targets: t });
    if (g.caster > 15) out.push({ severity: 'info', title: `High caster (${fmtAngle(g.caster)})`, detail: 'Good self-centering but heavy steering; watch steering effort.', targets: t });
    if (g.trail < 0) out.push({ severity: 'warning', title: `Negative mechanical trail (${fmtLen(g.trail)})`, detail: 'The kingpin axis meets the ground behind the contact patch — steering becomes unstable.', targets: t });
    if (Math.abs(g.scrub) > 3) out.push({ severity: 'info', title: `Large scrub radius (${fmtLen(g.scrub)})`, detail: 'Bumps and braking will kick the steering wheel. Push the ball joints outboard into the wheel or add wheel offset.', targets: t });
    return out;
  },
});

registerCheck({
  id: 'dyn.bumpsteer', category: D, label: 'Bump steer',
  run(st, A) {
    const out = [];
    for (const k of ['front', 'rear']) {
      const s = A.susp?.[k];
      if (!s || !s.ok) continue;
      const axle = st.suspension[k];
      // Allow about 0.25° per inch of total travel (min 1°) before flagging.
      if (s.toeRange > Math.max(1.0, 0.25 * ((axle.bump ?? 0) + (axle.droop ?? 0)))) {
        const z = k === 'front' && typeOf(axle).steer ? idealTieRodZ(axle, st) : null;
        out.push({
          severity: 'warning', title: `${AX[k]} bump steer: ${fmtAngle(s.toeRange, 2)} of toe change`,
          detail: `Across ${fmtLen(axle.droop)} droop to ${fmtLen(axle.bump)} bump (${fmtNum(s.bumpSteer ?? 0, 2)}°/in at ride height).` + (z != null ? ` Moving the inner tie rod to Z = ${fmtLen(z)} lines it up with the arms' instant center.` : ' Adjust camber-link inner heights so the links stay parallel to each other.'),
          targets: [{ kind: 'hardpoint', id: `${k}.${k === 'front' ? 'TR_I' : 'CLU_I'}` }],
          fix: z != null ? { label: `Move tie-rod inner to Z ${fmtLen(z)}`, apply: (st2) => { st2.suspension[k].points.TR_I[2] = +z.toFixed(3); } } : undefined,
        });
      }
    }
    return out;
  },
});

registerCheck({
  id: 'dyn.shock', category: D, label: 'Shock length and stroke',
  run(st, A) {
    const out = [];
    for (const k of ['front', 'rear']) {
      const s = A.susp?.[k];
      if (!s || s.shockStatic == null) continue;
      const sh = shockData(st.suspension[k], st);
      const comp = sh.extended - sh.stroke;
      const t = [{ kind: 'hardpoint', id: `${k}.SH_U` }, { kind: 'hardpoint', id: `${k}.SH_L` }];
      if (s.shockStatic > sh.extended + 0.05 || s.shockStatic < comp - 0.05) {
        out.push({ severity: 'error', title: `${AX[k]} shock doesn't fit its mounts`, detail: `Mount-to-mount distance at ride height is ${fmtLen(s.shockStatic)}; the shock works between ${fmtLen(comp)} and ${fmtLen(sh.extended)}. Move a mount or pick another shock.`, targets: t });
        continue;
      }
      if (s.shockMin < comp - 0.05) out.push({ severity: 'warning', title: `${AX[k]} shock bottoms before full bump`, detail: `Full bump needs ${fmtLen(s.shockMin)} eye-to-eye, shock stops at ${fmtLen(comp)}. Available bump ≈ ${fmtLen((s.shockStatic - comp) / Math.max(0.1, s.motionRatio || 1))}.`, targets: t });
      if (s.shockMax > sh.extended + 0.05) out.push({ severity: 'warning', title: `${AX[k]} shock tops out before full droop`, detail: `Full droop needs ${fmtLen(s.shockMax)}, shock extends to ${fmtLen(sh.extended)}. The shock will limit droop to ≈ ${fmtLen((sh.extended - s.shockStatic) / Math.max(0.1, s.motionRatio || 1))}.`, targets: t });
      const sag = (sh.extended - s.shockStatic) / sh.stroke;
      if (sag < 0.15 || sag > 0.5) out.push({ severity: 'info', title: `${AX[k]} ride height uses ${(sag * 100).toFixed(0)}% of shock stroke`, detail: 'Most off-road setups sit around 25–35% of stroke at ride height so the wheel can drop into holes.', targets: t });
      if (s.motionRatio != null && s.motionRatio < 0.4) out.push({ severity: 'info', title: `${AX[k]} motion ratio is low (${fmtNum(s.motionRatio, 2)})`, detail: 'The shock moves less than half the wheel travel, so it needs a very stiff spring. Move the lower mount outboard or make the shock more vertical.', targets: t });
    }
    return out;
  },
});

registerCheck({
  id: 'dyn.rim', category: D, label: 'Ball joints and links inside the wheel',
  run(st, A) {
    const out = [];
    for (const k of ['front', 'rear']) {
      const axle = st.suspension[k];
      const g = A.susp?.[k]?.stat;
      if (!g) continue;
      const tire = tireData(axle, st);
      const rimR = tire.rim / 2 - 0.35;
      for (const [pk, d] of Object.entries(typeOf(axle).points)) {
        if (d.body !== 'upright' || pk === 'WC' || !axle.points[pk]) continue;
        const v = V(axle.points[pk]).sub(g.wc);
        const ax = v.dot(g.axis);
        const rad = v.addScaledVector(g.axis, -ax).length();
        if (ax > -tire.rimWidth / 2 && rad > rimR) {
          out.push({ severity: 'warning', title: `${AX[k]} ${d.label.toLowerCase()} may hit the wheel`, detail: `It sits ${fmtLen(rad)} from the axle inside the wheel barrel (rim inner radius ≈ ${fmtLen(rimR)}). Move it inward or inboard.`, targets: [{ kind: 'hardpoint', id: `${k}.${pk}` }] });
        }
      }
    }
    return out;
  },
});

registerCheck({
  id: 'dyn.steering', category: D, label: 'Steering',
  run(st, A) {
    const f = A.susp?.front;
    if (!f?.steer) return [];
    const out = [];
    const t = [{ kind: 'axle', id: 'front' }];
    if (!f.steer.ok) out.push({ severity: 'warning', title: 'Steering binds before full rack travel', detail: 'Reduce rack travel or lengthen the steering arm.', targets: t });
    if (st.suspension.steering.travel > f.rack.travel + 1e-6) out.push({ severity: 'warning', title: 'Rack travel exceeds the rack model', detail: `Set to ±${fmtLen(st.suspension.steering.travel)} but the rack allows ±${fmtLen(f.rack.travel)}.`, targets: t });
    if (f.steer.outerMax < 20) out.push({ severity: 'info', title: `Turning circle ${(f.steer.turningDia / 12).toFixed(1)} ft (outer wheel ${fmtAngle(f.steer.outerMax)})`, detail: 'Tight endurance courses reward more lock. Lengthen rack travel or shorten the steering arm.', targets: t });
    if (f.steer.ackermann < -10) out.push({ severity: 'info', title: `Reverse Ackermann (${f.steer.ackermann.toFixed(0)}%)`, detail: 'The outer wheel steers more than the inner. Angle the steering arms toward the rear-axle center to add Ackermann.', targets: t });
    return out;
  },
});

registerCheck({
  id: 'dyn.rc', category: D, label: 'Roll center and arms',
  run(st, A) {
    const out = [];
    for (const k of ['front', 'rear']) {
      const g = A.susp?.[k]?.stat;
      if (!g) continue;
      if (g.rcHeight != null && g.rcHeight < 0) out.push({ severity: 'info', title: `${AX[k]} roll center below ground (${fmtLen(g.rcHeight)})`, detail: 'Expect more body roll. Angle the upper arm/link more steeply than the lower to raise it.', targets: [{ kind: 'axle', id: k }] });
      if (g.lcaLength != null && g.lcaLength < 8) out.push({ severity: 'info', title: `${AX[k]} lower arm is short (${fmtLen(g.lcaLength)})`, detail: 'Short arms give large camber change and track change through travel.', targets: [{ kind: 'axle', id: k }] });
    }
    return out;
  },
});

export { contactPatch, THREE, segPoint };
