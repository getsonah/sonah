// D108 (the owner, 2026-10-17: "Yes, keep it on for now"), held to the code: what docs/PRIVACY.md and docs/INSTALL.md
// say the code step sends is what it sends by default. With part B on (evidence/src/code-pass.js `CODE_WHOLE_FILES.on`),
// both say that the review agent is given each changed file whole and the lines the session read of files it left
// unchanged, within the block's cap; and PRIVACY no longer says the rule and skill files are cut (D105 sends them whole).
// Each statement is asked to be there exactly while the setting is on, so turning it off asks the docs to change too.
// No recording, no model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CODE_WHOLE_FILES, CODE_CHANGE_BLOCK_MAX_BYTES } from '../../evidence/src/code-pass.js';

const PRIVACY = await readFile(new URL('../../../docs/PRIVACY.md', import.meta.url), 'utf8');
const INSTALL = await readFile(new URL('../../../docs/INSTALL.md', import.meta.url), 'utf8');
const flat = (text) => text.replace(/\s+/g, ' ');
const GIVEN = 'each changed file whole, the lines the session read of files it left unchanged';
const kb = (bytes) => `about ${bytes / 1000} KB`;

test('D108 premise: the code step gives the review agent each changed file whole and the session\'s reads by default, '
  + 'each block within 400,000 bytes, the change block\'s own cap', () => {
  assert.equal(CODE_WHOLE_FILES.on, true);
  assert.deepEqual([CODE_WHOLE_FILES.maxBytes, CODE_WHOLE_FILES.readsMaxBytes], [400_000, 400_000]);
  assert.equal(CODE_WHOLE_FILES.maxBytes, CODE_CHANGE_BLOCK_MAX_BYTES);
});

test('D108 docs/PRIVACY.md: what leaves your computer with the code step names each changed file whole and the lines '
  + 'the session read, at their cap; no rule or skill file is said to be cut', () => {
  const row = PRIVACY.split('\n').find((line) => line.startsWith('| With the code step only'));
  assert.ok(row, 'the code step\'s row of the table');
  const words = flat(row);
  assert.equal(words.includes(`each changed file whole, as it is now, smallest first, up to ${kb(CODE_WHOLE_FILES.maxBytes)}`),
    CODE_WHOLE_FILES.on);
  assert.equal(words.includes(`in files that did not change since the start commit, as they are now, up to ${kb(
    CODE_WHOLE_FILES.readsMaxBytes)}`), CODE_WHOLE_FILES.on);
  assert.ok(words.includes('the skill files of the repository it used (as they are now), each whole.'));
  assert.ok(!/first and last 3,600 characters/.test(words), 'D105: the rule and skill files go whole');
  // The review command's own line says what the review agent is given.
  const review = flat(PRIVACY.slice(PRIVACY.indexOf('- **`sonah review`**'), PRIVACY.indexOf('- **`sonah doctor`**')));
  assert.equal(review.includes(`given the change the session made, ${GIVEN}`), CODE_WHOLE_FILES.on);
});

test('D108 docs/INSTALL.md: how the code step reviews the change names each changed file whole and the lines the '
  + 'session read, and the cap of the whole files', () => {
  const at = INSTALL.indexOf('## How the code step reviews the change');
  assert.ok(at >= 0);
  const section = flat(INSTALL.slice(at, INSTALL.indexOf('\n## ', at + 1)));
  assert.equal(section.includes(`It gives that change, ${GIVEN}`), CODE_WHOLE_FILES.on);
  assert.equal(section.includes(`the whole files fill up to ${kb(CODE_WHOLE_FILES.maxBytes)}`), CODE_WHOLE_FILES.on);
});
