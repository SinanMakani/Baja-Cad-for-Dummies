// Driver body model. Each team driver is entered by name, height, weight and
// gender; segment lengths are estimated as fractions of standing height
// (averages from military anthropometric surveys, ANSUR) and body girth from
// body-mass index. Any estimate can be replaced with a value measured on the
// actual driver. Lengths in inches, weight in pounds.

export const SEXES = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'unspecified', label: 'Not specified' },
];

// Fractions of standing height. hipW is the seated hip width at bmiRef
// (it grows with the square root of BMI); head is a head-radius offset.
const PROP = {
  male: { sitHeight: 0.517, shoulderH: 0.338, shoulderWidth: 0.226, thigh: 0.252, shank: 0.254, upperArm: 0.192, forearm: 0.206, hipJoints: 0.104, hipW: 0.217, bmiRef: 27, head: 0 },
  female: { sitHeight: 0.523, shoulderH: 0.339, shoulderWidth: 0.222, thigh: 0.255, shank: 0.252, upperArm: 0.188, forearm: 0.203, hipJoints: 0.108, hipW: 0.245, bmiRef: 25, head: -0.1 },
};
PROP.unspecified = Object.fromEntries(Object.keys(PROP.male).map((k) => [k, (PROP.male[k] + PROP.female[k]) / 2]));

/** Body measurements a team can measure and enter instead of the estimate. */
export const MEASURES = [
  { key: 'sitHeight', label: 'Sitting height', hint: 'Seat to the top of the head, sitting upright' },
  { key: 'shoulderH', label: 'Shoulder height, sitting', hint: 'Seat to the top of the shoulder' },
  { key: 'shoulderWidth', label: 'Shoulder width', hint: 'Across the shoulders, bone to bone' },
  { key: 'hipWidth', label: 'Hip width, sitting', hint: 'Widest point across the hips while seated' },
  { key: 'thigh', label: 'Hip to knee', hint: 'Hip joint to the center of the knee' },
  { key: 'shank', label: 'Knee to ankle', hint: 'Center of the knee to the ankle bone' },
  { key: 'upperArm', label: 'Shoulder to elbow' },
  { key: 'forearm', label: 'Elbow to grip', hint: 'Elbow to the center of a closed fist' },
];

export const HEIGHT_RANGE = [48, 84]; // 4' 0" – 7' 0"
export const WEIGHT_RANGE = [70, 400];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** 70 → 5' 10"   (rounded to the nearest half inch) */
export function fmtHeight(inches) {
  if (!Number.isFinite(inches)) return '—';
  const r = Math.round(inches * 2) / 2;
  const ft = Math.floor(r / 12);
  const inch = +(r - ft * 12).toFixed(1);
  return `${ft}' ${inch}"`;
}

export const sexLabel = (sex) => SEXES.find((s) => s.value === sex)?.label ?? 'Not specified';

/** "Male · 5' 10" · 175 lb" */
export function driverSummary(d) {
  return `${sexLabel(d.sex)} · ${fmtHeight(d.height)} · ${Math.round(d.weight)} lb`;
}

/** Measured values the user entered (positive numbers only). */
export function measuredOf(d) {
  const out = {};
  for (const { key } of MEASURES) {
    const v = d.measure?.[key];
    if (Number.isFinite(v) && v > 0) out[key] = v;
  }
  return out;
}

/** Estimates from height, weight and gender alone. */
export function estimateBody(d) {
  const P = PROP[d.sex] || PROP.unspecified;
  const H = clamp(Number(d.height) || 70, ...HEIGHT_RANGE);
  const W = clamp(Number(d.weight) || 175, ...WEIGHT_RANGE);
  const bmi = (703 * W) / (H * H);
  return {
    H, W, bmi, P,
    sitHeight: P.sitHeight * H,
    shoulderH: P.shoulderH * H,
    shoulderWidth: P.shoulderWidth * H,
    hipWidth: P.hipW * H * Math.sqrt(bmi / P.bmiRef),
    thigh: P.thigh * H,
    shank: P.shank * H,
    upperArm: P.upperArm * H,
    forearm: P.forearm * H,
  };
}

/**
 * Everything the seated-driver model needs, from a roster entry:
 * segment lengths, widths, head size, girth (limb/torso thickness factor),
 * and which values were measured rather than estimated.
 */
export function driverBody(d) {
  const est = estimateBody(d);
  const measured = measuredOf(d);
  const m = { ...est, ...measured };
  // Keep the pose solvable when a measured value is far off the estimate.
  const shoulderH = clamp(m.shoulderH, 0.45 * m.sitHeight, 0.8 * m.sitHeight);
  return {
    id: d.id,
    label: (d.name || '').trim() || 'Driver',
    sex: d.sex,
    height: est.H,
    weight: est.W,
    bmi: est.bmi,
    girth: clamp(Math.sqrt(est.bmi / 24), 0.8, 1.45),
    sitHeight: m.sitHeight,
    shoulderH,
    shoulderHalf: m.shoulderWidth / 2,
    hipHalf: (est.P.hipJoints * est.H) / 2,
    hipWidth: m.hipWidth,
    thigh: m.thigh,
    shank: m.shank,
    upperArm: m.upperArm,
    forearm: m.forearm,
    headR: 4.45 + 0.025 * (est.H - 69) + est.P.head,
    summary: driverSummary({ ...d, height: est.H, weight: est.W }),
    measured: Object.keys(measured),
    estimates: Object.fromEntries(MEASURES.map(({ key }) => [key, est[key]])),
  };
}

/** A new roster entry. */
export function makeDriver(id, { name, sex = 'male', height = 70, weight = 175 } = {}) {
  return { id, name: name || `Driver ${String(id).replace(/\D/g, '') || 1}`, sex, height, weight, measure: {} };
}

export function defaultErgonomics() {
  return { drivers: [makeDriver('D1')], driverId: 'D1', checkAll: true, showDriver: true, includeDriverInCG: true };
}

/** The roster entry currently posed in the car. */
export function activeDriver(state) {
  const e = state.ergonomics || {};
  const list = Array.isArray(e.drivers) ? e.drivers : [];
  return list.find((d) => d.id === e.driverId) || list[0] || makeDriver('D1');
}

/**
 * Bring an ergonomics block up to the roster format. Projects saved with the
 * old fixed design drivers keep the same body size as an editable driver.
 */
export function migrateErgonomics(state) {
  const e = (state.ergonomics ??= {});
  if (!Array.isArray(e.drivers) || !e.drivers.length) {
    const legacy = { '5F': { sex: 'female', height: 60, weight: 110 }, '50M': { sex: 'male', height: 69.1, weight: 172 }, '95M': { sex: 'male', height: 74, weight: 216 } }[e.driver];
    e.drivers = [makeDriver('D1', legacy)];
    e.driverId = 'D1';
  }
  delete e.driver;
  e.drivers = e.drivers.filter((d) => d && typeof d === 'object').map((d, i) => ({
    id: d.id || `D${i + 1}`,
    name: typeof d.name === 'string' ? d.name : `Driver ${i + 1}`,
    sex: SEXES.some((s) => s.value === d.sex) ? d.sex : 'unspecified',
    height: Number.isFinite(d.height) ? d.height : 70,
    weight: Number.isFinite(d.weight) ? d.weight : 175,
    measure: d.measure && typeof d.measure === 'object' ? d.measure : {},
  }));
  if (!e.drivers.length) e.drivers = [makeDriver('D1')];
  if (!e.drivers.some((d) => d.id === e.driverId)) e.driverId = e.drivers[0].id;
  e.checkAll ??= true;
  e.showDriver ??= true;
  e.includeDriverInCG ??= true;
  state.seq ??= {};
  const top = Math.max(0, ...e.drivers.map((d) => parseInt(String(d.id).replace(/\D/g, ''), 10) || 0));
  state.seq.D = Math.max(state.seq.D || 0, top);
  return e;
}
