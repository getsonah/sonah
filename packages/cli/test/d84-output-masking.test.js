// D84 (owner decision 2026-10-12, "off for the model, on for output"): the reviewer model reads the recorded session
// unredacted; the page, the Markdown story, the PR comment body and the terminal lines do not show a secret; a masking
// failure writes and prints nothing. Synthetic recordings, a fake transport and FAKE key-shaped strings only, each
// built at run time so no line of this file is itself key-shaped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { session as recording, toJsonl } from '../../golden/src/build.js';
import { runSessionReviewCommand } from '../src/session-review-command.js';
/** These tests pin what the session's review shows and masks, so the code step (on by default, owner decision
 *  2026-10-14) is turned off for each with its flag; code-pass-command.test.js masks what the code step reads. */
const sessionOnly = (argv, dependencies) => runSessionReviewCommand([...argv, '--no-code-pass'], dependencies);
import { loadRecordedSessionWithHash } from '../src/recorded-session.js';
import { escapePublicText } from '../../github/index.js';
import { keepPeopleSecrets, maskForPeople, peopleMask, peopleSecretsFor, redact, sliceHash }
  from '../../redact/index.js';
import { loadSessionEvidence } from '../src/session-evidence.js';
import { asPeopleRead, clip, forPeople, oneLine, sessionForPeople, visible } from '../../render/session-story.js';
import { escapeHtml } from '../../render/session-page.js';

const BODY = 'FAKEonlyForTests0123456789abcdefXYZ0123456789fake';
const KEY = ['sk', 'ant', 'api03', BODY].join('-');
const AWS = ['AKIA', 'FAKE', 'TEST', 'ONLY', '0000'].join('');
const ASK = `Deploy with the key ${KEY} and run the tests.`;
const COMMAND = `ANTHROPIC_API_KEY=${KEY} npm test`;
const SECRETS = [KEY, AWS];
/** Every 16-character run of a planted secret's random part: no part of one may reach a person. */
const fragments = [...new Set([BODY, AWS].flatMap((s) =>
  Array.from({ length: s.length - 15 }, (_, i) => s.slice(i, i + 16))))];
const leaks = (text) => fragments.filter((part) => text.includes(part));

const streams = () => {
  const chunks = { stdout: '', stderr: '' };
  return { chunks, stdout: { write: (text) => { chunks.stdout += text; } },
    stderr: { write: (text) => { chunks.stderr += text; } } };
};
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'sonah-d84-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const home = join(directory, 'home'), repo = join(directory, 'repo');
  await mkdir(home); await mkdir(repo);
  const file = join(directory, 'recording.jsonl');
  await writeFile(file, toJsonl(recording({ cwd: repo, sessionId: 'synthetic-d84', version: '2.1.284' })
    .ask(ASK)
    .run(COMMAND, { pass: `4 passing\nused key ${KEY}\naws ${AWS}` })
    .edit('src/settings.js', 'const key = "";', `const key = "${KEY}";`)
    .say(`Deployed with ${KEY}; the tests pass.`).done()) + '\n');
  const env = { HOME: home, SONAH_HOME: join(home, '.sonah'), CODEX_HOME: join(home, 'codex'),
    SONAH_CLAUDE_PROJECTS: join(home, 'claude-projects') };
  return { directory, home, repo, file, env, options: { cwd: repo, env, installSignals: false,
    loadReviews: async () => new Map(), openPage: async () => {} } };
}
/** A fake reviewer that quotes the planted secret wherever it can: the request, a command, a decision. */
function transport(calls) {
  return ({ onResult, config }) => async (request) => {
    calls.push(request);
    onResult({ ok: true, backend: config.backend, attestation: 'attested', contextWindow: 1_000_000 });
    if (request.challenge) return { votes: request.challenge.items.map(({ key, candidate }) => ({ key,
      verdict: 'not-refuted', explanation: `The recording shows ${KEY} in the command.`,
      receipts: candidate.receipts })) };
    const instruction = request.window.events.find((event) => event.kind === 'instruction');
    const command = request.window.events.find((event) => event.kind === 'invocation' && event.operation === 'command');
    const edit = request.window.events.find((event) => event.kind === 'invocation' && event.operation === 'edit');
    return { pivots: [], claims: [], failures: [], notClaims: [], forbiddenEdits: [],
      requirements: instruction && command ? [{ text: `Deploy with ${KEY}`, status: 'done',
        instruction: { eventId: instruction.id, role: 'instruction', quote: ASK },
        deliverable: { eventId: command.id, role: 'action', quote: COMMAND } }] : [],
      decisions: instruction && edit ? [{ dimension: `where ${KEY} is kept`, chosen: `Wrote ${KEY} into settings.js`,
        value: 'src/settings.js',
        valueReceipt: { eventId: edit.id, field: 'path', role: 'action', quote: 'src/settings.js' },
        actions: [edit.id], stated: null, constrainedBy: { instruction: { eventId: instruction.id, role: 'instruction',
          quote: ASK }, settles: false, settledValueQuote: null } }] : [] };
  };
}

test('D84: the model reads the planted secret; the page, the story and the terminal never show it', async (t) => {
  const input = await fixture(t), calls = [];
  const page = join(input.directory, 'review.html'), out = streams();
  assert.equal(await sessionOnly([input.file, '--format', 'html', '--output', page, '--no-open'],
    { ...input.options, ...out, createJudge: transport(calls) }), 0, out.chunks.stderr);
  // The model request carries the recording as it was recorded.
  assert.ok(calls.length > 0);
  assert.ok(calls.some((request) => `${request.system}${request.prompt}`.includes(KEY)), 'the request holds the key');
  assert.ok(calls.some((request) => `${request.system}${request.prompt}`.includes(AWS)));
  // The page holds the review (the requirement, the decision) and none of the secrets.
  const html = await readFile(page, 'utf8');
  assert.match(html, /‹redacted:anthropic-key›/, 'premise: the page shows the masked texts');
  assert.deepEqual(leaks(html), []);
  assert.equal((await stat(page)).mode & 0o777, 0o600);
  // The terminal lines of that run.
  assert.deepEqual(leaks(out.chunks.stdout + out.chunks.stderr), []);
  // The Markdown story, printed to the terminal (stored answers are reused: no new call).
  const story = streams(), again = [];
  assert.equal(await sessionOnly([input.file], { ...input.options, ...story,
    createJudge: transport(again) }), 0, story.chunks.stderr);
  assert.equal(again.length, 0, 'the same requests, answered from the store');
  assert.match(story.chunks.stdout, /‹redacted:anthropic-key›/, 'premise: the story shows the masked texts');
  assert.deepEqual(leaks(story.chunks.stdout + story.chunks.stderr), []);
  // Written to a file, the same.
  const md = join(input.directory, 'review.md');
  assert.equal(await sessionOnly([input.file, '--output', md], { ...input.options, ...streams(),
    createJudge: transport([]) }), 0);
  assert.deepEqual(leaks(await readFile(md, 'utf8')), []);
  // What stays on this computer for the next run keeps the model's words: owner-only files in owner-only folders.
  const state = join(input.env.SONAH_HOME, 'session-reviews');
  const walk = async (dir) => (await Promise.all((await readdir(dir, { withFileTypes: true })).map((entry) =>
    (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)])))).flat();
  const files = await walk(state);
  assert.ok(files.length > 0);
  for (const file of files) assert.equal((await stat(file)).mode & 0o777, 0o600, 'stored state is owner-only');
});

test('D84: a masking failure writes and prints nothing', async (t) => {
  const input = await fixture(t);
  for (const [format, maskOutput] of [['html', () => { throw new Error('mask failed'); }],
    ['md', () => { throw new Error('mask failed'); }], ['html', (text) => `${text}!`]]) {
    const output = join(input.directory, `failed-${format}-${maskOutput.length}.${format}`), out = streams();
    const argv = [input.file, '--format', format, '--output', output, '--no-open'];
    assert.equal(await runSessionReviewCommand(argv, { ...input.options, ...out, createJudge: transport([]),
      maskOutput, openPage: () => assert.fail('nothing is opened') }), 3);
    await assert.rejects(stat(output), { code: 'ENOENT' }, 'nothing is written');
    assert.match(out.chunks.stderr, /Review could not complete: output_not_masked\./);
    assert.deepEqual(leaks(out.chunks.stdout + out.chunks.stderr), []);
  }
  // Printed to the terminal: nothing of the story is printed.
  const out = streams();
  assert.equal(await runSessionReviewCommand([input.file], { ...input.options, ...out, createJudge: transport([]),
    maskOutput: () => { throw new Error('mask failed'); } }), 3);
  assert.doesNotMatch(out.chunks.stdout, /‹redacted|Deploy with/);
  assert.match(out.chunks.stderr, /output_not_masked/);
  // The output function itself: a page whose text would change is refused; a story is masked as it stands.
  assert.throws(() => forPeople(`<p>${KEY}</p>`, 'html'), { code: 'output_not_masked' });
  assert.equal(forPeople(`<p>${'&lt;'}ok&gt;</p>`, 'html'), `<p>${'&lt;'}ok&gt;</p>`);
  assert.deepEqual(leaks(forPeople(`key ${KEY}\n`, 'md')), []);
});

test('D84: the session hash is over the bounded, unmasked ledger, and stable', async (t) => {
  const input = await fixture(t);
  const load = () => loadRecordedSessionWithHash({ parent: input.file, codexHome: input.env.CODEX_HOME,
    claudeProjects: input.env.SONAH_CLAUDE_PROJECTS, sessionKey: 'session' });
  const [one, two] = [await load(), await load()];
  assert.match(one.hash, /^[0-9a-f]{64}$/);
  assert.equal(one.hash, two.hash, 'deterministic');
  assert.ok(one.session.events.some((event) => one.session.textOf(event, 'text').includes(KEY)
    || one.session.textOf(event, 'command').includes(KEY)), 'the session the model reads holds the key');
  // The whole difference from a masked load is the masking: the same load masked hashes otherwise.
  const files = [input.file];
  const loaded = (mask) => loadSessionEvidence(files, { outcomes: null, reviewLinkedChildren: true, mask,
    recordingRoots: { codex: join(input.env.CODEX_HOME, 'sessions'), claude: input.env.SONAH_CLAUDE_PROJECTS } });
  const open = redact(await loaded(false), { mask: false }).ledger;
  const masked = redact(await loaded(true)).ledger;
  assert.equal(one.hash, sliceHash(open), 'the hash names the ledger the model reads');
  assert.notEqual(one.hash, sliceHash(masked));
  assert.ok(JSON.stringify(open).includes(KEY) && !JSON.stringify(masked).includes(KEY));
});

test('D84: the PR comment body carries no secret, and a text it cannot mask is never posted', () => {
  // D82 step 10: the comment is built from the session review's report (github/publication.js `publicCommentText`), and
  // every text in it that is not a fixed literal passes `escapePublicText`, which masks with `maskForPeople`.
  const posted = escapePublicText(`The key ${KEY} is committed. It sits beside ${AWS} in the deploy script.`);
  for (const secret of SECRETS) assert.ok(!posted.includes(secret));
  assert.deepEqual(leaks(posted), []);
  assert.match(posted, /redacted:anthropic\\-key/, 'premise: the text is shown, masked');
  assert.throws(() => escapePublicText(null), { code: 'disclosure_rejected' });
});

// ---- D84 review (2026-10-13): secrets only the redactor's full walk can see -----------------------------------------
// Findings 1 to 3 of the D84 review: a value is a secret by its event's other fields (S1: the command that names it,
// the path that names the file holding it) or by the lines above it (a YAML block under a secret-named key), never by
// its own shape, so a pass over one text at a time misses it. The FAKE values below are each left alone by
// `maskForPeople` read alone (the premise); the redactor's full walk hides each (`peopleSecretsOf`), so the page, the
// story and a comment body written from the session never show one, a value the model restates in its own words
// included, and a quote of the model's a mask touches is not shown.
const LONE = ['tangerine', 'quartz', 'fake'].join('');                         // `echo $DB_PASSWORD` prints it alone
const CRED = ['fake7', 'Token4', 'Only2', 'Tests'].join('');                   // a value key in a secret-named file
const BLOCK = Buffer.from('signing-key-fake-only-for-tests-01').toString('base64');   // a line of a YAML key block
const OWNER = ['platform', 'team', 'zephyr'].join('-');                        // the block's comment: no secret
const CONTEXT_ONLY = [LONE, CRED, BLOCK];
const READ = [`# owner: ${OWNER}`, 'signing_key: |', `  ${BLOCK}`, 'region: eu']
  .map((line, i) => `${String(i + 1).padStart(6)}\t${line}`).join('\n');
const QUOTE = READ.split('\n').slice(0, 3).join('\n').slice(READ.indexOf(OWNER));   // the owner line to the key's line
const CLAIM = `Settings check: the read showed ${BLOCK} and the command showed ${LONE}.`;
const CHOSEN = `Settings store: wrote ${CRED} beside ${LONE} into the file`;
const hidden = (text) => CONTEXT_ONLY.flatMap((value) => Array.from({ length: value.length - 7 },
  (_, i) => value.slice(i, i + 8))).filter((part) => text.includes(part));

async function contextFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'sonah-d84-walk-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const home = join(directory, 'home'), repo = join(directory, 'repo');
  await mkdir(home); await mkdir(repo);
  const file = join(directory, 'recording.jsonl');
  await writeFile(file, toJsonl(recording({ cwd: repo, sessionId: 'synthetic-d84-walk', version: '2.1.284' })
    .ask('Set up the deploy settings and check the database login.')
    .run('echo $DB_PASSWORD', { pass: LONE })
    .create('deploy/credentials.json', `{"db":{"value":"${CRED}"}}`)
    .read('config/signing.yaml', READ)
    .say('The database login works and the signing key is in place.').done()) + '\n');
  const env = { HOME: home, SONAH_HOME: join(home, '.sonah'), CODEX_HOME: join(home, 'codex'),
    SONAH_CLAUDE_PROJECTS: join(home, 'claude-projects') };
  return { directory, file, env, options: { cwd: repo, env, installSignals: false,
    loadReviews: async () => new Map(), openPage: async () => {} } };
}
/** A fake reviewer that restates the context-only values in its own words, and cites the key block's lines. */
function restating(calls) {
  return ({ onResult, config }) => async (request) => {
    calls.push(request);
    onResult({ ok: true, backend: config.backend, attestation: 'attested', contextWindow: 1_000_000 });
    if (request.challenge) return { votes: request.challenge.items.map(({ key, candidate }) => ({ key,
      verdict: 'not-refuted', explanation: `The read printed ${BLOCK} and the command printed ${LONE}.`,
      receipts: [candidate.contradictedBy ?? candidate.stated].filter(Boolean) })) };
    const ask = request.window.events.find((event) => event.kind === 'instruction');
    const said = request.window.events.find((event) => event.kind === 'commentary');
    const write = request.window.events.find((event) => event.kind === 'invocation' && event.operation === 'write');
    // The recording's last result is the Read's.
    const read = request.window.events.filter((event) => event.kind === 'observation').at(-1);
    return { pivots: [], failures: [], notClaims: [], forbiddenEdits: [], requirements: [],
      decisions: ask && write ? [{ dimension: `where ${CRED} is kept`, chosen: CHOSEN, value: 'deploy/credentials.json',
        valueReceipt: { eventId: write.id, field: 'path', role: 'action', quote: 'deploy/credentials.json' },
        actions: [write.id], stated: null, constrainedBy: { instruction: { eventId: ask.id, role: 'instruction',
          quote: 'Set up the deploy settings' }, settles: false, settledValueQuote: null } }] : [],
      claims: said && read ? [{ text: CLAIM,
        stated: { eventId: said.id, role: 'commentary', quote: 'the signing key is in place.' },
        contradictedBy: { eventId: read.id, role: 'observation', quote: QUOTE } }] : [] };
  };
}

test('D84 review: a secret only the full walk sees is in the request, and never on the page, in the story or a comment',
  async (t) => {
    const input = await contextFixture(t), calls = [];
    // The premise: each value read alone passes the prose rules unmasked, so only the walk's context can hide it.
    for (const value of CONTEXT_ONLY) assert.equal(maskForPeople(value), value);
    for (const text of [CLAIM, CHOSEN])
      assert.equal(maskForPeople(text), text, 'premise: the prose rules alone leave the restated values');
    const page = join(input.directory, 'review.html'), out = streams();
    assert.equal(await sessionOnly([input.file, '--format', 'html', '--output', page, '--no-open'],
      { ...input.options, ...out, createJudge: restating(calls) }), 0, out.chunks.stderr);
    const asked = calls.map((request) => `${request.system}${request.prompt}`).join('\n');
    for (const value of CONTEXT_ONLY) assert.ok(asked.includes(value), 'the model reads the session as recorded');
    const html = await readFile(page, 'utf8');
    assert.match(html, /Settings store/, 'premise: the decision the reviewer restated the values in is on the page');
    assert.deepEqual(hidden(html), []);
    // The claim's recorded result touches the key block's mask: the quote does not ground for a person, so the page
    // does not list the claim (a row's quotes must ground, D84), and none of the quote shows.
    assert.doesNotMatch(html, new RegExp(OWNER), 'a quote a mask touches is not shown');
    assert.deepEqual(hidden(out.chunks.stdout + out.chunks.stderr), []);
    // The Markdown story, printed and written (answers reused: no new call).
    const story = streams();
    assert.equal(await sessionOnly([input.file], { ...input.options, ...story,
      createJudge: restating([]) }), 0, story.chunks.stderr);
    assert.match(story.chunks.stdout, /Settings check/, 'premise: the claim the values are restated in is told');
    assert.match(story.chunks.stdout, /Settings store/);
    assert.deepEqual(hidden(story.chunks.stdout), []);
    assert.doesNotMatch(story.chunks.stdout, new RegExp(OWNER), 'a quote a mask touches is not shown');
    const md = join(input.directory, 'review.md');
    assert.equal(await sessionOnly([input.file, '--output', md], { ...input.options, ...streams(),
      createJudge: restating([]) }), 0);
    assert.deepEqual(hidden(await readFile(md, 'utf8')), []);
    // A comment body written from the session (D82 step 10) masks with the session's mask.
    const { session } = await loadRecordedSessionWithHash({ parent: input.file, codexHome: input.env.CODEX_HOME,
      claudeProjects: input.env.SONAH_CLAUDE_PROJECTS });
    const mask = peopleMask(peopleSecretsFor(session).values);
    assert.deepEqual(hidden(escapePublicText(CLAIM, mask)), []);
    assert.match(escapePublicText(CLAIM, mask), /Settings check/);
    assert.notDeepEqual(hidden(escapePublicText(CLAIM)), [], 'premise: without the session\'s mask the values show');
  });

test('D84 review: the walk that finds what a person may not read fails closed: nothing is written', async (t) => {
  const input = await contextFixture(t);
  // The session as loaded, but kept beside a ledger the walk cannot read.
  const failing = async (options) => {
    const loaded = await loadRecordedSessionWithHash(options);
    const unreadable = { get ask() { throw new Error('the walk failed'); } };
    return { ...loaded, session: keepPeopleSecrets(Object.create(loaded.session), unreadable) };
  };
  for (const format of ['html', 'md']) {
    const output = join(input.directory, `walk-failed.${format}`), out = streams();
    assert.equal(await runSessionReviewCommand([input.file, '--format', format, '--output', output, '--no-open'],
      { ...input.options, ...out, createJudge: restating([]), loadSession: failing }), 3);
    await assert.rejects(stat(output), { code: 'ENOENT' }, 'nothing is written');
    assert.match(out.chunks.stderr, /Review could not complete: output_not_masked\./);
    assert.deepEqual(hidden(out.chunks.stdout + out.chunks.stderr), []);
  }
});

test('D84 review: each text helper masks what it is given, with the session\'s values during a render', async (t) => {
  const input = await contextFixture(t);
  const { session } = await loadRecordedSessionWithHash({ parent: input.file, codexHome: input.env.CODEX_HOME,
    claudeProjects: input.env.SONAH_CLAUDE_PROJECTS });
  const helpers = { visible, oneLine, escapeHtml, clip: (text) => clip(text, 1000) };
  // Outside a render: the prose rules, a pattern-shaped key anywhere.
  for (const [name, helper] of Object.entries(helpers)) assert.deepEqual(leaks(helper(`used ${KEY} here`)), [], name);
  // Inside one: the session's own values too, a value the model restates in its own words.
  const shown = asPeopleRead(session, () => Object.fromEntries(Object.entries(helpers)
    .map(([name, helper]) => [name, helper(CLAIM)])));
  for (const [name, text] of Object.entries(shown)) {
    assert.deepEqual(hidden(text), [], name);
    assert.match(text, /Settings check/, name);
  }
  // A text a cut made before this pass ends inside a value the report restates: what is left of it is masked too.
  const cut = asPeopleRead(session, () => visible(`the command showed ${LONE.slice(0, 12)}`), { explanation: CLAIM });
  assert.deepEqual(hidden(cut), []);
  assert.doesNotMatch(cut, new RegExp(LONE.slice(0, 8)));
  // After the render, the helpers mask by the prose rules alone again: nothing of a session outlives its render.
  assert.equal(visible(`the command showed ${LONE}`), `the command showed ${LONE}`);
});

test('D84 review: a recorded hunk\'s line a secret-named key above it makes secret is masked in the people view',
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'sonah-d84-hunk-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const repo = join(directory, 'repo');
    await mkdir(repo);
    const old = Buffer.from('old-signing-key-fake-only-for-tests').toString('base64');
    const path = `${repo}/config/app.yaml`, file = join(directory, 'recording.jsonl');
    await writeFile(file, toJsonl(recording({ cwd: repo, sessionId: 'synthetic-d84-hunk', version: '2.1.284' })
      .ask('Rotate the signing key.')
      .tool('Edit', { file_path: path, old_string: `  ${old}`, new_string: `  ${BLOCK}` }, 'ok', { sidecar: {
        filePath: path, oldString: `  ${old}`, newString: `  ${BLOCK}`,
        originalFile: `signing_key: |\n  ${old}\nregion: eu\n`,
        structuredPatch: [{ oldStart: 1, oldLines: 3, newStart: 1, newLines: 3,
          lines: [' signing_key: |', `-  ${old}`, `+  ${BLOCK}`, ' region: eu'] }],
        userModified: false, replaceAll: false } })
      .say('Rotated.').done()) + '\n');
    const { session } = await loadRecordedSessionWithHash({ parent: file, codexHome: join(directory, 'codex') });
    const edit = session.events.find((event) => event.kind === 'invocation' && event.recorded?.hunks);
    const runs = (s) => JSON.stringify(s.sourceGroupsFor(edit).filter((group) => group.hunk === true));
    assert.ok(runs(session).includes(BLOCK), 'premise: the model reads the hunk as recorded');
    assert.equal(maskForPeople(`  ${BLOCK}`), `  ${BLOCK}`, 'premise: the added run alone passes the prose rules');
    const secrets = peopleSecretsFor(session);
    const people = sessionForPeople(session, peopleMask(secrets.values), secrets);
    assert.deepEqual(hidden(runs(people)), []);
    assert.match(runs(people), /signing_key/, 'the hunk\'s other runs stay');
  });

// ---- D84 x D82 step 10: the session review's PR comment is masked with the session's mask ------------
const SHARING = { SONAH_GITHUB_ACTOR_ID: '7', SONAH_GITHUB_APP_ID: '9' };
const COMMENT = ['--github', 'example/demo', '--pr', '7', '--post-comment', '--format', 'html'];
/** The session as loaded, kept beside a ledger the redactor's full walk cannot read. */
async function walkFails(options) {
  const loaded = await loadRecordedSessionWithHash(options);
  const unreadable = { get ask() { throw new Error('the walk failed'); } };
  return { ...loaded, session: keepPeopleSecrets(Object.create(loaded.session), unreadable) };
}
/** A fake GitHub answering the PR's metadata only; every write is recorded. */
function metadataOnly() {
  const writes = [];
  return { writes, client: { async request(request) {
    if (request.method !== 'GET') { writes.push(request); return { status: 201, data: {} }; }
    return { status: 200, data: { number: 7, base: { sha: 'b'.repeat(40), repo: { id: 42, name: 'demo', private: true,
      owner: { login: 'example' } } }, head: { sha: 'a'.repeat(40) } } };
  } } };
}

test('D84 x D82 step 10: the comment is masked with the session\'s mask, and a walk that cannot run shows none',
  async (t) => {
    const input = await contextFixture(t);
    const env = { ...input.env, ...SHARING };
    // A finished review, so a dry run has the saved report its comment is built from.
    assert.equal(await sessionOnly([input.file, '--format', 'html', '--output',
      join(input.directory, 'first.html'), '--no-open'], { ...input.options, ...streams(),
      createJudge: restating([]) }), 0);
    const dryRun = async (extra) => {
      const out = streams();
      const code = await sessionOnly([input.file, '--dry-run', ...COMMENT, '--output',
        join(input.directory, 'dry.html')], { ...input.options, ...out, env, client: { request: async () =>
        assert.fail('a dry run reads nothing from GitHub') }, ...extra });
      return { code, text: out.chunks.stdout };
    };
    const shown = await dryRun({});
    assert.equal(shown.code, 0);
    assert.match(shown.text, /as this recording's last finished review would post it/);
    assert.match(shown.text, /Sonah advisory review/);
    assert.deepEqual(hidden(shown.text), []);
    // The comment's mask is the session's: when the walk behind it cannot run, no comment is shown (fails closed).
    const refused = await dryRun({ loadSession: walkFails });
    assert.equal(refused.code, 0);
    assert.doesNotMatch(refused.text, /Sonah advisory review/);
    assert.match(refused.text, /could not be read, so there is no comment to show/);
    // The live comment: the mask the command passes reaches every text of the plan; one that throws posts nothing.
    const { sharePrReview } = await import('../src/pr-sharing.js');
    const state = (await readdir(join(input.env.SONAH_HOME, 'session-reviews')))
      .map((name) => join(input.env.SONAH_HOME, 'session-reviews', name))[0];
    const report = JSON.parse(await readFile(join(state, 'review', 'report.private.json'), 'utf8'));
    const share = async (mask) => {
      const github = metadataOnly(), out = streams(); let asked = null;
      const result = await sharePrReview({ client: github.client, github: { owner: 'example', repo: 'demo', number: 7 },
        report, stateDir: state, env: SHARING, ...out, confirm: async ({ body }) => { asked = body; return false; },
        mask });
      return { result, asked, writes: github.writes.length, stderr: out.chunks.stderr };
    };
    const plain = await share(undefined), marked = await share((text) => text.toUpperCase());
    assert.equal(plain.result.state, 'cancelled');
    assert.notEqual(marked.asked, plain.asked, 'the mask given is the one applied');
    assert.match(marked.asked, /^Sonah advisory review\n/, 'a fixed literal of the comment is not given to the mask');
    assert.match(marked.asked, /\n- 1 DECISION WHERE THE REVIEW COULD NOT CHECK/, 'each attention line passes the mask given');
    assert.match(plain.asked, /\n- 1 decision where the review could not check/);
    // D88: and the plain line that says how many rows Sonah could not check are folded.
    assert.match(marked.asked, /\n1 ROW SONAH COULD NOT CHECK — FOLDED/, 'the folded line passes the mask given');
    assert.match(plain.asked, /\n1 row Sonah could not check — folded/);
    const failed = await share(() => { throw new Error('the walk failed'); });
    assert.deepEqual([failed.result.state, failed.result.exitCode, failed.asked, failed.writes],
      ['failed', 3, null, 0]);
    assert.match(failed.stderr, /disclosure_rejected/);
  });
