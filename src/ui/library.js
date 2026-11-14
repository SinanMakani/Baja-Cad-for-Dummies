// Parts library: browse the five hardware categories, hover for full specs,
// drag a card onto the car (or click Add). Slot parts (tires, shocks, brakes,
// racks, uprights) are assigned to the front or rear suspension instead.
import { h, icon, toast, setChildren } from './dom.js';
import { CATEGORIES, allDefs, getDef, specsOf, weightOf } from '../catalog/index.js';
import { SLOT_LABELS } from '../catalog/dynamics.js';
import { addPart, assignSlot } from '../core/commands.js';
import { gateLocked } from '../systems/stresstest.js';
import { fmtWeight } from '../core/units.js';

let specTip;
function showSpecTip(card, def, state) {
  specTip ??= document.body.appendChild(h('div', { class: 'spec-tip', role: 'tooltip' }));
  const specs = specsOf({}, def);
  setChildren(specTip,
    h('div', { class: 'tip-title' }, def.name),
    h('div', { class: 'tip-sub' }, def.summary || ''),
    h('dl', { class: 'kv tight' }, specs.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
    def.slot ? h('p', { class: 'tip-note' }, `Drop on the car to use as the front or rear ${SLOT_LABELS[def.slot].toLowerCase()}.`) : null,
    def.notes ? h('p', { class: 'tip-note' }, def.notes) : null,
    def.custom ? h('p', { class: 'tip-note' }, 'Saved in this project (My Parts).') : null,
  );
  specTip.hidden = false;
  const r = card.getBoundingClientRect();
  const w = 300;
  let x = r.right + 10;
  if (x + w > window.innerWidth - 8) x = Math.max(8, r.left - w - 10);
  specTip.style.left = `${x}px`;
  specTip.style.top = `${Math.max(8, Math.min(r.top, window.innerHeight - specTip.offsetHeight - 8))}px`;
}
function hideSpecTip() { if (specTip) specTip.hidden = true; }

/** Where "Add" puts a part: its usual mounting spot if the catalog gives one,
 * otherwise on the ground beside the car so it doesn't collide with anything. */
export function defaultDropPoint(state, analysis, def) {
  if (def.defaultPos) return def.defaultPos.slice();
  const box = analysis().dims?.box;
  const cx = box ? (box.min.x + box.max.x) / 2 : 30;
  const side = box ? box.min.y - 14 : -44;
  return [Math.round(cx), Math.round(side), 0];
}

export function partCard(def, ctx) {
  const { store, analysis, interaction } = ctx;
  const w = weightOf({}, def);
  if (def.category !== 'chassis' && gateLocked(store.state)) {
    return h('div', { class: 'card locked', title: 'Unlocks when the frame passes its stress tests' },
      h('div', { class: 'card-main' },
        h('div', { class: 'card-name' }, def.name),
        h('div', { class: 'card-sub' }, def.summary || ''),
        h('div', { class: 'card-meta' }, w ? fmtWeight(w) : '')),
      icon('lock', 16));
  }
  const actions = def.slot
    ? h('div', { class: 'card-actions' },
      def.slot === 'rack'
        ? h('button', { class: 'btn tiny', type: 'button', onclick: () => { assignSlot(store, def.key, 'front'); toast(`${def.name} set as steering rack`, 'ok'); } }, 'Use')
        : [h('button', { class: 'btn tiny', type: 'button', onclick: () => { assignSlot(store, def.key, 'front'); toast(`${def.name} → front`, 'ok'); } }, 'Front'),
          h('button', { class: 'btn tiny', type: 'button', onclick: () => { assignSlot(store, def.key, 'rear'); toast(`${def.name} → rear`, 'ok'); } }, 'Rear')])
    : h('div', { class: 'card-actions' }, h('button', {
      class: 'btn tiny', type: 'button', title: 'Add at a default spot (or drag onto the car)',
      onclick: () => {
        const res = addPart(store, def.key, defaultDropPoint(store.state, analysis, def), { rot: def.defaultRot || [0, 0, 0] });
        if (res?.id) { store.select({ kind: 'part', id: res.id }); toast(res.swapped ? `Swapped in ${def.name}` : `Added ${def.name} — drag it into place or type exact coordinates`, 'ok'); }
      },
    }, icon('plus', 14), 'Add'));
  const inUse = def.slot ? usedOn(store.state, def) : null;
  const card = h('div', {
    class: `card ${inUse ? 'in-use' : ''}`, draggable: 'true', tabindex: '0',
    onmouseenter: (e) => showSpecTip(e.currentTarget, def, store.state),
    onmouseleave: hideSpecTip,
    onfocus: (e) => showSpecTip(e.currentTarget, def, store.state),
    onblur: hideSpecTip,
    ondragstart: (e) => { interaction.dragDef = def.key; e.dataTransfer.setData('text/plain', def.key); e.dataTransfer.effectAllowed = 'copy'; hideSpecTip(); },
    ondragend: () => { interaction.dragDef = null; interaction.overlays.setGhost(null); },
  },
  h('div', { class: 'card-main' },
    h('div', { class: 'card-name' }, def.name, def.custom ? h('span', { class: 'pill tiny' }, 'My part') : null),
    h('div', { class: 'card-sub' }, def.summary || ''),
    h('div', { class: 'card-meta' }, w ? fmtWeight(w) : '', inUse ? h('span', { class: 'pill ok tiny' }, `In use: ${inUse}`) : null)),
  actions);
  return card;
}

function usedOn(state, def) {
  const s = state.suspension;
  const on = [];
  if (def.slot === 'rack') return s.steering.rack === def.key ? 'steering' : null;
  for (const k of ['front', 'rear']) {
    const v = def.slot === 'tire' ? s[k].tire : s[k][def.slot];
    if (v === def.key) on.push(k);
  }
  return on.length ? on.join(' + ') : null;
}

function customDefs(state) {
  return Object.keys(state.customDefs || {}).map((k) => getDef(k, state)).filter(Boolean);
}

/** Cards for one category, grouped by `group`. */
const norm = (s) => String(s).toLowerCase().replace(/×/g, 'x').replace(/\s+/g, ' ');

export function categoryCards(category, ctx, filter = '') {
  const words = norm(filter).trim().split(' ').filter(Boolean);
  const defs = [...customDefs(ctx.store.state), ...allDefs()].filter((d) => d.category === category)
    .filter((d) => { const hay = norm(`${d.name} ${d.summary} ${d.group} ${d.key}`); return words.every((w) => hay.includes(w)); });
  const groups = new Map();
  for (const d of defs) {
    const g = d.custom ? 'My parts' : d.group;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(d);
  }
  return [...groups.entries()].map(([g, list]) => h('div', { class: 'card-group' }, h('div', { class: 'group-label' }, g), list.map((d) => partCard(d, ctx))));
}

export function renderLibrary(ctx) {
  const { store } = ctx;
  const ui = store.ui;
  const cat = ui.libraryCat || 'all';
  const filter = ui.libraryFilter || '';
  const search = h('input', { class: 'field', type: 'search', id: 'lib-search', placeholder: 'Search parts…', value: filter, 'aria-label': 'Search parts' });
  search.addEventListener('input', () => { store.ui.libraryFilter = search.value; ctx.rerender(); });
  const chips = h('div', { class: 'chips', role: 'tablist' },
    [{ key: 'all', label: 'All' }, ...CATEGORIES].map((c) => h('button', {
      class: `chip ${cat === c.key ? 'active' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(cat === c.key),
      onclick: () => store.setUI({ libraryCat: c.key }),
    }, c.label)));
  const cats = CATEGORIES.filter((c) => cat === 'all' || c.key === cat);
  const locked = gateLocked(store.state);
  return h('div', { class: 'panel-inner' },
    h('p', { class: 'panel-intro' }, 'Drag a part onto the car, or click Add. Hover a card for its full specs. Values are typical starting points — verify against supplier data.'),
    locked ? h('div', { class: 'note' }, icon('lock', 14), ' Only chassis parts can be added until the frame passes its stress tests. ',
      h('button', { class: 'link', type: 'button', onclick: () => store.setUI({ tab: 'chassis', chassisMode: 'stress' }) }, 'Go to stress tests')) : null,
    search, chips,
    cats.map((c) => {
      const cards = categoryCards(c.key, ctx, filter);
      if (!cards.length) return null;
      return h('div', { class: 'lib-cat' }, h('h3', { class: 'cat-title' }, c.label, h('span', { class: 'muted' }, ` · ${c.blurb}`)), cards);
    }));
}

export { hideSpecTip };
