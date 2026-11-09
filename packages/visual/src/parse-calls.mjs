// parse-calls.mjs: a repository's call graph at one commit, from the parsed files (parse-tree.mjs). Callee names are
// resolved conservatively, in a fixed order, and a name that fits more than one definition is counted as ambiguous,
// never guessed:
//   scope   a definition visible from the call in the same file (Go: the same package folder), innermost first
//   import  the name, or the module it is called on, was imported, and the import resolves to a file in the repository
//   class   this./self./super. (or ClassName.) to a method of the enclosing class or a base class found by the same rules
//   unique  a bare name defined exactly once in the repository (functions and classes, never methods)
//   typed   v.name() / self.attr.name() where v's or attr's declared type (annotation, `new C()`, `C()`) is a class
//           found by these same rules, to that class's method (or a base's)
//   member  obj.name() on an object code cannot type: a method name defined exactly once in the repository (resolved and
//           counted, never used: on one measured PR 341 of its 342 impact edges were wrong)
//   dispatch  the same method name overridden in a subclass of the class a this./typed call resolved to (may run)
//   maybe   an ambiguous call with at most MAYBE_CAP candidates, to each candidate (counted apart, never merged)
// Names that resolve nowhere: external (imported from outside the repository), ambiguous (several), none (builtins).
// TypeScript types (interfaces, type aliases, enums) are never call targets.
import { dirname, posix } from 'node:path';

const JS_EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const CALLABLE = new Set(['function', 'method', 'class', 'callback']);
const MAYBE_CAP = 6; // an ambiguous call with at most this many candidates is kept as "maybe" edges to each

export function defId(f, i) {
  const d = f.defs[i];
  const chain = [];
  for (let p = d.parent; p >= 0; p = f.defs[p].parent) chain.unshift(f.defs[p].name);
  const owner = d.parent >= 0 ? chain.join('.') : d.owner;
  return `${f.path}#${owner ? owner + '.' : ''}${d.name}`;
}

/** files: Map(path -> parsed). aux: { packageJson: Map(path -> text), tsconfig: Map(path -> text), gomod: Map(path -> text) } */
export function buildGraph(files, aux = {}) {
  const paths = new Set(files.keys());
  const byName = new Map(); // name -> [{ path, i }]
  const dirFiles = new Map();
  for (const f of files.values()) {
    const ids = new Map();
    f.ids = f.defs.map((_, i) => {
      let id = defId(f, i);
      const k = (ids.get(id) ?? 0) + 1; ids.set(id, k);
      if (k > 1) id += `~${k}`;
      return id;
    });
    f.defs.forEach((d, i) => { if (d.kind !== 'callback' && d.kind !== 'type') (byName.get(d.name) ?? byName.set(d.name, []).get(d.name)).push({ path: f.path, i }); });
    const dir = dirname(f.path);
    (dirFiles.get(dir) ?? dirFiles.set(dir, []).get(dir)).push(f.path);
  }
  const workspaces = workspacePackages(aux.packageJson ?? new Map());
  const aliases = tsAliases(aux.tsconfig ?? new Map());
  const goMods = goModules(aux.gomod ?? new Map());

  // ---------- module resolution ----------
  const jsResolve = (from, spec) => {
    let base = null;
    if (spec.startsWith('.')) base = posix.normalize(posix.join(posix.dirname(from), spec));
    else if (spec.startsWith('/')) base = spec.slice(1);
    else {
      for (const a of aliases) {
        if (!from.startsWith(a.scope)) continue;
        if (a.exact ? spec === a.prefix : spec.startsWith(a.prefix)) {
          for (const target of a.targets) {
            const b = posix.normalize(posix.join(a.base, target.replace('*', spec.slice(a.prefix.length))));
            const hit = jsFile(b); if (hit) return hit;
          }
        }
      }
      const ws = workspaces.find((w) => spec === w.name || spec.startsWith(w.name + '/'));
      if (!ws) return null;
      if (spec === ws.name) return jsFile(posix.join(ws.dir, ws.main ?? 'index'));
      base = posix.join(ws.dir, spec.slice(ws.name.length + 1));
    }
    return jsFile(base);
  };
  const jsFile = (base) => {
    if (base.startsWith('./')) base = base.slice(2);
    if (paths.has(base)) return base;
    const stem = base.replace(/\.(m|c)?jsx?$/, '');
    for (const e of JS_EXTS) if (paths.has(stem + e)) return stem + e;
    for (const e of JS_EXTS) if (paths.has(`${base}/index${e}`)) return `${base}/index${e}`;
    return null;
  };
  const pyModuleFiles = (from, source, level) => { // a dotted module -> its file (module.py or package/__init__.py)
    const rel = source.replace(/\./g, '/');
    if (level > 0) {
      let dir = posix.dirname(from);
      for (let k = 1; k < level; k++) dir = posix.dirname(dir);
      const b = rel ? (dir === '.' ? rel : `${dir}/${rel}`) : dir;
      for (const c of [`${b}.py`, `${b}/__init__.py`, `${b}.pyi`]) if (paths.has(c)) return c;
      return null;
    }
    for (const c of [`${rel}.py`, `${rel}/__init__.py`]) if (paths.has(c)) return c;
    const hits = [];
    for (const p of paths) if (p.endsWith(`/${rel}.py`) || p.endsWith(`/${rel}/__init__.py`)) hits.push(p);
    return hits.length === 1 ? hits[0] : null; // several roots hold such a module: unresolved, never guessed
  };
  const goPackageFiles = (spec) => {
    for (const m of goMods) {
      if (spec === m.module || spec.startsWith(m.module + '/')) {
        const dir = posix.normalize(posix.join(m.dir, spec.slice(m.module.length + 1) || '.'));
        return (dirFiles.get(dir === '.' ? '.' : dir) ?? []).filter((p) => p.endsWith('.go'));
      }
    }
    return null;
  };
  // an import binding -> { files: [path], name: exported name | '*' } or null when outside the repository
  const importTarget = (f, imp) => {
    if (f.family === 'js') { const p = jsResolve(f.path, imp.source); return p ? { files: [p], name: imp.imported } : null; }
    if (f.family === 'go') { const ps = goPackageFiles(imp.source); return ps?.length ? { files: ps, name: '*' } : null; }
    // python
    if (imp.from) {
      const sub = pyModuleFiles(f.path, imp.source ? `${imp.source}.${imp.imported}` : imp.imported, imp.level);
      if (sub) return { files: [sub], name: '*' }; // from pkg import module
      const p = pyModuleFiles(f.path, imp.source, imp.level);
      return p ? { files: [p], name: imp.imported } : null;
    }
    const p = pyModuleFiles(f.path, imp.source, 0);
    return p ? { files: [p], name: '*' } : null;
  };

  // a name exported by a file -> [{ path, i }] (following re-exports and imports a few hops)
  const exportOf = (path, name, depth = 0) => {
    const f = files.get(path);
    if (!f || depth > 4) return [];
    const top = f.defs.map((d, i) => ({ d, i })).filter(({ d }) => d.parent === -1 && d.name === name && d.kind !== 'callback' && d.kind !== 'type');
    if (top.length) return top.map(({ i }) => ({ path, i }));
    if (name === 'default') {
      const def = f.defs.findIndex((d) => d.parent === -1 && (d.isDefault || (d.exported && d.name === 'default')));
      if (def >= 0) return [{ path, i: def }];
    }
    for (const r of f.reexports) {
      if (r.exported !== name && r.exported !== '*') continue;
      if (r.source === null) { const own = exportOf(path, r.imported, depth + 1); if (own.length) return own; continue; }
      const p = jsResolve(path, r.source);
      if (!p) continue;
      const hit = exportOf(p, r.exported === '*' ? name : r.imported, depth + 1);
      if (hit.length) return hit;
    }
    for (const imp of f.imports) {
      if (imp.local !== name) continue;
      const t = importTarget(f, imp);
      if (t && t.name !== '*') return t.files.flatMap((p) => exportOf(p, t.name, depth + 1));
    }
    if (f.family === 'go') { // Go: anything at top level in the package folder
      const out = [];
      for (const p of dirFiles.get(dirname(path)) ?? []) {
        const g = files.get(p);
        g.defs.forEach((d, i) => { if (d.parent === -1 && d.name === name && d.kind !== 'method') out.push({ path: p, i }); });
      }
      return out;
    }
    return [];
  };

  const classMethods = (cls, name, depth = 0) => { // cls: { path, i } -> methods named `name` on it or its bases
    if (depth > 3) return [];
    const f = files.get(cls.path); const c = f.defs[cls.i];
    const own = f.family === 'go'
      ? (dirFiles.get(dirname(cls.path)) ?? []).flatMap((p) => files.get(p).defs.map((d, i) => ({ d, i, p })))
        .filter(({ d }) => d.kind === 'method' && d.owner === c.name && d.name === name).map(({ i, p }) => ({ path: p, i }))
      : f.defs.map((d, i) => ({ d, i })).filter(({ d }) => d.parent === cls.i && d.name === name && d.kind !== 'callback')
        .map(({ i }) => ({ path: cls.path, i }));
    if (own.length) return own;
    for (const b of c.bases ?? []) {
      const r = resolveBare(f, b, c.parent);
      if (r.to.length === 1 && files.get(r.to[0].path).defs[r.to[0].i].kind === 'class') {
        const hit = classMethods(r.to[0], name, depth + 1);
        if (hit.length) return hit;
      }
    }
    return [];
  };
  const enclosingClass = (f, ctx) => {
    for (let p = ctx; p >= 0; p = f.defs[p].parent) {
      if (f.defs[p].kind === 'class') return { path: f.path, i: p };
      if (f.family === 'go' && f.defs[p].kind === 'method') {
        const owner = f.defs[p].owner;
        for (const q of dirFiles.get(dirname(f.path)) ?? []) {
          const i = files.get(q).defs.findIndex((d) => d.kind === 'class' && d.name === owner);
          if (i >= 0) return { path: q, i };
        }
        return null;
      }
    }
    return null;
  };

  // ---------- one name ----------
  function resolveBare(f, name, ctx) {
    // 1. scope: definitions in this file visible from ctx (top level, or nested in one of ctx's enclosing defs)
    const chain = [];
    for (let p = ctx; p >= 0; p = f.defs[p].parent) chain.push(p);
    chain.push(-1);
    for (const scope of chain) {
      const hit = [];
      f.defs.forEach((d, i) => { if (d.parent === scope && d.name === name && d.kind !== 'callback' && d.kind !== 'method' && d.kind !== 'type') hit.push({ path: f.path, i }); });
      if (scope >= 0 && f.defs[scope].kind === 'class') continue; // a class body is no scope for bare names
      if (hit.length) return { to: hit.length === 1 ? hit : [], how: hit.length === 1 ? 'scope' : 'ambiguous', n: hit.length, cands: hit };
      // a parameter or local variable of that name shadows every outer definition: not a call to any of them
      if (scope >= 0 && f.defs[scope].locals?.includes(name)) return { to: [], how: 'local', n: 0 };
    }
    if (f.family === 'go') {
      const hit = exportOf(f.path, name);
      if (hit.length) return { to: hit.length === 1 ? hit : [], how: hit.length === 1 ? 'scope' : 'ambiguous', n: hit.length, cands: hit };
    }
    // 2. import
    const imp = f.imports.find((x) => x.local === name);
    if (imp) {
      const t = importTarget(f, imp);
      if (!t) return { to: [], how: 'external', n: 0 };
      if (t.name === '*') return { to: [], how: 'module', n: 0 }; // the name is a module, not a callable
      const hit = t.files.flatMap((p) => exportOf(p, t.name));
      if (hit.length === 1) return { to: hit, how: 'import', n: 1 };
      return { to: [], how: hit.length ? 'ambiguous' : 'import-unresolved', n: hit.length, cands: hit };
    }
    if (f.family === 'py') { // from x import *
      for (const s of f.imports.filter((x) => x.star)) {
        const p = pyModuleFiles(f.path, s.source, s.level);
        const hit = p ? exportOf(p, name) : [];
        if (hit.length === 1) return { to: hit, how: 'import', n: 1 };
      }
    }
    // 3. unique repo-wide (functions and classes, never methods)
    // (top-level definitions only: a nested one is visible only inside its own parent)
    const all = (byName.get(name) ?? []).filter(({ path, i }) => { const d = files.get(path).defs[i]; return d.parent === -1 && d.kind !== 'method'; });
    const fam = all.filter(({ path }) => files.get(path).family === f.family);
    if (fam.length === 1) return { to: fam, how: 'unique', n: 1 };
    return { to: [], how: fam.length ? 'ambiguous' : 'none', n: fam.length, cands: fam };
  }

  function resolveSite(f, s) {
    if (s.recv === null) return resolveBare(f, s.name, s.ctx);
    if (s.recv === 'this' || s.recv === 'super') {
      const cls = enclosingClass(f, s.ctx);
      if (cls) {
        let hit = [];
        if (s.recv === 'this') hit = classMethods(cls, s.name);
        else {
          const c = files.get(cls.path).defs[cls.i];
          for (const b of c.bases ?? []) {
            const r = resolveBare(files.get(cls.path), b, c.parent);
            if (r.to.length === 1) { hit = classMethods(r.to[0], s.name); if (hit.length) break; }
          }
        }
        if (hit.length === 1) return { to: hit, how: 'class', n: 1, also: s.recv === 'this' && f.family !== 'go' ? overrides(cls, s.name) : [] };
        if (hit.length > 1) return { to: [], how: 'ambiguous', n: hit.length, cands: hit };
        const over = s.recv === 'this' && f.family !== 'go' ? overrides(cls, s.name) : [];
        if (over.length) return { to: [], how: 'dispatch-only', n: over.length, also: over };
      }
      return member(f, s);
    }
    // this.attr.name() (JS) / self.attr.name() / v.attr.name() (Python): the attribute's declared type
    if (s.recv.startsWith('this.') || /^expr:[A-Za-z_]\w*\.[A-Za-z_]\w*$/.test(s.recv)) {
      const [v, a] = s.recv.startsWith('this.') ? ['self', s.recv.slice(5)] : s.recv.slice(5).split('.');
      const vc = v === 'self' ? enclosingClass(f, s.ctx) : varClass(f, s.ctx, v);
      const ac = vc ? attrClass(vc, a) : null;
      if (ac) { const t = typedCall(f, s, ac); if (t) return t; }
      return member(f, s);
    }
    // a module or package the name is called on: import * as ns / import x / Go package
    let recv = s.recv;
    if (recv.startsWith('expr:')) { // Python a.b.c.f(): a module path when an import binds its head
      const dotted = recv.slice(5);
      const imp = f.imports.find((x) => !x.from && (x.dotted === dotted || (x.source === dotted && x.local === dotted)));
      if (imp) {
        const p = pyModuleFiles(f.path, dotted, 0);
        const hit = p ? exportOf(p, s.name) : [];
        if (hit.length === 1) return { to: hit, how: 'import', n: 1 };
        if (!p) return { to: [], how: 'external', n: 0 };
      }
      return member(f, s);
    }
    if (recv === 'expr') return member(f, s);
    const imp = f.imports.find((x) => x.local === recv);
    if (imp) {
      const t = importTarget(f, imp);
      if (!t) return { to: [], how: 'external', n: 0 };
      if (t.name === '*') {
        const hit = t.files.flatMap((p) => exportOf(p, s.name));
        if (hit.length === 1) return { to: hit, how: 'import', n: 1 };
        return { to: [], how: hit.length ? 'ambiguous' : 'import-unresolved', n: hit.length };
      }
      const cls = t.files.flatMap((p) => exportOf(p, t.name)).filter(({ path, i }) => files.get(path).defs[i].kind === 'class');
      if (cls.length === 1) { const hit = classMethods(cls[0], s.name); if (hit.length === 1) return { to: hit, how: 'class', n: 1 }; }
      return member(f, s);
    }
    // ClassName.method() on a class in scope
    const r = resolveBare(f, recv, s.ctx);
    if (r.to.length === 1 && files.get(r.to[0].path).defs[r.to[0].i].kind === 'class') {
      const hit = classMethods(r.to[0], s.name);
      if (hit.length === 1) return { to: hit, how: 'class', n: 1 };
    }
    // v.name() where v has a declared type in scope
    const vc = varClass(f, s.ctx, recv);
    if (vc) { const t = typedCall(f, s, vc); if (t) return t; }
    return member(f, s);
  }
  function typedCall(f, s, cls) {
    const hit = classMethods(cls, s.name);
    const over = f.family !== 'go' ? overrides(cls, s.name) : [];
    if (hit.length === 1) return { to: hit, how: 'typed', n: 1, also: over };
    if (!hit.length && over.length) return { to: [], how: 'dispatch-only', n: over.length, also: over };
    return null;
  }
  const isClass = (t) => t && files.get(t.path).defs[t.i].kind === 'class';
  let typeDepth = 0; // one bound across every path of type lookups (they can call each other through resolveSite)
  function classByType(f, ctx, t, depth = 0) {
    if (!t || depth > 4 || typeDepth > 6) return null;
    typeDepth++;
    try { return classByTypeOnce(f, ctx, t, depth); } finally { typeDepth--; }
  }
  function classByTypeOnce(f, ctx, t, depth) {
    if (t.startsWith('call:')) { // a class called, or a function whose declared return type is a class
      const callee = t.slice(5);
      const [obj, name] = callee.includes('.') ? callee.split('.') : [null, callee];
      const r = obj === null ? resolveBare(f, name, ctx) : resolveSite(f, { recv: obj, name, ctx });
      if (r.to.length !== 1) return null;
      const g = files.get(r.to[0].path); const d = g.defs[r.to[0].i];
      if (d.kind === 'class') return r.to[0];
      return d.returns ? classByType(g, d.parent >= 0 ? d.parent : -1, d.returns, depth + 1) : null;
    }
    if (t.startsWith('attr:')) {
      const [v, a] = t.slice(5).split('.');
      const vc = v === 'self' || v === 'this' ? enclosingClass(f, ctx) : varClass(f, ctx, v, depth + 1);
      return vc ? attrClass(vc, a, depth + 1) : null;
    }
    const r = resolveBare(f, t.split('.').pop(), ctx);
    return r.to.length === 1 && isClass(r.to[0]) ? r.to[0] : null;
  }
  function varClass(f, ctx, v, depth = 0) {
    for (let p = ctx; p >= 0; p = f.defs[p].parent) {
      const t = f.defs[p].types?.[v];
      if (t) return classByType(f, p, t, depth);
      if (f.defs[p].locals?.includes(v)) return null; // bound here, with no declared type
    }
    return null;
  }
  function attrClass(cls, a, depth = 0) {
    if (depth > 4) return null;
    const cf = files.get(cls.path); const c = cf.defs[cls.i];
    if (c.attrTypes?.[a]) return classByType(cf, cls.i, c.attrTypes[a], depth + 1);
    const getter = cf.defs.findIndex((d) => d.parent === cls.i && d.name === a && d.kind === 'method' && d.returns);
    if (getter >= 0) return classByType(cf, cls.i, cf.defs[getter].returns, depth + 1);
    for (const b of c.bases ?? []) {
      const r = resolveBare(cf, b, c.parent);
      if (r.to.length === 1 && isClass(r.to[0])) { const x = attrClass(r.to[0], a, depth + 1); if (x) return x; }
    }
    return null;
  }
  let subIndex = null;
  function overrides(cls, name) { // methods named `name` in classes that extend cls, at any depth
    if (!subIndex) {
      subIndex = new Map();
      for (const g of files.values()) g.defs.forEach((d, i) => {
        if (d.kind !== 'class') return;
        for (const b of d.bases ?? []) {
          const r = resolveBare(g, b, d.parent);
          if (r.to.length === 1 && isClass(r.to[0])) { const k = `${r.to[0].path}\0${r.to[0].i}`; (subIndex.get(k) ?? subIndex.set(k, []).get(k)).push({ path: g.path, i }); }
        }
      });
    }
    const out = []; const todo = [cls]; const seen = new Set();
    while (todo.length) {
      const c = todo.pop();
      for (const sub of subIndex.get(`${c.path}\0${c.i}`) ?? []) {
        const k = `${sub.path}\0${sub.i}`;
        if (seen.has(k)) continue;
        seen.add(k); todo.push(sub);
        const sf = files.get(sub.path);
        sf.defs.forEach((d, i) => { if (d.parent === sub.i && d.name === name && d.kind === 'method') out.push({ path: sub.path, i }); });
      }
    }
    return out;
  }
  function member(f, s) {
    const all = (byName.get(s.name) ?? []).filter(({ path, i }) => files.get(path).defs[i].kind === 'method' && files.get(path).family === f.family);
    if (all.length === 1) return { to: all, how: 'member', n: 1 };
    if (!all.length) { // no method of that name: a top-level function defined once, called through an object (a registry)
      const fns = (byName.get(s.name) ?? []).filter(({ path, i }) => { const d = files.get(path).defs[i]; return d.parent === -1 && d.kind === 'function' && files.get(path).family === f.family; });
      if (fns.length === 1) return { to: [], how: 'ambiguous', n: 1, cands: fns };
    }
    return { to: [], how: all.length ? 'ambiguous' : 'none', n: all.length, cands: all };
  }

  // ---------- every site ----------
  const edges = []; // { from: id, to: id, how, line, kind: call|ref, site }
  const ambiguous = []; // { from: id, path, line, cands: [id] }: a call whose name fits several definitions
  const counts = { call: {}, ref: {} };
  for (const f of files.values()) {
    const ctxId = (ctx) => (ctx >= 0 ? f.ids[ctx] : `${f.path}#<top>`);
    for (const [kind, list] of [['call', f.calls], ['ref', f.refs]]) {
      for (const s of list) {
        const r = resolveSite(f, s);
        if (kind === 'ref') { // a reference counts only when it is bound (scope, import, class) to a function or method
          if (!['scope', 'import', 'class'].includes(r.how)) r.to = [];
          r.to = r.to.filter(({ path, i }) => { const k = files.get(path).defs[i].kind; return k === 'function' || k === 'method'; });
          if (!r.to.length && (r.how !== 'ambiguous')) { counts.ref.none = (counts.ref.none ?? 0) + 1; continue; }
        }
        counts[kind][r.how] = (counts[kind][r.how] ?? 0) + 1;
        for (const t of r.to) edges.push({ from: ctxId(s.ctx), to: files.get(t.path).ids[t.i], how: r.how, line: s.line, path: f.path, kind });
        if (kind !== 'call') continue;
        // C() / new C() also runs C's constructor (its own or a base's)
        for (const t of r.to) {
          if (files.get(t.path).defs[t.i].kind !== 'class' || (s.kind !== 'call' && s.kind !== 'new')) continue;
          for (const c of classMethods(t, f.family === 'py' ? '__init__' : 'constructor')) edges.push({ from: ctxId(s.ctx), to: files.get(c.path).ids[c.i], how: r.how, line: s.line, path: f.path, kind });
        }
        for (const t of r.also ?? []) edges.push({ from: ctxId(s.ctx), to: files.get(t.path).ids[t.i], how: 'dispatch', line: s.line, path: f.path, kind });
        if (r.how === 'ambiguous' && r.cands?.length) ambiguous.push({ from: ctxId(s.ctx), path: f.path, line: s.line, cands: r.cands.map((t) => files.get(t.path).ids[t.i]) });
        if (r.how === 'ambiguous' && r.cands && r.cands.length <= MAYBE_CAP) {
          for (const t of r.cands) edges.push({ from: ctxId(s.ctx), to: files.get(t.path).ids[t.i], how: 'maybe', line: s.line, path: f.path, kind });
        }
      }
    }
  }
  const defs = new Map();
  for (const f of files.values()) f.defs.forEach((d, i) => defs.set(f.ids[i], { ...d, id: f.ids[i], path: f.path, parentId: d.parent >= 0 ? f.ids[d.parent] : null }));
  return { files, defs, edges, ambiguous, counts };
}

function workspacePackages(pkgs) {
  const out = [];
  for (const [path, text] of pkgs) {
    try {
      const p = JSON.parse(text);
      if (typeof p.name !== 'string') continue;
      const dir = posix.dirname(path);
      let main = typeof p.main === 'string' ? p.main.replace(/^\.\//, '') : null;
      const ex = p.exports;
      const dot = typeof ex === 'string' ? ex : (ex && typeof ex['.'] === 'string' ? ex['.'] : ex?.['.']?.import ?? ex?.['.']?.default ?? null);
      if (typeof dot === 'string') main = dot.replace(/^\.\//, '');
      out.push({ name: p.name, dir: dir === '.' ? '' : dir, main });
    } catch { /* not JSON: skipped */ }
  }
  return out.sort((a, b) => b.name.length - a.name.length);
}

function jsonc(text) { // JSON with comments and trailing commas (tsconfig)
  let out = ''; let i = 0; let inStr = false;
  while (i < text.length) {
    const c = text[i];
    if (inStr) { out += c; if (c === '\\') { out += text[i + 1] ?? ''; i += 2; continue; } if (c === '"') inStr = false; i++; continue; }
    if (c === '"') { inStr = true; out += c; i++; continue; }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && text[i + 1] === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i += 2; continue; }
    out += c; i++;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

function tsAliases(configs) {
  const out = [];
  for (const [path, text] of configs) {
    let c; try { c = jsonc(text); } catch { continue; }
    const dir = posix.dirname(path) === '.' ? '' : posix.dirname(path);
    const co = c.compilerOptions ?? {};
    const base = posix.join(dir, co.baseUrl ?? '.');
    for (const [k, v] of Object.entries(co.paths ?? {})) {
      if (!Array.isArray(v)) continue;
      out.push({ scope: dir ? dir + '/' : '', prefix: k.replace('*', ''), exact: !k.includes('*'), targets: v, base });
    }
  }
  return out.sort((a, b) => b.scope.length - a.scope.length || b.prefix.length - a.prefix.length);
}

function goModules(mods) {
  const out = [];
  for (const [path, text] of mods) {
    const m = /^module\s+(\S+)/m.exec(text);
    if (m) out.push({ module: m[1], dir: posix.dirname(path) });
  }
  return out.sort((a, b) => b.module.length - a.module.length);
}

export { CALLABLE };
