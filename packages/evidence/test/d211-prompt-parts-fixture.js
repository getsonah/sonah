// D211 (0.3.0-beta.13). The requests whose prompts D211 cuts into parts, built the ways a review builds them: the
// kinds of a refuted row's re-ask from one kept request (prompt.js; D212 withdrew W1 A's, `recolumnRequest`), a session review's restatus re-asks through
// `runReview` (the S3 fixture), and the code step's requests through `runCodePass` with fake agents that make every
// checker ask once more and the review agent ask for its repair.
//
// It imports only what 20be6999 (the code before D211) already had, so the same file runs on both: the pinned digests
// in d211-prompt-parts.test.js were computed ONCE by running it against `git archive 20be6999`. Every byte here is
// invented: no recording of a real session, no model, no network. Nothing prints.
import { createHash } from 'node:crypto';
import { NOW_ANSWER, NOW_ANSWER_AGAIN, restatusRequest, reanchorRequest } from '../src/prompt.js';
import { runReview } from '../src/run-review.js';
import { codeSnapshotPlan, freezeCodeSnapshot, runCodePass } from '../src/code-pass.js';
import { load, humanAsk, said, call, result } from './m33-u-unasked-fixture.js';
import { CODE_FILES, CODE_TEXT, codeSession, reviewFinding, holds, allSound, verifiedFinding, batchItems, accountsHold }
  from '../../cli/test/code-pass-fixture.js';

export const sha16 = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

// ---- the two kinds of re-ask, from one kept request ------------------------------------------------------------------

const KEPT_BODY = ['SYNTHETIC_D211_KEPT: the window\'s request, its checklist and its events.', '',
  '<<SYNTHETIC_D211_EVENT_E1>>', 'SYNTHETIC_D211 a line of the window.', '>>'].join('\n');
const keptRequest = (tail, images = undefined) => ({ system: 'SYNTHETIC_D211_SYSTEM', schema: { type: 'object' },
  prompt: `${KEPT_BODY}\n${tail.join('\n')}`, label: 'narrative:w1', ...(images ? { images } : {}) });
const vote = (k) => ({ explanation: `SYNTHETIC_D211 check ${k}.`, receipts: [{ eventId: 'E1', role: 'action',
  quote: `SYNTHETIC_D211 receipt ${k}` }] });
const REQUIREMENT = { text: 'SYNTHETIC_D211 an ask', instruction: { eventId: 'E1', role: 'instruction',
  quote: 'SYNTHETIC_D211 the ask' }, status: 'done' };
const DECISION = { dimension: 'SYNTHETIC_D211 a dimension', chosen: 'SYNTHETIC_D211 chosen', actions: ['E1'],
  notActing: true, stated: { eventId: 'E1', role: 'commentary', quote: 'SYNTHETIC_D211 stated' } };
export const IMAGE = Object.freeze({ mediaType: 'image/png', data: 'iVBORw0KGgo=' });

/** Each kept request (its "Now answer" either NOW_ANSWER or NOW_ANSWER_AGAIN, one with an image) and the two re-asks
 *  built from it: `{ name, kept, reasks: { restatus, reanchor } }` (D212: W1 A's recolumn re-ask is withdrawn). */
export function syntheticReasks() {
  return [['first', NOW_ANSWER], ['again', NOW_ANSWER_AGAIN], ['image', NOW_ANSWER, [IMAGE]]].map(([name, tail, images]) => {
    const kept = keptRequest(tail, images);
    return { name, kept, tail, reasks: {
      restatus: restatusRequest({ request: kept, row: REQUIREMENT, refutations: [vote(1)], label: 'narrative:w1:restatus:0' }),
      reanchor: reanchorRequest({ request: kept, row: DECISION, refutations: [vote(3), vote(4)],
        label: 'narrative:w1:reanchor:0' }) } };
  });
}

// ---- a session review's restatus re-asks, through runReview (the S3 fixture) ----------------------------------------

export const S3_ASK = 'Fix greet.js so empty names give the guest greeting. Also add a test for it.';
const SIDECAR = { stdout: 'PASS', stderr: '', interrupted: false, isImage: false, noOutputExpected: false };
const s3Rows = () => [
  humanAsk(S3_ASK),
  call('t1', 'Edit', { file_path: '/repo/greet.js', old_string: 'return name', new_string: 'return name || "guest"' }),
  result('t1', 'The file /repo/greet.js has been updated.', { filePath: '/repo/greet.js', oldString: 'return name',
    newString: 'return name || "guest"', originalFile: 'return name\n', structuredPatch: [], userModified: false,
    replaceAll: false }),
  call('t2', 'Bash', { command: 'npm test' }),
  result('t2', 'PASS test/greet.test.js\n3 passed', SIDECAR),
  said('Fixed greet.js; I did not add a test.'),
];

/** The S3 session with both of its asks refuted, so its window sends two restatus re-asks. `hold(request)` is called
 *  with each re-ask as it reaches the judge and may return a promise it is answered after (default: at once). Resolves
 *  `{ seen, kept, reasks }`: every request in the order the judge received it, the window's kept request and its
 *  re-asks. */
export async function s3Run(t, { hold = () => null } = {}) {
  const { session } = await load(t, s3Rows());
  const of = (kind) => session.events.filter((event) => event.kind === kind);
  const [ask] = of('instruction'), [edit] = of('invocation'), [closing] = of('commentary');
  const q = (eventId, role, quote) => ({ eventId, role, quote });
  const fixAsk = q(ask.id, 'instruction', 'Fix greet.js so empty names give the guest greeting');
  const testAsk = q(ask.id, 'instruction', 'Also add a test for it');
  const shortfall = q(closing.id, 'commentary', 'I did not add a test.');
  const rows = [{ text: 'fix empty names', instruction: fixAsk, status: 'partly-done',
    deliverable: q(edit.id, 'code', 'return name || "guest"'), shortfall },
  { text: 'add a test', instruction: testAsk, status: 'not-done', shortfall }];
  const narrative = (requirements) => ({ decisions: [], pivots: [], claims: [], requirements });
  const seen = [];
  const judge = async (request) => {
    seen.push(request);
    if (request.challenge) return { votes: request.challenge.items.map((item) => {
      const receipt = item.candidate?.deliverable ?? item.candidate?.shortfall ?? item.candidate?.instruction ?? null;
      return { key: item.key, verdict: item.type === 'requirement' && !/:restatus/.test(request.label) ? 'refuted'
        : 'not-refuted', explanation: `SYNTHETIC_D211 check of ${item.key}.`,
      receipts: receipt ? [{ eventId: receipt.eventId, role: receipt.role, quote: receipt.quote }] : [] };
    }) };
    if (/:restatus:/.test(request.label)) {
      await hold(request);
      return narrative([]);
    }
    return narrative(rows);
  };
  await runReview({ session, pr: null, reviewScope: 'session-only', judge });
  return { seen, kept: seen.find((request) => request.label === 'narrative:w1'),
    reasks: seen.filter((request) => /:restatus:/.test(request.label) && !request.challenge) };
}

// ---- the code step's requests, through runCodePass ------------------------------------------------------------------

const enc = (text) => new TextEncoder().encode(text);
const ROOT = '/work/repo';
const R = (eventId, role, quote) => ({ eventId, role, quote });
const CLAIM_QUOTE = 'parse now returns an empty list for empty input.';
const PARSE_LINES = CODE_FILES['src/parse.js'].split('\n').map((line) => line.trim());
function sessionReport() {
  return {
    repo: { host: 'github.com', id: '0' }, reviewScope: 'session-only', pr: null, codeCoverage: 'missing',
    coverage: 'complete', sessionReview: 'complete', findings: [],
    promises: [{ id: `sha256:${'1'.repeat(64)}`, stated: R('C1', 'commentary', CLAIM_QUOTE),
      text: 'The agent said parse returns an empty list for empty input.', status: 'open', receipts: [] }],
    requirements: [{ text: 'Return [] for empty input.', instruction: R('I1', 'instruction', CODE_TEXT.ask),
      status: 'partly-done', deliverable: R('W1', 'code', 'export function parse(input) {'),
      shortfall: R('C1', 'commentary', CLAIM_QUOTE) }],
    decisions: [{ id: `sha256:${'2'.repeat(64)}`, dimension: 'How to split the input', chosen: 'Split on commas',
      actions: ['W1'], column: 'unasked', stated: null }],
    failures: [], writtenClaims: [],
  };
}
const named = (path) => String(path).replace(/^\.\//, '').replace(`${ROOT}/`, '');
const fileOf = (path) => (Object.hasOwn(CODE_FILES, named(path)) ? { path: named(path), text: CODE_FILES[named(path)],
  sha256: createHash('sha256').update(enc(CODE_FILES[named(path)])).digest('hex') } : null);
const repo = { root: ROOT, top: ROOT, read: fileOf, base: () => null };
function snapshot(session) {
  const plan = codeSnapshotPlan(session);
  return freezeCodeSnapshot(plan, plan.map((entry) => (Object.hasOwn(CODE_FILES, entry.path)
    ? { path: entry.path, bytes: enc(CODE_FILES[entry.path]) } : { path: entry.path, state: 'deleted' })),
  { base: { kind: 'recorded_edits' } });
}
/** Three findings, each on its own line of parse.js, and one question on the ask. */
const findingOn = (line) => reviewFinding({ kind: 'missed_case', title: `SYNTHETIC_D211 on line ${line}`,
  trace: [{ step: `SYNTHETIC_D211 line ${line} shows it.`, path: 'src/parse.js', side: 'new', startLine: line,
    endLine: line, quote: PARSE_LINES[line - 1] }], anchor: { path: 'src/parse.js', side: 'new', startLine: line,
    endLine: line } });
export const CODE_ANSWER = Object.freeze({ findings: [findingOn(1), findingOn(2), findingOn(3)],
  questions: [{ question: 'SYNTHETIC_D211 should empty input throw?', key: 'S1', quote: 'add a parse function' }] });

/**
 * The code step over the fixture: the review agent's first answer cannot be used, so it asks its one repair, which
 * answers CODE_ANSWER; the first finding's check, the batch check and the accounting each answer once in no shape, so
 * each asks once more. `hold(request)` is called with each request as it reaches the judge and may return a promise it
 * is answered after. Resolves every request in the order the judge received it.
 */
export async function codeRun({ hold = () => null } = {}) {
  const seen = [];
  const judge = async (request) => {
    seen.push(request);
    await hold(request);
    const { label } = request;
    if (label === 'code-review:agent') return { findings: 'SYNTHETIC_D211 not a list' };
    if (label === 'code-review:repair') return CODE_ANSWER;
    if (label === 'code-verify:F1' || label === 'code-verify:batch' || label === 'code-account:1') return {};
    if (/^code-verify:F\d+(:reask)?$/.test(label)) return holds(verifiedFinding(request.prompt));
    if (/^code-verify:batch(:reask)?$/.test(label)) return allSound(batchItems(request.prompt));
    if (/^code-account:\d+(:reask)?$/.test(label)) return accountsHold(request.prompt);
    throw new Error(`unexpected request ${label}`);
  };
  const session = codeSession();
  await runCodePass({ report: sessionReport(), session, snapshot: snapshot(session), repo, bound: 1_620_000, judge,
    base: { kind: 'recorded_edits' }, root: ROOT, top: null, gate: null, ran: true });
  return seen;
}
