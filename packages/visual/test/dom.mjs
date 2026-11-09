// A small DOM for the page tests, so page.client.js and bridge.client.js run as they are, in Node, with no package.
// It parses the page render.mjs writes (quoted attributes, closed tags, SVG's self-closing tags, raw script and style
// text), matches a selector subset (type, #id, .class, [a], [a="v"], [a^="v"], [a~="v"], :not(...), descendants,
// lists), sends events that bubble to the document and the window, and stubs layout: an element's box is 100 x 20
// unless a test sets el.rect, and zero when it or an ancestor is hidden. Not a browser: no CSS is applied.
import vm from 'node:vm';

const VOID = new Set(['meta', 'input', 'br', 'img', 'link', 'hr']);
const RAW = new Set(['script', 'style']);
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] !== '#') return ENT[e] ?? m;
  return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
});

// ---------- selectors ----------
function parseSelector(text) {
  const list = [];
  let complex = [], cur = null, i = 0;
  const s = text.trim();
  const compound = () => (cur ??= { tag: null, id: null, classes: [], attrs: [], nots: [] });
  const ident = () => { const m = /^[\w-]+/.exec(s.slice(i)); if (!m) throw new Error(`selector: ${text}`); i += m[0].length; return m[0]; };
  while (i < s.length) {
    const c = s[i];
    if (c === ',') { if (cur) complex.push(cur); list.push(complex); complex = []; cur = null; i++; while (s[i] === ' ') i++; continue; }
    if (c === ' ') { if (cur) complex.push(cur); cur = null; while (s[i] === ' ') i++; continue; }
    if (c === '>' || c === '+' || c === '~') throw new Error(`selector combinator not supported: ${text}`);
    if (c === '#') { i++; compound().id = ident(); continue; }
    if (c === '.') { i++; compound().classes.push(ident()); continue; }
    if (c === '[') {
      const end = s.indexOf(']', i);
      const m = /^\[([\w-]+)(?:([\^~]?=)"([^"]*)")?\]$/.exec(s.slice(i, end + 1));
      if (!m) throw new Error(`selector attribute: ${text}`);
      compound().attrs.push({ name: m[1], op: m[2] ?? null, value: m[3] ?? null });
      i = end + 1;
      continue;
    }
    if (s.startsWith(':not(', i)) {
      let depth = 1, j = i + 5;
      while (depth) { if (s[j] === '(') depth++; else if (s[j] === ')') depth--; j++; }
      compound().nots.push(parseSelector(s.slice(i + 5, j - 1))[0][0]);
      i = j;
      continue;
    }
    compound().tag = ident().toLowerCase();
  }
  if (cur) complex.push(cur);
  if (complex.length) list.push(complex);
  return list;
}
function matchCompound(el, c) {
  if (c.tag && el.localName !== c.tag) return false;
  if (c.id && el.getAttribute('id') !== c.id) return false;
  for (const k of c.classes) if (!el.classList.contains(k)) return false;
  for (const a of c.attrs) {
    if (!el.hasAttribute(a.name)) return false;
    const v = el.getAttribute(a.name);
    if (a.op === '=' && v !== a.value) return false;
    if (a.op === '^=' && !v.startsWith(a.value)) return false;
    if (a.op === '~=' && !v.split(/\s+/).includes(a.value)) return false;
  }
  for (const n of c.nots) if (matchCompound(el, n)) return false;
  return true;
}
function matchComplex(el, parts, i = parts.length - 1) {
  if (!matchCompound(el, parts[i])) return false;
  if (i === 0) return true;
  for (let a = el.parentElement; a; a = a.parentElement) if (matchComplex(a, parts, i - 1)) return true;
  return false;
}
const matches = (el, list) => list.some((parts) => matchComplex(el, parts));

// ---------- events ----------
export class Event {
  constructor(type, init = {}) {
    this.type = type; this.bubbles = !!init.bubbles; this.cancelable = !!init.cancelable; this.detail = init.detail ?? 0;
    this.defaultPrevented = false; this.target = null; this.currentTarget = null; this.stopped = false;
    for (const k of ['source', 'data', 'relatedTarget', 'key', 'shiftKey', 'button']) if (k in init) this[k] = init[k];
  }
  preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
  stopPropagation() { this.stopped = true; }
}
class Target {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
  removeEventListener(type, fn) { const l = this.listeners.get(type); if (l) l.splice(l.indexOf(fn) >>> 0, 1); }
  fire(ev) { for (const fn of [...(this.listeners.get(ev.type) ?? [])]) { ev.currentTarget = this; fn.call(this, ev); } }
}

// ---------- nodes ----------
class Node extends Target {
  constructor(doc) { super(); this.ownerDocument = doc; this.parentNode = null; this.childNodes = []; }
  get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
  appendChild(n) { if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.childNodes.push(n); return n; }
  append(...ns) { for (const n of ns) this.appendChild(typeof n === 'string' ? new Text(this.ownerDocument, n) : n); }
  prepend(n) { if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.childNodes.unshift(n); return n; }
  removeChild(n) { const i = this.childNodes.indexOf(n); if (i >= 0) this.childNodes.splice(i, 1); n.parentNode = null; return n; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v) { for (const c of [...this.childNodes]) this.removeChild(c); if (v !== '') this.appendChild(new Text(this.ownerDocument, String(v))); }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  *walk() { for (const c of this.childNodes) if (c.nodeType === 1) { yield c; yield* c.walk(); } }
  querySelectorAll(sel) { const list = parseSelector(sel); return [...this.walk()].filter((el) => matches(el, list)); }
  querySelector(sel) { const list = parseSelector(sel); for (const el of this.walk()) if (matches(el, list)) return el; return null; }
  dispatchEvent(ev) {
    ev.target = this;
    const path = [];
    for (let x = this; x; x = x.parentNode) path.push(x);
    const win = this.ownerDocument.defaultView;
    if (win) path.push(win);
    for (const [k, x] of path.entries()) { if (k > 0 && !ev.bubbles) break; x.fire(ev); if (ev.stopped) break; }
    return !ev.defaultPrevented;
  }
}
class Text extends Node {
  constructor(doc, data) { super(doc); this.nodeType = 3; this.data = data; }
  get textContent() { return this.data; }
}
const REFLECT = ['id', 'title', 'method', 'action', 'enctype', 'target', 'type', 'name', 'rel', 'href'];
class Element extends Node {
  constructor(doc, name, attrs = []) {
    super(doc);
    this.nodeType = 1; this.localName = name.toLowerCase(); this.tagName = this.localName.toUpperCase();
    this.attrs = new Map(attrs); this.style = {}; this.rect = null; this.value = this.attrs.get('value') ?? '';
  }
  getAttribute(n) { return this.attrs.has(n) ? this.attrs.get(n) : null; }
  hasAttribute(n) { return this.attrs.has(n); }
  setAttribute(n, v) { this.attrs.set(n, String(v)); this.ownerDocument.changed(this, n); }
  removeAttribute(n) { if (this.attrs.delete(n)) this.ownerDocument.changed(this, n); }
  get hidden() { return this.hasAttribute('hidden'); }
  set hidden(v) { if (v) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
  get classList() {
    const get = () => (this.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
    const put = (l) => this.setAttribute('class', l.join(' '));
    return { contains: (c) => get().includes(c), add: (...cs) => put([...new Set([...get(), ...cs])]),
      remove: (...cs) => put(get().filter((x) => !cs.includes(x))),
      toggle: (c, force) => { const on = force ?? !get().includes(c); if (on) put([...new Set([...get(), c])]); else put(get().filter((x) => x !== c)); return on; } };
  }
  get dataset() {
    const el = this;
    const attr = (k) => `data-${String(k).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
    return new Proxy({}, { get: (t, k) => (typeof k === 'string' ? el.getAttribute(attr(k)) ?? undefined : undefined),
      set: (t, k, v) => { el.setAttribute(attr(k), v); return true; } });
  }
  set innerHTML(html) { for (const c of [...this.childNodes]) this.removeChild(c); parseInto(String(html), this.ownerDocument, this); }
  get nextElementSibling() { const sib = this.parentNode ? this.parentNode.children : []; return sib[sib.indexOf(this) + 1] ?? null; }
  matches(sel) { return matches(this, parseSelector(sel)); }
  closest(sel) { const list = parseSelector(sel); for (let x = this; x && x.nodeType === 1; x = x.parentNode) if (matches(x, list)) return x; return null; }
  shown() { for (let x = this; x && x.nodeType === 1; x = x.parentNode) if (x.hidden) return false; return true; }
  getBoundingClientRect() {
    const r = this.shown() ? (this.rect ?? { x: 0, y: 0, width: 100, height: 20 }) : { x: 0, y: 0, width: 0, height: 0 };
    return { ...r, left: r.x, top: r.y, right: r.x + r.width, bottom: r.y + r.height };
  }
  getClientRects() { return { length: this.shown() ? 1 : 0 }; }
  get offsetHeight() { return this.getBoundingClientRect().height; }
  get clientWidth() { return this.rect?.width ?? 0; }
  focus() { const d = this.ownerDocument, was = d.activeElement; if (was === this) return; d.activeElement = this;
    if (was && was !== d.body) was.dispatchEvent(new Event('blur')); this.dispatchEvent(new Event('focus')); this.dispatchEvent(new Event('focusin', { bubbles: true })); }
  blur() { const d = this.ownerDocument; if (d.activeElement !== this) return; d.activeElement = d.body; this.dispatchEvent(new Event('blur')); }
  scrollIntoView() {}
  click() { this.dispatchEvent(new Event('click', { bubbles: true, cancelable: true })); }
  submit() { // a form: what it would send
    const fields = [...this.walk()].filter((e) => e.localName === 'input' && e.name).map((e) => [e.name, e.value]);
    this.ownerDocument.submitted.push({ method: this.method, action: this.action, enctype: this.enctype, target: this.target,
      rel: this.rel, hidden: this.hidden, inBody: this.ownerDocument.body.contains(this), fields });
  }
}
for (const p of REFLECT) Object.defineProperty(Element.prototype, p, { get() { return this.getAttribute(p) ?? ''; }, set(v) { this.setAttribute(p, v); } });

function parseInto(html, doc, root) {
  const stack = [root];
  const top = () => stack[stack.length - 1];
  let i = 0;
  while (i < html.length) {
    if (html.startsWith('<!--', i)) { const j = html.indexOf('-->', i + 4); i = j < 0 ? html.length : j + 3; continue; }
    if (html.startsWith('<!', i)) { i = html.indexOf('>', i) + 1; continue; }
    if (html.startsWith('</', i)) {
      const j = html.indexOf('>', i);
      const name = html.slice(i + 2, j).trim().toLowerCase();
      for (let k = stack.length - 1; k > 0; k--) if (stack[k].localName === name) { stack.length = k; break; }
      i = j + 1;
      continue;
    }
    if (html[i] === '<' && /[a-zA-Z]/.test(html[i + 1] ?? '')) {
      const name = /^<([a-zA-Z][\w:-]*)/.exec(html.slice(i, i + 80))[1];
      let j = i + 1 + name.length, close = false;
      const attrs = [];
      for (;;) {
        while (/\s/.test(html[j])) j++;
        if (html[j] === '>') { j++; break; }
        if (html[j] === '/' && html[j + 1] === '>') { j += 2; close = true; break; }
        const an = /^[^\s=/>]+/.exec(html.slice(j, j + 200))[0];
        j += an.length;
        let val = '';
        if (html[j] === '=') {
          j++;
          const q = html[j];
          if (q === '"' || q === "'") { const k = html.indexOf(q, j + 1); val = html.slice(j + 1, k); j = k + 1; }
          else { const m = /^[^\s>]+/.exec(html.slice(j)); val = m[0]; j += val.length; }
        }
        attrs.push([an, decode(val)]);
      }
      const el = new Element(doc, name, attrs);
      top().appendChild(el);
      if (RAW.has(el.localName)) {
        const re = new RegExp(`</${el.localName}`, 'ig');
        re.lastIndex = j;
        const end = re.exec(html)?.index ?? html.length;
        el.appendChild(new Text(doc, html.slice(j, end)));
        i = html.indexOf('>', end) + 1 || html.length;
        continue;
      }
      if (!close && !VOID.has(el.localName)) stack.push(el);
      i = j;
      continue;
    }
    const k = html.indexOf('<', i + 1);
    const end = k < 0 ? html.length : k;
    top().appendChild(new Text(doc, decode(html.slice(i, end))));
    i = end;
  }
}

class Document extends Node {
  constructor() { super(null); this.ownerDocument = this; this.nodeType = 9; this.observers = []; this.submitted = []; this.activeElement = null; this.defaultView = null; }
  get documentElement() { return this.children[0] ?? null; }
  get head() { return this.querySelector('head'); }
  get body() { return this.querySelector('body'); }
  getElementById(id) { for (const el of this.walk()) if (el.getAttribute('id') === id) return el; return null; }
  createElement(name) { return new Element(this, name); }
  createTextNode(t) { return new Text(this, t); }
  changed(el, name) {
    for (const o of this.observers) if (o.target === el && (!o.filter || o.filter.includes(name))) queueMicrotask(() => o.fn([{ type: 'attributes', attributeName: name, target: el }]));
  }
}

/**
 * The page as a browser would load it, its scripts run in order (the JSON data script is data, not run). Options: width
 * (the window), systemDark, parent (a fake parent window: the page is framed), storage (false: a sandboxed frame's
 * storage throws). Returns { window, document, run(code) }.
 */
export function loadPage(html, { width = 1440, height = 900, systemDark = false, parent = null, storage = true } = {}) {
  const document = new Document();
  parseInto(html, document, document);
  document.activeElement = document.body;
  const win = new Target();
  document.defaultView = win;
  const store = new Map();
  Object.assign(win, {
    document, innerWidth: width, innerHeight: height, scrollX: 0, scrollY: 0, location: { hash: '', href: 'file:///review/page.html' },
    navigator: {}, setTimeout, clearTimeout, queueMicrotask, Event, MouseEvent: Event,
    scrollBy() {}, scrollTo() {},
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    matchMedia: (q) => ({ matches: /dark/.test(q) ? systemDark : false, addEventListener() {} }),
    getComputedStyle: (el) => ({ paddingLeft: '16px', paddingRight: '16px', position: el.computedPosition ?? 'static', top: el.computedTop ?? 'auto' }),
    MutationObserver: class { constructor(fn) { this.fn = fn; } observe(target, o) { document.observers.push({ target, filter: o.attributeFilter ?? null, fn: this.fn }); } },
    localStorage: { getItem(k) { if (!storage) throw new Error('SecurityError'); return store.get(k) ?? null; },
      setItem(k, v) { if (!storage) throw new Error('SecurityError'); store.set(k, String(v)); } },
  });
  win.window = win; win.self = win; win.parent = parent ?? win;
  document.documentElement.rect = { x: 0, y: 0, width, height };
  const ctx = vm.createContext(win);
  const run = (code) => vm.runInContext(code, ctx);
  for (const s of document.querySelectorAll('script')) if (!s.hasAttribute('type')) run(s.textContent);
  return { window: win, document, run };
}
export const settle = () => new Promise((r) => setTimeout(r, 5));
