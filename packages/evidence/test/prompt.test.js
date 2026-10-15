// The contract that makes grounding possible: the model is shown verbatim text and returns
// verbatim spans, so pass 3 can verify by literal string search. If either half breaks, every
// candidate abstains and the product silently reports nothing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { redisPivotSession, redisPivotPr } from '../fixtures/redis-pivot.js';
import { Session, verifyReceipt } from '../src/session.js';
import { planWindows } from '../src/windows.js';
import { buildNarrativePrompt, NARRATIVE_SCHEMA, PROMPT_VERSION } from '../src/prompt.js';
import { instructionReviewScope, windowEnd } from '../src/ledger.js';
import { buildCodeReviewPrompt } from '../src/code-review-prompt.js';

const session = redisPivotSession();
const windows = planWindows(session);

/** Pull the fenced regions back out of the prompt — what a well-behaved model copies from. */
function fencedSpans(prompt) {
  return [...prompt.matchAll(/<<<\n([\s\S]*?)\n>>>/g)].map((m) => m[1]);
}

// ---- windows ------------------------------------------------------------------------
test('a short session is exactly one window', () => {
  assert.equal(windows.length, 1);
  assert.equal(windows[0].events.length, session.events.length);
});

test('M35 a compaction boundary closes no window: it rides in its window, in recorded order', () => {
  const withBoundary = new Session({ sessionKey: session.sessionKey, blobs: session.blobs,
    events: [...session.events.slice(0, 5),
      { id: 'B1', kind: 'boundary', sequence: 98, boundary: 'compaction', relatedSession: null },
      ...session.events.slice(5)] });
  const split = planWindows(withBoundary);
  assert.equal(split.length, 1);
  assert.deepEqual(split[0].events.map((e) => e.id), ['E1', 'E2', 'E3', 'E4', 'E5', 'B1', 'E6', 'E7', 'E8', 'E9']);
});

test('window size is measurable before a call is spent', () => {
  assert.ok(windows[0].workBytes > 0);
});

// ---- the verbatim round trip --------------------------------------------------------
test('every fenced region in the prompt is the exact source text, not a summary', () => {
  const { prompt } = buildNarrativePrompt({ session, window: windows[0] });
  const spans = fencedSpans(prompt);
  // Each fenced block must appear verbatim in some event's reconstructed source.
  for (const span of spans) {
    const found = session.events.some((e) =>
      session.sourcesFor(e).some((s) => s.text.includes(span)));
    assert.ok(found, `fenced text was altered before the model saw it: ${span.slice(0, 40)}`);
  }
});

test('M29 a captured delegate brief is visible and citable only as parent-agent action evidence', () => {
  const blobs = { ask: 'Please delegate the synthetic work.', brief: 'Inspect the synthetic cache update.' };
  const ref = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key]) }];
  const delegated = new Session({ sessionKey: 'synthetic-delegate-brief', blobs, events: [
    { id: 'I1', kind: 'instruction', authority: 'human', sequence: 0, text: ref('ask'), supersedes: [] },
    { id: 'D1', kind: 'invocation', callKey: 'D1', tool: 'collaboration.spawn_agent',
      operation: 'delegate', sequence: 1, paths: [], command: [], input: ref('brief'), changes: [] },
  ] });
  const { evidencePrompt, sourceMap } = buildNarrativePrompt({ session: delegated,
    window: planWindows(delegated)[0] });
  assert.match(evidencePrompt, /parent agent assignment \(role=action; not a human instruction\)/);
  assert.ok(evidencePrompt.includes(`<<<\n${blobs.brief}\n>>>`));
  assert.deepEqual(sourceMap.D1.filter((source) => source.text),
    [{ role: 'action', text: blobs.brief }]);
  assert.ok(verifyReceipt(delegated, { eventId: 'D1', role: 'action', quote: blobs.brief }).ok);
  assert.equal(verifyReceipt(delegated, { eventId: 'D1', role: 'instruction', quote: blobs.brief }).ok, false);
});

test('a quote copied out of the prompt grounds against the real session', () => {
  const { prompt } = buildNarrativePrompt({ session, window: windows[0] });
  // Simulate a well-behaved model: copy a span straight out of what it was shown.
  const instructionBlock = fencedSpans(prompt).find((text) => text === session.textOf(session.event('E1')));
  const quote = instructionBlock.slice(0, 40);
  assert.ok(verifyReceipt(session, { role: 'instruction', eventId: 'E1', quote }).ok);
});

test('a PARAPHRASED quote is refused — the failure mode the prompt exists to prevent', () => {
  // Same meaning, re-worded. This is what a model does if the prompt lets it.
  const paraphrases = [
    'Do not add new infrastructure of any kind',          // reworded
    'do not add any new infrastructure',                  // case changed
    'Do not add any new  infrastructure',                 // whitespace changed
    'Do not add any new infrastructure - no new services', // em dash flattened to hyphen
  ];
  for (const quote of paraphrases) {
    assert.equal(verifyReceipt(session, { role: 'instruction', eventId: 'E1', quote }).ok, false, quote);
  }
  // The exact span, with its real em dash, does ground.
  assert.ok(verifyReceipt(session, { role: 'instruction', eventId: 'E1',
    quote: 'Do not add any new infrastructure — no new services' }).ok);
});

test('the source map hands the verifier the same text the model was shown', () => {
  const { sourceMap } = buildNarrativePrompt({ session, window: windows[0] });
  assert.deepEqual(Object.keys(sourceMap).sort(), session.events.map((e) => e.id).sort());
  for (const [eventId, sources] of Object.entries(sourceMap)) {
    // M36 phase 2 (C-07 "M36 window format"): a window lists the code it shows — a change's absent before side, which it
    // shows nothing of, is no source of it (the session's own list keeps it as an empty source, which grounds nothing).
    const live = session.sourcesFor(session.event(eventId)).filter((s) => !(s.role === 'code' && s.text === ''));
    assert.deepEqual(sources.map((s) => s.text), live.map((s) => s.text), eventId);
  }
});

test('a human instruction appears once while its timeline position remains explicit', () => {
  const { prompt, evidencePrompt } = buildNarrativePrompt({ session, window: windows[0] });
  const instruction = session.textOf(session.event('E1'));
  assert.equal(fencedSpans(prompt).filter((span) => span === instruction).length, 1);
  const timeline = evidencePrompt.split('## Human instructions recorded up to the end of this window')[0];
  assert.match(timeline, /\[E1\] HUMAN INSTRUCTION · authority=human · sequence=0/);
  assert.match(timeline, /Exact text: see \[E1\] in the full human instruction inventory below/);
  assert.equal(timeline.includes(instruction), false);
  const eventOrder = [...timeline.matchAll(/^\[(E\d+)\]/gm)].map((match) => match[1]);
  assert.deepEqual(eventOrder, windows[0].events.map((event) => event.id));
  // Commentary, commands, code and observations keep their original quotable regions.
  for (const event of session.events.filter((event) => event.kind !== 'instruction'))
    for (const source of session.sourcesFor(event).filter((source) => source.text))
      assert.ok(timeline.includes(source.text));
});

// D59: every instruction recorded up to the window's end — earlier windows' included — and none after it.
test('every window retains every earlier instruction without collapsing distinct occurrences, and none recorded after it', () => {
  const repeated = 'Keep the literal "quoted" value and \\separator.\n  Preserve Unicode: λ and 🙂.\n';
  const later = 'After this point, use the amended setting.';
  const blobs = { repeated, later, work: 'I will keep the earlier setting while checking the implementation.' };
  const ref = (sourceKey) => [{ sourceKey, fromByte: 0, untilByte: Buffer.byteLength(blobs[sourceKey]) }];
  const multi = new Session({ sessionKey: 'synthetic-instruction-history', blobs, events: [
    { id: 'I1', kind: 'instruction', authority: 'human', sequence: 0, text: ref('repeated') },
    { id: 'B1', kind: 'boundary', boundary: 'compaction', sequence: 1 },
    { id: 'I2', kind: 'instruction', authority: 'human', sequence: 2, text: ref('repeated') },
    { id: 'C1', kind: 'commentary', phase: 'working', sequence: 3, text: ref('work') },
    { id: 'B2', kind: 'boundary', boundary: 'compaction', sequence: 4 },
    { id: 'I3', kind: 'instruction', authority: 'human', sequence: 5, text: ref('later') },
  ] });
  assert.equal(instructionReviewScope(multi).complete, true);
  const expected = [['I1'], ['I1', 'I2'], ['I1', 'I2', 'I3']];
  // M35: a compaction no longer splits; each human message is a segment, and the windows here are those segments.
  const segmentWindows = [[0, 1], [2, 3, 4], [5]].map((at, index) => ({ index, events: at.map((k) => multi.events[k]) }));
  for (const [index, window] of segmentWindows.entries()) {
    const scope = instructionReviewScope(multi, { upTo: windowEnd(window) });
    assert.equal(scope.complete, true);
    assert.deepEqual(scope.instructions.map((i) => i.eventId), expected[index]);
    const { prompt, evidencePrompt, sourceMap } = buildNarrativePrompt({ session: multi, window });
    assert.equal(fencedSpans(prompt).filter((span) => span === repeated).length, index === 0 ? 1 : 2,
      'identical instructions from different events remain separate evidence');
    assert.equal(fencedSpans(prompt).filter((span) => span === later).length, index === 2 ? 1 : 0);
    assert.ok(evidencePrompt.includes(`scopeDigest: ${scope.scopeDigest}`));
    assert.match(evidencePrompt, /complete: true/);
    for (const instruction of scope.instructions) {
      assert.ok(evidencePrompt.includes(`[${instruction.eventId}] HUMAN INSTRUCTION · authority=human · sequence=${instruction.sequence} · role=instruction\n<<<\n${instruction.text}\n>>>`));
      assert.deepEqual(sourceMap[instruction.eventId], [{ role: 'instruction', text: instruction.text }]);
      assert.ok(verifyReceipt(multi, { eventId: instruction.eventId, role: 'instruction', quote: instruction.text }).ok);
    }
    assert.deepEqual(Object.keys(sourceMap).sort(),
      [...new Set([...window.events.map((event) => event.id), ...expected[index]])].sort());
  }
});

test('instructions excluded from an incomplete inventory remain verbatim in the timeline', () => {
  const blobs = { assignment: 'Check the child task using its recorded assignment.',
    malformed: 'Preserve this instruction despite its ambiguous sequence.' };
  const ref = (sourceKey) => [{ sourceKey, fromByte: 0, untilByte: Buffer.byteLength(blobs[sourceKey]) }];
  const partial = new Session({ sessionKey: 'synthetic-partial-inventory', blobs, events: [
    { id: 'A1', kind: 'instruction', authority: 'assignment', sequence: 0, text: ref('assignment') },
    { id: 'I1', kind: 'instruction', authority: 'human', sequence: 0, text: ref('malformed') },
  ] });
  const { evidencePrompt, sourceMap } = buildNarrativePrompt({ session: partial, window: planWindows(partial)[0] });
  assert.match(evidencePrompt, /complete: false/);
  assert.doesNotMatch(evidencePrompt, /Exact text: see/);
  for (const event of partial.events) {
    const text = partial.textOf(event);
    assert.equal(fencedSpans(evidencePrompt).filter((span) => span === text).length, 1);
    assert.deepEqual(sourceMap[event.id], partial.sourcesFor(event));
  }
});

test('challenge evidence is the complete shared suffix with no extraction contract or source re-encoding', () => {
  const diff = 'diff --git a/synthetic.js b/synthetic.js\n+const label = "quoted\\value";\n';
  const { prompt, evidencePrompt, sourceMap } = buildNarrativePrompt({ session, window: windows[0], diff });
  assert.ok(prompt.endsWith(evidencePrompt));
  assert.ok(Buffer.byteLength(evidencePrompt) < Buffer.byteLength(prompt));
  assert.doesNotMatch(evidencePrompt, /YOUR TASK|## How to answer|Return ONE JSON object/);
  assert.match(prompt, /YOUR TASK/);
  assert.match(prompt, /Return ONE JSON object/);
  // M35: W3-7's "Stated before this window" pointers are gone with the carry.
  assert.doesNotMatch(evidencePrompt, /## Stated before this window/);
  assert.equal(fencedSpans(evidencePrompt).filter((span) => span === diff).length, 1);
  for (const sources of Object.values(sourceMap))
    for (const source of sources.filter((source) => source.text)) assert.ok(evidencePrompt.includes(source.text));
});

// ---- what the prompt must say -------------------------------------------------------
test('the prompt forbids paraphrase, normalisation and cross-event joins explicitly', () => {
  const { prompt } = buildNarrativePrompt({ session, window: windows[0] });
  for (const rule of [
    /character for character/i,
    /Do not normalise whitespace/i,
    /Do not translate, paraphrase/i,
    /Do not join text from two events/i,
    /OMIT THE CLAIM/,
  ]) assert.match(prompt, rule);
});

test('the prompt forbids model-emitted severity, and says what happens if it disobeys', () => {
  const { prompt } = buildNarrativePrompt({ session, window: windows[0] });
  assert.match(prompt, /Never emit severity, confidence, rank, tier/i);
  assert.match(prompt, /discarded whole/i);
  assert.ok(!('severity' in NARRATIVE_SCHEMA.properties));
});

test('the prompt asks for pivots, and says why they matter', () => {
  const { prompt } = buildNarrativePrompt({ session, window: windows[0] });
  assert.match(prompt, /PIVOTS/);
  assert.match(prompt, /the diff shows only the\s+survivor/i);
});

test('an unasked choice is framed as normal, not as an accusation', () => {
  const { prompt } = buildNarrativePrompt({ session, window: windows[0] });
  assert.match(prompt, /A choice nobody asked for is NORMAL/);
  // (wording that spans a line wrap is matched with \s+ — the prompt is wrapped prose)
  assert.match(prompt, /never an accusation/);
});

test('role labels tell the model which receipt role each region can carry', () => {
  const { prompt } = buildNarrativePrompt({ session, window: windows[0] });
  assert.match(prompt, /path \(role=action\)/);
  assert.match(prompt, /role=code/);
  assert.match(prompt, /Text in\s+a tool result is NOT a human instruction/);
});

// ---- carry-over (W3-7): M35 windowing replaced it with the carried context (m35-windowing.test.js); nothing a model wrote
// travels between windows, and a combined review's window carries nothing. ---------------------------------------------
test('M35 a combined review\'s window carries nothing: no carried context, no pointer section', () => {
  const { prompt } = buildNarrativePrompt({ session, window: windows[0] });
  assert.ok(!prompt.includes('Stated before this window'));
  assert.ok(!prompt.includes('## Carried context'));
});

test('the diff prompt never treats an absent hunk as proof of a reverted choice', () => {
  const { prompt } = buildNarrativePrompt({ session, window: windows[0], diff: 'diff --git a/x b/x' });
  assert.match(prompt, /frozen PR diff, not the full final file tree/);
  assert.match(prompt, /Do not\s+infer that it was reverted solely/);
});

test('the prompt version is stable and declared', () => {
  assert.equal(buildNarrativePrompt({ session, window: windows[0] }).promptVersion, PROMPT_VERSION);
});

test('the prompt states an output contract — without it the model returns prose and the run yields nothing', () => {
  // A run once failed exactly here: the agent prompt described what to report but never
  // said to return JSON, so the model wrote a review, extractJson found nothing, and the report
  // came back "session evidence missing" with no way to tell that from a dead transport.
  const { prompt } = buildNarrativePrompt({ session, window: windows[0] });
  assert.match(prompt, /Return ONE JSON object and nothing else/);
  assert.match(prompt, /No prose before it, no prose after it, no code fence/);
  for (const key of ['decisions', 'pivots', 'claims', 'requirements']) {
    assert.match(prompt, new RegExp(`"${key}"`), `${key} must appear in the output contract`);
  }
  // Honest emptiness must be explicitly allowed, or the model pads to look useful.
  assert.match(prompt, /An empty array is an honest answer/);
});

test('the output contract matches the schema the runner validates against', () => {
  const contractKeys = Object.keys(NARRATIVE_SCHEMA.properties).sort();
  // M33 (C-06 "M33 written statements"): writtenClaims is asked for beside the four channels.
  assert.deepEqual(contractKeys, ['claims', 'decisions', 'pivots', 'requirements', 'writtenClaims']);
  const { prompt } = buildNarrativePrompt({ session, window: windows[0] });
  for (const key of contractKeys) assert.match(prompt, new RegExp(`"${key}":`));
});

test('the actual joint wire prompt retains the full authority-proof contract after stripping narrative framing', () => {
  const narrative = buildNarrativePrompt({ session, window: windows[0] });
  const joint = buildCodeReviewPrompt({ narrativePrompt: narrative,
    snapshot: { diff: '', files: [], sources: [], complete: false } });
  const schema = NARRATIVE_SCHEMA.properties.decisions.items.properties.instructionReview;
  for (const prompt of [narrative.prompt, `${joint.system}\n${joint.prompt}`]) {
    const example = prompt.match(/\{"dimension":"same dimension as this decision"[\s\S]*?\}\]\}/)?.[0];
    assert.ok(example, 'transport-visible text must supply the contract, independently of request.schema');
    const parsed = JSON.parse(example);
    assert.deepEqual(Object.keys(parsed).sort(), [...schema.required].sort());
    assert.deepEqual(Object.keys(parsed.checks[0]).sort(), [...schema.properties.checks.items.required].sort());
    assert.deepEqual(Object.keys(parsed.checks[0].instruction).sort(),
      [...schema.properties.checks.items.properties.instruction.required].sort());
    assert.equal(parsed.noRelevantInstruction, true);
    assert.equal(parsed.checks[0].relevant, false);
    assert.equal(parsed.checks[0].instruction.role, 'instruction');
  }
  assert.ok(!joint.evidencePrompt.includes('same dimension as this decision'),
    'the answer contract is framing, never evidence for a challenge');
  assert.ok(joint.evidencePrompt.includes(narrative.evidencePrompt), 'complete source suffix retained');
});
