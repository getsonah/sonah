// D153: a review run with the after-point re-check, for the readers. Three windows of the main agent: w1 writes
// a statement into README.md, runs the tests, which fail, and claims they pass (ask 1 found partly done); w2 says the
// changelog is not updated (ask 2 found not done); w3 replaces the statement, runs the tests, which pass, and says so.
// The re-check of w3 finds ask 1 done, corrects the claim and the statement, and settles nothing of ask 2. Synthetic
// session and judge in code only: no recording, no model, no network.
import { runReview } from '../../evidence/src/run-review.js';
import { laterCorrectionSession, recontradictionSession, receipt } from '../../evidence/test/d153-recheck-fixture.js';

export const recheckRenderSession = laterCorrectionSession;

const ASK1 = receipt('I1', 'instruction', 'fix greet.js so empty names give the guest greeting, and add a test for it');
const ASK2 = receipt('I2', 'instruction', 'ask a helper to check the docs, then update the changelog');
const ASK3 = receipt('I3', 'instruction', 'now add the missing test');
const FAIL = receipt('A1-r', 'observation', 'not ok 1 - empty name gives the guest greeting');
const PASS = receipt('A2-r', 'observation', 'ok 1 - empty name gives the guest greeting');
const STATED = receipt('C1', 'commentary', 'All tests pass.');
const narrative = (x = {}) => ({ decisions: [], pivots: [], claims: [], requirements: [], ...x });
const ANSWERS = {
  'narrative:w1': narrative({ requirements: [{ text: 'fix greet.js and add a test', instruction: ASK1,
    status: 'partly-done', deliverable: receipt('WR1', 'code', 'Empty names get the guest greeting.'), shortfall: FAIL }],
  claims: [{ text: 'all tests pass', stated: STATED, contradictedBy: FAIL }],
  writtenClaims: [{ text: 'empty names get the guest greeting', stated: receipt('WR1', 'code',
    'Empty names get the guest greeting.'), contradictedBy: FAIL }] }),
  'narrative:w2': narrative({ requirements: [{ text: 'update the changelog', instruction: ASK2, status: 'not-done',
    shortfall: receipt('C2', 'commentary', 'The changelog is not updated.') }] }),
  'narrative:w3': narrative({ requirements: [{ text: 'add the test', instruction: ASK3, status: 'done',
    deliverable: PASS }] }),
  'narrative:w2:recheck': narrative({ requirements: [{ text: 'x', instruction: ASK1, status: 'not-checked' }],
    claims: [{ text: 'all tests pass', stated: STATED, contradictedBy: null, resolvedBy: null }] }),
  'narrative:w3:recheck': narrative({ requirements: [{ text: 'x', instruction: ASK1, status: 'done', deliverable: PASS },
    { text: 'y', instruction: ASK2, status: 'not-checked' }],
  claims: [{ text: 'all tests pass', stated: STATED, contradictedBy: null, resolvedBy: { observation: PASS,
    statement: receipt('C3', 'commentary', 'all tests pass now.') } }],
  writtenClaims: [{ text: 'empty names get the guest greeting', stated: receipt('ED2', 'code',
    'Empty names are refused with an error.') }] }),
};

/** The judge in code: each narrative label's answer, and every challenge vote upholding its item through its own
 *  receipt. */
async function judge(request) {
  if (request.challenge) return { votes: request.challenge.items.map((item) => {
    const c = item.candidate;
    const cited = c.correctedBy?.observation ?? c.correctedBy ?? c.contradictedBy ?? (c.status === 'done'
      ? c.deliverable : c.shortfall ?? c.deliverable) ?? c.stated ?? null;
    return { key: item.key, verdict: 'not-refuted', explanation: `Synthetic check of ${item.key}.`,
      receipts: cited ? [{ eventId: cited.eventId, role: cited.role, quote: cited.quote }] : [] };
  }) };
  return structuredClone(ANSWERS[request.label] ?? narrative());
}

/** The review's report, with the option on (`on`) or off. */
export const recheckRenderReport = (on = true) => runReview({ session: recheckRenderSession(), pr: null,
  reviewScope: 'session-only', judge, ...(on ? { afterPointRecheck: true } : {}) });

/** The same session where the re-check of w3 settles none of the four accusing rows but ask 1: it reaffirms ask 1 (a
 *  shortfall that w3 records), and says nothing that settles ask 2, the claim or the statement. */
const UNSETTLED_ANSWERS = {
  ...ANSWERS,
  'narrative:w3:recheck': narrative({ requirements: [{ text: 'x', instruction: ASK1, status: 'not-done',
    shortfall: receipt('ED2', 'code', 'Empty names are refused with an error.') },
  { text: 'y', instruction: ASK2, status: 'not-checked' }],
  claims: [{ text: 'all tests pass', stated: STATED, contradictedBy: null, resolvedBy: null }] }),
};
const unsettledJudge = async (request) => (request.challenge ? judge(request)
  : structuredClone(UNSETTLED_ANSWERS[request.label] ?? narrative()));

/** The review's report where the re-check reaffirms ask 1 and leaves ask 2, the claim and the statement unsettled, with
 *  the option on (`on`) or off. */
export const recheckUnsettledReport = (on = true) => runReview({ session: recheckRenderSession(), pr: null,
  reviewScope: 'session-only', judge: unsettledJudge, ...(on ? { afterPointRecheck: true } : {}) });

/** The session where w1 finds the claim "All tests pass." contradicted by a failing run, w2's re-check corrects it on a
 *  later passing run (`corrected`, else w2 settles nothing) and w3's re-check grounds a still later failing run that
 *  shows the claim not holding again. The statement replaced in w2 stays replaced (no write back). */
export const recontradictedSession = () => recontradictionSession({ putBack: false });
const AGAIN = receipt('A3-r', 'observation', 'not ok 1 - empty name gives the guest greeting');
const recontradictedAnswers = (corrected) => ({
  'narrative:w1': narrative({ claims: [{ text: 'all tests pass', stated: STATED, contradictedBy: FAIL }] }),
  'narrative:w2:recheck': narrative({ claims: [{ text: 'all tests pass', stated: STATED, contradictedBy: null,
    resolvedBy: corrected ? { observation: PASS, statement: receipt('C2', 'commentary', 'all tests pass now.') }
      : null }] }),
  'narrative:w3:recheck': narrative({ claims: [{ text: 'all tests pass', stated: STATED, contradictedBy: AGAIN,
    resolvedBy: null }] }),
});

/** The review of `recontradictedSession` with the option on (`on`) or off: a claim whose correction a later failing
 *  RESULT voids (`corrected`), or one that RESULT re-contradicts with no correction. */
export const recontradictedReport = ({ corrected = true, on = true } = {}) => {
  const answers = recontradictedAnswers(corrected);
  const own = async (request) => (request.challenge ? judge(request)
    : structuredClone(answers[request.label] ?? narrative()));
  return runReview({ session: recontradictedSession(), pr: null, reviewScope: 'session-only', judge: own,
    ...(on ? { afterPointRecheck: true } : {}) });
};
