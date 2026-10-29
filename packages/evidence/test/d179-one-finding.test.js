// D179 (0.3.0-beta.10; D156's design, steps 1, 3 and 4): one defect in a file that several places of the change
// (worktrees, clones) hold byte for byte is published once. After the checks, the held findings of one key
// (`samePlacesKeyOf`: both checks hold; one kind of the closed list; one side; equal lines; one 64-hex `anchorSha256`; one
// scope; one set of grounded session ties) in places known and different (by the file of the change its anchor names,
// `anchorPlacesOf`, D178's place rule), one finding in each place (`samePlacesLeads`), are merged into the first in check
// order: it keeps its label and gains the copies' ties (`mergeTies`) and `places`; the copy's id names the lead, so its
// triage key does; a copy goes in no list; a withheld copy stays withheld. The invariants, each a test:
//   1. The rule, pure: each condition alone keeps two findings apart; the place of a finding is its file's (D178's).
//   2. Same bytes in two places: one finding with both places; every copy still checked in its own request.
//   3. Other bytes, one place at two paths, an ambiguous or unreadable path: two items, as before.
//   4. A withheld copy stays withheld, byte for byte; the lead stands alone.
//   5. A copy's triage key names the lead: its entry stands for the lead, or is a repeat of the lead's own.
//   6. A copy's ties are the lead's: one tied by its copy's grounded breaks or row is published, not open; the first in
//      check order keeps its label.
//   7. The anchor's lines, hash and changed lines are read under the name its grounding read it by (D147's ambiguity of
//      the working folder's relative name), so the working folder's copy merges too.
//   8. CODE_PASS_PROFILE and TRIAGE_ERRORS, byte for byte: no answer key moves.
//   9. D179's review: a merge never loses a tie a reader reads. A copy whose trace quotes an ask its lead's does not
//      stays its own item, in either order, and the ask keeps its attention link; a lead outside the evaluated session
//      would read none of an inside copy's ties, so they never merge.
//  10. D179's review: which findings join never depends on check order. A second, distinct finding in a place stays
//      its own item; two findings of one key in one place make the group ambiguous, and none of it merges.
//
// Synthetic sessions and files, an in-memory repository reader and deterministic fake agents: no recording, no model, no
// network. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as codePass from '../src/code-pass.js';
import { TRIAGE_ERRORS } from '../src/ledger.js';
import * as fixture from '../../cli/test/code-pass-fixture.js';
import { askCodeLinks, withAskCodeLinks } from '../src/ask-code-links.js';
import { askRowKind } from '../src/review.js';
import { runScenario, findingOn, triageEntry, otherBytes, HERE, THERE, COPY, SIBLING, ONE_ASK } from
  './d179-one-finding-fixture.js';

const { samePlacesCopy, samePlacesLeads, anchorPlacesOf, CODE_PASS_PROFILE, findingTied, withCodePass } = codePass;
const mods = { ...codePass, fixture };
const sha = (text) => createHash('sha256').update(text).digest('hex');
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));
const PARSE = fixture.CODE_FILES['src/parse.js'];
const OUTSIDE = { premise: 'SYNTHETIC: the platform splits so.', source: 'outside', receipts: [] };
/** The places a run's lists hold, by list. */
const lists = ({ codePass: p }) => ({ findings: p.findings.length, open: p.open.length, unconfirmed: p.unconfirmed.length,
  withheld: p.withheld.filter((w) => w.what === 'finding').length });
const at = (path) => ({ path, side: 'new', startLine: 2, endLine: 2 });

test('D179 (1): the rule — each condition alone keeps two held findings apart; a finding is placed by its file of the change', () => {
  const A = 'test/a.test.js', B = '/w/B/test/a.test.js', C = '/w/C/test/a.test.js', SAME_PLACE = 'test/copy.test.js';
  const placeOf = anchorPlacesOf([{ path: A }, { path: B, place: '/w/B' }, { path: C, place: '/w/C' },
    { path: SAME_PLACE }, { path: '/w/D/x.js', place: '' }]);
  const HASH = 'a'.repeat(64);
  const held = (path, over = {}) => ({ kind: 'weak_test', anchor: { path, side: 'new', startLine: 10, endLine: 12 },
    anchorSha256: HASH, check: { verdict: 'holds' }, ...over });
  // The place: another place's top folder, the working folder's repository (''), none for a file not of the change.
  assert.deepEqual([A, B, C, '/w/D/x.js', 'docs/none.md'].map((path) => placeOf(held(path))),
    ['', '/w/B', '/w/C', '', null]);
  assert.equal(placeOf({ kind: 'bug' }), null);
  // Same kind, side, lines, bytes, scope and session ties, and two known places: one defect. In any two places.
  assert.equal(samePlacesCopy(held(A), held(B), placeOf), true);
  assert.equal(samePlacesCopy(held(B), held(C), placeOf), true);
  // D179's review: the same grounded session ties, in any order and each once, are one set.
  const said = (eventId, quote) => ({ step: 'SYNTHETIC step.', source: 'session', eventId, role: 'instruction', quote });
  const ties = [said('I1', 'SYNTHETIC quote one'), said('I2', 'SYNTHETIC quote two')];
  assert.equal(samePlacesCopy(held(A, { trace: ties }), held(B, { trace: [ties[1], ties[0], ties[1]] }), placeOf), true);
  assert.equal(samePlacesCopy(held(A, { trace: [{ ...ties[0], step: 'SYNTHETIC other words.' }] }),
    held(B, { trace: [ties[0]] }), placeOf), true, 'the words of a step are no tie');
  // Each condition alone keeps them apart.
  const apart = {
    'other bytes': held(B, { anchorSha256: 'b'.repeat(64) }),
    'no hash (a file not readable, collided or ambiguous)': held(B, { anchorSha256: undefined }),
    'a hash not 64-hex': held(B, { anchorSha256: `sha256:${HASH}` }),
    'a null kind': held(B, { kind: null }),
    'a kind outside the closed list': held(B, { kind: 'style' }),
    'another kind': held(B, { kind: 'bug' }),
    'the other side': held(B, { anchor: { path: B, side: 'old', startLine: 10, endLine: 12 } }),
    'lines that do not overlap': held(B, { anchor: { path: B, side: 'new', startLine: 13, endLine: 14 } }),
    'lines that overlap but differ': held(B, { anchor: { path: B, side: 'new', startLine: 12, endLine: 20 } }),
    'lines that hold the others': held(B, { anchor: { path: B, side: 'new', startLine: 10, endLine: 13 } }),
    'an anchor out of its shape': held(B, { anchor: { path: B, side: 'new', startLine: 10, endLine: 12, extra: 1 } }),
    'a check that does not hold': held(B, { check: { verdict: 'refuted' } }),
    'one place at two paths': held(SAME_PLACE),
    'a file not of the change': held('docs/none.md'),
    'outside the evaluated session': held(B, { outsideSession: true }),
    'a session tie the other has not': held(B, { trace: [said('I1', 'SYNTHETIC quote one')] }),
    'another session tie': held(B, { trace: [said('I1', 'SYNTHETIC quote two')] }),
  };
  for (const [why, f] of Object.entries(apart)) {
    assert.equal(samePlacesCopy(held(A), f, placeOf), false, why);
    assert.equal(samePlacesCopy(f, held(A), placeOf), false, `${why}, as the lead`);
  }
  assert.equal(samePlacesCopy(held(A, { kind: null }), held(B, { kind: null }), placeOf), false, 'two null kinds');
  assert.equal(samePlacesCopy(held(A, { outsideSession: true }), held(B, { outsideSession: true }), placeOf), true);
  assert.equal(samePlacesCopy(held(A), held(B), null), false, 'no place rule, no merge');
  assert.equal(samePlacesCopy(held(A), held(B), () => null), false, 'unknown places never merge');
  // The groups (`samePlacesLeads`): each finding's lead, by index; none without a place rule.
  assert.deepEqual(samePlacesLeads([held(A), held(B), held(C)], placeOf), [0, 0, 0]);
  assert.deepEqual(samePlacesLeads([held(A), held(B)], null), [0, 1]);
  assert.deepEqual(samePlacesLeads('not a list', placeOf), []);
});

test('D179 (2): the same bytes in two places are one finding with both places; each copy is still checked', async () => {
  const seen = [];
  const result = await runScenario(mods, { places: 'same', findings: [findingOn(fixture, HERE), findingOn(fixture, THERE)],
    seen });
  assert.deepEqual(seen.map((r) => r.label).filter((l) => l.startsWith('code-verify:')), ['code-verify:F1',
    'code-verify:F2'], 'every copy is checked in its own request');
  assert.deepEqual(lists(result), { findings: 1, open: 0, unconfirmed: 0, withheld: 0 });
  const [lead] = result.codePass.findings;
  assert.deepEqual(lead.places, [at('src/parse.js'), at(THERE)], 'the lead first, then its copy, each once');
  assert.deepEqual([lead.anchor.path, lead.anchorSha256], ['src/parse.js', sha(PARSE)]);
  // The copy's ties are the lead's: its grounded receipt of what it breaks (the sibling's line) joins the lead's own.
  assert.deepEqual(lead.check.breaks.map((r) => r.path), ['src/parse.js', THERE]);
  // D179's review: a second, distinct finding in a place the lead names (other lines) stays its own item.
  const again = findingOn(fixture, THERE, { anchor: { path: THERE, side: 'new', startLine: 2, endLine: 3 } });
  const three = await runScenario(mods, { places: 'same', findings: [findingOn(fixture, HERE), findingOn(fixture, THERE),
    again] });
  assert.deepEqual(lists(three), { findings: 2, open: 0, unconfirmed: 0, withheld: 0 });
  assert.deepEqual(three.codePass.findings.map((f) => [f.anchor.endLine, f.places]), [[2, [at('src/parse.js'),
    at(THERE)]], [3, undefined]]);
  // Two held findings of one key in one place (parse.js and its copy in the working folder): either could be the
  // sibling's copy, so none of the three merges.
  const ambiguous = await runScenario(mods, { places: 'same', copy: true, findings: [findingOn(fixture, HERE),
    findingOn(fixture, `/work/repo/${COPY}`), findingOn(fixture, THERE)] });
  assert.deepEqual(lists(ambiguous), { findings: 3, open: 0, unconfirmed: 0, withheld: 0 });
  assert.ok(ambiguous.codePass.findings.every((f) => f.places === undefined));
  // The copy checked first leads instead: the order is the checks'.
  const reversed = await runScenario(mods, { places: 'same', findings: [findingOn(fixture, THERE),
    findingOn(fixture, HERE)] });
  assert.deepEqual(reversed.codePass.findings.map((f) => f.places), [[at(THERE), at('src/parse.js')]]);
});

test('D179 (3): other bytes, one place at two paths, an ambiguous or an unreadable path stay two items', async () => {
  const other = await runScenario(mods, { places: 'other', findings: [findingOn(fixture, HERE),
    findingOn(fixture, THERE)] });
  assert.deepEqual(lists(other), { findings: 2, open: 0, unconfirmed: 0, withheld: 0 });
  assert.deepEqual(other.codePass.findings.map((f) => [f.anchorSha256, f.places]), [[sha(PARSE), undefined],
    [sha(otherBytes(PARSE)), undefined]]);
  const twoPaths = await runScenario(mods, { places: 'twoPaths', findings: [findingOn(fixture, 'src/parse.js'),
    findingOn(fixture, COPY)] });
  assert.deepEqual(lists(twoPaths), { findings: 2, open: 0, unconfirmed: 0, withheld: 0 });
  assert.equal(new Set(twoPaths.codePass.findings.map((f) => f.anchorSha256)).size, 1, 'one hash, one place');
  assert.ok(twoPaths.codePass.findings.every((f) => f.places === undefined));
  // A relative path that both places hold names none (D147): withheld, never resolved to a place by its content.
  const ambiguous = await runScenario(mods, { places: 'same', findings: [findingOn(fixture, THERE),
    findingOn(fixture, 'src/parse.js')] });
  assert.deepEqual(lists(ambiguous), { findings: 1, open: 0, unconfirmed: 0, withheld: 1 });
  assert.equal(ambiguous.codePass.findings[0].places, undefined);
  const unreadable = await runScenario(mods, { places: 'same', findings: [findingOn(fixture, HERE),
    findingOn(fixture, `${SIBLING}/src/missing.js`)] });
  assert.deepEqual(lists(unreadable), { findings: 1, open: 0, unconfirmed: 0, withheld: 1 });
  assert.equal(unreadable.codePass.findings[0].places, undefined);
});

test('D179 (4): a withheld copy stays withheld, byte for byte; the lead stands alone', async () => {
  const refuteThere = (shown) => (shown.anchor.path !== THERE ? null : { verdict: 'refuted', reason: 'step_unsupported',
    claims: shown.claims.map(({ claim }) => ({ claim, verdict: 'holds' })),
    premises: [fixture.repositoryPremise(shown)], breaks: [], receipts: [], explanation: 'SYNTHETIC refuted.' });
  const both = await runScenario(mods, { places: 'same', findings: [findingOn(fixture, HERE), findingOn(fixture, THERE)],
    verify: refuteThere });
  assert.deepEqual(lists(both), { findings: 1, open: 0, unconfirmed: 0, withheld: 1 });
  assert.equal(both.codePass.findings[0].places, undefined);
  const alone = await runScenario(mods, { places: 'same', findings: [findingOn(fixture, THERE)], verify: refuteThere });
  assert.deepEqual(both.codePass.withheld, alone.codePass.withheld, 'the withheld copy is the record it is alone');
  assert.equal(both.codePass.withheld[0].reason, 'verify_refuted');
});

test('D179 (5): a copy\'s triage key names the lead — its entry stands for it, or repeats the lead\'s own', async () => {
  const findings = [findingOn(fixture, HERE), findingOn(fixture, THERE)];
  const both = await runScenario(mods, { places: 'same', findings, triage: [triageEntry('F1'),
    triageEntry('F2', { label: 'the copy' })] });
  const [lead] = both.codePass.findings;
  assert.deepEqual(both.codePass.triage.map((t) => [t.ref, t.label]), [[{ finding: lead.id }, 'fix empty input']]);
  assert.deepEqual(both.codePass.triageDropped.filter((d) => d.key === 'F2'), [{ key: 'F2', index: 1,
    cause: 'triage_key_repeated' }]);
  const copyOnly = await runScenario(mods, { places: 'same', findings, triage: [triageEntry('F2', { label: 'the copy' })] });
  assert.deepEqual(copyOnly.codePass.triage.map((t) => [t.ref, t.label]), [[{ finding: copyOnly.codePass.findings[0].id },
    'the copy']]);
  assert.ok(!copyOnly.codePass.triageDropped.some((d) => d.cause === 'triage_key_repeated'));
});

test('D179 (6): a copy\'s ties are the lead\'s; the first in check order keeps its label', async () => {
  // The lead alone is open (no row, no receipt of what it breaks); its copy's grounded breaks tie it: published.
  const untiedHere = (shown) => (shown.anchor.path === HERE
    ? fixture.holdsWith(shown, [fixture.repositoryPremise(shown)], []) : null);
  const findings = [findingOn(fixture, HERE), findingOn(fixture, THERE)];
  const alone = await runScenario(mods, { places: 'other', findings, verify: untiedHere });
  assert.equal(alone.codePass.open.length, 1, 'other bytes: the working folder\'s finding is open alone');
  const merged = await runScenario(mods, { places: 'same', findings, verify: untiedHere });
  assert.deepEqual(lists(merged), { findings: 1, open: 0, unconfirmed: 0, withheld: 0 });
  assert.equal(findingTied(merged.codePass.findings[0]), true);
  assert.deepEqual(merged.codePass.findings[0].check.breaks.map((r) => r.path), [THERE]);
  // A copy that follows from a row of the session review gives the lead that row.
  const row = await runScenario(mods, { places: 'same', verify: () => null, findings: [findingOn(fixture, HERE),
    findingOn(fixture, THERE, { leadsFrom: ['S1'] })] });
  assert.deepEqual(row.codePass.findings[0].leadsFrom.map((r) => r.source), ['requirements']);
  // The first in check order keeps its check's label (D110): a lead to verify stays to verify, with its copy's place.
  const toVerify = await runScenario(mods, { places: 'same', findings, verify: (shown) => (shown.anchor.path === HERE
    ? fixture.holdsWith(shown, [OUTSIDE]) : null) });
  assert.deepEqual(lists(toVerify), { findings: 0, open: 0, unconfirmed: 1, withheld: 0 });
  assert.deepEqual(toVerify.codePass.unconfirmed[0].places, [at('src/parse.js'), at(THERE)]);
});

test('D179 (7): the anchor is read under the name its grounding read it by: the working folder\'s copy keeps its lines', async () => {
  // Two places hold src/parse.js, so its relative name names none (D147); the answer names it by its absolute path.
  const result = await runScenario(mods, { places: 'other', findings: [findingOn(fixture, HERE)] });
  const [f] = result.codePass.findings;
  assert.equal(f.anchor.path, 'src/parse.js');
  assert.equal(f.anchorSha256, sha(PARSE));
  assert.deepEqual([f.anchorSpan.startLine, f.anchorSpan.lines], [2, [PARSE.split('\n')[1]]]);
  // Its changed lines by the grounded name (the change's own name for the file), so they are marked on the page.
  assert.deepEqual(f.anchorChanged, [2]);
  // One place: the same fields as the reader's own name gives them.
  const one = await runScenario(mods, { places: 'twoPaths', findings: [findingOn(fixture, 'src/parse.js')] });
  assert.equal(one.codePass.findings[0].anchorSha256, sha(PARSE));
  assert.deepEqual(one.codePass.findings[0].anchorChanged, [2]);
});

test('D179 (8): CODE_PASS_PROFILE and TRIAGE_ERRORS are beta.10\'s before D179, byte for byte', () => {
  assert.equal(createHash('sha256').update(canon(CODE_PASS_PROFILE)).digest('hex'),
    'a5277583946e9dec230e25c4d7e158a881128294330f4193aea113943e8a5cc6');
  assert.deepEqual(TRIAGE_ERRORS, ['triage_key_unknown', 'triage_key_repeated', 'triage_not_item', 'file_not_in_change',
    'where_ungrounded', 'item_withheld', 'file_not_in_unit']);
  assert.equal(CODE_PASS_PROFILE.triage.errors, TRIAGE_ERRORS);
});

/** A session step of a finding's trace that quotes the fixture's ask (I1), as an answer gives it. */
const QUOTES_ASK = { step: 'SYNTHETIC: the person asked for an empty list.', side: 'session', path: null,
  startLine: null, endLine: null, quote: ONE_ASK.requirements[0].instruction.quote };
const quotingAsk = (f) => ({ ...f, trace: [QUOTES_ASK, ...f.trace] });
/** What a run gives the fixture's one ask (status done): its links (`askCodeLinks`) and its row kind (`askRowKind`). */
const askOf = (result) => {
  const session = fixture.codeSession();
  const joined = withAskCodeLinks(withCodePass(ONE_ASK, result), session);
  return { links: askCodeLinks(joined, session)[0].map((l) => l.link), kind: askRowKind(joined.requirements[0], joined) };
};

test('D179 (9): a merge never loses a tie a reader reads: a copy\'s session tie, a scope', async () => {
  // The copy's trace quotes the ask, its lead's does not: two items, in either order, and the ask is still a counted
  // row beside the code review's finding (base b11b601f gave the same), never "done" alone.
  for (const order of [[false, true], [true, false]]) {
    const result = await runScenario(mods, { places: 'same', findings: [HERE, THERE].map((path, k) => (order[k]
      ? quotingAsk(findingOn(fixture, path)) : findingOn(fixture, path))) });
    assert.deepEqual(lists(result), { findings: 2, open: 0, unconfirmed: 0, withheld: 0 }, `order ${order}`);
    assert.ok(result.codePass.findings.every((f) => f.places === undefined));
    assert.deepEqual(askOf(result), { links: ['trace_quotes_ask'], kind: 'asksCodeFinding' }, `order ${order}`);
  }
  // Both quote it: one item, and the ask keeps its link.
  const both = await runScenario(mods, { places: 'same', findings: [quotingAsk(findingOn(fixture, HERE)),
    quotingAsk(findingOn(fixture, THERE))] });
  assert.deepEqual(lists(both), { findings: 1, open: 0, unconfirmed: 0, withheld: 0 });
  assert.deepEqual(askOf(both), { links: ['trace_quotes_ask'], kind: 'asksCodeFinding' });
  // The scope: a reader reads no tie of a finding outside the evaluated session (D113), so a lead outside it that held
  // an inside copy's row would leave the ask with no link. Two items keep it; one merged item would not.
  const apart = await runScenario(mods, { places: 'other', verify: () => null, findings: [findingOn(fixture, HERE),
    findingOn(fixture, THERE, { leadsFrom: ['S1'] })] });
  const [away, own] = apart.codePass.findings.map((f, k) => (k === 0 ? { ...f, outsideSession: true } : f));
  const session = fixture.codeSession();
  const linksOf = (findings) => askCodeLinks(withCodePass(ONE_ASK, { ...apart, codePass: { ...apart.codePass,
    findings } }), session)[0].map((l) => l.link);
  assert.deepEqual(linksOf([away, own]), ['leads_from']);
  assert.deepEqual(linksOf([{ ...away, leadsFrom: own.leadsFrom }]), []);
});

test('D179 (10): which findings join never depends on check order; a group with two in one place merges none', async () => {
  const L = (path, endLine) => findingOn(fixture, path, { title: `SYNTHETIC ${path === HERE ? 'here' : 'there'} 2-${endLine}`,
    anchor: { path, side: 'new', startLine: 2, endLine } });
  /** The items of a run: each finding's title and its places' paths and last lines, in one fixed order. */
  const items = (result) => ['findings', 'open', 'unconfirmed'].flatMap((name) => result.codePass[name])
    .map((f) => [...(f.places ?? [f.anchor]).map((p) => `${p.path === HERE || p.path === 'src/parse.js' ? 'here' : 'there'
    }:${p.endLine}`)].sort().join(' ')).sort();
  const runs = async (findings, verify = null) => {
    const out = [];
    const orders = [[0, 1, 2, 3], [2, 0, 1, 3], [1, 2, 0, 3], [3, 2, 1, 0], [1, 3, 0, 2]].map((o) => o
      .filter((k) => k < findings.length));
    for (const order of orders) out.push(items(await runScenario(mods, { places: 'same', verify,
      findings: order.map((k) => findings[k]()) })));
    return out;
  };
  // Here 2-2, there 2-2, there 2-3 (a distinct finding there): here 2-2 and there 2-2 are one item, there 2-3 its own,
  // whatever the order.
  for (const got of await runs([() => L(HERE, 2), () => L(THERE, 2), () => L(THERE, 3)]))
    assert.deepEqual(got, ['here:2 there:2', 'there:3']);
  // The mirror: two distinct findings in each place, each paired with its own copy.
  for (const got of await runs([() => L(HERE, 2), () => L(HERE, 3), () => L(THERE, 2), () => L(THERE, 3)]))
    assert.deepEqual(got, ['here:2 there:2', 'here:3 there:3']);
  // Ties follow their own copies: lines 2-2 checked with no receipt of what it breaks are open in both places, and
  // stay open; the 2-3 pair is tied by its grounded breaks.
  const untied22 = (shown) => (shown.anchor.endLine === 2
    ? fixture.holdsWith(shown, [fixture.repositoryPremise(shown)], []) : null);
  const mirror = await runScenario(mods, { places: 'same', verify: untied22, findings: [L(HERE, 2), L(HERE, 3),
    L(THERE, 2), L(THERE, 3)] });
  assert.deepEqual([mirror.codePass.findings.map((f) => f.anchor.endLine), mirror.codePass.open.map((f) => f.anchor
    .endLine)], [[3], [2]]);
  // The pure groups: two of one key in one place (an ambiguous copy) merge none of the group; another group still merges.
  const placeOf = anchorPlacesOf([{ path: 'a.js' }, { path: 'b.js' }, { path: '/w/B/a.js', place: '/w/B' }]);
  const f = (path, startLine) => ({ kind: 'bug', anchor: { path, side: 'new', startLine, endLine: startLine },
    anchorSha256: 'c'.repeat(64), check: { verdict: 'holds' } });
  assert.deepEqual(samePlacesLeads([f('a.js', 1), f('b.js', 1), f('/w/B/a.js', 1), f('a.js', 5), f('/w/B/a.js', 5)],
    placeOf), [0, 1, 2, 3, 3]);
});
