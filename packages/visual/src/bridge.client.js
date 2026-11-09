// The page side of the frame protocol (the hosted server's review frame and rail). On the team page the review is shown
// in a sandboxed iframe from another origin, and the decision rail around it talks to this page by postMessage only:
//   page -> rail  { type: 'sonah:ready', keys }      once, when the page has drawn: the item keys it shows, in page
//                                                    order (each data-key, and each data-fn naming one function), at
//                                                    most 10000
//   page -> rail  { type: 'sonah:item', key, kind }  a finding row or pin clicked, a function chip, step or button
//                                                    clicked, or the card come to show a function (kind: finding |
//                                                    function)
//   rail -> page  { type: 'sonah:marks', marks }     the whole set each time: { <key>: { act } }, act one of confirm,
//                                                    override, not_right, question; a key not listed is unmarked
//   rail -> page  { type: 'sonah:open', key }        show that item: scroll to the finding, open the function's card
//   rail -> page  { type: 'sonah:theme', theme }     the team page's theme (its one theme switch), on ready and on each
//                                                    change: 'light' or 'dark', shown as the page's data-theme. The
//                                                    page's own switch is hidden while framed (page.css), so the page
//                                                    never sets a theme of its own there
// Only plain objects from window.parent are read, of these types, with the page's own keys, the closed acts and the
// two themes; other fields are ignored. No text of a message is ever put in the page: an item is marked by
// data-mark="<act>" on each element that carries its key. Outside a frame this does nothing. Shared code (MIT), no
// network, no clock.
(() => {
  const w = window;
  let parent = null;
  try { parent = w.parent; } catch (e) { return; }
  if (!parent || parent === w) return;
  const doc = document;
  const ACTS = ['confirm', 'override', 'not_right', 'question'];
  const MAX_KEYS = 10000;
  const has = Object.prototype.hasOwnProperty;
  const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  const okKey = (k) => typeof k === 'string' && k.length > 0 && k.length <= 1024 && !/[\u0000-\u001f\u007f]/.test(k);
  const all = (sel) => Array.prototype.slice.call(doc.querySelectorAll(sel));
  const post = (msg) => { try { parent.postMessage(msg, '*'); } catch (e) { /* the rail is gone */ } };

  // The items: each element with a data-key (finding rows, function chips and steps, a finding's function buttons) or
  // with the data-fn of one function (a Read heading, a folded function); one key on many elements is one item.
  const keyOf = (el) => (el.hasAttribute('data-key') ? el.getAttribute('data-key') : el.getAttribute('data-fn'));
  const keys = [];
  const known = new Set();
  for (const el of all('[data-key], [data-fn]')) {
    const k = keyOf(el);
    if (!okKey(k) || known.has(k) || keys.length >= MAX_KEYS) continue;
    known.add(k);
    keys.push(k);
  }
  const isItem = (el) => !!el && el.nodeType === 1 && (el.hasAttribute('data-key') || el.hasAttribute('data-fn')) && known.has(keyOf(el));
  const itemEls = () => all('[data-key], [data-fn]').filter(isItem);
  const kindOf = (el) => (el.hasAttribute('data-fn') ? 'function' : 'finding');
  const classed = (el, c) => (` ${el.getAttribute('class') || ''} `).indexOf(` ${c} `) >= 0;
  const shown = (el) => { try { return el.getClientRects().length > 0; } catch (e) { return false; } };

  // The item a click is on: the nearest item, or the item a link (a finding pin) points at.
  function itemOf(node) {
    for (let n = node; n && n !== doc; n = n.parentNode) {
      if (n.nodeType !== 1) continue;
      const href = String(n.tagName || '').toLowerCase() === 'a' ? n.getAttribute('href') : null;
      if (href && href.charAt(0) === '#') {
        let id = '';
        try { id = decodeURIComponent(href.slice(1)); } catch (e) { /* not an id */ }
        const to = id ? doc.getElementById(id) : null;
        if (isItem(to)) return to;
      }
      if (isItem(n)) return n;
    }
    return null;
  }

  // After the page's own handler has run: a finding clicked is told; a function clicked is told when its card opened
  // (a second click closes it); a card that comes to show another function (a tab, a file's list) tells that one. The
  // card names the function it shows in data-card-fn (page.client.js).
  let quiet = false; // while the page opens an item the rail asked for, nothing is told back
  let showing = null; // the function the open card showed after the last click
  doc.addEventListener('click', (ev) => {
    const tell = !quiet;
    const el = itemOf(ev.target);
    setTimeout(() => {
      const card = doc.getElementById('card');
      const open = !!card && !card.hidden;
      const was = showing;
      const now = open ? card.getAttribute('data-card-fn') : null;
      showing = now && known.has(now) ? now : null;
      if (!tell) return;
      if (el && kindOf(el) === 'finding') post({ type: 'sonah:item', key: keyOf(el), kind: 'finding' });
      else if (el && open) post({ type: 'sonah:item', key: keyOf(el), kind: 'function' });
      else if (showing && showing !== was) post({ type: 'sonah:item', key: showing, kind: 'function' });
    }, 0);
  });

  function applyMarks(marks) {
    if (!isObj(marks)) return;
    for (const el of itemEls()) {
      const k = keyOf(el);
      const v = has.call(marks, k) ? marks[k] : null;
      const act = isObj(v) && ACTS.indexOf(v.act) >= 0 ? v.act : null;
      if (act) el.setAttribute('data-mark', act); else el.removeAttribute('data-mark');
    }
  }

  function firstFocusable(el) {
    const kids = Array.prototype.slice.call(el.children || []);
    for (const c of kids) {
      const tag = String(c.tagName || '').toLowerCase();
      if (tag === 'button' || tag === 'summary' || (tag === 'a' && c.hasAttribute('href')) || c.hasAttribute('tabindex')) return c;
      const inner = firstFocusable(c);
      if (inner) return inner;
    }
    return null;
  }

  function openItem(key) {
    if (!known.has(key)) return;
    const els = itemEls().filter((el) => keyOf(el) === key);
    const el = els.filter(shown)[0] || els[0];
    if (!el) return;
    try { el.scrollIntoView({ block: 'center' }); } catch (e) { /* still open it */ }
    if (kindOf(el) === 'function') {
      const card = doc.getElementById('card');
      if (card && !card.hidden && classed(el, 'sel')) return; // its card is open already
      quiet = true;
      try { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })); } finally { quiet = false; }
      return;
    }
    const f = firstFocusable(el);
    if (f) try { f.focus({ preventScroll: true }); } catch (e) { /* not focusable */ }
  }

  // The theme: the team page's, as it sends it; only the two values, set on the root as the page's own switch would
  // (page.client.js follows data-theme for its icon).
  // Until it comes the page paints nothing (data-sonah-wait, set in <head>); a team page that sends no theme leaves the
  // page as the system shows it, shortly after sonah:ready.
  const THEMES = ['light', 'dark'];
  const unwait = () => { try { doc.documentElement.removeAttribute('data-sonah-wait'); } catch (e) { /* shown already */ } };
  function takeTheme(theme) {
    if (typeof theme !== 'string' || THEMES.indexOf(theme) < 0) return;
    try { doc.documentElement.setAttribute('data-theme', theme); } catch (e) { /* the page keeps the theme it shows */ }
    unwait();
  }

  w.addEventListener('message', (ev) => {
    if (ev.source !== parent) return;
    const m = ev.data;
    if (!isObj(m)) return;
    if (m.type === 'sonah:marks') applyMarks(m.marks);
    else if (m.type === 'sonah:open' && okKey(m.key)) openItem(m.key);
    else if (m.type === 'sonah:theme') takeTheme(m.theme);
  });

  // The marks' look, from the page's own colours; page.css hides the page's own decision and share controls and its
  // theme switch under data-sonah-framed (the rail is the one place to decide, this page's address is not the review's,
  // and the team page has the one theme switch).
  try {
    doc.documentElement.setAttribute('data-sonah-framed', '');
    const style = doc.createElement('style');
    style.textContent = '[data-mark="confirm"]{--sonah-mk:var(--ok)} [data-mark="override"]{--sonah-mk:var(--red)}'
      + ' [data-mark="not_right"]{--sonah-mk:var(--amber)} [data-mark="question"]{--sonah-mk:var(--accent)}'
      + ' g[data-mark] > rect:not(.ring){stroke:var(--sonah-mk) !important; stroke-width:2px !important}'
      + ' button[data-mark]{box-shadow:inset 0 -2px 0 var(--sonah-mk)} li[data-mark]{box-shadow:inset 3px 0 0 var(--sonah-mk)}';
    (doc.head || doc.documentElement).appendChild(style);
  } catch (e) { /* the marks still carry their attributes */ }

  post({ type: 'sonah:ready', keys });
  setTimeout(unwait, 600);
})();
