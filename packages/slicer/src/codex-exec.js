// A small static reader for Codex's functions.exec wrapper. This is intentionally NOT a
// JavaScript interpreter: only literal data and unconditional tool-call expressions are read.
// Branches, loops, functions, interpolation, getters and unknown arguments are never executed.

import { SLICE_REASONS } from '../index.js';
import { duplicateJsonKeys, strictJson } from './strict-json.js';

export const CODEX_CAPTURE_REASONS = Object.freeze({
  unsupported: 'codex_wrapper_unsupported',
  syntaxInvalid: 'codex_wrapper_syntax_invalid',
  incomplete: 'codex_wrapper_incomplete',
  unmapped: 'codex_wrapper_output_unmapped',
  arguments: 'codex_tool_arguments_unsupported',
  missing: 'codex_tool_result_missing',
  message: 'codex_message_content_unsupported',
  identity: 'codex_tool_identity_conflict',
  uiUnmatched: 'codex_ui_tool_unmatched',
  nativeUnmatched: 'codex_native_item_unmatched',
  // C-02 M33 native-first: a turn whose command, file or MCP inventory is not proved complete by
  // the per-turn bound (every wrapper parsed exactly and N native items === P dispatched calls).
  nativeInventory: 'codex_native_inventory_incomplete',
  pollUnmatched: 'codex_poll_unmatched',
  shape: SLICE_REASONS.CAPTURE_INCOMPLETE,
  codeEffectUntyped: SLICE_REASONS.KNOWN_CODE_EFFECT_UNTYPED,
  // Declared once, in the slicer's table (F130); this reader emits that member, never a copy.
  childHistory: SLICE_REASONS.CHILD_HISTORY_UNCHECKED,
});

const ACTION = /^(exec_command|apply_patch|shell|local_shell|run_terminal_cmd|str_replace_editor|read_file|view_file|write_file|create_file)$/;
export const isCodeTool = (name) => ACTION.test(String(name).split('.').pop()) || /^mcp__[\w-]+__(?:write|create|edit|update|replace|patch|append|save|delete|remove|trash|read|view|get|cat|open)_file$/.test(name);
const unknown = Symbol('unknown');
// C-02: `tools.constructor(...)` invokes Object, not a tool, and a `__proto__` key sets a
// prototype, not a field. No Object.prototype member is ever a tool name or an argument key.
const PROTOTYPE_NAMES = new Set(Object.getOwnPropertyNames(Object.prototype));
// C-02: names a module-code binding may not use (an early error: nothing in the script runs).
const BINDING_RESERVED = new Set(['await', 'yield', 'let', 'static', 'implements', 'interface', 'package',
  'private', 'protected', 'public', 'enum', 'arguments', 'eval', 'this', 'super', 'new', 'true', 'false', 'null',
  'var', 'const', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'typeof', 'void', 'delete', 'in',
  'instanceof', 'class', 'import', 'export', 'default', 'switch', 'case', 'break', 'continue', 'try', 'catch',
  'finally', 'throw', 'with', 'debugger', 'extends']);
const DECLARE = new Set(['const', 'let', 'var', 'function', 'class']);
// Declarations hoist: one anywhere that binds these makes every call, or every emission, unproved.
const CALL_GLOBALS = new Set(['tools', 'Promise']);
const EMIT_GLOBALS = new Set(['text', 'String', 'JSON', 'image', 'audio', 'notify', 'store']);
// C-02: a failed statement that mentions `tools` in ANY position (`globalThis.tools`, `self.tools`)
// declares an unsupported action. A code-tool name counts only as a bare call, never as the member
// of an already counted `tools.` access.
const toolMentions = (tokens) => tokens.reduce((n, t, i) => n + Number(t.type === 'id'
  && (t.value === 'tools' || tokens[i - 1]?.value !== '.' && isCodeTool(t.value) && tokens[i + 1]?.value === '(')), 0);
// C-02 M33 native-first refreeze: the dynamic dispatch routes a wrapper that "parsed exactly" never
// names. An identifier token anywhere (a member, a key or a template substitution included) counts;
// string contents and comments are not names.
const DYNAMIC_DISPATCH = new Set(['globalThis', 'self', 'window', 'global', 'eval', 'Function', 'Reflect',
  'Proxy', 'import', 'require']);
// Template substitutions are raw source this reader does not tokenize: a route name, `tools`, or a
// backslash (an identifier escape could spell either) anywhere in one counts.
const SUBSTITUTION_DISPATCH = /(?<![\w$])(?:globalThis|self|window|global|eval|Function|Reflect|Proxy|import|require|tools)(?![\w$])|\\/;
/** Every `tools` is a direct `tools.<name>(` call, and no dynamic dispatch route is named. */
function directDispatchOnly(tokens) {
  return tokens.every((token, i) => {
    if (token.type === 'template') return !token.value.expressions.some((e) => SUBSTITUTION_DISPATCH.test(e));
    if (token.type !== 'id') return true;
    if (DYNAMIC_DISPATCH.has(token.value)) return false;
    return token.value !== 'tools' || (tokens[i - 1]?.type !== 'punct' || !['.', '?.'].includes(tokens[i - 1].value))
      && tokens[i + 1]?.type === 'punct' && tokens[i + 1].value === '.'
      && tokens[i + 2]?.type === 'id' && tokens[i + 3]?.type === 'punct' && tokens[i + 3].value === '(';
  });
}
/** Every declared binding name (conservatively, any identifier in a binding position), by keyword. */
function declaredBindings(tokens) {
  const depthAt = []; let depth = 0;
  for (const token of tokens) {
    depthAt.push(depth);
    if (token.type === 'punct' && '([{'.includes(token.value)) depth++;
    else if (token.type === 'punct' && ')]}'.includes(token.value)) depth--;
  }
  const names = [];
  tokens.forEach((token, i) => {
    if (token.type !== 'id' || !DECLARE.has(token.value) || tokens[i - 1]?.value === '.') return;
    const topLevel = depthAt[i] === 0;
    if (token.value === 'function' || token.value === 'class') {
      const j = i + 1 + Number(tokens[i + 1]?.value === '*');
      if (tokens[j]?.type === 'id') names.push({ name: tokens[j].value, kind: token.value, topLevel });
      return;
    }
    let level = 0; let binding = true;
    for (let j = i + 1; j < tokens.length; j++) {
      const t = tokens[j];
      if (t.type === 'punct' && '([{'.includes(t.value)) { level++; continue; }
      if (t.type === 'punct' && ')]}'.includes(t.value)) { if (--level < 0) break; continue; }
      if (level === 0) {
        if (t.value === ';' || (t.type === 'id' && DECLARE.has(t.value))) break;
        if (t.type === 'punct' && t.value === '=') { binding = false; continue; }
        if (t.type === 'punct' && t.value === ',') { binding = true; continue; }
        if (binding && t.type === 'id' && (t.value === 'of' || t.value === 'in')) break;
      }
      if (binding && t.type === 'id' && tokens[j + 1]?.value !== ':') names.push({ name: t.value, kind: token.value, topLevel });
    }
  });
  return names;
}
/** An early error or a hoisted rebinding of `tools`/`Promise`: the reader proves no call at all. */
function unprovable(tokens, declared) {
  // C-02: a backslash outside a literal is an identifier escape (`t\u006fols`, `Str\u0069ng`) or
  // part of a regular expression. Either way the tokens are not what JavaScript runs.
  if (tokens.some((t) => t.type === 'punct' && (t.value === '/' || t.value === '\\'))) return true;
  if (tokens.some((t) => t.value === '=>' && t.nl)) return true;
  if (declared.some(({ name }) => BINDING_RESERVED.has(name) || CALL_GLOBALS.has(name))) return true;
  const top = new Map();
  for (const { name, kind, topLevel } of declared) if (topLevel) top.set(name, [...(top.get(name) ?? []), kind]);
  return [...top.values()].some((kinds) => kinds.length > 1 && kinds.some((kind) => kind !== 'var'));
}
// A literal-map callback parameter may not be a wrapper global, a keyword or a special name.
const MAP_RESERVED = new Set(['tools', 'Promise', 'JSON', 'String', 'text', 'image', 'audio', 'notify', 'store',
  'await', 'async', 'yield', 'this', 'arguments', 'eval', 'undefined', 'NaN', 'Infinity', 'globalThis',
  'var', 'let', 'const', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'new', 'typeof', 'void',
  'delete', 'in', 'of', 'instanceof', 'class', 'true', 'false', 'null', 'super', 'import', 'export',
  'default', 'switch', 'case', 'break', 'continue', 'try', 'catch', 'finally', 'throw', 'with', 'debugger',
  'enum', 'extends', 'static', 'implements', 'interface', 'package', 'private', 'protected', 'public']);

// C-02 strict JSON (strict-json.js): a repeated key makes a payload untyped on every path.
export { duplicateJsonKeys };

// C-02: JavaScript ends a line comment at any line terminator, not only LF.
const LINE_TERMINATOR = /[\n\r\u2028\u2029]/g;
function lineEnd(source, from) {
  LINE_TERMINATOR.lastIndex = from;
  return LINE_TERMINATOR.exec(source)?.index ?? -1;
}

// An interpolated template is syntax, never a value this reader evaluates. Retain its
// boundaries so a later unsupported formatter cannot erase earlier literal tool calls.
// Only the exact output-only form below is allowed to prove one visible emission per call.
function scanTemplate(source, start, depth = 0) {
  if (depth > 32 || source[start] !== '`') throw Error('template');
  const segments = []; const expressions = [];
  let i = start + 1; let segmentStart = i;
  while (i < source.length) {
    const c = source[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '`') {
      segments.push(source.slice(segmentStart, i));
      return { segments, expressions, end: i + 1 };
    }
    if (c !== '$' || source[i + 1] !== '{') { i++; continue; }
    segments.push(source.slice(segmentStart, i));
    const expressionStart = i + 2;
    i = expressionStart;
    let braces = 1;
    while (i < source.length && braces) {
      const ch = source[i];
      if (ch === '"' || ch === "'") {
        const quote = ch; i++;
        while (i < source.length && source[i] !== quote) {
          if (source[i] === '\\') i++;
          i++;
        }
        if (i >= source.length) throw Error('template string');
        i++; continue;
      }
      if (ch === '`') { i = scanTemplate(source, i, depth + 1).end; continue; }
      if (ch === '/' && source[i + 1] === '/') {
        const end = lineEnd(source, i + 2);
        i = end < 0 ? source.length : end + 1; continue;
      }
      if (ch === '/' && source[i + 1] === '*') {
        const end = source.indexOf('*/', i + 2);
        if (end < 0) throw Error('template comment');
        i = end + 2; continue;
      }
      if (ch === '{') braces++;
      else if (ch === '}') braces--;
      i++;
    }
    if (braces) throw Error('template expression');
    expressions.push(source.slice(expressionStart, i - 1));
    segmentStart = i;
  }
  throw Error('template');
}

function tokensOf(source) {
  const tokens = [];
  // `nl` marks a token preceded by a line terminator (JavaScript forbids one before `=>`).
  let newline = false;
  const push = (token) => { if (newline) token.nl = true; newline = false; tokens.push(token); };
  for (let i = 0; i < source.length;) {
    const c = source[i];
    if (/\s/.test(c)) { if ('\n\r\u2028\u2029'.includes(c)) newline = true; i++; continue; }
    if (source.startsWith('//', i)) {
      const end = lineEnd(source, i + 2);
      if (end >= 0) newline = true;
      i = end < 0 ? source.length : end + 1; continue;
    }
    if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2); if (end < 0) throw Error('comment');
      LINE_TERMINATOR.lastIndex = 0;
      if (LINE_TERMINATOR.test(source.slice(i + 2, end))) newline = true;
      i = end + 2; continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c; const start = i; let value = ''; let closed = false; let templated = false; i++;
      while (i < source.length) {
        const ch = source[i++];
        if (ch === quote) { closed = true; break; }
        if (quote === '`' && ch === '$' && source[i] === '{') {
          const template = scanTemplate(source, start);
          push({ type: 'template', value: template });
          i = template.end; closed = true; templated = true; break;
        }
        if (quote !== '`' && (ch === '\n' || ch === '\r')) throw Error('newline');
        // A template's raw CR or CRLF reads as LF, as JavaScript cooks it.
        if (ch === '\r') { if (source[i] === '\n') i++; value += '\n'; continue; }
        if (ch !== '\\') { value += ch; continue; }
        if (i >= source.length) throw Error('escape');
        const e = source[i++];
        const simple = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' };
        if (e === '\n') continue;
        if (e === '\r') { if (source[i] === '\n') i++; continue; }
        if (e === 'x' || e === 'u') {
          let digits;
          if (e === 'u' && source[i] === '{') {
            const end = source.indexOf('}', ++i); if (end < 0) throw Error('unicode');
            digits = source.slice(i, end); i = end + 1;
            if (!/^[0-9a-f]{1,6}$/i.test(digits) || parseInt(digits, 16) > 0x10ffff) throw Error('unicode');
          } else {
            const length = e === 'x' ? 2 : 4; digits = source.slice(i, i + length); i += length;
            if (digits.length !== length || !/^[0-9a-f]+$/i.test(digits)) throw Error('unicode');
          }
          value += String.fromCodePoint(parseInt(digits, 16)); continue;
        }
        if (/\d/.test(e) && (e !== '0' || /\d/.test(source[i] ?? ''))) throw Error('octal');
        value += Object.hasOwn(simple, e) ? simple[e] : e;
      }
      if (!closed) throw Error('string');
      // C-02 M33 (3): a no-substitution template also keeps its raw source text, CR/CRLF read as
      // LF as JavaScript's raw value does, so an exact String.raw tag can read it (never cooked).
      if (!templated) push(quote === '`'
        ? { type: 'literal', value, template: true, raw: source.slice(start + 1, i - 1).replace(/\r\n?/g, '\n') }
        : { type: 'literal', value });
      continue;
    }
    const identifier = /^[A-Za-z_$][\w$]*/.exec(source.slice(i));
    if (identifier) { push({ type: 'id', value: identifier[0] }); i += identifier[0].length; continue; }
    const number = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(i));
    // A legacy octal or leading-zero number is an early error in module code.
    if (number && /^0\d/.test(number[0])) throw Error('leading zero');
    if (number) { push({ type: 'literal', value: Number(number[0]) }); i += number[0].length; continue; }
    const compound = ['...', '=>', '?.', '&&', '||', '??', '++', '--', '===', '!==', '==', '!='].find((s) => source.startsWith(s, i));
    push({ type: 'punct', value: compound ?? c }); i += compound?.length ?? 1;
  }
  return tokens;
}

/**
 * D69 review (finding F3): every string a code cell's script spells literally, by the JavaScript grammar (`tokensOf`): each
 * string literal's value, each template literal's text between its substitutions (as written), and the strings of each
 * substitution's own code, recursively. Null when the script does not tokenize (the reader's screen is conservative): what
 * it names is then unknown. Words of a string are the caller's to read (events.js reads them by the shell grammar).
 */
export function scriptStrings(source) {
  let tokens;
  try { tokens = tokensOf(String(source)); } catch { return null; }
  const out = [];
  const templateStrings = (template, depth) => {
    out.push(...template.segments);
    for (const expression of template.expressions) {
      if (depth > 32) continue;
      let inner;
      try { inner = tokensOf(expression); } catch { inner = []; }
      for (const t of inner) collect(t, depth + 1);
    }
  };
  const collect = (t, depth = 0) => {
    if (t.type === 'literal' && typeof t.value === 'string') out.push(t.value);
    else if (t.type === 'template' && t.value && Array.isArray(t.value.segments)) templateStrings(t.value, depth);
  };
  for (const t of tokens) collect(t);
  return out;
}

// Only references created by this reader have authority. Recorded object literals can contain
// arbitrary marker/value properties; their shape must never impersonate a tool result reference.
const references = new WeakSet();
const marker = (kind, value) => {
  const reference = { marker: kind, value };
  references.add(reference);
  return reference;
};
const isMarker = (value) => !!value && typeof value === 'object' && references.has(value);
const literal = (value) => value !== unknown && !isMarker(value) && (value == null || typeof value !== 'object'
  || (Array.isArray(value) ? value.every(literal) : Object.values(value).every(literal)));

/** An exact global `String.raw` tag on a no-substitution template starts at `tokens[i]`. */
function stringRawTagAt(tokens, i) {
  const [tag, dot, raw, template] = tokens.slice(i, i + 4);
  const previous = tokens[i - 1];
  return tag?.type === 'id' && tag.value === 'String'
    && !(previous?.type === 'punct' && (previous.value === '.' || previous.value === '?.'))
    && dot?.type === 'punct' && dot.value === '.' && raw?.type === 'id' && raw.value === 'raw'
    && template?.type === 'literal' && template.template === true && typeof template.raw === 'string';
}
// A substitution is source text this reader does not tokenize: any `String` word in it, or any
// backslash (an identifier escape could spell one), counts as an occurrence of the identifier.
const SUBSTITUTION_STRING = /(?<![\w$])String(?![\w$])|\\/;
/**
 * C-02 M33 (3) refreeze: the identifier `String` occurs nowhere in the source except as the object
 * of exact `String.raw` tags. A parameter, catch binding, destructuring, object key, member
 * `x.String`, label, bare `String` or a mention inside a template substitution (all of which
 * could rebind or stand for another `String`) leaves every `String.raw` tag unproved.
 */
function stringRawEligible(tokens) {
  return tokens.every((token, i) => (token.type === 'template'
    ? !token.value.expressions.some((expression) => SUBSTITUTION_STRING.test(expression))
    : token.type !== 'id' || token.value !== 'String' || stringRawTagAt(tokens, i)));
}

/** Replace each exact global `String.raw` + no-substitution template with its raw string literal. */
function stringRawLiterals(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const tag = tokens[i];
    if (stringRawTagAt(tokens, i)) {
      out.push({ type: 'literal', value: tokens[i + 3].raw, ...(tag.nl ? { nl: true } : {}) });
      i += 3;
    } else out.push(tag);
  }
  return out;
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
function wholeSourceParses(source, tokens) {
  // Compile only: the source is never executed. Strict async function syntax catches ordinary
  // syntax errors cheaply, while retaining top-level await. Module code also rejects return
  // outside a function body and top-level new.target; conservatively screen those tokens.
  try { new AsyncFunction(`"use strict";\n${source}`); } catch { return false; }
  const pairs = new Map(); const stack = [];
  const opposite = { ')': '(', ']': '[', '}': '{' };
  for (const [index, token] of tokens.entries()) {
    if (token.type !== 'punct') continue;
    if (['(', '[', '{'].includes(token.value)) stack.push([token.value, index]);
    else if (Object.hasOwn(opposite, token.value)) {
      const last = stack.pop();
      if (!last || last[0] !== opposite[token.value]) return false;
      pairs.set(last[1], index);
    }
  }
  if (stack.length) return false;
  const functionBodies = [];
  for (const [index, token] of tokens.entries()) {
    if (token.type === 'id' && token.value === 'function') {
      let at = index + 1;
      if (tokens[at]?.value === '*') at++;
      if (tokens[at]?.type === 'id') at++;
      const endParams = tokens[at]?.value === '(' ? pairs.get(at) : null;
      const body = endParams == null ? null : endParams + 1;
      if (tokens[body]?.value === '{' && pairs.has(body)) functionBodies.push([body, pairs.get(body)]);
    } else if (token.type === 'punct' && token.value === '=>'
      && tokens[index + 1]?.type === 'punct' && tokens[index + 1]?.value === '{'
      && pairs.has(index + 1)) functionBodies.push([index + 1, pairs.get(index + 1)]);
  }
  for (const [index, token] of tokens.entries()) {
    if (token.type === 'id' && token.value === 'return'
      && !functionBodies.some(([start, end]) => start < index && index < end)) return false;
    if (token.type === 'id' && token.value === 'new'
      && tokens[index + 1]?.type === 'punct' && tokens[index + 1]?.value === '.'
      && tokens[index + 2]?.type === 'id' && tokens[index + 2]?.value === 'target') return false;
  }
  return true;
}

/**
 * Parse only the unconditional prefix. A later unsupported statement cannot license calls in it.
 * `inventoryExact` (C-02 M33 native-first refreeze) is true only when the script is not
 * syntax-invalid, every statement was read (none rejected, none unsupported), and its source names
 * no dynamic dispatch route and no `tools` other than a direct `tools.<name>(` call: only then is
 * `calls` every inner call the script can have dispatched.
 */
export function readExecCalls(source) {
  const calls = []; const emissions = []; let unsupported = 0; let emissionsExact = true;
  let emissionsPrefixLength = null; let nextBatch = 0;
  let completedStatements = 0; let tierOneMatched = false; let statementRejected = false;
  const inexactEmissions = () => {
    emissionsPrefixLength ??= emissions.length;
    emissionsExact = false;
  };
  if (typeof source !== 'string' || source.length > 1_000_000) return {
    calls, emissions, emissionsExact: false, emissionsPrefixLength: 0, unsupported: 1, inventoryExact: false,
  };
  let ts;
  try { ts = tokensOf(source); } catch { return {
    calls, emissions, emissionsExact: false, emissionsPrefixLength: 0, unsupported: 1, inventoryExact: false,
  }; }
  if (!wholeSourceParses(source, ts)) return {
    calls, emissions, emissionsExact: false, emissionsPrefixLength: 0,
    unsupported: 0, syntaxInvalid: true, inventoryExact: false,
  };
  // C-02: the token stream must be what JavaScript runs, before any statement is believed.
  const declared = declaredBindings(ts);
  if (unprovable(ts, declared)) return {
    calls, emissions, emissionsExact: false, emissionsPrefixLength: 0, unsupported: Math.max(1, toolMentions(ts)),
    inventoryExact: false,
  };
  const dispatchDirect = directDispatchOnly(ts);
  const emitterRebound = declared.some(({ name }) => EMIT_GLOBALS.has(name));
  // C-02 M33 (3): with the identifier `String` occurring only as the object of exact `String.raw`
  // tags, each such tag on one no-substitution template is a string literal whose value is the
  // raw text. Any other tag, a member `x.String.raw`, a substitution or a nested template keeps
  // its tokens, so it stays unproved; so does every tag when `String` occurs anywhere else.
  if (!declared.some(({ name }) => name === 'String') && stringRawEligible(ts)) ts = stringRawLiterals(ts);
  let at = 0; const bindings = new Map(); const settledBindings = new WeakMap();
  // M30: a const bound to a dense primitive literal array, by the statement that declared it,
  // and how often each name was declared. `awaitedAt` holds token positions directly after await.
  const literalArrays = new Map(); const declarations = new Map(); const awaitedAt = new Set();
  // Settled markers of expanded calls. Only an index-carrying emitter may map them (C-02 M30).
  const expandedSettled = new WeakSet();
  // A later lexical declaration throws at an earlier reference, so these read the whole source.
  const bareGlobal = ts.some((token, index) => token.type === 'id' && ['tools', 'Promise'].includes(token.value)
    && ts[index - 1]?.value !== '.' && ts[index + 1]?.value !== '.');
  const occurrences = (name) => ts.reduce((n, token, index) => n
    + Number(token.type === 'id' && token.value === name && ts[index - 1]?.value !== '.'), 0);
  const peek = (value) => ts[at]?.value === value;
  const take = (value) => { if (!peek(value)) throw Error('syntax'); return ts[at++]; };
  // Any `tools` mention in a failed statement (`(0, tools).x`, an alias) may have run a call.
  const remainingActions = () => toolMentions(ts.slice(at));
  const argumentsOf = () => {
    take('('); const args = [];
    while (!peek(')')) { args.push(expression()); if (!peek(',')) break; at++; if (peek(')')) break; }
    take(')'); return args;
  };
  const indexedSettledOutput = (resultName, indexName, jsonRequired = false) => {
    take('text'); take('(');
    const json = peek('JSON');
    if (jsonRequired && !json) throw Error('indexed output');
    if (json) { take('JSON'); take('.'); take('stringify'); take('('); }
    take('{');
    const shorthand = ts[at++]; take(','); take('...'); const spread = ts[at++]; take('}');
    if (json) take(')');
    take(')');
    if (resultName?.type !== 'id' || indexName?.type !== 'id' || resultName.value === indexName.value
      // The shorthand key must be the actual iterator index, and the spread must be
      // the untouched settled result. execResults validates the indexed envelope.
      || ['text', 'JSON'].includes(resultName.value)
      || ['text', 'JSON', 'status', 'value', 'reason'].includes(indexName.value)
      || (!json && indexName.value !== 'i')
      || shorthand?.type !== 'id' || shorthand.value !== indexName.value
      || spread?.type !== 'id' || spread.value !== resultName.value) throw Error('indexed output');
    return indexName.value;
  };
  const indexedLoopSpreadOutput = (collection, indexName) => {
    // The forEach envelope `{i, ...entry}` with the entry read as `collection[index]`. The same
    // name rules apply: a plain (non-JSON) object only for `i`, never an envelope key as index.
    const exactId = (name) => {
      const token = ts[at++];
      if (token?.type !== 'id' || token.value !== name) throw Error('indexed output');
    };
    exactId('text'); take('(');
    const json = ts[at]?.type === 'id' && peek('JSON');
    if (json) { exactId('JSON'); take('.'); exactId('stringify'); take('('); }
    take('{'); exactId(indexName.value); take(','); take('...');
    exactId(collection.value); take('['); exactId(indexName.value); take(']'); take('}');
    if (json) take(')');
    take(')');
    if (indexName?.type !== 'id' || collection?.type !== 'id' || indexName.value === collection.value
      || ['text', 'JSON', 'status', 'value', 'reason'].includes(indexName.value)
      || ['text', 'JSON', 'tools', 'Promise'].includes(collection.value)
      || (!json && indexName.value !== 'i')) throw Error('indexed output');
    return indexName.value;
  };
  const indexedNestedSettledOutput = (resultName, indexName, collectionName = null) => {
    // JSON.stringify({i, result: entry}) retains the original settled envelope under
    // `result`. The index may be written as shorthand or explicitly as `index: i`.
    take('text'); take('('); take('JSON'); take('.'); take('stringify'); take('('); take('{');
    const first = ts[at++];
    if (first?.type !== 'id') throw Error('nested index');
    let indexKey = first.value;
    if (peek(':')) { take(':'); take(indexName.value); }
    else if (first.value !== indexName.value) throw Error('nested index');
    take(','); take('result'); take(':');
    if (collectionName) {
      take(collectionName); take('['); take(indexName.value); take(']');
    } else take(resultName.value);
    take('}'); take(')'); take(')');
    if (resultName?.type !== 'id' || indexName?.type !== 'id'
      || resultName.value === indexName.value || !['i', 'index'].includes(indexKey)
      || ['text', 'tools', 'Promise', 'JSON', 'result'].includes(resultName.value)
      || ['text', 'tools', 'Promise', 'JSON', 'result'].includes(indexName.value)
      || (collectionName && collectionName === indexName.value)) throw Error('nested index');
    return indexKey;
  };
  const indexedProjectedSettledOutput = (resultName, indexName, collectionName = null) => {
    // The rejected arm has an exact shape. A different object payload must therefore
    // be the fulfilled tool value; an identical shape has known ownership only.
    if (bindings.has('String')) throw Error('shadowed String');
    take('text'); take('('); take('JSON'); take('.'); take('stringify'); take('('); take('{');
    const first = ts[at++];
    if (first?.type !== 'id') throw Error('projected index');
    const indexKey = first.value;
    if (peek(':')) { take(':'); take(indexName.value); }
    else if (first.value !== indexName.value) throw Error('projected index');
    take(','); take('result'); take(':');
    const member = (part) => {
      if (collectionName) { take(collectionName); take('['); take(indexName.value); take(']'); }
      else take(resultName.value);
      take('.'); take(part);
    };
    member('status'); take('===');
    const fulfilled = ts[at++];
    if (fulfilled?.type !== 'literal' || fulfilled.value !== 'fulfilled') throw Error('projected status');
    take('?'); member('value'); take(':');
    let rejectionShape = 'string';
    if (peek('{')) {
      take('{');
      const key = ts[at++];
      if (key?.type !== 'id' || !['error', 'reason'].includes(key.value)) throw Error('projected rejection');
      rejectionShape = key.value;
      take(':');
    }
    take('String'); take('('); member('reason'); take(')');
    if (rejectionShape !== 'string') take('}');
    take('}'); take(')'); take(')');
    if (resultName?.type !== 'id' || indexName?.type !== 'id'
      || resultName.value === indexName.value || !['i', 'index'].includes(indexKey)
      || ['text', 'tools', 'Promise', 'JSON', 'String', 'result'].includes(resultName.value)
      || ['text', 'tools', 'Promise', 'JSON', 'String', 'result'].includes(indexName.value))
      throw Error('projected index');
    return { indexKey, rejectionShape };
  };
  const indexedStatusValueOutput = (resultName, indexName, collectionName = null) => {
    // Only the original settled status and the untouched fulfilled value retain a
    // typed result. A projection, spread, alias or coerced rejection is a different
    // grammar, even if its recorded JSON has the same apparent keys.
    take('text'); take('('); take('JSON'); take('.'); take('stringify'); take('('); take('{');
    const first = ts[at++];
    if (first?.type !== 'id') throw Error('settled index');
    const indexKey = first.value;
    if (peek(':')) { take(':'); take(indexName.value); }
    else if (indexKey !== indexName.value) throw Error('settled index');
    take(','); take('status'); take(':');
    const member = (part) => {
      if (collectionName) { take(collectionName); take('['); take(indexName.value); take(']'); }
      else take(resultName.value);
      take('.'); take(part);
    };
    member('status'); take(',');
    const valueKey = ts[at++];
    if (valueKey?.type !== 'id' || !['result', 'value'].includes(valueKey.value)) throw Error('settled value key');
    take(':'); member('status'); take('===');
    const fulfilled = ts[at++];
    if (fulfilled?.type !== 'literal' || fulfilled.value !== 'fulfilled') throw Error('settled status');
    take('?'); member('value'); take(':'); member('reason');
    take('}'); take(')'); take(')');
    if (resultName?.type !== 'id' || indexName?.type !== 'id'
      || resultName.value === indexName.value || !['i', 'index'].includes(indexKey)
      || ['text', 'tools', 'Promise', 'JSON', 'status', 'result', 'value', 'reason'].includes(resultName.value)
      || ['text', 'tools', 'Promise', 'JSON', 'status', 'result', 'value', 'reason'].includes(indexName.value)
      || (collectionName && collectionName === indexName.value)) throw Error('settled names');
    return { indexKey, valueKey: valueKey.value };
  };
  const tierOneBatch = (settled, collectionName) => settled.value.length > 0
    && completedStatements === 1 && emissions.length === 0
    && settledBindings.get(settled)?.name === collectionName
    && settledBindings.get(settled)?.declaration === 'const'
    && calls.length === settled.value.length
    && settled.value.every((index, position) => index === position
      && calls[index].awaited && isCodeTool(calls[index].name));
  const addSettledEmissions = (value, indexKey) => {
    const batch = nextBatch++;
    for (let i = 0; i < value.value.length; i++) emissions.push(marker('settledForEach', {
      call: value.value[i], batch, index: i, indexKey, count: value.value.length,
    }));
  };
  const exactMember = (tokens, start, root, parts) => {
    let atMember = start;
    if (tokens[atMember]?.type !== 'id' || tokens[atMember++].value !== root) return null;
    for (const part of parts) {
      if (tokens[atMember++]?.value !== '.' || tokens[atMember++]?.value !== part) return null;
    }
    return atMember;
  };
  const visibleTemplate = (template, resultName, indexName) => {
    if (resultName?.type !== 'id' || indexName?.type !== 'id'
      || resultName.value === indexName.value
      || ['text', 'tools', 'Promise', 'JSON', 'String', 'notify', 'store'].includes(resultName.value)
      || ['text', 'tools', 'Promise', 'JSON', 'String', 'notify', 'store'].includes(indexName.value)
      || template?.type !== 'template' || template.value.expressions.length !== 2
      || template.value.segments.length !== 3
      || template.value.segments[0] !== '' || template.value.segments[1] !== ': '
      || template.value.segments[2] !== '') return false;
    const index = tokensOf(template.value.expressions[0]);
    if (index.length !== 1 || index[0].type !== 'id' || index[0].value !== indexName.value) return false;
    const parts = tokensOf(template.value.expressions[1]);
    let pos = exactMember(parts, 0, resultName.value, ['status']);
    if (pos == null || parts[pos++]?.value !== '===' || parts[pos]?.type !== 'literal'
      || parts[pos++].value !== 'fulfilled' || parts[pos++]?.value !== '?') return false;
    const success = exactMember(parts, pos, resultName.value, ['value', 'output']);
    if (success != null) pos = success;
    else {
      const inner = parts[pos++];
      if (inner?.type !== 'template' || ![1, 2].includes(inner.value.expressions.length)) return false;
      const innerParts = inner.value.expressions.map((expression) => tokensOf(expression));
      if (innerParts.length === 2 && exactMember(innerParts[0], 0, resultName.value,
        ['value', 'exit_code']) !== innerParts[0].length) return false;
      const outputParts = innerParts.at(-1);
      if (exactMember(outputParts, 0, resultName.value, ['value', 'output']) !== outputParts.length) return false;
    }
    if (parts[pos++]?.value !== ':') return false;
    return exactMember(parts, pos, resultName.value, ['reason']) === parts.length;
  };
  const canonicalAllSettledForEach = () => {
    const start = at;
    const collection = ts[at++];
    if (collection?.type !== 'id' || !peek('.')) { at = start; return false; }
    const value = bindings.get(collection.value);
    if (!isMarker(value) || value.marker !== 'allSettled') { at = start; return false; }
    // C-02 M33 (5) refreeze: an indexed emitter is called on the exact bound settled-result
    // name. An alias (any other identifier bound to the same result) proves no mapping.
    if (settledBindings.get(value)?.name !== collection.value) throw Error('settled forEach alias');
    take('.'); take('forEach'); take('('); take('(');
    const resultName = ts[at++]; take(','); const indexName = ts[at++]; take(')'); take('=>');
    // Both supported callbacks emit synchronously once per original settled entry. A
    // template may display transformed text, so it proves only visible O, never status.
    let indexKey = null; let templateVisible = false; let nested = false; let projection = null; let statusValue = null;
    if (peek('text') && ts[at + 1]?.value === '(' && ts[at + 2]?.type === 'template') {
      take('text'); take('(');
      const template = ts[at++]; take(')');
      if (!visibleTemplate(template, resultName, indexName)) throw Error('template emitter');
      templateVisible = true;
    } else {
      const emissionStart = at;
      try { indexKey = indexedSettledOutput(resultName, indexName); }
      catch {
        at = emissionStart;
        try { indexKey = indexedNestedSettledOutput(resultName, indexName); nested = true; }
        catch {
          at = emissionStart;
          try {
            projection = indexedProjectedSettledOutput(resultName, indexName);
            indexKey = projection.indexKey;
          } catch {
            at = emissionStart;
            statusValue = indexedStatusValueOutput(resultName, indexName);
            indexKey = statusValue.indexKey;
          }
        }
      }
    }
    take(')');
    if (statusValue && !tierOneBatch(value, collection.value)) throw Error('settled batch');
    if (statusValue) tierOneMatched = true;
    if (templateVisible) {
      const batch = nextBatch++;
      for (let i = 0; i < value.value.length; i++) emissions.push(marker('settledVisibleOutput', {
        call: value.value[i], batch, index: i, count: value.value.length, indexPrefix: true,
      }));
    } else if (nested || projection || statusValue) {
      const batch = nextBatch++;
      for (let i = 0; i < value.value.length; i++) emissions.push(marker(statusValue ? 'settledStatusValue'
        : projection ? 'settledProjection' : 'settledNested', {
        call: value.value[i], batch, index: i, indexKey, count: value.value.length,
        ...(projection ? { rejectionShape: projection.rejectionShape } : {}),
        ...(statusValue ? { valueKey: statusValue.valueKey } : {}),
      }));
    } else addSettledEmissions(value, indexKey);
    return true;
  };
  const canonicalAllSettledIndexLoop = () => {
    if (!peek('for')) return false;
    const start = at;
    take('for'); take('(');
    if (!peek('let')) { at = start; return false; }
    take('let'); const indexName = ts[at++]; take('=');
    const zero = ts[at++]; take(';'); take(indexName.value); take('<');
    const collection = ts[at++]; take('.'); take('length'); take(';');
    take(indexName.value); take('++'); take(')');
    if (indexName?.type !== 'id' || collection?.type !== 'id'
      || zero?.type !== 'literal' || zero.value !== 0
      || indexName.value === collection.value || ['text', 'tools', 'Promise', 'JSON'].includes(indexName.value))
      throw Error('settled index loop');
    const settled = bindings.get(collection.value);
    if (!isMarker(settled) || settled.marker !== 'allSettled') throw Error('settled index loop');
    // The collection must be the settled result's own binding, not an alias of it, in every
    // indexed loop form (C-02: aliases do not prove the mapping).
    if (settledBindings.get(settled)?.name !== collection.value) throw Error('settled index loop alias');
    const braced = peek('{'); if (braced) take('{');
    const emissionStart = at;
    // C-02 M33 (1): the untouched spread envelope `{index, ...results[index]}` is an indexed
    // emitter here exactly as inside forEach or entries(). Its payload rules are unchanged
    // (execResults: strict JSON, one block per index, native settled status). The collection
    // must be the settled result's own binding, not an alias of it.
    let spreadKey = null;
    try { spreadKey = indexedLoopSpreadOutput(collection, indexName); } catch { at = emissionStart; }
    if (spreadKey !== null) {
      if (braced) { if (peek(';')) take(';'); take('}'); }
      addSettledEmissions(settled, spreadKey);
      return true;
    }
    let indexKey; let projection = null; let statusValue = null;
    try { indexKey = indexedNestedSettledOutput(collection, indexName, collection.value); }
    catch {
      at = emissionStart;
      try {
        projection = indexedProjectedSettledOutput(collection, indexName, collection.value);
        indexKey = projection.indexKey;
      } catch {
        at = emissionStart;
        statusValue = indexedStatusValueOutput(collection, indexName, collection.value);
        indexKey = statusValue.indexKey;
      }
    }
    if (braced) { if (peek(';')) take(';'); take('}'); }
    if (statusValue && !tierOneBatch(settled, collection.value)) throw Error('settled batch');
    if (statusValue) tierOneMatched = true;
    const batch = nextBatch++;
    for (let i = 0; i < settled.value.length; i++) emissions.push(marker(statusValue ? 'settledStatusValue'
      : projection ? 'settledProjection' : 'settledNested', {
      call: settled.value[i], batch, index: i, indexKey, count: settled.value.length,
      ...(projection ? { rejectionShape: projection.rejectionShape } : {}),
      ...(statusValue ? { valueKey: statusValue.valueKey } : {}),
    }));
    return true;
  };
  const canonicalAllSettledEntries = () => {
    if (!peek('for')) return false;
    take('for'); take('('); take('const'); take('[');
    const indexName = ts[at++]; take(','); const resultName = ts[at++]; take(']'); take('of');
    const collection = ts[at++];
    if (collection?.type !== 'id') throw Error('entries collection');
    const value = bindings.get(collection.value);
    if (!isMarker(value) || value.marker !== 'allSettled'
      || collection.value === indexName?.value || collection.value === resultName?.value
      // C-02 M33 (5) refreeze: the exact bound settled-result name, never an alias of it.
      || settledBindings.get(value)?.name !== collection.value) throw Error('entries collection');
    take('.'); take('entries'); take('('); take(')'); take(')');
    // Array.entries() yields each original index/result pair in order. Accept only
    // this unmodified, synchronous JSON emission; W6's transformed loops stay gaps.
    const indexKey = indexedSettledOutput(resultName, indexName, true);
    addSettledEmissions(value, indexKey);
    return true;
  };
  const canonicalAllSettledVisibleOutputLoop = () => {
    if (!peek('for')) return false;
    const start = at;
    take('for'); take('('); take('const');
    // Leave destructured `for (const [index, entry] of ...)` to the indexed reader.
    if (ts[at]?.type !== 'id') { at = start; return false; }
    const item = ts[at++]; take('of'); const collection = ts[at++]; take(')');
    if (item?.type !== 'id' || collection?.type !== 'id' || item.value === collection.value
      || ['text', 'String', 'tools', 'Promise', 'JSON'].includes(item.value)
      || bindings.has('String')) throw Error('settled output loop');
    const settled = bindings.get(collection.value);
    if (!isMarker(settled) || settled.marker !== 'allSettled') throw Error('settled output loop');
    // Unindexed: its output carries no array index, so it maps no expanded call (C-02 M30).
    if (expandedSettled.has(settled)) throw Error('settled output loop');
    const member = (...parts) => {
      take(item.value);
      for (const part of parts) { take('.'); take(part); }
    };
    // Promise.allSettled and a direct for-of both preserve the input array's order. This
    // exact, unbraced expression emits once per entry but discards status and exit_code.
    // It proves which displayed text belongs to which call, not whether the call succeeded.
    take('text'); take('(');
    member('status'); take('===');
    const fulfilled = ts[at++];
    if (fulfilled?.type !== 'literal' || fulfilled.value !== 'fulfilled') throw Error('settled status');
    take('?'); member('value', 'output'); take(':');
    take('String'); take('('); member('reason'); take(')'); take(')');
    const batch = nextBatch++;
    for (let i = 0; i < settled.value.length; i++) emissions.push(marker('settledVisibleOutput', {
      call: settled.value[i], batch, index: i, count: settled.value.length,
    }));
    return true;
  };
  const canonicalAllSettledEnvelopeLoop = () => {
    // This exact loop emits each untouched Promise.allSettled entry once, in order.
    // A transformed entry or a callback is outside the proof, even if counts happen to fit.
    const [forToken, open, declaration, item, of, collection, close, emit, emitOpen,
      emitted, emitClose] = ts.slice(at, at + 11);
    if (forToken?.value !== 'for' || open?.value !== '(' || declaration?.value !== 'const'
      || item?.type !== 'id' || of?.value !== 'of' || collection?.type !== 'id'
      || close?.value !== ')' || emit?.value !== 'text' || emitOpen?.value !== '('
      || emitted?.value !== item.value || emitClose?.value !== ')') return false;
    if (item.value === collection.value || ['text', 'tools', 'Promise', 'JSON'].includes(item.value))
      throw Error('settled envelope loop');
    const settled = bindings.get(collection.value);
    if (!isMarker(settled) || settled.marker !== 'allSettled') throw Error('settled envelope loop');
    // Unindexed: its output carries no array index, so it maps no expanded call (C-02 M30).
    if (expandedSettled.has(settled)) throw Error('settled envelope loop');
    at += 11;
    const batch = nextBatch++;
    for (let i = 0; i < settled.value.length; i++) emissions.push(marker('settledEnvelope', {
      call: settled.value[i], batch, index: i, count: settled.value.length,
    }));
    return true;
  };
  const primitiveItem = () => {
    const token = ts[at];
    // A non-finite number is serialized as null on its way to the tool: not the recorded value.
    if (token?.type === 'literal' && (typeof token.value === 'string' || Number.isFinite(token.value))) { at++; return token.value; }
    if (token?.value === '-' && ts[at + 1]?.type === 'literal' && Number.isFinite(ts[at + 1].value)) {
      at += 2; return -ts[at - 1].value;
    }
    if (token?.type === 'id' && ['true', 'false', 'null'].includes(token.value)) { at++; return JSON.parse(token.value); }
    throw Error('literal item');
  };
  const primitiveArray = () => {
    take('['); const items = [];
    while (!peek(']')) { items.push(primitiveItem()); if (!peek(',')) break; at++; }
    take(']'); return items;
  };
  // M30 (C-02): `await Promise.allSettled(ARRAY.map(item => tools.name({item, flag: literal})))`
  // over a dense primitive literal array, inline or a const declared by the statement just
  // before. Anything that starts this way and deviates throws, so its statement stays a gap.
  // The expanded calls are attempted actions in array order; results need their own proof.
  const literalMap = () => {
    const start = at;
    take('(');
    let items;
    const head = ts[at];
    if (head?.type === 'id' && ts[at + 1]?.value === '.' && ts[at + 2]?.value === 'map') {
      const bound = literalArrays.get(head.value);
      if (!bound || bound.statement !== completedStatements - 1 || declarations.get(head.value) !== 1
        || occurrences(head.value) !== 2) throw Error('map array');
      items = bound.items; at++;
    } else if (peek('[')) {
      try { items = primitiveArray(); } catch { at = start; return null; }
      if (!peek('.') || ts[at + 1]?.value !== 'map') { at = start; return null; }
    } else { at = start; return null; }
    take('.'); take('map'); take('(');
    if (bareGlobal) throw Error('map global');
    const parenthesized = peek('('); if (parenthesized) take('(');
    const parameter = ts[at++];
    if (parameter?.type !== 'id' || MAP_RESERVED.has(parameter.value) || bindings.has(parameter.value))
      throw Error('map parameter');
    if (parenthesized) take(')');
    take('=>');
    const body = peek('('); if (body) take('(');
    take('tools'); take('.');
    const name = ts[at++]; if (name?.type !== 'id' || PROTOTYPE_NAMES.has(name.value)) throw Error('map tool');
    take('('); take('{');
    const fields = []; const keys = new Set(); let substituted = 0;
    while (!peek('}')) {
      const key = ts[at++];
      if (!key || !['id', 'literal'].includes(key.type) || typeof key.value !== 'string' || keys.has(key.value)
        || PROTOTYPE_NAMES.has(key.value)) throw Error('map field');
      keys.add(key.value);
      if (key.type === 'id' && key.value === parameter.value && (peek(',') || peek('}'))) {
        fields.push([key.value, null]); substituted++;
      } else { take(':'); fields.push([key.value, { value: primitiveItem() }]); }
      if (!peek(',')) break; at++;
    }
    take('}');
    const close = () => { if (peek(',') && ts[at + 1]?.value === ')') at++; take(')'); };
    close(); if (body) take(')'); close(); close();
    if (substituted !== 1) throw Error('map substitution');
    return items.map((item) => {
      const input = Object.create(null);
      for (const [key, field] of fields) input[key] = field ? field.value : item;
      calls.push({ name: name.value, input, awaited: false });
      return marker('call', calls.length - 1);
    });
  };
  function expression() {
    if (peek('await')) {
      at++; awaitedAt.add(at); const value = expression();
      if (isMarker(value) && value.marker === 'call') calls[value.value].awaited = true;
      else if (isMarker(value) && (value.marker === 'all' || value.marker === 'allSettled')) for (const i of value.value) calls[i].awaited = true;
      return value;
    }
    let value;
    const token = ts[at++]; if (!token) throw Error('expression');
    if (token.type === 'literal') value = token.value;
    // A template interpolation can throw, mutate state, or call another tool. Once it
    // appears outside the one proved formatter, no later statement is known to run.
    else if (token.type === 'template') throw Error('template expression');
    else if (token.value === '-' && ts[at]?.type === 'literal' && typeof ts[at].value === 'number') value = -ts[at++].value;
    else if (token.value === '(') { value = expression(); take(')'); }
    else if (token.value === '[') {
      value = [];
      while (!peek(']')) { value.push(expression()); if (!peek(',')) break; at++; if (peek(']')) break; }
      take(']');
    } else if (token.value === '{') {
      value = Object.create(null);
      while (!peek('}')) {
        const key = ts[at++];
        if (!key || !['id', 'literal'].includes(key.type) || typeof key.value !== 'string' || PROTOTYPE_NAMES.has(key.value)) throw Error('key');
        // C-02 M33 (2): shorthand `{name}` is exactly `{name: name}`. Re-read the key token as
        // the value expression, so it resolves and fails exactly as the explicit identifier.
        if (key.type === 'id' && (peek(',') || peek('}'))) { at--; value[key.value] = expression(); }
        else { take(':'); value[key.value] = expression(); }
        if (!peek(',')) break; at++; if (peek('}')) break;
      }
      take('}');
    } else if (token.type === 'id') {
      if (token.value === 'true') value = true;
      else if (token.value === 'false') value = false;
      else if (token.value === 'null') value = null;
      else if (token.value === 'tools' && peek('.')) {
        at++; const name = ts[at++]; if (name?.type !== 'id' || PROTOTYPE_NAMES.has(name.value)) throw Error('tool');
        const args = argumentsOf();
        // An invalid invocation may throw before any later statement. Keep only the
        // already completed prefix instead of treating this call as a harmless value.
        if (args.length !== 1 || !literal(args[0])) throw Error('tool arguments');
        value = marker('call', calls.length);
        calls.push({ name: name.value, input: args[0], awaited: false });
      } else if (token.value === 'Promise' && peek('.')) {
        const awaited = awaitedAt.has(at - 1);
        at++; const method = ts[at++]?.value;
        if (method !== 'all' && method !== 'allSettled') throw Error('promise');
        const mapped = method === 'allSettled' && awaited ? literalMap() : null;
        const args = mapped ? [mapped] : argumentsOf();
        if (args.length !== 1 || !Array.isArray(args[0]) || !args[0].every((x) => isMarker(x) && x.marker === 'call')) throw Error('promise');
        value = marker(method, args[0].map((x) => x.value));
        if (mapped) expandedSettled.add(value);
      } else if (token.value === 'JSON' && peek('.')) {
        at++; take('stringify'); const args = argumentsOf(); if (args.length !== 1) throw Error('json');
        // Only a proved result reference keeps its identity; any other stringified value is text.
        value = isMarker(args[0]) ? args[0] : unknown;
      } else if (token.value === 'notify' && peek('(')) {
        // Notifications can be separate outputs under the wrapper call ID, without a
        // distinct protocol marker. Their text could imitate completion or cell headers;
        // it cannot prove that any following source calls were reached.
        throw Error('notification boundary');
      } else if (['text', 'image', 'audio', 'store'].includes(token.value) && peek('(')) {
        const args = argumentsOf();
        if (token.value === 'text') emissions.push(args.length === 1 && isMarker(args[0])
          && !expandedSettled.has(args[0]) ? args[0] : null);
        else if (token.value === 'image' || token.value === 'audio') {
          inexactEmissions(); unsupported++;
        }
        value = unknown;
      } else if (bindings.has(token.value)) value = bindings.get(token.value);
      else throw Error('unbound identifier');
    } else throw Error('expression');
    while (peek('.')) {
      at++; const key = ts[at++]; if (key?.type !== 'id') throw Error('property');
      if (isMarker(value) && value.marker === 'call' && key.value === 'output') value = marker('output', value.value);
      else if (literal(value) && value && typeof value === 'object' && Object.hasOwn(value, key.value)) value = value[key.value];
      // Null/undefined access throws, and a missing or unknown property can invoke a
      // getter. Neither proves that a later tool call in this wrapper was reached.
      else throw Error('unproved property');
    }
    return value;
  }
  while (at < ts.length) {
    if (peek(';')) { at++; continue; }
    const start = at; const callStart = calls.length; const emissionStart = emissions.length;
    try {
      if (['const', 'let', 'var'].includes(ts[at]?.value)) {
        const declaration = ts[at++].value;
        const name = ts[at++]; if (name?.type !== 'id') throw Error('binding');
        if (['tools', 'Promise', 'JSON', 'text', 'image', 'audio', 'notify', 'store'].includes(name.value)) throw Error('shadowing');
        declarations.set(name.value, (declarations.get(name.value) ?? 0) + 1);
        take('='); const initializer = at; const value = expression();
        if (!peek(';') && at < ts.length) throw Error('statement');
        bindings.set(name.value, value);
        literalArrays.delete(name.value);
        if (declaration === 'const' && ts[initializer]?.value === '[') {
          // Only an initializer that is itself a dense primitive array literal, token for token.
          const end = at; at = initializer;
          try { const items = primitiveArray(); if (at === end) literalArrays.set(name.value, { statement: completedStatements, items }); }
          catch { /* not a literal array */ }
          at = end;
        }
        if (isMarker(value) && value.marker === 'allSettled' && !settledBindings.has(value))
          settledBindings.set(value, { name: name.value, declaration });
      } else {
        if (!canonicalAllSettledEnvelopeLoop() && !canonicalAllSettledIndexLoop()
          && !canonicalAllSettledVisibleOutputLoop() && !canonicalAllSettledEntries()
          && !canonicalAllSettledForEach()) expression();
        if (!peek(';') && at < ts.length) throw Error('statement');
      }
      if (peek(';')) at++;
      completedStatements++;
    } catch {
      // A parsed call may have been behind an unrecognised operator. Roll back the whole
      // statement (e.g. false && tools.exec_command(...)), then declare its action gap.
      at = start; calls.length = callStart; emissions.length = emissionStart;
      // C-02 M33 native-first refreeze: an unsupported statement, whatever it names, leaves the
      // script's dispatched calls unproved (`foo()` may reach tools by a route never spelled here).
      statementRejected = true;
      const suffix = ts.slice(start);
      unsupported += remainingActions() + Number(suffix.some((token) => token.type === 'template'));
      // An unsupported statement after visible emissions is a source coverage gap even
      // when it contains no further tool call (for example `void 0`). With no emitted
      // prefix, the existing unmapped-result accounting covers output-only formatters.
      if (emissions.length && !unsupported) unsupported++;
      inexactEmissions();
      // A rejected statement may have appended a nested emission before it failed to
      // parse. Its boundary cannot extend past the completed prior statements.
      emissionsPrefixLength = Math.min(emissionsPrefixLength, emissionStart);
      // notify can produce a separate result row with the wrapper's call ID and a forged
      // completion header. No row proves an earlier prefix when this boundary is reached.
      if (suffix.some((token) => token.value === 'notify')) emissionsPrefixLength = 0;
      break;
    }
  }
  unsupported += calls.filter((call) => !call.awaited).length;
  // A hoisted text/String/JSON declaration rebinds every emitter: no emission is proved.
  if (emitterRebound) { emissionsExact = false; emissionsPrefixLength = 0; }
  return { calls, emissions, emissionsExact, emissionsPrefixLength, unsupported,
    tierOneSourceExact: tierOneMatched && emissionsExact && unsupported === 0 && completedStatements === 2,
    inventoryExact: !statementRejected && unsupported === 0 && dispatchDirect };
}

/** Match only output positions explicitly emitted by parsed text(callResult) expressions. */
export function execResults(output, parsed) {
  const blocks = Array.isArray(output) ? output.filter((b) => b && ['text', 'input_text'].includes(b.type) && typeof b.text === 'string').map((b) => b.text)
    : typeof output === 'string' ? [output] : [];
  const completed = blocks.length > 0 && /^Script completed\b/.test(blocks[0]);
  const results = new Map();
  if (!completed || parsed.transportExact === false) return { completed, results };
  const payloads = blocks.slice(1);
  const emissionCount = parsed.emissionsExact ? parsed.emissions.length : parsed.emissionsPrefixLength;
  if (!Number.isSafeInteger(emissionCount) || emissionCount < 0 || emissionCount > parsed.emissions.length
    || (parsed.emissionsExact ? payloads.length !== emissionCount : payloads.length < emissionCount)) {
    return { completed, results };
  }
  // C-02 strict JSON: a payload that parses but repeats a key stays text. Every typed reader
  // below then refuses it as a non-object/array; only a single text(result) keeps its text.
  const strict = payloads.slice(0, emissionCount).map((payload) => strictJson(payload));
  const decoded = strict.map(({ value }) => value);
  const batches = new Map();
  for (let i = 0; i < emissionCount; i++) {
    const ref = parsed.emissions[i];
    if (!isMarker(ref) || !['settledForEach', 'settledNested', 'settledProjection', 'settledStatusValue'].includes(ref.marker)) continue;
    const entries = batches.get(ref.value.batch) ?? [];
    entries.push({ ref, position: i }); batches.set(ref.value.batch, entries);
  }
  const validBatches = new Set();
  for (const [batch, entries] of batches) {
    const tierOne = entries[0].ref.marker === 'settledStatusValue';
    // A Tier 1 emitter is the entire wrapper output grammar. Earlier/later output,
    // a partly parsed suffix, or another call cannot borrow its indexed receipt.
    if (tierOne && (parsed.tierOneSourceExact !== true || !parsed.emissionsExact || parsed.unsupported !== 0
      || parsed.calls.length !== entries.length || emissionCount !== entries.length
      || payloads.length !== entries.length)) continue;
    if (entries.length !== entries[0].ref.value.count || entries.some(({ ref, position }, index) => {
      const payload = decoded[position];
      const indexKey = ref.value.indexKey;
      if (ref.value.index !== index || ref.value.count !== entries.length || !payload || typeof payload !== 'object'
        || Array.isArray(payload) || !Object.hasOwn(payload, indexKey) || payload[indexKey] !== ref.value.index) return true;
      if (tierOne) {
        const valueKey = ref.value.valueKey;
        if (ref.marker !== 'settledStatusValue' || ref.value.valueKey !== entries[0].ref.value.valueKey
          || duplicateJsonKeys(payloads[position]) || Object.keys(payload).length !== 3
          || !Object.hasOwn(payload, 'status') || !Object.hasOwn(payload, valueKey)
          || !Object.keys(payload).every((key) => key === indexKey || key === 'status' || key === valueKey)
          || !['fulfilled', 'rejected'].includes(payload.status)) return true;
        return payload.status === 'fulfilled' && payload[valueKey] == null;
      }
      const nested = ref.marker === 'settledNested';
      const projected = ref.marker === 'settledProjection';
      if ((nested || projected) && (Object.keys(payload).length !== 2 || !Object.hasOwn(payload, 'result'))) return true;
      if (projected) return false;
      const settled = nested ? payload.result : payload;
      if (!settled || typeof settled !== 'object' || Array.isArray(settled)) return true;
      const keys = Object.keys(settled);
      return settled.status === 'fulfilled'
        ? !Object.hasOwn(settled, 'value') || !keys.every((key) => key === 'status' || key === 'value' || !nested && key === indexKey)
        : settled.status !== 'rejected' || !keys.every((key) => key === 'status' || key === 'reason' || !nested && key === indexKey);
    })) continue;
    validBatches.add(batch);
  }
  const validVisibleBatches = new Set();
  const indexedVisible = new Map();
  for (let i = 0; i < emissionCount; i++) {
    const ref = parsed.emissions[i];
    if (!isMarker(ref) || ref.marker !== 'settledVisibleOutput' || !ref.value.indexPrefix) continue;
    const entries = indexedVisible.get(ref.value.batch) ?? [];
    entries.push({ ref, position: i }); indexedVisible.set(ref.value.batch, entries);
  }
  for (const [batch, entries] of indexedVisible) {
    if (entries.length === entries[0].ref.value.count && entries.every(({ ref, position }, index) =>
      ref.value.index === index && ref.value.count === entries.length
      && payloads[position].startsWith(`${index}: `))) validVisibleBatches.add(batch);
  }
  for (let i = 0; i < emissionCount; i++) {
    const ref = parsed.emissions[i]; if (!isMarker(ref)) continue;
    const value = decoded[i];
    if (ref.marker === 'call') results.set(ref.value, strict[i].json && !strict[i].strict
      // The source proves this text is the call's result; a repeated key proves no status.
      ? { value: payloads[i], rawOutput: true, outcomeUnknown: true, visiblePayload: payloads[i] }
      : { value, rawOutput: false, visiblePayload: payloads[i] });
    else if (ref.marker === 'output') { if (!results.has(ref.value)) results.set(ref.value, {
      value: payloads[i], rawOutput: true, visiblePayload: payloads[i] }); }
    else if (ref.marker === 'settledVisibleOutput') {
      if (ref.value.indexPrefix && !validVisibleBatches.has(ref.value.batch)) continue;
      // The source proves only the displayed text's owner. A rejected reason may itself say
      // "tests passed", and a fulfilled tool result may omit its exit code entirely.
      results.set(ref.value.call, { value: payloads[i], rawOutput: true,
        outcomeUnknown: true, visiblePayload: payloads[i] });
    }
    else if (ref.marker === 'settledEnvelope') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const keys = Object.keys(value);
      if (value.status === 'rejected' && keys.every((key) => key === 'status' || key === 'reason'))
        results.set(ref.value.call, { value: { output: '', is_error: true }, rawOutput: false,
          visiblePayload: payloads[i] });
      else if (value.status === 'fulfilled' && Object.hasOwn(value, 'value')
        && keys.every((key) => key === 'status' || key === 'value') && value.value != null)
        results.set(ref.value.call, { value: value.value, rawOutput: false,
          visiblePayload: payloads[i] });
    }
    else if (ref.marker === 'settledProjection') {
      if (!validBatches.has(ref.value.batch)) continue;
      const projected = value.result;
      const rejectionShape = ref.value.rejectionShape;
      const couldBeRejection = rejectionShape === 'string'
        ? typeof projected === 'string'
        : projected && typeof projected === 'object' && !Array.isArray(projected)
          && Object.keys(projected).length === 1
          && typeof projected[rejectionShape] === 'string';
      if (projected && typeof projected === 'object' && !Array.isArray(projected) && !couldBeRejection) {
        results.set(ref.value.call, { value: projected, rawOutput: false, visiblePayload: payloads[i] });
      } else results.set(ref.value.call, { value: payloads[i], rawOutput: true,
        outcomeUnknown: true, visiblePayload: payloads[i] });
    }
    else if (ref.marker === 'settledStatusValue') {
      if (!validBatches.has(ref.value.batch)) continue;
      if (value.status === 'rejected') results.set(ref.value.call, {
        value: { output: '', is_error: true }, rawOutput: false,
        visiblePayload: payloads[i],
      });
      else results.set(ref.value.call, { value: value[ref.value.valueKey], rawOutput: false,
        visiblePayload: payloads[i] });
    }
    else if (ref.marker === 'settledForEach' || ref.marker === 'settledNested') {
      if (!validBatches.has(ref.value.batch)) continue;
      const settled = ref.marker === 'settledNested' ? value.result : value;
      if (settled.status === 'rejected') results.set(ref.value.call, {
        value: { output: '', is_error: true }, rawOutput: false,
        visiblePayload: payloads[i] });
      else if (settled.value != null) results.set(ref.value.call, {
        value: settled.value, rawOutput: false, visiblePayload: payloads[i] });
    }
    else if ((ref.marker === 'all' || ref.marker === 'allSettled') && Array.isArray(value) && value.length === ref.value.length) {
      for (let j = 0; j < value.length; j++) {
        const settled = value[j];
        if (ref.marker === 'allSettled' && settled && typeof settled === 'object' && !Array.isArray(settled)
          && settled.status === 'rejected' && Object.keys(settled).every((key) => key === 'status' || key === 'reason')) {
          // A rejected invocation is unsuccessful, not a missing successful result. Its reason
          // is not command stdout or an exit code: even a reason containing "tests passed" must
          // not turn rejection into success. Undefined reasons may be omitted by JSON.stringify.
          results.set(ref.value[j], { value: { output: '', is_error: true }, rawOutput: false });
          continue;
        }
        if (ref.marker === 'allSettled' && (!settled || typeof settled !== 'object' || Array.isArray(settled)
          || settled.status !== 'fulfilled' || !Object.hasOwn(settled, 'value')
          || !Object.keys(settled).every((key) => key === 'status' || key === 'value'))) continue;
        const result = ref.marker === 'allSettled' ? settled.value : settled;
        if (result != null) results.set(ref.value[j], { value: result, rawOutput: false });
      }
    }
  }
  return { completed, results };
}
