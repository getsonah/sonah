// Session page (D97). ONE recorded session's review as a self-contained HTML page: the report model
// (report-model.js `reportModel`) rendered for a browser, in its order — the header and the count line, your prompt with
// each ask marked, then Must act, Must know, Good to know (folded), what the agent did (folded), what Sonah could not
// check (folded) and the footer. The Markdown report renders the same model, so both say the same things, in the same
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

import { visible, backtickPieces } from './session-story.js';
import { reportModel, REPORT_MODEL_VERSION, REPORT_LIMITS } from './report-model.js';
import { REPORT_TIER_WORDS, REPORT_TYPE_WORDS, REPORT_HEADER_WORDS, REPORT_COUNT_WORDS, REPORT_SECTION_WORDS,
  REPORT_ITEM_WORDS, REPORT_PROMPT_WORDS, REPORT_DID_WORDS, REPORT_NOT_CHECKED_WORDS, REPORT_TRIM_WORDS,
  REPORT_FOOTER_WORDS, REPORT_CAUSE_WORDS, REPORT_GAP_WORDS, REPORT_COLUMN_REASON_WORDS, REPORT_ANSWER_WORDS }
  from './report-words.js';

/** The page's layout version, in its generator meta. /37 (D97, owner decisions 2026-10-16): the page
 *  renders the report model — the header (its size line, the runs after the last edit, what Sonah did not check), the
 *  count line, your prompt with each ask's words marked by its status, then the items in three tiers (Must act, Must
 *  know, Good to know folded), what the agent did and what Sonah could not check, folded. It replaces the checklist
 *  order of D71 (S4) and D88's attention summary; the steps card, the decision cards' step folds and the old parts are
 *  removed. Its only links out are GitHub permalinks built from validated local git facts. (/36 and every version
 *  before it: the checklist page, `git log` of this file.) */
export const PAGE_VERSION = 'sonah.session-page/37';

/** The page's colour themes. `system` (the default) follows the reader's setting; `light` and `dark` fix the theme. */
export const PAGE_THEMES = Object.freeze(['system', 'light', 'dark']);
const [SYSTEM] = PAGE_THEMES;

/** The page's bounds. `maxBytes` is the bound on the whole page: past it a long message keeps only its start (its whole
 *  text is not folded below it, and a message that holds no ask shows its start), then the evidence folds of Good to know
 *  keep their summary only, then those of Must know and Must act, then the lists of what the agent did and the messages
 *  that hold no ask are halved until empty, then the lists of what Sonah could not check — each said where it happens
 *  (D97). Only the visible lines of the items and the open start of each message that holds an ask are never cut. The
 *  report model's display bounds are `REPORT_LIMITS`. */
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
  if (header.noLinks.length) out.push(`<p class="meta no-links">${header.noLinks.map(esc).join(' ')}</p>`);
  if (header.runs.length) out.push(`<p class="meta runs">${header.runs.map(esc).join(' ')}</p>`);
  const notChecked = [...header.reviewIncomplete.map(esc)];
  if (header.didNotCheck) notChecked.push(`${esc(header.didNotCheck.lead)} ${header.didNotCheck.phrases.map(esc).join(' · ')}`
    + `${header.didNotCheck.more ? ` <a href="#not-checked">${esc(header.didNotCheck.more)}</a>` : ''}`);
  if (notChecked.length) out.push(`<p class="meta not-checked">${notChecked.join(' ')}</p>`);
  if (header.noCode) out.push(`<p class="meta no-code">${header.noCode.map(esc).join(' ')}</p>`);
  const tiers = countLine.tiers.map((t) => `<a href="#${t.tier.replace(/_/g, '-')}">${esc(REPORT_COUNT_WORDS.tier(t.words, t.n))}`
    + `${t.folded ? ` ${esc(REPORT_COUNT_WORDS.folded)}` : ''}</a>`).join(' · ');
  out.push(`<p class="count">${tiers} · <a href="#prompt">${esc(countLine.prompt)}</a></p>`);
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
    const status = REPORT_PROMPT_WORDS.status[{ done: 'done', doneCode: 'done', partly: 'partly', notDone: 'notDone',
      notChecked: 'notChecked', notCheckedCode: 'notChecked' }[seg.state]];
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
    return `<div class="message-block"><p class="message">${start.html}${start.cut ? '…' : ''}</p>${whole}${extras}`
      + `<p class="note coverage">${esc(REPORT_PROMPT_WORDS.coverage)}</p>${unlocatedHtml}</div>`;
  });
  // An ask whose words no mark above shows (its mark past a message's start, or inside an earlier ask's) is listed with
  // its words.
  const lines = prompt.asks.filter((a) => a.lines.length || !ids.has(a.n)).map((a) => {
    const unmarked = !ids.has(a.n);
    const id = unmarked ? (ids.add(a.n), ` id="ask-${a.n}"`) : '';
    return `<li${id}>${esc(REPORT_PROMPT_WORDS.askLine(a.n))} · <span class="tag s-${esc(a.state)}">${esc(a.status)}</span>`
      + `${unmarked && a.words.length ? ` · ${partsHtml(a.words)}` : ''}${a.lines.map((line) => ` · ${partsHtml(line)}`)
        .join('')}</li>`;
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
  return `<section class="card-ui part" id="prompt"><div class="card-bar"><h2>${esc(REPORT_SECTION_WORDS
    .promptCounted(prompt.asks.length, prompt.parts.join(', ')))}</h2></div><div class="content">`
    + (messagesCut ? `<p class="cut">${esc(REPORT_TRIM_WORDS.messagesTrimmed)}</p>` : '')
    + (noAskShown.length < noAsk.length ? `<p class="cut">${esc(REPORT_TRIM_WORDS.listsTrimmed)}</p>` : '')
    + (prompt.asks.length ? '' : `<p class="note">${esc(REPORT_COUNT_WORDS.noAsk)}</p>`)
    + blocks.join('') + (lines.length ? `<ul class="rows ask-lines">${lines.join('')}</ul>` : '') + empty
    + '</div></section>';
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
  const marker = item.scope.asks.length && !item.where.some((w) => w.anchor === `ask-${item.scope.asks[0]}`)
    ? [`<a href="#ask-${item.scope.asks[0]}">${esc(REPORT_ITEM_WORDS.asked(item.scope.asks[0]))}</a>`] : [];
  return places.length || marker.length ? labelled(REPORT_ITEM_WORDS.where, [...places, ...marker].join(' · '), 'line where')
    : '';
}
function evidenceHtml(item, trimmed) {
  const summary = `${esc(REPORT_ITEM_WORDS.evidence)} · ${esc(REPORT_ITEM_WORDS.why(REPORT_TIER_WORDS[item.tier.final]))}`;
  if (trimmed) return `<details class="evidence"><summary>${summary}</summary></details>`;
  const lines = item.evidence.map((e) => labelled(e.label, partsHtml(e.parts)));
  const noLink = [...new Set(item.where.map((w) => w.noLink).filter(Boolean))].map((t) => `<p class="note">${esc(t)}</p>`);
  const id = item.rowId ? labelled(REPORT_ITEM_WORDS.rowId, `<code>${esc(shortId(item.rowId))}</code>`, 'note') : '';
  // Your earlier answer is your own words, escaped, and never in a recorded quote's quotation marks.
  const answer = item.answer ? labelled(REPORT_ITEM_WORDS.yourAnswer, `${esc(item.answer.words)} `
    + `<span class="answer-reason">${esc(item.answer.reason)}</span>`, 'note answer') : '';
  return `<details class="evidence"><summary>${summary}</summary>${lines.join('')}${noLink.join('')}`
    + `<p class="note why">${esc(item.why)}</p>${id}${answer}</details>`;
}
/** The visible lines of an item (D97), in order, then its evidence fold. */
function itemBody(item, trimmed) {
  const scope = item.scope.notAsked ? ` <span class="scope">${esc(REPORT_ITEM_WORDS.notAsked)}</span>`
    : item.scope.askedUnknown ? ` <span class="scope">${esc(REPORT_ITEM_WORDS.askedUnknown)}</span>` : '';
  const out = [];
  if (item.quote) out.push(`<blockquote class="item-quote">${item.quoteLabel ? `<span class="label">${esc(item.quoteLabel)}</span> `
    : ''}${partHtml(item.quote)}</blockquote>`);
  else if (item.quoteMissing) out.push(`<p class="note">${esc(REPORT_ITEM_WORDS.quoteMissing)}</p>`);
  if (item.impact) out.push(labelled(REPORT_ITEM_WORDS.impact, partsHtml(item.impact), 'line impact'));
  if (item.agentSaid) out.push(labelled(item.agentSaidLabel ?? REPORT_ITEM_WORDS.agentSaid, partHtml(item.agentSaid),
    'line agent-said'));
  if (item.action) out.push(labelled(REPORT_ITEM_WORDS.action, partsHtml(item.action), 'line action'));
  out.push(whereHtml(item));
  out.push(excerptHtml(item.where[0]?.excerpt));
  out.push(evidenceHtml(item, trimmed));
  return { head: `<span class="n">${item.n}</span> <strong class="type">${esc(REPORT_TYPE_WORDS[item.type])}:</strong> `
    + `${partsHtml(item.what.parts)}${scope}`, body: out.join('') };
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
function tiersHtml(model, trim) {
  const [act, know, good] = ['must_act', 'must_know', 'good_to_know'];
  const note = (on) => (on ? `<p class="cut">${esc(REPORT_TRIM_WORDS.trimmed)}</p>` : '');
  const open = (tier) => `<section class="part tier" id="${tier.replace(/_/g, '-')}"><h2>${esc(REPORT_SECTION_WORDS
    .tier(REPORT_TIER_WORDS[tier], model.tiers[tier].length))}</h2>${tier === act ? note(trim.items) : ''}`
    + `${model.tiers[tier].map((item) => itemHtml(item, trim.items)).join('')}</section>`;
  const gtk = `<details class="part tier fold-tier" id="good-to-know"><summary><h2>${esc(REPORT_SECTION_WORDS
    .tier(REPORT_TIER_WORDS[good], model.tiers[good].length))}</h2></summary>${note(trim.goodToKnow)}`
    + `${model.tiers[good].map((item) => goodToKnowHtml(item, trim.goodToKnow)).join('')}</details>`;
  return open(act) + open(know) + gtk;
}

// ---- what the agent did -------------------------------------------------------------------------------------------

const cap = (n, factor) => Math.floor(n * factor);
function didHtml(model, factor) {
  const { did } = model;
  const note = factor < 1 ? `<p class="cut">${esc(REPORT_TRIM_WORDS.listsTrimmed)}</p>` : '';
  // Files.
  let room = cap(REPORT_LIMITS.files, factor);
  const fileLine = (f) => `<li><code>${esc(f.path)}</code> · ${esc(f.type)}${f.counts ? ` · <span class="mono">${esc(f.counts)}</span>`
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
  const files = `<h3 class="sub-h">${esc(REPORT_SECTION_WORDS.files)}</h3>`
    + (did.files.grouped ? `<p class="note">${esc(REPORT_DID_WORDS.filesByAsk)}</p>` : '')
    + (did.files.total ? groups : `<p class="note">${esc(REPORT_DID_WORDS.noFiles)}</p>`)
    + (filesMore > 0 ? `<p class="cut">${esc(REPORT_DID_WORDS.moreFiles(filesMore))}</p>` : '')
    + (did.files.outside ? `<p class="note">${esc(REPORT_DID_WORDS.outside(did.files.outside.n, did.files.outside.paths.join(', '),
      did.files.outside.more))}</p>` : '')
    + (did.files.unconfirmed ? `<p class="note">${esc(REPORT_DID_WORDS.unconfirmed(did.files.unconfirmed))}</p>` : '');
  // Runs.
  const runsShown = did.runs.shown.slice(0, cap(did.runs.shown.length, factor));
  const runsCut = did.runs.shown.length - runsShown.length;
  const runLine = (run) => `<li id="run-${run.k}">${run.text ? `<code>${esc(run.text)}</code>` : run.tool
    ? `<code>${esc(run.tool)}</code>` : ''}${run.outcome ? ` · ${esc(run.outcome)}` : ''}`
    + `${run.handling ? ` · ${esc(run.handling)}` : ''}${run.item ? ` <a href="#item-${run.item}">→ item ${run.item}</a>` : ''}</li>`;
  const runs = `<h3 class="sub-h">${esc(REPORT_SECTION_WORDS.runs)}</h3>`
    + (did.runs.total ? `<ol class="rows runs">${runsShown.map(runLine).join('')}</ol>` : `<p class="note">${esc(REPORT_DID_WORDS.noRuns)}</p>`)
    + (did.runs.quietExit0 ? `<p class="cut">${esc(REPORT_DID_WORDS.moreRuns(did.runs.quietExit0))}</p>` : '')
    + (did.runs.cut + runsCut ? `<p class="cut">${esc(REPORT_DID_WORDS.runsCut(runsShown.length, did.runs.cut + runsCut,
      did.runs.cutParts.join(', ') || String(did.runs.cut + runsCut)))}</p>` : '')
    + (did.runs.neverRan.length ? `<p class="note">${esc(REPORT_DID_WORDS.neverRan(did.runs.neverRan.join(', ')))}</p>` : '');
  // Claims.
  const claimsShown = did.claims.shown.slice(0, cap(did.claims.shown.length, factor));
  const claimsMore = did.claims.total - claimsShown.length;
  const claimLine = (c) => `<li id="${esc(c.anchor)}">${c.status ? `<span class="tag">${esc(c.status)}</span>` : ''}`
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
      + partHtml(x.youSaid) : ''}</li>`).join('') + `</ul>${more(did.settled.length - settledShown.length)}`
    : `<p class="note">${esc(REPORT_DID_WORDS.noSettled)}</p>`);
  return `<details class="card-ui part fold-part" id="did"><summary class="card-bar"><h2>${esc(REPORT_SECTION_WORDS
    .didCounted(did.files.total, did.runs.commands, did.runs.others, did.claims.total))}</h2></summary><div class="content">${note}`
    + files + runs + claims + leftOut + settled + '</div></details>';
}

// ---- what Sonah could not check ------------------------------------------------------------------------------------

function notCheckedHtml(model, factor) {
  const nc = model.notChecked;
  const note = factor < 1 ? `<p class="cut">${esc(REPORT_TRIM_WORDS.listsTrimmed)}</p>` : '';
  const facts = nc.facts.slice(0, cap(nc.facts.length, factor));
  const withheld = nc.withheld.slice(0, cap(nc.withheld.length, factor));
  const factsHtml = facts.length ? `<ul class="rows">${facts.map((f) => `<li>${partsHtml(f.parts)}</li>`).join('')}</ul>` : '';
  const code = nc.code.length ? `<h3 class="sub-h">${esc(REPORT_NOT_CHECKED_WORDS.codeReview)}</h3>`
    + nc.code.map((line) => `<p class="note">${partsHtml(line)}</p>`).join('') : '';
  const withheldHtml = nc.withheldTotal ? `<details class="fold"><summary>${esc(REPORT_SECTION_WORDS.withheld(nc.withheldTotal))}`
    + `</summary><ul class="rows">${withheld.map((w) => `<li>${w.what ? `<span class="label">${esc(w.what)}</span> ` : ''}`
      + `${partsHtml(w.words)}${w.why ? ` · ${esc(w.why)}` : ''}${w.check ? ` · <span class="label">${esc(REPORT_NOT_CHECKED_WORDS
        .checkSaid)}</span> ${partsHtml(w.check)}` : ''}</li>`).join('')}</ul>`
    + (nc.withheldTotal > withheld.length ? `<p class="cut">${esc(REPORT_NOT_CHECKED_WORDS.rowsNotShown(nc.withheldTotal
      - withheld.length))}</p>` : '') + '</details>' : '';
  const cut = nc.facts.length - facts.length;
  return `<details class="card-ui part fold-part" id="not-checked"><summary class="card-bar"><h2>`
    + `${esc(REPORT_SECTION_WORDS.notCheckedCounted(nc.total))}</h2></summary><div class="content">${note}`
    + `<h3 class="sub-h">${esc(REPORT_NOT_CHECKED_WORDS.sessionReview)}</h3><p class="note">${esc(nc.lead)}</p>`
    + factsHtml + (cut ? `<p class="cut">${esc(REPORT_NOT_CHECKED_WORDS.rowsNotShown(cut))}</p>` : '')
    + code + withheldHtml
    + [...nc.unreadAsks, ...nc.unreadRows].map((line) => `<p class="note">${esc(line)}</p>`).join('')
    + '</div></details>';
}

// ---- the footer -----------------------------------------------------------------------------------------------------

function footerHtml(model) {
  const { footer } = model;
  const items = ['must_act', 'must_know', 'good_to_know'].flatMap((tier) => model.tiers[tier]);
  const answer = footer.sessionHash && items.some((item) => item.rowId)
    ? `<details class="fold answer"><summary>${esc(REPORT_SECTION_WORDS.answer)}</summary>`
      + `<p>${esc(REPORT_FOOTER_WORDS.answerIntro)} ${esc(REPORT_FOOTER_WORDS.answerParts)}</p>`
      + `<p class="cmd"><code>${esc(REPORT_FOOTER_WORDS.answerCommand(footer.sessionHash))}</code></p>`
      + `<p>${esc(REPORT_FOOTER_WORDS.answerReport)}</p></details>` : '';
  return `<footer class="foot"><p class="gen">${esc(footer.provenance)}</p>`
    + footer.legend.map((line) => `<p>${esc(line)}</p>`).join('')
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
details.item.gtk > summary { font: 500 15px/1.45 var(--display); color: var(--ink); }
.fold-tier { display: flex; flex-direction: column; gap: 12px; }
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

/** One composition of the page: which folds keep only their summary, and the factor every list is cut by. */
function compose(model, theme, trim) {
  const card = `<article class="card-ui review" aria-labelledby="review-title"><div class="card-bar">`
    + `<h1 id="review-title">${esc(REPORT_HEADER_WORDS.review)}</h1><span class="mono">${esc(model.header.size.join(' · '))}</span>`
    + `</div><div class="content">${headerHtml(model)}</div></article>`;
  const body = [`<header class="masthead"><p class="wordmark">${LOGO}Sonah</p></header>`, card, promptHtml(model, trim),
    tiersHtml(model, trim), didHtml(model, trim.did), notCheckedHtml(model, trim.notChecked), footerHtml(model)];
  // One list item a line, so a reader of the source (and a snapshot's diff) can follow it. Recorded text never holds a
  // tag (it is escaped), and no list item is inside a <pre>, so this changes no rendered text.
  const html = body.join('\n').replace(/<\/li>/g, '</li>\n').replace(/<\/article>/g, '</article>\n');
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
 * page shows); then the evidence folds of Good to know keep their summary only; then those of Must know and Must act;
 * then the lists of what the agent did and the messages that hold no ask are halved until empty; then the lists of what
 * Sonah could not check. The visible lines of every item stay, and so does the open start of each message that holds
 * an ask.
 */
function* compositions() {
  const none = { messages: false, goodToKnow: false, items: false, did: 1, notChecked: 1 };
  yield none;
  const cut = { ...none, messages: true };
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

/** The page (`renderSessionPage`) and whether it kept every part: `{ html, whole }`, `whole` false when the page had to
 *  leave something out to fit `PAGE_LIMITS.maxBytes`. The CLI passes `whole` to the Markdown report it writes beside
 *  the page. Pure. */
export function sessionPage(session, report, options = {}) {
  const opts = plain(options) ? options : {};
  const model = reportModel(session, plain(report) ? report : {}, opts);
  const theme = PAGE_THEMES.includes(opts.theme) ? opts.theme : SYSTEM;
  let html = '';
  let whole = true;
  for (const trim of compositions()) {
    html = compose(model, theme, trim);
    if (bytes(html) <= PAGE_LIMITS.maxBytes) break;
    whole = false;
  }
  return { html, whole };
}
