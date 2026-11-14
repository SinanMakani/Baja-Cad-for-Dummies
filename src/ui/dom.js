// Tiny DOM toolkit: element builder, icons, toasts, modal dialogs, downloads.
import { inArtifact, artifactDownload } from '../platform/artifact.js';

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

/** Replace an element's children, skipping null/false (replaceChildren would print "null"). */
export function setChildren(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
}

const ICONS = {
  select: '<path d="M6 3l12 7.5-5.2 1.6L10 18z"/>',
  node: '<circle cx="12" cy="12" r="3.2"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/>',
  tube: '<path d="M6.5 17.5l11-11"/><circle cx="5.5" cy="18.5" r="2"/><circle cx="18.5" cy="5.5" r="2"/>',
  split: '<path d="M5 19L19 5"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/>',
  measure: '<path d="M3.5 16.5L16.5 3.5l4 4-13 13z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 000 11H13"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0112 5c6.4 0 10 7 10 7a17 17 0 01-3.2 4M6.2 6.2A17 17 0 002 12s3.6 7 10 7a9.6 9.6 0 004.4-1"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  target: '<circle cx="12" cy="12" r="7"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  camera: '<rect x="3" y="7" width="18" height="13" rx="2"/><circle cx="12" cy="13.5" r="3.5"/><path d="M8.5 7l1.5-3h4l1.5 3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  mirror: '<path d="M12 3v18" stroke-dasharray="2 2"/><path d="M9 7L4 17h5zM15 7l5 10h-5z"/>',
  sliders: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.6 2.6 0 115 1c0 1.8-2.5 2.2-2.5 4M12 17.5v.5"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>',
  link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
  unlink: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7"/><path d="M4 4l16 16"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  play: '<path d="M7 5l12 7-12 7z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  floor: '<path d="M3 20h18"/><path d="M12 4v11M8 11l4 4 4-4"/>',
  rotate: '<path d="M20 12a8 8 0 11-2.3-5.7"/><path d="M20 4v5h-5"/>',
  move: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>',
  cube: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
  section: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M12 2v20" stroke-dasharray="2 2"/>',
  xray: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" stroke-dasharray="2 2"/><circle cx="12" cy="12" r="2.5"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8" r="1.5"/>',
  save: '<path d="M5 3h11l4 4v14H5z"/><path d="M8 3v5h8V3M8 21v-7h8v7"/>',
  warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>',
};

export function icon(name, size = 18) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size);
  s.setAttribute('height', size);
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.7');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[name] || '';
  return s;
}

export function iconBtn(name, title, onClick, { active = false, cls = '', id } = {}) {
  return h('button', { class: `icon-btn ${active ? 'active' : ''} ${cls}`, title, 'aria-label': title, 'aria-pressed': active ? 'true' : null, onclick: onClick, id, type: 'button' }, icon(name));
}

// ---------------------------------------------------------------- toasts
let toastHost;
export function toast(message, kind = 'info', ms = 2800) {
  toastHost ??= document.body.appendChild(h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }));
  const t = h('div', { class: `toast toast-${kind}` }, message);
  toastHost.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}

// ---------------------------------------------------------------- modal
export function modal({ title, body, actions = [], wide = false, onClose }) {
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const overlay = h('div', { class: 'modal-overlay', onmousedown: (e) => { if (e.target === overlay) close(); } },
    h('div', { class: `modal ${wide ? 'wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'modal-head' }, h('h2', {}, title), iconBtn('x', 'Close', close)),
      h('div', { class: 'modal-body' }, body),
      actions.length ? h('div', { class: 'modal-actions' }, actions.map((a) => h('button', { class: `btn ${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''}`, type: 'button', onclick: async () => { const keep = await a.onClick?.(); if (keep !== true) close(); } }, a.label))) : null,
    ));
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  setTimeout(() => overlay.querySelector('input, textarea, select, .btn.primary')?.focus(), 30);
  return close;
}

export function confirmDialog(message, { ok = 'OK', danger = false, title = 'Please confirm' } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    modal({
      title,
      body: h('p', {}, message),
      actions: [
        { label: 'Cancel', onClick: () => { answered = true; resolve(false); } },
        { label: ok, primary: !danger, danger, onClick: () => { answered = true; resolve(true); } },
      ],
      onClose: () => { if (!answered) resolve(false); },
    });
  });
}

export function promptDialog(title, value = '', { label = '', ok = 'Save' } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const input = h('input', { class: 'field', type: 'text', value, id: 'prompt-input' });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { answered = true; resolve(input.value); close(); } });
    const close = modal({
      title,
      body: h('label', { class: 'stack' }, label ? h('span', { class: 'muted' }, label) : null, input),
      actions: [
        { label: 'Cancel', onClick: () => { answered = true; resolve(null); } },
        { label: ok, primary: true, onClick: () => { answered = true; resolve(input.value); } },
      ],
      onClose: () => { if (!answered) resolve(null); },
    });
  });
}

/** Offer text output both as a file download and as copyable text. */
export function textExport(title, text, filename, mime = 'text/plain') {
  const ta = h('textarea', { class: 'field mono export-text', readonly: true, spellcheck: false, id: 'export-text' });
  ta.value = text;
  modal({
    title, wide: true,
    body: h('div', { class: 'stack' }, h('p', { class: 'muted' }, `Download ${filename}, or copy the text below.`), ta),
    actions: [
      { label: 'Copy', onClick: async () => { try { await navigator.clipboard.writeText(text); toast('Copied to clipboard', 'ok'); } catch { ta.select(); toast('Press Ctrl+C to copy the selected text'); } return true; } },
      { label: `Download ${filename}`, primary: true, onClick: () => { download(filename, text, mime); return true; } },
    ],
  });
}

export function download(filename, content, mime = 'application/octet-stream') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  // A claude.ai Artifact's frame ignores <a download>; the viewer's save prompt takes over there.
  if (inArtifact) return artifactDownload(filename, blob, { notify: toast, fallback: linkDownload });
  linkDownload(filename, blob);
}

function linkDownload(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename, style: { display: 'none' } });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
}

/** Decode a base64 data: URL (canvas.toDataURL) into a Blob without fetch(). */
export function dataUrlToBlob(url) {
  const comma = url.indexOf(',');
  const mime = /^data:([^;,]+)/.exec(url)?.[1] || 'application/octet-stream';
  const bin = atob(url.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, style: { display: 'none' } });
    input.addEventListener('change', () => { resolve(input.files?.[0] || null); input.remove(); });
    document.body.append(input);
    input.click();
  });
}
