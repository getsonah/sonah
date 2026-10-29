// D124 (the --code-repo option): without the flag, every request byte and every report byte are as before it. Three
// shapes run through the CLI with no --code-repo: a session in a git repository with a recorded write (the ordinary
// case); a session that wrote in its own repository and in a sibling one (D117's place, with D113's window there); and
// the smoke's S1 shape (a session that started in a folder of no repository and changed a repository only through a
// script). Every request the reviewer is sent (its label, system text, prompt and the agent's folders) and every report
// byte (the .md and the page) is digested, with the throwaway folders' paths named by role, and each digest is the one
// the tree before D124 gives (commit f731f368, this file run there unchanged). The one move by design: the S1 shape's
// reason (`no_seen_write`) now ends with the way out, `--code-repo`, which is taken out before its report is digested.
// A later change that moves these bytes on purpose records the new digests here with the decision that moved them.
// D129 renders its moves back instead (the cost sentence and the readers' versions), so the digests stay D124's.
// D147 renders its move back too: the sibling shape is a change that two places hold, so each of its code-step requests
// is sent the absolute-path brief and names each file of the working directory by its absolute path; each such request
// is put back to the one-place brief and to the names relative to its working directory before it is digested.
//
// Throwaway folders and repositories, synthetic sessions, a deterministic fake reviewer: no recording, no model, no
// network. Every commit date and every file time that a rule reads is fixed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runSessionReviewCommand } from '../src/session-review-command.js';
import { readCodeSnapshot } from '../src/code-snapshot.js';
import { renderSessionPage } from '../../render/session-page.js';
import { REPORT_PROMPT_WORDS } from '../../render/report-words.js';
import { CODE_TEXT, CODE_FILES, buildCodeSession, codeJudge, codeSession, sha256 } from './code-pass-fixture.js';
import { textBeforeAgentPrompt, textBeforeTruthOnly, textBeforeRenderFix } from '../../evidence/test/m33-integration-fixture.js';
import { CODE_BRIEFS_ABSOLUTE, CODE_REVIEW_SYSTEM, CODE_REVIEW_SYSTEM_WHOLE_FILES, CODE_VERIFY_SYSTEM,
  CODE_BATCH_VERIFY_SYSTEM, CODE_ACCOUNT_SYSTEM } from '../../evidence/src/code-pass.js';

const START = '2030-01-01T00:00:00.000Z';
const END = '2030-01-02T00:00:00.000Z';
const DURING = new Date('2030-01-01T12:00:00.000Z');
const T1 = { turn: 'T1' };
const GIT_ENV = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))),
  GIT_AUTHOR_DATE: '2029-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2029-01-01T00:00:00Z', GIT_AUTHOR_NAME: 'synthetic',
  GIT_AUTHOR_EMAIL: 's@example.invalid', GIT_COMMITTER_NAME: 'synthetic', GIT_COMMITTER_EMAIL: 's@example.invalid' };
const NO_ROWS = () => ({ decisions: [], pivots: [], claims: [], requirements: [] });
const digest = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);
/** D147: each absolute-path brief and the one-place brief it was before. */
const RELATIVE_BRIEF = new Map([[CODE_BRIEFS_ABSOLUTE.review, CODE_REVIEW_SYSTEM],
  [CODE_BRIEFS_ABSOLUTE.reviewWholeFiles, CODE_REVIEW_SYSTEM_WHOLE_FILES], [CODE_BRIEFS_ABSOLUTE.verify, CODE_VERIFY_SYSTEM],
  [CODE_BRIEFS_ABSOLUTE.batch, CODE_BATCH_VERIFY_SYSTEM], [CODE_BRIEFS_ABSOLUTE.account, CODE_ACCOUNT_SYSTEM]]);
/** D147 rendered back: a request sent the absolute-path brief, with its brief put back and every name it gave by the
 *  working directory's absolute path (`<root>/…`) put back relative to it; any other request as it was. */
const beforeAbsoluteNames = (r) => (!RELATIVE_BRIEF.has(r.system) ? r : { ...r, system: RELATIVE_BRIEF.get(r.system),
  prompt: r.prompt.split(`${r.agent.root}/`).join('') });
/** The options `readCode` was given before D124, by name. */
const READ_CODE_OPTIONS = ['harnessHomes', 'maxBytes', 'own', 'recording', 'root'];
/** The package's version, which the .md's footer names (the tree before D124 named 0.3.0-beta.5). */
const PACKAGE_VERSION = JSON.parse(await readFile(new URL('../../../package.json', import.meta.url), 'utf8')).version;

async function folder(t, name) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), `sonah-d124b-${name}-`)));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function put(root, files, time = null) {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
    if (time) await utimes(join(root, path), time, time);
  }
}
async function repository(root, base, after = {}) {
  await put(root, base);
  for (const args of [['init', '-q', '-b', 'main'], ['add', '-A'], ['commit', '-q', '-m', 'base']])
    execFileSync('git', args, { cwd: root, env: GIT_ENV, stdio: 'pipe' });
  await put(root, after, DURING);
}
async function recordingIn(base) {
  const recording = join(base, 'recording.jsonl');
  await writeFile(recording, `${JSON.stringify({ timestamp: START })}\n${JSON.stringify({ timestamp: END })}\n`);
  return recording;
}

/** The three shapes: each `{ base, recorded, recording, session }`, every path under `base`. */
const SHAPES = {
  // A session in a git repository that wrote src/parse.js (as recorded), beside a file changed while it ran.
  ordinary: async (t) => {
    const base = await folder(t, 'ord');
    const root = join(base, 'work');
    await repository(root, { ...CODE_FILES, 'src/parse.js': 'export function parse() {}\n' },
      { 'src/parse.js': CODE_FILES['src/parse.js'], 'src/gen.js': 'export const gen = 1;\n' });
    return { base, recorded: root, recording: await recordingIn(base), session: codeSession() };
  },
  // D117: a recorded write in the working repository and one in a sibling repository, whose other file changed while
  // the session ran.
  sibling: async (t) => {
    const base = await folder(t, 'sib');
    const root = join(base, 'work'), lib = join(base, 'lib');
    await repository(root, { ...CODE_FILES, 'src/parse.js': 'export function parse() {}\n' },
      { 'src/parse.js': CODE_FILES['src/parse.js'] });
    await repository(lib, { 'src/text.js': 'export const a = 1;\n', 'src/other.js': 'export const b = 1;\n' },
      { 'src/text.js': 'export const a = 2;\n', 'src/other.js': 'export const b = 2;\n' });
    return { base, recorded: root, recording: await recordingIn(base),
      session: codeSession({ writes: [{ path: join(lib, 'src/text.js'), text: 'export const a = 2;\n' }] }) };
  },
  // The smoke's S1 shape: a scratch folder of no repository beside `app`, changed only through a script.
  script: async (t) => {
    const base = await folder(t, 'scr');
    const sandbox = join(base, 'sandbox'), app = join(base, 'app');
    await put(sandbox, { 'scratch-notes.txt': 'notes\n' });
    await repository(app, { 'src/money.js': 'export const cents = 1;\n' }, { 'src/money.js': 'export const cents = 2;\n' });
    const cmd = `python3 - <<'EOF'\nbase='${app}/'\nopen(base+'src/money.js','w').write(src)\nEOF`;
    const session = buildCodeSession('s-d124b-script', { ...CODE_TEXT, cmd }, [
      { id: 'I1', kind: 'instruction', blob: 'ask', ...T1 },
      { id: 'B1', kind: 'invocation', callKey: 'B1', tool: 'Bash', operation: 'command', paths: [],
        command: [{ sourceKey: 'cmd', fromByte: 0, untilByte: Buffer.byteLength(cmd) }], input: [], changes: [], ...T1 },
      { id: 'B1-r', kind: 'observation', invocation: 'B1', blob: 'wrote', ...T1 },
      { id: 'C2', kind: 'commentary', blob: 'final', phase: 'final', ...T1 }]);
    return { base, recorded: sandbox, recording: await recordingIn(base), session };
  },
};

/** One review with no --code-repo, from the session's working directory: the digests of its requests and report. */
async function digestsOf(t, shape) {
  const { base, recorded, recording, session } = await SHAPES[shape](t);
  const run = await folder(t, 'run');
  const calls = [], read = [];
  const output = join(run, 'story.html');
  const state = join(run, 'state');
  const answer = codeJudge({ narrative: NO_ROWS, review: () => ({ findings: [], questions: [] }) });
  const code = await runSessionReviewCommand([recording, '--concurrency', '1', '--state-dir', state, '--format', 'html',
    '--output', output, '--no-open', '--code-pass'], {
    stdout: { write: () => {} }, stderr: { write: () => {} }, cwd: recorded,
    env: { HOME: join(run, 'home'), SONAH_HOME: join(run, '.sonah'), CODEX_HOME: join(run, 'codex'),
      SONAH_CLAUDE_PROJECTS: join(run, 'claude') },
    installSignals: false, loadReviews: async () => new Map(), openPage: async () => {},
    loadSession: async () => ({ session, hash: sha256('synthetic'), cwd: recorded }),
    readCode: async (...args) => { read.push(args); return readCodeSnapshot(...args); },
    createJudge: ({ onResult }) => async (request) => {
      calls.push(request);
      onResult({ ok: true, backend: 'claude-cli', attestation: 'attested', contextWindow: 1_000_000 });
      return answer(request);
    } });
  assert.equal(code, 0, shape);
  // The throwaway folders by role (as written, and as the .md escapes them), so the digests hold on any machine.
  const escaped = (path) => path.replace(/[\\`*_[\]|]/g, '\\$&');
  const named = (text) => text.split(run).join('<run>').split(base).join('<base>').split(escaped(run)).join('<run>')
    .split(escaped(base)).join('<base>');
  // The one move by design (D124): the S1 shape's reason ends with the way out. 0.3.0-beta.6 moved the readers'
  // versions once (D126 and D127, COMPACTION_READER_VERSIONS; D129, COST_READER_VERSIONS: the same move): a session with
  // no compaction renders as before but for them. D129 (C7) rendered back too: the footer's sentence of what this run
  // cost, which nothing else moves here. Each release renders back too: the footer's version is put back to the one that
  // the tree before D124 named, so a new version moves no digest. D144 (0.3.0-beta.7) rendered back first
  // (`textBeforeAgentPrompt`): each prompt for the agent's fold, and the readers' versions it moved. D152 (0.3.0-beta.9)
  // rendered back before that (`textBeforeTruthOnly`): the paragraph on how the code review works, and the model's
  // version. D169 (0.3.0-beta.10) rendered back first of all (`textBeforeRenderFix`, before the order is put back,
  // which reads Good to know's fold): an empty Good to know's fold and "(folded)", and the model's version.
  const before = (text) => textBeforeAgentPrompt(textBeforeTruthOnly(text)).replaceAll(`Sonah ${PACKAGE_VERSION} · `, 'Sonah 0.3.0-beta.5 · ')
    .replace(/\. To review that code, run sonah review again with --code-repo (?:&lt;|<)the (?:repository's|repository&#39;s) folder(?:&gt;|>)/g, '')
    .replace(/<p>In this run, Sonah made [^<]*<\/p>/g, '').replace(/In this run, Sonah made [^\n]*  \n/g, '')
    .replaceAll('sonah.report-model/6', 'sonah.report-model/5').replaceAll('sonah.session-page/45', 'sonah.session-page/44')
    .replaceAll('sonah.session-story/40', 'sonah.session-story/39');
  // D131 (R1, B12) rendered back: Must act and Must know before your prompt is the order's one move; the prompt is put
  // back before them, on the page and in the .md, and nothing else moves.
  const pageOrder = (html) => {
    const [act, prompt, good] = ['<section class="part tier" id="must-act">', '<section class="card-ui part" id="prompt">',
      '<details class="part tier fold-tier" id="good-to-know">'].map((marker) => html.indexOf(marker));
    return html.slice(0, act) + html.slice(prompt, good - 1) + '\n' + html.slice(act, prompt - 1) + html.slice(good);
  };
  const mdOrder = (md) => {
    const [act, prompt, good] = ['### Must act (', '### Your prompt (', '<details><summary>Good to know (']
      .map((marker) => md.indexOf(marker));
    return md.slice(0, act) + md.slice(prompt, good) + md.slice(act, prompt) + md.slice(good);
  };
  // D131 and D133's merged review rendered back: in the .md, the note that Sonah could not find an ask's words in your
  // message is put back on the row's open notes (after a "found in a file that you attached" note), out of the row's
  // fold, which then goes when it holds nothing else. Nothing else moves.
  const UNLOCATED = REPORT_PROMPT_WORDS.unlocated.replace(/'/g, '\\\'');
  const unlocatedBack = (md) => md.split('\n').map((line) => {
    const fold = '<details><summary>Evidence</summary>';
    if (!line.startsWith('| ') || !line.includes(`${fold}${UNLOCATED}`) && !line.includes(`${fold}${REPORT_PROMPT_WORDS.unlocated}`)) return line;
    const said = line.includes(`${fold}${UNLOCATED}`) ? UNLOCATED : REPORT_PROMPT_WORDS.unlocated;
    let out = line.replace(` ${fold}${said}</details>`, '').replace(`${fold}${said}</details>`, '')
      .replace(`${fold}${said} `, fold);
    const cells = out.split(' | ');
    const attached = REPORT_PROMPT_WORDS.fromAttached;
    cells[2] = cells[2].startsWith(attached) ? `${attached} ${said}${cells[2].slice(attached.length)}` : `${said} ${cells[2]}`;
    out = cells.join(' | ').replace(/ {2}\|$/, ' |');
    return out;
  }).join('\n');
  const report = JSON.parse(await readFile(join(state, 'review', 'report.private.json'), 'utf8'));
  const absolute = calls.filter((r) => RELATIVE_BRIEF.has(r.system)).map((r) => r.label ?? null);
  const requests = calls.map(beforeAbsoluteNames).map((r) => JSON.stringify([r.label ?? null, r.system ?? null,
    r.prompt ?? null, r.agent ? [r.agent.root, r.agent.addDirs] : null]));
  return { read: read.map(([, options]) => Object.keys(options).sort()),
    given: [JSON.stringify(report), ...requests].some((text) => text.includes('"given"')),
    requests: digest(named(requests.join('\n'))),
    md: digest(named(before(mdOrder(textBeforeRenderFix(unlocatedBack(await readFile(join(run, 'story.md'), 'utf8'))))))),
    page: digest(named(before(pageOrder(textBeforeRenderFix(renderSessionPage(session, report, { folder: recorded })))))),
    labels: calls.map((r) => r.label ?? null), absolute };
}

test('D124: without --code-repo, the requests and the report of each shape are byte for byte those of the tree before '
  + 'it', async (t) => {
  const got = {};
  for (const shape of Object.keys(SHAPES)) got[shape] = await digestsOf(t, shape);
  for (const [shape, { read, given }] of Object.entries(got)) {
    assert.deepEqual(read, [READ_CODE_OPTIONS], `${shape}: readCode is given what it was before`);
    assert.equal(given, false, `${shape}: no place is marked as given`);
  }
  // D147: only the sibling shape's code-step requests are sent the absolute-path brief (two places hold its change).
  assert.deepEqual(Object.fromEntries(Object.entries(got).map(([shape, { absolute }]) => [shape, absolute])),
    { ordinary: [], sibling: ['code-review:agent', 'code-account:1'], script: [] });
  assert.deepEqual(Object.fromEntries(Object.entries(got).map(([shape, { requests, md, page, labels }]) =>
    [shape, { requests, md, page, labels }])), {
    // D133 (R2): the readers' lines about what Sonah could not check moved into their folds (the .md and the page only);
    // no request moved. D161: the report's two parts moved the .md and the page once more (was ordinary dc0a8516eeda471b,
    // c4f2596aa9e740b8; sibling 0494b0af596c3eb2, 6bf1bef7ecc2418a; script 3f561852160daaea, 36d515d60bfa22fc); no
    // request moved. D163: the page's three new style rules, which every page carries, moved the page alone (was
    // ordinary 9f99e009e1e477bb, sibling 52270a36ccb5e6c5, script ae0a3e716e358055); no .md and no request moved.
    // D167: the .md counts the runs in place of listing them, which moved the script shape's .md alone, the one shape
    // with a run (was a77fe0a283737ee2); no page and no request moved. Its review: that run is quiet (exit 0 before the
    // last edit), which the page does not list, so the .md no longer says the list is on the page (was
    // 2d5ba7a8e05f9184).
    ordinary: { requests: '3c472f0b2f284287', md: '069c1ac7864cfec3', page: 'b76844956962288d',
      labels: ['narrative:w1', 'code-review:agent', 'code-account:1'] },
    sibling: { requests: '1d3c67aaf360cf88', md: '61b3262c1a3f4bce', page: '68cb29f37291560f',
      labels: ['narrative:w1', 'code-review:agent', 'code-account:1'] },
    script: { requests: 'afe064acbf3c9007', md: '86b886eaeb816962', page: 'bbcd8b8cc5e7e7b6', labels: ['narrative:w1'] },
  });
});
