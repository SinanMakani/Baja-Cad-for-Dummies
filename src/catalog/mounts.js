// Typical mounting spots used when a part is added with the "Add" button
// (dragging onto the car places it where you drop it instead). Positions
// match the starter frame; parts without an entry land beside the car.
import { getDef } from './index.js';

const SEAT = { pos: [24, 0, 10.75] };
const MOUNTS = {
  'erg.seat.al': SEAT, 'erg.seat.fg': SEAT, 'erg.seat.cf': SEAT, 'erg.seat.custom': SEAT,
  'erg.pedal.brake': { pos: [67, 3, 10.25] },
  'erg.pedal.throttle': { pos: [67, -3.5, 10.25] },
  'erg.steeringwheel': { pos: [42, 0, 38], rot: [0, 20, 0] },
  'erg.harness5': { pos: [29.6, 0, 15.3] },
  'pt.gearbox.2stage': { pos: [0, 0, 11] },
  'pt.gearbox.chain': { pos: [0, 0, 11] },
  'pt.fueltank': { pos: [8, -11.3, 19.25] },
  'pt.frontdiff': { pos: [58, 0, 11.5] },
  'pt.airfilter': { pos: [-8, -4, 31] },
  'ch.skidplate': { pos: [44, 0, 9.375] },
  'ch.engineplate': { pos: [6, -4, 18.9] },
  'hw.firewall': { pos: [13.2, 0, 10.5] },
  'hw.killswitch.cockpit': { pos: [52, 5, 27.6] },
  'hw.killswitch.external': { pos: [-12, 6, 25.6] },
  'hw.brakelight': { pos: [-12.6, 0, 26.4] },
  'hw.extinguisher': { pos: [17, -12, 26] },
  'hw.battery': { pos: [-11, -5, 25.625] },
  'hw.transponder': { pos: [-13, 9, 12] },
};

export function applyDefaultMounts() {
  for (const [key, m] of Object.entries(MOUNTS)) {
    const d = getDef(key);
    if (!d) continue;
    d.defaultPos = m.pos;
    if (m.rot) d.defaultRot = m.rot;
  }
}
