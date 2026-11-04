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
import { textBeforeAgentPrompt, textBeforeTruthOnly, textBeforeRenderFix, textBeforeBeta11, requestBeforePlaced }
  from '../../evidence/test/m33-integration-fixture.js';
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
/** The options `readCode` was given before D124, by name; D206 added `activity`, which no request names. */
const READ_CODE_OPTIONS = ['activity', 'harnessHomes', 'maxBytes', 'own', 'recording', 'root'];
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
  // 0.3.0-beta.11 (D182 to D185) rendered back before that (`textBeforeBeta11`): the paragraph on how the code review
  // works, as it named the repository, D184's two count lines, and the model's version.
  const before = (text) => textBeforeAgentPrompt(textBeforeTruthOnly(text)).replaceAll(`Sonah ${PACKAGE_VERSION} · `, 'Sonah 0.3.0-beta.5 · ')
    .replace(/\. To review that code, run sonah review again with --code-repo (?:&lt;|<)the (?:repository's|repository&#39;s) folder(?:&gt;|>)/g, '')
    .replace(/<p>In this run, Sonah made [^<]*<\/p>/g, '').replace(/In this run, Sonah made [^\n]*  \n/g, '')
    .replaceAll('sonah.report-model/6', 'sonah.report-model/5').replaceAll('sonah.session-page/45', 'sonah.session-page/44')
    .replaceAll('sonah.session-story/40', 'sonah.session-story/39');
  // D131 (R1, B12) rendered back: Must act and Must know before your prompt is the order's one move; the prompt is put
  // back before them, on the page and in the .md, and nothing else moves.
  // D193: the prompt's marker is its panel's.
  const pageOrder = (html) => {
    const [act, prompt, good] = ['<section class="part tier" id="must-act">', '<section class="part panel" id="prompt">',
      '<details class="part tier fold-tier" id="good-to-know">'].map((marker) => html.indexOf(marker));
    return html.slice(0, act) + html.slice(prompt, good - 1) + '\n' + html.slice(act, prompt - 1) + html.slice(good);
  };
  const mdOrder = (md) => {
    const [act, prompt, good] = ['### Must act (', '### Your asks (', '<details><summary>Good to know (']
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
  // D207 rendered back (`requestBeforePlaced`): a row's note on what places its file in the change, and the outside
  // block's note. No other request byte of these shapes moved.
  const requests = calls.map(beforeAbsoluteNames).map((r) => JSON.stringify([r.label ?? null, r.system ?? null,
    r.prompt == null ? null : requestBeforePlaced(r.prompt), r.agent ? [r.agent.root, r.agent.addDirs] : null]));
  return { read: read.map(([, options]) => Object.keys(options).sort()),
    given: [JSON.stringify(report), ...requests].some((text) => text.includes('"given"')),
    requests: digest(named(requests.join('\n'))),
    md: digest(named(before(mdOrder(textBeforeRenderFix(unlocatedBack(textBeforeBeta11(await readFile(join(run, 'story.md'),
      'utf8')))))))),
    page: digest(named(before(pageOrder(textBeforeRenderFix(textBeforeBeta11(renderSessionPage(session, report,
      { folder: recorded }))))))),
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
    // 2d5ba7a8e05f9184). D193: the page's tabs, panels and stylesheet moved the page alone (was ordinary
    // b76844956962288d, sibling 68cb29f37291560f, script bbcd8b8cc5e7e7b6); no .md and no request moved. D194: the
    // decision list's style rules moved the page alone once more (was ordinary b29e3af1ba4ec2bf, sibling
    // 8998389afdd589a4, script 1f153438d3158e5b); these shapes hold no decision and no quote-led item, so no .md moved.
    // D195: the page's pills and key column moved the page alone once more (was ordinary 2285b66e027728ae, sibling
    // 6b8eb39d5bae0c43, script 8094690ee63872f1). D196: the tabs as radios, the header's tiles and the asks bar moved the
    // page alone once more (was ordinary 2b9b3bcdfbb658af, sibling 3ad6fd57ce67dca4, script 9e4a004b7d13dfe6). D197: the
    // chips and the run and claim marks moved it once more (was ordinary c445704926dff9b6, sibling 01de2127436e130d,
    // script f713ef6a641c222e). D198: rows and the asks checklist moved it once more (was ordinary ccc0bc7e55c5a30f,
    // sibling ee1822bd7a157a74, script 9e5973ec8e6e4f64). D199 (the owner, 2026-10-30, "All of them"): the .md and the
    // page by lines removed alone (was md ordinary 069c1ac7864cfec3, sibling 61b3262c1a3f4bce, script 86b886eaeb816962;
    // page ordinary 7591ce3bdce825a2, sibling f4058225bce5887e, script e525f8c351e1bbcb): the header's no-GitHub-remote
    // line (.md of ordinary and sibling); the ask row's fold of why it is not checked, with the note that Sonah could
    // not find its words in your message; the sentence on which parts of your prompt Sonah checked; "Sonah finished
    // its review of this session."; the paragraphs on how the code review works and labels a finding; the footer's
    // lines on "you" and on reading before you share; and on the page, the dashboard markup (the asks' heading without
    // its status parts and the did heading without its counts, each with its stats under it; the files' hidden
    // separators and type pills; the not-checked chips and cards) and its stylesheet rules. No such shape holds a
    // prompt for the agent, so no page gains a script. No request, status, count, quote or anchor moved. D199's review
    // round moved the page alone once more (was ordinary 555a2808e60e530a, sibling 0db228d8b96b1a9b, script
    // ca9364684a30b1ce): the asks' stats one a state in the count line's words, a row with nothing under it a plain
    // row, the session review's card only with something in it, and the decisions tile a label. Its review round's
    // second pass moved the .md and the page once more (was md ordinary 868e2a8edc147c5a, sibling 7338cebdb6b72cba,
    // script 3f9a865363197101; page ordinary 3e33159d4c154890, sibling 53fa120eeb2e9237, script 3d0549f77b09e032):
    // Sonah's own row for the message (codeMade) has words, the start of that message as a recorded quote, in the .md's
    // row and the page's row; and the script shape's run stat is Commands (R17). No request, status, count or anchor
    // moved. (A pass between listed that row again under its message in Your messages, with the note on words Sonah could
    // not find there, which is false of a message's own start: page ordinary e980de528f3c0ca9, sibling 6058771d1e38e0d8,
    // script 7dc85311f0f19b74; the model now leaves Sonah's own rows out of a message's `unlocated`.)
    // D200 (the owner, 2026-10-31: "bring back the precision markers as short tags") moved the .md and the page once
    // more, each shape alike (was md ordinary 173946948be3af8b, sibling 4eab1e3019420018, script d5251f76e9cfbf9f; page
    // ordinary e4335e2a529a3d83, sibling 2f1692510467f5e1, script bb8729e278d72201): the not-checked ask's row gains
    // its tag, "Ask not named" (the .md's note cell, "Ask not named."; on the page a tag after your words, its reason's
    // sentence its title); "Sonah checked only the marked parts of your message." is back, under the .md's table and
    // first in the page's fold of your messages; and the page's stylesheet: the --ease token, tight tracking on the big
    // numbers, translucent sticky tabs (solid under reduced transparency), the rules of the tags and of the header's
    // sub-count, the copy button's and the chips' press feedback and the copy check's fade-in (off under reduced
    // motion), and the dead .item-head rules gone. No request, status, count, quote or anchor moved. D200's review
    // round moved the .md and the page once more, each shape alike, by one line of the .md and the tag's markup (was md
    // ordinary 46707c26cbba284d, sibling dd4d16b33eda9bef, script 627407710675f965; page ordinary ccb0110c16b2faac,
    // sibling bd1beb745d2df6f4, script 06f02d36a6304fae): under the .md's table, "Sonah checked only the marked parts
    // of your message." reads "Sonah checked only the parts of your prompt that the table above lists." (the page
    // keeps "marked parts" in its fold of your messages); on the page, the tag drops its title for tabindex="0" and
    // holds the same sentence in a `.tip` span ("Ask not named <span class="tip">The session review did not name what
    // you asked in this message, …</span>"); the stylesheet gains the .tip rules (clipped until the tag is hovered or
    // focused, open in print), position:relative on .why and .flag, and the phone rule that spans .ask-row .at across
    // the row. No request, status, count, quote or anchor moved.
    // D201 (the owner, 2026-10-31: "move claims to the top on what the agent did") moved the page alone, each shape
    // alike (was ordinary fb7eb9ec4df728b7, sibling 9c24508edd02425e, script 789a01655bd5c264): in What the agent did,
    // the Claims list (its heading, "The session review recorded no claim." and the fold of closing lines no claim
    // covers) now comes before Files and Runs, word for word as it was. These shapes hold no claim and no Verify item,
    // so no stats tile, chip line or evidence line moved; no .md, request, status, count, quote or anchor moved.
    // D201's review moved the page alone once more, each shape alike, by one stylesheet rule (was ordinary
    // bad2c33e9a3118cc, sibling 8c8dd839e70be439, script 0393eb62a1f46727; the page without that rule gives them back):
    // under prefers-reduced-motion, the copy button's and the acts' summaries' press transform is none. No .md, request,
    // status, count, quote or anchor moved.
    // D202 (the owner, 2026-10-31: "Done asks: what does it", "Short replies: context", "Decisions: their actions",
    // "Legend and small fixes", "Form, not meaning") moved the .md and the page, each shape alike (was md ordinary
    // 161da9d2979df61a, sibling 0b1a580567305422, script bab6a648311d5191; page ordinary 149f63770c731185, sibling
    // 7a1cb1221174c388, script 2b1005352e3015dd): the legend's four lines more (the page's six, with the row tags' and
    // the bar's); where a shape has them, the asks' evidence (the .md's fold under the table, the page's row folds), the
    // agent's message before yours, a decision's recorded actions, the code review's lines' tag; on the page, a radio's
    // name with its count, a 0 tile's class, the bar in its words' order, and the stylesheet's D202 rules. No request,
    // status, count, quote or anchor moved. D203 (the owner, 2026-10-31: "Yes, extend the script") moved the page alone,
    // each shape alike: it now carries the page's one script, which also follows an in-page link (these shapes have no
    // copy button, so they had none), its hash in the policy, a place's room under the tab bar and its ring, and every
    // focus ring in the accent's ink. No .md, request, status, count, quote or anchor moved. D204 (the coordinator's
    // review of D202 and D203; the owner, 2026-10-31: "Your asks" everywhere, "Yes, add Back") moved the .md and the page,
    // each shape alike: the count line and the prompt's heading say "Your asks", the legend says what the code review's
    // lines' tag means where a shape has those lines, and the page's script adds Back and opening at a #place (its
    // review: the entries written before the page moves, the browser's own scroll restoring kept, the link focused on
    // Back, a tab opened by hand kept for a reload), and a phone's tiles never split a word. No request, status, count, quote or anchor moved.
    // D207 is rendered back above (`requestBeforePlaced`, `textBeforePlaced`, which `textBeforeBeta11` applies first): a
    // file's row and the base line's sentence, the words to a whole branch, and the readers' versions; with them back, no
    // request and no .md moved. D208 (the owner, 2026-11-02: no colour behind quoted words) moved the page alone, each shape
    // alike, by five stylesheet rules (was ordinary 310f1683d05c8093, sibling 1d3ead4efc6c9d75, script 2a2082cb2c86f27d; the
    // page with those five rules back gives them back). No .md, request, status, count, quote or anchor moved.
    ordinary: { requests: '3c472f0b2f284287', md: 'e91ad34d210fafaf', page: '3f1ab912e7232975',
      labels: ['narrative:w1', 'code-review:agent', 'code-account:1'] },
    sibling: { requests: '1d3c67aaf360cf88', md: 'b64f4fd8a797af09', page: '563e22762f0a505e',
      labels: ['narrative:w1', 'code-review:agent', 'code-account:1'] },
    script: { requests: 'afe064acbf3c9007', md: '21b702a6c58bbad6', page: '64bef5337a63a2c7',
      labels: ['narrative:w1'] },
  });
});
