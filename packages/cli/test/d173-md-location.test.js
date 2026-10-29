// D173: where the report files go, said truthfully. The one line of `sonah review --session ID --background` (the line
// /sonah relays word for word) names the page, the Markdown report beside it and the log; the .md it names is the one
// the detached review writes (`mdPathFor(page)`). A typed relative --output is still printed as typed (D97). The skill
// text and its version do not change. Every fixture is synthetic, in a private temporary folder; no reviewer is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mdPathFor, REPORT_OUTPUT_WORDS } from '../src/report-output.js';
import { SESSION_ID_WORDS, runSessionReviewCommand } from '../src/session-review-command.js';
import { SKILLS, SKILL_VERSION } from '../src/skill.js';

const ID = '3f2a9c1e-5b7d-4e2f-9a1b-0c3d4e5f6a7b';
const streams = () => {
  const chunks = { stdout: '', stderr: '' };
  return { chunks, stdout: { write: (text) => { chunks.stdout += text; } },
    stderr: { write: (text) => { chunks.stderr += text; } } };
};
const rowOf = (cwd, extra) => ({ sessionId: ID, cwd, version: '2.1.308', isSidechain: false,
  timestamp: '2026-10-28T10:00:00.000Z', ...extra });
const lines = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
const judge = ({ onResult }) => async (request) => {
  onResult({ ok: true, backend: 'claude-cli', attestation: 'attested', contextWindow: 1_000_000 });
  if (request.challenge) return { votes: request.challenge.items.map((item) => ({ key: item.key, verdict: 'not-refuted',
    explanation: 'Synthetic.', receipts: [] })) };
  return { decisions: [], pivots: [], claims: [], requirements: [] };
};

async function home(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'sonah-d173-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const projects = join(dir, 'claude', 'projects'), repo = join(dir, 'repo'), sub = join(repo, 'sub');
  await mkdir(join(projects, '-repo'), { recursive: true }); await mkdir(sub, { recursive: true });
  await mkdir(join(dir, 'codex'));
  const file = join(projects, '-repo', `${ID}.jsonl`);
  await writeFile(file, lines([rowOf(repo, { type: 'user', origin: { kind: 'human' }, promptSource: 'typed',
    message: { role: 'user', content: 'Read the parser.' } })]), { mode: 0o600 });
  const env = { HOME: dir, SONAH_HOME: join(dir, '.sonah'), CODEX_HOME: join(dir, 'codex'),
    CLAUDE_CONFIG_DIR: join(dir, 'claude') };
  return { dir, repo, sub, file, env, options: { env, installSignals: false, loadReviews: async () => new Map(),
    openPage: async () => {}, createJudge: judge } };
}

test('D173: the background line names the page, the .md beside it and the log, and the .md is the one the review '
  + 'writes', async (t) => {
  const h = await home(t);
  for (const noOpen of [false, true]) {
    let started = null;
    const out = streams();
    assert.equal(await runSessionReviewCommand(['--session', ID, '--background', '--no-code-pass',
      ...(noOpen ? ['--no-open'] : [])], { ...h.options, ...out, cwd: h.sub,
      startReview: async (spec) => { started = spec; return 4242; } }), 0);
    const page = started.argv[started.argv.indexOf('--output') + 1];
    const md = mdPathFor(page);
    assert.notEqual(md, page);
    assert.equal(dirname(md), dirname(page), 'beside the page');
    assert.equal(out.chunks.stdout, `${(noOpen ? SESSION_ID_WORDS.startedNoOpen : SESSION_ID_WORDS.started)(page, md,
      started.log)}\n`);
    assert.equal(out.chunks.stdout.split('\n').length, 2, 'one line');
    for (const path of [page, md, started.log]) assert.ok(out.chunks.stdout.includes(path), path);
    // The detached review, run here with the argv and the folder it was started with: it writes that .md, beside the
    // page, and its own line (in its log, in a real run) names the same file.
    const child = streams();
    assert.equal(await runSessionReviewCommand(started.argv.slice(1), { ...h.options, ...child, cwd: started.cwd }), 0);
    assert.ok((await stat(page)).isFile());
    assert.ok((await stat(md)).isFile(), 'the named .md is written');
    assert.ok((await readdir(dirname(page))).includes(basename(md)));
    assert.ok(child.chunks.stdout.includes(REPORT_OUTPUT_WORDS.mdWritten(md, (await stat(md)).size)));
    await rm(join(dirname(page), 'active.json'), { force: true });
  }
});

test('D173: a typed relative --output is printed as typed, and the files land in the folder the command ran from',
  async (t) => {
    const h = await home(t);
    const out = streams();
    assert.equal(await runSessionReviewCommand([h.file, '--no-code-pass', '--format', 'html', '--output', 'r.html'], {
      ...h.options, ...out, cwd: h.sub }), 0);
    assert.ok((await stat(join(h.sub, 'r.html'))).isFile());
    const bytes = (await stat(join(h.sub, 'r.md'))).size;
    assert.ok(out.chunks.stdout.includes(`${REPORT_OUTPUT_WORDS.mdWritten('r.md', bytes)}\n`));
    assert.ok(out.chunks.stdout.includes(`${REPORT_OUTPUT_WORDS.ghLine('r.md')}\n`));
    assert.ok(!out.chunks.stdout.includes(join(h.sub, 'r.md')), 'never the absolute path of a relative --output');
  });

test('D173: the skill and its version do not change; the line it relays is the background start', () => {
  assert.equal(SKILL_VERSION, 1);
  assert.equal(SKILLS.claude.versions.length, 1);
  const text = SKILLS.claude.versions[0]['SKILL.md'];
  assert.equal(createHash('sha256').update(text).digest('hex'),
    '6296f52c09a258c5d916e4cd73ff8e402279daad430e6dd9380e0a219d52437d');
  assert.ok(text.includes('!`sonah review --session "${CLAUDE_SESSION_ID}" --background`'));
  assert.ok(text.includes('Reply with the line above only, word for word.'));
});

// D173 fix round: the two shipped passages that say what the line names, INSTALL's /sonah paragraph and
// TROUBLESHOOTING's entry for the background start, name the .md too. Read with each line break as one space.
test('D173: INSTALL and TROUBLESHOOTING say the line names the page, the .md beside it and the log', async () => {
  const doc = async (name) => (await readFile(fileURLToPath(new URL(`../../../docs/${name}`, import.meta.url)), 'utf8'))
    .replace(/\n[ \t]*/g, ' ');
  const install = await doc('INSTALL.md');
  assert.ok(install.includes('the agent replies with the one line Sonah printed: the review started, and where its '
    + 'page, the Markdown report beside it and its log will be.'));
  assert.ok(!install.includes('and where its page will be.'));
  const troubleshooting = await doc('TROUBLESHOOTING.md');
  assert.ok(troubleshooting.includes('Its line names the page, the Markdown report beside it (the .md for your pull '
    + 'request) and the log.'));
  assert.ok(!troubleshooting.includes('Its line names the page and the log.'));
});
