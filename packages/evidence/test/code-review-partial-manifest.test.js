import test from 'node:test';
import assert from 'node:assert/strict';
import { fileReview, renderManifest } from '../src/code-review-prompt.js';

test('a shown partial file names withheld hunks without claiming the omitted patch was reviewed', () => {
  const snapshot = {
    files: [{ path: 'src/example.js', change: 'modified', contentState: 'partial',
      withheldHunks: [{ oldStart: 4, oldLines: 2, newStart: 4, newLines: 2, reason: 'redacted_content' }] }],
    blocks: [{ path: 'src/example.js', text: '@@ -1 +1 @@\n-old\n+new\n', additions: 1, deletions: 1 }],
    sources: [], unreviewable: [],
  };
  const [row] = fileReview(snapshot);
  assert.equal(row.reason, null);
  assert.equal(row.withheldCount, 1);
  const manifest = renderManifest([row], new Set([row.path]));
  assert.match(manifest, /1 hunk\(s\) withheld by redaction · shown/);
  assert.match(manifest, /omitted ranges remain unchecked/);
});
