// The code step's report as every reader reads it — the session page and the story: the one word table
// (CODE_REPORT_WORDS; render/session-story.js STORY_CODE_WORDS and render/session-page.js PAGE_CODE_WORDS are this
// object), the one reading order (`codeSectionPlan`), the coverage and footer lines (`codeCoverageLines`,
// `codeFooterLines`) and whether a code quote may be shown (`codeReceiptFound`). Each reader escapes, clips and lays out
// what these give it; none decides anything of its own about the report.
//
// Pure: no disk, clock, network or model. Fixed words filled with counts, paths, line numbers and the report's own
// texts. Every choice here reads structure (which list a row is in, its index, a closed token, whether a quote is
// literally in the span stored with it), never a word of a finding, a statement or a question.
import { CODE_CHECK_OUTCOMES, CODE_FILE_STATES, CODE_WITHHELD_ITEMS, CODE_CLAIM_VERDICTS, CODE_SEEN_STATES,
  CODE_REVIEW_TERMINALS, CODE_ACCOUNT_ASK_SOURCES, CODE_ACCOUNT_FATES, CODE_NOT_REVIEWED_REASONS, honestStatuses }
  from './ledger.js';
import { codeContradictedRows, codePassFindings, codePassQuestions, codePassWithheld, codeSeenOf, codeChangeTally,
  sessionChangeOf, placesOf, foldersOf, unresolvedOf, repositoriesGiven, tieRuled } from './code-pass.js';
import { askSourceOf } from './code-context.js';

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const SHA256 = /^[0-9a-f]{64}$/;
const [CONTRADICTED_BY_CODE] = CODE_CHECK_OUTCOMES;
const [CLAIM_HOLDS] = CODE_CLAIM_VERDICTS;
const [WITHHELD_FINDING] = CODE_WITHHELD_ITEMS;
const [, SEEN_IN_PART, , NOT_SEEN, LINES_UNKNOWN] = CODE_SEEN_STATES;
const [REVIEW_ANSWERED, REVIEW_UNUSABLE, REVIEW_FAILED] = CODE_REVIEW_TERMINALS;
// Three CODE_FILE_STATES members, two CODE_FOOTER_KINDS members and a CODE_WITHHELD_REASONS member, named here by value:
// their index differs between versions of the lists (the word table's test pins that each is a member).
const OUTSIDE_ROOT = 'outside_root';
const DELETED = 'deleted';
const CHANGED_SINCE_SESSION = 'changed_since_session';
const LEFT_OUT_STATE = 'left_out';
const [SHOWN] = CODE_FILE_STATES;
const FOOTER_WITHHELD = 'withheld';
const UNACCOUNTED = 'unaccounted';
const VERIFY_REFUTED = 'verify_refuted';
const OUT_OF_SCOPE = 'out_of_scope';

/**
 * The code step's words, one table for every reader. What the code contradicts is said as what the code at review time
 * shows, never as verified: the code was read, never run. A finding's own texts (its title, its supporting claims, its
 * input, its steps), a question and a check's explanation are the review's words, and every reader labels them so; the
 * rest is these fixed words. No reader says the code bears a row out or that a statement holds, and none shows a
 * supporting claim its check found false.
 */
export const CODE_REPORT_WORDS = Object.freeze({
  heading: 'What the code review found', label: 'Code check',
  footer: 'The code review read the code as it is now, after the session. It ran nothing.',
  // A row's code check: only what the code contradicts (a row the step did not contradict carries none).
  outcomes: Object.freeze({ [CONTRADICTED_BY_CODE]: 'the code at review time contradicts it' }),
  // D109: true by how the step works in every case it can print: never "the change that the session made" (the change
  // runs from the start commit, `base`), never that each question was checked (`questionsChecked` says what the records
  // show). Its review: printed only where the record shows that the code review read what Sonah sent it (`codeHowLine`),
  // and never that it read the change (it can see the change in part: the coverage line says how much) or that Sonah
  // reviewed it (a code review that did not finish did not). D110 (the premise contract): no sentence says that a second
  // or independent reviewer checked a finding. One model reviews and checks (code-pass.js: one judge serves every
  // code-step request), and code computes the label (`howConfirm`). A finding published to verify was checked too: its
  // check found the same problem.
  how: 'Sonah asked for a review of the change as a code reviewer reviews a pull request. The code review read what '
    + 'Sonah sent it and ran nothing. It could open, search and list any file of the repository. Sonah publishes a '
    + 'finding only when the same model, with the same access, checked it and found the same problem. If the problem '
    + 'is real but not against your ask, the finding becomes an open question for you. Sonah folds the rest at the '
    + 'end, with the reason, and shows a quote only where code found it again.',
  // D152 (the check judges truth only): `how` for a report whose code step put its findings in lists by the tie rule
  // (code-pass.js `tieRuled`). The check judges only whether a problem is real. A checked finding (`howConfirm`, the next
  // paragraph: its premises can make it an item to verify instead) goes where its kind and the level the code review
  // proposed put it (D96, triage.js `boundTier`) when it is tied (`findingTied`): a row of the session review it follows
  // from (`leadsFrom`), or a receipt its check gave of what it breaks that code found word for word (`check.breaks`); an
  // untied one is open, with its own line (`openFinding`).
  howTied: 'Sonah asked for a review of the change as a code reviewer reviews a pull request. The code review read what '
    + 'Sonah sent, could open, search and list any file of the repository, and ran nothing. Sonah publishes a finding '
    + 'only when the same model, with the same access, checked it and found the problem real. A checked finding goes '
    + 'where its kind and the level the code review proposed put it, when something ties it. A tie is a session review '
    + 'item it follows from, or a quote of what it breaks that Sonah found. Sonah folds the rest at the end, with the '
    + 'reason, and shows a quote only where code found it again.',
  // D109: how many of the published open questions have a check record: each one, how many of them, or (its review)
  // none, when no question carries a check record (a batch check that failed), in the words the other case ends with.
  // D110: the same model checks them, never a second reviewer.
  questionsChecked: (checked, total) => (checked === total ? 'With the same access, the same model checked each open '
    + 'question.' : checked === 0 ? `Sonah publishes ${total === 1 ? 'the open question' : `the ${total} open questions`} `
    + 'unchecked.' : `With the same access, the same model checked ${checked} of the ${total} `
    + `open questions. Sonah publishes the ${total - checked === 1 ? 'other' : 'others'} unchecked.`),
  // D110: how code computes the label, said after `how` when the report's code step used the premise contract. Its
  // review: code checks only that each quote is literally in the repository and that each source is a token of the
  // closed list. Whether a line shows its premise, and whether a behaviour is documented, are the check's to say, so
  // each sentence names the check as the one that quotes or names, never Sonah as the one that settles.
  howConfirm: 'Sonah asks the check of each finding for the premises that the finding rests on. Sonah calls a finding '
    + 'checked only when its check quotes repository lines or names documented language behaviour for each premise. '
    + 'Sonah must also find each quote word for word. A finding is an item to verify when its check finds the problem '
    + 'but names anything else for a premise.',
  // D109: with a git base, when the change holds files no recorded edit of the session wrote, it says so.
  // D117: with files of the change in another repository or folder too (`here`), the line speaks of the working
  // directory's repository (or the working directory) alone; each other place has its own line (`placeBase`).
  base: (commit, unrecorded = 0, total = 0, here = false) => (commit ? `${here ? 'In the working directory\'s '
    + `repository, the change runs from the session's start commit (${commit}) to the files now.` : 'The change runs from '
    + `the commit where the session started (${commit}) to the files as they are now.`}${unrecorded > 0 ? ' So it can hold work done after the session. Sonah '
      + `found no recorded edit of the session that wrote ${unrecorded === total ? `any of its ${plural(total, 'file')}`
        : `${unrecorded} of its ${plural(total, 'file')}`}.` : ''}`
    // D100 (the audit of absence sentences): git can fail to say for any reason, so said as what Sonah could not read.
    : here ? 'In the working directory, Sonah could not read from git where the session started. The change there is '
      + 'the edits that the session recorded.'
      : 'Sonah could not read from git where the session started, so the change is the edits that the session recorded.'),
  // D113 (code-snapshot/13): with git, a change of the files that a recorded write of the session could have changed (a
  // write whose effect is landed or unknown), and of the files that no such write changed whose last change came while
  // the session ran (by the file system's time, inside the recording's first and last timestamps): `unrecorded` of its
  // `total` files. A file the session wrote that also changed after its last recorded edit is said by `changedSince`.
  // D117: `here`, as `base`'s.
  ownBase: (commit, unrecorded = 0, total = 0, here = false) => `${here ? 'In the working directory\'s repository, the '
    + `change runs from the session's start commit (${commit}) to the files now.` : 'The change runs from the commit '
    + `where the session started (${commit}) to the files as they are now.`}${unrecorded > 0 ? ` No recorded write of the session changed ${unrecorded === total
      ? (total === 1 ? 'its one file' : `any of its ${total} files`) : `${unrecorded} of its ${plural(total, 'file')}`}. `
      + `${unrecorded === 1 ? 'That file' : 'Each of them'} last changed while the session ran.`
      : ' It holds only files that a recorded write of the session could have changed.'}`,
  // D113: the files that differ from the start commit that no recorded write of the session touched and whose last
  // change did not come while the session ran (or cannot be placed in time: a file not there any more), named: no part
  // of the change (a later commit, a person, a tree already dirty at the start), so "outside this session's recorded
  // writes", the one thing every such file shares.
  // D113's review: at most CODE_REPORT_LIMITS.changedOutsideNames names, then how many `more`. D113 amended (2026-10-18;
  // the owner: "tag it by outside the evaluated session"): said of them when no code review that answered was given them
  // (`codeChangedOutsideLine`: the session's own change held no file to review, or the review did not answer), tagged in
  // the fixed words.
  changedOutside: (paths, more = 0) => `Sonah did not review ${plural(paths.length + more, 'file')} that changed `
    + `outside this session's recorded writes. ${paths.length + more === 1 ? 'It is' : 'They are'} outside the evaluated `
    + `session: ${paths.join(', ')}${more ? `, and ${more} more` : ''}`,
  // D113 amended: the fixed words beside a file outside the evaluated session in the files list, and beside a withheld
  // finding anchored in one (its record's `outsideSession`).
  outsideTag: 'outside the evaluated session',
  // D113 amended: the same files when the code review was given them after the session's own change and answered
  // (`codeChangedOutsideLine`), named as many as `changedOutside`; what it saw of them is `outsideSeen`'s.
  outsideFiles: (paths, more = 0) => `${plural(paths.length + more, 'file')} that changed outside this session's `
    + `recorded writes ${paths.length + more === 1 ? 'is' : 'are'} outside the evaluated session: `
    + `${paths.join(', ')}${more ? `, and ${more} more` : ''}`,
  // D113 amended: the one tally's part of the files outside the evaluated session (code-pass.js `codeChangeTally`'s
  // `outside`), by its groups as `files` says the session's own change's, summing to the files `outsideFiles` counts.
  outsideSeen: (seen, unseen) => (seen.length ? `${seen.map(([group, n], at) => `${at === 0 ? 'Of the files outside '
    + `the evaluated session, the code review saw ${n}` : `It saw ${n}`} ${W.seenGroups[group](n)}.`).join(' ')}${unseen
    ? ` It did not see ${unseen}.` : ''}`
    : 'The code review did not see any of the files outside the evaluated session.'),
  // D117 (amending D109; the owner, 2026-10-18: "the changes that happened outside the worktree but is relevant to this
  // session should also be reviewed, make this default"): each other repository or folder the session wrote to, after the
  // working folder's repository, with where its change runs from (code-pass.js `placesOf`): a git repository, from the
  // commit where it stood when the session started (the working folder's rule, `startCommit`); a git repository with no
  // such commit, or a folder in none, the edits the session recorded. `n` the files of the change there (the one tally's),
  // `unrecorded` of them no recorded write of the session changed (D113's window, as `ownBase` says it).
  placeBase: (at, commit, n, unrecorded = 0) => `In ${at}, the change runs from the session's start commit there `
    + `(${commit}) to the files now. The change holds ${plural(n, 'file')} there.${unrecorded
      > 0 ? ` No recorded write of the session changed ${unrecorded === n ? (n === 1 ? 'that file' : 'any of them')
        : `${unrecorded} of them`}. ${unrecorded === 1 ? 'That file' : 'Each of them'} last changed while the session ran.`
      : ''}`,
  placeEdits: (at, n, repository = false) => `In ${at}, the change is the edits that the session recorded to `
    + `${plural(n, 'file')}.${repository ? ' Sonah could not read from git where the session started there.' : ''}`,
  // D124's review (its medium): the person gave the repository that holds the working directory with --code-repo (the
  // record's `base.given`). It is no place of its own: it is read by its own rule (D113, D117), where git's lists stop at
  // the working directory, so outside it the change holds only the files that a recorded write could have changed.
  givenHere: 'You gave the repository that holds the working directory with --code-repo. Sonah reads it by the working '
    + 'directory\'s own rule. Outside the working directory, the change holds only its files that a recorded write could '
    + 'have changed.',
  // D117: the files of another git repository that differ from its base and that no recorded write of the session
  // touched: no part of the change, named (as `changedOutside`, bounded the same way, and in its words: D113 amended,
  // outside the evaluated session; `placeOutsideFiles` when the code review was given them and answered).
  placeChangedOutside: (at, paths, more = 0) => `In ${at}, Sonah did not review ${plural(paths.length + more, 'file')} `
    + `that changed outside this session's recorded writes. ${paths.length + more === 1 ? 'It is' : 'They are'} outside `
    + `the evaluated session: ${paths.join(', ')}${more ? `, and ${more} more` : ''}`,
  placeOutsideFiles: (at, paths, more = 0) => `In ${at}, ${plural(paths.length + more, 'file')} that changed outside `
    + `this session's recorded writes ${paths.length + more === 1 ? 'is' : 'are'} outside the evaluated session: `
    + `${paths.join(', ')}${more ? `, and ${more} more` : ''}`,
  // D117: where a file of another place lies, as the files list of what the agent did names it: a git repository by its
  // top folder, or a folder in none.
  placeOfFile: (at, repository) => (repository ? `in the git repository ${at}` : `in ${at}, which no git repository `
    + 'holds'),
  // D117: how the files of the change divide among its places, after the line that counts them (`files`): the working
  // folder's repository (`at` null; the working directory when it is in none), then each other place, summing to the
  // whole; with `unseen`, how many of those the code review did not see.
  filesWhere: (n, at, unseen = 0, repository = true) => `${n} of them ${n === 1 ? 'lies' : 'lie'} in ${at === null
    ? (repository ? 'the repository of the working directory' : 'the working directory') : at}.${unseen
    ? ` The code review did not see ${unseen === n ? (n === 1 ? 'it' : 'any of them') : `${unseen} of those`}.` : ''}`,
  // D117 amended (the owner, 2026-10-18: "files outside any repository are listed, not reviewed"): the folders in no
  // git repository that the session wrote to (code-pass.js `foldersOf`), each with how many of its files lie there, at
  // most CODE_REPORT_LIMITS.changedOutsideNames of them by name, then how many more folders; `n` all those files.
  folders: (n, entries, more = 0) => `The session wrote ${plural(n, 'file')} in ${entries.length + more === 1 ? 'a folder'
    : `${entries.length + more} folders`} that no git repository holds. Sonah lists ${n === 1 ? 'it' : 'them'} and did not `
    + `review ${n === 1 ? 'it' : 'them'}: ${entries.map(([at, k]) => `${at} (${plural(k, 'file')})`).join(', ')}${
      more ? `, and ${plural(more, 'more folder')}` : ''}`,
  // D117 amended (the owner: "paths that hold an unexpanded $VARIABLE are never counted"): the session's writes whose
  // path, as a command spelled it, holds an unexpanded shell variable or command substitution (code-pass.js
  // `unresolvedOf`): counted apart, never a file of the change.
  unresolved: (n) => `${plural(n, 'write')} of the session ${n === 1 ? 'names a path' : 'name paths'} with an unexpanded `
    + `shell variable or command substitution. Sonah cannot tell which ${n === 1 ? 'file it' : 'files they'} wrote, so it `
    + `counts ${n === 1 ? 'it' : 'them'} apart and did not review ${n === 1 ? 'it' : 'them'}.`,
  // D117 amended (the owner: "the page says plainly that edits made by helper agents or by scripts after cd are not seen
  // yet"): said on the page, in the .md and on the terminal (cli session-review-command.js `codeStepLine`) when the
  // session ran a shell command (code-pass.js `mayMissEdits`, the record's `unseenEdits`).
  unseenEdits: 'Sonah does not yet see every edit made by helper agents or by scripts after a cd. The change can miss '
    + 'some of them.',
  // D113: an empty change of a snapshot that counts the session's recorded writes. None at all: said plainly (a write
  // refused before it ran, or one that failed or was cancelled, changed nothing: session.js `effectOf`).
  noWrite: 'The code review had no change to review. The recording shows no write of the session that could have '
    + 'changed a file.',
  // D123 (the beta.5 end-to-end smoke): no such write, but the session ran a shell command (the record's `unseenEdits`),
  // whose writes Sonah does not yet see: said as what Sonah found, never that the session wrote nothing. The notes before
  // it say that such edits can be missing (`unseenEdits`).
  noSeenWrite: 'The code review had no change to review. Sonah found no write of the session that it can read, and the '
    + 'session ran shell commands.',
  // D113: writes, but none in the working directory that differs from the start commit, beside files that changed outside
  // them (said as what Sonah found: git's lists, as `noFile`).
  noWrittenChange: 'The code review had no change to review. Sonah found no file that the session wrote in the working '
    + 'directory that differs from where the session started.',
  // D109: the one tally (code-pass.js `codeChangeTally`): every file of the change in one group, the groups summing to the
  // whole, each counted as the footer's line of it counts it. `seen` the counts of the groups seen in any part, in
  // CODE_TALLY_GROUPS order (`[group, n]`), `unseen` the files it did not see.
  // One short sentence a group, so each stays plain however many groups a review has.
  // D109 amended (2026-10-18; the truth check of real reports: "It did not see 56" while its checks read 8 of them):
  // `read`, how many of the files it did not see its checks read (the tally's `checksRead`), and whose reading counts.
  files: (total, seen, unseen, read = 0) => `The change covers ${plural(total, 'file')}. ${seen.length ? `${seen
    .map(([group, n], at) => `${at === 0 ? `The code review saw ${n} of them` : `It saw ${n}`} ${W.seenGroups[group](n)}.`)
    .join(' ')}${unseen ? ` It did not see ${unseen}.` : ''}` : 'The code review did not see any of them.'}${read > 0
    ? ` Its checks read ${read < unseen ? `${read} of ${seen.length ? `those ${unseen}` : 'them'}` : unseen === 1 ? 'it'
      : unseen === 2 ? 'both' : `all ${unseen}`}. Sonah counts as seen only what it sent the code review and what the `
      + 'code review read itself.' : ''}`,
  // D149: a review of several units (code-pass.js `manifest.units`): the files whose every changed line a request of
  // the code review showed, in how many calls, and the files it could not show so, by why (`reasons`: `[words, n]`).
  // What was shown, never what was checked or found sound.
  // D149: the generated, vendored and lock files it showed so, counted apart (`generated`).
  units: (shown, calls, reasons, generated = 0) => `Sonah showed the code review every changed line of `
    + `${plural(shown, 'file')} in ${plural(calls, 'call')}.${generated ? ` It also showed every changed line of `
    + `${plural(generated, 'generated, vendored or lock file')}.` : ''}${reasons.length ? ` It could not show `
    + `${plural(reasons.reduce((n, [, k]) => n + k, 0), 'file')}: ${reasons.map(([words, k]) => `${k} ${words}`)
      .join(', ')}.` : ''}`,
  // D149: a file of the change whose review unit is past the most units one review plans.
  unitCap: 'past the calls one review makes',
  // A report written before D105, which kept no manifest: what the request showed, its own words.
  shownFiles: (shown, total, others) => `The change covers ${plural(total, 'file')}, and the code review saw the change `
    + `of ${shown}.${others ? ` The others: ${others}.` : ''}`,
  seenGroups: Object.freeze({ whole: () => 'whole',
    whole_not_before: (n) => (n === 1 ? 'whole but not as it was before' : 'whole but not as they were before'),
    in_part: () => 'in part', hunks_only: (n) => `only where the change touched ${n === 1 ? 'it' : 'them'}`,
    lines_unknown: () => 'in lines that Sonah could not number' }),
  // D105 (code-pass/12): a review request whose minimum is over the bound is not sent; no reader says the review saw
  // anything of it, or names it as a call that did not answer.
  tooLarge: (total) => `The change covers ${plural(total, 'file')}. The code review did not run, because its input was `
    + 'too large to send.',
  // D109 (its review): a request sent whose call did not answer, with no sign that the review read it (code-pass.js
  // `codeReviewAnswered`): no reader says the review saw anything of it. The footer names the call.
  noAnswer: (total) => `The change covers ${plural(total, 'file')}. The code review did not answer, so Sonah ${total === 1
    ? 'does not count it as seen' : 'counts none of them as seen'}.`,
  // A report of an earlier code step, whose list held the files the session read beside those of the change.
  earlierFiles: (shown, total, others) => `The code review saw ${shown} of ${plural(total, 'file')} that the session `
    + `changed or read, or that differ from its start.${others ? ` The others: ${others}.` : ''}`,
  // D100: the recording may name none, or one Sonah cannot read here: said as what Sonah could not read.
  noRoot: 'The code review did not run. Sonah could not read a working directory of the session on this computer, so it '
    + 'read no file.',
  // Why the step did not run, by its gap (the report's `gaps[].code`), when it names one.
  notRun: Object.freeze({ code_step_backend: 'The code review did not run. It needs Claude Code and its read-only tools, '
    + 'and this review used another backend.' }),
  // The session changed no file: the code review had no change to read, and no reader says every file was shown.
  // D100: with no git base the change is the recorded edits only: said as what Sonah found.
  noFile: 'The code review had no change to review. Sonah found no file in the working directory that differs from where '
    + 'the session started.',
  // D118 (a), the owner's go of 2026-10-18 ("cool go for it"; the dogfood's DF2): the first screen's sentence when the
  // code step reviewed no code (`codeNotReviewedOf`), the same on every reader (the page, the Markdown report, the PR
  // comment, the terminal): the owner's fixed words, then the one closed reason (ledger.js CODE_NOT_REVIEWED_REASONS).
  // A reader that knows the folder the code step looked in names it after them (`notReviewedFolder`).
  notReviewed: (reason) => `No code was reviewed. Reason: ${reason}.`,
  notReviewedReasons: Object.freeze({
    step_off: 'this review ran without the code review',
    backend: 'the code review needs Claude Code, and this review used another backend',
    no_folder: 'Sonah could not read a working directory of the session on this computer',
    // As `noWrite` (its proof): the session's own writes, by their effect (session.js `effectOf`).
    no_write: 'the recording shows no write of the session that could have changed a file',
    // D123 (the beta.5 end-to-end smoke): as `noSeenWrite`. A script that a shell command ran can write files that no
    // recorded write names (after a `cd`, or by a path it builds), so the reason says what Sonah found and what you can
    // do, never that the session changed nothing. D124 (the --code-repo option): and the way to have that code reviewed,
    // with the command's name (the style's glossary keeps "the review" for Sonah's parts).
    no_seen_write: 'Sonah found no write of the session that it can read. The session ran shell commands, and Sonah '
      + 'does not yet see what a script writes. Check each repository that they could change, with git status and git '
      + 'diff. To review that code, run sonah review again with --code-repo <the repository\'s folder>',
    // D124's review (its medium): as `no_seen_write`, but the person gave a repository with --code-repo (code-pass.js
    // `repositoriesGiven`) and Sonah found no file of the change there: what Sonah found, never the way out again.
    no_seen_write_given: 'Sonah found no write of the session that it can read, and no file of the change in the '
      + 'repositories that you gave with --code-repo. The session ran shell commands, and Sonah does not yet see what a '
      + 'script writes. Check each repository that they could change, with git status and git diff',
    no_written_change: 'among the changed files in the folder, Sonah found none that the session wrote',
    no_file: 'Sonah found no changed file in the folder',
    none_shown: 'Sonah could show the code review no changed lines of the change',
    too_large: "the code review's input was too large to send",
    no_answer: 'the code review did not answer',
    none_seen: 'the code review saw none of the files of the change',
    // D122 (a review low of D118): a record an earlier code step wrote before it kept the request's manifest.
    unknown: 'this review was saved by an earlier version of Sonah, which did not record why' }),
  notReviewedFolder: (folder) => `Folder: ${folder}`,
  // The coverage line, by the code review's own coverage (`codeReviewCoverage`). D111's second review: `partial` names no
  // list, since the lines after it can include the counts of the item-by-item check (a published finding can follow
  // from a counted item, so they are no part of what the code review did not cover), and since the page shows those
  // lines above it. A coverage short of complete only by those counts prints no coverage line: the counts say it.
  coverage: Object.freeze({ partial: 'The code review did not finish every part of its work.',
    missing: 'The code review did not finish. The list below shows what it did not cover.' }),
  besideGroup: 'Beside what the session review found', restGroup: 'Other problems that the code review found',
  questionsGroup: 'Open questions for you',
  // Shown only when something was not covered: with nothing to list, no line says the review covered everything.
  footerGroup: 'What the code review did not cover',
  finding: 'Code review finding', codeNow: 'The code now', codeBefore: 'The code before the session',
  sessionSaid: 'Recorded in the session', input: 'For the input', trace: 'How it gets there', foundBy: 'Found through',
  concerns: 'It concerns',
  // A published finding's check. A supporting claim it found false is not shown (the report keeps it, with its verdict).
  // `checkHolds`: a report made before the premise contract (D110), whose check held by the gate of its day.
  // Each is shown after the label "Its check:" (render/report-words.js REPORT_ITEM_WORDS.check), so none repeats it.
  checkLabel: 'Its check', checkHolds: 'It traced the finding and found the same problem.',
  // D110: a finding code's label confirms, and one it does not (code-pass.js `findingConfirmed`). The glossary's
  // "checked" (docs/STYLE.md): Sonah compared it with the code. Its review: what the check quotes or names is said as
  // the check's, since code checks only that a quote is literally there and that a source is a closed token.
  checkConfirmed: 'It found the same problem. For each premise, it quotes lines of the repository or names documented '
    + 'behaviour of the language.',
  checkUnconfirmed: 'It found the same problem. Sonah could not check all of its premises in the repository or the '
    + 'language.',
  // D110: one premise of a check, in the check's own words, then where its evidence is, by its closed source (ledger.js
  // CODE_PREMISE_SOURCES); a premise that cannot confirm (code-pass.js `premiseConfirms`) reads `outside`, whatever
  // source it names. A language premise is the check's naming of documented behaviour: Sonah read no documentation, so
  // the words say whose naming it is. A repository premise is the check's quoting of lines: Sonah found each quote word
  // for word, and never judged whether a line shows the premise, so the words say whose quoting it is too.
  premiseSources: Object.freeze({ repository: 'Its check quotes lines of the repository for it. Sonah found each quote '
    + 'there word for word.',
    language: 'Its check names documented behaviour of the language for it.',
    outside: 'Sonah could not check it in the repository or the language.' }),
  // D152: a finding its check found to hold that Sonah confirms, tied to no written promise (code-pass.js `findingTied`:
  // no row of the session review it follows from, and no receipt of what it breaks that grounded).
  openFinding: 'Checked: the code does this. Sonah found nothing that it breaks: no ask, claim, doc, caller or test.',
  // An open question that comes from a finding the check found real but not against what you asked (a record before
  // D152).
  fromFinding: 'From a finding of the code review',
  fromFindingWords: 'Its check found that the code does this. It also found that this does not go against your ask or '
    + 'the contract with callers. Is it what you want?',
  withheldLabel: 'Withheld', withheldNoText: 'The code review gave no text for it.',
  withheldWhat: Object.freeze({ finding: 'A finding', question: 'An open question' }),
  withheldReasons: Object.freeze({
    malformed: 'it broke the answer\'s contract, even after one repair',
    evidence_grounding_failed: 'Sonah did not find, word for word, a quote that it rests on, even after one repair',
    out_of_scope: 'it is not about lines that the change touched',
    verify_refuted: 'its check refuted it',
    verify_cannot_tell: 'its check could not settle it from the repository',
    verify_unexecuted: 'its check did not finish',
    false_premise: 'it rests on a premise that the code shows is false',
    request_failed: 'the call that would check it failed',
    request_too_large: 'the input of the call that would check it was too large to send' }),
  // D113 amended (its review): why a finding of a kind that is itself a tie to an item of the session (code-pass.js
  // TIE_KINDS), anchored in a file outside the evaluated session (its record's `outsideSession`), is out of scope,
  // whatever lines its trace runs through: said in place of `withheldReasons.out_of_scope` and its cause
  // (`withheldWhy`), by its kind.
  outsideTie: Object.freeze({
    ask_not_met: 'it says that an ask is not met, and Sonah ties no finding outside the evaluated session to an ask',
    claim_false: 'it says that the code contradicts a claim, and Sonah ties no finding outside the evaluated session to '
      + 'a claim' }),
  // A reason said without "even after one repair", for an item of which Sonah checked no repaired version (its
  // `repair`); the reasons that say nothing of a repair are said as they are.
  unrepairedReasons: Object.freeze({ malformed: 'it broke the answer\'s contract',
    evidence_grounding_failed: 'Sonah did not find, word for word, a quote that it rests on' }),
  // Why no item of the one repair stood in its place (ledger.js CODE_REPAIR_UNCHECKED), said after the reason and its
  // cause, by what the item is (CODE_WITHHELD_ITEMS). The words say only what code compared (code-pass.js `mergeRepair`,
  // F3a): an item of the repair matches it when it is the same value, a finding of its kind on lines of the same file
  // version that overlap its lines, or a question with its words about its dossier item; it takes its place only one to
  // one. A finding takes part by its lines only when its anchor is in the contract's shape and its lines, the first not
  // after the last, are lines of a file version that Sonah could read: each sentence names which side lacked that. A
  // repair that corrects those very parts matches nothing and is checked as a new item, so no sentence says that Sonah
  // checked no repaired version. `unplaced` is a finding's alone: a question has no anchor.
  unrepaired: Object.freeze({
    unmatched: Object.freeze({
      finding: 'no finding of the repair matched it by kind, file version and lines',
      question: 'no question of the repair matched it by its words and its item' }),
    uncompared: Object.freeze({
      finding: 'Sonah could not compare it by kind, file version and lines with every finding of the repair, and none '
        + 'that it could compare that way matched it: the anchor of each other one is missing, is not in the shape of '
        + 'the answer\'s contract, names lines that are not all lines of a file version that Sonah could read, or ends '
        + 'before it starts',
      question: 'Sonah could not compare it by its words and its item with every question of the repair, and none that '
        + 'it could compare that way matched it: each other one gives no text of a question' }),
    ambiguous: Object.freeze({
      finding: 'a finding of the repair matched it, but Sonah put none in its place, because more than one finding of '
        + 'the repair matched it, or the one that matched it also matched another finding of the code review',
      question: 'a question of the repair matched it, but Sonah put none in its place, because more than one question '
        + 'of the repair matched it, or the one that matched it also matched another question of the code review' }),
    matched_past_limit: Object.freeze({
      finding: 'a finding of the repair matched it, but Sonah did not check that finding, because it is past the most '
        + 'items that its list may hold',
      question: 'a question of the repair matched it, but Sonah did not check that question, because it is past the most '
        + 'items that its list may hold' }),
    unnamed: Object.freeze({
      finding: 'no finding of the repair could match it by kind, file version and lines, because its anchor is missing '
        + 'or is not in the shape of the answer\'s contract',
      question: 'no question of the repair could match it by its words and its item, because it gives no text of a '
        + 'question' }),
    unplaced: Object.freeze({
      finding: 'no finding of the repair could match it by kind, file version and lines, because the lines that its '
        + 'anchor names are not all lines of a file version that Sonah could read, or its last line is before its '
        + 'first' }),
    brought: 'Sonah did not ask for its repair, because it came in the one repair',
    failed: 'the call that would repair it failed',
    spent: 'Sonah did not ask for its repair, because the one repair asked again for the whole answer',
    unasked: 'Sonah did not check it or ask for its repair, because it is past the most items that its list may hold',
    too_large: 'Sonah did not ask for its repair, because the repair\'s input was too large to send',
    // F3b (D111): a finding that came with the code review's item-by-item check of the items in scope (ledger.js
    // CODE_ACCOUNT_SCOPE), named by those kinds alone (its review: not every claim and decision is in scope). D111
    // amended (2026-10-18): the scope holds every ask of the session review, an ask an agent wrote into a helper's brief
    // too (CODE_ACCOUNT_ASK_SOURCES), so the asks are the session review's, never "your asks".
    accounted: 'Sonah did not ask for its repair, because it came with the code review\'s item-by-item check of the '
      + 'session review\'s asks, of the statements that the agent wrote into a file and of the agent\'s decisions not to '
      + 'act',
    // An earlier report's (code-pass/10, which read the repair at the item's index): its words as it was written with.
    different: Object.freeze({
      finding: 'Sonah did not use the repair\'s finding at its place, because that finding differs in kind, file or file '
        + 'version',
      question: 'Sonah did not use the repair\'s question at its place, because that question differs in the item that it '
        + 'concerns' }),
    absent: Object.freeze({
      finding: 'Sonah did not check a repaired version of it, because the one repair returned no finding at its place',
      question: 'Sonah did not check a repaired version of it, because the one repair returned no question at its '
        + 'place' }),
    repeated: Object.freeze({
      finding: 'Sonah did not use the repair\'s finding at its place, because that finding repeats another finding of the '
        + 'code review',
      question: 'Sonah did not use the repair\'s question at its place, because that question repeats another question of '
        + 'the code review' }) }),
  // Why a check refuted it (ledger.js CODE_REFUTATION_REASONS), said after "its check refuted it".
  refutations: Object.freeze({ incorrect: 'it misreads the code', step_unsupported: 'a step does not follow from its quote',
    mitigation_shown: 'another line handles the case', input_unreachable: 'the input cannot reach it',
    rests_on_unshown_code: 'it rests on code that the reviewer did not see', out_of_scope: 'its cause is not in the change',
    unverifiable: 'the code that the reviewer saw cannot settle it',
    not_against_goal: 'the code does this, but this does not go against your ask or the contract with callers' }),
  // The closed cause beside a reason (ledger.js CODE_ITEM_ERRORS, CODE_VOID_CAUSES).
  causes: Object.freeze({ key_missing: 'a member that it needs is not there',
    key_outside_contract: 'it holds a member outside the contract', value_outside_list: 'a value is outside its closed list',
    // A list past its most items gives this cause too (ledger.js CODE_ITEM_ERRORS), so the words name both.
    text_over_limit: 'a text or a list is over its length limit',
    dossier_key_unknown: 'it names a key that the session review does not hold',
    ask_key_required: 'an ask not met must name the ask',
    claim_key_required: 'a claim that the code contradicts must name the claim or decision',
    // D100 (the audit of absence sentences): the cause also stands for a receipt of the wrong shape or length, and for
    // a session quote, so it says what Sonah did not find, never what a file lacks.
    quote_ungrounded: 'Sonah found nothing in what it names that matches the quote word for word',
    // D100: two checks give this cause (code-pass.js `groundCodeReceipt`, a quote that is not on the lines that it
    // names; `groundFinding`, lines that no code step of the trace quotes), and the words name both.
    anchor_off_quote: 'the lines that it names do not hold the code that it quotes, or no step of its trace quotes '
      + 'the lines that it is about',
    file_not_readable: 'it names a file that Sonah could not read', out_of_scope: 'it is not about lines that the change '
      + 'touched',
    // D122 (d): a relative path that names a file in more than one place of the change names none of them.
    path_ambiguous: 'it names a path that more than one repository of the change holds, so Sonah could not tell which '
      + 'file it means',
    shape: 'the check\'s answer broke its contract',
    receipt_ungrounded: 'Sonah did not find a quote of the check\'s word for word',
    support_off_anchor: 'the check upheld it without a quote of the lines that it is about',
    support_off_trace: 'the check upheld it without a quote of another line of its trace',
    refutation_uncited: 'the check refuted it without a quote of the code that shows it',
    // D147: a quote of the check's whose relative path more than one place of the change holds: what Sonah could not
    // tell, as for an item's own path (`path_ambiguous`).
    receipt_path_ambiguous: 'the check named a path that more than one repository of the change holds, so Sonah could '
      + 'not tell which file it means' }),
  kinds: Object.freeze({ bug: 'a bug', missed_case: 'a missed case', weak_test: 'a test that would still pass with the bug',
    contract_break: 'a broken contract', ask_not_met: 'an ask not met', rule_break: 'a broken rule',
    claim_false: 'a claim of the agent\'s that the code contradicts' }),
  lenses: Object.freeze({ behaviour: 'behaviour', tests: 'tests', contracts: 'contracts', ask: 'your ask',
    rules: 'the rules', claims: 'the agent\'s claims' }),
  // The closed state of a file of the change (ledger.js CODE_FILE_STATES), with the states of earlier reports.
  states: Object.freeze({ not_shown: 'not shown whole for lack of room', binary: 'binary',
    credential_path: 'withheld as credential-shaped', harness_home: 'withheld as harness files',
    // R16: the footer's words: the file changed after the last recorded edit, which can be during the session (the
    // agent's own formatter), so never "since the session".
    oversize: 'too large for one call', changed_since_session: 'changed after the session\'s last recorded edit',
    deleted: 'not there any more', outside_root: 'outside the working directory', unreadable: 'not readable',
    // D109: hunks left out for room are never "too large"; a recorded write outside the change block by where it lies.
    left_out: 'left out for room', other_repository: 'in another repository',
    outside_writer_root: 'written by an agent from another working directory' }),
  // D109: a file of the change the request showed by its hunks with none of its lines (a whole-file write named by its
  // line count) that the review did not read: its state is `shown`, so it has its own words.
  unseenShown: 'named without a line shown',
  // The footer, one line per kind (ledger.js CODE_FOOTER_KINDS, with an earlier report's `listed_by_name`), in this
  // order, each given every entry of its kind: their paths, their files' states, the parts of the calls, a count.
  footerKinds: Object.freeze({
    listed_by_name: (e) => `${plural(e.paths.length, 'file')} not shown whole for lack of room: ${e.paths.join(', ')}`,
    // D109: left out of the request for room (CODE_LEFT_OUT_REASONS), never "too large": a file too large on its own is
    // `oversize`, under `withheld`.
    clipped: (e) => `${plural(e.paths.length, 'file')} whose change Sonah left out of the code review's input for room: `
      + `${e.paths.join(', ')}`,
    withheld: (e) => `${plural(e.n, 'file')} whose change the code review did not see${e.states.length ? ` (${e.states
      .map(([state, k]) => `${k} ${state}`).join(', ')})` : ''}${e.paths.length ? `: ${e.paths.join(', ')}` : ''}`,
    failed: (e) => `${plural(e.count, 'call')} that did not answer${e.parts.length ? `: ${e.parts.join(', ')}` : ''}`,
    // D109: only a write outside every folder the code review could read; one in another repository or in the working
    // directory is a file of the change, named. Its review: `home` of them lie in a coding agent's home folder or are named
    // from the home folder, which can lie in a folder the review could read, so they are said apart. D117: or in a place
    // Sonah writes (its home, its state folder), which stays out as a coding agent's home does.
    outside_root: (e) => {
      const home = Number.isSafeInteger(e.home) && e.home > 0 ? Math.min(e.home, e.count) : 0;
      const homeWords = 'in a coding agent\'s home folder, in Sonah\'s own folders or under a name from your home folder';
      const outsideWords = 'outside the folders that the code review could read';
      return home === 0 ? `${plural(e.count, 'path')} that the session wrote to ${outsideWords}, which Sonah counts but `
        + 'did not review' : home === e.count ? `${plural(e.count, 'path')} that the session wrote to ${homeWords}, which `
        + 'Sonah counts but did not review' : `${plural(e.count, 'path')} that the session wrote to, which Sonah counts but `
        + `did not review: ${e.count - home} ${outsideWords}, ${home} ${homeWords}`;
    },
    source_changed: () => 'The repository changed while the code review ran, so a file that it quotes can differ now',
    // D105: a request too large to send is named so, by its part, never as a call that did not answer.
    too_large: (e) => `${plural(e.count, 'call')} that Sonah did not make, because ${e.count === 1 ? 'its input was'
      : 'their inputs were'} too large to send${e.parts.length ? `: ${e.parts.join(', ')}` : ''}`,
    // D105: commands that did not fit beside the rest of the request (the agent cannot read a command itself).
    commands_left_out: (e) => `${plural(e.count, 'command')} after a changed file's last edit that did not fit in the `
      + 'code review\'s input' }),
  // F3b (D111): the items in scope (ledger.js CODE_ACCOUNT_SCOPE) whose entry in the code review's item-by-item check
  // is `not_examined` or `missing` (the footer's `unaccounted`, by scope), counted. The words say only what every such
  // fate proves: that check did not examine the item, or examined it in a way that Sonah could not use. They name that
  // check, never the code review as a whole (its review): a published finding can follow from a counted item, and is a
  // check that Sonah used. No line counts or names the items it examined, and no entry's words are shown. D111 amended
  // (2026-10-18; the truth check of real reports, where 3 asks an agent wrote into a helper's brief read as "your
  // asks"): the asks are counted by whose words each rests on (ledger.js CODE_ACCOUNT_ASK_SOURCES, code-context.js
  // `askSourceOf`), and only those that rest on your own words are called yours.
  unaccounted: Object.freeze({
    ask: Object.freeze({
      person: (n) => `${n} of your asks that the code review's item-by-item check did not examine in a way that Sonah `
        + 'could use',
      helper_brief: (n) => `${plural(n, 'ask')} that an agent wrote into a helper's brief, which the code review's `
        + 'item-by-item check did not examine in a way that Sonah could use',
      other: (n) => `${plural(n, 'ask')} that Sonah could not trace to your own words, which the code review's `
        + 'item-by-item check did not examine in a way that Sonah could use' }),
    written_claim: (n) => `${plural(n, 'statement')} that the agent wrote into a file, which the code review's `
      + 'item-by-item check did not examine in a way that Sonah could use',
    not_acting: (n) => `${plural(n, 'decision')} not to act that the code review's item-by-item check did not examine in `
      + 'a way that Sonah could use' }),
  // D105: what the code review saw of a file of the change, or of a rule or skill file the session loaded, when short of
  // whole (code-pass.js `codeSeenOf`, from the request's manifest and the review's reading record). Seeing is not
  // checking: no line says a file seen whole is fine, and a file whose change the review saw whole is named nowhere.
  seenInPart: (files) => `${plural(files.length, 'file')} of the change that the code review saw only in part: `
    + `${files.join(', ')}`,
  hunksOnly: (paths) => `${plural(paths.length, 'file')} of the change that the code review saw only where the change `
    + `touched ${paths.length === 1 ? 'it' : 'them'}: ${paths.join(', ')}`,
  // A file of the change the code review saw whole as it is now, whose hunks' rows on the earlier side the request did
  // not show: no Read shows a file as it was, so the review did not see its change.
  wholeNotBefore: (paths) => `${plural(paths.length, 'file')} of the change that the code review saw whole, but not as `
    + `${paths.length === 1 ? 'it was' : 'they were'} before: ${paths.join(', ')}`,
  rulesInPart: (files) => `${plural(files.length, 'rule or skill file', 'rule or skill files')} that the code review saw `
    + `only in part: ${files.join(', ')}`,
  rulesNotSeen: (paths) => `${plural(paths.length, 'rule or skill file', 'rule or skill files')} that the session loaded `
    + `and the code review did not see: ${paths.join(', ')}`,
  // A file the code review read with a Read whose result gave no lines that Sonah could read, or (D109) whose hunks the
  // request showed in rows that Sonah could not place: never said unseen.
  linesUnknown: (paths) => `${plural(paths.length, 'file')} of the change that the code review saw, though Sonah could not `
    + `tell which lines: ${paths.join(', ')}`,
  rulesLinesUnknown: (paths) => `${plural(paths.length, 'rule or skill file', 'rule or skill files')} that the code `
    + `review read, though Sonah could not tell which lines: ${paths.join(', ')}`,
  // A file's lines the code review saw, as a footer line names them: "lines 1 to 80 and 120 to 200 of 423".
  linesOf: (ranges, total) => `${ranges.length === 1 && ranges[0][0] === ranges[0][1] ? 'line' : 'lines'} ${ranges
    .map(([a, b]) => (a === b ? `${a}` : `${a} to ${b}`)).reduce((out, part, at, all) => (at === 0 ? part
      : `${out}${at === all.length - 1 ? ' and ' : ', '}${part}`), '')}${Number.isSafeInteger(total) ? ` of ${total}` : ''}`,
  // A file of the change that changed after the session's last recorded edit (its state `changed_since_session`) whose
  // change the request showed: a fact, said after the files whose change it did not show.
  changedSince: (paths) => `${plural(paths.length, 'file')} changed after the session's last recorded edit, so Sonah `
    + `cannot tell whether all of ${paths.length === 1 ? 'its' : 'their'} lines are the agent's: ${paths.join(', ')}`,
  outsideLine: (n) => `${plural(n, 'path')} outside the working directory also ${n === 1 ? 'differs' : 'differ'} from `
    + 'where the session started, which Sonah did not review or name',
  // A report of an earlier code step: the repository was the home folder or held it.
  homeLine: (n) => `The repository is your home folder, so Sonah read only the files that the session changed or read.${n
    > 0 ? ` Sonah did not read, name or send ${plural(n, 'other path')} that ${n === 1 ? 'differs' : 'differ'} from `
      + 'where the session started.' : ''} Sonah did not look for untracked files that the session did not change or read`,
  // A failed call's part (ledger.js CODE_STEP_PARTS), with the parts of earlier reports.
  parts: Object.freeze({ review: 'the code review', repair: 'the repair of the code review', verify: 'a finding\'s check',
    batch: 'the check of its questions',
    // F3b (D111): an accounting agent, by the name the footer's `unaccounted` lines give its check (each of its calls
    // that did not answer, or that Sonah did not make, leaves its items counted there, by kind).
    account: 'its item-by-item check',
    check: 'the check of the session review against the code', lens: 'the lens',
    check_challenge: 'the checking passes of that check', finding_challenge: 'the checking passes of the findings' }),
  quoteUnchecked: 'Sonah does not show its quote, because it did not find the quote again where the code review read it.',
  // When no finding is published: whether the review proposed none, or how many its check withheld and where.
  noFindings: 'The code review published no finding.',
  proposedNone: 'The code review proposed no finding.',
  // A finding its check found real but not against your ask is a question for you: an item of the report, in the
  // section its tier puts it in (no one section, so none is named). D110: a finding Sonah could not confirm is an item
  // to verify, in the section its tier puts it in. Sonah withholds a finding by its own checks or by its check's; every
  // reader lists them under the section named here (render/report-words.js REPORT_SECTION_WORDS.withheld, with its
  // count).
  notPublished: (withheld, asked, unconfirmed = 0) => `The code review published no finding${unconfirmed
    ? ' that Sonah checked' : ''}.${unconfirmed ? ` ${plural(unconfirmed, 'finding')} that it proposed ${unconfirmed === 1
      ? 'is an item' : 'are items'} of this report to verify. Sonah could not check all of the premises of `
    + `${unconfirmed === 1 ? 'it' : 'each'}.` : ''}${asked ? ` ${plural(asked, 'finding')} `
    + `that it proposed ${asked === 1 ? 'is an item' : 'are items'} of this report, as ${asked === 1 ? 'a question'
      : 'questions'} for you.` : ''}${withheld
    ? ` Sonah withheld ${withheld} of its findings. ${withheld === 1 ? 'It is' : 'They are'} under Proposals of the code `
      + `review that Sonah withheld, ${withheld === 1 ? 'with' : 'each with'} the reason.` : ''}`,
  rowKinds: Object.freeze({ promises: 'the claim', writtenClaims: 'the statement that the agent wrote into a file',
    findings: 'the contradicted claim', requirements: 'the ask', decisions: 'the decision', failures: 'the failure',
    pivots: 'the change of approach' }),
});
/** The kind of each text of CODE_REPORT_WORDS, for the style linter (packages/render/test/style-lint.js): a fragment is
 *  a part a reader joins into its own sentence or list. */
export const STYLE_KINDS = Object.freeze({
  CODE_REPORT_WORDS: 'description', 'CODE_REPORT_WORDS.heading': 'heading', 'CODE_REPORT_WORDS.label': 'label',
  'CODE_REPORT_WORDS.outcomes': 'fragment',
  ...Object.fromEntries(['besideGroup', 'restGroup', 'questionsGroup', 'footerGroup']
    .map((key) => [`CODE_REPORT_WORDS.${key}`, 'heading'])),
  ...Object.fromEntries(['finding', 'codeNow', 'codeBefore', 'sessionSaid', 'input', 'trace', 'foundBy',
    'concerns', 'checkLabel', 'fromFinding', 'withheldLabel', 'withheldWhat'].map((key) => [`CODE_REPORT_WORDS.${key}`,
    'label'])),
  ...Object.fromEntries(['withheldReasons', 'outsideTie', 'unrepairedReasons', 'unrepaired', 'refutations', 'causes',
    'kinds', 'lenses', 'states', 'footerKinds', 'unaccounted', 'changedSince', 'changedOutside', 'outsideFiles',
    'outsideTag', 'placeChangedOutside', 'placeOutsideFiles', 'placeOfFile', 'outsideLine', 'parts',
    'rowKinds', 'seenInPart',
    'hunksOnly', 'wholeNotBefore', 'rulesInPart', 'rulesNotSeen', 'linesUnknown', 'rulesLinesUnknown', 'linesOf',
    'seenGroups', 'unseenShown', 'notReviewedReasons', 'notReviewedFolder']
    .map((key) => [`CODE_REPORT_WORDS.${key}`, 'fragment'])),
});
/** The arguments each function of CODE_REPORT_WORDS is rendered with for the style linter. */
export const STYLE_FIXTURES = Object.freeze({
  'CODE_REPORT_WORDS.base': [['0123456789ab'], [null], ['0123456789ab', 3, 248], ['0123456789ab', 248, 248],
    ['0123456789ab', 0, 2, true], [null, 0, 0, true]],
  'CODE_REPORT_WORDS.ownBase': [['0123456789ab'], ['0123456789ab', 1, 3], ['0123456789ab', 2, 2],
    ['0123456789ab', 1, 1], ['0123456789ab', 0, 2, true], ['0123456789ab', 1, 3, true]],
  'CODE_REPORT_WORDS.changedOutside': [[['docs/a.md']], [['docs/a.md', 'src/b.js']], [['docs/a.md', 'src/b.js'], 238]],
  'CODE_REPORT_WORDS.outsideFiles': [[['docs/a.md']], [['docs/a.md', 'src/b.js']], [['docs/a.md', 'src/b.js'], 238]],
  'CODE_REPORT_WORDS.outsideSeen': [[[['whole', 2]], 0], [[['whole', 1], ['hunks_only', 3]], 2], [[], 4],
    [[['in_part', 1]], 1]],
  'CODE_REPORT_WORDS.placeBase': [['/work/other-repo', '0123456789ab', 1], ['/work/other-repo', '0123456789ab', 3],
    ['/work/other-repo', '0123456789ab', 1, 1], ['/work/other-repo', '0123456789ab', 3, 3],
    ['/work/other-repo', '0123456789ab', 3, 1], ['/work/other-repo', '0123456789ab', 4, 2]],
  'CODE_REPORT_WORDS.placeEdits': [['/work/notes', 1], ['/work/notes', 4], ['/work/new-repo', 2, true]],
  'CODE_REPORT_WORDS.placeChangedOutside': [['/work/other-repo', ['/work/other-repo/a.md']],
    ['/work/other-repo', ['/work/other-repo/a.md', '/work/other-repo/b.js'], 12]],
  'CODE_REPORT_WORDS.placeOutsideFiles': [['/work/other-repo', ['/work/other-repo/a.md']],
    ['/work/other-repo', ['/work/other-repo/a.md', '/work/other-repo/b.js'], 12]],
  'CODE_REPORT_WORDS.placeOfFile': [['/work/other-repo', true], ['/work/notes', false]],
  'CODE_REPORT_WORDS.filesWhere': [[3, null], [1, null, 0, false], [2, '/work/other-repo', 1], [1, '/work/notes', 1],
    [4, '/work/notes', 4], [5, null, 2]],
  'CODE_REPORT_WORDS.folders': [[1, [['/work/notes', 1]]], [5, [['/work/notes', 3], ['/tmp/scratch', 2]]],
    [40, [['/work/notes', 3], ['/tmp/scratch', 2]], 11]],
  'CODE_REPORT_WORDS.unresolved': [[1], [11]],
  'CODE_REPORT_WORDS.files': [[2, [['whole', 2]], 0], [55, [['whole', 8], ['in_part', 3], ['hunks_only', 11]], 33],
    [3, [['whole_not_before', 1], ['lines_unknown', 1]], 1], [4, [], 4], [110, [['whole', 53], ['in_part', 1]], 56, 8],
    [3, [['whole', 2]], 1, 1], [4, [['whole', 2]], 2, 2], [4, [], 4, 1], [4, [], 4, 4]],
  'CODE_REPORT_WORDS.questionsChecked': [[2, 2], [1, 2], [1, 3], [0, 1], [0, 2]],
  'CODE_REPORT_WORDS.shownFiles': [[1, 2, '1 binary'], [2, 2, '']],
  'CODE_REPORT_WORDS.units': [[418, 16, [['binary', 2]]], [1, 2, []], [5, 3, [['left out for room', 1],
    ['past the calls one review makes', 1]]], [406, 16, [['binary', 2]], 12], [3, 2, [], 1]],
  'CODE_REPORT_WORDS.seenGroups.whole': [[1]],
  'CODE_REPORT_WORDS.seenGroups.whole_not_before': [[1], [2]],
  'CODE_REPORT_WORDS.seenGroups.in_part': [[1]],
  'CODE_REPORT_WORDS.seenGroups.lines_unknown': [[1]],
  'CODE_REPORT_WORDS.seenGroups.hunks_only': [[1], [2]],
  'CODE_REPORT_WORDS.rulesLinesUnknown': [[['AGENTS.md']], [['AGENTS.md', 'docs/RULES.md']]],
  'CODE_REPORT_WORDS.tooLarge': [[1], [31]], 'CODE_REPORT_WORDS.noAnswer': [[1], [110]],
  'CODE_REPORT_WORDS.footerKinds.too_large': [[{ count: 1, parts: ['the code review'] }], [{ count: 2, parts: [] }]],
  'CODE_REPORT_WORDS.footerKinds.commands_left_out': [[{ count: 1 }], [{ count: 12 }]],
  'CODE_REPORT_WORDS.unaccounted.ask.person': [[1], [12]],
  'CODE_REPORT_WORDS.unaccounted.ask.helper_brief': [[1], [3]],
  'CODE_REPORT_WORDS.unaccounted.ask.other': [[1], [2]],
  'CODE_REPORT_WORDS.unaccounted.written_claim': [[1], [3]],
  'CODE_REPORT_WORDS.unaccounted.not_acting': [[1], [2]],
  'CODE_REPORT_WORDS.seenInPart': [[['src/a.js (lines 1 to 80 of 423)']], [['src/a.js (line 5 of 9)',
    'src/b.js (lines 1 to 2, 4 to 6 and 9 of 12)']]],
  'CODE_REPORT_WORDS.hunksOnly': [[['src/a.js']], [['src/a.js', 'src/b.js']]],
  'CODE_REPORT_WORDS.wholeNotBefore': [[['src/a.js']], [['src/a.js', 'src/b.js']]],
  'CODE_REPORT_WORDS.rulesInPart': [[['AGENTS.md (lines 1 to 40 of 900)']]],
  'CODE_REPORT_WORDS.rulesNotSeen': [[['AGENTS.md']], [['AGENTS.md', 'docs/RULES.md']]],
  'CODE_REPORT_WORDS.linesUnknown': [[['logo.png']], [['src/a.js', 'AGENTS.md']]],
  'CODE_REPORT_WORDS.linesOf': [[[[1, 80]], 423], [[[5, 5]], 9], [[[1, 2], [4, 6], [9, 9]], 12]],
  'CODE_REPORT_WORDS.earlierFiles': [[1, 3, '2 not shown whole for lack of room'], [2, 2, '']],
  'CODE_REPORT_WORDS.footerKinds.listed_by_name': [[{ paths: ['src/big.js'] }]],
  'CODE_REPORT_WORDS.footerKinds.clipped': [[{ paths: ['src/big.js', 'src/huge.js'] }]],
  'CODE_REPORT_WORDS.footerKinds.withheld': [[{ n: 2, states: [['binary', 1], ['deleted', 1]], paths: ['a.png', 'b.js'] }],
    [{ n: 1, states: [], paths: [] }]],
  'CODE_REPORT_WORDS.footerKinds.failed': [[{ count: 2, parts: ['the code review'] }], [{ count: 1, parts: [] }]],
  'CODE_REPORT_WORDS.footerKinds.outside_root': [[{ count: 1 }], [{ count: 3 }], [{ count: 2, home: 2 }],
    [{ count: 8, home: 4 }]],
  'CODE_REPORT_WORDS.footerKinds.source_changed': [[]],
  'CODE_REPORT_WORDS.changedSince': [[['src/a.js']], [['src/a.js', 'src/b.js']]],
  'CODE_REPORT_WORDS.outsideLine': [[1], [3]],
  'CODE_REPORT_WORDS.homeLine': [[0], [1], [2]],
  'CODE_REPORT_WORDS.notPublished': [[3, 0], [0, 1], [1, 2], [0, 0, 1], [2, 1, 3]],
  'CODE_REPORT_WORDS.notReviewed': [['Sonah found no changed file in the folder'],
    ["the code review's input was too large to send"]],
  'CODE_REPORT_WORDS.notReviewedFolder': [['/work/project']],
});
/** "Working directory" and "checking passes" are technical nouns, not verbs in progress. */
export const STYLE_ALLOW = Object.freeze({ ...Object.fromEntries(['noRoot', 'noFile', 'noWrittenChange', 'outsideLine',
  'filesWhere',
  'states.outside_root',
  'states.outside_writer_root',
  'parts.check_challenge', 'parts.finding_challenge'].map((key) => [`CODE_REPORT_WORDS.${key}`, ['technical-noun']])),
  // D118 (a): the owner's fixed words. No actor on purpose: no review of any actor (Sonah's, the code review's) read code.
  'CODE_REPORT_WORDS.notReviewed': ['actor-unknown'],
  'CODE_REPORT_WORDS.notReviewedReasons.no_folder': ['technical-noun'] });

const W = CODE_REPORT_WORDS;

// ---- what each reader reads ---------------------------------------------------------------------------------------

/** The items the code step withheld, each with what it is and its reason, both closed (an item with no text is still
 *  listed, said so in fixed words): code-pass.js `codePassWithheld`; null for a report of an earlier code step, which
 *  kept no text of them (its `rejected`). */
export const codeStepWithheld = (report) => (Array.isArray(report?.codePass?.withheld) ? codePassWithheld(report) : null);
/** The supporting claims a reader shows of a finding: those its check found to hold, in order. A claim it found false is
 *  cut and shown nowhere (the report keeps it, with its verdict), and neither is a claim with no closed verdict. */
export const findingClaims = (f) => list(f?.claims).filter((c) => plain(c) && typeof c.text === 'string' && c.text.trim()
  && c.verdict === CLAIM_HOLDS);
/** Is this trace step or receipt one of the session's (the person's words or a recorded result), not of a file? */
export const sessionStep = (r) => plain(r) && (r.side === 'session' || r.source === 'session');

/**
 * May a reader show this code receipt's quote? Only when it is found literally in the span the report stored with it,
 * on a side of the file (`new`, the file at review time; `old`, at the start commit) with a content hash, and — when
 * the report's list of the change's files records that side's hash — the same hash. The page never reads the
 * repository: the span is what the review read there, and code grounded the quote in it.
 */
export function codeReceiptFound(report, r) {
  if (!plain(r) || typeof r.quote !== 'string' || !r.quote || typeof r.span !== 'string' || !r.span.includes(r.quote)
      || typeof r.path !== 'string' || !r.path || !Number.isSafeInteger(r.startLine) || !Number.isSafeInteger(r.endLine)
      || !['new', 'old'].includes(r.side ?? 'new') || typeof r.sha256 !== 'string' || !SHA256.test(r.sha256)) return false;
  // D113 amended: a receipt in a file outside the evaluated session, by the record's list of them.
  const file = [...list(report?.codePass?.files), ...list(report?.codePass?.outsideFiles)]
    .find((f) => plain(f) && f.path === r.path);
  const sha = r.side === 'old' ? file?.baseSha256 : file?.sha256;
  return typeof sha !== 'string' || sha === r.sha256;
}

/** The order of the rows a code finding or a contradicted check may stand beside: the checklist's, your asks first. */
export const CODE_ROW_ORDER = Object.freeze(['requirements', 'promises', 'writtenClaims', 'findings', 'decisions',
  'pivots', 'failures']);
const rowAt = (report, ref) => (plain(ref) && CODE_ROW_ORDER.includes(ref.source) && Number.isSafeInteger(ref.index)
  && ref.index >= 0 && plain(list(report?.[ref.source])[ref.index]) ? { source: ref.source, index: ref.index } : null);
const byRow = (a, b) => CODE_ROW_ORDER.indexOf(a.source) - CODE_ROW_ORDER.indexOf(b.source) || a.index - b.index;
/** The row a finding sits beside: of the rows it follows from (`leadsFrom`) that the report holds, the first in the
 *  checklist's order (an ask before a claim, whatever order the review listed them in); null when it holds none. */
export const firstRowOf = (report, refs) => list(refs).map((ref) => rowAt(report, ref)).filter(Boolean).sort(byRow)[0]
  ?? null;

/**
 * What the code review found, in the order every reader shows it:
 *   beside    each row of the session review a published finding follows from (beside the first of its rows in the
 *             checklist's order: `firstRowOf`) or the code contradicts, in the checklist's order, with its findings;
 *   rest      the other findings, in table-of-contents order (by path, then line);
 *   questions the open questions for you;
 *   withheld  what the review proposed and its check withheld (null for an earlier report, which kept no text).
 * Pure: the page and the story share it.
 */
export function codeSectionPlan(report) {
  const rows = new Map();
  const at = (source, index) => {
    const key = `${source}:${index}`;
    if (!rows.has(key)) rows.set(key, { source, index, findings: [] });
    return rows.get(key);
  };
  for (const { source, row } of codeContradictedRows(report)) {
    const ref = rowAt(report, { source, index: list(report[source]).indexOf(row) });
    if (ref) at(ref.source, ref.index);
  }
  const rest = [];
  for (const f of codePassFindings(report)) {
    const ref = firstRowOf(report, f.leadsFrom);
    if (ref) at(ref.source, ref.index).findings.push(f);
    else rest.push(f);
  }
  const place = (f) => [plain(f.anchor) && typeof f.anchor.path === 'string' ? f.anchor.path : '\uffff',
    Number.isSafeInteger(f.anchor?.startLine) ? f.anchor.startLine : 0];
  rest.sort((a, b) => { const [pa, la] = place(a), [pb, lb] = place(b); return pa < pb ? -1 : pa > pb ? 1 : la - lb; });
  return { beside: [...rows.values()].sort(byRow), rest, questions: codePassQuestions(report),
    withheld: codeStepWithheld(report) };
}

/** The sentence a reader shows when no finding is published as confirmed: the review proposed none; or, of the
 *  findings it proposed, how many are items to verify (D110: Sonah could not confirm them), how many are open questions
 *  for you (its check found them real but not against what you asked) and how many its check withheld, and where each
 *  is listed; or, for a review that did not complete or an earlier report that
 *  kept no text of what it withheld, only that none was published. Counts of the plan's lists, never their words. */
export function codeNoFindingLine(pass, withheld, questions = [], unconfirmed = []) {
  if (withheld === null || pass?.coverage === 'missing' || pass?.ran !== true) return W.noFindings;
  const findings = withheld.filter((w) => w.what === WITHHELD_FINDING).length;
  const asked = list(questions).filter((q) => plain(q?.finding)).length;
  // D110: the findings Sonah could not confirm are items of the report, to verify.
  const toVerify = list(unconfirmed).length;
  return findings || asked || toVerify ? W.notPublished(findings, asked, toVerify) : W.proposedNone;
}

/** The fixed words of why an item was withheld: its reason, the refutation's reason when its check refuted it, and the
 *  closed cause when there is one; for an item in whose place no item of the repair stood (its `repair`, a
 *  CODE_REPAIR_UNCHECKED member, or an earlier report's member that `unrepaired` keeps), the reason without "even after
 *  one repair", then why (what code compared, by what the item is: none said for an item that is neither a finding nor a
 *  question). D113 amended (its review): for an ask not met or a claim the code contradicts that is out of scope and
 *  tagged outside the evaluated session, its kind's tie (`outsideTie`) in place of the reason and its cause. */
export function withheldWhy(w) {
  if (!Object.hasOwn(W.withheldReasons, w?.reason)) return null;
  const unchecked = typeof w.repair === 'string' && Object.hasOwn(W.unrepaired, w.repair);
  const words = unchecked ? W.unrepaired[w.repair] : null;
  const why = typeof words === 'string' ? words
    : plain(words) && typeof w.what === 'string' && Object.hasOwn(words, w.what) ? words[w.what] : null;
  // D113 amended (its review): a finding of a tie kind anchored in a file outside the evaluated session is out of scope
  // as a tie, whatever lines its trace runs through: said so by its kind (`outsideTie`), with no cause of the scope.
  const tie = w.reason === OUT_OF_SCOPE && w.outsideSession === true && Object.hasOwn(W.outsideTie, w.kind)
    ? W.outsideTie[w.kind] : null;
  const reason = tie ?? (unchecked && Object.hasOwn(W.unrepairedReasons, w.reason) ? W.unrepairedReasons[w.reason]
    : W.withheldReasons[w.reason]);
  const refuted = w.reason === VERIFY_REFUTED && plain(w.check) && Object.hasOwn(W.refutations, w.check.reason)
    ? `: ${W.refutations[w.check.reason]}` : '';
  const cause = tie === null && typeof w.cause === 'string' && Object.hasOwn(W.causes, w.cause)
    && W.causes[w.cause] !== reason ? ` (${W.causes[w.cause]})` : '';
  return `${reason}${refuted}${cause}${why !== null ? `, and ${why}` : ''}`;
}

// ---- coverage and the footer ----------------------------------------------------------------------------------------

const clipPath = (path, n = 120) => {
  const points = [...String(path).replace(/\s+/g, ' ')];
  if (points.length <= n) return points.join('');
  const name = [...points.join('').slice(points.join('').lastIndexOf('/') + 1)];
  if (name.length + 2 >= n) return `…${name.slice(-(n - 1)).join('')}`;
  return `${points.slice(0, n - name.length - 2).join('')}…/${name.join('')}`;
};

/** The footer's entries, each `{ kind, path?, part?, count?, state? }`: the report's list as it stands, or an earlier
 *  report's footer object (`{ listed_by_name, clipped, withheld, failed }`) read the same way. */
function footerEntries(footer) {
  if (Array.isArray(footer)) return footer.filter((e) => plain(e) && typeof e.kind === 'string');
  if (!plain(footer)) return [];
  const [LISTED, CLIPPED, WITHHELD, FAILED] = ['listed_by_name', 'clipped', 'withheld', 'failed'];
  return [...list(footer[LISTED]).map((path) => ({ kind: LISTED, path })),
    ...list(footer[CLIPPED]).map((path) => ({ kind: CLIPPED, path })),
    ...list(footer[WITHHELD]).filter(plain).map((w) => ({ kind: WITHHELD, path: w.path, state: w.state })),
    ...list(footer[FAILED]).filter(plain).map((x) => ({ ...x, kind: FAILED }))];
}

/**
 * What the code review did not cover, as reader lines (after PR-Agent's), one per footer kind in the word
 * table's order: the files whose change was too large for the request, the other files whose change it did not show
 * (with their states, from the change's list of files; a recorded write outside the working directory that lies in the
 * repository among them), and after them the files whose change it showed that changed after the session's last
 * recorded edit (a fact, `changedSince`: in a report that keeps what its check withheld, a file of the change whose
 * state is `changed_since_session` and that the footer does not name as not shown), the calls that did not answer (by
 * part, counted), the writes outside the repository (counted), whether the repository changed while the review ran;
 * then an earlier report's count of differing paths outside the working directory and its home-folder line; then (F3b,
 * D111) per scope of the accounting, your asks, the statements the agent wrote into a file and its decisions not to act
 * that the code review's item-by-item check did not examine in a way that Sonah could use (`unaccounted`, counted; never
 * the ones it examined). A path
 * is named once. None when everything was covered: a reader then shows no footer at all, never an all-clear.
 */
export function codeFooterLines(report, { session = null } = {}) {
  const pass = report?.codePass;
  // D109: with the review request's manifest, the files the code review did not see are the one tally's (`codeChangeTally`),
  // each named once with its state: those left out for room under `clipped`, the others under `withheld`; the record's
  // footer gives the rest (calls, writes outside, the repository changing). An earlier report's footer, as it was.
  const tally = codeChangeTally(pass);
  const fromTally = tally !== null && tally.sent === true;
  // D109 (its review): a review whose call did not answer and shows no sign that it read its request names no file, as
  // one too large to send: the coverage line says it of them all, and the footer names the call.
  const unseenUnits = fromTally && tally.answered === true ? tally.groups.not_seen : [];
  const entries = [...(fromTally ? unseenUnits.map((u) => ({ kind: u.state === LEFT_OUT_STATE ? 'clipped'
    : FOOTER_WITHHELD, path: u.path, state: u.state })) : []), ...footerEntries(pass?.footer)
    .filter((e) => !fromTally || ![FOOTER_WITHHELD, 'clipped'].includes(e.kind))];
  const files = list(pass?.files).filter((f) => plain(f) && typeof f.path === 'string');
  const stateOf = new Map(files.map((f) => [f.path, f.state]));
  const clipped = new Set(entries.filter((e) => e.kind === 'clipped').map((e) => e.path));
  const unshown = new Set(entries.filter((e) => e.kind === FOOTER_WITHHELD || e.kind === 'clipped').map((e) => e.path));
  const changedSince = Array.isArray(pass?.withheld) ? [...new Set(files.filter((f) => f.state === CHANGED_SINCE_SESSION
    && !unshown.has(f.path)).map((f) => f.path))] : [];
  const lines = [];
  for (const [kind, line] of Object.entries(W.footerKinds)) {
    const mine = entries.filter((e) => e.kind === kind && !(kind === FOOTER_WITHHELD && clipped.has(e.path)));
    if (mine.length) {
      const named = [...new Set(mine.map((e) => e.path).filter((p) => typeof p === 'string' && p))];
      const paths = named.map((p) => clipPath(p));
      const stateFor = (e) => e.state ?? stateOf.get(e.path);
      // D109: a file the request named by its hunks with none of its lines, unseen, is counted by its own words, so the
      // states always sum to the files the line names.
      const states = [...Object.keys(W.states).map((state) => [W.states[state], mine.filter((e) => stateFor(e) === state)
        .length]), ...(fromTally && kind === FOOTER_WITHHELD ? [[W.unseenShown, mine.filter((e) => e.state === SHOWN)
        .length]] : [])].filter(([, n]) => n > 0);
      const partOf = (x) => x.part ?? x.step;
      const parts = [...new Set(mine.filter((x) => Object.hasOwn(W.parts, partOf(x))).map((x) => (partOf(x) === 'lens'
        && Object.hasOwn(W.lenses, x.lens) ? `${W.parts.lens} ${W.lenses[x.lens]}${Number.isSafeInteger(x.group)
          ? ` (part ${x.group})` : ''}` : W.parts[partOf(x)])))];
      const count = mine.reduce((n, e) => n + (Number.isSafeInteger(e.count) && e.count > 0 ? e.count : 1), 0);
      const home = mine.reduce((n, e) => n + (Number.isSafeInteger(e.home) && e.home > 0 ? e.home : 0), 0);
      const total = Math.max(named.length, states.reduce((k, [, m]) => k + m, 0));
      if (!((kind === 'listed_by_name' || kind === 'clipped') && !paths.length))
        lines.push(line({ paths, states, parts, count, n: total, home }));
    }
    if (kind === FOOTER_WITHHELD && changedSince.length)
      lines.push(W.changedSince(changedSince.map((p) => clipPath(p))));
    // D105: after the files it did not see, the files it saw short of whole.
    if (kind === FOOTER_WITHHELD) lines.push(...codeSeenLines(pass));
  }
  const outside = pass?.base?.outside;
  if (Number.isSafeInteger(outside) && outside > 0) lines.push(W.outsideLine(outside));
  if (pass?.base?.homeRepository === true)
    lines.push(W.homeLine(Number.isSafeInteger(pass.base.unrecorded) && pass.base.unrecorded > 0 ? pass.base.unrecorded : 0));
  // F3b (D111): the items in scope that the item-by-item check did not examine in a way that Sonah could use, one line
  // per scope, counted; the asks one line per source (`unaccountedAsks`), summing to the footer's count.
  for (const [scope, line] of Object.entries(W.unaccounted)) {
    const count = entries.filter((e) => e.kind === UNACCOUNTED && e.scope === scope && Number.isSafeInteger(e.count)
      && e.count > 0).reduce((n, e) => n + e.count, 0);
    if (count > 0 && typeof line === 'function') lines.push(line(count));
    else if (count > 0) for (const [by, n] of unaccountedAsks(report, count, session)) lines.push(line[by](n));
  }
  return lines;
}

const [, , , NOT_EXAMINED_FATE, MISSING_FATE] = CODE_ACCOUNT_FATES;
const ASKED_BY_OTHER = CODE_ACCOUNT_ASK_SOURCES.at(-1);
/**
 * D111 amended (2026-10-18): the footer's count of asks that the item-by-item check did not examine in a way that Sonah
 * could use, split by whose words each rests on (ledger.js CODE_ACCOUNT_ASK_SOURCES, in its order, as `[source, n]`):
 * each counted entry of the accounting's record (`codePass.account.entries`, scope `ask`, fate `not_examined` or
 * `missing`) by the ask row it names (`ref`, a row of `report.requirements`) and the recorded event its instruction
 * receipt cites (code-context.js `askSourceOf`, with `session`). With no session, a row it cannot name, or entries that
 * do not sum to the footer's `count`, the asks that cannot be told apart are counted as `other`, never as yours: the
 * parts always sum to `count`. Structure only. Pure.
 */
function unaccountedAsks(report, count, session) {
  const rows = list(report?.requirements);
  const counted = list(report?.codePass?.account?.entries).filter((e) => plain(e) && e.scope === 'ask'
    && [NOT_EXAMINED_FATE, MISSING_FATE].includes(e.fate));
  const bySource = new Map(CODE_ACCOUNT_ASK_SOURCES.map((by) => [by, 0]));
  if (counted.length === count) for (const e of counted) {
    const row = plain(e.ref) && e.ref.source === 'requirements' && Number.isSafeInteger(e.ref.index) ? rows[e.ref.index]
      : null;
    const by = session && plain(row) ? askSourceOf(session, row.instruction) : ASKED_BY_OTHER;
    bySource.set(by, bySource.get(by) + 1);
  } else bySource.set(ASKED_BY_OTHER, count);
  return [...bySource].filter(([, n]) => n > 0);
}

/**
 * D105 (F2 part A4): what the code review saw short of whole, as footer lines — the files of the change it saw only in
 * part (the lines named), those it saw only where the change touched them, those it saw whole as they are now but not
 * as they were before (its change not seen: the request did not show their hunks' earlier rows), the rule and skill
 * files it saw only in part or not at all, and the files it read with no lines Sonah could read (never said unseen) — a
 * pure function of the request's manifest and the review's reading record (code-pass.js `codeSeenOf`). None for a file
 * whose change it saw whole, none for a request too large to send (the coverage line says it), and none for an earlier
 * report, which kept neither. A file the review did not see at all is named by the footer's own kinds.
 */
export function codeSeenLines(pass) {
  const tally = codeChangeTally(pass);
  if (tally === null || tally.sent !== true || tally.answered !== true) return [];
  const seen = codeSeenOf(pass);
  const withLines = (x) => `${clipPath(x.path)} (${W.linesOf(x.lines, x.total)})`;
  const of = (units, state) => units.filter((x) => x.state === state && typeof x.path === 'string');
  // D109: the files' lines are the one tally's groups, so each counts what the coverage line counts.
  const { in_part: inPart, hunks_only: hunks, whole_not_before: wholeOnly, lines_unknown: unknown } = tally.groups;
  const [rulesInPart, rulesNot, rulesUnknown] = [of(seen.rules, SEEN_IN_PART), of(seen.rules, NOT_SEEN),
    of(seen.rules, LINES_UNKNOWN)];
  return [...(inPart.length ? [W.seenInPart(inPart.map(withLines))] : []),
    ...(hunks.length ? [W.hunksOnly(hunks.map((x) => clipPath(x.path)))] : []),
    ...(wholeOnly.length ? [W.wholeNotBefore(wholeOnly.map((x) => clipPath(x.path)))] : []),
    ...(rulesInPart.length ? [W.rulesInPart(rulesInPart.map(withLines))] : []),
    ...(rulesNot.length ? [W.rulesNotSeen(rulesNot.map((x) => clipPath(x.path)))] : []),
    ...(unknown.length ? [W.linesUnknown(unknown.map((x) => clipPath(x.path)))] : []),
    ...(rulesUnknown.length ? [W.rulesLinesUnknown(rulesUnknown.map((x) => clipPath(x.path)))] : [])];
}

/** D109 amended (2026-10-18): how many of the files of the change the code review did not see its checks read (the one
 *  tally's `checksRead`; none for a request too large to send, a review that did not answer, or an earlier report). */
export function codeUnseenReadByChecks(pass) {
  const tally = codeChangeTally(pass);
  return tally !== null && tally.sent === true && tally.answered === true
    ? tally.groups.not_seen.filter((u) => u.checksRead === true).length : 0;
}

/** How many files of the change the code review did not see (the page's header counts them). D109: the one tally's
 *  (`codeChangeTally`; every file of a request too large to send, D105), the count the coverage line says; an earlier
 *  report's, the distinct paths its footer names as not shown. */
export function codeUnseenFiles(pass) {
  const tally = codeChangeTally(pass);
  if (tally !== null) return tally.groups.not_seen.length;
  const named = list(pass?.footer).filter((e) => plain(e) && [FOOTER_WITHHELD, 'clipped'].includes(e.kind));
  return new Set(named.map((e) => e.path).filter((p) => typeof p === 'string')).size;
}

/**
 * D109 (its review): the paragraph that says how the code review works (`how`), only where the record shows each of its
 * sentences true: the step ran as one review agent that could open, search and list the repository, with its checking
 * agents (a code step before code-pass/7 kept no record of such an agent, `agent`, and worked another way), and the
 * code review read what Sonah sent it. With the review request's manifest, the one tally says so (`codeChangeTally`'s
 * `answered`: the request sent, with a sign that the review read it); a request too large to send, or a call that did
 * not answer with no turn, tool call or read recorded, holds none. With no manifest (a report written before D105, or a
 * change with nothing to review): the review agent's request ended in a reply (`agent.terminal` `answered` or
 * `unusable`), or in a failed call after which its record counts a turn, a tool call or a read; never `not_sent`, no
 * change to review. Else null: the coverage line then says what became of the review. Structure only. Pure.
 */
export function codeHowLine(pass) {
  if (pass?.ran !== true) return null;
  // D152: under the tie rule, the paragraph says that the check judges truth only.
  const how = tieRuled(pass) ? W.howTied : W.how;
  const tally = codeChangeTally(pass);
  if (tally !== null) return tally.answered === true ? how : null;
  if (!plain(pass.agent)) return null;
  const counted = (n) => Number.isSafeInteger(n) && n > 0;
  const { terminal, turns, tools, reads } = pass.agent;
  const acted = counted(turns) || counted(reads) || (plain(tools) && Object.values(tools).some(counted));
  return terminal === REVIEW_ANSWERED || terminal === REVIEW_UNUSABLE || (terminal === REVIEW_FAILED && acted)
    ? how : null;
}

/** D109: the line after `how` that says what the records show of the open questions' checks: of the questions the code
 *  step published, how many carry a check record (a question routed from a finding carries its finding's check). None
 *  when it published none, or did not run. */
export function codeQuestionsLine(pass) {
  if (pass?.ran !== true) return null;
  const published = list(pass.questions).filter(plain);
  if (!published.length) return null;
  return W.questionsChecked(published.filter((q) => plain(q.check)).length, published.length);
}

/** D109: the line that says where the change runs from (`base`): with a git base, and when the one tally holds files no
 *  recorded edit of the session wrote, that it can hold work done after the session, and how many. D113: a record of
 *  code-snapshot/13 (code-pass.js `sessionChangeOf`, its `changedOutside`) says that the change holds only files that a
 *  recorded write of the session could have changed, or how many of them no such write changed, each last changed while
 *  the session ran (`ownBase`); the files that changed outside both are named apart (`codeChangedOutsideLine`). */
export function codeBaseLine(pass) {
  // D113's review: a change with no file to review runs from nowhere to nothing: no base line (`codeNoChangeOf`).
  if (!plain(pass?.base) || pass.ran !== true || codeNoChangeOf(pass) !== null) return null;
  const commit = pass.base.kind === 'git' && typeof pass.base.commit === 'string' ? pass.base.commit : null;
  const tally = codeChangeTally(pass);
  // D117: with files of the change in another repository or folder, the line speaks of the working directory's
  // repository alone (`here`), counting its files; none when it holds none (each other place has its own line).
  const elsewhere = placesOf(pass.base).filter((p) => filesOfPlace(pass, tally, p.at) > 0).length > 0;
  const own = elsewhere && tally !== null ? tally.units.filter((u) => typeof u.place !== 'string') : tally?.units ?? [];
  if (elsewhere && filesOfPlace(pass, tally, null) === 0) return null;
  const [unrecorded, total] = commit ? [own.filter((u) => u.recorded === false).length, own.length] : [0, 0];
  if (commit && Array.isArray(sessionChangeOf(pass.base).changedOutside))
    return W.ownBase(commit, unrecorded, total, elsewhere);
  return W.base(commit, unrecorded, total, elsewhere);
}

/** D117: how many files of the change lie in one place (`at`, a place's folder; null for the working directory's
 *  repository): the one tally's (`tally`), or with no review request the record's files there that have a diff. */
function filesOfPlace(pass, tally, at) {
  const of = (x) => (typeof x?.place === 'string' ? x.place : null) === at;
  return tally !== null ? tally.units.filter(of).length
    : list(pass?.files).filter((f) => plain(f) && of(f) && typeof f.type === 'string').length;
}

/**
 * D117: the lines that say where the change runs from in each other repository or folder the session wrote to (the
 * record's `base.places`, in their order: code-pass.js `placesOf`), after the working folder's base line — a git
 * repository's base commit (`placeBase`), or the recorded edits (`placeEdits`) — each with the files of the change there
 * (the one tally's, or with no review request the record's files of that place that have a diff; how many of them no
 * recorded write changed), then the files of a git repository that changed outside this session's recorded writes, named
 * apart, outside the evaluated session (`placeChangedOutside`, or `placeOutsideFiles` when the code review was given
 * them and answered; at most CODE_REPORT_LIMITS.changedOutsideNames by name). None for a step that did not
 * run or a record with no other place; a change with no file to review says only the files named apart, as the working
 * directory's (`codeChangedOutsideLine`). D124: a repository given with --code-repo (`given`) always has its base line,
 * with its count of files of the change, none included. D124's review (its low): the working folder's own repository
 * given (the record's `base.given`) is said first, as read by its own rule (`givenHere`), with or without a change.
 * Fixed words, counts and paths. Pure.
 */
export function codePlaceLines(pass) {
  if (pass?.ran !== true) return [];
  const here = plain(pass.base) && pass.base.given === true ? [W.givenHere] : [];
  const places = placesOf(pass.base);
  if (!places.length) return here;
  // A change with no file to review runs from nowhere to nothing: no base line; what changed elsewhere is still named.
  const empty = codeNoChangeOf(pass) !== null;
  const tally = codeChangeTally(pass);
  // D113 amended: the files named apart there were given to the code review after the session's own change, and it
  // answered (`outsideTally`), as the working directory's (`codeChangedOutsideLine`).
  const given = outsideTally(pass) !== null;
  return [...here, ...places.flatMap((p) => {
    const n = empty ? 0 : filesOfPlace(pass, tally, p.at);
    const unrecorded = tally !== null ? tally.units.filter((u) => u.place === p.at && u.recorded === false).length : 0;
    const named = list(p.changedOutside).slice(0, CODE_REPORT_LIMITS.changedOutsideNames);
    // D124: a repository the person gave with --code-repo is named with its count, none included, so the person learns
    // what Sonah found there.
    return [...(n === 0 && p.given !== true ? [] : p.kind === 'git' ? [W.placeBase(p.at, p.commit, n, unrecorded)]
      : [W.placeEdits(p.at, n, p.repository === true)]),
    ...(named.length ? [(given ? W.placeOutsideFiles : W.placeChangedOutside)(p.at, named.map((x) => clipPath(x)),
      list(p.changedOutside).length - named.length)] : [])];
  })];
}

/**
 * D117 amended (the owner, 2026-10-18: "review the session's writes in any git repository; files outside any repository
 * are listed, not reviewed; paths that hold an unexpanded $VARIABLE are never counted; the page says plainly that edits
 * made by helper agents or by scripts after cd are not seen yet"): the code review's notes after the places' lines — the
 * folders in no repository the session wrote to, listed with their counts (`folders`, at most
 * CODE_REPORT_LIMITS.changedOutsideNames by name), the writes not resolved, counted (`unresolved`), and, when the
 * session ran a shell command (the record's `unseenEdits`), the one fixed sentence that says such
 * edits can be missing (`unseenEdits`). Each also with an empty change; none for a step that did not run or an earlier
 * record. Fixed words, counts and paths. Pure.
 */
export function codeWritesLines(pass) {
  if (pass?.ran !== true) return [];
  const folders = foldersOf(pass.base);
  const shown = folders.slice(0, CODE_REPORT_LIMITS.changedOutsideNames);
  const unresolved = unresolvedOf(pass.base);
  return [...(folders.length ? [W.folders(folders.reduce((n, f) => n + f.written, 0), shown.map((f) => [clipPath(f.at),
    f.written]), folders.length - shown.length)] : []), ...(unresolved > 0 ? [W.unresolved(unresolved)] : []),
  ...(pass.unseenEdits === true ? [W.unseenEdits] : [])];
}

/** D113's review: the display bound of the line that names the files that changed outside this session's recorded
 *  writes — a later merge can leave thousands — frozen: the first names in code-unit order, then how many more. The
 *  record keeps every path. */
export const CODE_REPORT_LIMITS = Object.freeze({ changedOutsideNames: 10 });

/** D113 amended: the one tally's part of the files outside the evaluated session (code-pass.js `codeChangeTally`'s
 *  `outside`) when the code review was given them and shows a sign that it read its request (`answered`); else null. */
function outsideTally(pass) {
  const tally = codeChangeTally(pass);
  return tally !== null && plain(tally.outside) && tally.sent === true && tally.answered === true ? tally.outside : null;
}

/** D113: the line that names the files that differ from the start commit that no recorded write of the session touched
 *  (code-pass.js `sessionChangeOf`): no part of the change, so Sonah did not review them; at most
 *  CODE_REPORT_LIMITS.changedOutsideNames of them by name, the others counted. None when there are none, the step did
 *  not run, or the record is an earlier snapshot's. D113 amended: each said outside the evaluated session; when the code
 *  review was given them after the session's own change and answered (`outsideTally`), the line says so
 *  (`outsideFiles`) and `codeOutsideSeenLine` says what it saw of them; else that Sonah did not review them. */
export function codeChangedOutsideLine(pass) {
  if (pass?.ran !== true) return null;
  const paths = list(sessionChangeOf(pass.base).changedOutside);
  const names = paths.slice(0, CODE_REPORT_LIMITS.changedOutsideNames);
  if (!paths.length) return null;
  return (outsideTally(pass) !== null ? W.outsideFiles : W.changedOutside)(names.map((p) => clipPath(p)),
    paths.length - names.length);
}

/** D113 amended: what the code review saw of the files outside the evaluated session, by the one tally's part of them
 *  (`outsideTally`): each group's count, and the files it did not see, summing to them all. None when it was not given
 *  them, did not answer, or the record is an earlier one. */
export function codeOutsideSeenLine(pass) {
  if (pass?.ran !== true) return null;
  const outside = outsideTally(pass);
  if (outside === null || !outside.total) return null;
  const seen = Object.entries(outside.groups).filter(([group, units]) => group !== 'not_seen' && units.length)
    .map(([group, units]) => [group, units.length]);
  return W.outsideSeen(seen, outside.groups.not_seen.length);
}

/**
 * D113's review: whether the code step's change holds no file to review, and why — the one test every reader of an
 * empty change shares (the coverage line, `codeCoverageLines`; the base line, `codeBaseLine`; the report model's line
 * of findings; the terminal's run-state line, cli session-review-command.js `runStateLine`), so the terminal and the
 * page never disagree. Null when the step did not run or its change holds a file, as the coverage line counts it: the
 * one tally's files (`codeChangeTally`); with no manifest, the files of the change, a write outside the working
 * directory among them only when the footer names it as one the review did not see; for an earlier report that kept
 * no list of what it withheld, any file it listed. Else the key of CODE_REPORT_WORDS that says why: an earlier
 * record's `noFile`; by the session's own change (code-pass.js `sessionChangeOf`), no recorded write at all
 * (`noWrite`; D123: `noSeenWrite` when the session ran a shell command, the record's `unseenEdits`), writes but none in
 * the change beside files that changed outside them (`noWrittenChange`), or none of either (`noFile`). Pure.
 */
export function codeNoChangeOf(pass) {
  if (pass?.ran !== true) return null;
  const files = list(pass.files).filter(plain);
  let empty;
  if (!Array.isArray(pass.withheld)) empty = !files.length;
  else {
    const tallied = codeChangeTally(pass);
    if (tallied !== null) empty = !tallied.total;
    else {
      const unshown = new Set(footerEntries(pass.footer).filter((e) => e.kind === FOOTER_WITHHELD).map((e) => e.path));
      empty = !files.some((f) => f.state !== OUTSIDE_ROOT || unshown.has(f.path));
    }
  }
  if (!empty) return null;
  const own = sessionChangeOf(pass.base);
  if (!Number.isSafeInteger(own.written)) return NO_CHANGE_FILE;
  // D123: no recorded write, but the session ran a shell command (the record's `unseenEdits`, code-pass.js
  // `mayMissEdits`): a script's writes are none that Sonah sees, so never `noWrite`.
  if (own.written === 0) return pass.unseenEdits === true ? NO_CHANGE_SEEN_WRITE : NO_CHANGE_WRITE;
  return list(own.changedOutside).length ? NO_CHANGE_WRITTEN : NO_CHANGE_FILE;
}
/** The keys `codeNoChangeOf` returns: each a key of CODE_REPORT_WORDS and of the terminal's
 *  RUN_STATE_WORDS.codePass. */
export const CODE_NO_CHANGE_KEYS = Object.freeze(['noWrite', 'noWrittenChange', 'noFile', 'noSeenWrite']);
const [NO_CHANGE_WRITE, NO_CHANGE_WRITTEN, NO_CHANGE_FILE, NO_CHANGE_SEEN_WRITE] = CODE_NO_CHANGE_KEYS;

const [STEP_OFF, NOT_RUN_BACKEND, NO_FOLDER, NO_WRITE, NO_SEEN_WRITE, NO_SEEN_WRITE_GIVEN, NO_WRITTEN_CHANGE, NO_FILE,
  NONE_SHOWN, NOT_SENT, NO_ANSWER, NONE_SEEN, UNKNOWN_WHY] = CODE_NOT_REVIEWED_REASONS;
/** D122: the code step's version that began to keep its review request's manifest (D105). A record that names an earlier
 *  one (`version.pass`) and made no review request does not say why. */
const MANIFEST_SINCE = 12;
const beforeManifest = (pass) => {
  const version = /^sonah\.code-pass\/(\d+)$/.exec(typeof pass?.version?.pass === 'string' ? pass.version.pass : '');
  return version !== null && Number(version[1]) < MANIFEST_SINCE;
};
/** `codeNoChangeOf`'s key, as a reason of CODE_NOT_REVIEWED_REASONS. */
const NO_CHANGE_REASON = Object.freeze({ [NO_CHANGE_WRITE]: NO_WRITE, [NO_CHANGE_SEEN_WRITE]: NO_SEEN_WRITE,
  [NO_CHANGE_WRITTEN]: NO_WRITTEN_CHANGE, [NO_CHANGE_FILE]: NO_FILE });
/**
 * D118 (a), the owner's go of 2026-10-18 ("cool go for it"; the dogfood's DF2): why the code step reviewed no code — it
 * made no review call, or its review read no file — as one closed reason (ledger.js CODE_NOT_REVIEWED_REASONS); null when
 * it reviewed code, or when its record cannot say. The one test every first screen reads (the report model's header, the
 * terminal's run-state lines, the PR comment), so none of them disagrees with another. No code pass record: `step_off`.
 * A step that did not run: by its gap as `codeCoverageLines` says it (`backend`), else `no_folder`. A change with no file
 * to review: by `codeNoChangeOf`; D124's review (its medium): `no_seen_write_given` in place of `no_seen_write` when the
 * record names a repository that the person gave with --code-repo (code-pass.js `repositoriesGiven`), whose words never
 * tell them to give one again. Else by the one tally (code-pass.js `codeChangeTally`): a request not sent
 * (`too_large`), one sent with no sign that its call read it (`no_answer`), or an answer with every file of the change
 * not seen (`none_seen`). With no tally (no review request was planned), the step's own count of review requests
 * (`calls.review`): none, so a change of files none of whose changed lines it could show (`none_shown`); D122: but a
 * record of a code step from before the request's manifest (`version.pass` below `sonah.code-pass/12`) does not say why,
 * since that step could also drop a request too large to send (`unknown`). A record that
 * holds neither (written before both) cannot say what its review read: null, so no reader says more than the record
 * holds. Structure only. Pure.
 */
export function codeNotReviewedOf(pass) {
  if (!plain(pass)) return STEP_OFF;
  if (pass.ran !== true) return list(pass.gaps).map((g) => (plain(g) ? g.code : g))
    .some((code) => Object.hasOwn(W.notRun, code)) ? NOT_RUN_BACKEND : NO_FOLDER;
  const none = codeNoChangeOf(pass);
  if (none !== null) return none === NO_CHANGE_SEEN_WRITE && repositoriesGiven(pass.base) ? NO_SEEN_WRITE_GIVEN
    : NO_CHANGE_REASON[none];
  const tally = codeChangeTally(pass);
  if (tally === null) return !plain(pass.calls) || pass.calls.review !== 0 ? null
    : beforeManifest(pass) ? UNKNOWN_WHY : NONE_SHOWN;
  if (tally.sent !== true) return NOT_SENT;
  if (tally.answered !== true) return NO_ANSWER;
  return tally.groups.not_seen.length === tally.total ? NONE_SEEN : null;
}

/**
 * D118 (a), one definition every reader of a report reads (D122, a review low of D118): why the report's review read no
 * code (CODE_NOT_REVIEWED_REASONS), or null. The code pass record's own reason (`codeNotReviewedOf`); but a report that
 * holds no code pass record and whose effective scope is not session-only (ledger.js `honestStatuses`: a combined pull
 * request review, an earlier route, whose own code review its run words name) is none, as is one whose statuses cannot
 * be read. The report model's first screen, the terminal's run state and coverage lines, the PR comment and the GitHub
 * check's title all read this, so none says what another does not. Structure only. Pure.
 */
export function reportNotReviewedOf(report) {
  if (!plain(report)) return null;
  if (report.codePass === undefined) {
    let scope = null;
    try { scope = honestStatuses({ ...report, findings: list(report.findings) }).reviewScope; } catch { scope = null; }
    if (scope !== 'session-only') return null;
  }
  return codeNotReviewedOf(report.codePass);
}

/**
 * The coverage of the code review and its checks, as every reader says it (F3b, D111's second review): the record's
 * coverage, except one short of complete only by the accounting — the accounting's record keeps the review's own
 * coverage (`account.reviewCoverage`) complete, and the footer counts an item in scope that the item-by-item check did
 * not examine in a way that Sonah could use — which is the review's own, `complete`. Those counts are no part of what
 * the code review did not finish or cover: every call can have answered, and a published finding can follow from a
 * counted item. So no reader says either of it; the counts say what the item-by-item check left. The record's coverage
 * stays partial (I10), and so does the exit code it decides. Pure.
 */
export function codeReviewCoverage(pass) {
  const counted = footerEntries(pass?.footer).some((e) => e.kind === UNACCOUNTED && Number.isSafeInteger(e.count)
    && e.count > 0);
  return pass?.coverage === 'partial' && plain(pass.account) && pass.account.reviewCoverage === 'complete' && counted
    ? 'complete' : pass?.coverage;
}

/**
 * The code review's coverage lines, the same on every reader: that it did not run (why, by its gap, when the report
 * names one: else no working directory here) or had no change to review; else (D109) how many files the change covers
 * and how many of them the review saw whole, whole but not as before, in part, only where the change touched them, in
 * lines Sonah could not tell, and not at all — the one tally's groups, summing to the whole (a report written before
 * D105: how many it saw the change of, from what the request showed, the others by closed state); or, for a request too
 * large to send, that the review did not run; and, when it ran short of complete by its own coverage
 * (`codeReviewCoverage`), that it did not finish or did not complete. D113: a change with no file to review is said by
 * the session's own change (`codeNoChangeOf`). Fixed words and counts.
 */
/**
 * D149: the line of a review of several units (`manifest.units`), from its hunk ledger (`manifest.hunks`): how many files
 * of the change had every hunk shown by a sent request (`shownIn`), in how many calls (the units' requests sent), and the
 * others by why (each file by the first closed reason of its ledger: its file state's words, or `block_cap` as too large
 * for one call, `request_bound` as left out for room, `unit_cap` as past the calls one review makes). None for a review
 * of one request, whose words are as before. Pure.
 */
export function codeUnitsLines(pass) {
  const units = pass?.manifest?.units;
  if (!Array.isArray(units)) return [];
  const byPath = new Map();
  for (const e of list(pass.manifest.hunks).filter(plain)) byPath.set(e.path, [...(byPath.get(e.path) ?? []), e]);
  const reasonWords = { block_cap: W.states.oversize, request_bound: W.states.left_out, unit_cap: W.unitCap };
  // D149: the generated, vendored and lock files (each unit's `generated`, by its files), counted apart.
  const generatedPaths = new Set(units.filter((u) => plain(u) && Array.isArray(u.generated) && Array.isArray(u.paths))
    .flatMap((u) => u.paths));
  let shown = 0, generated = 0;
  const reasons = new Map();
  for (const [path, entries] of byPath) {
    const missing = entries.find((e) => !Array.isArray(e.shownIn) || e.shownIn.length === 0);
    if (!missing) { if (generatedPaths.has(path)) generated += 1; else shown += 1; continue; }
    const words = reasonWords[missing.closed] ?? W.states[missing.closed] ?? W.states.unreadable;
    reasons.set(words, (reasons.get(words) ?? 0) + 1);
  }
  return [W.units(shown, units.filter((u) => plain(u) && u.sent === true).length, [...reasons], generated)];
}

export function codeCoverageLines(pass) {
  const files = list(pass?.files).filter(plain);
  if (pass?.ran !== true) {
    const gap = list(pass?.gaps).map((g) => (plain(g) ? g.code : g)).find((code) => Object.hasOwn(W.notRun, code));
    return [gap ? W.notRun[gap] : W.noRoot];
  }
  // D113 (its review): a change with no file to review, by the session's own change (`codeNoChangeOf`).
  const none = codeNoChangeOf(pass);
  if (none !== null) return [W[none]];
  const own = codeReviewCoverage(pass);
  const coverage = Object.hasOwn(W.coverage, own) ? [W.coverage[own]] : [];
  const tally = (rest) => Object.keys(W.states).map((state) => [state, rest.filter((f) => f.state === state).length])
    .filter(([, n]) => n > 0).map(([state, n]) => `${n} ${W.states[state]}`).join(', ');
  // An earlier report (no `withheld` list) listed the files the session read beside the change's: its own words.
  if (!Array.isArray(pass.withheld)) {
    const shown = files.filter((f) => f.state === SHOWN);
    return [W.earlierFiles(shown.length, files.length, tally(files.filter((f) => f.state !== SHOWN))), ...coverage];
  }
  const unshown = new Set(footerEntries(pass.footer).filter((e) => e.kind === FOOTER_WITHHELD).map((e) => e.path));
  // D109: a report with the review request's manifest counts from the one tally of it and the review's reading record
  // (code-pass.js `codeChangeTally`): the change is every path of the manifest (a recorded write the change block does
  // not hold that lies in a folder the review can read among them; one outside every such folder is no part of it, and
  // the footer counts it), each in exactly one group — seen whole, whole as it is now but not as it was before, in part,
  // only where the change touched it, in lines Sonah could not tell, or not seen — the groups summing to the whole and
  // each counted as the footer's line of it counts it. A request too large to send — never "saw", never a call that did
  // not answer.
  const tallied = codeChangeTally(pass);
  if (tallied !== null) {
    // D117: with files in more than one place, where they lie, each place's files counted (and, when the review
    // answered, how many of them it did not see), summing to the whole.
    const answered = tallied.sent === true && tallied.answered === true;
    const where = list(tallied.places).length > 1 ? tallied.places.map((p) => W.filesWhere(p.total, p.place,
      answered ? p.notSeen : 0, pass.base?.kind === 'git')) : [];
    if (tallied.sent !== true) return [W.tooLarge(tallied.total), ...where];
    if (tallied.answered !== true) return [W.noAnswer(tallied.total), ...where, ...coverage];
    const seen = Object.entries(tallied.groups).filter(([group, units]) => group !== 'not_seen' && units.length)
      .map(([group, units]) => [group, units.length]);
    return [...codeUnitsLines(pass), W.files(tallied.total, seen, tallied.groups.not_seen.length,
      codeUnseenReadByChecks(pass)), ...where, ...coverage];
  }
  // A report written before D105: a recorded write outside the working directory is listed with the change's files.
  // One the footer names as a path whose change the request did not show (it lies in the repository) is a part of the
  // change the review did not cover, counted here by its state; any other (outside the repository) is no part of the
  // change: the footer counts it. A deleted path's change is shown when its removed lines are (it has hunks); a file
  // that changed after the session's last recorded edit, when the footer does not name it as not shown.
  const change = files.filter((f) => f.state !== OUTSIDE_ROOT || unshown.has(f.path));
  const seen = (f) => !unshown.has(f.path) && (f.state === SHOWN
    || (f.state === DELETED && Number.isSafeInteger(f.hunks) && f.hunks > 0) || f.state === CHANGED_SINCE_SESSION);
  return [W.shownFiles(change.filter(seen).length, change.length, tally(change.filter((f) => !seen(f)))), ...coverage];
}
