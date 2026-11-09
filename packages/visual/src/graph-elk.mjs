// graph-elk.mjs: the Eclipse Layout Kernel (src/vendor/elkjs, EPL-2.0, used unmodified), loaded once, only when a page
// draws a desktop graph. Layered layout with orthogonal routing; positions only, no drawing. No network, no clock, no
// random value reaches the output (ELK's own seed is fixed): the same graph gives the same positions.
// The bundle is kept as `.cjs` (its bytes unchanged) so Node loads it as CommonJS whatever the package's type says.
import { createRequire } from 'node:module';

let engine = null;

/** ELK's layout of one graph (ELK JSON: children, ports, edges, labels, layoutOptions), resolved with positions. */
export async function elkLayout(graph) {
  if (!engine) {
    const ELK = createRequire(import.meta.url)('./vendor/elkjs/lib/elk.bundled.cjs');
    engine = new ELK();
  }
  return engine.layout(graph);
}

/** elkLayout, or null when ELK throws on this graph (the caller takes its next, simpler setting). */
export async function tryLayout(graph) {
  try { return await elkLayout(graph); } catch { return null; }
}

/** An ELK edge's route as one list of points (its sections joined), rounded to tenths. */
export function routeOf(e) {
  const pts = [];
  for (const s of e?.sections ?? []) {
    pts.push([s.startPoint.x, s.startPoint.y], ...(s.bendPoints ?? []).map((p) => [p.x, p.y]), [s.endPoint.x, s.endPoint.y]);
  }
  const out = [];
  for (const [x, y] of pts) {
    const p = [r1(x), r1(y)];
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  return out;
}

export const r1 = (v) => Math.round(v * 10) / 10;
