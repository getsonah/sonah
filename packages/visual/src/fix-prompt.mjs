// fix-prompt.mjs: the text a fix starts from, and the ways to open it in Claude Code (the hosted server's fix loop,
// its FIXLOOP.md "The prompt", "Opening it in Claude Code" and "Shapes"). The server's panel and the laptop's
// `sonah fix` build the prompt with this one function from the same fields, so what the author previews is what is
// sent. The shape checks and the closed lists here are the ones both sides use. D223: this file is the original; the
// server's copy is synced from this folder with the rest of it. Pure: no clock, no random value, no network, no import.

/** Claude Code's terminal link takes a prompt of at most this many characters. */
export const LINK_MAX = 5000;
/** A comment's words: at most this many characters (the store's note limit). */
export const WORDS_MAX = 2000;
/** A finding's quote (requests.mjs LIMITS.quoteChars; a test keeps the two equal). */
export const QUOTE_MAX = 120;
/** The first line of the words, as a notice or a listing shows it. */
export const FIRST_LINE_MAX = 120;
/** What ends a text Sonah cut. */
export const CUT = '…';
/** The comments a reply's prompt quotes before its own words (its thread, oldest first), at most. */
export const THREAD_MAX = 20;
const TITLE_MAX = 1000;
const ONE_LINE_MAX = 2000;
const FNS_MAX = 1000;

/**
 * Sonah's own text of the prompt: one frozen literal, with a verb per act. A {part} is filled in once (what fills it
 * is never read for parts); a line whose part is empty is left out. The teammate's words are never in it: each of their
 * lines follows `mark`, under the heading that names who wrote them, how and when.
 */
export const FRAME = Object.freeze({
  opening: "A review comment from @{login} on {owner}/{name}{pr} (branch {branch}), left on Sonah's review of {head}.",
  pr: ' PR #{n}',
  theirs: 'Their words are below exactly as written; each of their lines starts with "> ".',
  finding: 'The item, as the review shows it (its quote is checked to be in the change):',
  function: 'The item, as the review shows it:',
  tiers: Object.freeze({ 'must-act': 'Must act', 'must-know': 'Must know', 'good-to-know': 'Good to know' }),
  title: '  {tier}: {title}',
  oneLine: '  {oneLine}',
  functions: '  Functions: {ids}',
  quote: '  Quote: {quote}',
  fn: '  Function: {id}{counts}',
  counts: ' (+{added} -{removed})',
  verbs: Object.freeze({ override: 'overrode it', question: 'asked', reply: 'wrote' }),
  heading: '@{login} {verb} on {date}:',
  noWords: '@{login} overrode it, with no words, on {date}.',
  mark: '> ',
  closing: Object.freeze([
    'Please take this up on branch {branch}; if this folder is on another branch, stop and tell me. If it asks for a change',
    'you agree with, make it and commit it on this branch, without pushing. If it asks a question, answer it. If you think',
    'it is wrong, tell me why and change nothing for it. The change under review is {base}..{head}.',
  ]),
  link: 'Review page: {url}/c/{id}',
  command: 'sonah fix {id}',
});

// ---------- the fix loop's closed lists (the server's vocab.mjs takes them from here) ----------

/** The acts whose words a fix can answer, when written by anyone but the author (FRAME.verbs has a verb for each). */
export const FIX_ACTS = Object.freeze(['override', 'question', 'reply']);
/** A fix's states; a fix's state is its last line. Nothing follows a final state. */
export const FIX_STATES = Object.freeze(['opened', 'launched', 'pushed', 'resolved', 'superseded', 'closed']);
export const FIX_FINAL_STATES = Object.freeze(['resolved', 'superseded', 'closed']);
/** The ways the author opened a fix: the keys of fixLinks, in the same order. */
export const FIX_ROUTES = Object.freeze(['command', 'terminal_link', 'vscode_link', 'copy']);
/** The harnesses an upload's sessions entry may name. */
export const SESSION_HARNESSES = Object.freeze(['claude-code']);

// ---------- shapes ----------

export class FixShapeError extends Error {
  constructor(where) {
    super(`not of its shape: ${where}`);
    this.name = 'FixShapeError';
    this.where = where;
  }
}
const bad = (where) => { throw new FixShapeError(where); };
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isText = (x, min, max) => typeof x === 'string' && x.length >= min && x.length <= max;

const COMMENT_ID = /^c_[0-9a-f]{16}$/;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FULL_SHA = /^[0-9a-f]{40}$/;
// As the server's store has them: a GitHub owner (single - or _ between letters and digits), a repository name, a login.
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9]|[-_](?=[A-Za-z0-9])){0,99}$/;
const NAME = /^[A-Za-z0-9._-]{1,100}$/;
const LOGIN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const ITEM_KEY = /^[^\0\n\r]{1,1024}$/;
const PATH = /^[^\0\n\r]{1,4096}$/;
const TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/;
// Characters no one sees, or that move or break a line: controls, format characters (bidirectional controls,
// zero-width characters, tags), line and paragraph separators, and half of a surrogate pair.
const HIDDEN = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu;
// The same in a person's words, but for their own line feeds and tabs and the zero-width joiners of emoji and scripts.
const NOT_WORDS = /(?![\n\t\u200c\u200d])[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;
// Claude Code's link refuses a control character other than a line feed or a tab; a lone surrogate cannot be encoded.
const NOT_IN_LINK = /[\0-\x08\x0b-\x1f\x7f-\x9f]|\p{Cs}/u;
// A branch: what git check-ref-format --branch refuses, and anything not seen or seen as a space.
const BRANCH_BAD = /[\0-\x20\x7f~^:?*[\\]|\.\.|@\{|\/\//;
const BRANCH_HIDDEN = /[\p{Cc}\p{Cf}\p{Cs}\p{Z}]/u;

/** A comment's id: c_ and 16 hex. */
export const isCommentId = (x) => typeof x === 'string' && COMMENT_ID.test(x);
/** A Claude Code session id: a UUID in lower case. */
export const isSessionId = (x) => typeof x === 'string' && SESSION_ID.test(x);
/** A commit: 40 hex in lower case. */
export const isFullSha = (x) => typeof x === 'string' && FULL_SHA.test(x);
export const isOwner = (x) => typeof x === 'string' && OWNER.test(x);
export const isName = (x) => typeof x === 'string' && NAME.test(x) && x !== '.' && x !== '..';
export const isLogin = (x) => typeof x === 'string' && LOGIN.test(x);
export const isPrNumber = (x) => Number.isSafeInteger(x) && x > 0;
export const isCount = (x) => Number.isSafeInteger(x) && x >= 0;
/** An item's key: a function's facts id, or a finding's k_ key. */
export const isItemKey = (x) => typeof x === 'string' && ITEM_KEY.test(x);
/** A file of the change, as facts names it. */
export const isPath = (x) => typeof x === 'string' && PATH.test(x);

/** A branch name as git allows it (check-ref-format --branch), with nothing hidden and no space of any kind. */
export function isBranch(x) {
  if (typeof x !== 'string' || x.length === 0 || x.length > 255) return false;
  if (x === '@' || x === 'HEAD' || x.startsWith('-') || x.startsWith('/') || x.endsWith('/') || x.endsWith('.')) return false;
  if (BRANCH_BAD.test(x) || BRANCH_HIDDEN.test(x)) return false;
  return x.split('/').every((part) => !part.startsWith('.') && !part.endsWith('.lock'));
}

/**
 * A person's words as they may be stored and shown: some text, at most WORDS_MAX characters, and nothing in them that
 * no one sees or that breaks a line other than a line feed: no control character but a line feed or a tab, no format
 * character (bidirectional controls, zero-width characters, tags; the zero-width joiners of emoji and scripts stay),
 * no line or paragraph separator, no half of a surrogate pair.
 */
export const isWords = (x) => typeof x === 'string' && x.length <= WORDS_MAX && /\S/.test(x) && !NOT_WORDS.test(x);

/** A time as the store writes it: an ISO date and time in UTC (YYYY-MM-DDTHH:MM:SS[.fraction]Z), a real calendar day. */
export function isTime(x) {
  const m = typeof x === 'string' ? TIME.exec(x) : null;
  if (!m) return false;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const feb = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  const days = [31, feb, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= days && h < 24 && mi < 60 && s < 60;
}

/** The server's PUBLIC_URL: an http(s) origin as URL writes it (no path, query, fragment, user or trailing slash). */
export function isPublicUrl(x) {
  if (typeof x !== 'string' || x.length > 2048 || !/^https?:\/\/[^/?#\s@\\]+$/.test(x)) return false;
  try { return new URL(x).origin === x; } catch { return false; }
}

// ---------- showing text ----------

const SHORT = Object.freeze({ '\b': '\\b', '\t': '\\t', '\n': '\\n', '\f': '\\f', '\r': '\\r' });
const escape = (ch) => (Object.hasOwn(SHORT, ch) ? SHORT[ch]
  : Array.from({ length: ch.length }, (_, i) => `\\u${ch.charCodeAt(i).toString(16).padStart(4, '0')}`).join(''));

/** Text from data on one line, as shown: each character no one sees, or that breaks a line, as its JSON escape. */
export const shown = (text) => String(text).replace(HIDDEN, escape);

// A quote as a JSON string, its hidden characters escaped as well, so JSON.parse gives back exactly the quote.
const quoted = (text) => `"${text.replace(/[\\"]|[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu,
  (ch) => (ch === '\\' || ch === '"' ? `\\${ch}` : escape(ch)))}"`;

// A literal of FRAME with its parts filled in, in one pass.
const fill = (template, parts) => template.replace(/\{(\w+)\}/g, (_, k) => {
  if (!Object.hasOwn(parts, k)) throw new Error(`fix-prompt: no part ${k}`);
  return parts[k];
});

/** Whether a prompt fits Claude Code's links: at most LINK_MAX characters as written and once NFKC-normalized (Claude
 *  Code counts the normalized text), and no control character but line feeds and tabs. */
export const fitsLink = (text) => typeof text === 'string' && text.length > 0 && text.length <= LINK_MAX
  && !NOT_IN_LINK.test(text) && text.normalize('NFKC').length <= LINK_MAX;

// A text cut to its first n characters (code points), ending in CUT.
const cutTo = (chars, n) => `${chars.slice(0, n).join('').trimEnd()}${CUT}`;

/** The first line of a person's words that has text, at most `max` characters (a cut one ends in "…"); null for none. */
export function firstLine(words, max = FIRST_LINE_MAX) {
  if (words === null || words === undefined) return null;
  if (!isWords(words)) bad('words');
  const line = words.split('\n').find((l) => /\S/.test(l)).trim();
  if (line.length <= max) return line;
  let out = '';
  for (const ch of line) {
    if (out.length + ch.length + CUT.length > max) break;
    out += ch;
  }
  return `${out.trimEnd()}${CUT}`;
}

// ---------- the prompt ----------

// The thread a reply answers, oldest first: [{ by, act, at, words }], each headed and quoted as the comment itself is.
function checkThread(thread) {
  if (thread === undefined || thread === null) return [];
  if (!Array.isArray(thread) || thread.length > THREAD_MAX) bad('thread');
  return thread.map((t, i) => {
    if (!isObj(t)) bad(`thread[${i}]`);
    if (!isLogin(t.by)) bad(`thread[${i}].by`);
    if (typeof t.act !== 'string' || !Object.hasOwn(FRAME.verbs, t.act)) bad(`thread[${i}].act`);
    if (!isTime(t.at)) bad(`thread[${i}].at`);
    const words = t.words ?? null;
    if (words === null ? t.act !== 'override' : !isWords(words)) bad(`thread[${i}].words`);
    return { parts: { login: t.by, verb: FRAME.verbs[t.act], date: t.at.slice(0, 10) }, words };
  });
}

function check(review, item, comment, publicUrl, thread) {
  if (!isPublicUrl(publicUrl)) bad('publicUrl');
  if (!isObj(review)) bad('review');
  if (!isOwner(review.owner)) bad('review.owner');
  if (!isName(review.name)) bad('review.name');
  const pr = review.pr ?? null;
  if (pr !== null && !isPrNumber(pr)) bad('review.pr');
  if (!isBranch(review.branch)) bad('review.branch');
  if (!isFullSha(review.base)) bad('review.base');
  if (!isFullSha(review.head)) bad('review.head');
  if (!isObj(comment)) bad('comment');
  if (!isCommentId(comment.id)) bad('comment.id');
  if (!isLogin(comment.by)) bad('comment.by');
  if (typeof comment.act !== 'string' || !Object.hasOwn(FRAME.verbs, comment.act)) bad('comment.act');
  if (!isTime(comment.at)) bad('comment.at');
  const words = comment.words ?? null;
  if (words === null ? comment.act !== 'override' : !isWords(words)) bad('comment.words');
  const parts = {
    login: comment.by, owner: review.owner, name: review.name, pr: pr === null ? '' : fill(FRAME.pr, { n: String(pr) }),
    branch: review.branch, head: review.head.slice(0, 12), base: review.base.slice(0, 12), date: comment.at.slice(0, 10),
    url: publicUrl, id: comment.id, verb: FRAME.verbs[comment.act],
  };
  if (!isObj(item)) bad('item');
  if (!isItemKey(item.key)) bad('item.key');
  if (item.kind === 'finding') {
    if (typeof item.tier !== 'string' || !Object.hasOwn(FRAME.tiers, item.tier)) bad('item.tier');
    if (!isText(item.title, 1, TITLE_MAX)) bad('item.title');
    const oneLine = item.oneLine ?? '';
    if (!isText(oneLine, 0, ONE_LINE_MAX)) bad('item.oneLine');
    if (!Array.isArray(item.fns) || item.fns.length > FNS_MAX || !item.fns.every(isItemKey)) bad('item.fns');
    if (!isText(item.quote, 1, QUOTE_MAX)) bad('item.quote');
    return { parts, words, thread: checkThread(thread), kind: 'finding', tier: item.tier, title: item.title, oneLine,
      fns: [...item.fns], quote: item.quote };
  }
  if (item.kind !== 'function') bad('item.kind');
  const added = item.added ?? null, removed = item.removed ?? null;
  if (added !== null && !isCount(added)) bad('item.added');
  if (removed !== null && !isCount(removed)) bad('item.removed');
  return { parts, words, thread: checkThread(thread), kind: 'function', key: item.key, added, removed };
}

// One person's words under their heading: who, how and when, then each of their lines after the mark.
const said = (parts, words) => (words === null ? [fill(FRAME.noWords, parts)]
  : [fill(FRAME.heading, parts), ...words.split('\n').map((line) => `${FRAME.mark}${line}`)]);

function build(p, title, oneLine) {
  const out = [fill(FRAME.opening, p.parts)];
  if (p.words !== null) out.push(FRAME.theirs);
  out.push('');
  if (p.kind === 'finding') {
    out.push(FRAME.finding, fill(FRAME.title, { tier: FRAME.tiers[p.tier], title: shown(title) }));
    if (oneLine) out.push(fill(FRAME.oneLine, { oneLine: shown(oneLine) }));
    if (p.fns.length) out.push(fill(FRAME.functions, { ids: p.fns.map(shown).join(', ') }));
    out.push(fill(FRAME.quote, { quote: quoted(p.quote) }));
  } else {
    const counts = p.added !== null && p.removed !== null
      ? fill(FRAME.counts, { added: String(p.added), removed: String(p.removed) }) : '';
    out.push(FRAME.function, fill(FRAME.fn, { id: shown(p.key), counts }));
  }
  out.push('');
  for (const t of p.thread) out.push(...said(t.parts, t.words), '');
  out.push(...said(p.parts, p.words));
  out.push('', ...FRAME.closing.map((line) => fill(line, p.parts)), fill(FRAME.link, p.parts));
  return out.join('\n');
}

// The largest n in [0, count) for which ok(n) holds, ok holding up to some n and not after; -1 when it never holds.
function largest(count, ok) {
  let lo = 0, hi = count - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ok(mid)) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return best;
}

/**
 * The prompt of a fix: { review: { owner, name, pr, branch, base, head }, item, comment: { id, by, act, at, words },
 * thread (a reply's: the comments it answers, oldest first, each { by, act, at, words }; none for the others),
 * publicUrl } -> text (FIXLOOP.md "Shapes" names each field). Every field is checked by shape (FixShapeError names the
 * first that is not). Only Sonah's own title and one line are ever cut, the one line first, each ending in "…", and only
 * so the prompt fits the links (fitsLink). When it cannot fit with both cut to "…" (the words, the quote, the functions
 * and the frame alone pass the limit), nothing is cut: the prompt stays whole, and fixLinks offers no link for it.
 */
export function fixPrompt({ review, item, comment, thread = [], publicUrl } = {}) {
  const p = check(review, item, comment, publicUrl, thread);
  const make = (title, oneLine) => build(p, title, oneLine);
  const whole = p.kind === 'finding' ? make(p.title, p.oneLine) : make('', '');
  if (p.kind !== 'finding' || fitsLink(whole)) return whole;
  const one = Array.from(p.oneLine);
  const restOne = one.length ? CUT : '';
  if (!fitsLink(make(CUT, restOne))) return whole;
  if (one.length) {
    const n = largest(one.length, (k) => fitsLink(make(p.title, cutTo(one, k))));
    if (n >= 0) return make(p.title, cutTo(one, n));
  }
  const title = Array.from(p.title);
  return make(cutTo(title, largest(title.length, (k) => fitsLink(make(cutTo(title, k), restOne)))), restOne);
}

// A part of a URL: encodeURIComponent, and !'()* too, so the link stays whole wherever it is pasted.
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * The ways to open a fix, keyed as FIX_ROUTES: { command, terminal_link, vscode_link, copy }. command is fixed text and
 * the id; the links carry the prompt URL-encoded, fill Claude Code's box and never send. Both links are null when the
 * prompt does not fit them (fitsLink), and vscode_link also when no session is given (the session that wrote the
 * item); the command and the copy always carry the whole prompt.
 */
export function fixLinks({ prompt, commentId, owner, name, session = null } = {}) {
  if (typeof prompt !== 'string' || prompt === '') bad('prompt');
  if (!isCommentId(commentId)) bad('commentId');
  if (!isOwner(owner)) bad('owner');
  if (!isName(name)) bad('name');
  if (session !== null && session !== undefined && !isSessionId(session)) bad('session');
  const fits = fitsLink(prompt);
  const q = fits ? enc(prompt) : '';
  return Object.freeze({
    command: fill(FRAME.command, { id: commentId }),
    terminal_link: fits ? `claude-cli://open?repo=${enc(owner)}/${enc(name)}&q=${q}` : null,
    vscode_link: fits && session ? `vscode://anthropic.claude-code/open?session=${session}&prompt=${q}` : null,
    copy: prompt,
  });
}
