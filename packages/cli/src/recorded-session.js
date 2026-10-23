// M33 S. One recorded session, loaded the way a session-only review loads it: the parent recording
// and its linked children (loadSessionEvidence), bounded and validated before anything else reads it (redact), then
// adapted to the canonical Session. D84, D90 (owner decision 2026-10-15, privacy is not a design constraint): with
// masking off — bounded and validated, nothing masked — because the reviewer model reads the session as recorded, and
// whatever Sonah writes from it for a person (the page, the Markdown story, a PR comment, the terminal) shows it as
// loaded.
// The same four calls, in the same order and with the same options, as
// scripts/session-review.mjs `loadRecordedSession` — so a story and the review it tells read the same
// events under the same ids. `claudeProjects` names the Claude projects tree the loader resolves Claude
// children against (its `recordingRoots.claude`); omitted, the loader's own default applies, exactly as
// in the review harness, which has no such option. Set, it can resolve other children than the review
// saw, so a caller sets it only to match a review that loaded them from there.
import { join, resolve } from 'node:path';
import { continuedRecordingsOf, loadSessionEvidence, recorderCensusOf } from './session-evidence.js';
import { outcomesFor } from './outcomes.js';
import { redact, sliceHash } from '../../redact/index.js';
import { sessionFromLedger } from '../../evidence/adapters/sonah-ledger.js';

/** The same load, with the session's hash: `sliceHash` of the ledger the review reads (D45; D84: the
 *  bounded, unmasked ledger — a digest names the session and shows none of its text). D69 f (g): the session page names
 *  it in the command under each decision, and your answers are keyed by it. */
export async function loadRecordedSessionWithHash({ parent, codexHome, claudeProjects = null, sessionKey = 'session',
  frozen = null }) {
  const files = [resolve(parent)];
  const recordingRoots = { codex: join(resolve(codexHome), 'sessions'),
    ...(typeof claudeProjects === 'string' && claudeProjects ? { claude: resolve(claudeProjects) } : {}) };
  // D142: `frozen` (frozen-read.js), a review by session id: every recording read as it was when it started.
  const raw = await loadSessionEvidence(files, { outcomes: await outcomesFor(files), reviewLinkedChildren: true,
    recordingRoots, ...(frozen ? { frozen } : {}) });
  const { ledger } = redact(raw);
  // D87: `cwd`, the working directory the recording names (the slicer's `cwd`), which `sonah review --code-pass` reads
  // the session's files under; null when it names none. Nothing else reads it. D99 (F1 guard): `census`, the recorder
  // census of the load (session-evidence.js `recorderCensusOf`), for the run record only; null when nothing was counted.
  // D126 (N0): `recordings`, the recordings the session was read from, oldest first — the recordings it continues and
  // then itself, when it opens on a compaction (session-evidence.js `continuedRecordingsOf`), else itself alone. The code
  // step's start (D113) is the start of the first of them.
  return { session: sessionFromLedger(ledger, { sessionKey }), hash: sliceHash(ledger),
    cwd: typeof ledger.cwd === 'string' && ledger.cwd ? ledger.cwd : null, census: recorderCensusOf(raw),
    recordings: continuedRecordingsOf(raw) ?? files };
}

/** The same load, the session alone. Nothing in this repository calls it since B5.2 step 11b; it stays exported by
 *  this name because tools outside this repository import it. */
export async function loadRecordedSession(options) {
  return (await loadRecordedSessionWithHash(options)).session;
}
