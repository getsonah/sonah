// D87 (the code pass), made agentic (code-pass/7, D90): a synthetic session, a repository folder its files are written
// to, and a deterministic fake reviewer that answers the session review, the review agent, its repair and every checking
// agent. Every byte is invented: no recording, no model, no network. Nothing prints.
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { Session } from '../../evidence/src/session.js';

export const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** A FAKE key (the GitHub token shape the redactor knows), planted in a file the step reads. Not a credential. */
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
 *  `invocation`, a `write` of a path or a `read` of one; `blob` names the text in `blobs` its field refers to.
 *  `projectInstructions`: the project instruction files the harness gave it, each `{ path, blob, … }`. */
export function buildCodeSession(sessionKey, blobs, specs, { projectInstructions = [] } = {}) {
  return build(sessionKey, blobs, specs, projectInstructions);
}

function build(sessionKey, blobs, specs, projectInstructions = []) {
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
  const files = projectInstructions.map(({ blob, ...entry }, k) => ({ id: `P${k}`, kind: 'project-instructions',
    afterSequence: -1, childId: null, text: whole(blob), ...entry }));
  return new Session({ sessionKey, adapter: 'claude', blobs, events, projectInstructions: files });
}

/** One turn: the ask, a write of `src/parse.js`, reads of `src/util.js` and `.env`, a claim and a final message.
 *  `reads`: more paths the session read after `.env`; `askTail`: more words after the ask, in the same message (none of
 *  either by default: the session is then byte for byte as before). */
export function codeSession({ reads = [], askTail = '' } = {}) {
  const T1 = { turn: 'T1' };
  const blobs = { ...CODE_TEXT, ...(askTail ? { ask: `${CODE_TEXT.ask}${askTail}` } : {}),
    ...Object.fromEntries(reads.map((path, at) => [`more${at}`, path])) };
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

/** `repoWith`, then made a git repository with every file in one commit (fixed dates and names, no GIT_* variable of
 *  the caller's): its state (code-snapshot.js `repositoryState`) is then known, so the code step's stored answers are
 *  keyed by it. */
export async function gitRepoWith(t, files = CODE_FILES) {
  const root = await repoWith(t, files);
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    GIT_AUTHOR_DATE: '2029-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2029-01-01T00:00:00Z', GIT_AUTHOR_NAME: 'synthetic',
    GIT_AUTHOR_EMAIL: 's@example.invalid', GIT_COMMITTER_NAME: 'synthetic', GIT_COMMITTER_EMAIL: 's@example.invalid' };
  for (const args of [['init', '-q', '-b', 'main'], ['add', '-A'], ['commit', '-q', '-m', 'base']])
    execFileSync('git', args, { cwd: root, env, stdio: 'pipe' });
  return root;
}

/** An in-memory repository reader (code-snapshot.js `createRepositoryReader`'s shape): `now` the files as they are, `before`
 *  at the start commit, by a path relative to `root` (or absolute under it). `reads` receives every read. */
export function memoryRepo({ root = '/repo', now = CODE_FILES, before = {}, reads = [] } = {}) {
  const named = (path) => String(path).replace(/^\.\//, '').replace(`${root}/`, '');
  const fileOf = (files, path) => (Object.hasOwn(files, named(path)) ? { path: named(path), text: files[named(path)],
    sha256: sha256(files[named(path)]) } : null);
  return { root, top: root, read: (path) => { reads.push(['now', path]); return fileOf(now, path); },
    base: (path) => { reads.push(['before', path]); return fileOf(before, path); } };
}

/** The dossier lines of a review request (one JSON line each). */
export function dossierItems(prompt) {
  return String(prompt).split('\n').filter((line) => line.startsWith('{"key":"S')).map((line) => JSON.parse(line));
}

export const PARSE_QUOTE = 'const parts = input.split(",");';
/** A finding on parse.js line 2 with a one-step trace, in the review agent's contract. */
export const reviewFinding = (over = {}) => ({ kind: 'bug', lens: 'behaviour', title: 'parse("") returns [""] instead of []',
  claims: ['Empty input splits into one empty part.'], input: 'parse("")',
  trace: [{ step: 'An empty string splits into one empty part.', path: 'src/parse.js', side: 'new', startLine: 2,
    endLine: 2, quote: PARSE_QUOTE }],
  anchor: { path: 'src/parse.js', side: 'new', startLine: 2, endLine: 2 }, leadsFrom: [], ...over });
/** The review agent's answer: the claim's dossier item contradicted by line 2 of parse.js (a `claim_false` finding
 *  following from it), no question. */
export const contradictClaim = (prompt) => {
  const claim = dossierItems(prompt).find((entry) => entry.kind === 'claim');
  return { findings: [reviewFinding({ kind: 'claim_false', lens: 'claims',
    title: 'parse("") returns [""], not the empty list the agent said', leadsFrom: claim ? [claim.key] : [] })],
  questions: [] };
};
/** The review agent's answer: the empty-input bug, following from the claim's dossier item. */
export const findEmptyInput = (prompt) => {
  const claim = dossierItems(prompt).find((entry) => entry.kind === 'claim');
  return { findings: [reviewFinding({ leadsFrom: claim ? [claim.key] : [] })], questions: [] };
};

/** The finding a finding's checking agent was shown (its request's JSON line). */
export function verifiedFinding(prompt) {
  const [, after] = String(prompt).split('# The finding to check — untrusted\n\n');
  return after ? JSON.parse(after.split('\n')[0]) : null;
}
/** The questions a batch checking agent was shown (its request's JSON lines), by key. */
export function batchItems(prompt) {
  return String(prompt).split('\n').filter((line) => /^\{"key":"Q\d+"/.test(line)).map((line) => JSON.parse(line));
}
/** F3b (D111): the items an accounting agent was shown (its request's JSON lines under the items heading), in order. */
export function accountItemsShown(prompt) {
  const [, after] = String(prompt).split('# The items to account for — built by Sonah from its report — untrusted '
    + 'evidence\n\n');
  return after ? after.split('\n\n')[0].split('\n').filter((line) => line.startsWith('{"key":"S'))
    .map((line) => JSON.parse(line)) : [];
}
/** F3b (D111): the first line of the change an accounting agent was shown that a receipt can quote — a row of a hunk
 *  (`| OLD | NEW | TYPE | code`) on the file as it is now, 4 to 120 characters — as a receipt; null when none. */
export function changeReceipt(prompt) {
  let path = null;
  for (const line of String(prompt).split('\n')) {
    if (line.startsWith('+++ ')) { path = line === '+++ /dev/null' ? null : line.slice('+++ b/'.length); continue; }
    const row = /^\| ([ \d]{4,}) \| ([ \d]{4,}) \| ([ +-]) \| (.*)$/.exec(line);
    if (!row || path === null || row[3] === '-' || !row[2].trim()) continue;
    const quote = row[4];
    if (quote.trim().length < 4 || quote.length > 120) continue;
    return { path, side: 'new', startLine: Number(row[2]), endLine: Number(row[2]), quote };
  }
  return null;
}
/** F3b (D111): the code review's findings an accounting agent was shown (`F<n>`, with the keys each follows from). */
export function accountFindingsShown(prompt) {
  const [, after] = String(prompt).split('# The code review\'s findings and questions — untrusted\n\n');
  return after ? after.split('\n\n')[0].split('\n').filter((line) => line.startsWith('{"key":"F'))
    .map((line) => JSON.parse(line)) : [];
}
/** F3b (D111): an accounting answer that agrees with the code review: an item a finding of the code review follows from
 *  breaks (by that finding), every other item holds, each quoting `receipt`; with no receipt, every item not examined;
 *  no finding of its own. `accountsHold` is the fixtures' default, so a review that is not about the accounting keeps its
 *  coverage. */
export const accountsHoldWith = (receipt) => (prompt) => {
  const findings = accountFindingsShown(prompt);
  return { entries: accountItemsShown(prompt).map(({ key }) => {
    const by = findings.find((f) => Array.isArray(f.leadsFrom) && f.leadsFrom.includes(key))?.key ?? null;
    return { key, outcome: !receipt ? 'not_examined' : by ? 'breaks' : 'holds', receipts: receipt ? [receipt] : [],
      by: receipt ? by : null, finding: null };
  }), findings: [] };
};
/** F3b (D111): the first line, 4 to 120 characters, of a file of the change's table of contents that `files` holds
 *  (path -> text, the fixture's repository by default) — `src/parse.js`, the file the fixture's session writes, when the
 *  change holds it (a test may give the other files other text), else the first — as a receipt; null when none. For a
 *  change whose hunks show no line (a whole-file write with no git base). */
export function fileReceipt(prompt, files = CODE_FILES) {
  const paths = String(prompt).split('\n').filter((line) => line.startsWith('- ')).map((line) => line.slice(2).split(' ')[0]);
  const path = paths.find((p) => p === 'src/parse.js' && Object.hasOwn(files, p))
    ?? paths.find((p) => Object.hasOwn(files, p));
  if (!path) return null;
  const at = files[path].split('\n').findIndex((line) => line.trim().length >= 4 && line.length <= 120);
  return at < 0 ? null : { path, side: 'new', startLine: at + 1, endLine: at + 1, quote: files[path].split('\n')[at] };
}
/** `accountsHoldWith` the first line of the change the request shows that a receipt can quote (`changeReceipt`), else
 *  the first line of a file of the change the fixture's repository holds (`fileReceipt`). */
export const accountsHold = (prompt) => accountsHoldWith(changeReceipt(prompt) ?? fileReceipt(prompt))(prompt);
/** The code steps of a finding's trace as receipts (the anchor's lines among them, for the fixture's findings). */
export const traceReceipts = (finding) => finding.trace.filter((t) => t.side !== 'session')
  .map(({ path, side, startLine, endLine, quote }) => ({ path, side, startLine, endLine, quote }));
/** A "holds" verdict on a finding, quoting every code step of its trace (the anchor's lines among them), every claim
 *  holding, with `premises` (code-verify/3, D110) as its premise list. */
export const holdsWith = (finding, premises) => ({ verdict: 'holds', reason: null,
  claims: finding.claims.map(({ claim }) => ({ claim, verdict: 'holds' })), premises,
  receipts: traceReceipts(finding), explanation: 'Synthetic: traced and found to hold.' });
/** The one premise of the fixture's "holds" (code-verify/3, D110): a line of the repository that the trace quotes. */
export const repositoryPremise = (finding) => ({ premise: 'Synthetic: the traced lines show the problem.',
  source: 'repository', receipts: traceReceipts(finding) });
/** A "holds" verdict on a finding (`holdsWith`) whose one premise is a line of the repository that its trace quotes: a
 *  check code's label confirms. */
export const holds = (finding) => holdsWith(finding, [repositoryPremise(finding)]);
/** Every question sound. */
export const allSound = (items) => ({
  questions: items.filter((i) => i.key.startsWith('Q')).map(({ key }) => ({ key, verdict: 'sound', receipts: [],
    explanation: 'Synthetic.' })) });
/**
 * How many items of the record the review agent's lists ended as, `[findings, questions]`: a finding published, sent
 * to you as a question, or withheld with its own record; a question published, or withheld with its own record. For an
 * answer whose items are distinct, these are its lists' lengths when no item merged into another or was lost. One item
 * lost and another shown twice leaves the counts the same, so the counts cannot see that.
 */
export const itemsEnded = ({ codePass: p }) => [p.findings.length
  + p.questions.filter((q) => q.from === 'finding').length + p.withheld.filter((w) => w.what === 'finding').length,
p.questions.filter((q) => q.from === 'review').length + p.withheld.filter((w) => w.what === 'question').length];

/** What the agent transport /2 sets on every agent answer (D105): its run record, here of a run that read nothing. */
export const SYNTHETIC_RUN = Object.freeze({ numTurns: 1, toolCalls: { Read: 0, Grep: 0, Glob: 0, StructuredOutput: 1 },
  reads: [], readRanges: [], readsUnranged: 0, readsUnrangedPaths: [], readsFailed: [] });
/** The run record of an agent that opened every file of the fixture whole with Read (the brief asks the review agent to
 *  open every changed file whole), under the request's working directory: what the transport /2 records of such a run. */
export function readsEveryFile(request, files = CODE_FILES) {
  const root = request?.agent?.root;
  if (typeof root !== 'string') return SYNTHETIC_RUN;
  const ranges = Object.entries(files).map(([path, text]) => {
    const lines = text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length;
    return { path: join(root, path), startLine: 1, numLines: lines, totalLines: lines };
  });
  return { ...SYNTHETIC_RUN, toolCalls: { ...SYNTHETIC_RUN.toolCalls, Read: ranges.length },
    reads: ranges.map((r) => r.path), readRanges: ranges };
}
/** An agent answer with a run record set on it, not enumerable, as the transport sets it. */
export function withRun(answer, run = SYNTHETIC_RUN) {
  if (answer === null || typeof answer !== 'object' || Object.hasOwn(answer, 'agentRun')) return answer;
  try { Object.defineProperty(answer, 'agentRun', { value: structuredClone(run), enumerable: false, configurable: true }); }
  catch { /* a frozen answer keeps its shape */ }
  return answer;
}
/** The withheld reasons a merge of the answers gives (its shape, its grounding, its list's limit); the others come
 *  from a checking agent. */
const MERGE_REASONS = Object.freeze(['malformed', 'evidence_grounding_failed', 'out_of_scope']);
/**
 * F3a, fate conservation, read off a run's record (`{ codePass }`) of an answer (`answer`) and its one repair (`repair`,
 * null when none came back): the fates of each list, `{ findings: { answer: [fate, …], repair: [fate, …] }, questions }`
 * by index, after checking that every item of either answer, each list to its end, has exactly one fate record of the
 * closed list, and no other record is there (so kept + replaced + added + folded + withheld is the number of items);
 * that a `replaced` item and the item of the repair that `replaces` it name each other; and that each withheld fate is
 * one withheld record of a merge's reason. Throws on any break.
 */
export function fatesOf({ codePass: p }, answer, repair = null) {
  const lists = ['findings', 'questions'], froms = { answer, repair };
  const length = (from, name) => (Array.isArray(froms[from]?.[name]) ? froms[from][name].length : 0);
  const fail = (why) => { throw new Error(`fates: ${why} ${JSON.stringify(p.fates)}`); };
  const seen = new Map();
  for (const r of p.fates) {
    const key = `${r.from}:${r.list}:${r.index}`;
    if (seen.has(key)) fail(`two fates for ${key}`);
    if (!['kept', 'replaced', 'added', 'folded', 'withheld'].includes(r.fate)) fail(`fate ${r.fate}`);
    seen.set(key, r);
  }
  const out = {};
  for (const name of lists) {
    out[name] = {};
    for (const from of ['answer', 'repair']) out[name][from] = Array.from({ length: length(from, name) }, (_, index) => {
      const r = seen.get(`${from}:${name}:${index}`);
      if (!r) fail(`no fate for ${from}:${name}:${index}`);
      return r.fate;
    });
  }
  const items = lists.reduce((n, name) => n + length('answer', name) + length('repair', name), 0);
  if (seen.size !== items) fail(`${seen.size} fates for ${items} items`);
  for (const r of p.fates) {
    if (r.fate === 'replaced' && seen.get(`repair:${r.list}:${r.by}`)?.replaces !== r.index) fail(`unpaired ${r.index}`);
    if (r.replaces !== undefined && seen.get(`answer:${r.list}:${r.replaces}`)?.by !== r.index) fail(`unpaired ${r.index}`);
  }
  const withheld = p.fates.filter((r) => r.fate === 'withheld');
  const records = p.withheld.filter((w) => MERGE_REASONS.includes(w.reason));
  if (withheld.length !== records.length) fail(`${withheld.length} withheld fates, ${records.length} records`);
  return out;
}
/**
 * The published findings of a run that are the same finding twice: pairs that are one finding by identity (F3a: of one
 * kind, on one file version, their anchors' lines overlapping), as `[title, title]`, and the published ids given twice.
 * For a run whose answer holds no two findings of one identity that both stand, both are empty exactly when the
 * published set holds no finding twice.
 */
export function sameFindingTwice({ codePass: p }) {
  const pairs = [];
  p.findings.forEach((a, i) => p.findings.slice(i + 1).forEach((b) => {
    if (a.kind === b.kind && a.anchor.path === b.anchor.path && a.anchor.side === b.anchor.side
        && a.anchor.startLine <= b.anchor.endLine && a.anchor.endLine >= b.anchor.startLine) pairs.push([a.title, b.title]);
  }));
  const ids = p.findings.map((f) => f.id);
  return { pairs, ids: ids.filter((id, at) => ids.indexOf(id) !== at) };
}

/**
 * The deterministic fake reviewer. A session narrative request: `narrative`. The review agent (`code-review:agent`):
 * `review(prompt, request)`'s answer; its repair (`code-review:repair`): `repair(request)`, or the review's answer again.
 * A finding's checking agent (`code-verify:F<n>`, and its re-ask): `verify(finding, request)`; the batch checking agent:
 * `batch(items, request)`; an accounting agent (`code-account:<n>`, and its re-ask; F3b, D111): `account(prompt,
 * request)`. A session challenge: every item not-refuted, citing the item's first receipt. `seen` receives
 * every request, in call order.
 */
export function codeJudge({ narrative = codeNarrative, review = contradictClaim, repair = null, verify = holds,
  batch = allSound, account = accountsHold, seen = [], run = readsEveryFile } = {}) {
  return async (request) => {
    seen.push(request);
    const label = request.label ?? '';
    const ran = async (answer) => withRun(await answer, typeof run === 'function' ? run(request) : run);
    if (label === 'code-review:agent') return ran(review(request.prompt, request));
    if (label === 'code-review:repair') return ran(repair ? repair(request) : review(request.prompt, request));
    if (/^code-verify:F\d+(?::reask)?$/.test(label)) return ran(verify(verifiedFinding(request.prompt), request));
    if (/^code-verify:batch(?::reask)?$/.test(label)) return ran(batch(batchItems(request.prompt), request));
    if (/^code-account:\d+(?::reask)?$/.test(label)) return ran(account(request.prompt, request));
    if (request.challenge) {
      return { votes: request.challenge.items.map((item) => ({ key: item.key, verdict: 'not-refuted',
        explanation: 'Synthetic support.', receipts: [firstReceipt(item.candidate)].filter(Boolean) })) };
    }
    return narrative(request);
  };
}

function firstReceipt(value) {
  if (Array.isArray(value)) { for (const v of value) { const found = firstReceipt(v); if (found) return found; } return null; }
  if (value === null || typeof value !== 'object') return null;
  if (typeof value.eventId === 'string' && typeof value.role === 'string' && typeof value.quote === 'string')
    return { eventId: value.eventId, role: value.role, quote: value.quote };
  for (const v of Object.values(value)) { const found = firstReceipt(v); if (found) return found; }
  return null;
}
