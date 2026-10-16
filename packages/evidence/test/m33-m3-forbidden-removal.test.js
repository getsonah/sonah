// M33 brittleness M3: the forbidden-edit route published only additive breaches ('wrote', 'ran'), so the commonest
// constraint — "don't delete, remove or change X" — could never be proved broken. One structural breach kind widens it:
//   removed  the code quote is an exact substring of a write's or edit's before side, recorded whole and shown to the
//            window, and occurs fewer times in what it wrote to that path (its after side, recorded whole too).
// The M3 review held a second kind, `deleted` (a delete action quoted by its recorded path), back: a delete's outcome is
// not recorded, so it could not land. A delete stays `violation_not_written`.
// Code checks where the quote sits in the recorded change and how often; the challengers judge the same proposition for
// every kind. Every row and text is synthetic. No real recording is read; no model is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceLineage } from '../../slicer/index.js';
import { redact } from '../../redact/index.js';
import { sessionFromLedger } from '../adapters/sonah-ledger.js';
import { Session } from '../src/session.js';
import * as ledger from '../src/ledger.js';
import * as forbidden from '../src/forbidden.js';
import * as reviewRun from '../src/run-review.js';
import * as challenge from '../src/challenge.js';
import * as story from '../../render/session-story.js';

const PATH = 'docs/legacy.md';
const TEXT = {
  ask: 'SYNTHETIC_M3_ASK: tidy the docs, but keep the legacy note exactly as it is.',
  before: 'Intro line.\nSYNTHETIC_M3_LEGACY_NOTE stays here.\nOutro line.\n',
  after: 'Intro line.\nOutro line.\n',
  found: 'Old body.\nSYNTHETIC_M3_LEGACY_NOTE stays here.\n',
  rewritten: 'New body.\n',
};
const CONSTRAINT = 'keep the legacy note exactly as it is.';
const NOTE = 'SYNTHETIC_M3_LEGACY_NOTE stays here.';
const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key], 'utf8') }];
const extent = (key, over = {}) => ({ chars: TEXT[key].length, lines: TEXT[key].split('\n').length - 1, truncated: false,
  cap: null, recorded: true, redactedLines: 0, priorState: 'edit-text', ...over });
const receipt = (eventId, role, quote) => ({ eventId, role, quote });

/** I1 (the ask), A1 (the action, `action` over its fields), A1-r (its typed result). */
function sessionOf(action, result = 'succeeded') {
  return new Session({ sessionKey: 'm33-m3', blobs: { ...TEXT }, events: [
    { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: whole('ask'), turn: 'T1' },
    { id: 'A1', kind: 'invocation', callKey: 'A1', tool: 'edit', operation: 'edit', paths: [{ path: PATH }], command: [],
      input: [], turn: 'T1', ...action },
    { id: 'A1-r', kind: 'observation', invocation: 'A1', callKey: 'A1', phase: 'terminal', result, terminalStatusProven: true,
      exitCode: null, output: [], sourceOfResult: 'native', turn: 'T1' },
  ].map((event, sequence) => ({ ...event, sequence })) });
}
const editOf = (over = {}) => ({ changes: [{ path: PATH, before: whole('before'), after: whole('after'), diff: [],
  extent: extent('after'), beforeExtent: extent('before'), ...over }] });
const sourceMap = (session) => Object.fromEntries(session.events.map((e) => [e.id, session.sourcesFor(e)]));
const read = (session, violation) => forbidden.readForbiddenEdit({ text: 'SYNTHETIC_M3: removed what the human kept.',
  instruction: receipt('I1', 'instruction', CONSTRAINT), violation }, { session, sourceMap: sourceMap(session) });

test('M3: an edit that took the quoted text out of the file is `removed`', () => {
  const session = sessionOf(editOf());
  const { edit } = read(session, receipt('A1', 'code', NOTE));
  assert.equal(edit.breach, 'removed');
  assert.equal(edit.revertedBy, null, 'a removal is never proved undone by this route');
  assert.equal(forbidden.forbiddenRevert(session, session.event('A1'), edit.violation, 'removed'), null);
  // The challenge item names what the violation is, in code's closed word; the proposition is the same for every kind.
  const item = forbidden.forbiddenChallengeItem('k', edit, challenge.FORBIDDEN_EDIT_PROPOSITION);
  assert.equal(item.candidate.breach, 'removed');
  assert.equal(item.candidate.proposition, challenge.FORBIDDEN_EDIT_PROPOSITION);
  assert.ok(challenge.FORBIDDEN_EDIT_NOTE.includes('"removed"') && !challenge.FORBIDDEN_EDIT_NOTE.includes('"deleted"'));
});

test('M3: text the change kept is neither written nor removed', () => {
  const session = sessionOf(editOf());
  assert.deepEqual(read(session, receipt('A1', 'code', 'Outro line.')), { withheld: 'violation_not_written' });
  assert.deepEqual(read(session, receipt('A1', 'code', 'Intro line.')), { withheld: 'violation_not_written' });
});

test('M3: a removal fails closed on any side not recorded whole', () => {
  const quote = receipt('A1', 'code', NOTE);
  for (const [label, over] of [
    ['before truncated', { beforeExtent: extent('before', { truncated: true }) }],
    ['before redacted', { beforeExtent: extent('before', { redactedLines: 1 }) }],
    ['before not recorded', { beforeExtent: extent('before', { recorded: false }) }],
    ['after truncated', { extent: extent('after', { truncated: true }) }],
    ['after redacted', { extent: extent('after', { redactedLines: 1 }) }],
    ['after extent missing', { extent: undefined }],
  ]) assert.deepEqual(read(sessionOf(editOf(over)), quote), { withheld: 'violation_not_written' }, label);
  // An edit whose before side was not recorded at all holds nothing to quote as removed.
  assert.deepEqual(read(sessionOf(editOf({ before: [], beforeExtent: undefined })), quote), { withheld: 'violation_ungrounded' });
});

test('M3: a whole-file write over a file the record found is `removed` when its body drops the quote', () => {
  // The adapter states the prior state on the change's extent (C-02 `extent.priorState`): here the file as found.
  const overwrite = { tool: 'write', operation: 'write', changes: [{ path: PATH, before: whole('found'), after: whole('rewritten'),
    diff: [], extent: extent('rewritten', { priorState: 'first-write' }), beforeExtent: extent('found', { priorState: 'first-write' }) }] };
  assert.equal(read(sessionOf(overwrite), receipt('A1', 'code', NOTE)).edit.breach, 'removed');
  assert.equal(read(sessionOf(overwrite), receipt('A1', 'code', 'New body.')).edit.breach, 'wrote');
  // A create (nothing recorded before it) removed nothing.
  const create = { tool: 'create', operation: 'write', changes: [{ path: PATH, before: [], after: whole('found'), diff: [],
    extent: extent('found') }] };
  assert.equal(read(sessionOf(create), receipt('A1', 'code', NOTE)).edit.breach, 'wrote');
});

test('M3 review: a delete is no breach kind (held back): quoted by its path or its prior text, not written',
  () => {
    const remove = { tool: 'delete', operation: 'delete', changes: [{ path: PATH, before: whole('found'), after: [], diff: [],
      beforeExtent: extent('found', { priorState: 'deleted' }) }] };
    const session = sessionOf(remove);
    assert.deepEqual(read(session, receipt('A1', 'action', PATH)), { withheld: 'violation_not_written' });
    assert.deepEqual(read(session, receipt('A1', 'action', 'docs/legacy')), { withheld: 'violation_not_written' });
    assert.deepEqual(read(session, receipt('A1', 'code', NOTE)), { withheld: 'violation_not_written' });
    assert.equal(ledger.FORBIDDEN_EDIT_BREACHES.includes('deleted'), false);
    assert.equal(ledger.forbiddenBreachOf(session, session.event('A1'), receipt('A1', 'action', PATH)), null);
  });

test('M3: the ledger names the published kind again from the recording, never from a candidate field', () => {
  const removal = sessionOf(editOf());
  const { forbiddenBreachOf } = ledger;
  assert.equal(forbiddenBreachOf(removal, removal.event('A1'), receipt('A1', 'code', NOTE)), 'removed');
  assert.equal(forbiddenBreachOf(removal, removal.event('A1'), receipt('A1', 'code', 'Outro line.')), null);
  for (const [session, violation, breach] of [[removal, receipt('A1', 'code', NOTE), 'removed']]) {
    const { edit } = read(session, violation);
    const grounded = ledger.groundFinding({ repo: { host: 'github.com', id: 'm3' }, session, pr: null,
      candidate: forbidden.forbiddenFindingCandidate(edit) });
    assert.equal(grounded.ok, true, breach);
    assert.equal(grounded.finding.breach, breach);
    assert.equal(grounded.finding.status, 'DECIDE', `${breach}: a removal against an instruction needs a decision`);
  }
});

// ---- real recorder shapes, end to end ----------------------------------------------------------------------------------

const SESSION = 'c0ffee00-0000-4000-8000-00000000b003';
let uuid = 0;
const row = (extra) => ({ cwd: '/repo', entrypoint: 'claude-desktop', gitBranch: 'main', isSidechain: false,
  parentUuid: null, sessionId: SESSION, timestamp: '2026-10-01T00:00:00Z', userType: 'external',
  uuid: `m3-${++uuid}`, version: '2.1.284', ...extra });
// M34 labels (merged into M33 integration): a human's prompt row carries the host's typed origin, as Claude Code 2.1.219
// and later records it; without it the slicer labels the row harness (`interrupt_untyped`), never the human's ask.
const user = (text) => row({ type: 'user', origin: { kind: 'human' }, promptSource: 'sdk',
  message: { role: 'user', content: text } });
const said = (text) => row({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const call = (id, name, input) => row({ type: 'assistant', message: { role: 'assistant',
  content: [{ type: 'tool_use', id, name, input }] } });
const result = (id, content, sidecar) => row({ type: 'user', toolUseResult: sidecar,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] } });
const rollout = (payload) => ({ type: 'response_item', timestamp: '2026-10-01T00:00:00Z', payload });

async function load(t, rows, name = `${SESSION}.jsonl`) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-m33-m3-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, name);
  await writeFile(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return sessionFromLedger(redact(await sliceLineage([file], { cwd: '/repo' })).ledger, { sessionKey: 'm33-m3' });
}

/** A judge proposing `edit(session)` to the session-only narrative request, and upholding each forbidden-edit item. */
const judgeOf = (proposal) => async (request) => {
  if (request.challenge) return { votes: request.challenge.items.map((item) => ({ key: item.key, verdict: 'not-refuted',
    explanation: 'Synthetic: the instruction ruled it out.', receipts: [item.candidate.violation] })) };
  const asked = `${request.system}${request.prompt}`.includes('"forbiddenEdits"');
  return { decisions: [], pivots: [], claims: [], requirements: [], ...(asked ? { forbiddenEdits: [proposal] } : {}) };
};

test('M3 Claude Code: "keep the line", then an Edit that takes it out → DECIDE, "The agent removed"', async (t) => {
  uuid = 0;
  const FILE = '/repo/docs/legacy.md';
  const ask = 'Tidy docs/legacy.md. Keep the origin line exactly as it is.';
  const line = 'This project grew out of SYNTHETIC_M3_ORIGIN.\n';
  // M3 review: a sidecar with no file state (`originalFile: null`), so the change's before side is the Edit's own
  // replaced text (`edit-text`) — the one shape whose sides compare.
  const session = await load(t, [user(ask),
    call('e1', 'Edit', { file_path: FILE, old_string: line, new_string: '' }),
    result('e1', `The file ${FILE} has been updated successfully.`, { filePath: FILE, oldString: line, newString: '',
      originalFile: null, replaceAll: false, structuredPatch: [], userModified: false }),
    said('Tidied the file.')]);
  const edit = session.events.find((e) => e.kind === 'invocation' && e.operation === 'edit');
  assert.equal(edit.changes[0].extent.priorState, 'edit-text', 'premise: the Edit\'s own replaced text');
  // C-01 event identity: the ask's event, found by what it is (the session's one instruction), never by a positional id.
  const askId = session.events.find((e) => e.kind === 'instruction').id;
  const proposal = { text: 'The human kept the origin line; the agent removed it.',
    instruction: receipt(askId, 'instruction', 'Keep the origin line exactly as it is.'),
    violation: receipt(edit.id, 'code', 'This project grew out of SYNTHETIC_M3_ORIGIN.') };
  const report = await reviewRun.runReview({ session, pr: null, reviewScope: 'session-only', judge: judgeOf(proposal) });
  const found = report.findings.filter((f) => f.kind === 'edit_under_negative_requirement');
  assert.deepEqual(found.map((f) => [f.status, f.breach]), [['DECIDE', 'removed']]);
  const told = story.renderReportMarkdown(session, report);
  assert.ok(told.includes('The agent removed: “This project grew out of SYNTHETIC\\_M3\\_ORIGIN.”'), told);
});

test('M3 review: an Edit whose before side is the whole file as found never certifies a line it left untouched as removed',
  async (t) => {
    uuid = 0;
    const FILE = '/repo/src/main.js';
    const header = '// SYNTHETIC_M3_LICENSE: header kept verbatim.';
    const original = `${header}\nconst greeting = 'helo';\nexport default greeting;\n`;
    const ask = 'Fix the typo in src/main.js. Keep the license header exactly as it is.';
    const session = await load(t, [user(ask),
      call('e1', 'Edit', { file_path: FILE, old_string: "const greeting = 'helo';", new_string: "const greeting = 'hello';" }),
      result('e1', `The file ${FILE} has been updated successfully.`, { filePath: FILE, oldString: "const greeting = 'helo';",
        newString: "const greeting = 'hello';", originalFile: original, replaceAll: false, structuredPatch: [],
        userModified: false }),
      said('Fixed the typo.')]);
    const edit = session.events.find((e) => e.kind === 'invocation' && e.operation === 'edit');
    // Premise: the adapter places the whole file as found on the Edit's first change, beside only its new text.
    assert.equal(edit.changes[0].extent.priorState, 'first-write');
    assert.equal(ledger.replacedSideComparable(edit.operation, edit.changes[0]), false);
    // C-01 event identity: the ask's event, found by what it is (the session's one instruction).
    const instruction = receipt(session.events.find((e) => e.kind === 'instruction').id, 'instruction',
      'Keep the license header exactly as it is.');
    const sourceMap = Object.fromEntries(session.events.map((e) => [e.id, session.sourcesFor(e)]));
    const readOf = (quote) => forbidden.readForbiddenEdit({ text: 'SYNTHETIC_M3: the header.', instruction,
      violation: receipt(edit.id, 'code', quote) }, { session, sourceMap });
    // The untouched header (was `removed` before this rule), and the replaced line itself: neither side compares.
    assert.deepEqual(readOf(header), { withheld: 'violation_not_written' });
    assert.deepEqual(readOf("const greeting = 'helo';"), { withheld: 'violation_not_written' });
    assert.equal(ledger.forbiddenBreachOf(session, edit, receipt(edit.id, 'code', header)), null);
    // What the Edit wrote is still `wrote`: that comparison only ever errs toward withholding.
    assert.equal(readOf("const greeting = 'hello';").edit.breach, 'wrote');
    // End to end, with an upholding judge: nothing is published, the proposal is counted as withheld. M36 phase 2 (D68 H,
    // c4; C-07 "M36 window format"): the window no longer inlines the file as found — it shows the Edit's own written and
    // replaced text — so the header is in no span it showed, and the quote does not ground there at all.
    const report = await reviewRun.runReview({ session, pr: null, reviewScope: 'session-only',
      judge: judgeOf({ text: 'SYNTHETIC_M3: the header.', instruction, violation: receipt(edit.id, 'code', header) }) });
    assert.deepEqual(report.findings.filter((f) => f.kind === 'edit_under_negative_requirement'), []);
    assert.equal(report.counts.forbiddenEdits.withheld.violation_ungrounded, 1);
  });

test('M3 review: which recorded before sides compare for a removal, by the adapter\'s own prior-state word', () => {
  const change = (priorState, marks = {}) => ({ path: PATH, extent: { recorded: true, priorState, ...marks } });
  assert.equal(ledger.replacedSideComparable('edit', change('edit-text')), true);
  assert.equal(ledger.replacedSideComparable('write', change('edit-text')), true);
  assert.equal(ledger.replacedSideComparable('write', change('first-write')), true);
  assert.equal(ledger.replacedSideComparable('edit', change('first-write')), false);
  for (const mark of ['append', 'insert', 'expanded'])
    assert.equal(ledger.replacedSideComparable('write', change('first-write', { [mark]: true })), false, mark);
  for (const state of ['redacted', 'deleted-state', 'none', undefined])
    assert.equal(ledger.replacedSideComparable('edit', change(state)), false, String(state));
  assert.equal(ledger.replacedSideComparable('edit', { path: PATH }), false, 'no extent');
});

test('M3 review Codex: "do not delete it", then a patch deleting the file → withheld, never "deleted"', async (t) => {
  const meta = { type: 'session_meta', payload: { id: 'codex-m3-0001', cwd: '/repo', cli_version: '0.117.0' } };
  const ask = 'Clean up the scripts. Do not delete scripts/legacy.sh.';
  const session = await load(t, [meta,
    rollout({ type: 'message', role: 'user', content: [{ type: 'input_text', text: ask }] }),
    rollout({ type: 'custom_tool_call', name: 'apply_patch', call_id: 'p1',
      input: '*** Begin Patch\n*** Delete File: scripts/legacy.sh\n*** End Patch' }),
    rollout({ type: 'custom_tool_call_output', call_id: 'p1',
      output: 'Exit code: 0\nWall time: 0.1 seconds\nOutput:\nSuccess. Updated the following files:\nD scripts/legacy.sh\n' }),
    rollout({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Cleaned up the scripts.' }] }),
  ], 'rollout-2026-10-01T00-00-00-codex-m3-0001.jsonl');
  const del = session.events.find((e) => e.kind === 'invocation' && e.operation === 'delete');
  assert.ok(del, 'the patch\'s deletion is a delete action');
  const path = del.paths[0].path;
  const ask1 = session.events.find((e) => e.kind === 'instruction').id;
  const proposal = { text: 'The human kept the script; the agent deleted it.',
    instruction: receipt(ask1, 'instruction', 'Do not delete scripts/legacy.sh.'), violation: receipt(del.id, 'action', path) };
  const report = await reviewRun.runReview({ session, pr: null, reviewScope: 'session-only', judge: judgeOf(proposal) });
  assert.deepEqual(report.findings.filter((f) => f.kind === 'edit_under_negative_requirement'), []);
  assert.equal(report.counts.forbiddenEdits.withheld.violation_not_written, 1);
  assert.ok(!story.renderReportMarkdown(session, report).includes('The agent deleted'));
});
