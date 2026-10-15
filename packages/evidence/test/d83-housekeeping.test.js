// D83 (3), owner decision 2026-10-12 (C-06 "D83: the agent's housekeeping is not a decision"): an action that changes
// nothing the person gets — a scratch file outside the repository, a read, a search — is not a decision "made without
// asking you". A session decision whose cited actions are all such housekeeping, by structure only, is not listed; the
// report counts it by its closed kinds. Every recording here is synthetic (invented asks, paths and code); no model is
// called — the judges are code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, humanAsk, call, result, said } from './m33-u-unasked-fixture.js';
import { runReview } from '../src/run-review.js';
import { NOT_LISTED_REASONS, HOUSEKEEPING_KINDS, housekeepingKinds, buildLedger } from '../src/ledger.js';

const ASK = 'Write the parser in src/parser.js.';
const CODE = 'export const parse = (s) => s.trim();\n';
const NOTES = 'SYNTHETIC scratch notes: parser plan.\n';
const KEEP = 'I will leave the README as it is.';
const write = (id, path, content) => [
  call(id, 'Write', { file_path: path, content }),
  result(id, `File created successfully at: ${path}`, { type: 'create', filePath: path, content, structuredPatch: [] }),
];
/** The ask; a scratch write outside the repository (`/tmp`, outside the recorder's `/repo`); a read and a search of
 *  the repository; the write inside it (unless `repo: false`); a shell command the recorder typed nothing about; the
 *  close. */
const rows = ({ repo = true } = {}) => [
  humanAsk(ASK),
  ...write('s1', '/tmp/scratch/notes.md', NOTES),
  call('r1', 'Read', { file_path: '/repo/README.md' }),
  result('r1', '1\tSYNTHETIC readme'),
  said(KEEP),
  call('g1', 'Grep', { pattern: 'parse', path: '/repo/src' }),
  result('g1', 'No matches found'),
  ...(repo ? write('w1', '/repo/src/parser.js', CODE) : []),
  call('b1', 'Bash', { command: 'ls src', description: 'List the sources' }),
  result('b1', 'parser.js', { stdout: 'parser.js', stderr: '', interrupted: false, isImage: false,
    noOutputExpected: false }, false),
  said('The parser is written.'),
].map((r, i) => ({ ...r, uuid: `u-d83h-${i + 1}` }));

async function fixture(t, options) {
  const { session } = await load(t, rows(options));
  const calls = session.events.filter((e) => e.kind === 'invocation');
  const ask = session.events.find((e) => e.kind === 'instruction' && e.authority === 'human');
  const [read, search] = calls.filter((e) => e.tool === 'read');
  const keep = session.events.find((e) => e.kind === 'commentary' && session.textOf(e) === KEEP);
  return { session, ask, read, search, keep, shell: calls.find((e) => e.operation === 'command'),
    scratch: calls.find((e) => e.operation === 'write' && e.paths[0]?.path.startsWith('/tmp')),
    repoWrite: calls.find((e) => e.operation === 'write' && e.paths[0]?.path === 'src/parser.js') };
}

const decision = (dimension, actions) => ({ dimension, chosen: `SYNTHETIC: ${dimension}`,
  actions: actions.map((e) => e.id) });
/** A judge: the narrative gets `decisions`; every decision is upheld on its first cited action's own recorded words;
 *  no column item is sent (today's column: the window answer's own field). */
const judgeOf = (session, decisions) => async (request) => {
  if (!request.challenge) return { decisions, pivots: [], claims: [], requirements: [] };
  const words = (id) => session.sourcesFor(session.event(id))
    .find((s) => s.role === 'action' && s.text.length >= 4).text;
  return { votes: request.challenge.items.map((item) => ({ key: item.key, verdict: 'not-refuted',
    explanation: 'Synthetic.', receipts: [item.candidate.notActing === true ? item.candidate.stated
      : { eventId: item.candidate.actions[0], role: 'action', quote: words(item.candidate.actions[0]) }] })) };
};
const review = async (session, decisions) => runReview({ session, judge: judgeOf(session, decisions),
  reviewScope: 'session-only' });

test('D83 (3): the closed reason and kinds', () => {
  assert.deepEqual([...NOT_LISTED_REASONS], ['housekeeping']);
  assert.deepEqual([...HOUSEKEEPING_KINDS], ['writes_nothing', 'outside_repository']);
});

test('D83 (3): a decision citing only an outside-repository write is not listed; one citing a repository write and a '
  + 'scratch write is', async (t) => {
  const { session, scratch, repoWrite } = await fixture(t);
  assert.ok(scratch.changes.every((c) => c.outsideRepository === true), 'premise: the scratch write is outside');
  assert.ok(repoWrite.changes.some((c) => c.outsideRepository !== true), 'premise: the parser write is inside');
  const report = await review(session, [decision('scratch notes', [scratch]),
    decision('parser module', [repoWrite, scratch])]);
  assert.deepEqual(report.decisions.map((d) => d.dimension), ['parser module']);
  assert.deepEqual(report.counts.notListed, { housekeeping: 1, kinds: { writes_nothing: 0, outside_repository: 1 } });
  assert.equal(report.counts.decisions, 1);
  assert.equal(report.rejectedDecisions.length, 0, 'not a rejection: it never caps coverage');
});

test('D83 (3): a decision citing only reads and searches writes nothing, and is not listed', async (t) => {
  const { session, read, search, repoWrite } = await fixture(t);
  const report = await review(session, [decision('what to read', [read, search]),
    decision('parser module', [repoWrite])]);
  assert.deepEqual(report.decisions.map((d) => d.dimension), ['parser module']);
  assert.deepEqual(report.counts.notListed.kinds, { writes_nothing: 1, outside_repository: 0 });
});

test('D83 (3): a choice not to act is never left out, even when every action it cites is a read', async (t) => {
  const { session, read, keep, repoWrite } = await fixture(t);
  const report = await review(session, [{ ...decision('the README', [read]), notActing: true,
    stated: { eventId: keep.id, role: 'commentary', quote: KEEP } }, decision('parser module', [repoWrite])]);
  const left = report.decisions.find((d) => d.dimension === 'the README');
  assert.equal(left?.notActing, true, 'listed, as a choice not to act');
  assert.equal(Object.hasOwn(report.counts, 'notListed'), false);
});

test('D83 (3): a shell command is never housekeeping by its text; with no listed decision, no count', async (t) => {
  const { session, shell, repoWrite } = await fixture(t);
  const report = await review(session, [decision('listing', [shell]), decision('parser module', [repoWrite])]);
  assert.deepEqual(report.decisions.map((d) => d.dimension).sort(), ['listing', 'parser module']);
  assert.equal(Object.hasOwn(report.counts, 'notListed'), false, 'absent when nothing was left out');
});

test('D83 (3): in a recording with no write inside the repository, a write outside it is listed (it may be the work)',
  async (t) => {
    const { session, scratch } = await fixture(t, { repo: false });
    const report = await review(session, [decision('scratch notes', [scratch])]);
    assert.deepEqual(report.decisions.map((d) => d.dimension), ['scratch notes']);
    assert.equal(housekeepingKinds(session, [scratch]), null);
  });

test('D83 (3): the kinds by structure — the recorder\'s typed reading of a command, never its text', () => {
  const session = { events: [{ kind: 'invocation', operation: 'edit', changes: [{ path: 'src/a.js' }] }] };
  const command = (parsedCmd) => ({ kind: 'invocation', operation: 'command',
    ...(parsedCmd ? { recorded: { parsedCmd } } : {}) });
  assert.deepEqual(housekeepingKinds(session,
    [command([{ type: 'read' }, { type: 'search' }, { type: 'list_files' }])]), ['writes_nothing']);
  assert.equal(housekeepingKinds(session, [command([{ type: 'read' }, { type: 'unknown' }])]), null);
  assert.equal(housekeepingKinds(session, [command(null)]), null, 'no typed reading: never housekeeping');
  const outside = { kind: 'invocation', operation: 'write', changes: [{ path: '/tmp/x', outsideRepository: true }] };
  assert.deepEqual(housekeepingKinds(session, [outside, { kind: 'invocation', operation: 'other', tool: 'read' }]),
    ['writes_nothing', 'outside_repository']);
  assert.equal(housekeepingKinds(session, [{ ...outside, shellWriteOf: 'b1' }]), null, 'a write parsed from a command');
  assert.equal(housekeepingKinds(session, [{ ...outside, changes: [] }]), null, 'no recorded change');
  assert.equal(housekeepingKinds(session, []), null, 'a decision citing no action');
  assert.equal(housekeepingKinds({ events: [] }, [outside]), null, 'no write inside the repository');
});

test('D83 (3): one tool write with a change inside the repository and one outside it is no housekeeping, and its '
  + 'decision is listed', async (t) => {
  // The slicer gives each recorded path its own event (a Codex patch of two files is two writes), so this one write's
  // two changes are put on it here: the parser write keeps its own change and also carries the scratch write's.
  const { session, scratch, repoWrite } = await fixture(t);
  repoWrite.changes.push(...scratch.changes);
  assert.deepEqual(repoWrite.changes.map((c) => c.outsideRepository === true), [false, true], 'premise: in, then out');
  assert.equal(housekeepingKinds(session, [repoWrite]), null, 'every change must lie outside');
  const candidate = { actorSession: session.sessionKey, ...decision('parser module', [repoWrite]) };
  const ledger = buildLedger({ repo: { host: 'github.com', id: '0' }, session, pr: null, candidates: [candidate],
    reviewScope: 'session-only', notActing: true, housekeeping: true });
  assert.deepEqual(ledger.decisions.map((d) => d.dimension), ['parser module']);
  assert.equal(Object.hasOwn(ledger.counts, 'notListed'), false);
});

test('D83 (3): only a session-only review leaves housekeeping out (the ledger\'s flag)', async (t) => {
  const { session, scratch } = await fixture(t);
  const candidate = { actorSession: session.sessionKey, ...decision('scratch notes', [scratch]) };
  const ledger = (housekeeping) => buildLedger({ repo: { host: 'github.com', id: '0' }, session, pr: null,
    candidates: [candidate], reviewScope: 'session-only', notActing: true, housekeeping });
  assert.equal(ledger(false).decisions.length, 1);
  assert.equal(ledger(true).decisions.length, 0);
  assert.deepEqual(ledger(true).counts.notListed,
    { housekeeping: 1, kinds: { writes_nothing: 0, outside_repository: 1 } });
});
