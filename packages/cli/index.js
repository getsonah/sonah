import { tokensOf } from '../slicer/index.js';
import { redact, sliceHash } from '../redact/index.js';
import { outcomesFor } from './src/outcomes.js';
import { loadSessionEvidence } from './src/session-evidence.js';

/** One lineage -> {ledger, hash, tokens}: the recording and its linked children, bounded and validated (redact), then
 *  hashed. The children stay pending, as `sonah slice` shows them (a review reads them through recorded-session.js); D82
 *  step 10 removed the PR route, the one caller that had them reviewed here, and the option it passed. D90 (owner
 *  decision 2026-10-15, privacy is not a design constraint): nothing is masked — `sonah slice` prints the recording as
 *  the review's load reads it. */
export async function analyze(files, { cwd } = {}) {
  // Capture-time exit codes, recorded by the PostToolUse hook per session file, joined at slice
  // time. Sessions without recordings get an empty map — the join is a no-op.
  const raw = await loadSessionEvidence(files, { cwd, outcomes: await outcomesFor(files) });
  const { ledger } = redact(raw);
  const hash = sliceHash(ledger);
  return { ledger, hash, tokens: tokensOf(ledger) };
}

// Owner decision 2026-10-06: `scan` and `reviewPending` — the legacy verdict commands' entry points
// (`sonah scan`, `sonah review-pending`) — are retired with the legacy gate's product surface. `analyze` stays:
// `sonah slice` prints its deterministic `.ledger` (D82 step 10: the PR route that also read it is removed).
