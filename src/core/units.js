// Imperial unit formatting and parsing. Every length in the model is stored in
// inches; every angle in degrees; every mass in pounds (lb).
//
// Inputs accept: 24.5 · 24.5in · 24 1/2 · 24-1/2 · 2' 6" · 2ft 6in · 3/8
// and, for convenience when copying supplier data, metric: 600mm · 60cm · 0.6m.
// Simple arithmetic also works: 24 + 1.25 · 3*12.

const prefs = { lengthFormat: 'decimal', precision: 3 };

export function setUnitPrefs(p) { Object.assign(prefs, p); }
export function getUnitPrefs() { return { ...prefs }; }

function gcd(a, b) { return b ? gcd(b, a % b) : a; }

function fraction(inches, denom = 16) {
  const sign = inches < 0 ? '-' : '';
  const v = Math.abs(inches);
  let whole = Math.floor(v);
  let num = Math.round((v - whole) * denom);
  if (num === denom) { whole += 1; num = 0; }
  if (num === 0) return `${sign}${whole}`;
  const g = gcd(num, denom);
  const frac = `${num / g}/${denom / g}`;
  return whole ? `${sign}${whole} ${frac}` : `${sign}${frac}`;
}

/** Format a length (inches) using the user's preferred style. */
export function fmtLen(inches, { unit = true, precision } = {}) {
  if (inches == null || !Number.isFinite(inches)) return '—';
  const p = precision ?? prefs.precision;
  if (prefs.lengthFormat === 'fraction') return `${fraction(inches)}${unit ? ' in' : ''}`;
  if (prefs.lengthFormat === 'ftin' && Math.abs(inches) >= 12) {
    const sign = inches < 0 ? '-' : '';
    const a = Math.abs(inches);
    const ft = Math.floor(a / 12 + 1e-9);
    return `${sign}${ft}′ ${fraction(a - ft * 12)}″`;
  }
  if (prefs.lengthFormat === 'ftin') return `${fraction(inches)}″`;
  return `${inches.toFixed(p)}${unit ? ' in' : ''}`;
}

/** Value shown inside editable inputs: always decimal so it is easy to edit. */
export function inputLen(inches) {
  if (inches == null || !Number.isFinite(inches)) return '';
  return String(+inches.toFixed(Math.max(prefs.precision, 3)));
}

export const fmtAngle = (deg, p = 1) => (Number.isFinite(deg) ? `${deg.toFixed(p)}°` : '—');
export const fmtWeight = (lb, p = 1) => (Number.isFinite(lb) ? `${lb.toFixed(p)} lb` : '—');
export const fmtNum = (v, p = 2) => (Number.isFinite(v) ? v.toFixed(p) : '—');
export const fmtPct = (v, p = 0) => (Number.isFinite(v) ? `${v.toFixed(p)}%` : '—');
export const fmtFt = (inches, p = 2) => (Number.isFinite(inches) ? `${(inches / 12).toFixed(p)} ft` : '—');

function parseInchPart(t) {
  t = t.trim();
  if (!t) return 0;
  let sign = 1;
  if (t.startsWith('-')) { sign = -1; t = t.slice(1).trim(); }
  let m;
  if ((m = t.match(/^(\d+(?:\.\d*)?|\.\d+)$/))) return sign * parseFloat(m[1]);
  if ((m = t.match(/^(\d+)\/(\d+)$/))) return sign * (Number(m[1]) / Number(m[2]));
  if ((m = t.match(/^(\d+)[\s-]+(\d+)\/(\d+)$/))) return sign * (Number(m[1]) + Number(m[2]) / Number(m[3]));
  return NaN;
}

function evalArithmetic(s) {
  if (!/^[\d.\s+\-*/()]+$/.test(s)) return NaN;
  try {
    // Only digits, dots, whitespace, parentheses and + - * / reach this point.
    const v = Function(`"use strict"; return (${s});`)();
    return Number.isFinite(v) ? v : NaN;
  } catch { return NaN; }
}

/** Parse a user-typed length. Returns inches or NaN. */
export function parseLength(input) {
  if (typeof input === 'number') return input;
  let s = String(input ?? '').trim().toLowerCase().replace(/,/g, '');
  if (!s) return NaN;
  let m = s.match(/^(-?\d*\.?\d+)\s*(mm|cm|m)$/);
  if (m) {
    const v = parseFloat(m[1]);
    return m[2] === 'mm' ? v / 25.4 : m[2] === 'cm' ? v / 2.54 : v / 0.0254;
  }
  s = s.replace(/[′]/g, "'").replace(/[″]/g, '"')
    .replace(/\s*(feet|foot|ft)\b/g, "'")
    .replace(/\s*(inches|inch|in)\b/g, '"');
  let feet = 0;
  let rest = s;
  m = s.match(/^(-?\d*\.?\d+)\s*'(.*)$/);
  if (m) { feet = parseFloat(m[1]); rest = m[2]; }
  rest = rest.replace(/"/g, '').trim();
  let inches = parseInchPart(rest);
  if (Number.isNaN(inches) && !m) inches = evalArithmetic(rest);
  if (Number.isNaN(inches)) return NaN;
  return feet < 0 ? feet * 12 - inches : feet * 12 + inches;
}

/** Parse an angle in degrees ("35", "35°", "0.61 rad"). */
export function parseAngle(input) {
  if (typeof input === 'number') return input;
  const s = String(input ?? '').trim().toLowerCase();
  let m = s.match(/^(-?\d*\.?\d+)\s*rad$/);
  if (m) return (parseFloat(m[1]) * 180) / Math.PI;
  const t = s.replace(/°|deg(rees)?/g, '').trim();
  const v = parseFloat(t);
  if (Number.isFinite(v) && /^-?\d*\.?\d+$/.test(t)) return v;
  return evalArithmetic(t);
}

/** Parse a weight in pounds ("175", "175 lb", "80 kg"). */
export function parseWeight(input) {
  if (typeof input === 'number') return input;
  const s = String(input ?? '').trim().toLowerCase().replace(/,/g, '');
  const m = s.match(/^(-?\d*\.?\d+)\s*(kg|kgs|kilograms?|lb|lbs|pounds?|#)?$/);
  if (m) return m[2]?.startsWith('k') ? parseFloat(m[1]) * 2.20462 : parseFloat(m[1]);
  return evalArithmetic(s);
}

export function parseNumber(input) {
  if (typeof input === 'number') return input;
  const s = String(input ?? '').trim();
  const v = Number(s);
  return Number.isFinite(v) && s !== '' ? v : evalArithmetic(s);
}
