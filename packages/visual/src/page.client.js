// The page's own script: theme, the floating card, the code graph's selection (calls and unchanged callers), the ways
// between a step in How and its place in Where, the graphs' keys, the Read stop's folded sections, decisions, share
// (the local page's "Save online" and "Invite your team"), the stop rail.
// It reads SONAH (written by render.mjs) and the data-* attributes on the page; it knows no particular PR.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const base = (p) => String(p).split('/').pop();
  const root = document.documentElement;
  const D = SONAH;

  /* ---- theme ---- */
  const themeBtn = $('#theme');
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const isDark = () => (root.getAttribute('data-theme') ? root.getAttribute('data-theme') === 'dark' : !!(mq && mq.matches));
  function syncTheme() {
    const d = isDark();
    root.classList.toggle('is-dark', d);
    themeBtn.setAttribute('aria-label', d ? 'Switch to light theme' : 'Switch to dark theme');
  }
  themeBtn.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('sonah-review-theme', next); } catch (e) { /* storage may be blocked */ }
    syncTheme();
  });
  if (mq && mq.addEventListener) mq.addEventListener('change', syncTheme);
  // framed on the team page, the theme comes from around the frame (bridge.client.js sets data-theme)
  try { new MutationObserver(syncTheme).observe(root, { attributes: true, attributeFilter: ['data-theme'] }); } catch (e) { /* the button syncs its own */ }
  syncTheme();

  const pinA = (k) => (D.kf[k] ? `<a href="#${k}" class="pin-h t-${D.kf[k].tier}" title="${esc(D.kf[k].title)}" aria-label="Finding ${D.kf[k].n}: ${esc(D.kf[k].title)}">${D.kf[k].n}</a>` : '');

  /* ---- diff rows ---- */
  const rowHtml = (r) => {
    if (r[0] === '~') return '<span class="l gap"><i></i><b>⋮</b></span>';
    const cls = r[0] === '+' ? ' a' : r[0] === '-' ? ' d' : '';
    const mark = r[0] === '+' ? '+' : r[0] === '-' ? '−' : ' ';
    const no = r[0] === '-' ? r[1] : (r[2] ?? r[1]);
    return `<span class="l${cls}"><i>${no ?? ''}</i><b>${mark}</b>${esc(r[3])}</span>`;
  };
  // The rows above the definition line (its doc comment) fold into one row when there are D.foldHead or more; the cap
  // is counted from the definition line (render.mjs does the same for the Read stop).
  function headOf(rows, line) {
    const at = line == null ? -1 : rows.findIndex((r) => r[0] !== '-' && r[0] !== '~' && r[2] === line);
    const head = at > 0 ? rows.slice(0, at) : [];
    return head.filter((r) => r[0] !== '~').length >= D.foldHead ? { head, body: rows.slice(at) } : { head: [], body: rows };
  }
  function foldHtml(head) {
    if (!head.length) return '';
    const n = head.filter((r) => r[0] !== '~').length;
    const a = head.filter((r) => r[0] === '+').length, d = head.filter((r) => r[0] === '-').length;
    const ch = a || d ? ` · ${a ? `+${a}` : ''}${a && d ? ' ' : ''}${d ? `−${d}` : ''}` : '';
    return `<span class="l cmt"><i></i><b></b><button type="button" class="cmt-b" data-cmt aria-expanded="false">comment, ${n} lines${ch}</button></span><span class="cmt-rows" hidden>${head.map(rowHtml).join('')}</span>`;
  }
  function capped(rows, all, line) {
    const { head, body } = headOf(rows, line);
    if (all) return { head, shown: body, rest: 0 };
    const shown = []; let c = 0;
    for (const r of body) { if (r[0] !== '~') { if (c === D.cap) break; c++; } shown.push(r); }
    return { head, shown, rest: body.filter((r) => r[0] !== '~').length - c };
  }
  function toggleFold(btn) {
    const rows = btn.parentElement && btn.parentElement.nextElementSibling;
    if (!rows || !rows.classList.contains('cmt-rows')) return;
    rows.hidden = !rows.hidden;
    btn.setAttribute('aria-expanded', String(!rows.hidden));
  }

  /* ---- the code graph: the open function's calls, and its unchanged callers ---- */
  const map = $('svg.cg');
  function chipFor(id) {
    if (!map) return null;
    return $$('.chip', map).find((g) => g.dataset.fn === id || (g.dataset.group || '').split(' ').includes(id)) || null;
  }
  function clearEdges() {
    if (!map) return;
    map.classList.remove('focus');
    $$('.hot', map).forEach((e) => e.classList.remove('hot'));
    $$('.chip.rel', map).forEach((c) => c.classList.remove('rel'));
    $$('g.imp', map).forEach((g) => g.setAttribute('hidden', '')); // an svg element has no hidden property
  }
  // The function's own view on the code graph, whichever card shows it: its row marked, its calls lit (a busy file's
  // brackets drawn for it alone: data-for), its unchanged callers shown.
  function drawEdges(id) {
    clearEdges();
    const me = chipFor(id);
    if (!me) return;
    map.classList.add('focus');
    me.classList.add('sel');
    $$('.cg-e', map).forEach((p) => {
      if (p.dataset.from !== id && p.dataset.to !== id) return;
      if (p.dataset.for && p.dataset.for !== id) return;
      p.classList.add('hot');
      const other = chipFor(p.dataset.from === id ? p.dataset.to : p.dataset.from);
      if (other && other !== me) other.classList.add('rel');
    });
    const over = $$('g.imp', map).find((g) => g.dataset.for === id);
    if (over) over.removeAttribute('hidden');
  }

  /* ---- the floating card ---- */
  const card = $('#card');
  let anchor = null, ctx = null, expanded = false;

  const goBtn = (id) => `<button type="button" class="c-tab" data-go="${esc(id)}">${esc(D.fn[id].n)}</button>`;
  const shows = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  // The function's place in Where as the page shows it now: its row on the code graph, else its list chip (its own, or
  // the "+N more" chip that holds it).
  function whereOf(id) {
    const all = $$('#where [data-fn], #where [data-group]').filter((el) => el.dataset.fn === id || (el.dataset.group || '').split(' ').includes(id));
    return all.find(shows) || null;
  }
  // The flow steps that name the function, as the page shows them now (the wide flow or the tall one), once per step.
  const stepKey = (el) => { const v = el.dataset.step, c = v.indexOf(':'); return `${v.slice(0, c - 1)}${v.slice(c)}`; };
  function stepsOf(id) {
    const seen = new Set();
    return $$('#how [data-step]').filter((el) => el.dataset.fn === id && shows(el)).filter((el) => {
      const k = stepKey(el);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  // Go to an element and open its card there: an instant scroll (the page's smooth one would move the element after
  // the card is placed beside it).
  function goTo(el, model) {
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    openCard(el, model, false);
  }
  function tabsHtml() {
    if (ctx.ids.length < 2) return '';
    return `<div class="c-tabs" role="tablist" aria-label="Functions here">${ctx.ids.map((id, i) => `<button type="button" class="c-tab" role="tab" data-at="${i}" aria-selected="${i === ctx.at}">${esc(D.fn[id].n)}</button>`).join('')}</div>`;
  }
  function fnCard() {
    const id = ctx.ids[ctx.at], f = D.fn[id], rows = D.diff[id] || [];
    const { head, shown, rest } = capped(rows, expanded, f.d);
    // opened from a flow step: the step's own words come first, in full
    const st = ctx.step && D.step[ctx.step];
    const stepHtml = st ? `<dl class="c-say">${st.label ? `<div><dt>step</dt><dd>${esc(st.label)}</dd></div>` : ''}${st.was ? `<div class="was"><dt>was</dt><dd>${esc(st.was)}</dd></div>` : ''}</dl>` : '';
    const status = f.s === 'new' ? 'new' : f.s === 'removed' ? 'removed' : 'changed';
    // a repository parsed in part (D.partial): its counts beyond the diff are lower bounds, and none is "no test"
    const least = D.partial ? 'at least ' : '';
    const tests = f.s === 'removed' ? '' : f.t || f.e ? [f.t ? `<span>${f.t} test${f.t === 1 ? '' : 's'} in this change</span>` : '', f.e ? `<span>${least}${f.e} existing test file${f.e === 1 ? '' : 's'} call${f.e === 1 ? 's' : ''} it</span>` : ''].join('') : D.partial ? '' : '<span class="nt">no test found</span>';
    // the parser's impact: unchanged callers (named), those that may run it, and the counts the graph does not draw
    const callers = f.i ? Object.keys(D.gh).filter((g) => D.gh[g].c.includes(id)) : [];
    const shownCallers = callers.slice(0, 8);
    const moreCallers = Math.max(0, f.i ? f.i[0] + f.i[1] - shownCallers.length : 0);
    const notes = [moreCallers ? `+${moreCallers} more` : '', f.i && f.i[2] ? `${f.i[2]} more two calls away` : '', f.i && f.i[3] ? `${f.i[3]} by name only` : ''].filter(Boolean);
    const impact = f.i && (f.i[0] || f.i[1]) ? `<div class="c-imp"><span class="lbl">Unchanged callers${D.partial ? ', at least' : ''}</span><div class="c-fns">${shownCallers.map((g) => `<button type="button" class="c-tab gh" data-gh="${esc(g)}">${esc(D.gh[g].n)}${D.gh[g].m ? ' <i>may run</i>' : ''}</button>`).join('')}</div>${notes.length ? `<p class="c-n">${notes.join(' · ')}</p>` : ''}</div>` : '';
    const inner = f.in && f.in.length ? `<p class="c-in">changed inside: ${f.in.map((n) => `<code>${esc(n)}</code>`).join(', ')}</p>` : '';
    // calls among the changed functions, in every view (the code graph draws them too)
    const calls = (D.calls[id] || []).filter((x) => D.fn[x]);
    const calledBy = Object.keys(D.calls).filter((x) => x !== id && D.fn[x] && D.calls[x].includes(id));
    const callRows = calls.length || calledBy.length ? `<dl class="c-calls">${calls.length ? `<div><dt>Calls</dt><dd class="c-fns">${calls.map(goBtn).join('')}</dd></div>` : ''}${calledBy.length ? `<div><dt>Called by</dt><dd class="c-fns">${calledBy.map(goBtn).join('')}</dd></div>` : ''}</dl>` : '';
    // the ways between How and Where: the function's place in Where, and the flow steps that name it
    const fromWhere = !!(anchor && anchor.closest && anchor.closest('#where'));
    const here = !fromWhere && whereOf(id) ? `<button type="button" class="c-way" data-where="${esc(id)}">Where it sits ↓</button>` : '';
    const steps = ctx.step ? [] : stepsOf(id);
    const ways = here || steps.length ? `<div class="c-ways">${here}${steps.map((el) => `<button type="button" class="c-way" data-flowstep="${esc(el.dataset.step)}">In the flow: ${esc((D.step[el.dataset.step] && D.step[el.dataset.step].label) || f.n)}</button>`).join('')}</div>` : '';
    return `${tabsHtml()}
      <div class="c-head">
        <div class="c-name"><code id="cardTitle">${esc(f.n)}</code><span class="stchip ${status}">${esc(f.s)}</span></div>
        <div class="c-meta"><span class="c-path" title="${esc(`${f.p}${f.l ? `:${f.l}` : ''}`)}">${esc(f.p)}${f.l ? `:${f.l}` : ''}</span>${tests}${f.k.map(pinA).join('')}</div>
      </div>
      ${stepHtml}
      ${f.o ? `<p class="c-one">${esc(f.o)}</p>` : ''}
      ${f.c ? `<div class="c-what"><span class="lbl">What changed</span><p>${esc(f.c)}</p></div>` : ''}
      ${inner}${impact}${callRows}${ways}
      <div class="c-dh"><span>its diff in ${esc(D.range)}</span><span><span class="p">+${f.a}</span> <span class="m">−${f.r}</span></span></div>
      ${rows.length ? `<pre class="diff">${foldHtml(head)}${shown.map(rowHtml).join('')}</pre>` : '<p class="c-note">No diff rows.</p>'}
      ${rest > 0 ? `<button type="button" class="c-more" data-more>+${rest} more line${rest === 1 ? '' : 's'}</button>` : ''}
      ${f.h ? `<div><a class="c-go" href="#${f.h}">Read it in context ↓</a></div>` : ''}`;
  }
  function extCard() {
    const x = D.ext[ctx.key];
    return `<div class="c-head">
        <div class="c-name"><code id="cardTitle">${esc(x.n)}</code><span class="stchip ext">outside</span></div>
      </div>
      ${x.label ? `<p class="c-one">${esc(x.label)}</p>` : ''}
      ${x.was ? `<dl class="c-say"><div class="was"><dt>was</dt><dd>${esc(x.was)}</dd></div></dl>` : ''}
      <p class="c-note">Not changed in this range, so it has no diff here.</p>`;
  }
  // an unchanged caller: where it is, and the changed functions it calls
  function ghostCard() {
    const g = D.gh[ctx.key];
    return `<div class="c-head">
        <div class="c-name"><code id="cardTitle">${esc(g.n)}</code><span class="stchip ext">unchanged</span></div>
        <div class="c-meta"><span class="c-path">${esc(g.p)}${g.l ? `:${g.l}` : ''}</span></div>
      </div>
      <p class="c-note">Not changed in this range. It ${g.m ? 'may run (through an override)' : 'calls'}:</p>
      <div class="c-fns">${g.c.map(goBtn).join('')}</div>`;
  }
  function fileCard() {
    const p = ctx.path, x = D.files[p];
    return `<div class="c-head">
        <div class="c-name"><code id="cardTitle">${esc(base(p))}</code><span class="stchip ${x.t === 'read' ? 'new' : 'changed'}">${esc(x.t === 'none' ? x.role || 'file' : x.t)}</span></div>
        <div class="c-meta"><span class="c-path" title="${esc(p)}">${esc(p)}</span><span>${esc(x.c)}</span>${x.role ? `<span>${esc(x.role)}</span>` : ''}</div>
      </div>
      ${x.fns.length ? `<div class="c-fns"><span class="lbl">changed functions</span>${x.fns.map(goBtn).join('')}</div>` : '<p class="c-note">No functions in this file.</p>'}`;
  }
  function render() {
    const body = ctx.type === 'fn' ? fnCard() : ctx.type === 'ext' ? extCard() : ctx.type === 'ghost' ? ghostCard() : fileCard();
    card.innerHTML = `<button type="button" class="x" aria-label="Close">×</button>${body}`;
    // the function the card shows, if any (the bridge tells the team page's rail; bridge.client.js)
    card.setAttribute('data-card-fn', ctx.type === 'fn' ? ctx.ids[ctx.at] : '');
    // every function card shows the function's own view on the code graph, wherever it was opened; a ghost chip's card
    // keeps its function's view (the ghost is in it)
    if (ctx.type === 'fn') drawEdges(ctx.ids[ctx.at]); else if (ctx.type !== 'ghost') clearEdges();
    place();
  }

  // The card's width on a desktop: about CARD_W, never wider than the page's column or the window less 2 x 16 px.
  const CARD_W = 600;
  const cardMax = (vw, col) => Math.min(CARD_W, col, vw - 32);
  function place() {
    if (!anchor || card.hidden) return null;
    const vw = root.clientWidth, vh = window.innerHeight;
    const wrapCs = getComputedStyle($('.wrap'));
    const ML = parseFloat(wrapCs.paddingLeft) || 16, MR = parseFloat(wrapCs.paddingRight) || 16, M = 16, GAP = 14;
    const r = anchor.getBoundingClientRect();
    card.style.maxHeight = Math.round(vh * 0.7) + 'px';
    let w, left, top, h;
    const below = () => {
      top = r.bottom + GAP;
      if (top + h > vh - M && r.top - GAP - h >= M) top = r.top - GAP - h;
    };
    const onMap = !!(map && map.contains(anchor));
    const column = $('main');
    const MAXW = cardMax(vw, column ? column.getBoundingClientRect().width : vw);
    if (vw < 700) {
      w = vw - ML - MR; card.style.width = w + 'px'; h = card.offsetHeight;
      left = ML; below();
    } else {
      const rightSpace = vw - M - (r.right + GAP), leftSpace = r.left - GAP - M;
      // beside the box; on the map also past the linked chips at its edge, or above or below it
      const cands = [];
      const measure = (ww) => { card.style.width = ww + 'px'; return card.offsetHeight; };
      const side = (s, edgeX) => {
        const space = s === 'r' ? vw - M - edgeX : edgeX - M;
        if (space < 380) return;
        const ww = Math.min(MAXW, space), hh = measure(ww);
        cands.push({ w: ww, h: hh, left: s === 'r' ? edgeX : edgeX - ww, top: Math.max(M, Math.min(r.top - 10, vh - M - hh)) });
      };
      const sides = rightSpace >= MAXW || rightSpace >= leftSpace ? ['r', 'l'] : ['l', 'r'];
      sides.forEach((s) => side(s, s === 'r' ? r.right + GAP : r.left - GAP));
      // past the open function's unchanged callers, on either side
      const shownCallers = onMap ? $('g.imp:not([hidden]) .imp-bg', map) : null;
      if (shownCallers) { const c = shownCallers.getBoundingClientRect(); side('r', Math.max(r.right, c.right) + GAP); side('l', Math.min(r.left, c.left) - GAP); }
      // the related chips are best left in view (the card lists the calls, so the call lines themselves may be covered)
      const linked = onMap ? $$('.chip.rel', map).map((e) => e.getBoundingClientRect()) : [];
      // the open function's unchanged callers are never covered, as the box itself is not
      const callersBox = onMap ? $('g.imp:not([hidden]) .imp-bg', map) : null;
      const keep = callersBox ? [r, callersBox.getBoundingClientRect()] : [r];
      if (onMap) {
        const chips = $$('.chip.rel', map).map((e) => e.getBoundingClientRect()).filter((b) => b.bottom > r.top - 10 && b.top < r.top + vh * 0.7);
        const pastR = Math.max(r.right, ...chips.filter((b) => b.right > r.right && b.left < r.right + GAP + 40).map((b) => b.right));
        const pastL = Math.min(r.left, ...chips.filter((b) => b.left < r.left && b.right > r.left - GAP - 40).map((b) => b.left));
        if (pastR > r.right) side('r', pastR + GAP);
        if (pastL < r.left) side('l', pastL - GAP);
      }
      // above or below what was clicked, at the full width, for any anchor (a step of a flow too). Below may run past
      // the window: reveal() then scrolls it into view and keeps the clicked box in sight, so it costs a little.
      {
        const ww = Math.min(MAXW, vw - 2 * M), hh = measure(ww), lx = Math.min(Math.max(r.left + r.width / 2 - ww / 2, M), vw - M - ww);
        cands.push({ w: ww, h: hh, left: lx, top: r.bottom + GAP, below: true, scroll: r.bottom + GAP + hh > vh - M });
        if (r.top - GAP - hh >= M) cands.push({ w: ww, h: hh, left: lx, top: r.top - GAP - hh });
      }
      if (cands.length) {
        const hits = (c, b) => b.right > c.left && b.left < c.left + c.w && b.bottom > c.top && b.top < c.top + c.h;
        // what it covers first, then a narrower card (it wraps more of the diff), then a scroll to see it
        const cost = (c) => 1000 * keep.filter((b) => hits(c, b)).length + linked.filter((b) => hits(c, b)).length
          + (MAXW - c.w) / 60 + (c.scroll ? 2 : 0);
        const best = cands.reduce((a, c) => (cost(c) < cost(a) ? c : a));
        w = best.w; card.style.width = w + 'px'; h = card.offsetHeight;
        left = best.left; top = best.below ? best.top : Math.max(M, Math.min(best.top, vh - M - h));
      } else {
        w = Math.min(MAXW, vw - 2 * M); card.style.width = w + 'px'; h = card.offsetHeight;
        left = Math.min(Math.max(r.left + r.width / 2 - w / 2, M), vw - M - w);
        below();
      }
    }
    card.style.left = Math.round(left + window.scrollX) + 'px';
    card.style.top = Math.round(top + window.scrollY) + 'px';
    return { top, h, vh, M, r };
  }
  function reveal(p) {
    if (!p) return;
    const over = p.top + p.h - (p.vh - p.M);
    if (over > 0) {
      const room = Math.max(0, p.r.top - 72); // keep the clicked box in sight, under the sticky rail
      const by = Math.min(over, room);
      const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (by > 0) window.scrollBy({ top: by, behavior: reduce ? 'auto' : 'smooth' });
    }
  }

  function clearSel() { $$('.sel').forEach((e) => e.classList.remove('sel')); }
  function openCard(el, model, focus) {
    clearSel();
    anchor = el; ctx = model; expanded = false;
    el.classList.add('sel');
    card.hidden = false;
    render();
    reveal(place());
    if (focus) card.focus({ preventScroll: true });
  }
  function closeCard(restore) {
    if (card.hidden) return;
    card.hidden = true;
    clearSel(); clearEdges();
    const a = anchor; anchor = null; ctx = null;
    if (restore && a && a.focus) a.focus({ preventScroll: true });
  }
  function modelOf(el) {
    const d = el.dataset;
    if (d.fn && D.fn[d.fn]) return { type: 'fn', ids: [d.fn], at: 0, step: d.step || null };
    if (d.group) { const ids = d.group.split(' ').filter((id) => D.fn[id]); return ids.length ? { type: 'fn', ids, at: 0 } : null; }
    if (d.ext && D.ext[d.ext]) return { type: 'ext', key: d.ext };
    if (d.ghost && D.gh[d.ghost]) return { type: 'ghost', key: d.ghost };
    if (d.path && D.files[d.path]) return { type: 'file', path: d.path };
    return null;
  }

  /* ---- the graphs' keys ---- */
  // Hover or keyboard focus on a key entry lights the marks it names in its own stop (data-k holds each mark's tokens,
  // data-k-for the entry's) and quiets the rest; leaving restores.
  let litStop = null;
  function unlight() {
    if (!litStop) return;
    litStop.classList.remove('k-on');
    $$('.k-lit', litStop).forEach((el) => el.classList.remove('k-lit'));
    litStop = null;
  }
  function light(entry) {
    unlight();
    const stop = entry.closest('.stop'), t = entry.getAttribute('data-k-for');
    if (!stop || !t) return;
    $$('[data-k]', stop).forEach((el) => { if ((el.getAttribute('data-k') || '').split(' ').includes(t)) el.classList.add('k-lit'); });
    stop.classList.add('k-on');
    litStop = stop;
  }
  $$('[data-k-for]').forEach((entry) => {
    entry.addEventListener('mouseenter', () => light(entry));
    entry.addEventListener('focus', () => light(entry));
    entry.addEventListener('mouseleave', () => {
      unlight();
      const f = document.activeElement; // the entry the keyboard is on, if any, stays lit
      if (f && f !== entry && f.hasAttribute && f.hasAttribute('data-k-for')) light(f);
    });
    entry.addEventListener('blur', unlight);
  });
  // A key held over its figure (sticky, on a desktop) gets a soft edge while the graph passes under it.
  const keys = $$('.key');
  let keysQueued = false;
  function edgeKeys() {
    keysQueued = false;
    for (const k of keys) {
      const cs = getComputedStyle(k), top = parseFloat(cs.top);
      const held = cs.position === 'sticky' && k.getBoundingClientRect().top <= top + 0.5 && k.parentElement.getBoundingClientRect().top < top - 0.5;
      k.classList.toggle('stuck', held);
    }
  }
  if (keys.length) window.addEventListener('scroll', () => { if (!keysQueued) { keysQueued = true; requestAnimationFrame(edgeKeys); } }, { passive: true });

  /* ---- Read: show a function's whole diff ---- */
  function expandRead(btn) {
    const id = btn.dataset.expand;
    const pre = $$('pre[data-rows]').find((p) => p.dataset.rows === id);
    if (pre) pre.innerHTML = (D.diff[id] || []).map(rowHtml).join('');
    btn.remove();
  }
  // A function's section: its one-line row (folded) or its whole diff (open); exactly one of them shows.
  function setOpen(hunk, open, focus) {
    const row = hunk && $('.h-row', hunk), body = hunk && $('.h-body', hunk);
    if (!row || !body) return;
    row.hidden = open; body.hidden = !open;
    hunk.classList.toggle('shut', !open);
    if (focus) { const to = open ? $('.h-fold', hunk) : row; if (to) to.focus({ preventScroll: true }); }
  }
  // A link to a folded section (the card's "Read it in context", the page's own address) opens it first.
  function openTarget(hash) {
    let id = '';
    try { id = decodeURIComponent(String(hash || '').replace(/^#/, '')); } catch (e) { return; }
    const el = id && document.getElementById(id);
    const hunk = el && el.closest && el.closest('.hunk.shut');
    if (hunk) setOpen(hunk, true, false);
  }
  window.addEventListener('hashchange', () => openTarget(location.hash));
  openTarget(location.hash);

  document.addEventListener('click', (ev) => {
    const t = ev.target;
    const fold = t.closest('[data-cmt]');
    if (fold) { toggleFold(fold); return; }
    const link = t.closest('a[href^="#"]');
    if (link) openTarget(link.getAttribute('href'));
    if (card.contains(t)) {
      if (t.closest('.x')) { closeCard(true); return; }
      const tab = t.closest('[data-at]');
      if (tab) { ctx.at = +tab.dataset.at; expanded = false; render(); const nt = card.querySelector(`[data-at="${ctx.at}"]`); if (nt) nt.focus({ preventScroll: true }); return; }
      const go = t.closest('[data-go]');
      if (go) { ctx = { type: 'fn', ids: [go.dataset.go], at: 0 }; expanded = false; render(); return; }
      const gh = t.closest('[data-gh]');
      if (gh && D.gh[gh.dataset.gh]) { ctx = { type: 'ghost', key: gh.dataset.gh }; render(); return; }
      const wh = t.closest('[data-where]');
      if (wh) {
        const id = wh.dataset.where, el = whereOf(id), mo = el && modelOf(el);
        if (el && mo && mo.type === 'fn') goTo(el, { ...mo, at: Math.max(0, mo.ids.indexOf(id)) });
        return;
      }
      const fs = t.closest('[data-flowstep]');
      if (fs) {
        const el = $$('#how [data-step]').find((x) => x.dataset.step === fs.dataset.flowstep), mo = el && modelOf(el);
        if (mo) goTo(el, mo);
        return;
      }
      if (t.closest('[data-more]')) { expanded = true; render(); return; }
      if (link) closeCard(false);
      return;
    }
    if (link) { closeCard(false); return; }
    const unfold = t.closest('[data-unfold], [data-fold]');
    if (unfold) { closeCard(false); setOpen(unfold.closest('.hunk'), unfold.hasAttribute('data-unfold'), true); return; }
    const ex = t.closest('[data-expand]');
    if (ex) { expandRead(ex); return; }
    const op = t.closest('[data-fn],[data-group],[data-ext],[data-ghost],[data-path]');
    const model = op && modelOf(op);
    if (model) {
      if (op === anchor && !card.hidden) { closeCard(false); return; }
      openCard(op, model, ev.detail === 0);
      return;
    }
    if (!t.closest('.share')) closeCard(false);
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !card.hidden) { ev.preventDefault(); closeCard(true); return; }
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const g = ev.target.closest && ev.target.closest('g[role="button"]');
    if (!g) return;
    ev.preventDefault();
    g.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
  });
  window.addEventListener('resize', () => place());
  // keyboard: Tab past either end of the card closes it and carries on from the box it came from
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const focusables = () => $$('button, a[href], [tabindex]:not([tabindex="-1"])', card).filter(visible);
  card.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Tab') return;
    const f = focusables(), first = f[0], last = f[f.length - 1], at = document.activeElement;
    if (ev.shiftKey && (at === card || at === first)) { ev.preventDefault(); closeCard(true); return; }
    if (!ev.shiftKey && (at === last || !f.length)) closeCard(true);
  });
  card.addEventListener('focusout', (ev) => {
    const to = ev.relatedTarget;
    if (to && !card.contains(to) && to !== anchor) closeCard(false);
  });

  /* ---- decide ---- */
  const tally = $('#tally');
  const total = $$('li.fd').length;
  function updateTally() {
    const c = $$('li.fd .dec .cf[aria-pressed="true"]').length, o = $$('li.fd .dec .ov[aria-pressed="true"]').length;
    if (tally) tally.innerHTML = `<b>${c + o}</b> of ${total} decided${c + o ? ` · ${c} confirmed · ${o} overridden` : ''}`;
  }
  $$('li.fd').forEach((row) => {
    const cf = $('.dec .cf', row), ov = $('.dec .ov', row), marks = $('.marks', row);
    const set = (which) => {
      const was = which.getAttribute('aria-pressed') === 'true';
      cf.setAttribute('aria-pressed', 'false'); ov.setAttribute('aria-pressed', 'false');
      const old = $('.mk.you', marks); if (old) old.remove();
      if (!was) {
        which.setAttribute('aria-pressed', 'true');
        const m = document.createElement('span');
        m.className = 'mk you ' + (which === cf ? 'ok' : 'ov');
        m.textContent = 'You';
        marks.prepend(m);
      }
      updateTally();
    };
    cf.addEventListener('click', () => set(cf));
    ov.addEventListener('click', () => set(ov));
  });

  /* ---- share: copy link on the hosted page (the local page links to the hosted /share page instead) ---- */
  const shareBtn = $('#share'), pop = $('#sharepop'), field = $('#linkfield');
  if (shareBtn && pop && field) {
    shareBtn.addEventListener('click', () => { const open = pop.hidden; pop.hidden = !open; shareBtn.setAttribute('aria-expanded', String(open)); });
    document.addEventListener('click', (ev) => { if (!pop.hidden && !ev.target.closest('.share')) { pop.hidden = true; shareBtn.setAttribute('aria-expanded', 'false'); } });
    const copyLink = (note) => {
      const url = location.href;
      const done = () => { note.hidden = false; setTimeout(() => { note.hidden = true; }, 2200); };
      const fallback = () => { field.hidden = false; field.value = url; pop.hidden = false; shareBtn.setAttribute('aria-expanded', 'true'); field.focus(); field.select(); };
      try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, fallback); else fallback(); }
      catch (e) { fallback(); }
    };
    $('#copylink').addEventListener('click', () => copyLink($('#copied')));
    const share2 = $('#share2');
    if (share2) share2.addEventListener('click', () => copyLink($('#copied2')));
  }

  /* ---- the local page: "Save online" and "Invite your team" send the review it carries ---- */
  // The page carries its upload in a JSON script element, #sonah-upload (the body of the server's POST /api/uploads),
  // with the server's /share in data-action. A click posts exactly two fields there, in a new tab:
  // upload (that JSON text) and intent (save or invite); nothing else leaves the laptop. Without the upload (over the
  // server's cap) or without script, the buttons are links to the server's /share page.
  const upload = document.getElementById('sonah-upload');
  const action = upload && upload.getAttribute('data-action');
  if (upload && action) {
    document.addEventListener('click', (ev) => {
      const a = ev.target.closest && ev.target.closest('a[data-intent]');
      const intent = a && a.getAttribute('data-intent');
      if (intent !== 'save' && intent !== 'invite') return;
      ev.preventDefault();
      const form = document.createElement('form');
      form.method = 'post';
      form.action = action;
      form.enctype = 'multipart/form-data';
      form.target = '_blank';
      form.setAttribute('rel', 'noopener');
      form.hidden = true;
      for (const [name, value] of [['upload', upload.textContent], ['intent', intent]]) {
        const field = document.createElement('input');
        field.type = 'hidden';
        field.name = name;
        field.value = value;
        form.appendChild(field);
      }
      document.body.appendChild(form);
      form.submit();
      form.remove();
    });
  }

  /* ---- rail ---- */
  const links = $$('.rail a');
  const order = links.map((a) => a.dataset.stop);
  function mark(id) {
    const at = order.indexOf(id);
    links.forEach((a, i) => { if (i === at) a.setAttribute('aria-current', 'step'); else a.removeAttribute('aria-current'); a.classList.toggle('done', i < at); });
  }
  mark('what');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => { entries.forEach((e) => { if (e.isIntersecting) mark(e.target.id); }); }, { rootMargin: '-35% 0px -60% 0px' });
    order.forEach((id) => { const s = document.getElementById(id); if (s) io.observe(s); });
  }
})();
