// Small canvas line charts for kinematic curves (camber / toe / steer vs travel).
import { h } from './dom.js';

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function niceStep(range, target = 4) {
  const raw = range / target;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
}

/**
 * series: [{ label, color (css var name), points: [[x, y], …] }]
 */
export function lineChart({ title, series, xLabel, yLabel, height = 150, yPad = 0.25, marker = null }) {
  const canvas = h('canvas', { class: 'chart', role: 'img', 'aria-label': `${title}: ${series.map((s) => s.label).join(', ')}` });
  const legend = h('div', { class: 'chart-legend' }, series.map((s) => h('span', { class: 'lg' }, h('i', { style: { background: `var(${s.color})` } }), s.label)));
  const wrap = h('figure', { class: 'chart-wrap' }, h('figcaption', {}, title), canvas, legend);
  const draw = () => {
    const w = wrap.clientWidth || 280;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = height * dpr;
    canvas.style.height = `${height}px`;
    const g = canvas.getContext('2d');
    g.scale(dpr, dpr);
    const pts = series.flatMap((s) => s.points);
    if (!pts.length) return;
    let [x0, x1] = [Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0]))];
    let [y0, y1] = [Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[1]))];
    if (y1 - y0 < yPad) { const m = (y0 + y1) / 2; y0 = m - yPad / 2; y1 = m + yPad / 2; }
    const pad = (y1 - y0) * 0.1; y0 -= pad; y1 += pad;
    if (x1 - x0 < 1e-6) x1 = x0 + 1;
    const L = 38, R = 8, T = 8, B = 22;
    const X = (x) => L + ((x - x0) / (x1 - x0)) * (w - L - R);
    const Y = (y) => T + (1 - (y - y0) / (y1 - y0)) * (height - T - B);
    const fg = css('--fg-muted'), grid = css('--line');
    g.font = `11px ${css('--font-mono') || 'monospace'}`;
    g.fillStyle = fg;
    g.strokeStyle = grid;
    g.lineWidth = 1;
    const ys = niceStep(y1 - y0);
    for (let y = Math.ceil(y0 / ys) * ys; y <= y1 + 1e-9; y += ys) {
      g.globalAlpha = Math.abs(y) < 1e-9 ? 0.9 : 0.45;
      g.beginPath(); g.moveTo(L, Y(y)); g.lineTo(w - R, Y(y)); g.stroke();
      g.globalAlpha = 1;
      g.textAlign = 'right'; g.textBaseline = 'middle';
      g.fillText(+y.toFixed(3) + '', L - 5, Y(y));
    }
    const xs = niceStep(x1 - x0);
    for (let x = Math.ceil(x0 / xs) * xs; x <= x1 + 1e-9; x += xs) {
      g.globalAlpha = Math.abs(x) < 1e-9 ? 0.9 : 0.35;
      g.beginPath(); g.moveTo(X(x), T); g.lineTo(X(x), height - B); g.stroke();
      g.globalAlpha = 1;
      g.textAlign = 'center'; g.textBaseline = 'top';
      g.fillText(+x.toFixed(2) + '', X(x), height - B + 5);
    }
    if (xLabel) { g.textAlign = 'right'; g.textBaseline = 'bottom'; g.fillText(xLabel, w - R, height - B - 2); }
    if (yLabel) { g.textAlign = 'left'; g.textBaseline = 'top'; g.fillText(yLabel, L + 4, T); }
    for (const s of series) {
      g.strokeStyle = css(s.color);
      g.lineWidth = 2;
      g.beginPath();
      s.points.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
      g.stroke();
      const z = s.points.reduce((best, p) => (Math.abs(p[0]) < Math.abs(best[0]) ? p : best), s.points[0]);
      g.fillStyle = css(s.color);
      g.beginPath(); g.arc(X(z[0]), Y(z[1]), 3, 0, Math.PI * 2); g.fill();
    }
    if (marker != null && marker >= x0 && marker <= x1) {
      g.strokeStyle = css('--accent'); g.lineWidth = 1.5; g.setLineDash([4, 3]);
      g.beginPath(); g.moveTo(X(marker), T); g.lineTo(X(marker), height - B); g.stroke(); g.setLineDash([]);
    }
  };
  requestAnimationFrame(draw);
  return wrap;
}
