// F59: the changed-files manifest is capped, and the JSON "Frozen PR manifest" section is not
// repeated when the narrative already rendered one. Synthetic only — no model, no provider, no
// recording.
import test from 'node:test';
import assert from 'node:assert/strict';
import { redisPivotSession } from '../fixtures/redis-pivot.js';
import { planWindows } from '../src/windows.js';
import { buildNarrativePrompt } from '../src/prompt.js';
import { buildCodeReviewPrompt, renderManifest, fileReview, MANIFEST_MAX_FILES, FILE_STATES,
  CODE_REVIEW_VERSION } from '../src/code-review-prompt.js';

const session = redisPivotSession();
const window = planWindows(session)[0];

function row(i) {
  return { path: `src/module-${String(i).padStart(4, '0')}.js`, oldPath: null,
    change: 'modified', additions: 1, deletions: 0, reason: null };
}

function syntheticSnapshot() {
  return { diff: 'diff --git a/x.js b/x.js\n--- a/x.js\n+++ b/x.js\n@@ -1 +1 @@\n-a\n+b\n',
    files: [{ path: 'x.js', oldPath: null, change: 'modified', contentState: 'complete' }],
    sources: [], baseOid: 'a'.repeat(40), headOid: 'b'.repeat(40), complete: true };
}

// ---- the cap itself -------------------------------------------------------------------

test('F59: 1,000 changed files render as MANIFEST_MAX_FILES lines plus one overflow line', () => {
  assert.equal(MANIFEST_MAX_FILES, 400);
  const rows = Array.from({ length: 1000 }, (_, i) => row(i));
  const manifest = renderManifest(rows, new Set([row(0).path]));
  const fileLines = manifest.split('\n').filter((l) => l.startsWith('- '));
  assert.equal(fileLines.length, MANIFEST_MAX_FILES);
  assert.match(manifest, /… and 600 more changed files not listed\.$/m);
  // The files actually placed in this request are always inside the first MANIFEST_MAX_FILES
  // rows in this fixture (pr.files order), so the "shown" declaration must survive the cap.
  assert.match(manifest, new RegExp(`${row(0).path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} · modified · \\+1/-0 · shown`));
});

test('F59: a request under the cap lists every file and adds no overflow line', () => {
  const rows = Array.from({ length: 10 }, (_, i) => row(i));
  const manifest = renderManifest(rows, new Set());
  const fileLines = manifest.split('\n').filter((l) => l.startsWith('- '));
  assert.equal(fileLines.length, 10);
  assert.doesNotMatch(manifest, /more changed files not listed/);
});

// ---- the JSON manifest no longer duplicates the rendered one ---------------------------

test('F59: a rendered manifest in the narrative suppresses the duplicate JSON manifest section', () => {
  const snapshot = syntheticSnapshot();
  const rows = fileReview(snapshot);
  const manifestText = renderManifest(rows, new Set(['x.js']));
  const narrative = buildNarrativePrompt({ session, window, hunks: '', manifest: manifestText });
  // F153: the caller says it rendered one; the text is never searched for it.
  const joint = buildCodeReviewPrompt({ narrativePrompt: narrative, snapshot, placed: ['x.js'], manifestRendered: true });
  assert.equal((joint.evidencePrompt.match(/## Changed files \(manifest\)/g) ?? []).length, 1,
    'the rendered manifest must appear exactly once');
  assert.ok(!joint.evidencePrompt.includes('## Frozen PR manifest'),
    'the JSON manifest must not repeat the same file list');
});

test('F59: without a rendered manifest, the JSON manifest section is still supplied', () => {
  const snapshot = syntheticSnapshot();
  const narrative = buildNarrativePrompt({ session, window });
  const joint = buildCodeReviewPrompt({ narrativePrompt: narrative, snapshot });
  assert.ok(joint.evidencePrompt.includes('## Frozen PR manifest'),
    'the only file declaration available must not be dropped');
  assert.ok(!joint.evidencePrompt.includes('## Changed files (manifest)'));
});

// ---- F105: a file whose diff did not parse is declared as that, not as withheld -------------

test('F105: the manifest says a file\'s diff did not parse, in its own closed state', () => {
  assert.equal(FILE_STATES.diff_unparsed, 'diff did not parse · not reviewable');
  const manifest = renderManifest([{ ...row(1), reason: 'diff_unparsed' }, { ...row(2), reason: 'withheld' }], new Set());
  const line = (n) => manifest.split('\n').find((l) => l.startsWith(`- ${row(n).path} ·`));
  assert.match(line(1), /· diff did not parse · not reviewable$/, 'redaction withheld nothing from this file');
  assert.match(line(2), /· withheld · not reviewable$/, 'a withheld file keeps its own state');
});

// ---- F121: a session-only request's fixed text names no manifest it does not carry ----------

const taskOf = (prompt) => prompt.slice(0, prompt.indexOf('\n## The session\n'));

test('F121: the session-only TASK never mentions a file manifest; a request with PR code still explains it', () => {
  const snapshot = syntheticSnapshot();
  const sessionOnly = buildCodeReviewPrompt({ snapshot, placed: [],
    narrativePrompt: buildNarrativePrompt({ session, window, diff: null, hunks: '', manifest: null }) });
  assert.match(sessionOnly.prompt, /## Pull-request code — none in this request/, 'the fixture is a session-only request');
  assert.ok(taskOf(sessionOnly.prompt).length > 0);
  assert.doesNotMatch(taskOf(sessionOnly.prompt), /manifest/i,
    'the fixed task text must not point the model at a manifest this request does not carry');
  assert.doesNotMatch(taskOf(sessionOnly.prompt), /marked "shown"/);

  const rows = fileReview(snapshot);
  const withCode = buildCodeReviewPrompt({ snapshot, placed: ['x.js'], manifestRendered: true,
    narrativePrompt: buildNarrativePrompt({ session, window, hunks: '', manifest: renderManifest(rows, new Set(['x.js'])) }) });
  assert.match(taskOf(withCode.prompt), /The file manifest lists every file this\npull request changed/,
    'a request that carries a manifest still says how to read it');
  // The request's bytes changed, so the instrument that produced them is a new version.
  // /9: shown files first in the manifest (F152); the manifest flag (F153).
  // /10: no PR-global value in a request — content source ids, no revision, local sizes (F225).
  // /12 (M33 H1): claims may carry resolvedBy (C-06 "M33 self-corrected claims").
  // /13 (M33): the narrative schema it closes grew writtenClaims (C-06 "M33 written statements").
  // M33 brittleness M4 moved it (`sonah.code-review/14`): a session finding's disclosure is its own proposition.
  // M33 integration moved it once more (`sonah.code-review/15`): one version above M33 forbidden-edit repair's /14.
  // Stable event ids moved it once more (`sonah.code-review/16`): every recorded event's id (C-01 event identity).
  // The D64 wording moved it once more (`sonah.code-review/17`): the joint task's disclosure sentence.
  // M35 windowing moved it once more (`sonah.code-review/18`): the narrative evidence it embeds (windows, trims, task).
  // M36 phase 1 moved it once more (`sonah.code-review/19`): the evidence it carries (D68; RECORDED_FACTS_VERSIONS).
  // M36 phase 2 moved it once more (`sonah.code-review/20`): the window format (D68; FORMAT_VERSIONS).
  // M36 phase 3 moved it once more (`sonah.code-review/21`): packed windows, carried failures, the evidence re-ask (D68 K, Q, F; CONVERSATION_VERSIONS).
  // D69 moved it once more (`sonah.code-review/22`): the net view's declines reverted, the harness home folders, the recorder's cwd (D69_VERSIONS).
  // The D69 review moved it once more (`sonah.code-review/23`): the narrative evidence a joint request embeds moved as the narrative's (D69_REVIEW_VERSIONS).
  // D71 (S2) moved it once more (sonah.code-review/24): the reviewer brief as the checklist (D71_BRIEF_VERSIONS).
  assert.equal(CODE_REVIEW_VERSION, 'sonah.code-review/24');
  assert.equal(sessionOnly.promptVersion, CODE_REVIEW_VERSION);
});
