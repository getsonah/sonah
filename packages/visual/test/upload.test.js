// The upload the local page carries (src/upload.mjs): one shape for the laptop client and the page, escaped for a
// script element, only within the server's cap; the local page's "Save online" and "Invite your team" (mode 'local'
// with a server only); the page's bytes the same for the same input.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { layout } from '../src/layout.mjs';
import { render, shareLink, shareParts } from '../src/render.mjs';
import { scriptJson, uploadBody, uploadText, UPLOAD_MAX_BYTES } from '../src/upload.mjs';
import { loadPage } from './dom.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, 'fixtures');
const load = (name) => {
  const r = (f) => JSON.parse(readFileSync(join(FIX, name, f), 'utf8'));
  return { facts: r('facts.json'), meaning: r('meaning.json'), findings: r('findings.json'), run: r('run.json') };
};
const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);
const D211 = load('d211');
const L211 = await layout(D211.facts, D211.meaning, D211.findings);
const SERVER = 'https://pr.example.test';
const urlOf = (x, owner = 'acme', repo = 'web') => shareLink(SERVER, { owner, repo, head: x.facts.range.head });
// The local page as job.mjs draws it: the hosted page in the upload, the local page carrying it.
function localPage(x, L, { owner = 'acme', name = 'web', branch = 'feature/key', shareUrl = urlOf(x, owner, name), page = null } = {}) {
  const hosted = page ?? render({ ...x, layout: L });
  const upload = uploadBody({ owner, name, branch, page: hosted, facts: x.facts, meaning: x.meaning, findings: x.findings, run: x.run });
  return { html: render({ ...x, layout: L, mode: 'local', shareUrl, upload }), upload, hosted };
}
const dataOf = (html) => /<script type="application\/json" id="sonah-upload" data-action="([^"]*)">([\s\S]*?)<\/script>/.exec(html);
// the buttons and the upload as markup (the stylesheet and the client script name them too)
const SHARE_MARKUP = /id="saveonline"|id="invite2?"|<script type="application\/json"|<header class="top with-share">/;

test('uploadBody: the body of POST /api/uploads, its keys in order, the range from the facts', () => {
  const x = D211;
  const body = uploadBody({ owner: 'acme', name: 'web', branch: 'main', page: '<!doctype html>', ...x });
  assert.deepEqual(Object.keys(body), ['repo', 'branch', 'base', 'head', 'page', 'facts', 'meaning', 'findings', 'run']);
  assert.deepEqual(body.repo, { owner: 'acme', name: 'web' });
  assert.deepEqual([body.base, body.head], [x.facts.range.base, x.facts.range.head]);
  assert.equal(body.facts, x.facts);
  // a branch not known is null, never empty or another type
  for (const b of [undefined, null, '', 7]) assert.equal(uploadBody({ owner: 'a', name: 'b', branch: b, page: '', ...x }).branch, null);
  assert.equal(UPLOAD_MAX_BYTES, 25 * 1024 * 1024);
});

test('scriptJson: no "<" and no line separator survive, and it parses to the same value', () => {
  const v = { q: `x </script><script>alert(1)</script> <!-- y ${LS} z ${PS}`, n: [1, -0, 1e21], s: 'naïve \u0000 \n' };
  const text = scriptJson(v);
  assert.doesNotMatch(text, /[<\u2028\u2029]/);
  assert.ok(text.includes('\\u003c/script>') && text.includes('\\u2028') && text.includes('\\u2029'));
  assert.deepEqual(JSON.parse(text), JSON.parse(JSON.stringify(v)));
  // over the cap: none; at most the cap: the text
  assert.equal(uploadText({ page: 'x'.repeat(UPLOAD_MAX_BYTES) }), null);
  assert.equal(uploadText({ page: 'x' }), '{"page":"x"}');
});

test('the local page carries its upload: exactly uploadBody\'s, escaped for its script element (</script> and U+2028 in a quote)', async () => {
  // a finding whose quote holds </script> and a line separator, a one-liner with the other separator
  const x = structuredClone(D211);
  x.findings[0].quote = `if (a </script><b>) return "${LS}";`;
  x.meaning.functions[Object.keys(x.meaning.functions)[0]].summary = `Ends a line${PS}here.`;
  const L = await layout(x.facts, x.meaning, x.findings);
  const { html, upload, hosted } = localPage(x, L);
  const m = dataOf(html);
  assert.ok(m, 'the page carries it');
  assert.equal(m[1], `${SERVER}/share`, 'posted to the server\'s /share');
  assert.equal(m[2], scriptJson(upload));
  assert.deepEqual(JSON.parse(m[2]), JSON.parse(JSON.stringify(upload)));
  assert.equal(JSON.parse(m[2]).page, hosted, 'the review drawn in mode hosted');
  assert.equal(JSON.parse(m[2]).findings[0].quote, x.findings[0].quote);
  // a browser reads the same text back: the script element ends where it should and the page's own script still runs
  const { document, window } = loadPage(html);
  const el = document.getElementById('sonah-upload');
  assert.deepEqual(JSON.parse(el.textContent), JSON.parse(JSON.stringify(upload)));
  assert.equal(document.querySelectorAll('script').length, 3, 'the theme, the upload (data), the data and client');
  assert.equal(typeof window.SONAH, 'undefined', 'SONAH is the script\'s own const');
  assert.ok(document.getElementById('card'), 'the page after it is whole');
  // the hosted page in it has no upload, no buttons and keeps its bridge
  assert.ok(!SHARE_MARKUP.test(hosted) && hosted.includes('sonah:ready'));
});

test('over the cap the page carries no upload, and both buttons are plain links to the server\'s /share page', () => {
  const x = D211;
  const big = render({ ...x, layout: L211 }) + `<!-- ${'x'.repeat(UPLOAD_MAX_BYTES)} -->`;
  const { html } = localPage(x, L211, { page: big });
  assert.equal(dataOf(html), null);
  const url = urlOf(x).replace(/&/g, '&amp;');
  for (const id of ['saveonline', 'invite', 'invite2']) {
    assert.match(html, new RegExp(`<a class="btn (quiet|strong)" id="${id}" href="${url.replace(/[.?]/g, '\\$&')}" target="_blank" rel="noopener" data-intent="(save|invite)"`), id);
  }
  // an upload of another review (repository, head or base) is never carried
  const hosted = render({ ...x, layout: L211 });
  const good = uploadBody({ owner: 'acme', name: 'web', branch: null, page: hosted, ...x });
  for (const bad of [{ ...good, repo: { owner: 'acme', name: 'other' } }, { ...good, repo: { owner: 'evil', name: 'web' } },
    { ...good, head: 'f'.repeat(40) }, { ...good, base: 'e'.repeat(40) }, 'text', 42]) {
    assert.equal(dataOf(render({ ...x, layout: L211, mode: 'local', shareUrl: urlOf(x), upload: bad })), null);
  }
});

test('"Save online" and "Invite your team": on the local page with a server only, top right and at the end of Decide', () => {
  const x = D211;
  const { html } = localPage(x, L211);
  const head = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
  // after the theme switch, in this order: the quiet one, then the strong one
  const order = ['id="theme"', 'id="saveonline"', 'id="invite"'].map((s) => head.indexOf(s));
  assert.ok(order.every((n) => n > 0) && order[0] < order[1] && order[1] < order[2], String(order));
  assert.match(head, /<header class="top with-share">/);
  assert.match(head, /class="btn quiet" id="saveonline"[^>]*data-intent="save" aria-label="Save online"><svg class="i-link"[^>]*>[\s\S]*?<\/svg><span>Save<span class="lw"> online<\/span><\/span><\/a>/);
  assert.match(head, /class="btn strong" id="invite"[^>]*data-intent="invite" aria-label="Invite your team"><span>Invite<span class="lw"> your team<\/span><\/span><\/a>/);
  // one strong button in the header; Decide ends with the other, in full
  assert.equal((head.match(/btn strong/g) ?? []).length, 1);
  const decide = html.slice(html.indexOf('<section class="stop" id="decide"'), html.indexOf('<section class="stop" id="read"'));
  assert.match(decide, /<div class="close">[\s\S]*<a class="btn strong" id="invite2"[^>]*data-intent="invite"[^>]*><span>Invite your team<\/span><\/a><\/div>\s*<\/section>\s*$/);
  assert.ok(!/Share with your team|id="copylink"|id="share2"/.test(html));
  // no server known (no push remote), or not a share url: neither button and no upload
  for (const bad of [null, 'javascript:alert(1)', `${SERVER}/share?owner=a&repo=b`, `${SERVER}/x?owner=a&repo=b&head=c`]) {
    const page = render({ ...x, layout: L211, mode: 'local', shareUrl: bad, upload: localPage(x, L211).upload });
    assert.ok(!SHARE_MARKUP.test(page), String(bad));
  }
  // the hosted page: never, whatever it is given; its copy link stays
  const hosted = render({ ...x, layout: L211, mode: 'hosted', shareUrl: urlOf(x), upload: localPage(x, L211).upload });
  assert.ok(!SHARE_MARKUP.test(hosted));
  assert.ok(hosted.includes('id="copylink"'));
  // framed (the bridge marks the root), the buttons and the page's own theme switch are hidden
  assert.match(html, /\[data-sonah-framed\] #theme, \[data-sonah-framed\] \[data-intent\]\{display:none\}/);
  // on phones they stay at the top right, short; up to 760 px (a half-screen window too) the repository moves under them
  assert.match(html, /@media \(max-width:760px\)\{ \.top\.with-share \.crumb\{order:3; flex-basis:100%\} \}/);
  assert.match(html, /@media \(max-width:480px\)\{ \.lw\{display:none\}/);
  // shareParts: what the page takes from a share url
  assert.deepEqual(shareParts(urlOf(x)), { action: `${SERVER}/share`, owner: 'acme', repo: 'web', head: x.facts.range.head });
  assert.equal(shareParts('https://pr.example.test/share?owner=a&repo=b'), null);
});

test('the local page with its upload: the same bytes for the same input, in this process and a fresh one', () => {
  const a = localPage(D211, L211).html, b = localPage(D211, L211).html;
  assert.equal(a, b);
  const script = `const { layout } = await import(${JSON.stringify(join(HERE, '..', 'src', 'layout.mjs'))});
const { render, shareLink } = await import(${JSON.stringify(join(HERE, '..', 'src', 'render.mjs'))});
const { uploadBody } = await import(${JSON.stringify(join(HERE, '..', 'src', 'upload.mjs'))});
const { readFileSync } = await import('node:fs');
const r = (f) => JSON.parse(readFileSync(${JSON.stringify(join(FIX, 'd211'))} + '/' + f, 'utf8'));
const x = { facts: r('facts.json'), meaning: r('meaning.json'), findings: r('findings.json'), run: r('run.json') };
const L = await layout(x.facts, x.meaning, x.findings);
const shareUrl = shareLink(${JSON.stringify(SERVER)}, { owner: 'acme', repo: 'web', head: x.facts.range.head });
const upload = uploadBody({ owner: 'acme', name: 'web', branch: 'feature/key', page: render({ ...x, layout: L }), ...x });
console.log((await import('node:crypto')).createHash('sha256').update(render({ ...x, layout: L, mode: 'local', shareUrl, upload })).digest('hex'));`;
  const fresh = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }).trim();
  assert.equal(fresh, createHash('sha256').update(a).digest('hex'));
});
