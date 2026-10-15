// C-06 "M33 session verdict": grounded agent claims that survive the challenge are published as
// `promises` — C-06 PromiseRecord { id, stated, text, status, receipts }, status `open` — and none
// is silently discarded. A claim a recorded result contradicts stays a `claim_contradicted` finding.
// A claim whose quote did not ground, or that the challengers did not uphold, is never published.
//
// Synthetic session, synthetic judge: no recording, no model call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session, receiptProjection } from '../src/session.js';
import { runReview, mergeWindowOutputs } from '../src/run-review.js';
import { renderReview } from '../src/review.js';
import { identityDigest } from '../contracts/canonical.js';

const TEXT = {
  ask: 'SYNTHETIC_M33_CLAIM_ASK: add the retry helper and run the unit tests.',
  said: 'SYNTHETIC_M33_CLAIM_SAID: I added the retry helper and the unit tests pass now.',
  cmd: 'npm run test:unit',
  out: 'SYNTHETIC_M33_CLAIM_OUT: Tests: 1 failed, 4 passed, 5 total',
};
const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key], 'utf8') }];
const session = () => new Session({ sessionKey: 'sess-claims', adapter: 'claude', blobs: { ...TEXT }, events: [
  { id: 'I1', kind: 'instruction', sequence: 0, authority: 'human', supersedes: [], text: whole('ask') },
  { id: 'A1', kind: 'invocation', sequence: 1, callKey: 'a1', tool: 'Bash', operation: 'command',
    paths: [], command: whole('cmd'), input: [], changes: [] },
  { id: 'A1-r', kind: 'observation', sequence: 2, invocation: 'A1', callKey: 'a1', phase: 'terminal',
    result: 'failed', exitCode: 1, terminalStatusProven: true, output: whole('out'), sourceOfResult: 'native' },
  { id: 'C1', kind: 'commentary', sequence: 3, phase: 'final', text: whole('said'), beforeInvocation: null },
] });

const STATED = { eventId: 'C1', role: 'commentary', quote: 'I added the retry helper and the unit tests pass now.' };
const CONTRADICTED_BY = { eventId: 'A1-r', role: 'observation', quote: 'Tests: 1 failed, 4 passed, 5 total' };
const CLAIM_TEXT = 'The agent said the retry helper was added and the unit tests pass.';
const claim = (over = {}) => ({ text: CLAIM_TEXT, stated: STATED, contradictedBy: null, ...over });
const support = { verdict: 'not-refuted', explanation: 'The agent said this in its final message.', receipts: [STATED] };
const refute = { verdict: 'refuted', explanation: 'The agent did not say this.', receipts: [STATED] };
/** A judge answering the narrative with `claims`, and every challenge pass with `vote`. */
const judge = (claims, vote = support) => async (request) => request.challenge
  ? { votes: request.challenge.items.map(({ key }) => ({ key, ...vote })) }
  : { decisions: [], pivots: [], requirements: [], claims };
const reviewOf = (claims, vote) => runReview({ session: session(), pr: null, reviewScope: 'session-only',
  judge: judge(claims, vote) });
const REPO = { host: 'github.com', id: '0' };

test('M33 a grounded claim that survived the challenge is published as an open PromiseRecord', async () => {
  const report = await reviewOf([claim()]);
  assert.equal(report.promises.length, 1);
  const [promise] = report.promises;
  assert.deepEqual(Object.keys(promise).sort(), ['id', 'receipts', 'stated', 'status', 'text']);
  assert.equal(promise.status, 'open');
  assert.equal(promise.text, CLAIM_TEXT);
  assert.equal(promise.stated.role, 'commentary');
  assert.equal(promise.stated.eventId, 'C1');
  assert.equal(promise.stated.quote, STATED.quote);
  assert.equal(promise.stated.sessionKey, 'sess-claims', 'the verified receipt, bound to its session');
  assert.ok(promise.receipts.length >= 1 && promise.receipts.every((r) => r.role === 'commentary'),
    'promises require commentary-role receipts (C-06)');
  // C-06 row identity: sonah.promise-identity/1 over repo, stated and text.
  assert.equal(promise.id, identityDigest('sonah.promise-identity/1',
    { repo: REPO, stated: receiptProjection(promise.stated), text: CLAIM_TEXT }));
  assert.match(promise.id, /^sha256:[0-9a-f]{64}$/);
  // It is a claim on the record, not a finding and not an instruction.
  assert.deepEqual(report.findings, []);
});

test('M33 the rendering lists the agent\'s grounded claims, open, with their quotes', async () => {
  const md = renderReview(await reviewOf([claim()]));
  assert.match(md, /### What the agent told you/);
  const section = md.slice(md.indexOf('### What the agent told you'));
  assert.ok(section.includes('The agent said the retry helper was added and the unit tests pass.'), section);
  // M33 C: an open claim reads "not checked", never "open".
  assert.match(section, /\*\*not checked\*\*/);
  assert.doesNotMatch(section.split('\n### ')[0].split('<details>')[0], /\bopen\b/i);
  assert.match(section, /\*\*agent said\*\* `C1` — “I added the retry helper and the unit tests pass now\.”/);
  assert.doesNotMatch(section.split('\n### ')[0], /verified|confirmed|kept/i, 'an open claim is never shown as kept');
});

test('M33 a claim whose quote did not ground is withheld and never published or rendered', async () => {
  const report = await reviewOf([claim({ stated: { eventId: 'C1', role: 'commentary',
    quote: 'SYNTHETIC QUOTE THAT WAS NEVER SAID BY ANYONE' } })]);
  assert.deepEqual(report.promises, []);
  assert.equal(report.claimsRejected, 1);
  // S6 (S5 review M4): the closing message's line the withheld claim quoted is now in no claim, so the section says so
  // by count — the quote itself is never rendered, and no claim is listed.
  const text = renderReview(report);
  assert.doesNotMatch(text, /SYNTHETIC QUOTE THAT WAS NEVER SAID/);
  assert.doesNotMatch(text, /^- \*\*(not checked|confirmed)/m);
  assert.match(text, /_Of the agent's closing messages, 1 line is in no claim: the session page lists it as recorded\._/);
});

test('M33 a claim the challengers refuted is not published', async () => {
  const report = await reviewOf([claim()], refute);
  assert.deepEqual(report.promises, []);
  assert.doesNotMatch(renderReview(report), /### What the agent told you/);
});

test('M33 a contradicted claim stays a claim_contradicted finding and is not an open promise', async () => {
  const report = await reviewOf([claim({ contradictedBy: CONTRADICTED_BY })]);
  assert.deepEqual(report.promises, []);
  assert.deepEqual(report.findings.map((f) => f.kind), ['claim_contradicted']);
});

test('M33 the same claim reported by two windows is one promise, by its C-06 identity', async () => {
  const [promise] = (await reviewOf([claim()])).promises;
  const merged = mergeWindowOutputs({ repo: REPO, perWindow: [
    { decisions: [], findings: [], requirements: [], promises: [promise] },
    { decisions: [], findings: [], requirements: [], promises: [{ ...promise }] },
  ] });
  assert.equal(merged.promises.length, 1);
});
