// Design-rule check registry. A check is { id, category, label, run(state, A) }
// returning issues: { severity: 'error'|'warning'|'info', title, detail,
// targets: [{kind, id}], fix?: { label, apply(state) } }.
// Rule numbers change every year, so messages describe the requirement in
// words and point you at the rulebook instead of citing section numbers.

const RULES = [];
const ORDER = { error: 0, warning: 1, info: 2 };

export function registerCheck(rule) { RULES.push(rule); }
export const listChecks = () => RULES.slice();

export function runChecks(state, A, disabled = {}) {
  const issues = [];
  for (const r of RULES) {
    if (disabled[r.id]) continue;
    try {
      const res = r.run(state, A) || [];
      res.forEach((i, n) => issues.push({ key: `${r.id}:${n}`, category: r.category, rule: r.id, targets: [], ...i }));
    } catch (e) {
      console.error(e);
      issues.push({ key: `${r.id}:err`, category: r.category, rule: r.id, severity: 'info', title: `Check "${r.label}" could not run`, detail: String(e.message || e), targets: [] });
    }
  }
  return issues.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}

export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
