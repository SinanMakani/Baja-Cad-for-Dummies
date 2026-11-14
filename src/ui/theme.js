// Appearance: Auto, Light ("Soapstone") or Dark ("Mill Scale").
//
// Auto follows the page's host first, then the OS. Inside a claude.ai Artifact
// the viewer writes its light/dark choice to <html data-theme>; with no choice
// there (or outside claude.ai) prefers-color-scheme decides. A Light or Dark
// choice made in Settings goes to a separate attribute, <html data-app-theme>,
// so the host's own attribute is never overwritten. styles.css resolves the
// order: data-app-theme, then data-theme, then the OS.
import { h } from './dom.js';
import { inArtifact } from '../platform/artifact.js';

const root = document.documentElement;

export const APPEARANCES = [
  { value: 'system', name: 'Auto', note: inArtifact ? 'Matches Claude' : 'Matches your system' },
  { value: 'light', name: 'Light', note: 'Soapstone' },
  { value: 'dark', name: 'Dark', note: 'Mill Scale' },
];

/** Show an appearance preference: 'light' or 'dark' pins that colorway, 'system' is Auto. */
export function setAppearance(pref) {
  if (pref === 'light' || pref === 'dark') root.dataset.appTheme = pref;
  else delete root.dataset.appTheme;
}

/**
 * Call `onChange` whenever what Auto shows may have changed: the OS setting, or
 * the host's data-theme (claude.ai changes it when the viewer switches theme).
 */
export function watchAutoAppearance(onChange) {
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', onChange);
  if (typeof MutationObserver === 'function') new MutationObserver(onChange).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
}

/** Run an appearance change as a short cross-fade, where supported and motion is welcome. */
export function crossfade(update) {
  if (!document.startViewTransition || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { update(); return; }
  document.startViewTransition(update);
}

// A miniature workbench (top bar, panel, 3D stage with a frame, inspector)
// drawn from one colorway's own tokens, so each option previews itself.
function preview(colorway) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 64 36');
  svg.innerHTML = '<path class="apt-tube" d="M6 28H52L58 20L50 15M40 28L36 8H20L10 22L6 28M10 22H39"/>'
    + '<circle class="apt-joint" cx="20" cy="8" r="1.9"/><circle class="apt-joint" cx="36" cy="8" r="1.9"/>';
  return h('span', { class: `ap-thumb cw-${colorway}` },
    h('span', { class: 'apt-top' }, h('i'), h('b')),
    h('span', { class: 'apt-left' }, h('i'), h('i'), h('i'), h('i')),
    h('span', { class: 'apt-stage' }, svg),
    h('span', { class: 'apt-right' }, h('i'), h('i'), h('i')));
}

/** Settings ▸ Appearance: one live preview per choice; Auto shows both colorways, split corner to corner. */
export function appearancePicker(value, onChange) {
  return h('div', { class: 'appearance', role: 'radiogroup', 'aria-label': 'Appearance' },
    APPEARANCES.map((a) => {
      const input = h('input', { class: 'ap-input', type: 'radio', name: 'appearance', value: a.value, id: `appearance-${a.value}`, checked: a.value === value });
      input.addEventListener('change', () => { if (input.checked) onChange(a.value); });
      return h('label', { class: 'ap-opt' },
        input,
        h('span', { class: 'ap-frame', 'aria-hidden': 'true' }, a.value === 'system' ? [preview('light'), preview('dark')] : preview(a.value)),
        h('span', { class: 'ap-name' }, a.name),
        h('span', { class: 'ap-note' }, a.note));
    }));
}
