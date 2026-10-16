// D90 (owner decision 2026-10-15, privacy is not a design constraint): the page and the report .md (the story since
// /32) show the session as the recording holds it, and say so. Their own words never speak of redaction: nothing they show was masked or withheld for
// a person. The words that changed with it are pinned here as written.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as page from '../session-page.js';
import * as story from '../session-story.js';
import * as words from '../report-words.js';

test('D90: the page and the report .md name the recorded session, and a message with no words as the recording\'s', () => {
  // D97: the page's and the report .md's footer say it once, in the report's words.
  assert.equal(words.REPORT_FOOTER_WORDS.share, 'Read this report before you share it.');
  assert.equal(words.REPORT_PROMPT_WORDS.withheldMessage, 'The recording holds no words of this message.');
  assert.equal(page.PAGE_GAP_WORDS.instruction_omitted, 'the recorder or Sonah cut short one of your messages here');
});

test('D90: no word of the page\'s or the report .md\'s own speaks of redaction', () => {
  // Every text either module exports (its word tables, and each sentence a table builds from counts), walked whole.
  const hits = [];
  const seen = new Set();
  const walk = (value, path) => {
    if (typeof value === 'string') { if (/redact/i.test(value)) hits.push(`${path}: ${value}`); return; }
    if (typeof value === 'function') {
      if (path.includes('.')) {
        let said;
        try { said = value({ n: 2, m: 3 }); } catch { said = undefined; }
        walk(said, `${path}()`);
      }
      return;
    }
    if (value !== null && typeof value === 'object' && !seen.has(value)) {
      seen.add(value);
      for (const [key, item] of Object.entries(value)) walk(item, `${path}.${key}`);
    }
  };
  for (const [name, module] of [['page', page], ['story', story], ['words', words]])
    for (const [key, value] of Object.entries(module)) walk(value, `${name}.${key}`);
  assert.deepEqual(hits, []);
});
