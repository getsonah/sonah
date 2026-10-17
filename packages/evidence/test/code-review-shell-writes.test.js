// W3d-7 (F173) — an inferred shell write needs per-write completion proof.
//
// A `sed -i`, heredoc or `tee` write is recorded as a sibling `edit` event beside the command that
// carried it (slicer events.js; the adapter links it with `shellWriteOf`). The sibling never gets a
// result of its own. A unique typed zero exit proves it only when the parser has established
// that this sibling is the sole direct write in one simple command. A compound command may
// write before failing or fail a write before a later command succeeds.
//
// Every byte is synthetic: invented instructions, commands, paths and model replies. No model is
// called; the judge is a table keyed by label, never by call order.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runCodeReview } from '../src/code-review.js';
import { Session } from '../src/session.js';

const REPO = { host: 'github.com', id: '708' };
const GREET = 'src/greet.js';
const DIFF = ['diff --git a/src/greet.js b/src/greet.js', 'new file mode 100644', '--- /dev/null',
  '+++ b/src/greet.js', '@@ -0,0 +1,2 @@', '+const SYNTHETIC_W3D7_GREETING = "hello";', '+export default SYNTHETIC_W3D7_GREETING;', ''].join('\n');
const PR = { repo: REPO, number: 708, baseOid: 'b'.repeat(40), diffBaseOid: 'b'.repeat(40), headOid: 'a'.repeat(40),
  gitAlgorithm: 'sha1', enumeration: 'complete', files: [{ path: GREET, change: 'added', contentState: 'complete' }] };

/**
 * One window: a human rule, then a shell command (`A1`) whose write under vendor/ the slicer
 * emitted as a sibling (`A2`, `shellWriteOf: 'A1'`), then a plain Edit (`E1`) under vendor/ too.
 * `command` and `edit` are each one outcome for that invocation's terminal observation, or null
 * for none recorded. `link` overrides the sibling's `shellWriteOf`; null leaves it unlinked.
 */
function vendorSession({ command, edit = 'succeeded', link = 'A1', eligible = true,
  commandText = "sed -i 's/SYNTHETIC_ONE/SYNTHETIC_UNO/' vendor/one.js", denial = null }) {
  const blobs = {
    rule: 'SYNTHETIC_W3D7_RULE: never edit anything under the vendor directory.',
    cmd: commandText,
    body: 'export const SYNTHETIC_W3D7_VENDOR = 2;\n',
    succeeded: 'SYNTHETIC_W3D7_OK', failed: 'SYNTHETIC_W3D7_FAILED', cancelled: 'SYNTHETIC_W3D7_CANCELLED',
    unknown: 'SYNTHETIC_W3D7_UNKNOWN',
  };
  const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  let sequence = 0;
  const events = [{ id: 'I1', kind: 'instruction', authority: 'human', sequence: sequence++, text: whole('rule'), supersedes: [] }];
  const observe = (id, result) => {
    if (result) events.push({ id: `${id}-r`, kind: 'observation', phase: 'terminal', invocation: id, callKey: id,
      sequence: sequence++, result, exitCode: result === 'succeeded' ? 0 : 1,
      terminalStatusProven: true, output: whole(result), sourceOfResult: 'native' });
  };
  events.push({ id: 'A1', kind: 'invocation', callKey: 'A1', tool: 'Bash', operation: 'command', sequence: sequence++,
    paths: [], command: whole('cmd'), input: [], changes: [], ...(denial === null ? {} : { recorded: { denial } }) });
  // The sibling as the adapter emits it: the path and an unrecorded body, never an outcome.
  events.push({ id: 'A2', kind: 'invocation', callKey: 'A2', tool: 'sed', operation: 'edit', sequence: sequence++,
    paths: [{ path: 'vendor/one.js' }], command: [], input: [],
    ...(link === null ? {} : { shellWriteOf: link }),
    ...(eligible ? { shellWriteStatusEligible: true } : {}),
    changes: [{ path: 'vendor/one.js', before: [], after: [], diff: [], extent: { recorded: false } }] });
  observe('A1', command);
  events.push({ id: 'E1', kind: 'invocation', callKey: 'E1', tool: 'Edit', operation: 'edit', sequence: sequence++,
    paths: [{ path: 'vendor/two.js' }], command: [], input: [],
    changes: [{ path: 'vendor/two.js', before: [], after: whole('body'), diff: [] }] });
  observe('E1', edit);
  return new Session({ sessionKey: 'sess-w3d7-shell', adapter: 'claude', events, blobs });
}

const rule = { eventId: 'I1', role: 'instruction', quote: 'SYNTHETIC_W3D7_RULE' };
const breach = (title, action) => ({ origin: 'session-review', kind: 'edit_under_negative_requirement', title,
  explanation: `${title}: an edit under the vendor rule.`, receipts: [rule, action], scope: 'session-effect', anchor: null });
const SHELL = breach('SYNTHETIC_W3D7_SHELL_WRITE', { eventId: 'A2', role: 'action', quote: 'vendor/one.js' });
const PLAIN = breach('SYNTHETIC_W3D7_PLAIN_EDIT', { eventId: 'E1', role: 'action', quote: 'vendor/two.js' });
const COMMAND = breach('SYNTHETIC_W3D7_COMMAND', { eventId: 'A1', role: 'action', quote: 'vendor/one.js' });

/** The window answers `sessionFindings`; a chunk call reviews the PR's one file; nothing else. */
const answering = (sessionFindings) => async (request) => {
  const base = { decisions: [], pivots: [], claims: [], requirements: [], codeFindings: [], sessionFindings: [] };
  if (request.challenge) return { votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted',
    explanation: 'Synthetic support.', receipts: [rule] })) };
  if (/^code\+chunk:/.test(request.label ?? '')) return { ...base, reviewedFiles: [GREET] };
  if (request.label === 'code+narrative:w1') return { ...base, sessionFindings, reviewedFiles: [] };
  return { ...base, reviewedFiles: [] };
};
const review = (session, findings) => runCodeReview({ session, pr: PR, diff: DIFF, judge: answering(findings) });
const outcomeGaps = (report) => report.gaps.filter((g) => g.code === 'write_outcome_unknown');
const published = (report, finding) => report.findings.some((f) => f.title === finding.title);

test('F173 premise: the sibling carries no outcome of its own; its command does', () => {
  const session = vendorSession({ command: 'succeeded' });
  assert.equal(session.outcomeOf('A2'), 'none', 'a shell-write sibling is never observed');
  assert.equal(session.outcomeOf('A1'), 'succeeded');
  assert.equal(session.event('A2').shellWriteOf, 'A1');
});

test('M28 a proved sole direct write with a typed zero exit proceeds to grounding', async () => {
  const report = await review(vendorSession({ command: 'succeeded' }), [SHELL]);
  assert.ok(published(report, SHELL), `the command succeeded, so the write happened:\n${JSON.stringify(report.rejectedFindings)}`);
  assert.deepEqual(outcomeGaps(report), [], 'nothing is missing from the record');
  assert.equal(report.coverage, 'complete');
  assert.equal(report.withheld.proposals, 0);
  assert.equal(report.sessionStatus, 'DECIDE');
});

for (const outcome of ['failed', 'cancelled']) {
  test(`M28 a shell write whose command ${outcome} remains outcome-unknown`, async () => {
    const report = await review(vendorSession({ command: outcome }), [SHELL]);
    assert.ok(!published(report, SHELL), 'never published');
    assert.deepEqual(outcomeGaps(report).map((g) => g.eventIds), [['A2']]);
    assert.equal(report.withheld.causes?.action_failed ?? 0, 0,
      'a process failure cannot prove the earlier write did not land');
    assert.equal(report.coverage, 'partial');
  });
}

for (const [name, command, commandText] of [
  ['successful tail after failed write', 'succeeded', "sed -i 's/A/B/' vendor/one.js; true"],
  ['failed tail after successful write', 'failed', 'tee vendor/one.js; false'],
]) {
  test(`M28 compound ${name} cannot inherit the enclosing command outcome`, async () => {
    const report = await review(vendorSession({ command, commandText, eligible: false }), [SHELL]);
    assert.ok(!published(report, SHELL));
    assert.deepEqual(outcomeGaps(report).map((g) => g.eventIds), [['A2']]);
    assert.equal(report.withheld.causes?.action_failed ?? 0, 0);
    assert.equal(report.coverage, 'partial');
  });
}

for (const [name, over] of [['has no recorded outcome', { command: null }], ['recorded an unknown outcome', { command: 'unknown' }],
  ['is not in the record at all', { command: 'succeeded', link: 'A404' }]]) {
  test(`F173 a shell write whose command ${name} is withheld and caps as write_outcome_unknown, as before`, async () => {
    const report = await review(vendorSession(over), [SHELL]);
    assert.ok(!published(report, SHELL), 'never published');
    const gaps = outcomeGaps(report);
    assert.equal(gaps.length, 1, 'declared once');
    assert.deepEqual(gaps[0].eventIds, ['A2'], 'the write the finding rests on');
    assert.equal(report.coverage, 'partial', 'whether the write happened is absent evidence');
    assert.equal(report.withheld.proposals, 0, 'not an inconclusive check');
  });
}

for (const [edit, expected] of [['succeeded', 'published'], ['failed', 'action_failed'], [null, 'write_outcome_unknown']]) {
  test(`F173 a plain Edit is judged by its own outcome, unchanged: ${edit ?? 'none'} -> ${expected}`, async () => {
    // The shell command's outcome is the opposite of the Edit's, so reading the wrong event shows.
    const report = await review(vendorSession({ command: edit === 'succeeded' ? 'failed' : 'succeeded', edit }), [PLAIN]);
    assert.equal(published(report, PLAIN), expected === 'published');
    assert.equal(report.withheld.causes?.action_failed ?? 0, expected === 'action_failed' ? 1 : 0);
    assert.deepEqual(outcomeGaps(report).map((g) => g.eventIds), expected === 'write_outcome_unknown' ? [['E1']] : []);
  });
}

test('F173 a sibling without the link is judged by its own (absent) outcome — never by a guessed command', async () => {
  const report = await review(vendorSession({ command: 'succeeded', link: null }), [SHELL]);
  assert.ok(!published(report, SHELL));
  assert.deepEqual(outcomeGaps(report).map((g) => g.eventIds), [['A2']]);
});

// D98 (one reading per recorder fact): the cited action is read by the one effect rule (session.js `effectOf`). A command
// that failed or was cancelled may have changed the file before it ended (C-02, D80), so a finding citing the command
// itself rests on an unknown outcome, as one citing its parsed write does; only a command the recorder typed as refused
// before it ran changed nothing.
for (const outcome of ['failed', 'cancelled']) {
  test(`D98 a finding citing a command that ${outcome} is withheld and caps, never read as a failed write`, async () => {
    const report = await review(vendorSession({ command: outcome }), [COMMAND]);
    assert.ok(!published(report, COMMAND));
    assert.deepEqual(outcomeGaps(report).map((g) => g.eventIds), [['A1']]);
    assert.equal(report.withheld.causes?.action_failed ?? 0, 0);
    assert.equal(report.coverage, 'partial');
  });
}

test('D98 a finding citing a command refused before it ran is withheld as a write that did not happen', async () => {
  const report = await review(vendorSession({ command: 'failed', denial: 'user-rejected' }), [COMMAND, SHELL]);
  assert.ok(!published(report, COMMAND) && !published(report, SHELL));
  assert.equal(report.withheld.causes?.action_failed, 2, 'the command and its parsed write changed nothing');
  assert.deepEqual(outcomeGaps(report), []);
  assert.equal(report.coverage, 'complete');
});
