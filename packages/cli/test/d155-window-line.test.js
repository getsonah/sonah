// D155: the terminal's window line says how many decisions Sonah left out because their second check did not run, with
// the remedy, and the report says the same in What Sonah could not check. The windows' count, the run state and the exit
// code stay as they were: that check never makes a window incomplete.
//
// Every byte is synthetic: an invented recording and a table transport. No model, no network, no real ~/.sonah —
// SONAH_HOME is a temporary directory.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { session as recording, toJsonl } from '../../golden/src/build.js';
import { COVERAGE_SENTENCE } from '../../evidence/src/review.js';
import { runSessionReviewCommand, windowCompletionLine, WINDOW_LINE_WORDS } from '../src/session-review-command.js';

const sentence = (text) => `${text[0].toUpperCase()}${text.slice(1)}.`;

test('D155 the window line: the count of decisions left out and the remedy, only when there is one', () => {
  const done = { windows: 5, complete: 5, byReason: {}, unexplained: 0 };
  assert.equal(windowCompletionLine(done), 'Windows complete: 5 of 5');
  assert.equal(windowCompletionLine(done, 0), 'Windows complete: 5 of 5');
  assert.equal(windowCompletionLine(done, 2), 'Windows complete: 5 of 5; 2 decisions left out because their second '
    + 'check did not run (run the same review again to check them)');
  assert.equal(windowCompletionLine(done, 1), 'Windows complete: 5 of 5; 1 decision left out because its second check '
    + 'did not run (run the same review again to check it)');
  assert.equal(windowCompletionLine({ windows: 3, complete: 2, byReason: { 'challenge:budget_exhausted': 1 },
    unexplained: 0 }, 1), 'Windows complete: 2 of 3; incomplete: challenge:budget_exhausted ×1; '
    + `${WINDOW_LINE_WORDS.rechecksUnexecuted(1)}`);
  // Closed: a value that is not a count prints nothing, and a record that cannot be read still prints no line.
  for (const value of [-1, 1.5, '2', null, Number.NaN]) assert.equal(windowCompletionLine(done, value),
    'Windows complete: 5 of 5', String(value));
  assert.equal(windowCompletionLine(null, 2), null);
});

// ---- the command --------------------------------------------------------------------------------
const ASK = 'SYNTHETIC_D155_ASK: rename the --out flag to --output.';
const PLAN = 'SYNTHETIC_D155_PLAN: first I will look at how the flag is read.';
const STOP = 'SYNTHETIC_D155_STOP: I have left the code as it was and am stopping here to ask you.';
/** The narrative proposes one choice not to act, anchored on the plan, that the ask settled; the window's check refutes
 *  it; the existence check (`challenge:wN:exists:…`) answers as `exists` says: `fail` (a failed call), `omit` (a reply
 *  that leaves the item out, which is stored), `refute` or `uphold`. Every label it is asked is kept in `seen`. */
const transport = ({ exists, seen = [] }) => ({ onResult, config }) => async (request) => {
  onResult({ ok: true, backend: config.backend, attestation: 'attested', contextWindow: 1_000_000 });
  seen.push(request.label);
  if (request.challenge) {
    const existence = /:exists:/.test(request.label);
    if (existence && exists === 'fail')
      throw Object.assign(new Error('model_unavailable'), { code: 'model_unavailable' });
    if (existence && exists === 'omit') return { votes: [] };
    const verdict = existence && exists === 'uphold' ? 'not-refuted' : 'refuted';
    return { votes: request.challenge.items.map(({ key, candidate }) => ({ key, verdict,
      explanation: 'SYNTHETIC vote.', receipts: [candidate.stated] })) };
  }
  const events = request.window.events;
  const ask = events.find((event) => event.kind === 'instruction');
  const plan = events.find((event) => event.kind === 'commentary');
  return { requirements: [], claims: [], pivots: [], failures: [], notClaims: [], forbiddenEdits: [],
    decisions: [{ dimension: 'whether to stop and ask before renaming the flag',
      chosen: 'did not rename the flag; stopped to ask first', value: null, valueReceipt: null, actions: [],
      notActing: true, stated: { eventId: plan.id, role: 'commentary', quote: PLAN },
      constrainedBy: { instruction: { eventId: ask.id, role: 'instruction', quote: ASK }, settles: true,
        settledValueQuote: 'to --output' }, instructionReview: null }] };
};

/** A home with the synthetic recording; each `run` reviews it again with the same Sonah home (its stored answers). */
async function home(t) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-d155-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const repo = join(dir, 'repo');
  await mkdir(repo);
  const path = join(dir, 'synthetic.jsonl');
  await writeFile(path, toJsonl(recording({ cwd: repo, sessionId: 'synthetic-d155', version: '2.1.284' })
    .ask(ASK).say(PLAN).read('a.js', 'SYNTHETIC_D155 file content.').say(STOP).done()) + '\n');
  return { run: async (options) => {
    const out = { stdout: '', stderr: '' };
    const seen = [];
    const code = await runSessionReviewCommand([path, '--no-code-pass'], { cwd: repo, installSignals: false,
      createJudge: transport({ ...options, seen }),
      env: { HOME: dir, SONAH_HOME: join(dir, '.sonah'), CODEX_HOME: join(dir, 'codex'),
        SONAH_CLAUDE_PROJECTS: join(dir, 'claude-projects') },
      loadReviews: async () => new Map(), openPage: async () => {},
      stdout: { write: (s) => { out.stdout += s; } }, stderr: { write: (s) => { out.stderr += s; } } });
    return { code, ...out, seen, lines: out.stdout.split('\n') };
  } };
}
const LINE = `Windows complete: 1 of 1; ${WINDOW_LINE_WORDS.rechecksUnexecuted(1)}`;
const SAID = sentence(COVERAGE_SENTENCE.rechecks_unexecuted({ n: 1 }));
const existenceCalls = (result) => result.seen.filter((label) => /^challenge:w1:exists:/.test(label));

test('D155 a second check that did not run: the window line and the report say how many, and the exit code stays 0',
  async (t) => {
    const failed = await (await home(t)).run({ exists: 'fail' });
    assert.ok(failed.lines.includes(LINE), failed.stdout);
    assert.ok(failed.stdout.includes(SAID), 'the report says it');
    assert.ok(failed.lines.some((line) => /^Sonah's review: complete/.test(line)), 'the run state is as before');
    assert.equal(failed.code, 0, 'D71 (a): the windows completed, so the exit code is as before');

    const ran = await (await home(t)).run({ exists: 'refute' });
    assert.ok(ran.lines.includes('Windows complete: 1 of 1'), ran.stdout);
    assert.equal(ran.stdout.includes(WINDOW_LINE_WORDS.rechecksUnexecuted(1)), false);
    assert.equal(ran.stdout.includes(SAID), false);
    assert.equal(ran.code, 0);
  });

test('D155 the remedy holds: running the same review again asks the second check again, also after a reply that left '
  + 'the decision out', async (t) => {
  for (const first of ['omit', 'fail']) {
    const reviews = await home(t);
    const one = await reviews.run({ exists: first });
    assert.ok(one.lines.includes(LINE), `${first}: ${one.stdout}`);
    assert.ok(existenceCalls(one).length >= 3, `${first}: premise, the check was asked`);
    // The same review again, the model now answering the check: it is asked again, live, and the line goes away.
    const two = await reviews.run({ exists: 'uphold' });
    assert.ok(existenceCalls(two).length >= 3, `${first}: the second check is asked again (${two.seen.join(', ')})`);
    assert.ok(!two.seen.includes('narrative:w1'), `${first}: and nothing else is asked again`);
    assert.ok(two.lines.includes('Windows complete: 1 of 1'), `${first}: ${two.stdout}`);
    assert.equal(two.stdout.includes(SAID), false, first);
    assert.equal(two.code, 0);
  }
});

test('D155 a second check that ran is not asked again', async (t) => {
  const reviews = await home(t);
  const one = await reviews.run({ exists: 'refute' });
  assert.ok(existenceCalls(one).length >= 3, 'premise: the check was asked');
  const two = await reviews.run({ exists: 'uphold' });
  assert.deepEqual(two.seen, [], 'every answer is reused, as before');
  assert.ok(two.lines.includes('Windows complete: 1 of 1'));
});
