// D80 (owner decision 2026-10-12): the quoted line is shown. When a code quote the page shows on the after side of an
// edit (a decision's "Code written", a finding's code receipt) has its line in no hunk of that edit — a line the edit
// kept, outside every hunk — the preview is that line's own window of the edit, as many lines as a hunk's window,
// centred on it and marked, every line with its own mark, with one fixed sentence saying the edit did not change it;
// never the edit's first hunk with no line marked. A quote in a hunk keeps its hunk; a quote not in the written text
// keeps today's preview. The sentence is only as true as the body the edit is compared with: a write whose command did
// not run or failed is never that body. Verbatim search only. Every session here is synthetic; every string and path
// is invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSessionPage, escapeHtml, PAGE_SENTENCES, PAGE_LIMITS } from '../session-page.js';
import { sessionBuilder, STORY_KEY } from './session-story-fixture.js';

const KEPT = escapeHtml(PAGE_SENTENCES.keptLine);
const decided = (fields) => ({ actorSession: STORY_KEY, dimension: 'flag', chosen: 'a flag', value: null,
  valueReceipt: null, valueState: 'unchecked', actions: [], stated: null, constrainedBy: null, instructionReview: null,
  column: 'asked-chose', columnState: 'grounded', amends: [], materiality: 'material', materialityRule: 'synthetic',
  relevance: 'unchecked', reasons: [], ...fields });
const codeReceipt = (quote) => ({ eventId: 'W1', field: 'added-code', role: 'code', quote, sessionKey: STORY_KEY });
const windows = [{ windowIndex: 0, eventIds: ['I1', 'W1', 'W1-r'], failure: null }];
/** The markup of one shown item, by its id. */
const itemOf = (html, id) => html.slice(html.indexOf(`id="${id}"`), html.indexOf('</li>', html.indexOf(`id="${id}"`)));
/** The one change preview of an item. */
const previewOf = (item) => item.slice(item.indexOf('<details class="change">'), item.indexOf('</details>') + 10);
/** One preview line as the page writes it. */
const ln = (mark, text, key = false) => `<span class="ln${mark === '+' ? ' add' : mark === '-' ? ' del' : ''}`
  + `${key ? ' key' : ''}">${escapeHtml(`${mark}${text}`)}</span>`;
const lines = (n, at = new Map()) => Array.from({ length: n },
  (_, i) => (at.has(i) ? at.get(i) : `const line${i} = ${i};`));
const text = (rows) => `${rows.join('\n')}\n`;
const head = (label) => `<details class="change"><summary>${label} <code>src/flags.js</code> `
  + '<span class="mono">+1 −1</span></summary>';

/** A session with one succeeded Edit of `src/flags.js` from `before` to `after` (its replaced text recorded). */
function edited(before, after) {
  const b = sessionBuilder();
  b.ask('I1', 'Change the flag.');
  b.change('W1', 'src/flags.js', { operation: 'edit', before: text(before), after: text(after),
    priorState: 'edit-text' });
  return b.session();
}
/** The page of a decision whose code written is `quote` (grounded on the edit's after side), in `column`. */
const decisionPage = (before, after, quote, column = 'asked-chose') => renderSessionPage(edited(before, after), {
  windowResults: windows, sessionStatus: 'CLEAN', decisions: [decided({ column, actions: ['W1'], value: quote,
    valueState: 'grounded', valueReceipt: codeReceipt(quote) })] });
/** The page of a finding citing the edit by a code receipt quoting `quote`. */
const findingPage = (before, after, quote) => renderSessionPage(edited(before, after), { windowResults: windows,
  sessionStatus: 'FYI', findings: [{ origin: 'session-review', kind: 'claim_contradicted', status: 'FYI',
    title: 'The flag', receipts: [{ role: 'code', eventId: 'W1', quote, sessionKey: STORY_KEY }] }] });

test('D80 a quote in a hunk keeps its hunk, marked, with no sentence', () => {
  const before = lines(10);
  const after = lines(10, new Map([[5, "const line5 = 'on';"]]));
  const hunk = [[' ', before[3]], [' ', before[4]], ['-', before[5]], ['+', after[5]], [' ', before[6]],
    [' ', before[7]]];
  // The added line itself, and a kept line within the hunk's two lines of context.
  for (const [quote, key] of [["const line5 = 'on';", 3], ['const line3 = 3;', 0]]) {
    const preview = previewOf(itemOf(decisionPage(before, after, quote), 'decision-1'));
    assert.equal(preview, `${head('The edit it was made in:')}<pre class="diff"><span class="lines">`
      + hunk.map(([mark, line], i) => ln(mark, line, i === key)).join('') + '</span></pre></details>', quote);
    assert.ok(!preview.includes(KEPT));
  }
});

test('D80 a quote on a line the edit kept, outside every hunk, is shown in its own window of the edit', () => {
  // 40 lines, line 35 changed: the quoted line 5 is in no hunk. Its window is the edit's first 24 lines (centred on
  // line 5, held at the top), the line marked, and the sentence says the edit did not change it.
  const before = lines(40);
  const after = lines(40, new Map([[35, "const line35 = 'on';"]]));
  for (const column of ['asked-chose', 'unasked']) {
    const preview = previewOf(itemOf(decisionPage(before, after, 'const line5 = 5;', column), 'decision-1'));
    assert.equal(preview, `${head('The edit it was made in:')}<p class="note">${KEPT}</p>`
      + '<pre class="diff"><span class="lines">'
      + after.slice(0, PAGE_LIMITS.snippetLines).map((line, i) => ln(' ', line, i === 5)).join('')
      + '</span></pre><p class="cut">First 24 of 41 lines.</p></details>', column);
  }
  // Centred on the line when it is further down: line 20 of 60 (line 55 changed) shows the edit's lines 9-32 of 61.
  const far = previewOf(itemOf(decisionPage(lines(60), lines(60, new Map([[55, 'const line55 = 0;']])),
    'const line20 = 20;'), 'decision-1'));
  assert.ok(far.includes(`<p class="note">${KEPT}</p><pre class="diff"><span class="lines">`
    + ln(' ', 'const line8 = 8;')));
  assert.ok(far.includes(ln(' ', 'const line19 = 19;') + ln(' ', 'const line20 = 20;', true)
    + ln(' ', 'const line21 = 21;')));
  assert.ok(far.includes(`${ln(' ', 'const line31 = 31;')}</span></pre><p class="cut">Lines 9–32 of 61.</p>`));
  assert.equal((far.match(/<span class="ln/g) ?? []).length, PAGE_LIMITS.snippetLines);
  // A window that reaches a hunk shows it as the hunk would: the removed and the added line, each with its mark.
  const near = previewOf(itemOf(decisionPage(lines(30), lines(30, new Map([[10, "const line10 = 'on';"]])),
    'const line15 = 15;'), 'decision-1'));
  assert.ok(near.includes(`${ln(' ', 'const line9 = 9;')}${ln('-', 'const line10 = 10;')}`
    + `${ln('+', "const line10 = 'on';")}${ln(' ', 'const line11 = 11;')}`));
  assert.ok(near.includes(ln(' ', 'const line15 = 15;', true)));
  assert.ok(near.includes(`<pre class="diff"><span class="lines">${ln(' ', 'const line4 = 4;')}`));
  assert.ok(near.includes('<p class="cut">Lines 5–28 of 31.</p>'));
  // An edit of two hunks with the quoted line between them: the window is cut in the whole edit's lines, line 30 of
  // 60 (lines 2 and 57 changed) shows its lines 20-43 of 62, and names no hunk (it is none of them).
  const between = previewOf(itemOf(decisionPage(lines(60), lines(60, new Map([[2, 'x'], [57, 'y']])),
    'const line30 = 30;'), 'decision-1'));
  assert.ok(between.includes(`<p class="note">${KEPT}</p>`));
  assert.ok(between.includes(ln(' ', 'const line30 = 30;', true)));
  assert.ok(between.includes('<p class="cut">Lines 20–43 of 62.</p>'));
  assert.ok(!between.includes('Hunk'));
  // The line marked is where the quote itself is, verbatim: its first line also stands alone earlier in the text.
  const twice = new Map([[12, 'return x;'], [13, '}'], [20, 'return x;'], [21, '} // end'], [28, 'const line28 = 0;']]);
  const both = previewOf(itemOf(decisionPage(lines(30, new Map([...twice].slice(0, 4))), lines(30, twice),
    'return x;\n} // end'), 'decision-1'));
  assert.ok(both.includes(`${ln(' ', 'return x;', true)}${ln(' ', '} // end')}`));
  assert.ok(both.includes(`${ln(' ', 'return x;')}${ln(' ', '}')}`), 'the earlier line is shown, not marked');
  // A finding's code receipt on the after side is shown the same way.
  const cited = previewOf(itemOf(findingPage(before, after, 'const line5 = 5;'), 'finding-1'));
  assert.ok(cited.startsWith(`${head('The edit it cites:')}<p class="note">${KEPT}</p>`));
  assert.ok(cited.includes(ln(' ', 'const line5 = 5;', true)));
});

test('D80 a quote not in the written text keeps today\'s preview', () => {
  const before = lines(40);
  const after = lines(40, new Map([[35, "const line35 = 'on';"]]));
  const hunk = [33, 34].map((i) => [' ', before[i]]).concat([['-', before[35]], ['+', after[35]]],
    [36, 37].map((i) => [' ', before[i]]));
  // A finding quoting the line the edit removed: its hunk, the removed line marked.
  const html = findingPage(before, after, 'const line35 = 35;');
  assert.equal(previewOf(itemOf(html, 'finding-1')), `${head('The edit it cites:')}<pre class="diff">`
    + `<span class="lines">${hunk.map(([mark, line]) => ln(mark, line, mark === '-')).join('')}</span></pre>`
    + '</details>');
  // A decision whose quoted code is not on the edit's after side shows no code written and its edit's first hunk,
  // with no line marked, as before.
  const item = itemOf(decisionPage(before, after, 'const line35 = 35;'), 'decision-1');
  assert.equal(previewOf(item), `${head('The edit it was made in:')}<pre class="diff"><span class="lines">`
    + hunk.map(([mark, line]) => ln(mark, line)).join('') + '</span></pre></details>');
  assert.ok(item.includes(escapeHtml(PAGE_SENTENCES.howCodeMissing)));
  assert.ok(!html.includes(KEPT) && !item.includes(KEPT));
});

/** A blob of the builder's session, referenced whole. */
const blob = (b, key, value) => {
  b.blobs[key] = value;
  return value === '' ? [] : [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(value, 'utf8') }];
};
/** A Bash call that `end`s as given, as d79-refusals.test.js builds it: a refusal is an error result and the recorder's
 *  typed denial on the call, a failure an error result and its exit code. */
function command(b, id, cmd, end) {
  const ok = end === 'succeeded', refused = end === 'refused';
  b.events.push({ sequence: b.events.length, id, kind: 'invocation', callKey: id, tool: 'Bash', operation: 'command',
    paths: [], command: blob(b, `${id}-cmd`, cmd), input: [], changes: [],
    recorded: { tool: 'Bash', ...(ok ? {} : { isError: true }), ...(refused ? { denial: 'user-rejected' } : {}) } });
  b.events.push({ sequence: b.events.length, id: `${id}-r`, kind: 'observation', invocation: id, callKey: id,
    phase: 'terminal', result: ok ? 'succeeded' : 'failed', exitCode: ok ? 0 : refused ? null : 1,
    terminalStatusProven: true, output: [], sourceOfResult: 'native' });
}
/** The write the slicer parses from a `cat > path <<'EOF'` command: the path and the body, no result of its own. */
function heredoc(b, id, of, path, body) {
  b.events.push({ sequence: b.events.length, id, kind: 'invocation', callKey: id, tool: 'heredoc', operation: 'edit',
    paths: [{ path }], command: [], input: [], shellWriteOf: of, shellWriteStatusEligible: true,
    changes: [{ path, before: [], after: blob(b, `${id}-after`, body), diff: [],
      extent: { chars: body.length, lines: body.split('\n').length, truncated: false, cap: null, recorded: true,
        redactedLines: 0, priorState: 'none' } }] });
}

test('D80 the sentence never rests on a write that may not have happened', () => {
  // The agent's Write of `src/flags.js` after a here-document wrote the same path: the quoted line 5 is in both bodies.
  // Only a here-document whose command ran and did not fail is the body the Write is compared with, so only then is
  // line 5 a line the edit kept, shown in its own window under the sentence. After one whose command did not run or
  // failed (D79; D80's first answer keeps a failed one's row, never its body as the base), the Write has no recorded
  // prior: every line is an added one, line 5 is marked in that hunk, and no sentence says the edit did not change it.
  const before = text(lines(40)), after = text(lines(40, new Map([[35, "const line35 = 'on';"]])));
  const preview = (end) => {
    const b = sessionBuilder();
    b.ask('I1', 'Change the flag.');
    command(b, 'H1', `cat > src/flags.js <<'EOF'\n${before}EOF`, end);
    heredoc(b, 'H1-w1', 'H1', 'src/flags.js', before);
    b.change('W1', 'src/flags.js', { after });
    const session = b.session();
    const report = { windowResults: [{ windowIndex: 0, eventIds: session.events.map((event) => event.id),
      failure: null }], sessionStatus: 'CLEAN', decisions: [decided({ actions: ['W1'], value: 'const line5 = 5;',
      valueState: 'grounded', valueReceipt: codeReceipt('const line5 = 5;') })] };
    return previewOf(itemOf(renderSessionPage(session, report), 'decision-1'));
  };
  const ran = preview('succeeded');
  assert.ok(ran.includes(`<p class="note">${KEPT}</p>`) && ran.includes(ln(' ', 'const line5 = 5;', true)));
  for (const end of ['refused', 'failed']) {
    const shown = preview(end);
    assert.ok(!shown.includes(KEPT), end);
    assert.ok(shown.includes(ln('+', 'const line5 = 5;', true)), end);
    const count = (pattern) => (shown.match(pattern) ?? []).length;
    assert.equal(count(/<span class="ln add/g), count(/<span class="ln/g), `${end}: every line shown is an added one`);
  }
});
