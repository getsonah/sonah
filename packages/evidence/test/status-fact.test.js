// Status fact (owner decision 2026-10-06: "unproven" is not a terminal state; C-02, C-05).
//
// A command line whose zero exit status does not cover every command of the line (a pipeline, a `;` sequence, …) still
// proves one fact: its last command finished with a zero status. The canonical observation carries it apart from whether
// it covers the line (`lastStatus`, `coversAll`, `statusGap`); every request that shows the result states it in one
// fixed sentence; and a support or a contradiction citing such a result is admissible only through a verbatim quote of
// its own output, judged by the existing challenge. A covered status keeps its structural path; a proven failure stays
// one. No code reads the output's words to decide pass or fail.
//
// Synthetic sessions (/srv/x paths) and synthetic judges only: no recording, no model call. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Session } from '../src/session.js';
import * as reviewRun from '../src/run-review.js';
import * as challenge from '../src/challenge.js';
import * as prompt from '../src/prompt.js';
import * as statusFact from '../src/status-fact.js';
import { sessionFromLedger, LEDGER_STATUS_GAPS, LAST_STATUS_VERDICTS } from '../adapters/sonah-ledger.js';
import { EXIT_STATUS_GAPS } from '../../slicer/src/events.js';
import { sliceLineage } from '../../slicer/index.js';
import { redact } from '../../redact/index.js';
import { STATUS_FACT_TEXT, STATUS_LINES, beforeStatusFact, statusLinesIn } from './status-fact-fixture.js';
import { stableText } from './m35-windows-fixture.js';

const KEY = 'sess-status-fact';
const TEXT = {
  ask: 'SYNTHETIC_SF_ASK: fix the parser and make the suite pass.',
  run: 'npm test 2>&1 | tail -5',
  failOut: 'SYNTHETIC_SF_RUN_1\nTests: 1 failed, 41 passed, 42 total',
  claimFalse: 'SYNTHETIC_SF_FALSE: all tests pass.',
  claimGreen: 'SYNTHETIC_SF_GREEN: the suite is green now.',
  passOut: 'SYNTHETIC_SF_RUN_2\nTests: 42 passed, 42 total',
  claimLint: 'SYNTHETIC_SF_LINT: the lint is clean.',
  lint: 'cd /srv/x && npm run lint',
  lintOut: 'SYNTHETIC_SF_LINT_OUT: 0 warnings',
  ask2: 'SYNTHETIC_SF_ASK_2: and the docs?',
  docs: 'SYNTHETIC_SF_DOCS: the docs build too.',
};
const PIPELINE_SENTENCE = 'This command line exited 0; that is the status of the last command of its pipeline and does not '
  + 'cover the earlier commands of the pipeline (pipeline).';
const ref = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key], 'utf8') }];
const T1 = { turn: 'T1' };
const command = (id, key, over = {}) => ({ id, kind: 'invocation', callKey: id, tool: 'Bash', operation: 'command',
  paths: [], command: ref(key), input: [], changes: [], ...T1, ...over });
/** An uncovered zero status: exit 0 on a pipeline — result `unknown`, the fact stated beside it. */
const uncovered = (id, invocation, key) => ({ id, kind: 'observation', invocation, callKey: invocation, phase: 'terminal',
  result: 'unknown', exitCode: 0, terminalStatusProven: true, output: ref(key), sourceOfResult: 'native',
  lastStatus: { exitCode: 0, verdict: null }, coversAll: false, statusGap: 'pipeline', ...T1 });
/** A covered zero status: exit 0 on an `&&` chain — `succeeded`. */
const covered = (id, invocation, key) => ({ id, kind: 'observation', invocation, callKey: invocation, phase: 'terminal',
  result: 'succeeded', exitCode: 0, terminalStatusProven: true, output: ref(key), sourceOfResult: 'native',
  lastStatus: { exitCode: 0, verdict: null }, coversAll: true, ...T1 });
const said = (id, key, over = {}) => ({ id, kind: 'commentary', phase: 'working', beforeInvocation: null, text: ref(key),
  ...T1, ...over });

/** One turn: a pipeline that printed a failing tally (exit 0), a false claim, a later green pipeline, a covered lint. */
function session() {
  const events = [
    { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: ref('ask'), ...T1 },
    command('A1', 'run'), uncovered('A1-r', 'A1', 'failOut'),
    said('C1', 'claimFalse'),
    said('C2', 'claimGreen'),
    command('A2', 'run'), uncovered('A2-r', 'A2', 'passOut'),
    said('C3', 'claimLint'),
    command('A3', 'lint'), covered('A3-r', 'A3', 'lintOut'),
  ].map((event, sequence) => ({ ...event, sequence }));
  return new Session({ sessionKey: KEY, adapter: 'claude', blobs: { ...TEXT }, events, children: [] });
}

const receipt = (eventId, role, quote) => ({ eventId, role, quote });
const CLAIMS = Object.freeze({
  // A contradiction through the failing line of an exit-0 pipeline.
  contradicted: { text: 'The agent said all tests pass.', stated: receipt('C1', 'commentary', 'all tests pass.'),
    contradictedBy: receipt('A1-r', 'observation', 'Tests: 1 failed, 41 passed') },
  // A support through the passing line of a later exit-0 pipeline.
  supported: { text: 'The agent said the suite is green.', stated: receipt('C2', 'commentary', 'the suite is green now.'),
    contradictedBy: null, supportedBy: receipt('A2-r', 'observation', 'Tests: 42 passed') },
  // A support of a covered status: its structural path.
  lint: { text: 'The agent said the lint is clean.', stated: receipt('C3', 'commentary', 'the lint is clean.'),
    contradictedBy: null, supportedBy: receipt('A3-r', 'observation', '0 warnings') },
});
const narrativeOf = (claims) => ({ decisions: [], pivots: [], requirements: [], claims: structuredClone(claims) });
const ownReceipt = ({ candidate }) => candidate.contradictedBy ?? candidate.supportedBy ?? candidate.stated;
function judgeWith(narrative, { verdict = () => 'not-refuted', cite = ownReceipt, seen = [] } = {}) {
  return async (request) => {
    seen.push(request);
    if (!request.challenge) return request.window.index === 0 ? structuredClone(narrative) : narrativeOf([]);
    return { votes: request.challenge.items.map((item) => {
      const chosen = verdict(item, request);
      return { key: item.key, verdict: chosen, explanation: 'Synthetic.', receipts: chosen === 'uncertain' ? [] : [cite(item, request)] };
    }) };
  };
}
const run = (claims, options = {}, base = session()) => reviewRun.runReview({ session: base, pr: null,
  reviewScope: 'session-only', judge: judgeWith(narrativeOf(claims), options) });
const decided = (report) => report.findings.filter((f) => f.kind === 'claim_contradicted').map((f) => f.status);
const votesOf = (report, type) => report.windowResults.flatMap((w) => [...(w.challenge?.results ?? []),
  ...(w.supportChallenge?.results ?? [])]).filter((r) => r.type === type).flatMap((r) => r.votes);
const promiseOf = (report, eventId) => report.promises.find((p) => p.stated.eventId === eventId);

// ---- the closed vocabularies ---------------------------------------------------------------------------------------

test('status fact: the closed tables — one sentence per slicer reason, the adapter\'s copy equal to the slicer\'s', () => {
  assert.deepEqual(LEDGER_STATUS_GAPS, EXIT_STATUS_GAPS);
  assert.deepEqual(Object.keys(statusFact.STATUS_GAP_WORDS).sort(), [...EXIT_STATUS_GAPS].sort());
  assert.deepEqual(LAST_STATUS_VERDICTS, ['completed', 'failed']);
  for (const table of [LEDGER_STATUS_GAPS, LAST_STATUS_VERDICTS, statusFact.STATUS_GAP_WORDS]) assert.ok(Object.isFrozen(table));
  assert.deepEqual([...challenge.VOTE_REJECTION_CAUSES], ['support_unbound', 'result_unquoted',
    'write_command_not_run_or_failed']);
  // The fixture's literal lines are every sentence the code can state, and nothing else.
  const states = [];
  for (const lastStatus of [{ exitCode: 0, verdict: null }, { exitCode: null, verdict: 'completed' }])
    for (const statusGap of [...EXIT_STATUS_GAPS, undefined])
      states.push(statusFact.statusFactLine({ kind: 'observation', lastStatus, coversAll: false, ...(statusGap ? { statusGap } : {}) }));
  assert.deepEqual(states.map((line) => `\n${line}`).sort(), [...STATUS_LINES].sort());
});

test('status fact: only an uncovered zero status states a sentence; a covered one, a failure or no status states none', () => {
  const base = { kind: 'observation', lastStatus: { exitCode: 0, verdict: null } };
  assert.equal(statusFact.statusFactSentence({ ...base, coversAll: false, statusGap: 'pipeline' }), PIPELINE_SENTENCE);
  assert.equal(statusFact.statusFactSentence({ kind: 'observation', lastStatus: { exitCode: null, verdict: 'completed' },
    coversAll: false, statusGap: 'sequence' }), 'This command line finished with a zero status (the harness\'s typed verdict; no '
    + 'exit code was recorded); that is the status of its last command and does not cover the commands before a ; or a newline (sequence).');
  for (const event of [{ ...base, coversAll: true }, { ...base, lastStatus: { exitCode: 1, verdict: null }, coversAll: false },
    { kind: 'observation', lastStatus: { exitCode: null, verdict: 'failed' }, coversAll: false }, { kind: 'observation' },
    { ...base, coversAll: false, statusGap: 'SYNTHETIC_NOT_A_REASON' }, { ...base, kind: 'invocation', coversAll: false }])
    assert.equal(statusFact.statusFactSentence(event), null, JSON.stringify(event));
  assert.equal(statusFact.statusUncovered({ ...base, coversAll: false, statusGap: 'or_list' }), true);
  assert.equal(statusFact.statusUncovered({ ...base, coversAll: true }), false);
});

// ---- the slicer and the adapter: the fact on the ledger and the canonical event --------------------------------------

const SIDECAR = (stdout) => ({ stdout, stderr: '', interrupted: false, isImage: false, noOutputExpected: false });
async function sliced(t, calls) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-status-fact-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const rows = [{ type: 'user', message: { role: 'user', content: 'SYNTHETIC_SF: run the checks.' } }];
  calls.forEach(({ command: cmd, out, error }, at) => {
    const id = `b${at}`;
    rows.push({ type: 'assistant', version: '2.1.205', message: { role: 'assistant', content: [
      { type: 'tool_use', id, name: 'Bash', input: { command: cmd } }] } });
    rows.push({ type: 'user', version: '2.1.205', message: { role: 'user', content: [
      { type: 'tool_result', tool_use_id: id, content: out, is_error: error === true }] },
      ...(error ? {} : { toolUseResult: SIDECAR(out) }) });
  });
  const file = join(dir, 'status-fact.jsonl');
  await writeFile(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  const raw = await sliceLineage([file], { cwd: '/srv/x' });
  return { ledger: raw.ledger, session: sessionFromLedger(redact(raw).ledger, { sessionKey: KEY }) };
}

test('status fact: the ledger keeps the closed reason; the canonical result states the last status apart from it', async (t) => {
  const { ledger, session: s } = await sliced(t, [
    { command: 'npm test 2>&1 | tail -5', out: 'SYNTHETIC_SF_A\nTests: 1 failed' },
    { command: 'cd /srv/x && npm test', out: 'SYNTHETIC_SF_B' },
    { command: 'npm test; echo done', out: 'SYNTHETIC_SF_C', error: true },
    { command: 'set -o pipefail; npm test | tail -5', out: 'SYNTHETIC_SF_D' }]);
  const commands = ledger.filter((e) => typeof e.cmd === 'string');
  assert.deepEqual(commands.map((e) => [e.outcome, e.statusGap]), [['unproven', 'pipeline'], ['passed', undefined],
    ['failed', undefined], ['passed', undefined]]);
  const results = s.events.filter((e) => e.kind === 'observation');
  const fact = (e) => ({ result: e.result, lastStatus: e.lastStatus, coversAll: e.coversAll, statusGap: e.statusGap });
  assert.deepEqual(results.map(fact), [
    // Claude Code's typed verdict on a pipeline: a zero status, stated, that does not cover the line.
    { result: 'unknown', lastStatus: { exitCode: null, verdict: 'completed' }, coversAll: false, statusGap: 'pipeline' },
    { result: 'succeeded', lastStatus: { exitCode: null, verdict: 'completed' }, coversAll: true, statusGap: undefined },
    // The error flag alone types no last status: the failure is the record's, unchanged.
    { result: 'failed', lastStatus: undefined, coversAll: undefined, statusGap: undefined },
    { result: 'succeeded', lastStatus: { exitCode: null, verdict: 'completed' }, coversAll: true, statusGap: undefined }]);
});

// ---- the request: one fixed sentence per uncovered result -------------------------------------------------------------

test('status fact: a window states the sentence once under each uncovered result, and nowhere else', () => {
  const [built] = reviewRun.planWindowRequests({ session: session(), reviewScope: 'session-only' }).requests;
  // M35 windowing: read with the window's aliases written back as the stable ids they name.
  const text = stableText(built, built.request.prompt);
  assert.equal(statusLinesIn(text), 2, 'A1-r and A2-r; never the covered A3-r');
  // D71 (S2): a session-only RESULT's header names no status; its typed outcome opens it, then the status fact.
  for (const id of ['A1-r', 'A2-r']) {
    const header = `[${id}] RESULT of ${id.slice(0, -2)} · role=observation\n  outcome: ran, exit 0`;
    assert.ok(text.includes(`${header}\n  status: ${PIPELINE_SENTENCE}\n`), id);
  }
  assert.ok(!text.includes('[A3-r] RESULT of A3 · role=observation\n  outcome: ran, exit 0\n  status:'));
  // The brief says how to cite such a result (D71 S2: the session-only route's task is the brief); a combined request's
  // task still does; rendered back, the request is /14's text with no sentence.
  assert.ok(built.request.system.replace(/\s+/g, ' ').includes('A RESULT with a "status:" line proves nothing by its exit '
    + 'status: cite it only by quoting the line of its output that shows the result.'));
  const [combined] = reviewRun.planWindowRequests({ session: session(), reviewScope: 'combined' }).requests;
  assert.ok(combined.request.prompt.includes(STATUS_FACT_TEXT.narrativeTask));
  assert.equal(statusLinesIn(beforeStatusFact(text)), 0);
  assert.ok(!beforeStatusFact(text).includes('"status:"'));
  // M33 integration moved it once more (`sonah.narrative/17`): one version above every branch's own (C-05 integration).
  // The M33 labels merge moved it once more (`sonah.narrative/18`): the slice-time marker headers.
  // Stable event ids moved it once more (`sonah.narrative/19`): every recorded event's id (C-01 event identity).
  // The D64 wording moved it once more (`sonah.narrative/20`): the proposer's two disclosure sentences.
  // M35 windowing moved it once more (`sonah.narrative/21`): windows, carried context, trims, aliases (C-07).
  // M36 phase 1 moved it once more (`sonah.narrative/22`): the evidence it carries (D68; RECORDED_FACTS_VERSIONS).
  // M36 phase 2 moved it once more (`sonah.narrative/23`): the window format (D68; FORMAT_VERSIONS).
  // M36 phase 3 moved it once more (`sonah.narrative/24`): packed windows, carried failures, the evidence re-ask (D68 K, Q, F; CONVERSATION_VERSIONS).
  // D69 moved it once more (`sonah.narrative/25`): the net view's declines reverted, the harness home folders, the recorder's cwd (D69_VERSIONS).
  // The D69 review moved it once more (`sonah.narrative/26`): a combined request's omission lines offer no request (F2), the ledger moved (typed withholding, paths as recorded) (D69_REVIEW_VERSIONS).
  // D71 (S2) moved it once more (sonah.narrative/27), and D71 (S3) once more (sonah.narrative/28): the new channels (D71_CHANNELS_VERSIONS).
  // The D80 integration moved it once more (sonah.narrative/31): a stopped call's outcome line (D80_VERSIONS).
  // The asks fixes moved it once more (sonah.narrative/33): S3's re-ask of a refuted requirement.
  // W1 A moved it once more (sonah.narrative/34): the re-ask of a decision refuted on who decided it.
  // The release review moved it once more (sonah.narrative/35): a project instruction file the session wrote
  // is left out of the window's project files. The second release review moved it once more
  // (sonah.narrative/36): that file's path is compared under the working directory. G2 moved it once more
  // (sonah.narrative/37): the re-ask of a choice not to act whose existence check refuted its words.
  assert.equal(prompt.PROMPT_VERSION, 'sonah.narrative/37');
  // The challengers' system prompt says it once.
  assert.equal(challenge.challengeSystem().split(STATUS_FACT_TEXT.challengeSystem).length, 2);
  // M33 integration moved it once more (`sonah.challenge/15`): one version above every branch's own (C-05 integration).
  // The disclosure narrowing moved it once more (`sonah.challenge/16`): a disclosure item's proposition and note only.
  // Stable event ids moved it once more (`sonah.challenge/17`): every recorded event's id (C-01 event identity).
  // M35 windowing moved it once more (`sonah.challenge/18`): every evidence byte and a session-only candidate's aliases.
  // M36 phase 1 moved it once more (`sonah.challenge/19`): the evidence it carries (D68; RECORDED_FACTS_VERSIONS).
  // M36 phase 2 moved it once more (`sonah.challenge/20`): the window format (D68; FORMAT_VERSIONS).
  // M36 phase 3 moved it once more (`sonah.challenge/21`): packed windows, carried failures, the evidence re-ask (D68 K, Q, F; CONVERSATION_VERSIONS).
  // D69 moved it once more (`sonah.challenge/22`): the net view's declines reverted, the harness home folders, the recorder's cwd (D69_VERSIONS).
  // The D69 review moved it once more (`sonah.challenge/23`): the evidence a challenge shows moved as the narrative's (D69_REVIEW_VERSIONS).
  // D71 (S2) moved it once more (sonah.challenge/24), and D71 (S3) once more (sonah.challenge/25): the new channels (D71_CHANNELS_VERSIONS).
  // The column fix moved it once more (sonah.challenge/30): who decided a decision (FIX_COLUMN_VERSIONS).
  // W1 B moved it once more (sonah.challenge/31): the file form of the forbidden-edit proposition and its note.
  // W2 moved it once more (sonah.challenge/32): CLAIM_NOTE judges the agent's own written text like a result.
  // W3 F1(b) moved it once more (sonah.challenge/33): a support with changes since its run is asked, listed.
  // W3 F2 moved it once more (sonah.challenge/34): a support whose result failed is asked, judged on its outcome.
  // The fix review moved it (sonah.challenge/35 to /37): stopped results, a file rule's lifts, the existence check.
  // D87 moved it once more (sonah.challenge/38, its /35 renumbered at the merge): the code pass's own run; no other
  // request byte moved.
  // The code step moved it once more (sonah.challenge/39): the code pass's run left challengeItems for a runner of its
  // own, verdict first; no other request byte moved.
  // The review of the code step moved it once more (sonah.challenge/40): no `duplicate` refutation, and a
  // finding's checker sees no agent words; no other request byte moved.
  // The second review of the code step moved it once more (sonah.challenge/41): a code check's checker sees no word
  // of the agent's in any row; no other request byte moved.
  // The third review of the code step moved it once more (sonah.challenge/42): a code check's checker sees
  // what its row states again; no other request byte moved.
  // The re-ask of a void vote moved it once more (sonah.challenge/43): a vote a reply cast that could not be
  // counted is asked again once, naming its cause; no first-round request byte moved.
  // Its withdrawal moved it once more (sonah.challenge/44): a vote a reply cast that could not be counted stands
  // again, as before /43; no first-round request byte moved.
  assert.equal(challenge.CHALLENGE_PROFILE.version, 'sonah.challenge/44');
});

// ---- supports: admissible only through a grounded quote of the result's own output -----------------------------------

test('status fact: a support through a grounded quote on an uncovered pipeline is accepted only with an upheld vote', async () => {
  const upheld = await run([CLAIMS.supported]);
  assert.equal(promiseOf(upheld, 'C2').status, 'verified', 'votes quoting the passing line uphold it');
  assert.deepEqual(promiseOf(upheld, 'C2').receipts.map((r) => [r.eventId, r.role, r.quote]),
    [['C2', 'commentary', 'the suite is green now.'], ['A2-r', 'observation', 'Tests: 42 passed']]);
  assert.equal(upheld.counts.promiseSupport.verified, 1);
  assert.ok(votesOf(upheld, 'support').every((v) => v.valid));
  // The same quote refuted by the challengers: not verified.
  const refuted = await run([CLAIMS.supported], { verdict: (item) => (item.type === 'support' ? 'refuted' : 'not-refuted') });
  assert.equal(promiseOf(refuted, 'C2').status, 'open');
  assert.equal(refuted.counts.promiseSupport.rejected.refuted, 1);
});

test('status fact: a support vote that does not quote the uncovered result is result_unquoted; the support is not verified', async () => {
  for (const [name, cite] of [['its command', receipt('A2', 'action', TEXT.run)], ['the claim\'s own words', CLAIMS.supported.stated]]) {
    const report = await run([CLAIMS.supported], { cite: (item) => (item.type === 'support' ? cite : ownReceipt(item)) });
    assert.equal(promiseOf(report, 'C2').status, 'open', name);
    const votes = votesOf(report, 'support');
    assert.equal(votes.length, 3, name);
    // The command binds by one hop but quotes no output; the claim's own words bind nothing for a support.
    assert.ok(votes.every((v) => v.answered && !v.valid && v.cause === (name === 'its command' ? 'result_unquoted' : 'support_unbound')), name);
    assert.equal(report.counts.promiseSupport.rejected.unsettled, 1, name);
    assert.equal(report.counts.promiseSupport.verified, 0, name);
  }
});

test('status fact: a support without a quote of that output is rejected by code with a closed reason', async () => {
  const noQuote = { ...CLAIMS.supported, supportedBy: { eventId: 'A2-r', role: 'observation' } };
  const notInOutput = { ...CLAIMS.supported, supportedBy: receipt('A2-r', 'observation', TEXT.run) };
  const commandRole = { ...CLAIMS.supported, supportedBy: receipt('A2', 'action', TEXT.run) };
  for (const [claim, reason] of [[noQuote, 'malformed'], [notInOutput, 'ungrounded'], [commandRole, 'role_mismatch']]) {
    const seen = [];
    const report = await run([claim], { seen });
    assert.equal(promiseOf(report, 'C2').status, 'open', reason);
    assert.equal(report.counts.promiseSupport.rejected[reason], 1, reason);
    assert.ok(!seen.some((request) => request.challenge?.items.some((item) => item.type === 'support')), `${reason}: never asked`);
  }
});

test('status fact: a covered status keeps its structural path — a vote citing the command binds', async () => {
  const report = await run([CLAIMS.lint], { cite: (item) => (item.type === 'support' ? receipt('A3', 'action', TEXT.lint) : ownReceipt(item)) });
  assert.equal(promiseOf(report, 'C3').status, 'verified');
  assert.ok(votesOf(report, 'support').every((v) => v.valid));
});

// The fix review (2026-10-14): named for what it checks. That the support is refuted is this judge's vote; code asks it
// as a failed result (`failedAsked`), and the claim stays open when its checkers refute it.
test('status fact: a proven failure is still a proven failure — a support citing it is asked and counted as failed, and stays open when refuted', async () => {
  const base = session();
  const events = base.events.map((e) => (e.id === 'A2-r' ? { ...e, result: 'failed', exitCode: 1,
    lastStatus: { exitCode: 1, verdict: null }, coversAll: undefined, statusGap: undefined } : e));
  const failedRun = new Session({ sessionKey: KEY, adapter: 'claude', blobs: { ...TEXT }, events, children: [] });
  // W3 F2 (owner decision 2026-10-13): a session-only review asks it (before: refused `failed_result`); its RESULT's
  // outcome line says it failed, and the checkers refute a claim that it passed. No status sentence is stated for it.
  const report = await run([CLAIMS.supported], { verdict: (item) => (item.type === 'support' ? 'refuted' : 'not-refuted') },
    failedRun);
  assert.equal(report.counts.promiseSupport.rejected.failed_result, 0);
  assert.equal(report.counts.promiseSupport.failedAsked.refuted, 1);
  assert.equal(promiseOf(report, 'C2').status, 'open');
});

// ---- contradictions: the failing line of an exit-0 pipeline -------------------------------------------------------------

test('status fact: a contradiction through a quoted failing line on an exit-0 pipeline publishes DECIDE', async () => {
  const report = await run([CLAIMS.contradicted]);
  assert.deepEqual(decided(report), ['DECIDE']);
  const [finding] = report.findings;
  assert.deepEqual(finding.receipts.map((r) => [r.eventId, r.role, r.quote]),
    [['C1', 'commentary', 'all tests pass.'], ['A1-r', 'observation', 'Tests: 1 failed, 41 passed']]);
  assert.ok(votesOf(report, 'claim').every((v) => v.valid));
});

test('status fact: a contradiction vote citing only the claim or the command is result_unquoted; never published, never CLEAN', async () => {
  for (const cite of [CLAIMS.contradicted.stated, receipt('A1', 'action', TEXT.run)]) {
    const report = await run([CLAIMS.contradicted], { cite: () => cite });
    assert.deepEqual(decided(report), [], cite.role);
    assert.ok(votesOf(report, 'claim').every((v) => v.answered && !v.valid && v.cause === 'result_unquoted'), cite.role);
    assert.equal(report.withheld.unsettled, 1, `${cite.role}: every pass voted; nothing settled it`);
    assert.notEqual(report.sessionStatus, 'CLEAN', `${cite.role}: an unsettled contradiction is never read as clean`);
  }
});
