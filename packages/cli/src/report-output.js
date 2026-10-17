// What the review prints after it writes the report (D97): the count line, the Must act labels, where
// the Markdown report for your pull request is, and the one `gh pr comment --body-file` command that posts it on the
// pull request of your current branch — which you run;
// Sonah posts nothing. Then, from the repository's facts (repo-links.js), what stands between the report and its code
// links: a commit that is not on GitHub yet, report files inside the repository, or work not committed yet.
//
// Fixed words and counts only, filled with the report model's own text (its counts and labels), the path you typed,
// and short commit ids. Pure: no disk, clock, network or model.
import { REPORT_COUNT_WORDS } from '../../render/report-words.js';
import { REPORT_MD_LIMITS } from '../../render/session-story.js';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** A byte count with a comma every three digits ("5,812"), the same on every computer (no locale). */
export const byteCount = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** The printed words, after the review. */
export const REPORT_OUTPUT_WORDS = Object.freeze({
  mdWritten: (path, bytes) => `Sonah wrote the report for your pull request: ${path} (${byteCount(bytes)} `
    + `${bytes === 1 ? 'byte' : 'bytes'}).`,
  ghLine: (path) => `To post it on the pull request of your current branch, run: gh pr comment --body-file ${path}`,
  tooLong: `The report is more than ${byteCount(REPORT_MD_LIMITS.maxBytes)} bytes, the limit that Sonah sets for a GitHub `
    + 'comment. Sonah prints no gh command for it.',
  // Pushing adds no link to this report: the next line says how to get a report with them. By the side whose links
  // are missing, each naming only those, as the report's header does: `new` HEAD, `old` the start commit, `both` one
  // commit that both sides need.
  // D100 (the audit of absence sentences): said as what git showed Sonah (its remote-tracking branches): git here may
  // not know a push made from elsewhere.
  notPushed: Object.freeze({
    new: (short, remote) => `Git does not show commit ${short} on ${remote}. This report has no links to the code as the `
      + 'agent left it.',
    old: (short, remote) => `Git does not show commit ${short} on ${remote}. This report has no links to the code as it `
      + 'was before the session.',
    both: (short, remote) => `Git does not show commit ${short} on ${remote}, so this report has no code links.`,
  }),
  rerun: 'To get code links, commit your work. Push the commit. Then run the same command with a new --output file. '
    + 'Sonah reuses its stored answers, and the report gets code links.',
  outputInRepository: 'Sonah wrote the report inside the repository. Move the report files out of it, or add them to '
    + '.gitignore, before you run Sonah again.',
});
/** How the style linter (packages/render/test/style-lint.js) reads the table: each entry is a notice. */
export const STYLE_KINDS = Object.freeze({ REPORT_OUTPUT_WORDS: 'notice' });
/** The arguments each function of the table is rendered with for the linter. */
export const STYLE_FIXTURES = Object.freeze({
  'REPORT_OUTPUT_WORDS.mdWritten': [['review.md', 5812], ['Kapi Labs/review.md', 1]],
  'REPORT_OUTPUT_WORDS.ghLine': [['review.md'], ["'Kapi Labs/review.md'"]],
  'REPORT_OUTPUT_WORDS.notPushed.new': [['1a2b3c4', 'origin']], 'REPORT_OUTPUT_WORDS.notPushed.old': [['1a2b3c4', 'origin']],
  'REPORT_OUTPUT_WORDS.notPushed.both': [['1a2b3c4', 'origin']],
});

/** The Markdown report's path beside an HTML page's: `X.html` (or `.htm`) becomes `X.md`; any other name gets `.md`. */
export const mdPathFor = (htmlPath) => (/\.html?$/i.test(htmlPath) ? htmlPath.replace(/\.html?$/i, '.md') : `${htmlPath}.md`);

/** A path as a POSIX shell reads it back unchanged: as it is when it holds only characters no shell treats specially,
 *  else in single quotes (a single quote inside closes, escapes and reopens them). */
export const shellQuote = (path) => (/^[A-Za-z0-9_./,:@%+=-]+$/.test(path) ? path
  : `'${String(path).replace(/'/g, "'\\''")}'`);

/** A text part of the report model as plain text: a verbatim quote in quotation marks, the cut outside them. */
const partsText = (parts) => (Array.isArray(parts) ? parts : []).map((p) => (p?.quote ? `“${p.text}”${p.cut ? '…' : ''}`
  : String(p?.text ?? ''))).join('');

/**
 * The terminal's count lines (D97): the tiers and your prompt's statuses (the D93 split: an ask with a code
 * finding counted apart), with no "(folded)"; then the Must act labels (the code review's or the fixed kind label), or,
 * when Must act and Must know are empty, the fixed pair that says this does not mean the work is correct.
 */
export function countLines(model) {
  const { countLine } = model;
  const lines = [`${countLine.tiers.map((t) => `${t.words} ${t.n}`).join(' · ')} · ${countLine.prompt}`];
  if (countLine.empty) lines.push(countLine.empty);
  else if (countLine.labels.length) lines.push(`${REPORT_COUNT_WORDS.mustActLead} ${countLine.labels
    .map((l) => partsText(l.parts)).join(' · ')}${countLine.more ? ` ${REPORT_COUNT_WORDS.more(countLine.more)}` : ''}`);
  return lines;
}

/**
 * The lines after the local page's (D97), given what the CLI wrote and read: `md` (`{ path, bytes }`: the
 * Markdown report as you named it, and its size), the repository's facts (`repo`, `github`: repo-links.js), the
 * change's files whose commit Sonah can tell (`files`: their paths, those in the repository with a hash, or deleted) and
 * whether a report file lies in the repository, not ignored (`inRepository`). The `gh` line names the path as you typed
 * it, quoted for the shell, and no pull request number: with none, `gh pr comment` posts to the pull request of the
 * current branch (`gh pr comment --help`), so the line runs as printed. A report over the
 * Markdown report's bound (`REPORT_MD_LIMITS.maxBytes`: only when the parts it never shortens are longer) gets no `gh`
 * line, as GitHub may refuse it, and a line that says so. The line on how to get code links is printed only with a
 * GitHub remote, when a file differs from the last commit or a commit is not pushed.
 */
export function reportOutputLines({ md = null, repo = null, github = null, files = [], inRepository = false } = {}) {
  const lines = [];
  if (md) {
    lines.push(REPORT_OUTPUT_WORDS.mdWritten(md.path, md.bytes));
    lines.push(md.bytes > REPORT_MD_LIMITS.maxBytes ? REPORT_OUTPUT_WORDS.tooLong
      : REPORT_OUTPUT_WORDS.ghLine(shellQuote(md.path)));
  }
  if (inRepository) lines.push(REPORT_OUTPUT_WORDS.outputInRepository);
  if (!github || typeof github !== 'object') return lines;
  const short = (sha) => String(sha).slice(0, 7);
  const head = github.pushed === false && repo?.head ? repo.head : null;
  const start = github.startPushed === false && repo?.start ? repo.start : null;
  if (head && head === start) lines.push(REPORT_OUTPUT_WORDS.notPushed.both(short(head), github.remote));
  else {
    if (head) lines.push(REPORT_OUTPUT_WORDS.notPushed.new(short(head), github.remote));
    if (start) lines.push(REPORT_OUTPUT_WORDS.notPushed.old(short(start), github.remote));
  }
  const committed = new Set([...(repo?.atHead ?? []), ...(repo?.goneAtHead ?? [])]);
  const uncommitted = !repo?.head || files.some((path) => !committed.has(path));
  if (uncommitted || github.pushed === false || github.startPushed === false) lines.push(REPORT_OUTPUT_WORDS.rerun);
  return lines;
}
