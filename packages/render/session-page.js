// Session page (D97). ONE recorded session's review as a self-contained HTML page: the report model
// (report-model.js `reportModel`) rendered for a browser, in its order — the header and the count line, Must act, Must
// know, Good to know (folded), the agent's decisions in the session order (D161: the report's second part, one fold a
// group), your prompt with each ask marked (D131: after Must act and Must know, folded on a long session), what the agent
// did (folded), what Sonah could not check (folded) and the footer. The Markdown report renders the same model, so both say the same things, in the same
// order, with the same counts. Styled as sonah.dev's "What a Sonah review looks like" card (light from the site's
// tokens, a derived warm dark, the reader's own setting unless asked).
//
// Pure and deterministic: no clock, no random source, no network, no model, no filesystem, no locale. Same inputs,
// same bytes out. What the human answered earlier (`options.decisionReviews`), the session's hash
// (`options.sessionHash`) and the repository's facts (`options.repo`, `options.github`) are inputs like the report.
//
// The rules that carry the weight:
//   1. A quote is shown only when the report model found it again, literally, in the session this page is given. Every
//      shown quote, and nothing else, is a `<q class="said">`; a cut the page makes is outside the quotation marks. The
//      session review's and the code review's own words are set in `<em>`, each with a class by source
//      (`by-session-review`, `by-code-review`), and the footer's legend says whose words each is.
//   2. Nothing is upgraded: an ask's status is the session review's token (D93), shown as a word, never as a colour that
//      means safe; a conflict gets a fact line, never a ruling. No verdict anywhere (D71): when Must act and Must know are
//      empty, a fixed sentence says that this does not mean the work is correct.
//   3. Safe and self-contained: one escape (`escapeHtml`) for every recorded, review-authored or human-answered string,
//      a CSP that allows the inline style and, only on a page with a prompt's copy button or an in-page link, one script
//      pinned by its sha256 (`PAGE_SCRIPT`, D199, D203): no other script, no external resource. The only links out are GitHub commit
//      permalinks the report model built from validated local git facts (D97 amends this rule) and, since D219, one
//      link to a local file: the graphs page of the session's commits that the CLI drew before this page, a `file:` URL
//      that the report model validated (`graphsPageOf`); every other link is an in-page anchor. The page is bounded
//      (`PAGE_LIMITS`): only the visible lines of the items and the open start of each message that holds an ask are
//      never cut. Every cut is stated where it happens.
//   4. Fold, never drop: every row of the review is placed once (report-model.js `reportPlacement`); a fold's summary
//      carries its count.

import { createHash } from 'node:crypto';
import { visible, backtickPieces, noFilesWords } from './session-story.js';
import { CODE_REPORT_WORDS } from '../evidence/src/code-report.js';
import { reportModel, REPORT_MODEL_VERSION, REPORT_LIMITS, askStatusWord, promptAfterTiers,
  agentPromptText, reportItems, listedThereParts, headParts, kindLineParts } from './report-model.js';
import { REPORT_TIER_WORDS, REPORT_TYPE_WORDS, REPORT_HEADER_WORDS, REPORT_COUNT_WORDS, REPORT_SECTION_WORDS,
  REPORT_ITEM_WORDS, REPORT_PROMPT_WORDS, REPORT_DID_WORDS, REPORT_NOT_CHECKED_WORDS, REPORT_TRIM_WORDS,
  REPORT_FOOTER_WORDS, REPORT_CAUSE_WORDS, REPORT_GAP_WORDS, REPORT_COLUMN_REASON_WORDS, REPORT_ANSWER_WORDS,
  REPORT_AGENT_PROMPT_WORDS, REPORT_TRAIL_WORDS, REPORT_TAB_WORDS, REPORT_ROW_TAGS, REPORT_PROMPT_PARTS, REPORT_ASK_TAGS,
  REPORT_DECISION_TAGS, REPORT_RUN_CHIPS, API_KEY_VARIABLE }
  from './report-words.js';

/** The page's layout version, in its generator meta. /37 (D97, owner decisions 2026-10-16): the page
 *  renders the report model — the header (its size line, the runs after the last edit, what Sonah did not check), the
 *  count line, your prompt with each ask's words marked by its status, then the items in three tiers (Must act, Must
 *  know, Good to know folded), what the agent did and what Sonah could not check, folded. It replaces the checklist
 *  order of D71 (S4) and D88's attention summary; the steps card, the decision cards' step folds and the old parts are
 *  removed. Its only links out are GitHub permalinks built from validated local git facts. (/36 and every version
 *  before it: the checklist page, `git log` of this file.) /38 (D98, one reading per recorder fact): what the agent
 *  did and what Sonah could not check read one effect rule (evidence session.js `effectOf`), so a write refused before
 *  it ran is no change, no unknown write and no unrecorded body. /39 (D99, F1 guard): a background run's end is said to
 *  be absent only where the slicer proved it; one Sonah could not read says so, under what Sonah could not check, and
 *  is never counted as a failure; a run stopped or cancelled before it finished is said as stopped in the header and in
 *  its failure's what line, never as having no recorded end. /40 (D100, the audit of absence sentences): a sentence
 *  says an absence only where code proves it (packages/render/test/absence-audit.js); elsewhere it says what Sonah
 *  found, holds or could not read, and a run Sonah read no result of is counted apart, never as having no recorded end.
 *  /41 (D101, owner decision 2026-10-17): an ask that Sonah did not check because a test refused its quote says which
 *  test, with the numbers code measured ("quoted 147 characters, more than the 120 that Sonah checks"), never that the
 *  quote is in the recording; "did not find the quote, word for word" only where the search ran and failed, only of the
 *  place cited and of what that answer was shown there. /42 (D104, F5 part 4): a claim, a run and a decision you
 *  settled show their rows' shown-in-part mark under its label, as an item's evidence and an ask's lines show it; and the
 *  page never links to a place it does not hold (`heldLinks`): a link to a run, a claim or an item that a trim or a
 *  list's bound left out keeps its words, unlinked. /43 (D105, F2 part A): what the code review saw of each file short
 *  of whole (in part, with its lines; only where the change touched it; a rule or skill file in part or not at all), a
 *  review request too large to send said so and never as a call that did not answer, and the commands left out of it
 *  for room, as the report model gives them. And in the same move (D107, F3a): a finding or question of the code review
 *  that Sonah withheld says whether an item of the repair matched it (by identity, never by its place), saying only
 *  what code compared: none matched, one matched but went to another item or past its list's limit, it names no lines
 *  or words to match, or it came in the repair. An earlier report's words stay. And (D110, the premise contract): a
 *  code finding shows as confirmed only when code's label confirms it, with each premise beside where its evidence is;
 *  a finding Sonah could not confirm is an item to verify, with each premise that Sonah could not check on a visible line
 *  (`restsOutside`); and no sentence says that a second reviewer checked a finding. And (D111, F3b, the accounting):
 *  What Sonah could not check counts, by kind, the items of the session review that the code review's item-by-item
 *  check (the accounting) did not examine in a way that Sonah could use, as the report model gives them; never the ones it examined;
 *  and the code review's coverage line by its own coverage (D111's second review), as the report model gives it. And (E1-F8, D112: one
 *  point, one item): an item shows its members after its own lines — the line that counts them, then each member's type
 *  word, what it is, its own tier word and its lines, folded when the report model folds it — and the items of a section
 *  come in the report model's order (by final level, then kind). /44 (D113, 0.3.0-beta.5; /43 shipped in 0.3.0-beta.4):
 *  What Sonah could not check says, as the report model gives it, that the change holds only the files that the
 *  session's recorded writes could have changed, names the files that changed outside those writes, and says a change
 *  with no file to review by the session's own writes. In the same move (D115, the owner: "for the hn5, start work
 *  now"): the session review's rows in words no wider than the field each rests on (an ask tied only to the agent's
 *  words, the end-of-recording fact, an ask of a helper's brief named so, never one Sonah could not read), and
 *  (D116) a question's pointer to an item or an ask only where code checked its tie, as the report model gives them.
 *  And (D125, the owner: "Let's fix 1st"; amended the same day, "go for option 3"): an ask that the session review left
 *  not checked and that the code review found to hold in the code keeps "Not checked", with the note the report model
 *  gives its row; the mark's word by the model's one map (`askStatusWord`). /45 (0.3.0-beta.6, one move from
 *  0.3.0-beta.5's /44). D126 and D127: beside the title, the recordings Sonah read a session that opens on a compaction
 *  from, or the part it did not read; and among your messages, each compaction of the agent's context at its place, as
 *  the report model gives them (a session with neither renders there as /44, byte for byte). D129 (C7): the footer says
 *  what the review cost, from its run record, after the line that names Sonah. D131 (R1, B12; the owner: "Must
 *  act comes first"), in the same move: Must act and Must know come before your prompt, and a long session's prompt
 *  (more than 30 asks) is a closed fold after them, its count in its summary. D133 (R2): the lines about what Sonah could
 *  not check are folded, each word for word (the fold What Sonah could not check, an ask's row fold, an item's evidence
 *  fold), and "Sonah checked only the marked parts of your message." is said once, in the legend. /46 (0.3.0-beta.7,
 *  one move from 0.3.0-beta.6's /45). D144 (the owner, 2026-10-23): under each item that leads in
 *  Must act and has a prompt, after its visible lines, a fold "Prompt for the agent" holds it, as plain
 *  text in a `<pre>` that one click selects whole (CSS, no script), left out with the evidence when the page is
 *  shortened; a page with no such prompt differs from /45 only by the versions it names and the fold's three style
 *  rules, which every page carries. D161 (the owner, 2026-10-27; 0.3.0-beta.9's content moves ride the report model's one
 *  move, D152's /8, as D153's did):
 *  the page has two parts. First what to act on: Must act, Must know, Good to know (folded); then the agent's decisions
 *  (`#decisions`), in the order the session recorded them, one fold a group by the message of yours they follow (open
 *  when it holds an item tagged Must act or Must know), one folded line a decision with its tier as a tag; then your
 *  prompt and the rest. The count line counts the decisions after the tiers. D163 (the owner, 2026-10-28; it rides
 *  the same move): Must act and Must know end with their pointers to the decisions tagged with them (`pointersHtml`),
 *  Must act's heading counting its own; a decision that the first part keeps has its line at its place in the second
 *  (`trailAboveHtml`); an open group folds its decisions tagged Good to know under one counted line after its Must ones
 *  (`trail-more`); a change of approach's reading of why is a line of its own (`review-why`). Three style rules more,
 *  which every page carries. D171 (the owner, 2026-10-28; no move of this reader, as D169's): after the line that names
 *  Sonah, the footer says that a newer Sonah is out when the report model has it (`footer.newer`); a page made with no
 *  such fact is as before, byte for byte. /47 (0.3.0-beta.11, one move from 0.3.0-beta.10's /46). D193 (the owner,
 *  2026-10-30: the page "felt too confusing" in a demo, "not able to read the entire thing in under 5 mins"; "You can
 *  use a tabs as well"), D194 to D202: as at the merge into 0.3.0-beta.11, under the header (its counts as tiles, your
 *  asks as a bar) a tab a part of the review (`tabsHtml`): the findings (Must act, Must know, Good to know), the agent's
 *  decisions, your asks, what the agent did and what Sonah could not check, each a panel. The tabs are radio inputs and
 *  their labels (D196): the stylesheet shows the panel of the checked radio, with no script; a link into another panel
 *  is that panel's label (`tabLinks`), which opens its tab at its top, and (D203) the page's one script then takes it
 *  to its place; print shows every panel in order. Items and
 *  decisions are rows (D198), asks a checklist, each tab opens on its counts (D199), short tags with their sentences as
 *  tips (D200), and a Verify item names the run its result came from (D201). D202: an ask's row folds its evidence (what
 *  does a done ask, how the session review read it, the agent's message before yours), a long prompt folds its other
 *  done asks, a decision lists its recorded actions, a tag's sentence is in its opened row, the code review's lines carry
 *  "Form, not meaning", the legend explains the tags, the bar follows its words, and the tabs wrap on a phone. D204: past
 *  its bound the page cuts your longest message first, the runs other parts name fold, the script adds Back and opens a
 *  page at its `#id`, the copy buttons do not print, and a phone's header holds four tiles to a row. The page's
 *  one script is the prompt box's
 *  copy button and the in-page links (`PAGE_SCRIPT`, pinned by its hash in the policy, D199, D203). The legend is a fold in the footer
 *  (`REPORT_TAB_WORDS.legend`). The stylesheet: flat surfaces and hairlines with no shadow, one accent (Must act's rule,
 *  the focus ring, the quotes' marks), labels in sentence case, the system's fonts, one type scale. /48 (D207): the
 *  file rows and base line the model's /11 moves. D208 rides it: no colour behind quoted words or a marked ask, only
 *  coloured marks and the rule under the ask. /49 (D210): the first screen's reason the model's /12 adds, a code review
 *  that waits for the run that can finish the session review; no other byte moves but the version. D219 (the owner,
 *  2026-11-09; no move of this reader, as D171's): the header's line that links to the graphs page of the session's
 *  commits, when the CLI drew it, or that says why the CLI did not draw it (`header.graphs`), unweighed against the
 *  page's bound; a page made with no such fact is as before, byte for byte. */
export const PAGE_VERSION = 'sonah.session-page/49';

/** The page's colour themes. `system` (the default) follows the reader's setting; `light` and `dark` fix the theme. */
export const PAGE_THEMES = Object.freeze(['system', 'light', 'dark']);
const [SYSTEM] = PAGE_THEMES;

/** The page's bounds. `maxBytes` is the bound on the whole page: past it a long message keeps only its start (its whole
 *  text is not folded below it, and a message that holds no ask shows its start), then the evidence folds of Good to know
 *  keep their summary only, then those of Must know and Must act, then the lists of what the agent did and the messages
 *  that hold no ask are halved until empty, then the lists of what Sonah could not check — each said where it happens
 *  (D97). D202: your asks' evidence folds go with the decisions' detail folds. Only the visible lines of the items and
 *  the open start of each message that holds an ask are never cut. The
 *  footer's line that a newer Sonah is out (D171) and the header's line about the graphs page of the session's commits
 *  (D219: its link, or why it was not drawn) are not weighed against `maxBytes`: the page leaves out what it would
 *  without them, so `whole`, and the .md made with it, do not move. The report model's display bounds
 *  are `REPORT_LIMITS`. */
export const PAGE_LIMITS = Object.freeze({ maxBytes: 600_000, quoteChars: REPORT_LIMITS.quoteChars,
  messageChars: REPORT_LIMITS.messageChars });

/** The page's words that the report model does not carry: the coverage causes, the gaps by message, why Sonah could not
 *  check whether you asked, and your earlier answer (report-words.js, one table for every reader). */
export const PAGE_CAUSE_WORDS = REPORT_CAUSE_WORDS;
export const PAGE_GAP_WORDS = REPORT_GAP_WORDS;
export const PAGE_COLUMN_REASON_WORDS = REPORT_COLUMN_REASON_WORDS;
export const PAGE_ANSWER_WORDS = REPORT_ANSWER_WORDS;

// ---- text safety ------------------------------------------------------------------------------------------

/** The one escape: bidi and invisible characters shown as their code point, controls replaced, then the five
 *  characters HTML reads as markup. Every recorded or review-authored string goes through it. */
export function escapeHtml(text) {
  return visible(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
const esc = escapeHtml;
/** Where a sentence of Sonah's names a recorded path: a character no word table holds. */
const SLOT = '\uE000';
/** A recorded or review-written text, escaped, each balanced single-backtick span a `<code>` element (session-story.js
 *  `backtickPieces`), as the Markdown report shows it as a code span. */
const codeHtml = (text) => backtickPieces(text).map((p) => (p.code ? `<code>${esc(p.text)}</code>` : esc(p.text))).join('');
/** D190 (its close check): Sonah's own words, escaped, the variable they name (`API_KEY_VARIABLE`) a `<code>` element, as
 *  the Markdown report shows it as a code span. */
const escOwnCode = (text) => esc(String(text).split(API_KEY_VARIABLE).join(SLOT)).split(SLOT)
  .join(`<code>${esc(API_KEY_VARIABLE)}</code>`);
const list = (value) => (Array.isArray(value) ? value : []);
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const bytes = (text) => Buffer.byteLength(text, 'utf8');
const ANCHOR = /^(?:ask|item|run|claim|not-checked|did|prompt)(?:-[A-Za-z0-9]+)?$/;
const GITHUB_URL = /^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/blob\/(?:[0-9a-f]{40}|[0-9a-f]{64})\/[^\s"'<>]*$/;
const SHORT_ID = 12;
const shortId = (id) => (typeof id === 'string' && id.startsWith('sha256:') ? id.slice(7, 7 + SHORT_ID) : String(id ?? ''));

/** One text part of the report model, as markup: a verbatim quote in coloured quotation marks (the cut outside them),
 *  code, a reviewer's words in `<em>` with its source's class, an in-page link, or Sonah's own words. */
function partHtml(p) {
  if (!plain(p)) return '';
  let inner = p.code ? `<code>${esc(p.text)}</code>` : p.quote || p.by !== 'sonah' ? codeHtml(p.text) : esc(p.text);
  if (p.quote) return `<q class="said">${inner}</q>${p.cut ? '…' : ''}`;
  if (p.by === 'code-review') inner = `<em class="by-code-review">${inner}</em>`;
  else if (p.by === 'session-review') inner = `<em class="by-session-review">${inner}</em>`;
  if (typeof p.href === 'string' && ANCHOR.test(p.href)) return `<a href="#${p.href}">${inner}</a>`;
  return inner;
}
const partsHtml = (parts) => list(parts).map(partHtml).join('');
/** D195: an item's type word as a pill, its class by type (a reader scans the colour; the word says it). The page drops
 *  the colon the .md writes after it: the pill's edge separates it from what follows. */
const typeHtml = (type) => `<strong class="type ty-${esc(type)}">${esc(REPORT_TYPE_WORDS[type])}</strong>`;
/** D197: a file's added and removed lines (the model's `+a −r`), each in its own span, coloured as a diff colours them. */
const countsHtml = (counts) => esc(counts).replace(/(^|\s)(\+\S+)/g, '$1<span class="plus">$2</span>')
  .replace(/(^|\s)(\u2212\S+)/g, '$1<span class="minus">$2</span>');
/** D197: a claim's status mark, by its key in the closed table (`REPORT_DID_WORDS.claimStatus`): named by its look, so
 *  the stylesheet holds no status word. */
const CLAIM_LOOK = Object.freeze({ contradicted: 'red', contradictedByCode: 'red', notChecked: 'dash', incomplete: 'dash',
  notCheckedLater: 'dash', laterWork: 'amber' });
const claimLook = (key) => CLAIM_LOOK[key] ?? 'plain';
const claimKey = (word) => claimLook(Object.keys(REPORT_DID_WORDS.claimStatus)
  .find((k) => REPORT_DID_WORDS.claimStatus[k] === word));
/** D199: an item's marker as a short tag (`REPORT_ROW_TAGS`), the fact `scopeMarker` says in a sentence: you did not
 *  ask for it, or it is about code outside the evaluated session; else nothing. */
const scopeTagHtml = (scope) => {
  const word = scope?.notAsked ? REPORT_ROW_TAGS.notAsked : !scope?.askedUnknown && scope?.outsideSession
    ? REPORT_ROW_TAGS.outsideSession : null;
  return word ? ` <span class="scope">${esc(word)}</span>` : '';
};
/** D199 (the owner, 2026-10-30: the tabs "like a dashboard"): a stat, its number large over its words, a tile of a tab's
 *  row of stats; and that row. The words are a closed table's; the number is the model's count. */
const statHtml = (n, words, cls = '') => `<span class="stat${cls ? ` ${cls}` : ''}"><span class="num">${n}</span> `
  + `<span class="k">${esc(words)}</span></span>`;
const statsHtml = (stats) => (stats.length ? `<div class="stats">${stats.join('')}</div>` : '');
/** D199: a file's type as a pill, its class by its key in the closed table (`REPORT_DID_WORDS.fileTypes`). */
const fileTypeHtml = (word) => {
  const key = Object.keys(REPORT_DID_WORDS.fileTypes).find((k) => REPORT_DID_WORDS.fileTypes[k] === word) ?? 'other';
  return `<span class="ft ft-${esc(key)}">${esc(word)}</span>`;
};
/** D195: a tier as a tag, its class by tier. */
const tierTagHtml = (tier) => `<span class="tag tier-tag tier-${esc(tier.replace(/_/g, '-'))}">${esc(REPORT_TIER_WORDS[tier])}</span>`;
/** D195: an item's visible line as a key and its value, each a cell of its own, so the keys make a column a reader
 *  scans. The text is `labelled`'s. */
const keyed = (label, html, cls) => `<p class="${cls} kv"><span class="label">${esc(label)}</span> <span class="v">${html}</span></p>`;
const labelled = (label, html, cls = 'line') => `<p class="${cls}">${label ? `<span class="label">${esc(label)}</span> ` : ''}${html}</p>`;
/** A GitHub permalink, only when it has the form the report model builds. */
const gitHubLink = (url) => (typeof url === 'string' && GITHUB_URL.test(url)
  ? ` <a class="gh" href="${esc(url)}" rel="noreferrer noopener">${esc(REPORT_ITEM_WORDS.onGitHub)}</a>` : '');
const placeText = (w) => `${w.path}${Number.isSafeInteger(w.startLine) ? `:${w.startLine}${Number.isSafeInteger(w.endLine)
  && w.endLine > w.startLine ? `-${w.endLine}` : ''}` : ''}`;

// ---- the header and the count line --------------------------------------------------------------------------------

/** D195: your asks as one bar, a segment a status, each as wide as its count: what the count line's words say, drawn;
 *  hidden from a screen reader, which reads those words. D202 (the follow-up review: the bar drew its parts in another
 *  order than its words): in the words' order (the model's `counts`). `BAR_ORDER` orders the prompt's stats and rows. */
const BAR_ORDER = Object.freeze(['notDone', 'partly', 'doneCode', 'notCheckedCode', 'notChecked', 'notCheckedLater',
  'notCheckedOpenTurn', 'laterWork', 'done']);
function asksBar(asks, counts) {
  const n = (state) => asks.filter((a) => a.state === state).length;
  const order = Object.keys(plain(counts) ? counts : {});
  const segs = [...order, ...new Set(asks.map((a) => a.state).filter((x) => !order.includes(x)))]
    .filter((state) => n(state) > 0);
  return segs.length ? `<span class="bar" aria-hidden="true">${segs.map((state) => `<i class="s-${state}" `
    + `style="flex:${n(state)}"></i>`).join('')}</span>` : '';
}
/** D193: the count line's separator, a span of its own so that the stylesheet can show each part as a chip. Its text
 *  is the count line's, so the page's text is the .md's. */
const SEP = '<span class="sep"> · </span>';
/** D219: the header's line about the graphs page of the session's commits (`header.graphs`, report-model.js): the link
 *  to the page the CLI drew (`graphsPageOf`; the page's one link to a file of this computer), or the fixed line that
 *  says why the CLI did not draw it (`graphsNotDrawnOf`), where the link would be; nothing with neither. As D171's
 *  footer line, its bytes are not weighed against `maxBytes` (`sessionPage`). */
const graphsHtml = (header) => (!header.graphs ? '' : typeof header.graphs.href === 'string'
  ? `<p class="meta graphs"><a href="${esc(header.graphs.href)}" rel="noreferrer noopener">${esc(header.graphs.words)}`
    + '</a></p>'
  : `<p class="meta graphs">${esc(header.graphs.words)}</p>`);

function headerHtml(model) {
  const { header, countLine } = model;
  const out = [];
  // Your words, each recorded span a quote of its own; a join and the cut are outside the quotation marks.
  if (header.title) out.push(`<p class="title-words">${partsHtml(header.title.parts)}</p>`);
  // D126 (N0) and D127 (B10d): a session that opens on a compaction says so beside the title.
  if (header.continued) out.push(`<p class="meta continued">${esc(header.continued)}</p>`);
  // D118 (a): no code reviewed, first after your words (the first screen); the folder last, as code.
  if (header.noCode) out.push(`<p class="meta no-code">${[esc(header.noCode.words),
    ...(header.noCode.impact ? [esc(header.noCode.impact)] : []),
    ...(header.noCode.folder ? [esc(CODE_REPORT_WORDS.notReviewedFolder(SLOT)).split(SLOT)
      .join(`<code>${esc(header.noCode.folder)}</code>`)] : [])].join(' ')}</p>`);
  if (header.noLinks.length) out.push(`<p class="meta no-links">${header.noLinks.map(esc).join(' ')}</p>`);
  if (header.runs.length) out.push(`<p class="meta runs">${header.runs.map(esc).join(' ')}</p>`);
  // D219: the graphs page of the session's commits that the CLI drew before this page, or why it did not draw it
  // (`header.graphs`, `graphsHtml`). A page made with no such fact is as before.
  if (header.graphs) out.push(graphsHtml(header));
  const notChecked = [...header.reviewIncomplete.map(escOwnCode)];
  if (header.didNotCheck) notChecked.push(`${esc(header.didNotCheck.lead)} ${header.didNotCheck.phrases.map(esc).join(' · ')}`
    + `${header.didNotCheck.more ? ` <a href="#not-checked">${esc(header.didNotCheck.more)}</a>` : ''}`);
  if (notChecked.length) out.push(`<p class="meta not-checked">${notChecked.join(' ')}</p>`);
  // D195: each tier a tile, its count large: the words are the count line's (`REPORT_COUNT_WORDS.tier`), in its order.
  // D200: Must know's tile says, under its number, the agent's decisions tagged Must know, which it does not count (D161).
  const alsoKnow = list(model.pointers?.must_know).length;
  // D202: a tile at 0 takes no tier colour (its second review: unless it counts Must know's decisions under it).
  const tiers = countLine.tiers.map((t) => `<a href="#${t.tier.replace(/_/g, '-')}" class="tile ${t.tier.replace(/_/g, '-')}`
    + `${t.n === 0 && !(t.tier === 'must_know' && alsoKnow) ? ' zero' : ''}">`
    + `<span class="k">${esc(t.words)}</span> <span class="num">${t.n}</span>${t.tier === 'must_know' && alsoKnow
      ? ` <span class="sub">${esc(REPORT_COUNT_WORDS.andDecisions(alsoKnow))}</span>` : ''}`
    + '</a>').join(SEP);
  // D161: the agent's decisions, counted after the tiers.
  // D199: a tile as the tiers', its number and its tab's word; the count line's words in its title.
  const decisions = countLine.decisions ? `${SEP}<a href="#decisions" class="tile" title="${esc(countLine.decisions.words)}">`
    + `<span class="k">${esc(REPORT_TAB_WORDS.decisions)}</span> <span class="num">${countLine.decisions.n}</span></a>` : '';
  out.push(`<p class="count">${tiers}${decisions}${SEP}<a href="#prompt" class="asks">${esc(countLine.prompt)}`
    + `${asksBar(model.prompt.asks, model.prompt.counts)}</a></p>`);
  // D113 amended: how many items are about code outside the evaluated session.
  if (countLine.outside) out.push(`<p class="count-outside">${esc(countLine.outside)}</p>`);
  // D153: what the after-point re-check took out of Must act, by mechanism (only a report it ran on).
  if (countLine.recheck) out.push(`<p class="count-recheck">${esc(countLine.recheck)}</p>`);
  if (countLine.empty) out.push(`<p class="count-empty">${esc(countLine.empty)}</p>`);
  else if (countLine.labels.length) out.push(`<p class="count-labels">${esc(REPORT_COUNT_WORDS.mustActLead)} `
    + `${countLine.labels.map((l) => `<a href="#item-${l.n}">${partsHtml(l.parts)}</a>`).join(' · ')}`
    + `${countLine.more ? ` ${esc(REPORT_COUNT_WORDS.more(countLine.more))}` : ''}</p>`);
  return out.join('');
}

// ---- your prompt ----------------------------------------------------------------------------------------------------

/** One message's segments, its asks marked; the first `room` characters, or all of them. Each ask's id is given once on
 *  the page (`ids`). */
function segmentsHtml(segments, room, ids) {
  const out = [];
  let left = room;
  const total = segments.reduce((n, seg) => n + [...seg.text].length, 0);
  for (const seg of segments) {
    if (left <= 0) break;
    const points = [...seg.text];
    if (seg.join && points.length > left) break;
    const text = points.slice(0, left).join('');
    left -= points.length;
    if (seg.join) { out.push(`<span class="join">${esc(text)}</span>`); continue; }
    if (!seg.ask) { out.push(seg.sonah ? `<span class="note">${esc(text)}</span>` : codeHtml(text)); continue; }
    const id = seg.first && !ids.has(seg.ask) ? (ids.add(seg.ask), ` id="ask-${seg.ask}"`) : '';
    // The status word of the ask's state, by the report model's one map (`askStatusWord`).
    const status = askStatusWord(seg.state);
    // D195: the status word a `<small>`, styled as a tag: one per ask, so a long prompt keeps its room.
    out.push(`<mark class="ask s-${esc(seg.state)}"${id}>${seg.first ? `<small>${esc(status)}</small>` : ''}`
      + `${codeHtml(text)}</mark>`);
  }
  return { html: out.join(''), cut: total > room };
}

/** Your prompt. Past the page's size (`trim.messages`), a long message keeps only its start: its whole text is not
 *  folded below it, and a message that holds no ask shows its start. The messages that hold no ask are a list, cut by
 *  `trim.did` like the lists of what the agent did. Each trim is said once, where it happens. */
/** D200: a tag's sentence, in the page as a tip a pointer or focus shows, that a screen reader reads and print shows. */
const tipHtml = (words) => (words ? ` <span class="tip">${esc(words)}</span>` : '');
/** D202 (the owner, 2026-10-31: "Form, not meaning"): the tag on the code review's impact and action lines, focusable
 *  in an item's body; in a row's summary, where a focus stop would sit inside the fold's own, a plain flag. */
const FORM_TAG = `<span class="why soft" tabindex="0">${esc(REPORT_ITEM_WORDS.formTag)}${tipHtml(REPORT_ITEM_WORDS.formWhy)}</span>`;
const FORM_FLAG = `<span class="flag soft">${esc(REPORT_ITEM_WORDS.formTag)}${tipHtml(REPORT_ITEM_WORDS.formWhy)}</span>`;
/** D200: an ask's tag (REPORT_ASK_TAGS), focusable so a keyboard shows its sentence; the agent's word only, muted. */
const askTagHtml = (t) => `<span class="why${t.key === 'agentOnly' ? ' soft' : ''}" tabindex="0">`
  + `${esc(REPORT_ASK_TAGS[t.key])}${tipHtml(t.words)}</span>`;
function promptHtml(model, trim) {
  const { prompt } = model;
  // D198: a session of at most 30 asks (`prompt.folded` false) shows every ask as a checklist row, first; the rows hold
  // the asks' anchors, and your messages, each ask marked, fold below them. D200 (on real sessions a long prompt was a
  // wall of 60 "Done" marks around the 14 asks to look at): a longer session's checklist holds the asks that are not
  // done, carry a tag (REPORT_ASK_TAGS) or a line, and any its marks do not show; the other asks keep their marks' anchors.
  const big = prompt.folded === true;
  // D200: a long prompt's rows by status in the stats' order (the asks not done first), then by number. Its done asks
  // whose only tag is the agent's word, with no line, fold under one summary (`soft`). Cut to fit, the soft rows go first
  // (by `trim.did`), the others last (by `trim.notChecked`); an ask with no row keeps its mark's anchor.
  const rank = (a) => (big ? BAR_ORDER.indexOf(a.state) : 0);
  const sorted = [...prompt.asks].sort((a, b) => rank(a) - rank(b) || a.n - b.n);
  const isSoft = (a) => big && a.state === 'done' && !a.lines.length && list(a.tags).length > 0
    && list(a.tags).every((t) => t.key === 'agentOnly');
  // D202 (the owner, 2026-10-31: "Done asks: what does it"): a long prompt's other done asks with no tag or line fold
  // under one summary of their own, each a row whose evidence says what does it.
  const isOtherDone = (a) => big && a.state === 'done' && !a.lines.length && !list(a.tags).length;
  const wanted = sorted.filter((a) => !isSoft(a) && !isOtherDone(a));
  const softAll = sorted.filter(isSoft);
  const otherAll = sorted.filter(isOtherDone);
  const openShown = big ? wanted.slice(0, cap(wanted.length, trim.notChecked)) : wanted;
  const softShown = softAll.slice(0, cap(softAll.length, trim.did));
  const otherShown = otherAll.slice(0, cap(otherAll.length, trim.did));
  const ids = new Set([...openShown, ...softShown, ...otherShown].map((a) => a.n));
  const asks = new Map(prompt.asks.map((a) => [a.n, a]));
  const messagesCut = new Set();
  const blocks = prompt.messages.map((m) => {
    const start = m.cutAt === null ? segmentsHtml(m.segments, Infinity, ids) : segmentsHtml(m.segments, m.cutAt, ids);
    // D204 (the owner, 2026-10-31: "Cut longest first"): only the messages the size trim names (`trim.messages`) lose
    // their whole text.
    const cutHere = m.cutAt !== null && trim.messages.has(m.k);
    if (cutHere) messagesCut.add(m.k);
    const whole = m.cutAt === null || cutHere ? '' : `<details class="whole"><summary>`
      + `${esc(REPORT_SECTION_WORDS.wholeMessage)}</summary><p class="message">${segmentsHtml(m.segments, Infinity, ids).html}`
      + '</p></details>';
    const extras = [m.attached ? REPORT_PROMPT_WORDS.attached(m.attached) : null, m.pasted].filter(Boolean)
      .map((t) => `<p class="note">${esc(t)}</p>`).join('');
    const listed = (numbers, lead) => {
      const shown = numbers.map((n) => asks.get(n)).filter((a) => a && a.words.length);
      return shown.length ? `<p class="note">${esc(lead)}</p><ul class="rows">` + shown.map((a) => `<li${ids.has(a.n) ? ''
        : (ids.add(a.n), ` id="ask-${a.n}"`)}>${esc(REPORT_PROMPT_WORDS.askLine(a.n))} · <span class="tag s-${esc(a.state)}">`
        + `${esc(a.status)}</span> · ${partsHtml(a.words)}${list(a.tags).map((t) => ` ${askTagHtml(t)}`).join('')}</li>`)
        .join('') + '</ul>' : '';
    };
    const unlocatedHtml = listed(m.attachedAsks, REPORT_PROMPT_WORDS.fromAttached)
      + listed(m.unlocated, REPORT_PROMPT_WORDS.unlocated);
    // D133 (R2): that Sonah checked only the marked parts is said once, in the page's legend (`footerHtml`).
    return `<div class="message-block"><p class="message">${start.html}${start.cut ? '…' : ''}</p>${whole}${extras}`
      + `${unlocatedHtml}</div>`;
  });
  // D127 (B10d): each compaction at its place among your messages: before the first message recorded after it.
  const compactions = Array.isArray(prompt.compactions) ? prompt.compactions : [];
  const compactionHtml = (c) => `<p class="note compaction">${esc(c.words)}</p>`;
  const placed = [];
  let next = 0;
  prompt.messages.forEach((m, at) => {
    while (next < compactions.length && compactions[next].afterMessage < m.k) placed.push(compactionHtml(compactions[next++]));
    placed.push(blocks[at]);
  });
  while (next < compactions.length) placed.push(compactionHtml(compactions[next++]));
  // An ask whose words no mark above shows (its mark past a message's start, or inside an earlier ask's) is listed with
  // its words.
  // D133 (R2): a row's folded lines (the model's `folded`) in its own evidence fold, after its open lines.
  // D199: an ask's row shows no fold of what Sonah could not check of it (D133's row fold); What Sonah could not check
  // counts those asks.
  // An ask that has no row and that no mark shows gets a row too, so every ask has its anchor.
  const rowed = new Set([...openShown, ...sorted.filter((a) => !ids.has(a.n))]);
  for (const a of rowed) ids.add(a.n);
  // D202: a row's evidence fold (the model's `details`), and the agent's message before yours on the first row of each
  // message the page shows (`said`); with the page shortened, no fold (said where the panel starts).
  const said = new Set();
  const messageOf = new Map(prompt.messages.map((m) => [m.k, m]));
  let detailsCut = false;
  const detailsHtml = (a) => {
    const before = messageOf.get(a.message)?.before;
    const lines = [...list(a.details), ...(before && !said.has(a.message) ? [{ label: REPORT_PROMPT_WORDS.agentBefore,
      parts: before }] : [])];
    if (before) said.add(a.message);
    if (!lines.length) return '';
    // Shortened, the fold goes whole (a summary a row would open to nothing), and the panel says so once.
    if (trim.trail) { detailsCut = true; return ''; }
    return `<details class="evidence ae"><summary>${esc(REPORT_ITEM_WORDS.evidence)}</summary>`
      + `${lines.map((e) => labelled(e.label, partsHtml(e.parts))).join('')}</details>`;
  };
  const rowOf = (a) => {
    // D199: a row of columns (the ask's number, its status, your words, what Sonah found of it); the separators stay in
    // the text, hidden, so the row reads as one line to a screen reader and in a copy. D200: its tags under your words.
    const tags = list(a.tags).map(askTagHtml).join(SEP);
    const more = detailsHtml(a);
    return `<li id="ask-${a.n}" class="ask-row"><span class="ak">${esc(REPORT_PROMPT_WORDS.askLine(a.n))}</span>${SEP}`
      + `<span class="tag s-${esc(a.state)}">${esc(a.status)}</span>`
      + `${a.words.length ? `${SEP}<span class="aw">${partsHtml(a.words)}</span>` : ''}`
      + `${tags ? `${SEP}<span class="at">${tags}</span>` : ''}`
      + `${a.lines.length ? `<span class="al">${a.lines.map((line) => `<span class="ln">${SEP}${partsHtml(line)}</span>`)
        .join('')}</span>` : ''}${more ? `<div class="ad acts">${more}</div>` : ''}</li>`;
  };
  const lines = sorted.filter((a) => rowed.has(a)).map(rowOf);
  const doneFold = (all, shown, summary) => (all.length ? `<details class="fold"><summary>${esc(summary)}</summary>`
    + `${shown.length ? `<ul class="rows ask-lines checklist">${shown.map(rowOf).join('')}</ul>` : ''}`
    + `${all.length > shown.length ? `<p class="cut">${esc(REPORT_NOT_CHECKED_WORDS.rowsNotShown(all.length
      - shown.length))}</p>` : ''}</details>` : '');
  const softHtml = doneFold(softAll, softShown, REPORT_PROMPT_WORDS.agentOnlyFold(softAll.length));
  const otherHtml = doneFold(otherAll, otherShown, REPORT_PROMPT_WORDS.otherDoneFold(otherAll.length));
  // The messages that hold no ask, as recorded (a join between two recorded spans is Sonah's), each its start when cut.
  // D183: those that no answer of the session review could have read (`unreachedMessages`) in a fold of their own, after
  // the others, said as what Sonah cannot tell; each fold cut by the size trim as the other is.
  const room = (m) => (trim.messages.has(m.k) ? REPORT_LIMITS.messageChars : Infinity);
  let listsCut = openShown.length < wanted.length || softShown.length < softAll.length
    || otherShown.length < otherAll.length;
  const noAskFold = (all, summary) => {
    const shownOf = all.slice(0, cap(all.length, trim.did));
    for (const m of shownOf) if (m.chars > room(m)) messagesCut.add(m.k);
    if (shownOf.length < all.length) listsCut = true;
    return all.length ? `<details class="fold"><summary>${esc(summary)}`
      + `</summary><ul class="rows">${shownOf.map((m) => { const shown = segmentsHtml(m.segments, room(m), ids);
        return `<li><p class="message">${shown.html}${shown.cut ? '…' : ''}</p>${m.pasted ? `<p class="note">${esc(m.pasted)}</p>`
          : ''}</li>`; }).join('')}</ul>${all.length > shownOf.length ? `<p class="cut">${esc(REPORT_NOT_CHECKED_WORDS
        .rowsNotShown(all.length - shownOf.length))}</p>` : ''}</details>` : '';
  };
  const unreached = Array.isArray(prompt.unreachedMessages) ? prompt.unreachedMessages : [];
  const empty = noAskFold(prompt.emptyMessages, REPORT_SECTION_WORDS.noAskMessages(prompt.emptyMessages.length))
    + noAskFold(unreached, REPORT_SECTION_WORDS.unreachedMessages(unreached.length));
  // D131 (R1): a long session's prompt is folded, its count in the fold's summary, as What the agent did is.
  // D199: the asks by status are the stats below it.
  const heading = `<h2>${esc(REPORT_SECTION_WORDS.promptCounted(prompt.asks.length, ''))}</h2>`;
  // D193: a tab holds your prompt, so the page shows it whole in its panel, folded on no session.
  const [open, close] = [`<section class="part panel" id="prompt"><div class="card-bar">${heading}</div>`, '</section>'];
  // D199: your asks by state, a row of stats in `BAR_ORDER` (D202: the header's bar draws them in the count line's order), each in the count line's
  // words (`REPORT_PROMPT_PARTS`, D93: an ask with a code finding apart) without their number, which the stat shows.
  const statOf = (state, n) => { const words = REPORT_PROMPT_PARTS[state](n);
    return statHtml(n, words.startsWith(`${n} `) ? words.slice(String(n).length + 1) : words, `s-${state}`); };
  const stats = prompt.asks.length ? statsHtml(BAR_ORDER.filter((state) => prompt.counts?.[state] > 0)
    .map((state) => statOf(state, prompt.counts[state]))) : '';
  return `${open}<div class="content">${stats}`
    + (messagesCut.size ? `<p class="cut">${esc(REPORT_TRIM_WORDS.messagesTrimmed(messagesCut.size))}</p>` : '')
    + (listsCut ? `<p class="cut">${esc(REPORT_TRIM_WORDS.listsTrimmed)}</p>` : '')
    + (detailsCut ? `<p class="cut">${esc(REPORT_TRIM_WORDS.askEvidenceTrimmed)}</p>` : '')
    // D183: an empty prompt in the count line's words (Sonah found no ask, or cannot tell: report-model.js).
    + (prompt.asks.length ? '' : `<p class="note">${esc(model.countLine.prompt)}</p>`)
    // D200: a long prompt's checklist says which asks it holds; your messages, each ask marked, fold below, with the
    // one line that Sonah checked only the marked parts.
    + (big && lines.length ? `<p class="note">${esc(REPORT_PROMPT_WORDS.listedAsks(lines.length, prompt.asks.length,
      listsCut))}</p>` : '')
    + (lines.length ? `<ul class="rows ask-lines checklist">${lines.join('')}</ul>` : '')
    + softHtml + otherHtml
    + (placed.length ? `<details class="fold msgs"><summary>${esc(REPORT_TAB_WORDS.messages)}</summary>`
      + `<p class="note">${esc(REPORT_PROMPT_WORDS.coverage)}</p>${placed.join('')}</details>` : '') + empty
    + `</div>${close}`;
}

// ---- the items ------------------------------------------------------------------------------------------------------

function excerptHtml(excerpt) {
  if (!plain(excerpt) || !list(excerpt.lines).length) return '';
  const width = String(excerpt.lines.at(-1).n).length;
  const rows = excerpt.lines.map((l) => `<span class="ln${l.changed ? ' add' : ''}"><span class="gutter">`
    + `${esc(String(l.n).padStart(width, ' '))}</span> ${esc(l.text)}</span>`).join('');
  return `<pre class="diff excerpt"><span class="lines">${rows}</span></pre>`
    + (excerpt.more ? `<p class="cut">${esc(REPORT_ITEM_WORDS.unchangedLines(excerpt.more))}</p>` : '');
}
function whereHtml(item) {
  const places = [...item.where.map((w) => (w.anchor ? (ANCHOR.test(w.anchor) ? `<a href="#${w.anchor}">${esc(w.text)}</a>`
    : esc(w.text)) : `<code>${esc(placeText(w))}</code>${gitHubLink(w.url)}`)),
  ...(item.whereMore ? [esc(REPORT_ITEM_WORDS.morePlaces(item.whereMore))] : [])];
  // A member (D112) has no scope of its own: its item's marker says whether you asked.
  const asks = item.scope?.asks ?? [];
  const marker = asks.length && !item.where.some((w) => w.anchor === `ask-${asks[0]}`)
    ? [`<a href="#ask-${asks[0]}">${esc(REPORT_ITEM_WORDS.asked(asks[0]))}</a>`] : [];
  return places.length || marker.length ? keyed(REPORT_ITEM_WORDS.where, [...places, ...marker].join(' · '), 'line where')
    : '';
}
function evidenceHtml(item, trimmed) {
  // D199 (the owner, 2026-10-30: "Remove too many disclaimers present with everything", "All of them"): the fold says
  // "Evidence", with no tier's reason, and holds no note of what Sonah could not verify; what it holds is the evidence,
  // the item's id and your answer. Shortened, it keeps its summary (the page says so where it trims); with nothing in it,
  // there is no fold.
  const summary = esc(REPORT_ITEM_WORDS.evidence);
  const lines = item.evidence.map((e) => labelled(e.label, partsHtml(e.parts)));
  const id = item.rowId ? labelled(REPORT_ITEM_WORDS.rowId, `<code>${esc(shortId(item.rowId))}</code>`, 'note') : '';
  // Your earlier answer is your own words, escaped, and never in a recorded quote's quotation marks.
  const answer = item.answer ? labelled(REPORT_ITEM_WORDS.yourAnswer, `${esc(item.answer.words)} `
    + `<span class="answer-reason">${esc(item.answer.reason)}</span>`, 'note answer') : '';
  const body = `${lines.join('')}${id}${answer}`;
  // D199's review: a fold that would hold nothing is no fold, shortened or not.
  return body ? `<details class="evidence"><summary>${summary}</summary>${trimmed ? '' : body}</details>` : '';
}
/** D144: the prompt for the agent of an item that leads in Must act, folded; D199: in a box with a copy button at its
 *  top right, the prompt as plain text in a `<pre>` that one click also selects whole (CSS `user-select: all`). */
const agentPromptHtml = (prompt) => `<details class="agent-prompt"><summary>${esc(REPORT_AGENT_PROMPT_WORDS.fold)}`
  + `</summary><div class="prompt-box">${COPY_BUTTON}<pre class="agent-prompt-text">${esc(agentPromptText(prompt))}</pre>`
  + '</div></details>';
/** D199 (the owner, 2026-10-30: "keep the prompt in a proper box with copy button at top right"; "One pinned script"):
 *  the copy button of a prompt's box, a copy icon that turns to a check once copied. `PAGE_SCRIPT` copies its box's text;
 *  with no script the box still selects whole on one click (CSS `user-select: all`). */
const COPY_BUTTON = `<button type="button" class="copy" hidden aria-label="${esc(REPORT_AGENT_PROMPT_WORDS.copy)}" `
  + `title="${esc(REPORT_AGENT_PROMPT_WORDS.copy)}" data-done="${esc(REPORT_AGENT_PROMPT_WORDS.copied)}"><svg class="i-copy" viewBox="0 0 16 16" aria-hidden="true">`
  + '<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 3.5v-.5a1.5 1.5 0 0 0-1.5-1.5H4a1.5 1.5 0 0 0-1.5 '
  + '1.5v5A1.5 1.5 0 0 0 4 9.5h.5"/></svg><svg class="i-done" viewBox="0 0 16 16" aria-hidden="true">'
  + '<path d="M3 8.5l3 3 7-7"/></svg></button>';
/** D199: the page's one script, pinned by its hash in the page's Content-Security-Policy (`PAGE_SCRIPT_HASH`), so no
 *  other script can run. It shows the copy buttons (hidden where no script runs, so none sits there doing nothing) and
 *  copies the text of the box whose button was clicked: by the clipboard API, else by selecting it and the browser's
 *  copy command; for a moment the button shows a check and its name says so (`data-done`). D203 (the owner, 2026-10-31:
 *  "Yes, extend the script"; a link into another tab opened that tab at its top, and in the Claude app's preview no
 *  in-page link moves at all): after a click on an in-page link (a tab's label made from it, `tabLinks`, or an `<a>`),
 *  once the label has opened its tab, it opens every fold around the place the link names, the place itself when it is a
 *  fold, brings it into view below the tab bar and gives it focus (a `tabindex` it adds goes when the place loses focus);
 *  and a link that is a tab's label takes keyboard focus, as a link (`role`), Enter or Space following it. D204 (the
 *  owner, 2026-10-31: "Yes, add Back"): each such jump keeps, in the current history entry, the tab and the scroll of
 *  the place it leaves and the link it took, and adds one entry for the place it goes to, its address the place's `#id`,
 *  both before the page moves; Back returns to the tab and the place it came from and gives the link focus again, and
 *  Forward to the place. A tab opened by hand is kept in the current entry. A page opened at a `#id` opens that place's
 *  tab and goes there, again once the page has loaded; a page reloaded on an entry with a tab opens that tab, and the
 *  browser keeps the scroll as ever. The place lands
 *  below the tab bar however tall it is. It reads the address's `#id` and the state of its own history entries, and
 *  writes those entries alone; besides, it reads the page's own markup only, and loads, sends and stores nothing else.
 *  Fixed text: the same bytes every page. Was `COPY_SCRIPT`. */
export const PAGE_SCRIPT = "document.querySelectorAll('button.copy').forEach(function(b){b.removeAttribute('hidden')});"
  + "document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest("
  + "'button.copy');if(!b)return;var p=b.parentNode.querySelector('pre');if(!p)return;function done(){"
  + "b.classList.add('done');b.setAttribute('aria-label',b.dataset.done);setTimeout(function(){"
  + "b.classList.remove('done');b.setAttribute('aria-label',b.title)},1500)}function pick(){"
  + "var r=document.createRange();r.selectNodeContents(p);var s=getSelection();s.removeAllRanges();s.addRange(r);"
  + "try{if(document.execCommand('copy'))done()}catch(x){}}if(navigator.clipboard&&navigator.clipboard.writeText)"
  + "navigator.clipboard.writeText(p.textContent).then(done,pick);else pick()});"
  + "document.querySelectorAll('label.xl[data-href]').forEach(function(l){l.tabIndex=0;l.setAttribute('role','link')});"
  + "var L='label.xl[data-href],a[href^=\"#\"]';"
  + "function tab(){var c=document.querySelector('input.tab-r:checked');return c?c.id:null}"
  + "function show(id){var t=document.getElementById(id);if(!t)return null;var p=t.closest('.panel');"
  + "var r=p&&document.getElementById('t-'+p.id);if(r)r.checked=true;return t}"
  + "function go(id){var t=document.getElementById(id);if(!t)return;for(var d=t.parentElement;d;d=d.parentElement)"
  + "if(d.tagName==='DETAILS')d.open=true;if(t.tagName==='DETAILS')t.open=true;if(!t.hasAttribute('tabindex')){"
  + "t.setAttribute('tabindex','-1');t.addEventListener('blur',function(){t.removeAttribute('tabindex')},{once:true})}"
  + "t.focus({preventScroll:true});t.scrollIntoView({block:'start'});var b=document.querySelector('.tabs');"
  + "if(b){var y=b.getBoundingClientRect().bottom+8,top=t.getBoundingClientRect().top;if(top<y)window.scrollBy(0,top-y)}}"
  + "document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest(L);if(!a)return;"
  + "var h=a.getAttribute('data-href')||a.getAttribute('href');if(h.length<2)return;if(a.tagName==='A')e.preventDefault();"
  + "var id=h.slice(1),t=document.getElementById(id),p=t&&t.closest('.panel');try{history.replaceState({tab:tab(),"
  + "y:window.scrollY,link:[].indexOf.call(document.querySelectorAll(L),a)},'');"
  + "history.pushState({tab:p?'t-'+p.id:tab(),id:id},'',h)}catch(x){}setTimeout(function(){show(id);go(id)},0)});"
  + "window.addEventListener('popstate',function(e){var s=e.state,id=s?s.id:null;if(!s){s={};try{id=decodeURIComponent("
  + "location.hash.slice(1))}catch(x){}}if(s.tab){var r=document.getElementById(s.tab);if(r)r.checked=true}"
  + "if(id&&document.getElementById(id)){show(id);go(id)}else if(typeof s.y==='number'){window.scrollTo(0,s.y);"
  + "var l=document.querySelectorAll(L)[s.link];if(l)l.focus({preventScroll:true})}});"
  + "document.addEventListener('change',function(e){var r=e.target;if(!r.matches||!r.matches('input.tab-r'))return;"
  + "try{history.replaceState(Object.assign({},history.state,{tab:r.id}),'')}catch(x){}});"
  + "try{var s0=history.state;if(s0&&s0.tab){var r0=document.getElementById(s0.tab);if(r0)r0.checked=true}else{"
  + "var first=decodeURIComponent(location.hash.slice(1));if(first&&show(first)){go(first);"
  + "window.addEventListener('load',function(){go(first)},{once:true});history.replaceState({tab:tab(),id:first},'')}}}"
  + "catch(x){}"
  + "document.addEventListener('keydown',function(e){if(e.key!=='Enter'&&e.key!==' ')return;var l=e.target;"
  + "if(!l.matches||!l.matches('label.xl[data-href]'))return;e.preventDefault();l.click()});";
export const PAGE_SCRIPT_HASH = `sha256-${createHash('sha256').update(PAGE_SCRIPT).digest('base64')}`;
/** The lines of an item or a member (D97, D112), in order, then (D144) the prompt for the agent of an item that has one,
 *  left out with the evidence when the page is shortened, then its evidence fold. */
function linesHtml(item, trimmed, { inRow = {} } = {}) {
  const out = [];
  // D194: what it is under a head that its quote leads; else its quote under the head. D198: a line the row's summary
  // shows (`inRow`) is not said again under it.
  // D202 (the follow-up review counted 258 rows showing their lead quote again when opened): an item whose quote leads has it in
  // its head, so its body never repeats it; its review: unless the head shows the decision's two sides (`facets`).
  const kind = kindLineParts(item);
  if (kind && !inRow.kind) out.push(`<p class="kind-line">${partsHtml(kind)}</p>`);
  if (item.quote && (!kind || item.facets)) out.push(item.quoteLabel ? `<blockquote class="item-quote kv"><span class="label">${esc(item.quoteLabel)}`
    + `</span> <span class="v">${partHtml(item.quote)}</span></blockquote>` : `<blockquote class="item-quote">${partHtml(item.quote)}`
    + '</blockquote>');
  // D202 (a tag's sentence showed on a pointer's hover only): each tag of the row with its sentence, which a keyboard and a
  // touch reach once the row is open.
  for (const t of list(item.tags)) if (t.words) out.push(keyed(REPORT_DECISION_TAGS[t.key], esc(t.words), 'line tag-why'));
  // D110: each premise of an item to verify that Sonah could not check, in its check's words.
  for (const parts of list(item.restsOutside)) out.push(keyed(REPORT_ITEM_WORDS.restsOutside, partsHtml(parts),
    'line rests-outside'));
  if (item.impact) out.push(keyed(REPORT_ITEM_WORDS.impact, `${partsHtml(item.impact)} ${FORM_TAG}`, 'line impact'));
  if (item.agentSaid) out.push(keyed(item.agentSaidLabel ?? REPORT_ITEM_WORDS.agentSaid, partHtml(item.agentSaid),
    'line agent-said'));
  // D163: a change of approach's reason in the session review's words, on its own line, after the agent's own.
  if (item.reviewWhy) out.push(keyed(REPORT_ITEM_WORDS.reviewWhy, partsHtml(item.reviewWhy), 'line review-why'));
  if (item.action && !inRow.action) out.push(keyed(REPORT_ITEM_WORDS.action, `${partsHtml(item.action)} ${FORM_TAG}`,
    'line action'));
  out.push(whereHtml(item));
  out.push(excerptHtml(item.where[0]?.excerpt));
  // D197: the prompt for the agent and the evidence as a row of chips; the one opened takes the row's width.
  const acts = `${item.agentPrompt && !trimmed ? agentPromptHtml(item.agentPrompt) : ''}${evidenceHtml(item, trimmed)}`;
  if (acts) out.push(`<div class="acts">${acts}</div>`);
  return out.join('');
}
/** D112: the members of an item, after its own lines: the line that counts them, then each one, its type word, what it
 *  is and its own tier word, then its lines; folded (`<details>`) when the model folds it. */
function membersHtml(item, trimmed) {
  const members = list(item.members);
  if (!members.length) return '';
  return `<div class="members"><p class="note">${esc(REPORT_ITEM_WORDS.members(members.length))}</p>${members.map((m) => {
    const head = `${typeHtml(m.type)} ${partsHtml(headParts(m))} · `
      + `<span class="tier-word">${esc(REPORT_TIER_WORDS[m.tier.final])}</span>`;
    return m.folded ? `<details class="member"><summary>${head}</summary>${linesHtml(m, trimmed)}</details>`
      : `<div class="member"><p class="member-head">${head}</p>${linesHtml(m, trimmed)}</div>`;
  }).join('')}</div>`;
}
/** The visible lines of an item (D97), in order, then its evidence fold, then its members (D112). */
function itemBody(item, trimmed) {
  // D113 amended: the model's one marker, an item outside the evaluated session's among them; D199: as a short tag.
  const scope = scopeTagHtml(item.scope);
  // D199: a decision, or a change of approach, as what it is about and what the agent chose (`facets`), an arrow
  // between them; its kind is a tag on its row (`REPORT_ROW_TAGS`).
  const what = item.facets ? `${item.facets.about ? `<span class="about">${partsHtml(item.facets.about)}</span>`
    + '<span class="to"> → </span>' : ''}<span class="choice">${partsHtml(item.facets.chosen)}</span>`
    : partsHtml(headParts(item));
  return { head: `<span class="n">${item.n}</span> ${typeHtml(item.type)} ${what}${scope}`,
    body: linesHtml(item, trimmed) + membersHtml(item, trimmed) };
}
/** D198 (the owner, 2026-10-30: "Traditionally, in UX and UI, what has worked best here? Let's go with that. The goal
 *  is faster readability"): every item is one row, as an issue list shows it. Its summary: the head (number, type pill,
 *  what it is, its marker), chips for its first place and its ask, `meta` (a decision's asks it follows and its tier),
 *  and one line under it: the action when the item has one, else what kind of item it is when its quote leads. The row
 *  opens to every other line, said once. `cls` is the row's own classes. */
function rowHtml(item, trimmed, cls, meta = '') {
  const { head } = itemBody(item, trimmed);
  const first = item.where[0];
  const place = first ? (first.anchor ? first.text : placeText(first)) : null;
  const asked = item.scope?.asks?.length ? REPORT_ITEM_WORDS.asked(item.scope.asks[0]) : null;
  // D200: the item's tags first (REPORT_DECISION_TAGS), each the sentence it stands for as its title.
  const flags = list(item.tags).map((t) => `<span class="flag">${esc(REPORT_DECISION_TAGS[t.key])}${tipHtml(t.words)}`
    + '</span>').join('');
  const chips = `${flags}${item.facets && REPORT_ROW_TAGS[item.kind] ? `<span class="kind">${esc(REPORT_ROW_TAGS[item.kind])}</span>`
    : ''}${[place, asked !== place ? asked : null].filter(Boolean).map((t) => `<span class="chip">${esc(t)}</span>`).join('')}`;
  const kind = kindLineParts(item);
  const preview = item.action ? `<span class="pv act"><span class="label">${esc(REPORT_ITEM_WORDS.action)}</span> `
    + `${partsHtml(item.action)} ${FORM_FLAG}</span>` : kind ? `<span class="pv">${partsHtml(kind)}</span>` : '';
  const inRow = { action: Boolean(item.action), kind: !item.action && Boolean(kind) };
  const summary = `<span class="rh">${head}</span><span class="rm">${chips}${meta}</span>${preview}`;
  const body = `${linesHtml(item, trimmed, { inRow })}${membersHtml(item, trimmed)}`;
  // D199: a row with nothing under it is a plain row, not a fold that opens to nothing.
  return body ? `<details class="${cls}" id="item-${item.n}"><summary>${summary}</summary>${body}</details>`
    : `<div class="${cls} flat" id="item-${item.n}"><div class="sum">${summary}</div></div>`;
}
function itemHtml(item, trimmed) {
  return rowHtml(item, trimmed, `item row t-${esc(item.type)}`);
}
function goodToKnowHtml(item, trimmed) {
  return rowHtml(item, trimmed, `item gtk row t-${esc(item.type)}`);
}
/** The three tiers: Must act and Must know open (`must`), Good to know folded (`good`); D131: your prompt may stand
 *  between them (`promptAfterTiers`). */
function tiersHtml(model, trim) {
  const [act, know, good] = ['must_act', 'must_know', 'good_to_know'];
  const note = (on) => (on ? `<p class="cut">${esc(REPORT_TRIM_WORDS.trimmed)}</p>` : '');
  // D163: a tier's heading counts as the count line does (Must act with its pointers), and after its own items come its
  // pointers to the decisions of the second part tagged with it.
  const open = (tier) => `<section class="part tier" id="${tier.replace(/_/g, '-')}"><h2>${esc(REPORT_SECTION_WORDS
    .tier(REPORT_TIER_WORDS[tier], model.countLine.counts[tier]))}</h2>${tier === act ? note(trim.items) : ''}`
    + `${model.tiers[tier].map((item) => itemHtml(item, trim.items)).join('')}${pointersHtml(model, tier)}</section>`;
  // D169: Good to know with no item is its heading, as an empty Must act is, never an empty fold.
  const gtk = model.tiers[good].length ? `<details class="part tier fold-tier" id="good-to-know"><summary><h2>`
    + `${esc(REPORT_SECTION_WORDS.tier(REPORT_TIER_WORDS[good], model.tiers[good].length))}</h2></summary>`
    + `${note(trim.goodToKnow)}${model.tiers[good].map((item) => goodToKnowHtml(item, trim.goodToKnow)).join('')}</details>`
    : `<section class="part tier" id="good-to-know"><h2>${esc(REPORT_SECTION_WORDS.tier(REPORT_TIER_WORDS[good], 0))}</h2>`
      + '</section>';
  return { must: open(act) + open(know), good: gtk, trail: trailHtml(model, trim) };
}
/** D163 (L1), D194: a tier's pointers to the decisions of the second part tagged with it: one line that counts them and
 *  links to that part. Empty with none. */
function pointersHtml(model, tier) {
  const pointers = list(model.pointers?.[tier]);
  // D194: one line, its count, linked to the decisions, which list each one once.
  return pointers.length ? `<p class="note pointers"><a href="#decisions">${esc(REPORT_TRAIL_WORDS
    .taggedThere(REPORT_TIER_WORDS[tier], pointers.length))}</a></p>` : '';
}
/** D163: the line of a decision that the first part shows, at its place in the second part: its type word, what it
 *  is and its marker, a link to its item there, and its tag. */
function trailAboveHtml(entry) {
  return `<p class="trail-above">${typeHtml(entry.type)} `
    + `${partsHtml(entry.what.parts)}${scopeTagHtml(entry.scope)} · `
    + `${entry.after ? `${afterHtml(entry.after, entry.afterAsk)} · ` : ''}`
    + `<a href="#item-${entry.n}">${esc(REPORT_TRAIL_WORDS.shownAbove(entry.n))}</a> · `
    + `${tierTagHtml(entry.tier)}</p>`;
}
/** D161: one decision of the report's second part: a fold whose summary is its line (its number, type word, what it is,
 *  its marker, the ask its instruction ties it to, and its tier as a tag), and whose body is the item's own lines. */
function trailItemHtml(item, trimmed, after = null, afterAsk = null) {
  // D198: a row, as every item: its ask a chip, then the asks it follows and its tier at the row's end.
  return rowHtml(item, trimmed, `item gtk row trail-item t-${esc(item.type)}`,
    `${after ? afterHtml(after, afterAsk) : ''}${tierTagHtml(item.tier.final)}`);
}
/** D202 (the follow-up review: "after ask N" was plain text): the asks a decision follows, a link to the first. */
const afterHtml = (after, n) => (Number.isSafeInteger(n) ? `<a href="#ask-${n}" class="after">${esc(after)}</a>`
  : `<span class="after">${esc(after)}</span>`);
/** D161, D194: the report's second part, the agent's decisions in the order the session recorded them, as one list: the
 *  entries the model shows (tagged Must act or Must know; a decision that the first part shows by its line there), each
 *  with the asks it follows, then one fold that counts the rest (tagged Good to know) and holds them in order. Empty
 *  with no decision. */
function trailHtml(model, trim) {
  const decisions = model.decisions;
  if (!decisions?.total) return '';
  // Lowest tier first, as the first part (its review): a decision tagged Good to know keeps only its summary with Good to
  // know's (`trail`); one tagged Must act or Must know only with Must act's and Must know's (`items`). Every line stays.
  const cut = (item) => (['must_act', 'must_know'].includes(item.tier.final) ? trim.items : trim.trail);
  const all = decisions.groups.flatMap((g) => g.items);
  const note = all.some(cut) ? `<p class="cut">${esc(REPORT_TRIM_WORDS.trimmed)}</p>` : '';
  const entryHtml = (e) => (e.above ? trailAboveHtml(e) : trailItemHtml(e.item, cut(e.item), e.after, e.afterAsk));
  // D194: one list in the session order: the entries tagged Must act or Must know, then one fold that counts those
  // tagged Good to know and holds them in order.
  const body = decisions.groups.map((g) => `${g.shown.map(entryHtml).join('')}${g.more.length ? `<details class="trail-more">`
    + `<summary>${esc(g.moreWords)}</summary>${g.more.map(entryHtml).join('')}</details>` : ''}`).join('');
  // D199: the decisions by their tier tags, a row of stats.
  const stats = statsHtml(['must_act', 'must_know', 'good_to_know'].filter((tier) => decisions.tagged[tier] > 0)
    .map((tier) => statHtml(decisions.tagged[tier], REPORT_TIER_WORDS[tier], `tier-${tier.replace(/_/g, '-')}`)));
  return `<section class="part tier trail panel" id="decisions"><h2>${esc(REPORT_TRAIL_WORDS.heading(decisions.total))}</h2>`
    + `${stats}${note}${body}</section>`;
}

// ---- what the agent did -------------------------------------------------------------------------------------------

const cap = (n, factor) => Math.floor(n * factor);
/** D199: the items a row names: one link as before, several as one group, each number a link. */
const itemRefs = (ns) => (ns.length > 1 ? ` <span class="refs">→ items ${ns.map((n) => `<a href="#item-${n}">${n}</a>`)
  .join(' ')}</span>` : ns.map((n) => ` <a href="#item-${n}">→ item ${n}</a>`).join(''));
function didHtml(model, factor) {
  const { did } = model;
  const note = factor < 1 ? `<p class="cut">${esc(REPORT_TRIM_WORDS.listsTrimmed)}</p>` : '';
  // Files.
  let room = cap(REPORT_LIMITS.files, factor);
  // D199: a file a row of columns (separators kept in the text, hidden); its items one group of links.
  const fileLine = (f) => `<li><code>${esc(f.path)}</code>${f.type ? `${SEP}${fileTypeHtml(f.type)}` : ''}${f.counts
    ? `${SEP}<span class="mono">${countsHtml(f.counts)}</span>`
    : ''}${f.state ? `${SEP}<span>${esc(f.state)}</span>` : ''}${f.what ? `${SEP}<span class="fw">${partsHtml(f.what)}</span>` : ''}`
    + `${gitHubLink(f.link)}${itemRefs(f.items)}</li>`;
  let shownFiles = 0;
  const groups = did.files.groups.map((g) => {
    const rows = g.files.slice(0, Math.max(0, room));
    room -= rows.length;
    shownFiles += rows.length;
    const heading = did.files.grouped ? `<h4 class="label">${esc(g.ask === null ? REPORT_DID_WORDS.noAskGroup
      : REPORT_DID_WORDS.askGroup(g.ask))}</h4>` : '';
    return rows.length ? `${heading}<ul class="files">${rows.map(fileLine).join('')}</ul>` : '';
  }).join('');
  const filesMore = did.files.total - shownFiles;
  const away = did.files.outsideSession;
  const files = `<h3 class="sub-h">${esc(REPORT_SECTION_WORDS.files)}</h3>`
    + (did.files.total ? groups : `<p class="note">${esc(noFilesWords(did))}</p>`)
    + (filesMore > 0 ? `<p class="cut">${esc(REPORT_DID_WORDS.moreFiles(filesMore))}</p>` : '')
    // D109 (its review): with the code step's one tally, the writes it counts and that are no file of the change.
    + (did.files.outside ? `<p class="note">${esc((did.files.outside.notInChange ? REPORT_DID_WORDS.notInChange
      : REPORT_DID_WORDS.outside)(did.files.outside.n, did.files.outside.paths.join(', '), did.files.outside.more))}</p>` : '')
    // D118 (b): the paths the recording does not resolve, apart, each as code.
    + (did.files.unresolved ? `<p class="note">${esc(REPORT_DID_WORDS.unresolved(did.files.unresolved.n, SLOT,
      did.files.unresolved.more)).split(SLOT).join(did.files.unresolved.paths.map((p) => `<code>${esc(p)}</code>`)
      .join(', '))}</p>` : '')
    + (did.files.unconfirmed ? `<p class="note">${esc(REPORT_DID_WORDS.unconfirmed(did.files.unconfirmed))}</p>` : '')
    // D113 amended: the files outside the evaluated session, apart, each tagged.
    + (away ? `<p class="note">${esc(away.lead)}</p><ul class="files">${away.files.map(fileLine).join('')}</ul>`
      + (away.more > 0 ? `<p class="cut">${esc(REPORT_DID_WORDS.moreFiles(away.more))}</p>` : '') : '');
  // Runs.
  // D200: cut to fit, the list keeps first the runs another part names, then those whose result a reader must see.
  const pri = (run) => (run.named ? 0 : run.attention ? 1 : 2);
  const keep = new Set(did.runs.shown.map((run, at) => ({ run, at })).sort((a, b) => pri(a.run) - pri(b.run) || a.at - b.at)
    .slice(0, cap(did.runs.shown.length, factor)).map(({ run }) => run));
  const runsShown = did.runs.shown.filter((run) => keep.has(run));
  const runsCut = did.runs.shown.length - runsShown.length;
  // D169: a run listed apart says its number first, as the report names it (the list numbers its entries by place).
  // D200: a row of the list carries its run's number as its marker, as the list can skip runs.
  const runLine = (run, numbered = false) => `<li id="run-${run.k}"${numbered ? '' : ` value="${run.k}"`}>${[numbered
    ? esc(REPORT_ITEM_WORDS.run(run.k)) : null,
    run.text ? `<code>${esc(run.text)}</code>` : run.tool ? `<code>${esc(run.tool)}</code>` : null].filter(Boolean)
    .join(' · ')}${run.outcome ? ` · <span class="out o-${esc(run.part ?? '')}">${esc(run.outcome)}</span>` : ''}`
    + `${run.handling ? ` · ${esc(run.handling)}` : ''}${run.item ? ` <a href="#item-${run.item}">→ item ${run.item}</a>` : ''}`
    + `</li>`;
  // D169: the runs that another part names and the list leaves out, after it, whole under the size trim: an item or an
  // ask that the page shows names each. D204 (the coordinator's review: this list, never folded and with no bound, grew
  // What the agent did most): in one fold that counts them; a link to one opens it (`PAGE_SCRIPT`).
  const named = did.runs.named.length ? `<details class="fold named-runs"><summary>${esc(REPORT_DID_WORDS
    .runsNamedFold(did.runs.named.length, runsShown.length > 0))}</summary><ul class="rows">`
    + `${did.runs.named.map((run) => runLine(run, true)).join('')}</ul></details>` : '';
  const runs = `<h3 class="sub-h">${esc(REPORT_SECTION_WORDS.runs)}</h3>`
    + (did.runs.total ? `<ol class="rows runs">${runsShown.map((run) => runLine(run)).join('')}</ol>` : `<p class="note">${esc(REPORT_DID_WORDS.noRuns)}</p>`)
    + named
    + (did.runs.quietExit0 ? `<p class="cut">${esc(REPORT_DID_WORDS.moreRuns(did.runs.quietExit0))}</p>` : '')
    + (did.runs.cut + runsCut ? `<p class="cut">${esc(REPORT_DID_WORDS.runsCut(runsShown.length + did.runs.named.length,
      did.runs.cut + runsCut, did.runs.cutParts.join(', ') || String(did.runs.cut + runsCut)))}</p>` : '')
    + (did.runs.neverRan.length ? `<p class="note">${esc(REPORT_DID_WORDS.neverRan(did.runs.neverRan.join(', ')))}</p>` : '');
  // Claims.
  const claimsShown = did.claims.shown.slice(0, cap(did.claims.shown.length, factor));
  const claimsMore = did.claims.total - claimsShown.length;
  const claimLine = (c) => `<li id="${esc(c.anchor)}">${c.status ? `<span class="tag c-${claimKey(c.status)}">`
    + `${esc(c.status)}</span>` : ''}`
    + `${c.item ? `${c.status ? ' ' : ''}<a href="#item-${c.item}">→ item ${c.item}</a>` : ''}`
    + ` ${c.quote ? partHtml(c.quote) : esc(REPORT_ITEM_WORDS.quoteMissing)}`
    + `${c.confirmedBy ? ` · <span class="label">${esc(REPORT_ITEM_WORDS.recordedResult)}</span> ${partHtml(c.confirmedBy)}` : ''}`
    + `${c.why ? ` · ${esc(c.why)}` : ''}`
    + `${c.path ? ` · ${esc(REPORT_DID_WORDS.written(c.path))}` : ''}</li>`;
  const closingRows = did.claims.closing.rows.slice(0, cap(did.claims.closing.rows.length, factor));
  const closing = did.claims.closing.total ? `<details class="fold"><summary>${esc(REPORT_SECTION_WORDS
    .closingLines(did.claims.closing.total))}</summary><ul class="rows">${closingRows.map((l) => `<li>${partsHtml(l.parts)}</li>`)
    .join('')}</ul>${did.claims.closing.total > closingRows.length ? `<p class="cut">${esc(REPORT_NOT_CHECKED_WORDS
    .rowsNotShown(did.claims.closing.total - closingRows.length))}</p>` : ''}</details>` : '';
  const claims = `<h3 class="sub-h">${esc(REPORT_SECTION_WORDS.claims)}</h3>`
    + (did.claims.total ? `<ul class="rows claims">${claimsShown.map(claimLine).join('')}</ul>`
      : `<p class="note">${esc(did.empty.claims)}</p>`)
    + (claimsMore > 0 ? `<p class="cut">${esc(REPORT_DID_WORDS.moreClaims(claimsMore))}</p>` : '') + closing;
  // What the agent said it did not do; the decisions you settled.
  const leftOutShown = did.leftOut.slice(0, cap(did.leftOut.length, factor));
  const settledShown = did.settled.slice(0, cap(did.settled.length, factor));
  const more = (n) => (n > 0 ? `<p class="cut">${esc(REPORT_NOT_CHECKED_WORDS.rowsNotShown(n))}</p>` : '');
  const leftOut = `<h3 class="sub-h">${esc(REPORT_SECTION_WORDS.leftOut)}</h3>` + (did.leftOut.length ? `<ul class="rows">`
    + leftOutShown.map((x) => `<li>${partHtml(x.quote)} <a href="#item-${x.item}">→ item ${x.item}</a></li>`).join('')
    + `</ul>${more(did.leftOut.length - leftOutShown.length)}` : `<p class="note">${esc(did.empty.leftOut)}</p>`);
  const settled = `<h3 class="sub-h">${esc(REPORT_SECTION_WORDS.settled)}</h3>` + (did.settled.length ? `<ul class="rows">`
    + settledShown.map((x) => `<li>${partsHtml(x.parts)}${x.youSaid ? ` · <span class="label">${esc(x.youSaidLabel ?? REPORT_ITEM_WORDS.youSaid)}</span> `
      + partHtml(x.youSaid) : ''}</li>`).join('') + `</ul>${more(did.settled.length - settledShown.length)}`
    : `<p class="note">${esc(did.empty.settled)}</p>`);
  // D199: the counts are the stats below the heading.
  return `<section class="part panel" id="did"><div class="card-bar"><h2>${esc(REPORT_TAB_WORDS.did)}</h2></div>`
    // D201 (the owner, 2026-10-31: "move claims to the top on what the agent did"): the claims first.
    + `<div class="content">${note}${didStatsHtml(did)}`
    + claims + files + runs + leftOut + settled + '</div></section>';
}
/** D199: What the agent did at a glance: its files, runs and claims as stats, then a line of chips for its runs by
 *  result and one for its claims by status (`did.runs.partKeys`, `did.claims.counts`), each the model's count with its
 *  closed words. */
function didStatsHtml(did) {
  // D199's review (R17): the commands and the other calls apart, as the header and the .md count them.
  // D201: the claims first, as the tab lists them.
  const tiles = [...(did.claims.total ? [statHtml(did.claims.total, REPORT_SECTION_WORDS.claims)] : []),
    ...(did.files.none === 'unseen' || !did.files.total ? [] : [statHtml(did.files.total, REPORT_SECTION_WORDS.files)]),
    ...(did.runs.commands ? [statHtml(did.runs.commands, REPORT_TAB_WORDS.commands)] : []),
    ...(did.runs.others ? [statHtml(did.runs.others, REPORT_TAB_WORDS.otherCalls)] : [])];
  // D200: each result class in its short label (REPORT_RUN_CHIPS) with its count.
  const runs = (did.runs.partKeys ?? []).map((key, at) => `<span class="mark out o-${esc(key)}">`
    + `${esc(REPORT_RUN_CHIPS[key](did.runs.partCounts[at]))}</span>`);
  const claims = Object.entries(did.claims.counts ?? {}).map(([key, n]) => `<span class="mark tag c-${claimLook(key)}">`
    + `${n} ${esc(REPORT_DID_WORDS.claimStatus[key])}</span>`);
  const line = (key, marks) => (marks.length ? `<p class="marks"><span class="k">${esc(key)}</span> ${marks.join(SEP)}</p>` : '');
  return `${statsHtml(tiles)}${line(REPORT_SECTION_WORDS.claims, claims)}${line(REPORT_TAB_WORDS.runs, runs)}`;
}

// ---- what Sonah could not check ------------------------------------------------------------------------------------

function notCheckedHtml(model, factor, did = 1) {
  const nc = model.notChecked;
  // D184: a fact that the claims list holds the rows Sonah did not check says so of the rows this page lists there (its
  // size trim's `did` factor cuts that list as `didHtml` does).
  const rows = cap(model.did.claims.shown.length, did);
  const partsOf = (f) => (f.listed ? listedThereParts(f.listed, rows) : f.parts);
  const note = factor < 1 ? `<p class="cut">${esc(REPORT_TRIM_WORDS.listsTrimmed)}</p>` : '';
  // D169: a fact about the code review (its `group` 'code') is under that heading, with its lines and the withheld
  // fold, as the .md has it (session-story.js `notCheckedSection`); the session review's under its own.
  const factsOf = (group) => {
    const all = nc.facts.filter((f) => (f.group === 'code') === (group === 'code'));
    const shown = all.slice(0, cap(all.length, factor));
    return (shown.length ? `<ul class="rows">${shown.map((f) => `<li>${partsHtml(partsOf(f))}</li>`).join('')}</ul>` : '')
      + (all.length > shown.length ? `<p class="cut">${esc(REPORT_NOT_CHECKED_WORDS.rowsNotShown(all.length
        - shown.length))}</p>` : '');
  };
  const withheld = nc.withheld.slice(0, cap(nc.withheld.length, factor));
  const codeFacts = nc.facts.some((f) => f.group === 'code');
  const withheldHtml = nc.withheldTotal ? `<details class="fold"><summary>${esc(REPORT_SECTION_WORDS.withheld(nc.withheldTotal))}`
    + `</summary><ul class="rows">${withheld.map((w) => `<li>${w.what ? `<span class="label">${esc(w.what)}</span> ` : ''}`
      + `${partsHtml(w.words)}${w.outside ? ` · ${esc(w.outside)}` : ''}${w.why ? ` · ${esc(w.why)}` : ''}`
      + `${w.check ? ` · <span class="label">${esc(REPORT_NOT_CHECKED_WORDS
        .checkSaid)}</span> ${partsHtml(w.check)}` : ''}</li>`).join('')}</ul>`
    + (nc.withheldTotal > withheld.length ? `<p class="cut">${esc(REPORT_NOT_CHECKED_WORDS.rowsNotShown(nc.withheldTotal
      - withheld.length))}</p>` : '') + '</details>' : '';
  // D199: the line of what Sonah did not check, as the model says it (`didNotCheck`), shown as chips: its quiet line goes.
  const dnc = nc.didNotCheck ? `${nc.didNotCheck.lead} ${nc.didNotCheck.phrases.join(' · ')}`
    + `${nc.didNotCheck.more ? ` ${nc.didNotCheck.more}` : ''}` : null;
  const quiet = nc.quiet.filter((t) => t !== dnc);
  // D199: the session review's card holds its lead, its facts and what Sonah could not read of it; none, no card.
  const session = `${nc.lead ? `<p class="note">${esc(nc.lead)}</p>` : ''}${factsOf('session')}`
    + [...nc.unreadAsks, ...nc.unreadRows].map((line) => `<p class="note">${esc(line)}</p>`).join('');
  const code = nc.code.length || codeFacts || nc.withheldTotal ? `<h3 class="sub-h">${esc(REPORT_NOT_CHECKED_WORDS
    .codeReview)}</h3>${nc.code.map((line) => `<p class="note">${partsHtml(line)}</p>`).join('')}${factsOf('code')}`
    + withheldHtml : '';
  return `<section class="part panel" id="not-checked"><div class="card-bar"><h2>`
    + `${esc(REPORT_SECTION_WORDS.notCheckedCounted(nc.total))}</h2></div><div class="content">${note}`
    // D133 (R2): the first screen's lines about what Sonah could not check, word for word, first; D199: the line of what
    // Sonah did not check as its lead and a chip a phrase (`didNotCheck`), the other lines as rows.
    + (dnc ? `<p class="marks dnc"><span class="k">${esc(nc.didNotCheck.lead)}</span> ${nc.didNotCheck.phrases.map((phrase) =>
      `<span class="mark">${esc(phrase)}</span>`).join(SEP)}${nc.didNotCheck.more ? ` ${esc(nc.didNotCheck.more)}` : ''}</p>` : '')
    + (quiet.length ? `<ul class="rows quiet">${quiet.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '')
    // D199: the session review's and the code review's limits, side by side.
    + (session || code ? `<div class="nc-cards">${session ? `<div class="nc-card"><h3 class="sub-h">`
      + `${esc(REPORT_NOT_CHECKED_WORDS.sessionReview)}</h3>${session}</div>` : ''}${code ? `<div class="nc-card">${code}</div>`
      : ''}</div>` : '')
    + '</div></section>';
}

// ---- the footer -----------------------------------------------------------------------------------------------------

/** D171: the footer's line that a newer Sonah is out, or nothing. Its bytes are not counted against `maxBytes`
 *  (`sessionPage`), so the page chooses what it leaves out as it would with no such line. */
const newerHtml = (footer) => (footer.newer ? `<p>${esc(footer.newer)}</p>` : '');

function footerHtml(model) {
  const { footer } = model;
  // D161: the agent's decisions among them: an answer is about a decision first.
  const items = reportItems(model);
  // D202's second review: whether a row of the page carries a row tag (a decision's kind, or `scopeTagHtml`'s marker).
  const rowTagged = items.flatMap((item) => [item, ...list(item.members)]).some((item) => (item.facets
    && REPORT_ROW_TAGS[item.kind]) || scopeTagHtml(item.scope) !== '');
  const answer = footer.sessionHash && items.some((item) => item.rowId)
    ? `<details class="fold answer"><summary>${esc(REPORT_SECTION_WORDS.answer)}</summary>`
      + `<p>${esc(REPORT_FOOTER_WORDS.answerIntro)} ${esc(REPORT_FOOTER_WORDS.answerParts)}</p>`
      + `<p class="cmd"><code>${esc(REPORT_FOOTER_WORDS.answerCommand(footer.sessionHash))}</code></p>`
      + `<p>${esc(REPORT_FOOTER_WORDS.answerReport)}</p></details>` : '';
  // D129 (C7): what the review cost, after the line that names Sonah, when the run record holds it. D171: before it,
  // the line that a newer Sonah is out, when the model has it (the CLI's update check knew one).
  // D193: the legend in a fold of its own, after the lines that name Sonah, a newer Sonah and the cost.
  return `<footer class="foot"><p class="gen">${esc(footer.provenance)}</p>${newerHtml(footer)}`
    + (footer.usage ? `<p>${esc(footer.usage)}</p>` : '')
    + `<details class="fold legend"><summary>${esc(REPORT_TAB_WORDS.legend)}</summary>`
    // D202's second review: the page's own legend lines, each only where the page shows what it explains.
    + [...footer.legend, ...(rowTagged ? [REPORT_FOOTER_WORDS.legendRowTags] : []),
      ...(model.prompt.asks.length ? [REPORT_FOOTER_WORDS.legendBar] : [])].map((line) => `<p>${esc(line)}</p>`).join('')
    // D133 (R2): said once here, in the legend, for every message whose asks the page marks.
    + `</details>${answer}</footer>`;
}

// ---- the page -------------------------------------------------------------------------------------------------------

const LOGO = '<svg class="logo" viewBox="0 0 64 64" aria-hidden="true"><rect class="l-bg" width="64" height="64" rx="14"/>'
  + '<rect class="l-fg" x="14" y="17" width="26" height="6" rx="3"/><rect class="l-fg l-dim" x="14" y="29" width="22" height="6" rx="3"/>'
  + '<rect class="l-ac" x="40" y="27" width="10" height="10" rx="2"/><rect class="l-fg" x="14" y="41" width="30" height="6" rx="3"/></svg>';

/** D193: the page's panels by id, and each one's tab word (`REPORT_TAB_WORDS`). */
const TAB_OF = Object.freeze({ review: 'review', decisions: 'decisions', prompt: 'prompt', did: 'did',
  'not-checked': 'notChecked' });
const PANEL_IDS = Object.keys(TAB_OF);

/** The page's one stylesheet (D193, the owner, 2026-10-30: "readability is very poor"): sonah.dev's colours, each token
 *  one `light-dark()` pair that the reader's setting or `data-theme` picks; flat surfaces and hairlines, no shadow; the
 *  accent on Must act's rule, the focus ring and the quotes' marks; labels in sentence case; one type scale. The tabs show one panel at a time with no script: the panel whose radio is
 *  checked (D196), the first by default; print, or a page read without the stylesheet, shows every panel in order. `--faint` at least 4.6:1 on the card and the
 *  wash in both themes (WCAG 2.2 AA 1.4.3). An ask's status is a word in a tag; its mark is one colour for every
 *  status: no colour means safe. */
export const PAGE_CSS = `
:root {
  color-scheme: light dark; --ease: cubic-bezier(0.23, 1, 0.32, 1);
  --bg: light-dark(#f7f7f4, #161310); --card: light-dark(#ffffff, #1e1a16); --ink: light-dark(#251f19, #f1ece6);
  --muted: light-dark(#68615a, #b5aca2); --faint: light-dark(#746b62, #a39a90); --line: light-dark(#ebe8e4, #2e2823);
  --line-strong: light-dark(#d4cdc7, #463e37); --wash: light-dark(#f7f6f2, #24201b);
  --accent: light-dark(#f48d16, #f59a2e); --accent-ink: light-dark(#9a5300, #ffb45e);
  --accent-edge: light-dark(rgba(244,141,22,.35), rgba(245,154,46,.40));
  --add: light-dark(rgba(46,140,74,.10), rgba(90,190,120,.14));
  --red: light-dark(#b42318, #fca5a5); --red-bg: light-dark(rgba(220,38,38,.09), rgba(248,113,113,.15));
  --amber: light-dark(#93370d, #fcd34d); --amber-bg: light-dark(rgba(217,119,6,.11), rgba(251,191,36,.14));
  --blue: light-dark(#1d4ed8, #93c5fd); --blue-bg: light-dark(rgba(37,99,235,.09), rgba(96,165,250,.15));
  --violet: light-dark(#6d28d9, #c4b5fd); --violet-bg: light-dark(rgba(124,58,237,.09), rgba(167,139,250,.15));
  --green: light-dark(#15803d, #86efac); --green-bg: light-dark(rgba(22,163,74,.10), rgba(74,222,128,.13));
  --teal: light-dark(#0f766e, #5eead4); --teal-bg: light-dark(rgba(13,148,136,.09), rgba(45,212,191,.13));
  --sans: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
}
:root[data-theme="light"] { color-scheme: light; }
:root[data-theme="dark"] { color-scheme: dark; }
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--ink); font-family: var(--sans); font-size: 15px; line-height: 1.6;
  overflow-wrap: anywhere; -webkit-font-smoothing: antialiased; }
h1, h2, h3, h4, p, figure, blockquote, pre, ol, ul { margin: 0; }
h1, h2, h3 { text-wrap: balance; }
a { color: inherit; text-decoration: underline; text-decoration-color: var(--line-strong); text-underline-offset: 3px; }
a:hover { text-decoration-color: currentColor; }
code, .mono { font-family: var(--mono); font-size: .9em; }
:focus-visible { outline: 2px solid var(--accent-ink); outline-offset: 2px; border-radius: 3px; }
[id] { scroll-margin-top: 64px; }
.page { max-width: 780px; margin: 0 auto; padding: 28px 16px 72px; display: flex; flex-direction: column; gap: 20px; }
.logo { width: 18px; height: 18px; flex-shrink: 0; }
.l-bg { fill: var(--ink); } .l-fg { fill: var(--bg); } .l-dim { opacity: .55; } .l-ac { fill: var(--accent); }

.card-ui.review { background: var(--card); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
.card-bar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 4px 16px; }
.review > .card-bar { padding: 12px 20px; border-bottom: 1px solid var(--line); }
.review > .card-bar h1 { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; }
.card-bar .mono { font-size: 12px; color: var(--faint); font-variant-numeric: tabular-nums; }
.content { padding: 18px 20px 20px; display: flex; flex-direction: column; gap: 10px; }
.title-words { font-size: 20px; font-weight: 600; line-height: 1.35; letter-spacing: -0.01em; }
.meta { font-size: 13.5px; color: var(--muted); }
.count { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-top: 8px; font-size: 13px;
  font-weight: 500; font-variant-numeric: tabular-nums; }
.sep { display: none; }
.count > a, .count > label { display: flex; flex-direction: column; justify-content: flex-start; gap: 2px; padding: 10px 12px;
  text-decoration: none; border: 1px solid var(--line); border-radius: 10px; background: var(--wash); color: var(--ink); }
.count > :hover { border-color: var(--line-strong); }
.count label.xl { text-decoration: none; }
.count .k { color: var(--muted); } .count .num { order: -1; font-size: 26px; font-weight: 600; line-height: 1.1;
  letter-spacing: -0.02em; }
.count .must-act { background: var(--red-bg); } .count .must-act .num { color: var(--red); }
.count .must-know .num { color: var(--amber); }
.count .tile.zero { background: var(--wash); } .count .tile.zero .num { color: var(--faint); }
.count .asks { grid-column: 1 / -1; }
.bar { display: flex; gap: 2px; height: 8px; margin-top: 6px; border-radius: 4px; overflow: hidden; }
.bar i { min-width: 4px; background: var(--muted); } .bar .s-notDone { background: var(--red); }
.bar .s-partly, .bar .s-doneCode { background: var(--amber); } .bar .s-done { background: var(--ink); opacity: .55; }
.bar [class*="s-notChecked"], .bar .s-laterWork { background: var(--line-strong); }
[class^="count-"] { font-size: 13.5px; color: var(--muted); }

.tabs { position: sticky; top: 0; z-index: 2; display: flex; gap: 4px; overflow-x: auto; scrollbar-width: none;
  margin: 0 -16px; padding: 0 16px; background: color-mix(in srgb, var(--bg) 82%, transparent);
  -webkit-backdrop-filter: saturate(180%) blur(14px); backdrop-filter: saturate(180%) blur(14px); box-shadow: inset 0 -1px var(--line); }
.tab { flex-shrink: 0; padding: 12px 10px 10px; font-size: 14px; font-weight: 500; color: var(--muted);
  text-decoration: none; border-bottom: 2px solid transparent; white-space: nowrap; }
.tab:hover { color: var(--ink); }
.tab-n { display: inline-block; min-width: 20px; margin-left: 4px; padding: 0 6px; font-size: 12px; text-align: center;
  color: var(--muted); background: var(--wash); border-radius: 999px; font-variant-numeric: tabular-nums; }
.panels { display: flex; flex-direction: column; gap: 32px; }
.panel { display: flex; flex-direction: column; gap: 24px; }
main .panels > .panel { display: none; }
${PANEL_IDS.map((id) => `#t-${id}:checked ~ .panels > #${id}`).join(', ')} { display: flex; }
${PANEL_IDS.map((id) => `#t-${id}:checked ~ .tabs .tab-${id}`).join(', ')} { color: var(--ink); border-bottom-color: var(--ink); }
${PANEL_IDS.map((id) => `#t-${id}:focus-visible ~ .tabs .tab-${id}`).join(', ')} { outline: 2px solid var(--accent-ink); outline-offset: -4px; }
.tab-r { position: absolute; opacity: 0; width: 1px; height: 1px; pointer-events: none; }
.tab { cursor: pointer; }
label.xl { cursor: pointer; text-decoration: underline; text-decoration-color: var(--line-strong); text-underline-offset: 3px; }
.panel [tabindex="-1"]:not(.part):focus { outline: 2px solid var(--accent-ink); outline-offset: 2px; }
.part > h2, .part > .card-bar h2, .fold-tier > summary h2 { font-size: 16px; font-weight: 600; letter-spacing: -0.005em; }
.part > .content { padding: 12px 0 0; }

.part.tier > h2 { padding-bottom: 8px; }
.item { padding: 16px 0 16px 16px; border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 8px;
  border-left: 2px solid transparent; }
#must-act > .item { border-left-color: var(--accent); }
summary .n { display: inline-block; min-width: 22px; font: 500 12px/1 var(--mono); color: var(--faint); }
.type { display: inline-block; font: 600 11.5px/1.7 var(--sans); letter-spacing: .03em; text-transform: uppercase;
  padding: 0 7px; border-radius: 5px; margin-right: 4px; vertical-align: 1px; color: var(--muted); background: var(--wash); }
.ty-fix { color: var(--red); background: var(--red-bg); } .ty-verify { color: var(--blue); background: var(--blue-bg); }
.ty-decide { color: var(--violet); background: var(--violet-bg); } .ty-read { color: var(--teal); background: var(--teal-bg); }

.kind-line { font-size: 14px; color: var(--muted); }
.stats { display: flex; flex-wrap: wrap; gap: 8px; margin: 2px 0 10px; }
.stat { display: inline-flex; flex-direction: column; min-width: 92px; padding: 8px 12px; border: 1px solid var(--line);
  border-radius: 10px; background: var(--wash); }
.stat .num { font-size: 22px; font-weight: 600; line-height: 1.15; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
.stat .k { font-size: 12.5px; color: var(--muted); }
.stat.tier-must-act, .stat.s-notDone { background: var(--red-bg); border-color: transparent; }
.stat.tier-must-act .num, .stat.s-notDone .num { color: var(--red); }
.stat.tier-must-know .num, .stat.s-partly .num, .stat.s-doneCode .num { color: var(--amber); }
.stat .k::first-letter { text-transform: uppercase; }
.stat.s-notChecked, .stat.s-notCheckedCode { border-style: dashed; }
.about { font-weight: 600; } .choice { font-weight: 500; }
.to { color: var(--muted); font-weight: 400; white-space: pre; }
.kind { font-size: 12px; font-weight: 500; padding: 0 8px; border-radius: 999px; color: var(--violet);
  background: var(--violet-bg); white-space: nowrap; }
.ask-row { display: grid; grid-template-columns: 52px 108px minmax(0, 1fr); column-gap: 12px; align-items: baseline; }
.ask-row .ak { font: 12px var(--mono); color: var(--faint); }
.ask-row > .tag { justify-self: start; white-space: normal; max-width: 100%; }
.ask-row .ln { display: block; }
.ask-row .at { grid-column: 3; display: flex; flex-wrap: wrap; gap: 4px; margin-top: 3px; }
.why, .flag { position: relative; font-size: 11.5px; font-weight: 600; padding: 0 7px; border-radius: 4px; white-space: nowrap;
  cursor: help; color: var(--amber); border: 1px dashed currentColor; }
.tip { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: normal; }
.why:hover > .tip, .why:focus > .tip, .flag:hover > .tip { z-index: 3; left: 0; top: calc(100% + 4px); width: max-content;
  max-width: 300px; height: auto; clip-path: none; padding: 6px 9px; border-radius: 6px; font-weight: 400; font-size: 12.5px;
  color: var(--bg); background: var(--ink); }
.why.soft, .flag.soft { color: var(--muted); } .count .sub { font-size: 12px; color: var(--muted); }
.ask-row .al { grid-column: 3; font-size: 13.5px; color: var(--muted); }
.ask-row .ad { grid-column: 3; margin-top: 2px; font-size: 13.5px; }
.ft { font-size: 11.5px; font-weight: 600; padding: 0 6px; border-radius: 4px; background: var(--wash);
  border: 1px solid var(--line-strong); }
.ft-added { color: light-dark(#166534, var(--green)); background: var(--green-bg); border-color: transparent; }
.ft-deleted { color: var(--red); background: var(--red-bg); border-color: transparent; }
.marks { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 8px; font-size: 12.5px; }
.mark { padding: 1px 9px; border-radius: 999px; border: 1px solid var(--line-strong); background: var(--card); font-weight: 500; }
.mark.o-ran-failed, .mark.o-failed-or-refused { background: var(--red-bg); border-color: transparent; }
.mark.o-did-not-run, .mark.o-stopped { background: var(--amber-bg); border-color: transparent; }
.marks > .k { min-width: 56px; font-weight: 600; color: var(--ink); margin-right: 2px; }
.files li { display: flex; flex-wrap: wrap; align-items: baseline; column-gap: 8px; }
.files .fw { font-style: italic; } .refs { font-size: 12.5px; color: var(--faint); }
.panel > .card-bar + .content { padding-top: 0; }
.trail.panel { gap: 0; } .trail.panel > h2 { margin-bottom: 12px; } .trail.panel > .stats { margin-bottom: 14px; }
.nc-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr)); gap: 14px; margin-top: 10px; }
.nc-card { padding: 4px 16px 14px; border: 1px solid var(--line); border-radius: 10px; background: var(--card); }
.checklist li { font-size: 14.5px; padding: 9px 0; } .checklist .tag { min-width: 92px; text-align: center; }
details.msgs { margin-top: 16px; } details.msgs > *:not(summary) { margin-top: 10px; }
details.row, .row.flat { padding: 10px 0 10px 12px; gap: 8px; }
.row > .sum { padding-left: 18px; }
details.row > summary, .row > .sum { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 12px; row-gap: 2px;
  align-items: baseline; color: var(--ink); font-size: 14.5px; font-weight: 500; line-height: 1.45; }
details.row[open] > summary { padding-bottom: 6px; }
details.row > summary:hover { background: var(--wash); border-radius: 6px; }
details.row > summary::before { color: var(--ink); border-width: 0 2px 2px 0; }
details.row[open] { background: var(--card); border-radius: 8px; }
.rm { display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; align-items: baseline; }
.chip { font: 12px/1.6 var(--mono); color: var(--muted); padding: 0 6px; border: 1px solid var(--line); border-radius: 4px;
  white-space: nowrap; max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
.pv { grid-column: 1 / -1; font-size: 13.5px; font-weight: 400; color: var(--muted); }
.pv.act { color: var(--ink); } .pv.act > .label { color: var(--blue); font-size: 11px; letter-spacing: .05em;
  text-transform: uppercase; margin-right: 6px; }
.rm .after { font-size: 12px; color: var(--muted); white-space: nowrap; }
.acts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.acts > details > summary { padding: 4px 12px 4px 26px; border: 1px solid var(--muted); border-radius: 999px;
  font-size: 12.5px; font-weight: 600; color: var(--ink); background: var(--wash); transition: transform 160ms var(--ease); }
.acts > details > summary:hover { border-color: var(--ink); background: var(--card); }
.prompt-box { position: relative; margin-top: 8px; }
.prompt-box > pre.agent-prompt-text { margin: 0; padding: 12px 48px 12px 14px; background: var(--card);
  border: 1px solid var(--line-strong); }
button.copy { position: absolute; top: 8px; right: 8px; width: 30px; height: 30px; display: grid; place-items: center;
  padding: 0; border: 1px solid var(--line-strong); border-radius: 6px; background: var(--wash); color: var(--muted);
  cursor: pointer; transition: transform 160ms var(--ease); }
button.copy:active, .acts > details > summary:active { transform: scale(0.97); }
button.copy.done svg { animation: in 160ms var(--ease); }
@keyframes in { from { opacity: 0; transform: scale(0.95); } }
button.copy:hover { color: var(--ink); border-color: var(--ink); } button.copy[hidden] { display: none; }
button.copy svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round;
  stroke-linejoin: round; }
button.copy .i-done, button.copy.done .i-copy { display: none; }
button.copy.done .i-done { display: block; } button.copy.done { color: var(--green); border-color: var(--green); }
.acts > details > summary::before { left: 10px; top: 50%; margin-top: -4px; }
.acts > details[open] { flex-basis: 100%; padding: 0; border: 0; }
.acts > details[open] > summary { margin-left: 0; display: inline-block; }
.scope { display: inline-block; font-size: 12px; font-weight: 500; padding: 0 7px; border-radius: 999px; color: var(--amber);
  background: var(--amber-bg); vertical-align: 1px; }
.plus { color: var(--green); } .minus { color: var(--red); }
#did label.xl { font-size: 12px; padding: 0 6px; border: 1px solid var(--line); border-radius: 4px; text-decoration: none;
  color: var(--muted); white-space: nowrap; }
.out { font-size: 13px; color: var(--muted); } .o-ran-failed, .o-failed-or-refused { color: var(--red); font-weight: 500; }
.o-did-not-run, .o-stopped { color: var(--amber); font-weight: 500; }
.tag.c-red { color: var(--red); background: var(--red-bg); border-color: transparent; }
.tag.c-dash { border-style: dashed; }
.tag.c-amber { color: var(--amber); background: var(--amber-bg); border-color: transparent; }
.item-quote { font-size: 14.5px; }
.line { font-size: 14.5px; line-height: 1.55; }
.label { font-size: 13px; font-weight: 600; color: var(--faint); }
.line .label, .note .label { margin-right: 4px; }
.kv { display: grid; grid-template-columns: 112px minmax(0, 1fr); column-gap: 10px; align-items: baseline; }
.kv > .label { font-size: 11px; line-height: 1.4; letter-spacing: .05em; text-transform: uppercase; }
.impact { font-weight: 500; } .impact > .label { color: var(--amber); } .action > .label { color: var(--blue); }
.where code { font-size: 12.5px; padding: 1px 5px; background: var(--wash); border: 1px solid var(--line); border-radius: 4px; }
q.said { quotes: "\\201C" "\\201D"; color: var(--ink); }
q.said::before, q.said::after { color: var(--accent-ink); font-weight: 600; }
q.said code { font: inherit; }
a.gh { font-size: 12.5px; color: var(--muted); }
.tag, mark.ask > small { display: inline-block; font: 500 12px/1.5 var(--sans); background: var(--wash);
  border: 1px solid var(--line-strong); border-radius: 4px; padding: 0 6px; margin-right: 4px; white-space: nowrap; }
.tag.s-notDone, .s-notDone > small, .tier-must-act { color: var(--red); background: var(--red-bg); border-color: transparent; }
.tag.s-partly, .s-partly > small, .tag.s-doneCode, .s-doneCode > small, .tier-must-know { color: var(--amber);
  background: var(--amber-bg); border-color: transparent; }
.tag.s-notChecked, .s-notChecked > small, .tag.s-notCheckedCode, .s-notCheckedCode > small { border-style: dashed; }
.note { font-size: 13.5px; line-height: 1.5; color: var(--muted); }
.cut { font-size: 13px; color: var(--muted); font-style: italic; }

details > summary { list-style: none; cursor: pointer; display: block; position: relative; padding-left: 18px;
  font-size: 13.5px; color: var(--muted); }
details > summary::-webkit-details-marker { display: none; }
details > summary::before { content: ""; position: absolute; left: 2px; top: calc(.75em - 3px); width: 6px; height: 6px;
  border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: rotate(-45deg);
  transition: transform .15s ease; }
details[open] > summary::before { transform: rotate(45deg); }
details > summary:hover { color: var(--ink); }
details.evidence > *:not(summary), details.agent-prompt > *:not(summary) { margin-top: 8px; }
details.evidence[open], details.agent-prompt[open] { padding: 0 0 4px 12px; border-left: 1px solid var(--line); }
details.evidence[open] > summary, details.agent-prompt[open] > summary { margin-left: -12px; }
pre { font: 12.5px/1.6 var(--mono); background: var(--wash); border: 1px solid var(--line); border-radius: 8px; }
pre.agent-prompt-text { padding: 10px 14px; white-space: pre-wrap; user-select: all; }
details.item.gtk, .item.gtk.flat { padding: 12px 0 12px 16px; }
details.item:not([open]) { gap: 0; }
details.item.gtk > summary { font-size: 14.5px; font-weight: 500; line-height: 1.5; color: var(--ink); }
details.item.gtk[open] > summary { padding-bottom: 6px; }
.members { display: flex; flex-direction: column; gap: 10px; margin-top: 4px; }
.member { border-left: 2px solid var(--line-strong); padding: 2px 0 2px 12px; display: flex;
  flex-direction: column; gap: 6px; }
.member-head, details.member > summary { font-size: 14.5px; font-weight: 500; color: var(--ink); }
.member .tier-word { color: var(--muted); }
.fold-tier > summary { padding-bottom: 8px; color: var(--ink); }
.fold-tier > summary h2 { display: inline; }
.trail-more { padding: 12px 0; border-top: 1px solid var(--line); }
.after { color: var(--muted); font-weight: 400; }
.trail-more > summary { font-size: 13.5px; font-weight: 500; color: var(--muted); }
.trail-above { font-size: 14.5px; font-weight: 500; padding: 10px 0 10px 16px; border-top: 1px solid var(--line); }
.trail .item.gtk { border-left: none; }
.tier-tag { margin: 0 0 0 2px; }
.sub-h { font-size: 14px; font-weight: 600; margin-top: 20px; padding-bottom: 6px; border-bottom: 1px solid var(--line); }
.content > .sub-h:first-child { margin-top: 0; }
h4.label { margin-top: 10px; }

.message-block { padding: 12px 0; border-top: 1px solid var(--line); }
.message-block:first-child { border-top: none; padding-top: 0; }
.message { font-size: 15px; line-height: 1.65; white-space: pre-wrap; }
mark.ask { background: none; color: inherit; border-bottom: 2px solid var(--accent-edge); padding: 1px 0; }
mark.ask > small { display: inline-block; font: 500 12px/1.5 var(--sans); background: var(--wash);
  border: 1px solid var(--line-strong); border-radius: 4px; padding: 0 6px; margin-right: 4px; white-space: nowrap; }
mark.ask.s-notDone, mark.ask.s-partly, mark.ask.s-doneCode, mark.ask.s-notCheckedCode { border-bottom-color: var(--accent); }
.join { color: var(--faint); }

.rows { list-style: none; padding: 0; display: flex; flex-direction: column; }
.rows li, .files li { font-size: 14px; line-height: 1.5; padding: 7px 0; border-top: 1px solid var(--line); }
.rows li:first-child, .files li:first-child { border-top: none; }
ol.rows.runs { list-style: decimal; padding-left: 28px; }
ol.rows.runs li::marker { color: var(--faint); font: 12px var(--mono); }
.files { list-style: none; padding: 0; }
pre.diff { padding: 8px 0; overflow-x: auto; }
pre.diff .lines { display: inline-block; min-width: 100%; }
pre.diff .ln { display: block; padding: 0 14px; white-space: pre; }
pre.diff .gutter { color: var(--faint); }
pre.diff .add { background: var(--add); }
.cmd code { display: block; font-size: 12px; background: var(--wash); border-radius: 6px; padding: 6px 10px; }

.foot { display: flex; flex-direction: column; gap: 8px; padding-top: 20px; border-top: 1px solid var(--line);
  font-size: 13px; color: var(--muted); }
.foot .gen { font-family: var(--mono); font-size: 12px; color: var(--faint); }
.foot details > *:not(summary) { margin-top: 6px; }
@media (max-width: 560px) { .content { padding: 16px; } .title-words { font-size: 18px; }
  details.row > summary, .row > .sum { grid-template-columns: minmax(0, 1fr); } .rm { justify-content: flex-start; }
  .ask-row { grid-template-columns: 44px minmax(0, 1fr); } .ask-row .aw, .ask-row .at, .ask-row .al { grid-column: 1 / -1; }
  .count { gap: 6px; } .count > a, .count > label { padding: 8px 6px; }
  .count .num { font-size: 20px; } .count .k, .count .sub { font-size: 11.5px; overflow-wrap: normal; }
  .tabs { flex-wrap: wrap; overflow-x: visible; column-gap: 0; } .tab { padding: 10px 8px 8px; }
  [id] { scroll-margin-top: 104px; }
  .ask-row .ad { grid-column: 1 / -1; }
  .kv { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 359px) { .count { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media print {
  .tabs { display: none; }
  main .panels > .panel { display: flex !important; }
  .tip { position: static; width: auto; height: auto; clip-path: none; }
  details::details-content { content-visibility: visible; }
  summary .flag:not(.soft) > .tip { display: none; }
  button.copy { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  details > summary::before, button.copy, .acts > details > summary { transition: none; } button.copy.done svg { animation: none; }
  button.copy:active, .acts > details > summary:active { transform: none; }
}
@media (prefers-reduced-transparency: reduce) { .tabs { background: var(--bg); backdrop-filter: none; } }
`;

/** D193: the stylesheet as the page carries it: each line break and the indent after it one space, so a page near its
 *  bound keeps its room for the review. D195: and no space around `{`, `}`, `;`, `,` or `>`, or after `:` (a space before
 *  `:` is a descendant combinator and stays), and no `;` before `}`. */
const PAGE_STYLE = PAGE_CSS.replace(/\n\s*/g, ' ').replace(/\s*([{};,>])\s*/g, '$1').replace(/:\s+/g, ':')
  .replace(/;}/g, '}').trim();

/**
 * D104: the page never links to a place it does not hold. A run, a claim or an item that a trim of the page or a list's
 * bound left out keeps its words, without the link. Structure of the page's own markup only: every in-page link the
 * page writes is `<a href="#id">…</a>` with no link inside it, and recorded text is escaped, so it never holds one.
 */
function heldLinks(html) {
  const ids = new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
  return html.replace(/<a href="#([^"]+)"(?: class="[^"]*")?>([\s\S]*?)<\/a>/g, (link, id, inner) => (ids.has(id) ? link : inner));
}

/** D193: the page's tabs, in the panels' order, each with its count when it has one. D195 (the owner, 2026-10-30: the
 *  tabs did not open in the Claude app's preview, where a link cannot move the page): each tab is the label of a radio
 *  button, before the tabs and the panels, the first checked; the stylesheet shows the panel whose radio is checked.
 *  A click checks a radio wherever the page is shown, with no script and no navigation. */
function tabsHtml(model, panels) {
  const ids = panels.map((p) => / id="([^"]+)"/.exec(p)[1]);
  const counts = { review: ['must_act', 'must_know', 'good_to_know'].reduce((n, t) => n + model.tiers[t].length, 0),
    decisions: model.decisions?.total ?? null, prompt: model.prompt.asks.length, did: null,
    'not-checked': model.notChecked.total };
  // D202: a radio's name says its tab's count too, as the tab does.
  const radio = (id, at) => `<input class="tab-r" type="radio" name="tab" id="t-${id}" aria-label="`
    + `${esc(REPORT_TAB_WORDS[TAB_OF[id]])}${Number.isSafeInteger(counts[id]) ? ` ${counts[id]}` : ''}"${at === 0 ? ' checked' : ''}>`;
  const tab = (id) => `<label class="tab tab-${id}" for="t-${id}">${esc(REPORT_TAB_WORDS[TAB_OF[id]])}`
    + `${Number.isSafeInteger(counts[id]) ? ` <span class="tab-n">${counts[id]}</span>` : ''}</label>`;
  return `${ids.map(radio).join('')}<nav class="tabs" aria-label="${esc(REPORT_TAB_WORDS.nav)}">${ids.map(tab).join('')}</nav>`;
}
/** D195: a link to a place in another panel (or from outside the panels to a panel) is the label of that panel's radio,
 *  so a click opens the panel the place is in, wherever the page is shown; it keeps where it pointed (`data-href`). A
 *  link within one panel stays a link. Structure of the page's own markup only, as `heldLinks`. */
function tabLinks(html) {
  const starts = [...html.matchAll(/<(?:div|section) class="[^"]*\bpanel\b[^"]*" id="([^"]+)"/g)]
    .map((m) => ({ at: m.index, id: m[1] }));
  const end = html.indexOf('<footer');
  const panelAt = (at) => (at > end ? null : starts.filter((p) => p.at <= at).at(-1)?.id ?? null);
  const where = new Map([...html.matchAll(/ id="([^"]+)"/g)].map((m) => [m[1], panelAt(m.index)]));
  // D199: a link's title (the header's decisions tile) goes with it onto its label.
  return html.replace(/<a href="#([^"]+)"(?: class="([^"]*)")?( title="[^"]*")?>([\s\S]*?)<\/a>/g, (link, id, cls, title, inner,
    at) => {
    const panel = where.get(id) ?? null;
    return panel && panel !== panelAt(at) ? `<label class="xl${cls ? ` ${cls}` : ''}" for="t-${panel}" data-href="#${id}"`
      + `${title ?? ''}>${inner}</label>` : link;
  });
}

/** One composition of the page: which folds keep only their summary, and the factor every list is cut by. */
function compose(model, theme, trim) {
  const card = `<article class="card-ui review" aria-labelledby="review-title"><div class="card-bar">`
    + `<h1 id="review-title">${LOGO}${esc(REPORT_HEADER_WORDS.review)}</h1><span class="mono">${esc(model.header.size
      .join(' · '))}</span></div><div class="content">${headerHtml(model)}</div></article>`;
  // D131 (R1, B12): Must act and Must know before your prompt (`promptAfterTiers`), so what needs your action is on the
  // first screen; Good to know, folded, after it.
  const tiers = tiersHtml(model, trim);
  const prompt = promptHtml(model, trim);
  // D193: each part of the review is a panel, and a tab names it (`tabsHtml`); the findings (Must act, Must know, Good
  // to know) are one panel. D161: the first part, then the second (the agent's decisions), then your prompt when it
  // comes after the tiers.
  const review = `<div class="panel" id="review">${tiers.must}${tiers.good}</div>`;
  const panels = [...(promptAfterTiers(model) ? [review, tiers.trail, prompt] : [prompt, review, tiers.trail]),
    didHtml(model, trim.did), notCheckedHtml(model, trim.notChecked, trim.did)].filter(Boolean);
  const body = [card, tabsHtml(model, panels), `<div class="panels">`, ...panels, '</div>', footerHtml(model)];
  // One list item a line, so a reader of the source (and a snapshot's diff) can follow it. Recorded text never holds a
  // tag (it is escaped), and no list item is inside a <pre>, so this changes no rendered text.
  const html = tabLinks(heldLinks(body.join('\n'))).replace(/<\/li>/g, '</li>\n').replace(/<\/article>/g, '</article>\n');
  // D199: the page's script only on a page that holds a copy button, D203: or an in-page link; the policy allows it by
  // its hash, and only then.
  const script = html.includes('<button type="button" class="copy"') || /data-href="#|<a href="#/.test(html);
  const themeAttribute = theme === SYSTEM ? '' : ` data-theme="${theme}"`;
  const colorScheme = theme === SYSTEM ? 'light dark' : theme;
  const title = model.header.title ? model.header.title.text : REPORT_HEADER_WORDS.review;
  return `<!doctype html>
<html lang="en"${themeAttribute}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';${script ? ` script-src '${PAGE_SCRIPT_HASH}';` : ''} base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="${colorScheme}">
<meta name="generator" content="${PAGE_VERSION} ${REPORT_MODEL_VERSION}">
<title>${esc(title)}</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<main class="page">
${html}
</main>${script ? `\n<script>${PAGE_SCRIPT}</script>` : ''}
</body>
</html>
`;
}

/**
 * What each composition leaves out, in order, until the page fits `maxBytes` (D97): nothing; a long message keeps only
 * its start, and a message that holds no ask its start (your own words, which you hold: the evidence is what only the
 * page shows), D204 (the owner, 2026-10-31: "Cut longest first") one message at a time, the longest first, until the
 * page fits or every long message is cut; then (D161) the detail folds of the agent's decisions keep their summary only, and (D202) your asks' evidence
 * folds go; then the evidence folds of
 * Good to know keep their summary only; then those of Must know and Must act;
 * then the lists of what the agent did and the messages that hold no ask are halved until empty; then the lists of what
 * Sonah could not check. The visible lines of every item stay, and so does the open start of each message that holds
 * an ask.
 */
function* compositions(model) {
  // D204: your long messages (past `messageChars`), those that hold an ask and those that hold none, longest first (then
  // by number), each a key of `trim.messages` once the trim cuts it.
  const prompt = model.prompt;
  const long = [...prompt.messages, ...prompt.emptyMessages, ...list(prompt.unreachedMessages)]
    .filter((m) => m.chars > REPORT_LIMITS.messageChars).sort((a, b) => b.chars - a.chars || a.k - b.k).map((m) => m.k);
  const none = { messages: new Set(), trail: false, goodToKnow: false, items: false, did: 1, notChecked: 1 };
  yield none;
  for (let n = 1; n < long.length; n++) yield { ...none, messages: new Set(long.slice(0, n)) };
  const all = new Set(long);
  if (long.length) yield { ...none, messages: all };
  // D161: the agent's decisions' detail folds keep their summary first, before any fold of the first part.
  const cut = { ...none, messages: all, trail: true };
  yield cut;
  yield { ...cut, goodToKnow: true };
  yield { ...cut, goodToKnow: true, items: true };
  for (let did = 1 / 2; did >= 1 / 1024; did /= 2) yield { ...cut, goodToKnow: true, items: true, did };
  yield { ...cut, goodToKnow: true, items: true, did: 0 };
  for (let nc = 1 / 2; nc >= 1 / 1024; nc /= 2) yield { ...cut, goodToKnow: true, items: true, did: 0, notChecked: nc };
  yield { ...cut, goodToKnow: true, items: true, did: 0, notChecked: 0 };
}

/**
 * The review page of one session, as one self-contained HTML document: the report model (report-model.js
 * `reportModel`) of `session` (the Session the adapter built) and `report` (the finished review report). `options`:
 * `title` names the page; `theme` is one of `PAGE_THEMES` (`system` unless given); `sessionHash` (redact/index.js
 * `sliceHash`) names the session in the answer command; `decisionReviews` your earlier answers, by row id; `repo`,
 * `github` and `sonahVersion` the CLI's facts (D97). Pure: the same inputs give the same bytes.
 */
export function renderSessionPage(session, report, options = {}) {
  return sessionPage(session, report, options).html;
}

/** The page (`renderSessionPage`) and whether it needed no size trim: `{ html, whole }`, `whole` false when the page had
 *  to leave something out to fit `PAGE_LIMITS.maxBytes`. Either way the page keeps the display limits of report-model.js
 *  REPORT_LIMITS and counts what each list leaves out (D176). The CLI passes `whole` to the Markdown report it writes
 *  beside the page. Pure. */
export function sessionPage(session, report, options = {}) {
  const opts = plain(options) ? options : {};
  const model = reportModel(session, plain(report) ? report : {}, opts);
  const theme = PAGE_THEMES.includes(opts.theme) ? opts.theme : SYSTEM;
  // D171 fix round: the line that a newer Sonah is out is not weighed, so the page leaves out what it would leave out
  // without it, `whole` is the same, and the .md made with `whole` is too; the page may pass `maxBytes` by that line.
  // D219: nor is the header's line about the graphs page (its link, or why it was not drawn), for the same reason.
  const unweighed = bytes(newerHtml(model.footer)) + bytes(graphsHtml(model.header));
  let html = '';
  let whole = true;
  for (const trim of compositions(model)) {
    html = compose(model, theme, trim);
    if (bytes(html) - unweighed <= PAGE_LIMITS.maxBytes) break;
    whole = false;
  }
  return { html, whole };
}
