// D149: every file whose hunks from the start commit Sonah holds keeps git's added and removed lines in the record,
// shown to the code review or left out of its input. The readers did not change, and they read the record: the header's
// size line gives the change's lines when every file has them, and the Files list gives git's lines for a file left out
// too, where before it gave the recording's own counts (for a file the session wrote whole: every line it wrote).
//
// Synthetic session and files, an in-memory repository reader and deterministic fake agents: no recording, no model, no
// network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSessionPage } from '../session-page.js';
import { renderReportMarkdown } from '../session-story.js';
import { reportModel } from '../report-model.js';
import { codeSnapshotPlan, freezeCodeSnapshot, runCodePass } from '../../evidence/src/code-pass.js';
import * as fixture from '../../cli/test/code-pass-fixture.js';
import { scenario, runScenario, FILES } from '../../evidence/test/d149-hunk-ledger-fixture.js';

const mods = { codeSnapshotPlan, freezeCodeSnapshot, runCodePass, fixture };
/** Three files the session wrote whole: two added, and b.js, modified in two lines (git: +2 −2; the write: 60 lines). */
const files = { 'src/a.js': FILES['src/a.js'], 'src/b.js': FILES['src/b.js'], 'src/m.js': FILES['src/m.js'] };
const textOf = (html) => html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, ' ').replace(/&#39;/g, '\'')
  .replace(/\s+/g, ' ');

async function readers(bound) {
  const f = scenario(mods, { files });
  const { codePass } = await runScenario(mods, { wholeFiles: false, bound, files });
  const report = { ...f.report, codePass };
  return { codePass, model: reportModel(f.session, report, {}), md: renderReportMarkdown(f.session, report),
    page: textOf(renderSessionPage(f.session, report)) };
}

test('D149: with one file left out of the code review\'s input, the header still gives the change\'s lines, and the Files list git\'s lines of each', async () => {
  // At this bound the request leaves out m.js, its largest file, for room.
  const { codePass, model, md, page } = await readers(33_616);
  assert.deepEqual(codePass.files.map((f) => [f.path, f.state]), [['src/a.js', 'shown'], ['src/b.js', 'shown'],
    ['src/m.js', 'left_out']]);
  assert.deepEqual(model.header.size, ['Claude Code recording', 'a change of 3 files, +405 −2', '0 commands']);
  assert.ok(md.includes('Claude Code recording · a change of 3 files, +405 −2 · 0 commands'), md);
  assert.ok(page.includes('a change of 3 files, +405 −2'));
  for (const line of ['- `src/a.js` · new · +3 −0\n', '- `src/b.js` · changed · +2 −2\n',
    '- `src/m.js` · new · +400 −0 · left out for room\n']) assert.ok(md.includes(line), line);
  for (const line of ['src/a.js · new · +3 −0', 'src/b.js · changed · +2 −2', 'src/m.js · new · +400 −0 · left out for room'])
    assert.ok(page.includes(line), line);
});

test('D149: with every file left out of the code review\'s input, each keeps git\'s lines, never the recording\'s count of its write', async () => {
  const { codePass, model, md, page } = await readers(12_000);
  assert.ok(codePass.files.every((f) => f.state === 'left_out'));
  assert.deepEqual(model.header.size, ['Claude Code recording', 'a change of 3 files, +405 −2', '0 commands']);
  assert.ok(md.includes('Claude Code recording · a change of 3 files, +405 −2 · 0 commands'), md);
  assert.ok(page.includes('a change of 3 files, +405 −2'));
  // b.js: git's two changed lines, not the 60 lines the session's write held.
  for (const line of ['- `src/a.js` · new · +3 −0 · left out for room\n',
    '- `src/b.js` · changed · +2 −2 · left out for room\n', '- `src/m.js` · new · +400 −0 · left out for room\n'])
    assert.ok(md.includes(line), line);
  for (const line of ['src/a.js · new · +3 −0 · left out for room', 'src/b.js · changed · +2 −2 · left out for room',
    'src/m.js · new · +400 −0 · left out for room']) assert.ok(page.includes(line), line);
  assert.ok(!md.includes('+60 −0') && !page.includes('+60 −0'));
});
