// parse-tree.mjs: one file's code facts from its tree-sitter syntax tree (JavaScript, TypeScript, Python, Go). Structure
// only (node types and fields of the official grammars), never words: definitions and their spans, call sites with the
// callee's name and receiver, names used as values, imports and re-exports, declared types, comment-only lines.
// The parser (src/vendor/web-tree-sitter) and each grammar load once, only when a run needs them. No network: the
// WebAssembly bytes are read from src/vendor and handed over. Deterministic: the same text gives the same facts.
// Each WebAssembly file is kept as gzip-compressed hex text (the public release audit admits text files only); the
// decoded bytes are the upstream package's, byte for byte (vendor/THIRD_PARTY.md pins their sha256).
//
// def:  { name, kind, parent, owner, line, start, end, docStart, exported, bases }
//       kind: class | function | method | value | callback | type. parent: index of the enclosing def (-1 at top level).
//       line: the definition's own first line (after its doc comment and decorators); start..end: the statement.
//       docStart: the first line of the comment or decorator block right above it (or `start`).
//       type: a TypeScript interface, type alias or enum (a definition to read, never a value or a call target).
// call: { line, name, recv, ctx, kind }   recv: null (bare name) | 'this' | 'super' | an identifier | 'expr'.
//       ctx: index of the innermost def holding it (-1 = the file's top level). kind: call | new | jsx | decorator.
// ref:  { line, name, recv, ctx }          a name used as a value (passed, returned, stored), not called there.
// imports: [{ local, imported, source, level }]  imported: a name, 'default', or '*' (the module itself).
// reexports: [{ exported, imported, source }]    imported '*' with exported '*' is `export * from`.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const RUNTIME_WASM = new URL('./vendor/web-tree-sitter/web-tree-sitter.wasm.gz.hex', import.meta.url);
const WASM = Object.freeze({
  javascript: new URL('./vendor/tree-sitter-javascript/tree-sitter-javascript.wasm.gz.hex', import.meta.url),
  typescript: new URL('./vendor/tree-sitter-typescript/tree-sitter-typescript.wasm.gz.hex', import.meta.url),
  tsx: new URL('./vendor/tree-sitter-typescript/tree-sitter-tsx.wasm.gz.hex', import.meta.url),
  python: new URL('./vendor/tree-sitter-python/tree-sitter-python.wasm.gz.hex', import.meta.url),
  go: new URL('./vendor/tree-sitter-go/tree-sitter-go.wasm.gz.hex', import.meta.url),
});
/** A vendored WebAssembly file's bytes, from its gzip-compressed hex text. */
export const wasmBytes = (url) => gunzipSync(Buffer.from(readFileSync(url, 'latin1').replace(/\s+/g, ''), 'hex'));
export const GRAMMAR_BY_EXT = Object.freeze({ js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx', py: 'python', pyi: 'python', go: 'go' });
export const FAMILY = Object.freeze({ javascript: 'js', typescript: 'js', tsx: 'js', python: 'py', go: 'go' });
const GRAMMARS_OF = Object.freeze({ js: ['javascript', 'typescript', 'tsx'], py: ['python'], go: ['go'] });
export const extOf = (path) => { const b = path.split('/').pop(); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1).toLowerCase() : ''; };
/** The grammar for a path, or null (a TypeScript declaration file is types only, never parsed). */
export const grammarOf = (path) => (path.endsWith('.d.ts') ? null : GRAMMAR_BY_EXT[extOf(path)] ?? null);
export const familyOf = (path) => { const g = grammarOf(path); return g ? FAMILY[g] : null; };

// Each load is started once and every caller waits on that same start: two extracts at once in one process (two
// jobs) would otherwise start the parser's WebAssembly twice and get a broken grammar. A failed start is tried again.
let runtime = null; // a Promise of { Parser, Language }: the parser's own WebAssembly
const loading = new Map(); // grammar -> a Promise of its Parser
const parsers = new Map(); // grammar -> Parser, once loaded

function startRuntime() {
  runtime ??= (async () => {
    const mod = await import('./vendor/web-tree-sitter/web-tree-sitter.js');
    // the bytes are read synchronously and handed over (an async read of them once hung with no progress)
    await mod.Parser.init({ wasmBinary: wasmBytes(RUNTIME_WASM) });
    return { Parser: mod.Parser, Language: mod.Language };
  })().catch((e) => { runtime = null; throw e; });
  return runtime;
}

/** Load the parser and the grammars of these families (js, py, go), once each. */
export async function loadFamilies(families) {
  const rt = await startRuntime();
  for (const fam of [...families].sort()) {
    for (const g of GRAMMARS_OF[fam] ?? []) {
      if (!loading.has(g)) {
        loading.set(g, (async () => {
          const p = new rt.Parser();
          p.setLanguage(await rt.Language.load(new Uint8Array(wasmBytes(WASM[g]))));
          parsers.set(g, p);
          return p;
        })().catch((e) => { loading.delete(g); throw e; }));
      }
      await loading.get(g);
    }
  }
}

const JS_FN = new Set(['arrow_function', 'function_expression', 'function', 'generator_function']);
const JS_CLASS = new Set(['class_declaration', 'abstract_class_declaration', 'class']);
const TS_TYPE = new Set(['interface_declaration', 'type_alias_declaration', 'enum_declaration']);
const STRINGISH = new Set(['string', 'template_string']);
const row = (n) => n.startPosition.row + 1;
const endRow = (n) => n.endPosition.row + 1;
const unq = (s) => s.replace(/^['"`]|['"`]$/g, '');

/** Parse one file's text. Returns null when no grammar covers its extension or its grammar is not loaded. */
export function parseFile(path, text) {
  const g = grammarOf(path);
  if (!g || !parsers.has(g)) return null;
  const tree = parsers.get(g).parse(text);
  const f = { path, grammar: g, family: FAMILY[g], defs: [], calls: [], refs: [], imports: [], reexports: [],
    commentRows: [], hasError: tree.rootNode.hasError, lines: text.split('\n').length };
  const lines = text.split('\n');
  const commentRows = new Set();
  const markComment = (n) => {
    const sr = n.startPosition.row; const er = n.endPosition.row;
    for (let r = sr; r <= er; r++) {
      const L = lines[r] ?? '';
      const before = r === sr ? L.slice(0, n.startPosition.column) : '';
      const after = r === er ? L.slice(n.endPosition.column) : '';
      if (!before.trim() && !after.trim().replace(/^[,;]$/, '')) commentRows.add(r + 1);
    }
  };
  // the comment and decorator lines right above a statement belong to it
  const docStartOf = (stmt) => {
    let s = row(stmt); let p = stmt.previousNamedSibling;
    while (p && (p.type === 'comment' || p.type === 'decorator') && endRow(p) >= s - 1 && p.endPosition.row < stmt.startPosition.row
      && !(lines[p.startPosition.row] ?? '').slice(0, p.startPosition.column).trim()) {
      s = row(p); p = p.previousNamedSibling;
    }
    return s;
  };
  const addDef = (d, stmt, at) => {
    const parent = d.parent ?? -1;
    const def = { name: d.name, kind: d.kind, parent, owner: d.owner ?? (parent >= 0 ? f.defs[parent].name : null),
      line: row(at ?? stmt), start: row(stmt), end: endRow(stmt), docStart: docStartOf(stmt), exported: !!d.exported,
      bases: d.bases ?? [], isDefault: !!d.isDefault, locals: [], types: {}, attrTypes: {} };
    f.defs.push(def);
    return f.defs.length - 1;
  };
  const addCall = (n, name, recv, ctx, kind = 'call') => { if (name) f.calls.push({ line: row(n), name, recv, ctx, kind }); };
  const addRef = (n, name, recv, ctx) => { if (name) f.refs.push({ line: row(n), name, recv, ctx }); };
  // a name bound inside a function (a parameter or a local variable) shadows any outer definition of that name
  const addLocal = (ctx, name) => { if (ctx >= 0 && name && !f.defs[ctx].locals.includes(name)) f.defs[ctx].locals.push(name); };
  const patternNames = (p, ctx) => {
    if (!p) return;
    const t = p.type;
    if (t === 'identifier' || t === 'shorthand_property_identifier_pattern') { addLocal(ctx, p.text); return; }
    if (t === 'assignment_pattern' || t === 'object_assignment_pattern') { patternNames(p.childForFieldName('left'), ctx); return; }
    if (t === 'required_parameter' || t === 'optional_parameter') { patternNames(p.childForFieldName('pattern'), ctx); return; }
    if (t === 'pair_pattern') { patternNames(p.childForFieldName('value'), ctx); return; }
    if (t === 'default_parameter' || t === 'typed_default_parameter') { patternNames(p.childForFieldName('name'), ctx); return; }
    if (t === 'typed_parameter') { for (const c of p.namedChildren) if (c.type === 'identifier') addLocal(ctx, c.text); return; }
    if (t === 'list_splat_pattern' || t === 'dictionary_splat_pattern') { for (const c of p.namedChildren) patternNames(c, ctx); return; }
    if (t === 'object_pattern' || t === 'array_pattern' || t === 'rest_pattern' || t === 'formal_parameters' || t === 'parameters'
      || t === 'pattern_list' || t === 'tuple_pattern' || t === 'list_pattern') for (const c of p.namedChildren) patternNames(c, ctx);
  };

  // declared types, from syntax only: a parameter's or variable's annotation, `new C()` / `C()` assigned, or `v.attr`
  // assigned (typed later from v's type). Read at resolution time as a class name; anything else resolves to nothing.
  const typeText = (n) => {
    if (!n) return null;
    const t = n.type === 'type_annotation' ? n.namedChild(0) : n;
    if (!t) return null;
    let s = t.text.replace(/^['"]|['"]$/g, '').replace(/\s+/g, '');
    const opt = /^Optional\[(.+)\]$/.exec(s); if (opt) s = opt[1];
    const parts = s.split('|').filter((x) => x && x !== 'None' && x !== 'null' && x !== 'undefined');
    if (parts.length !== 1) return null;
    s = parts[0].replace(/[<[].*$/, '');
    return /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(s) ? s : null;
  };
  const setType = (ctx, name, t) => { if (ctx >= 0 && name && t && !(name in f.defs[ctx].types)) f.defs[ctx].types[name] = t; };
  const setAttr = (cls, name, t) => { if (cls >= 0 && name && t && !(name in f.defs[cls].attrTypes)) f.defs[cls].attrTypes[name] = t; };
  const valueType = (v, ctx = -1) => { // the type a value gives the name it is assigned to
    if (!v) return null;
    if (v.type === 'await_expression' || v.type === 'await' || v.type === 'unary_expression') return valueType(v.namedChild(0), ctx);
    if (v.type === 'new_expression') { const c = v.childForFieldName('constructor'); return c && /^[\w$.]+$/.test(c.text) ? `call:${c.text}` : null; }
    // C() (Python: a class), f() (a function with a declared return type: resolved later), pkg.New() (Go)
    if (v.type === 'call' || v.type === 'call_expression') { const c = v.childForFieldName('function'); return c && /^[\w$]+(\.[\w$]+)?$/.test(c.text) ? `call:${c.text}` : null; }
    if (v.type === 'identifier' && ctx >= 0 && f.defs[ctx].types[v.text]) return f.defs[ctx].types[v.text];
    if ((v.type === 'member_expression' || v.type === 'attribute') && /^[\w$]+\.[\w$]+$/.test(v.text)) return `attr:${v.text}`;
    return null;
  };

  if (f.family === 'js') visitJs(tree.rootNode, { def: -1, cls: -1, stmt: null, exported: false });
  else if (f.family === 'py') visitPy(tree.rootNode, { def: -1, cls: -1, inClass: false, stmt: null });
  else visitGo(tree.rootNode, { def: -1 });
  tree.delete();
  f.commentRows = [...commentRows].sort((a, b) => a - b);
  f.blankRows = lines.map((l, i) => (l.trim() ? 0 : i + 1)).filter(Boolean);
  return f;

  // ---------- JavaScript and TypeScript ----------
  function jsRecv(obj) {
    if (!obj) return 'expr';
    if (obj.type === 'this') return 'this';
    if (obj.type === 'super') return 'super';
    if (obj.type === 'identifier') return obj.text;
    if (obj.type === 'member_expression' && obj.childForFieldName('object')?.type === 'this') return `this.${obj.childForFieldName('property')?.text}`;
    return 'expr';
  }
  function jsCallee(fn) { // [name, recv] of a call's function part
    if (!fn) return [null, null];
    if (fn.type === 'identifier') return [fn.text, null];
    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property'); const obj = fn.childForFieldName('object');
      const name = prop?.text ?? null;
      // f.call(...), f.apply(...), f.bind(...) call f itself
      if ((name === 'call' || name === 'apply' || name === 'bind') && obj) {
        if (obj.type === 'identifier') return [obj.text, null];
        if (obj.type === 'member_expression') return jsCallee(obj);
      }
      return [name, jsRecv(obj)];
    }
    if (fn.type === 'parenthesized_expression' && fn.namedChildCount === 1) return jsCallee(fn.namedChild(0));
    if (fn.type === 'non_null_expression' && fn.namedChildCount === 1) return jsCallee(fn.namedChild(0));
    return [null, null];
  }
  function jsValueRef(n, sc) {
    if (!n) return;
    if (n.type === 'identifier' || n.type === 'shorthand_property_identifier') addRef(n, n.text, null, sc.def);
    else if (n.type === 'member_expression') {
      const prop = n.childForFieldName('property');
      if (prop && prop.type !== 'member_expression') addRef(n, prop.text, jsRecv(n.childForFieldName('object')), sc.def);
    }
  }
  function jsImport(n) {
    const src = n.childForFieldName('source');
    if (!src) return;
    const source = unq(src.text);
    const clause = n.namedChildren.find((c) => c.type === 'import_clause');
    if (!clause) return; // import './side-effect'
    for (const c of clause.namedChildren) {
      if (c.type === 'identifier') f.imports.push({ local: c.text, imported: 'default', source, level: 0 });
      else if (c.type === 'namespace_import') {
        const id = c.namedChildren.find((x) => x.type === 'identifier');
        if (id) f.imports.push({ local: id.text, imported: '*', source, level: 0 });
      } else if (c.type === 'named_imports') {
        for (const s of c.namedChildren) {
          if (s.type !== 'import_specifier') continue;
          const name = s.childForFieldName('name')?.text; const alias = s.childForFieldName('alias')?.text;
          if (name) f.imports.push({ local: unq(alias ?? name), imported: unq(name), source, level: 0 });
        }
      }
    }
  }
  function jsRequire(decl) { // const x = require('m') / const { a, b: c } = require('m')
    const value = decl.childForFieldName('value'); const name = decl.childForFieldName('name');
    if (!value || value.type !== 'call_expression') return false;
    const fn = value.childForFieldName('function');
    if (fn?.type !== 'identifier' || fn.text !== 'require') return false;
    const arg = value.childForFieldName('arguments')?.namedChild(0);
    if (!arg || !STRINGISH.has(arg.type)) return false;
    const source = unq(arg.text);
    if (name?.type === 'identifier') f.imports.push({ local: name.text, imported: '*', source, level: 0 });
    else if (name?.type === 'object_pattern') {
      for (const p of name.namedChildren) {
        if (p.type === 'shorthand_property_identifier_pattern') f.imports.push({ local: p.text, imported: p.text, source, level: 0 });
        else if (p.type === 'pair_pattern') {
          const k = p.childForFieldName('key')?.text; const v = p.childForFieldName('value');
          if (k && v?.type === 'identifier') f.imports.push({ local: v.text, imported: unq(k), source, level: 0 });
        }
      }
    }
    return true;
  }
  function jsBases(cls) {
    const out = [];
    const her = cls.namedChildren.find((c) => c.type === 'class_heritage');
    if (!her) return out;
    const take = (v) => {
      if (!v) return;
      if (v.type === 'identifier' || v.type === 'type_identifier') out.push(v.text);
      else if (v.type === 'member_expression') out.push(v.childForFieldName('property')?.text);
      else if (v.type === 'call_expression') take(v.childForFieldName('function'));
    };
    for (const c of her.namedChildren) {
      if (c.type === 'extends_clause') take(c.childForFieldName('value') ?? c.namedChild(0));
      else if (c.type !== 'implements_clause') take(c);
    }
    return out.filter(Boolean);
  }
  function jsFnBody(fnNode, idx, sc) { // visit a function's parameters (defaults) and body as def idx
    if (idx >= 0 && idx !== sc.def && !f.defs[idx].returns) f.defs[idx].returns = typeText(fnNode.childForFieldName('return_type'));
    const params = fnNode.childForFieldName('parameters') ?? fnNode.childForFieldName('parameter');
    if (params && idx >= 0 && idx !== sc.def) {
      patternNames(params, idx);
      for (const p of params.namedChildren) {
        if (p.type !== 'required_parameter' && p.type !== 'optional_parameter') continue;
        const pat = p.childForFieldName('pattern'); const ty = typeText(p.childForFieldName('type'));
        if (pat?.type === 'identifier') {
          setType(idx, pat.text, ty);
          // constructor(private client: Client): a parameter property is also the class's attribute
          if (p.namedChildren.some((c) => c.type === 'accessibility_modifier' || c.type === 'override_modifier') || /^(readonly|public|private|protected)\s/.test(p.text)) setAttr(sc.cls, pat.text, ty);
        }
      }
    }
    for (const c of fnNode.namedChildren) visitJs(c, { ...sc, def: idx, stmt: null, exported: false });
  }
  function jsClass(n, name, stmt, sc) {
    const idx = addDef({ name, kind: 'class', parent: sc.def, exported: sc.exported, bases: jsBases(n), isDefault: sc.isDefault }, stmt, n);
    for (const c of n.namedChildren) visitJs(c, { ...sc, def: idx, cls: idx, stmt: null, exported: false });
    return idx;
  }
  function visitJs(n, sc) {
    const t = n.type;
    if (t === 'comment') { markComment(n); return; }
    if (t === 'import_statement') { jsImport(n); return; }
    if (t === 'export_statement') {
      const src = n.childForFieldName('source');
      if (src) {
        const source = unq(src.text);
        const clause = n.namedChildren.find((c) => c.type === 'export_clause');
        if (!clause) {
          const ns = n.namedChildren.find((c) => c.type === 'namespace_export');
          if (ns) { const id = ns.namedChildren.find((x) => x.type !== 'string'); f.reexports.push({ exported: id?.text ?? '*', imported: '*', source }); }
          else f.reexports.push({ exported: '*', imported: '*', source });
        } else {
          for (const s of clause.namedChildren) {
            if (s.type !== 'export_specifier') continue;
            const name = s.childForFieldName('name')?.text; const alias = s.childForFieldName('alias')?.text;
            if (name) f.reexports.push({ exported: unq(alias ?? name), imported: unq(name), source });
          }
        }
        return;
      }
      const clause = n.namedChildren.find((c) => c.type === 'export_clause');
      if (clause) { // export { a, b as c } of local names
        for (const s of clause.namedChildren) {
          if (s.type !== 'export_specifier') continue;
          const name = s.childForFieldName('name')?.text; const alias = s.childForFieldName('alias')?.text;
          if (name) f.reexports.push({ exported: unq(alias ?? name), imported: unq(name), source: null });
        }
        return;
      }
      const value = n.childForFieldName('value');
      if (value && (value.type === 'identifier')) { f.reexports.push({ exported: 'default', imported: value.text, source: null }); return; }
      for (const c of n.namedChildren) visitJs(c, { ...sc, stmt: n, exported: true, isDefault: n.text.startsWith('export default') });
      return;
    }
    if (TS_TYPE.has(t) && sc.def === -1) { // a TypeScript interface, type alias or enum: read like a definition
      const name = n.childForFieldName('name')?.text;
      if (name) addDef({ name, kind: 'type', parent: -1, exported: sc.exported }, sc.stmt ?? n, n);
      return;
    }
    if (t === 'function_declaration' || t === 'generator_function_declaration') {
      const name = n.childForFieldName('name')?.text ?? (sc.isDefault ? 'default' : null);
      if (!name) { jsFnBody(n, sc.def, sc); return; }
      const idx = addDef({ name, kind: 'function', parent: sc.def, exported: sc.exported, isDefault: sc.isDefault }, sc.stmt ?? n, n);
      jsFnBody(n, idx, { ...sc, isDefault: false });
      return;
    }
    if (JS_CLASS.has(t) && t !== 'class') {
      const name = n.childForFieldName('name')?.text ?? (sc.isDefault ? 'default' : null);
      if (name) { jsClass(n, name, sc.stmt ?? n, sc); return; }
    }
    // an object literal's members inside a function body are that function's own code, not definitions of their own
    const inBodyObject = (sc.def >= 0 && f.defs[sc.def].kind !== 'value' && f.defs[sc.def].kind !== 'class');
    if (t === 'method_definition' && n.parent?.type === 'object' && inBodyObject) { jsFnBody(n, sc.def, sc); return; }
    if (t === 'pair' && inBodyObject) { const v = n.childForFieldName('value'); if (v && !JS_FN.has(v.type)) jsValueRef(v, sc); for (const c of n.namedChildren) visitJs(c, { ...sc, stmt: null, exported: false }); return; }
    if (t === 'for_in_statement') patternNames(n.childForFieldName('left'), sc.def);
    if (t === 'catch_clause') patternNames(n.childForFieldName('parameter'), sc.def);
    if (t === 'method_definition') {
      const name = n.childForFieldName('name')?.text;
      const idx = addDef({ name, kind: 'method', parent: sc.def }, n, n);
      jsFnBody(n, idx, sc);
      return;
    }
    if (t === 'public_field_definition' || t === 'field_definition') {
      const nameNode = n.childForFieldName('name') ?? n.childForFieldName('property');
      const value = n.childForFieldName('value');
      if (nameNode && value && JS_FN.has(value.type)) {
        const idx = addDef({ name: nameNode.text, kind: 'method', parent: sc.def }, n, n);
        jsFnBody(value, idx, sc);
        return;
      }
      if (nameNode) setAttr(sc.cls, nameNode.text, typeText(n.childForFieldName('type')) ?? valueType(value));
    }
    if (t === 'lexical_declaration' || t === 'variable_declaration') {
      const decls = n.namedChildren.filter((c) => c.type === 'variable_declarator');
      for (const d of decls) {
        if (jsRequire(d)) continue;
        const nameNode = d.childForFieldName('name'); const value = d.childForFieldName('value');
        const stmt = decls.length === 1 ? (sc.stmt ?? n) : d;
        // a function, or a call handed a function literal (a wrapped function: memo(async () => ...))
        const wrapped = value?.type === 'call_expression' && sc.def === -1
          && (value.childForFieldName('arguments')?.namedChildren ?? []).some((a) => JS_FN.has(a.type));
        if (nameNode?.type === 'identifier' && value && wrapped) {
          const idx = addDef({ name: nameNode.text, kind: 'function', parent: -1, exported: sc.exported }, stmt, n);
          visitJs(value, { ...sc, def: idx, stmt: null, exported: false });
        } else if (nameNode?.type === 'identifier' && value && JS_FN.has(value.type)) {
          const idx = addDef({ name: nameNode.text, kind: 'function', parent: sc.def, exported: sc.exported }, stmt, n);
          jsFnBody(value, idx, sc);
        } else if (nameNode?.type === 'identifier' && value?.type === 'class') {
          jsClass(value, nameNode.text, stmt, sc);
        } else if (nameNode?.type === 'identifier' && sc.def === -1) {
          const idx = addDef({ name: nameNode.text, kind: 'value', parent: -1, exported: sc.exported }, stmt, n);
          if (value) { jsValueRef(value, { ...sc, def: idx }); visitJs(value, { ...sc, def: idx, stmt: null, exported: false }); }
        } else {
          if (nameNode) patternNames(nameNode, sc.def);
          if (nameNode?.type === 'identifier') setType(sc.def, nameNode.text, typeText(d.childForFieldName('type')) ?? valueType(value, sc.def));
          if (value) { jsValueRef(value, sc); visitJs(value, { ...sc, stmt: null, exported: false }); }
          if (nameNode && nameNode.type !== 'identifier') visitJs(nameNode, { ...sc, stmt: null }); // defaults in patterns
        }
      }
      return;
    }
    if (t === 'expression_statement' && n.namedChildCount === 1 && n.namedChild(0).type === 'assignment_expression') {
      const a = n.namedChild(0); const left = a.childForFieldName('left'); const right = a.childForFieldName('right');
      if (left?.type === 'member_expression' && left.childForFieldName('object')?.type === 'this') setAttr(sc.cls, left.childForFieldName('property')?.text, valueType(right, sc.def));
      if (right && JS_FN.has(right.type) && left) {
        let name = null; let owner;
        if (left.type === 'identifier') name = left.text;
        else if (left.type === 'member_expression') {
          name = left.childForFieldName('property')?.text;
          const obj = left.childForFieldName('object');
          // X.prototype.y = ... is X's; module.exports.y / exports.y / this.y keep the enclosing owner
          if (obj?.type === 'member_expression' && obj.childForFieldName('property')?.text === 'prototype') owner = obj.childForFieldName('object')?.text;
        }
        if (name) {
          const idx = addDef({ name, kind: sc.cls >= 0 ? 'method' : 'function', parent: sc.def, owner }, n, n);
          visitJs(left, sc);
          jsFnBody(right, idx, sc);
          return;
        }
      }
    }
    if (t === 'pair') {
      const key = n.childForFieldName('key'); const value = n.childForFieldName('value');
      if (key && value && JS_FN.has(value.type)) {
        const idx = addDef({ name: unq(key.text), kind: 'method', parent: sc.def }, n, n);
        jsFnBody(value, idx, sc);
        return;
      }
      if (value) jsValueRef(value, sc);
    }
    if (t === 'call_expression') {
      const fn = n.childForFieldName('function'); const args = n.childForFieldName('arguments');
      const [name, recv] = jsCallee(fn);
      addCall(n, name, recv, sc.def, 'call');
      if (fn) visitJs(fn, { ...sc, stmt: null, exported: false });
      if (args) visitJsArgs(args, sc, name, recv, fn);
      return;
    }
    if (t === 'new_expression') {
      const c = n.childForFieldName('constructor');
      const [name, recv] = jsCallee(c);
      addCall(n, name, recv, sc.def, 'new');
      const args = n.childForFieldName('arguments');
      if (c) visitJs(c, sc);
      if (args) visitJsArgs(args, sc, name, recv, c);
      return;
    }
    if (t === 'jsx_opening_element' || t === 'jsx_self_closing_element') {
      const nm = n.childForFieldName('name');
      if (nm?.type === 'identifier' && /^[A-Z]/.test(nm.text)) addCall(n, nm.text, null, sc.def, 'jsx');
      else if (nm?.type === 'member_expression') addCall(n, nm.childForFieldName('property')?.text, jsRecv(nm.childForFieldName('object')), sc.def, 'jsx');
    }
    if (t === 'return_statement' || t === 'array' || t === 'jsx_expression') for (const c of n.namedChildren) jsValueRef(c, sc);
    if (t === 'shorthand_property_identifier') addRef(n, n.text, null, sc.def);
    if (t === 'assignment_expression' || t === 'assignment_pattern' || t === 'object_assignment_pattern') jsValueRef(n.childForFieldName('right'), sc);
    // a function picked by a condition: (a ? f : g)(x), a || f
    if (t === 'ternary_expression') { jsValueRef(n.childForFieldName('consequence'), sc); jsValueRef(n.childForFieldName('alternative'), sc); }
    if (t === 'binary_expression' && ['||', '??', '&&'].includes(n.childForFieldName('operator')?.text)) jsValueRef(n.childForFieldName('right'), sc);
    for (const c of n.namedChildren) visitJs(c, { ...sc, stmt: null, exported: false, isDefault: false });
  }
  function visitJsArgs(args, sc, calleeName, recv, fnNode) {
    const kids = args.namedChildren;
    // a function handed to a call whose first argument is a string literal is its own context, named by that call
    // (a test case, a route, an event handler): structure, not words
    const titled = kids.length >= 2 && STRINGISH.has(kids[0].type);
    for (const c of kids) {
      if (titled && JS_FN.has(c.type) && calleeName) {
        const title = kids[0].text.slice(1, -1).slice(0, 80);
        const recvText = fnNode?.type === 'member_expression' ? `${fnNode.childForFieldName('object')?.text ?? ''}.` : '';
        const idx = addDef({ name: `${recvText}${calleeName}(${JSON.stringify(title)})`, kind: 'callback', parent: sc.def }, c, c);
        jsFnBody(c, idx, sc);
        continue;
      }
      jsValueRef(c, sc);
      visitJs(c, { ...sc, stmt: null, exported: false });
    }
  }

  // ---------- Python ----------
  function pyDotted(n) { return n ? n.text.replace(/\s+/g, '') : null; }
  function pyImport(n) {
    if (n.type === 'import_statement') {
      for (const c of n.namedChildren) {
        if (c.type === 'dotted_name') f.imports.push({ local: c.text.split('.')[0], imported: '*', source: c.text.split('.')[0], level: 0, dotted: c.text });
        else if (c.type === 'aliased_import') {
          const name = pyDotted(c.childForFieldName('name')); const alias = c.childForFieldName('alias')?.text;
          f.imports.push({ local: alias, imported: '*', source: name, level: 0 });
        }
      }
      return;
    }
    const mod = n.childForFieldName('module_name');
    let source = ''; let level = 0;
    if (mod?.type === 'relative_import') {
      const prefix = mod.namedChildren.find((c) => c.type === 'import_prefix');
      level = prefix ? prefix.text.length : 0;
      source = pyDotted(mod.namedChildren.find((c) => c.type === 'dotted_name')) ?? '';
    } else source = pyDotted(mod) ?? '';
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (n.fieldNameForChild(i) !== 'name') { if (c.type === 'wildcard_import') f.imports.push({ local: '*', imported: '*', source, level, star: true }); continue; }
      if (c.type === 'dotted_name') f.imports.push({ local: c.text.split('.').pop(), imported: c.text, source, level, from: true });
      else if (c.type === 'aliased_import') {
        const name = pyDotted(c.childForFieldName('name')); const alias = c.childForFieldName('alias')?.text;
        f.imports.push({ local: alias, imported: name, source, level, from: true });
      }
    }
  }
  function pyRecv(obj) {
    if (!obj) return 'expr';
    if (obj.type === 'identifier') return obj.text === 'self' || obj.text === 'cls' ? 'this' : obj.text;
    if (obj.type === 'call' && obj.childForFieldName('function')?.text === 'super') return 'super';
    if (obj.type === 'attribute') return 'expr:' + obj.text.replace(/\s+/g, ''); // a dotted path: a module path or an attribute chain
    return 'expr';
  }
  function pyCallee(fn) {
    if (!fn) return [null, null];
    if (fn.type === 'identifier') return [fn.text, null];
    if (fn.type === 'attribute') return [fn.childForFieldName('attribute')?.text, pyRecv(fn.childForFieldName('object'))];
    return [null, null];
  }
  function pyValueRef(n, sc) {
    if (!n) return;
    if (n.type === 'identifier') addRef(n, n.text, null, sc.def);
    else if (n.type === 'attribute') addRef(n, n.childForFieldName('attribute')?.text, pyRecv(n.childForFieldName('object')), sc.def);
  }
  function pyDocstring(body) {
    const first = body?.namedChild(0);
    if (first?.type === 'expression_statement' && first.namedChildCount === 1 && first.namedChild(0).type === 'string') markComment(first);
  }
  function visitPy(n, sc) {
    const t = n.type;
    if (t === 'comment') { markComment(n); return; }
    if (t === 'import_statement' || t === 'import_from_statement') { pyImport(n); return; }
    if (t === 'decorated_definition') {
      for (const c of n.namedChildren) {
        if (c.type === 'decorator') {
          const e = c.namedChild(0);
          if (e && (e.type === 'identifier' || e.type === 'attribute')) { const [nm, r] = pyCallee(e); addCall(e, nm, r, sc.def, 'decorator'); }
          else if (e) visitPy(e, sc);
        }
      }
      const d = n.childForFieldName('definition');
      if (d) visitPy(d, { ...sc, stmt: n });
      return;
    }
    if (t === 'function_definition') {
      const name = n.childForFieldName('name')?.text;
      const idx = addDef({ name, kind: sc.inClass ? 'method' : 'function', parent: sc.def }, sc.stmt ?? n, n);
      f.defs[idx].returns = typeText(n.childForFieldName('return_type'));
      const body = n.childForFieldName('body');
      pyDocstring(body);
      patternNames(n.childForFieldName('parameters'), idx);
      for (const p of n.childForFieldName('parameters')?.namedChildren ?? []) {
        if (p.type === 'typed_parameter') setType(idx, p.namedChildren.find((c) => c.type === 'identifier')?.text, typeText(p.childForFieldName('type')));
        else if (p.type === 'typed_default_parameter') setType(idx, p.childForFieldName('name')?.text, typeText(p.childForFieldName('type')));
      }
      for (const c of n.namedChildren) visitPy(c, { ...sc, def: idx, inClass: false, stmt: null });
      return;
    }
    if (t === 'class_definition') {
      const name = n.childForFieldName('name')?.text;
      const sup = n.childForFieldName('superclasses');
      const bases = (sup?.namedChildren ?? []).filter((c) => c.type === 'identifier' || c.type === 'attribute')
        .map((c) => (c.type === 'attribute' ? c.childForFieldName('attribute')?.text : c.text)).filter(Boolean);
      const idx = addDef({ name, kind: 'class', parent: sc.def, bases }, sc.stmt ?? n, n);
      const body = n.childForFieldName('body');
      pyDocstring(body);
      if (sup) visitPy(sup, sc);
      if (body) for (const c of body.namedChildren) visitPy(c, { ...sc, def: idx, cls: idx, inClass: true, stmt: null });
      return;
    }
    if (t === 'expression_statement' && sc.def === -1 && n.namedChild(0)?.type === 'assignment') {
      const a = n.namedChild(0); const left = a.childForFieldName('left'); const right = a.childForFieldName('right');
      if (left?.type === 'identifier') {
        const idx = addDef({ name: left.text, kind: right?.type === 'lambda' ? 'function' : 'value', parent: -1 }, n, n);
        if (right) { pyValueRef(right, { ...sc, def: idx }); visitPy(right, { ...sc, def: idx }); }
        return;
      }
    }
    if (t === 'call') {
      const fn = n.childForFieldName('function');
      const [name, recv] = pyCallee(fn);
      addCall(n, name, recv, sc.def, 'call');
      const args = n.childForFieldName('arguments');
      if (args) for (const c of args.namedChildren) {
        if (c.type === 'keyword_argument') pyValueRef(c.childForFieldName('value'), sc); else pyValueRef(c, sc);
      }
    }
    if (t === 'return_statement' || t === 'list' || t === 'tuple') for (const c of n.namedChildren) pyValueRef(c, sc);
    if (t === 'for_statement' || t === 'for_in_clause') patternNames(n.childForFieldName('left'), sc.def);
    if (t === 'as_pattern') patternNames(n.childForFieldName('alias')?.namedChild(0) ?? n.childForFieldName('alias'), sc.def);
    if (t === 'pair') pyValueRef(n.childForFieldName('value'), sc);
    if (t === 'assignment') {
      const left = n.childForFieldName('left'); const right = n.childForFieldName('right');
      pyValueRef(right, sc); patternNames(left, sc.def);
      const ty = typeText(n.childForFieldName('type')) ?? valueType(right, sc.def);
      if (left?.type === 'identifier') { if (sc.inClass) setAttr(sc.cls, left.text, ty); else setType(sc.def, left.text, ty); }
      else if (left?.type === 'attribute' && left.childForFieldName('object')?.text === 'self') setAttr(sc.cls, left.childForFieldName('attribute')?.text, ty);
    }
    for (const c of n.namedChildren) visitPy(c, { ...sc, stmt: null });
  }

  // ---------- Go ----------
  function goType(res) { // a Go result type: T or *T (a single result, or the first of a list)
    let ty = res?.type === 'parameter_list' ? res.namedChildren[0]?.childForFieldName('type') : res;
    while (ty && (ty.type === 'pointer_type' || ty.type === 'generic_type')) ty = ty.namedChild(0);
    return ty?.type === 'type_identifier' || ty?.type === 'qualified_type' ? ty.text.split('.').pop() : null;
  }
  function goRecvType(recv) {
    const p = recv?.namedChildren.find((c) => c.type === 'parameter_declaration');
    let ty = p?.childForFieldName('type');
    while (ty && (ty.type === 'pointer_type' || ty.type === 'generic_type' || ty.type === 'parenthesized_type')) ty = ty.namedChild(0);
    return [ty?.text ?? null, p?.childForFieldName('name')?.text ?? null];
  }
  function visitGo(n, sc) {
    const t = n.type;
    if (t === 'comment') { markComment(n); return; }
    if (t === 'import_spec') {
      const path = n.childForFieldName('path'); const name = n.childForFieldName('name');
      if (path) { const source = unq(path.text); f.imports.push({ local: name?.text ?? source.split('/').pop(), imported: '*', source, level: 0 }); }
      return;
    }
    if (t === 'function_declaration') {
      const idx = addDef({ name: n.childForFieldName('name')?.text, kind: 'function', parent: -1 }, n, n);
      f.defs[idx].returns = goType(n.childForFieldName('result'));
      for (const c of n.namedChildren) visitGo(c, { def: idx });
      return;
    }
    if (t === 'method_declaration') {
      const [ty, recvName] = goRecvType(n.childForFieldName('receiver'));
      const idx = addDef({ name: n.childForFieldName('name')?.text, kind: 'method', parent: -1, owner: ty }, n, n);
      f.defs[idx].recvName = recvName;
      f.defs[idx].returns = goType(n.childForFieldName('result'));
      for (const c of n.namedChildren) visitGo(c, { def: idx, recvName });
      return;
    }
    if (t === 'type_spec' && sc.def === -1) {
      const decl = n.parent?.type === 'type_declaration' && n.parent.namedChildren.filter((c) => c.type === 'type_spec').length === 1 ? n.parent : n;
      addDef({ name: n.childForFieldName('name')?.text, kind: 'class', parent: -1 }, decl, n);
      return;
    }
    if (t === 'short_var_declaration' && sc.def >= 0) { // s := pkg.New(): s takes New's declared result type
      const left = n.childForFieldName('left')?.namedChildren ?? []; const right = n.childForFieldName('right')?.namedChildren ?? [];
      if (left.length === right.length) left.forEach((l, i) => { if (l.type === 'identifier') { addLocal(sc.def, l.text); setType(sc.def, l.text, valueType(right[i], sc.def)); } });
    }
    if (t === 'call_expression') {
      const fn = n.childForFieldName('function');
      if (fn?.type === 'identifier') addCall(n, fn.text, null, sc.def);
      else if (fn?.type === 'selector_expression') {
        const op = fn.childForFieldName('operand');
        const recv = op?.type === 'identifier' ? (op.text === sc.recvName ? 'this' : op.text) : 'expr';
        addCall(n, fn.childForFieldName('field')?.text, recv, sc.def);
      }
      const args = n.childForFieldName('arguments');
      if (args) for (const c of args.namedChildren) if (c.type === 'identifier') addRef(c, c.text, null, sc.def);
    }
    for (const c of n.namedChildren) visitGo(c, sc);
  }
}
