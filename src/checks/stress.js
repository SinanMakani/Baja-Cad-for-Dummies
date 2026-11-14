import { registerCheck } from './index.js';
import { stressStatus, gateLocked } from '../systems/stresstest.js';
import { fmtNum } from '../core/units.js';

registerCheck({
  id: 'chassis.stress', category: 'chassis', label: 'Frame stress tests',
  run(st) {
    if (!Object.keys(st.chassis.members).length) return [];
    const status = stressStatus(st);
    const locked = gateLocked(st);
    const s = st.stress?.settings || {};
    const how = 'Open Chassis ▸ Stress test and run the tests.';
    if (status === 'none') {
      return [{
        severity: locked ? 'warning' : 'info',
        title: locked ? 'Frame not stress-tested yet — other systems are locked' : 'Frame has not been stress-tested',
        detail: `${how}${locked ? ' Suspension, ergonomics and powertrain unlock when every case passes.' : ''}`,
      }];
    }
    const left = st.stress?.last?.left || [];
    const leftOut = status !== 'stale' && left.length ? [{
      severity: 'warning',
      title: left.length === 1 ? '1 tube isn\'t connected to the main frame' : `${left.length} tubes aren't connected to the main frame`,
      detail: 'The stress tests ran on the main frame and left these tubes out. Join them to the frame (or delete them) so they carry load.',
      targets: left.map((id) => ({ kind: 'member', id })),
    }] : [];
    if (status === 'stale') {
      return [{ severity: 'warning', title: 'Frame changed since the last stress test', detail: `The last results no longer match the frame or test settings. ${how}` }];
    }
    if (status === 'fail') {
      return [...leftOut, ...st.stress.last.cases.filter((c) => !c.pass).map((c) => {
        if (!c.ok) return { severity: 'error', title: `${c.name} could not be analyzed`, detail: c.error };
        const yieldFail = c.minFos < s.fosYield;
        return {
          severity: 'error',
          title: yieldFail ? `${c.name}: tube ${c.minFosMember} reaches FoS ${fmtNum(c.minFos, 2)}` : `${c.name}: tube ${c.minBuckMember} may buckle (FoS ${fmtNum(c.minBuck, 2)})`,
          detail: yieldFail
            ? `Target is ${s.fosYield}. Add a brace or gusset near that tube, shorten its span, or use a heavier wall.`
            : `Buckling target is ${s.fosBuckling}. Brace the tube at mid-length or use a larger diameter.`,
          targets: [{ kind: 'member', id: yieldFail ? c.minFosMember : c.minBuckMember }],
        };
      })];
    }
    return leftOut;
  },
});
