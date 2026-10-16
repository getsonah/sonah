// D90 (owner decision 2026-10-15, privacy is not a design constraint): the reviewer model reads the recorded session as
// it was recorded (D84: bounded and validated, nothing masked), and every output — the page, the Markdown story, the
// terminal lines and a PR comment — shows it as loaded: no text is masked for a person. Each text below was blanked by
// the output masking D84 built (a test name read as a password, a decorator after a diff's `+` read as an email
// address, a test result read as a secret-named value, a path cut out of an entropy-heavy search line, the line after
// a bare `pass`, a key-shaped value); each is now shown word for word. Synthetic recordings, a fake transport and FAKE
// key-shaped strings only, each built at run time so no line of this file is itself key-shaped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIds, session as recording, toJsonl } from '../../golden/src/build.js';
import { runSessionReviewCommand } from '../src/session-review-command.js';
import { loadRecordedSessionWithHash } from '../src/recorded-session.js';
import { escapePublicText } from '../../github/index.js';
import { clip, oneLine, visible } from '../../render/session-story.js';
import { escapeHtml } from '../../render/session-page.js';
import { CLI_SAFE_ERROR_CODES } from '../../evidence/src/ledger.js';

/** These tests pin what the session's review shows, so the code step (on by default, owner decision 2026-10-14) is
 *  turned off for each with its flag. */
const sessionOnly = (argv, dependencies) => runSessionReviewCommand([...argv, '--no-code-pass'], dependencies);

const KEY = ['sk', 'ant', 'api03', 'FAKEonlyForTests0123456789abcdefXYZ0123456789fake'].join('-');
const ASK = `Speed up the parser and keep the key ${KEY} in the deploy script.`;
const DEPLOY = `DEPLOY_KEY=${KEY} ./deploy.sh`;
/** A search result whose first token is entropy-heavy (35 characters at 4.73 bits): D84's walk hid the whole line, and
 *  the output masking then cut the path out of every text it ended or started (`tomlkit/parser.py`). */
const SEARCH = 'tomlkit/parser.py:212:MAX_KEY_DEPTH = 0x3F';
const PATH = 'tomlkit/parser.py';
const GO_PASS = '--- PASS: TestX (0.00s)';
const GO = `=== RUN   TestX\n${GO_PASS}\nPASS\nok  \texample.com/x\t0.012s`;
const PASSES = 'passes: 5 tests, no failures';
const SINGLE = 'Single-pass test is timed against a fixed budget of three runs.';
const BOUND = 'with trio.move_on_after(3):';
const DECORATOR = '@pytest.mark.parametrize("n", [1, 2])';
const OLD_TEST = ['def test_stop(process):', '    pass', '', 'def test_a(n):', '    assert n'].join('\n');
const NEW_TEST = ['def test_stop(process):', '    pass', '', `    ${BOUND}`, '        stop(process)', '', DECORATOR,
  'def test_a(n):', '    assert n'].join('\n');
/** What each output must show word for word (D90), as a reader reads it. */
/** D97: what the report .md (the story since /32) shows: the page's texts (the story's diff lines are gone with its
 *  step blocks). */
const SHOWN = Object.freeze([SINGLE, GO_PASS, 'passes: 5 tests', PATH, KEY]);
/** D97: the page shows no edit's diff (an item shows a code excerpt only from the code step's stored spans), so the
 *  decorator and the time bound, shown only in the edit's hunk, are not on it; every text it shows is as recorded. */
const PAGE_SHOWN = Object.freeze([SINGLE, GO_PASS, 'passes: 5 tests', PATH, KEY]);

const streams = () => {
  const chunks = { stdout: '', stderr: '' };
  return { chunks, stdout: { write: (text) => { chunks.stdout += text; } },
    stderr: { write: (text) => { chunks.stderr += text; } } };
};
/** The synthetic recording, its event ids fixed (`resetIds`), so its slice hash and requests are the same every run. */
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'sonah-d90-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const home = join(directory, 'home'), repo = join(directory, 'repo');
  await mkdir(home); await mkdir(repo);
  const file = join(directory, 'recording.jsonl');
  resetIds();
  await writeFile(file, toJsonl(recording({ cwd: repo, sessionId: 'synthetic-d90', version: '2.1.284' })
    .ask(ASK)
    .run(`grep -n MAX_KEY_DEPTH ${PATH}`, { pass: SEARCH })
    .edit(PATH, 'MAX_KEY_DEPTH = 0x3F', 'MAX_KEY_DEPTH = 0x40')
    .run('go test -v ./...', { pass: GO })
    .run('npm test', { pass: PASSES })
    .say('All five tests pass.')
    .edit('tests/test_stop.py', OLD_TEST, NEW_TEST)
    .run(DEPLOY, { pass: 'deployed' })
    .say(SINGLE).done()) + '\n');
  const env = { HOME: home, SONAH_HOME: join(home, '.sonah'), CODEX_HOME: join(home, 'codex'),
    SONAH_CLAUDE_PROJECTS: join(home, 'claude-projects') };
  return { directory, home, repo, file, env, options: { cwd: repo, env, installSignals: false,
    loadReviews: async () => new Map(), openPage: async () => {} } };
}
/** A fake reviewer that quotes each text where a reader is shown it: the ask and the deploy command (a requirement), the
 *  agent's statement and the Go test result (a claim the result contradicts), the npm result (a claim it supports), and
 *  the decorator's line (a decision, its code written shown with its hunk). Every vote upholds, citing what it checks. */
function transport(calls) {
  return ({ onResult, config }) => async (request) => {
    calls.push(request);
    onResult({ ok: true, backend: config.backend, attestation: 'attested', contextWindow: 1_000_000 });
    if (request.challenge) return { votes: request.challenge.items.map(({ key, candidate }) => ({ key,
      verdict: 'not-refuted', explanation: 'The recording shows it.',
      receipts: candidate.receipts ?? [candidate.constrainedBy?.instruction ?? candidate.supportedBy
        ?? candidate.contradictedBy ?? candidate.stated].filter(Boolean) })) };
    const events = request.window.events;
    const instruction = events.find((event) => event.kind === 'instruction');
    const said = events.filter((event) => event.kind === 'commentary');
    const results = events.filter((event) => event.kind === 'observation');
    const actions = events.filter((event) => event.kind === 'invocation');
    const edits = actions.filter((event) => event.operation === 'edit');
    // The results in recorded order: the search, the first edit's, the Go tests', the npm tests'.
    const [, , go, npm] = results;
    return { pivots: [], failures: [], notClaims: [], forbiddenEdits: [],
      requirements: instruction ? [{ text: 'Keep the deploy key', status: 'done',
        instruction: { eventId: instruction.id, role: 'instruction', quote: ASK },
        deliverable: { eventId: actions.at(-1).id, role: 'action', quote: DEPLOY } }] : [],
      claims: said.length === 2 && go && npm ? [
        { text: SINGLE, stated: { eventId: said[1].id, role: 'commentary', quote: SINGLE },
          contradictedBy: { eventId: go.id, role: 'observation', quote: GO_PASS } },
        { text: 'All five tests pass', stated: { eventId: said[0].id, role: 'commentary', quote: 'All five tests pass.' },
          contradictedBy: null, supportedBy: { eventId: npm.id, role: 'observation', quote: PASSES } },
      ] : [],
      decisions: instruction && edits.length === 2 ? [{ dimension: 'how the stop is bounded',
        chosen: 'A time bound around the stop, and the second test parametrized', value: DECORATOR,
        valueReceipt: { eventId: edits[1].id, field: 'added-code', role: 'code', quote: DECORATOR },
        actions: [edits[1].id], stated: null, constrainedBy: { instruction: { eventId: instruction.id,
          role: 'instruction', quote: 'Speed up the parser' }, settles: false, settledValueQuote: null } }] : [] };
  };
}
/** A page's text with its escapes read back; a story's with its Markdown escapes and mention breaks read back. */
const pageText = (html) => html.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&');
/** The report .md's text read back: code spans opened (a mention or an issue number is one: D97), escapes undone. */
const storyText = (md) => md.replace(/`([^`\n]*)`/g, '$1').replace(/\\(.)/g, '$1');
const MARK = /‹(?:redacted|dropped)/;

test('D90: the page and the story show every recorded text word for word, as the model read it', async (t) => {
  const input = await fixture(t), calls = [];
  const page = join(input.directory, 'review.html'), out = streams();
  assert.equal(await sessionOnly([input.file, '--format', 'html', '--output', page, '--no-open'],
    { ...input.options, ...out, createJudge: transport(calls) }), 0, out.chunks.stderr);
  // The model request carries the recording as it was recorded.
  assert.ok(calls.some((request) => `${request.system}${request.prompt}`.includes(KEY)), 'the request holds the key');
  assert.ok(calls.some((request) => request.prompt.includes(SEARCH)), 'and the search line');
  const html = await readFile(page, 'utf8');
  for (const text of PAGE_SHOWN) assert.ok(pageText(html).includes(text), `the page shows ${JSON.stringify(text)}`);
  assert.doesNotMatch(html, MARK);
  assert.equal((await stat(page)).mode & 0o777, 0o600);
  assert.doesNotMatch(out.chunks.stdout + out.chunks.stderr, MARK);
  // The Markdown story, printed to the terminal (stored answers are reused: no new call), and written to a file.
  const story = streams(), again = [];
  assert.equal(await sessionOnly([input.file], { ...input.options, ...story, createJudge: transport(again) }), 0,
    story.chunks.stderr);
  assert.equal(again.length, 0, 'the same requests, answered from the store');
  for (const text of SHOWN)
    assert.ok(storyText(story.chunks.stdout).includes(text), `the story shows ${JSON.stringify(text)}`);
  assert.doesNotMatch(story.chunks.stdout, MARK);
  // D97: the page's run wrote the report .md beside it; a run with --output writes it alone.
  for (const text of SHOWN) assert.ok(storyText(await readFile(join(input.directory, 'review.md'), 'utf8')).includes(text), text);
  const md = join(input.directory, 'story.md');
  assert.equal(await sessionOnly([input.file, '--output', md], { ...input.options, ...streams(),
    createJudge: transport([]) }), 0);
  for (const text of SHOWN) assert.ok(storyText(await readFile(md, 'utf8')).includes(text), text);
  // What stays on this computer for the next run: owner-only files in owner-only folders.
  const state = join(input.env.SONAH_HOME, 'session-reviews');
  const walk = async (dir) => (await Promise.all((await readdir(dir, { withFileTypes: true })).map((entry) =>
    (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)])))).flat();
  const files = await walk(state);
  assert.ok(files.length > 0);
  for (const file of files) assert.equal((await stat(file)).mode & 0o777, 0o600, 'stored state is owner-only');
});

test('D90: the text helpers every reader escapes through show each text as written', () => {
  // The line after a bare `pass`, in the agent's words or a file (D84's prose rules read `pass` as a password label).
  const afterPass = `The stop is now bounded:\n    pass\n\n    ${BOUND}\n        stop(process)`;
  for (const text of [SINGLE, GO_PASS, PASSES, `+${DECORATOR}`, `token ${KEY} here`, SEARCH, afterPass]) {
    assert.equal(visible(text), text);
    assert.equal(clip(text, 1000), text);
    assert.equal(oneLine(text), text.replace(/\s+/g, ' ').trim());
    assert.equal(pageText(escapeHtml(text)), text);
  }
});

test('D90: the session hash and the session request bytes are those of the bounded, unmasked load', async (t) => {
  const input = await fixture(t), calls = [];
  const { session, hash } = await loadRecordedSessionWithHash({ parent: input.file, codexHome: input.env.CODEX_HOME,
    claudeProjects: input.env.SONAH_CLAUDE_PROJECTS, sessionKey: 'session' });
  assert.ok(session.events.some((event) => session.textOf(event, 'text').includes(KEY)), 'the session holds the key');
  // Pinned: the hash of this recording's ledger, and the bytes of its session window request, as the bounded, unmasked
  // load gave them before the output masking was removed — removing it moves neither.
  assert.equal(hash, 'c06929418e8e861e83d8e9d94322793f791004728f047e72254053aebd00a718');
  assert.equal(await sessionOnly([input.file, '--format', 'html', '--output', join(input.directory, 'r.html'),
    '--no-open'], { ...input.options, ...streams(), createJudge: transport(calls) }), 0);
  const windows = calls.filter((request) => /^narrative:/.test(request.label));
  assert.equal(windows.length, 1);
  assert.equal(createHash('sha256').update(`${windows[0].system}\u0000${windows[0].prompt}`).digest('hex'),
    '4da96afe0fe3efabdde1178b49face3b110743a3ccee7a84c48a01ed7ef16487');
});

test('D90: the PR comment body escapes its sentences and masks nothing; output_not_masked is no longer a code', () => {
  // D82 step 10: the comment is built from the session review's report (github/publication.js `publicCommentText`), and
  // every text in it that is not a fixed literal passes `escapePublicText`, which escapes and masks nothing.
  const posted = escapePublicText(`The key ${KEY} is committed.`);
  assert.equal(posted, `The key ${KEY.replace(/-/g, '\\-')} is committed\\.`);
  assert.throws(() => escapePublicText(null), { code: 'disclosure_rejected' });
  assert.ok(!CLI_SAFE_ERROR_CODES.includes('output_not_masked'), 'nothing is masked, so nothing fails to be');
});

// ---- D82 step 10: the session review's PR comment, previewed and planned from the saved report ----------------------
const SHARING = { SONAH_GITHUB_ACTOR_ID: '7', SONAH_GITHUB_APP_ID: '9' };
const COMMENT = ['--github', 'example/demo', '--pr', '7', '--post-comment', '--format', 'html'];
/** A fake GitHub answering the PR's metadata only; every write is recorded. */
function metadataOnly() {
  const writes = [];
  return { writes, client: { async request(request) {
    if (request.method !== 'GET') { writes.push(request); return { status: 201, data: {} }; }
    return { status: 200, data: { number: 7, base: { sha: 'b'.repeat(40), repo: { id: 42, name: 'demo', private: true,
      owner: { login: 'example' } } }, head: { sha: 'a'.repeat(40) } } };
  } } };
}

test('D90 x D82 step 10: the comment a dry run previews and the one a review plans are the saved report\'s, unmasked',
  async (t) => {
    const input = await fixture(t);
    const env = { ...input.env, ...SHARING };
    // A finished review, so a dry run has the saved report its comment is built from.
    assert.equal(await sessionOnly([input.file, '--format', 'html', '--output',
      join(input.directory, 'first.html'), '--no-open'], { ...input.options, ...streams(),
      createJudge: transport([]) }), 0);
    const out = streams();
    assert.equal(await sessionOnly([input.file, '--dry-run', ...COMMENT, '--output', join(input.directory, 'dry.html')],
      { ...input.options, ...out, env, client: { request: async () => assert.fail('a dry run reads nothing from GitHub') } }),
    0);
    assert.match(out.chunks.stdout, /as the last finished review of this recording would post it/);
    assert.match(out.chunks.stdout, /Sonah advisory review/);
    assert.doesNotMatch(out.chunks.stdout, MARK);
    // The live comment: planned from the saved report, shown before it is posted, and posted only once confirmed.
    const { sharePrReview } = await import('../src/pr-sharing.js');
    const state = (await readdir(join(input.env.SONAH_HOME, 'session-reviews')))
      .map((name) => join(input.env.SONAH_HOME, 'session-reviews', name))[0];
    const report = JSON.parse(await readFile(join(state, 'review', 'report.private.json'), 'utf8'));
    const github = metadataOnly(), shared = streams();
    let asked = null;
    const result = await sharePrReview({ client: github.client, github: { owner: 'example', repo: 'demo', number: 7 },
      report, stateDir: state, env: SHARING, ...shared, confirm: async ({ body }) => { asked = body; return false; } });
    assert.equal(result.state, 'cancelled');
    assert.match(asked, /^Sonah advisory review\n/);
    assert.doesNotMatch(asked, MARK);
    assert.equal(github.writes.length, 0, 'nothing is posted unconfirmed');
  });
