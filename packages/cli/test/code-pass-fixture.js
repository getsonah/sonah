// D87 (the code pass): a synthetic session, a repository folder its files are written to, and a deterministic fake
// reviewer that answers the session review, step 1, step 2 and every challenge. Every byte is invented: no recording, no
// model, no network. Nothing prints.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { Session } from '../../evidence/src/session.js';

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** A FAKE key (the GitHub token shape the redactor knows), planted in a file the pass shows. Not a credential. */
export const FAKE_KEY = `ghp_${'FAKEfake0123456789'.repeat(2)}ab`;

/** The files of the synthetic repository at review time. `parse.js` is what the session wrote; `util.js` it read. */
export const CODE_FILES = Object.freeze({
  'src/parse.js': [
    'export function parse(input) {',
    '  const parts = input.split(",");',
    '  return parts.map((part) => part.trim());',
    '}',
    '',
  ].join('\n'),
  'src/util.js': [
    'export const SEPARATOR = ",";',
    `export const TOKEN = "${FAKE_KEY}";`,
    'export function trimAll(list) { return list.map((x) => x.trim()); }',
    '',
  ].join('\n'),
  '.env': 'API_KEY=not-a-real-key\n',
});

export const CODE_TEXT = Object.freeze({
  ask: 'SYNTHETIC_CODE_ASK: add a parse function that returns [] for empty input, and do not touch the README.',
  body: CODE_FILES['src/parse.js'],
  wrote: 'File created successfully',
  readUtil: 'src/util.js',
  readEnv: '.env',
  readOut: '1\texport const SEPARATOR = ",";',
  claim: 'SYNTHETIC_CODE_CLAIM: parse now returns an empty list for empty input.',
  final: 'SYNTHETIC_CODE_FINAL: done, parse handles empty input and the tests pass.',
});

/** A synthetic session from `specs` (one event each, in order): an instruction, a commentary, an observation of
 *  `invocation`, a `write` of a path or a `read` of one; `blob` names the text in `blobs` its field refers to. */
export function buildCodeSession(sessionKey, blobs, specs) { return build(sessionKey, blobs, specs); }

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
    if (event.kind === 'invocation' && event.read) {
      const { read: path, ...rest } = event;
      return { callKey: rest.id, tool: 'read', operation: 'other', paths: [{ path }], command: [], input: [], changes: [],
        ...rest, sequence };
    }
    return { ...event, sequence };
  });
  return new Session({ sessionKey, adapter: 'claude', blobs, events });
}

/** One turn: the ask, a write of `src/parse.js`, reads of `src/util.js` and `.env`, a claim and a final message.
 *  `reads`: more paths the session read after `.env` (none by default: the session is then byte for byte as before). */
export function codeSession({ reads = [] } = {}) {
  const T1 = { turn: 'T1' };
  const blobs = { ...CODE_TEXT, ...Object.fromEntries(reads.map((path, at) => [`more${at}`, path])) };
  return build('sess-code-pass', blobs, [
    { id: 'I1', kind: 'instruction', blob: 'ask', ...T1 },
    { id: 'W1', kind: 'invocation', write: 'src/parse.js', blob: 'body', ...T1 },
    { id: 'W1-r', kind: 'observation', invocation: 'W1', blob: 'wrote', ...T1 },
    { id: 'R1', kind: 'invocation', read: 'src/util.js', blob: 'readUtil', ...T1 },
    { id: 'R1-r', kind: 'observation', invocation: 'R1', blob: 'readOut', ...T1 },
    { id: 'R2', kind: 'invocation', read: '.env', blob: 'readEnv', ...T1 },
    ...reads.map((path, at) => ({ id: `X${at}`, kind: 'invocation', read: path, blob: `more${at}`, ...T1 })),
    { id: 'C1', kind: 'commentary', blob: 'claim', ...T1 },
    { id: 'C2', kind: 'commentary', blob: 'final', phase: 'final', ...T1 },
  ]);
}

const receipt = (eventId, role, quote) => ({ eventId, role, quote });
/** The session review's one answer: a claim, a decision, an ask partly done. */
export function codeNarrative() {
  return {
    decisions: [{ dimension: 'SYNTHETIC_CODE_DIMENSION: how to split the input', chosen: 'Split on commas',
      value: null, valueReceipt: null, actions: ['W1'], stated: null, constrainedBy: null }],
    pivots: [],
    claims: [{ text: 'The agent said parse returns an empty list for empty input.',
      stated: receipt('C1', 'commentary', 'parse now returns an empty list for empty input.'), contradictedBy: null }],
    requirements: [{ text: 'Return [] for empty input.', instruction: receipt('I1', 'instruction', CODE_TEXT.ask),
      status: 'partly-done', deliverable: receipt('W1', 'code', 'export function parse(input) {'),
      shortfall: receipt('C1', 'commentary', 'parse now returns an empty list for empty input.') }],
  };
}

/** Write `files` (path -> text) under a fresh folder; returns its path. */
export async function repoWith(t, files = CODE_FILES) {
  const root = await mkdtemp(join(tmpdir(), 'sonah-code-pass-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

/** The ids and paths of the files a code-pass request shows (its FILE lines). */
export function shownFiles(text) {
  return [...String(text).matchAll(/^FILE (\{.*\})$/gm)].map((m) => JSON.parse(m[1]));
}
/** The rows a step-1 request lists (its JSON lines). */
export function checkRows(prompt) {
  return String(prompt).split('\n').filter((line) => line.startsWith('{"key":"R')).map((line) => JSON.parse(line));
}

/**
 * The deterministic fake reviewer. A session narrative request: `narrative`. A step-1 request (`code-check`, and its
 * re-ask `code-check:reask`): `check(rows, files)`'s checks. A lens request (`code-pass:<lens>`): `pass(prompt, files,
 * lens)`'s findings and `questions(prompt, lens)`'s questions. A receipt repair: `repair(request)`, or an empty answer.
 * A challenge: the session's (every item not-refuted, citing the item's first receipt) or the code step's
 * (`codeVote(item, request)`, by default upheld citing the candidate's anchor and every quote it carries). `seen`
 * receives every request, in call order.
 */
export function codeJudge({ narrative = codeNarrative, check = () => [], pass = () => [], questions = () => [],
  repair = null, codeVote = null, seen = [] } = {}) {
  return async (request) => {
    seen.push(request);
    const files = shownFiles(request.prompt);
    if (/^code-check(:reask)?$/.test(request.label)) return { checks: check(checkRows(request.prompt), files, request) };
    const lens = /^code-pass:([a-z]+)(?::g\d+)?$/.exec(request.label ?? '');
    if (lens) return { findings: pass(request.prompt, files, lens[1]), questions: questions(request.prompt, lens[1]) };
    if (/receipt-repair$/.test(request.label ?? '')) return repair ? repair(request, files)
      : request.label.startsWith('code-check') ? { checks: [] } : { findings: [], questions: [] };
    if (request.challenge && /^challenge:code-(check|finding)/.test(request.label)) {
      return { votes: candidatesOf(request.prompt, request.challenge.items).map((item) => (codeVote ? codeVote(item, request)
        : upheld(item))) };
    }
    if (request.challenge) {
      return { votes: request.challenge.items.map((item) => ({ key: item.key, verdict: 'not-refuted',
        explanation: 'Synthetic support.', receipts: [firstReceipt(item.candidate)].filter(Boolean) })) };
    }
    return narrative(request);
  };
}

/** The candidates a code-step challenge request shows (one JSON line each, after its first heading), by its keys. */
export function candidatesOf(prompt, items) {
  const keys = new Set(items.map((item) => item.key));
  return String(prompt).split('\n').filter((line) => line.startsWith('{"key":"')).map((line) => JSON.parse(line))
    .filter((candidate) => keys.has(candidate.key));
}

/** An upheld vote on a code-step candidate (verdict first) citing every code quote it carries: a check's receipts, or a
 *  finding's trace steps (whose last step and anchor they cover). */
export function upheld(candidate, verdict = 'upheld') {
  const quotes = [...(candidate.receipts ?? []), ...(candidate.trace ?? []).filter((t) => t.source !== 'session')]
    .map(({ path, side, startLine, endLine, quote }) => ({ path, side, startLine, endLine, quote }));
  return { key: candidate.key, verdict, reason: verdict === 'upheld' ? null : 'incorrect', receipts: quotes,
    explanation: 'Synthetic.' };
}

function firstReceipt(value) {
  if (Array.isArray(value)) { for (const v of value) { const found = firstReceipt(v); if (found) return found; } return null; }
  if (!plain(value)) return null;
  if (typeof value.eventId === 'string' && typeof value.role === 'string' && typeof value.quote === 'string')
    return { eventId: value.eventId, role: value.role, quote: value.quote };
  for (const v of Object.values(value)) { const found = firstReceipt(v); if (found) return found; }
  return null;
}

export const PARSE_QUOTE = 'const parts = input.split(",");';
/** Step 1 answers: the claim contradicted by line 2 of parse.js, every other row cannot-tell. */
export const contradictClaim = (rows) => rows.map((row) => (row.kind === 'claim'
  ? { key: row.key, answer: 'contradicts', explanation: 'split on an empty string gives [""], not [].',
    receipts: [{ path: 'src/parse.js', side: 'new', startLine: 2, endLine: 2, quote: PARSE_QUOTE }] }
  : { key: row.key, answer: 'cannot-tell', explanation: 'The code does not settle it.', receipts: [] }));

/** The dossier lines of a lens request (one JSON line each). */
export function dossierItems(prompt) {
  return String(prompt).split('\n').filter((line) => line.startsWith('{"key":"S')).map((line) => JSON.parse(line));
}
/** A finding on parse.js line 2 with a one-step trace, in the lens contract. */
export const parseFinding = (over = {}) => ({ kind: 'bug', title: 'parse("") returns [""] instead of []',
  explanation: 'Empty input splits into one empty part.', input: 'parse("")',
  trace: [{ step: 'An empty string splits into one empty part.', source: 'file', path: 'src/parse.js', side: 'new',
    startLine: 2, endLine: 2, quote: PARSE_QUOTE }],
  anchor: { path: 'src/parse.js', side: 'new', startLine: 2, endLine: 2 }, leadsFrom: [], ...over });
/** Step 2 answers: the behaviour lens finds the empty-input bug, following from the claim's dossier item; the other
 *  lenses find nothing. */
export const findEmptyInput = (prompt, files, lens = 'behaviour') => {
  if (lens !== 'behaviour') return [];
  const claim = dossierItems(prompt).find((entry) => entry.kind === 'claim');
  return [parseFinding({ leadsFrom: claim ? [claim.key] : [] })];
};
