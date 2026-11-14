// Single source of truth for the design (`state`, serializable, undoable) and
// the editor session (`ui`, not undoable). Every design change goes through
// commit() or a gesture so undo/redo and autosave stay consistent.

const AUTOSAVE_KEY = 'baja-designer:autosave:v1';
const PREFS_KEY = 'baja-designer:prefs:v1';
const MAX_UNDO = 150;

export const SCHEMA_VERSION = 1;

function safeStorage(fn, fallback) {
  try { return fn(); } catch { return fallback; }
}

export class Store {
  constructor(state, ui) {
    this.state = state;
    this.ui = ui;
    this.rev = 0;
    this.undoStack = [];
    this.redoStack = [];
    this.listeners = new Set();
    this.normalizers = [];
    this._gesture = null;
    this._saveTimer = null;
    this._uiQueued = false;
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  _emit(evt) { for (const fn of this.listeners) fn(evt); }

  _normalize() { for (const n of this.normalizers) n(this.state); }

  _changed(evt) {
    this._normalize();
    this.rev++;
    this.state.meta.modified = new Date().toISOString();
    this._emit({ type: 'state', ...evt });
    if (!evt.transient) this._scheduleSave();
  }

  /** Apply an undoable change. `fn` mutates the draft state in place. */
  commit(label, fn) {
    const snap = JSON.stringify(this.state);
    const result = fn(this.state);
    this.undoStack.push({ label, snap });
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
    this._changed({ label });
    return result;
  }

  /** Record something that isn't a design edit (e.g. test results): saved, but not undoable. */
  apply(label, fn) {
    fn(this.state);
    this._changed({ label });
  }

  /** Continuous edits (dragging) collapse into one undo step. */
  beginGesture(label) {
    if (!this._gesture) this._gesture = { label, snap: JSON.stringify(this.state), moved: false };
  }
  updateGesture(fn) {
    if (!this._gesture) this.beginGesture('Edit');
    fn(this.state);
    this._gesture.moved = true;
    this._changed({ label: this._gesture.label, transient: true });
  }
  endGesture() {
    const g = this._gesture;
    this._gesture = null;
    if (!g || !g.moved) return;
    this.undoStack.push({ label: g.label, snap: g.snap });
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
    this._changed({ label: g.label });
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  get undoLabel() { return this.undoStack.at(-1)?.label; }
  get redoLabel() { return this.redoStack.at(-1)?.label; }

  undo() {
    const e = this.undoStack.pop();
    if (!e) return;
    this.redoStack.push({ label: e.label, snap: JSON.stringify(this.state) });
    this.state = JSON.parse(e.snap);
    this._validateSelection();
    this._changed({ label: `Undo ${e.label}`, undo: true });
  }

  redo() {
    const e = this.redoStack.pop();
    if (!e) return;
    this.undoStack.push({ label: e.label, snap: JSON.stringify(this.state) });
    this.state = JSON.parse(e.snap);
    this._validateSelection();
    this._changed({ label: `Redo ${e.label}`, undo: true });
  }

  /** Replace the whole project (open file / new project). Clears history. */
  load(state, label = 'Open project') {
    this.state = state;
    this.undoStack = [];
    this.redoStack = [];
    this.ui.selection = null;
    this.ui.hover = null;
    this._changed({ label, loaded: true });
    this._emit({ type: 'ui' });
  }

  setUI(patch) {
    Object.assign(this.ui, patch);
    if (['prefs', 'layers', 'snap', 'mirror', 'focusMode', 'tab'].some((k) => k in patch)) this._savePrefs();
    this._emit({ type: 'ui', patch });
  }

  select(sel) { this.setUI({ selection: sel }); }

  _validateSelection() {
    const s = this.ui.selection;
    if (!s) return;
    const st = this.state;
    const exists =
      (s.kind === 'node' && st.chassis.nodes[s.id]) ||
      (s.kind === 'member' && st.chassis.members[s.id]) ||
      (s.kind === 'part' && st.parts[s.id]) ||
      !['node', 'member', 'part'].includes(s.kind);
    if (!exists) this.ui.selection = null;
  }

  _scheduleSave() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      safeStorage(() => localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(this.state)));
    }, 600);
  }

  _savePrefs() {
    const { prefs, layers, snap, mirror, focusMode, tab } = this.ui;
    safeStorage(() => localStorage.setItem(PREFS_KEY, JSON.stringify({ prefs, layers, snap, mirror, focusMode, tab })));
  }

  static loadAutosave() {
    return safeStorage(() => {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      return s && s.schema === SCHEMA_VERSION ? s : null;
    }, null);
  }

  static loadPrefs() {
    return safeStorage(() => JSON.parse(localStorage.getItem(PREFS_KEY) || 'null'), null);
  }
}

/** Sequential, human-readable ids: N12 (node), T40 (tube), P7 (part). */
export function nextId(state, prefix) {
  state.seq ??= {};
  state.seq[prefix] = (state.seq[prefix] || 0) + 1;
  return `${prefix}${state.seq[prefix]}`;
}
