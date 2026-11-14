// D219 (the owner, 2026-11-09: "Why can't we make this the default?", then "both works"): `sonah review --format html`
// also draws the graphs page of the session's commits (`sonah visual`'s page, visual-command.js `drawVisualPage`) and
// the review page links to it. Only a review that writes its HTML page draws it (`--format html --output`, and the
// background review that the /sonah skill starts), only on the claude-cli backend, and not with `--no-visual`. The
// range is the code review's base to HEAD (repo-links.js `readRepoFacts`: `repo.start..repo.head`): the session's start
// commit, or with `--code-base REF` (D207) the merge-base of REF and HEAD, so that range covers the whole branch. It is
// drawn only when both are known, differ, and each file of the change is at HEAD: the graphs page draws commits only.
// Under a limit on the review's calls or size (`--max-calls`, `--max-input-bytes`, `--stop-at-utilization`) it is not
// drawn, since its calls are outside those limits. When it is not drawn, one line on stdout says why (render
// report-words.js REPORT_GRAPHS_WORDS, by a closed code), and the review page says the same line where the link would
// be; the line names `sonah visual` where it can draw the page (with the range when Sonah knows it), never for another
// backend, a folder no git repository holds, or a HEAD that is still the start commit with nothing left to commit.
//
// It runs after the review's facts are read and before the review page is written (once, `wx`), so the page links to a
// page that exists. Its calls use the visual's model, folder and calls environment (D151), never the review's. What it
// prints is fixed words, codes and paths. A failure prints the visual's problem and fix on stderr, each line marked as
// the graphs page's, and hands the page the visual's closed code (render REPORT_GRAPHS_FAILURE_WORDS), whose problem
// and fix the page says; it never changes the review's exit code, and never reaches the review's own failure. A stop
// (`signal`: the review's Ctrl-C or SIGTERM while it draws) abandons the graphs page alone: the review goes on to
// write its page and its usage record.
//
// No work at import: the visual's job is imported only when it runs (visual-command.js).
import { realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPORT_GRAPHS_FAILURE_WORDS, REPORT_GRAPHS_WORDS } from '../../render/report-words.js';
import { repoChangeFiles } from './repo-links.js';
import { VISUAL_DEFAULT_MODEL, VISUAL_FIX_WORDS, VISUAL_WORDS, visualFixOf, visualOutDir } from './visual-command.js';

const HASH = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
/** A range as the lines name it: 12 characters of each commit, as `sonah visual`'s started line names them. */
const rangeText = (base, head) => `${base.slice(0, 12)}..${head === 'HEAD' ? head : head.slice(0, 12)}`;
const RUN_LINE = 'Run sonah visual with a range, such as sonah visual main..HEAD.';

/** The lines the review prints about its graphs page, in fixed words, but those that say why it is not drawn (render
 *  report-words.js REPORT_GRAPHS_WORDS, which the review page says too). */
export const REVIEW_GRAPHS_WORDS = Object.freeze({
  // stderr, just before the job starts.
  started: 'Sonah draws the graphs page of the session\'s commits, with claude -p on your Claude plan.',
  // stdout, once the page is written: its absolute path. Never "Local page:", which names the review's own page.
  page: (path) => `Graphs page: ${path}`,
  // stdout, after the page's line: the job's totals (run.json), as the page's footer counts them.
  usage: (calls, cost) => `Graphs page usage: ${calls} model ${calls === 1 ? 'call' : 'calls'}, list cost $${cost}, `
    + 'as the footer of the page counts them.',
  // stderr: the mark on each line of the visual's own problem and fix, then how to draw it alone.
  mark: 'Graphs page:',
  again: (range) => `Graphs page: to draw it on its own, run sonah visual ${range}.`,
  // The dry run's line, when the review writes its HTML page. It reads no commit: whether the work is committed is
  // known only after the code review.
  dry: Object.freeze({
    on: 'Graphs page: on. After the review, Sonah would draw it with claude -p, from commits only.',
    off: 'Graphs page: off (--no-visual).',
    backend: 'Graphs page: off. Sonah draws it only on the claude-cli backend.',
    codeStep: 'Graphs page: off. Sonah finds where the session\'s commits start with the code review, which is off. '
      + RUN_LINE,
    noRepository: 'Graphs page: off. It draws the commits of a git repository, and Sonah found none that holds the '
      + 'session\'s folder.',
    unknown: 'Graphs page: off. It draws commits only, and Sonah could not tell where the session\'s commits start. '
      + RUN_LINE,
    limits: 'Graphs page: off, because its calls would not count in the limits that you set.',
  }),
});

/** The kind of each of this file's word tables, for the style linter (packages/render/test/style-lint.js). */
export const STYLE_KINDS = Object.freeze({ REVIEW_GRAPHS_WORDS: 'notice', 'REVIEW_GRAPHS_WORDS.page': 'label',
  'REVIEW_GRAPHS_WORDS.mark': 'label' });
/** The arguments each function of a word table is rendered with for the style linter. */
export const STYLE_FIXTURES = Object.freeze({ 'REVIEW_GRAPHS_WORDS.page': [['/tmp/you/.sonah/visual/widget-0a1b2c3d/'
  + '0123456789ab-fedcba987654-claude-sonnet-5-5/page.html']], 'REVIEW_GRAPHS_WORDS.usage': [[1, '0.02'], [4, '0.64']],
'REVIEW_GRAPHS_WORDS.again': [['0123456789ab..fedcba987654']] });
/** `claude -p` and the Claude plan are the names that the claude CLI and its plans use. */
export const STYLE_ALLOW = Object.freeze({ 'REVIEW_GRAPHS_WORDS.started': ['quoted-term'],
  'REVIEW_GRAPHS_WORDS.dry.on': ['quoted-term'] });

/** Whether the review runs under a limit of its calls or its size (review-budget.js `normalizeReviewBudget`). */
export const reviewLimited = (options) => ['maxCalls', 'maxInputBytes', 'stopAtUtilization']
  .some((field) => options?.[field] !== null && options?.[field] !== undefined);

/** Whether the code step's snapshot shows a git repository that holds the session's folder: its own fact
 *  (`repository`), or a git base (the snapshot's or the code step record's). Structure only. */
const inRepository = (snapshot, base) => snapshot?.root === true
  && (snapshot.repository === true || base?.kind === 'git');

/**
 * The range the graphs page draws for a review: `{ base, head }`, the start commit (the code review's base: the
 * session's start commit, or the `--code-base` merge-base) and HEAD (`readRepoFacts`'s `repo.start`, `repo.head`), when
 * both are known, differ, and each file of the change (`repoChangeFiles` of the code step's record) is at HEAD
 * (`repo.atHead`, `repo.goneAtHead` for a file it deleted, or `repo.cleanAtHead` for one whose bytes Sonah holds no
 * hash of, which git decides); else `{ skip }`, a code of REPORT_GRAPHS_WORDS: `unknown` (no start commit or no
 * HEAD), `noCommits` (HEAD is the start commit and each file of the change, if any, is at HEAD: nothing to draw, and no
 * range to name), `noChange` (no file of the change in the repository, or a code review that read none) or
 * `uncommitted` (a file of the change differs from HEAD), with `base` for the two that name `<start>..HEAD`. Structure
 * only: commits and paths.
 */
export function reviewGraphsRange({ repo, codePass }) {
  const start = HASH.test(repo?.start ?? '') ? repo.start : null;
  const head = HASH.test(repo?.head ?? '') ? repo.head : null;
  if (!start || !head) return { skip: 'unknown' };
  const paths = repoChangeFiles(codePass).map((f) => f.path);
  const listed = (field) => (Array.isArray(repo[field]) ? repo[field] : []);
  const there = new Set([...listed('atHead'), ...listed('goneAtHead'), ...listed('cleanAtHead')]);
  const committed = paths.every((path) => there.has(path));
  // HEAD is the start commit first: a session that left nothing to commit has no range to draw, ever.
  if (start === head) return committed ? { skip: 'noCommits' } : { skip: 'uncommitted', base: start };
  if (!paths.length) return { skip: 'noChange', base: start };
  if (!committed) return { skip: 'uncommitted', base: start };
  return { base: start, head };
}

/**
 * The dry run's line about the graphs page: whether a review that writes its HTML page would draw it. `codeStepOn` and
 * `snapshot` are the code step's (session-review-command.js): with the code step off there is no start commit, and
 * with no git repository or no start commit in its snapshot the review would not draw it either.
 */
export function reviewGraphsDryRunLine({ options, backend, codeStepOn = false, snapshot = null }) {
  const W = REVIEW_GRAPHS_WORDS.dry;
  if (options.noVisual) return W.off;
  if (backend !== 'claude-cli') return W.backend;
  if (codeStepOn !== true || !snapshot) return W.codeStep;
  if (!inRepository(snapshot, snapshot.base)) return W.noRepository;
  if (snapshot.base?.kind !== 'git' || !HASH.test(snapshot.base.commit ?? '')) return W.unknown;
  return reviewLimited(options) ? W.limits : W.on;
}

const STOPPED = Symbol('stopped');

/**
 * The visual's closed code that the review page's `failed` line says (render REPORT_GRAPHS_FAILURE_WORDS, its problem
 * and fix): the code itself when it is a key of VISUAL_FIX_WORDS, whose own fix `visualFixOf` prints, and the page has
 * words for it; else `other`, whose fix is VISUAL_FIX_DEFAULT's (a failed call, answers still needed, a throw, anything
 * else). Structure only.
 */
export const failureCodeOf = (code) => (typeof code === 'string' && Object.hasOwn(VISUAL_FIX_WORDS, code)
  && Object.hasOwn(REPORT_GRAPHS_FAILURE_WORDS, code) ? code : 'other');

/**
 * The review's graphs page: prints its lines and resolves the review page's fact of it, for `sessionPage`: `{ graphsPage
 * }` (the page's `file:` URL) when it is drawn, `{ graphsNotDrawn: { code, range?, failure? } }` (a code of
 * REPORT_GRAPHS_WORDS, the range its line names, and with `failed` the visual's closed code, `failureCodeOf`) when it is
 * not, or `{}` when there is nothing to say. `draw` is `drawVisualPage` (the entry's; a test passes another);
 * `snapshot` the code step's (null with the code step off; its `top`, the repository's top folder); `cwd` the folder
 * the review runs in, which a relative SONAH_HOME is read from; `env` the review's environment, which the visual reads
 * for Sonah's folder and its calls; `signal` stops the drawing (the review's Ctrl-C or SIGTERM): the graphs page alone
 * is abandoned, and `draw` is handed it so that no new call starts. Never rejects, and never decides the review's exit
 * code.
 */
export async function reviewGraphsPage({ options, backend, repo, codePass, snapshot, cwd = process.cwd(),
  env = process.env, stdout = process.stdout, stderr = process.stderr, draw, signal = null }) {
  const W = REVIEW_GRAPHS_WORDS;
  const say = (stream, text) => { try { stream.write(`${text}\n`); } catch { /* a stream that cannot be written to */ } };
  // Not drawn: the line that says why (on stdout), and the review page's fact of it.
  const skip = (code, range = null) => {
    const words = REPORT_GRAPHS_WORDS[code];
    say(stdout, typeof words === 'function' ? words(range) : words);
    return { graphsNotDrawn: { code, ...(range ? { range } : {}) } };
  };
  let range = null;
  // The visual's closed code, when it does not draw the page (`failureCodeOf`); `other` for a pending job or a throw.
  let failure = 'other';
  try {
    if (backend !== 'claude-cli') return skip('backend');
    if (!snapshot) return skip('codeStep');
    if (!inRepository(snapshot, codePass?.base)) return skip('noRepository');
    const found = reviewGraphsRange({ repo, codePass });
    if (found.skip === 'unknown' || found.skip === 'noCommits') return skip(found.skip);
    if (found.skip) return skip(found.skip, rangeText(found.base, 'HEAD'));
    range = rangeText(found.base, found.head);
    if (reviewLimited(options)) return skip('limits', range);
    // The repository's real top folder, as `sonah visual` names it (code-snapshot.js `gitTop`), so that its folder, and
    // the answers it keeps there, are the ones `sonah visual` with this range finds.
    const top = typeof snapshot.top === 'string' && isAbsolute(snapshot.top)
      ? await realpath(snapshot.top).catch(() => snapshot.top) : null;
    if (top === null) return skip('unknown');
    if (signal?.aborted) return skip('stopped', range);
    const model = VISUAL_DEFAULT_MODEL;
    // An absolute folder, whatever SONAH_HOME is: a relative one is read from the folder the review runs in.
    const outDir = resolve(cwd, visualOutDir({ top, base: found.base, head: found.head, model, env }));
    const drawing = Promise.resolve().then(() => draw({ top, base: found.base, head: found.head, model, outDir, env,
      onStart: () => say(stderr, W.started), ...(signal ? { signal } : {}) }));
    const stop = signal ? new Promise((done) => signal.addEventListener('abort', () => done(STOPPED), { once: true }))
      : null;
    const drawn = stop ? await Promise.race([drawing, stop]) : await drawing;
    if (drawn === STOPPED) {
      // The job is left to end on its own: the drawer starts no new call once the signal is aborted, and (D226) stops
      // the call still running, then releases its folder's lock.
      drawing.catch(() => {});
      return skip('stopped', range);
    }
    if (drawn?.status === 'complete') {
      // Drawn: never the failure branch. The page's absolute path, as the drawer gave it or where it writes it.
      const page = typeof drawn.page === 'string' && drawn.page !== '' ? resolve(cwd, drawn.page)
        : join(outDir, 'page.html');
      say(stdout, W.page(page));
      const totals = drawn.run?.totals;
      if (Number.isSafeInteger(totals?.calls) && totals.calls >= 0 && Number.isFinite(totals?.costUsd)
          && totals.costUsd >= 0) say(stdout, W.usage(totals.calls, totals.costUsd.toFixed(2)));
      return { graphsPage: pathToFileURL(page).href };
    }
    const code = typeof drawn?.code === 'string' ? drawn.code : 'visual_failed';
    if (drawn?.status !== 'pending') failure = failureCodeOf(code);
    failed(drawn?.status === 'pending' ? VISUAL_WORDS.pending(Number.isSafeInteger(drawn.needed) ? drawn.needed : 0,
      false) : VISUAL_WORDS.failed(code, visualFixOf(code)), code === 'no_change' ? null : range, stderr);
  } catch {
    failure = 'other';
    failed(VISUAL_WORDS.failed('visual_failed', visualFixOf('visual_failed')), range, stderr);
  }
  return range ? { graphsNotDrawn: { code: 'failed', range, failure } } : {};
}

/** The visual's own lines of a page it did not draw, each marked as the graphs page's, then how to draw it alone
 *  (none after no_change: that range would draw nothing again, and the visual's own fix names one that can). */
function failed(said, range, stderr) {
  const W = REVIEW_GRAPHS_WORDS;
  const lines = said.split('\n').map((line) => `${W.mark} ${line}`);
  if (range) lines.push(W.again(range));
  try { stderr.write(`${lines.join('\n')}\n`); } catch { /* a stream that cannot be written to: nothing more to say */ }
}
