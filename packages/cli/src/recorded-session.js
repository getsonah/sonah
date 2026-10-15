// M33 S. One recorded session, loaded the way a session-only review loads it: the parent recording
// and its linked children (loadSessionEvidence), redacted before anything else reads it, then adapted
// to the canonical Session. D84 (owner decision 2026-10-12, "off for the model, on for output"): redacted with
// masking off — bounded and validated, nothing masked — because the reviewer model reads the session unredacted (the
// provider already saw it in the original session). Whatever Sonah writes from it for a person (the page, the
// Markdown story, a PR comment, the terminal) is masked where it is written (redact/index.js `maskForPeople`).
// The same four calls, in the same order and with the same options, as
// scripts/session-review.mjs `loadRecordedSession` — so a story and the review it tells read the same
// events under the same ids. `claudeProjects` names the Claude projects tree the loader resolves Claude
// children against (its `recordingRoots.claude`); omitted, the loader's own default applies, exactly as
// in the review harness, which has no such option. Set, it can resolve other children than the review
// saw, so a caller sets it only to match a review that loaded them from there.
import { join, resolve } from 'node:path';
import { loadSessionEvidence } from './session-evidence.js';
import { outcomesFor } from './outcomes.js';
import { keepPeopleSecrets, redact, sliceHash } from '../../redact/index.js';
import { sessionFromLedger } from '../../evidence/adapters/sonah-ledger.js';

/** The same load, with the session's hash: `sliceHash` of the ledger the review reads (D45; D84: the
 *  bounded, unmasked ledger, so a recording has one hash whatever an output masks — a digest names the session and
 *  shows none of its text). D69 f (g): the session page names it in the command under each decision, and your answers
 *  are keyed by it. D84 review: the session keeps what the redactor's full walk hides in that ledger (redact
 *  `keepPeopleSecrets`, found when a page, a story or a comment is first written from it), so what a person reads is
 *  masked with the context the load used to mask with. */
export async function loadRecordedSessionWithHash({ parent, codexHome, claudeProjects = null, sessionKey = 'session' }) {
  const files = [resolve(parent)];
  const recordingRoots = { codex: join(resolve(codexHome), 'sessions'),
    ...(typeof claudeProjects === 'string' && claudeProjects ? { claude: resolve(claudeProjects) } : {}) };
  const raw = await loadSessionEvidence(files, { outcomes: await outcomesFor(files), reviewLinkedChildren: true,
    recordingRoots, mask: false });
  const { ledger } = redact(raw, { mask: false });
  // D87: `cwd`, the working directory the recording names (the slicer's `cwd`), which `sonah review --code-pass` reads
  // the session's files under; null when it names none. Nothing else reads it.
  return { session: keepPeopleSecrets(sessionFromLedger(ledger, { sessionKey }), ledger), hash: sliceHash(ledger),
    cwd: typeof ledger.cwd === 'string' && ledger.cwd ? ledger.cwd : null };
}

/** The same load, the session alone. Nothing in this repository calls it since B5.2 step 11b; it stays exported by
 *  this name because tools outside this repository import it. */
export async function loadRecordedSession(options) {
  return (await loadRecordedSessionWithHash(options)).session;
}
