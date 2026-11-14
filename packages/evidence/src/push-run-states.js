// D225 review (second look 1): the push run's two closed lists, in a module of Node's own modules and nothing else, so
// that the hidden `sonah pre-push` stays light. team/runs.json's shape (cli/src/team-home.js `RUN_KEYS`) is read at
// every write of a run, and the hook writes one at every push; ledger.js, where these lists stood, pulls in the whole
// decisions ledger (the adapters, the challenge, the windows, the session) to do it. ledger.js re-exports them, so
// every other reader reads them where it always did.
//
// No work at import.

/** D227 (item 10, C4): the push run (cli/src/push-run.js), the background review of each pushed branch, and its record
 *  in team/runs.json (team-home.js).
 *  PUSH_RUN_STATES: where one pushed branch's run stands. `waiting` (its ticket waits: for the remote to show the
 *  commit, or for the runner), `queued` (the remote shows it, and the runner takes another first, or waits for the
 *  laptop's one job slot or for the page's folder), `running` (its page is drawn), `uploading`; the ends: `done` (the
 *  server took the upload), `skipped` (nothing to review), `replaced` (a review of the branch took its place: the one
 *  of the commit the branch holds on the remote, else the one whose commit holds this one's, D228 reviews 1, 4 and 5),
 *  `failed`, `gave_up` (its time ran out), `pending_upload` (drawn, and not sent: the upload did not reach the
 *  server, or a share could not read the folder; a later pass or a share sends it),
 *  `shared` (sent again by `sonah share`, C5), `stopped` (its process ended before the run did).
 *  PUSH_RUN_REASONS: why a run stands where it does, each said in fixed words (push-run.js PUSH_RUN_WORDS.why):
 *    remote_not_seen       waiting: the remote does not show the commit on its branch yet;
 *    job_slot              queued: another push's review runs on this computer now (one at a time);
 *    folder_in_use         queued: another Sonah draws the page of the same range into the same folder now (D226);
 *    folder_held           pending_upload: a share waited for that folder to its own deadline and sent nothing, so the
 *                          review still waits to be sent, and nothing waits for the folder any more (D228 review 2;
 *                          D228 review 1 wrote `folder_in_use` here, whose words say that Sonah waits for the folder);
 *    newer_push            replaced: a review of the branch, from a newer push or a share, that took this one's
 *                          place: the review of the commit the branch holds on the remote (D228 review 4, the
 *                          remote-tracking ref a push moves; D228 review 5: never this computer's own branch, which
 *                          an amend or a `git reset` moves with no push; D228 review, second look 2: a ref under
 *                          `refs/remotes/` is the only one a push moves and a person's own work does not, so a
 *                          refspec that maps the branch anywhere else is no answer and the remote is asked; D228
 *                          review, second look 2, review 1: read of the remotes this clone's own runs name, each of
 *                          them, and asked of the remote itself where another clone of the repository has a review
 *                          of the branch too, since a remote-tracking ref is a cache this clone's own pushes and
 *                          fetches move; D228 review, second look 2, review 2: a run that names no remote is left
 *                          out of those names rather than turning the read off, with the remote asked since an
 *                          address push moves no ref here; that cache answers for a remote that gives no answer at
 *                          all; and a name neither can say a word about leaves the read null), which is the newest
 *                          whatever the other commit is and whether or not git
 *                          here can relate the two,
 *                          else the one whose commit holds this one's,
 *                          else the newer of the two by its time, where git cannot say which commit holds which
 *                          (D228 review 1; second look 2, review 2: the times across this computer's clones too,
 *                          one order every clone's pass reads the same way, where review 1 gave the pass's own clone
 *                          the place of another's and had two of them POST the one review).
 *                          The reviews that are of one branch are the ones of one review of the
 *                          server's own: its repository, as the server keys it (the owner and name in lower case),
 *                          and its branch, never the branch alone (D228 review, second look 1, and second look 2:
 *                          two casings of one push URL are one review there, and two clones of one repository on one
 *                          computer are two passes of one review, each ordered against the other's runs while each
 *                          sends only its own pages and writes only rows it read);
 *    on_default_branch     skipped: the commit is on the remote's default branch already;
 *    hook_removed          skipped: `sonah hook remove --push` dropped its ticket before the review (D227 review);
 *    remote_never_showed   failed: the remote did not show the commit within the wait;
 *    not_connected, connection_unreadable, connection_changed   failed: no connection, one Sonah cannot read, or one
 *                          to another server or login than the push's;
 *    refused               failed: the server no longer takes the token (401; the connection is marked refused);
 *    not_member            failed: the server's answer is 403 `not_member`, its person is in no team;
 *    no_repository         failed: the push remote names no owner and repository (visual-command.js
 *                          `remoteRepository`);
 *    repository_gone       failed: no worktree of the repository is on this computer;
 *    no_base               failed: the remote's default branch is not in this repository;
 *    usage_limit, auth, billing, cli_missing, model_not_found   failed: the drawing's calls stopped (transport
 *                          STOP_ERRORS); the first three end the pass for every ticket after it;
 *    draw_failed           failed: the drawing ended with another code (the run keeps it as `code`);
 *    too_large             failed: the upload is over the server's 25 MB;
 *    upload_refused        failed: the server refused the upload (the run keeps its `status` and `code`);
 *    time_limit            gave_up: the ticket's time since its push ran out;
 *    upload_failed         pending_upload: no answer, a 5xx or a 429 to the upload;
 *    uploaded              done: the server took the upload;
 *    process_ended         stopped: the run's process ended before the run did. */
export const PUSH_RUN_STATES = Object.freeze(['waiting', 'queued', 'running', 'uploading', 'done', 'skipped',
  'replaced', 'failed', 'gave_up', 'pending_upload', 'shared', 'stopped']);
export const PUSH_RUN_REASONS = Object.freeze(['remote_not_seen', 'job_slot', 'folder_in_use', 'folder_held',
  'newer_push', 'on_default_branch', 'hook_removed', 'remote_never_showed', 'not_connected', 'connection_unreadable',
  'connection_changed', 'refused', 'not_member', 'no_repository', 'repository_gone', 'no_base', 'usage_limit', 'auth',
  'billing', 'cli_missing', 'model_not_found', 'draw_failed', 'too_large', 'upload_refused', 'time_limit',
  'upload_failed', 'uploaded', 'process_ended']);
