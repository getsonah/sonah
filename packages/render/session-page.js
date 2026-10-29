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
//      a CSP that allows only the inline style, no script, no external resource. The only links out are GitHub commit
//      permalinks the report model built from validated local git facts (D97 amends this rule); every other link is an
//      in-page anchor. The page is bounded (`PAGE_LIMITS`): only the visible lines of the items and the open start of
//      each message that holds an ask are never cut. Every cut is stated where it happens.
//   4. Fold, never drop: every row of the review is placed once (report-model.js `reportPlacement`); a fold's summary
//      carries its count.

import { visible, backtickPieces, noFilesWords } from './session-story.js';
import { CODE_REPORT_WORDS } from '../evidence/src/code-report.js';
import { reportModel, REPORT_MODEL_VERSION, REPORT_LIMITS, scopeMarker, foldNotes, askStatusWord, promptAfterTiers,
  agentPromptText, reportItems } from './report-model.js';
import { REPORT_TIER_WORDS, REPORT_TYPE_WORDS, REPORT_HEADER_WORDS, REPORT_COUNT_WORDS, REPORT_SECTION_WORDS,
  REPORT_ITEM_WORDS, REPORT_PROMPT_WORDS, REPORT_DID_WORDS, REPORT_NOT_CHECKED_WORDS, REPORT_TRIM_WORDS,
  REPORT_FOOTER_WORDS, REPORT_CAUSE_WORDS, REPORT_GAP_WORDS, REPORT_COLUMN_REASON_WORDS, REPORT_ANSWER_WORDS,
  REPORT_SEEN_WORDS, REPORT_AGENT_PROMPT_WORDS, REPORT_TRAIL_WORDS } from './report-words.js';

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
 *  such fact is as before, byte for byte. */
export const PAGE_VERSION = 'sonah.session-page/46';

/** The page's colour themes. `system` (the default) follows the reader's setting; `light` and `dark` fix the theme. */
export const PAGE_THEMES = Object.freeze(['system', 'light', 'dark']);
const [SYSTEM] = PAGE_THEMES;

/** The page's bounds. `maxBytes` is the bound on the whole page: past it a long message keeps only its start (its whole
 *  text is not folded below it, and a message that holds no ask shows its start), then the evidence folds of Good to know
 *  keep their summary only, then those of Must know and Must act, then the lists of what the agent did and the messages
 *  that hold no ask are halved until empty, then the lists of what Sonah could not check — each said where it happens
 *  (D97). Only the visible lines of the items and the open start of each message that holds an ask are never cut. The
 *  footer's line that a newer Sonah is out (D171) is not weighed against `maxBytes`. The report model's display bounds
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
const list = (value) => (Array.isArray(value) ? value : []);
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const bytes = (text) => Buffer.byteLength(text, 'utf8');
const ANCHOR = /^(?:ask|item|run|claim|not-checked|did|prompt)(?:-[A-Za-z0-9]+)?$/;
const GITHUB_URL = /^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/blob\/(?:[0-9a-f]{40}|[0-9a-f]{64})\/[^\s"'<>]*$/;
const SHORT_ID = 12;
const shortId = (id) => (typeof id === 'string' && id.startsWith('sha256:') ? id.slice(7, 7 + SHORT_ID) : String(id ?? ''));

/** One text part of the report model, as markup: a verbatim quote in highlighted quotation marks (the cut outside them),
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
const labelled = (label, html, cls = 'line') => `<p class="${cls}">${label ? `<span class="label">${esc(label)}</span> ` : ''}${html}</p>`;
/** A GitHub permalink, only when it has the form the report model builds. */
const gitHubLink = (url) => (typeof url === 'string' && GITHUB_URL.test(url)
  ? ` <a class="gh" href="${esc(url)}" rel="noreferrer noopener">${esc(REPORT_ITEM_WORDS.onGitHub)}</a>` : '');
const placeText = (w) => `${w.path}${Number.isSafeInteger(w.startLine) ? `:${w.startLine}${Number.isSafeInteger(w.endLine)
  && w.endLine > w.startLine ? `-${w.endLine}` : ''}` : ''}`;

// ---- the header and the count line --------------------------------------------------------------------------------

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
  const notChecked = [...header.reviewIncomplete.map(esc)];
  if (header.didNotCheck) notChecked.push(`${esc(header.didNotCheck.lead)} ${header.didNotCheck.phrases.map(esc).join(' · ')}`
    + `${header.didNotCheck.more ? ` <a href="#not-checked">${esc(header.didNotCheck.more)}</a>` : ''}`);
  if (notChecked.length) out.push(`<p class="meta not-checked">${notChecked.join(' ')}</p>`);
  const tiers = countLine.tiers.map((t) => `<a href="#${t.tier.replace(/_/g, '-')}">${esc(REPORT_COUNT_WORDS.tier(t.words, t.n))}`
    + `${t.folded ? ` ${esc(REPORT_COUNT_WORDS.folded)}` : ''}</a>`).join(' · ');
  // D161: the agent's decisions, counted after the tiers.
  const decisions = countLine.decisions ? ` · <a href="#decisions">${esc(countLine.decisions.words)}</a>` : '';
  out.push(`<p class="count">${tiers}${decisions} · <a href="#prompt">${esc(countLine.prompt)}</a></p>`);
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
    out.push(`<mark class="ask s-${esc(seg.state)}"${id}>${seg.first ? `<span class="tag">${esc(status)}</span>` : ''}`
      + `${codeHtml(text)}</mark>`);
  }
  return { html: out.join(''), cut: total > room };
}

/** Your prompt. Past the page's size (`trim.messages`), a long message keeps only its start: its whole text is not
 *  folded below it, and a message that holds no ask shows its start. The messages that hold no ask are a list, cut by
 *  `trim.did` like the lists of what the agent did. Each trim is said once, where it happens. */
function promptHtml(model, trim) {
  const { prompt } = model;
  const ids = new Set();
  const asks = new Map(prompt.asks.map((a) => [a.n, a]));
  let messagesCut = false;
  const blocks = prompt.messages.map((m) => {
    const start = m.cutAt === null ? segmentsHtml(m.segments, Infinity, ids) : segmentsHtml(m.segments, m.cutAt, ids);
    if (m.cutAt !== null && trim.messages) messagesCut = true;
    const whole = m.cutAt === null || trim.messages ? '' : `<details class="whole"><summary>`
      + `${esc(REPORT_SECTION_WORDS.wholeMessage)}</summary><p class="message">${segmentsHtml(m.segments, Infinity, ids).html}`
      + '</p></details>';
    const extras = [m.attached ? REPORT_PROMPT_WORDS.attached(m.attached) : null, m.pasted].filter(Boolean)
      .map((t) => `<p class="note">${esc(t)}</p>`).join('');
    const listed = (numbers, lead) => {
      const shown = numbers.map((n) => asks.get(n)).filter((a) => a && a.words.length);
      return shown.length ? `<p class="note">${esc(lead)}</p><ul class="rows">` + shown.map((a) => `<li${ids.has(a.n) ? ''
        : (ids.add(a.n), ` id="ask-${a.n}"`)}>${esc(REPORT_PROMPT_WORDS.askLine(a.n))} · <span class="tag s-${esc(a.state)}">`
        + `${esc(a.status)}</span> · ${partsHtml(a.words)}</li>`).join('') + '</ul>' : '';
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
  const lines = prompt.asks.filter((a) => a.lines.length || a.folded.length || !ids.has(a.n)).map((a) => {
    const unmarked = !ids.has(a.n);
    const id = unmarked ? (ids.add(a.n), ` id="ask-${a.n}"`) : '';
    const folded = a.folded.length ? ` · <details class="row-evidence"><summary>${esc(REPORT_ITEM_WORDS.evidence)}</summary>`
      + `${a.folded.map((line) => `<p class="note">${partsHtml(line)}</p>`).join('')}</details>` : '';
    return `<li${id}>${esc(REPORT_PROMPT_WORDS.askLine(a.n))} · <span class="tag s-${esc(a.state)}">${esc(a.status)}</span>`
      + `${unmarked && a.words.length ? ` · ${partsHtml(a.words)}` : ''}${a.lines.map((line) => ` · ${partsHtml(line)}`)
        .join('')}${folded}</li>`;
  });
  // The messages that hold no ask, as recorded (a join between two recorded spans is Sonah's), each its start when cut.
  const noAsk = prompt.emptyMessages;
  const noAskShown = noAsk.slice(0, cap(noAsk.length, trim.did));
  const room = trim.messages ? REPORT_LIMITS.messageChars : Infinity;
  if (noAskShown.some((m) => m.chars > room)) messagesCut = true;
  const empty = noAsk.length ? `<details class="fold"><summary>${esc(REPORT_SECTION_WORDS.noAskMessages(noAsk.length))}`
    + `</summary><ul class="rows">${noAskShown.map((m) => { const shown = segmentsHtml(m.segments, room, ids);
      return `<li><p class="message">${shown.html}${shown.cut ? '…' : ''}</p>${m.pasted ? `<p class="note">${esc(m.pasted)}</p>`
        : ''}</li>`; }).join('')}</ul>${noAsk.length > noAskShown.length ? `<p class="cut">${esc(REPORT_NOT_CHECKED_WORDS
      .rowsNotShown(noAsk.length - noAskShown.length))}</p>` : ''}</details>` : '';
  // D131 (R1): a long session's prompt is folded, its count in the fold's summary, as What the agent did is.
  const heading = `<h2>${esc(REPORT_SECTION_WORDS.promptCounted(prompt.asks.length, prompt.parts.join(', ')))}</h2>`;
  const [open, close] = prompt.folded === true
    ? [`<details class="card-ui part fold-part" id="prompt"><summary class="card-bar">${heading}</summary>`, '</details>']
    : [`<section class="card-ui part" id="prompt"><div class="card-bar">${heading}</div>`, '</section>'];
  return `${open}<div class="content">`
    + (messagesCut ? `<p class="cut">${esc(REPORT_TRIM_WORDS.messagesTrimmed)}</p>` : '')
    + (noAskShown.length < noAsk.length ? `<p class="cut">${esc(REPORT_TRIM_WORDS.listsTrimmed)}</p>` : '')
    + (prompt.asks.length ? '' : `<p class="note">${esc(REPORT_COUNT_WORDS.noAsk)}</p>`)
    + placed.join('') + (lines.length ? `<ul class="rows ask-lines">${lines.join('')}</ul>` : '') + empty
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
  return places.length || marker.length ? labelled(REPORT_ITEM_WORDS.where, [...places, ...marker].join(' · '), 'line where')
    : '';
}
function evidenceHtml(item, trimmed) {
  const summary = `${esc(REPORT_ITEM_WORDS.evidence)} · ${esc(REPORT_ITEM_WORDS.why(REPORT_TIER_WORDS[item.tier.final]))}`;
  // D133 (R2): what Sonah could not check of the item, first in its fold (`foldNotes`); kept when the fold is shortened
  // to its summary, as it was kept on the item's visible lines before.
  const notes = foldNotes(item).map((t) => `<p class="note">${esc(t)}</p>`).join('');
  if (trimmed) return `<details class="evidence"><summary>${summary}</summary>${notes}</details>`;
  const lines = item.evidence.map((e) => labelled(e.label, partsHtml(e.parts)));
  const noLink = [...new Set(item.where.map((w) => w.noLink).filter(Boolean))].map((t) => `<p class="note">${esc(t)}</p>`);
  const id = item.rowId ? labelled(REPORT_ITEM_WORDS.rowId, `<code>${esc(shortId(item.rowId))}</code>`, 'note') : '';
  // Your earlier answer is your own words, escaped, and never in a recorded quote's quotation marks.
  const answer = item.answer ? labelled(REPORT_ITEM_WORDS.yourAnswer, `${esc(item.answer.words)} `
    + `<span class="answer-reason">${esc(item.answer.reason)}</span>`, 'note answer') : '';
  return `<details class="evidence"><summary>${summary}</summary>${notes}${lines.join('')}${noLink.join('')}`
    + `<p class="note why">${esc(item.why)}</p>${id}${answer}</details>`;
}
/** D144: the prompt for the agent of an item that leads in Must act, folded: the note on its voice, then the
 *  prompt as plain text in a `<pre>` that one click selects whole (CSS `user-select: all`; the page runs no script). */
const agentPromptHtml = (prompt) => `<details class="agent-prompt"><summary>${esc(REPORT_AGENT_PROMPT_WORDS.fold)}`
  + `</summary><p class="note">${esc(REPORT_AGENT_PROMPT_WORDS.voice)}</p><pre class="agent-prompt-text">`
  + `${esc(agentPromptText(prompt))}</pre></details>`;
/** The lines of an item or a member (D97, D112), in order, then (D144) the prompt for the agent of an item that has one,
 *  left out with the evidence when the page is shortened, then its evidence fold. */
function linesHtml(item, trimmed) {
  const out = [];
  if (item.quote) out.push(`<blockquote class="item-quote">${item.quoteLabel ? `<span class="label">${esc(item.quoteLabel)}</span> `
    : ''}${partHtml(item.quote)}</blockquote>`);
  // D110: each premise of an item to verify that Sonah could not check, in its check's words.
  for (const parts of list(item.restsOutside)) out.push(labelled(REPORT_ITEM_WORDS.restsOutside, partsHtml(parts),
    'line rests-outside'));
  if (item.impact) out.push(labelled(REPORT_ITEM_WORDS.impact, partsHtml(item.impact), 'line impact'));
  if (item.agentSaid) out.push(labelled(item.agentSaidLabel ?? REPORT_ITEM_WORDS.agentSaid, partHtml(item.agentSaid),
    'line agent-said'));
  // D163: a change of approach's reason in the session review's words, on its own line, after the agent's own.
  if (item.reviewWhy) out.push(labelled(REPORT_ITEM_WORDS.reviewWhy, partsHtml(item.reviewWhy), 'line review-why'));
  if (item.action) out.push(labelled(REPORT_ITEM_WORDS.action, partsHtml(item.action), 'line action'));
  out.push(whereHtml(item));
  out.push(excerptHtml(item.where[0]?.excerpt));
  if (item.agentPrompt && !trimmed) out.push(agentPromptHtml(item.agentPrompt));
  out.push(evidenceHtml(item, trimmed));
  return out.join('');
}
/** D112: the members of an item, after its own lines: the line that counts them, then each one, its type word, what it
 *  is and its own tier word, then its lines; folded (`<details>`) when the model folds it. */
function membersHtml(item, trimmed) {
  const members = list(item.members);
  if (!members.length) return '';
  return `<div class="members"><p class="note">${esc(REPORT_ITEM_WORDS.members(members.length))}</p>${members.map((m) => {
    const head = `<strong class="type">${esc(REPORT_TYPE_WORDS[m.type])}:</strong> ${partsHtml(m.what.parts)} · `
      + `<span class="tier-word">${esc(REPORT_TIER_WORDS[m.tier.final])}</span>`;
    return m.folded ? `<details class="member"><summary>${head}</summary>${linesHtml(m, trimmed)}</details>`
      : `<div class="member"><p class="member-head">${head}</p>${linesHtml(m, trimmed)}</div>`;
  }).join('')}</div>`;
}
/** The visible lines of an item (D97), in order, then its evidence fold, then its members (D112). */
function itemBody(item, trimmed) {
  // D113 amended: the model's one marker (`scopeMarker`), an item outside the evaluated session's among them.
  const marker = scopeMarker(item.scope).trim();
  const scope = marker ? ` <span class="scope">${esc(marker)}</span>` : '';
  return { head: `<span class="n">${item.n}</span> <strong class="type">${esc(REPORT_TYPE_WORDS[item.type])}:</strong> `
    + `${partsHtml(item.what.parts)}${scope}`, body: linesHtml(item, trimmed) + membersHtml(item, trimmed) };
}
function itemHtml(item, trimmed) {
  const { head, body } = itemBody(item, trimmed);
  return `<article class="item t-${esc(item.type)}" id="item-${item.n}"><p class="item-head">${head}</p>${body}</article>`;
}
function goodToKnowHtml(item, trimmed) {
  const { head, body } = itemBody(item, trimmed);
  const where = item.where.slice(0, 1).map((w) => (w.anchor ? w.text : placeText(w)));
  return `<details class="item gtk t-${esc(item.type)}" id="item-${item.n}"><summary>${head}`
    + `${where.length ? ` · <span class="mono">${esc(where[0])}</span>` : ''}</summary>${body}</details>`;
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
/** D163 (L1): a tier's pointers to the decisions of the second part tagged with it, under their heading: each the
 *  decision's number, type word and what it is, linked to its line there, then its marker and its ask. Empty with
 *  none. Never shortened: a line each. */
function pointersHtml(model, tier) {
  const pointers = list(model.pointers?.[tier]);
  if (!pointers.length) return '';
  const line = (p) => {
    const marker = scopeMarker(p.scope).trim();
    return `<li><a href="#item-${p.n}"><span class="n">${p.n}</span> <strong class="type">`
      + `${esc(REPORT_TYPE_WORDS[p.type])}:</strong> ${partsHtml(p.what.parts)}</a>`
      + `${marker ? ` <span class="scope">${esc(marker)}</span>` : ''}${p.scope.asks.length ? ` · <a href="#ask-`
        + `${p.scope.asks[0]}">${esc(REPORT_ITEM_WORDS.asked(p.scope.asks[0]))}</a>` : ''}</li>`;
  };
  return `<h3 class="sub-h">${esc(REPORT_TRAIL_WORDS.taggedHere(REPORT_TIER_WORDS[tier], pointers.length))}</h3>`
    + `<ul class="rows pointers">${pointers.map(line).join('')}</ul>`;
}
/** D163: the line of a decision that the first part shows, at its place in the second part: its type word, what it
 *  is and its marker, a link to its item there, and its tag. */
function trailAboveHtml(entry) {
  const marker = scopeMarker(entry.scope).trim();
  return `<p class="trail-above"><strong class="type">${esc(REPORT_TYPE_WORDS[entry.type])}:</strong> `
    + `${partsHtml(entry.what.parts)}${marker ? ` <span class="scope">${esc(marker)}</span>` : ''} · `
    + `<a href="#item-${entry.n}">${esc(REPORT_TRAIL_WORDS.shownAbove(entry.n))}</a> · `
    + `<span class="tag tier-tag">${esc(REPORT_TIER_WORDS[entry.tier])}</span></p>`;
}
/** D161: one decision of the report's second part: a fold whose summary is its line (its number, type word, what it is,
 *  its marker, the ask its instruction ties it to, and its tier as a tag), and whose body is the item's own lines. */
function trailItemHtml(item, trimmed) {
  const { head, body } = itemBody(item, trimmed);
  const ask = item.scope.asks.length ? ` · <a href="#ask-${item.scope.asks[0]}">${esc(REPORT_ITEM_WORDS
    .asked(item.scope.asks[0]))}</a>` : '';
  return `<details class="item gtk trail-item t-${esc(item.type)}" id="item-${item.n}"><summary>${head}${ask} · `
    + `<span class="tag tier-tag">${esc(REPORT_TIER_WORDS[item.tier.final])}</span></summary>${body}</details>`;
}
/** D161: the report's second part, the agent's decisions in the order the session recorded them: one fold a group, open
 *  when the model opens it, its summary whose message it follows and its count; inside, that message's asks, then each
 *  decision's line. D163: each entry the model shows in it (`shown`), a decision that the first part shows by its line
 *  there; then, in an open group, one fold that counts the rest (`more`, tagged Good to know) and holds them in order.
 *  Empty with no decision. */
function trailHtml(model, trim) {
  const decisions = model.decisions;
  if (!decisions?.total) return '';
  // Lowest tier first, as the first part (its review): a decision tagged Good to know keeps only its summary with Good to
  // know's (`trail`); one tagged Must act or Must know only with Must act's and Must know's (`items`). Every line stays.
  const cut = (item) => (['must_act', 'must_know'].includes(item.tier.final) ? trim.items : trim.trail);
  const all = decisions.groups.flatMap((g) => g.items);
  const note = all.some(cut) ? `<p class="cut">${esc(REPORT_TRIM_WORDS.trimmed)}</p>` : '';
  const entryHtml = (e) => (e.above ? trailAboveHtml(e) : trailItemHtml(e.item, cut(e.item)));
  const groups = decisions.groups.map((g) => {
    const asks = g.askLines.map((a) => `<li><a href="#ask-${a.n}">${esc(REPORT_PROMPT_WORDS.askLine(a.n))}</a> · `
      + `<span class="tag s-${esc(a.state)}">${esc(a.status)}</span> · ${partsHtml(a.words)}</li>`).join('')
      + (g.asksMore ? `<li>${esc(REPORT_TRAIL_WORDS.moreAsks(g.asksMore))}</li>` : '');
    const more = g.more.length ? `<details class="trail-more"><summary>${esc(g.moreWords)}</summary>`
      + `${g.more.map(entryHtml).join('')}</details>` : '';
    return `<details class="trail-group"${g.open ? ' open' : ''}><summary>${esc(g.words)} · ${esc(g.count)}</summary>`
      + `${asks ? `<ul class="rows trail-asks">${asks}</ul>` : ''}`
      + `${g.shown.map(entryHtml).join('')}${more}</details>`;
  }).join('');
  return `<section class="part tier trail" id="decisions"><h2>${esc(REPORT_TRAIL_WORDS.heading(decisions.total))}</h2>`
    + `${note}${groups}</section>`;
}

// ---- what the agent did -------------------------------------------------------------------------------------------

const cap = (n, factor) => Math.floor(n * factor);
/** D104: a row's shown-in-part mark in a list (`seen`: lines of parts), each line after the row's own, under its label. */
const seenHtml = (seen) => list(seen).map((line, k) => ` · ${k === 0 ? `<span class="label">${esc(REPORT_SEEN_WORDS.label)}`
  + '</span> ' : ''}${partsHtml(line)}`).join('');
function didHtml(model, factor) {
  const { did } = model;
  const note = factor < 1 ? `<p class="cut">${esc(REPORT_TRIM_WORDS.listsTrimmed)}</p>` : '';
  // Files.
  let room = cap(REPORT_LIMITS.files, factor);
  const fileLine = (f) => `<li><code>${esc(f.path)}</code>${f.type ? ` · ${esc(f.type)}` : ''}${f.counts
    ? ` · <span class="mono">${esc(f.counts)}</span>`
    : ''}${f.state ? ` · ${esc(f.state)}` : ''}${f.what ? ` · ${partsHtml(f.what)}` : ''}${gitHubLink(f.link)}`
    + `${f.items.map((n) => ` <a href="#item-${n}">→ item ${n}</a>`).join('')}</li>`;
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
    + (did.files.grouped ? `<p class="note">${esc(REPORT_DID_WORDS.filesByAsk)}</p>` : '')
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
  const runsShown = did.runs.shown.slice(0, cap(did.runs.shown.length, factor));
  const runsCut = did.runs.shown.length - runsShown.length;
  // D169: a run listed apart says its number first, as the report names it (the list numbers its entries by place).
  const runLine = (run, numbered = false) => `<li id="run-${run.k}">${[numbered ? esc(REPORT_ITEM_WORDS.run(run.k)) : null,
    run.text ? `<code>${esc(run.text)}</code>` : run.tool ? `<code>${esc(run.tool)}</code>` : null].filter(Boolean)
    .join(' · ')}${run.outcome ? ` · ${esc(run.outcome)}` : ''}`
    + `${run.handling ? ` · ${esc(run.handling)}` : ''}${run.item ? ` <a href="#item-${run.item}">→ item ${run.item}</a>` : ''}`
    + `${seenHtml(run.seen)}</li>`;
  // D169: the runs that another part names and the list leaves out, after it under their sentence (the .md's label when
  // the list shows none), whole under the size trim: an item that the page shows names each.
  const named = did.runs.named.length ? `<p class="note">${esc(runsShown.length ? REPORT_DID_WORDS.runsNamedApart
    : REPORT_DID_WORDS.runsNamed)}</p><ul class="rows">${did.runs.named.map((run) => runLine(run, true)).join('')}</ul>` : '';
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
  const claimLine = (c) => `<li id="${esc(c.anchor)}">${c.status ? `<span class="tag">${esc(c.status)}</span>` : ''}`
    + `${c.item ? `${c.status ? ' ' : ''}<a href="#item-${c.item}">→ item ${c.item}</a>` : ''}`
    + ` ${c.quote ? partHtml(c.quote) : esc(REPORT_ITEM_WORDS.quoteMissing)}`
    + `${c.confirmedBy ? ` · <span class="label">${esc(REPORT_ITEM_WORDS.recordedResult)}</span> ${partHtml(c.confirmedBy)}` : ''}`
    + `${c.why ? ` · ${esc(c.why)}` : ''}`
    + `${c.path ? ` · ${esc(REPORT_DID_WORDS.written(c.path))}` : ''}${seenHtml(c.seen)}</li>`;
  const closingRows = did.claims.closing.rows.slice(0, cap(did.claims.closing.rows.length, factor));
  const closing = did.claims.closing.total ? `<details class="fold"><summary>${esc(REPORT_SECTION_WORDS
    .closingLines(did.claims.closing.total))}</summary><ul class="rows">${closingRows.map((l) => `<li>${partsHtml(l.parts)}</li>`)
    .join('')}</ul>${did.claims.closing.total > closingRows.length ? `<p class="cut">${esc(REPORT_NOT_CHECKED_WORDS
    .rowsNotShown(did.claims.closing.total - closingRows.length))}</p>` : ''}</details>` : '';
  const claims = `<h3 class="sub-h">${esc(REPORT_SECTION_WORDS.claims)}</h3>`
    + (did.claims.total ? `<ul class="rows claims">${claimsShown.map(claimLine).join('')}</ul>`
      : `<p class="note">${esc(REPORT_DID_WORDS.noClaims)}</p>`)
    + (claimsMore > 0 ? `<p class="cut">${esc(REPORT_DID_WORDS.moreClaims(claimsMore))}</p>` : '') + closing;
  // What the agent said it did not do; the decisions you settled.
  const leftOutShown = did.leftOut.slice(0, cap(did.leftOut.length, factor));
  const settledShown = did.settled.slice(0, cap(did.settled.length, factor));
  const more = (n) => (n > 0 ? `<p class="cut">${esc(REPORT_NOT_CHECKED_WORDS.rowsNotShown(n))}</p>` : '');
  const leftOut = `<h3 class="sub-h">${esc(REPORT_SECTION_WORDS.leftOut)}</h3>` + (did.leftOut.length ? `<ul class="rows">`
    + leftOutShown.map((x) => `<li>${partHtml(x.quote)} <a href="#item-${x.item}">→ item ${x.item}</a></li>`).join('')
    + `</ul>${more(did.leftOut.length - leftOutShown.length)}` : `<p class="note">${esc(REPORT_DID_WORDS.noLeftOut)}</p>`);
  const settled = `<h3 class="sub-h">${esc(REPORT_SECTION_WORDS.settled)}</h3>` + (did.settled.length ? `<ul class="rows">`
    + settledShown.map((x) => `<li>${partsHtml(x.parts)}${x.youSaid ? ` · <span class="label">${esc(x.youSaidLabel ?? REPORT_ITEM_WORDS.youSaid)}</span> `
      + partHtml(x.youSaid) : ''}${seenHtml(x.seen)}</li>`).join('') + `</ul>${more(did.settled.length - settledShown.length)}`
    : `<p class="note">${esc(REPORT_DID_WORDS.noSettled)}</p>`);
  return `<details class="card-ui part fold-part" id="did"><summary class="card-bar"><h2>${esc(REPORT_SECTION_WORDS
    .didCounted(did.files.none === 'unseen' ? null : did.files.total, did.runs.commands, did.runs.others,
      did.claims.total))}</h2></summary><div class="content">${note}`
    + files + runs + claims + leftOut + settled + '</div></details>';
}

// ---- what Sonah could not check ------------------------------------------------------------------------------------

function notCheckedHtml(model, factor) {
  const nc = model.notChecked;
  const note = factor < 1 ? `<p class="cut">${esc(REPORT_TRIM_WORDS.listsTrimmed)}</p>` : '';
  // D169: a fact about the code review (its `group` 'code') is under that heading, with its lines and the withheld
  // fold, as the .md has it (session-story.js `notCheckedSection`); the session review's under its own.
  const factsOf = (group) => {
    const all = nc.facts.filter((f) => (f.group === 'code') === (group === 'code'));
    const shown = all.slice(0, cap(all.length, factor));
    return (shown.length ? `<ul class="rows">${shown.map((f) => `<li>${partsHtml(f.parts)}</li>`).join('')}</ul>` : '')
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
  const code = nc.code.length || codeFacts || nc.withheldTotal ? `<h3 class="sub-h">${esc(REPORT_NOT_CHECKED_WORDS
    .codeReview)}</h3>${nc.code.map((line) => `<p class="note">${partsHtml(line)}</p>`).join('')}${factsOf('code')}`
    + withheldHtml : '';
  return `<details class="card-ui part fold-part" id="not-checked"><summary class="card-bar"><h2>`
    + `${esc(REPORT_SECTION_WORDS.notCheckedCounted(nc.total))}</h2></summary><div class="content">${note}`
    // D133 (R2): the first screen's lines about what Sonah could not check, word for word, first.
    + (nc.quiet.length ? `<ul class="rows quiet">${nc.quiet.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '')
    + `<h3 class="sub-h">${esc(REPORT_NOT_CHECKED_WORDS.sessionReview)}</h3><p class="note">${esc(nc.lead)}</p>`
    + factsOf('session') + code
    + [...nc.unreadAsks, ...nc.unreadRows].map((line) => `<p class="note">${esc(line)}</p>`).join('')
    + '</div></details>';
}

// ---- the footer -----------------------------------------------------------------------------------------------------

/** D171: the footer's line that a newer Sonah is out, or nothing. Its bytes are not counted against `maxBytes`
 *  (`sessionPage`), so the page chooses what it leaves out as it would with no such line. */
const newerHtml = (footer) => (footer.newer ? `<p>${esc(footer.newer)}</p>` : '');

function footerHtml(model) {
  const { footer } = model;
  // D161: the agent's decisions among them: an answer is about a decision first.
  const items = reportItems(model);
  const answer = footer.sessionHash && items.some((item) => item.rowId)
    ? `<details class="fold answer"><summary>${esc(REPORT_SECTION_WORDS.answer)}</summary>`
      + `<p>${esc(REPORT_FOOTER_WORDS.answerIntro)} ${esc(REPORT_FOOTER_WORDS.answerParts)}</p>`
      + `<p class="cmd"><code>${esc(REPORT_FOOTER_WORDS.answerCommand(footer.sessionHash))}</code></p>`
      + `<p>${esc(REPORT_FOOTER_WORDS.answerReport)}</p></details>` : '';
  // D129 (C7): what the review cost, after the line that names Sonah, when the run record holds it. D171: before it,
  // the line that a newer Sonah is out, when the model has it (the CLI's update check knew one).
  return `<footer class="foot"><p class="gen">${esc(footer.provenance)}</p>${newerHtml(footer)}`
    + (footer.usage ? `<p>${esc(footer.usage)}</p>` : '')
    + footer.legend.map((line) => `<p>${esc(line)}</p>`).join('')
    // D133 (R2): said once here, in the legend, for every message whose asks the page marks.
    + (model.prompt.messages.length ? `<p>${esc(REPORT_PROMPT_WORDS.coverage)}</p>` : '')
    + (footer.triageLegend ? `<p>${esc(footer.triageLegend)}</p>` : '')
    + `<p>${esc(footer.share)}</p>${answer}</footer>`;
}

// ---- the page -------------------------------------------------------------------------------------------------------

const LOGO = '<svg class="logo" viewBox="0 0 64 64" aria-hidden="true"><rect class="l-bg" width="64" height="64" rx="14"/>'
  + '<rect class="l-fg" x="14" y="17" width="26" height="6" rx="3"/><rect class="l-fg l-dim" x="14" y="29" width="22" height="6" rx="3"/>'
  + '<rect class="l-ac" x="40" y="27" width="10" height="10" rx="2"/><rect class="l-fg" x="14" y="41" width="30" height="6" rx="3"/></svg>';

const DARK = `--bg: #161310; --card: #1e1a16; --panel: rgba(255,255,255,.04); --footer: #1b1814; --ink: #f1ece6;
    --muted: #b5aca2; --faint: #a39a90; --line: #2e2823; --line-strong: #463e37; --wash: #24201b; --accent: #f59a2e;
    --accent-ink: #ffb45e; --accent-soft: rgba(245,154,46,.14); --accent-edge: rgba(245,154,46,.40);
    --add: rgba(90,190,120,.14); --del: rgba(240,110,90,.14); --mark: rgba(245,154,46,.10);
    --shadow: 0 1px 2px rgba(0,0,0,.4), 0 24px 60px -24px rgba(0,0,0,.6);`;

/** The page's one stylesheet: sonah.dev's tokens and components (light), and a warm dark derived from them. `--faint`
 *  at least 4.6:1 on the card and the wash in both themes (WCAG 2.2 AA 1.4.3). An ask's status is a word in a tag; its
 *  mark is one colour for every status: no colour means safe. */
export const PAGE_CSS = `
:root {
  color-scheme: light dark;
  --bg: #f7f7f4; --card: #ffffff; --panel: rgba(235,232,228,.6); --footer: #eeede6; --ink: #251f19;
  --muted: #68615a; --faint: #746b62; --line: #ebe8e4; --line-strong: #d4cdc7; --wash: #f7f6f2; --accent: #f48d16;
  --accent-ink: #9a5300; --accent-soft: rgba(244,141,22,.10); --accent-edge: rgba(244,141,22,.35);
  --add: rgba(46,140,74,.10); --del: rgba(200,64,40,.09); --mark: rgba(244,141,22,.08);
  --shadow: 0 1px 2px rgba(37,31,25,.04), 0 24px 60px -24px rgba(37,31,25,.22);
  --sans: "Geist", "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --display: "DM Sans", "Inter", system-ui, -apple-system, sans-serif;
  --mono: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    ${DARK}
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  ${DARK}
}
:root[data-theme="light"] { color-scheme: light; }
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--ink); font-family: var(--sans); font-size: 16px; line-height: 1.5;
  -webkit-font-smoothing: antialiased; }
h1, h2, h3, h4, p, figure, blockquote, pre, ol, ul { margin: 0; }
a { color: var(--accent-ink); }
code, .mono { font-family: var(--mono); }
a:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.page { max-width: 860px; margin: 0 auto; padding: 32px 16px 80px; display: flex; flex-direction: column; gap: 24px; }
.masthead { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; }
.wordmark { display: inline-flex; align-items: center; gap: 9px; font: 600 22px/1 var(--display); letter-spacing: -0.02em; }
.logo { width: 26px; height: 26px; flex-shrink: 0; }
.l-bg { fill: var(--ink); } .l-fg { fill: var(--bg); } .l-dim { opacity: .55; } .l-ac { fill: var(--accent); }
.card-ui { width: 100%; margin: 0; background: var(--card); border: 1px solid var(--line); border-radius: 20px; overflow: hidden;
  box-shadow: var(--shadow); }
.card-bar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; padding: 14px 18px;
  background: var(--wash); border-bottom: 1px solid var(--line); }
.card-bar h1, .card-bar h2 { font: 600 14px/1.3 var(--display); }
.card-bar .mono { font-size: 12px; color: var(--faint); }
.content { padding: clamp(16px, 4vw, 24px); display: flex; flex-direction: column; gap: 8px; }
.title-words { font: 500 18px/1.4 var(--display); overflow-wrap: anywhere; }
.meta { font-size: 14px; color: var(--muted); overflow-wrap: anywhere; }
.count { font-size: 15px; font-weight: 600; overflow-wrap: anywhere; }
.count a, .count-labels a { text-decoration: none; }
.count-labels, .count-empty { font-size: 14px; overflow-wrap: anywhere; }
.label { font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--faint); }
.tag { display: inline-block; font: 600 11px/1.4 var(--mono); color: var(--ink); background: var(--wash);
  border: 1px solid var(--line-strong); border-radius: 4px; padding: 0 5px; margin-right: 4px; }
.message { font-size: 15px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
mark.ask { background: var(--mark); color: inherit; border-bottom: 2px solid var(--accent-edge); padding: 1px 0; }
mark.ask.s-notDone, mark.ask.s-partly, mark.ask.s-doneCode, mark.ask.s-notCheckedCode { border-bottom-color: var(--accent); }
.join { color: var(--faint); }
.note { font-size: 13px; line-height: 1.45; color: var(--muted); overflow-wrap: anywhere; }
.cut { font-size: 13px; color: var(--muted); overflow-wrap: anywhere; }
.rows { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.rows li { font-size: 14px; line-height: 1.45; overflow-wrap: anywhere; }
ol.rows.runs { list-style: decimal; padding-left: 28px; }
.part.tier { display: flex; flex-direction: column; gap: 12px; }
.part.tier > h2, .fold-tier > summary h2 { font: 600 17px/1.3 var(--display); }
.item { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 16px 18px;
  display: flex; flex-direction: column; gap: 6px; box-shadow: var(--shadow); }
.item-head { font: 500 16px/1.45 var(--display); overflow-wrap: anywhere; }
.item-head .n { font: 600 12px/1 var(--mono); color: var(--faint); margin-right: 4px; }
.item-head .scope { color: var(--accent-ink); }
.item-quote { margin: 0; padding: 2px 0 2px 12px; border-left: 2px solid var(--accent); font-size: 14px; overflow-wrap: anywhere; }
.line { font-size: 14px; line-height: 1.5; overflow-wrap: anywhere; }
.line .label, .note .label { margin-right: 6px; }
em.by-code-review, em.by-session-review { font-style: italic; }
q.said { quotes: "\\201C" "\\201D"; color: var(--ink); background: var(--accent-soft); border-radius: 3px; padding: 0 2px;
  -webkit-box-decoration-break: clone; box-decoration-break: clone; }
q.said::before, q.said::after { color: var(--accent-ink); font-weight: 700; }
q.said code { font: inherit; }
a.gh { font-size: 12px; }
details > summary { list-style: none; cursor: pointer; display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px;
  font-size: 13px; color: var(--muted); }
details > summary::-webkit-details-marker { display: none; }
details > summary::before { content: ""; flex-shrink: 0; align-self: center; width: 0; height: 0; border-style: solid;
  border-width: 4px 0 4px 6px; border-color: transparent transparent transparent var(--accent); transition: transform .15s ease; }
details[open] > summary::before { transform: rotate(90deg); }
details.evidence { margin-top: 4px; }
details.evidence > *:not(summary) { margin-top: 6px; }
details.row-evidence { display: inline-block; vertical-align: baseline; }
details.row-evidence[open] { display: block; }
details.row-evidence > *:not(summary) { margin-top: 4px; }
details.agent-prompt { margin-top: 4px; }
details.agent-prompt > *:not(summary) { margin-top: 6px; }
pre.agent-prompt-text { font: 12.5px/1.55 var(--mono); color: var(--ink); background: var(--wash); border: 1px solid var(--line);
  border-radius: 12px; padding: 10px 14px; white-space: pre-wrap; overflow-wrap: anywhere; cursor: text;
  -webkit-user-select: all; user-select: all; }
details.item.gtk > summary { font: 500 15px/1.45 var(--display); color: var(--ink); }
.members { display: flex; flex-direction: column; gap: 8px; margin-top: 6px; }
.member { border-left: 2px solid var(--line-strong); padding: 2px 0 2px 12px; display: flex; flex-direction: column; gap: 6px; }
.member-head, details.member > summary { font: 500 15px/1.45 var(--display); color: var(--ink); overflow-wrap: anywhere; }
.member .tier-word { color: var(--muted); }
.fold-tier { display: flex; flex-direction: column; gap: 12px; }
.trail-group { display: flex; flex-direction: column; gap: 8px; }
.trail-group > summary { font: 600 15px/1.45 var(--display); color: var(--ink); }
.trail-more { display: flex; flex-direction: column; gap: 8px; }
.trail-more > summary { font: 500 15px/1.45 var(--display); color: var(--muted); }
.trail-above { font: 500 15px/1.45 var(--display); color: var(--ink); overflow-wrap: anywhere; }
.tier-tag { margin: 0 0 0 2px; }
.fold-part > summary.card-bar { color: var(--ink); }
.fold-part:not([open]) > summary.card-bar { border-bottom: none; }
.sub-h { font: 600 14px/1.3 var(--display); margin-top: 12px; }
pre.diff { font: 12.5px/1.55 var(--mono); color: var(--ink); background: var(--wash); border: 1px solid var(--line);
  border-radius: 12px; padding: 10px 0; overflow-x: auto; }
pre.diff .lines { display: inline-block; min-width: 100%; }
pre.diff .ln { display: block; padding: 0 14px; white-space: pre; }
pre.diff .gutter { color: var(--faint); }
pre.diff .add { background: var(--add); }
.files { list-style: none; padding: 0; }
.files li { padding: 6px 0; border-top: 1px solid var(--line); font-size: 13px; overflow-wrap: anywhere; }
.files li:first-child { border-top: none; }
.cmd code { display: block; font-size: 11.5px; line-height: 1.5; color: var(--muted); background: var(--wash);
  border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; overflow-wrap: anywhere; }
.foot { display: flex; flex-direction: column; gap: 8px; padding: 24px clamp(16px, 4vw, 24px); border-radius: 20px;
  background: var(--footer); font-size: 14px; color: var(--muted); }
.foot .gen { padding-bottom: 10px; border-bottom: 1px dashed var(--line-strong); font-family: var(--mono); font-size: 12px; }
@media (prefers-reduced-motion: reduce) {
  details > summary::before { transition: none; }
}
`;

/**
 * D104: the page never links to a place it does not hold. A run, a claim or an item that a trim of the page or a list's
 * bound left out keeps its words, without the link. Structure of the page's own markup only: every in-page link the
 * page writes is `<a href="#id">…</a>` with no link inside it, and recorded text is escaped, so it never holds one.
 */
function heldLinks(html) {
  const ids = new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
  return html.replace(/<a href="#([^"]+)">([\s\S]*?)<\/a>/g, (link, id, inner) => (ids.has(id) ? link : inner));
}

/** One composition of the page: which folds keep only their summary, and the factor every list is cut by. */
function compose(model, theme, trim) {
  const card = `<article class="card-ui review" aria-labelledby="review-title"><div class="card-bar">`
    + `<h1 id="review-title">${esc(REPORT_HEADER_WORDS.review)}</h1><span class="mono">${esc(model.header.size.join(' · '))}</span>`
    + `</div><div class="content">${headerHtml(model)}</div></article>`;
  // D131 (R1, B12): Must act and Must know before your prompt (`promptAfterTiers`), so what needs your action is on the
  // first screen; Good to know, folded, after it.
  const tiers = tiersHtml(model, trim);
  const prompt = promptHtml(model, trim);
  const body = [`<header class="masthead"><p class="wordmark">${LOGO}Sonah</p></header>`, card,
    // D161: the first part (Must act, Must know, Good to know), then the second (the agent's decisions), then your prompt
    // when it comes after the tiers.
    ...(promptAfterTiers(model) ? [tiers.must, tiers.good, tiers.trail, prompt]
      : [prompt, tiers.must, tiers.good, tiers.trail]), didHtml(model, trim.did),
    notCheckedHtml(model, trim.notChecked), footerHtml(model)];
  // One list item a line, so a reader of the source (and a snapshot's diff) can follow it. Recorded text never holds a
  // tag (it is escaped), and no list item is inside a <pre>, so this changes no rendered text.
  const html = heldLinks(body.join('\n')).replace(/<\/li>/g, '</li>\n').replace(/<\/article>/g, '</article>\n');
  const themeAttribute = theme === SYSTEM ? '' : ` data-theme="${theme}"`;
  const colorScheme = theme === SYSTEM ? 'light dark' : theme;
  const title = model.header.title ? model.header.title.text : REPORT_HEADER_WORDS.review;
  return `<!doctype html>
<html lang="en"${themeAttribute}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="${colorScheme}">
<meta name="generator" content="${PAGE_VERSION} ${REPORT_MODEL_VERSION}">
<title>${esc(title)}</title>
<style>${PAGE_CSS}</style>
</head>
<body>
<main class="page">
${html}
</main>
</body>
</html>
`;
}

/**
 * What each composition leaves out, in order, until the page fits `maxBytes` (D97): nothing; a long message keeps only
 * its start, and a message that holds no ask its start (your own words, which you hold: the evidence is what only the
 * page shows); then (D161) the detail folds of the agent's decisions keep their summary only; then the evidence folds of
 * Good to know keep their summary only; then those of Must know and Must act;
 * then the lists of what the agent did and the messages that hold no ask are halved until empty; then the lists of what
 * Sonah could not check. The visible lines of every item stay, and so does the open start of each message that holds
 * an ask.
 */
function* compositions() {
  const none = { messages: false, trail: false, goodToKnow: false, items: false, did: 1, notChecked: 1 };
  yield none;
  yield { ...none, messages: true };
  // D161: the agent's decisions' detail folds keep their summary first, before any fold of the first part.
  const cut = { ...none, messages: true, trail: true };
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
  const unweighed = bytes(newerHtml(model.footer));
  let html = '';
  let whole = true;
  for (const trim of compositions()) {
    html = compose(model, theme, trim);
    if (bytes(html) - unweighed <= PAGE_LIMITS.maxBytes) break;
    whole = false;
  }
  return { html, whole };
}
