// Session story (M33 S). A GitHub-ready Markdown account of ONE recorded session, for a developer, a
// lead or a product person who would otherwise review a 40-file PR. It is built ONLY from the redacted
// Session the adapter builds and a finished review report (report.private.json / runReview's report).
//
// Pure and deterministic: no clock, no random source, no network, no model, no filesystem. Same inputs,
// same bytes out. No ordering here depends on the locale (no localeCompare).
//
// Owner decisions (2026-09-30): a step was ONE REVIEW WINDOW, in `windowResults` order, and a long session simply had
// many steps; three reader sections (product, lead, engineer) in one file; low verbosity; no "what could go wrong"
// section; the output is a .md file people may push to GitHub. Owner decision D77 C (2026-10-11; story /14): a STEP IS
// ONE OF YOUR REQUESTS — the events the review windows hold that belong to that request, in session order, whichever
// windows hold them — so a request reviewed across several windows is one step, and a window packing several requests
// (D68 K) contributes to each one's step; work recorded before your first request is one step of its own, first. The
// step count is the number of your requests the review touched (plus that one), never the number of windows. Owner
// decision D79 (2026-10-11; story /15): a file you attached to a message belongs to that message's request (the
// recorder's `attached` marker, as windows.js `startsSegment` keeps it with its message), shown under the message.
//
// Three rules carry the weight:
//   1. Every quote shown is a receipt the review recorded AND one this code finds again, literally, in
//      the session it is given (`verifyReceipt`, string search). A quote that does not ground here is
//      not shown; a fixed sentence says so. A requirement's quoted words are one of its grounded instruction
//      quotes, read from the recorded request itself.
//   2. Step titles, line counts and snippets are computed from recorded facts only — invocations, their
//      recorded outcomes, and the recorded change bodies. No model writes any of them. Writes the
//      recorder marks as outside the repository (harness memory, plans, scratch files) are counted, never
//      shown: no path, no line count, no snippet.
//   3. Everything a reader sees is bounded: quotes 120 chars, commands 80, paths 120, snippets 12 lines of
//      160 chars, chart labels 60, the overview chart 30 nodes and each step chart 40, each section a share of the
//      document, and the whole document `STORY_LIMITS.targetBytes` where it can be, never more than
//      `STORY_LIMITS.maxBytes`. Every cut is stated.
//
// M33 S2 (readability of a long review): harness context a recorder keeps as a user message is
// never an ask; step titles name what happened (edits, failed commands, commits, reads, scripts, helpers); a
// requirement the review re-proposed in every window is one row with the status of the last window that
// proposed it, and every request keeps its heading and visible rows before any is folded; leads see only
// decisions the review is SURE were made without asking you; quiet steps fold into one line (a step holding
// a claim the agent wrote into a file is never quiet); and no closed token (a status, a column, a
// materiality, a label) reaches a reader.
//
// M33 S3 (long Codex stories): harness context is never an ask — M5; M34 labels: the slicer labels which recorded message is the human's once, for every reader (slicer
// labels.js, by the recorder's structure: Codex by its typed `UserMessage` channel), and the story reads that label; the closed context-tag
// list, the human-reply tag and the clipped-message rule it re-decided by are retired; a requirement is grouped by the human words its
// rows cite, not by the review's wording, and reads as those words — but two rows are one requirement only when
// their quotes share words, rows one window proposed side by side are never one, and when nothing tells which
// requirement a row continues it is shown on its own, so no open requirement is closed by a guess; and a step block
// says each thing once (the leads' count of decisions the review could not check is not repeated, several written
// statements or test runs are one counted line with their list folded, and a failed test run or a contradicted
// statement stays visible past the bullet cap, a bounded number of them on their own lines).
//
// M33 S5 (a long story rendered as GitHub renders it, fit to the page width): one chart of every step, with
// its helpers in a lane at the bottom joined by edges the height of the chart, was scaled down until no label could
// be read. "What happened" is now an OVERVIEW: each request, and under it its phases (runs of steps doing the same
// kind of work), findings, changes of approach and helpers beside them, at most `overviewNodes` nodes and at most
// `overviewWidth` side by side. Each request's steps are charted once, folded, at the top of that request in the
// engineer section. In every chart an edge joins adjacent ranks, and a helper hangs beside the node that spawned it
// and joins the chain again at the next node: no lane, no edge across the chart.
//
// D78 (owner decision 2026-10-11): since D77 C a request owns exactly one step, so the rules that acted on several
// steps of one request are removed: runs of quiet steps folded into one line (a quiet step is still one line of its
// own), runs of steps as overview phases (each step is its own box; the overview levels that joined or merged them),
// the grouping of helper-only and plain steps in a step chart (its two levels), and the step chart's hard stop (one
// step's chart has at most two nodes at its last level). No byte of any story moved.

import { verifyReceipt, artifactRanges, PROJECT_INSTRUCTIONS_ROLE, referredPath } from '../evidence/src/session.js';
import { startsSegment } from '../evidence/src/windows.js';
import { codeContradictedRows, codePassFindings, codePassQuestions } from '../evidence/src/code-pass.js';
import { DECISION_COLUMNS, honestStatuses, WRITTEN_LABELS, PROMISE_STATUSES, DISCLOSURE_REASONS, FORBIDDEN_EDIT_BREACHES,
  REQUIREMENT_STATUSES, CONTRADICTION_SOURCES, CONTRADICTION_ROLES, STOPPED_DENIALS, STOPPED_WORDS, shellWriteWords,
  OUTPUT_NOT_MASKED, OWN_WRITTEN_SOURCE, CODE_CHECK_OUTCOMES, CODE_CHECK_REASONS, CODE_FILE_STATES, CODE_FINDING_KINDS,
  CODE_PASS_LENSES, CODE_FOOTER_KINDS, CODE_STEP_PARTS, FAILURE_HANDLINGS, resultOutcome }
  from '../evidence/src/ledger.js';
import { FOLDED_SECTION_WORDS, FAILURE_SECTION_WORDS, CHECKLIST_FAILURE_WORDS, CHECKLIST_FAILURE_REASON_WORDS,
  CHECKLIST_OUTCOME_WORDS, CHECKLIST_REQUIREMENT_REASON_WORDS, askRowKind, claimRowKind, failureRowKind, writtenRowKind,
  derivedColumn, listedPromises } from '../evidence/src/review.js';
import { INTER_AGENT_GAP_NOTES, HELPER_RECEIPT_BOUNDARY } from '../evidence/adapters/sonah-ledger.js';
import { readOnlyProgram, readOnlyGit } from './read-only-programs.js';
import { maskForPeople, maskValues, peopleMask, peopleSecretsFor, joinHidden, joinSecretValues, NO_PEOPLE_SECRETS }
  from '../redact/index.js';

/** The story's layout version, reported in the script's summary. /2 (M33 S2): folded quiet steps, one row per
 *  distinct requirement, the requests cell, the lead table of confident decisions, and plain words throughout.
 *  /3 (M33 S3): requirements as the human's quoted words (with the review's words when two read the same),
 *  replies, and step blocks that count their lists. /4 (M33 S5): an overview chart of requests and phases, and one
 *  folded step chart per request in the engineer section. /5 (M1): no "ran tests"
 *  from a runner-name list; a step names every command the record says failed, verbatim. /6 on M33 outcomes repair
 *  (status fact, owner decision 2026-10-06): a claim confirmed by a recorded result shows the result's words it was
 *  confirmed through (`confirmingQuote`). /6 on M33 gate repair (L6): a requirement row that ties between two
 *  requirements quoting the same words starts its own, never one an English stop-word similarity picks. */
/** /7 (M33 integration, 2026-10-06): one version above both /6s (the status fact's and L6's, which collided) for the
 *  merged story: H4's lead table and decision order, the status fact's confirming quote, G3's "confirmed by a recorded
 *  result", L6's tie rule, and H2/M5's structural human channel. */
/** /8 (D64 wording, owner decision 2026-10-07): an upheld disclosure says what the challengers upheld — "The agent told
 *  you afterwards that it went against your instruction" (`STORY_SENTENCES.editDisclosed`), its statement labelled "The
 *  agent told you it went against your instruction" (`STORY_FORBIDDEN_EDIT_LABELS.reported`). No other text moved. */
/** /9 (M35 windowing, C-07 "M35 windowing"): a step is still one review window, and a helper's windows are steps of
 *  their own; no window holds a helper's receipt boundary, so a helper is listed under the step holding its receipt,
 *  else under the step of the last event of its own session recorded before it. No text moved. */
/** /10 (M36 phase 3, owner decision D68 K, C-07 "M36 packed windows"): small sessions share a review window, so a step
 *  (still one review window) may hold a helper's events beside its parent's; the placement rule is /9's. No text moved. */
/** /11 (D71 (a), owner decision 2026-10-08: no verdict anywhere the human sees): no status word — the findings are
 *  listed under one "Findings" heading, each "Finding" with its recorded facts; the charts draw every finding alike and
 *  name it "Finding"; the head table counts the requests first, then the findings, the decisions made without asking and
 *  the changes of approach, and says only whether Sonah's own review completed ("Review"), never a session status. */
/** /12 (D71 S4): a checklist ask (a session-only review's statuses) is read as code published it — its status after the
 *  code checks and the challenge, never the answer's proposed one — one row per published row (`checklistRequirement`);
 *  and a contradicted claim's contradicting quote is labelled by its code-set source ("You said", "The file's recorded
 *  content", "The project's instruction file"; a result's as before). A legacy report's bytes do not move. */
/** /13 (S6, S5 review L4; owner decision D71 d): a choice not to act is marked wherever the story lists it — in its step
 *  and among the decisions for leads — in bold fixed words (`STORY_NOT_ACTING_MARK`), as the page and the PR comment mark
 *  it. A report with no such decision keeps its bytes. */
/** /14 (owner decision D77 C, 2026-10-11): a step is one of your requests — every event the review windows hold that
 *  belongs to that request (`requestOfEvent`: the last of your asks at or before it; a helper's by the hand-off that
 *  delivered or launched its work), in session order, whichever windows hold them — no longer one review window: a
 *  window packs consecutive requests (D68 K), so one window held several requests as one step under the last of them
 *  (a review of two requests read "1 step", every row under request 2), and a long request spanned many steps. Now a request reviewed
 *  across several windows is one step with those windows; work before your first request is one step, first; a request
 *  no window touches has no step. Each step keeps its windows and the failure of the first that failed; a requirement's
 *  steps run from its request's step (or the first step of the first window that proposed it, if later) to the last step
 *  of the last; `ask.steps` is the request's own step. The steps, the rows placed in them, the request each is shown
 *  under, the engineer section's headings and the charts follow. A report whose every window holds one request, each
 *  request in one window, keeps its bytes. D78 removed the rules /14 left with nothing to act on (the header's D78
 *  paragraph); no byte moved, so the version holds. */
/** /15 (owner decision D79, 2026-10-11): a file you attached to a message belongs to that message's request — for the
 *  steps and for the request every row is shown under (`requestOfEvent` counts only the messages that start a segment,
 *  windows.js `startsSegment`: the recorder's `attached` marker, never the words) — no longer a request and a step of
 *  its own (/14 read every human instruction event as a request, so one message with one attached file was two
 *  requests, two steps, and the work after the file was shown under the file). The file stays visible under its
 *  message, one "You attached:" line in the product and engineer sections; a requirement citing it is its message's.
 *  One recorded before any message of yours belongs to no request (`facts.unattached`); its line is shown before your
 *  requests in the product section and in the step of the work before your first request. The "N asks" count and the
 *  request numbers count messages. A session with no attached file keeps its bytes. */
/** /16 (owner decision D79, 2026-10-11): a command Claude Code refused did not run. A call whose record carries the
 *  recorder's typed denial of a kind that means refused before it ran (`REFUSED_DENIALS`) is counted and shown as "did
 *  not run" — a title phrase, a kept bullet (`STORY_BULLETS.didNotRun`) — never among the commands that failed,
 *  whatever its result says; the interrupted and cancelled kinds keep the result rule (not decided). And a write the
 *  slicer parsed from a command (`shellWriteOf`: a heredoc's body) whose command did not run or failed changed nothing:
 *  it has no change row and is never the body a later write of the path is compared with (`countedChanges`); a
 *  structured write the recorder typed as having a prior file that carries none (the slicer gave the prior state to
 *  that never-run write) is then no create: its removals are `?` (`PRIOR_HELD`). Typed fields only. A session with no
 *  refused command and no shell write of a refused or failed command keeps its bytes. */
/** /17 (owner decision D80, 2026-10-12; the D80 integration's one step for its four items; page /19): item N, D79's "or
 *  failed" is narrowed, and a stopped command has one phrase. A write the slicer parsed from a command (`shellWriteOf`)
 *  has no change row only when its command did not run (`REFUSED_DENIALS`). One whose command failed, or was stopped,
 *  keeps its row, never as done: it is not among the files the story counts as changed (no title verb, no "N files
 *  changed", no file list, no snippet) but named on its own kept bullet, "Write not recorded as done: `path` +n −m —
 *  its command failed, so whether this write happened is not recorded" (evidence `shellWriteWords`, the ledger's words
 *  for that write: C-02, its command's status never proves whether it happened), and after it the path's content is not
 *  known (a later write that records no prior of its own reads its removals as `?`). And a call the recorder typed with
 *  a stopped denial kind (`STOPPED_DENIALS`: `interrupted`, `cancelled`), which /16 left to the result rule, is
 *  `stopped`, never failed and never did not run: a title phrase "1 command stopped before it finished" (no alarm) and
 *  a kept bullet "Stopped before it finished: `…`", the evidence's one phrase (`STOPPED_WORDS`); its step is never
 *  drawn as reading only (`readingStep`: it started, and what it changed is not recorded). Typed fields only. A session
 *  with no stopped call and no shell write of a failed command keeps its bytes. The other three D80 items move no code
 *  here: item M (two published claims apart only by a support no check upheld are one claim) and item Q (a quote only
 *  in the body of a write whose command did not run, failed or stopped is refused) reach the story only through the
 *  report it reads (the claims count, the claim lines, the rows a refusal leaves not checked); item W (the quoted
 *  line's own window) is the page's. */
/** /18 (owner decision D84, 2026-10-12, "off for the model, on for output"; page /23): the session the story is told
 *  from is the one the model read, unredacted, so the story masks it as it writes: it is rendered from the session as a
 *  person may read it (`sessionForPeople`: every recorded span masked whole by `maskForPeople`, redact/index.js), and
 *  every text it shows passes `maskForPeople` before it is cut or escaped (`visible`, `clip`, `md`, `html`). A quote
 *  of the reviewer's that a mask touches no longer grounds and is not shown. A session with nothing to mask keeps its
 *  bytes, but for this version string. The D84 review (same version, never released): each field is first masked
 *  with what the redactor's full walk hid in it, and every text with the session's values (`asPeopleRead`). */
/** /19 (the column fix; owner decision D83 (2) on the normal column path, 2026-10-12; renumbered later
 *  from /18, which D84's masking took; page /24): a decision whose column the ledger derived from a project
 *  instruction file the agent was given (its covering receipt of role project-instructions on that file, grounded
 *  here) says who decided it with the file it was referred from, by the path the recording carries ("you settled
 *  (referred from `CLAUDE.md`)", `STORY_REFERRED_FROM`), never as words said in the session. A story with no such
 *  decision keeps its bytes. And later, in the same unreleased /19: a file whose recorded path lies outside
 *  the working tree as written (absolute, home-relative or climbing out of it) is named by its file name alone
 *  (session.js `referredPath`), never by a home or absolute path; a path inside it reads as recorded. And Gain I
 *  (2026-10-13, the images gain; page /24), in the same unreleased /19: under a message you pasted an image (or
 *  other nontext content) into, one line says so by count (`STORY_SENTENCES.pasted`), never the image; the coverage
 *  line names that loss by its own causes (`instructions_nontext`, `instructions_nontext_unplaced`), no longer "elided
 *  by the recorder". A story of a session with no nontext human input keeps its bytes. */
/** /20 (W1 B, owner decision 2026-10-13; page /25): an edit against what you said whose rule is a project instruction
 *  file the main agent was given before the change shows that file's words labelled as the file's ("The project's
 *  instruction file", `STORY_FORBIDDEN_EDIT_LABELS.file`), never as words you said. A story with no such edit keeps its
 *  bytes. */
/** /21 (W2, owner decision 2026-10-13; page /26): a claim contradicted by the text the agent's own edit or write added
 *  (ledger.js CONTRADICTION_SOURCES `own_written`) labels that text "Code the agent wrote", never a file's recorded
 *  content; a statement written into a file that such text contradicts says so (`writtenWords`), never "by a recorded
 *  result". A story with no such claim or statement keeps its bytes. */
/** /22 (the review of W4, 2026-10-14; W4 is the owner's "never started" decision): an ask published not-done because no
 *  action was recorded after it (the fact `no_action_after_ask`) says so beside its row, in the page's and the PR
 *  comment's words (STORY_REQUIREMENT_FACT_WORDS), so a reader can tell that status came from that rule and not from a
 *  check. A story with no such ask keeps its bytes. */
/** /23 (D87, owner decisions 2026-10-13/14; page /28; built beside W4's review as /22 and page /27, renumbered at their
 *  merge): a review with a code pass (`report.codePass`) has a section "What the code review found"
 *  (`codeSection`) after the findings: the claims, asks and decisions its check found contradicted by the code at review
 *  time, then each upheld finding with its title and explanation (the review's words), its path and lines, its code
 *  quote when it is found again in the span stored with the file's sha256, and the row it follows from; and each checked
 *  row says its code check beside its status (`codeCheckWords`), after any fact W4 gives it. A story of a review without
 *  a code pass keeps its bytes. */
/** /24 (the W4 revert, owner decision 2026-10-14; page /29): W4 is removed, and with it /22's words beside a row that
 *  carries `no_action_after_ask` (STORY_REQUIREMENT_FACT_WORDS): a requirement row says its status, its step and its code
 *  check, and no fact. A story of a report without that fact keeps its bytes. */
/** /25 (D88, owner decision 2026-10-14, amending D71 S2's "every row short of done points attention"; page /30): the
 *  story follows the page's order, led by the agent's judgment and the settled problems — the decisions and changes of
 *  approach (for leads), your requests with their settled asks (for product), the failures the agent passed over (a
 *  checklist report's: each with what came back and the end of its turn; the ones it acted on or told you about folded),
 *  what the agent told you (its contradicted claims, then the claims confirmed by a recorded result, folded), the edits
 *  against what you said (with the statements written into files and contradicted), what the code review found, and
 *  last, under its own heading, "What Sonah could not check (N)": every row of review.js FOLDED_ROWS, folded in one
 *  `<details>` block — the asks not checked (with why), the claims not checked or resting on a check that never
 *  completed, the failures not checked (with why), the statements written into files and not checked. Each section that
 *  holds such rows says how many. Then what happened (the overview) and the engineer section, as before. No row is
 *  removed; the step blocks keep theirs. */
/** /26 (the code step, code-pass/2; page /31; built beside D88
 *  as /25 and page /30, renumbered at their merge): "What the code review found" lists, in order, the findings
 *  that follow from a row of the session review placed beside that row (with the rows the check found contradicted by
 *  the code), then the other findings in table-of-contents order, then the open questions for you, then what the code
 *  review did not cover. A finding says its kind, its place, its title and explanation, the input it names and the steps
 *  of its trace, each step's quote shown only when it is found again (`codeQuoteOf`, `sessionQuoteOf`), and the lenses
 *  that reached it. The section keeps D88's place: after the edits against what you said, before What Sonah could not
 *  check. A story of a review without a code pass keeps its bytes. */
/** /27 (the review of the code step, 2026-10-14; page /32; built beside D88 as /26 and page /31, renumbered at their
 *  merge): what the code review did not cover also says, by count only, how many paths outside the working
 *  directory differ from where the session started (`codeFooterLines`). A story of a review with no such path keeps its
 *  bytes but for its version. */
/** /28 (the judgment-first review, 2026-10-14; page /33): the story lists the claims every reader lists (review.js
 *  `listedPromises`: one a contradicted-claim finding cites is that finding, never also a claim) and reads who decided
 *  by the one rule (`derivedColumn`). A story whose claims no finding cites keeps its bytes but for its version. */
/** /29 (the release review, 2026-10-14; page /34): with the home folder as the repository, what the code review did
 *  not cover says that only the files the session changed or read were read, and counts the other paths that differ
 *  (`codeFooterLines`); and the code review's coverage is said plainly (`codeCoverageLines`). A story with no code pass,
 *  or one whose code pass read every file it showed, keeps its bytes but for its version. */
export const STORY_VERSION = 'sonah.session-story/29';
/** D87: the code pass's words, for the story and the page (page.js `PAGE_CODE_WORDS`). Fixed words, filled with counts,
 *  paths, line numbers and escaped text only.
 *  "Shown in code" is said as what the code at review time shows, never as verified: the files were read, never run. */
export const STORY_CODE_WORDS = Object.freeze({
  heading: 'What the code review found', label: 'Code check',
  footer: 'The code was read as it is now, after the session, under What the code review found; nothing was run.',
  outcomes: Object.freeze({ [CODE_CHECK_OUTCOMES[0]]: 'the code at review time shows it',
    [CODE_CHECK_OUTCOMES[1]]: 'the code at review time contradicts it',
    [CODE_CHECK_OUTCOMES[2]]: 'not checked in the code' }),
  reasons: Object.freeze({ [CODE_CHECK_REASONS[0]]: 'the file it rests on was not shown to the reviewer',
    [CODE_CHECK_REASONS[1]]: 'the code the reviewer quoted is not word for word in the file',
    [CODE_CHECK_REASONS[2]]: 'the lines the reviewer named do not hold the code it quoted',
    [CODE_CHECK_REASONS[3]]: 'the file no longer holds what the session wrote to it',
    [CODE_CHECK_REASONS[4]]: 'the request was too large to send',
    [CODE_CHECK_REASONS[5]]: 'the code review gave no answer either way',
    [CODE_CHECK_REASONS[6]]: 'the checking passes refuted the reviewer\'s answer',
    [CODE_CHECK_REASONS[7]]: 'the checking passes did not all uphold the reviewer\'s answer',
    [CODE_CHECK_REASONS[8]]: 'a checking pass did not run',
    [CODE_CHECK_REASONS[9]]: 'the reviewer could not tell from the code' }),
  states: Object.freeze({ [CODE_FILE_STATES[1]]: 'not shown whole for lack of room', [CODE_FILE_STATES[2]]: 'binary',
    [CODE_FILE_STATES[3]]: 'withheld as credential-shaped', [CODE_FILE_STATES[4]]: 'withheld as harness files',
    [CODE_FILE_STATES[5]]: 'too large for one request', [CODE_FILE_STATES[6]]: 'changed since the session',
    [CODE_FILE_STATES[7]]: 'not there any more', [CODE_FILE_STATES[8]]: 'outside the working directory',
    [CODE_FILE_STATES[9]]: 'could not be read' }),
  how: 'Sonah reviewed the change the session made the way a code reviewer reviews a pull request, with its review of '
    + 'the session beside it: every file that differs from where the session started, as it is now, and the files the '
    + 'session read. It ran nothing. It first checked whether the code shows what the agent claimed, decided and was '
    + 'asked, then read the change for behaviour, tests, contracts and your ask. Every answer and finding here quotes '
    + 'the code, was checked word for word by code, and was upheld by all of three independent checking passes; what '
    + 'was not is left off.',
  base: (commit) => (commit ? `The change runs from the commit the session started from (${commit}) to the files now.`
    : 'No git history placed where the session started: the change shown is the session\'s own recorded edits.'),
  files: (shown, total, others) => `It showed the reviewer ${shown} of the ${plural(total, 'file')} the session `
    + `changed or read, or that differ from where it started${others ? `; the others: ${others}` : ''}.`,
  // The release review (owner, 2026-10-14): the code review's own coverage, said plainly whether or not it decides the
  // exit code (it does only with --code-pass on the command line): it ran with no working directory to read under, it
  // had no file to read, or it did not read every file it showed.
  noRoot: 'The code review did not run: the working directory the recording names is not on this computer, so no file '
    + 'was read.',
  noFile: 'The code review had no file to read: the session changed or read none, and none differs from where it started.',
  coverage: Object.freeze({ partial: 'The code review did not read every file it showed: what it did not cover is listed '
    + 'below.', missing: 'The code review did not complete: what it did not cover is listed below.' }),
  contradictedGroup: 'Claims, asks and decisions the code at review time contradicts', findingsGroup: 'Findings',
  besideGroup: 'Beside what the session review found', restGroup: 'Other findings of the code review',
  questionsGroup: 'Open questions for you', footerGroup: 'What the code review did not cover',
  finding: 'Code review finding', followsFrom: 'Follows from', codeNow: 'The code now',
  codeBefore: 'The code before the session', sessionSaid: 'Recorded in the session', input: 'For the input',
  trace: 'How it gets there', foundBy: 'Found through', concerns: 'It concerns',
  kinds: Object.freeze({ [CODE_FINDING_KINDS[0]]: 'a bug', [CODE_FINDING_KINDS[1]]: 'a missed case',
    [CODE_FINDING_KINDS[2]]: 'a test that would still pass with the bug', [CODE_FINDING_KINDS[3]]: 'a broken contract',
    [CODE_FINDING_KINDS[4]]: 'an ask not met' }),
  lenses: Object.freeze({ [CODE_PASS_LENSES[0]]: 'behaviour', [CODE_PASS_LENSES[1]]: 'tests',
    [CODE_PASS_LENSES[2]]: 'contracts', [CODE_PASS_LENSES[3]]: 'your ask' }),
  footerLines: Object.freeze({
    [CODE_FOOTER_KINDS[0]]: (paths) => `${plural(paths.length, 'file')} not shown whole for lack of room: ${paths.join(', ')}`,
    [CODE_FOOTER_KINDS[1]]: (paths) => `${plural(paths.length, 'file')} too large for one request: ${paths.join(', ')}`,
    [CODE_FOOTER_KINDS[2]]: (states) => `${plural(states.reduce((n, [, k]) => n + k, 0), 'file')} withheld (${states
      .map(([state, k]) => `${k} ${state}`).join(', ')})`,
    [CODE_FOOTER_KINDS[3]]: (parts) => `calls that did not answer: ${parts.join(', ')}` }),
  outsideLine: (n) => `${plural(n, 'path')} outside the working directory also ${n === 1 ? 'differs' : 'differ'} from `
    + 'where the session started: not reviewed, and not named',
  // The release review (medium): the repository is the home folder or holds it.
  homeLine: (n) => `The repository is your home folder, so only the files the session changed or read were read${n > 0
    ? `; ${plural(n, 'other path')} that ${n === 1 ? 'differs' : 'differ'} from where the session started ${n === 1
      ? 'was' : 'were'} not read, named or sent` : ''}, and untracked files it did not change or read were not looked for`,
  parts: Object.freeze({ [CODE_STEP_PARTS[0]]: 'the check of the session review against the code',
    [CODE_STEP_PARTS[1]]: 'the lens', [CODE_STEP_PARTS[2]]: 'the checking passes of that check',
    [CODE_STEP_PARTS[3]]: 'the checking passes of the findings' }),
  footerNone: 'Nothing: every file was shown, and every call answered.',
  quoteUnchecked: 'Its quote is not shown: it was not found again where the review read it.',
  noFindings: 'The code review published no finding.',
  rowKinds: Object.freeze({ promises: 'the claim', writtenClaims: 'the statement written into a file',
    findings: 'the contradicted claim', requirements: 'the ask', decisions: 'the decision', failures: 'the failure',
    pivots: 'the change of approach' }),
});
/** D71 (d): the fixed words that mark a choice not to act (a published decision code carried `notActing` on). */
export const STORY_NOT_ACTING_MARK = 'a choice not to act';
const notActingMark = (d) => (d?.notActing === true ? ` **(${STORY_NOT_ACTING_MARK})**` : '');

/** Every bound the story keeps, in one frozen table. `targetBytes` is what a long session's story aims for;
 *  `maxBytes` is the hard bound past it. The overview aims at `overviewNodes` nodes and has more only to keep every
 *  request and every step with a finding or a contradicted statement, never more than `overviewMaxNodes`; it never
 *  has more than `overviewWidth` on one rank. A step chart never has more than `stepChartNodes`; no chart label more
 *  than `chartLabelChars` characters. */
export const STORY_LIMITS = Object.freeze({
  maxBytes: 200_000, targetBytes: 70_000, minBytes: 20_000, overviewNodes: 30, overviewMaxNodes: 60, overviewWidth: 3,
  stepChartNodes: 40,
  snippetLines: 12, snippetLineChars: 160, quoteChars: 120, commandChars: 80, askChars: 160, titleChars: 80, chartLabelChars: 60,
  settledChars: 40, pathChars: 120, titleDirChars: 60, filesPerStep: 15,
  bulletsPerStep: 10, listedPerStep: 20, contradictedPerStep: 10, findings: 30, leadRows: 60, decisionsListed: 150,
  // D88: the entries (group headings included) What Sonah could not check lists, past which the rest are counted.
  foldedRows: 300,
  pivotsShown: 15, pivots: 100, promises: 50, asks: 40, rowsPerAsk: 8, requirementsPerAsk: 40, stepRuns: 10, textChars: 160,
  diffLines: 50_000, diffWork: 1_000_000, requirementWork: 2_000_000,
  // M33 F: a helper's reported first sentence in a step block; beside a report, its brief in a chart node.
  reportChars: 100, briefBesideReportChars: 20,
});
/** The share of the document's target each head section may use: a cap, never a reservation — a section takes what it
 *  needs, up to its share. The engineer section has what is left of the target, and when the sections above it leave too
 *  little, what is left of the bound. Within the lead section, the decision table may use 40% of it; the list of the
 *  other decisions and the changes of approach each half of what is left. The chart share holds every chart: the
 *  overview first, and the step charts (in the engineer section) share what it leaves. D88: what the agent told you and
 *  the edits against what you said each take the `decisions` share (the findings', which they split; the claims moved
 *  there from the lead section), and the failures and what Sonah could not check have their own. */
export const STORY_SHARES = Object.freeze({ decisions: 0.2, chart: 0.15, product: 0.25, lead: 0.2,
  // D88: the failures it passed over, and what Sonah could not check.
  failures: 0.1, folded: 0.2 });

// ---- closed vocabularies ---------------------------------------------------------------------------
// The words a reader compares across stories — who decided, statuses, materiality, receipt labels,
// requirement and claim words, chart collapses, fixed sentences — are in these tables. The rest (section
// headings, step-title verbs, chart node prefixes, count phrases) are fixed literals in this file. Only
// counts, step numbers and recorded text (escaped and clipped) are ever filled in; a model's words never are.

/** Who decided, by the ledger's derived column (DECISION_COLUMNS). A column counts only when the ledger
 *  derived it (`columnState` grounded); a `null` column (`columnState` unchecked) is `unchecked`: the review
 *  could not check whether you were asked, so the decision is only POSSIBLY made without asking. Leads are
 *  shown the confident ones; the possible ones are counted and listed apart, never counted with them. */
export const STORY_WHO_DECIDED = Object.freeze({
  [DECISION_COLUMNS[0]]: 'you settled',
  [DECISION_COLUMNS[1]]: 'you asked, agent chose',
  [DECISION_COLUMNS[2]]: 'agent, not asked',
  unchecked: 'agent; could not check if you asked',
});
/** /18 (D83 (2)): the words after who decided a decision a project instruction file covers, by its recorded path.
 *  Later: a path outside the working tree as written is named by its file name alone (`referredPath`). */
export const STORY_REFERRED_FROM = (path) => `(referred from ${codeSpan(clipPath(referredPath(path)))})`;
/** /18 (D83 (2)): the recorded path of the project instruction file a decision's covering words are referred from —
 *  its `constrainedBy` receipt of role project-instructions, on an event of that kind, grounded in `session` — else
 *  null. */
function referredFromOf(session, d) {
  const instruction = plainObject(d?.constrainedBy) ? d.constrainedBy.instruction : null;
  if (!plainObject(instruction) || instruction.role !== PROJECT_INSTRUCTIONS_ROLE) return null;
  const source = session?.event?.(instruction.eventId);
  if (source?.kind !== PROJECT_INSTRUCTIONS_ROLE || typeof source.path !== 'string' || !source.path) return null;
  try { return verifyReceipt(session, instruction).ok ? source.path : null; } catch { return null; }
}
/** Who decided a decision, as a line says it: the closed words, and (/18) the file its covering words were referred
 *  from. */
const whoDecided = ({ who, referredFrom }) => `${STORY_WHO_DECIDED[who]}`
  + `${typeof referredFrom === 'string' ? ` ${STORY_REFERRED_FROM(referredFrom)}` : ''}`;
/** How the chart names a decision made without asking, by the same key. */
export const STORY_CHART_UNASKED = Object.freeze({ [DECISION_COLUMNS[2]]: 'Not asked' });
/** D71 (a), owner decision 2026-10-08: a finding as a reader reads it — never its status (before D71: "Needs your
 *  decision" for DECIDE, "Worth a look" for FYI). Its recorded facts (corrected, undone, disclosed, a helper's own) are
 *  said beside it in `STORY_SENTENCES`. */
export const STORY_FINDING_WORDS = Object.freeze({ one: 'Finding' });
/** D88: the story's checklist sections after the leads' and the product's, in the page's words (page.js PAGE_LABELS):
 *  the failures it passed over, what the agent told you, and the edits against what you said. What Sonah could not check
 *  is review.js FOLDED_SECTION_WORDS. */
export const STORY_CHECKLIST_HEADINGS = Object.freeze({ failures: 'Failures it passed over',
  claims: 'What the agent told you', edits: 'Edits against what you said' });
/** How a receipt is labelled, by its C-05 role. */
export const STORY_RECEIPT_LABELS = Object.freeze({
  commentary: 'Agent said', observation: 'Recorded result', instruction: 'You said', action: 'Agent did',
  code: 'Code written',
  // D71 (g), S4: the project's own instruction file the harness gave the agent (its own role, C-05).
  'project-instructions': "The project's instruction file",
});
/** D71 (e), (g), S4: what contradicts a claim, by the finding's code-set source (ledger.js CONTRADICTION_SOURCES; a
 *  finding without one cites a result, as before): its receipt is labelled by it — an edit's removed or context lines
 *  are the file's recorded content, never "Code written". */
export const STORY_CONTRADICTION_LABELS = Object.freeze({ result: 'Recorded result', human_message: 'You said',
  file_content: "The file's recorded content", project_instructions: "The project's instruction file",
  // W2 (/21): the text the agent's own edit or write added.
  own_written: 'Code the agent wrote' });
/** D71 (e), (g): a contradicted claim's source (`contradictionSource`, code's; absent means a result), or null for any
 *  other finding. */
export const contradictionSourceOf = (f) => (f?.kind !== 'claim_contradicted' ? null
  : CONTRADICTION_SOURCES.includes(f.contradictionSource) ? f.contradictionSource : CONTRADICTION_SOURCES[0]);
/** The label of a contradicted claim's receipt that is what contradicts it (its source's role), or null. */
export function contradictionLabel(f, r) {
  const source = contradictionSourceOf(f);
  return source !== null && r?.role === CONTRADICTION_ROLES[source] ? STORY_CONTRADICTION_LABELS[source] : null;
}
/** M33 H (C-06 "M33 helper-internal claims"): the label of a helper's own statement, in a finding the review
 *  disclosed as `helper_internal` — the helper said it, not the agent you talked to. */
export const STORY_HELPER_STATEMENT_LABEL = 'Helper said';
/** The closed disclosure (C-06, ledger.js DISCLOSURE_REASONS) of a contradicted claim that was a helper's own. */
const [, HELPER_INTERNAL] = DISCLOSURE_REASONS;
/** D71 (a): is this finding a contradicted claim the review found corrected later in the same turn (FYI,
 *  `self_corrected`, C-06 "M33 self-corrected claims")? A recorded fact said beside it, never a status. */
export const claimCorrected = (f) => f?.kind === 'claim_contradicted' && f.status === 'FYI'
  && f.disclosureReason === DISCLOSURE_REASONS[0];
/** Is this finding a helper's own contradicted statement, as the review disclosed it (FYI, `helper_internal`)? */
export const helperInternal = (f) => f?.kind === 'claim_contradicted' && f.status === 'FYI' && f.disclosureReason === HELPER_INTERNAL;
/** M33 N (C-06 "M33 forbidden edits"): how a forbidden edit's quotes are labelled — what you said, and what the agent
 *  wrote, ran or removed (by the row's code-set `breach`; M33 brittleness M3 added the last), and the agent's own
 *  statement about it (M33 brittleness M4: only an upheld disclosure's, `disclosedEdit`, on either route). */
// D64 wording (owner decision 2026-10-07): `reported` labels only an upheld disclosure's statement, so it says what the
// challengers upheld: "The agent told you it went against your instruction: <its words>".
// W1 B (owner decision 2026-10-13): and the words of a project instruction file the main agent was given before the
// change, labelled as the file's (`file`, the label of its role), never as words you said in the session.
export const STORY_FORBIDDEN_EDIT_LABELS = Object.freeze({ instruction: 'You said', wrote: 'The agent wrote',
  ran: 'The agent ran', removed: 'The agent removed', reported: 'The agent told you it went against your instruction',
  file: STORY_RECEIPT_LABELS['project-instructions'] });
/** M33 N: a forbidden edit's receipt label — what you said (W1 B: or what the project's instruction file says), else what
 *  the agent wrote, ran or removed, by the row's code-set `breach`. */
export const forbiddenEditLabel = (f, r) => (r?.role === 'instruction' ? STORY_FORBIDDEN_EDIT_LABELS.instruction
  : r?.role === 'project-instructions' ? STORY_FORBIDDEN_EDIT_LABELS.file : STORY_FORBIDDEN_EDIT_LABELS[f.breach]);
/** Is this finding a forbidden edit (an `edit_under_negative_requirement` row carrying a closed `breach`)? */
export const forbiddenEdit = (f) => f?.kind === 'edit_under_negative_requirement' && FORBIDDEN_EDIT_BREACHES.includes(f.breach);
/** M33 brittleness M4 (owner decision 2026-10-06: on both routes): the agent's statement of an edit the review published
 *  FYI `disclosed` — its upheld disclosure — or null for any other row. */
export const disclosedEdit = (f) => (f?.kind === 'edit_under_negative_requirement' && f.status === 'FYI'
  && f.disclosureReason === DISCLOSURE_REASONS[2] && typeof f.disclosedBy?.quote === 'string' ? f.disclosedBy : null);
/** The order a finding's receipts are chosen in: at most two are shown. */
const RECEIPT_ORDER = Object.freeze(['commentary', 'observation', 'instruction', 'action', 'code', 'project-instructions']);
export const STORY_RECORDING_KINDS = Object.freeze({
  claude: 'Claude Code recording', codex: 'Codex recording', cursor: 'Cursor recording', other: 'Recording',
});
/** M33 T. The meta line's words for hand-off briefs the recorder encrypted (the delegate event's `briefEncrypted`), by
 *  the recording's kind: stated once, in the meta line, never per helper. */
export const STORY_ENCRYPTED_BRIEFS = Object.freeze({
  codex: (n) => `${plural(n, 'helper brief')} ${n === 1 ? 'was' : 'were'} encrypted by Codex and cannot be shown`,
  other: (n) => `${plural(n, 'helper brief')} ${n === 1 ? 'was' : 'were'} encrypted by the recorder and cannot be shown`,
});
/** M33 F. The meta line's words for inter-agent messages the recorder encrypted (the adapter's children-channel gaps
 *  noted INTER_AGENT_GAP_NOTES.encrypted, a transferred helper's included), by the recording's kind: stated once, in
 *  the meta line. `atLeast` when a declaration stated no count. */
export const STORY_ENCRYPTED_MESSAGES = Object.freeze({
  codex: (n, atLeast = false) => `${atLeast ? 'at least ' : ''}${plural(n, 'inter-agent message')} `
    + `${n === 1 && !atLeast ? 'was' : 'were'} encrypted by Codex and cannot be shown`,
  other: (n, atLeast = false) => `${atLeast ? 'at least ' : ''}${plural(n, 'inter-agent message')} `
    + `${n === 1 && !atLeast ? 'was' : 'were'} encrypted by the recorder and cannot be shown`,
});
/** The requirement statuses a review publishes (run-review.js `groundedExtras`), and their words. D71 (S2): a session-only
 *  review's checklist statuses (ledger.js REQUIREMENT_STATUSES) in the page's words; an earlier report's legacy ones keep
 *  theirs. */
export const STORY_REQUIREMENT_WORDS = Object.freeze({
  addressed: 'addressed', 'partly-addressed': 'partly addressed', open: 'open',
  done: 'done', 'partly-done': 'partly done', 'not-done': 'not done', 'not-checked': 'not checked',
});
/** D71 (S2): the statuses that say an ask was met in full — a legacy report's and a checklist's. */
export const MET_REQUIREMENT_STATUSES = Object.freeze(['addressed', 'done']);
const [WRITTEN_UNVERIFIED, WRITTEN_CONTRADICTED] = WRITTEN_LABELS;
/** A claim the agent wrote into a file, by its ledger label. */
export const STORY_WRITTEN_WORDS = Object.freeze({
  [WRITTEN_UNVERIFIED]: 'Written into a file, not checked',
  [WRITTEN_CONTRADICTED]: 'Written into a file, contradicted by a recorded result',
});
/** W2 (/21): a statement written into a file that the text the agent's own earlier edit or write added contradicts
 *  (its record's `contradictionSource`, code's: written.js `publishedStatement`). */
export const STORY_WRITTEN_OWN_WRITTEN_WORDS = 'Written into a file, contradicted by what the agent wrote before it';
/** A written statement's words: by its label, and for a contradicted one by what contradicts it. */
export const writtenWords = (w) => (w?.label === WRITTEN_CONTRADICTED && w.contradictionSource === OWN_WRITTEN_SOURCE
  ? STORY_WRITTEN_OWN_WRITTEN_WORDS : STORY_WRITTEN_WORDS[w?.label]);
/** D71 (a): whether Sonah's own session review completed (honestStatuses' `sessionReview`), in words — the head
 *  table's "Review" cell. Never a status of the agent's work (before D71: the session status, "needs your decision"
 *  through "clean"). */
export const STORY_REVIEW_WORDS = Object.freeze({ complete: 'complete', incomplete: 'did not complete' });
/** C-06 materiality, in plain words (the mapping): `material` (it deletes files or touches dependencies,
 *  schema, API, config or auth) reads "changes behaviour"; `structural` (a new module, where code lives, or
 *  not classified) reads "changes structure"; `cosmetic` (naming, style or copy) reads "cosmetic". The
 *  legend under the lead table says the same. M33 brittleness H4: a fact shown beside a decision, never a
 *  rank or a filter: every decision made without asking is in the lead table, whatever its materiality. */
export const STORY_MATERIALITY_WORDS = Object.freeze({ material: 'changes behaviour', structural: 'changes structure',
  cosmetic: 'cosmetic' });
/** The engineer section's bullet labels. A step does not repeat the count of decisions the review could not
 *  check: the lead section counts them. */
export const STORY_BULLETS = Object.freeze({
  finding: 'Finding', decision: 'Decision', pivot: 'Changed approach', promise: 'Claim', failed: 'Failed',
  // /16 (D79): a command the recorder typed as refused before it ran.
  didNotRun: 'Did not run',
  // D80: a command the recorder typed as stopped (a STOPPED_DENIALS kind), and a write of a failed or stopped command.
  stopped: `${STOPPED_WORDS[0].toUpperCase()}${STOPPED_WORDS.slice(1)}`,
  unconfirmedWrite: 'Write not recorded as done',
  // M33 F: a helper the step spawned whose final report was attached to its hand-off.
  helper: 'Helper',
});
/** M33 C (C-06 "M33 claims are facts"): what a claim's status says, in plain words — never "open": `open` means
 *  nothing the review checked settles it (`not checked`); `verified`, a recorded result confirms it (after it, or
 *  before it in its own turn with no change to the code between: owner decision 2026-10-05). Any
 *  other value reads as not checked. */
export const STORY_PROMISE_WORDS = Object.freeze({ open: 'not checked', verified: 'confirmed by a recorded result',
  // D71 (S2): every action the claim rests on has a typed outcome that never completed.
  incomplete: 'the check it rests on never completed' });
export const promiseWords = (status) => STORY_PROMISE_WORDS[Object.hasOwn(STORY_PROMISE_WORDS, status) ? status : PROMISE_STATUSES[0]];
/**
 * Status fact (owner decision 2026-10-06): the result's own words a claim was confirmed through — its support receipt
 * (the promise's receipt of role observation, which the review grounded in that result's output and its challenge
 * upheld) — when the claim reads "confirmed by a recorded result" and that receipt grounds in THIS session; else null. A
 * command's status alone never confirms a claim whose line it does not cover: the quote is what did, so it is shown.
 */
export function confirmingQuote(session, promise) {
  if (promiseWords(promise?.status) !== STORY_PROMISE_WORDS.verified) return null;
  const support = list(promise.receipts).find((r) => plainObject(r) && r.role === 'observation' && typeof r.quote === 'string');
  try { return support && verifyReceipt(session, support).ok ? support.quote : null; } catch { return null; }
}
/** How a claim's confirming quote follows it in a list or a bullet: labelled as a recorded result, on one line. */
const confirmedWords = (quote) => (quote === null || quote === undefined ? ''
  : ` — ${STORY_RECEIPT_LABELS.observation}: "${md(clip(oneLine(visible(quote)), STORY_LIMITS.textChars))}"`);
/** Why a request's step chart was simplified, one phrase per collapse level (index = level). A request's step chart is
 *  its one step (D77 C) and what hangs off it; the levels apply in order, and the chart drawn is the first within
 *  `stepChartNodes` nodes and its bytes. Every level draws a step's decisions made without asking and its abandoned
 *  approaches as one node each, and the helpers it spawned as one node. At the last level the chart is at most two
 *  nodes (the step and its findings), so it always has a level to draw (D78: the levels that grouped steps and the hard
 *  stop over them are removed). */
export const STORY_CHART_COLLAPSES = Object.freeze([
  null,
  'decisions you settled are not drawn',
  'decisions made without asking are not drawn (the lead section lists them)',
  'several findings of one step are drawn as one node',
  "abandoned approaches are counted on their step's node",
  'helpers are counted on the node that spawned them',
]);
/** Why the overview was simplified, one phrase per collapse level (index = level); the last entry is the hard stop.
 *  The overview draws each request and its one step (D77 C), the step's findings, changes of approach and helpers
 *  beside it. The levels apply in order until the overview has at most `overviewNodes` nodes and fits its bytes. Past
 *  them the hard stop over the last level keeps every request and every step with a finding or a contradicted statement
 *  (past `overviewNodes` when it must, never past `overviewMaxNodes`), and when it cannot, fewer nodes until it fits.
 *  So no finding, change of approach or helper is ever left out without a count: on its step, or on the dashed edge
 *  where it was left out. (D78: the levels that joined runs of steps into one phase are removed: a request has one
 *  step. The phrases still say "phase", as the overview's sentence does: a phase is now one step.) */
export const STORY_OVERVIEW_COLLAPSES = Object.freeze([
  null,
  'changes of approach are counted on their phase',
  'helpers are counted on their phase',
  'requests and steps with findings or contradicted statements come first, then phases with changes of approach, '
    + 'helpers and file changes, as room allows; a dashed edge counts what was left out',
]);
/** What the engineer section leaves out to keep the file within its target, one phrase per level. */
export const STORY_ENGINEER_CUTS = Object.freeze([
  null,
  'snippets are shown only for steps with a finding or a decision made without asking',
  'snippets are not shown',
  'snippets are not shown, and file lists and test runs are listed only for steps with a finding or a decision made '
    + 'without asking (every step title still names them)',
]);
/** Fixed sentences. */
export const STORY_SENTENCES = Object.freeze({
  footer: '_Generated by Sonah from a redacted recording; review before sharing._',
  quotesMissing: '> _The recorded quotes for this finding were not found in this recording._',
  withheldAsk: '(request text withheld by redaction)',
  // A helper whose hand-off recorded no brief is described by its own first statement, marked as such.
  helperSaid: 'helper said:',
  // M33 T: before that, by its hand-off's task name in plain words, marked as such.
  helperTask: 'task:',
  // M33 F: what a helper reported back (its attached final report), by its first sentence.
  helperReported: 'reported:',
  // M33 P: a helper received in a step of a later request than the one that launched it.
  helperForRequest: (k) => `launched for request ${k}`,
  // M33 F repair: redaction, or the slicer's line-boundary cap of a report with no whole line to keep, can leave no
  // words; the story does not say which (the gaps do).
  reportWithheld: '(report text withheld before review)',
  // M33 W: the agents one Workflow call ran are one helper group, named by the workflow's recorded name in plain words.
  workflow: 'workflow',
  // M33 H (C-06 "M33 helper-internal claims"): a contradicted claim that was a helper's own statement, in plain words —
  // under its finding, and (short) beside its step bullet. M33 H repair: what the review does with a relay, not a
  // promise about everything the main agent said.
  // D71 (a): said as what it is, never "shown for information".
  helperInternal: 'A helper agent said this in its own work or its report to the main agent, not to you; if the main '
    + 'agent passed it on to you, that statement is reviewed as the main agent\'s own claim.',
  helperInternalShort: 'a helper\'s internal statement',
  // M33 N (C-06 "M33 forbidden edits"): a change made against your instruction, in plain words — under its finding.
  forbiddenEdit: 'You gave this instruction; later the agent did what it ruled out.',
  forbiddenEditReverted: 'You gave this instruction; later the agent did what it ruled out, and undid it before that '
    + 'turn ended.',
  // M33 brittleness M4: an edit against your instruction the agent told you about, as the review upheld its statement.
  // D64 wording (owner decision 2026-10-07): what the challengers upheld — that it went against your instruction.
  editDisclosed: 'The agent told you afterwards that it went against your instruction.',
  // D71 (a): a contradicted claim the review found corrected later in the same turn (its closed disclosure
  // `self_corrected`) says so in words — before D71 only its "Worth a look" heading told it apart.
  claimCorrected: 'A recorded result contradicted this claim; the agent corrected it later in the same turn.',
  claimCorrectedShort: 'corrected later in the same turn',
  noSteps: 'This report has no review windows, so there are no steps to show.',
  noDecisions: 'No decisions were recorded.',
  noUnasked: 'No decision is confirmed as made without asking you.',
  unaskedIntro: 'Decisions the review confirmed were made without asking you:',
  otherDecisionsSummary: 'Show the other decisions',
  noPivots: 'No changes of approach were recorded.',
  noRequirements: 'No requirement was recorded for this request.',
  noAsks: 'No request was recorded in this session.',
  askWithoutStep: 'No step holds this request.',
  // /15 (D79): a file you attached to a message, shown under that message (it is no request of its own).
  youAttached: 'You attached',
  // Gain I (2026-10-13), in the same unreleased /19: what you pasted into a message beside its words (an image) is
  // never shown here; it is said, by count, under the message (`pastedLines`).
  pasted: ({ images = 0, others = 0 }) => `You attached ${[...(images ? [plural(images, 'image')] : []),
    ...(others ? [plural(others, 'file that is not text', 'files that are not text')] : [])].join(' and ')} to this `
    + `message; ${images + others === 1 ? 'it is' : 'they are'} not shown here.`,
  countLegend: '`?` and `≥n` in line counts: the recording did not keep enough text to count those lines exactly.',
  materialityLegend: 'Impact: changes behaviour = deletes files or touches dependencies, schema, API, config or '
    + 'auth; changes structure = a new module, where code lives, or not classified; cosmetic = naming, style or copy.',
  notReviewed: 'not reviewed (the review of this step did not finish)',
  outside: 'outside the repository, not shown',
  noActions: 'No recorded actions',
  // D88: what the agent told you, the edits against what you said and the failures it passed over, as the page says
  // them.
  noClaims: 'The review recorded no claims.',
  noEdits: 'The review recorded no edit against what you said and no statement written into a file.',
  confirmedSummary: 'Show the claims confirmed by a recorded result',
  handledSummary: (n) => `Show the ${n === 1 ? 'failure' : `${n} failures`} it acted on or told you about`,
  turnEnded: 'Its turn ended with',
  actionNotHeld: 'an action this recording does not hold',
  writtenSummary: 'Show the statements written into files',
  failedSummary: 'Show the failed commands',
  // /16 (D79): the one phrase for a command the recorder typed as refused before it ran (a title phrase; the page's
  // chip and counts), and the fold of several on one bullet.
  didNotRun: 'did not run',
  didNotRunSummary: 'Show the commands that did not run',
  // D80: the one phrase for a command the recorder typed as stopped (`STOPPED_WORDS`; the page reads it too), its
  // plural, and the fold of several on one bullet; and what a write of a failed or stopped command says
  // (`shellWriteWords`).
  stopped: STOPPED_WORDS,
  stoppedMany: 'stopped before they finished',
  stoppedSummary: 'Show the commands that stopped before they finished',
  unconfirmedWrite: (end) => `its ${shellWriteWords(end)}`,
  unconfirmedSummary: 'Show the writes not recorded as done',
  writeNotNamed: 'a file outside the repository (not shown)',
  failedNotNamed: 'a command that names a path outside the repository (not shown)',
  contradictedSummary: 'Show the other contradicted statements',
  reviewWords: "the review's words:",
  chartSimplified: `The chart was simplified to stay within ${STORY_LIMITS.stepChartNodes} nodes and within its share of `
    + 'this file:',
  overviewSimplified: `The overview was simplified to stay within ${STORY_LIMITS.overviewNodes} nodes and within its share `
    + 'of this file:',
  overviewPast: `The overview was simplified to stay within ${STORY_LIMITS.overviewNodes} nodes where it can (more only to keep `
    + 'every request and every step with a finding or a contradicted statement, never more than '
    + `${STORY_LIMITS.overviewMaxNodes}) and within its share of this file:`,
  phaseLegend: 'Each box under a request is a phase: consecutive steps that did the same kind of work (reading, editing and '
    + 'testing, committing, or waiting on helpers), and a step with a finding or a contradicted statement is a box of its own.',
  phaseLegendSimplified: 'Each box under a request is a phase: consecutive steps that did the same kind of work (reading, '
    + 'editing and testing, committing, or waiting on helpers), and a step with a finding or a contradicted statement is a '
    + 'box of its own, except where the simplifications below say otherwise.',
  overviewOver: `The overview has more than ${STORY_LIMITS.overviewNodes} nodes only to keep every request and every step `
    + `with a finding or a contradicted statement (never more than ${STORY_LIMITS.overviewMaxNodes}).`,
  stepChartsAll: 'Every step of a request is charted one by one at the top of that request in the '
    + '[engineer section](#for-engineers).',
  stepChartsSome: "Where there is room, a request's steps are charted one by one at the top of that request in the "
    + '[engineer section](#for-engineers).',
  stepChartSummary: 'Show the step chart',
  noChart: 'No step was recorded, so there is nothing to chart.',
});

const HEREDOC = 'heredoc';   // the tool a shell heredoc write carries (slicer events.js SHELL_WRITES `how`)

const FINDING_STATUSES = Object.freeze(['DECIDE', 'FYI']);
const WRITE_OPERATIONS = Object.freeze(['write', 'edit', 'delete']);
const NOT_DONE = Object.freeze(['failed', 'cancelled']);
/** /16 (D79): the recorder's typed prior states of a write (redact `RECORDED_FACTS.prior`) that say the file was there
 *  before it — its record holds the file whole or as hunks — so the write is never read as a create. */
const PRIOR_HELD = Object.freeze(['file', 'hunks']);
/** /16 (owner decision D79): the members of the recorder's closed denial vocabulary (Claude Code's `toolDenialKind`,
 *  as the slicer types it on the call: `recorded.denial`; redact `RECORDED_FACTS.denial`) that mean the call was
 *  refused before it ran — by the human, a permission rule or the auto-mode classifier — so the command did not run
 *  and is never counted among the ones that failed. The two kinds left out, `interrupted` and `cancelled` (D80: the
 *  ledger's `STOPPED_DENIALS`), mean the call was stopped: such a command is `stopped` (`commandEnd`), shown as
 *  "stopped before it finished", never failed. Asserted against the redactor's vocabulary in
 *  test/d79-refusals.test.js. */
export const REFUSED_DENIALS = Object.freeze(['user-rejected', 'permission-rule', 'automode-blocked',
  'automode-unavailable', 'automode-parsing-error']);
const GAP = '‹…›';   // shown where a recorded body's quotable spans are not contiguous (a redaction, a cut)

// ---- text safety ------------------------------------------------------------------------------------

// D84 (owner decision 2026-10-12, "off for the model, on for output"): the session a story or a page is given is the
// one the reviewer model read, unredacted. Both render from it as a person may read it (`sessionForPeople`, below),
// and every text either shows a person passes the one output function, `maskForPeople` (redact/index.js), WHOLE,
// before anything cuts or escapes it: `visible` (and `oneLine`, `codeSpan`, a page's `escapeHtml`, each built on it)
// and `clip` mask what they are given, and `md` and `html` mask what they escape — so no cut leaves part of a secret,
// and no escape hides one from the rules. A text masked once is unchanged by a second pass. The command that writes
// the story or page passes it once more as a whole (`forPeople`, below), and writes nothing when that fails.
// D84 review: during a render (`asPeopleRead`), the function these helpers apply (`peopleText`) is `maskForPeople`
// given the session's own values — what the redactor's full walk hid in the session and shows nowhere else in it
// (redact `peopleSecretsOf`) — so a value the model restates in its own words is masked too.
let peopleText = maskForPeople;
// Bidi controls and invisible characters could make a quote or a snippet read differently from what the
// record holds; they are shown as their code point. C0 controls other than newline and tab never render.
const INVISIBLE = /[؜​‎‏‪-‮⁦-⁩﻿]/g;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
export const visible = (text) => peopleText(String(text ?? '')).replace(/\r\n?/g, '\n')
  .replace(INVISIBLE, (c) => `‹U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}›`)
  .replace(CONTROL, '�');
export const oneLine = (text) => visible(text).replace(/\s+/g, ' ').trim();
/** Clip to `n` code points, marking the cut. D84: masked whole first (`maskForPeople`), so a cut never leaves part of a
 *  secret. */
export function clip(text, n) {
  const whole = peopleText(String(text));
  const points = [...whole];
  return points.length <= n ? whole : `${points.slice(0, Math.max(1, n - 1)).join('')}…`;
}
/** Clip a path to `n` code points in the middle, keeping its file name. */
export function clipPath(path, n = STORY_LIMITS.pathChars) {
  const points = [...String(path)];
  if (points.length <= n) return String(path);
  const name = [...String(path).slice(String(path).lastIndexOf('/') + 1)];
  if (name.length + 2 >= n) return `…${name.slice(-(n - 1)).join('')}`;
  return `${points.slice(0, n - name.length - 2).join('')}…/${name.join('')}`;
}
/**
 * Markdown inline text: every character GitHub would read as markup is escaped, so it renders as-is. An
 * `@name` or a `#123` would also become a live mention or issue reference once the story is pasted into
 * a PR or an issue; an empty HTML comment after the `@` or `#` keeps the text and drops the link.
 */
function md(text) {
  return peopleText(String(text)).replace(/[\\`*_[\]<>|~&#$]/g, (c) => `\\${c}`)
    .replace(/^(\s*)([-+=])/, '$1\\$2').replace(/^(\s*\d+)([.)])/, '$1\\$2')
    .replace(/@(?=[A-Za-z0-9])/g, '@<!-- -->').replace(/\\#(?=\d)/g, '\\#<!-- -->');
}
const html = (text) => peopleText(String(text)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');
/**
 * D84 (owner decision 2026-10-12, "off for the model, on for output"): a whole story or page, passed once more
 * through the one output function (`mask`, `maskForPeople` unless a test gives another) just before it is written or
 * printed — the last pass of the output layer. A story (`md`) is masked as a whole and returned as that pass leaves
 * it, so a secret only its neighbouring lines reveal (a key block, a YAML block under a secret-named key, in a snippet
 * whose lines were masked one by one) is masked too. A page's markup is never rewritten: the text of each of its
 * elements (between two tags, the five escapes read back; `<style>` set aside) must come back from the pass unchanged,
 * and the page is returned as it is — each element on its own, as the page masked what it put there, because two
 * elements side by side are no text anyone wrote (read as one text, a label above a row's id read as a secret's name,
 * and a page was refused for it). Fails closed: when the pass throws, or a page's text
 * would change, it throws an error coded `output_not_masked` (evidence/src/ledger.js OUTPUT_NOT_MASKED), and the
 * caller writes and prints nothing. The command gives `mask` the session's values (redact `peopleSecretsFor`).
 */
export function forPeople(content, format, mask = maskForPeople) {
  let out = null;
  try {
    if (format !== 'html') out = mask(content);
    else if (pageTexts(content).every((text) => mask(text) === text)) out = content;
  } catch { out = null; }
  if (typeof out !== 'string') throw notMasked();
  return out;
}
const notMasked = () => Object.assign(new Error(OUTPUT_NOT_MASKED), { code: OUTPUT_NOT_MASKED });
/**
 * D84 review (2026-10-13): `render(view)` as a person may read the session — the view `sessionForPeople` gives, with
 * what the redactor's full walk hid in the session (redact `peopleSecretsFor`), and the text helpers masking with the
 * session's values for the render's length (they return to `maskForPeople` after it, so nothing outlives a render);
 * a value `report` restates is masked also where a cut leaves part of it (redact `peopleMask`, `restatedIn`).
 * Fails closed: when the walk cannot run, it throws `output_not_masked` and nothing is rendered.
 */
export function asPeopleRead(recorded, render, report = null, codeSecrets = []) {
  let secrets, mask;
  try {
    secrets = peopleSecretsFor(recorded);
    // D87: and what the output rules hide in the files a code pass read (redact `peopleSecretsOfTexts`), given by the
    // command; none leaves the session's own values as they were (`joinSecretValues`).
    mask = peopleMask(joinSecretValues(secrets.values, Array.isArray(codeSecrets) ? codeSecrets : []),
      { restatedIn: report });
  } catch { throw notMasked(); }
  const prior = peopleText;
  peopleText = mask;
  try { return render(sessionForPeople(recorded, mask, secrets)); } finally { peopleText = prior; }
}
/**
 * D84 (owner decision 2026-10-12, "off for the model, on for output"): the session as a person may read it, the one a
 * story or a page is rendered from (`renderSessionStory`, `renderSessionPage`). The same events, ids and structure as
 * the session the model read; only its recorded texts differ: each uninterrupted span of a field is masked WHOLE by the
 * one output function (`mask`, `maskForPeople`), with the context the whole span gives — the line that makes the lines
 * below it secret, the name before a value — and split again at each mask, exactly as the session splits a field at a
 * redactor's mark, so a quote can never run across one. A quote of the model's that a mask touches no longer grounds
 * here and is not shown (fails closed), as no quote across a mask ever was. A recorded hunk's runs are masked the same
 * way; a path is a path, never masked (redact/index.js rule 1). Deterministic; each span is masked once per view.
 *
 * D84 review (2026-10-13, finding 1): one span alone cannot show what its event's other fields say (S1: the command
 * that names the secret it printed, the path that names the secret a write holds), so first each field is masked as
 * the load masked it before D84: `secrets` (redact `peopleSecretsOf`) gives what the redactor's full walk hid in the
 * field a text is stored from — matched by the blob the text's refs read, by its exact bytes — and those values are
 * masked in it wherever they stand whole; a field the walk withheld whole is withheld whole (`‹redacted›`, nothing
 * quotable). Then `mask`: the session's values and the prose rules.
 */
export function sessionForPeople(session, mask = maskForPeople, secrets = NO_PEOPLE_SECRETS) {
  if (session === null || typeof session !== 'object' || session[PEOPLE_VIEW] === true
    || typeof session.textRegionsOf !== 'function' || typeof session.sourceGroupsFor !== 'function') return session;
  const view = Object.create(session);
  const once = new Map();
  const masked = (text, hidden = NOTHING_HIDDEN) => {
    if (!text) return text;
    if (hidden.values.length) return mask(maskValues(text, hidden.values));
    if (!once.has(text)) once.set(text, mask(text));
    return once.get(text);
  };
  /** What the walk hid in the fields `holder[field]` is stored from (the blobs its refs read). */
  const hiddenIn = (holder, field) => {
    const refs = holder !== null && typeof holder === 'object' ? holder[field] : null;
    if (!Array.isArray(refs) || secrets === NO_PEOPLE_SECRETS) return NOTHING_HIDDEN;
    return joinHidden([...new Set(refs.map((ref) => ref?.sourceKey))].map((key) => secrets.of(session.blobs?.[key])));
  };
  /** What the walk hid in an event's recorded hunks (each hunk's lines, one field of the recording). */
  const hiddenInHunks = (event) => (secrets === NO_PEOPLE_SECRETS ? NOTHING_HIDDEN
    : joinHidden((Array.isArray(event?.recorded?.hunks) ? event.recorded.hunks : [])
      .map((hunk) => (Array.isArray(hunk?.lines) ? secrets.of(hunk.lines.join('\n')) : NOTHING_HIDDEN))));
  const pieces = (text) => artifactRanges(text).map(({ from, until }) => text.slice(from, until));
  const regions = new WeakMap();
  Object.defineProperty(view, PEOPLE_VIEW, { value: true });
  view.textRegionsOf = (holder, field = 'text') => {
    const held = holder !== null && typeof holder === 'object';
    const byField = held ? regions.get(holder) ?? new Map() : new Map();
    if (held) regions.set(holder, byField);
    if (byField.has(field)) return byField.get(field);
    const { text, ranges, complete } = session.textRegionsOf(holder, field);
    const hidden = hiddenIn(holder, field);
    if (hidden.whole && text) {
      const result = { text: WITHHELD_FIELD, ranges: [], complete: false };
      byField.set(field, result);
      return result;
    }
    let out = '', cursor = 0, cut = false;
    const kept = [];
    for (const { from, until } of ranges) {
      out += masked(text.slice(cursor, from), hidden);
      const span = text.slice(from, until), shown = masked(span, hidden);
      if (shown !== span) cut = true;
      const at = out.length;
      for (const range of artifactRanges(shown)) kept.push({ from: at + range.from, until: at + range.until });
      out += shown;
      cursor = until;
    }
    out += masked(text.slice(cursor), hidden);
    const result = { text: out, ranges: kept, complete: complete && !cut };
    byField.set(field, result);
    return result;
  };
  view.sourceGroupsFor = (event) => {
    const groups = session.sourceGroupsFor.call(view, event);
    if (!groups.some((group) => group?.hunk === true)) return groups;
    const hidden = hiddenInHunks(event);
    return groups.map((group) => (group?.hunk === true
      ? { ...group, spans: hidden.whole ? [] : group.spans.flatMap((span) => pieces(masked(span, hidden))) } : group));
  };
  return view;
}
const PEOPLE_VIEW = Symbol('sessionForPeople');
const NOTHING_HIDDEN = NO_PEOPLE_SECRETS.of('');
/** What a field withheld whole shows: the redactor's mark alone. */
const WITHHELD_FIELD = '‹redacted›';
/** A page's texts as a person reads them: the text between each two tags, its stylesheet set aside, the escapes read
 *  back; blank ones left out. */
const pageTexts = (page) => String(page).replace(/<style\b[\s\S]*?<\/style>/gi, '<style>').split(/<[^>]*>/)
  .filter((text) => text.trim()).map((text) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&'));
/** An inline code span that holds any text, backticks included. */
function codeSpan(text) {
  const value = oneLine(text);
  const run = Math.max(0, ...[...value.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(run + 1);
  const pad = value.startsWith('`') || value.endsWith('`') || value.startsWith(' ') ? ' ' : '';
  return `${fence}${pad}${value}${pad}${fence}`;
}
/** A Mermaid label: one line, no character Mermaid or GitHub's renderer would read as syntax. */
export function mermaidLabel(text, n = STORY_LIMITS.chartLabelChars) {
  const safe = oneLine(text)
    .replace(/["`]/g, "'").replace(/[[{<]/g, '(').replace(/[\]}>]/g, ')')
    .replace(/\|/g, '/').replace(/;/g, ',').replace(/&/g, '+').replace(/\\/g, '/')
    .replace(/\s+/g, ' ').trim();
  const clipped = clip(safe, n).trim();
  return clipped || '-';
}
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** M33 T. A hand-off's task name in plain words: the last part of a task path, `_` and `-` read as spaces, marked as a
 *  task. Only a plain identifier, or a Codex task path of them, within the identity length bound, is ever shown. */
const TASK_NAME = /^(?:\/root(?:\/[A-Za-z0-9_-]+)+|[A-Za-z0-9_-]+)$/;
function taskWords(name) {
  if (typeof name !== 'string' || name.length > 200 || !TASK_NAME.test(name)) return '';
  const words = name.split('/').pop().replace(/[_-]+/g, ' ').trim();
  return words ? `${STORY_SENTENCES.helperTask} ${words}` : '';
}
/** M33 W. A Workflow run's group name: "workflow", and the run's recorded workflowName in plain words (`_` and `-`
 *  read as spaces) when it is a plain identifier within the bound — else nothing more. */
const WORKFLOW_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
function workflowWords(name) {
  const words = typeof name === 'string' && name.length <= 64 && WORKFLOW_NAME.test(name)
    ? name.replace(/[_-]+/g, ' ').trim() : '';
  return words ? `${STORY_SENTENCES.workflow} ${words}` : STORY_SENTENCES.workflow;
}
/** M33 F. A helper's attached final report (the hand-off's `helperReported` observation), in plain words: its first
 *  sentence — up to the first `.`, `!` or `?` that ends a word — on one line, clipped to `reportChars`. A report
 *  left with no words says so. This review's cut and redaction's gaps read as `…`, never as text. */
function reportWords(session, observation) {
  const text = oneLine(session.textSpansOf(observation, 'output').join(' … '));
  if (!text) return STORY_SENTENCES.reportWithheld;
  const first = /^.*?[.!?](?=\s|$)/u.exec(text)?.[0] ?? text;
  return clip(first, STORY_LIMITS.reportChars);
}
const bytes = (lines) => Buffer.byteLength(`${lines.join('\n')}\n`, 'utf8');

// ---- what a command did ------------------------------------------------------------------------------
// A step's title names what its commands did, from the recorded command text only. Each simple command of
// a chain (split at unquoted `&&`, `||`, `|`, `;`, `&` and newlines) is classified by its first word, and
// for git by its subcommand. Purely presentational: no title word decides a status. Whether a command failed is the
// record's (its result, its exit code), never its name: M1 retired the story's "is it a test run" lists.

// H5: which first words only read (and whether they name the files they read) is one table (read-only-programs.js
// `READ_ONLY_PROGRAMS`, `READ_ONLY_GIT`; the page read it too until the D69 page audit deleted "Touches"): `files` — a
// read naming its files; `none` — neither reads a named file nor changes anything, so it leaves a command read-only.
/** Words that run the command after them. */
const PREFIX_WORDS = Object.freeze(['env', 'time', 'sudo', 'command', 'exec', 'nohup']);
/** Git subcommands that write, and the words a title says for them, in the order it names them. The first
 *  five are named when present; the others only when none of those is. */
const GIT_WRITE_WORDS = Object.freeze({ commit: 'committed', merge: 'merged', rebase: 'rebased', 'cherry-pick': 'cherry-picked',
  push: 'pushed', add: 'staged files', checkout: 'checked out', switch: 'switched branches', worktree: 'managed worktrees',
  restore: 'restored files', reset: 'reset changes' });
const GIT_HEADLINE = Object.freeze(['commit', 'merge', 'rebase', 'cherry-pick', 'push']);
const GIT_OPTION_VALUES = Object.freeze(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path']);
/** Interpreters that run a script file (`node <file>`), and the options whose value is not that file. */
const FILE_RUNNERS = Object.freeze(['node', 'python', 'python3', 'bash', 'sh', 'zsh']);
const RUNNER_VALUES = Object.freeze(['-r', '--require', '--import', '--loader', '--experimental-loader', '-W', '-X']);
/** Package installs: the tool, and the subcommands that install. */
const INSTALL_WORDS = Object.freeze({ npm: ['install', 'i', 'ci', 'add'], pnpm: ['install', 'i', 'add'], yarn: ['install', 'add'],
  bun: ['install', 'i', 'add'], pip: ['install'], pip3: ['install'] });
/** Options of a read command that take the next word (two words for the `jq` pairs) as their value. */
const READ_VALUES = Object.freeze({
  head: ['-n', '-c'], tail: ['-n', '-c'], nl: ['-b', '-s', '-w', '-v', '-i', '-n'],
  rg: ['-e', '-f', '-g', '-t', '-T', '-A', '-B', '-C', '-m', '-M', '-j', '--glob', '--iglob', '--type', '--type-not', '--regexp',
    '--file', '--max-count', '--context', '--after-context', '--before-context'],
  grep: ['-e', '-f', '-A', '-B', '-C', '-m', '--regexp', '--file', '--max-count', '--context', '--after-context',
    '--before-context'],
  sed: ['-e', '-f', '--expression', '--file'], jq: ['-f', '--from-file', '--arg', '--argjson', '--slurpfile', '--rawfile'],
});
const PAIR_VALUES = Object.freeze(['--arg', '--argjson', '--slurpfile', '--rawfile']);
/** Commands whose first argument is a pattern or a script, unless one of these options gave it. */
const PATTERN_FIRST = Object.freeze({ rg: ['-e', '-f', '--regexp', '--file', '--files', '--type-list'],
  grep: ['-e', '-f', '--regexp', '--file'], 'git grep': ['-e', '-f'], sed: ['-e', '-f', '--expression', '--file'],
  jq: ['-f', '--from-file'] });
/** A word that names a file: path characters only (no glob, quote, range, `:` or `=`), and a name with an
 *  extension or a dotfile name. A directory, a pattern or a revision is not a file read. */
const PATH_CHARS = /^[\p{L}\p{N}_./@~+ -]+$/u;
const FILE_NAME = /\.[\p{L}\p{N}_-]*\p{L}[\p{L}\p{N}_-]*$/u;
const isFileWord = (word) => PATH_CHARS.test(word) && !/\.\.(?!\/)/.test(word)
  && FILE_NAME.test(word.slice(word.lastIndexOf('/') + 1));
const cleanPath = (path) => path.replace(/^(?:\.\/)+/, '').replace(/\/{2,}/g, '/');
const lookup = (table, key) => (Object.hasOwn(table, key) ? table[key] : null);

/** A command's simple commands, as argv lists. A heredoc's body is text the command writes, never
 *  commands: the text is cut at the end of the line that opens it. The shell's token grammar (POSIX.1-2017 XCU 2.2
 *  Quoting, 2.3 Token Recognition, 2.7.4 Here-Document): a word ends at an unquoted blank or control operator (`&&`,
 *  `||`, `|`, `;`, `&`, newline), single and double quotes and a backslash are removed as quoting. */
function commandSegments(command) {
  let text = String(command ?? '');
  const heredoc = /<<-?\s*['"]?[A-Za-z_][A-Za-z0-9_]*['"]?/.exec(text);
  if (heredoc && text.indexOf('\n', heredoc.index) !== -1) text = text.slice(0, text.indexOf('\n', heredoc.index));
  const segments = [];
  let argv = [], token = '', open = false, quote = null;
  const endToken = () => { if (open) argv.push(token); token = ''; open = false; };
  const endSegment = () => { endToken(); if (argv.length) segments.push(argv); argv = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && i + 1 < text.length) token += text[++i];
      else token += c;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; open = true; continue; }
    if (c === '\\' && i + 1 < text.length) { if (text[i + 1] !== '\n') { token += text[i + 1]; open = true; } i++; continue; }
    if (c === '&' && (text[i - 1] === '>' || text[i - 1] === '<' || text[i + 1] === '>')) { token += c; open = true; continue; }
    if (c === '&' || c === '|' || c === ';' || c === '\n') {
      endSegment();
      if ((c === '&' || c === '|') && text[i + 1] === c) i++;
      continue;
    }
    if (/\s/.test(c)) { endToken(); continue; }
    token += c;
    open = true;
  }
  endSegment();
  return segments;
}

/** An argv without its redirections, and whether one of them writes a file (anything but /dev/null). */
function withoutRedirections(argv) {
  const args = [];
  let writes = false;
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i];
    if (/^\d*>&\d*-?$/.test(word)) continue;
    const redirect = /^(\d*>>?|&>>?|<<?<?)(.*)$/.exec(word);
    if (!redirect) { args.push(word); continue; }
    const target = redirect[2] || argv[++i] || '';
    if (redirect[1].includes('>') && target !== '/dev/null') writes = true;
  }
  return { args, writes };
}

/** The files a read command names: its arguments that are file words, past its options, their values
 *  and a leading pattern or script. `find` names its paths before its first expression. */
function readPaths(word, args) {
  const values = lookup(READ_VALUES, word) ?? [];
  const given = lookup(PATTERN_FIRST, word);
  let pattern = given !== null && !args.some((arg) => given.some((option) => arg === option || arg.startsWith(`${option}=`)));
  const paths = [];
  let rest = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!rest && arg === '--') { rest = true; continue; }
    if (!rest && word === 'find' && /^[-(!]/.test(arg)) break;
    if (!rest && arg.startsWith('-') && arg !== '-') { if (values.includes(arg)) i += PAIR_VALUES.includes(arg) ? 2 : 1; continue; }
    if (pattern) { pattern = false; continue; }
    if (isFileWord(arg)) paths.push(cleanPath(arg));
  }
  return paths;
}

/** The script file an interpreter runs, or null when it runs inline code, a module, or nothing named. */
function scriptFile(runner, args) {
  const inline = (arg) => (runner === 'node' ? ['-e', '--eval', '-p', '--print'].includes(arg) || /^--(?:eval|print)=/.test(arg)
    : runner.startsWith('python') ? ['-c', '-m', '-'].includes(arg) : /^-[A-Za-z]*c[A-Za-z]*$/.test(arg) || arg === '-s');
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (inline(arg)) return null;
    if (RUNNER_VALUES.includes(arg)) { i++; continue; }
    if (arg.startsWith('-')) continue;
    return isFileWord(arg) ? cleanPath(arg) : null;
  }
  return null;
}

/** The tool `npx` runs: its first word past its own options. */
function npxTool(args) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-p' || args[i] === '--package') { i++; continue; }
    if (args[i].startsWith('-')) continue;
    return /^[@\p{L}\p{N}._/-]+$/u.test(args[i]) ? args[i] : null;
  }
  return null;
}

/**
 * What one recorded command did, from its text only: `{ reads, readOnly, git, scripts, install }`.
 * `reads` are the files its read and search commands name (distinct, in order); `readOnly` is true when it
 * read or searched and did nothing else; `git` the writing git subcommands it ran; `scripts` the script
 * files (`node <file>`, `python <file>`, `bash <file>`) and `npx <tool>` runs; `install` whether it
 * installed packages. Pure, and presentational only: nothing here is a status.
 */
export function commandFacts(command) {
  const facts = { reads: [], readOnly: false, git: [], scripts: [], install: false };
  let reads = 0, others = 0;
  for (const segment of commandSegments(command)) {
    const { args, writes } = withoutRedirections(segment);
    let argv = args;
    while (argv.length && (PREFIX_WORDS.includes(argv[0]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[0]))) argv = argv.slice(1);
    if (!argv.length) continue;
    const head = argv[0].replace(/^\(+/, '');
    const word = head.slice(head.lastIndexOf('/') + 1);
    const kind = (() => {
      if (word === 'git') {
        let at = 1;
        while (at < argv.length && argv[at].startsWith('-')) at += GIT_OPTION_VALUES.includes(argv[at]) ? 2 : 1;
        const sub = argv[at] ?? '';
        if (Object.hasOwn(GIT_WRITE_WORDS, sub)) { facts.git.push(sub); return 'write'; }
        const how = readOnlyGit(sub);
        if (how === null || writes) return 'other';
        if (how === 'none') return 'neutral';
        facts.reads.push(...readPaths(`git ${sub}`, argv.slice(at + 1)));
        return 'read';
      }
      if (readOnlyProgram(word) === 'files') {
        const inPlace = word === 'sed' ? argv.some((arg) => /^--in-place(?:=|$)/.test(arg) || /^-[A-Za-z]*i/.test(arg))
          : word === 'find' && argv.some((arg) => ['-delete', '-exec', '-execdir', '-ok', '-okdir', '-fprint'].includes(arg));
        if (writes || inPlace) return 'other';
        facts.reads.push(...readPaths(word, argv.slice(1)));
        return 'read';
      }
      if ((lookup(INSTALL_WORDS, word) ?? []).includes(argv[1])
        || (['python', 'python3'].includes(word) && argv[1] === '-m' && ['pip', 'pip3'].includes(argv[2]) && argv[3] === 'install')) {
        facts.install = true;
        return 'install';
      }
      if (word === 'npx') {
        const name = npxTool(argv.slice(1));
        if (name) facts.scripts.push(`npx ${name}`);
        return 'script';
      }
      if (FILE_RUNNERS.includes(word)) {
        const file = scriptFile(word, argv.slice(1));
        if (file) facts.scripts.push(file);
        return 'script';
      }
      return readOnlyProgram(word) === 'none' && !writes
        && !(word === 'sort' && argv.some((arg) => /^-[A-Za-z]*o|^--output/.test(arg))) ? 'neutral' : 'other';
    })();
    if (kind === 'read') reads++;
    else if (kind !== 'neutral') others++;
  }
  return { ...facts, reads: [...new Set(facts.reads)], readOnly: reads > 0 && others === 0, git: [...new Set(facts.git)],
    scripts: [...new Set(facts.scripts)] };
}

/** A leading `cd <dir> &&` / `cd <dir>;` segment: where a command ran, not what it did (the page drops it too). Formal
 *  grammar (D69 page audit): the shell's own — a simple command `cd` with one word (unquoted, or in single or double
 *  quotes) ended by an AND-list `&&` or the sequential separator `;` (POSIX.1-2017 XCU 2.9.3 Lists, 2.2 Quoting). */
const LEADING_CD = /^\s*cd\s+(?:"[^"]*"|'[^']*'|[^\s;&|]+)\s*(?:&&|;)\s*/;
/** A command's text with every leading `cd <dir> &&` / `cd <dir>;` dropped (`LEADING_CD`). */
export function withoutLeadingCd(raw) {
  let text = String(raw ?? '');
  while (LEADING_CD.test(text)) text = text.replace(LEADING_CD, '');
  return text;
}
/** A word naming a path outside the working tree: absolute, in a home directory, on a drive, or climbing out with `..`
 *  (a redirection's target included; `/dev/null` is no path). Formal grammar (D69 page audit), never a list of folder
 *  names: a redirection operator before its target (`[n]>`, `>>`, `<`, `>&`, `&>`: POSIX.1-2017 XCU 2.7, bash's `&>`);
 *  an absolute pathname begins with `/` (XBD 4.13 Pathname Resolution) or, on Windows, a drive letter and a separator
 *  (Win32 file path formats, "fully qualified DOS paths"); a tilde-prefix is a home directory (XCU 2.6.1), also after
 *  the `=` of an assignment or a `--name=value` option (XCU 2.9.1; getopt_long); a `..` component climbs to the parent
 *  (XBD 4.13). */
const outsideWord = (word) => {
  const target = word.replace(/^(?:\d*[<>]+&?|&>>?)/, '');
  if (target === '/dev/null') return false;
  return /^(?:\/|~|[A-Za-z]:[\\/])/.test(target) || /=(?:\/|~)/.test(target) || target.split(/[\\/]/).includes('..');
};
/** Does this shell text name a path outside the working tree in any of its words (`commandSegments`, `outsideWord`)? */
export const namesOutsidePath = (text) => commandSegments(String(text ?? '')).some((segment) => segment.some(outsideWord));

/**
 * M1: a failed command as a reader is shown it — its recorded text with any leading `cd <dir> &&` or `cd <dir>;` dropped
 * (where it ran, not what it did), on one line, clipped to `limit` — or null when what remains names a path outside the
 * working tree (an absolute path, a home directory, a drive, a climb out with `..`): like every such path, it is counted,
 * never named (it can carry a local user name, and it is no part of the repository). Otherwise its recorded words.
 */
export function failedCommandText(raw, limit = STORY_LIMITS.commandChars) {
  const text = withoutLeadingCd(raw);
  if (!text.trim()) return null;
  if (namesOutsidePath(text)) return null;
  return clip(oneLine(text), limit);
}

// ---- line counts ------------------------------------------------------------------------------------

/** Lines of a recorded body. A final newline ends the last line; it does not start another. A CRLF line
 *  end is read as LF, so a file's line endings are never counted as changed lines. */
function splitLines(text) {
  if (!text) return [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * A bounded line diff of two line arrays: `{ ops, added, removed, exact }`. `ops` is the edit script as
 * `[' ' | '-' | '+', line]` pairs. The common head and tail are trimmed first; the middle is Myers'
 * O((N+M)D) diff, stopped once its work passes `maxWork` (or the input passes `maxLines`). Stopped, it
 * falls back to multiset counts with no edit script: those are lower bounds (`exact: false`).
 */
export function diffLines(before, after, { maxWork = STORY_LIMITS.diffWork, maxLines = STORY_LIMITS.diffLines } = {}) {
  const a = Array.isArray(before) ? before : [], b = Array.isArray(after) ? after : [];
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tailA = a.length, tailB = b.length;
  while (tailA > head && tailB > head && a[tailA - 1] === b[tailB - 1]) { tailA--; tailB--; }
  const A = a.slice(head, tailA), B = b.slice(head, tailB);
  const middle = A.length + B.length > maxLines ? null : myers(A, B, maxWork);
  if (middle === null) {
    const pool = new Map();
    for (const line of A) pool.set(line, (pool.get(line) ?? 0) + 1);
    let common = 0;
    for (const line of B) { const left = pool.get(line); if (left) { pool.set(line, left - 1); common++; } }
    return { ops: null, added: B.length - common, removed: A.length - common, exact: false };
  }
  const ops = [...a.slice(0, head).map((line) => [' ', line]), ...middle, ...a.slice(tailA).map((line) => [' ', line])];
  return { ops, added: ops.filter((op) => op[0] === '+').length, removed: ops.filter((op) => op[0] === '-').length, exact: true };
}

function myers(A, B, maxWork) {
  const N = A.length, M = B.length;
  if (!N) return B.map((line) => ['+', line]);
  if (!M) return A.map((line) => ['-', line]);
  const max = N + M, off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace = [];
  let work = 0, done = false;
  for (let d = 0; d <= max && !done; d++) {
    trace.push(v.slice(off - d - 1, off + d + 2));   // k in [-d-1, d+1], as it stood before step d
    work += 2 * d + 3;
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < N && y < M && A[x] === B[y]) { x++; y++; work++; }
      v[off + k] = x;
      if (x >= N && y >= M) { done = true; break; }
    }
    if (!done && work > maxWork) return null;
  }
  const ops = [];
  let x = N, y = M;
  for (let d = trace.length - 1; d >= 0; d--) {
    const snap = trace[d];
    const at = (k) => snap[k + d + 1];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK), prevY = prevX - prevK;
    while (x > prevX && y > prevY) { ops.push([' ', A[x - 1]]); x--; y--; }
    if (d > 0) ops.push(x === prevX ? ['+', B[y - 1]] : ['-', A[x - 1]]);
    x = prevX; y = prevY;
  }
  return ops.reverse();
}

/** A count as printed: `≥n` (or `?` for nothing known) when the true number may be higher. */
const countWord = (n, atLeast) => (atLeast ? (n > 0 ? `≥${n}` : '?') : String(n));
export const lineWord = (c) => `+${countWord(c.added, c.addedAtLeast)} −${countWord(c.removed, c.removedAtLeast)}`;
export const inexact = (c) => c.addedAtLeast || c.removedAtLeast;
const zeroCounts = () => ({ added: 0, removed: 0, addedAtLeast: false, removedAtLeast: false });
function addCounts(into, c) {
  into.added += c.added; into.removed += c.removed;
  into.addedAtLeast ||= c.addedAtLeast; into.removedAtLeast ||= c.removedAtLeast;
  return into;
}

/** What the record says a path held after a change: deleted, a whole recorded body, or not known. */
const DELETED = Object.freeze({ deleted: true });
const UNKNOWN = Object.freeze({ unknown: true });

/** Whether a change's written body is the file's whole new state: a structured write, or a shell heredoc
 *  that replaced the file (`cat > f <<'EOF'`). Never an edit entry, an append, a new cell, or a heredoc
 *  whose unquoted delimiter let the shell expand it into text the record never saw. */
const wholeBody = (event, extent) => extent.recorded !== false && extent.priorState !== 'edit-text'
  && extent.append !== true && extent.insert !== true && extent.expanded !== true
  && (event.operation === 'write' || (event.operation === 'edit' && event.tool === HEREDOC));

/**
 * One recorded change's line counts and edit script, from recorded bodies only. `prior` is what the
 * record says the path held before this change (`undefined` when this session had not changed it yet):
 *   - a delete removes its recorded prior body (unknown when the record kept none);
 *   - a body the record does not contain counts nothing (`+? −?`);
 *   - an append or a new cell adds its body; an expanded heredoc adds at least its recorded lines;
 *   - an edit entry with its replaced segment is diffed against that segment;
 *   - a whole new body is diffed against its recorded prior file, else against the body this session last
 *     wrote to the path. It is a create (all additions) when the path was deleted before, or when it is a
 *     structured write to a path this session never changed. Otherwise its prior is unknown: its written
 *     lines are additions and its removals are `?`. The recorder keeps a prior state for a path's FIRST
 *     write only (slicer before.js), so without this a rewrite would read as a create. /16 (D79): that first
 *     write may be one that changed nothing (a shell write of a command that did not run or failed, which has
 *     no row), so a structured write the recorder typed as having a prior file (`PRIOR_HELD`) and that carries
 *     none is never a create: its removals are `?`.
 *   - an edit whose replaced text the record does not isolate counts its written lines as additions, and
 *     its removals as unknown.
 * A side the recorder cut, or the redactor dropped lines from, makes every count on it a lower bound.
 */
function changeFacts(session, event, change, prior) {
  const extent = change?.extent ?? {};
  const afterInfo = session.textSpanInfoOf(change, 'after'), beforeInfo = session.textSpanInfoOf(change, 'before');
  const afterText = afterInfo.spans.join(GAP), beforeText = beforeInfo.spans.join(GAP);
  const after = splitLines(afterText), before = splitLines(beforeText);
  const hasBefore = Array.isArray(change?.before) && change.before.length > 0;
  const afterCut = change?.truncated === true || extent.truncated === true;
  const beforeCut = change?.beforeExtent?.truncated === true;
  const afterDropped = Number(extent.redactedLines) > 0;
  const beforeDropped = Number(change?.beforeExtent?.redactedLines) > 0;
  const whole = wholeBody(event, extent);
  const state = event.operation === 'delete' ? DELETED
    : whole && !afterCut && !afterDropped && afterInfo.complete ? Object.freeze({ lines: after }) : UNKNOWN;
  const facts = (counts, ops) => ({ path: typeof change?.path === 'string' ? change.path : null,
    counts: { ...counts, addedAtLeast: counts.addedAtLeast || afterDropped, removedAtLeast: counts.removedAtLeast || beforeDropped },
    ops: ops && ops.length ? ops : null, afterText, beforeText, state });
  const unknownCounts = { added: 0, removed: 0, addedAtLeast: true, removedAtLeast: true };
  if (event.operation === 'delete') {
    return hasBefore
      ? facts({ added: 0, removed: before.length, addedAtLeast: false, removedAtLeast: beforeCut },
        beforeCut ? null : before.map((line) => ['-', line]))
      : facts({ added: 0, removed: 0, addedAtLeast: false, removedAtLeast: true }, null);
  }
  if (extent.recorded === false) return facts(unknownCounts, null);
  const additions = (removedAtLeast) => facts({ added: after.length, removed: 0, addedAtLeast: afterCut, removedAtLeast },
    after.map((line) => ['+', line]));
  if (extent.append === true || extent.insert === true) return additions(false);
  if (extent.expanded === true) return facts({ added: after.length, removed: 0, addedAtLeast: true, removedAtLeast: true }, null);
  const diffed = (from, fromCut) => {
    if (afterCut || fromCut) return facts(unknownCounts, null);
    const diff = diffLines(from, after);
    // A replace-all edit changed the segment at least once: its counts are lower bounds.
    const bound = !diff.exact || extent.replaceAll === true;
    return facts({ added: diff.added, removed: diff.removed, addedAtLeast: bound, removedAtLeast: bound }, diff.ops);
  };
  if (extent.priorState === 'edit-text') return hasBefore ? diffed(before, beforeCut) : additions(false);
  if (whole) {
    if (hasBefore) return diffed(before, beforeCut);
    if (prior === DELETED) return additions(false);
    if (prior === undefined) {
      return additions(event.operation !== 'write' || PRIOR_HELD.includes(event.recorded?.prior));
    }
    if (Array.isArray(prior.lines)) return diffed(prior.lines, false);
  }
  return additions(true);
}

// ---- the facts of a session and its report ----------------------------------------------------------

const list = (value) => (Array.isArray(value) ? value : []);
const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Recorded outcomes, indexed once per render: the Session's own `observationFor` / `outcomeOf` scan every
 * event per call, which is quadratic over a long session. `result` and `outcome` are those two methods'
 * definitions over the index (the FIRST terminal observation of an invocation). `notDone` asks the
 * Session's `actionOutcomeOf` itself, but only for a write that has a failed or cancelled terminal
 * receipt of its own — the only receipt that method can return a failed or cancelled result from.
 */
function outcomeIndex(session, events) {
  const terminals = new Map();
  for (const event of events) {
    if (event.kind !== 'observation' || event.phase !== 'terminal' || typeof event.invocation !== 'string') continue;
    if (!terminals.has(event.invocation)) terminals.set(event.invocation, []);
    terminals.get(event.invocation).push(event);
  }
  return {
    result: (id) => terminals.get(id)?.[0] ?? null,
    outcome: (id) => terminals.get(id)?.[0]?.result ?? 'none',
    notDone: (event) => (terminals.get(event.id) ?? []).some((row) => NOT_DONE.includes(row.result))
      && NOT_DONE.includes(session.actionOutcomeOf(event)),
  };
}

/**
 * /16 (owner decision D79): how a command's record says it ended, by typed fields only. `didNotRun`: the recorder typed
 * the call as refused before it ran (`recorded.denial`, a REFUSED_DENIALS kind) — then it is not a failed command,
 * whatever its result row says (Claude Code records a refusal as an error result). `failed` (M1): its result `failed`
 * (only ever from a native or hook status: sonah-ledger.js), or a recorded nonzero exit — whatever command it was.
 * D80: `stopped`: the recorder typed the call with a stopped denial kind (`STOPPED_DENIALS`) — it started and did not
 * finish; neither failed nor did not run, whatever its result row says.
 */
function commandEnd(outcomes, event) {
  const result = outcomes.result(event.id);
  const exitCode = Number.isInteger(result?.exitCode) ? result.exitCode : null;
  const didNotRun = REFUSED_DENIALS.includes(event.recorded?.denial);
  const stopped = STOPPED_DENIALS.includes(event.recorded?.denial);
  const failed = !didNotRun && !stopped
    && (outcomes.outcome(event.id) === 'failed' || (exitCode !== null && exitCode !== 0));
  return { exitCode, didNotRun, stopped, failed };
}

/**
 * Every write-shaped action's changes, in session order, with their line facts: event id -> rows. A write
 * the record says failed or was cancelled changed nothing and has no row. Each path's recorded state is
 * carried from one change to the next, so a rewrite is diffed against the body written before it.
 * /16 (D79): a write the slicer parsed from a command (`shellWriteOf`, a heredoc's body) has no result of its own; it
 * changed nothing when its command did not run (`commandEnd`), so it has no row and never becomes the state a later
 * write of the path is compared with — as the ledger reads it (`actionOutcome`: did-not-run), by typed outcome, never
 * by text. D80 (owner decision 2026-10-12): one whose command failed or was stopped keeps its row, marked `unconfirmed`
 * (`failed` or `stopped`: a SHELL_WRITE_ENDS key): the record does not say whether it happened (C-02; the ledger's
 * `command-failed` and `command-stopped` forms), so after it the path's content is not known (`UNKNOWN`).
 */
function countedChanges(session, events, outcomes) {
  const counted = new Map();
  const state = new Map();
  const shellEnd = (event) => {
    if (typeof event.shellWriteOf !== 'string' || !event.shellWriteOf) return null;
    const command = session.event(event.shellWriteOf);
    if (!command) return null;
    const end = commandEnd(outcomes, command);
    return end.didNotRun ? 'didNotRun' : end.failed ? 'failed' : end.stopped ? 'stopped' : null;
  };
  for (const event of events) {
    if (event.kind !== 'invocation' || !WRITE_OPERATIONS.includes(event.operation) || outcomes.notDone(event)) continue;
    const end = shellEnd(event);
    if (end === 'didNotRun') continue;
    const rows = [];
    list(event.changes).forEach((change, index) => {
      if (typeof change?.path !== 'string' || !change.path) return;
      const outside = change.outsideRepository === true;
      const facts = changeFacts(session, event, change, outside ? undefined : state.get(change.path));
      if (!outside) state.set(change.path, end === null ? facts.state : UNKNOWN);
      rows.push({ event, index, helper: event.childId != null, outside, ...(end === null ? {} : { unconfirmed: end }),
        ...facts });
    });
    counted.set(event.id, rows);
  }
  return counted;
}

export function storyFacts(session, report) {
  const events = list(session?.events);
  const orderOf = new Map(events.map((event, index) => [event.id, index]));
  const order = (id) => orderOf.get(id) ?? Infinity;
  const outcomes = outcomeIndex(session, events);
  const counted = countedChanges(session, events, outcomes);
  const windows = list(report?.windowResults);

  // Human asks, in session order. M5; M34 labels: every human instruction event is one — harness context never became
  // one (the slicer's label, labels.js) — shown by its recorded words. Each is one request, and (/14, owner decision
  // D77 C) one step: `start` is set below, once the steps are known. /15 (owner decision D79, 2026-10-11): a file you
  // attached to a message (the recorder's `attached` marker: the one human instruction windows.js `startsSegment` keeps
  // with its message, so the review windows and the story cut alike) is no request of its own. It belongs to the
  // message it was attached to — the last of your messages recorded before it — for the steps and for the request
  // every row is shown under, and is shown under that message (`attachments`); one recorded before any message of
  // yours belongs to no request, as the windows have it, and is shown before your requests (`unattached`). Structure
  // only: the recorder's marker and event order, never the words.
  const wordsOf = (event) => {
    const spans = session.textSpansOf(event, 'text');
    // A gap in the recorded text (a redaction, a cut) shows as `…`.
    const text = spans.length ? oneLine(spans.join(' … ')) : '';
    return text || STORY_SENTENCES.withheldAsk;
  };
  const instructions = events.filter((event) => event.kind === 'instruction' && event.authority === 'human');
  const asks = instructions.filter(startsSegment)
    // OWNER DECISION B: the human's answer to a question the agent asked (AskUserQuestion) is a reply.
    .map((event, k) => ({ k: k + 1, event, at: order(event.id), reply: typeof event.answerTo === 'string',
      text: wordsOf(event), attachments: [], start: null, steps: [], ...pastedOf(event) }));
  const unattached = [];
  for (const event of instructions.filter((event) => !startsSegment(event))) {
    const at = order(event.id);
    const ask = asks.filter((candidate) => candidate.at <= at).at(-1);
    (ask ? ask.attachments : unattached).push({ event, at, text: wordsOf(event) });
  }
  // A turn's request is its first ask (OWNER DECISION B: an instruction recorded later within the turn — a queued prompt,
  // an answer — never takes the turn's helpers from it).
  const requestOfTurn = new Map();
  for (const ask of asks) if (typeof ask.event.turn === 'string' && !requestOfTurn.has(ask.event.turn)) requestOfTurn.set(ask.event.turn, ask.k);
  // The hand-off that launched each verified helper (a spawn, never a follow-up): the first recorded for its child.
  const launchOf = new Map();
  for (const event of events) {
    if (event.kind !== 'invocation' || event.operation !== 'delegate') continue;
    const link = session.childFor(event.id);
    if (link?.relation === 'followup' || link?.state !== 'verified' || typeof link.childId !== 'string') continue;
    if (!launchOf.has(link.childId)) launchOf.set(link.childId, event);
  }
  // The request an event belongs to: the last of your requests recorded at or before it; for a helper's event, the
  // request of the hand-off that delivered it (C-03 M33 P `deliveredBy`: a follow-up's work is that follow-up's, as
  // ledger.js `attributionOf` credits its part), else of the hand-off that launched the helper. A hand-off's request is
  // its turn's (`requestOfTurn`, as `helpers` says it), else that of its own place. Structure only: event order, turns
  // and the recorded hand-off links; a cycle of them names no request. It places every row (a decision's `request`) and,
  // since /14, every event in its step.
  const requestOfEvent = (event, seen = new Set()) => {
    if (!event || seen.has(event.id)) return null;
    seen.add(event.id);
    const helperEvent = typeof event.childId === 'string' && event.childId !== '';
    const delivering = helperEvent && typeof event.deliveredBy === 'string' && event.deliveredBy !== event.id
      ? session.event(event.deliveredBy) : null;
    const handOff = delivering ?? (helperEvent ? launchOf.get(event.childId) ?? null : null);
    if (handOff) {
      if (seen.has(handOff.id)) return null;
      return typeof handOff.turn === 'string' && requestOfTurn.has(handOff.turn) ? requestOfTurn.get(handOff.turn)
        : requestOfEvent(handOff, seen);
    }
    const at = order(event.id);
    return asks.filter((ask) => ask.at <= at).at(-1)?.k ?? null;
  };

  // /14 (owner decision D77 C): a STEP IS ONE OF YOUR REQUESTS — every event the review windows hold that belongs to
  // that request (`requestOfEvent`), in session order, whichever windows hold them — so a request reviewed across
  // several windows is one step, and a window packing several requests (D68 K) contributes to each one's step. Work
  // recorded before your first request (no request names it) is one step of its own, first. A request no window
  // touches has no step. Each step keeps the windows that hold its events (`windows`, their indexes) and the failure of
  // the first of them that failed. Structure only: event order, the recorder's labels and the report's windows.
  const held = new Map();
  windows.forEach((window, w) => {
    const ids = list(window?.eventIds).filter((id) => typeof id === 'string' && orderOf.has(id));
    for (const id of new Set(ids)) {
      if (!held.has(id)) held.set(id, { event: session.event(id), request: requestOfEvent(session.event(id)), windows: [] });
      held.get(id).windows.push(w);
    }
  });
  const byRequest = new Map();
  for (const entry of held.values()) {
    if (!byRequest.has(entry.request)) byRequest.set(entry.request, []);
    byRequest.get(entry.request).push(entry);
  }
  const stepRequests = [...(byRequest.has(null) ? [null] : []), ...asks.map((ask) => ask.k).filter((k) => byRequest.has(k))];
  const stepOf = new Map();
  const steps = stepRequests.map((request, index) => {
    const own = byRequest.get(request).sort((a, b) => order(a.event.id) - order(b.event.id));
    const stepWindows = [...new Set(own.flatMap((entry) => entry.windows))].sort((a, b) => a - b);
    for (const entry of own) stepOf.set(entry.event.id, index);
    return { index, n: index + 1, request, events: own.map((entry) => entry.event), windows: stepWindows,
      failure: stepWindows.map((w) => windows[w]?.failure ?? null).find((failure) => failure !== null) ?? null };
  });
  // Each ask starts in its own step; one with no step (no window touches its request) starts in the first step after
  // it — the next request's — so its heading keeps its place, and is worked on in no step.
  const stepByRequest = new Map(steps.map((step) => [step.request, step.index]));
  for (let i = asks.length - 1, next = null; i >= 0; i--) {
    const own = stepByRequest.get(asks[i].k);
    asks[i].start = own ?? next;
    asks[i].steps = own === undefined ? [] : [own + 1];
    if (own !== undefined) next = own;
  }
  // A window's steps, first and last (0-based), for the rows the report places by window (a requirement's).
  const stepsOfWindow = new Map();
  for (const step of steps)
    for (const w of step.windows) {
      const span = stepsOfWindow.get(w);
      stepsOfWindow.set(w, span ? [Math.min(span[0], step.index), Math.max(span[1], step.index)] : [step.index, step.index]);
    }

  // Report rows, each placed in one step: by the event that places it (`placedId`), the first or last of its ids a step
  // holds, in session order.
  const placedId = (ids, pick) => {
    const placed = ids.filter((id) => stepOf.has(id)).sort((a, b) => order(a) - order(b));
    if (!placed.length) return null;
    return pick === 'last' ? placed[placed.length - 1] : placed[0];
  };
  const stepOfIds = (ids, pick) => {
    const id = placedId(ids, pick);
    return id === null ? null : stepOf.get(id);
  };
  const receiptIds = (receipts, skipInstructions) => {
    const all = list(receipts).filter(plainObject);
    const chosen = skipInstructions && all.some((r) => r.role !== 'instruction') ? all.filter((r) => r.role !== 'instruction') : all;
    return chosen.map((r) => r.eventId).filter((id) => typeof id === 'string');
  };
  // A decision's column counts only when the ledger derived it. `unasked` is a decision the review is
  // SURE was made without asking you, and every one of them leads (M33 brittleness H4: its materiality is shown
  // beside it, never used to leave it out).
  const decisions = list(report?.decisions).filter(plainObject).map((d, i) => {
    // The judgment-first review (low, one counting): who decided, by the one rule every reader reads (review.js
    // `derivedColumn`: the column only when the ledger derived it).
    const who = derivedColumn(d) ?? 'unchecked';
    const unasked = who === DECISION_COLUMNS[2];
    // D71 (S4, d): a choice not to act has no action: its recorded place is its statement's (ledger, `notActing`).
    const placedBy = d.notActing === true && !list(d.actions).length && typeof d.stated?.eventId === 'string' ? [d.stated.eventId]
      : list(d.actions).filter((id) => typeof id === 'string');
    // /18 (D83 (2)): an asked column the ledger derived from a project instruction file names that file.
    const referredFrom = who === DECISION_COLUMNS[0] || who === DECISION_COLUMNS[1] ? referredFromOf(session, d) : null;
    return { d, i, step: stepOfIds(placedBy, 'first'), anchor: placedId(placedBy, 'first'), who, unasked,
      lead: unasked, ...(referredFrom === null ? {} : { referredFrom }) };
  });
  const findings = list(report?.findings).filter((f) => plainObject(f) && FINDING_STATUSES.includes(f.status))
    .map((f, i) => ({ f, i, step: stepOfIds(receiptIds(f.receipts, true), 'last') }))
    .sort((x, y) => (FINDING_STATUSES.indexOf(x.f.status) - FINDING_STATUSES.indexOf(y.f.status))
      || ((x.step ?? Infinity) - (y.step ?? Infinity)) || (x.i - y.i));
  const pivots = list(report?.pivots).filter((p) => plainObject(p) && typeof p.abandoned === 'string' && typeof p.adopted === 'string')
    .map((p, i) => ({ p, i, step: stepOfIds(receiptIds(p.receipts, true), 'last') }));
  // The claims every reader lists (review.js `listedPromises`): one a contradicted-claim finding cites is that finding
  // (C-06 M33 G3), never also a claim here (the judgment-first review, low: the page and the story folded it while the
  // PR comment and the CLI left it out).
  const listed = new Set(listedPromises(report ?? {}));
  const promises = list(report?.promises).filter((p) => listed.has(p))
    .map((p, i) => ({ p, i, step: stepOfIds([p.stated?.eventId].filter((id) => typeof id === 'string'), 'first'),
      confirmedBy: confirmingQuote(session, p) }));
  const written = list(report?.writtenClaims).filter((w) => plainObject(w) && typeof w.text === 'string' && WRITTEN_LABELS.includes(w.label))
    .map((w, i) => ({ w, i, step: stepOfIds([w.stated?.eventId].filter((id) => typeof id === 'string'), 'first') }));
  // D88: a checklist report's failure rows (each names its RESULT), each placed by its RESULT or its action, the first a
  // step holds; null for a report from before the checklist, which has none.
  const failures = Array.isArray(report?.failures) ? report.failures
    .filter((row) => plainObject(row) && typeof row.eventId === 'string')
    .map((row, i) => ({ row, i, step: stepOfIds([row.eventId, row.action].filter((id) => typeof id === 'string'), 'first') }))
    : null;
  // /15 (D79): a requirement citing a file you attached is its message's request's.
  const kOfAsk = new Map(asks.flatMap((ask) => [[ask.event.id, ask.k],
    ...ask.attachments.map((a) => [a.event.id, ask.k])]));
  const requirements = distinctRequirements(session, report, new Set(kOfAsk.keys()));
  // /14: a requirement's steps are read by window (the windows that proposed it, or that hold its ask): from the first
  // step of the first such window — never before the step its own request is — to the last step of the last one.
  for (const r of requirements) {
    if (!Array.isArray(r.steps)) continue;
    const from = stepsOfWindow.get(r.steps[0] - 1), until = stepsOfWindow.get(r.steps[1] - 1);
    if (!from || !until) { r.steps = null; continue; }
    const last = Math.max(from[1], until[1]);
    const own = stepByRequest.get(kOfAsk.get(r.ask));
    const first = Math.min(Math.max(from[0], own ?? from[0]), last);
    r.steps = [first + 1, last + 1];
  }
  for (const ask of asks) ask.requirements = requirements.filter((r) => kOfAsk.get(r.ask) === ask.k);

  // Helpers: every spawn hand-off (a delegate that is not a follow-up), in session order, with the files
  // in the repository its own child session changed.
  const childPaths = new Map();
  for (const rows of counted.values())
    for (const row of rows) {
      if (typeof row.event.childId !== 'string' || row.outside || row.unconfirmed) continue;
      if (!childPaths.has(row.event.childId)) childPaths.set(row.event.childId, new Set());
      childPaths.get(row.event.childId).add(row.path);
    }
  const helpers = [];
  // M33 P: a helper whose work the review shows where the parent RECEIVED it is listed in the step holding that receipt
  // (the receipt boundary heading its work names its hand-off), and under the request whose turn launched it.
  // M35 windowing: a review window never holds a receipt boundary (a helper is reviewed in its own windows), so a
  // receipt no step holds stands in the step of the last event of its own session recorded before it.
  const receiptStep = new Map();
  const sameStream = (a, b) => (a.childId ?? null) === (b.childId ?? null);
  const stepAt = (boundary) => {
    if (stepOf.has(boundary.id)) return stepOf.get(boundary.id);
    for (let at = order(boundary.id) - 1; at >= 0; at--)
      if (sameStream(events[at], boundary) && stepOf.has(events[at].id)) return stepOf.get(events[at].id);
    return null;
  };
  for (const event of events)
    if (event.kind === 'boundary' && event.boundary === HELPER_RECEIPT_BOUNDARY && Array.isArray(event.assignments)) {
      const step = stepAt(event);
      if (step !== null)
        for (const id of event.assignments) if (typeof id === 'string' && !receiptStep.has(id)) receiptStep.set(id, step);
    }
  for (const event of events) {
    if (event.kind !== 'invocation' || event.operation !== 'delegate') continue;
    const link = session.childFor(event.id);
    if (link?.relation === 'followup') continue;
    const childId = link?.state === 'verified' && typeof link.childId === 'string' ? link.childId : null;
    // The brief the parent sent, when the hand-off recorded one; else the brief as the verified helper received
    // it (its first instruction); else (M33 T) — Codex encrypts the brief of its `spawn_agent` hand-off on both
    // sides — the hand-off's task name in plain words; else the helper's own first statement, marked as the
    // helper's words.
    const textOfEvent = (e) => (e ? oneLine(session.textSpansOf(e, 'text').join(' … ')) : '');
    const sent = oneLine(session.textSpansOf(event, 'input').join(' … '));
    // M5: harness context a helper's recording starts with (a Codex plugin list) is no instruction event of it at all
    // (the slicer's decision), so it is never its brief.
    const own = (kind) => (childId === null ? null : events.find((e) => e.childId === childId && e.kind === kind) ?? null);
    const received = sent ? '' : textOfEvent(own('instruction'));
    const task = sent || received ? '' : taskWords(event.taskName);
    const said = sent || received || task ? '' : textOfEvent(own('commentary'));
    const brief = sent || received || task || (said ? `${STORY_SENTENCES.helperSaid} ${said}` : '');
    const result = outcomes.result(event.id);
    // M33 F: what the helper reported back — only a final report attached to this hand-off (`helperReported`).
    const report = result?.helperReported === true ? reportWords(session, result) : null;
    // M33 W: a Workflow agent belongs to its call's helper group (the delegate event's `workflowCall`), named by the
    // workflow's recorded name; every other helper is a group of its own, as before.
    const run = event.operation === 'delegate' && typeof event.workflowCall === 'string' ? event.workflowCall : null;
    helpers.push({ k: helpers.length + 1, event, link, childId, brief, report,
      ...(run !== null ? { run, runName: workflowWords(event.workflowName) } : {}),
      files: childId === null ? null : childPaths.get(childId)?.size ?? 0,
      spawnStep: receiptStep.has(event.id) ? receiptStep.get(event.id) : stepOf.has(event.id) ? stepOf.get(event.id) : null,
      request: typeof event.turn === 'string' && requestOfTurn.has(event.turn) ? requestOfTurn.get(event.turn) : null,
      resultStep: result && result.result === 'succeeded' && stepOf.has(result.id) ? stepOf.get(result.id) : null });
  }

  // The request a decision was made under, read from the event that places it (`anchor`), never from its step
  // (`requestOfEvent`, the rule that also places every event in its step since /14: for your own work the two agree by
  // construction; a decision placed by no event names none).
  for (const x of decisions) x.request = x.anchor === null ? null : requestOfEvent(session.event(x.anchor));

  for (const step of steps) Object.assign(step, stepActivity(session, step.events, outcomes, counted));
  for (const step of steps) {
    const here = (row) => row.step === step.index;
    step.decisions = decisions.filter(here);
    step.findings = findings.filter(here);
    step.pivots = pivots.filter(here);
    step.promises = promises.filter(here);
    step.written = written.filter(here);
    step.helpers = helpers.filter((h) => h.spawnStep === step.index);
    // The requests whose heading the engineer section prints above this step: its own, and any no window touched that
    // comes right before it. `request` (the request the step is shown under) is the step's own, set where it was built.
    step.asksStarting = asks.filter((ask) => ask.start === step.index);
    step.title = stepTitle(step);
  }
  const whole = stepActivity(session, events, outcomes, counted);
  const linkedHelpers = new Set(list(session?.children).filter((link) => link?.state === 'verified'
    && typeof link.childSession === 'string' && link.childSession).map((link) => link.childSession)).size;
  // M33 T: every hand-off (a spawn or a follow-up, the parent's or a transferred helper's) whose brief the recorder
  // encrypted. Counted here and stated once in the meta line.
  const encryptedBriefs = events.filter((event) => event.kind === 'invocation' && event.operation === 'delegate'
    && event.briefEncrypted === true).length;
  // M33 F: every inter-agent message the recorder encrypted, as the adapter declared them (this session's and each
  // transferred helper's gap). Counted here and stated once in the meta line; a declaration with no count is one.
  const encryptedGaps = list(session?.adapterGaps).filter((gap) => plainObject(gap) && gap.code === 'incomplete_inventory'
    && gap.channel === 'children' && gap.note === INTER_AGENT_GAP_NOTES.encrypted);
  const encryptedMessages = { n: encryptedGaps.reduce((n, gap) => n + (Number.isSafeInteger(gap.count) && gap.count > 0
    ? gap.count : 1), 0), atLeast: encryptedGaps.some((gap) => !(Number.isSafeInteger(gap.count) && gap.count > 0)) };
  return { events, steps, asks, unattached, decisions, findings, pivots, promises, written, failures, helpers, whole,
    linkedHelpers, encryptedBriefs, encryptedMessages };
}

/** A requirement's text as compared, for rows whose quote cannot be located: case, whitespace and punctuation
 *  do not make another requirement. */
const requirementKey = (eventId, text) => JSON.stringify([eventId,
  String(text).toLowerCase().replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim()]);
/** How unevenly a wording reads beside the others: a lower-case first letter, a closing period. */
const untidy = (text) => { const line = oneLine(text); return Number(/^\p{Ll}/u.test(line)) + Number(/\.$/.test(line)); };
/** Requirement statuses, least addressed first. D71 (S2): with the checklist's, a not-checked row before a done one. */
const REQUIREMENT_ORDER = Object.freeze(['open', 'not-done', 'partly-addressed', 'partly-done', 'not-checked', 'addressed', 'done']);
const leastAddressed = (rows) => REQUIREMENT_ORDER.find((status) => rows.some((row) => row.r.status === status));
/**
 * Where a grounded instruction quote sits in its instruction, as `{ span, from, until }` without the whitespace at
 * its ends: its place in the one uninterrupted text span of the instruction that holds it (a quote that grounds is
 * in one of them). A quote found at more than one place is not located: its words do not say which place it cites.
 */
export function locateQuote(instruction, spans) {
  // D71 (S2): code's own row for a message no row cited quotes nothing (`ask_unreviewed`): it is never located.
  if (typeof instruction?.quote !== 'string' || !instruction.quote) return null;
  let at = null;
  for (let span = 0; span < spans.length; span++) {
    const from = spans[span].indexOf(instruction.quote);
    if (from === -1) continue;
    if (at || spans[span].indexOf(instruction.quote, from + 1) !== -1) return null;
    at = { span, from, until: from + instruction.quote.length };
  }
  if (!at) return null;
  const text = spans[at.span];
  while (at.from < at.until && /\s/.test(text[at.from])) at.from++;
  while (at.until > at.from && /\s/.test(text[at.until - 1])) at.until--;
  return at.from < at.until ? at : null;
}
/** How many characters two located quotes of one span share (0 or less when none). As quotes are located without
 *  the whitespace at their ends, any shared character run holds a word character. */
const sharedChars = (a, b) => Math.min(a.until, b.until) - Math.max(a.from, b.from);
/** Whether two located quotes overlap by at least half of the shorter one. */
export const overlapping = (a, b) => 2 * sharedChars(a, b) >= Math.min(a.until - a.from, b.until - b.from);
/** The share of the words two located quotes cover together that both cover (0 when they share none). */
const sameWords = (a, b) => Math.max(0, sharedChars(a, b)) / (Math.max(a.until, b.until) - Math.min(a.from, b.from));

/**
 * The review's requirement rows, grouped into requirements. `batches` are lists of rows no two of which are one
 * requirement: a review window's proposals (a window proposes each requirement once), or one report row each.
 *
 * A located row continues a requirement of an EARLIER batch, of the same instruction span, only when its quote
 * shares words with every quote of that requirement and overlaps at least one of them by at least half of the
 * shorter: so two quotes that share no word are never one requirement, whatever quote lies between them. Each
 * requirement is continued by at most one row of a batch. Rows and requirements are matched best first: the most
 * words in common between the quotes (the share both cover), then row and requirement order. When the best match of
 * a row, or for a requirement, ties with another, nothing tells which it is: the row starts a requirement of its own,
 * and a requirement two rows tie for is not continued in that batch. (L6: no wording
 * similarity breaks such a tie — the English stop-word Dice score, `alike`, that did is deleted.) A row that
 * continues nothing starts a requirement. A row a batch holds twice, at the same place, is one.
 *
 * A row whose quote cannot be located joins, by its text as compared (`requirementKey`), the first requirement
 * that holds a located row with that text, else the first one without a location that has it. So does every row
 * of the batches after the matching has done `STORY_LIMITS.requirementWork` comparisons: a review whose rows fit
 * many requirements equally, window after window, cannot make the story slow, and text grouping never merges two
 * wordings, so it can only show more rows, never fewer.
 */
function groupRequirements(batches, spansOf) {
  const groups = [];
  const bySpan = new Map();
  const place = (row) => JSON.stringify([row.ask, row.at.span]);
  const start = (row) => {
    const group = { n: groups.length, ask: row.ask, members: [], quotes: [], batches: new Set(),
      minUntil: Infinity, maxFrom: -Infinity };
    groups.push(group);
    if (row.at) {
      if (!bySpan.has(place(row))) bySpan.set(place(row), []);
      bySpan.get(place(row)).push(group);
    }
    return group;
  };
  const join = (group, row) => {
    group.members.push(row);
    group.batches.add(row.batch);
    if (row.at) {
      if (!group.quotes.some((q) => q.span === row.at.span && q.from === row.at.from && q.until === row.at.until)) group.quotes.push(row.at);
      group.minUntil = Math.min(group.minUntil, row.at.until);
      group.maxFrom = Math.max(group.maxFrom, row.at.from);
    }
  };
  const score = (row, group) => {
    // Shares words with every quote (the quotes of a requirement all share a place: that place is inside
    // [maxFrom, minUntil)), and overlaps one by half.
    if (group.batches.has(row.batch) || row.at.from >= group.minUntil || row.at.until <= group.maxFrom) return null;
    if (!group.quotes.some((q) => overlapping(row.at, q))) return null;
    return { q: group.quotes.reduce((n, q) => Math.max(n, sameWords(row.at, q)), 0) };
  };
  let work = 0;
  const unmatched = new Set();
  batches.forEach((rows, batch) => {
    // Past the work bound, a batch's rows are grouped by their text as compared, like rows without a location.
    if (work > STORY_LIMITS.requirementWork) for (const row of rows) if (row.at) unmatched.add(row);
    // A row one batch holds twice (the same text as compared, at the same place) is one row: it goes where the
    // first goes.
    const firstAt = new Map();
    const echoes = [];
    const located = rows.filter((row) => {
      if (!row.at || unmatched.has(row)) return false;
      const same = JSON.stringify([row.key, row.at.span, row.at.from, row.at.until]);
      if (firstAt.has(same)) { echoes.push([row, firstAt.get(same)]); return false; }
      firstAt.set(same, row);
      return true;
    });
    const pairs = [];
    located.forEach((row, i) => {
      for (const group of bySpan.get(place(row)) ?? []) {
        work++;
        const s = score(row, group);
        if (s) pairs.push({ i, group, ...s });
      }
    });
    work += pairs.length;
    pairs.sort((x, y) => y.q - x.q || x.i - y.i || x.group.n - y.group.n);
    const chosen = new Map(), taken = new Set();
    for (let k = 0; k < pairs.length; k++) {
      const pair = pairs[k];
      if (chosen.has(pair.i) || taken.has(pair.group)) continue;
      // Its rivals: the pairs of equal score after it, of the same row or the same requirement, still open.
      const rivals = [];
      for (let j = k + 1; j < pairs.length && pairs[j].q === pair.q; j++)
        if ((pairs[j].i === pair.i || pairs[j].group === pair.group) && !chosen.has(pairs[j].i) && !taken.has(pairs[j].group))
          rivals.push(pairs[j]);
      const contested = rivals.some((p) => p.group === pair.group);
      chosen.set(pair.i, rivals.length ? null : pair.group);
      for (const p of rivals) if (p.group === pair.group) chosen.set(p.i, null);
      if (!rivals.length || contested) taken.add(pair.group);
    }
    const home = new Map();
    located.forEach((row, i) => { const group = chosen.get(i) ?? start(row); join(group, row); home.set(row, group); });
    for (const [row, first] of echoes) join(home.get(first), row);
  });
  // Rows without a location (or past the work bound), by their text as compared, once every located row has its
  // requirement.
  const locatedByKey = new Map(), plainByKey = new Map();
  for (const group of groups)
    for (const row of group.members) if (!locatedByKey.has(row.key)) locatedByKey.set(row.key, group);
  batches.forEach((rows) => {
    for (const row of rows.filter((r) => !r.at || unmatched.has(r))) {
      const group = locatedByKey.get(row.key) ?? plainByKey.get(row.key) ?? start(row);
      if (!plainByKey.has(row.key) && !locatedByKey.has(row.key)) plainByKey.set(row.key, group);
      join(group, row);
    }
  });
  return groups;
}

/**
 * The distinct requirements of the human asks. The review re-proposes a requirement in every window, in other
 * words each time, so its wording cannot tell two rows of one requirement apart; the human words each row cites
 * mostly can (`groupRequirements`). The rows grouped are each window's proposals whose instruction quote grounds
 * in this session, a window being a batch; the report's own rows only say which requirements the review published,
 * and in what order. A report row no window proposed (or every row, when the report has no window narratives) is
 * grouped with the others like it, one row a batch: nothing then says which rows one window proposed side by side.
 * A requirement the report lists no row of is not shown; the requirements are in the order the report first lists
 * them.
 *
 * Each requirement is shown ONCE. One with a located quote reads as the human's own words: the longest of its
 * quotes that no other requirement's quote overlaps by half, else the longest of them. Its status is from the LAST
 * window that proposed any row of it (the least addressed of that window's rows, should it hold two), and its steps
 * run from the first such window to the last. A requirement only report rows make up gives the least addressed
 * status of those rows, and no steps: a report row keeps the status of its latest wording, however old. `wording` is
 * the review's words of the row the status is from, for the reader when two requirements read as the same words.
 */
function distinctRequirements(session, report, askIds) {
  const readable = (r) => plainObject(r) && typeof r.text === 'string' && Object.hasOwn(STORY_REQUIREMENT_WORDS, r.status)
    && plainObject(r.instruction) && askIds.has(r.instruction.eventId);
  const spansCache = new Map();
  const spansOf = (id) => {
    if (!spansCache.has(id)) spansCache.set(id, session.textSpansOf(session.event(id), 'text'));
    return spansCache.get(id);
  };
  const row = (r, window, batch) => {
    const grounded = verifyReceipt(session, r.instruction).ok;
    const ask = r.instruction.eventId;
    return { r, window, batch, ask, grounded, key: requirementKey(ask, r.text),
      at: grounded ? locateQuote(r.instruction, spansOf(ask)) : null };
  };
  // D71 (S4): a checklist row (a session-only review's statuses, ledger.js REQUIREMENT_STATUSES) is read as code published
  // it — its status, evidence and reason after the code checks and the challenge (owner decision D71 b), never the
  // answer's proposed status — one requirement per report row (the merge already keyed it by its grounded instruction
  // quote: run-review.js `mergeWindowOutputs`). The legacy rows are grouped below, as before.
  const all = list(report?.requirements).filter(readable);
  const checklist = all.filter((r) => REQUIREMENT_STATUSES.includes(r.status));
  const listed = all.filter((r) => !REQUIREMENT_STATUSES.includes(r.status));
  const order = new Map();
  listed.forEach((r, i) => { const key = requirementKey(r.instruction.eventId, r.text); if (!order.has(key)) order.set(key, i); });
  const windows = list(report?.windowResults).map((window, index) => list(window?.narrative?.requirements)
    .filter((r) => readable(r) && !REQUIREMENT_STATUSES.includes(r.status) && r.instruction.role === 'instruction')
    .map((r) => row(r, index, index)).filter((x) => x.grounded));
  const proposedKeys = new Set(windows.flat().map((x) => x.key));
  const unproposed = listed.filter((r) => !proposedKeys.has(requirementKey(r.instruction.eventId, r.text)));
  const groups = [...groupRequirements(windows, spansOf),
    ...groupRequirements(unproposed.map((r, i) => [row(r, null, i)]), spansOf)];
  const lowest = (values) => values.reduce((n, v) => Math.min(n, v), Infinity);
  const highest = (values) => values.reduce((n, v) => Math.max(n, v), -Infinity);
  // A quote another requirement of the same request also overlaps by half is not how either one reads.
  const shared = (group, quote) => groups.some((other) => other !== group && other.ask === group.ask
    && other.quotes.some((q) => q.span === quote.span && overlapping(q, quote)));
  return [...groups.map((group) => ({ group, first: lowest(group.members.map((m) => order.get(m.key) ?? Infinity)) }))
    .filter(({ first }) => first !== Infinity).sort((a, b) => a.first - b.first || a.group.n - b.group.n).map(({ group }) => {
      const proposed = group.members.filter((m) => m.window !== null);
      const last = proposed.length ? highest(proposed.map((m) => m.window)) : null;
      const deciding = last === null ? group.members : proposed.filter((m) => m.window === last);
      const status = leastAddressed(deciding);
      const own = group.quotes.filter((quote) => !shared(group, quote));
      const shown = (own.length ? own : group.quotes)
        .reduce((best, q) => (best === null || q.until - q.from > best.until - best.from ? q : best), null);
      const text = shown ? spansOf(group.ask)[shown.span].slice(shown.from, shown.until)
        : group.members.map((m) => m.r.text).reduce((best, t) => (untidy(t) < untidy(best) ? t : best));
      // `located`: every place in the request's recorded text its grounded quotes sit (D69 f (g), the session page links
      // the rows that cite the same words by it); the story reads none of it.
      return { ask: group.ask, status, text, quoted: shown !== null, wording: deciding.find((m) => m.r.status === status).r.text,
        steps: last === null ? null : [lowest(proposed.map((m) => m.window)) + 1, last + 1],
        located: group.quotes.map((q) => ({ span: q.span, from: q.from, until: q.until })) };
    }), ...checklist.map((r) => checklistRequirement(session, report, r, spansOf))];
}

/**
 * D71 (S4): one checklist requirement row as the readers show it — the human's grounded words for the ask (code's own
 * row, `codeMade`, has none: it reads in its fixed words), the status code published, and the row itself (`checked`:
 * its deliverable, shortfall, `restsOn`, closed reason and facts). Its steps are the windows whose answer proposed a row
 * citing the same words (by event and quote), else the windows that hold the ask; structure only.
 */
function checklistRequirement(session, report, r, spansOf) {
  const ask = r.instruction.eventId;
  const quoted = r.codeMade !== true && verifyReceipt(session, r.instruction).ok;
  const at = quoted ? locateQuote(r.instruction, spansOf(ask)) : null;
  const windows = list(report?.windowResults);
  const proposing = windows.flatMap((window, index) => (list(window?.narrative?.requirements).some((n) => plainObject(n)
    && plainObject(n.instruction) && n.instruction.eventId === ask && n.instruction.quote === r.instruction.quote) ? [index] : []));
  const holding = proposing.length ? proposing
    : windows.flatMap((window, index) => (list(window?.eventIds).includes(ask) ? [index] : []));
  return { ask, status: r.status, text: quoted ? r.instruction.quote : r.text, quoted, wording: r.text,
    steps: holding.length ? [Math.min(...holding) + 1, Math.max(...holding) + 1] : null,
    located: at ? [{ span: at.span, from: at.from, until: at.until }] : [], checked: r };
}

/** What happened in a list of events: commands (with what each did), files read and changed, hand-offs.
 *  Changes outside the repository are only counted, as distinct paths. D80: a write of a failed or stopped command
 *  (`unconfirmed`, inside the repository or not) is none of the changes: it is listed apart (`unconfirmed`). */
function stepActivity(session, events, outcomes, counted) {
  const commands = [], changes = [], unconfirmed = [], readPaths = new Set(), outside = new Set();
  let spawns = 0;
  for (const event of events) {
    if (event.kind !== 'invocation') continue;
    if (event.operation === 'command') {
      const raw = session.textSpansOf(event, 'command').join(' ');
      const facts = commandFacts(raw);
      for (const path of facts.reads) readPaths.add(path);
      // M1: a command failed when its record says so (`commandEnd`); /16 (D79): one the recorder typed as refused did
      // not run, and is not a failed command.
      // D80: and one it typed as stopped is neither.
      const { exitCode, didNotRun, stopped, failed } = commandEnd(outcomes, event);
      commands.push({ event, text: clip(oneLine(raw), STORY_LIMITS.commandChars), facts, outcome: outcomes.outcome(event.id),
        exitCode, failed, didNotRun, stopped,
        ...(failed || didNotRun || stopped ? { shown: failedCommandText(raw) } : {}) });
    } else if (event.operation === 'delegate') {
      if (session.childFor(event.id)?.relation !== 'followup') spawns++;
    } else if (WRITE_OPERATIONS.includes(event.operation)) {
      for (const row of counted.get(event.id) ?? []) {
        if (row.unconfirmed) unconfirmed.push(row);
        else if (row.outside) outside.add(row.path);
        else changes.push(row);
      }
    } else {
      for (const p of list(event.paths)) if (typeof p?.path === 'string' && p.path) readPaths.add(cleanPath(p.path));
    }
  }
  const files = new Map();
  for (const change of changes) {
    const file = files.get(change.path) ?? { path: change.path, counts: zeroCounts(), helper: true, operations: new Set() };
    addCounts(file.counts, change.counts);
    file.helper &&= change.helper;
    file.operations.add(change.event.operation);
    files.set(change.path, file);
  }
  const counts = [...files.values()].reduce((sum, file) => addCounts(sum, file.counts), zeroCounts());
  return { commands, changes, unconfirmed, files: [...files.values()], counts, readPaths, spawns, outsidePaths: outside,
    outside: outside.size };
}

/** A step is quiet when it changed no file in the repository, holds no finding, no decision the review is
 *  sure was made without asking, no change of approach, spawned no helper, and holds no claim the agent wrote
 *  into a file. That last one matters for a write outside the repository (a PR body in /tmp, a plan file): the
 *  step changed nothing here, but its block is the only place the story shows what the written text claims. A quiet
 *  step is one line in the engineer section (`quietLine`), not a block. */
const quietStep = (step) => !(step.files.length || step.findings.length || step.pivots.length || step.spawns
  || step.decisions.some((x) => x.unasked) || step.written.length || step.unconfirmed.length);

export const commonDirectory = (paths) => {
  const dirs = paths.map((path) => path.split('/').slice(0, -1));
  if (!dirs.length) return '';
  let shared = dirs[0];
  for (const dir of dirs.slice(1)) {
    let i = 0;
    while (i < shared.length && i < dir.length && shared[i] === dir[i]) i++;
    shared = shared.slice(0, i);
  }
  return shared.join('/');
};

/** Whether a path a command names is inside the working tree: not absolute, not under a home directory, and
 *  never climbing out of it. A path outside it (a scratch file, another checkout, a user's home) is counted in
 *  a title, never named: it can carry a local user name and it is no part of the repository. */
const inWorkingTree = (path) => !path.startsWith('/') && !path.startsWith('~') && !path.split('/').includes('..');

/** Where the files read sit: " in DIR" when the first directory that holds the most of them holds them
 *  all (DIR is their common directory), " mostly in DIR" when it holds more than half, else nothing.
 *  Paths outside the working tree are counted, never named. */
function readPlace(paths) {
  const groups = new Map();
  for (const path of paths) {
    const parts = path.split('/');
    if (!inWorkingTree(path) || parts.length < 2) continue;
    groups.set(parts[0], [...(groups.get(parts[0]) ?? []), path]);
  }
  let best = null;
  for (const [top, members] of groups)
    if (!best || members.length > best[1].length || (members.length === best[1].length && top < best[0])) best = [top, members];
  if (!best) return '';
  const dir = clipPath(commonDirectory(best[1]), STORY_LIMITS.titleDirChars);
  return best[1].length === paths.length ? ` in ${dir}` : 2 * best[1].length > paths.length ? ` mostly in ${dir}` : '';
}

/**
 * The phrases of a title, from facts only, at most three, in this order: edits ("Edited 3 files in
 * src/middleware", or files changed outside the repository), failed commands ("2 commands failed"), git
 * writes ("committed"), reads ("read 14 files in packages/evidence"), scripts ("ran scripts/x.mjs", or
 * "ran 4 scripts", or "ran 1 script" when it ran from outside the working tree), helpers ("spawned 2
 * helpers"), installs. "Ran N commands" — or "ran N read-only commands" when nothing but reads ran — only
 * when none of these applies, and only with `fallback`.
 */
function titlePhrases(activity, options) {
  return activityPhrases(activity, options).slice(0, 3).map((phrase) => phrase.text);
}

/** Every phrase `titlePhrases` may pick from, in its order, each with what it names (`key`: edit, failed, didNotRun,
 *  stopped, git, reads, scripts, helpers, install, commands), a `short` form without where the files are (or "outside
 *  the repo"), and a `tiny` one (failed commands: "2 failed"). A failed command is an `alarm`: a chart label keeps it
 *  before any other phrase; /16 (D79): a command that did not run is no alarm; D80: nor one stopped before it
 *  finished. M1: no phrase says "ran tests": which
 *  command is a test is not code's to say. */
export function activityPhrases(activity, { fallback = true, outside = true } = {}) {
  const { files, commands } = activity;
  const phrases = [];
  const phrase = (key, text, short = text, tiny = short, alarm = false) => phrases.push({ key, text, short, tiny, alarm });
  if (files.length) {
    const ops = new Set(files.flatMap((file) => [...file.operations]));
    const verb = ops.size !== 1 ? 'changed' : ops.has('edit') ? 'edited' : ops.has('delete') ? 'deleted' : 'wrote';
    const dir = commonDirectory(files.map((file) => file.path));
    phrase('edit', `${verb} ${plural(files.length, 'file')}${dir ? ` in ${clipPath(dir, STORY_LIMITS.titleDirChars)}` : ''}`,
      `${verb} ${plural(files.length, 'file')}`);
  } else if (outside && activity.outside) phrase('edit', `changed ${plural(activity.outside, 'file')} outside the repository`,
    `changed ${plural(activity.outside, 'file')} outside the repo`);
  const failed = commands.filter((c) => c.failed).length;
  if (failed) phrase('failed', `${plural(failed, 'command')} failed`, `${plural(failed, 'command')} failed`, `${failed} failed`, true);
  // /16 (D79): a command the recorder typed as refused did not run; counted apart from the failed ones, no alarm.
  const didNotRun = commands.filter((c) => c.didNotRun).length;
  if (didNotRun) phrase('didNotRun', `${plural(didNotRun, 'command')} ${STORY_SENTENCES.didNotRun}`,
    `${plural(didNotRun, 'command')} ${STORY_SENTENCES.didNotRun}`, `${didNotRun} ${STORY_SENTENCES.didNotRun}`);
  // D80: a command the recorder typed as stopped before it finished; counted apart from the failed ones, no alarm.
  const stopped = commands.filter((c) => c.stopped).length;
  if (stopped) phrase('stopped', stoppedPhrase(stopped), stoppedPhrase(stopped), `${stopped} stopped`);
  const git = new Set(commands.flatMap((c) => c.facts.git));
  const order = Object.keys(GIT_WRITE_WORDS).filter((sub) => git.has(sub));
  const gitWords = [...new Set((order.some((sub) => GIT_HEADLINE.includes(sub)) ? order.filter((sub) => GIT_HEADLINE.includes(sub))
    : order).map((sub) => GIT_WRITE_WORDS[sub]))].slice(0, 2);
  if (gitWords.length) phrase('git', gitWords.join(' and '));
  const read = [...activity.readPaths];
  if (read.length) phrase('reads', `read ${plural(read.length, 'file')}${readPlace(read)}`, `read ${plural(read.length, 'file')}`);
  // Scripts are named (one or two) only when every one of them is run from inside the working tree.
  const scripts = [...new Set(commands.flatMap((c) => c.facts.scripts))];
  if (scripts.length) phrase('scripts', scripts.length > 2 || !scripts.every((script) => inWorkingTree(script.replace(/^npx /, '')))
    ? `ran ${plural(scripts.length, 'script')}` : `ran ${scripts.map((script) => clipPath(script, STORY_LIMITS.titleDirChars)).join(' and ')}`);
  if (activity.spawns) phrase('helpers', `spawned ${plural(activity.spawns, 'helper')}`);
  if (commands.some((c) => c.facts.install)) phrase('install', 'installed packages');
  if (fallback && !files.length && phrases.every((p) => p.key === 'edit') && commands.length)
    phrase('commands', `ran ${plural(commands.length, commands.every((c) => c.facts.readOnly) ? 'read-only command' : 'command')}`);
  return phrases;
}

/** D80: "1 command stopped before it finished", "2 commands stopped before they finished". */
export const stoppedPhrase = (n) => `${plural(n, 'command')} `
  + `${n === 1 ? STORY_SENTENCES.stopped : STORY_SENTENCES.stoppedMany}`;

/** A step's title: "Edited 3 files in src/middleware · 2 commands failed · committed". */
function stepTitle(step) {
  const title = titlePhrases(step).join(' · ');
  return title ? title[0].toUpperCase() + title.slice(1) : STORY_SENTENCES.noActions;
}

// ---- snippet ------------------------------------------------------------------------------------------

export function hunksOf(ops, context = 2) {
  const hunks = [];
  ops.forEach((op, i) => {
    if (op[0] === ' ') return;
    const last = hunks[hunks.length - 1];
    if (last && i - last.end <= 2 * context) last.end = i;
    else hunks.push({ start: i, end: i });
  });
  return hunks.map((h) => ops.slice(Math.max(0, h.start - context), Math.min(ops.length, h.end + context + 1)));
}

/**
 * The step's one snippet (owner-approved rule): the change a finding or decision of the step cites —
 * findings first (DECIDE before FYI), then decisions made without asking, then the others; each by its
 * receipts' and actions' events — else the largest change in the step. Only a change with an edit script
 * that changes a line can be shown; when a cited change has none, the next one is tried, and in the end
 * the largest change that has one.
 */
function stepSnippet(step) {
  const showable = step.changes.filter((c) => c.ops);
  if (!showable.length) return null;
  const cited = [];
  const cite = (eventId, quote = null) => { if (typeof eventId === 'string') cited.push({ eventId, quote }); };
  for (const { f } of step.findings)
    for (const r of list(f.receipts)) if (plainObject(r) && ['code', 'action'].includes(r.role))
      cite(r.eventId, r.role === 'code' ? r.quote : null);
  const byAuthority = [...step.decisions.filter((x) => x.unasked), ...step.decisions.filter((x) => !x.unasked)];
  for (const { d } of byAuthority) {
    if (d.valueReceipt?.role === 'code') cite(d.valueReceipt.eventId, d.valueReceipt.quote);
    for (const id of list(d.actions)) cite(id);
  }
  const size = (c) => c.counts.added + c.counts.removed;
  const bySize = (changes) => [...changes].sort((a, b) => size(b) - size(a));
  for (const { eventId, quote } of cited) {
    const candidates = showable.filter((c) => c.event.id === eventId);
    const quoted = typeof quote === 'string' && quote.trim()
      ? candidates.find((c) => c.afterText.includes(quote) || c.beforeText.includes(quote)) : null;
    for (const change of quoted ? [quoted, ...bySize(candidates.filter((c) => c !== quoted))] : bySize(candidates)) {
      const snippet = snippetOf(change, change === quoted ? quote : null);
      if (snippet) return snippet;
    }
  }
  for (const change of bySize(showable)) {
    const snippet = snippetOf(change, null);
    if (snippet) return snippet;
  }
  return null;
}

function snippetOf(change, quote) {
  const hunks = hunksOf(change.ops);
  if (!hunks.length) return null;
  const needle = typeof quote === 'string' ? quote.split('\n').map((l) => l.trim()).find(Boolean) : null;
  const found = needle ? hunks.findIndex((h) => h.some(([, line]) => line.includes(needle))) : -1;
  const at = found === -1 ? 0 : found;
  const hunk = hunks[at];
  // The diff marker is one of the line's characters: the line is at most `snippetLineChars` in all.
  const shown = hunk.slice(0, STORY_LIMITS.snippetLines).map(([t, line]) =>
    `${t}${clip(visible(line.replace(/\r/g, '␍')).replace(/\t/g, '  '), STORY_LIMITS.snippetLineChars - 1)}`);
  return { change, path: change.path, counts: change.counts, lines: shown, total: hunk.length, hunk: at + 1, hunks: hunks.length };
}

function fencedDiff(lines) {
  const run = Math.max(2, ...lines.flatMap((line) => [...line.matchAll(/`+/g)].map((m) => m[0].length)));
  const fence = '`'.repeat(run + 1);
  return [`${fence}diff`, ...lines, fence];
}

// ---- the charts ---------------------------------------------------------------------------------------
// Every chart is a `flowchart TD` whose main chain runs down one side: requests and their steps in the overview, a
// request's one step in its step chart. Side nodes (findings, changes of approach, decisions, helpers) hang one rank
// below the chain node they belong to. A helper node also joins the chain again at the NEXT chain node: that back
// edge is the only edge that does not go from a node to the rank below it, and it never passes the next node (a step
// chart has no next node, so its helper node has no back edge). Chain nodes are declared
// first and chain edges come first, so a layered layout (GitHub's Mermaid) keeps the chain one straight line and puts
// the side nodes beside it, never in a lane of their own.

/** Explicit light fills with dark text, so every class reads on GitHub's light and dark themes alike. */
const CLASS_DEFS = Object.freeze([
  ['ask', 'fill:#eef2ff,stroke:#4338ca,color:#111827'],
  ['step', 'fill:#f9fafb,stroke:#6b7280,color:#111827'],
  ['quiet', 'fill:#f3f4f6,stroke:#9ca3af,color:#374151,stroke-dasharray:3 3'],
  ['finding', 'fill:#fee2e2,stroke:#b91c1c,color:#111827,stroke-width:2px'],
  ['unasked', 'fill:#ffedd5,stroke:#c2410c,color:#111827'],
  ['settled', 'fill:#dcfce7,stroke:#15803d,color:#111827'],
  ['abandoned', 'fill:#f3f4f6,stroke:#6b7280,color:#374151,stroke-dasharray:4 3'],
  ['helper', 'fill:#dbeafe,stroke:#1d4ed8,color:#111827'],
]);

/** What a chart unit holds that a dashed edge must count when the hard stop leaves the unit out. */
const held = (findings = 0, contradicted = 0, pivots = 0, helpers = 0) => ({ findings, contradicted, pivots, helpers });

/** A request's node: a stadium, "You: …" or "You replied: …". */
const askUnit = (ask) => ({ id: `A${ask.k}`, priority: 0, steps: 0, asks: 1, held: held(), edges: [], helper: null,
  nodes: [{ id: `A${ask.k}`, shape: 'stadium', cls: 'ask', label: `${youWord(ask)}: ${ask.text}` }] });

/** A helper side node's label: how many helpers, their briefs (clipped), and the steps that hold their recorded
 *  results: "3 helpers: Write tests / Update the README / … · merged at step 12". Where a result was merged is said
 *  here, never drawn: an edge to it could cross the whole chart. */
function helpersLabel(helpers) {
  const merged = [...new Set(helpers.map((h) => h.resultStep).filter((s) => s !== null))].sort((a, b) => a - b).map((s) => s + 1);
  const tail = !merged.length ? '' : merged.length === 1 ? ` · merged at step ${merged[0]}`
    : merged.length === 2 ? ` · merged at steps ${merged[0]} and ${merged[1]}` : ` · merged at steps ${merged[0]}–${merged[merged.length - 1]}`;
  const head = `${plural(helpers.length, 'helper')}: `;
  // M33 F: a helper that reported back is shown by what it reported, its brief shortened beside it.
  const shown = (h) => mermaidLabel(h.report
    ? `${clip(oneLine(h.brief || 'no brief recorded'), STORY_LIMITS.briefBesideReportChars)} — ${STORY_SENTENCES.helperReported} ${h.report}`
    : h.brief || 'no brief recorded');
  // M33 W: the agents of one Workflow call are one item, "workflow <name> (<agent> / <agent>)", where the first stood.
  const items = [];
  for (const h of helpers) {
    const group = h.run === undefined ? null : items.find((item) => item.run === h.run);
    if (group) group.shown.push(shown(h));
    else items.push({ run: h.run, name: h.runName, shown: [shown(h)] });
  }
  const briefs = items.map((item) => (item.run === undefined ? item.shown[0]
    : `${mermaidLabel(item.name)} (${item.shown.join(' / ')})`)).join(' / ');
  return `${head}${clip(briefs, Math.max(2, STORY_LIMITS.chartLabelChars - [...head].length - [...tail].length))}${tail}`;
}

/** A side node for the helpers a chain node's steps spawned, unless they are only counted: the unit's `helper`. */
function addHelperNode(unit, helpers) {
  if (!helpers.length) return;
  unit.helper = `H${unit.id.slice(1)}`;
  unit.nodes.push({ id: unit.helper, shape: 'subroutine', cls: 'helper', label: helpersLabel(helpers) });
  unit.edges.push(`${unit.id} -.-> ${unit.helper}`);
}

const LABEL_FORMS = Object.freeze(['text', 'short', 'tiny']);
/** A label part's `form`, or the next fuller form it has. */
const formOf = (part, form) => part[LABEL_FORMS.slice(0, LABEL_FORMS.indexOf(form) + 1).reverse().find((f) => part[f] != null)];
/** A label part with its shorter forms (LABEL_FORMS). */
const labelPart = (text, short = text, tiny = short) => ({ text, short, tiny });
/** Whether score `a` is lexicographically greater than score `b`. */
const better = (a, b) => { const i = a.findIndex((x, k) => x !== b[k]); return i !== -1 && a[i] > b[i]; };

/**
 * A chart label of parts joined with " · ", within `n` code points: the `head` parts (what the node is, its counts
 * of contradicted statements) and the `tail` parts (counts) are always kept — in their shorter forms when the full
 * ones leave no room for a whole phrase, and those never cut — and `phrases` fill the room between, whole ones in
 * their order while they fit, in the fullest forms that fit the most. A failed test run (`alarm`) is kept first:
 * when not all fit, it goes before the others. Only when not one phrase fits whole is the first one clipped. Each
 * part and phrase has a `text` form and may have `short` and `tiny` ones (LABEL_FORMS).
 */
function composeLabel(head, phrases, tail, { n = STORY_LIMITS.chartLabelChars, capital = false } = {}) {
  const width = (parts) => [...parts.join(' · ')].length;
  const alarms = phrases.filter((p) => p.alarm);
  const orders = [phrases, ...(alarms.length ? [[...alarms, ...phrases.filter((p) => !p.alarm)]] : [])];
  let best = null;
  LABEL_FORMS.forEach((frame, f) => {
    const ends = [head.map((p) => formOf(p, frame)), tail.map((p) => formOf(p, frame))];
    if (width([...ends[0], ...ends[1]]) > n) return;
    LABEL_FORMS.forEach((form, g) => orders.forEach((order) => {
      const picked = [];
      for (const phrase of order) {
        if (width([...ends[0], ...[...picked, phrase].map((p) => formOf(p, form)), ...ends[1]]) > n) break;
        picked.push(phrase);
      }
      // Every failed command kept; a whole phrase at all; the fullest head and tail; the most phrases; their fullest form.
      const score = [alarms.every((p) => picked.includes(p)) ? 1 : 0, picked.length ? 1 : 0, -f, picked.length, -g];
      if (!best || better(score, best.score)) best = { score, ends, form, picked: phrases.filter((p) => picked.includes(p)) };
    }));
  });
  if (!best) return [...head.map((p) => formOf(p, 'tiny')), ...tail.map((p) => formOf(p, 'tiny'))].join(' · ');
  const middle = best.picked.map((p) => formOf(p, best.form));
  const room = n - width([...best.ends[0], '', ...best.ends[1]]);
  if (!middle.length && phrases.length && room >= 8) middle.push(clip(formOf(orders[orders.length - 1][0], 'tiny'), room));
  if (capital && middle.length) middle[0] = middle[0][0].toUpperCase() + middle[0].slice(1);
  return [...best.ends[0], ...middle, ...best.ends[1]].join(' · ');
}

// ---- the overview: requests and their steps -----------------------------------------------------------------------

/** A step the overview draws dashed, as reading only: it changed no file (its own or a helper's), spawned no
 *  helper, and every command in it is its own (none a helper's), none failed (M1: never "a test run" by its name) and
 *  none commits, merges, rebases, cherry-picks or pushes. D80 (review of D80 N): nor was any stopped before it finished
 *  (`stopped`): it started, and what it changed before it stopped is not recorded. A refused one (`didNotRun`) never
 *  ran, so it leaves the step reading. */
function readingStep(step) {
  const own = step.commands.filter((c) => c.event.childId == null);
  return !step.files.length && !step.unconfirmed.length && !step.spawns && own.length === step.commands.length
    && !own.some((c) => c.failed || c.stopped)
    && !own.some((c) => c.facts.git.some((sub) => GIT_HEADLINE.includes(sub)));
}
const contradictedCount = (step) => step.written.filter(({ w }) => w.label === WRITTEN_CONTRADICTED).length;
/** A step that holds a finding, or a statement a recorded result contradicts: never drawn as reading. */
const pinnedStep = (step) => step.findings.length > 0 || contradictedCount(step) > 0;

/** The first overview collapse level at which each rule applies (`STORY_OVERVIEW_COLLAPSES`). */
const OVERVIEW_LEVEL = Object.freeze({ pivots: 1, helperCounts: 2 });

/** A finding side node's label: the finding itself, or how many (D71 (a): never a status). */
function findingsLabel(findings) {
  if (findings.length === 1) return `${STORY_FINDING_WORDS.one}: ${oneLine(findings[0].f.title ?? '')}`;
  return plural(findings.length, 'finding');
}

/**
 * The overview at one level, as units in chain order: each request, then its one step (D77 C; the step for the work
 * before your first request first). A step's node reads "Step 3 · edited 12 files in packages/slicer · 2 commands
 * failed": what it changed first. Beside it hang at most two side nodes, so no rank holds more than three: its
 * helpers (one node, joining the chain again at the next node), its changes of approach (one node with their count),
 * its findings (one node). When a step has findings and helpers both drawn, its changes of approach are counted on its
 * own label; from `pivots` and `helperCounts` they are counted there anyway. A step is drawn dashed only when all it
 * did was read: no finding, no contradicted statement, no file changed anywhere.
 */
function overviewUnits(facts, level) {
  const units = [];
  const countPivots = level >= OVERVIEW_LEVEL.pivots, countHelpers = level >= OVERVIEW_LEVEL.helperCounts;
  for (const step of facts.steps) {
    for (const ask of step.asksStarting) units.push(askUnit(ask));
    const id = `S${step.n}`;
    const { findings, helpers } = step;
    const pivots = step.pivots.length;
    const contradicted = contradictedCount(step);
    const helperNode = helpers.length > 0 && !countHelpers;
    const pivotNode = pivots > 0 && !countPivots && !(findings.length && helperNode);
    // Helpers are drawn beside the step or counted on it: "spawned N helpers" only when nothing else is said.
    const named = activityPhrases({ ...step, spawns: 0 });
    const spawnedOnly = !named.length && helpers.length > 0;
    const bare = spawnedOnly ? `spawned ${plural(helpers.length, 'helper')}` : STORY_SENTENCES.noActions.toLowerCase();
    const phrases = named.length ? named : [labelPart(bare)];
    // The counts are never cut: when the full words leave no room for a phrase, "12 contradicted", "3 approach
    // changes", and then the step number without the word "Step".
    const head = [labelPart(`Step ${step.n}`, undefined, `${step.n}`), ...(contradicted
      ? [labelPart(`${plural(contradicted, 'statement')} contradicted`, `${contradicted} contradicted`)] : [])];
    const pivotWords = labelPart(`${plural(pivots, 'change')} of approach`, plural(pivots, 'approach change'));
    const tail = [...(pivots && !pivotNode ? [pivotWords] : []),
      ...(helpers.length && !helperNode && !spawnedOnly ? [labelPart(plural(helpers.length, 'helper'))] : [])];
    const label = composeLabel(head, phrases, tail);
    const reading = !pinnedStep(step) && readingStep(step) && !step.outside;
    const unit = { id, steps: 1, asks: 0, held: held(findings.length, contradicted, pivots, helpers.length), edges: [],
      helper: null, priority: findings.some((x) => x.f.status === 'DECIDE') ? 1 : findings.length ? 2 : contradicted ? 3
        : pivots ? 4 : helpers.length ? 5 : step.files.length ? 6 : 7,
      nodes: [{ id, shape: 'rect', cls: reading ? 'quiet' : 'step', label }] };
    if (helperNode) addHelperNode(unit, helpers);
    const side = (node, arrow) => { unit.nodes.push(node); unit.edges.push(`${id} ${arrow} ${node.id}`); };
    if (pivotNode) side({ id: `P${step.n}`, shape: 'note', cls: 'abandoned', label: pivotWords.text }, '-.->');
    if (findings.length) side({ id: `F${step.n}`, shape: 'rect', label: findingsLabel(findings), cls: 'finding' },
      '---');
    units.push(unit);
  }
  for (const ask of facts.asks) if (ask.start === null) units.push(askUnit(ask));
  return { units };
}

// ---- a request's step chart ---------------------------------------------------------------------------------------

/** How much a step matters, for which request's step chart is left out first when they do not all fit
 *  (`stepCharts`): a step that needs your decision first, then findings, abandoned approaches, file changes, and a step
 *  whose only mark is a decision made without asking after the steps with file changes. */
const unitPriority = (step) => (step.findings.some((x) => x.f.status === 'DECIDE') ? 1 : step.findings.length ? 2
  : step.pivots.length ? 3 : step.files.length ? 4 : step.decisions.some((x) => x.unasked) ? 5 : 6);
/** The first step-chart collapse level at which each part of the chart changes (`STORY_CHART_COLLAPSES`). */
const LEVEL = Object.freeze({ settled: 1, decisions: 2, findings: 3, pivots: 4, helperCounts: 5 });

/**
 * A request's step chart at one collapse level: its one step (D77 C), with the nodes attached to it and its helper
 * node, as the one unit `assemble` draws.
 */
function stepChartUnits(step, level) {
  // From `helperCounts`, the helpers the step spawned are counted on its node, not drawn beside it.
  const counting = level >= LEVEL.helperCounts;
  const { helpers } = step;
  const id = `S${step.n}`;
  // The title gives way, whole phrases first, a failed test run last of them; never the step number or the counts
  // after it.
  const counted = level >= LEVEL.pivots && step.pivots.length;
  const tail = [...(step.files.length ? [labelPart(`files ${lineWord(step.counts)}`)] : []),
    ...(counted ? [labelPart(`${plural(step.pivots.length, 'approach', 'approaches')} abandoned`)] : []),
    ...(counting && helpers.length ? [labelPart(plural(helpers.length, 'helper'))] : [])];
  const phrases = activityPhrases(step).slice(0, 3);
  const label = composeLabel([labelPart(`${step.n}`)],
    phrases.length ? phrases : [labelPart(STORY_SENTENCES.noActions)], tail, { capital: true });
  const unit = { id, edges: [], helper: null, nodes: [{ id, shape: 'rect', cls: 'step', label }] };
  if (!counting) addHelperNode(unit, helpers);
  const attach = (node, arrow = '---') => { unit.nodes.push(node); unit.edges.push(`${id} ${arrow} ${node.id}`); };
  const findings = step.findings;
  if (level >= LEVEL.findings && findings.length > 1) {
    attach({ id: `F${step.n}_all`, shape: 'rect', cls: 'finding', label: plural(findings.length, 'finding') });
  } else findings.forEach((x, m) => attach({ id: `F${step.n}_${m + 1}`, shape: 'rect', cls: 'finding',
    label: `${STORY_FINDING_WORDS.one}: ${oneLine(x.f.title ?? '')}` }));
  // A step's decisions made without asking, its settled decisions and its abandoned approaches are one
  // node each, with a count when there are several.
  const unasked = step.decisions.filter((x) => x.unasked);
  if (level < LEVEL.decisions && unasked.length) attach({ id: `U${step.n}`, shape: 'hexagon', cls: 'unasked',
    label: unasked.length > 1 ? `${unasked.length} decisions made without asking`
      : `${STORY_CHART_UNASKED[unasked[0].who]}: ${oneLine(unasked[0].d.dimension ?? '')}: `
        + `${oneLine(unasked[0].d.chosen ?? '')}` });
  const settled = step.decisions.filter((x) => x.who === DECISION_COLUMNS[0]);
  if (level < LEVEL.settled && settled.length) attach({ id: `K${step.n}`, shape: 'rhombus', cls: 'settled',
    n: STORY_LIMITS.settledChars, label: settled.length > 1 ? `You settled ${settled.length} decisions`
      : `You settled: ${oneLine(settled[0].d.dimension ?? '')}` });
  if (!counted && step.pivots.length) attach({ id: `P${step.n}`, shape: 'note', cls: 'abandoned',
    label: step.pivots.length > 1 ? `${step.pivots.length} approaches abandoned`
      : `Abandoned: ${oneLine(step.pivots[0].p.abandoned)}` }, '-.->');
  return { units: [unit] };
}

// ---- drawing a chart ------------------------------------------------------------------------------------------------

/** What the hard stop left out between two kept units, as a dashed edge (or an end node) says it: the steps and
 *  requests, and the findings, contradicted statements, changes of approach and helpers they held, so none of them
 *  is ever left out without a count. The counts are never cut: when the full words do not fit, shorter ones. */
function gapLabel(left, n = STORY_LIMITS.chartLabelChars) {
  const parts = (short) => [left.steps ? plural(left.steps, 'step') : null, left.asks ? plural(left.asks, 'request') : null,
    left.findings ? plural(left.findings, 'finding') : null,
    left.contradicted ? (short ? `${left.contradicted} contradicted` : plural(left.contradicted, 'contradicted statement')) : null,
    left.pivots ? (short ? plural(left.pivots, 'approach change') : `${plural(left.pivots, 'change')} of approach`) : null,
    left.helpers ? plural(left.helpers, 'helper') : null].filter(Boolean);
  const text = (short) => `${parts(short).join(', ')} not charted`;
  return mermaidLabel([...text(false)].length <= n ? text(false) : text(true), n);
}
/** `left` with a unit the hard stop leaves out added to it. */
function leaving(left, unit) {
  const into = left ?? { steps: 0, asks: 0, ...held() };
  into.steps += unit.steps;
  into.asks += unit.asks;
  for (const key of Object.keys(unit.held)) into[key] += unit.held[key];
  return into;
}

/**
 * A chart's nodes and edges from its units: every unit, or only those in `keep` (`left`: how many units were left
 * out). Units left out are counted, with what they held, on a dashed edge between the kept units around them (or on a
 * node before the first or after the last). Chain nodes are declared first, then side nodes; chain edges first, then
 * side edges, then each helper's one edge back into the next chain node drawn after the unit that spawned it.
 */
function assemble({ units }, keep = null) {
  const chain = [], sides = [], chainEdges = [], sideEdges = [], backEdges = [];
  let previous = null, helper = null, left = null, dropped = 0;
  // The chain edge into the next chain node, and the back edge of the helper beside the node before it.
  const join = (edge, id) => {
    if (previous === null) return;
    chainEdges.push(edge);
    if (helper !== null) backEdges.push(`${helper} -.-> ${id}`);
  };
  for (const unit of units) {
    if (keep && !keep.has(unit)) { left = leaving(left, unit); dropped++; continue; }
    const gap = left ? gapLabel(left) : null;
    if (previous === null && gap) {
      chain.push({ id: 'EARLIER', shape: 'rect', cls: 'quiet', label: gap });
      chainEdges.push(`EARLIER -.-> ${unit.id}`);
    } else join(gap ? `${previous} -.->|${gap}| ${unit.id}` : `${previous} --> ${unit.id}`, unit.id);
    left = null;
    const [head, ...rest] = unit.nodes;
    chain.push(head);
    sides.push(...rest);
    sideEdges.push(...unit.edges);
    previous = unit.id;
    helper = unit.helper;
  }
  if (left) {
    chain.push({ id: 'MORE', shape: 'rect', cls: 'quiet', label: `… ${gapLabel(left, STORY_LIMITS.chartLabelChars - 2)}` });
    join(`${previous} -.-> MORE`, 'MORE');
  }
  return { nodes: [...chain, ...sides], edges: [...chainEdges, ...sideEdges, ...backEdges], left: dropped };
}

/** The overview's hard stop: keep units by priority (requests, then DECIDE, FYI, contradicted, pivot, helper,
 *  file-changing steps), each whole, in chain order, within `room` nodes — two of them kept for the gap nodes. */
function cappedPlan(chart, room) {
  const byPriority = chart.units.map((unit, i) => ({ unit, i })).sort((a, b) => a.unit.priority - b.unit.priority || a.i - b.i);
  const keep = new Set();
  let used = 0;
  for (const { unit } of byPriority) if (used + unit.nodes.length <= room - 2) { keep.add(unit); used += unit.nodes.length; }
  return assemble(chart, keep);
}
/** The room the hard stop needs to keep every request and every unit with a finding or a contradicted statement
 *  (priority 3 or less), and the two gap nodes. */
const pinnedRoom = (chart) => chart.units.filter((unit) => unit.priority <= 3).reduce((n, unit) => n + unit.nodes.length, 0) + 2;

function nodeLine(node) {
  const label = mermaidLabel(node.label, node.n ?? STORY_LIMITS.chartLabelChars);
  switch (node.shape) {
    case 'stadium': return `${node.id}(["${label}"])`;
    case 'hexagon': return `${node.id}{{"${label}"}}`;
    case 'rhombus': return `${node.id}{"${label}"}`;
    case 'note': return `${node.id}>"${label}"]`;
    case 'subroutine': return `${node.id}[["${label}"]]`;
    default: return `${node.id}["${label}"]`;
  }
}

/** A plan as one Mermaid block: nodes, edges, then the classes its nodes use. */
function mermaidLines(plan) {
  const lines = ['```mermaid', 'flowchart TD'];
  for (const node of plan.nodes) lines.push(`  ${nodeLine(node)}`);
  for (const edge of plan.edges) lines.push(`  ${edge}`);
  const byClass = new Map();
  for (const node of plan.nodes) byClass.set(node.cls, [...(byClass.get(node.cls) ?? []), node.id]);
  for (const [cls, def] of CLASS_DEFS) if (byClass.has(cls)) lines.push(`  classDef ${cls} ${def}`);
  for (const [cls, ids] of byClass) lines.push(`  class ${ids.join(',')} ${cls}`);
  lines.push('```');
  return lines;
}

/**
 * The overview ("What happened") as a plan and the simplifications that made it, `{ plan, reasons }`, for the first
 * of these whose lines fit (`fits(plan, reasons)`): the first collapse level up to `helperCounts` with at most
 * `overviewNodes` nodes; the hard stop over that last level, as long as it keeps every request and every step with a
 * finding or a contradicted statement (with more than `overviewNodes` nodes when it must, never more than
 * `overviewMaxNodes`, fewer while it can); else the hard stop over it with fewer nodes until it fits. `reasons` names
 * each level that took nodes away, and the hard stop only when it left something out.
 */
function overviewChoice(facts, fits) {
  const target = STORY_LIMITS.overviewNodes, ceiling = STORY_LIMITS.overviewMaxNodes;
  const hard = STORY_OVERVIEW_COLLAPSES[STORY_OVERVIEW_COLLAPSES.length - 1];
  const reasons = [];
  let previous = Infinity;
  const at = (level) => {
    const chart = overviewUnits(facts, level);
    const plan = assemble(chart);
    if (plan.nodes.length < previous && level) reasons.push(STORY_OVERVIEW_COLLAPSES[level]);
    previous = plan.nodes.length;
    return { chart, plan, done: plan.nodes.length <= target && fits(plan, reasons) };
  };
  const hardStop = (chart, from, to) => {
    for (let room = from; room >= to; room--) {
      const plan = cappedPlan(chart, room);
      const why = plan.left ? [...reasons, hard] : [...reasons];
      if (fits(plan, why)) return { plan, reasons: why };
    }
    return null;
  };
  let level = null;
  for (let k = 0; k <= OVERVIEW_LEVEL.helperCounts; k++) {
    level = at(k);
    if (level.done) return { plan: level.plan, reasons: [...reasons] };
  }
  const need = pinnedRoom(level.chart);
  const kept = need <= ceiling ? hardStop(level.chart, Math.max(target, need), need) : null;
  if (kept) return kept;
  return hardStop(level.chart, Math.min(ceiling, Math.max(target, need)), 3)
    ?? { plan: cappedPlan(level.chart, 3), reasons: [...reasons, hard] };
}

/**
 * The overview section's lines: the chart, the sentence that says what a box under a request is and where each
 * request's step is charted (`allCharted`: every step's request shows its step chart), and how the chart was simplified
 * when it was.
 */
function overviewLines(facts, { plan, reasons }, allCharted) {
  const over = plan.nodes.length > STORY_LIMITS.overviewNodes;
  const legend = `${reasons.length ? STORY_SENTENCES.phaseLegendSimplified : STORY_SENTENCES.phaseLegend} ${allCharted
    ? STORY_SENTENCES.stepChartsAll : STORY_SENTENCES.stepChartsSome}`;
  return ['## What happened', '', ...(plan.nodes.length ? mermaidLines(plan) : [STORY_SENTENCES.noChart]),
    ...(facts.steps.length ? ['', legend] : []),
    ...(reasons.length ? ['', `${over ? STORY_SENTENCES.overviewPast : STORY_SENTENCES.overviewSimplified} ${reasons.join('; ')}.`]
      : over ? ['', STORY_SENTENCES.overviewOver] : [])];
}

/**
 * The ways a request's step chart (its one step) can be drawn, most detailed first: each collapse level with at most
 * `stepChartNodes` nodes, as a closed details block that says how it was simplified (each level that took nodes away).
 * The last level has at most two nodes, so there is always one.
 */
function stepChartOptions(step) {
  const block = (plan, reasons) => ['<details>',
    `<summary>${STORY_SENTENCES.stepChartSummary} (step ${step.n})</summary>`, '', ...mermaidLines(plan),
    ...(reasons.length ? ['', `${STORY_SENTENCES.chartSimplified} ${reasons.join('; ')}.`] : []), '', '</details>', ''];
  const reasons = [], levels = [];
  for (let level = 0, previous = Infinity; level < STORY_CHART_COLLAPSES.length; level++) {
    const plan = assemble(stepChartUnits(step, level));
    if (plan.nodes.length < previous && level) reasons.push(STORY_CHART_COLLAPSES[level]);
    previous = plan.nodes.length;
    if (plan.nodes.length <= STORY_LIMITS.stepChartNodes) levels.push(block(plan, [...reasons]));
  }
  return levels;
}

/** The most detailed way to draw a step chart within `budget` bytes: the first level that fits; null when none does. */
function stepChartWithin(levels, budget) {
  for (const lines of levels) if (bytes(lines) <= budget) return lines;
  return null;
}

/**
 * Every request's step chart, within `budget` bytes in all: `{ byAsk, leftOut }`, `byAsk` keyed by the number of the
 * request that owns the step. Each chart is first given its least detailed level (its floor). When the floors do not
 * all fit, charts are left out one at a time, and counted: first those of the requests whose step matters least
 * (`unitPriority`: a step that needs your decision is kept longest), among them the largest floor, then the later
 * request. So a request with a finding keeps its chart first, and as many others as can keep theirs. What is left is
 * shared evenly towards each chart's most detailed level, a chart that needs less than its share leaving the rest to
 * the others.
 */
function stepCharts(facts, budget) {
  const owned = facts.steps.filter((step) => step.asksStarting.length);
  const options = owned.map((step) => stepChartOptions(step));
  const wants = options.map((levels) => bytes(levels[0]));
  const floors = options.map((levels) => Math.min(...levels.map(bytes)));
  const notable = owned.map(unitPriority);
  const shown = owned.map((_, i) => i);
  let spare = Math.max(0, budget);
  while (shown.length && shown.reduce((n, i) => n + floors[i], 0) > spare) {
    const first = shown.reduce((a, b) => (notable[b] - notable[a] || floors[b] - floors[a] || b - a) > 0 ? b : a);
    shown.splice(shown.indexOf(first), 1);
  }
  const given = owned.map(() => 0);
  for (const i of shown) { given[i] = floors[i]; spare -= floors[i]; }
  shown.map((i) => ({ i, more: wants[i] - floors[i] })).sort((a, b) => a.more - b.more || a.i - b.i).forEach(({ i, more }, k, all) => {
    const extra = Math.min(more, Math.floor(spare / (all.length - k)));
    given[i] += extra;
    spare -= extra;
  });
  const byAsk = new Map();
  let leftOut = 0;
  owned.forEach((step, i) => {
    const lines = shown.includes(i) ? stepChartWithin(options[i], given[i]) : null;
    if (lines) byAsk.set(step.asksStarting[step.asksStarting.length - 1].k, lines);
    else leftOut++;
  });
  return { byAsk, leftOut };
}

// ---- sections -----------------------------------------------------------------------------------------

/** Who speaks in an ask's heading and chart node: "You", or "You replied" for a human answer a harness wrapped. */
export const youWord = (ask) => (ask.reply ? 'You replied' : 'You');
const askHeading = (ask) => `### ${youWord(ask)}: ${md(clip(ask.text, STORY_LIMITS.askChars))}`;
/** /15 (D79): the files you attached to a request, each one line under its message, as its words are shown; those
 *  attached before any message of yours (`facts.unattached`) the same way, before your requests. */
/** Gain I (2026-10-13): what a message carried beside its words (its event's `nonText`, by the recorder's block type):
 *  `{ pasted: { images, others } }`, or nothing when it carried none. */
const pastedOf = (event) => {
  const blocks = Array.isArray(event?.nonText) ? event.nonText : [];
  const images = blocks.filter((block) => block?.type === 'image').length;
  return blocks.length ? { pasted: { images, others: blocks.length - images } } : {};
};
const attachmentLines = (attachments) => attachments.flatMap((a) =>
  [`**${STORY_SENTENCES.youAttached}:** ${md(clip(a.text, STORY_LIMITS.askChars))}`, '']);
/** Gain I (2026-10-13): under a message you pasted an image (or other nontext content) into, one line saying so by
 *  count (`pastedOf`); the image itself is never shown. Then its attached files, as before. */
const askExtras = (ask) => [...(ask.pasted ? [`_${STORY_SENTENCES.pasted(ask.pasted)}_`, ''] : []),
  ...attachmentLines(ask.attachments)];

/** A step reference: a link while the engineer section shows that step, plain text once it was cut. */
const stepRef = (n, linked) => (n === null ? 'no step' : linked(n) ? `[step ${n}](#step-${n})` : `step ${n}`);
const more = (n, what) => `_…and ${plural(n, what)} not shown._`;
/** Step numbers as runs: "step 1 to step 3, step 5", at most `stepRuns` runs. */
function stepRuns(ns, linked) {
  const runs = [];
  for (const n of ns) {
    const last = runs[runs.length - 1];
    if (last && n === last[1] + 1) last[1] = n; else runs.push([n, n]);
  }
  const shown = runs.slice(0, STORY_LIMITS.stepRuns)
    .map(([a, b]) => (a === b ? stepRef(a, linked) : `${stepRef(a, linked)} to ${stepRef(b, linked)}`));
  const rest = runs.slice(STORY_LIMITS.stepRuns).reduce((n, [a, b]) => n + b - a + 1, 0);
  return `${shown.join(', ')}${rest ? `, and ${plural(rest, 'more step')}` : ''}`;
}

/**
 * `header`, then whole items while they fit in `budget` bytes (header included) and number at most `cap`;
 * `rest(n)` states the n left out. Every item goes in when all of them fit (and `cap` allows); otherwise room
 * for the longest `rest` line is kept free, so header, items and closing line together never pass the budget.
 * `{ lines, placed }`: `placed` is how many items went in.
 */
function pack(header, items, budget, cap, rest) {
  const out = [...header];
  let used = bytes(out);
  const limit = Math.min(items.length, cap);
  const sizes = items.slice(0, limit).map(bytes);
  let placed = 0;
  if (limit === items.length && used + sizes.reduce((n, size) => n + size, 0) <= budget) placed = limit;
  else {
    const reserve = bytes(rest(items.length));
    while (placed < limit && used + sizes[placed] + reserve <= budget) used += sizes[placed++];
  }
  for (const item of items.slice(0, placed)) out.push(...item);
  if (placed < items.length) out.push(...rest(items.length - placed));
  return { lines: out, placed };
}
const packed = (header, items, budget, cap, rest) => pack(header, items, budget, cap, rest).lines;

/** `lines`, then a closed <details> block holding `items` packed like `pack`, the block's lines counted
 *  in `budget`; `lines` alone when there are no items. `{ lines, placed }`. */
function detailsPack(lines, summary, items, budget, cap, rest) {
  if (!items.length) return { lines, placed: 0 };
  const open = [...lines, '<details>', `<summary>${summary}</summary>`, ''], close = ['', '</details>'];
  const inner = pack(open, items, budget - bytes(close), cap, rest);
  return { lines: [...inner.lines, ...close], placed: inner.placed };
}
const detailsBlock = (lines, summary, items, budget, cap, rest) => detailsPack(lines, summary, items, budget, cap, rest).lines;

/** A finding's receipts that ground in THIS session, at most two, in the fixed role order. M33 N: a forbidden edit's are
 *  what you said and what the agent wrote or ran, in that order. (M33 brittleness M4 session route: the agent's
 *  statement is no receipt of it; an upheld disclosure is shown apart, `disclosedEdit`.) */
export function shownReceipts(session, finding) {
  const grounds = (r) => plainObject(r) && typeof r.quote === 'string' && Object.hasOwn(STORY_RECEIPT_LABELS, r.role)
    && verifyReceipt(session, r).ok;
  const grounded = list(finding.receipts).filter(grounds);
  // W1 B: the rule is your instruction or the project's instruction file the agent was given.
  if (forbiddenEdit(finding)) return ['instruction', 'project-instructions', 'code', 'action']
    .flatMap((role) => grounded.filter((r) => r.role === role)).slice(0, 2);
  return RECEIPT_ORDER.flatMap((role) => grounded.filter((r) => r.role === role)).slice(0, 2);
}

function quoteLines(label, quote) {
  const lines = clip(visible(quote), STORY_LIMITS.quoteChars).split('\n')
    .map((line) => md(line).replace(/^[ \t]+/, (space) => ' '.repeat(space.length)));
  return [`> **${label}:** ${lines[0]}`, ...lines.slice(1).map((line) => (line ? `> ${line}` : '>'))];
}

// ---- D87: the code pass ---------------------------------------------------------------------------------------------

/** A code receipt's place: its path (clipped) and its line or lines. */
const codeAt = (r) => `${clipPath(oneLine(r.path))}:${r.startLine === r.endLine ? r.startLine : `${r.startLine}–${r.endLine}`}`;
/** The quote of a code receipt as a reader may show it, or null: found literally in the span the report stored with it,
 *  that span's file one the pass read with the same sha256 (the file now, or for side `old` the file at the start
 *  commit), and left whole by the output masking. Pure. */
export function codeQuoteOf(report, r) {
  if (!plainObject(r) || typeof r.quote !== 'string' || !r.quote || typeof r.span !== 'string' || !r.span.includes(r.quote)
      || typeof r.path !== 'string' || !Number.isSafeInteger(r.startLine) || !Number.isSafeInteger(r.endLine)) return null;
  const file = list(report?.codePass?.files).find((f) => plainObject(f) && f.path === r.path);
  const sha = r.side === 'old' ? file?.baseSha256 : file?.sha256;
  if (!file || typeof sha !== 'string' || sha !== r.sha256) return null;
  return clip(r.quote, Number.MAX_SAFE_INTEGER) === r.quote ? r.quote : null;
}
/** The quote of a session step of a trace as a reader may show it, or null: found again in the recording, in the event
 *  and role it names (session.js `verifyReceipt`). */
export function sessionQuoteOf(session, r) {
  if (!plainObject(r) || typeof r.quote !== 'string' || !r.quote || typeof r.eventId !== 'string') return null;
  try { return verifyReceipt(session, { eventId: r.eventId, role: r.role, quote: r.quote }).ok ? r.quote : null; }
  catch { return null; }
}
/** D87: a checked row's code check, after its status in a list — fixed words, never "verified"; nothing for a row the
 *  pass did not check. */
function codeCheckWords(row) {
  const check = plainObject(row) ? row.codeCheck : null;
  if (!plainObject(check) || !CODE_CHECK_OUTCOMES.includes(check.outcome)) return '';
  const [first] = list(check.receipts);
  const where = check.outcome !== CODE_CHECK_OUTCOMES[2] && plainObject(first) && typeof first.path === 'string'
    && Number.isSafeInteger(first.startLine) && Number.isSafeInteger(first.endLine) ? ` (${codeSpan(codeAt(first))})` : '';
  const why = check.outcome === CODE_CHECK_OUTCOMES[2] && Object.hasOwn(STORY_CODE_WORDS.reasons, check.reason)
    ? `: ${md(STORY_CODE_WORDS.reasons[check.reason])}` : '';
  return ` — ${md(STORY_CODE_WORDS.label.toLowerCase())}: ${md(STORY_CODE_WORDS.outcomes[check.outcome])}${where}${why}`;
}
/** The review's words for a row the code pass names (its kind, then its words; never a quote). */
function codeRowWords(report, ref) {
  const row = plainObject(ref) && Number.isSafeInteger(ref.index) ? list(report?.[ref.source])[ref.index] : null;
  const kind = plainObject(ref) ? STORY_CODE_WORDS.rowKinds[ref.source] ?? null : null;
  if (!plainObject(row) || kind === null) return null;
  const text = ref.source === 'decisions' ? row.dimension : ref.source === 'requirements' ? row.text
    : ref.source === 'findings' ? row.title : ref.source === 'pivots' ? row.adopted
      : ref.source === 'failures' ? null : row.text;
  return `${md(kind[0].toUpperCase() + kind.slice(1))}${typeof text === 'string' && text.trim()
    ? `: ${md(clip(oneLine(text), STORY_LIMITS.textChars))}` : ''}`;
}
/** The order the rows a code finding may follow from are listed in: the checklist's. */
const CODE_ROW_ORDER = Object.freeze(['requirements', 'promises', 'writtenClaims', 'findings', 'decisions', 'pivots',
  'failures']);
const refsOf = (f) => [].concat(f?.leadsFrom ?? []).filter((ref) => plainObject(ref) && typeof ref.source === 'string'
  && Number.isSafeInteger(ref.index));
/**
 * What the code review found, in the order the reader is shown it: `beside` — each row of the session review
 * that a finding follows from or that the check found contradicted by the code, in the checklist's order, with its
 * findings (a finding sits beside the first row it follows from); `rest` — the other findings, in table-of-contents order
 * (by path, then line); `questions` — the open questions for the person. Pure: the page and the story share it.
 */
export function codeSectionPlan(report) {
  const rows = new Map();
  const at = (source, index) => {
    const key = `${source}:${index}`;
    if (!rows.has(key)) rows.set(key, { source, index, findings: [] });
    return rows.get(key);
  };
  for (const { source, row } of codeContradictedRows(report)) at(source, list(report[source]).indexOf(row));
  const rest = [];
  for (const f of codePassFindings(report)) {
    const [ref] = refsOf(f);
    if (ref && plainObject(list(report?.[ref.source])[ref.index])) at(ref.source, ref.index).findings.push(f);
    else rest.push(f);
  }
  const place = (f) => [plainObject(f.anchor) && typeof f.anchor.path === 'string' ? f.anchor.path : '\uffff',
    Number.isSafeInteger(f.anchor?.startLine) ? f.anchor.startLine : 0];
  rest.sort((a, b) => { const [pa, la] = place(a), [pb, lb] = place(b); return pa < pb ? -1 : pa > pb ? 1 : la - lb; });
  const beside = [...rows.values()].sort((a, b) => CODE_ROW_ORDER.indexOf(a.source) - CODE_ROW_ORDER.indexOf(b.source)
    || a.index - b.index);
  return { beside, rest, questions: codePassQuestions(report) };
}
/** The code review's coverage footer as reader lines (after PR-Agent's): what was not shown whole, what was
 *  too large, what was withheld (counted by state, never by path), which calls did not answer, and how many paths
 *  outside the working directory differ (counted, never named). Fixed words, paths of files the review read, and
 *  counts. */
export function codeFooterLines(report) {
  const footer = plainObject(report?.codePass?.footer) ? report.codePass.footer : {};
  const W = STORY_CODE_WORDS.footerLines;
  const [LISTED, CLIPPED, WITHHELD, FAILED] = CODE_FOOTER_KINDS;
  const paths = (key) => list(footer[key]).filter((p) => typeof p === 'string').map((p) => clipPath(oneLine(p)));
  const lines = [];
  if (paths(LISTED).length) lines.push(W[LISTED](paths(LISTED)));
  if (paths(CLIPPED).length) lines.push(W[CLIPPED](paths(CLIPPED)));
  const states = CODE_FILE_STATES.map((state) => [STORY_CODE_WORDS.states[state] ?? state,
    list(footer[WITHHELD]).filter((w) => plainObject(w) && w.state === state).length]).filter(([, n]) => n > 0);
  if (states.length) lines.push(W[WITHHELD](states));
  const parts = list(footer[FAILED]).filter((x) => plainObject(x) && CODE_STEP_PARTS.includes(x.step)).map((x) =>
    (x.step === CODE_STEP_PARTS[1] && Object.hasOwn(STORY_CODE_WORDS.lenses, x.lens)
      ? `${STORY_CODE_WORDS.parts[x.step]} ${STORY_CODE_WORDS.lenses[x.lens]}${Number.isSafeInteger(x.group)
        ? ` (part ${x.group})` : ''}` : STORY_CODE_WORDS.parts[x.step]));
  if (parts.length) lines.push(W[FAILED]([...new Set(parts)]));
  const outside = report?.codePass?.base?.outside;
  if (Number.isSafeInteger(outside) && outside > 0) lines.push(STORY_CODE_WORDS.outsideLine(outside));
  const base = report?.codePass?.base;
  if (base?.homeRepository === true)
    lines.push(STORY_CODE_WORDS.homeLine(Number.isSafeInteger(base.unrecorded) && base.unrecorded > 0 ? base.unrecorded : 0));
  return lines;
}
/** The release review (owner, 2026-10-14): the code review's coverage lines, the same on the page and in the story —
 *  what it showed (`files`), or that it did not run (no working directory here) or had no file to read; then, when it
 *  ran short of complete, that it did not read every file it showed or did not complete. Fixed words and counts. */
export function codeCoverageLines(pass) {
  const W = STORY_CODE_WORDS;
  const files = list(pass?.files).filter(plainObject);
  if (pass?.ran !== true) return [W.noRoot];
  if (!files.length) return [W.noFile];
  const shown = files.filter((f) => f.state === CODE_FILE_STATES[0]).length;
  const others = CODE_FILE_STATES.slice(1).map((state) => [state, files.filter((f) => f.state === state).length])
    .filter(([, n]) => n > 0).map(([state, n]) => `${n} ${W.states[state]}`).join(', ');
  return [W.files(shown, files.length, others), ...(Object.hasOwn(W.coverage, pass.coverage) ? [W.coverage[pass.coverage]]
    : [])];
}
/** A finding's kind and the lenses that reached it, in fixed words. */
const kindWords = (f) => STORY_CODE_WORDS.kinds[f?.kind] ?? null;
const lensWords = (f) => list(f?.foundByLenses).filter((l) => Object.hasOwn(STORY_CODE_WORDS.lenses, l))
  .map((l) => STORY_CODE_WORDS.lenses[l]);
/**
 * D87, reworked as the code step: what the code review found, after the edits against what
 * you said and before What Sonah could not check (D88's order) — only for a review that ran a code pass. How it
 * worked, where the change starts and which files it showed (counted by closed state); then, in order
 * (`codeSectionPlan`): the rows of the session review a finding follows from or the check found contradicted, each with
 * its code check and its findings beside it; the other findings in table-of-contents order; the open questions for you;
 * and what the code review did not cover (`codeFooterLines`). A finding: its kind, its place, its title and explanation
 * (the review's words), the input it names, the steps of its trace with their quotes (checked: `codeQuoteOf`,
 * `sessionQuoteOf`) and the lenses that reached it. No status, rank or severity.
 */
function codeSection(report, budget, session = null) {
  const pass = plainObject(report?.codePass) ? report.codePass : null;
  if (!pass) return [];
  const W = STORY_CODE_WORDS;
  const commit = typeof pass.base?.commit === 'string' ? pass.base.commit.slice(0, 12) : null;
  const heading = [`## ${md(W.heading)}`, '', `_${md(W.how)}_`, '',
    ...(pass.base ? [md(W.base(commit)), ''] : []),
    ...codeCoverageLines(pass).flatMap((line) => [md(line), ''])];
  const quoted = (r) => {
    if (r?.source === 'session') {
      const quote = session ? sessionQuoteOf(session, r) : null;
      return quote === null ? [`_${md(W.quoteUnchecked)}_`] : quoteLines(W.sessionSaid, quote);
    }
    const quote = codeQuoteOf(report, r);
    return quote === null ? [`${codeSpan(codeAt(r))} — _${md(W.quoteUnchecked)}_`]
      : quoteLines(`${r.side === 'old' ? W.codeBefore : W.codeNow} ${codeAt(r)}`, quote);
  };
  const finding = (f) => {
    const anchor = plainObject(f.anchor) && typeof f.anchor.path === 'string' ? f.anchor : null;
    const kind = kindWords(f);
    const lenses = lensWords(f);
    const steps = list(f.trace).filter(plainObject);
    return [`**${md(W.finding)}**${kind ? ` (${md(kind)})` : ''}${anchor ? ` · ${codeSpan(codeAt(anchor))}` : ''} — `
      + `${md(clip(oneLine(f.title), STORY_LIMITS.textChars))}`,
    '', `${STORY_SENTENCES.reviewWords} ${md(clip(oneLine(f.explanation), STORY_LIMITS.textChars * 4))}`,
    ...(typeof f.input === 'string' && f.input.trim() ? ['', `${md(W.input)}: ${codeSpan(clip(oneLine(f.input),
      STORY_LIMITS.textChars))}`] : []),
    ...(steps.length ? ['', `${md(W.trace)}:`, ...steps.flatMap((t, i) => ['', `${i + 1}. ${md(clip(oneLine(t.step ?? ''),
      STORY_LIMITS.textChars))}`, '', ...quoted(t)])]
      : list(f.receipts).slice(0, 2).flatMap((r) => ['', ...quoted(r)])),
    ...(lenses.length ? ['', `${md(W.foundBy)}: ${md(lenses.join(', '))}`] : []), ''];
  };
  const { beside, rest, questions } = codeSectionPlan(report);
  const besideItems = beside.map(({ source, index, findings }) => {
    const row = list(report[source])[index];
    const named = codeRowWords(report, { source, index });
    const [first] = list(row?.codeCheck?.receipts);
    return [`- ${named ?? ''}${codeCheckWords(row)}`,
      ...(row?.codeCheck?.outcome === CODE_CHECK_OUTCOMES[1] && plainObject(first) ? ['', ...quoted(first)] : []), '',
      ...findings.flatMap(finding)];
  });
  const questionItems = questions.map((q) => {
    const named = q.concerns ? codeRowWords(report, q.concerns) : null;
    const quote = session ? sessionQuoteOf(session, q.quote) : null;
    return [`- ${md(clip(oneLine(q.question), STORY_LIMITS.textChars * 2))}`,
      ...(named ? ['', `${md(W.concerns)}: ${named}`] : []), ...(quote ? ['', ...quoteLines(W.sessionSaid, quote)] : []), ''];
  });
  const footer = codeFooterLines(report);
  const items = [
    ...(besideItems.length ? [[`**${md(W.besideGroup)}**`, ''], ...besideItems] : []),
    ...(rest.length ? [[`**${md(W.restGroup)}**`, ''], ...rest.map(finding)] : []),
    ...(!rest.length && !beside.some((b) => b.findings.length) ? [[`_${md(W.noFindings)}_`, '']] : []),
    ...(questionItems.length ? [[`**${md(W.questionsGroup)}**`, ''], ...questionItems] : []),
    [`**${md(W.footerGroup)}**`, '', ...(footer.length ? footer.map((line) => `- ${md(line)}`) : [md(W.footerNone)]), ''],
  ];
  return packed(heading, items, budget, STORY_LIMITS.findings, (n) => [more(n, 'entry'), '']);
}

/**
 * The findings (D71 (a), owner decision 2026-10-08: never under a status's heading — before D71, "Needs your decision"
 * for DECIDE, then "Worth a look" for FYI). Each says what it is and, beside it, its recorded facts: a helper's own
 * statement, an edit undone in the same turn, an edit the agent told you about. The order is the story facts'
 * (`storyFacts`); no word in it is a status. D88: the contradicted claims are listed under what the agent told you
 * (`toldSection`), every other finding under the edits against what you said (`editsSection`), as the page lists them;
 * `findings` is the ones this section lists, under `header`, within `budget`.
 */
function findingItems(findings, linked) {
  return findings.map(({ f, step, receipts }) => {
    const lines = [`**${STORY_FINDING_WORDS.one}** · ${stepRef(step === null ? null : step + 1, linked)} — `
      + `${md(clip(oneLine(f.title ?? ''), STORY_LIMITS.textChars))}`];
    // M33 H: a helper's own contradicted statement says so in plain words, and its words are labelled the helper's.
    const helper = helperInternal(f);
    if (helper) lines.push('', `_${STORY_SENTENCES.helperInternal}_`);
    if (claimCorrected(f)) lines.push('', `_${STORY_SENTENCES.claimCorrected}_`);
    // M33 N: a forbidden edit says so in plain words, and shows what you said beside what the agent wrote or ran.
    const forbidden = forbiddenEdit(f);
    if (forbidden) lines.push('', `_${f.status === 'FYI' && f.disclosureReason === DISCLOSURE_REASONS[0]
      ? STORY_SENTENCES.forbiddenEditReverted : STORY_SENTENCES.forbiddenEdit}_`);
    // M33 brittleness M4: an edit the agent disclosed (its statement upheld as its own proposition) says so, with it —
    // on either route (owner decision 2026-10-06), a session-only forbidden edit's included.
    const disclosed = disclosedEdit(f);
    if (disclosed) lines.push('', `_${STORY_SENTENCES.editDisclosed}_`);
    if (!receipts.length) lines.push(STORY_SENTENCES.quotesMissing);
    const label = (r) => (forbidden ? forbiddenEditLabel(f, r)
      : helper && r.role === 'commentary' ? STORY_HELPER_STATEMENT_LABEL
        : contradictionLabel(f, r) ?? STORY_RECEIPT_LABELS[r.role]);
    receipts.forEach((r, i) => {
      if (i) lines.push('>');
      lines.push(...quoteLines(label(r), r.quote));
    });
    if (disclosed) lines.push(...(receipts.length ? ['>'] : []), ...quoteLines(STORY_FORBIDDEN_EDIT_LABELS.reported, disclosed.quote));
    // D87: a contradicted claim the code pass checked says what the code at review time shows of it.
    const code = codeCheckWords(f);
    if (code) lines.push('', `_${code.slice(3)}_`);
    return [...lines, ''];
  });
}
const CLAIM_CONTRADICTED_KIND = 'claim_contradicted';

/** D88: a claim as a line: the review's words for it, its status in words, its step, the result it was confirmed
 *  through, and its code check. */
const claimLine = ({ p, step, confirmedBy }, linked) => [`- ${md(clip(oneLine(p.text), STORY_LIMITS.textChars))} `
  + `(${promiseWords(p.status)}; ${stepRef(step === null ? null : step + 1, linked)})${confirmedWords(confirmedBy)}`
  + codeCheckWords(p)];
/** D88: a statement written into a file as a line: its words for what it is, the review's words, its step, its code
 *  check. */
const writtenLine = ({ w, step }, linked) => [`- ${writtenWords(w)}: ${md(clip(oneLine(w.text), STORY_LIMITS.textChars))} `
  + `(${stepRef(step === null ? null : step + 1, linked)})${codeCheckWords(w)}`];
/** D88: the line a section says where it holds rows Sonah could not check. */
const foldedHere = (n, one, many) => (n ? [`_${FOLDED_SECTION_WORDS.here(n, one, many)}_`, ''] : []);

/**
 * D88 (owner decision 2026-10-14): what the agent told you, as the page lists it — the contradicted claims, each its
 * finding with what contradicts it, then the claims confirmed by a recorded result, folded, each with the result's words;
 * the claims not checked, or resting on a check that never completed, are listed under What Sonah could not check
 * (`foldedSection`), and this section says how many.
 */
function toldSection(facts, budget, linked) {
  const findings = facts.findings.filter(({ f }) => f.kind === CLAIM_CONTRADICTED_KIND);
  const confirmed = facts.promises.filter(({ p }) => claimRowKind(p) === null);
  const folded = facts.promises.length - confirmed.length;
  let out = [`## ${STORY_CHECKLIST_HEADINGS.claims}`, ''];
  if (!findings.length && !facts.promises.length) return [...out, STORY_SENTENCES.noClaims, ''];
  out = pack(out, findingItems(findings, linked), Math.floor(budget / 2), STORY_LIMITS.findings,
    (n) => [more(n, 'finding'), '']).lines;
  if (confirmed.length) {
    out.push(`**${STORY_PROMISE_WORDS.verified[0].toUpperCase()}${STORY_PROMISE_WORDS.verified.slice(1)}: ${confirmed.length}**`, '');
    const close = ['', '</details>', ''];
    out = [...packed([...out, '<details>', `<summary>${STORY_SENTENCES.confirmedSummary}</summary>`, ''],
      confirmed.map((entry) => claimLine(entry, linked)), budget - bytes(close) - bytes(foldedHere(folded, 'claim')),
      STORY_LIMITS.promises, (n) => [`- ${more(n, 'claim')}`]), ...close];
  }
  return [...out, ...foldedHere(folded, 'claim')];
}

/**
 * D88 (owner decision 2026-10-14): the edits against what you said, as the page lists them — each finding that is not a
 * contradicted claim, then the statements the agent wrote into files that a recorded result (or what it wrote before)
 * contradicts; the statements not checked are listed under What Sonah could not check (`foldedSection`), and this
 * section says how many.
 */
function editsSection(facts, budget, linked) {
  const findings = facts.findings.filter(({ f }) => f.kind !== CLAIM_CONTRADICTED_KIND);
  const contradicted = facts.written.filter(({ w }) => writtenRowKind(w) === 'writtenContradicted');
  const folded = facts.written.filter(({ w }) => writtenRowKind(w) === 'writtenOpen').length;
  const out = [`## ${STORY_CHECKLIST_HEADINGS.edits}`, ''];
  if (!findings.length && !facts.written.length) return [...out, STORY_SENTENCES.noEdits, ''];
  const tail = foldedHere(folded, 'statement');
  const items = [...findingItems(findings, linked), ...contradicted.map((entry) => [...writtenLine(entry, linked), ''])];
  return [...packed(out, items, budget - bytes(tail), STORY_LIMITS.findings, (n) => [more(n, 'entry'), '']), ...tail];
}

/** D88: one failure row as a line (review.js `failureRowKind`, its handling in the PR comment's words): what the agent
 *  did about it, the command it ran (or the tool it called) and its step, what came back in plain words (the RESULT's
 *  typed outcome, read again from the recording), why it is not checked, and the end of its turn or the words it cites,
 *  as a quote only when it grounds in this session. */
function failureLines(session, { row, step }, linked) {
  const handling = Object.hasOwn(CHECKLIST_FAILURE_WORDS, row.handling) ? row.handling : FAILURE_HANDLINGS[3];
  const action = typeof row.action === 'string' ? session.event(row.action) : null;
  const command = action?.operation === 'command' ? failedCommandText(session.textSpansOf(action, 'command').join(' ')) : undefined;
  const tool = typeof action?.tool === 'string' && action.tool ? action.tool : typeof row.tool === 'string' && row.tool ? row.tool : null;
  const what = command === null ? STORY_SENTENCES.failedNotNamed : command !== undefined ? codeSpan(command)
    : tool !== null ? codeSpan(tool) : STORY_SENTENCES.actionNotHeld;
  const result = session.event(row.eventId);
  const outcome = result ? resultOutcome(session, result) : { class: row.outcome, form: row.form ?? null };
  const said = Object.hasOwn(CHECKLIST_OUTCOME_WORDS, outcome?.class)
    ? ` ${CHECKLIST_OUTCOME_WORDS[outcome.class](result?.exitCode ?? null, outcome.form ?? null)}` : '';
  const words = CHECKLIST_FAILURE_WORDS[handling];
  const why = handling === FAILURE_HANDLINGS[3] && Object.hasOwn(CHECKLIST_FAILURE_REASON_WORDS, row.reason)
    ? ` Why it is not checked: ${CHECKLIST_FAILURE_REASON_WORDS[row.reason]}.` : '';
  const lines = [`- ${failureRowKind(row) === 'passedOver' ? `**${words}**` : words} — ${what} `
    + `(${stepRef(step === null ? null : step + 1, linked)}):${said}${why}${codeCheckWords(row)}`];
  const response = handling !== FAILURE_HANDLINGS[3] && plainObject(row.response) && typeof row.response.quote === 'string'
    && Object.hasOwn(STORY_RECEIPT_LABELS, row.response.role) && verifyReceipt(session, row.response).ok ? row.response : null;
  if (response) lines.push('', ...quoteLines(handling === FAILURE_HANDLINGS[2] ? STORY_SENTENCES.turnEnded
    : STORY_RECEIPT_LABELS[response.role], response.quote));
  return [...lines, ''];
}

/**
 * D88 (owner decision 2026-10-14): the failures it passed over, as the page lists them — a checklist report's every
 * RESULT that failed, did not run or recorded no end: the ones it passed over first, in bold, with the end of its turn;
 * folded, the ones it acted on or told you about; the ones not checked are listed under What Sonah could not check
 * (`foldedSection`), and this section says how many. A report from before the checklist has no section.
 */
function failuresSection(session, facts, budget, linked) {
  if (facts.failures === null) return [];
  const out = [`## ${STORY_CHECKLIST_HEADINGS.failures}`, ''];
  if (!facts.failures.length) return [...out, FAILURE_SECTION_WORDS.none, ''];
  out.push(FAILURE_SECTION_WORDS.intro, '');
  const passed = facts.failures.filter(({ row }) => failureRowKind(row) === 'passedOver');
  const handled = facts.failures.filter(({ row }) => failureRowKind(row) === null);
  const folded = facts.failures.length - passed.length - handled.length;
  const tail = foldedHere(folded, 'failure');
  const rest = (n) => [more(n, 'failure'), ''];
  const shown = pack(out, passed.map((entry) => failureLines(session, entry, linked)), Math.floor(budget / 2),
    STORY_LIMITS.findings, rest).lines;
  const close = ['', '</details>', ''];
  const lines = handled.length ? [...packed([...shown, '<details>', `<summary>${STORY_SENTENCES.handledSummary(handled.length)}</summary>`, ''],
    handled.map((entry) => failureLines(session, entry, linked)), budget - bytes(close) - bytes(tail), STORY_LIMITS.findings, rest),
  ...close] : shown;
  return [...lines, ...tail];
}

/**
 * D88 (owner decision 2026-10-14): What Sonah could not check (N) — under its own heading, after every other section of
 * the checklist, every row of review.js FOLDED_ROWS the story holds, in that order, in one folded `<details>` block: the
 * asks not checked (your words, the request and steps, why), the claims not checked against a recorded result, the
 * claims resting on a check that never completed, the failures not checked (why), the statements written into files
 * and not checked. N counts them all; none is counted anywhere else. Nothing when there is none.
 */
function foldedSection(session, facts, budget, linked) {
  const asks = facts.asks.flatMap((ask) => ask.requirements.filter((r) => askRowKind(r) === 'asksNotChecked')
    .map((r) => ({ ask, r })));
  const open = facts.promises.filter(({ p }) => claimRowKind(p) === 'claimsOpen');
  const incomplete = facts.promises.filter(({ p }) => claimRowKind(p) === 'claimsIncomplete');
  const failures = (facts.failures ?? []).filter(({ row }) => failureRowKind(row) === 'failuresNotChecked');
  const written = facts.written.filter(({ w }) => writtenRowKind(w) === 'writtenOpen');
  const n = asks.length + open.length + incomplete.length + failures.length + written.length;
  if (!n) return [];
  const W = FOLDED_SECTION_WORDS.groups;
  // Each group's heading stands after a blank line, so no list above reads it as its own.
  const group = (kind, rows, line) => (rows.length ? [['', `**${W[kind]} (${rows.length})**`, ''], ...rows.map(line)] : []);
  const askLine = ({ ask, r }) => {
    const why = Object.hasOwn(CHECKLIST_REQUIREMENT_REASON_WORDS, r.checked?.reason)
      ? ` — why not checked: ${md(CHECKLIST_REQUIREMENT_REASON_WORDS[r.checked.reason])}` : '';
    return [`- ${ask.reply ? 'You replied' : 'You asked'} (request ${ask.k}): ${requirementWords(r)}${requirementSteps(r)}${why}`
      + codeCheckWords(r.checked)];
  };
  const items = [...group('asksNotChecked', asks, askLine), ...group('claimsOpen', open, (entry) => claimLine(entry, linked)),
    ...group('claimsIncomplete', incomplete, (entry) => claimLine(entry, linked)),
    ...group('failuresNotChecked', failures, (entry) => failureLines(session, entry, linked)),
    ...group('writtenOpen', written, (entry) => writtenLine(entry, linked))];
  const header = [`## ${FOLDED_SECTION_WORDS.summary(n)}`, '', `_${FOLDED_SECTION_WORDS.lead}_`, ''];
  return [...detailsBlock(header, FOLDED_SECTION_WORDS.show(n), items, budget, STORY_LIMITS.foldedRows,
    (left) => [`- ${more(left, 'entry')}`]), ''];
}

/**
 * Each request with its distinct requirements. Every request (up to `asks`) keeps its heading, its visible
 * rows (`rowsPerAsk`; fewer only when the section could not otherwise hold every request) and the steps it
 * was worked on. What is left of the section's share is then split evenly among the requests that have more
 * rows — one that needs less than its share leaves the rest to the others — and each fills a details block
 * with as many as fit, counting the rest; with no room for one, the rest are only counted. A request is
 * dropped (and counted) only when not even its heading and counts fit. A requirement says the steps where the
 * review worked on it, when the report's windows show them; one that reads as the same human words as another of its
 * request also says which it is, in the review's words.
 */
function productSection(facts, budget, linked) {
  // /15 (D79): a file you attached before any message of yours belongs to no request; it is shown first.
  const header = ['## <a name="for-product"></a>For product: your requests', '', ...attachmentLines(facts.unattached)];
  if (!facts.asks.length) return [...header, STORY_SENTENCES.noAsks, ''];
  // A requirement located in the request reads as the human's own words, in quotation marks. When two of one request
  // read as the same words, each also says which it is, in the review's words.
  const words = requirementWords;
  const readAs = new Map();
  for (const ask of facts.asks) for (const r of ask.requirements) readAs.set(`${ask.k} ${words(r)}`, (readAs.get(`${ask.k} ${words(r)}`) ?? 0) + 1);
  const row = (ask) => (r) => `- ${STORY_REQUIREMENT_WORDS[r.status]}: ${words(r)}${r.quoted && readAs.get(`${ask.k} ${words(r)}`) > 1
    ? ` — ${STORY_SENTENCES.reviewWords} ${md(clip(oneLine(r.wording), STORY_LIMITS.textChars))}` : ''}${requirementSteps(r)}`
    + codeCheckWords(r.checked);
  const left = (n) => [`- ${more(n, 'requirement')}`];
  const asks = facts.asks.slice(0, STORY_LIMITS.asks);
  const dropped = facts.asks.length - asks.length;
  const closing = dropped ? [more(dropped, 'request'), ''] : [];
  const entry = (ask, visible) => {
    const asked = ask.reply ? 'You replied' : 'You asked';
    const head = [`**${ask.k}. ${asked}:** ${md(clip(ask.text, STORY_LIMITS.askChars))}`, '',
      ...askExtras(ask)];
    // D88: an ask Sonah could not check is listed under What Sonah could not check; the request says how many.
    const settled = ask.requirements.filter((r) => askRowKind(r) !== 'asksNotChecked');
    const tail = [...foldedHere(ask.requirements.length - settled.length, 'ask'),
      ask.steps.length ? `Worked on in ${stepRuns(ask.steps, linked)}.` : STORY_SENTENCES.askWithoutStep, ''];
    const rows = settled.length ? settled.slice(0, visible).map(row(ask))
      : ask.requirements.length ? [] : [STORY_SENTENCES.noRequirements];
    const rest = settled.slice(visible).map((r) => [row(ask)(r)]);
    const compact = [...head, ...rows, ...(rest.length ? left(rest.length) : []), '', ...tail];
    const within = (room) => {
      if (!rest.length) return compact;
      const folded = detailsPack([...head, ...rows, ''], `Show ${plural(rest.length, 'more requirement')}`, rest,
        room - bytes(['', ...tail]), STORY_LIMITS.requirementsPerAsk, left);
      return folded.placed ? [...folded.lines, '', ...tail] : compact;
    };
    return { compact, within, want: rest.length ? bytes(within(Infinity)) - bytes(compact) : 0 };
  };
  const room = budget - bytes(header) - bytes(closing);
  let visible = STORY_LIMITS.rowsPerAsk;
  let entries = asks.map((ask) => entry(ask, visible));
  const needed = () => entries.reduce((n, e) => n + bytes(e.compact), 0);
  while (visible > 0 && needed() > room) {
    visible--;
    entries = asks.map((ask) => entry(ask, visible));
  }
  if (needed() > room) {
    return packed(header, entries.map((e) => e.compact), budget, asks.length, (n) => [more(n + dropped, 'request'), '']);
  }
  let spare = room - needed();
  const given = entries.map((e) => bytes(e.compact));
  const wanting = entries.map((e, i) => ({ i, want: e.want })).filter((x) => x.want > 0)
    .sort((a, b) => a.want - b.want || a.i - b.i);
  wanting.forEach(({ i, want }, k) => {
    const share = Math.min(want, Math.floor(spare / (wanting.length - k)));
    given[i] += share;
    spare -= share;
  });
  return [...header, ...entries.flatMap((e, i) => e.within(given[i])), ...closing];
}

/** A requirement's words: located in the request, the human's own, in quotation marks; else the review's. */
const requirementWords = (r) => (r.quoted ? `"${md(clip(oneLine(r.text), STORY_LIMITS.askChars))}"`
  : md(clip(oneLine(r.text), STORY_LIMITS.textChars)));
/** A requirement's steps, when the report's windows show them. */
const requirementSteps = (r) => (r.steps ? ` (${r.steps[0] === r.steps[1] ? `step ${r.steps[0]}` : `steps ${r.steps[0]}–${r.steps[1]}`})` : '');

/** A decision's materiality as a reader reads it; '–' when the report gave none the story knows. */
const impactWord = (d) => (Object.hasOwn(STORY_MATERIALITY_WORDS, d.materiality) ? STORY_MATERIALITY_WORDS[d.materiality] : '–');

/**
 * The lead section. The table holds every decision the review is sure was made without asking you, in step
 * order, with its impact shown as a fact; every other decision is counted by who decided, and listed in a
 * details block. Changes of approach: `pivotsShown` visible, the rest in a details block. D88 (owner decision
 * 2026-10-14): it is the story's first section — the agent's judgment first — and the agent's claims, listed here before
 * D88, are listed under what the agent told you and What Sonah could not check.
 */
function leadSection(facts, budget, linked) {
  let out = ['## <a name="for-leads"></a>For leads: decisions and changes of approach', ''];
  const rows = [...facts.decisions].sort((a, b) => ((a.step ?? Infinity) - (b.step ?? Infinity)) || (a.i - b.i));
  const text = (d) => md(clip(`${oneLine(d.dimension ?? '')}: ${oneLine(d.chosen ?? '')}`, STORY_LIMITS.textChars))
    + notActingMark(d) + codeCheckWords(d);
  const half = () => bytes(out) + Math.floor(Math.max(0, budget - bytes(out)) / 2);
  if (!rows.length) out.push(STORY_SENTENCES.noDecisions, '');
  else {
    const lead = rows.filter((x) => x.lead);
    if (!lead.length) out.push(STORY_SENTENCES.noUnasked, '');
    else {
      const items = lead.map(({ d, step }) => {
        const cell = step === null ? '–' : linked(step + 1) ? `[${step + 1}](#step-${step + 1})` : String(step + 1);
        return [`| ${cell} | ${text(d)} | ${impactWord(d)} |`];
      });
      out = [...packed([...out, STORY_SENTENCES.unaskedIntro, '', '| Step | Decision | Impact |', '|---|---|---|'], items,
        bytes(out) + Math.floor(budget * 0.4), STORY_LIMITS.leadRows, (n) => ['', more(n, 'decision')]), ''];
    }
    // The other decisions, in the C-06 decision order (M33 brittleness H4): you asked and the agent chose how,
    // then you settled, then those the review could not check; each in step order.
    const groups = [DECISION_COLUMNS[1], DECISION_COLUMNS[0], 'unchecked'];
    const others = groups.flatMap((who) => rows.filter((x) => !x.lead && x.who === who));
    if (others.length) {
      const parts = groups.map((who) => [others.filter((x) => x.who === who).length, STORY_WHO_DECIDED[who]])
        .filter(([n]) => n > 0).map(([n, words]) => `${n} ${words}`);
      out.push(`**Other decisions: ${others.length}** — ${parts.join(' · ')}`, '');
      const items = others.map((x) =>
        [`- ${stepRef(x.step === null ? null : x.step + 1, linked)} · ${text(x.d)} — ${whoDecided(x)}`
          + ` · ${impactWord(x.d)}`]);
      out = [...detailsBlock(out, STORY_SENTENCES.otherDecisionsSummary, items, half(), STORY_LIMITS.decisionsListed,
        (n) => [`- ${more(n, 'decision')}`]), ''];
    }
    out.push(STORY_SENTENCES.materialityLegend, '');
  }
  out.push('**Changes of approach**', '');
  if (!facts.pivots.length) out.push(STORY_SENTENCES.noPivots);
  else {
    const items = facts.pivots.map(({ p, step }) =>
      [`- ${md(clip(oneLine(p.abandoned), 70))} → ${md(clip(oneLine(p.adopted), 70))} (${stepRef(step === null ? null : step + 1, linked)})`]);
    const shown = items.slice(0, STORY_LIMITS.pivotsShown), rest = items.slice(STORY_LIMITS.pivotsShown);
    const room = half();
    const left = (n) => [`- ${more(n, 'change')}`];
    // The visible ones keep room for the line that counts the rest: when no folded one fits, it is that line.
    const visible = pack(out, shown, room - (rest.length ? bytes(left(items.length)) : 0), STORY_LIMITS.pivotsShown,
      (n) => left(n + rest.length));
    if (visible.placed < shown.length) out = visible.lines;
    else if (!rest.length) out = [...visible.lines, ''];
    else {
      const folded = detailsPack([...visible.lines, ''], `Show ${plural(rest.length, 'more change')} of approach`, rest, room,
        STORY_LIMITS.pivots - STORY_LIMITS.pivotsShown, left);
      out = folded.placed ? folded.lines : [...visible.lines, ...left(rest.length)];
    }
  }
  // D88: the agent's claims are listed under what the agent told you (`toldSection`) and What Sonah could not check
  // (`foldedSection`), as the page lists them.
  return [...out, ''];
}

/** A notable step's block. `cut` (STORY_ENGINEER_CUTS) says which snippets it may show and, at the last
 *  level, whether it lists its files and test runs: only a step with a finding or a decision made without
 *  asking keeps them there. */
function stepBlock(step, cut) {
  const out = [`#### <a name="step-${step.n}"></a>Step ${step.n} — ${md(step.title)}`, ''];
  const open = step.findings.length || step.decisions.some((x) => x.unasked);
  const lists = cut < 3 || open;
  const line = [plural(step.commands.length, 'command'), `files ${lineWord(step.counts)}`, `helpers ${step.spawns}`];
  if (step.outside) line.push(`${plural(step.outside, 'file')} ${STORY_SENTENCES.outside}`);
  if (step.failure) line.push(STORY_SENTENCES.notReviewed);
  out.push(line.join(' · '));
  const text = (value) => md(clip(oneLine(value ?? ''), STORY_LIMITS.textChars));
  // Each bullet says one thing once. A bullet may fold its list into a details block, placed after the bullets;
  // a bullet that `keep`s is shown past the bullet cap.
  const bullets = [];
  const bullet = (line, { keep = false, details = null } = {}) => bullets.push({ line, keep, details });
  const folded = (summary, items, what) => ({ summary, items: [...items.slice(0, STORY_LIMITS.listedPerStep).map((item) => `- ${item}`),
    ...(items.length > STORY_LIMITS.listedPerStep ? [`- ${more(items.length - STORY_LIMITS.listedPerStep, what)}`] : [])] });
  for (const { f } of step.findings) bullet(`${STORY_BULLETS.finding}`
    + `${helperInternal(f) ? ` (${STORY_SENTENCES.helperInternalShort})` : claimCorrected(f)
      ? ` (${STORY_SENTENCES.claimCorrectedShort})` : ''}: ${text(f.title)}`);
  // The decisions whose column the ledger derived are listed; the others are counted for leads only.
  for (const x of step.decisions.filter((y) => y.who !== 'unchecked')) {
    const decided = clip(`${oneLine(x.d.dimension ?? '')}: ${oneLine(x.d.chosen ?? '')}`, STORY_LIMITS.textChars);
    bullet(`${STORY_BULLETS.decision}: ${md(decided)}${notActingMark(x.d)} — ${whoDecided(x)}`);
  }
  for (const { p } of step.pivots)
    bullet(`${STORY_BULLETS.pivot}: ${md(clip(oneLine(p.abandoned), 70))} → ${md(clip(oneLine(p.adopted), 70))}`);
  for (const { p, confirmedBy } of step.promises)
    bullet(`${STORY_BULLETS.promise} (${promiseWords(p.status)}): ${text(p.text)}${confirmedWords(confirmedBy)}`);
  // M33 F: each helper the step spawned that reported back: its brief, and what it reported (its first sentence).
  for (const helper of step.helpers.filter((h) => h.report !== null))
    bullet(`${STORY_BULLETS.helper}${helper.run === undefined ? '' : ` (${md(helper.runName)})`}: `
      + `${md(clip(oneLine(helper.brief || 'no brief recorded'), 70))} — ${STORY_SENTENCES.helperReported} ${md(helper.report)}`
      // M33 P: received here, launched under another request: that request is named.
      + (helper.request !== null && step.request !== null && helper.request !== step.request
        ? ` (${STORY_SENTENCES.helperForRequest(helper.request)})` : ''));
  // A statement a recorded result contradicts is its own line, kept past the bullet cap, up to `contradictedPerStep`
  // of them; the rest are one kept count, with the statements in a details block. The others are one line each while
  // there is one; past that, one count, with the statements in a details block.
  const [contradicted, unverified] = [WRITTEN_CONTRADICTED, WRITTEN_UNVERIFIED].map((label) => step.written.filter(({ w }) => w.label === label));
  for (const { w } of contradicted.slice(0, STORY_LIMITS.contradictedPerStep))
    bullet(`${writtenWords(w)}: ${text(w.text)}`, { keep: true });
  const beyond = contradicted.slice(STORY_LIMITS.contradictedPerStep);
  if (beyond.length) {
    // W2 (/21): by what contradicts them, when any is the agent's own earlier text.
    const by = beyond.some(({ w }) => w.contradictionSource === OWN_WRITTEN_SOURCE)
      ? 'recorded results or by what the agent wrote before them' : 'recorded results';
    bullet(`${plural(beyond.length, 'more statement')} written into files, contradicted by ${by}`, { keep: true,
      details: folded(STORY_SENTENCES.contradictedSummary, beyond.map(({ w }) => text(w.text)), 'more statement') });
  }
  if (unverified.length > 1) {
    bullet(`Wrote ${unverified.length} statements into files (not checked)`, { details: folded(STORY_SENTENCES.writtenSummary,
      unverified.map(({ w }) => text(w.text)), 'more statement') });
  } else for (const { w } of unverified) bullet(`${writtenWords(w)}: ${text(w.text)}`);
  // M1: every command the record says failed (its result, or a nonzero exit), named verbatim (one line, clipped): one
  // is named on its line; several are counted, with the commands in a details block. Kept past the bullet cap.
  const failedCommands = step.commands.filter((c) => c.failed);
  if (failedCommands.length && lists) {
    const line = (c) => `${c.shown === null ? STORY_SENTENCES.failedNotNamed : codeSpan(c.shown)}`
      + `${c.exitCode !== null && c.exitCode !== 0 ? ` (exit ${c.exitCode})` : ''}`;
    if (failedCommands.length === 1) bullet(`${STORY_BULLETS.failed}: ${line(failedCommands[0])}`, { keep: true });
    else {
      bullet(`${STORY_BULLETS.failed}: ${plural(failedCommands.length, 'command')}`,
        { keep: true, details: folded(STORY_SENTENCES.failedSummary, failedCommands.map(line), 'more failed command') });
    }
  }
  // /16 (D79): every command the recorder typed as refused before it ran, named verbatim the same way; kept past the
  // cap.
  const refusedCommands = step.commands.filter((c) => c.didNotRun);
  if (refusedCommands.length && lists) {
    const line = (c) => (c.shown === null ? STORY_SENTENCES.failedNotNamed : codeSpan(c.shown));
    if (refusedCommands.length === 1) bullet(`${STORY_BULLETS.didNotRun}: ${line(refusedCommands[0])}`, { keep: true });
    else {
      bullet(`${STORY_BULLETS.didNotRun}: ${plural(refusedCommands.length, 'command')}`,
        { keep: true, details: folded(STORY_SENTENCES.didNotRunSummary, refusedCommands.map(line), 'more command') });
    }
  }
  // D80: every command the recorder typed as stopped before it finished, named the same way; kept past the cap.
  const stoppedCommands = step.commands.filter((c) => c.stopped);
  if (stoppedCommands.length && lists) {
    const line = (c) => (c.shown === null ? STORY_SENTENCES.failedNotNamed : codeSpan(c.shown));
    if (stoppedCommands.length === 1) bullet(`${STORY_BULLETS.stopped}: ${line(stoppedCommands[0])}`, { keep: true });
    else {
      bullet(`${STORY_BULLETS.stopped}: ${plural(stoppedCommands.length, 'command')}`,
        { keep: true, details: folded(STORY_SENTENCES.stoppedSummary, stoppedCommands.map(line), 'more command') });
    }
  }
  // D80: every write of a failed or stopped command, by its path (one outside the repository is not named) and line
  // counts, with what its command's end leaves unrecorded; several are counted, folded. Kept past the cap.
  if (step.unconfirmed.length && lists) {
    const line = (row) => `${row.outside ? STORY_SENTENCES.writeNotNamed
      : `${codeSpan(clipPath(row.path))} ${lineWord(row.counts)}`} — `
      + STORY_SENTENCES.unconfirmedWrite(row.unconfirmed);
    const [first] = step.unconfirmed;
    if (step.unconfirmed.length === 1) bullet(`${STORY_BULLETS.unconfirmedWrite}: ${line(first)}`, { keep: true });
    else {
      bullet(`${STORY_BULLETS.unconfirmedWrite}: ${plural(step.unconfirmed.length, 'write')}`,
        { keep: true, details: folded(STORY_SENTENCES.unconfirmedSummary, step.unconfirmed.map(line), 'more write') });
    }
  }
  if (bullets.length) {
    const shown = bullets.filter((b, i) => i < STORY_LIMITS.bulletsPerStep || b.keep);
    out.push('');
    for (const b of shown) out.push(`- ${b.line}`);
    if (bullets.length > shown.length) out.push(`- ${more(bullets.length - shown.length, 'item')}`);
    for (const { details } of shown)
      if (details) out.push('', '<details>', `<summary>${details.summary}</summary>`, '', ...details.items, '', '</details>');
  }
  if (step.files.length && lists) {
    const shown = step.files.slice(0, STORY_LIMITS.filesPerStep)
      .map((file) => `${codeSpan(clipPath(file.path))} ${lineWord(file.counts)}${file.helper ? ' (helper)' : ''}`);
    const rest = step.files.length - shown.length;
    out.push('', `Files: ${shown.join(', ')}${rest > 0 ? `, and ${plural(rest, 'more file')}` : ''}`);
  }
  const snippet = cut === 0 || (cut === 1 && open) ? stepSnippet(step) : null;
  if (snippet) {
    const same = step.changes.filter((c) => c.path === snippet.path);
    const notes = [same.length > 1
      ? `change ${same.indexOf(snippet.change) + 1} of ${same.length} to this file, ${lineWord(snippet.counts)}` : lineWord(snippet.counts)];
    if (snippet.hunks > 1) notes.push(`hunk ${snippet.hunk} of ${snippet.hunks}`);
    if (snippet.total > snippet.lines.length) notes.push(`first ${snippet.lines.length} of ${snippet.total} lines`);
    out.push('', open ? '<details open>' : '<details>',
      `<summary>Snippet: <code>${html(clipPath(oneLine(snippet.path)))}</code> · ${notes.join(' · ')}</summary>`, '',
      ...fencedDiff(snippet.lines), '', '</details>');
  }
  out.push('');
  return out;
}

/** A quiet step (`quietStep`) as ONE line, with its anchor: "Step 7 · read 40 files in packages · 66 commands · no
 *  changes". */
function quietLine(step) {
  const parts = [`**Step ${step.n}**`, ...titlePhrases(step, { fallback: false, outside: false }).map(md),
    plural(step.commands.length, 'command'), step.outside
      ? `no changes in the repository · ${plural(step.outside, 'file')} ${STORY_SENTENCES.outside}` : 'no changes'];
  if (step.failure) parts.push(STORY_SENTENCES.notReviewed);
  return [`<a name="step-${step.n}"></a>${parts.join(' · ')}`, ''];
}

/** The line that counts the requests whose step chart did not fit. */
const chartsLeftOutLine = (n) => [`_To keep this file short, the step charts of ${plural(n, 'request')} are not shown._`, ''];

/** The engineer section within `budget` bytes, showing at most `maxSteps` steps, whole blocks only: each step in order,
 *  a quiet one as one line. `shown` is how many steps it showed; the steps after them are named in one closing
 *  sentence. */
function engineerSection(facts, { budget, maxBytes, maxSteps, blockOf, cut, chartsLeftOut }) {
  const out = ['## <a name="for-engineers"></a>For engineers: step by step', ''];
  const total = facts.steps.length;
  if (!total) out.push(STORY_SENTENCES.noSteps, '');
  if (cut) out.push(`_To keep this file short, ${STORY_ENGINEER_CUTS[cut]}._`, '');
  if (chartsLeftOut) out.push(...chartsLeftOutLine(chartsLeftOut));
  if (facts.steps.some((s) => [...s.changes, ...s.unconfirmed].some((c) => inexact(c.counts)))) {
    out.push(STORY_SENTENCES.countLegend, '');
  }
  const trailing = facts.asks.filter((ask) => ask.start === null);
  const stop = (from) => [`_Stopped here to keep this file under ${Math.floor(maxBytes / 1000)} KB: `
    + `${from === total ? `step ${from} is` : `steps ${from}–${total} are`} not shown._`, ''];
  const reserve = Math.max(bytes(stop(1)), bytes(stop(Math.max(1, total - 1))));
  let used = bytes(out), shown = 0;
  for (const step of facts.steps) {
    if (shown + 1 > maxSteps) break;
    const block = blockOf(step);
    const size = bytes(block);
    const last = shown + 1 === total && !trailing.length;
    if (used + size + (last ? 0 : reserve) > budget) break;
    out.push(...block);
    used += size;
    shown += 1;
  }
  if (shown < total) return { lines: [...out, ...stop(shown + 1)], shown };
  const items = trailing.map((ask) =>
    [askHeading(ask), '', ...askExtras(ask), STORY_SENTENCES.askWithoutStep, '']);
  return { lines: packed(out, items, budget, STORY_LIMITS.asks, (n) => [more(n, 'request'), '']), shown };
}

export function durationWord(events) {
  const times = events.map((event) => (typeof event.timestamp === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(event.timestamp)
    ? Date.parse(event.timestamp) : NaN)).filter(Number.isFinite);
  if (times.length < 2) return null;
  const minutes = Math.round((Math.max(...times) - Math.min(...times)) / 60_000);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** The requests cell: requests whose distinct requirements are all addressed, over the requests with
 *  any requirement; a request partly addressed (some requirement addressed or partly, not all addressed)
 *  is counted apart. Never raw report rows. */
function requestsCell(asks) {
  const tracked = asks.filter((ask) => ask.requirements.length);
  if (!tracked.length) return 'none recorded';
  const full = tracked.filter((ask) => ask.requirements.every((r) => MET_REQUIREMENT_STATUSES.includes(r.status))).length;
  const partly = tracked.filter((ask) => !ask.requirements.every((r) => MET_REQUIREMENT_STATUSES.includes(r.status))
    && ask.requirements.some((r) => !['open', 'not-done', 'not-checked'].includes(r.status))).length;
  return `${full} of ${plural(tracked.length, 'request')} fully addressed${partly ? ` · ${partly} partly addressed` : ''}`;
}

function headSection(facts, session, report, options) {
  const firstAsk = facts.asks.find((ask) => ask.text !== STORY_SENTENCES.withheldAsk);
  const titleText = typeof options.title === 'string' && oneLine(options.title) ? oneLine(options.title)
    : firstAsk ? firstAsk.text : 'Session story';
  const kind = STORY_RECORDING_KINDS[Object.hasOwn(STORY_RECORDING_KINDS, session?.adapter) && session.adapter !== 'other'
    ? session.adapter : 'other'];
  const { whole } = facts;
  const meta = [kind, durationWord(facts.events), plural(facts.asks.length, 'ask'), plural(facts.steps.length, 'step'),
    plural(facts.linkedHelpers, 'helper agent'), plural(whole.commands.length, 'command'),
    `${plural(whole.files.length, 'file')} changed (${lineWord(whole.counts)})`,
    whole.outside ? `${plural(whole.outside, 'file')} ${STORY_SENTENCES.outside}` : null,
    facts.encryptedBriefs ? STORY_ENCRYPTED_BRIEFS[session?.adapter === 'codex' ? 'codex' : 'other'](facts.encryptedBriefs)
      : null,
    facts.encryptedMessages.n ? STORY_ENCRYPTED_MESSAGES[session?.adapter === 'codex' ? 'codex' : 'other'](
      facts.encryptedMessages.n, facts.encryptedMessages.atLeast) : null].filter(Boolean).join(' · ');
  // D71 (a): whether Sonah's own session review completed, recomputed from the report's facts — never a status.
  let completed = false;
  try { completed = honestStatuses({ ...report, findings: list(report?.findings) }).sessionReview === 'complete'; }
  catch { completed = false; }
  const notReviewed = facts.steps.filter((s) => s.failure).length;
  const reviewCell = `${STORY_REVIEW_WORDS[completed ? 'complete' : 'incomplete']}${notReviewed ? ` · ${notReviewed} of ${plural(facts.steps.length, 'step')} not reviewed` : ''}`;
  return [
    `# ${md(clip(titleText, STORY_LIMITS.titleChars))}`, '', meta, '',
    ...(inexact(whole.counts) ? [STORY_SENTENCES.countLegend, ''] : []),
    '| Requests addressed | Findings | Decided without asking | Changes of approach | Review |',
    '|---|---|---|---|---|',
    `| ${requestsCell(facts.asks)} | ${facts.findings.length} | ${facts.decisions.filter((x) => x.lead).length} | ${facts.pivots.length} | ${reviewCell} |`,
    '',
    'Read as: [Product](#for-product) · [Lead](#for-leads) · [Engineer](#for-engineers)',
    '',
  ];
}

/**
 * The story of one session, as GitHub-flavoured Markdown. `session` is the redacted Session the adapter
 * built; `report` is the finished review report of that session. `options.title` names the story
 * (default: the first human ask); `options.maxBytes` lowers the document bound, to no less than
 * `STORY_LIMITS.minBytes`. Pure: the same inputs give the same bytes.
 *
 * The head sections each take at most their `STORY_SHARES` of the document's target (`targetBytes`, or the
 * bound when that is lower); "What happened" is the overview chart. The engineer section shows each quiet step as
 * one line and the others as blocks, at the most detail (`STORY_ENGINEER_CUTS`) that keeps the whole file within the
 * target, each request starting with its folded step chart. The step charts have what the
 * chart share leaves after the overview, or the room the engineer section leaves at its most detail, whichever is
 * more. When even the least detail does not fit, the engineer section has what is left of the bound, and when it had
 * to stop early, the sections above it are rendered again with plain step numbers, not links, for the steps it does
 * not show.
 */
export function renderSessionStory(recorded, report, options = {}) {
  // D84: rendered from the session as a person may read it (`asPeopleRead`), never the one the model read.
  // D87: with what the output rules hide in the files a code pass read (`options.codeSecrets`), given by the command.
  return asPeopleRead(recorded, (session) => storyOf(session, report, options), report,
    Array.isArray(options?.codeSecrets) ? options.codeSecrets : []);
}
function storyOf(session, report, options) {
  const facts = storyFacts(session, report);
  for (const row of facts.findings) row.receipts = shownReceipts(session, row.f);
  const bound = Number.isSafeInteger(options.maxBytes) && options.maxBytes > 0
    ? Math.min(STORY_LIMITS.maxBytes, Math.max(STORY_LIMITS.minBytes, options.maxBytes)) : STORY_LIMITS.maxBytes;
  const target = Math.min(STORY_LIMITS.targetBytes, bound);
  const share = (name) => Math.floor(target * STORY_SHARES[name]);
  const head = headSection(facts, session, report, options);
  // The overview is chosen, and every section after it placed, with the longer sentence about the step charts; the
  // shorter one replaces it at the end when every step's request shows its chart, so the file only gets shorter.
  const choice = overviewChoice(facts, (plan, reasons) => bytes(overviewLines(facts, { plan, reasons }, false)) <= share('chart'));
  let overview = overviewLines(facts, choice, false);
  const footer = ['---', '', STORY_SENTENCES.footer];
  const cache = new Map();
  // A step that starts requests carries their headings (D79: and the files attached to each), then the step chart of
  // the request that owns it. /15 (D79): the step of the work before your first request carries the files you attached
  // before any message.
  const blockOf = (cut, charts) => (step) => {
    const key = `${cut}:${step.index}`;
    if (!cache.has(key)) cache.set(key, quietStep(step) ? quietLine(step) : stepBlock(step, cut));
    const asks = step.asksStarting;
    return [...(step.request === null ? attachmentLines(facts.unattached) : []),
      ...asks.flatMap((ask) => [askHeading(ask), '', ...askExtras(ask)]),
      ...(asks.length ? charts.byAsk.get(asks[asks.length - 1].k) ?? [] : []),
      ...cache.get(key)];
  };
  // D88 (owner decision 2026-10-14): the page's order, led by the agent's judgment and the settled problems — the
  // decisions and changes of approach, your requests, the failures it passed over, what it told you, the edits against
  // what you said, what the code review found, and last, under its own heading, what Sonah could not check; then what
  // happened, and the engineer section.
  const compose = (linked) => [...head, ...leadSection(facts, share('lead'), linked),
    ...productSection(facts, share('product'), linked), ...failuresSection(session, facts, share('failures'), linked),
    ...toldSection(facts, share('decisions'), linked), ...editsSection(facts, share('decisions'), linked),
    ...codeSection(report, share('decisions'), session), ...foldedSection(session, facts, share('folded'), linked),
    ...overview, ''];
  const total = facts.steps.length;
  let before = compose(() => true);
  const engineerWithin = (limit, maxSteps, cut, charts) => engineerSection(facts,
    { budget: limit - bytes(before) - bytes(footer), maxBytes: limit, maxSteps, blockOf: blockOf(cut, charts), cut,
      chartsLeftOut: charts.leftOut });
  // The step charts have what the chart share leaves after the overview, or the room the engineer section leaves at
  // its most detail, whichever is more (less the line that counts the charts left out): so the engineer section never
  // has less room than beside one chart that used the whole share, and a chart never takes a snippet's place.
  const plain = engineerWithin(target, total, 0, { byAsk: new Map(), leftOut: 0 });
  const spare = plain.shown === total ? target - bytes(before) - bytes(footer) - bytes(plain.lines)
    - bytes(chartsLeftOutLine(facts.asks.length)) : 0;
  const charts = stepCharts(facts, Math.max(share('chart') - bytes([...overview, '']), spare));
  let engineer = null;
  for (let cut = 0; cut < STORY_ENGINEER_CUTS.length && engineer?.shown !== total; cut++) engineer = engineerWithin(target, total, cut, charts);
  if (engineer.shown < total) {
    const cut = STORY_ENGINEER_CUTS.length - 1;
    engineer = engineerWithin(bound, total, cut, charts);
    // Each round shows no more steps than the last, so this ends; in practice after one round.
    for (let limit = total; engineer.shown < limit;) {
      limit = engineer.shown;
      const shown = limit;
      before = compose((n) => n <= shown);
      engineer = engineerWithin(bound, shown, cut, charts);
    }
  }
  if (engineer.shown === total && !charts.leftOut && facts.steps.every((step) => step.asksStarting.length)) {
    overview = overviewLines(facts, choice, true);
    before = compose(() => true);
  }
  const text = [...before, ...engineer.lines, ...footer].join('\n').replace(/\n{3,}/g, '\n\n');
  return `${text}\n`;
}
