// Form controls. Numeric fields accept expressions and units and commit on
// Enter / blur; ↑/↓ nudge by the step (Shift ×10, Alt ÷10).
import { h, icon } from './dom.js';
import { parseLength, parseAngle, parseNumber, parseWeight, inputLen, fmtLen, fmtAngle } from '../core/units.js';

const PARSERS = { len: parseLength, ang: parseAngle, num: parseNumber, mass: parseWeight };
const UNITS = { len: 'in', ang: '°', mass: 'lb' };
const TITLES = { len: 'Inches. Also accepts 24 1/2, 2\' 6", 600mm', mass: 'Pounds. Also accepts kg, e.g. 80 kg' };

/** `format` (optional) shows the value differently, e.g. a height as 5' 10"; it must parse back. */
export function numField({ id, value, kind = 'len', unit, step, onCommit, disabled = false, title, placeholder, width, format }) {
  const parse = PARSERS[kind];
  const show = (v) => (v == null || !Number.isFinite(v) ? '' : format ? format(v) : kind === 'len' ? inputLen(v) : String(+Number(v).toFixed(kind === 'ang' ? 3 : kind === 'mass' ? 1 : 4)));
  const input = h('input', {
    class: 'field num', type: 'text', inputmode: format ? 'text' : 'decimal', id, value: show(value), disabled, title: title || TITLES[kind], placeholder,
    autocomplete: 'off', spellcheck: false, style: width ? { width } : undefined,
  });
  let last = input.value;
  const commit = () => {
    if (input.value === last) return;
    const v = parse(input.value);
    if (!Number.isFinite(v)) { input.classList.add('invalid'); input.title = 'Could not read that value'; return; }
    input.classList.remove('invalid');
    last = input.value;
    onCommit?.(v);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { commit(); input.select(); }
    if (e.key === 'Escape') { input.value = last; input.blur(); }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && step) {
      e.preventDefault();
      const cur = parse(input.value);
      if (!Number.isFinite(cur)) return;
      const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
      const nv = +(cur + (e.key === 'ArrowUp' ? 1 : -1) * step * mult).toFixed(6);
      input.value = show(nv);
      commit();
    }
  });
  input.addEventListener('blur', commit);
  input.addEventListener('focus', () => input.select());
  const u = unit ?? UNITS[kind];
  return u ? h('span', { class: 'num-wrap' }, input, h('span', { class: 'unit' }, u)) : input;
}

export function selectField({ id, value, options, onChange, disabled }) {
  const sel = h('select', { class: 'field', id, disabled, onchange: (e) => onChange?.(coerce(e.target.value, options)) },
    options.map((o) => h('option', { value: String(o.value), selected: String(o.value) === String(value) }, o.label)));
  return sel;
}

function coerce(v, options) {
  const o = options.find((x) => String(x.value) === v);
  return o ? o.value : v;
}

export function checkField({ id, checked, onChange, label, title }) {
  return h('label', { class: 'check', title },
    h('input', { type: 'checkbox', id, checked: !!checked, onchange: (e) => onChange?.(e.target.checked) }),
    h('span', {}, label));
}

export function textField({ id, value, onCommit, placeholder, multiline = false, rows = 3 }) {
  const el = h(multiline ? 'textarea' : 'input', { class: 'field', id, placeholder, rows: multiline ? rows : undefined, type: multiline ? undefined : 'text', spellcheck: multiline });
  el.value = value ?? '';
  let last = el.value;
  const commit = () => { if (el.value !== last) { last = el.value; onCommit?.(el.value); } };
  el.addEventListener('blur', commit);
  if (!multiline) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); });
  return el;
}

export function row(labelText, control, { hint, id } = {}) {
  return h('div', { class: 'row' },
    h('label', { class: 'row-label', for: id || control?.id || control?.querySelector?.('input,select,textarea')?.id }, labelText),
    h('div', { class: 'row-ctl' }, control),
    hint ? h('div', { class: 'row-hint' }, hint) : null);
}

export function xyzRow(labelText, p, { idPrefix, onCommit, step = 0.125, disabled } = {}) {
  const f = (i, axis) => numField({ id: `${idPrefix}-${axis}`, value: p[i], kind: 'len', unit: axis.toUpperCase(), step, disabled, onCommit: (v) => { const n = p.slice(); n[i] = v; onCommit?.(n); } });
  return h('div', { class: 'row xyz' }, h('span', { class: 'row-label' }, labelText), h('div', { class: 'xyz-ctl' }, f(0, 'x'), f(1, 'y'), f(2, 'z')));
}

export function section(title, content, { open = true, id, extra, count } = {}) {
  const key = `baja-section:${id || title}`;
  let isOpen = open;
  try { const s = localStorage.getItem(key); if (s != null) isOpen = s === '1'; } catch { /* storage unavailable */ }
  const body = h('div', { class: 'sec-body', hidden: !isOpen }, content);
  const btn = h('button', { class: `sec-head ${isOpen ? 'open' : ''}`, type: 'button', 'aria-expanded': String(isOpen) },
    icon('chevron', 14), h('span', { class: 'sec-title' }, title), count != null ? h('span', { class: 'count' }, count) : null);
  btn.addEventListener('click', () => {
    isOpen = !isOpen;
    body.hidden = !isOpen;
    btn.classList.toggle('open', isOpen);
    btn.setAttribute('aria-expanded', String(isOpen));
    try { localStorage.setItem(key, isOpen ? '1' : '0'); } catch { /* storage unavailable */ }
  });
  return h('section', { class: 'sec' }, h('div', { class: 'sec-headrow' }, btn, extra || null), body);
}

/** Read-only key/value table. rows: [[label, value, cls?]] */
export function kv(rows) {
  return h('dl', { class: 'kv' }, rows.filter(Boolean).map(([k, v, cls]) => [h('dt', {}, k), h('dd', { class: cls || '' }, v)]));
}

export function pill(text, kind = '') { return h('span', { class: `pill ${kind}` }, text); }

export { fmtLen, fmtAngle };
