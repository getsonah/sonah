// M33 J (the opt-in "m33-fast" speed profile). Synthetic sessions, a deterministic fake judge and the
// capture of every request a standard review plans and sends — shared by the tests and by the one-off
// capture that pinned the base values (run once against an export of a2bc39d, the code before any
// speed profile existed). It imports only what a2bc39d already had, so the same file runs on both.
//
// Every byte here is invented: no recording, no model, no network. Nothing prints.
import { createHash } from 'node:crypto';
import { Session } from '../../evidence/src/session.js';

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** `bytes` of deterministic filler text for unit `k`, one numbered line after another. */
function filler(k, bytes) {
  const lines = [`SYNTHETIC_FAST_OUT_${k}: the synthetic step ${k} ran and printed its report.`];
  let size = Buffer.byteLength(lines[0], 'utf8') + 1;
  for (let n = 0; size < bytes; n++) {
    const line = `SYNTHETIC_FAST_FILL_${k}_${String(n).padStart(6, '0')} padding padding padding padding`;
    lines.push(line);
    size += Buffer.byteLength(line, 'utf8') + 1;
  }
  return `${lines.join('\n')}\n`;
}

function build(sessionKey, blobs, specs) {
  const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  const events = specs.map((spec, sequence) => {
    const { blob, ...event } = spec;
    if (event.kind === 'instruction') return { authority: 'human', supersedes: [], text: whole(blob), ...event, sequence };
    if (event.kind === 'commentary') return { phase: 'working', beforeInvocation: null, text: whole(blob), ...event, sequence };
    if (event.kind === 'observation') return { callKey: event.invocation, phase: 'terminal', result: 'succeeded', exitCode: 0,
      terminalStatusProven: true, sourceOfResult: 'native', output: whole(blob), ...event, sequence };
    if (event.kind === 'invocation' && event.write) {
      const { write: path, ...rest } = event;
      return { callKey: rest.id, tool: 'Write', operation: 'write', paths: [{ path }], command: [], input: [],
        changes: [{ path, before: [], after: whole(blob), diff: [] }], ...rest, sequence };
    }
    if (event.kind === 'invocation') return { callKey: event.id, tool: 'Bash', operation: 'command', paths: [],
      command: whole(blob), input: [], changes: [], ...event, sequence };
    return { ...event, sequence };
  });
  return new Session({ sessionKey, adapter: 'claude', blobs, events });
}

/**
 * Ten units of an instruction, a statement, a command and its ~70 KB result, then one command whose result is
 * ~600 KB, then a compaction and a small tail unit. (It made many byte-budget windows; M35 windowing trims each result
 * to 2k tokens, so it is one window now.)
 */
export function largeSession({ units = 10, unitBytes = 70_000, bigBytes = 600_000 } = {}) {
  const blobs = {};
  const specs = [];
  for (let k = 1; k <= units + 1; k++) {
    blobs[`ask${k}`] = `SYNTHETIC_FAST_ASK_${k}: run the synthetic step ${k} and report what it printed.`;
    blobs[`said${k}`] = `SYNTHETIC_FAST_SAID_${k}: running the synthetic step ${k} now.`;
    blobs[`cmd${k}`] = `node /srv/fast/step-${k}.js`;
    blobs[`out${k}`] = filler(k, k === units + 1 ? bigBytes : unitBytes);
    specs.push({ id: `I${k}`, kind: 'instruction', blob: `ask${k}` },
      { id: `C${k}`, kind: 'commentary', blob: `said${k}` },
      { id: `A${k}`, kind: 'invocation', blob: `cmd${k}` },
      { id: `O${k}`, kind: 'observation', invocation: `A${k}`, blob: `out${k}` });
  }
  specs.push({ id: 'B1', kind: 'boundary', boundary: 'compaction' });
  const tail = units + 2;
  blobs[`ask${tail}`] = `SYNTHETIC_FAST_ASK_${tail}: tidy the synthetic notes.`;
  blobs[`cmd${tail}`] = `node /srv/fast/tidy.js`;
  blobs[`out${tail}`] = `SYNTHETIC_FAST_OUT_${tail}: tidied.\n`;
  specs.push({ id: `I${tail}`, kind: 'instruction', blob: `ask${tail}` },
    { id: `A${tail}`, kind: 'invocation', blob: `cmd${tail}` },
    { id: `O${tail}`, kind: 'observation', invocation: `A${tail}`, blob: `out${tail}` });
  return build('sess-fast-large', blobs, specs);
}

/**
 * M35 windowing: a compaction no longer splits a window, so a unit that must be a window of its own also writes a
 * long file (`PAD_BYTES`, shown in full and never carried): no two such units fit one 200k-token window.
 */
const PAD_BYTES = 370_000;
function padUnit(blobs, specs, k, over = {}) {
  blobs[`pad${k}`] = filler(k, PAD_BYTES);
  blobs[`padOut${k}`] = `SYNTHETIC_FAST_PAD_OUT_${k}: file created\n`;
  specs.push({ id: `P${k}`, kind: 'invocation', write: `/srv/fast/pad-${k}.txt`, blob: `pad${k}`, ...over },
    { id: `P${k}-r`, kind: 'observation', invocation: `P${k}`, blob: `padOut${k}`, ...over });
}

/** `count` windows (M35: each unit writes a long file), each one instruction, one command and its result. */
export function manyWindowSession(count = 14) {
  const blobs = {};
  const specs = [];
  for (let k = 1; k <= count; k++) {
    blobs[`ask${k}`] = `SYNTHETIC_FAST_LANE_ASK_${k}: run the synthetic lane ${k}.`;
    blobs[`cmd${k}`] = `node /srv/fast/lane-${k}.js`;
    blobs[`out${k}`] = `SYNTHETIC_FAST_LANE_OUT_${k}: lane ${k} done.\n`;
    specs.push({ id: `I${k}`, kind: 'instruction', blob: `ask${k}` },
      { id: `A${k}`, kind: 'invocation', blob: `cmd${k}` },
      { id: `O${k}`, kind: 'observation', invocation: `A${k}`, blob: `out${k}` });
    padUnit(blobs, specs, k);
    if (k < count) specs.push({ id: `B${k}`, kind: 'boundary', boundary: 'compaction' });
  }
  return build('sess-fast-lanes', blobs, specs);
}

/** `bytes` of deterministic human instruction text for instruction `k`: what grows every later window's
 *  full human instruction inventory. */
function askText(k, bytes) {
  const lines = [`SYNTHETIC_FAST_INVENTORY_ASK_${k}: keep every synthetic step's report and follow these notes.`];
  let size = Buffer.byteLength(lines[0], 'utf8') + 1;
  for (let n = 0; size < bytes; n++) {
    const line = `SYNTHETIC_FAST_NOTE_${k}_${String(n).padStart(6, '0')} keep the synthetic report as written`;
    lines.push(line);
    size += Buffer.byteLength(line, 'utf8') + 1;
  }
  return lines.join('\n');
}

/**
 * M33 J repair. A session whose later windows carry a large human instruction inventory: `instructions`
 * human instructions of `instructionBytes` each, then `units` commands and their `unitBytes` results. The
 * inventory is not source of the windows after the first, so it does not count toward their source
 * budget — but every one of their requests carries it.
 */
export function inventorySession({ instructions = 14, instructionBytes = 20_000, units = 60, unitBytes = 30_000 } = {}) {
  const blobs = {};
  const specs = [];
  for (let k = 1; k <= instructions; k++) {
    blobs[`ask${k}`] = askText(k, instructionBytes);
    specs.push({ id: `I${k}`, kind: 'instruction', blob: `ask${k}` });
  }
  for (let k = 1; k <= units; k++) {
    blobs[`cmd${k}`] = `node /srv/fast/inventory-step-${k}.js`;
    blobs[`out${k}`] = filler(k, unitBytes);
    specs.push({ id: `A${k}`, kind: 'invocation', blob: `cmd${k}` },
      { id: `O${k}`, kind: 'observation', invocation: `A${k}`, blob: `out${k}` });
  }
  return build('sess-fast-inventory', blobs, specs);
}

/** M33 J repair. `count` windows (M35: each turn writes a long file), each one turn in which the agent claims a
 *  check passes and the recorded result then shows it failed: one contradicted claim per window. */
export function contradictedSession(count = 14) {
  const blobs = {};
  const specs = [];
  for (let k = 1; k <= count; k++) {
    const turn = { turn: `T${k}` };
    blobs[`ask${k}`] = `SYNTHETIC_FAST_CHECK_ASK_${k}: run the synthetic check ${k}.`;
    blobs[`said${k}`] = `SYNTHETIC_FAST_CHECK_SAID_${k}: the synthetic check ${k} passes.`;
    blobs[`cmd${k}`] = `node /srv/fast/check-${k}.js`;
    blobs[`out${k}`] = `SYNTHETIC_FAST_CHECK_FAIL_${k}: check ${k} failed`;
    specs.push({ id: `I${k}`, kind: 'instruction', blob: `ask${k}`, ...turn },
      { id: `C${k}`, kind: 'commentary', blob: `said${k}`, ...turn },
      { id: `A${k}`, kind: 'invocation', blob: `cmd${k}`, ...turn },
      { id: `O${k}`, kind: 'observation', invocation: `A${k}`, blob: `out${k}`, result: 'failed', exitCode: 1, ...turn });
    padUnit(blobs, specs, k, turn);
    if (k < count) specs.push({ id: `B${k}`, kind: 'boundary', boundary: 'compaction' });
  }
  return build('sess-fast-contradicted', blobs, specs);
}

/** The narrative of one `contradictedSession` window: its one claim, and the result contradicting it. */
export function contradictedNarrative(window) {
  const k = window.events.find((event) => event.kind === 'commentary').id.slice(1);
  return { decisions: [], pivots: [], requirements: [], claims: [{ text: `The agent said check ${k} passes.`,
    stated: receipt(`C${k}`, 'commentary', `the synthetic check ${k} passes.`),
    contradictedBy: receipt(`O${k}`, 'observation', `SYNTHETIC_FAST_CHECK_FAIL_${k}: check ${k} failed`) }] };
}

export const TURN_TEXT = Object.freeze({
  ask: 'SYNTHETIC_FAST_TURN_ASK: make the synthetic replay report no gaps and write the notes.',
  replay: 'node /srv/fast/replay.js',
  lint: 'node /srv/fast/lint.js',
  claim: 'SYNTHETIC_FAST_TURN_CLAIM: this change clears the gap.',
  three: 'SYNTHETIC_FAST_TURN_REPLAY: gaps=3',
  first: 'SYNTHETIC_FAST_TURN_FIRST: trying the regex parser first.',
  regex: 'SYNTHETIC_FAST_TURN_REGEX: regex parser fails on nested input',
  switched: 'SYNTHETIC_FAST_TURN_SWITCHED: switching to the tokenizer instead of the regex.',
  notes: '# Synthetic notes\nSYNTHETIC_FAST_TURN_STATUS: all replay checks pass.\n',
  wrote: 'SYNTHETIC_FAST_TURN_WROTE: file created',
  checks: 'SYNTHETIC_FAST_TURN_CHECKS: 2 replay checks failing',
  zero: 'SYNTHETIC_FAST_TURN_REPLAY: gaps=0',
  corrected: 'SYNTHETIC_FAST_TURN_CORRECTED: the replay now reports gaps=0 after the fix.',
  plain: 'SYNTHETIC_FAST_TURN_PLAIN: the notes file is written.',
});

/**
 * One turn with every proposal class: a claim a later result contradicts and a later same-turn
 * result and statement that correct it (a resolution item), a plain claim, a decision, a pivot, a
 * requirement, and a statement the agent wrote into a file that a later result contradicts.
 */
export function turnSession() {
  const T1 = { turn: 'T1' };
  const blobs = { ...TURN_TEXT };
  const specs = [
    { id: 'I1', kind: 'instruction', blob: 'ask', ...T1 },
    { id: 'C1', kind: 'commentary', blob: 'claim', ...T1 },
    { id: 'A1', kind: 'invocation', blob: 'replay', ...T1 },
    { id: 'A1-r', kind: 'observation', invocation: 'A1', blob: 'three', result: 'failed', exitCode: 1, ...T1 },
    { id: 'C2', kind: 'commentary', blob: 'first', ...T1 },
    { id: 'A5', kind: 'invocation', blob: 'lint', ...T1 },
    { id: 'A5-r', kind: 'observation', invocation: 'A5', blob: 'regex', result: 'failed', exitCode: 1, ...T1 },
    { id: 'C6', kind: 'commentary', blob: 'switched', ...T1 },
    { id: 'W1', kind: 'invocation', write: '/srv/fast/NOTES.md', blob: 'notes', ...T1 },
    { id: 'W1-r', kind: 'observation', invocation: 'W1', blob: 'wrote', ...T1 },
    { id: 'A3', kind: 'invocation', blob: 'replay', ...T1 },
    { id: 'A3-r', kind: 'observation', invocation: 'A3', blob: 'checks', result: 'failed', exitCode: 1, ...T1 },
    { id: 'A2', kind: 'invocation', blob: 'replay', ...T1 },
    { id: 'A2-r', kind: 'observation', invocation: 'A2', blob: 'zero', ...T1 },
    { id: 'C3', kind: 'commentary', blob: 'corrected', phase: 'final', ...T1 },
    { id: 'C4', kind: 'commentary', blob: 'plain', phase: 'final', ...T1 },
  ];
  return build('sess-fast-turn', blobs, specs);
}

const receipt = (eventId, role, quote) => ({ eventId, role, quote });
export const TURN_RECEIPTS = Object.freeze({
  ask: receipt('I1', 'instruction', TURN_TEXT.ask),
  stated: receipt('C1', 'commentary', 'this change clears the gap.'),
  against: receipt('A1-r', 'observation', TURN_TEXT.three),
  fixed: receipt('A2-r', 'observation', TURN_TEXT.zero),
  accurate: receipt('C3', 'commentary', 'the replay now reports gaps=0 after the fix.'),
  plain: receipt('C4', 'commentary', 'the notes file is written.'),
  first: receipt('C2', 'commentary', TURN_TEXT.first),
  regex: receipt('A5-r', 'observation', TURN_TEXT.regex),
  switched: receipt('C6', 'commentary', TURN_TEXT.switched),
  written: receipt('W1', 'code', 'SYNTHETIC_FAST_TURN_STATUS: all replay checks pass.'),
  checks: receipt('A3-r', 'observation', TURN_TEXT.checks),
});

/** The turn session's one narrative: every proposal class, in a fixed order. */
export function turnNarrative() {
  const r = TURN_RECEIPTS;
  return {
    decisions: [{ dimension: 'SYNTHETIC_FAST_TURN_DIMENSION', chosen: 'Parse with the tokenizer', value: null,
      valueReceipt: null, actions: ['A5'], stated: r.switched, constrainedBy: null }],
    pivots: [{ abandoned: 'the regex parser', adopted: 'the tokenizer', receipts: [r.first, r.regex, r.switched] }],
    claims: [
      { text: 'The agent said the change clears the gap.', stated: r.stated, contradictedBy: r.against,
        resolvedBy: { observation: r.fixed, statement: r.accurate } },
      { text: 'The agent said the notes file is written.', stated: r.plain, contradictedBy: null },
    ],
    // D71 (S2): a session-only review's checklist status, with the deliverable a done row needs (the notes it wrote).
    requirements: [{ text: 'Make the synthetic replay report no gaps.', instruction: r.ask, status: 'done',
      deliverable: r.written }],
    writtenClaims: [{ text: 'The notes say all replay checks pass.', stated: r.written, contradictedBy: r.checks }],
  };
}

/** A generic narrative for a window of `largeSession` or `manyWindowSession`: a requirement per
 *  instruction, a decision per command, a claim per statement — each quoting its window's source. */
export function windowNarrative(session, window) {
  const quote = (event, role) => session.sourcesFor(event).find((s) => s.role === role)?.text.slice(0, 48) ?? '';
  const out = { decisions: [], pivots: [], claims: [], requirements: [] };
  for (const event of window.events) {
    // D71 (S2): "open" was not done or could not tell; a session-only checklist row that names no evidence is not-checked.
    if (event.kind === 'instruction') out.requirements.push({ text: `Do what ${event.id} asks.`,
      instruction: receipt(event.id, 'instruction', quote(event, 'instruction')), status: 'not-checked' });
    else if (event.kind === 'invocation') out.decisions.push({ dimension: `SYNTHETIC_FAST_DIMENSION_${event.id}`,
      chosen: `Run ${event.id}`, value: null, valueReceipt: null, actions: [event.id], stated: null, constrainedBy: null });
    else if (event.kind === 'commentary') out.claims.push({ text: `The agent said ${event.id}.`,
      stated: receipt(event.id, 'commentary', quote(event, 'commentary')), contradictedBy: null });
  }
  return out;
}

/** The first receipt a candidate cites, wherever it sits: what a fake challenger quotes back. */
export function firstReceipt(value) {
  if (Array.isArray(value)) { for (const v of value) { const found = firstReceipt(v); if (found) return found; } return null; }
  if (!plain(value)) return null;
  if (typeof value.eventId === 'string' && typeof value.role === 'string' && typeof value.quote === 'string')
    return { eventId: value.eventId, role: value.role, quote: value.quote };
  for (const v of Object.values(value)) { const found = firstReceipt(v); if (found) return found; }
  return null;
}

/** M33 C (C-05 "M33 vote binding"): the receipt an honest challenger cites to uphold an item — a resolution's
 *  later result, a support's confirming result — else the item's first receipt. Votes do not change a request
 *  byte: only which items survive. */
export function ownReceipt(candidate) {
  const own = plain(candidate) ? candidate.resolvedBy?.observation ?? candidate.supportedBy : null;
  return firstReceipt(own) ?? firstReceipt(candidate);
}

/**
 * The deterministic fake judge. A narrative request is answered by `narrativeOf(request)`. A challenge
 * request votes not-refuted on every item, citing the item's own receipt (`ownReceipt`) — except that on pass 2 of
 * a first (not re-asked) batch the last item is left out, so every such batch takes its one re-ask.
 * `seen` receives every request, in call order.
 */
export function fixtureJudge({ narrativeOf, seen = [], omitOnPass = 2 }) {
  return async (request) => {
    seen.push(request);
    if (!request.challenge) return narrativeOf(request);
    const items = request.challenge.items;
    const kept = request.challenge.reask !== true && request.challenge.pass === omitOnPass ? items.slice(0, -1) : items;
    return { votes: kept.map((item) => ({ key: item.key, verdict: 'not-refuted', explanation: 'Synthetic support.',
      receipts: [ownReceipt(item.candidate)].filter(Boolean) })) };
  };
}

/** What identifies one request's bytes and name: its label and the digests of its system and prompt. */
export const requestIdentity = (request) =>
  `${request.label}|${sha256(request.system ?? '')}|${sha256(request.prompt ?? '')}`;

/**
 * Everything a standard review plans and sends for one synthetic case, as digests: each planned
 * narrative request (label, system, prompt, evidence prompt), and every request the run sent — the
 * sorted list and its digest. `options` is passed to `planWindowRequests` and `runReview` as is (the
 * base ignores a member it does not know). Concurrency 1, so the call order is fixed too. D145: `sentOrder` (optional,
 * on the modules) puts the requests sent in another order before they are digested (`modulesBeforeD145`).
 */
export async function captureCase({ runReview, planWindowRequests, sentOrder = (list) => list },
  { name, session, narrativeOf, options = {} }) {
  const plan = planWindowRequests({ session, reviewScope: 'session-only', ...options });
  const planned = plan.requests.map(({ request }) => `${requestIdentity(request)}|${sha256(request.evidencePrompt)}`);
  const asked = [];
  const report = await runReview({ session, pr: null, reviewScope: 'session-only', concurrency: 1, ...options,
    judge: fixtureJudge({ narrativeOf: (request) => narrativeOf(session, request), seen: asked }) });
  const seen = sentOrder(asked);
  const sent = seen.map(requestIdentity);
  return { name, windows: plan.windows.length, planned: sha256(planned.join('\n')),
    sentCount: sent.length, sentInOrder: sha256(sent.join('\n')), sentSorted: sha256([...sent].sort().join('\n')),
    labels: sha256(seen.map((request) => request.label).join('\n')),
    windowFailures: report.windowFailures.map((w) => `${w.window}:${w.reason}`).join(',') };
}

/** The synthetic cases, each with its narrative. */
export const CASES = Object.freeze([
  { name: 'large', session: largeSession, narrativeOf: (session, request) => windowNarrative(session, request.window) },
  { name: 'turn', session: turnSession, narrativeOf: () => turnNarrative() },
  { name: 'lanes', session: () => manyWindowSession(4),
    narrativeOf: (session, request) => windowNarrative(session, request.window) },
]);

/** Every case captured, plus the digest of both frozen run profiles and the session profile digest. */
export async function captureStandard(modules, { canonicalJson, runProfile, sessionProfileDigest }, options = {},
  profileArgs = []) {
  const cases = [];
  for (const { name, session, narrativeOf } of CASES)
    cases.push(await captureCase(modules, { name, session: session(), narrativeOf, options }));
  return { cases,
    runProfile: { 'session-only': sha256(canonicalJson(runProfile('session-only', ...profileArgs))),
      combined: sha256(canonicalJson(runProfile('combined', ...profileArgs))) },
    sessionProfileDigest: sessionProfileDigest(...profileArgs) };
}
